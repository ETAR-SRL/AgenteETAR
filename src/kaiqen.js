/** Lecturas de KAIQEN; nunca inicia sesión ni escribe en el sistema de calidad. */
export class KaiqenError extends Error {
  constructor(message, code, status, upstreamStatus) {
    super(message)
    this.name = 'KaiqenError'
    this.code = code
    this.status = status
    if (upstreamStatus !== undefined) this.upstreamStatus = upstreamStatus
  }
}

const LIMITACIONES = Object.freeze([
  'Sólo incluye los proyectos y módulos visibles para la cuenta autenticada y su planta.',
  'La fecha de consulta no acredita la fecha de actualización de cada registro.',
  'Respetá sin_ia_externa y sin_ia_externa_por_cliente antes de enviar datos a una IA externa.'
])

function invalid(message) {
  return new KaiqenError(message, 'KAIQEN_INVALID_INPUT', 400)
}

function baseAddress(value) {
  let url
  try { url = new URL(value) } catch { throw invalid('La dirección de KAIQEN no es válida.') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw invalid('KAIQEN requiere HTTPS; HTTP sólo se admite en loopback.')
  }
  if (url.username || url.password || url.search || url.hash || !['/', '/api', '/api/'].includes(url.pathname)) {
    throw invalid('Usá el origen de KAIQEN o su ruta /api, sin credenciales ni parámetros.')
  }
  return url.origin
}

function entityId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw invalid('El identificador de KAIQEN no es válido.')
  }
  return value
}

function projectQuery(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw invalid('Los filtros de proyectos no son válidos.')
  const allowed = new Set(['q', 'status', 'offset', 'limit'])
  for (const key of Object.keys(params)) if (!allowed.has(key)) throw invalid('El filtro de proyectos no está admitido.')
  for (const key of ['q', 'status']) {
    if (params[key] !== undefined && (typeof params[key] !== 'string' || params[key].length > 100 || /[\x00-\x1f\x7f]/.test(params[key]))) {
      throw invalid('El texto del filtro no es válido.')
    }
  }
  function integer(key, fallback, max) {
    if (params[key] === undefined) return fallback
    const raw = params[key]
    if ((typeof raw !== 'number' && typeof raw !== 'string') || !/^\d+$/.test(String(raw))) throw invalid('La paginación no es válida.')
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < (key === 'limit' ? 1 : 0) || value > max) throw invalid('La paginación está fuera de rango.')
    return value
  }
  return { q: params.q?.trim().toLocaleLowerCase('es') ?? '', status: params.status?.trim() ?? '', offset: integer('offset', 0, 1000000), limit: integer('limit', 100, 500) }
}

export function createKaiqen({ baseUrl, token, fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const origin = baseUrl ? baseAddress(baseUrl) : null
  if (token !== undefined && token !== null && (typeof token !== 'string' || /[\r\n]/.test(token))) throw invalid('La credencial de KAIQEN no es válida.')
  const accessToken = token?.trim() || null
  if (accessToken?.startsWith('kqi_')) {
    throw invalid('La clave de sincronización ERP no permite leer KAIQEN. Configurá un token de acceso de usuario.')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw invalid('El tiempo de espera de KAIQEN no es válido.')
  if (typeof fetchImpl !== 'function') throw invalid('No hay un cliente HTTP disponible.')
  const available = Boolean(origin && accessToken)

  async function read(path, expectedShape) {
    if (!available) throw new KaiqenError('Configurá la dirección y el token de acceso de KAIQEN.', 'KAIQEN_NOT_CONFIGURED', 503)
    if (!/^\/api\/(projects(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?:\/(?:quality-tower|vinculo-erp))?)?|portfolio\/quality-rollup|erp\/productos\/[A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.test(path)) {
      throw invalid('La ruta de KAIQEN no está admitida.')
    }
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      const response = await fetchImpl(`${origin}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
        credentials: 'omit',
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal
      })
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        throw new KaiqenError('KAIQEN redirigió la consulta; no se siguió la redirección.', 'KAIQEN_REDIRECT_BLOCKED', 502, response.status)
      }
      if (!response.ok) {
        const errors = {
          401: ['La sesión de KAIQEN venció o no es válida. Proporcioná un token de acceso vigente.', 'KAIQEN_UNAUTHENTICATED', 401],
          403: ['La cuenta de KAIQEN no tiene acceso al módulo o proyecto, o debe completar MFA.', 'KAIQEN_FORBIDDEN', 403],
          404: ['El registro no existe o no es visible para esta cuenta de KAIQEN.', 'KAIQEN_NOT_FOUND', 404],
          429: ['KAIQEN limitó las consultas. Reintentá más tarde.', 'KAIQEN_RATE_LIMITED', 429]
        }
        const [message, code, status] = errors[response.status] ?? ['KAIQEN no pudo completar la consulta.', 'KAIQEN_UPSTREAM_ERROR', 502]
        throw new KaiqenError(message, code, status, response.status)
      }
      let data
      try { data = await response.json() } catch {
        if (timedOut) throw new KaiqenError('KAIQEN superó el tiempo de espera.', 'KAIQEN_TIMEOUT', 504)
        throw new KaiqenError('KAIQEN devolvió una respuesta que no es JSON.', 'KAIQEN_INVALID_RESPONSE', 502)
      }
      if (!expectedShape(data)) throw new KaiqenError('La respuesta de KAIQEN no coincide con el contrato esperado.', 'KAIQEN_INVALID_RESPONSE', 502)
      return { origen: 'kaiqen', fetchedAt: new Date().toISOString(), endpoint: path, data, limitaciones: [...LIMITACIONES] }
    } catch (error) {
      if (error instanceof KaiqenError) throw error
      if (timedOut) throw new KaiqenError('KAIQEN superó el tiempo de espera.', 'KAIQEN_TIMEOUT', 504)
      // El error de red puede contener URL, cabeceras o credenciales: no se propaga.
      throw new KaiqenError('No se pudo conectar con KAIQEN.', 'KAIQEN_CONNECTION_FAILED', 502)
    } finally {
      clearTimeout(timer)
    }
  }

  return Object.freeze({
    available,
    async projects(params = {}) {
      const query = projectQuery(params)
      const result = await read('/api/projects', data => Array.isArray(data) && data.every(item => item && typeof item.id === 'string'))
      const filtered = result.data.filter(item => {
        const text = [item.code, item.name, item.customer].filter(value => typeof value === 'string').join(' ').toLocaleLowerCase('es')
        return (!query.q || text.includes(query.q)) && (!query.status || item.status === query.status)
      })
      return {
        ...result,
        data: filtered.slice(query.offset, query.offset + query.limit),
        pagination: { offset: query.offset, limit: query.limit, total: filtered.length, upstreamPagination: false },
        limitaciones: [...result.limitaciones, 'Los filtros y la paginación se aplican localmente: KAIQEN entrega toda la cartera visible.']
      }
    },
    async project(id) {
      return read(`/api/projects/${entityId(id)}`, data => Boolean(data && typeof data.project === 'object' && data.project && typeof data.project.id === 'string'))
    },
    async projectLink(id) {
      return read(`/api/projects/${entityId(id)}/vinculo-erp`, data => Boolean(
        data && typeof data.integracion_activa === 'boolean' &&
        Number.isInteger(data.piezas) && Number.isInteger(data.vinculadas) &&
        Array.isArray(data.sin_vincular) && Array.isArray(data.sugerencias_referencia) &&
        (data.articulo_referencia === null || (
          data.articulo_referencia && typeof data.articulo_referencia.id === 'string' &&
          typeof data.articulo_referencia.codigo === 'string' && typeof data.articulo_referencia.clave === 'string'
        ))
      ))
    },
    async product(id) {
      return read(`/api/erp/productos/${entityId(id)}`, data => Boolean(
        data && typeof data.id === 'string' && typeof data.codigo === 'string' &&
        typeof data.clave === 'string' && typeof data.sucursal === 'string' &&
        typeof data.precios_visibles === 'boolean' && (data.precios === null || Array.isArray(data.precios))
      ))
    },
    async quality(id) {
      if (id === undefined) return read('/api/portfolio/quality-rollup', data => Boolean(data && Array.isArray(data.projects)))
      return read(`/api/projects/${entityId(id)}/quality-tower`, data => Boolean(data && ['VERDE', 'AMBAR', 'ROJO'].includes(data.semaforo_global)))
    }
  })
}

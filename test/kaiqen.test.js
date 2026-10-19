import test from 'node:test'
import assert from 'node:assert/strict'
import { createKaiqen } from '../src/kaiqen.js'

const config = { baseUrl: 'https://kaiqen.example/api', token: 'test-access-token' }
function fixture(body, options = {}) {
  const calls = []
  const adapter = createKaiqen({ ...config, ...options, fetchImpl: async (url, request) => {
    calls.push({ url, request })
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  } })
  return { adapter, calls }
}

test('consulta sólo GET con Bearer, evita cookies y redirecciones; filtra y pagina localmente', async () => {
  const { adapter, calls } = fixture([
    { id: 'p-1', code: 'PR-1', name: 'Prensa', status: 'ACTIVO' },
    { id: 'p-2', code: 'PR-2', name: 'Prensa dos', status: 'ACTIVO' },
    { id: 'p-3', name: 'Molde', status: 'CERRADO' }
  ])
  const result = await adapter.projects({ q: 'PRENSA', status: 'ACTIVO', limit: '1', offset: '1' })
  assert.equal(adapter.available, true)
  assert.equal(result.origen, 'kaiqen')
  assert.equal(result.data[0].id, 'p-2')
  assert.deepEqual(result.pagination, { offset: 1, limit: 1, total: 2, upstreamPagination: false })
  assert.ok(!Number.isNaN(Date.parse(result.fetchedAt)))
  assert.ok(result.limitaciones.some(value => value.includes('planta')))
  assert.equal(calls[0].url, 'https://kaiqen.example/api/projects')
  assert.equal(calls[0].request.method, 'GET')
  assert.equal(calls[0].request.headers.Authorization, 'Bearer test-access-token')
  assert.equal(calls[0].request.redirect, 'manual')
  assert.equal(calls[0].request.credentials, 'omit')
})

test('usa las rutas reales de proyecto y calidad y conserva restricciones de IA', async () => {
  const project = fixture({ project: { id: 'p_1', sin_ia_externa: true, sin_ia_externa_por_cliente: false } })
  assert.equal((await project.adapter.project('p_1')).data.project.sin_ia_externa, true)
  assert.equal(project.calls[0].url, 'https://kaiqen.example/api/projects/p_1')
  const quality = fixture({ semaforo_global: 'AMBAR', fnc: { total: 1 } })
  assert.equal((await quality.adapter.quality('p_1')).data.semaforo_global, 'AMBAR')
  assert.equal(quality.calls[0].url, 'https://kaiqen.example/api/projects/p_1/quality-tower')
  const portfolio = fixture({ projects: [] })
  await portfolio.adapter.quality()
  assert.equal(portfolio.calls[0].url, 'https://kaiqen.example/api/portfolio/quality-rollup')
})

test('sin configuración no consulta y no confunde configuración con conectividad', async () => {
  let calls = 0
  const adapter = createKaiqen({ fetchImpl: () => { calls += 1 } })
  assert.equal(adapter.available, false)
  await assert.rejects(adapter.projects(), { code: 'KAIQEN_NOT_CONFIGURED', status: 503 })
  assert.equal(calls, 0)
})

test('rechaza URLs inseguras, credenciales embebidas, rutas y claves ERP', () => {
  for (const baseUrl of ['http://erp.example', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?token=a', 'https://example.com#x', 'file:///etc/passwd']) {
    assert.throws(() => createKaiqen({ ...config, baseUrl }), { code: 'KAIQEN_INVALID_INPUT' })
  }
  for (const baseUrl of ['http://127.0.0.1:8000', 'http://localhost:8000/api/', 'http://[::1]:8000']) {
    assert.equal(createKaiqen({ ...config, baseUrl }).available, true)
  }
  assert.throws(() => createKaiqen({ ...config, token: 'kqi_prefijo_secreto' }), { code: 'KAIQEN_INVALID_INPUT' })
  assert.throws(() => createKaiqen({ ...config, token: 'token\r\nInjected: yes' }), { code: 'KAIQEN_INVALID_INPUT' })
})

test('bloquea path traversal y filtros no admitidos antes de usar la red', async () => {
  const { adapter, calls } = fixture([])
  for (const id of ['../auth/me', '%2e%2e', 'id?x=1', '//evil.example', 'x/y', '', null]) {
    await assert.rejects(adapter.project(id), { code: 'KAIQEN_INVALID_INPUT' })
    await assert.rejects(adapter.projectLink(id), { code: 'KAIQEN_INVALID_INPUT' })
    await assert.rejects(adapter.product(id), { code: 'KAIQEN_INVALID_INPUT' })
  }
  for (const query of [{ tenant: 'otro' }, { limit: 0 }, { limit: 501 }, { limit: true }, { offset: -1 }, { q: ['x'] }, { q: 'x\n' }]) {
    await assert.rejects(adapter.projects(query), { code: 'KAIQEN_INVALID_INPUT' })
  }
  assert.equal(calls.length, 0)
})

test('no sigue redirecciones y no expone Location ni respuestas de error', async () => {
  let calls = 0
  const adapter = createKaiqen({ ...config, fetchImpl: async (_, request) => {
    calls += 1
    assert.equal(request.redirect, 'manual')
    return new Response('sensitive-body', { status: 302, headers: { Location: 'https://evil.example' } })
  } })
  await assert.rejects(adapter.projects(), error => error.code === 'KAIQEN_REDIRECT_BLOCKED' && !error.message.includes('evil'))
  assert.equal(calls, 1)
})

test('401 y 403 son explícitos; errores de red y servidor no filtran secretos', async () => {
  for (const [status, code] of [[401, 'KAIQEN_UNAUTHENTICATED'], [403, 'KAIQEN_FORBIDDEN'], [404, 'KAIQEN_NOT_FOUND'], [429, 'KAIQEN_RATE_LIMITED'], [500, 'KAIQEN_UPSTREAM_ERROR']]) {
    const adapter = createKaiqen({ ...config, fetchImpl: async () => new Response('sensitive-body', { status }) })
    await assert.rejects(adapter.projects(), error => error.code === code && error.upstreamStatus === status && !error.message.includes('sensitive-body'))
  }
  const adapter = createKaiqen({ ...config, fetchImpl: async () => { throw new Error('test-access-token sensitive-body') } })
  await assert.rejects(adapter.projects(), error => error.code === 'KAIQEN_CONNECTION_FAILED' && !error.message.includes('test-access-token'))
})

test('rechaza HTML y respuestas fuera del contrato', async () => {
  const html = createKaiqen({ ...config, fetchImpl: async () => new Response('<html>login</html>') })
  await assert.rejects(html.projects(), { code: 'KAIQEN_INVALID_RESPONSE' })
  const { adapter } = fixture({ rows: [] })
  await assert.rejects(adapter.projects(), { code: 'KAIQEN_INVALID_RESPONSE' })
})

test('cancela la consulta al vencer el tiempo configurado', async () => {
  const adapter = createKaiqen({ ...config, timeoutMs: 10, fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }) })
  await assert.rejects(adapter.projects(), { code: 'KAIQEN_TIMEOUT', status: 504 })
})

test('lee el vínculo explícito y obtiene sucursal desde la ficha del producto', async () => {
  const reference = {
    id: 'erp-product-1', clave: '0101|PRJ-001', codigo: 'PRJ-001', nombre: 'Referencia de prueba',
    habilitacion: 'HABILITADO', tipo_kaiqen: null, bloqueado_en_erp: false,
    baja_en_erp_en: null, ultima_vez_en: '2026-10-19T12:00:00Z', nueva: false, piezas: 0
  }
  const link = fixture({ integracion_activa: true, piezas: 1, vinculadas: 0,
    sin_vincular: [{ id: 'part-1', part_no: 'PN-001', revision: 'A', name: null }],
    articulo_referencia: reference, sugerencias_referencia: [] })
  const linked = await link.adapter.projectLink('p_1')
  assert.equal(link.calls[0].url, 'https://kaiqen.example/api/projects/p_1/vinculo-erp')
  assert.deepEqual(linked.data.articulo_referencia, reference)
  assert.equal(Object.hasOwn(linked.data.articulo_referencia, 'sucursal'), false)
  const product = fixture({ ...reference, sucursal: '0101', customer_id: null, customer_nombre: null,
    datos: [], piezas_vinculadas: [], proveedores: [], clientes: [], precios_visibles: false, precios: null })
  const detailed = await product.adapter.product(linked.data.articulo_referencia.id)
  assert.equal(product.calls[0].url, 'https://kaiqen.example/api/erp/productos/erp-product-1')
  assert.equal(detailed.data.sucursal, '0101')
  assert.equal(detailed.data.codigo, 'PRJ-001')
  assert.equal(detailed.data.precios_visibles, false)
  assert.equal(detailed.data.precios, null)
})

test('conserva referencia ausente y sugerencias sin convertirlas en vínculos', async () => {
  const { adapter } = fixture({ integracion_activa: true, piezas: 0, vinculadas: 0, sin_vincular: [],
    articulo_referencia: null, sugerencias_referencia: [{ id: 'suggested-1', codigo: 'PRJ-001' }] })
  const result = await adapter.projectLink('p_1')
  assert.equal(result.data.articulo_referencia, null)
  assert.equal(result.data.sugerencias_referencia.length, 1)
})

test('rechaza vínculos/productos incompletos y mantiene explícito el rechazo de permisos', async () => {
  const wrongLink = fixture({ articulo_referencia: { codigo: 'PRJ-001' } })
  await assert.rejects(wrongLink.adapter.projectLink('p_1'), { code: 'KAIQEN_INVALID_RESPONSE' })
  const wrongProduct = fixture({ id: 'erp-1', codigo: 'PRJ-001', clave: '0101|PRJ-001', precios_visibles: false, precios: null })
  await assert.rejects(wrongProduct.adapter.product('erp-1'), { code: 'KAIQEN_INVALID_RESPONSE' })
  const forbidden = createKaiqen({ ...config, fetchImpl: async () => new Response('', { status: 403 }) })
  await assert.rejects(forbidden.projectLink('p_1'), { code: 'KAIQEN_FORBIDDEN', upstreamStatus: 403 })
  await assert.rejects(forbidden.product('erp-1'), { code: 'KAIQEN_FORBIDDEN', upstreamStatus: 403 })
})

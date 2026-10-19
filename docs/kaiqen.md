# Contrato de lectura de KAIQEN

Relevamiento estático del 19/10/2026 sobre `C:/Users/vigil/OneDrive/Escritorio/ICOMPP`, checkout limpio `9fe5b292bb5d1ec9fe7374abe7fd5a9222f9c3ec`. Se leyó código, contrato y documentación vigente sin leer secretos, modificar KAIQEN, iniciar servicios ni consultar datos productivos. Los tests del adaptador usan dobles HTTP: no acreditan conectividad ni permisos reales.

## Adaptador

`src/kaiqen.js` exporta `createKaiqen({baseUrl, token, fetchImpl, timeoutMs})`. `available` indica que existe configuración; no es una prueba de salud. Cada lectura devuelve `{origen: 'kaiqen', fetchedAt, endpoint, data, limitaciones}`. `fetchedAt` es el instante de lectura, no la fecha de modificación de la fuente. Los cuerpos conservan el contrato de KAIQEN.

| Método | GET de KAIQEN | Módulo exigido |
|---|---|---|
| `projects({q,status,limit,offset})` | `/api/projects` | `cartera` |
| `project(id)` | `/api/projects/{id}` | `cartera` |
| `projectLink(id)` | `/api/projects/{id}/vinculo-erp` | `cartera` |
| `product(id)` | `/api/erp/productos/{id}` | `cartera`; `costeo` para ver precios |
| `quality(id)` | `/api/projects/{id}/quality-tower` | `calidad` |
| `quality()` | `/api/portfolio/quality-rollup` | `inteligencia` |

`/api/projects` entrega un array sin filtros ni paginación upstream. El adaptador filtra `q` sobre código/nombre/cliente y `status` por igualdad; después aplica `offset` y `limit` locales (100 por defecto, máximo 500). Su bloque `pagination` declara `upstreamPagination: false`. No hay filtro arbitrario de tenant ni acceso SQL a Supabase.

Las rutas están restringidas; los identificadores no admiten barras, escapes ni parámetros. Sólo HTTPS o HTTP de loopback; no se siguen redirecciones ni se envían cookies. El tiempo de espera es 10 segundos por defecto. `KaiqenError` publica `code`, `status` y, cuando corresponde, `upstreamStatus`, sin cuerpo upstream ni errores de red que puedan contener credenciales. 401 y 403 son explícitos, nunca resultados vacíos exitosos.

## Autenticación, permisos y confidencialidad

Las lecturas normales aceptan un JWT de acceso de usuario mediante `Authorization: Bearer`. La API revalida usuario activo, tenant activo, rol, módulos y proyectos visibles en cada request; fija el tenant desde la cuenta de la base. El alcance puede ser `todos` o `asignados`. No compartir caché entre cuentas/plantas ni inferir que una cartera vacía significa que la planta no tiene proyectos. Evidencia: `api/deps.py:188`, `api/deps.py:700`, montaje en `api/main.py`.

El JWT vence por defecto a los **30 minutos** (`api/config.py:59`), configurable en KAIQEN. El adaptador sólo recibe el token: no obtiene contraseñas, no inicia sesión, no evita MFA ni renueva tokens. Un token estático no resuelve una conexión desatendida durable. Hace falta una provisión y renovación autorizadas o implementar en KAIQEN un mecanismo dedicado de lectura con alcances. La API existente permite renovación con refresh token rotatorio, pero eso no está implementado aquí.

La clave `kqi_...` del emisor tiene alcance `erp_sync` y sirve para recibir la sincronización del ERP; **no permite consultar proyectos ni catálogos**. El adaptador la rechaza. No reutilizar el secreto del servicio instalado.

El detalle de proyecto contiene `project.sin_ia_externa` y `project.sin_ia_externa_por_cliente`. Si cualquiera es verdadero, no enviar información de ese proyecto a una IA externa. Listado de proyectos y rollup de calidad no incluyen estos flags: antes de construir contexto externo, leer el detalle. La ausencia de un flag en una respuesta de listado no equivale a permiso. El adaptador conserva las marcas, pero la decisión de enviar contexto debe aplicarla el componente que llama al modelo.

Los precios de la ficha del producto sólo viajan con `costeo`: sin ese permiso, `precios_visibles: false` y `precios: null`. No interpretar ese null como ausencia de precios en el ERP.

## Vínculo explícito proyecto–ERP

`projectLink(id).data` tiene esta estructura (fuente: `api/schemas.py:26268`):

```ts
{
  integracion_activa: boolean,
  piezas: number,
  vinculadas: number,
  sin_vincular: Array<{id: string, part_no: string, revision: string, name: string | null}>,
  articulo_referencia: ErpProductoFilaOut | null,
  sugerencias_referencia: ErpProductoFilaOut[]
}
```

`ErpProductoFilaOut` contiene exactamente estos campos de salida (`api/schemas.py:26105`):

```ts
{
  id: string,
  clave: string,
  codigo: string,
  nombre: string | null,
  habilitacion: string,
  tipo_kaiqen: string | null,
  bloqueado_en_erp: boolean,
  baja_en_erp_en: string | null,
  ultima_vez_en: string,
  nueva: boolean,
  piezas: number
}
```

**`articulo_referencia` no trae `sucursal`.** Para componer el resumen, si hay referencia, llamar `product(articulo_referencia.id)`. `ErpProductoFichaOut` hereda todos los campos anteriores y agrega `sucursal`, `customer_id`, `customer_nombre`, `datos`, `piezas_vinculadas`, `proveedores`, `clientes`, `precios_visibles` y `precios` (`api/schemas.py:26169`). La ficha permite obtener el par explícito `{codigo,sucursal}` para consultar Protheus. Verificar coherencia del id/código devueltos con la referencia antes de cruzar fuentes.

La clave del espejo se construye como `sucursal|campos_de_clave`; para producto es `sucursal|codigo` (`src/integracion_erp.py:560`). Se conserva como evidencia. La ficha evita depender de interpretar una clave opaca cuando se necesita la sucursal. No completar un vínculo faltante con `sugerencias_referencia`: son propuestas sin confirmación.

El artículo de referencia utilizado para cotizar puede ser distinto del producto definitivo de las piezas. Para consultar los productos finales del proyecto se requiere además `GET /api/projects/{id}/parts`, cuyas filas tienen `erp_producto_id`, y luego la ficha de cada producto. Esa lectura de piezas no está expuesta como método del adaptador actual. No presentar los pendientes o ventas de la referencia como si abarcaran todos los productos finales del proyecto.

Un resumen puede consultar proyecto, calidad y vínculo en paralelo y después consultar la ficha de la referencia. Las fuentes pueden fallar o exigir permisos distintos: identificar cada resultado y su fecha, y conservar errores parciales. Ninguna consulta representa una transacción consistente entre KAIQEN y el ERP.

## Estados y calidad

El listado de proyectos incluye `id`, `code`, `name`, `customer`, `current_phase_no`, `phase_progress_pct`, `sop_date`, `status`, `apqp_risk`, `apqp_risk_reasons`, `etapa_de_vida`, `etapa_desde`, `etapa_marcas`, `arranque_faltantes`, `arranque_sin_ce_declaradas` y `reinicio_faltantes` (`api/schemas.py:944`). No confundir estado comercial, riesgo APQP y etapa de vida.

El detalle contiene `project`, `phases`, `gates`, `deliverables`, `team`, `phase_progress`, datos de etapa de vida, completitud, advertencias y resumen Run@Rate (`api/schemas.py:1814`).

La torre de calidad devuelve `sc`, `capability`, `msa`, `issues`, `fnc`, `cqi`, `calibraciones`, `verificaciones`, `safe_launch`, `cambios`, `run_at_rate`, `proveedores`, `lecciones`, `riesgos` y `semaforo_global` (`api/schemas.py:12343`). El semáforo es `VERDE|AMBAR|ROJO`; conservar las reglas derivadas del servidor.

El rollup general devuelve `{projects:[{id,code,name,current_phase_no,apqp_risk,domains,semaforo_global}]}` (`api/schemas.py:12611`).

Hay endpoints adicionales, no implementados por este adaptador, para FNC (`/api/projects/{id}/nc-reports`), PPAP (`/ppap-packages` bajo proyecto), problemas (`/issues`), hitos (`/milestones`) y eventos (`/lifecycle-events`). Los primeros requieren `ingenieria`; los eventos, `cartera`. Son listas sin paginación. Issues admite `as_of` y `carril`; hitos admite `as_of`.

## Contrato ERP vigente: 18 puntos

`integraciones/protheus/contrato/puntos.json` declara versión **3** y 18 puntos. Las menciones históricas a 14 puntos quedaron superadas por este contrato y por `PENDIENTES.md` del 19/10/2026. Cada clave incluye además `sucursal`.

| Punto | Tabla | Campos de clave, además de sucursal |
|---|---|---|
| clientes | SA1 | codigo, tienda |
| proveedores | SA2 | codigo, tienda |
| productos | SB1 | codigo |
| listas-precios-clientes | DA0 | codigo |
| precios-clientes | DA1 | listaCodigo, item |
| listas-precios-proveedores | AIA | proveedorCodigo, proveedorTienda, codigo |
| precios-proveedores | AIB | proveedorCodigo, proveedorTienda, listaCodigo, item |
| productos-proveedores | SA5 | proveedorCodigo, proveedorTienda, productoCodigo |
| productos-clientes | SA7 | clienteCodigo, clienteTienda, productoCodigo |
| estructuras | SG1 | productoCodigo, componenteCodigo, secuencia, revisionDesde |
| procesos | SG2 | productoCodigo, rutaCodigo, operacion |
| recursos | SH1 | codigo |
| costos | SB2 | productoCodigo, deposito |
| monedas | SM2 | fecha |
| centros-costos | CTT | codigo |
| unidades-medida | SAH | codigo |
| monedas-configuradas | SX6 | codigo |
| configuracion-costeo | SX6 | codigo |

KAIQEN recibe estos datos del emisor mediante HTTPS saliente desde la planta. Los registros espejados incluyen fecha de última lectura y marcas de baja/bloqueo; no equivalen a consulta en vivo de Protheus. ERP conserva identidad y datos comerciales; KAIQEN conserva estados y evidencia de calidad. El centralizador no debe activar la cola de creación Z ni escribir en KAIQEN para efectuar estas lecturas.
# Conexión local activa desde el 19/10/2026

El dueño autorizó usar las credenciales de este equipo y almacenarlas en `.env`. La credencial de usuario del archivo histórico fue rechazada por `/api/auth/login`; se verificó una alternativa autorizada por PostgreSQL usando la conexión de destino del proyecto. No se cambió ninguna contraseña ni se emitieron tokens artificiales.

`KAIQEN_SOURCE=postgres` selecciona `src/kaiqen-postgres.js`. La conexión verifica TLS con la CA del proyecto y exige `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`; comprueba `transaction_read_only=on` en cada transacción. El pooler ignoró la opción de sólo lectura en el arranque, por eso la protección se aplica explícitamente dentro de cada transacción. Todas las tablas de negocio se filtran por `KAIQEN_TENANT_ID`; el ámbito se obtuvo del proyecto que indicó el dueño. No se modificaron permisos ni datos del servidor.

Esta vía entrega los registros guardados de proyectos, fases, gates, eventos de vida, NC, problemas, PPAP, MSA y capacidad, junto con los vínculos explícitos de productos. No usa `project.status_id` como estado vigente: el código de KAIQEN indica que es una columna heredada sin uso. Las etapas derivadas y el semáforo global se marcan como no calculados. Tampoco replica los permisos por usuario/módulo de la API; es una lectura local autorizada de la planta, protegida por las claves del centralizador.

La referencia de costeo y el producto definitivo de una pieza se mantienen separados. Los campos de confidencialidad del proyecto y del cliente se conservan. Evidencia real sin filas comerciales: `reports/kaiqen-live-check.json`.

El contrato HTTP descrito a continuación se conserva para una futura conexión por cuenta de servicio válida.

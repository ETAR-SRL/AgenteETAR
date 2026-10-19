# Estado verificado — 19/10/2026

Actualización del asistente: 56 pruebas automatizadas aprobadas. Chat de lenguaje natural local en `/api/agent/chat`; precio de venta resuelto con DA1/DA0, búsquedas por nombre, conversación y aprendizaje explícito de términos. Ver [inteligencia-local.md](inteligencia-local.md).

| Área | Evidencia | Estado |
|---|---|---|
| Conexión SQL Server del ZIP | SELECT real con configuración suministrada | Verificada |
| Catálogo físico | 24 aliases resueltos inequívocamente | Verificado |
| Recursos ERP | Lectura mínima de 16 de los 20 recursos | Verificada; no es auditoría funcional completa |
| Compras/producción/cotizaciones | SC7, SC2, SCJ, SCK sin filas activas; campos existentes | Requiere validar filial y circuito operativo |
| Remitos | SF2: RFN / N / 50; API autenticada devuelve lectura | Verificado |
| Pendientes de venta | API de ítems con saldo técnico positivo | Verificado; no significa entrega física |
| KAIQEN | PostgreSQL real, TLS validado con CA, tenant del proyecto indicado, transacciones READ ONLY | Conectado: 4 proyectos; calidad y vínculo ERP verificados |
| Propuestas | Precio DA1/AIB y contacto de clientes/proveedores; diferencias, caducidad, relectura | Implementado y probado con datos ficticios |
| Escritura ERP | Endpoint de ejecución rechaza con 501 | Deshabilitada; cero escrituras realizadas |
| Texto | Modelo Qwen3 4B local con herramientas, contexto y memoria | Lenguaje natural verificado con ERP y KAIQEN |
| PWA | Central abierta en Microsoft Edge; instalación ofrecida por el navegador | Implementada: asistente, explorador, proyectos/calidad, conexiones, filtros, paginación y CSV |
| Voz | Audio sintético español → Whisper base local → consulta a KAIQEN con 4 proyectos | Implementada y verificada; micrófono físico pendiente de prueba por el usuario |
| Inteligencia | Qwen3 4B local, herramientas de búsqueda/lectura, resolución de precios y memoria | Implementado; no requiere modelo externo |

Actualización PWA: **42 pruebas automatizadas aprobadas**. Evidencia adicional en `reports/pwa-live-check.json`. El siguiente párrafo describe las verificaciones del backend previas al frontal.

Pruebas automatizadas: **37 aprobadas**. Prueba HTTP contra ERP real: **8/8** casos esperados, incluyendo consultas de costos, remitos, pendientes y rechazo de sucursal no autorizada. Con el proceso local en ejecución se verificaron además **5/5** rutas HTTP: salud, cartera KAIQEN, proyecto, calidad y vista conjunta. Auditoría de dependencias: **0 vulnerabilidades reportadas** por npm al cierre.

Informes reproducibles: `reports/erp-live-check.json`, `reports/http-live-check.json`, `reports/kaiqen-live-check.json` y `reports/local-running-check.json`. Contienen resultados y conteos mínimos, sin filas comerciales ni credenciales. El servicio final quedó iniciado en segundo plano en `http://127.0.0.1:4310`; PID guardado en `data/server.pid`. Para una próxima sesión se puede usar `iniciar.ps1` o `npm start`, sin iniciar ambos a la vez.

La configuración local conserva la conexión suministrada por el usuario. No se cambió el login ni sus permisos SQL: `readOnlyIntent` no convierte por sí solo la cuenta en una cuenta con permiso exclusivo SELECT. El código del centralizador no expone SQL libre ni tiene adaptador de escritura.

Para el siguiente tramo faltan: resolver las cuatro filiales pendientes, reproducir las etapas de vida y semáforos derivados de KAIQEN mediante su lógica oficial, definir evidencia logística de entrega y homologar rutinas de alteración Protheus. La lectura KAIQEN actual entrega datos guardados y no usa `project.status_id` como estado vigente. El artículo de referencia del proyecto verificado no devolvió filas SB2; no se interpreta como costo cero. El ejecutor futuro debe volver a validar dentro de su transacción; el control de concurrencia local de propuestas no es un sustituto.

Inteligencia verificada con modelo real: precio DA1/DA0, moneda en seguimiento, búsqueda por descripción ambigua, cartera KAIQEN y producto no identificado (5 casos); enseñanza por chat y recuperación en otra conversación con nueva lectura del ERP (2 casos). La memoria de prueba se eliminó. Informes: `reports/intelligence-live-check.json` y `reports/learning-live-check.json`. La aceleración Vulkan utiliza la Intel Arc 140V de este equipo. Tiempos observados: 6–83 segundos por consulta, incluyendo carga inicial; no constituyen un SLA.

Prueba adicional de chat KAIQEN: cartera con fases y consulta de calidad del proyecto seleccionado, ambas con el modelo real. Se validó además el resumen de calidad contra los conteos originales para no confundir el catálogo de estados con un estado del proyecto. Informes: `reports/kaiqen-chat-live-check.json` y `reports/quality-summary-live-check.json`. La consulta natural de precio también quedó verificada visualmente en la PWA (`reports/ui-intelligence-check.json`).

Reglas ETAR incorporadas al chat y al repositorio: terminados Z, vínculo cliente/lista mediante A1_TABELA y representación por millar conservando el precio unitario. SX3 confirmó C6_MILLAR y D2_MILLAR; se exponen en las lecturas cuando existen físicamente. La nueva propuesta AIB valida precisión SX3 y no ejecuta SQL. Los UPDATE y las alteraciones de pedidos siguen pendientes; ver `reglas-etar.md`.

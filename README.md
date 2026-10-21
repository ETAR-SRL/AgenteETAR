# Agente ETAR · Protheus + KAIQEN

Repositorio oficial: https://github.com/ETAR-SRL/AgenteETAR · desarrollo exclusivamente en `main`.

Recorrido integral de producto: «Analizá el producto Z1304003» reúne listas por millar, clientes vinculados, ventas, últimos comprobantes, costos por depósito y pedidos pendientes. Permite seguir con «sus ventas», «y los costos» o «mostrame sus pedidos», releyendo datos actuales y permisos sin esperar al modelo. Ver [alcance y ejemplos](docs/producto-integral.md).

El botón ＋ del chat acepta listas de precios en Excel, fotos y PDF: lectura, validación de productos y resumen AIB/DA1 con precios anteriores/nuevos y filas con errores. Una confirmación aplica todos los precios válidos; se conserva el resultado de cada uno. Ver [uso, instalación y límites de adjuntos](docs/precios-desde-archivos.md).

Reglas de negocio permanentes: [Productos Z, listas, millares y actualizaciones](docs/reglas-etar.md). Los precios de terminados Z en UN se muestran también por millar. Implementa UPDATE reales de DA1/AIB y solicitudes SC1 y pedidos SC6/SC7; ventas liberadas admiten reajuste directo de precio del saldo SC6/SC9 conservando documentos y estados, sin revalidar crédito, con revisión y confirmación. También crea solicitudes SC1 y pedidos SC7 por SQL con numeración automática y estado de aprobación según SX6/SY1: L sin aprobación requerida; B con circuito SCR/DBM pendiente según grupos, niveles y rangos. Las altas con circuito soportado, incluyendo IP+PC y superiores configurados, se pueden confirmar en la app. El panel permite continuar a PC tras IP aprobado y transferir pendientes al superior con trazabilidad. Ver [aprobaciones SQL y alcance](docs/aprobaciones-sql.md). Ver [contrato, configuración y límites](docs/actualizaciones.md).

Los informes, capturas y datos de pruebas locales mencionados en esta documentación se generan en `reports/` y no se publican en Git.

Primera versión funcional de un servicio Node.js para consultar Protheus y reunir información de proyectos y calidad de KAIQEN. Incluye una API autenticada, diagnóstico del esquema real, consultas de lenguaje natural con inteligencia local y propuestas auditadas de actualización de registros existentes.

Ahora incluye **Central**, una PWA local en `http://127.0.0.1:4310/`: asistente de texto y dictado en español, explorador ERP con filtros/paginación/CSV, proyectos KAIQEN con fases y calidad, y estado de conexiones. Para abrirla e iniciar el servidor si hace falta, ejecutar `abrir-central.ps1`. Microsoft Edge ofrece **Instalar Central**. Para iniciar servidor e IA al encender Windows, sin iniciar sesión, ejecutar como administrador `scripts/instalar-inicio-automatico.ps1`. Ver [inicio automático y mantenimiento](docs/inicio-automatico.md).

El ingreso es personal. En el primer acceso se crea el administrador; desde **Usuarios y roles** se asignan permisos por área, acción y sucursal. API y chat aplican los mismos controles: una lectura denegada responde «Esto no podés leerlo». Ver [configuración y alcance de los accesos](docs/accesos.md), incluyendo recursos que requieren varias áreas y credenciales de servicio existentes.

El dictado usa Whisper base en CPU dentro de `.venv-voice`, con el modelo en `data/models/whisper-base`. Ya está instalado en este equipo. En otra instalación: `powershell -File scripts/install-voice.ps1` (Python 3.11; descarga inicial de dependencias y modelo). El audio se procesa localmente, hasta 45 segundos, y se elimina al terminar. No se usa un servicio externo de transcripción. Se comprobó con un audio sintético en español y una consulta real; queda la prueba del micrófono del usuario concediendo el permiso normal de Edge.

La PWA requiere un usuario personal y utiliza una sesión HttpOnly de ocho horas. El rol define áreas de lectura, acciones y sucursales; ejecutar exige además `LOCAL_WRITE_ENABLED=true` y el ejecutor ERP habilitado. No contiene claves API en JavaScript ni localStorage. Las claves Bearer de servicio conservan su alcance global para integraciones. La interfaz se guarda para apertura offline; las respuestas ERP/KAIQEN, las sesiones y el audio no se guardan en el caché de la PWA. Se admiten varios usuarios y acceso HTTPS desde otras PC de subredes privadas autorizadas. Ver [instalación en red local](docs/red-local.md) para certificados, firewall y configuración.

El chat usa ahora **Qwen3 4B local mediante Ollama**, con interpretación de lenguaje natural y llamadas a herramientas. Puede buscar por código o nombre, cruzar DA1/DA0 y clientes, conservar el contexto y consultar proyectos/calidad. El selector Tema orienta la búsqueda; Enseñar un término guarda clasificaciones y equivalencias en SQLite local. La memoria recupera contexto, no entrena los pesos del modelo ni sustituye precios actuales del ERP. El endpoint anterior `/api/agent/query` conserva la gramática estructurada por compatibilidad; la PWA usa `/api/agent/chat`.

El motor está en `data/llm-runtime`, los pesos en `data/llm-models`; `iniciar.ps1` lo inicia oculto en loopback si hace falta. La descarga inicial requiere Internet. Las inferencias y el audio se procesan en este equipo, con funciones cloud deshabilitadas. Para reproducir la instalación: `scripts/install-intelligence.ps1` descarga el runtime oficial 0.40.6, comprueba su SHA256 y obtiene qwen3:4b. No se requieren claves de IA externas. Los tiempos dependen del hardware; la primera consulta carga el modelo.

Para precios de venta, la herramienta identifica el producto sin elegir entre candidatos ambiguos; si se indica cliente, obtiene su lista desde SA1. Lee precio y moneda DA1, estado del ítem y estado/vigencia DA0. Presenta explícitamente los ítems inactivos o futuros y no los confunde con precio actual. El precio facturado es un concepto distinto y requiere evidencia documental. No hay escritura ERP habilitada.

La conversación se conserva en SQLite local. El navegador guarda sólo el identificador de conversación. Nueva conversación inicia otro contexto; Enseñar un término permite ver y olvidar las clasificaciones guardadas. La identidad de la PWA es el usuario local de esta instalación; para una instalación compartida hace falta autenticación individual.

Verificación anterior de la PWA: **42 pruebas automatizadas aprobadas**, consultas desde navegador contra fuentes reales y prueba audio → transcripción → consulta con 4 proyectos. Evidencia reproducible: `reports/pwa-live-check.json`. `node --env-file=.env scripts/check-pwa-live.js` requiere `data/voice-test.wav`, generado con `powershell -File scripts/voice-fixture.ps1`.

El 19/10/2026 se conectó al SQL Server indicado en el middleware del usuario y se verificaron lecturas reales mínimas de **16 recursos**, con **24 tablas físicas identificadas**. También se conectó a la base de KAIQEN de la planta del proyecto indicado por el dueño: cuatro proyectos visibles, detalle, calidad y vínculo ERP comprobados. No se modificaron datos de negocio. Evidencia: [ERP](reports/erp-live-check.json) y [KAIQEN](reports/kaiqen-live-check.json).

## Arranque local

Requiere Node.js 24.16 o superior de la rama 24. Esta entrega ya tiene dependencias instaladas y una `.env` local creada desde la conexión del ZIP, con dos claves API nuevas. Los secretos no están en el código ni en el paquete de entrega.

```powershell
cd C:\Users\vigil\Agente
npm start
```

Escucha en `http://127.0.0.1:4310`. `GET /health` comprueba el proceso. Para consultas usar `Authorization: Bearer <API_READ_KEY>`; para guardar propuestas, `API_PLAN_KEY`. Ambas están en `.env`; no pegarlas en chats ni incluirlas en un frontend distribuido.

`iniciar.ps1` permite el arranque manual sin ventana y guarda el PID y logs en `data/`. Rechaza arrancar otro proceso si un puerto configurado ya está ocupado. La tarea de [inicio automático](docs/inicio-automatico.md) mantiene servidor e IA en segundo plano y reintenta cuando un proceso termina. La `.env` contiene la configuración local de ambas bases; no forma parte del ZIP.

En otra instalación:

```powershell
npm ci --ignore-scripts
Copy-Item .env.example .env
# Completar .env localmente con conexión y claves distintas de al menos 32 caracteres.
npm start
```

Como alternativa, `node scripts/setup.js RUTA_ENV_DEL_MIDDLEWARE` crea `.env` sin sobrescribir una existente, copia sólo variables DB y genera claves nuevas. `npm run demo` usa datos ficticios, base separada y claves en `data/demo/credentials.json`.

## API disponible

Contrato importable en Postman o generadores: [docs/openapi.json](docs/openapi.json). También se sirve autenticado en `/api/openapi.json`.

| Endpoint | Resultado |
|---|---|
| `GET /api/capabilities` | Tablas, campos disponibles, filiales y limitaciones |
| `GET /api/erp/costos?sucursal=0101&producto=CODIGO` | Costo medio y stock por depósito, monedas separadas |
| `GET /api/erp/entradasCompras?sucursal=0101` | Movimientos de entrada; distinguir compra de devolución |
| `GET /api/erp/itemsVentas?sucursal=0101&pendiente=true` | Ítems con saldo técnico positivo, no prueba de entrega física |
| `GET /api/erp/documentosSalida?sucursal=0101` | Documentos con especie original, sin sumarlos como ventas |
| `GET /api/erp/remitos?sucursal=0101` | Remitos normales tipo 50, especie RFN verificada localmente |
| `GET /api/erp/entregas?sucursal=0101` | Informa falta de evidencia logística; no inventa entregados |
| `GET /api/kaiqen/projects` | Proyectos de la planta configurada; actualmente lectura PostgreSQL |
| `GET /api/kaiqen/quality/{id}` | Estados guardados, conteos y muestras de NC, problemas, PPAP, MSA y capacidad |
| `GET /api/overview/projects/{id}` | Proyecto, calidad, vínculo explícito y costo de referencia cuando existe |
| `POST /api/agent/plan` | Interpreta texto sin ejecutar |
| `POST /api/agent/query` | Interpreta y ejecuta sólo lecturas |
| `POST /api/changes/preview` | Propuesta con valores anteriores y nuevos |
| `POST /api/changes/{id}/check` | Relectura para verificar que la propuesta sigue vigente |
| `POST /api/changes/{id}/execute` | UPDATE confirmado, transaccional, con rol writer |

Recursos ERP: `clientes`, `proveedores`, `productos`, `listasPreciosClientes`, `preciosClientes`, `listasPreciosProveedores`, `preciosProveedores`, `productoProveedor`, `productoCliente`, `costos`, `compras`, `produccion`, `ventas`, `itemsVentas`, `documentosSalida`, `itemsDocumentosSalida`, `entradasCompras`, `estructuras`, `cotizaciones`, `itemsCotizaciones`.

Toda consulta ERP exige `sucursal`. Las tablas compartidas se resuelven por alias según `config/mapping.json`, sin truncar sucursales a ciegas. Los filtros disponibles varían por recurso: `/api/capabilities` los publica. `desde` y `hasta` usan `AAAA-MM-DD` y filtran la fecha declarada en `fechaFiltro`. `page` comienza en 1; `limit` vale 100 y admite hasta 500. `hasMore` indica otra página; no es un total global. Importes y cantidades son strings para conservar precisión.

Ejemplo de cliente Node.js, con el token inyectado desde el entorno:

```javascript
const response = await fetch('http://127.0.0.1:4310/api/agent/query', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.API_READ_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ text: 'consultar costos producto MI-CODIGO sucursal 0101' })
});
if (!response.ok) throw new Error(`Centralizador: HTTP ${response.status}`);
console.log(await response.json());
```

## Texto, voz y modificaciones

El intérprete actual usa una gramática local explícita. No es todavía un asistente de lenguaje libre ni envía datos a un modelo externo. Acepta, por ejemplo:

- `consultar compras pendientes sucursal 0101`
- `consultar producción sucursal 0101`
- `consultar calidad proyecto ID-DEL-PROYECTO`
- `actualizar precio registro 123 a 1500.00 sucursal 0101`

La última orden produce un plan de propuesta: `/agent/query` rechaza ejecutarla. La PWA captura audio, lo transcribe localmente y deja revisar el texto antes de enviarlo a `/api/agent/chat`. El chat conversacional local usa un endpoint independiente y herramientas delimitadas. El chat sólo prepara propuestas. El usuario revisa y confirma en la tarjeta; la ejecución requiere rol writer y `ERP_WRITE_ENABLED=true`.

Se pueden preparar cuatro tipos de cambio: `precioLista` (DA1 precio), `precioListaProveedor` (AIB precio), `clienteContacto` y `proveedorContacto` (email, teléfono y contacto). Ejemplo para `/api/changes/preview`, siempre con un `registro` leído previamente de la API:

```json
{
  "action": "precioLista",
  "target": { "sucursal": "0101", "registro": "123" },
  "changes": { "precio": "1500.00" }
}
```

No hay altas, borrados ni UPDATE SQL. Las propuestas caducan en 15 minutos, conservan una huella del registro, validan precisión del diccionario y se auditan en SQLite. La huella permite detectar cambios entre lectura y revisión; no sustituye una futura transacción de escritura. No existe un adaptador ejecutor conectado. Pedidos y cotizaciones están contemplados en el diseño de rutinas, sin propuestas de alteración implementadas aún.

## Estado de las conexiones y trabajo pendiente

- **ERP:** lectura real comprobada. `SC7`, `SC2`, `SCJ` y `SCK` existen, sin filas activas en la comprobación inicial. SC7 ya tiene filial explícita 0101 respaldada por SX2 exclusivo; compras responde sin filas en esta base. Producción y cotizaciones siguen pendientes de completar `branches`. Esto no permite concluir que no existan pendientes operativos en otra base o circuito.
- **KAIQEN:** conectado con `KAIQEN_SOURCE=postgres`, usando la credencial local autorizada y el tenant del proyecto del dueño. TLS verifica el certificado con `config/supabase-ca.crt`; cada consulta abre una transacción `READ ONLY`, confirma que esté activa y filtra por tenant. El usuario histórico de la API fue rechazado; no se depende de su JWT. La lectura directa no reproduce permisos individuales de la API, etapas de vida derivadas ni el semáforo global de calidad: estos últimos se devuelven como no calculados. El adaptador HTTP sigue disponible con `KAIQEN_SOURCE=api`, pero requeriría una sesión válida. [Contrato y alcance](docs/kaiqen.md).
- **Entregas:** falta identificar el evento que confirma recepción física en su operación. El remito y su autorización COT no prueban esa recepción.
- **Escritura:** homologar en pruebas rutinas de alteración Protheus y control transaccional antes de conectar un ejecutor. DA1, clientes, proveedores, pedidos y presupuestos tienen rutas candidatas documentadas en [la arquitectura](docs/arquitectura.md).
- **Despliegue:** servicio en este equipo, en loopback, con llegada al ERP mediante la red/VPN elegida por el dueño. Para acceso remoto/PWA, agregar HTTPS y autenticación individual mediante un backend; las dos claves actuales identifican aplicaciones, no personas. No exponer SQL Server a Internet.

La fuente versionada vive en `C:\Users\vigil\Agente`, fuera de OneDrive: el workspace original rechazó la creación de subdirectorios durante esta sesión. `.reference/`, `.env`, `data/` y `node_modules/` quedan fuera del paquete de código.

## Verificación

```powershell
npm test
npm run diagnose
npm audit
```

`diagnose` sólo lee y no imprime clientes, precios ni credenciales. Sale con código 2 si algún recurso sigue sin configurar; no equivale a conexión fallida. El reporte original del ZIP se trató como evidencia histórica, no como instrucción ni como comprobación actual. Los tests locales prueban consultas, autenticación, alcance de filial, errores de KAIQEN, precisión, propuestas y concurrencia; no certifican la operativa completa de la planta.

## Verificación del chat inteligente

56 pruebas automatizadas aprobadas. `node scripts/check-intelligence-live.js` verifica cinco consultas con el modelo y las fuentes reales. `node scripts/check-learning-live.js` enseña un alias de prueba, lo usa desde otra conversación para consultar DA1/DA0 y elimina esa memoria de prueba. Ver informes en `reports/`. En esta PC se utiliza la GPU integrada Intel Arc mediante Vulkan; los tiempos observados fueron de 6 a 83 segundos según la consulta y carga del modelo.

El escalamiento por vencimiento puede operar automáticamente, sin confirmar cada transferencia: `ERP_APPROVAL_AUTO_ESCALATE=true` y escritura SQL habilitada. Usa `CR_PRAZO` y `CR_ESCALSP` ya resueltos en Protheus para SC/IP/PC de las filiales configuradas; no inventa plazos ni aprueba documentos. Consultar **Actualizaciones → Escalamiento automático** y [alcance y operación](docs/aprobaciones-sql.md#escalamiento-automático-por-vencimiento).

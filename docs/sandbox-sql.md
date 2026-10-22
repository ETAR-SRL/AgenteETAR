# Pruebas SQL Server locales con datos sintéticos

`node scripts/sandbox-purchase-sql.js --run-local-synthetic` requiere Windows,
SQL Server LocalDB instalado y la instancia independiente `AgenteSqlSandbox`.
La instancia se creó expresamente para estas pruebas; el script no inicia,
detiene ni reinicia servicios o instancias.

Cada ejecución crea una base nueva `AgenteSqlSandbox_<16 caracteres hex>`.
No carga `.env`, no abre Store, no copia filas ERP y no conecta al servidor ERP.
Usa autenticación integrada de Windows contra `(localdb)\AgenteSqlSandbox`.
Antes de cada operación comprueba nombre exacto de base, `IsLocalDB=1` y un
token aleatorio de fixture. Rechaza los nombres de producción, DEV/VAL y cualquier
otro destino. La creación inicial exige que la base no exista. Las bases quedan
disponibles para inspección; no hay borrado automático de bases.

El transporte de prueba mantiene una conexión .NET SqlClient persistente por
sesión, parámetros `varchar(512)` y transacciones serializables. Usa la función
`transact` del adaptador, incluidos XACT_ABORT, timeout y clasificación de COMMIT
incierto. Dos sesiones separadas prueban la concurrencia real del motor.

Las altas y los UPDATE llaman a `createWriter` y sus ejecutores existentes;
no duplican su SQL. Los catálogos y el diccionario son fixtures sintéticos
derivados de las pruebas unitarias. Para UPDATE se prepara expresamente un ítem
simple existente con aprobación/segunda unidad vacías; no se amplía el estado
admisible de los ejecutores.

El informe de consola incluye conteos antes/después: commit de dos ítems,
revalidación de huella tras cambio de catálogo, rollback después de dos INSERT
reales, asignación concurrente de documento/RECNO bigint y actualización de precio
con total derivado en SC1/SC7. También intenta DDL con un token incorrecto y
comprueba que la tabla no se creó. Los tests ordinarios `sandbox-sql.test.js`
sólo prueban el rechazo previo de destinos inválidos y no requieren un motor.

Esto verifica los ejecutores contra SQL Server real local con esquema sintético.
La moneda de estas altas es la local del fixture; no acredita altas USD ni sus
parámetros de importación en una instalación Protheus real.
No homologa DBAccess/AppServer, reservas numéricas nativas, personalizaciones
ADVPL, circuito fiscal ni liberación en pantallas Protheus. No prueba aquí
SCR/DBM con aprobaciones B.

El flujo HTTP se prueba sobre los ejecutores conectados a LocalDB: instancia
efímera de `createApp` en loopback, `Store(':memory:')` e identidades personales
aisladas de Access. Preparar el resumen no escribe; confirmación falsa, huella
incorrecta, otro actor, lector, permiso revocado o catálogo cambiado conservan
el conteo SQL. Confirmar la huella exacta inserta dos ítems, verifica cantidades,
precios y totales mediante SELECT y devuelve un recibo idempotente al repetir.
No abre endpoints, Store ni procesos de fondo de producción.

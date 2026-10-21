# Validación ejecutable de integración, sin escrituras

El paquete distingue contratos controlados, disponibilidad del origen y evidencia de lecturas reales. Un puerto disponible, una conexión abierta o una ejecución offline **no** aprueban una integración real. No se ejecuta un cambio ERP como prueba.

## Ejecución offline

```powershell
node scripts/validate-integration.js --offline
node scripts/validate-integration.js --offline --prepare
node --test test/integration-validation.test.js
```

Usa exclusivamente adaptadores sintéticos en memoria: no abre SQL Server, PostgreSQL, Store ni la base operativa local; no inicia servidor, scheduler, VPN ni tareas de fondo. Los datos ficticios cubren SA1/DA1/DA0, SB1, SC6, SC7, remitos/SD2, SC1 y contratos KAIQEN. El informe declara `controlled_fixtures_only`, `fixture_metadata_not_real` y `realValidation: not_performed`. Ésta es una prueba del paquete y sus contratos, no evidencia de la base comercial.

`--prepare` prepara en el doble una propuesta DA1 con el mismo precio. No la guarda y no llama a execute. La presencia de una propuesta controlada no acredita que una propuesta real sea ejecutable.

## Validación real futura, sólo lectura

No se ejecutó una validación real durante esta implementación ni se cambiaron redes, VPN, reglas, credenciales o datos comerciales. Una persona autorizada debe elegir la filial y proyecto reales antes de ejecutar:

```powershell
# Completar localmente: no pegar secretos en consola compartida ni chats.
$env:VALIDATION_BRANCH = 'FILIAL_AUTORIZADA'
$env:VALIDATION_SAMPLE_LIMIT = '1' # entero entre 1 y 3
node --env-file=.env scripts/validate-integration.js --live
```

La filial debe estar expresamente incluida en `ERP_BRANCHES`. No se elige una filial por defecto y no se amplían permisos. `ERP_BRANCHES` es una autorización de instalación para este diagnóstico administrativo, no reemplaza los roles personales del servidor. Ejecutar sólo desde la cuenta administradora autorizada para estos datos, con credenciales de base de sólo lectura y la conectividad existente. El programa no configura ni repara la red. No basta con cambiar una variable para obtener permisos de base.

El programa no carga `.env` por sí mismo: el operador decide si usa `--env-file`. Copia el entorno para el adaptador y fuerza `ERP_WRITE_ENABLED=false`, `LOCAL_WRITE_ENABLED=false` y `ERP_APPROVAL_AUTO_ESCALATE=false`; rechaza un adaptador que declare el ejecutor habilitado. No importa ni abre Store, app, servidor, motor IA, notificaciones o planificadores. Nunca solicita una conexión writable ni llama execute. ReadOnlyIntent del controlador SQL no sustituye un usuario SQL restringido: conservar permisos SELECT de esa cuenta.

ERP usa `createErp`, su catálogo y consultas SELECT parametrizadas existentes. La inicialización relee metadatos de tablas/diccionarios; las muestras comerciales tienen límite de 1 a 3 filas por recurso, primera página solamente. Se realizan además hasta cinco consultas relacionadas limitadas de la misma manera. No se recorre todo el corpus ni todas las páginas y no se modifican registros.

KAIQEN se consulta únicamente si `KAIQEN_SOURCE=postgres`, `KAIQEN_DATABASE_URL` y `KAIQEN_TENANT_ID` están configurados. Usa el adaptador existente con TLS y transacciones PostgreSQL READ ONLY. Consulta proyectos con muestra acotada; `project`, `quality` y `projectLink` sólo se ejecutan si el operador suministró `KAIQEN_PROJECT_ID`. No se elige un proyecto encontrado automáticamente ni se cambia la planta. Un origen ausente queda pendiente; un fallo devuelve un código saneado, sin texto del controlador.

Para preparar opcionalmente una propuesta real de lectura:

```powershell
node --env-file=.env scripts/validate-integration.js --live --prepare
```

Sólo reutiliza el precio actual de una fila DA1 ya leída, sin proponer una modificación efectiva. No persiste propuesta, precio, huella ni fila. El ejecutor sigue deshabilitado. Una propuesta sin diferencias puede ser rechazada por las validaciones existentes; se informa como rechazo, sin falsear éxito. No se preparan altas SC1/SC7, aprobaciones ni transferencias.

## Qué se contrasta y qué queda pendiente

| Área | Evidencia del paquete | Revisión real pendiente |
|---|---|---|
| Esquema | Campos físicos presentes/ausentes, tipo y decimales SX3 disponibles en metadata del adaptador | Confirmar SX2, sucursales compartidas/exclusivas, nombres físicos y precisión con la instalación concreta; offline no prueba esquema real |
| Cliente/lista | SA1.A1_TABELA → DA1_CODTAB y cabecera DA0 por ID exacto de lista de la muestra | Vigencia/estado DA0/DA1, moneda y producto SB1; no inferir cliente único por producto Z |
| Producto | DA1_CODPRO → SB1.B1_COD por consulta exacta | B1_UM=UN antes de ofrecer precio por millar para terminados Z; otras unidades necesitan interpretación explícita |
| Millares | C6_MILLAR y D2_MILLAR comparados con cantidad/1000 cuando ambos valores existen | Revisar diferencias históricas y precisión SX3; esos campos son cantidades, nunca precios. No inventar C7_MILLAR |
| Precios/totales | Comparación decimal exacta de cantidad × precio y total guardado | Diferencias pueden depender de redondeo SX3, descuentos e impuestos; no corregir ni aprobar automáticamente un total |
| Monedas | Presencia y preservación del campo moneda, sin suma ni conversión | Significado MV_MOEDA1..5 en SX6; cotización SM2 de la fecha; no suponer que moneda 1/2 tienen igual definición en todas las instalaciones |
| Pedido SC6 | Cantidad pedida/atendida, precio, total y vínculo SD2 por pedido/producto; búsqueda de ítem coincidente | C6_QTDVEN, C6_QTDENT, C6_PRCVEN, C6_VALOR, C6_MILLAR, SC9 pendiente vs documentada, bloqueos, segunda unidad y MV_BLOQUEI |
| Compra SC7 | Cantidades, precio, total y moneda de una muestra real, si existe | C7_QUANT, C7_QUJE, C7_PRECO, C7_TOTAL, C7_MOEDA; recepción SD1, descuentos, aprobación, cierre y residuos. SC7 vacío sigue pendiente |
| Remitos | Recurso existente `remitosEmitidos`, documento+serie → ítems SD2 | D2_PEDIDO/D2_ITEMPV, RFN/tipo documental y especie local; no confundir documento emitido con entrega física |
| KAIQEN | Lectura tenant-scoped, proyecto/calidad/vínculo sólo con ID explícito | Confirmar planta, referencia ERP y dominios guardados; no inferir estado derivado ni divulgar contenido protegido a IA externa |
| Propuestas | Preparación DA1 opcional, aislada y sin cambio de valor | Permisos, revisión y confirmación deben seguir el flujo normal; no demuestra ejecución, rollback ni recuperación ante resultado incierto |

Las comparaciones SC6→SD2 pueden no encontrar el ítem en la primera muestra acotada; en ese caso quedan pendientes. Ninguna coincidencia de una muestra acredita todos los documentos relacionados.

## Aprobación SQL y SC1 en dólares: conservar sin ejecutar

Antes de una validación comercial específica futura, revisar `docs/aprobaciones-sql.md`, `docs/monedas-altas.md` y `docs/reglas-etar.md`. Este paquete **no inserta SC1, SC7, SCR o DBM**, no aprueba ni transfiere, no modifica SX6/SY1 y no reserva RECNO/numeradores.

Checklist pendiente de lectura y revisión por el dueño:

- SX3/SX2 de SC1/SC7/SCR/DBM y campos físicos necesarios; variantes desconocidas deben seguir bloqueadas.
- Tipo SI/MATA113 elegido explícitamente para SC1 USD: C1_TIPO, C1_PRECO y C1_MOEDA; conservar C1_VUNIT de solicitud común sin convertir silenciosamente a pesos.
- MV_APROVSI y demás parámetros SX6, grupos/perfiles SY1 y niveles/rangos efectivos, sin inventar reglas.
- Estado L sólo cuando la configuración comprobada no requiere aprobación; estado B con circuito pendiente soportado, sin aprobar por SQL.
- Cotización SM2 y moneda de SC7, contexto de filial, estados y dependencias de documento existente.
- Reservas de numeración, bloqueo global RECNO y relectura transaccional pertenecen a los ejecutores autorizados, **no** a una prueba de arranque o diagnóstico.
- Cualquier prueba futura que escriba requiere una instrucción concreta separada sobre registros identificados y su circuito de revisión habitual. No añadir escrituras a este validador.

## Informes y resultado

Cada ejecución válida crea únicamente `data/validation/<fecha>-<modo>-<id>.json`, dentro del directorio ya ignorado por Git. Guarda nombre de controles, conteos, estado, campos de esquema y códigos; **no** guarda filas, nombres de clientes/proyectos, importes, contraseñas, hosts, SQL ni mensajes de controlador. No exportar esos informes automáticamente a servicios externos.

`availability` informa disponibilidad de interfaces, no aprobación. `observed` significa que hubo una lectura; `passed` aplica sólo a un control específico; `pending` identifica falta de evidencia; `failed` requiere revisión. Los totales base se informan como observación y sus diferencias no se presentan como un error de negocio demostrado.

El código de salida es 0 cuando terminan los controles acotados sin fallo comprobado, 1 para argumentos inválidos, 2 para fallo o informe no escrito. **0 no significa aprobación productiva**. En modo live, `realValidation` conserva `partial_requires_review`, porque escrituras, circuitos reales completos y universos completos siguen sin validar. Una conexión fallida conserva `not_completed`; el paquete jamás transforma una indisponibilidad en una validación aprobada.

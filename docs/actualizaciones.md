# Actualizaciones reales de registros existentes

Implementación del 19/10/2026. La API y la PWA ejecutan UPDATE parametrizados sobre un ítem activo y, cuando corresponde, sus liberaciones pendientes, después de preparar y confirmar una propuesta. Los UPDATE no crean registros ni ejecutan SQL generado por el modelo; las nuevas acciones de alta SC1/SC7 se describen al final. El alcance es una empresa/base configurada y sus sucursales autorizadas.

## Campos y conversiones

| Acción | Tabla | Campos actualizados |
|---|---|---|
| `precioLista` | DA1 | `DA1_PRCVEN`, y `DA1_PRCMIL` cuando existe y el producto es UN |
| `precioListaProveedor` | AIB | `AIB_PRCCOM` |
| `pedidoVenta` | SC6 | `C6_PRCVEN`, `C6_QTDVEN`, `C6_VALOR`, `C6_MILLAR`; sincroniza `C6_PRUNIT` al cambiar precio sólo si era igual al precio neto |
| Dependencia de `pedidoVenta` | SC9 | Sólo `C9_PRCVEN` de liberaciones pendientes elegibles; nunca SC9 documentada |
| `solicitudCompra` | SC1 | `C1_VUNIT`, `C1_QUANT`, `C1_TOTAL`; sólo solicitudes sin atención, aprobación o documentos vinculados |
| `pedidoCompra` | SC7 | `C7_PRECO`, `C7_QUANT`, `C7_TOTAL`; sólo usaría `C7_MILLAR` si existiera y estuviera definido en SX3 |

Sólo se incluyen en el SET los campos con diferencias. No se modifica moneda, clave, vigencia, cliente/proveedor, estado, borrado lógico ni RECNO. Los triggers STAMP existentes pueden cambiar `S_T_A_M_P_`; cualquier otro cambio inesperado de la fila causa rollback. Se contrastan las definiciones de triggers habilitados con hashes inspeccionados en esta instalación. Un trigger nuevo o modificado bloquea la operación hasta su revisión.

Para UN: 1 millar = 1000 unidades; precio por unidad = precio por millar ÷ 1000. Ejemplo: 2,5 millares a 80 por millar → 2500 unidades × 0,08 = 200. Los precios y cantidades deben caber exactamente en SX3; sólo el total se redondea HALF_UP a los decimales del campo. El total enviado es una comprobación, no un importe independiente. Unidades diferentes de UN no admiten conversión a millares. `D2_MILLAR` no se actualiza: corresponde a documentos emitidos.

Los productos Z se vinculan a sus clientes mediante `SA1.A1_TABELA` y DA0/DA1. Un cambio de lista no cambia automáticamente pedidos existentes, ni actualiza otras listas. La propuesta identifica lista, producto, ítem, proveedor/tienda o pedido según la operación, y conserva los códigos de moneda del ERP.

## Límites de pedidos

Se mantiene el UPDATE de precios/cantidades de ítems simples sin dependencias. Para **ventas liberadas o parcialmente atendidas** se agregó un modo automático de **sólo precio**: no acepta `cantidadPedida`, no corrige `C6_MILLAR`, no altera reservas, cantidades atendidas ni estados. Exige saldo positivo, tipo normal `C5_TIPO=N`, identidad coherente de producto/cliente y cantidades SC9 compatibles con lo pedido y atendido.

- SC6 conserva cantidad total pedida y atendida; cambia precio neto, precio base si era igual al neto, y total de referencia `C6_VALOR = C6_QTDVEN × nuevo precio`.
- SC9 pendiente cambia únicamente `C9_PRCVEN`, en la misma transacción. Cada liberación aparece con su RECNO y secuencia en la propuesta y el recibo. Las filas con factura **o remito** se conservan completas. Un estado procesado `10` sin documento identificable se rechaza.
- SD2 se lee y conserva íntegra. No se actualizan SD1/SD2, SF1/SF2, títulos financieros ni stock. Tampoco se crean o estornan liberaciones. El código no puede revalorizar un remito emitido aún no facturado.
- La propuesta muestra cantidad atendida, pendiente, millares pendientes, total pendiente al nuevo precio, número de liberaciones a actualizar y documentos preservados. **El total de referencia del pedido no es el importe facturado histórico.** No se suman indiscriminadamente remitos y facturas para calcular lo atendido: se toma `C6_QTDENT`, manteniendo evidencia SD2 y SC9 sin duplicar documentos argentinos.
- Una diferencia previa entre precio SC6 y SC9 exige revisión, no se unifica automáticamente. Se verifica la precisión de cada tabla: en este ambiente SC9 tiene 4 decimales, SC6 6; un precio incompatible se rechaza sin redondearlo.

**Restricciones que siguen vigentes:** descuentos, cambios de cantidad con segunda unidad, importes fiscales/accesorios, contratos/órdenes vinculadas, aprobaciones comerciales, WMS/TMS/carga/separación y bloqueos incompatibles. El total original debe coincidir con cantidad × precio a precisión SX3. No se homologó el circuito fiscal completo de Argentina.

**Crédito y parámetros:** por instrucción explícita posterior del dueño, `MV_BLOQUEI=.T.` ya no bloquea por sí solo el reajuste directo de precio. Se conservan `C9_BLCRED`, `C9_BLEST`, las aprobaciones de cabecera y SX6, sin recalcular los saldos de SA1 ni ejecutar análisis de crédito. La propuesta, el chat y el recibo muestran `PRECIO_SQL_SIN_REVALIDACION`: el nuevo importe puede diferir del importe previamente aprobado. No se afirma que conservar un flag equivalga a revalidar. Los bloqueos efectivos de crédito en SC9 siguen impidiendo operar. Un parámetro desconocido también bloquea. `MV_ALTPREC` continúa limitando el estado admisible; ambos parámetros forman parte de la huella y se releen con bloqueo antes de escribir. No se modifica SX6.

En el modo avanzado de sólo precio, las cantidades de segunda unidad no negativas y `C6_SEGUM` se conservan sin convertirlas ni corregirlas. No se permite cambiar cantidad en ventas liberadas/parciales. La transacción verifica todos esos campos antes del COMMIT. Las propuestas anteriores a esta política caducan por cambio de versión en su huella.

**Compras recibidas/aprobadas:** conservan el rechazo, con motivo explícito. La documentación de MATA121 restringe precio/valor y cantidad de pedidos atendidos aun con `MV_ALTEPEDC=S`; `MV_ALTPC` añade un bloqueo por atención. No se presume que `.F.` habilite todos los casos parciales. SC7 estaba vacía en la verificación; falta homologar un pedido parcial real y su circuito de aprobación antes de habilitarlo. Este cambio no habilita compras recibidas.

SC7 y SC9 se configuran con filial `0101` por SX2 exclusivo E/E/E. No se inventa C7_MILLAR, ausente en este esquema. En DA1 la filial física es `01`; cada alias resuelve su propia filial. Contactos SA1/SA2 y cotizaciones siguen sin ejecución.

### Fundamento revisado en TOTVS

- [OMSA010 y MV_REAJSC9 (Mercado Internacional)](https://centraldeatendimento.totvs.com/hc/es/articles/14871733134871-Cross-Segmentos-TOTVS-BackOffice-L%C3%ADnea-Protheus-MI-Facturaci%C3%B3n-SIGAFAT-OMSA010-Uso-de-par%C3%A1metro-MV-REAJSC9): el reajuste nativo puede alcanzar SC6 y SC9; cambiar sólo SC6 no cubre una liberación existente.
- [Recálculo de precios MATA410](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360042778873-Cross-Segmentos-Backoffice-Protheus-SIGAFAT-Rec%C3%A1lculo-do-pre%C3%A7o-de-venda-no-Pedido-de-vendas-MATA410): diferencia entre precio base y neto y estados de MV_ALTPREC.
- [Análisis de crédito y stock](https://centraldeatendimento.totvs.com/hc/pt-br/articles/360014207291-Cross-Segmentos-Backoffice-Protheus-SIGAFAT-Como-identificar-e-liberar-bloqueios-do-Pedido-de-Vendas): la liberación pasa por validaciones comerciales, crédito y existencias. La restricción del ejecutor SQL es una decisión conservadora propia, no una afirmación de que TOTVS prohíba todo reajuste liberado.
- [MATA121](https://tdn.totvs.com/pages/viewpage.action?pageId=306851390): parámetros de alteración, atención y redondeo de compras.

Estas fuentes describen el producto, no certifican este ejecutor SQL ni sustituyen la homologación de las personalizaciones locales.

### Modo SQL y revalidación nativa

La ejecución implementada continúa con UPDATE SQL controlados, sin llamadas REST a Protheus. Las altas SC1/SC7 se implementaron después, con MAX+1 explícitamente autorizado y sin validación nativa. `GET /api/capabilities` expone `writePolicy` con transporte SQL y `nativeCreditRevalidation=false`; la PWA y el contexto del chat explicitan esa limitación. El permiso general `canExecute` no habilita una propuesta bloqueada: su validación particular sigue siendo obligatoria en el servidor.

La revalidación nativa **no está implementada**. TOTVS documenta [MATA410 mediante MSExecAuto](https://tdn.totvs.com/pages/viewpage.action?pageId=6784012), con operación 4 para alterar, y [el comportamiento de MV_AVALCRD](https://tdn.totvs.com/pages/viewpage.action?pageId=776122750), que exige reinformar `C6_QTDLIB` en la alteración para someter la liberación al análisis correspondiente. Eso requiere ejecutar y homologar la rutina dentro de Protheus; cambiar campos SQL no reproduce ese circuito. Tampoco corresponde invocar MATA440 por ExecAuto: [TOTVS indica que no está disponible](https://centraldeatendimento.totvs.com/hc/pt-br/articles/4415766894359-Cross-Segmento-TOTVS-Backoffice-Linha-Protheus-SIGAFAT-Execauto-MATA440).

No se escriben aprobaciones, saldos crediticios ni parámetros para simular esa ejecución. El reajuste SQL explícitamente autorizado conserva los estados existentes sin acreditar una nueva aprobación. Los estados bloqueados, parámetros desconocidos y demás dependencias incompatibles siguen rechazándose.

## Activación y uso

`.env` local, nunca versionado:

```dotenv
ERP_WRITE_ENABLED=true
LOCAL_WRITE_ENABLED=true
API_WRITE_KEY=<secreto distinto de READ y PLAN, mínimo 32 caracteres>
```

Los defaults de `.env.example` están deshabilitados. El usuario SQL debe poder SELECT, consultar metadatos/definiciones y UPDATE las tablas habilitadas (incluida SC9 para casos elegibles); el agente no otorga permisos. El pool de escritura se abre sólo al ejecutar. La PWA requiere ambos flags, usuario personal y permisos de lectura, preparación y ejecución para la acción. Usa mismo origen, con cookie HttpOnly/SameSite=Strict (también Secure en HTTPS). Los usuarios y roles se administran en Central y mantienen sus permisos al ingresar por la LAN autorizada. Ver accesos.md y red-local.md.

En **Actualizaciones**, ingresar un RECNO existente obtenido en Explorar ERP, seleccionar la base de precio/cantidad, preparar y revisar. En el chat puede pedirse por texto o dictado: el modelo busca el registro y prepara una tarjeta; ante identidad/base ambiguas debe solicitar aclaración. El ejecutor no está disponible como herramienta del modelo. La confirmación final es un botón explícito de la tarjeta.

API: usar la misma clave writer para crear, confirmar y consultar la propuesta. La clave planner sólo prepara/comprueba sus propias propuestas, nunca ejecuta; la reader sólo lee. Los valores son texto decimal con punto, sin separadores de miles.

```json
{
  "action": "pedidoVenta",
  "target": {"sucursal": "0101", "registro": "RECNO_EXISTENTE"},
  "changes": {"precioUnitario": "80", "cantidadPedida": "2.5", "total": "200.00"},
  "priceUnit": "millar",
  "quantityUnit": "millares"
}
```

1. `POST /api/changes/preview`: recibe ese objeto, lee el origen y devuelve `id`, `fingerprint`, identidad, diferencias y cálculo. Vence en 15 minutos. No escribe en ERP.
2. Opcional: `POST /api/changes/{id}/check`, que detecta cambios sin bloquear.
3. `POST /api/changes/{id}/execute` con `{"confirm":true,"fingerprint":"HUELLA_RECIBIDA"}`. La huella debe coincidir exactamente. No existe ejecución masiva implícita.
4. `GET /api/changes/{id}`: devuelve propuesta y estado/recibo de ejecución de ese actor.

## Transacción y fallos

SQLite registra la intención antes de tocar ERP. SQL Server comienza una transacción SERIALIZABLE, con XACT_ABORT y timeout de bloqueos. Relee la fila y dependencias con UPDLOCK/HOLDLOCK, compara la huella (incluye producto, cabecera, conjuntos completos SC9/SD2, parámetros, triggers y ámbito), recalcula valores y verifica que sean los confirmados. Ejecuta cada UPDATE filtrado por filial, RECNO y borrado lógico, exige exactamente una fila por sentencia y verifica valores y dependencias mediante SELECT antes del COMMIT. Las colecciones se ordenan por RECNO y se leen hasta 501 filas para detectar y rechazar más de 500; nunca se aceptan las primeras dos liberaciones como conjunto completo. Los bloqueos protegen también contra inserción concurrente de liberaciones/documentos. Una nueva factura/remito, cantidad, precio, estado o parámetro después de la propuesta exige releer y preparar otra. No añade tablas ni triggers en el ERP. El OUTPUT usa una variable de tabla transitoria compatible con triggers STAMP.

`executed` conserva un recibo que se devuelve sin otro UPDATE ante reenvío del mismo ID. `failed` requiere corregir el problema y preparar otra propuesta. `executing` no admite reenvío. `unknown` indica que no se pudo confirmar COMMIT/rollback o que el proceso terminó durante una ejecución. No existe transacción distribuida entre SQLite y SQL Server: si se pierde la respuesta o falla el guardado del recibo después del COMMIT, no se adivina éxito/fracaso ni se reintenta. Se consulta el estado y se compara el registro en Protheus antes de emitir otra propuesta. Los registros `executing` heredados al reiniciar se convierten en `unknown`.

Referencias técnicas: [bloqueos y aislamiento SQL Server](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide?view=sql-server-ver17), [UPDLOCK/HOLDLOCK](https://learn.microsoft.com/en-us/sql/t-sql/queries/hints-transact-sql-table?view=sql-server-ver15), [xFilial](https://tdn.totvs.com/pages/viewpage.action?pageId=27675626).

## Verificación

`npm test`: 103 pruebas aprobadas, incluyendo los escenarios de saldo parcial/liberado. Incluye actualizaciones de las cuatro tablas con dobles transaccionales, conversiones, precisiones, totales, rollback, concurrencia, aislamiento de actores, idempotencia, pérdida de COMMIT y recuperación tras reinicio. El chat se prueba preparando sin ejecutar y HTTP con permisos separados.

`node --env-file=.env scripts/check-writes-readonly.js` lee datos reales y prepara propuestas sin guardarlas ni ejecutarlas. DA1 y AIB prepararon correctamente; los tres pedidos de venta históricos muestreados se rechazaron por dependencias; SC7 no tenía registros. No se ejecutó ningún UPDATE comercial como prueba. También se comprobó por SELECT el permiso UPDATE de las cuatro tablas y una transacción real sin DML mediante el pool de escritura. Esto verifica conectividad, metadatos y preparación, no acredita una modificación real ni sus efectos en pantallas/reportes Protheus.

Prueba HTTP con el modelo local real: una petición de cambio de precio por millar resolvió producto y lista vigente, y guardó una propuesta revisable en tres pasos. No se ejecutó. Las filas inactivas del mismo producto no se confunden con la única alternativa vigente; varias alternativas vigentes requieren identificar la lista o el cliente.

La comprobación adicional `node --env-file=.env scripts/check-sales-balance-readonly.js` prepara cambios de precio en ventas liberadas/parciales con un adaptador sin pool de escritura. Sólo imprime estados, campos y motivos de rechazo; no guarda datos comerciales ni ejecuta UPDATE.

Relevamiento de esta ampliación: por SELECT se verificaron 13 ítems de venta abiertos con liberaciones, sin ítems parcialmente atendidos; SC7 seguía sin filas. Se comprobó MV_ALTPREC=T, MV_BLOQUEI=.T. y el trigger SC9010_STAMP (sólo sello de tiempo). Por crédito activo, las liberaciones pendientes requieren el circuito nativo. Dos intentos posteriores de preparar propuestas contra la base fallaron por timeout de conexión; no se considera validada la preparación real de esta ampliación. Los casos parciales se verificaron con dobles transaccionales, sin cambios comerciales.

En una comprobación posterior del mismo día se recuperó la conexión y se completó `check-sales-balance-readonly.js`: los 13 ítems liberados muestreados fueron rechazados por dependencias o segunda unidad. Esto verifica los rechazos con datos reales, pero no acredita una preparación elegible ni una modificación real de pedidos liberados. No se ejecutaron UPDATE comerciales.


## Ampliación posterior: UPDATE directo y solicitudes SC1

La indicación más reciente reemplaza el rechazo genérico por crédito activo por una advertencia explícita de no revalidación, conservando bloqueos efectivos, documentos y estados. El muestreo real posterior preparó 11 de 13 ítems liberados como ejecutables; los otros dos se rechazaron por `C6_PRUNIT` distinto del precio neto y `C6_UNSVEN` no cero. Fue SELECT + preparación en memoria, sin guardar propuestas ni ejecutar UPDATE. No hubo prueba comercial de escritura.

SC1 se incorpora al explorador, chat y formulario con acción `solicitudCompra`: `C1_VUNIT` es precio estimado, no precio de venta. Cantidad en unidades; millares sólo para UM=UN. La precisión local de C1_VUNIT es 2 decimales: se rechazan conversiones que no caben, sin redondear el precio. Se bloquean solicitudes atendidas, aprobadas, cotizadas, vinculadas a pedidos o con dependencias. Se consulta también SC7 por C7_NUMSC/C7_ITEMSC bajo bloqueo transaccional para detectar vínculos concurrentes. SC1 y SC7 estaban vacías en la comprobación real; los UPDATE se probaron con dobles, no con documentos reales.

## Altas SC1/SC7 por SQL con MAX+1

El dueño indicó explícitamente usar `MAX(R_E_C_N_O_)+1`, sin REST. Las acciones `crearSolicitudCompra` y `crearPedidoCompra` crean documentos completos de 1 a 50 ítems mediante la misma API de propuestas y confirmación. La PWA ofrece el formulario **Crear solicitud o pedido de compra** y el chat la herramienta `preparar_alta`; ninguno ejecuta automáticamente al preparar.

### Asignación transaccional

Al confirmar, una transacción SERIALIZABLE con XACT_ABORT y timeout de bloqueo de 10 segundos toma `TABLOCKX,HOLDLOCK` sobre toda la tabla destino. Lee el RECNO máximo global, sin filtrar filial ni borrado lógico, y reserva en memoria de la transacción un rango consecutivo para todos los ítems. Usa BigInt y texto decimal, nunca Number para esos identificadores. Verifica desborde bigint y exige un índice único de RECNO habilitado.

El número de documento se obtiene del máximo número completamente numérico de esa misma tabla, también incluyendo todas las filiales y borrados, más uno, rellenado con ceros hasta la longitud SX3. Los números alfanuméricos no participan del máximo; nunca se reutiliza un número numérico eliminado. Se comprueba que el nuevo número no exista y se rechaza el agotamiento de longitud sin volver a cero. Los ítems se numeran 0001, 0002, etc. según SX3. No se aceptan RECNO, número, campos SQL ni estados proporcionados por el cliente.

Los máximos se leen y todos los INSERT se ejecutan **dentro de la misma transacción**, manteniendo el bloqueo hasta COMMIT/rollback. Cada INSERT usa parámetros, OUTPUT INTO y verificación del RECNO devuelto. Se relee el documento completo y se comprueban todos sus campos: cantidades, precio, total, estados, valores iniciales y sellos generados. Un fallo en cualquier ítem revierte el documento completo. La propuesta no reserva números: se asignan al ejecutar y aparecen en el recibo. Reenviar el mismo ID confirmado devuelve ese recibo sin otra alta; ante resultado incierto no se reintenta.

**Límite de interoperabilidad:** TABLOCKX coordina el acceso a la tabla SQL, pero no actualiza reservas de numeración en memoria de DBAccess/AppServer ni SXE/SXF. No se promete ausencia de conflictos con un proceso Protheus que ya tenga un número reservado. Esta implementación conserva los índices únicos; si su INSERT colisiona, falla y revierte. No altera tablas internas de DBAccess, no migra RECNO a IDENTITY ni simula que ejecutó GetNumSC1/GetNumSC7. [TOTVS distingue la asignación DBAccess de RECNO de la modalidad IDENTITY](https://tdn.totvs.com/display/public/framework/campos%2BRECNO%2Bauto-incremental).

### Datos y estado del documento

La primera versión crea documentos independientes en moneda local `1` y cotización `1`, sin relación con otra solicitud, contrato, recepción, impuesto calculado, descuento, rateo o grilla de productos. No es la ejecución de MATA110/MATA120. El estado inicial ya no es B fijo: se resuelve con SX6/SY1 conforme al apartado siguiente. Genera el circuito SCR/DBM pendiente descrito en [aprobaciones SQL](aprobaciones-sql.md); no atribuye una aprobación realizada a un usuario Protheus. La auditoría del operador queda en el recibo local. La ausencia de aprobación requerida no equivale a haber ejecutado validaciones nativas.

Se verifican referencias activas de producto SB1, depósito NNR, proveedor/tienda SA2 y condición SE4; el centro de costo informado o tomado de SB1 se valida en CTT. Se rechazan productos/proveedores bloqueados. Cantidad y precio tienen base explícita. Para UN se convierten millares; si SB1 tiene segunda unidad, se calcula usando B1_CONV y B1_TIPCONV, con la precisión de C1_QTSEGUM/C7_QTSEGUM. No se redondean silenciosamente cantidades ni precios; sólo totales. SC1 guarda precio estimado C1_VUNIT y cantidad original C1_QTDORIG; SC7 guarda C7_PRECO y C7_TXMOEDA. Se conservan cantidades atendidas en cero, sin tocar stock ni títulos.

Se cotejan SX3, tipos físicos, campos obligatorios, valores iniciales e índices. Valores iniciales desconocidos, columnas nuevas obligatorias o triggers no verificados impiden el alta. Los catálogos, reglas de conversión, esquema y datos calculados forman parte de la huella; se vuelven a comprobar dentro de la transacción. La app requiere permiso SQL INSERT en SC1/SC7 además de SELECT. No otorga permisos.

Ejemplo de solicitud, sustituyendo los códigos por referencias existentes:

```json
{
  "action": "crearSolicitudCompra",
  "target": {"sucursal": "0101"},
  "header": {"fechaEmision": "2026-10-19", "moneda": "1", "solicitante": "Operador"},
  "items": [{
    "producto": "CODIGO_EXISTENTE", "deposito": "01", "fechaNecesidad": "2026-10-20",
    "cantidad": "2.5", "baseCantidad": "millares", "precio": "80", "basePrecio": "millar"
  }]
}
```

Para `crearPedidoCompra`, la cabecera requiere `proveedor`, `tienda` y `condicionPago`, en lugar de `solicitante`; `contacto` y `comprador` (código SY1) son opcionales. Si hay grupos por comprador, se debe identificar el comprador; su grupo prevalece sobre MV_PCAPROV. No se infiere un usuario ERP a partir del nombre de sesión local. Cada ítem admite `centroCosto` y `observacion` opcionales. La confirmación continúa en `/api/changes/{id}/execute` con `confirm:true` y la huella devuelta. La API tiene un límite de cuerpo de 16 KiB, además de 50 ítems; no se divide un documento automáticamente.

### Verificación de esta ampliación

103 pruebas aprobaron, incluyendo altas multiítem de SC1/SC7, RECNO mayor que Number.MAX_SAFE_INTEGER, máximos de otra filial y de filas borradas, numeración agotada, dos confirmaciones concurrentes con doble transaccional, rollback del segundo INSERT, cambios de catálogos, defaults inesperados, permisos HTTP, idempotencia y COMMIT incierto. El chat se prueba preparando desde referencias observadas sin ejecutar.

`node --env-file=.env scripts/check-purchase-creation-readonly.js` preparó ambos tipos contra los catálogos reales y verificó el SELECT de asignación con bloqueo en SQL Server. Comprobó 89 valores iniciales omitidos en SC1 y 249 en SC7. No guardó propuestas ni ejecutó INSERT/UPDATE comerciales. Las transacciones de alta se probaron con dobles; falta verificar un documento comercial concreto en las pantallas y reportes Protheus. La implementación está habilitada, pero esa homologación funcional no se presenta como realizada.


### Estado inicial y circuito de aprobación de Protheus

La implementación actual sustituye el bloqueo general de altas con alçadas por generación transaccional de SCR y DBM. La propuesta versión 4 y el recibo incluyen los pasos por grupo, aprobador, nivel e importe. Un documento pendiente B puede crearse desde la app; la aprobación posterior corresponde a Protheus. No se permite forzar estados por parámetros de entrada.

Ver [contrato de aprobaciones SQL](aprobaciones-sql.md) para reglas, campos, límites, fuentes y evidencia de pruebas. La aprobación simple SC1 se distingue del circuito por alçadas y utiliza los derechos SAI. Configuración incompleta o variantes no implementadas se informan como errores específicos, nunca como ausencia de aprobación.

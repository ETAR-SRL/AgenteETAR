# Logística de solicitudes y pedidos existentes

El chat y el dictado preparan cambios sobre documentos existentes, con los permisos actuales de preparación y ejecución de cada tipo. No se agregan permisos a roles. La conversación identifica el documento; sus valores actuales siempre se releen.

| Documento | Emisión, documento completo | Entrega/necesidad del ítem | Depósito del ítem | Pago, documento completo |
|---|---|---|---|---|
| Solicitud SC1 | C1_EMISSAO | C1_DATPRF | C1_LOCAL | No aplica al contrato estándar SC1 |
| Compra SC7 | C7_EMISSAO | C7_DATPRF | C7_LOCAL | C7_COND en todos los ítems |
| Venta SC5/SC6 | C5_EMISSAO | C6_ENTREG | C6_LOCAL | C5_CONDPAG en cabecera |

## Resumen y ejecución

La tarjeta muestra antes/después, fechas completas, códigos con ceros iniciales y todos los ítems comprendidos por un cambio general. Emisión y pago generan una única propuesta por documento. Si se combinan con cambios por ítem y falta identificarlo, se pregunta el alcance, conservando ambos cambios. No se crean tarjetas superpuestas.

Nada se ejecuta al pedirlo por chat. Se conserva la confirmación explícita con huella. Al confirmar se revalidan permisos, identidad, sucursal, valores, dependencias, catálogos y metadatos. Si cambiaron, se rechaza la propuesta y se requiere revisar un resumen nuevo. Una ejecución fallida o incierta no se reenvía automáticamente.

La transacción serializable relee bajo bloqueos de rango el documento completo y sus dependencias. SC5 se actualiza una vez; los campos de cabecera repetidos en SC1/SC7 se actualizan atómicamente. Se verifican filas afectadas y lectura posterior, revirtiendo efectos no solicitados. La huella incluye SX3/columnas físicas vigentes, triggers verificados y catálogos. La versión de política invalida propuestas antiguas.

Una modificación sólo logística conserva precios, cantidades, totales y MILLAR, incluidas diferencias históricas. Los cambios numéricos expresamente solicitados conservan sus reglas. Un precio sin diferencias no impide otro cambio logístico válido; los errores de precisión o negocio sí.

## Reglas y límites

- Fecha completa y calendario válido. Entrega/necesidad no anterior a emisión es una restricción conservadora de la app, no una afirmación sobre todos los casos nativos.
- Logística sólo sin atención, liberaciones, reservas, aprobación, documentos vinculados ni dependencias especiales. No mueve stock ni modifica remitos, facturas, títulos, aprobaciones o crédito. El reajuste de precio pendiente de ventas liberadas conserva su circuito anterior.
- Depósitos NNR exactos y activos. Se rechazan vínculos concretos de lote, ubicación, WMS y depósitos especiales no soportados; la configuración de rastreo del producto por sí sola no acredita esos vínculos.
- Pago verifica SE4 actual y nueva: condiciones normales sin descuentos, intereses, anticipos o efectos financieros que requieran las rutinas nativas. No modifica vencimientos emitidos.
- SC5 con lista verifica DA0/DA1: vigencia, moneda, condición e intervalos de cantidad. No cruza cambios de aplicabilidad ni reemplaza precios manuales.
- Son UPDATE SQL controlados: no ejecutan validadores/personalizaciones ADVPL ni equivalen a homologación nativa. Los casos con recálculos o metadatos desconocidos se rechazan con motivo específico.
- Los adjuntos conservan precios, cantidades y altas. Esta ampliación logística se pide por texto/voz sobre documentos existentes; no se habilita silenciosamente en lotes de archivo.

## Uso

«Del pedido de compra 000123, cambiá la entrega del ítem 0001 al 05/11/2026». «Usá el depósito 03 para ese ítem». «En ese pedido, condición de pago 002». «La emisión no: dejala al 23/10/2026». «De la solicitud 000456, ítem 0001, cambiá la fecha de necesidad al 10/11/2026».

## Evidencia del 22/10/2026

ERP consultivo: 20 depósitos y 35 condiciones, códigos únicos; SX3/columnas logísticas y DA0/DA1 verificadas. SC1/SC7 sin documentos activos de la sucursal. SC6: 163 filas con dependencias según la regla conservadora; 80 preparaciones sobre 20 filas rechazadas correctamente. No se acredita una escritura comercial real.

Chat HTTP completo con datos reales, usuarios y SQLite aislados: documento/ítem, continuidad de entrega, corrección, aislamiento y revocación. Ocho lecturas, cero inferencias innecesarias, confirmaciones y escrituras. El caso real requirió Protheus por sus dependencias; no se presenta como ejecutable.

SQL Server LocalDB independiente, datos sintéticos y ejecutores reales: ocho casos de commit SC1/SC7/SC6 conservando importes/cantidades, pago SC5/SC7, emisión SC1 de dos ítems, rollback tras el segundo UPDATE y catálogo cambiado. No homologa DBAccess/AppServer ni personalizaciones.

```
node --test test/logistics-writer.test.js test/logistics-update-access.test.js test/logistics-updates-chat.test.js
node scripts/sandbox-logistics-updates-sql.js --run-local-synthetic
node --env-file=.env scripts/check-logistics-updates-readonly.js --preview --limit=20
node --env-file=.env scripts/evaluate-logistics-updates-chat-live.js --live
```

Informes en `reports/`, ignorados por Git, sin filas/identificadores comerciales. El auditor rechaza DML, bloqueos y lotes SQL; no abre Store ni conexión de escritura.

Referencias oficiales: [pedido de compra](https://tdn.totvs.com/pages/viewpage.action?pageId=306851390), [campos de emisión/pago](https://tdn.totvs.com/display/INT/Detalhamento%2B-%2BCampos%2BIntegrados), [fechas/depósitos SC1/SC7](https://tdn.totvs.com/display/PROT/Resultados%2Bdo%2BMRP), [vigencia DA1 y emisión](https://tdn.totvs.com/pages/viewpage.action?pageId=726508630), [entrega y vencimientos](https://centraldeatendimento.totvs.com/hc/pt-br/articles/7894027693335-Cross-Segmento-TOTVS-Backoffice-Linha-Protheus-SIGAFAT-Gerar-duplicata-a-partir-da-data-de-entrega-do-pedido).

# Monedas en altas desde adjuntos

El chat admite archivos Excel, fotos y PDF en pesos o dólares. Se pide sólo la información faltante; no se crea ningún documento al adjuntar, dictar o preparar. La tarjeta muestra moneda original, cantidades y bases, precios originales, importes que se grabarán, total local, cotización, fecha y fuente antes de exigir confirmación.

## Pedidos SC7

- Resuelve la moneda mediante los nombres MV_MOEDA1…5 de SX6, con precedencia de filial sobre configuración global. No supone que dólar siempre sea el código 2.
- Para moneda extranjera obtiene una única fila activa de SM2 de la fecha de emisión. No utiliza una tasa externa, una tasa del archivo, el último día disponible ni un valor predeterminado de 1. Ausencia, duplicidad o tasa no positiva impiden preparar hasta corregir la cotización en Protheus o indicar otra fecha.
- Conserva precios en la moneda de origen: C7_MOEDA identifica la moneda y C7_TXMOEDA guarda la tasa. Precio por millar / 1000 y cantidad de millares × 1000 son conversiones independientes. C7_TOTAL se calcula a partir del precio y cantidad almacenados.
- Relee y compara moneda y tasa dentro de la transacción. Si cambian después del resumen, exige una propuesta nueva. La precisión debe caber en SX3 tanto para SC7 como para SCR; no redondea silenciosamente la cotización.

## Solicitudes SC1 en dólares

La variante verificada para moneda extranjera es **Solicitud de importación (SI, MATA113)**, que comparte SC1 con la solicitud común (SC, MATA110). El chat pide elegir explícitamente ese tipo si el usuario sólo dijo «solicitud en dólares». La API requiere `header.tipoSolicitud="importacion"`. La elección se mantiene en el resumen; no transforma automáticamente una compra nacional en una importación.

- Conserva el código de moneda en C1_MOEDA, el precio unitario en C1_PRECO y el total en C1_TOTAL. No convierte esos valores a pesos ni utiliza C1_VUNIT para el precio de importación.
- C1_TIPO=2, C1_IMPORT=S, C1_COTACAO=IMPORT y clase inicial C1_CLASS=1 validada contra SX5/Y1. El producto debe estar activo, ser único y tener B1_IMPORT=S. No modifica su clasificación. Mantiene validación de depósitos, unidades, centros de costo y fechas.
- Aplica la regla local verificada de SX7: NoRound(C1_PRECO × C1_QUANT, decimales de C1_TOTAL), es decir, truncamiento del total positivo. El precio debe caber exactamente en SX3 (en este ambiente, C1_PRECO admite cuatro decimales). Relee la regla al confirmar; no ejecuta texto del diccionario.
- Requiere MV_COMPINT activo y MV_EASY=N. MV_APROVSI determina B (pendiente de aprobación en MATA113) o L. SI no hereda el circuito SC de MV_APRSCEC: no inventa filas SCR/DBM. B puede confirmarse y crearse; la app no aprueba el documento.
- La cotización SM2 sigue mostrándose y revalidándose en el resumen. El equivalente en pesos es **informativo**. SC1 no tiene un campo de tasa equivalente a C7_TXMOEDA: fecha y tasa se conservan en la auditoría local, sin presentarlas como tasa fija de un futuro pedido. C1_TX es transmisión y no se modifica.
- Las consultas leen C1_PRECO y C1_MOEDA para SI; las SC comunes siguen usando C1_VUNIT y moneda local. La acción de actualizar estimaciones comunes rechaza SI, para no tocar el campo de precio incorrecto.

Ejemplo: 2,5 millares a USD 80 por millar → C1_QUANT=2500, C1_PRECO=0,0800, C1_TOTAL=200,00 y C1_MOEDA=código USD configurado. Sólo se crea después de confirmar el resumen.

## Evidencia

Relevamiento local del 20/10/2026 mediante SELECT: SM2010 es compartida y no tiene M2_FILIAL; SX2 declara modo C. La configuración `branches.SM2.0101` es vacía, explícita. SX6 identifica PESO y DOLAR. SX3 describe C1_VUNIT como precio unitario estimado y C1_TX como flag de transmisión. No se crearon documentos de negocio como prueba.

TOTVS documenta [moneda y tasa en pedidos de compra](https://centraldeatendimento.totvs.com/hc/pt-br/articles/4417553472279-Cross-Segmentos-Totvs-Backoffice-Protheus-SIGACOM-Uso-da-Moeda-no-processo-de-Compras-Pedido-de-Compras-x-Nota-fiscal-de-Entrada), y distingue [C1_PRECO/C1_TOTAL en localizaciones internacionales](https://centraldeatendimento.totvs.com/hc/pt-br/articles/6904106787735-Cross-Segmentos-TOTVS-Backoffice-Linha-Protheus-SIGACOM-Tem-como-habilitar-os-campos-C1-PRECO-e-C1-TOTAL-da-tabela-de-Solicita%C3%A7%C3%A3o-de-Compras). La ampliación se basa en las referencias oficiales de Mercado Internacional: [C1_MOEDA debe conservar la moneda del archivo en MATA113](https://tdn.totvs.com/x/8pIUIg), [requisitos MV_COMPINT y MV_EASY](https://centraldeatendimento.totvs.com/hc/es/articles/33998401401367), [filtro SI con C1_TIPO=2, moneda y C1_COTACAO](https://centraldeatendimento.totvs.com/hc/es/articles/360059108793), [aprobación mediante MV_APROVSI](https://centraldeatendimento.totvs.com/hc/es/articles/1500000243842) y [SI no usa el circuito por entidades contables de SC](https://centraldeatendimento.totvs.com/hc/es/articles/10323241408151). El [layout MILE oficial](https://centraldeatendimento.totvs.com/hc/es/articles/4415170660119) identifica C1_PRECO/C1_TOTAL en los ítems y C1_MOEDA en cabecera.

Se contrastaron campos y parámetros en la base argentina 2510: C1_PRECO=4 decimales, C1_TOTAL=2, regla SX7 NoRound, MV_COMPINT=T, MV_EASY=N y MV_APROVSI=F. Una preparación de extremo a extremo con producto importado y depósito reales pasó sin blockers usando exclusivamente SELECT. No equivale a validar una inserción real desde la pantalla MATA113; las ejecuciones y rollbacks se probaron con dobles SQL.

Permisos y confirmación son los mismos de crearSolicitudCompra/crearPedidoCompra. No se agregó una API de lectura general de SX6 ni se cambiaron roles. Cada documento admite una sola moneda explícita; las filas incompatibles se presentan como errores antes de preparar.

# Monedas en altas desde adjuntos

El chat admite archivos Excel, fotos y PDF en pesos o dólares. Se pide sólo la información faltante; no se crea ningún documento al adjuntar, dictar o preparar. La tarjeta muestra moneda original, cantidades y bases, precios originales, importes que se grabarán, total local, cotización, fecha y fuente antes de exigir confirmación.

## Pedidos SC7

- Resuelve la moneda mediante los nombres MV_MOEDA1…5 de SX6, con precedencia de filial sobre configuración global. No supone que dólar siempre sea el código 2.
- Para moneda extranjera obtiene una única fila activa de SM2 de la fecha de emisión. No utiliza una tasa externa, una tasa del archivo, el último día disponible ni un valor predeterminado de 1. Ausencia, duplicidad o tasa no positiva impiden preparar hasta corregir la cotización en Protheus o indicar otra fecha.
- Conserva precios en la moneda de origen: C7_MOEDA identifica la moneda y C7_TXMOEDA guarda la tasa. Precio por millar / 1000 y cantidad de millares × 1000 son conversiones independientes. C7_TOTAL se calcula a partir del precio y cantidad almacenados.
- Relee y compara moneda y tasa dentro de la transacción. Si cambian después del resumen, exige una propuesta nueva. La precisión debe caber en SX3 tanto para SC7 como para SCR; no redondea silenciosamente la cotización.

## Solicitudes SC1: alcance explícito

Esta implementación admite **adjuntos en dólares**, pero **no crea una solicitud SC1 denominada en dólares**. Convierte el precio estimado del adjunto a moneda local, graba C1_MOEDA=1 y C1_VUNIT en moneda local y recalcula C1_TOTAL desde el precio estimado almacenado. Conserva importe y moneda originales en la propuesta/auditoría. El resumen advierte que no fija la moneda de un futuro pedido.

C1_VUNIT se redondea a la precisión SX3 local y el ajuste queda expuesto en `ajusteRedondeoLocal` en los detalles. C1_TX es un indicador de transmisión, **no una cotización**. No se escribe allí ni se inventa C1_TXMOEDA. El uso de C1_MOEDA/C1_PRECO para una solicitud internacional requiere verificar la rutina de la localización argentina; no se habilita por semejanza de nombres.

## Evidencia

Relevamiento local del 20/10/2026 mediante SELECT: SM2010 es compartida y no tiene M2_FILIAL; SX2 declara modo C. La configuración `branches.SM2.0101` es vacía, explícita. SX6 identifica PESO y DOLAR. SX3 describe C1_VUNIT como precio unitario estimado y C1_TX como flag de transmisión. No se crearon documentos de negocio como prueba.

TOTVS documenta [moneda y tasa en pedidos de compra](https://centraldeatendimento.totvs.com/hc/pt-br/articles/4417553472279-Cross-Segmentos-Totvs-Backoffice-Protheus-SIGACOM-Uso-da-Moeda-no-processo-de-Compras-Pedido-de-Compras-x-Nota-fiscal-de-Entrada), y distingue [C1_PRECO/C1_TOTAL en localizaciones internacionales](https://centraldeatendimento.totvs.com/hc/pt-br/articles/6904106787735-Cross-Segmentos-TOTVS-Backoffice-Linha-Protheus-SIGACOM-Tem-como-habilitar-os-campos-C1-PRECO-e-C1-TOTAL-da-tabela-de-Solicita%C3%A7%C3%A3o-de-Compras). Estas referencias no prueban por sí solas un circuito de solicitud extranjera argentino; por eso se muestra el tratamiento de estimación local.

Permisos y confirmación son los mismos de crearSolicitudCompra/crearPedidoCompra. No se agregó una API de lectura general de SX6 ni se cambiaron roles. Cada documento admite una sola moneda explícita; las filas incompatibles se presentan como errores antes de preparar.

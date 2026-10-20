# Consultas comerciales y comandos del chat

Altas y cambios se solicitan por texto o voz en el Asistente. No hay una pantalla separada de Actualizaciones. La tarjeta del chat conserva identidad, diferencias, condiciones y confirmación. Antes de preparar un cambio se relee el producto en SB1; el ejecutor mantiene la validación transaccional del producto, documento y dependencias. Las altas SC1/SC7 se identifican como documentos nuevos desde cero, numerados al confirmar.

Ejemplos: «Mostrame las notas de crédito de ventas de este mes», «Sacame un dashboard de compras por proveedor», «Resumí las ventas de octubre por producto», «Mostrame remitos pendientes de facturar», «Qué pedidos de venta quedan para el cliente 000001».

La herramienta `resumir` agrega todo el alcance filtrado en SQL. La tarjeta muestra totales, gráfico por grupo, tabla completa y CSV. El resumen textual usa cifras verificadas por el servidor. Sin período explícito se usa el mes corriente de Argentina hasta hoy.

## Recursos de solo lectura

| `/api/erp/…` | Datos |
| --- | --- |
| `comprobantesVentas` | SD2 NF/NDC y SD1 NCC |
| `comprobantesCompras` | SD1 NF/NDP y SD2 NCP |
| `remitosEmitidos` | SD2 RFN, tipo N, TIPODOC 50 |
| `remitosPendientes` | Los mismos remitos con D2_QTDAFAT positivo |
| `pedidosVentaPendientes` | SC6 QTDVEN − QTDENT positivo, sin residuo BLQ R |
| `pedidosCompraPendientes` | SC7 QUANT − QUJE positivo, sin RESIDUO ni ENCER |
| `resumenVentas`, `resumenCompras` | Agregación de los respectivos comprobantes |
| `resumenRemitosPendientes`, `resumenPedidosVenta`, `resumenPedidosCompra` | Agregación de saldos actuales |

Las especies se contrastaron con SX5 tabla 42 del ambiente. Una NC de proveedor sale por SD2; una NC de cliente entra por SD1. No clasificar todo SD2 como venta. Referencia: [TOTVS, documentos de diferencia de cambio Argentina](https://tdn-homolog.totvs.com/display/public/PROT/DT%2BDiferencia%2Bde%2Bcambio%2Bcuentas%2Bpor%2Bcobrar%2BFINA074%2BARG).

La moneda se obtiene de una cabecera SF1/SF2 única por filial, documento, serie, tercero/tienda, tipo, especie y TIPODOC. Ventas pendientes usan SC5; compras usan C7_MOEDA. Cada tabla aplica su filial configurada y excluye borrados. Si la cabecera falta o es ambigua no se publican importes.

## Interpretación y límites

- Neto de ítems = NF + ND − valor absoluto de NC. No incluye automáticamente impuestos/fletes ni equivale al total final de cabecera.
- Se separan monedas y unidades, sin conversión cambiaria. Se muestran los códigos de moneda del ERP. Cálculo a seis decimales; cantidad en millares sólo para unidad UN.
- Remito pendiente significa pendiente de facturación por D2_QTDAFAT, no de entrega física. Incluye cantidades original, facturada y devuelta. Importe pendiente estimado = saldo × precio.
- Los pendientes son saldos actuales. El período filtra emisión y no reconstruye un saldo histórico; pueden incluir bloqueos/aprobaciones pendientes.
- Especies distintas de NF/NCC/NDC/NCP/NDP no se incluyen en los resúmenes de facturación.
- Resúmenes: máximo 367 días inclusive y 5000 grupos. Si se exceden no se devuelve un total parcial. No sumar conteos de documentos entre unidades diferentes.
- Se verificaron lecturas reales sin escrituras comerciales. SC7 no tenía filas ni se encontró NCC de cliente: esas variantes tienen pruebas con datos simulados.

Filtros: `sucursal`, `desde`, `hasta`, `numero`, `serie`, `producto`, `cliente` o `proveedor`, `tienda`, `moneda`, `clase` (NF/NC/ND para comprobantes). Resúmenes agregan `agrupar`: mes, tercero, producto o clase; no admiten páginas posteriores a la primera. Detalle admite `page` y `limit`.

Ventas requieren permisos de ventas/clientes/precios de venta/catálogo; compras requieren compras/proveedores/precios de compra/catálogo. Las lecturas antiguas sin clasificación de SD1/SD2/SF2 requieren ambas áreas porque mezclan comprobantes de clientes y proveedores.

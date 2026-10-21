# Recorrido integral por pedido de venta

Por texto o dictado: «Analizá el pedido de venta 129713». Verifica una cabecera SC5 única y reúne:

- Cliente y tienda SA1, lista guardada en el pedido.
- Ítems SC6 con producto SB1, cantidades pedida/atendida/saldo aritmético, precio unitario y total almacenado. Para terminados Z en UN muestra también precio por millar. C6_MILLAR es cantidad; nunca se interpreta como precio.
- Liberaciones SC9 por ítem, producto, cliente y tienda; cantidad, precio, secuencia, bloqueos de crédito/stock y referencias documentales. No suma liberaciones históricas como disponibilidad ni interpreta códigos vacíos como aprobación.
- Remitos RFN/50/N y facturas NF/notas de débito NDC SD2 con cabecera SF2 única. Mantiene moneda de cada documento, que puede diferir de la del pedido.

Continúa con «su cliente», «sus productos», «sus precios», «sus cantidades», «sus liberaciones», «sus remitos» o «sus facturas». Cada turno relee la identidad SC5 y las fuentes solicitadas sin llamar al modelo. Guarda sólo número, sucursal y foco en el contexto personal de conversación; no usa importes guardados como valores actuales. Cambiar de entidad o sucursal invalida el foco. Conserva la referencia para preparar modificaciones por el flujo existente, con resumen y confirmación; consultar la ficha no ejecuta modificaciones.

## Vínculos y límites

`documentosPedidoVenta` requiere `pedido` exacto. Consulta sólo SD2 NF/NDC/RFN. Comprueba cliente/tienda y cabecera SC5, además de un ítem SC6 único con el mismo producto y tercero. El vínculo puede ser directo por D2_PEDIDO/D2_ITEMPV, o mediante D2_REMITO/D2_SERIREM/D2_ITEMREM a un remito RFN/50/N único, con esos mismos tercero, producto y sucursal, que referencia el pedido/ítem. No busca por semejanza de producto o fecha. Una factura con otra referencia directa de pedido no se reasigna por el remito.

Los vínculos incompletos o ambiguos quedan fuera. No encontrar filas no demuestra ausencia de facturación. No incluye notas de crédito SD1 sin vínculo verificado. Cada importe documental conserva su moneda, unidad y alcance de ítem: no incorpora automáticamente impuestos/fletes ni total final de cabecera. Remitos y facturas no se suman entre sí. SC6 atendido, SC9 y remitos no certifican recepción física por el cliente.

Máximo 1000 filas por recurso en la ficha, con alcance parcial explícito; hasta diez ítems visibles por sección y detalle en las fuentes. Los documentos se ordenan por emisión/registro; no se presenta una muestra como total global.

## Permisos y verificación

`liberacionesVentas` y `documentosPedidoVenta` requieren ventas, clientes, preciosVenta y catalogo. Cada lectura pasa por autorización y sucursal del servidor; no requiere acceso a compras/proveedores para consultar documentos de venta. La cabecera usa los permisos existentes de `ventas`; cada sección verifica los de su recurso. Una sección denegada responde «Esto no podés leerlo» y no adjunta filas protegidas. Si cambia el acceso durante la lectura, se propaga el rechazo del servidor.

Pruebas automatizadas cubren continuidad, aislamiento por usuario/sucursal, revocación, faltantes, duplicados, vínculos inconsistentes, separación de monedas/unidades y conservación de propuestas de cambios. Verificación local de sólo lectura: pedidos 129713 y 125746, con SC5/SC6/SC9, remitos y factura reales. El camino de factura vía remito se verificó además ejecutando SELECT con filas sintéticas en memoria de la consulta SQL, sin insertar tablas ni registros ERP; no se encontró una muestra actual con todas sus referencias completas para ese camino. Ningún documento comercial se modificó como prueba.

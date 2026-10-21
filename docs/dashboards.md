# Dashboards desde el chat

Por texto o voz:

- «Haceme un dashboard de ventas de los últimos dos días».
- «Dashboard de ventas y compras de este mes».
- «Resumen de compras por proveedor del mes pasado».
- «Ranking de ventas por producto de este año».
- «Dashboard de pedidos de venta pendientes de este mes».
- «Reporte de remitos pendientes de este mes».

Después de un informe individual, «¿y el pasado?» o «¿y el año pasado?» relee ambos períodos y muestra una comparación con diferencias y porcentajes. Conserva filtros y sucursal de ese informe. El período actual termina hoy; el anterior se consulta completo. Una base anterior cero no tiene variación porcentual calculable.

Las tarjetas muestran indicadores por moneda y unidad, gráficos, tabla completa, CSV e impresión/PDF desde el navegador. Los rankings visuales ordenan las agrupaciones por importe; el gráfico muestra hasta 24. La tabla y el CSV incluyen todo el resultado agregado, sin sumar páginas de movimientos. La interfaz no convierte monedas ni suma unidades distintas.

Las monedas se identifican con `SX6.MV_MOEDA1..5` en su filial física configurada. «Pesos (ARS)» y «Dólares (USD)» sólo se muestran cuando esa descripción está verificada; no se asignan por el número 1 o 2. Una moneda sin descripción conserva su código y se marca sin identificar. Los importes de ambas monedas siguen separados.

Un informe cuyo período está dentro de un mismo mes incluye automáticamente barras comparativas de importes y cantidades contra los mismos días del mes anterior. Por ejemplo, 1–21 de octubre contra 1–21 de septiembre; los días se ajustan al último día existente en meses cortos. Se muestran las fechas y las variaciones, sin porcentaje si la base anterior es cero. Para períodos que abarcan varios meses se conservan los gráficos de evolución y la comparación explícita por chat. Si falla la lectura de referencia se conserva el período consultado y se indica que la comparación no está disponible, sin inventar ceros.

Las cantidades UN se presentan prioritariamente en millares (división exacta entre 1000); KG, metros y otras unidades conservan su medida. La tabla y el CSV del dashboard incluyen la cantidad en millares y la cantidad original en unidades, además del código de moneda. La comparación muestra importes y cantidades con escalas propias por moneda y unidad. Valores negativos llevan signo y barras diferenciadas.

Se usan los recursos agregados existentes y sus permisos. Ventas y compras se consultan por separado, sin calcular una utilidad a partir de su diferencia. Las ventas incluyen NF + ND − NC; los importes provienen de ítems y no incorporan automáticamente impuestos o fletes. Los pendientes reflejan el saldo actual de documentos emitidos en el período; los remitos pendientes son pendientes de facturar, no una confirmación de recepción física.

Los períodos reconocidos directamente son hoy, ayer, últimos N días (1–366), este mes, mes pasado, este año y año pasado. Los filtros específicos o períodos no reconocidos pasan a las herramientas validadas del asistente: no se descartan silenciosamente. Una consulta fallida no debe mostrarse como un resultado vacío o como cifras inventadas. Los documentos nuevos y actualizaciones conservan sus resúmenes y confirmaciones independientes.

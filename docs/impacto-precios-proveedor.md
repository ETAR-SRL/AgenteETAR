# Impacto consultivo de una lista de proveedor adjunta

Después de revisar un adjunto y preparar precios AIB válidos, el resumen agrega una simulación sobre saldos de pedidos de compra existentes del mismo proveedor, tienda y producto. Usa exclusivamente `pedidosCompraPendientes`, con filtros ya soportados, sin relaciones SQL nuevas ni coincidencias por nombre.

La estimación compara saldo pendiente × precio actual SC7 con saldo pendiente × precio AIB propuesto por unidad. No usa el precio anterior de AIB como si fuera el precio del pedido. Presenta cantidad, importe actual, simulado y diferencia, separados por código de moneda y unidad. Sólo UN tiene cantidad en millares. No convierte monedas ni unidades y excluye registros con identidad, precio, moneda o unidad no verificables. No incluye impuestos ni fletes y no certifica recepción física.

La lectura tiene un máximo de veinte productos y tres páginas de cien filas por producto. Si se agota el límite o la fuente no confirma completitud, el resumen queda explícitamente parcial. Las lecturas fallidas, campos ausentes y registros excluidos se explican por producto. Varios registros AIB del mismo producto y tercero no eligen automáticamente un rango ni duplican el saldo.

Antes de consultar pedidos se exige permiso de lectura del recurso completo. Sin ese permiso, la sección responde «Esto no podés leerlo.» y no consulta pedidos ni devuelve sus títulos, cantidades o importes. Cada página revalida permisos antes y después de la lectura; una revocación durante la revisión descarta la respuesta.

Cada fila del lote muestra diferencia absoluta y porcentual de precio, moneda ERP, unidad y fecha de evidencia. Una base anterior cero no tiene variación porcentual calculable. Las fechas de vigencia, si estaban en el registro, se conservan como referencia anterior/nueva sin modificación; no se afirma que el cambio de precio actualice vigencias. La huella del lote incluye el impacto leído para que la confirmación corresponda al resumen exacto. Esa evidencia es una fotografía consultiva de la revisión, no una garantía de que el saldo no cambiará después.

Confirmar el lote sigue ejecutando únicamente las propuestas AIB preparadas. No prepara ni modifica SC7, no agrega escrituras y no exige confirmar otra operación. Un cambio futuro de pedidos requeriría una propuesta independiente en el circuito existente.

Las pruebas usan fuentes controladas y verifican permiso sin consultas, monedas separadas, UN frente a otras unidades, límites y parcialidad, precios SC7 independientes de AIB, evidencia y vigencia en el lote y ausencia de propuestas/escrituras adicionales.

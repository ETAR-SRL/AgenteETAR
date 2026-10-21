# Recorrido integral por proveedor

Texto o dictado: «Analizá el proveedor STILMAR», «Ficha integral del proveedor 000039 tienda 01». Resuelve la identidad en SA2 por código o nombre y pide elegir si hay proveedores o tiendas ambiguos. Cada seguimiento relee el proveedor y tienda exactos, sin agregar ceros al código ni heredar otra sucursal.

## Contenido y contexto

- Precios AIA/AIB del proveedor y tienda: conserva todas las listas, rangos, fletes, monedas y vigencias. La unidad se verifica mediante la referencia inequívoca a SB1; sólo UN tiene equivalencia por millar. Una cabecera faltante, duplicada, futura o vencida se señala. No elige un precio entre alternativas ni presenta fechas vigentes como una validación comercial nativa.
- Compras facturadas con NF/ND menos NC usando el resumen comercial SQL existente, separado por moneda y unidad y con dashboard. No suma páginas ni mezcla compras con ventas o entradas de devolución.
- Pedidos de compra con saldo técnico actual, sin recorte por emisión que elimine pedidos antiguos. Mantiene moneda/unidad; no equivale a deuda financiera ni recepción física. Puede incluir ítems con aprobación o bloqueos pendientes.
- Entradas documentales normales SD1, especie NF y tipo N, verificadas en esta base. Muestra documento, producto, cantidad/unidad, depósito, fechas y referencia D1_PEDIDO/D1_ITEMPC cuando está guardada. No inventa un vínculo con SC7, ni confirma recepción física, ni incluye NC/ND. No representa un circuito independiente de remitos de proveedor ni se suma a la facturación.
- Títulos SE2 con saldo almacenado distinto de cero, por tipo y moneda, con vencimiento/cuota. No netea anticipos o créditos como deuda ni calcula intereses, compensaciones o saldos históricos.

Seguimientos: «sus precios», «sus compras», «y el mes pasado», «sus pedidos», «sus recepciones», «sus saldos», «sus comprobantes». Tras compras, la comparación vuelve a consultar ambos períodos para el mismo proveedor y tienda. Las recepciones muestran hasta diez ítems recientes sin recorte por defecto; «sus recepciones del mes pasado», o «y el mes pasado» después de recepciones, filtra por **emisión**. El registro de entrada se muestra además en su campo propio, sin confundir las fechas.

Los saldos de títulos/pedidos son actuales y no se reconstruyen a una fecha pasada. Los filtros no soportados se aclaran o se derivan al flujo existente, sin descartarlos. Cambiar de cliente, producto, proveedor o sucursal evita reutilizar silenciosamente la referencia anterior. La memoria guarda sólo identidad, tienda, sucursal y período; no sustituye valores actuales del ERP. Las operaciones de escritura conservan sus flujos de propuesta y confirmación existentes: esta ficha sólo consulta.

Las secciones independientes leen en paralelo sin una inferencia del modelo. Las listas, los pedidos y los títulos recorren hasta diez páginas de cien filas por recurso. Se informa el alcance parcial; las sumas de filas parciales no se presentan como totales globales. Se muestra una muestra breve en el chat; las fuentes conservan el detalle leído y los decimales originales, aunque la respuesta elimine residuos de representación float con hasta 15 dígitos significativos.

## Recursos y permisos

Todos los recursos exigen usuario autorizado y sucursal. Resolver SA2 requiere `read:proveedores`. Precios AIA/AIB y compras conservan sus permisos compuestos existentes; la ficha no concede un permiso global. Una sección denegada responde «Esto no podés leerlo» sin adjuntar filas ni enviarlas al modelo; un error de fuente no se interpreta como cero. La revisión de acceso se verifica también al entregar la respuesta.

Nuevo recurso `GET /api/erp/saldosProveedores?sucursal=0101&proveedor=000039&tienda=01`: requiere **read:finanzasProveedores y read:proveedores**. Los roles existentes no reciben automáticamente ese nuevo acceso financiero; se asigna desde Usuarios y roles. La lectura usa SE2 (`dbo.SE2010`), filial física `0101` verificada, código/tienda parametrizados, exclusión de borrados y E2_SALDO numérico distinto de cero. Conserva E2_MOEDA y E2_TIPO separados. No permite pagos ni cambios en los títulos.

Nuevo recurso `GET /api/erp/recepcionesCompras?sucursal=0101&proveedor=000039&tienda=01`: requiere **read:compras, read:proveedores y read:catalogo**. No devuelve precios ni valores monetarios protegidos. Usa SD1 en la filial explícita y omite borrados; las condiciones fijas y parametrizadas **D1_ESPECIE=NF y D1_TIPO=N** no pueden ser reemplazadas por parámetros del cliente. Filtros: proveedor, tienda, producto, documento y referencia de pedido; fechas por D1_EMISSAO. No expone el SD1 mixto de otros tipos ni infiere un remito RFP no verificado. La especie/tipo y los campos se comprobaron en el esquema y datos reales locales.

Las pruebas usan dobles para identidad/tienda, permisos por sección, aislamiento de cuentas, contexto, comparación, errores, precisión y paginación. Las pruebas de SQL verifican condiciones obligatorias, valores parametrizados y exclusión de registros indebidos. Las comprobaciones reales son lecturas: no crean documentos, no registran recepciones físicas ni ejecutan pagos, compensaciones o actualizaciones.

# Recorrido integral de producto

Desde el chat o el dictado: «Analizá el producto Z1304003» o «Ficha integral del producto Z1199664». Resuelve código o coincidencias de catálogo en SB1; si hay varios candidatos pide elegir antes de consultar importes. No agrega ceros ni transforma códigos en productos Z.

La ficha reúne:

- Precios de venta DA1 y cabeceras DA0, con moneda, vigencia y precio por millar para terminados Z en UN, conservando el precio unitario. Distingue precio de lista de precio facturado.
- Clientes por `SA1.A1_TABELA` → listas DA1 del producto. No deduce exclusividad ni compras por el nombre de la lista.
- Ventas facturadas del mes actual, o mes/año solicitado, con resumen SQL completo, monedas separadas y dashboard existente. NF/ND y NC conservan su signo y alcance neto de ítems.
- Hasta cinco ítems de comprobantes recientes NF/NC/ND sin recorte de fechas, con precio unitario y por millar cuando la unidad es UN. Son una muestra, no un total ni precio de lista vigente.
- Costo medio SB2 y existencias por depósito. Moneda de valuación 1 se identifica como tal; no se convierte a dólares ni se infiere rentabilidad, costo histórico o costo de fabricación.
- Pedidos de venta y compra con saldo técnico actual, sin filtro de fecha que excluya pedidos antiguos. Se recorren hasta diez páginas de 100 filas por recurso; se declara alcance parcial cuando corresponde. No prueba entrega física ni deuda.

Seguir con «sus ventas», «y los costos», «mostrame sus clientes», «sus precios», «mostrame sus pedidos pendientes», «sus pedidos de compra» o «sus comprobantes». Después de ventas, «y el mes pasado» vuelve a consultar ambos períodos para comparar el mismo producto. No reconstruye costos históricos desde SB2 actual. Las secciones independientes se consultan en paralelo sin esperar inferencia del modelo.

El contexto conserva sólo identidad del producto, sucursal y período por conversación autenticada. Cada turno relee SB1 y los datos pedidos; importes guardados en conversaciones anteriores no sustituyen al ERP actual. Cambiar de sucursal descarta la referencia y un nuevo producto explícito reemplaza la anterior. Las consultas con filtros adicionales no soportados se aclaran o continúan por los flujos existentes; no se eliminan silenciosamente. Los cambios de negocio mantienen sus propuestas y confirmaciones existentes: la ficha sólo lee.

Se reutilizan recursos protegidos y sus permisos existentes: `productos` (catálogo), `preciosClientes` y `listasPreciosClientes` (precios de venta), `clientes` (clientes), `costos` (costos y catálogo), `resumenVentas`, `comprobantesVentas` y `pedidosVentaPendientes` (ventas, clientes, precios de venta y catálogo), `pedidosCompraPendientes` (compras, proveedores, precios de compra y catálogo). El nuevo filtro `clientes?lista=` usa comparación parametrizada contra A1_TABELA y la filial resuelta por el catálogo. No se agrega un endpoint de acceso global ni un permiso que permita omitir esas comprobaciones.

Una sección denegada dice «Esto no podés leerlo» y no adjunta sus datos. Una sección fallida queda no disponible, nunca se presenta como cero; las demás secciones autorizadas pueden completarse. Un cambio de revisión de acceso invalida la operación. El catálogo también exige autorización y no revela identidades a quien no puede leerlo.

Las pruebas usan dobles para permisos, aislamiento de usuario/sucursal, contexto, relectura, errores, paginación y cálculos. Las comprobaciones reales sólo consultan el ERP: no crean documentos ni actualizan datos de negocio.

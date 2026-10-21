# Recorrido integral por cliente

Texto o dictado: «Analizá el cliente MILORDI», «Ficha integral del cliente 001199 tienda 01». Resuelve código o nombre en SA1; si hay varios clientes o tiendas pide elegir y relee la combinación elegida antes de consultar importes. Conserva código, tienda, sucursal y período por conversación autenticada, sin usar precios o saldos memorizados como datos actuales.

## Contenido

- Lista asignada por A1_TABELA, cabecera DA0, precios DA1 y productos SB1 referenciados de forma inequívoca. Convierte precio unitario a millar sólo para terminados Z en UN. Conserva alternativas y tramos; informa vigencias/estados incompletos o inactivos sin presentarlos como precio actual.
- Ventas facturadas del mes actual o mes/año solicitado, con agregado SQL completo y dashboard, manteniendo moneda y unidad separadas. Comparar vuelve a leer ambos períodos para el mismo cliente y tienda.
- Pedidos con saldo técnico actual, sin recorte por fecha de emisión. Se muestran por moneda y unidad; el importe es saldo de cantidad por precio, no deuda financiera.
- Hasta cinco ítems recientes de remitos emitidos (incluidos los ya facturados) y remitos con saldo pendiente de facturar. No acredita recepción física. Pedidos y remitos no se suman entre sí.
- Títulos financieros SE1 con E1_SALDO distinto de cero, separados por E1_MOEDA y E1_TIPO, con vencimiento y cuota. No se netean créditos/anticipos como deuda, ni se reconstruye deuda histórica o se calculan intereses/compensaciones. El detalle guarda el saldo original leído.

Seguimientos: «sus precios», «sus ventas», «y el mes pasado», «sus pedidos», «sus remitos», «sus remitos emitidos», «sus remitos pendientes», «sus saldos» y «sus comprobantes». Las consultas históricas de ventas no convierten saldos actuales en saldos históricos. Cambiar explícitamente a otro cliente, producto, proveedor o sucursal descarta la referencia anterior cuando corresponde. No se ignoran filtros de tienda, moneda, vencimiento o fechas no soportados: se pide una consulta específica.

Las lecturas independientes se ejecutan en paralelo, sin modelo para este recorrido. Cada recurso paginado recorre hasta diez páginas de cien filas; se informa si el resultado es parcial y las sumas de filas parciales nunca se presentan como totales globales. Las respuestas breves muestran una muestra de precios/documentos; el resto del alcance leído está en las fuentes. El agregado de ventas lo calcula SQL, sin sumar páginas.

## Permisos y alcance financiero

La identidad de cliente exige `read:clientes`. Precios usa los permisos existentes de DA1/DA0/SB1; ventas, pedidos y remitos conservan todos los dominios de sus recursos comerciales. Cada sección se vuelve a autorizar; una sección denegada responde «Esto no podés leerlo» sin adjuntar sus filas, mientras las demás secciones autorizadas pueden completarse. Cambios de permisos durante una consulta invalidan la respuesta final.

Nuevo recurso consultivo: `GET /api/erp/saldosClientes?sucursal=0101&cliente=001199&tienda=01`. Exige **read:finanzasClientes y read:clientes**. El administrador ya tiene acceso por su rol; los roles existentes no reciben automáticamente el nuevo permiso financiero. Se asigna desde Usuarios y roles. No habilita escrituras ni acceso a otras sucursales.

SE1 se verificó localmente en `dbo.SE1010`, sucursal física `0101`, con diccionario SX2 exclusivo y campos de cliente/tienda, prefijo/número/cuota/tipo, emisión/vencimientos, moneda, valor original y saldo. El recurso exige saldo numérico, usa valores parametrizados, omite borrados y filtra saldo distinto de cero. Los valores float se transportan como texto con conversión de 17 dígitos, sin pasar por Number ni mezclar monedas. El filtro de fechas se refiere a E1_VENCTO; la ficha no lo usa para eliminar títulos antiguos abiertos.

La documentación de [compensación FINA330](https://tdn.totvs.com/pages/viewpage.action?pageId=505768648) y [compensación entre carteras](https://tdn.totvs.com/pages/viewpage.action?pageId=516194467) distingue monedas y títulos de crédito/anticipos. Esta implementación muestra los saldos almacenados separados por tipo: no pretende reproducir esas rutinas ni un estado de cuenta neto oficial de Protheus Argentina.

Las pruebas automatizadas usan dobles. Las comprobaciones reales sólo consultan: no se ejecutan altas, pagos, compensaciones, actualizaciones ni cambios de permisos productivos para probar la ficha.

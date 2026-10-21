# Informes terminados de consulta

Los dashboards comerciales permiten descargar un HTML imprimible o un archivo Excel con una lectura nueva del servidor. Los recursos admitidos son `resumenVentas`, `resumenCompras`, `resumenRemitosPendientes`, `resumenPedidosVenta` y `resumenPedidosCompra`; corresponden al catálogo comercial existente. No se acepta SQL, filas enviadas por el navegador, recursos arbitrarios ni formatos distintos.

El endpoint personal `POST /api/reports/export` recibe `{resource,filters,format}`. Los filtros son los ya soportados por el informe, incluyendo sucursal y período. La función `exportFinishedReport(input,{read,authorizeRead,clock})` devuelve un buffer, tipo de contenido y nombre seguro de archivo. La lectura y la entrega revalidan recurso y sucursal con permisos actuales; Excel vuelve a comprobarlos tras terminar de generar el archivo. No hay Store, trabajo persistido ni consulta adicional del modelo.

El informe identifica sucursal, período, criterio de fecha, agrupación, filtros, instante de lectura, cobertura y limitaciones. Se conserva cada moneda y unidad en una sección HTML y hoja Excel separada. Los totales son los del resumen estructurado original; no se recalculan sumando filas de total y detalle. No existe un total general de monedas ni de unidades. Los documentos distintos por grupo no se suman entre grupos, porque un documento puede aparecer en varias dimensiones. UN permanece en unidades; la equivalencia con millares se aclara sin convertir otras unidades.

Una respuesta parcial, sin total por grupo o con valores ausentes se señala expresamente. Una respuesta de otra sucursal/recurso, totales duplicados o falta de moneda/unidad verificable se rechaza. No se identifica un resumen de saldo técnico como deuda, facturación ni recepción física. Se mantienen las limitaciones del conector, incluyendo precisión y tratamiento de impuestos/fletes.

El HTML escapa todo texto de la fuente y no contiene scripts, recursos externos ni formularios. El Excel conserva valores decimales como texto para evitar pérdida de precisión; los textos con `=` son celdas literales, nunca fórmulas. Los archivos contienen datos del alcance autorizado al momento de exportar: compartirlos posteriormente queda bajo control del usuario.

El módulo `public/report-download-ui.js` expone `addReportDownload(card,result,{request,notice})`. Agrega dos botones a una tarjeta de dashboard. `request` sigue el contrato de `fetch` y devuelve `Response`; debe conservar la sesión personal y el control de origen de la aplicación. La petición incluye sólo el recurso y filtros del dashboard, y el servidor relee las fuentes. No agrega filtros ni modifica el dashboard.

Las pruebas verifican escape HTML, literales Excel, separación de moneda/unidad, ausencia de sumas inventadas, fechas y cobertura, rechazo de filas cliente y recursos desconocidos, permiso antes de consultar y revocación antes de entregar ambos formatos.

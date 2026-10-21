# Aprendizaje local del vocabulario

Central interpreta giros argentinos como «che», «porfa», «tirame un pantallazo de ventas», «pasame los números de compras» o «cómo venimos de ventas». El procesamiento es local y no añade una llamada al modelo.

Cuando un pantallazo, paneo o tablero se resuelve con un dashboard verificado, guarda esa equivalencia para ese usuario y sucursal. Lo avisa debajo de la respuesta y cuenta las reutilizaciones que terminan en consultas verificadas. Una lectura denegada o fallida no acredita aprendizaje. Esta versión no deduce vocabulario desconocido de sus propias respuestas: necesita una aclaración del usuario para evitar reforzar una interpretación equivocada.

También admite definiciones y correcciones naturales:

- «Cuando digo radiografía, me refiero a un dashboard».
- «Acá le decimos radiografía a un informe».
- «No, por radiografía me refiero a un resumen».
- «¿Qué aprendiste?» o el botón **Mis expresiones**.
- «Olvidá radiografía».

Las equivalencias persistentes admiten dashboard, resumen, informe, reporte, precio de venta y nombres de dominios: producto, cliente, proveedor, solicitud de compra, pedido de compra/venta, lista de precios, ventas, compras, producción y calidad. Se aplican a la parte inicial de una consulta, sin sustituir nombres de productos dentro de filtros. Una corrección reemplaza la anterior; se pueden borrar por chat. En instrucciones de creación, actualización o confirmación se aportan al modelo como vocabulario tipado: no sustituyen el texto, ni representan una orden de ejecutar. Se mantienen las validaciones y resúmenes habituales.

El registro principal es `language_aliases` en la SQLite local existente. Al lado de esa base se crea la carpeta `aprendizaje/` (por defecto `data/aprendizaje/`), con copias JSON de las expresiones y sus usos. Los nombres de archivo son hashes de usuario y sucursal; no son una ruta pública. No se guardan credenciales, documentos ni importes ERP en esas copias. No se versiona la carpeta. SQLite prevalece: editar una copia JSON no cambia lo aprendido. Si falla una copia, la corrección permanece en SQLite.

El aprendizaje está aislado por actor y sucursal, persiste entre conversaciones y no concede acceso a datos. Cada consulta pasa por los permisos actuales y las herramientas ERP habituales. No aprende instrucciones de adjuntos, nombres de productos ni respuestas del modelo. Los importes, monedas, cantidades, estados y aprobaciones no se convierten en reglas aprendidas. «Lucas», «palos» y «verdes» no acreditan una moneda ni una base de precio para una operación.

Esto adapta el vocabulario y las rutas de consulta; no reentrena los pesos del modelo. No requiere un servicio externo ni instala software adicional. La activación requiere reiniciar el servicio Node que carga los módulos del servidor.

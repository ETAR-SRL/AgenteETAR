# Descartes y correcciones de referencias comerciales

El chat por texto y voz conserva las referencias descartadas de productos, clientes, pedidos y listas, además de proveedores. «El anterior», «ese producto» y «la misma lista» no rehabilitan un dato pendiente. Una selección afirmativa vuelve a consultarse en el ERP. Si falla la fuente, no hay coincidencias o hay varias, la referencia sigue pendiente; no se sustituye por otra ni por una respuesta anterior del asistente.

Ejemplos:

- «No es el producto Z-UNO, es Z-DOS».
- «El cliente correcto es C-DOS, tienda 02».
- «No es el pedido de venta 123, es el pedido de compra 124, ítem 02».
- «No era la lista 001, era 002».
- «En realidad es el producto Z-DOS».

Los códigos de estos ejemplos son sintéticos. Los nombres y códigos concretos se validan; no se agregan ceros de producto ni se inventan vínculos. La numeración de pedido/ítem conserva el relleno verificado en SX3. Un cambio de referencia no modifica una cabecera ni crea ítems: las operaciones habilitadas siguen siendo las existentes.

| Corrección | Comprobación actual | Datos derivados que se invalidan |
|---|---|---|
| Producto | SB1, identidad y unidad | Selecciones de ítem, candidatos y precio recuperado de lista; las bases explícitas se revisan contra la nueva UM |
| Cliente | SA1, código y tienda; A1_TABELA al consultar precios | Tienda anterior, lista asignada y selecciones dependientes |
| Pedido | Tipo venta/compra, número e ítem SC6/SC7 | RECNO seleccionado, candidatos e ítem anterior |
| Lista | Cabecera y detalle DA0/DA1 o lista AIB del proveedor/tienda | Selecciones y precio de la lista anterior |

Los importes, monedas, cantidades y bases escritos expresamente se conservan como entradas pendientes, no como datos ERP actuales. Si cambia la UM a una incompatible con millares, se pide aclarar la base antes de proponer. Si el cliente/proveedor corregido no coincide con el del pedido leído, se pide el pedido correcto y no se prepara un cambio para el tercero anterior.

## Contexto, permisos y confirmación

La barrera usa mensajes del usuario de toda la conversación y sucursal autorizadas, antes de seleccionar el historial del modelo. No toma respuestas del asistente como selección o verificación. Las referencias cuya consulta falló se conservan separadas por sucursal, con su tipo de pedido/lista y las identidades necesarias para volver a consultar; no guardan importes actuales ni decisiones de autorización.

Las consultas explícitas de otro producto o tercero se permiten durante un pendiente y no reemplazan el borrador. `pausedPurchase` y `pausedBusiness` conservan sus entradas; una corrección pertinente puede retomar el mismo circuito. Los informes y remitos que dependían de un filtro descartado se invalidan completos para evitar una consulta involuntariamente más amplia.

Antes de inferir o consultar se comprueban los permisos existentes de las fuentes involucradas. La preparación conserva su permiso propio, el resumen y la confirmación explícita; el escritor sigue releyendo identidad, valores y huella al ejecutar. No se ampliaron operaciones de escritura, permisos ni SQL generable por IA.

Qwen conserva su modelo y pesos. Cuando falta una referencia, sólo puede generar `responder`, argumentos vacíos y una pregunta admitida por el esquema. Se valida la salida sin repararla. Esto mejora el asistente con interpretación y generación restringida; no acredita comprensión sin esos controles. Las citas, hipótesis y órdenes de conservar una referencia no se aplican como descartes. Las frases ambiguas se aclaran.

## Pruebas del 22/10/2026

- Ocho casos sintéticos congelados, cortos y con 90 mensajes distractores: **8/8**, con Qwen real, argumentos vacíos y salida cruda sin posprocesamiento. Informe privado `data/evaluation/qwen-references-v6-first.json`.
- Chat HTTP completo con ERP y Qwen reales: **4/4 casos principales**, producto, cliente, pedido de venta y lista DA1. Cada conversación llegó a **98–100 mensajes** antes de la corrección final, con 46 desvíos verificados por caso. El producto conservó el borrador de compra en USD, cantidad y precio por millar. **206 lecturas y ocho inferencias**, cero propuestas prematuras o ejecuciones. Informe de entrega `reports/live-references-v6-release-2026-10-22.json`; las ejecuciones anteriores se conservan por separado.
- Las referencias de lista se descubrieron mediante SA1.A1_TABELA → DA0/DA1; los productos mediante DA1 y relecturas SB1 exactas, con muestras y número de consultas acotados. No acredita cobertura global del catálogo.
- La muestra de SC7 no aportó registros. El subcaso real sigue explícitamente pendiente; las pruebas HTTP controladas cubren pedidos de compra sin crear documentos en Protheus. AIB, cambios venta→compra, UM incompatible, terceros distintos del pedido, fuente incorrecta/fallida, aislamiento y recuperación de borradores tienen pruebas controladas separadas.
- Se verificaron denegación antes del conector, aislamiento entre usuarios y revocación. Las bases de los evaluadores son SQLite aisladas; nunca se abren como `Store` las bases operativas ni se llaman endpoints de confirmación.
- Suite completa final: **752/752**, 86,193 segundos (`data/references-v6-final-verified-tests.log`). Incluye fuente no disponible, candidatos no encontrados, tienda/tipo de documento incorrectos, precios contextuales tras un descarte y conservación de valores ante caída de la IA. La regresión real de proveedores también pasó (`reports/live-supplier-v6-regression-2026-10-22.json`), al igual que los cuatro recorridos anteriores y la consulta contextual del precio (`reports/live-chat-v6-regression-2026-10-22.json`).

Comprobaciones reproducibles:

```powershell
node scripts/qwen-reference-evaluate.js --live --report data/evaluation/qwen-referencias.json
node --env-file=.env scripts/evaluate-reference-chat-live.js --live --report reports/referencias-chat.json
node --test --test-concurrency=2 test/*.test.js
```

Los informes y salidas crudas permanecen en carpetas locales excluidas de Git; los informes HTTP sólo contienen comprobaciones y conteos. Las latencias son muestras de este equipo y su carga, no una promesa de rendimiento. No se modificaron documentos comerciales para las pruebas.

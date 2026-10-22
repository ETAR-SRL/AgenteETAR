# Proveedor descartado o desconocido en Qwen

## Comportamiento

El proveedor descartado sigue pendiente aunque se pida «usá el de antes». La corrección elimina proveedor, tienda, lista y precio recuperado de esa lista; conserva producto, cantidades, bases, moneda y precio informado explícitamente. Un reemplazo afirmativo se vuelve a verificar en SA2 sin heredar la tienda anterior. Las solicitudes SC1 conservan el proveedor opcional.

La guardia de compra considera todos los mensajes del usuario de la conversación y sucursal autorizadas, antes de seleccionar el historial que entra en el modelo. Las respuestas anteriores del asistente no eligen proveedores. Una pregunta sobre un proveedor, un ejemplo citado o «no cambies el proveedor» tampoco equivalen a descartarlo o seleccionarlo. Consultas de informes, proyectos, ventas y solicitudes siguen sus recorridos habituales.

## Contrato del modelo y permisos

Se conserva `qwen3:4b`, sin claves externas, cambios de pesos ni activación de razonamiento extendido. Cuando el proveedor queda pendiente y se intenta preparar o retomar la compra, el contrato de generación admite únicamente `responder`, argumentos vacíos y tres preguntas seguras sobre el proveedor. Qwen devuelve ese JSON; no se repara una salida fallida ni se reemplaza después por una respuesta aprobada. La salida debe satisfacer tanto el contrato estrecho como el original. Esto es generación restringida por estado conversacional; no demuestra que Qwen resuelva las negaciones sin esa ayuda.

El servidor verifica permisos de preparación de compra y lectura de proveedores antes de inferir. Una aclaración válida termina en la primera respuesta y no inicia otro ciclo de herramientas. Los recorridos directos mantienen pendiente la referencia anafórica sin buscar un proveedor llamado «antes». La selección concreta sigue necesitando lectura ERP, resumen y confirmación. No se agregaron operaciones de escritura ni se cambió el ejecutor.

## Verificación reproducible

Las salidas crudas sintéticas se guardan en `data/evaluation/` y los informes HTTP sin filas comerciales en `reports/`, ambos excluidos de Git. Se conservan intentos fallidos e informes pendientes. El evaluador HTTP usa los permisos/rutas reales de la aplicación, una SQLite aislada y un conector ERP forzado a lectura; no abre la base local de producción ni ejecuta confirmaciones.

Comandos:

```powershell
node scripts/qwen-quality-evaluate.js supplier-negations data/evaluation/qwen-supplier-v5-frozen-final.json
node scripts/qwen-quality-evaluate.js original data/evaluation/qwen-supplier-v5-original-final.json
node scripts/qwen-quality-evaluate.js variants data/evaluation/qwen-supplier-v5-variants-final.json
node scripts/qwen-quality-evaluate.js long data/evaluation/qwen-supplier-v5-long-regression-final.json
node --env-file=.env scripts/evaluate-supplier-chat-live.js --live --report reports/live-supplier-chat.json
node --test --test-concurrency=2 test/*.test.js
```

La rúbrica estricta de proveedor exige una pregunta concreta, argumentos vacíos, contrato estrecho enviado antes de generar y salida cruda idéntica a la validada. La rúbrica histórica v1 se conserva sin modificaciones: puede rechazar una pregunta válida «¿Con qué proveedor…?» porque su expresión regular sólo reconoce otras formulaciones. Los resultados de ambas rúbricas se distinguen; no se cuentan como equivalentes ni se oculta ese rechazo.

## Resultado del 22/10/2026

- Proveedor, rúbrica estricta v2: **8/8**, incluyendo ambos descartes largos, historial recuperado y proveedor desconocido después de 45 intercambios distractores. Salidas originales en `data/evaluation/qwen-supplier-v5-frozen-final.json`.
- Cuatro casos originales, rúbrica v1: **4/4** (`qwen-supplier-v5-original-final.json`). Cuatro regresiones sintéticas largas: **4/4** (`qwen-supplier-v5-long-regression-final.json`).
- Ocho variantes históricas, rúbrica v1: **7/8** (`qwen-supplier-v5-variants-final.json`). El rechazo es la pregunta válida «¿Con qué proveedor…?»; esa misma variante pasa el contrato estricto v2. No hubo argumentos inventados ni acción de propuesta en esa respuesta. El primer intento de v2 se conserva como `qwen-supplier-v5-frozen.json`: detectó un pendiente borrado por «proveedor nuevo» y la limitación de la expresión regular v1; ambos se distinguen del resultado posterior.
- Chat HTTP con ERP y Qwen reales: conversación de **52 turnos / 104 mensajes antes de retomar**, seguida de recuperación del borrador y dos reemplazos afirmativos verificados. **46 consultas distractoras verificadas**, **60 lecturas ERP**, dos inferencias locales, cero propuestas prematuras, confirmaciones o ejecuciones. Se comprobaron aislamiento, denegación y revocación antes del conector. Informe `reports/live-supplier-v5-complete-2026-10-22.json`; repetición final en `reports/live-supplier-v5-final-2026-10-22.json`.
- Regresión HTTP real de los cuatro recorridos y consulta contextual del precio: **4/4 + prueba contextual**, dos inferencias, 17 lecturas, cero ejecuciones (`reports/live-chat-supplier-v5-regression-2026-10-22.json`).
- Suite completa: **711/711**, 78,708 segundos (`data/supplier-v5-release-verified-tests.log`). Incluye variantes anafóricas en compras/listas, proveedor opcional SC1, límites de entrada/salida, permisos, confirmación, huellas y transacciones controladas. Las respuestas de los dobles de transporte se ajustaron al nuevo contrato; esas pruebas no se presentan como inferencia real.

La primera búsqueda real de producto terminado no lo encontró en los primeros 500 productos. Se conserva el informe pendiente `reports/live-supplier-v5-2026-10-22.json`; el evaluador ahora toma hasta 100 referencias DA1 y verifica como máximo diez códigos Z exactos en SB1. Esto no prueba cobertura global del catálogo.

Las muestras y latencias son comprobaciones puntuales en este equipo, sin garantía de cobertura de todas las expresiones ni de rendimiento habitual. Un proveedor no disponible o ambiguo sigue requiriendo aclaración; no se inventa ni se resuelve con memoria histórica.

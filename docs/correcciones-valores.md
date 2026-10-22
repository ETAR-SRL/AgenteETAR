# Correcciones de valores comerciales

Central separa cinco datos: precio, cantidad, moneda, base del precio y base de la cantidad. Son entradas del usuario, no datos actuales acreditados del ERP. El intérprete literal comparte las reglas entre solicitudes, pedidos y listas; no habilita operaciones nuevas.

## Comportamiento

- «No son 80, son 90 dólares por millar» reemplaza el precio y conserva los demás datos.
- «No son 3 millares, son 2500 unidades» reemplaza cantidad y su base, sin cambiar la base del precio.
- «Pesos no, dólares» corrige la moneda solicitada. En un documento existente debe coincidir con la moneda verificada: no modifica cabeceras ni convierte importes.
- «Por unidad no, por millar» cambia sólo la base del precio. «Cantidad en unidades, precio por millar» mantiene ambas bases separadas. Los números no se multiplican durante la interpretación; la conversión pertenece al circuito existente y se muestra en el resumen.
- «Ese precio no» descarta el dato y lo deja pendiente. «Usá el anterior» o «confirmá» no recuperan un valor rechazado. Una corrección literal lo resuelve.
- «No cambies la cantidad» conserva la cantidad. Los ejemplos, citas y situaciones hipotéticas no aportan nuevos valores a una operación.
- «Sin precio» permite omitir el precio opcional de una solicitud nueva SC1. Un pedido exige un precio o una lista seleccionada explícitamente y verificada.

Los descartes pendientes se guardan con el borrador, dentro de su conversación, usuario y sucursal. Sobreviven a desvíos de tema y a la selección acotada de mensajes para el modelo. No son una preferencia entre conversaciones ni una fuente de precios históricos. Una referencia y un importe pueden descartarse en el mismo mensaje sin restaurarse mutuamente.

## Modelo y autorización

Las correcciones claras usan extracción estructurada sin una llamada adicional a Qwen. Para aclaraciones de valores descartados, el modelo recibe un contrato JSON reducido antes de generar: respuesta de aclaración, argumentos vacíos y pregunta por los datos pendientes. Su salida se valida contra ese contrato y el original, sin reparar ni sustituir su respuesta después. No representa entrenamiento de pesos ni una evaluación de Qwen sin restricciones.

El control de permisos precede a la aclaración y las consultas. Los valores negados se eliminan antes de invocar el modelo, para que una caída de la IA no los restaure. Los errores de conexión conservan el borrador. Las correcciones de moneda incompatibles conservan los otros datos para permitir corregirla después.

No hay ejecución desde estas rutas. Los recorridos existentes releen SB1, precios e identidades de los documentos; preparan el resumen con las precondiciones actuales. La confirmación explícita y la revalidación transaccional del ejecutor se conservan. No se modifican permisos, monedas de cabecera ni documentos históricos.

## Verificación

Las pruebas controladas cubren extracción, descartes incompletos, bases independientes, referencias mixtas, borradores pausados, fallo del modelo, propuestas SC1/SC6/SC7/DA1/AIB y recuperación tras una moneda incompatible. Los dobles verifican precio y cantidad actuales, identidad y resumen de confirmación; no ejecutan operaciones comerciales.

El evaluador `scripts/evaluate-value-chat-live.js --live` usa el chat HTTP completo, ERP de sólo lectura, Qwen local y SQLite aislado. Descubre un producto real por DA1 y lo verifica exactamente en SB1, mantiene tres conversaciones con 46 consultas intermedias cada una, vuelve a los descartes y aplica reemplazos literales. Comprueba aislamiento, revocación y ausencia de propuestas prematuras. No envía confirmaciones ni conserva filas comerciales en el informe.

`scripts/qwen-value-evaluate.js --live` ejecuta diez casos sintéticos congelados: los cinco campos en conversaciones cortas y con 90 mensajes intermedios. Guarda salidas crudas, esquema enviado, uso y resultados sólo en `data/evaluation`, ignorado por Git. `--validate-fixtures` valida las pruebas sin inferencia y no constituye una prueba del modelo.

Las muestras reales de SC1/SC7 y las escrituras no quedan verificadas por usar un producto real: sus circuitos se prueban con dobles y no se alteran documentos del ERP para fabricar casos.

Resultados del 22/10/2026:

- Qwen local: 10/10 casos restringidos, cortos y largos; salidas crudas sin modificación en `data/evaluation/qwen-values-v7-release.json`. No utiliza claves externas.
- Chat HTTP con ERP real: 3/3 recorridos, 51 turnos de usuario y 102 mensajes cada uno; 147 lecturas, 9 inferencias, 0 ejecuciones y 0 confirmaciones enviadas. Aislamiento y revocación verificados. Informe privado `reports/live-values-v7-2026-10-22.json`.
- Propuestas SC1/SC6/SC7/DA1/AIB: pruebas controladas de valores corregidos, precondiciones actuales y resumen para confirmar. No son escrituras verificadas en producción.
- La suite completa anterior pasó 792/792. La comprobación final de 793 pruebas aprobó 792 y agotó los 120 segundos de la extracción física de PDF/foto al correr simultáneamente con inferencia. La extracción aislada pasó después 1/1 en 63,4 segundos, sin cambiar su plazo ni debilitar la prueba: las 793 comprobaciones quedaron verificadas. Se conservan ambos registros en `data/value-v7-release-tests.log` y `data/value-v7-ocr-isolated-tests.log`. Las 25 pruebas de valores/chat completas también pasaron tras el último ajuste del alcance de negaciones.

# Medición comparativa del circuito conversacional

`node scripts/benchmark-operative.js --baseline 1f1d913 --loops 40 --warmup 5` ejecuta el mismo arnés contra el código anterior y el árbol de trabajo actual. La referencia es configurable; el script extrae ese commit dentro de una carpeta UUID ignorada de `data/bench` y deja allí `benchmark.json`, con muestras individuales y percentiles.

Los cuatro casos reutilizan las formas de datos y diálogos de las pruebas existentes: precio de Z100, resumen de ventas del mes seguido de «¿Y el mes pasado?», inicio de solicitud con producto exacto 1 y consulta de precio frente a fuente conocida caída. Cada muestra usa SQLite en memoria y diálogos nuevos. No carga `.env`, no abre la base operativa y no tiene adaptadores de red. Las respuestas del modelo son controladas y se cuentan; no hay inferencia real. Los casos no ejecutan propuestas ni escrituras comerciales.

Se informa p50 y p95 del diálogo completo después del calentamiento, junto con llamadas al modelo, lecturas simuladas, preparaciones y forma de evidencia de cada respuesta. El tiempo empieza después de crear la instancia y el fixture: mide routing, procesamiento y persistencia del diálogo, no arranque, importaciones, ERP, conexión, audio ni calidad del modelo. Un resumen seguido de otra pregunta tiene dos turnos; no debe compararse su duración con el precio de un solo turno.

Los indicadores de respuesta permiten detectar diferencias funcionales: si la revisión anterior recurrió al modelo de control o no devolvió una comparación, no representa la misma cobertura funcional aunque el texto del usuario sea idéntico. Los resultados describen el caso medido; no justifican prometer mejoras de latencia de producción. La revisión anterior se ejecuta primero y hay ruido del host: repetir la medición antes de sacar conclusiones causales, especialmente con duraciones menores a un milisegundo. Una diferencia positiva significa que la versión actual tardó más en esa muestra.

No se compara la investigación en cola con la investigación sincrónica dentro de una misma cifra: miden respuesta de encolado y trabajo completo, respectivamente. El aislamiento, reinicio, cancelación y completitud de esas investigaciones se comprueban con las pruebas específicas de la cola.

## Medición del 21/10/2026

Referencia `1f1d913`, 40 muestras y 5 de calentamiento por caso y versión. Evidencia local: `data/bench/63cac65d-2b0e-4fe9-8ed6-a518709f125c/benchmark.json`. El arnés comprobó que el precio produjo evidencia, la solicitud identificó el producto exacto, la segunda pregunta comparó períodos y la caída quedó explícita.

| Caso | p50 anterior / actual (ms) | p95 anterior / actual (ms) | Llamadas al modelo anterior / actual |
|---|---:|---:|---:|
| Precio Z100 | 0,530 / 0,496 | 1,014 / 0,988 | 0 / 0 |
| Mes y mes pasado, dos turnos | 0,557 / 0,568 | 0,811 / 1,135 | 0 / 0 |
| Inicio solicitud producto 1 | 0,227 / 0,277 | 0,309 / 0,831 | 0 / 0 |
| Fuente conocida caída | 0,322 / 0,457 | 0,378 / 0,841 | 0 / 0 |

No se observó una mejora general de latencia: la mediana bajó en precio y subió en los otros tres casos. Ambas versiones ya evitaron el modelo en todos los diálogos medidos. Estas diferencias pequeñas y sensibles al host no prueban cambios de latencia ERP ni de experiencia real.

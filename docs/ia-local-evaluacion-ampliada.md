# IA local, conversaciones largas y validación ampliada — 22/10/2026

Se mantiene `qwen3:4b` instalado, sin claves externas, descargas ni entrenamiento de pesos. El adaptador conserva `think:false`, temperatura cero, contexto 8192 y los límites de tiempo/salida. Se mejoró el contrato de decisión y la recuperación de referencias; nunca se corrige una salida del modelo para hacerla aprobar.

## Contrato y memoria

La guía distingue cada campo de precio/cantidad y sus bases, exige pedir importe/moneda/base ante alternativas y proveedor cuando falta. Se quitaron ejemplos numéricos que el modelo podía copiar como datos. Un rechazo o aclaración debe usar `responder` y argumentos vacíos. Esto no sustituye autorización, validación ERP ni confirmación.

Todo el historial sigue guardado por usuario y sucursal. La selección para el motor local tiene 6000 caracteres de contenido histórico; para proveedores externos conserva 12000. No son los últimos diez mensajes: se ponderan referencias poco frecuentes, se recupera el comienzo cuando se solicita y se incluyen correcciones inmediatas aunque digan solamente «ese código no». Una consulta explícita al comienzo prioriza ese tema y sus correcciones, en lugar de incorporar productos recientes ajenos. La recuperación es local, sin una inferencia adicional.

Si se pide el primer producto, sólo una identidad SB1 única previamente verificada puede generar una referencia explícita para buscar. No se usa si hay candidatos ambiguos, otra sucursal o una corrección/negación detectada; nunca acredita valores actuales. Para esa pregunta de precio sin alcance adicional, el contrato ofrece únicamente consulta de precio por producto y aclaración: no permite completar cliente/lista no elegidos. Las consultas con cliente, lista, tienda u otro alcance conservan su contrato. El catálogo de precios omite metadatos ajenos al tema; las preguntas combinadas conservan el catálogo completo y sus filtros. Las preguntas naturales de lectura no necesitan decir «no cambies nada»; las instrucciones de preparar, actualizar o confirmar conservan su circuito.

Los ejecutores, permisos, revisiones de rol, propuestas, huellas y confirmaciones permanecen en servidor. No hay SQL generado libremente ni escritura automática nueva.

## Qwen aislado: resultados y fallos conservados

| Evaluación con contrato final | Resultado | Alcance |
|---|---:|---|
| Cuatro casos originales | **4/4** | Arnés original y rúbrica sin modificar; antes 3/4 |
| Ocho variantes argentinas congeladas antes de medir | **7/8** | Decimales, bases invertidas, jerga, proveedor y elusión |
| Cuatro transcripciones largas | **4/4** | Entre 90 y 94 mensajes previos; referencia, reemplazo, ambigüedad y permisos |
| Negación larga adicional | **0/1 estricto** | La rúbrica anterior daba un falso aprobado; la revisión semántica lo rechaza |
| Negación con recuperación, presupuesto 12000 | **0/1** | La negación estaba presente; aun así inventó valores |
| Controles de respetar permisos/confirmación | **2/2** | No convertir una instrucción legítima en una denegación |

El fallo de la variante corta selecciona preparar aunque pregunta por proveedor e inventa argumentos inválidos. La negación larga copia una instrucción y vuelve a mencionar el proveedor descartado. **No se declara confiabilidad general de Qwen ni 8/8 final.** La aplicación sigue dependiendo de sus validaciones y confirmaciones.

Se descartaron un contrato que consiguió 8/8 pero copiaba cifras de su ejemplo, un recordatorio final y un orden alternativo de propiedades. Un diagnóstico `think:true` agotó 60 segundos en las dos negaciones y no se aplicó. Los tiempos individuales y cargas variaron; no se presentan percentiles ni rendimiento típico. El arnés original final tardó 39,707 segundos en sus cuatro casos; las variantes 114,190 y las cuatro transcripciones 146,887. Son totales de lotes, no tiempos de una respuesta.

`scripts/qwen-quality-evaluate.js` conserva mensajes sintéticos enviados, esquema, opciones, respuestas crudas y telemetría bajo `data/evaluation`. `scripts/qwen-quality-summarize.js` reúne los intentos sin borrar fallos. Informe final privado: `data/evaluation/qwen-quality-summary-2026-10-22.json`. El primer control final de disponibilidad quedó pendiente por timeout; el reintento se guarda aparte. Ninguno usa ERP, Store operativo ni APIs externas.

## Chat completo con ERP real

La regresión HTTP aprobó los cuatro recorridos completos y la consulta indirecta posterior. Releyó productos y proveedor reales, conservó borradores y verificó aislamiento/revocación. Los cuatro recorridos estructurados no llamaron al modelo; la consulta indirecta sí hizo una inferencia local. Informe: `reports/live-chat-regression-final-2026-10-22.json`.

El recorrido largo realizó **32 turnos HTTP reales**, sin insertar historial ficticio, y volvió al primer producto con Qwen mediante «Volvamos al primer producto… ¿a cuánto lo vendemos hoy por unidad y por millar?». Aprobó precio actual activo/vigente, moneda y cálculo unidad/millar, aislamiento, revocación antes del conector y cero propuestas/ejecuciones. Comprobó además que el contexto queda en ese producto y «y su precio por millar» vuelve a consultarlo correctamente. Sólo después de verificarlo se cambia el contexto; un borrador comercial anterior se pausa sin perder datos. El control final de esta muestra tardó **4,339 segundos**, con una inferencia, tres lecturas ERP y 1665/106 tokens de entrada/salida. Informe: `reports/live-chat-long-conversation-final-2026-10-22.json`.

Los intentos previos se conservan: uno agotó 60 segundos; otros eligieron otra referencia o agregaron filtros cliente/lista no solicitados. El diagnóstico permitió corregir contexto y contrato, sin suavizar la rúbrica. Un precio vacío no aprueba. El informe final guarda sólo metadatos, booleanos y conteos, sin filas ni identificadores comerciales. Otras muestras aprobadas tardaron 9,396 y 15,788 segundos, con variantes de la pregunta y condiciones distintas. Los tiempos observados no son garantías de latencia ni una comparación causal aislada; la carga y el estado del caché pueden variar.

El método, los presupuestos y comandos están en [evaluación HTTP](evaluacion-chat-completo.md). Las conversaciones y usuarios de prueba usan exclusivamente SQLite en memoria, ejecución deshabilitada y consultas comerciales de lectura.

## Protheus y pruebas de escritura separadas

La [auditoría ampliada real](auditoria-ampliada-historica-2026-10-22.md) confirma cero filas activas/borradas SC1/SC7 en las tablas y filial físicas autorizadas, todas las fechas. Amplía SD1 y verifica SD2→SC6 exacto con un remito y una factura separados. La validación comercial de SC1/SC7 en ese origen sigue sin muestra real.

En 50 SC6 UN hay 15 diferencias persistentes con MILLAR cero; en 50 SD2 UN, 12. Las demás coinciden exactamente o a precisión SX3. Son muestras parciales, no un censo. No se corrigió ningún dato ni se atribuyó causa al defecto.

Se creó una instancia SQL Server LocalDB independiente con esquema/datos sintéticos. **19 casos contra el motor SQL real** prueban ejecutores SC1/SC7, UPDATE, cantidades/totales, rollback, RECNO/números concurrentes y el flujo HTTP con resumen, confirmación exacta, permisos/revocación, huella y recibo idempotente. No se conecta al ERP operativo ni se abre su Store. Evidencia: `reports/sandbox-sql-evidence.json`; [método y límites](sandbox-sql.md).

Esto acredita los ejecutores en un motor SQL de prueba, no DBAccess, ADVPL, pantallas Protheus, personalizaciones, aprobación B ni altas USD nativas. Se ejecutaron cero escrituras comerciales en el ERP real.

## Comprobaciones automatizadas

La suite completa del árbol final aprobó **676/676 pruebas**, cero fallos, con concurrencia 2 (65,2 segundos). Incluye contexto, aislamiento, permisos, confirmaciones, huellas, idempotencia, caídas de fuentes y los circuitos existentes. El límite de entrada del modelo sigue incluyendo íntegra la guía; se ajustó el presupuesto del mock de llamada exitosa, sin ampliar límites operativos ni debilitar el test de exceso de contexto.

## Activación

El supervisor Windows existente reinició el servidor con el árbol final. El 22/10/2026 a las 14:54:35 UTC, `/health` devolvió 200, `/api/agent/status` identificó `operativo-local-4` y memoria 3, y ERP, KAIQEN e IA local estaban disponibles. Se comprobó que la clave de lectura de servicio sigue sin acceder a información personal. La evidencia privada está en `data/local-ai-v4-activation.json`; no se guardaron credenciales en el informe.

Para empezar: «Mostrame el producto…», continuar con otras consultas y después «Volvamos al primer producto: ¿a cuánto lo vendemos por unidad y por millar?»; «y su precio por millar» conserva esa referencia. Las solicitudes y propuestas de cambios siguen necesitando datos validados y la confirmación habitual.

# IA local: cuatro casos y contexto verificados

Implementación del 22/10/2026. Se conserva `qwen3:4b` local, `think:false`, temperatura cero y los presupuestos existentes. No se instalaron modelos, no se cambió proveedor y no se usan claves externas. No hay entrenamiento de pesos: se mejoró el contrato de decisión, el contexto que recibe el modelo y el manejo de datos conversacionales.

## Comportamiento

- Precio y cantidad conservan bases independientes. «2,50 por unidad, 3 millares» no convierte el precio ni guarda 3 como unidades. Una corrección del mismo documento conserva los datos anteriores; cambiar de documento no hereda su precio/base. Si se dieron precio y cantidad sin identificar una operación, pregunta qué documento es en lugar de actualizar una lista descartando la cantidad.
- Ante «3 lucas o 2 verdes», pregunta importe exacto, moneda y base; no elige una alternativa. Conserva el borrador anterior y, en un inicio ambiguo, sólo producto y cantidades inequívocas, indicando que su validación está pendiente. La aclaración siguiente verifica SB1 sin pedir de nuevo esos datos.
- Un pedido de compra en dólares sin proveedor pide el proveedor y conserva producto, importe, moneda y bases. «No me acuerdo» ya no cancela el borrador. Una referencia negada no se usa como referencia afirmativa.
- Pedir saltear permisos, confirmaciones o ejecutar SQL libre se rechaza antes del modelo, las lecturas, el aprendizaje o la preparación. No cambia permisos ni descarta un borrador legítimo. Las denegaciones ordinarias siguen respondiendo «Esto no podés leerlo» y eliminando evidencia parcial.

Las rutas estructuradas siguen consultando las fuentes y los ejecutores existentes. No se amplió ninguna escritura. Preparar no ejecuta: se conserva el resumen, la confirmación explícita y la revalidación de permisos y valores actuales. Las solicitudes siguen admitiendo precio opcional; las consultas de varias monedas no se tratan como una modificación ambigua.

## Modelo y contexto

El adaptador local agrega una guía breve a los esquemas de decisión: omitir argumentos no aportados, separar extracción de autorización, mantener bases originales y pedir datos obligatorios. Ese texto cuenta contra el presupuesto de entrada; no se trunca el contexto silenciosamente. La respuesta sigue validándose contra el esquema, sin corregirla o inventarla para aprobar una prueba.

En consultas locales de sólo lectura se omiten del esquema las altas, aprobaciones y modificaciones. El prompt conserva catálogo de recursos/filtros, instrucciones de lectura, referencias recuperadas, términos pertinentes y preferencias de presentación. Las propuestas y enseñanzas explícitas conservan sus contratos propios. Los permisos continúan verificándose en servidor, no en el prompt.

## Resultados reales y límites

| Comprobación | Resultado | Alcance |
|---|---|---|
| Modelo aislado, cuatro casos originales | 3/4, antes 0/4 | Mismo esquema y rúbrica; sin ERP. La aclaración de jerga seguía incompleta |
| Modelo aislado, cuatro variantes inéditas | 3/4 | Extracción inversa de bases, proveedor y rechazo correctos; misma limitación de aclaración |
| Cuatro recorridos HTTP completos con ERP real | 4/4 | Estado actual de borradores, aclaración inicial y posterior, proveedor verificado, permisos, aislamiento y revocación |
| Consulta indirecta con contexto, modelo y ERP reales | Aprobada | Una inferencia local, referencia conservada y precios releídos mediante DA1/SB1 |

El primer control contextual con el prompt extenso agotó 60 segundos mientras había carga de pruebas; se conserva como fallido. Con el contrato final de lectura, el mismo control respondió en 17,783 segundos: 10.922 caracteres de mensajes, 2.868 tokens de entrada y 68 de salida. El primer intento usó 22.756 caracteres. Son muestras individuales; cambió la carga del equipo y no prueban latencia típica, percentiles ni una mejora general. Los cuatro recorridos directos de la muestra real tardaron 0,329 / 0,215 / 0,255 / 0,266 segundos por recorrido, sin inferencia innecesaria. No se atribuye ese resultado al modelo solo.

La evaluación HTTP utiliza `createApp`, sus rutas y autenticación personal, con SQLite en memoria e identidades aisladas. El conector ERP se fuerza a lectura; no hay permisos de ejecución, servicios de fondo ni solicitudes de confirmación. Se verificaron cero ejecuciones comerciales y cero llamadas externas. Sus muestras son de hasta 500 filas por recurso y no acreditan toda la base. Los controles que necesitan un ejecutor utilizan únicamente dobles aislados; no prueban escrituras productivas.

Evidencia privada ignorada por Git:

- `data/evaluation/ia-local-quality-summary-2026-10-22.json` y sus tres mediciones: propuesta final 3/4; otra propuesta 2/4 fue descartada.
- `reports/live-chat-2026-10-22.json`: cuatro recorridos aprobados y control contextual original fallido.
- `reports/live-chat-probe-final-2026-10-22.json`: control contextual aprobado contra el contrato final, con filtros completos.

No se guardan filas comerciales, IDs ni conversaciones en esos informes. El método y los comandos reproducibles están en [evaluación del chat completo](evaluacion-chat-completo.md). Los resultados del modelo aislado y del asistente completo son diferentes: no se declara que Qwen haya pasado 4/4 por sí solo.

La suite completa del árbol final aprobó **659/659 pruebas**, sin fallos, con concurrencia 2 (103,4 segundos). Incluye confirmaciones falsas/desactualizadas, ejecución local deshabilitada, permisos y revocación, aislamiento, fuentes caídas y las regresiones nuevas. La denegación de evidencia parcial conserva su prueba original; las peticiones explícitas de elusión tienen una prueba separada más estricta: cero llamadas al modelo y a las fuentes.

## Versión activa y comprobación en la PWA

Código publicado en `main` mediante `43123d8`. El reinicio del mecanismo Windows existente terminó correctamente; `/health` devolvió 200 y `/api/agent/status` identificó `operativo-local-3`, con IA local disponible. ERP y KAIQEN recuperaron disponibilidad. No hubo cambios de credenciales ni de permisos de usuarios operativos.

Con la sesión personal ya abierta en Edge se repitieron los cuatro casos: solicitud con ambas bases, jerga y aclaración posterior sin repetir producto/cantidad, pedido USD sin proveedor y rechazo de SQL libre. Los borradores de prueba se cancelaron, sin preparar ni confirmar documentos comerciales. En otra conversación se consultó un producto real y después «del que vimos recién, decime cuánto le cobramos a quien nos compra…». La respuesta de `qwen3:4b` conservó la referencia y adjuntó el precio actual verificado, con base por millar/unidad y aclaración de precio de lista. La captura de esa versión permanece en `data/ia-local-chat-verificado-2026-10-22.jpg`, ignorada por Git. La PWA quedó abierta en ese resultado.

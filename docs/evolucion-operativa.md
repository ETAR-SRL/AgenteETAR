# Evolución operativa · avance comprobable

Pedido del 21/10/2026. Repositorio real `C:\Users\vigil\Agente`, exclusivamente `main`. Punto de partida: `1f1d913`, 508 pruebas aprobadas. El ERP está fuera de alcance de red/VPN; no se modifica la red ni se usan datos simulados en la instalación operativa.

| Etapa | Existente y reutilizado | Ampliación en curso | Comprobación pendiente |
|---|---|---|---|
| A. Disponibilidad | Arranque/reconexión ERP, estados unknown, servicio Windows | Salud independiente KAIQEN/IA, trabajos persistentes | Fuentes reales al recuperar red |
| B. Comprensión | Recorridos deterministas, memoria selectiva, reglas y permisos | OpenAI/Anthropic nativos, evaluación reproducible, límites/consumo | Claves y pruebas expresas sin información privada |
| C. Casos | op_items/op_follows, evidencias, propuestas confirmadas | Pausa/retomar, próximos pasos, investigación durable | Contratos y permisos controlados |
| D. Prioridades | Bandeja y notificaciones optativas | Prioridades explicadas y resumen personal programable | Horario/zonas, aislamiento y reinicio |
| E. Circuitos | Pedido vencido, remito, adjuntos y lotes AIB/DA1 | Impacto consultivo de listas, regresiones completas | Vínculos/volumen/SQL en Protheus real |
| F. Reportes/conectores | Dashboards, CSV/Excel, OIDC de ingreso | Documentos Workspace/365 con OAuth y ubicaciones explícitas; batería de integración | Credenciales, consentimiento, ubicaciones reales |

Decisiones: ampliar los módulos existentes; separar estado de caso, disponibilidad y ejecución; ninguna nueva escritura comercial; documentos externos son datos; toda confirmación conserva usuario/alcance/huella; ninguna reconexión reenvía escrituras. Los escenarios de prueba usan SQLite aislado y transportes controlados, sin sustituir el almacenamiento operativo.

Distribución: principal integra disponibilidad, permisos, concurrencia, confirmaciones, pruebas de extremo a extremo y publicación. Subtareas acotadas en Sol 6.1 medio para adaptadores IA, ampliación de casos/resumen y conectores documentales. No se cambió la configuración global ni se estiman ahorros inventados.

Implementación integrada: los estados KAIQEN/ERP son independientes; los casos agregan objetivo, pausa, próximos pasos, evidencia explicable, prioridades y vínculos de propuestas. Las investigaciones consultivas usan cola SQLite, préstamos renovados, cancelación, recuperación y validación de permisos; nunca contienen operaciones comerciales. El resumen diario se programa en el servidor. El conocimiento aprobado exige área y ACL propias. Los conectores documentales, exportaciones y proveedores IA están montados en Conexiones/chat/PWA, conservando voz y confirmaciones existentes.

## Evidencia local del 21/10/2026

- Suite amplia: 603 pruebas aprobadas, cero fallos, 96,8 segundos con concurrencia 2. Regresiones finales posteriores: 32 pruebas de fuente KAIQEN, callbacks, HTTP y memoria documental; 6 de conexión ERP y 4 de UI de investigaciones (permisos al abrir, tarjetas duplicadas, revocación y cierre). Las pruebas usan SQLite aislado y contratos controlados.
- Circuito A: `attention.test.js`, `evolution-http.test.js`, `investigation-jobs.test.js` y `attention-cases-daily.test.js`: pedido vencido, investigación/recorrido, seguimiento entre chats y reinicios, cambios, pausas y cierre únicamente con evidencia actual. El mismo caso no se duplica.
- Circuito B: `price-imports.test.js`, `price-batches.test.js` y `supplier-price-impact.test.js`: extracción local, producto/proveedor/lista, moneda/base, impacto consultivo SC7, filas con errores, conjunto fijo de confirmación, revalidación, fallos parciales e inciertos. Actualizar AIB no prepara ni ejecuta cambios SC7 automáticamente.
- Circuito C: `attention.test.js`, `attention-http.test.js` y recorridos comerciales existentes: remito y relaciones documentales controladas; errores/páginas incompletas no certifican facturación ni recepción física. Las relaciones reales nuevas siguen pendientes.
- `npm run evaluate`: 16/16 contratos de transporte controlados, sin llamadas pagas; no mide comprensión ni calidad de modelos reales. Benchmark reproducible contra `1f1d913`: cuatro diálogos, 40 muestras por versión, cero llamadas al modelo en ambas versiones. No demuestra mejora general de latencia; ver `benchmark-operativo.md`.
- `npm run validate:integration -- --offline --prepare`: batería ejecutable comprobada, informe local ignorado, `realValidation:not_performed`, cero escrituras. No se ejecutó `--live` ni se tocaron documentos comerciales.
- Prueba HTTP de la PWA aislada en SQLite en memoria: versión nueva, seis recursos estáticos entregados, resumen parcial, moneda/millares, seguimiento e investigación completada. Fuentes controladas; cero conexiones externas/escrituras ERP.
- La automatización visual de Edge se interrumpió durante el acceso a una pestaña de prueba. No se presenta una captura antigua como validación visual de esta versión. Los módulos UI tienen comprobaciones de sintaxis, DOM controlado y entrega HTTP; revisar dispositivos reales también forma parte de la homologación.

## Pendientes externos concretos

1. Red/VPN empresarial para ejecutar la batería consultiva por filial y revisar el informe; homologar campos/personalizaciones SX3/SX6, monedas/SM2, aprobación y vínculos reales. Las capacidades nuevas no agregan SQL ni relaciones inferidas.
2. Claves/modelos OpenAI o Anthropic y una prueba sintética explícita. No se configuró un proveedor externo ni se reenviaron datos de la empresa como prueba. El historial previo sin procedencia KAIQEN se trata conservadoramente: usar IA local o una conversación nueva.
3. Aplicaciones documentales separadas, secretos y clave de cifrado, callbacks HTTPS exactos, IDs de carpetas/drive, permiso local y ACL. Luego consentimiento por usuario y verificación real de lectura/revocación. Permanecen sin conectar hasta completar esos pasos.
4. Para validación móvil/voz/push real se necesitan navegador/dispositivo y autorizaciones optativas; no se activaron permisos de micrófono ni notificaciones nuevas por esta entrega.

Distribución real: el principal realizó integración, revisión de permisos/concurrencia/privacidad y publicación; tres subagentes Sol 6.1 en esfuerzo medio resolvieron módulos y pruebas acotadas. No se modificó la configuración global ni se afirma un ahorro de tokens no medido. Ver `alojamiento-permanente.md` para respaldo, restauración y migración futura sin contratar infraestructura.

Publicación: implementación subida a `main` en `ea489da`. Complemento final: batería consultiva con los tres circuitos de atención y exposición SC7 (máximo cuatro lecturas extra), 7 pruebas del paquete aprobadas; interfaz compatible con el servidor anterior mientras se completa un reinicio administrativo. La carga de módulos ausentes no inhabilita el chat ni activa datos sustitutos.

Activación verificada el 21/10/2026 a las 19:00 de Argentina: el dueño aceptó el nuevo aviso administrativo, se reinició el servidor y el supervisor registra el proceso nuevo en ejecución. `/health` devuelve 200 y `/api/agent/status` identifica `operativo-integral-1`. Los cuatro módulos nuevos de la PWA responden 200; la clave global de servicio no puede consultar investigaciones personales (403). KAIQEN registra una lectura exitosa y la IA local está disponible. Se comprobaron dos fallos de conexión ERP con reintento mientras HTTP siguió disponible: los 68 avisos ERP conservan estado unknown y no aparecieron eventos de objetivo cumplido. No hubo escrituras comerciales ni una validación nueva contra Protheus. La comprobación operativa no sustituye la revisión visual ni las validaciones externas pendientes.


## Continuación del 22/10/2026: desconexiones de KAIQEN

El diagnóstico local encontró un error PostgreSQL ECONNRESET no manejado en un cliente prestado. El pool ya tenía listener de errores de clientes ociosos; faltaba cubrir el intervalo de adquisición, consultas y devolución. Se agregó un guard permanente por cliente, sin acumular listeners ni guardar mensajes del controlador. Un error descarta la evidencia y destruye esa conexión; se conserva la transacción READ ONLY y el circuito de reintento existente. No se atrapan globalmente excepciones del proceso ni se simulan resultados.

Pruebas aisladas: 41 aprobadas, incluyendo cinco regresiones de socket/adquisición/rollback/errores tardíos/recuperación, pruebas HTTP, permisos y seguimientos. No se modificaron documentos comerciales. La configuración local conserva IA local y no contiene claves externas ni las credenciales completas de Google/Microsoft documental.

Referencia técnica: [eventos de pg.Client](https://node-postgres.com/apis/client) y [errores de pg.Pool](https://node-postgres.com/apis/pool). El error de un cliente prestado no queda cubierto solamente por el listener del pool.

## Comprobaciones ampliadas del 22/10/2026

La red empresarial volvió a estar accesible. Se ejecutó la batería consultiva real con una sola filial autorizada y muestras acotadas: ERP y KAIQEN respondieron; se verificaron un pedido vencido, SC5/SA1/SC6 y un remito con sus ítems SD2. No se hicieron escrituras comerciales ni se prepararon operaciones ejecutables. El [resultado real](resultado-validacion-real-2026-10-22.md) distingue los vínculos comprobados de las lecturas vacías y las diferencias de datos. Se corrigió el validador para respetar UM, precisión SX3 y SA1 compartida según los metadatos del adaptador existente.

La suite completa del 22/10 aprobó **627 pruebas**, cero fallos, con concurrencia 2 (105 segundos). Incluye fallos de fuentes, reinicio/persistencia, confirmaciones, aislamiento y revocación, circuitos de adjuntos, cola consultiva y notificaciones. Son pruebas controladas; no sustituyen la homologación de escrituras o de todos los registros ERP.

La PWA ahora reconsulta el estado de IA cada 15 segundos mientras está visible, al volver a la pestaña o red y después de guardar configuración. La comprobación no genera inferencias, admite una sola consulta en curso y descarta respuestas al cambiar de sesión. Un proveedor externo configurado no se presenta como verificado sin una respuesta exitosa. Se aprobaron después **13 pruebas focalizadas**, incluidas seis nuevas de este refresco, entrega HTTP del módulo y comportamiento del service worker. El shell pasa a v49 y la identificación del servidor a `operativo-integral-2` para comprobar el reinicio. También se comprobó a ancho móvil de 390 px sin desborde horizontal del documento; esto no acredita instalación en un teléfono físico.

En Edge, con la sesión personal ya abierta, se comprobó el precio real por unidad/millar; dashboard mensual separado en pesos/dólares; continuidad «¿Y el mes pasado?» con relectura de ambos períodos; bandeja con vencidos y KAIQEN relacionado; investigación en segundo plano y seguimiento por chat con referencia contextual. Los hallazgos separaron hechos de causas sin evidencia y no certificaron recepción física. Las capturas y el historial comercial de estas comprobaciones permanecen sólo en almacenamiento local ignorado.

Se agregó una evaluación explícita y acotada de modelos reales, independiente del arnés de transportes controlados. La medición de `qwen3:4b` encontró errores en los cuatro diálogos sintéticos: no se declara una mejora general de comprensión ni se confía al modelo autorización, cálculos o SQL. Las consultas directas conservan sus verificaciones estructuradas. Ver [método y resultado](ia-proveedores.md). El usuario confirmó que todavía no existen claves externas ni credenciales OAuth documentales; no se configuraron conexiones ficticias ni se enviaron datos comerciales a terceros para probarlas.

Pendientes concretos que no se pueden cerrar por código:

- Revisar registros heredados de muestra con `C6_MILLAR`/`D2_MILLAR` en cero y cantidades positivas en UN. Se detectó la diferencia, sin corregir el ERP ni atribuir su causa.
- Homologar SC1/SC7 y compras con casos reales: la muestra autorizada devolvió cero filas. SC9 y remitos/facturas del pedido vencido tampoco aportaron filas; no se certifica su ausencia general ni el cierre de remitos pendientes.
- Crear/configurar claves IA y aplicaciones documentales con ubicaciones y consentimiento explícitos para verificar los proveedores reales. Los adaptadores y sus controles están probados con escenarios aislados.
- Probar micrófono, instalación móvil y push con el dispositivo y las autorizaciones personales correspondientes. No se activaron permisos del navegador como parte de estas comprobaciones.

## Activación y cierre operativo del 22/10/2026

Código publicado en `main` (`fc5dd7b`, `ba2b1a0`). El reinicio mediante el mecanismo administrativo existente terminó correctamente, sin ejecuciones comerciales activas. A las 09:55 de Argentina `/health` devolvió 200, `/api/agent/status` identificó **`operativo-integral-2`** y el supervisor registró el nuevo servidor en ejecución. ERP y KAIQEN recuperaron lecturas; IA local disponible. `/ai-status-ui.js` devolvió 200 y la PWA mostró «IA local activa». La clave global de servicio continuó recibiendo 403 en investigaciones personales.

Un seguimiento creado para la comprobación conservó identificador, objetivo, fecha de inicio y estado después del reinicio. Se recuperó por chat en otra conversación. La primera lista lo mostró sin verificar; al pedir cambios, la relectura registró «la fuente volvió a estar disponible; no cambiaron los datos». No hubo eventos de objetivo cumplido durante la caída/reinicio. Una consulta local de integridad encontró cero identidades de caso duplicadas.

Por chat funcionaron consulta de cambios, posposición «hasta el lunes» (26/10/2026, 08:00 Argentina), corrección «volvé a mostrarlo» y cancelación del seguimiento de prueba. Se dejó ese seguimiento cancelado y el aviso abierto como al inicio, con constancia local de limpieza; no se ocultó un pendiente comercial real por terminar la prueba. También se consultó el código exacto 1 en SB1: devolvió su tipo SERVICIO y pidió sólo cantidad, aclarando que SC1 puede ir sin precio. No se completó ni confirmó una propuesta comercial.

La PWA quedó abierta en Edge con un dashboard real. La captura de esta versión está en `data/pwa-verificada-2026-10-22.jpg`, fuera de Git. Las verificaciones visuales no sustituyen una prueba en teléfono físico, micrófono o consentimiento push. La evaluación externa sin configuración devolvió `EXTERNAL_CONFIGURATION_REQUIRED`, sin inferencias; las credenciales continúan pendientes, como confirmó el usuario.

## IA local y cuatro casos: continuación del 22/10/2026

Se publicó y activó `operativo-local-3` (`43123d8`): bases independientes, continuidad del borrador ante aclaraciones, proveedor faltante y rechazo de elusión antes de consultar. Suite final 659/659; cuatro recorridos HTTP con ERP real 4/4; consulta indirecta contextual con modelo local y precio real aprobada; repetición visible en la PWA y borradores de prueba cancelados. Ninguna escritura comercial ni llamada externa. El modelo aislado mejoró a 3/4, no a 4/4: el asistente completa la aclaración ambigua con una regla explícita. Método, muestras, rendimiento y límites en [IA local: casos verificados](ia-local-cuatro-casos.md).
## Actualización local 4 — 22/10/2026

La [evaluación ampliada de IA y Protheus](ia-local-evaluacion-ampliada.md) reemplaza el resultado aislado anterior de Qwen: cuatro originales 4/4, variantes 7/8 y cuatro transcripciones largas 4/4, con fallos adicionales de negación explícitamente conservados. El chat completo verificó 32 turnos HTTP con ERP real, recuperación del primer producto, precio actual y continuidad posterior. La suite final pasó 676/676; servicio `operativo-local-4` y memoria 3 activos, con ERP/KAIQEN disponibles.

Se ampliaron lecturas SC1/SC7/SD1 y vínculos documentales, y se revisaron muestras históricas de MILLAR sin corregirlas. Se verificaron 19 casos de escritura/confirmación contra SQL Server LocalDB independiente con datos sintéticos y ejecutores existentes. Esto no cierra la homologación nativa de Protheus ni las integraciones externas sin credenciales. Los límites y evidencias están separados en los documentos enlazados.

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

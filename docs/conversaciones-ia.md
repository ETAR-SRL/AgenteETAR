# Conversaciones, comparativas y proveedor de IA

En el chat, después de un resumen de ventas o compras, «¿y este mes?», «¿y el pasado?» y «¿y el año pasado?» conservan filtros y sucursal, consultan de nuevo ambos períodos y comparan importes netos por moneda/unidad. Mes/año actual hasta hoy (Argentina); mes/año pasado completo. La comparación explicita fechas; no presupone duraciones equivalentes ni calcula porcentaje con base cero. El año pasado significa el año calendario completo, no el mismo mes del año pasado.

**Mis conversaciones** permite abrir, renombrar y eliminar conversaciones del usuario. Se conserva el historial completo desde esta versión, sin recortarlo al guardar; la lista muestra las 100 más recientes. Eliminar la conversación no elimina propuestas ni auditoría. Los cambios de permisos aíslan las conversaciones anteriores mediante la revisión de identidad existente.

En **Conexiones → Asistente e inteligencia**, sólo un administrador puede elegir Local o API externa, URL HTTPS, modelo y clave. Requiere un proveedor compatible con Chat Completions y JSON mode. La implementación usa [JSON mode documentado por OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat), con validación del esquema en el servidor y los mismos permisos de herramientas. No es un conector nativo a todas las APIs: un proveedor con contrato distinto necesita su adaptador.

Configuración persistente: `data/ai-settings.json` (no versionado), con API key sólo en servidor. Opcionalmente se inicializa con AI_PROVIDER/AI_API_URL/AI_API_MODEL/AI_API_KEY de `.env`. El archivo guardado desde la UI tiene prioridad. Una URL distinta exige volver a ingresar la clave, nunca se reenvía automáticamente la existente. Las peticiones no siguen redirecciones. Probar conexión manda un saludo sintético, sin datos ERP. El estado «configurada» no significa que la clave se haya validado. Si falla el proveedor no se cambia silenciosamente a otro.

Las consultas que requieren modelo envían al proveedor elegido una selección cronológica de contexto reciente y antiguo relevante y muestras de fuentes autorizadas. Las rutas directas de ERP no llaman al modelo. La voz sigue transcribiéndose localmente. No se altera la ejecución de cambios: propuesta y confirmación siguen siendo obligatorias. No se entrenan pesos automáticamente.

## Precios en documentos

SC1 permite omitir el precio tanto por chat como por adjuntos y API: graba precio/total cero y muestra «Sin precio» en el resumen. Mantiene la aprobación configurada, calculada sobre ese importe; no valora automáticamente la solicitud ni elude reglas. Un precio explícito positivo sigue validándose. SC7 exige precio positivo; si falta, busca AIA/AIB del proveedor/tienda/producto, con vigencia en la fecha del documento. Si hay varias listas se pide elegir. Las condiciones por rango/flete que no puede resolver se explicitan, sin inventar precios ni conversiones.

En pedidos existentes, «usá la lista» prepara el precio vigente de AIB para compras o DA1 para ventas. Venta usa A1_TABELA; una lista explícita reemplaza esa selección sólo para esta propuesta. La moneda debe coincidir con el pedido. No se modifica A1_TABELA. Las altas de pedidos de venta siguen fuera del ejecutor autorizado actual (sólo SC1/SC7); las actualizaciones SC6 existentes se conservan.

## Memoria de conversaciones largas

La selección local busca referencias en todo el historial de la conversación y sucursal: prioriza el intercambio reciente y recupera mensajes antiguos por palabras/códigos relevantes. Su presupuesto es de 12.000 caracteres de historial; no envía toda la conversación ni hace una llamada adicional a la IA para resumir. Las correcciones más recientes prevalecen en las instrucciones al modelo. Esto es recuperación selectiva, no memoria ilimitada del modelo: ante referencias ambiguas puede pedir una aclaración.

Los datos de una solicitud o pedido de compra de un ítem quedan pausados cuando se consulta otro tema. «Retomemos la solicitud» o «Continuemos el pedido de compra» recupera el borrador de la misma sucursal y vuelve a validar los catálogos. Iniciar otro documento reemplaza ese borrador; cancelarlo lo descarta. Nunca recupera un precio de lista almacenado como precio vigente ni ejecuta una propuesta por recordar su historial.

La memoria sigue aislada por usuario/revisión de permisos y conversación. Los valores actuales requieren lectura autorizada en este turno; los cambios conservan resumen y confirmación. Los mensajes que versiones anteriores ya descartaron no pueden recuperarse. El historial completo se borra al eliminar la conversación, sin eliminar auditoría ni propuestas.

## Preferencias personales entre conversaciones

Las preferencias se gestionan por texto o voz en el chat, sin otra pantalla ni llamada a la IA:

- «Recordá que prefiero respuestas breves» (o «detalladas»).
- «Prefiero respuestas en tabla» (o «texto»): orientación para las respuestas redactadas por el modelo; no cambia las tarjetas de fuentes o confirmaciones.
- «Prefiero ver cantidades en millares» (o «unidades»): presentación del modelo, sólo compatible con UN; nunca completa la base de una operación de escritura.
- «Usá el depósito 16 por defecto»: verifica que exista y que el usuario pueda leerlo, y lo guarda para esta sucursal.
- «Mi solicitante por defecto es Ana»: dato aportado por el usuario para nuevas solicitudes.
- «Mostrame mis preferencias», «Olvidá mis preferencias» o «Olvidá mis preferencias de depósito» (también respuestas, formato, cantidades o solicitante).

Repetir una preferencia reemplaza la anterior. Borrar todas elimina las generales y las de la sucursal seleccionada. Los valores explícitos del documento y del turno tienen prioridad. Los depósitos y solicitantes habituales se aplican al recorrido directo de altas SC1/SC7 de un ítem; se revalidan los catálogos y las condiciones del documento y siempre se muestra la propuesta antes de confirmar. No se trasladan automáticamente a adjuntos ni a otras operaciones.

SQLite guarda estas preferencias por identidad personal y revisión de permisos, separadas de las conversaciones. Las cuentas de servicio no comparten ni guardan preferencias de usuarios. Un cambio de rol o permisos deja de recuperar las preferencias de la revisión anterior. No se copian automáticamente mensajes, archivos, registros ERP, precios, saldos, productos ni cantidades a la memoria entre conversaciones. Los permisos y las confirmaciones se verifican como antes. Eliminar una conversación no borra las preferencias; se borran explícitamente desde el chat.

### Preferencias en lenguaje natural

No se requieren frases exactas: ante una expresión personal de hábito o preferencia, el asistente puede interpretar «me resulta más cómodo que me contestes cortito» o «normalmente trabajo con el depósito 16, tenelo presente». Usa el modelo configurado sólo para esos candidatos y conserva las rutas directas para instrucciones ya reconocidas. La primera llamada al modelo local puede tardar más si necesita cargarlo. Sólo se envía el mensaje actual y, al corregir, la última preferencia de ese chat; no otras conversaciones ni filas ERP.

Cada guardado enumera campos y valores; los reemplazos interpretados muestran el valor anterior. Una frase puede definir varias preferencias: se validan todas antes de guardar alguna. «No, mejor el 17» inmediatamente después de guardar un depósito lo corrige en el mismo chat y sucursal, con nueva validación. Una referencia ambigua pide aclaración. Podés borrar preferencias con expresiones como «olvidá que prefiero respuestas breves».

La interpretación sigue limitada a extensión/formato de respuestas, presentación de cantidades, depósito y solicitante habituales. Los valores de depósito y solicitante deben aparecer literalmente en lo que escribió el usuario; el modelo no puede inventarlos. Las citas, referencias a archivos, instrucciones de una sola vez y operaciones comerciales no disparan extracción de preferencias. Las preferencias no cambian permisos ni sustituyen la revisión de propuestas. Las expresiones no reconocidas no se guardan silenciosamente. La corrección contextual sólo sirve inmediatamente después del aviso de guardado, y no se traslada a otra conversación.

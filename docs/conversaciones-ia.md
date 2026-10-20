# Conversaciones, comparativas y proveedor de IA

En el chat, después de un resumen de ventas o compras, «¿y este mes?», «¿y el pasado?» y «¿y el año pasado?» conservan filtros y sucursal, consultan de nuevo ambos períodos y comparan importes netos por moneda/unidad. Mes/año actual hasta hoy (Argentina); mes/año pasado completo. La comparación explicita fechas; no presupone duraciones equivalentes ni calcula porcentaje con base cero. El año pasado significa el año calendario completo, no el mismo mes del año pasado.

**Mis conversaciones** permite abrir, renombrar y eliminar conversaciones del usuario. Se conservan hasta 20 mensajes recientes por conversación; la lista muestra las 100 más recientes. Eliminar la conversación no elimina propuestas ni auditoría. Los cambios de permisos aíslan las conversaciones anteriores mediante la revisión de identidad existente.

En **Conexiones → Asistente e inteligencia**, sólo un administrador puede elegir Local o API externa, URL HTTPS, modelo y clave. Requiere un proveedor compatible con Chat Completions y JSON mode. La implementación usa [JSON mode documentado por OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat), con validación del esquema en el servidor y los mismos permisos de herramientas. No es un conector nativo a todas las APIs: un proveedor con contrato distinto necesita su adaptador.

Configuración persistente: `data/ai-settings.json` (no versionado), con API key sólo en servidor. Opcionalmente se inicializa con AI_PROVIDER/AI_API_URL/AI_API_MODEL/AI_API_KEY de `.env`. El archivo guardado desde la UI tiene prioridad. Una URL distinta exige volver a ingresar la clave, nunca se reenvía automáticamente la existente. Las peticiones no siguen redirecciones. Probar conexión manda un saludo sintético, sin datos ERP. El estado «configurada» no significa que la clave se haya validado. Si falla el proveedor no se cambia silenciosamente a otro.

Las consultas que requieren modelo envían al proveedor elegido el contexto reciente y muestras de fuentes autorizadas. Las rutas directas de ERP no llaman al modelo. La voz sigue transcribiéndose localmente. No se altera la ejecución de cambios: propuesta y confirmación siguen siendo obligatorias. No se entrenan pesos automáticamente.

## Precios en documentos

SC1 permite omitir el precio tanto por chat como por adjuntos y API: graba precio/total cero y muestra «Sin precio» en el resumen. Mantiene la aprobación configurada, calculada sobre ese importe; no valora automáticamente la solicitud ni elude reglas. Un precio explícito positivo sigue validándose. SC7 exige precio positivo; si falta, busca AIA/AIB del proveedor/tienda/producto, con vigencia en la fecha del documento. Si hay varias listas se pide elegir. Las condiciones por rango/flete que no puede resolver se explicitan, sin inventar precios ni conversiones.

En pedidos existentes, «usá la lista» prepara el precio vigente de AIB para compras o DA1 para ventas. Venta usa A1_TABELA; una lista explícita reemplaza esa selección sólo para esta propuesta. La moneda debe coincidir con el pedido. No se modifica A1_TABELA. Las altas de pedidos de venta siguen fuera del ejecutor autorizado actual (sólo SC1/SC7); las actualizaciones SC6 existentes se conservan.

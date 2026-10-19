# Inteligencia del chat

Central usa un modelo de lenguaje Qwen3 4B, ejecutado por Ollama 0.40.6 en este equipo. El modelo interpreta la pregunta, decide una herramienta, recibe la respuesta y puede continuar con otra consulta. No genera SQL ejecutable ni tiene funciones de escritura en el ERP.

## Circuito

1. La PWA envía texto, tema opcional, sucursal y conversación a `POST /api/agent/chat`.
2. El servidor recupera las últimas intervenciones y los términos del negocio más relevantes. También descubre los recursos y filtros del catálogo ERP actual.
3. El modelo selecciona entre buscar productos/clientes/proveedores/listas, resolver un precio, consultar un recurso ERP o consultar proyectos/calidad. Hasta seis pasos por turno; una consulta simultánea por identidad.
4. Los adaptadores validan sucursal, filtros, tamaños y tipos antes de leer las bases. Una búsqueda por nombre usa SQL parametrizado, sin ampliar sucursal ni incluir eliminados lógicos.
5. La respuesta incluye evidencias, fuentes y trazas. Los precios de lista se redactan desde los datos verificados por una función de negocio; el modelo no inventa ni calcula esos importes.

## Precio de venta

Se identifica el producto por código exacto y, si no existe esa coincidencia, por palabras de su nombre. Varias coincidencias requieren elegir. Si se indica un cliente, se resuelve su tienda y lista SA1; no se adivina una lista si el cliente no la tiene asignada. Una lista explícita distinta a la del cliente genera una aclaración.

Se leen DA1 y DA0: importe, moneda, unidad, fecha, estado del ítem, estado y fechas de la lista, tramos y condiciones disponibles. Un ítem inactivo o una cabecera vencida no se presenta como precio vigente. Si hay varias alternativas, se muestran sin elegir arbitrariamente. El precio de lista no prueba el precio efectivamente facturado y no ejecuta la rutina comercial Protheus para impuestos/descuentos. Las tablas conservan valores originales en CSV.

## Memoria y aprendizaje

Las conversaciones y clasificaciones se guardan en `data/agent.sqlite`. El navegador conserva sólo el UUID de conversación. Los valores actuales se consultan nuevamente; una respuesta anterior no es fuente de un precio actual.

El botón **Enseñar un término** permite guardar y olvidar equivalencias o clasificaciones. También se admite una enseñanza explícita por chat, por ejemplo: «Recordá que llamamos varilla azul al producto ABC123». El modelo propone el término y su significado; el servidor exige que el término esté escrito en el mensaje actual y que haya una enseñanza explícita. Una fila del ERP no puede generar por sí sola una memoria. Los importes, saldos y estados no se guardan mediante esa herramienta como reglas permanentes.

Es memoria recuperable y uso de herramientas; no reentrenamiento autónomo de los pesos ni modificación autónoma del código. El asistente puede equivocarse al interpretar una pregunta: las fuentes y candidatos permiten verificar y corregir el resultado.

## Operación y privacidad

- Modelo: `data/llm-models`. Runtime: `data/llm-runtime`. Ambos excluidos del ZIP y de Git.
- `scripts/install-intelligence.ps1` reproduce la instalación desde el lanzamiento oficial y verifica SHA256. `iniciar.ps1` inicia también el motor local si hace falta.
- API del modelo exclusivamente en `127.0.0.1:11434`, con funciones cloud deshabilitadas. No hay claves API externas ni envío de filas ERP/KAIQEN a un modelo remoto.
- Sesión PWA local de lectura; se permite guardar su propia memoria local. Los consumidores Bearer tienen memoria separada por identidad de clave. La PWA es para un único usuario de este equipo.
- `POST /api/agent/chat`, `GET /api/agent/status`, `GET/POST /api/agent/knowledge`, `DELETE /api/agent/knowledge/{id}`, `GET /api/agent/conversations/{id}`.
- `/api/agent/query` y `/api/agent/plan` conservan el contrato estructurado anterior para clientes existentes. El frontal conversacional usa `/api/agent/chat`.

## Referencias técnicas

- [API de chat y salida JSON de Ollama](https://docs.ollama.com/api/chat)
- [Runtime standalone para Windows](https://docs.ollama.com/windows)
- [Modelo Qwen3 4B](https://ollama.com/library/qwen3:4b)

Pruebas automatizadas incluyen búsqueda parametrizada, precios inactivos/futuros/vencidos, productos ambiguos, separación de usuarios, memoria, consultas encadenadas y rechazo de una respuesta numérica sin ninguna fuente consultada. Las verificaciones con el modelo y bases reales se registran, sin filas comerciales, en `reports/intelligence-live-check.json`.

Los resúmenes de cartera y calidad KAIQEN se redactan desde campos y conteos verificados: la fase no se convierte en estado global y el catálogo de estados no se presenta como estado de un proyecto. La IA elige las herramientas y resuelve referencias; las funciones de negocio conservan la exactitud de estos resúmenes y de los precios.

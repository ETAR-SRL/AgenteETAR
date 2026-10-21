# Usuarios, roles y acceso a los datos

Los [adjuntos de precios](precios-desde-archivos.md) admiten DA1/AIB, SC6, SC7 y SC1. La carga pendiente de clasificación exige al menos un permiso de preparación de esas acciones. Antes de consultar se exige preparar la acción concreta y leer catálogo, tercero y precios/ventas/compras que correspondan; SC1 no necesita proveedores. Sus borradores, conversaciones y resultados se aíslan por actor y sucursal. Subir un archivo no concede permisos ni ejecuta cambios; la ejecución conserva los permisos y confirmación existentes.

Los adjuntos también admiten altas `crearPedidoCompra` y `crearSolicitudCompra`. Requieren sus permisos propios de preparación y ejecución: poder actualizar un pedido no autoriza crearlo. El alta comprueba además el acceso a depósitos y, para SC7, condiciones de pago y proveedor. Cada propuesta pertenece al actor y sucursal del archivo. Corregirlo invalida las propuestas anteriores en el servidor, incluso si se conservó su ID.

La confirmación conjunta exige además el permiso de ejecutar la acción de precios, `LOCAL_WRITE_ENABLED` para usuarios y el ejecutor habilitado. Revalida autorización antes de cada precio; no convierte un permiso de preparación en escritura. El lote pertenece a la identidad y revisión de permisos que lo preparó. Consultar o reenviar un lote de otra identidad no permite leerlo ni ejecutarlo.

## Primer ingreso

Abrir `http://127.0.0.1:4310/`. Si aún no hay usuarios, Central solicita crear el primer administrador. Elegir nombre, usuario y una contraseña de entre 12 y 128 caracteres. No hay una contraseña inicial compartida. El alta inicial es única, incluso si dos solicitudes llegan juntas.

En **Usuarios y roles**, crear primero el rol, marcar sus permisos y sucursales, guardar y luego crear los usuarios asignándoles ese rol. El administrador puede editar roles, cambiar contraseñas y desactivar usuarios. El rol Administrador tiene acceso completo; no se puede modificar ni dejar la instalación sin un administrador activo.

Cada usuario tiene una sola asignación de rol. Se puede crear un rol sin permisos de lectura; ningún dato de negocio queda habilitado por defecto.

## Qué controla cada permiso

Las áreas son catálogo, clientes, proveedores, costos, precios de venta, precios de compra, ventas, compras, producción, proyectos, calidad y aprobaciones. Los permisos para preparar y ejecutar cada tipo de modificación son independientes de los de lectura. Ejecutar requiere también preparar; las verificaciones de negocio, `LOCAL_WRITE_ENABLED=true`, la habilitación del ejecutor y la confirmación de la propuesta siguen vigentes.

Los permisos de esta versión son **por conjuntos de datos**, no por columna, cliente individual o proyecto individual. Un recurso que contiene varias áreas exige todas. Por ejemplo:

| Consulta | Permisos de lectura necesarios |
|---|---|
| Producción | Producción y catálogo |
| Costos/stock valuado | Costos y catálogo |
| Precios DA1 | Precios de venta y catálogo |
| Ítems de venta, incluidos importes | Ventas, clientes, precios de venta y catálogo |
| Pedidos de compra | Compras, proveedores, precios de compra y catálogo |
| Proyectos KAIQEN | Proyectos y clientes |
| Calidad KAIQEN | Calidad |
| Proyecto combinado con calidad y costos | Proyectos, clientes, calidad, costos y catálogo |

La pantalla muestra la lista completa de dependencias. Si falta un permiso, se deniega el recurso completo: no se devuelven filas con algunas columnas ocultas. Los nombres, descripciones y otros textos libres de las áreas habilitadas se muestran tal como los entrega la fuente; no se clasifican automáticamente fragmentos de texto.

Las sucursales restringen las consultas y operaciones ERP. KAIQEN conserva el alcance de planta configurado de su conector; no hereda las sucursales ERP ni replica los permisos individuales propios de KAIQEN.

## API, chat y memoria

La preparación conversacional directa de SC1 exige permiso de preparar `crearSolicitudCompra` antes de leer referencias, además de los permisos de cada lectura. Sus datos pendientes se guardan dentro de la conversación del actor y se descartan al cambiar de sucursal, cancelar o iniciar otra operación. No agrega rutas ni permisos de ejecución.

Los nuevos comprobantes, pendientes y resúmenes declaran las áreas de ventas o compras, terceros, precios y catálogo. Los recursos antiguos sin clasificación `documentosSalida`, `itemsDocumentosSalida` y `entradasCompras` requieren ambas áreas: contienen también notas de crédito en sentido inverso. Para un rol de una sola área usar los recursos clasificados descritos en [consultas comerciales](consultas-comerciales.md).

El servidor verifica permisos antes de llamar al conector, incluyendo búsquedas, alias, consultas combinadas y herramientas de la IA. Ante una lectura denegada devuelve HTTP 403 `LECTURA_DENEGADA`, con **«Esto no podés leerlo.»**. El chat detiene la búsqueda ante esa denegación, descarta los resultados parciales de esa respuesta y no pide al modelo que busque una alternativa para eludirla.

Las conversaciones, conocimientos guardados y propuestas tienen identidad de usuario y revisión de permisos. Al modificar el usuario o su rol, los historiales anteriores no vuelven a alimentar al modelo y las propuestas anteriores dejan de estar disponibles para esa identidad. Los registros de auditoría y ejecución se conservan. Las conversaciones anónimas de la versión anterior no se asignan automáticamente al administrador.

Un cambio de usuario revoca sus sesiones. Los cambios de rol se aplican en la siguiente solicitud y se revalidan antes de devolver resultados de consultas en curso. Una transacción de negocio que ya empezó no se deshace por un cambio posterior de rol. Cerrar sesión o cambiar de cuenta limpia identificadores locales; otras pestañas se recargan al detectar el cambio.

## Credenciales y despliegue

Las contraseñas se almacenan con scrypt (N=32768, r=8, p=3, sal aleatoria de 16 bytes), nunca en texto plano. Las sesiones duran ocho horas, tienen tokens aleatorios de 32 bytes y sólo su hash SHA-256 queda en SQLite. La cookie usa HttpOnly y SameSite=Strict. Hay límite de intentos de ingreso por dirección y comprobación de origen para acciones desde el navegador.

La PWA admite **HTTP en loopback** y una entrada adicional **HTTPS para la LAN**, con orígenes y subredes privados explícitos. La cookie de red es Secure y el alta inicial del administrador permanece limitada a loopback. Ver [configuración de red local](red-local.md). No basta con cambiar `HOST`. La cuenta de Windows con acceso a `.env` o a `data/agent.sqlite` continúa siendo una identidad administradora de infraestructura.

Las claves `API_READ_KEY`, `API_PLAN_KEY` y `API_WRITE_KEY` se conservan para las integraciones existentes. Son credenciales de servicio con el alcance global de lectura/planificación/escritura de la instalación, no usuarios restringidos. **No entregarlas al equipo ni incorporarlas al frontal**. No permiten administrar usuarios y roles. La PWA utiliza exclusivamente el ingreso personal; la antigua sesión anónima no da acceso, tampoco antes del alta inicial.

El servicio de escalamiento automático de aprobaciones sigue siendo una operación de fondo de la instalación autorizada por su configuración, independiente de los roles interactivos. Consultar su historial exige los permisos de aprobaciones y el nivel de operador.

## Verificación

`npm test` incluye pruebas de aislamiento por usuario y sucursal, accesos directos e indirectos, detención de herramientas de IA, revocación, sesiones, contraseñas, origen, primer administrador concurrente y administración de roles. Las pruebas usan bases en memoria y conectores simulados: no crean usuarios ni modifican documentos en los sistemas reales.

Los conectores KAIQEN usan una proyección explícita de campos para usuarios restringidos. Campos adicionales de la API (por ejemplo precios dentro de la ficha de un producto) no se propagan automáticamente a otras áreas. El contrato de calidad completo verificado corresponde a la conexión PostgreSQL; campos adicionales de la API HTTP requieren incorporar su mapeo antes de habilitarlos a roles restringidos.


Las preferencias personales (`user_preferences`) sólo se alimentan con instrucciones explícitas del usuario autenticado por el chat existente. Admiten campos tipados, no reglas de acceso. Se aíslan por actor y revisión de permisos; depósito/solicitante además por sucursal. No agregan rutas ni recursos ERP. Guardar un depósito exige la lectura autorizada de `depositos`, y usarlo en un alta vuelve a exigir los permisos de preparación y lectura actuales. Las preferencias no cambian las autorizaciones, la moneda ni la base de cantidades de una escritura. Las cuentas de servicio no pueden guardarlas.

La interpretación natural de preferencias usa un esquema cerrado y fragmentos literales del mensaje actual. El modelo propone campos; el servidor valida tipos, propiedad del usuario, sucursal y lecturas antes de persistir. Un fallo o ambigüedad no modifica la memoria. Los guardados múltiples son atómicos; la lectura de depósitos ocurre antes de la transacción SQLite. No hay nuevos permisos ni acciones ERP.

El acceso corporativo opcional usa OIDC (ver acceso-corporativo.md), sin alta automática ni asociación por email. La vinculación explícita de emisor y sub con un usuario local preserva su rol, sucursales y memoria. Las rutas públicas de inicio/callback sólo autentican: no conceden acceso a recursos ERP.

El vocabulario aprendido (`language_aliases`, ver aprendizaje-local.md) se aísla por actor autenticado y sucursal. Sólo contiene equivalencias lingüísticas tipadas y sus usos verificados; no acredita valores ni permisos. Se gestiona desde el chat autenticado existente, sin rutas nuevas. Las consultas interpretadas conservan los controles de recurso/sucursal actuales. El aprendizaje automático sólo registra expresiones soportadas tras un informe verificado; las correcciones sólo proceden del mensaje humano actual. No se toman de herramientas ni adjuntos. Las copias de `data/aprendizaje/` no se sirven por HTTP.

Los filtros y el detalle de dashboards usan el chat autenticado y los recursos existentes. Se exige leer el informe antes de resolver nombres y leer el detalle antes de consultar documentos. El contrato `dashboard` sólo acepta informes conocidos, modos de lectura, filtros tipados y la sucursal actual. Las barras no autorizan recursos ni SQL libre. La paginación revalida sesión, recurso y sucursal por página; `unidad` mantiene la separación del importe seleccionado.
## Dashboards personales guardados

Cada resultado permite **Guardar dashboard** con un nombre, sus filtros, agrupación y sucursal. **Mis dashboards** permite volver a abrirlo o quitarlo. Puede conservar fechas exactas o recalcular este mes, el mes anterior, este año o el año anterior al abrirlo.

Las rutas autenticadas `GET/POST /api/dashboards` y `GET/DELETE /api/dashboards/:id` guardan sólo la configuración en SQLite local, nunca una copia de las filas ERP. Exigen usuario personal, no aceptan claves globales de servicio ni un propietario enviado por el cliente. El propietario es el ID estable del usuario: un cambio de rol conserva la definición, pero no sus privilegios. Listar, guardar, abrir y quitar exigen los permisos actuales del recurso comercial existente y su sucursal; las definiciones no autorizadas se ocultan. Otro usuario recibe 404 por el mismo ID salvo que exista una asignación explícita a su usuario o a su rol actual. No existe recurso de lectura nuevo ni permiso que amplíe el alcance comercial.

Abrir recupera la definición y ejecuta la consulta normal del chat, que vuelve a validar referencias, permisos y sucursal en el servidor antes de leer el ERP. No se reutilizan importes guardados. Se admiten hasta 100 dashboards por usuario, nombres de hasta 100 caracteres y sólo filtros comerciales declarados. Guardar no modifica Protheus.


### Compartir dashboards

En **Mis dashboards**, el dueño puede elegir **Compartir**, marcar usuarios o roles y guardar los destinatarios. Desmarcarlos revoca el acceso compartido. Las rutas `GET/PUT /api/dashboards/:id/sharing` son exclusivas del dueño y exigen además que conserve la lectura del informe y su sucursal. La selección es transaccional y queda auditada; sólo admite IDs existentes de usuarios activos y roles con acceso al recurso y sucursal. El directorio devuelve únicamente ID y nombre de destinatarios elegibles, nunca contraseñas, sesiones ni permisos completos. No otorga acceso administrativo ni agrega recursos ERP nuevos.

Los receptores ven **Compartido con vos · sólo lectura** en su listado. No pueden cambiar destinatarios ni borrar el original. Compartir conserva la definición, no resultados ni credenciales del dueño. Al listar o abrir se exige una asignación vigente al usuario o a su rol actual y se verifican los permisos y sucursal propios de quien consulta; la lectura ERP posterior conserva todos los controles existentes. Revocar la asignación impide recuperar de nuevo la definición. Cambiar de rol deja de habilitar las asignaciones del rol anterior; reducir permisos oculta los dashboards aunque la asignación continúe guardada. El dueño puede quitar asignaciones que dejaron de ser elegibles. Quitar el original elimina sus asignaciones.

### Dashboards por texto o voz

El chat autenticado permite «guardalo como Ventas del equipo», «abrí el dashboard Ventas del equipo», «compartilo con Ana y el rol Ventas» y «mostrame mis dashboards». El dictado usa exactamente la misma interpretación y autorización que el texto. La gestión se resuelve localmente, sin enviar nombres de destinatarios al modelo ni esperar generación de IA. Sólo actúa a partir del mensaje humano, no de las fuentes ni los adjuntos.

Guardar usa el último dashboard verificado de la sucursal actual; no guarda cifras ni inventa filtros. Pregunta el nombre si falta. Si sus fechas coinciden con este mes/año o el anterior, guarda ese período móvil y lo informa; «con fechas fijas» conserva las fechas exactas. Abrir resuelve nombres entre dashboards propios y compartidos accesibles, relee la definición autorizada y consulta el ERP de nuevo. Si corresponde a otra sucursal autorizada, el chat cambia a esa sucursal al mostrarlo.

Compartir exige propiedad vigente antes de buscar destinatarios elegibles por nombre o usuario. Agrega destinatarios sin revocar los anteriores; para revocar, usar la gestión de destinatarios o los comandos de revocación del chat. Las coincidencias múltiples se aclaran con nombre u opción numerada. El borrador conserva el dashboard y los destinatarios ya resueltos, pregunta sólo lo pendiente y se puede cancelar. Se aísla dentro de la conversación del usuario y revisión de permisos; cambiar sucursal descarta el borrador. Elegir una opción vuelve a verificar los permisos y destinatarios antes de guardar. No agrega herramientas de ejecución ERP ni acceso SQL al modelo.


El chat y el dictado también admiten «dejá de compartir este dashboard con Ana», «quitale el acceso al rol Ventas» y «sacale el acceso a Ana del dashboard Ventas del equipo». Resuelve sólo las asignaciones existentes, incluidas las de usuarios deshabilitados o que ya perdieron permisos. El dueño y su autorización actual se verifican antes de consultar esos nombres. Sólo pregunta por destinatarios o dashboards faltantes o ambiguos; ante un destinatario sin asignación no elimina nada. Conserva las selecciones durante una aclaración y permite cancelar.

`POST /api/dashboards/:id/unshare` elimina transaccionalmente las asignaciones concretas indicadas y deja intactas todas las demás, incluidas las agregadas mientras se aclaraba una selección. Repetir una eliminación ya aplicada no borra otros accesos. La operación queda auditada y no requiere que el destinatario siga siendo elegible para recibir nuevas asignaciones. Quitar una asignación directa no quita el acceso por roles aún compartidos: el chat lo aclara, sin revocar el rol para el resto de sus integrantes. No modifica usuarios, roles ni permisos ERP.


### Consultar destinatarios y vías de acceso

«¿Con quién está compartido este dashboard?», «¿Quién tiene acceso al dashboard Ventas?» y «¿Ana accede directamente o por un rol?» consultan la configuración actual de SQLite sin llamar al modelo. Se conserva el dashboard del contexto y se aclaran nombres repetidos. `GET /api/dashboards/:id/access` y su interpretación en el chat exigen ser el dueño y conservar lectura del informe y su sucursal antes de consultar destinatarios. Recibir un dashboard, incluso con rol administrador, no habilita inspeccionar sus destinatarios si no se es dueño.

El informe identifica roles compartidos y los usuarios asignados directamente o que pertenecen actualmente a esos roles; muestra ambas vías cuando coinciden. El dueño aparece identificado como tal. Por usuario distingue asignación de acceso efectivo: verifica actividad, rol vigente, permisos comerciales actuales y sucursal autorizada. Conserva visibles asignaciones a usuarios deshabilitados o eliminados, indicando que no acceden; un rol compartido sin integrantes también se muestra. Cambiar de rol, revocar una asignación o reducir permisos se refleja en la siguiente lectura. El conteo de miembros incluye las cuentas con ese rol, aun deshabilitadas; su estado se indica por separado.

Sólo devuelve nombres, identificadores de destinatarios, vías de acceso y motivos de habilitación/denegación. No devuelve credenciales, sesiones, permisos completos, conversaciones ni usuarios ajenos al dashboard. Buscar un usuario concreto se limita al dueño y los destinatarios actuales: una ausencia no se presenta como un relevamiento de todo el directorio. Es consultivo: no cambia asignaciones, usuarios, roles ni registros ERP.


### Historial de asignaciones del dashboard

El chat y el dictado admiten «mostrame el historial de este dashboard», «¿quién lo compartió?» y «¿quién quitó accesos del dashboard Ventas?». Reutilizan el dashboard del contexto y aclaran nombres repetidos. «Mostrame más historial de este dashboard» continúa la paginación. La ruta `GET /api/dashboards/:id/history?page=1` exige usuario personal, propiedad del dashboard y permisos actuales del informe y sucursal, antes de consultar la auditoría. Los receptores, aunque puedan leer el dashboard o sean administradores de otro, no pueden consultar su historial. No agrega permisos ERP ni llamadas al modelo.

Desde esta versión se guardan, en la misma transacción que las asignaciones, el instante UTC, identidad y nombre del autor y los destinatarios realmente agregados o quitados, con su nombre al momento del cambio. Incluye cambios desde botones y chat. La lectura presenta horarios de Argentina, 25 eventos por página, más recientes primero. Cambiar el nombre, rol o estado de una cuenta no reescribe estos eventos. Los intentos repetidos que no cambian asignaciones se muestran como «sin cambios en los accesos», nunca como revocaciones realizadas. Un fallo del registro de historial revierte también las asignaciones y la auditoría de esa transacción.

La auditoría anterior se presenta separada como incompleta: registra autor y fecha del evento pero no permite acreditar todos los destinatarios o el resultado exacto. Si el autor todavía existe se muestra su nombre actual expresamente identificado como tal; no se inventan nombres históricos, destinatarios ni fechas a partir del estado actual. Las revocaciones antiguas registraban los destinos solicitados, sin acreditar si se eliminaron: no se anuncian como accesos efectivamente quitados. El historial no reconstruye cambios de pertenencia a roles ni de permisos generales. Las lecturas no modifican asignaciones ni Protheus.

### Filtros y descarga del historial

El chat y el dictado admiten «historial del dashboard Ventas del usuario Ana desde 01/10/2026 hasta 21/10/2026», «filtralo por rol Ventas», «y el mes pasado» y «exportá el historial del dashboard Ventas en Excel». Los nombres se resuelven entre identidades registradas en ese historial, conservando alias de nombres anteriores y preguntando cuando hay más de una coincidencia. La API antigua `usuario` filtra autor o destinatario por compatibilidad; el chat actual usa autor y usuario destinatario separados, como se detalla más abajo. Un rol filtra asignaciones dirigidas a ese rol, sin atribuir usuarios a roles históricos. Se pueden combinar filtros, que se aplican por AND. Los eventos completos coincidentes pueden incluir otros destinatarios del mismo cambio. Los registros antiguos sin destinatarios verificables sólo pueden coincidir por autor o fecha, nunca por un destinatario inferido.

`GET /api/dashboards/:id/history` admite `usuario`, `rol` (IDs resueltos), `desde`, `hasta` (AAAA-MM-DD) y `page`. Las fechas incluyen ambos días en horario de Argentina; el chat acepta además DD/MM/AAAA, hoy, ayer, este mes/año y el anterior. Las aclaraciones y páginas siguientes conservan los filtros. El botón **Descargar historial en Excel** de cada respuesta usa exactamente sus filtros. «Descargalo en Excel» recupera la descarga del historial filtrado del contexto.

`GET /api/dashboards/:id/history.xlsx` genera un archivo XLSX con todas las páginas del filtro, hoja Historial y hoja Alcance, encabezados, filtros de columna, filas inmovilizadas y nombres como texto literal (sin fórmulas provenientes de nombres). Una operación puede ocupar varias filas por sus distintos destinatarios. La descarga vuelve a comprobar dueño, permisos y sucursal, también antes de enviar el archivo; usa no-store, no se publica un archivo compartido ni se cachea en la PWA. No modifica el ERP. Límite explícito de 20.000 eventos/100.000 filas por descarga: si se supera se solicita acotar el filtro y no se entrega una primera página disfrazada de exportación completa.


### Filtrar por tipo de cambio de acceso

«Historial de este dashboard sólo accesos agregados», «mostrame sólo accesos quitados», «filtralo por tipo sin cambios» y «descargalo en Excel» conservan el resto de filtros y los controles de propiedad, informe y sucursal. La API de consulta y XLSX admite `tipo=agregados`, `tipo=quitados` o `tipo=sin_cambios`; otros valores se rechazan. El tipo se conserva al pedir otra página o descargar y puede combinarse con usuario, rol y fechas. Pedir dos tipos contradictorios en una instrucción exige elegir uno, sin ampliar silenciosamente la consulta.

La selección se calcula sobre los destinos realmente agregados/quitados del evento confirmado: agregados exige al menos un alta; quitados al menos una baja; sin cambios exige ambos conjuntos vacíos. Los eventos antiguos incompletos no se clasifican como ninguno de esos tres tipos. Una operación mixta puede coincidir con agregados y quitados: la respuesta y Excel muestran sólo las acciones del tipo elegido. Si se combina con usuario destinatario o rol, la coincidencia debe corresponder a esa misma acción (sin buscar el nombre en el lado opuesto del cambio); el autor sigue siendo una coincidencia válida para el filtro de usuario. «Sin cambios» puede filtrarse por autor y fechas; no se infieren destinatarios de una operación sin altas/bajas. No se modifican asignaciones ni Protheus.


### Autor y destinatario separados

Se pueden combinar «historial de este dashboard hechos por Giuliano para el usuario Ana y el rol Ventas este mes», «por autor Giuliano», «usuario destinatario Ana» y «destinatario rol Ventas», junto con tipo de cambio y fechas. El chat resuelve autores sólo entre quienes figuran como autores en el historial y usuarios destinatarios sólo entre los destinos verificados; no usa pertenencias actuales para inventar destinatarios históricos. Se aclaran las identidades ambiguas sin perder el resto de filtros. En el chat, «usuario Ana» ahora significa usuario destinatario y se rotula como tal. Autor es siempre un filtro explícito separado.

Las rutas JSON y XLSX aceptan `autor` y `destinatario` como IDs independientes, junto con `rol` para el rol destinatario. Se aplican por AND en SQL, antes de contar o paginar: autor sólo coincide con quien realizó el evento; destinatario sólo con altas/bajas dirigidas a ese usuario (y al tipo de acción elegido). El campo anterior `usuario` de la API se mantiene con su semántica amplia por compatibilidad, y si aparece en un contexto anterior se rotula «usuario (autor o destinatario)» para distinguirlo. Una nueva selección explícita de destinatario reemplaza ese filtro amplio. Autor puede filtrar auditoría antigua con identidad verificable; destinatario no coincide con registros antiguos sin destinos comprobados. Sin cambios puede combinarse con autor, sin inferir destinatarios.

Consulta, paginación, aclaraciones y Excel conservan los criterios independientes. La hoja Alcance explica las diferencias y la hoja Historial mantiene autor y destinatario en columnas separadas. Se mantienen los controles de dueño, permisos actuales del informe y sucursal, incluso al descargar; esta mejora no concede accesos ni modifica el ERP.

### Filtros personales guardados del historial

«Guardá estos filtros como Control mensual», «guardalos como Revisión», «aplicá los filtros Control mensual», «exportá con mis filtros Control mensual en Excel» y «mostrame mis filtros de historial» gestionan configuraciones personales desde el chat y el dictado, sin llamar al modelo. Si falta el nombre, sólo se pregunta ese dato; si hay nombres repetidos se permite elegir. Se guardan el dashboard concreto, los filtros canónicos de autor/destinatario/rol/tipo/fechas y el período, nunca una copia del historial ni del Excel.

El período relativo de la consulta (este mes/año, el anterior, hoy o ayer) se conserva como tal y se recalcula al aplicar; las fechas explícitas siguen fijas. «Con fechas fijas» al guardar permite fijarlas expresamente. Los contextos antiguos sin indicación de período se interpretan según sus fechas y el período elegido se informa al guardar. Los filtros se pueden usar desde una conversación nueva y sobreviven reinicios. Al aplicar se consulta nuevamente el historial y se devuelve la descarga habitual de Excel con esos mismos filtros. Si la sucursal guardada es otra autorizada, pasa a ser la sucursal activa.

`GET/POST /api/history-filters` lista y guarda; `GET /api/history-filters/:id` recupera la definición personal con fechas recalculadas. Se exige usuario personal y propiedad del dashboard además de permisos vigentes de informe y sucursal en cada operación. El propietario del filtro es el ID estable autenticado: no se acepta un owner enviado por el cliente ni claves globales de servicio. Otro usuario recibe 404 por el mismo ID. Si se pierde acceso al dashboard o éste se elimina, sus filtros se ocultan del listado y no pueden aplicarse. Recibir un dashboard compartido no habilita guardar filtros de su historial, que sigue siendo exclusivo del dueño. Límite de 100 configuraciones personales y nombres de hasta 100 caracteres. No se comparten automáticamente filtros personales ni se amplían permisos por haberlos guardado.


### Renombrar y eliminar filtros personales

«Renombrá el filtro Control mensual a Revisión de accesos», «cambiá el nombre de mis filtros Control mensual», «eliminá el filtro Revisión de accesos» y «borrá mis filtros Revisión» se resuelven localmente por texto o dictado. Se buscan sólo las configuraciones propias y actualmente autorizadas; los nombres ambiguos requieren elegir una opción. Si falta el nuevo nombre se pregunta únicamente ese dato, conservando la identidad del filtro. Renombrar modifica sólo el nombre: mantiene los criterios, período y dashboard asociado. No hay eliminación masiva implícita.

`PATCH /api/history-filters/:id` admite `{name}` para renombrar y nombres de hasta 100 caracteres; para editar criterios utiliza el contrato separado detallado más abajo. `DELETE /api/history-filters/:id` realiza una eliminación lógica y deja de mostrar o aplicar esa configuración. `POST /api/history-filters/:id/restore` permite recuperarla. El chat conserva el ID de la última eliminación de esta conversación para «deshacé la eliminación»; ese ID no concede permisos. Todas las operaciones vuelven a exigir usuario personal, propiedad del filtro y del dashboard, lectura del informe y sucursal vigentes. Otra cuenta recibe 404, incluso si conoce el ID. Los filtros eliminados no cuentan para el límite de 100 activos; recuperar respeta ese límite.

«Deshacé la última modificación» recupera los criterios y período anteriores de la última configuración personal editada; también admite «revertí el último cambio del filtro Control». Si el nombre es ambiguo, pide elegir. `POST /api/history-filters/:id/undo` ejecuta la misma operación con autorización actual de propietario, informe y sucursal. Conserva ID, nombre y dashboard; no crea otro filtro ni cambia accesos. El respaldo local persiste entre conversaciones y reinicios, guarda un solo paso por filtro y se consume al deshacer: repetir no alterna versiones. Una nueva edición reemplaza ese respaldo. Los períodos relativos recuperan su significado y recalculan fechas al consultar. Renombrar no invalida el respaldo; los filtros eliminados no pueden deshacerse hasta recuperarlos. Sin edición disponible devuelve 409; otro usuario recibe 404. La restauración y su auditoría se guardan en una transacción, verificando que el cuerpo actual coincida con la versión editada. No restaura permisos ni modifica documentos del ERP.

Los cambios quedan auditados y son transaccionales. La migración local agrega el indicador de eliminación sin borrar configuraciones previas. Eliminar o renombrar no modifica el historial, el dashboard, asignaciones de acceso, configuraciones de otros usuarios ni registros ERP. Si ya no se puede acceder al dashboard, tampoco se puede renombrar, eliminar ni restaurar sus filtros por esta vía.


### Editar criterios de una configuración existente

«Modificá el filtro Control mensual con autor Giuliano para el usuario Ana desde 01/10/2026 hasta 20/10/2026 sólo accesos agregados», «actualizá mis filtros Control mensual con mes pasado y tipo sin cambios» y «modificá el filtro Control mensual con sin autor» editan la configuración propia existente, conservando su ID, nombre y dashboard. Usar `con`, `para` o `:` separa el nombre de los cambios; los nombres se pueden escribir entre comillas. Si no se indican cambios se pregunta qué modificar, y los nombres de configuraciones o personas ambiguos se aclaran sin guardar parcialmente. Autor y usuario/rol destinatario se verifican en las identidades del historial de ese dashboard. Un nombre no verificado detiene toda la edición.

`PATCH /api/history-filters/:id` admite `{filters:{autor,destinatario,rol,desde,hasta,tipo},period?}` como edición parcial, separada de `{name}`. Los criterios no mencionados permanecen intactos; `null` quita sólo el criterio indicado. No se permite cambiar propietario, dashboard ni estado de eliminación. El período admite fijo, este mes/año, el anterior, hoy y ayer. Cambiar fechas exactas pasa a período fijo; si antes era relativo, conserva el otro extremo calculado al momento. Cambiar a un período relativo elimina las fechas fijas anteriores. Se rechazan fechas invertidas, tipos desconocidos y combinaciones contradictorias sin modificar la configuración. «Sin fechas» quita ambas fechas; «sin autor», «sin usuario destinatario», «sin rol» y «sin tipo» eliminan esos criterios.

La actualización vuelve a exigir identidad personal, propiedad de filtro y dashboard, lectura del informe y sucursal actuales. Filtros eliminados no se editan ni reaparecen por este medio. Los cambios de criterios y período se guardan junto con una auditoría del antes/después en una transacción. Consulta y Excel posteriores leen la misma configuración actualizada y vuelven a validar permisos; no se crean nuevas configuraciones, ni se modifica el historial, las asignaciones o Protheus.


Rehacer criterios personales: `POST /api/history-filters/:id/redo` vuelve a aplicar el cuerpo exacto de la edición deshecha, sobre el mismo ID, nombre y dashboard. Por texto o voz: «rehacé la última modificación» o «rehacé el último cambio del filtro Control». Resuelve nombres ambiguos antes de actuar. Sin nombre selecciona el último deshacer personal pendiente y disponible; se revalidan propiedad del filtro y dashboard, informe y sucursal. Otra cuenta recibe 404 y permisos revocados 403. El respaldo local persiste entre conversaciones y reinicios. Rehacer consume ese respaldo y habilita deshacer nuevamente; repetir rehacer sin un nuevo deshacer devuelve 409. Una nueva edición de criterios invalida el rehacer de ese filtro; renombrarlo conserva el respaldo. No opera sobre filtros eliminados. La transacción comprueba el cuerpo actual y guarda el cambio, los respaldos y la auditoría `dashboard.history-filters.redone` juntos. No crea filtros ni cambia permisos ni registros ERP.

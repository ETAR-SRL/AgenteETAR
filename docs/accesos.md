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

Las rutas autenticadas `GET/POST /api/dashboards` y `GET/DELETE /api/dashboards/:id` guardan sólo la configuración en SQLite local, nunca una copia de las filas ERP. Exigen usuario personal, no aceptan claves globales de servicio ni un propietario enviado por el cliente. El propietario es el ID estable del usuario: un cambio de rol conserva la definición, pero no sus privilegios. Listar, guardar, abrir y quitar exigen los permisos actuales del recurso comercial existente y su sucursal; las definiciones no autorizadas se ocultan. Otro usuario recibe 404 por el mismo ID. No existe recurso de lectura nuevo ni permiso que amplíe el alcance comercial.

Abrir recupera la definición y ejecuta la consulta normal del chat, que vuelve a validar referencias, permisos y sucursal en el servidor antes de leer el ERP. No se reutilizan importes guardados. Se admiten hasta 100 dashboards por usuario, nombres de hasta 100 caracteres y sólo filtros comerciales declarados. Guardar no modifica Protheus.

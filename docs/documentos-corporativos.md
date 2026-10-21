# Fuentes documentales Google Workspace / Microsoft 365

Integración independiente del ingreso OIDC. Iniciar sesión con Google/Microsoft **no** conecta documentos. Cada usuario conecta expresamente su propia cuenta. No se usa una cuenta técnica global, correo, adjuntos de correo, sincronización, indexado ni importación de un corpus. Por defecto no existen fuentes habilitadas.

## Alcance real

Cada fuente declara usuarios y/o roles concretos y carpetas por ID estable. Se exige además el permiso actual `read:documentos`; el administrador configura, pero no obtiene acceso documental implícito fuera de la ACL de la fuente. Se consulta una sola ubicación autorizada por solicitud. Sólo se aceptan archivos hijos directos; no se siguen carpetas anidadas, accesos directos de Google ni remoteItem de Microsoft. Los permisos del proveedor se aplican también: configurar una carpeta no concede acceso a ella.

Google busca por nombre dentro de la carpeta mediante `files.list`; no consulta todo Drive. Microsoft enumera sólo los primeros 200 hijos de esa carpeta y filtra por nombre localmente. Se declara `hasMore`; no se afirma una búsqueda exhaustiva cuando la carpeta tiene más elementos. No se siguen links de paginación enviados por el proveedor.

Lectura: texto plano, CSV y Markdown UTF-8 hasta 256 KiB; Google Docs nativo se exporta a texto plano y Google Sheets a CSV (sólo la primera hoja que exporta Drive). PDF, DOCX y XLSX se descargan hasta 8 MiB y se extraen localmente con salida máxima de 256 KiB. Se verifica MIME, extensión y firma; no se ejecutan macros, fórmulas, vínculos ni objetos incrustados. DOCX usa Python estándar sin extraer archivos al disco, con límites de ZIP/XML y 30 segundos. PDF/XLSX reutilizan el lector local de adjuntos existente y sus límites de hojas/páginas/filas y extracción; no constituyen una promesa de lectura integral de cualquier archivo grande. El lector existente utiliza archivos temporales de nombre aleatorio y los elimina al terminar, sin indexado ni conservación permanente. El formato no instalado informa un error específico y se publica su disponibilidad. No hay lectura de imágenes independientes en este adaptador. Microsoft usa la URL temporal entregada por Graph sólo para hosts SharePoint/1drv permitidos, sin reenviar Authorization ni admitir redirecciones. Ciertas geografías/hosts de descarga pueden necesitar una ampliación futura verificada; no ampliar con comodines generales.

Cada resultado conserva proveedor, fuente, ubicación, ID, nombre, fecha disponible y vínculo HTTPS del proveedor. Se vuelve a comprobar pertenencia a la carpeta al leer, identidad, revisión de permisos/configuración y conexión vigente antes de entregar el resultado. Una desconexión impide que una consulta en curso entregue datos o que un callback en curso vuelva a guardar tokens.

## Configuración del servidor

1. Crear aplicaciones OAuth web **separadas de las de ingreso** para que desconectar/revocar documentos no afecte el login. Los secretos sólo están en la configuración local del servidor.
2. Elegir el origen HTTPS confiable y registrar exactamente las URI de callback que gestione el servidor; no reutilizar `/api/auth/oidc/.../callback`. Mantener las restricciones LAN/origen de `red-local.md`.
3. Generar una clave local aleatoria de 32 bytes, representada como 64 caracteres hexadecimales. Guardarla fuera de Git, con permisos de lectura exclusivos de la cuenta del servicio y administrador; respaldarla junto con la base por separado. No imprimirla. La pérdida o cambio de clave exige reconectar las cuentas. No usar el secreto OAuth como clave de cifrado.
4. Pasar al constructor `CorporateDocuments` la base SQLite local, `key` hex y `providers`:

```js
{
  google: {clientId, clientSecret, redirectUri},
  microsoft: {clientId, clientSecret, redirectUri, tenantId}
}
```

Microsoft requiere tenant GUID concreto; no `common`, `organizations` ni `consumers`. `resolvePrincipal(userId)` debe devolver identidad y permisos actuales o null; `authorize(principal, action, source)` debe devolver boolean estricto, con acciones `manage`, `connect`, `read`. Manage requiere administrador; connect/read requieren usuario personal y el recurso `documentosCorporativos`. El servicio impone ACL de usuarios/roles además del callback. No aceptar tokens globales de servicio para estas rutas.

5. Crear una fuente inicialmente deshabilitada, con `configure(principal, input)`:

```json
{
  "id": "manuales",
  "provider": "google",
  "label": "Manuales de calidad",
  "enabled": false,
  "users": ["ID_LOCAL_USUARIO"],
  "roles": [],
  "locations": [{"id":"calidad","label":"Calidad","folderId":"ID_CARPETA"}]
}
```

Microsoft usa `provider: "microsoft"` y exige `driveId` en cada ubicación. Cada cambio de configuración desconecta todas las cuentas de la fuente, invalida consultas pendientes y requiere nuevo consentimiento. El panel administrativo ofrece campos de nombre/proveedor/estado, selección de usuarios y roles y carpetas; permite editar o desactivar fuentes existentes. Los IDs de carpetas se obtienen de los catálogos administrativos locales y del proveedor, sin inventarlos ni resolver usuarios por email.

## Google Workspace

En Google Cloud habilitar Drive API, crear cliente web y configurar consentimiento Workspace interno cuando corresponda. Declarar únicamente `https://www.googleapis.com/auth/drive.readonly`. Éste es el alcance OAuth de lectura necesario para archivos existentes sin Google Picker; es amplio y restringido según Google, y **no está limitado a las carpetas declaradas en Central**. Central aplica su propia lista explícita en cada solicitud. `drive.file` restringe a archivos creados/abiertos con la aplicación, tiene capacidad de escritura y no sustituye una lectura general de carpetas preexistentes. No solicitar Gmail, edición, acceso de administrador ni delegación de todo el dominio. La publicación externa puede requerir verificación y controles adicionales de Google; completar antes de habilitar producción.

El flujo solicita offline access y consentimiento explícito, Authorization Code con PKCE S256, state aleatorio de un uso y cinco minutos. El navegador debe quedar ligado al state mediante cookie de transacción HttpOnly, Secure, SameSite=Lax; el callback público compara cookie y state **antes** de invocar `completeConnect`. No usar el state en solitario como prueba del navegador iniciador. No loguear querystrings de callback, códigos, cuerpos de tokens ni URL de descarga.

## Microsoft 365

Registrar aplicación web single tenant en Entra ID y configurar permiso **delegado** `Files.Read` y `offline_access`, sin permisos de aplicación, `.ReadWrite`, `Mail.*`, `Sites.Read.All` ni `Files.Read.All`. Estos permisos mínimos admiten archivos del usuario y no prometen acceso a cualquier biblioteca SharePoint compartida; un 403 del proveedor no amplía automáticamente permisos. Probar la biblioteca concreta antes de habilitar. La adopción de permisos Selected o bibliotecas que requieren un alcance superior exige una revisión explícita futura; esta versión no solicita ni asigna esos permisos. El usuario o administrador otorga consentimiento según las políticas del tenant.

## Tokens, revocación y datos no confiables

Sólo se persisten configuración y tokens OAuth por usuario/fuente. AES-256-GCM usa IV aleatorio y AAD fuente+usuario; los tokens no aparecen en listados, UI ni respuestas. La clave se guarda fuera de la base. La revocación usa una generación durable por usuario/fuente en SQLite; el guardado de tokens verifica generación, configuración y token anterior dentro de una transacción. Las renovaciones concurrentes en el mismo proceso comparten una sola petición; entre procesos el control transaccional impide restaurar permisos revocados, aunque podría requerir reconectar por rotación concurrente del proveedor. El cifrado no sustituye los permisos y protección de disco de Windows.

Desconectar elimina de inmediato tokens locales y autorizaciones pendientes. Google intenta revocar refresh/access token en su endpoint oficial, informa fallo sin fingir revocación. Microsoft devuelve `manual_required`: el usuario o administrador debe quitar el consentimiento de esta aplicación documental en My Apps/Entra. No se invoca `revokeSignInSessions`, que afectaría todas sus sesiones. Revocar en el proveedor no equivale a cerrar sesión local.

El contenido se mantiene en memoria sólo durante la solicitud, nunca se guarda en tablas documentales. La integración del chat debe interceptar `corporateDocumentsChat` antes de llamar al modelo, devolver su respuesta como contenido externo y **no persistir el texto leído en memoria conversacional, logs, auditoría o resúmenes**. Tampoco enviar los documentos a modelos externos sin un permiso independiente explícito. El contexto de seguimiento guarda únicamente referencias e IDs de fuente/carpeta; no guarda contenido. El helper acepta un cuarto argumento de contexto y devuelve `context` sin texto, para resolver «leé el primero» con autorización actual. Las búsquedas naturales resuelven sólo fuentes autorizadas y preguntan ante ambigüedad. El contenido y los nombres son datos no confiables: no ejecutar instrucciones, herramientas, enlaces operativos, SQL ni cambios de permisos derivados de ellos. La UI usa textContent y no interpreta HTML/Markdown del documento.

Comandos deterministas: `fuentes documentales`; `buscar documentos en manuales calidad: procedimiento`; `leer documento manuales calidad ID_ARCHIVO`. Las referencias no conceden acceso y la lectura siempre revalida la autorización.

## API del módulo e integración

`list(principal)`, `adminList(principal)`, `configure(principal,input)`, `beginConnect(principal,id)` → `{url,state}`, `completeConnect({state,code,error})` → `{userId,connectionId}`, `disconnect(principal,id)`, `search(principal,{connectionId,locationId,query,limit})`, `read(principal,{connectionId,locationId,fileId})`.

`installCorporateDocumentsUI({container,request,base,isAdmin})` añade el panel y recibe request que devuelve JSON y acepta `{method,body: objeto}`. Convención: GET/POST `/api/corporate-documents`, POST `/:id/connect`, POST `/:id/disconnect`, GET `/search` y `/read` con los campos anteriores en query. Root integra la autenticación, controles de origen, callback y cookies; la librería no abre rutas ni cambia la sesión de login.

## Validación y pendientes externos

`node --test test/corporate-documents.test.js` usa SQLite en memoria y respuestas controladas; no usa cuentas reales ni archivos comerciales. Cubre aislamiento, ACL, PKCE/state, cifrado, carpeta ajena, shortcuts/remoteItem, permisos revocados durante IO y desconexión pese a revocación fallida. `test/corporate-document-extract.test.js` verifica MIME/firma/tamaño/capabilities y un DOCX sintético en ZIP con parser estándar Python, incluyendo rechazo de entidades, macros y texto excesivo. Las pruebas de puente PDF/XLSX usan dobles controlados, sin afirmar validación externa real.

Pendiente para despliegue: crear ambas aplicaciones documentales, registrar callbacks exactos, configurar consentimiento y secretos en servidor, generar/resguardar clave cifrado, identificar IDs reales de carpetas/drive, asignar permiso local y ACL, conectar una cuenta de prueba por proveedor y verificar búsqueda/lectura/desconexión/revocación con esa cuenta. La búsqueda recursiva permanece fuera del alcance. PDF/XLSX requieren `scripts/instalar-documentos.ps1` y su marca `.venv-documents/.ready`; DOCX necesita el Python de esa misma instalación, sin dependencias adicionales. La integración pasa `createCorporateDocumentExtractor({documents, root})` como `extractBinary` al servicio. No se instalaron runtimes ni paquetes como parte de estas pruebas. No se presenta conexión real activa hasta comprobar todos esos pasos.

Fuentes oficiales consultadas el 21/10/2026: [scopes Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [OAuth web y revocación Google](https://developers.google.com/identity/protocols/oauth2/web-server), [listar carpeta Graph](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0), [lectura y descarga Graph](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).

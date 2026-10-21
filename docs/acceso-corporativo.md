# Ingreso con Google / Microsoft 365 y PWA

Central conserva el ingreso local. Los botones corporativos están deshabilitados hasta configurar un proveedor y acceder desde OIDC_ORIGIN. No se simula una conexión ni se asignan roles por correo o dominio.

1. Registrar una aplicación web en Google Cloud o Microsoft Entra ID. Microsoft usa un tenant concreto (GUID), no common ni consumers.
2. Registrar exactamente OIDC_ORIGIN/api/auth/oidc/google/callback o /api/auth/oidc/microsoft/callback. Usar HTTPS y un nombre de servidor que admita el proveedor, accesible desde las PC. El certificado debe ser válido para ese nombre. Agregar ese origen a la configuración LAN existente; no ampliar a comodines. HTTP loopback sólo sirve para desarrollo local.
3. Completar las variables OIDC_* de .env.example en el .env del servidor. Guardar allí los secretos, nunca en el navegador ni Git.
4. Crear previamente el usuario local y asignarle su rol. En OIDC_ACCOUNT_LINKS vincular provider + issuer (URL exacta del emisor) + subject (claim sub estable y verificado por el administrador del proveedor) con username local. No se vincula por email ni se crean usuarios al iniciar sesión.
5. Reiniciar el servicio y probar con una cuenta de prueba vinculada. Los roles, sucursales, desactivaciones y revisión de permisos siguen controlados por Central.

El flujo usa Authorization Code, PKCE S256, state, nonce y cookie HttpOnly SameSite=Lax de cinco minutos para la transacción de ingreso. La sesión normal conserva SameSite=Strict. La transacción es de un solo uso y se invalida al reiniciar el servicio. El servidor no guarda tokens del proveedor. No incluye acceso a Drive, Gmail, SharePoint ni Graph: esos permisos son integraciones separadas.

Referencias: [OpenID Connect de Google](https://developers.google.com/identity/openid-connect/openid-connect), [Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc), [openid-client](https://github.com/panva/openid-client).

## Instalación

La aplicación incluye manifest, iconos 192/512 y service worker. El botón Instalar app usa el aviso del navegador cuando está disponible; en Edge también se puede instalar desde su menú Aplicaciones. En móvil usar el menú Agregar a inicio. Fuera de loopback se requiere HTTPS confiable. No se guardan sesiones ni respuestas ERP en el caché offline: sin servidor sólo queda disponible la interfaz. Instalarla no reemplaza el servicio de inicio automático de esta PC.

## Validación pendiente de credenciales

El flujo y sus controles se prueban con dobles automatizados. La conexión real con Google/Microsoft requiere credenciales, dominio de red y vinculaciones del administrador; no se presenta como activada hasta realizar esa configuración.

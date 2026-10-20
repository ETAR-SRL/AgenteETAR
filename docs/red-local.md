# Central desde otras PC

Central puede mantener su entrada HTTP de desarrollo en `127.0.0.1:4310` y abrir una segunda entrada **HTTPS** para la LAN. Ambas comparten usuarios, roles, sesiones, conversaciones, propuestas y permisos; no son dos instalaciones. No se distribuyen claves API al equipo.

## Preparar el servidor Windows

Con PowerShell 7, desde el repositorio:

```powershell
.\scripts\configurar-lan.ps1 -Address 192.168.1.10 -Subnet 192.168.1.0/24 -DnsName central
```

Usar la IP, subred y nombre reales del servidor. El script valida que la subred sea privada, genera un certificado de servidor de un año, configura `.env` y crea:

- `data/tls/server.pfx` y `server-password.txt`: privados, con permisos de Windows limitados al usuario del proceso y SYSTEM.
- `data/lan-client/central-ca.cer`, `instalar-certificado.ps1` y `LEEME.txt`: paquete público para otras PC, con huella SHA-256.

La clave privada de la autoridad que firma este certificado se descarta; no se guarda en el servidor ni en el paquete. Para renovar se vuelve a ejecutar con `-Renew`, se reinicia el servicio y se distribuye el nuevo certificado público. Un certificado corporativo válido puede sustituir el PFX y su contraseña sin usar este generador.

En una consola de administrador, habilitar exclusivamente el puerto HTTPS para la subred:

```powershell
.\scripts\habilitar-firewall-lan.ps1 -Subnet 192.168.1.0/24 -Port 4311
```

La regla de Windows se limita a `node.exe`, TCP 4311 y esa subred; no abre SQL Server, Ollama, voz ni el puerto HTTP. Se aplica a todos los perfiles para admitir redes empresariales que Windows identifica como públicas, manteniendo el filtro de subred. El servicio también comprueba la dirección de cada conexión. No se configura el router ni redirección de puertos de Internet.

Reiniciar Central con `iniciar.ps1` después de detener su proceso de forma controlada y comprobar que no haya ejecuciones en curso. El script de inicio comprueba ambos puertos, espera a que la app responda y muestra las direcciones disponibles.

## Incorporar cada PC

1. Copiar **sólo** la carpeta `data/lan-client` al equipo.
2. Verificar con el administrador la huella que figura en `LEEME.txt` y ejecutar `instalar-certificado.ps1` con el usuario Windows que usará la app. Instala el certificado público en `Cert:\CurrentUser\Root`. También puede importarse desde el asistente de certificados de Windows. Edge y Chrome utilizan ese almacén; otros navegadores pueden requerir configurar su confianza por separado.
3. Abrir la URL HTTPS que figura en `LEEME.txt`, por ejemplo `https://192.168.1.10:4311/`.
4. Ingresar con la cuenta personal creada en **Usuarios y roles**. El rol y las sucursales siguen controlando cada consulta y modificación.

La PC servidora debe estar encendida y accesible. Reservar su dirección por DHCP o utilizar una IP fija. El nombre alternativo sólo funciona si la red lo resuelve; ante cambio de IP/nombre hay que actualizar el certificado, los orígenes y, cuando corresponda, la subred.

No continuar a través de una advertencia de certificado: comprobar instalación, URL y vencimiento. HTTPS con certificado confiable permite instalar la PWA y solicitar el micrófono. El usuario conserva el control del permiso de voz del navegador.

El primer administrador sólo se puede crear desde loopback en la PC servidora. En las otras PC se indica que falta esa configuración, sin ofrecer el alta inicial.

## Configuración

```dotenv
HOST=127.0.0.1
PORT=4310
LAN_HTTPS_ENABLED=true
LAN_HOST=0.0.0.0
LAN_PORT=4311
LAN_ORIGINS=https://192.168.1.10:4311,https://central:4311
LAN_CIDRS=192.168.1.0/24
LAN_TLS_PFX=data/tls/server.pfx
LAN_TLS_PASSWORD_FILE=data/tls/server-password.txt
```

`LAN_ORIGINS` contiene orígenes HTTPS exactos, sin barra final, rutas, credenciales ni comodines. `LAN_CIDRS` admite varias subredes privadas separadas por comas, incluidas VPN explícitas. `LAN_HOST` define dónde escucha TLS; el filtro por subred se aplica aunque escuche en todas las interfaces. Con `LAN_HTTPS_ENABLED=false` se conserva únicamente el acceso local.

No se aceptan `Forwarded` ni `X-Forwarded-*` como prueba de IP, host o cifrado. Esta configuración termina TLS directamente en Node; no habilita un proxy inverso. Las cookies HTTPS usan el nombre `__Secure-central_auth`, `Secure`, `HttpOnly` y `SameSite=Strict`, sin `Domain`. Están separadas de la cookie HTTP local. No se habilita CORS.

Las claves Bearer de servicio conservan su alcance global, pero también deben entrar por un origen, transporte y red admitidos. No deben compartirse con usuarios restringidos.

## Verificación

`npm test` comprueba política de red, falsificación de cabeceras, límites de subred, sesión segura, alta inicial, revocación y permisos de API/chat. Las pruebas de rutas simulan propiedades del socket; la prueba operativa de despliegue debe verificar además el handshake HTTPS con el certificado público, sin desactivar la validación TLS.

Desde otra PC, probar la URL HTTPS, iniciar sesión como usuario restringido y pedir un dato excluido de su rol. Debe responder «Esto no podés leerlo». Si no conecta, comprobar el firewall, la ruta/VPN y aislamiento de clientes Wi-Fi. La verificación desde el servidor no acredita por sí sola conectividad desde una segunda PC.

Referencias: [HTTPS de Node.js](https://nodejs.org/api/https.html), [contextos seguros del navegador](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), [reglas de Windows Firewall](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule).

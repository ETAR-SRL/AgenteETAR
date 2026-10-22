# Inicio al encender Windows

## Instalador BAT: servicio nativo de Windows

Con la aplicación ya configurada, abrir **Instalar-servicio.bat** en la carpeta raíz. Pide elevación de Windows una sola vez si hace falta. Instala y arranca el servicio **CentralETAR**, visible como **Central ETAR** en `services.msc`, con inicio automático diferido y cuenta **LOCAL SERVICE**. Funciona antes de iniciar sesión. La PC debe permanecer encendida; no modifica suspensión, VPN, firewall ni certificados.

Requisitos: Windows 8 / Server 2012 o posterior con .NET Framework 4.x y su compilador local, Node **>=24.16.0 y <25**, `.env` y las dependencias instaladas con `npm ci`. Se puede usar Node del sistema o el runtime portable existente en `data/node-runtime/node.exe`; no descarga runtimes ni ejecutables de terceros. Compila el pequeño host versionado en `scripts/windows-service-host.cs` y guarda el ejecutable generado en `data/service-runtime`, excluido de Git. El ejecutable generado localmente no tiene firma Authenticode; una política empresarial que exija firmas requiere la firma aprobada por la organización.

Para revisar la configuración sin elevar permisos, registrar servicios, cambiar tareas ni iniciar procesos de la app:

```bat
Instalar-servicio.bat --preview
```

También acepta `--check` y `--dry-run`. La comprobación valida Node, dependencias, los módulos locales alcanzados por imports literales del servidor/supervisor, los recursos de la página y del caché PWA, el mapping configurado y la presencia de los archivos TLS requeridos. Informa versiones del paquete, agente y PWA, módulos npm, recursos públicos y preparación de voz, sin mostrar `.env`. Es una comprobación estática de archivos y paquetes; no verifica imports calculados, conectividad al ERP, validez del certificado ni ejecuta operaciones comerciales. Las rutas con espacios y caracteres Unicode se pasan entre comillas; el directorio de trabajo queda fijado a la instalación, independientemente de la carpeta desde donde se abra el BAT.

### Preparar otro Windows Server

1. Copiar una revisión completa y actual de la aplicación, incluyendo `Instalar-servicio.bat`, `scripts`, `src`, `public`, `config`, `package.json` y `package-lock.json`. Conservar juntos los archivos de esa revisión; una copia parcial puede perder módulos nuevos o recursos de voz.
2. Preparar Node compatible y .NET Framework en el servidor y ejecutar `npm ci` en la carpeta nueva. El BAT verifica estos requisitos; no descarga ni instala runtimes automáticamente.
3. Guardar una copia de seguridad local protegida de `.env`, configuración privada, certificados y claves TLS, y datos que se deban migrar, antes de reemplazarlos. Transferirlos por un medio seguro y ajustar sus rutas para el nuevo servidor. Git y el paquete de fuentes no contienen `.env`, bases, modelos ni runtimes. Para conservar usuarios, permisos y memoria, migrar la base y sus archivos asociados mediante una copia coherente durante mantenimiento; no copiar SQLite activo como archivos independientes.
4. Ejecutar `Instalar-servicio.bat --preview` desde la carpeta nueva y revisar todas las versiones y advertencias. Corregir requisitos ausentes antes de instalar. La voz es opcional: su ausencia se informa y no bloquea el servicio.
5. Ejecutar el BAT y verificar el servicio y el acceso HTTPS habitual con una cuenta personal. En una instalación previa, aplicar primero la migración durante mantenimiento descrita más abajo. La vista previa nunca instala ni activa el servicio.

El dictado graba con `MediaRecorder` en un navegador compatible y transcribe en este servidor mediante `.venv-voice/Scripts/python.exe`, `faster-whisper`, PyAV y el modelo local `data/models/whisper-base` (`model.bin`, `config.json`, `tokenizer.json`, `vocabulary.txt`). PyAV incorpora las bibliotecas FFmpeg usadas para decodificar; este transcriptor no necesita un `ffmpeg.exe` separado. No basta copiar un entorno virtual entre servidores: recrearlo con Python compatible y paquetes locales aprobados si sus rutas originales ya no existen. El instalador sólo consulta versiones presentes; no descarga paquetes/modelos ni envía audio a servicios externos. Un resultado de voz preparado confirma archivos y metadatos de paquetes, y requiere probar un dictado real bajo la cuenta del servicio para verificar carga del modelo y permisos.

En LAN el micrófono necesita HTTPS confiable, permiso del navegador y acceso personal; HTTP se admite sólo en loopback. Un micrófono visible no garantiza que el servidor tenga instalado el transcriptor. Sin Python, paquetes o modelo, se puede usar texto y el dictado local queda indisponible. Los modelos de IA y la voz no son requisitos para registrar/arrancar el servicio; sus funciones permanecen limitadas hasta preparar esos componentes locales.

El servicio usa el mismo supervisor `scripts/auto-start.mjs`. Concede lectura al código, configuración, Node y entornos Python, y escritura en `data`; el host compilado recibe sólo lectura/ejecución para LOCAL SERVICE. Conserva los permisos personales de la app y los certificados. Reinicia los procesos terminados con espera de 30 segundos a cinco minutos; Windows reintenta el host hasta tres veces, con 60 segundos entre intentos y contador restablecido cada 24 horas. Una caída del host cierra su árbol completo de procesos antes del reintento. No depende de que el ERP esté disponible al encender la PC.

El comando de instalación se puede repetir: si la misma versión ya está ejecutándose en esa ruta y cuenta, informa su estado sin reiniciarla. Una ruta, runtime o versión diferente exige mantenimiento. Si se usa OneDrive, marcar toda la carpeta y los modelos como **Mantener siempre en este dispositivo**; los archivos sólo en la nube y una VPN que exige sesión personal no estarán disponibles al arrancar Windows.

### Migrar una instalación que ya usa la tarea programada

El BAT detecta la tarea anterior y el supervisor/servidor activo y **rechaza interrumpirlos**. Comprobar SQLite y detener inmediatamente seguiría dejando una carrera con nuevas operaciones comerciales. Para preparar el servicio manteniendo la aplicación actual en marcha:

```bat
Instalar-servicio.bat --install-only
```

Registra CentralETAR **detenido y en inicio manual**; conserva el estado de la tarea anterior. No activa el servicio ni realiza la migración.

Para migrar, coordinar una ventana sin operaciones ni escalamiento activo. Desde PowerShell como administrador, comprobar que la acción de la tarea corresponde a esta carpeta antes de detenerla:

```powershell
Get-ScheduledTask -TaskName 'Central ETAR - Inicio automatico' | Select-Object -ExpandProperty Actions
# Verificar Execute, Arguments y WorkingDirectory de ESTA instalacion.
# Cuando no haya operaciones activas:
Stop-ScheduledTask -TaskName 'Central ETAR - Inicio automatico'
# Verificar que terminaron supervisor y servidor de esta instalacion.
# Si el servidor era externo a la tarea, detenerlo por su mecanismo de mantenimiento.
.\Instalar-servicio.bat
```

El instalador verifica la ruta esperada, activa SCM y deshabilita la tarea anterior después de confirmar el estado Running. La conserva para una vuelta atrás manual. Si falla la activación, deja SCM en inicio manual y no deshabilita la tarea anterior; revisar el error antes de reintentar. No borra datos ni detiene procesos desde el instalador. La instalación no verifica por sí sola que el ERP o HTTPS estén disponibles: comprobar los estados y el acceso habitual al terminar.

Verificación administrativa:

```powershell
Get-Service CentralETAR
Get-CimInstance Win32_Service -Filter "Name='CentralETAR'" | Select-Object Name, State, StartMode, StartName, PathName
sc.exe qfailure CentralETAR
Get-Content .\data\autostart.status.json
Invoke-RestMethod http://127.0.0.1:4310/health
```

Logs: `data/service-host.log` registra inicio/parada del host sin credenciales; los logs del supervisor y de cada proceso se describen más abajo. `Stop-Service CentralETAR` termina su árbol completo: usar sólo durante mantenimiento, después de finalizar las operaciones. Para volver a la tarea, detener SCM, ponerlo en inicio manual y habilitar/iniciar la tarea anterior durante esa misma ventana. Evitar activar ambos mecanismos.

La compilación y vista previa se prueban sin instalar ni detener servicios. La verificación completa de arranque al encender Windows, recuperación SCM y ejecución bajo LOCAL SERVICE requiere instalarlo durante mantenimiento y reiniciar el equipo; una vista previa correcta no significa que el servicio esté instalado.

## Mecanismo anterior: tarea programada

En PowerShell **como administrador**, desde la instalación ya configurada:

```powershell
.\scripts\instalar-inicio-automatico.ps1
```

Instala y activa la tarea **Central ETAR - Inicio automatico**, con disparador al arrancar Windows y demora de 20 segundos. No requiere iniciar sesión ni guardar la contraseña de un usuario. Ejecuta Node como **LOCAL SERVICE**, sin privilegios de administrador. Mantiene el acceso HTTPS, los usuarios y los roles de la misma instalación y `.env`; no crea otra base de datos.

El instalador concede a esa cuenta lectura del código, dependencias, configuración, certificado y Python de la instalación de voz; modificación sólo sobre `data` para SQLite, modelos, audio temporal y logs. La carpeta TLS protegida recibe lectura. También permite recorrer y listar las carpetas padre para validar rutas de modelos, sin herencia ni acceso al contenido de otros archivos del perfil. No publica archivos privados ni abre puertos adicionales. Después de mover la instalación, cambiar el runtime o renovar permisos de archivos, volver a ejecutar el instalador.

El supervisor inicia el servidor y el Ollama local instalado en `data/llm-runtime`. Ambos se ejecutan sin ventanas. Si un proceso termina —por ejemplo, porque el ERP todavía no está accesible durante el arranque— reintenta después de 30 segundos, aumentando hasta cinco minutos entre intentos. Windows también reinicia el supervisor si termina con error. No hay límite de duración ni condición de alimentación eléctrica para la tarea.

Reutiliza procesos que ya estén atendiendo los puertos. Si un puerto está ocupado y no puede verificar el servicio, registra el conflicto y espera: no termina el proceso ajeno. Un proceso propio vivo tampoco se reinicia por un fallo de `/health`; así se evita interrumpir operaciones por una demora de respuesta. Un bloqueo permanente requiere diagnóstico administrativo.

La PC debe permanecer encendida y conectada. Suspender o hibernar la PC interrumpe el acceso; esta instalación no modifica las opciones de energía. Si el ERP requiere una VPN, esa conexión debe poder establecerse sin sesión interactiva para que las consultas estén disponibles antes de ingresar a Windows. El supervisor reintenta, pero no configura ni inicia una VPN personal.

## Verificar

```powershell
Get-ScheduledTask -TaskName 'Central ETAR - Inicio automatico'
Get-ScheduledTaskInfo -TaskName 'Central ETAR - Inicio automatico'
Get-Content .\data\autostart.status.json
Invoke-RestMethod http://127.0.0.1:4310/health
```

Ejecutar los comandos de tareas desde PowerShell como administrador. Estado esperado de la tarea: `Running`. `LastTaskResult=267009` (0x41301) significa que sigue ejecutándose, no un error. En el JSON, `running` indica proceso iniciado por el supervisor con respuesta de salud; `external-running`, un proceso previo reutilizado. El supervisor actualiza el estado cada diez segundos aproximadamente. Verificar también la URL HTTPS desde otra PC con su certificado instalado y su cuenta personal.

Logs locales: `data/autostart.log`, `data/server.stdout.log`, `data/server.stderr.log`, `data/ollama.stdout.log`, `data/ollama.stderr.log`. El log del supervisor no incluye la configuración ni las contraseñas. Rota a `.previous` al superar 5 MB; los logs de procesos se rotan al siguiente arranque del proceso. Ninguno se sube a Git.

## Mantenimiento

Para evitar nuevos arranques automáticos sin interrumpir el proceso actual:

```powershell
Disable-ScheduledTask -TaskName 'Central ETAR - Inicio automatico'
```

Antes de detener la tarea o reiniciar la PC, esperar a que terminen las ejecuciones y el escalamiento automático. `Stop-ScheduledTask` puede terminar los procesos de la tarea; no es un mecanismo de cancelación de operaciones ERP. Durante mantenimiento, detener primero el supervisor para que no vuelva a lanzar el servidor que se está modificando.

Para habilitar y arrancar nuevamente:

```powershell
Enable-ScheduledTask -TaskName 'Central ETAR - Inicio automatico'
Start-ScheduledTask -TaskName 'Central ETAR - Inicio automatico'
```

El instalador se puede ejecutar de nuevo para actualizar la definición. Las credenciales de la app permanecen exclusivamente en `.env` local; los permisos personales se siguen verificando en el servidor.

Referencias: [cuenta de servicio del Programador de tareas](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal), [condiciones y reintentos de tareas](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset).

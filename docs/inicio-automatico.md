# Inicio al encender Windows

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

# Instalación en otro servidor Windows

Para las actualizaciones posteriores, usar **Actualizar-app.bat**, con respaldo y reversión: [instrucciones](actualizar-servidor.md). No volver a aplicar un ZIP privado de traslado sobre una instalación con usuarios en uso.

## Paquete de traslado

**AgenteETAR-PRIVADO-servidor.zip** contiene fuentes, `.env`, claves TLS, una copia consistente de SQLite con usuarios, roles, conversaciones y seguimientos, Qwen, Whisper y cachés de dependencias. **Contiene secretos y datos privados. No publicarlo en GitHub ni distribuirlo a los usuarios.** El ZIP no está cifrado: transferir por un medio privado protegido. El paquete público de fuentes excluye estos datos.

La copia corresponde a `snapshotAt` de `data/install-origin.json`. Si se sigue utilizando la PC anterior y se necesitan las novedades posteriores, generar otra copia definitiva durante mantenimiento. No sincroniza dos servidores. Usa la API de backup de SQLite, incluyendo WAL confirmado, y rechaza operaciones activas. No copia archivos SQLite activos como archivos independientes ni modifica el ERP.

## Mañana en el servidor de destino

El bootstrap también recrea el lector local de Excel, PDF e imágenes con OCR, para conservar los adjuntos. Incluye wheels con versiones/hashes fijados y el redistribuible Visual C++ x64: sólo instala este último si falta o es anterior a la versión requerida, comprobando su firma Microsoft. Los entornos se verifican con importaciones, carga de modelos locales y `pip check`.

1. Usar **Windows x64, Windows 10 / Server 2016 o posterior**, Windows PowerShell 5.1 y compilador .NET Framework 4.x. Extraer todo el ZIP a una carpeta local estable, por ejemplo `C:\AgenteETAR`. No ejecutarlo dentro del ZIP ni sobre la instalación original; evitar archivos sólo en la nube.
2. Abrir **Instalar-servicio.bat** y aceptar la elevación de Windows. `Instalar-servicio.bat --offline` usa exclusivamente las cachés incluidas. Sin esa opción puede descargar faltantes desde los orígenes y versiones fijados. Prepara Node, npm, Python, voz, Ollama y el modelo configurado.
3. Si detecta una sola IPv4 privada, configura HTTPS con esa IP, el nombre de la PC y la subred de su interfaz. Con varias redes/VPN pide elegirlas explícitamente mediante este comando (reemplazar los valores de ejemplo):

```powershell
.\scripts\instalar-servidor-completo.ps1 -Offline -LanAddress 192.168.1.20 -LanSubnet 192.168.1.0/24 -LanDnsName servidor-etar
```

La IP debe pertenecer al servidor y a la subred indicada. Genera un certificado nuevo y abre únicamente el puerto HTTPS para esa subred y perfiles Privado/Dominio. `-LocalOnly` instala expresamente sólo para uso en el servidor, sin entrada LAN.

4. Esperar el resultado final. **CentralETAR** queda bajo **LOCAL SERVICE**, con inicio automático diferido y recuperación ante caídas, sin login de Windows. No declara éxito hasta comprobar proceso, versión/huella, HTTP, HTTPS si está habilitado, una inferencia local y una transcripción de silencio con Whisper. Guarda `data/installation-verification.json` sin claves ni conversaciones. Un error informa instalación incompleta y devuelve código distinto de cero.
5. Distribuir **sólo `data/lan-client`** a las PC de usuarios. Instalar el certificado público con `instalar-certificado.ps1`, abrir la dirección de `LEEME.txt` e ingresar con el usuario personal existente. Se mantienen roles y permisos. El micrófono remoto necesita HTTPS confiable y permiso del navegador. No distribuir `.env`, SQLite, TLS privado ni el ZIP de traslado a los usuarios.

La velocidad de Qwen depende del hardware; las pruebas tienen plazos máximos y no suponen que haya GPU. Dejar espacio para descomprimir modelos, cachés y entornos además del ZIP.

## Evitar dos servidores operando el ERP

La preparación adapta las rutas locales y respalda `.env` en `data/install-backups`. La primera instalación arranca con **ERP_WRITE_ENABLED=false, LOCAL_WRITE_ENABLED=false, ERP_APPROVAL_AUTO_ESCALATE=false y ATTENTION_PUSH_ENABLED=false**. Conserva usuarios y roles; no concede permisos ni ejecuta propuestas. Usa **AI_PROVIDER=local** y el modelo de `AI_MODEL`.

Durante el traslado definitivo, terminar las operaciones y detener el mecanismo de inicio de la PC anterior. Revisar el `.env` original respaldado y reactivar sólo las opciones de escritura, escalamiento y push previamente autorizadas; reiniciar durante esa ventana. Las operaciones manuales conservan resúmenes y confirmaciones. Una prueba de arranque no habilita escrituras.

Protheus o KAIQEN pueden estar caídos: el servicio arranca, informa su estado y se reconecta cuando vuelve la red/VPN. Una fuente caída no resuelve seguimientos. El BAT no configura VPN ni exige conexión ERP para probar IA y voz. Una VPN personal que requiere login necesita preparación aparte para usarla antes de iniciar sesión.

## Comprobar y repetir

```bat
Instalar-servicio.bat --preview
Instalar-servicio.bat --prepare-only
Instalar-servicio.bat --install-only
```

`--preview` conserva la comprobación estática sin descargas ni cambios. `--prepare-only` prepara dependencias desde cachés y adapta el traslado sin registrar ni iniciar servicios. `--install-only` registra el servicio detenido y manual: no prueba ni afirma el arranque. Activar ejecutando el BAT sin esa opción durante mantenimiento.

El instalador completo rechaza cambiar dependencias o configuración cuando detecta servicio, tarea, supervisor o servidor activo. No borra entornos incompatibles ni sustituye runtimes activos. Para repetir sólo la verificación:

```powershell
.\data\node-runtime\node.exe .\scripts\verificar-instalacion.mjs --require-local-ai --require-voice
Get-Service CentralETAR
Get-Content .\data\installation-verification.json
```

Si utiliza Node del sistema, reemplazar la ruta portable por `node`. El verificador no envía la prueba al chat ni consulta documentos comerciales. El silencio acredita carga y decodificación del modelo; completar un dictado desde el navegador para comprobar micrófono y permiso personal.

## Integridad y generación

El ZIP contiene `PACKAGE-MANIFEST.json` con tamaño y SHA-256 por archivo. El BAT lo verifica antes de preparar componentes. Comparar también el SHA-256 del ZIP con el archivo `.sha256` entregado por un canal confiable. El manifiesto comprueba integridad; no es una firma del editor. Node, Python, Ollama, Whisper y wheels de voz tienen versiones/hashes fijados; npm utiliza `package-lock.json`.

```powershell
.\.venv-voice\Scripts\python.exe scripts/package-source.py --output data/install-package/AgenteETAR-fuentes.zip
.\.venv-voice\Scripts\python.exe scripts/package-source.py --include-local-state --include-local data/models --include-local data/llm-models --include-local data/llm-runtime --include-local data/install-cache --output data/install-package/AgenteETAR-PRIVADO-servidor.zip
```

Confirmar las fuentes en `main` antes de empaquetar: se utilizan archivos registrados en Git. No incluye informes comerciales, capturas, audio personal ni entornos virtuales de otra carpeta. Los entornos se recrean; el paquete privado incluye los modelos y cachés necesarios.

Las pruebas de integridad, instalación aislada y ejecución local no equivalen a verificar el arranque de la otra máquina. Registrar la activación SCM y el reinicio completo en el servidor de destino.

En esta entrega se verificaron por separado instalaciones portables offline de voz y del lector OCR, la instalación offline de las dependencias completas npm y la ejecución real de IA/voz/HTTPS de esta PC. No se sustituyó su tarea programada por SCM ni se reinició Windows para fabricar una prueba del otro servidor. La compilación del host y las rutas de registro se comprueban con pruebas controladas; la activación SCM de destino queda a cargo del BAT mañana.

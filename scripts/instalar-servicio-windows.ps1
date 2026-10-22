param([Alias('Preview')][switch]$Check, [switch]$InstallOnly, [string]$NodePath, [switch]$RequireLocalAI, [switch]$RequireVoice)
$ErrorActionPreference = 'Stop'
# Un BAT abierto desde PowerShell 7 puede heredar sus modulos incompatibles con
# Windows PowerShell 5.1. El instalador solo usa modulos incluidos en Windows.
if ($PSVersionTable.PSEdition -eq 'Desktop') {
    $env:PSModulePath = @((Join-Path $env:ProgramFiles 'WindowsPowerShell/Modules'), (Join-Path $PSHOME 'Modules')) -join ';'
}
$root = Split-Path $PSScriptRoot -Parent
$data = Join-Path $root 'data'
$serviceName = 'CentralETAR'
$legacyName = 'Central ETAR - Inicio automatico'
$source = Join-Path $PSScriptRoot 'windows-service-host.cs'
$runtime = Join-Path $data 'service-runtime'
$hostExe = Join-Path $runtime 'CentralETAR.Service.exe'
$sourceStamp = Join-Path $runtime 'source.sha256'
$installerElevated = $false
trap {
    Write-Host ('Instalacion incompleta: ' + $_.Exception.Message) -ForegroundColor Red
    if ($installerElevated) {
        try {
            [IO.Directory]::CreateDirectory($data) | Out-Null
            $_.Exception.Message | Set-Content -LiteralPath (Join-Path $data 'service-install-error.txt') -Encoding utf8
        } catch { }
    }
    exit 1
}
if ([Environment]::OSVersion.Version -lt [version]'10.0') { throw 'Se requiere Windows 10 / Server 2016 o posterior para Node 24.' }
foreach ($relative in @('.env', 'package.json', 'package-lock.json', 'scripts/auto-start.mjs', 'src/server.js', 'src/service-supervisor.js', 'scripts/windows-service-host.cs', 'scripts/service-path-access.ps1')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) { throw "Falta un archivo necesario: $relative" }
}
if ($NodePath) { $node = (Resolve-Path -LiteralPath $NodePath).Path }
elseif (Test-Path -LiteralPath (Join-Path $data 'node-runtime/node.exe')) { $node = Join-Path $data 'node-runtime/node.exe' }
else {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'Falta Node >=24.16.0 y <25. Instalarlo y ejecutar npm ci antes de continuar.' }
    $node = $nodeCommand.Source
}
foreach ($path in @($root, $node, $hostExe)) {
    if ($path.Contains('"') -or $path.EndsWith('\')) { throw 'Ruta no admitida para el servicio.' }
}
$nodeVersion = & $node --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.(\d+)\.(\d+)$') { throw 'No se pudo verificar Node.' }
$version = [version]$nodeVersion.Substring(1)
if ($version -lt [version]'24.16.0' -or $version -ge [version]'25.0.0') { throw 'Instalar Node >=24.16.0 y <25 antes de continuar.' }
# Inspeccion estatica: no importa la app, no conecta al ERP ni muestra .env.
$readinessCode = @'
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {createRequire,isBuiltin} from 'node:module';
const root=process.cwd(),require=createRequire(resolve(root,'package.json'));
const pkg=JSON.parse(readFileSync('package.json','utf8').replace(/^\uFEFF/,''));
const requiredModules=Object.keys(pkg.dependencies||{}).sort();
try { for(const name of requiredModules) require.resolve(name); }
catch { console.log(JSON.stringify({error:'No se pudieron validar .env y dependencias. Revisar configuracion y ejecutar npm ci.'})); process.exit(1); }
const seen=new Set(),assets=new Set();
function inspect(path,asset=false){
 path=resolve(path);
 if(!existsSync(path)) throw new Error('Falta un archivo necesario: '+relative(root,path));
 if(asset) assets.add(relative(root,path).replaceAll('\\','/'));
 if(seen.has(path))return;seen.add(path);
 const source=readFileSync(path,'utf8');
 if(/\.(m?js)$/.test(path)){
   for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)){
     const name=match[1];if(name.startsWith('.'))inspect(resolve(dirname(path),name),asset);
     else if(!isBuiltin(name))require.resolve(name);
   }
 }
 if(path.endsWith('index.html'))for(const match of source.matchAll(/(?:src|href)=["'](\/[^"'?#]+)["']/g))inspect(resolve(root,'public',match[1].slice(1)),true);
 if(path.endsWith('sw.js')){
   const shell=source.match(/const SHELL=\[([^;]+)\];/);
   if(!shell)throw new Error('No se pudo verificar el listado de recursos PWA.');
   for(const match of shell[1].matchAll(/['"]([^'"]+)['"]/g))inspect(resolve(root,'public',match[1]==='/'?'index.html':match[1].slice(1)),true);
 }
}
try{
 for(const path of ['src/server.js','scripts/auto-start.mjs','scripts/transcribe.py'])inspect(resolve(root,path));
 for(const path of ['index.html','sw.js','manifest.webmanifest'])inspect(resolve(root,'public',path),true);
 if((process.env.MODE||'live')==='live')inspect(resolve(root,process.env.ERP_MAPPING_PATH||process.env.CONFIG_PATH||'config/mapping.json'));
 if(process.env.LAN_HTTPS_ENABLED==='true')for(const key of ['LAN_TLS_PFX','LAN_TLS_PASSWORD_FILE']){
   if(!process.env[key]||!existsSync(resolve(root,process.env[key])))throw new Error('Falta archivo privado requerido por '+key+'. Revisar configuracion local.');
 }
 const sw=readFileSync('public/sw.js','utf8');
 const agentPath=resolve(root,'src/intelligence/agent.js');
 const agentVersion=existsSync(agentPath)?readFileSync(agentPath,'utf8').match(/\bversion:\s*['"](operativo-local-[^'"]+)['"]/)?.[1]:undefined;
 console.log(JSON.stringify({applicationVersion:pkg.version,agentVersion:agentVersion||'unknown',pwaVersion:sw.match(/const CACHE=['"]([^'"]+)['"]/)?.[1]||'unknown',requiredModules,publicAssets:[...assets].sort(),checkedFiles:seen.size,lanHttpsConfigured:process.env.LAN_HTTPS_ENABLED==='true'}));
}catch(error){console.log(JSON.stringify({error:error.message}));process.exitCode=1;}
'@
Push-Location -LiteralPath $root
try {
    $ErrorActionPreference = 'Continue'
    $readinessOutput = $readinessCode | & $node --env-file=.env --input-type=module 2>$null
    $readinessExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    try { $readiness = ($readinessOutput -join "`n") | ConvertFrom-Json } catch { throw 'No se pudieron validar .env y dependencias. Revisar configuracion y ejecutar npm ci.' }
    if ($readinessExit -ne 0) { if ($readiness.error) { throw $readiness.error }; throw 'No se pudieron validar .env y dependencias. Revisar configuracion y ejecutar npm ci.' }
} finally { $ErrorActionPreference = 'Stop'; Pop-Location }
# Voz opcional: consulta paquetes locales sin cargar modelos ni descargarlos.
$voicePython = Join-Path $root '.venv-voice/Scripts/python.exe'
$missingVoiceModel = @(@('model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt') | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root ('data/models/whisper-base/' + $_)) -PathType Leaf) })
$voicePackages = $null
if (Test-Path -LiteralPath $voicePython -PathType Leaf) {
    $ErrorActionPreference = 'Continue'
    $voiceOutput = & $voicePython -B -c "import json,sys,importlib.metadata as m; print(json.dumps({'python':sys.version.split()[0], 'fasterWhisper':m.version('faster-whisper'), 'pyav':m.version('av')}))" 2>$null
    $voiceExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($voiceExit -eq 0) { try { $voicePackages = ($voiceOutput -join "`n") | ConvertFrom-Json } catch { } }
}
$voiceReady = ($null -ne $voicePackages -and $missingVoiceModel.Count -eq 0)
$voiceReadiness = [ordered]@{
    ready = $voiceReady; optional = $true; pythonPresent = (Test-Path -LiteralPath $voicePython -PathType Leaf)
    versions = $voicePackages; missingModelFiles = $missingVoiceModel
    decoder = 'PyAV / bibliotecas FFmpeg del entorno Python; no requiere ffmpeg.exe separado'
    browser = 'MediaRecorder, permiso de microfono y HTTPS en LAN (HTTP solo loopback)'
    warning = $(if ($voiceReady) { 'Archivos y paquetes de voz presentes; probar dictado tras instalar con la cuenta del servicio.' } else { 'Dictado local no disponible: falta Python, paquetes de voz o modelo. No bloquea el arranque; no se descarga nada.' })
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe' }
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Falta el compilador local de .NET Framework 4.x. Habilitar .NET Framework en Windows.' }
$binaryPath = '"' + $hostExe + '" --root "' + $root + '" --node "' + $node + '"'
$sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
$existing = Get-CimInstance Win32_Service -Filter "Name='CentralETAR'"
$legacy = Get-ScheduledTask -TaskName $legacyName -ErrorAction SilentlyContinue
if ($existing -and $existing.PathName -ne $binaryPath) { throw 'CentralETAR ya pertenece a otra ruta/runtime. Revisar esa instalacion antes de continuar.' }
if ($legacy -and (@($legacy.Actions).Count -ne 1 -or $legacy.Actions[0].Arguments -ne ('"' + (Join-Path $root 'scripts/auto-start.mjs') + '"') -or $legacy.Actions[0].WorkingDirectory -ne $root)) {
    throw 'La tarea anterior pertenece a otra instalacion; no se modificara.'
}
if ($Check) {
    [ordered]@{
        mode = 'check'; mechanism = 'Windows SCM'; name = $serviceName; root = $root
        node = $node; nodeVersion = $nodeVersion; compiler = $compiler
        readiness = $readiness; voice = $voiceReadiness
        account = 'NT AUTHORITY\LocalService'; startup = 'Automatic delayed'
        recovery = '3 reinicios, 60 segundos entre intentos; contador restablecido cada 24h'
        binaryPath = $binaryPath; workingDirectory = $root
        currentService = $(if ($existing) { $existing.State } else { 'Absent' })
        legacyTask = $(if ($legacy) { [string]$legacy.State } else { 'Absent or not visible without administrator' })
        migration = 'No se detiene ningun proceso. Si la tarea/supervisor anterior sigue activo, instalar durante mantenimiento despues de detenerlo.'
        changesApplied = $false
    } | ConvertTo-Json
    exit 0
}
Write-Output ('Aplicacion ' + $readiness.applicationVersion + '; PWA ' + $readiness.pwaVersion + '; ' + $readiness.checkedFiles + ' archivos verificados.')
Write-Output $voiceReadiness.warning
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -NodePath "' + $node + '"'
    if ($InstallOnly) { $arguments += ' -InstallOnly' }
    if ($RequireLocalAI) { $arguments += ' -RequireLocalAI' }
    if ($RequireVoice) { $arguments += ' -RequireVoice' }
    $powershell = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $elevated = Start-Process -FilePath $powershell -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if ($elevated.ExitCode -ne 0) {
        $errorFile = Join-Path $data 'service-install-error.txt'
        if (Test-Path -LiteralPath $errorFile) { Write-Host (Get-Content -LiteralPath $errorFile -Raw) -ForegroundColor Red }
    } else {
        Write-Output 'Instalacion administrativa completada. Revisar CentralETAR en Servicios de Windows; --install-only lo deja detenido y manual.'
    }
    exit $elevated.ExitCode
}
$installerElevated = $true
function Confirm-ServiceReadiness {
    # La identidad HTTP debe pertenecer al arbol del host SCM actual, nunca a
    # otro listener ya presente ni a un PID guardado por una instalacion vieja.
    $ownedPid = $null
    $deadline = (Get-Date).AddSeconds(60)
    do {
        $scm = Get-CimInstance Win32_Service -Filter "Name='CentralETAR'"
        $pidPath = Join-Path $data 'server.pid'
        if ($scm.State -eq 'Running' -and $scm.StartName -eq 'NT AUTHORITY\LocalService' -and $scm.ProcessId -gt 0 -and (Test-Path -LiteralPath $pidPath)) {
            $candidate = (Get-Content -LiteralPath $pidPath -Raw).Trim()
            if ($candidate -match '^\d+$') {
                $ancestorId = [uint32]$candidate
                for ($level = 0; $level -lt 5 -and $ancestorId -gt 0; $level++) {
                    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$ancestorId"
                    if (-not $processInfo) { break }
                    if ($ancestorId -eq $scm.ProcessId) { $ownedPid = $candidate; break }
                    $ancestorId = $processInfo.ParentProcessId
                }
            }
        }
        if (-not $ownedPid) { Start-Sleep -Seconds 1 }
    } while (-not $ownedPid -and (Get-Date) -lt $deadline)
    if (-not $ownedPid) { throw 'No se pudo comprobar que el servidor pertenece a LOCAL SERVICE y al host SCM activo.' }
    $verifyArguments = @((Join-Path $PSScriptRoot 'verificar-instalacion.mjs'), '--root', $root, '--expected-pid', $ownedPid)
    if ($RequireLocalAI) { $verifyArguments += '--require-local-ai' }
    if ($RequireVoice) { $verifyArguments += '--require-voice' }
    $verification = & $node @verifyArguments
    if ($LASTEXITCODE -ne 0) { throw 'El servicio inicio pero no supero la verificacion HTTP/version/IA/voz. Revisar los codigos de verificacion y logs en data.' }
    # Solamente estado e identidades tecnicas, sin claves, audios ni filas ERP.
    $verification | Set-Content -LiteralPath (Join-Path $data 'installation-verification.json') -Encoding utf8
    Write-Output $verification
}
if ($existing -and $existing.State -eq 'Running') {
    if ($existing.StartName -ne 'NT AUTHORITY\LocalService' -or -not (Test-Path -LiteralPath $sourceStamp) -or (Get-Content -LiteralPath $sourceStamp -Raw).Trim() -ne $sourceHash) {
        throw 'El servicio esta activo con otra cuenta o version. Esperar el fin de operaciones y detenerlo durante mantenimiento antes de actualizar.'
    }
    Confirm-ServiceReadiness
    Write-Output 'CentralETAR ya esta instalado y verificado como LOCAL SERVICE. No se reinicio.'
    exit 0
}
# No cortar operaciones activas para migrar la tarea anterior al SCM.
if (-not $InstallOnly -and $legacy -and $legacy.State -eq 'Running') { throw 'La tarea anterior sigue activa. No se interrumpieron operaciones. Usar --install-only para preparar el servicio detenido, o migrar durante mantenimiento segun docs/inicio-automatico.md.' }
$activeSupervisor = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine.Contains('auto-start.mjs') })
if (-not $InstallOnly -and $activeSupervisor.Count -gt 0) { throw 'El supervisor anterior sigue activo. No se interrumpieron operaciones. Usar --install-only o migrar durante mantenimiento segun docs/inicio-automatico.md.' }
$pidFile = Join-Path $data 'server.pid'
if (-not $InstallOnly -and (Test-Path -LiteralPath $pidFile)) {
    $serverPidText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($serverPidText -match '^\d+$') {
        $priorServer = Get-CimInstance Win32_Process -Filter "ProcessId=$serverPidText"
        if ($priorServer -and $priorServer.Name -eq 'node.exe' -and $priorServer.CommandLine -match 'src[\\/]server\.js') {
            throw 'El servidor anterior sigue activo. Esperar el fin de operaciones y detenerlo durante mantenimiento antes de activar SCM; --install-only permite preparar sin interrumpirlo.'
        }
    }
}

[IO.Directory]::CreateDirectory($runtime) | Out-Null
$temporaryExe = Join-Path $runtime ('CentralETAR.' + [guid]::NewGuid().ToString('N') + '.exe')
try {
    & $compiler /nologo /target:exe /optimize+ /reference:System.ServiceProcess.dll "/out:$temporaryExe" $source
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar el servicio con .NET Framework local.' }
    & $temporaryExe --root $root --node $node --check
    if ($LASTEXITCODE -ne 0) { throw 'El ejecutable compilado no valido su configuracion.' }
    Move-Item -LiteralPath $temporaryExe -Destination $hostExe -Force
    $sourceHash | Set-Content -LiteralPath $sourceStamp -Encoding ascii
} finally {
    if (Test-Path -LiteralPath $temporaryExe) { Remove-Item -LiteralPath $temporaryExe -Force }
}

. (Join-Path $PSScriptRoot 'service-path-access.ps1')
function Grant-ServiceAccess([string]$Path, [string]$Rights) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    & icacls.exe $Path /grant "*S-1-5-19:$Rights" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron configurar los permisos de LOCAL SERVICE.' }
}
function Grant-Parents([string]$Path) {
    $ancestor = [IO.Directory]::GetParent($Path)
    while ($null -ne $ancestor) {
        Grant-ServicePathTraversal $ancestor.FullName
        $ancestor = $ancestor.Parent
    }
}
Grant-ServiceAccess $root '(RX)'
Grant-Parents $root
foreach ($file in @('.env', 'package.json', 'package-lock.json')) { Grant-ServiceAccess (Join-Path $root $file) '(R)' }
foreach ($directory in @('src', 'public', 'scripts', 'config', 'node_modules', '.venv-voice', '.venv-documents')) {
    Grant-ServiceAccess (Join-Path $root $directory) '(OI)(CI)(RX)'
}
Grant-ServiceAccess $data '(OI)(CI)(M)'
Grant-ServiceAccess (Join-Path $data 'tls') '(OI)(CI)(RX)'
Grant-ServiceAccess (Split-Path $node -Parent) '(RX)'
Grant-ServiceAccess $node '(RX)'
Grant-Parents (Split-Path $node -Parent)
foreach ($venvName in @('.venv-voice', '.venv-documents')) {
    $venvConfig = Join-Path $root "$venvName/pyvenv.cfg"
    if (Test-Path -LiteralPath $venvConfig) {
        $pythonHome = (Get-Content -LiteralPath $venvConfig | Where-Object { $_ -match '^home\s*=' } | Select-Object -First 1) -replace '^home\s*=\s*', ''
        if (-not $pythonHome -or -not (Test-Path -LiteralPath (Join-Path $pythonHome 'python.exe'))) { throw 'No se pudo localizar Python del entorno local.' }
        Grant-ServiceAccess $pythonHome '(OI)(CI)(RX)'
        Grant-Parents $pythonHome
    }
}
# El ejecutable del servicio nunca hereda escritura de LOCAL SERVICE en data.
$acl = Get-Acl -LiteralPath $runtime
$acl.SetAccessRuleProtection($true, $false)
foreach ($entry in @(@('S-1-5-18','FullControl'), @('S-1-5-32-544','FullControl'), @($identity.User.Value,'FullControl'), @('S-1-5-19','ReadAndExecute'))) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($entry[0]), [Security.AccessControl.FileSystemRights]$entry[1], 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.SetAccessRule($rule)
}
Set-Acl -LiteralPath $runtime -AclObject $acl

$startMode = if ($InstallOnly) { 'Manual' } else { 'Automatic' }
if ($existing) {
    $changed = Invoke-CimMethod -InputObject $existing -MethodName Change -Arguments @{PathName=$binaryPath; StartMode=$startMode; StartName='NT AUTHORITY\LocalService'; StartPassword=''}
} else {
    $changed = Invoke-CimMethod -ClassName Win32_Service -MethodName Create -Arguments @{Name=$serviceName; DisplayName='Central ETAR'; PathName=$binaryPath; StartMode=$startMode; StartName='NT AUTHORITY\LocalService'; ServiceType=[byte]16; ErrorControl=[byte]1}
}
if ($changed.ReturnValue -ne 0) { throw "Windows no pudo registrar el servicio (codigo $($changed.ReturnValue))." }
$scStartMode = if ($InstallOnly) { 'demand' } else { 'delayed-auto' }
& sc.exe config $serviceName start= $scStartMode | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo configurar el arranque automatico diferido.' }
& $hostExe --root $root --node $node --configure-recovery
if ($LASTEXITCODE -ne 0) { throw 'No se pudo configurar la recuperacion del servicio.' }
& sc.exe failureflag $serviceName 1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo configurar la recuperacion ante errores.' }
& sc.exe description $serviceName 'Central ETAR y su IA local. LOCAL SERVICE; sin inicio de sesion. Logs en data.' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo configurar la descripcion del servicio.' }
if (-not $InstallOnly) {
    try {
        Start-Service -Name $serviceName
        $service = Get-Service -Name $serviceName
        $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(30))
        Confirm-ServiceReadiness
        # La tarea queda disponible para una vuelta atras manual, deshabilitada.
        if ($legacy) { Disable-ScheduledTask -TaskName $legacyName | Out-Null }
    } catch {
        # Evitar dos mecanismos al proximo arranque. No matar un servidor que
        # haya podido iniciar ni alterar la tarea anterior en caso de fallo.
        Set-Service -Name $serviceName -StartupType Manual
        throw 'No se completo la activacion. CentralETAR queda en inicio manual; revisar data/service-host.log y la tarea anterior antes de reintentar.'
    }
}
[ordered]@{service=$serviceName; mechanism='Windows SCM'; account='LOCAL SERVICE'; root=$root; installedAt=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $data 'service-install.json') -Encoding utf8
if ($InstallOnly) { Write-Output 'Servicio CentralETAR preparado, detenido y en inicio manual. La tarea anterior conserva su estado. Para activarlo, migrar durante mantenimiento y ejecutar nuevamente el BAT sin opciones.' }
else { Write-Output 'Servicio CentralETAR instalado y activo como LOCAL SERVICE. Arranque automatico diferido; logs y estado en data.' }

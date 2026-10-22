param([Alias('Preview')][switch]$Check, [switch]$InstallOnly, [string]$NodePath)
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
if ([Environment]::OSVersion.Version -lt [version]'6.2') { throw 'Se requiere Windows 8 / Server 2012 o posterior.' }
foreach ($relative in @('.env', 'package.json', 'scripts/auto-start.mjs', 'src/server.js', 'src/service-supervisor.js', 'scripts/windows-service-host.cs', 'scripts/service-path-access.ps1')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) { throw "Falta un archivo necesario: $relative" }
}
if ($NodePath) { $node = (Resolve-Path -LiteralPath $NodePath).Path }
elseif (Test-Path -LiteralPath (Join-Path $data 'node-runtime/node.exe')) { $node = Join-Path $data 'node-runtime/node.exe' }
else { $node = (Get-Command node.exe -ErrorAction Stop).Source }
foreach ($path in @($root, $node, $hostExe)) {
    if ($path.Contains('"') -or $path.EndsWith('\')) { throw 'Ruta no admitida para el servicio.' }
}
$nodeVersion = & $node --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.(\d+)\.(\d+)$') { throw 'No se pudo verificar Node.' }
$version = [version]$nodeVersion.Substring(1)
if ($version -lt [version]'24.16.0' -or $version -ge [version]'25.0.0') { throw 'Instalar Node >=24.16.0 y <25 antes de continuar.' }
Push-Location -LiteralPath $root
try {
    $ErrorActionPreference = 'Continue'
    & $node --env-file=.env --input-type=module -e "import {createRequire} from 'node:module'; const require=createRequire(process.cwd()+'/package.json'); for(const name of Object.keys(require('./package.json').dependencies)) require.resolve(name);" 2>$null
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron validar .env y dependencias. Revisar configuracion y ejecutar npm ci.' }
} finally { $ErrorActionPreference = 'Stop'; Pop-Location }
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
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -NodePath "' + $node + '"'
    if ($InstallOnly) { $arguments += ' -InstallOnly' }
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
if ($existing -and $existing.State -eq 'Running') {
    if ($existing.StartName -ne 'NT AUTHORITY\LocalService' -or -not (Test-Path -LiteralPath $sourceStamp) -or (Get-Content -LiteralPath $sourceStamp -Raw).Trim() -ne $sourceHash) {
        throw 'El servicio esta activo con otra cuenta o version. Esperar el fin de operaciones y detenerlo durante mantenimiento antes de actualizar.'
    }
    Write-Output 'CentralETAR ya esta instalado y ejecutandose como LOCAL SERVICE. No se reinicio.'
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
foreach ($file in @('.env', 'package.json')) { Grant-ServiceAccess (Join-Path $root $file) '(R)' }
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

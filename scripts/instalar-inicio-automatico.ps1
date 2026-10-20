#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$taskName = 'Central ETAR - Inicio automatico'
$node = (Get-Command node -ErrorAction Stop).Source
$data = Join-Path $root 'data'
[IO.Directory]::CreateDirectory($data) | Out-Null
trap {
    $_.Exception.Message | Set-Content -LiteralPath (Join-Path $data 'autostart-install-error.txt') -Encoding utf8
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $root '.env'))) { throw 'Falta .env. Configurar Central antes de instalar su arranque.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) { throw 'Ejecutar npm ci antes de instalar el arranque.' }
if ($root.Contains('"') -or $node.Contains('"')) { throw 'La ruta no puede contener comillas.' }

# Cuenta de servicio sin contraseña ni privilegios de administrador.
# Lectura del código/configuración; escritura sólo en los datos de la aplicación.
function Grant-ServiceAccess([string]$Path, [string]$Rights) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    & icacls.exe $Path /grant "*S-1-5-19:$Rights" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo configurar el acceso de LOCAL SERVICE a $Path" }
}
Grant-ServiceAccess $root '(RX)'
# Ollama verifica la ruta completa de sus modelos. Necesita consultar atributos
# de los directorios padre, incluso si Windows permite atravesarlos implícitamente.
# Sin herencia ni permiso para leer el contenido de otros archivos del perfil.
$ancestor = [IO.Directory]::GetParent($root)
. (Join-Path $PSScriptRoot 'service-path-access.ps1')
while ($null -ne $ancestor) {
    Grant-ServicePathTraversal $ancestor.FullName
    $ancestor = $ancestor.Parent
}
foreach ($file in @('.env', 'package.json')) { Grant-ServiceAccess (Join-Path $root $file) '(R)' }
foreach ($directory in @('src', 'public', 'scripts', 'config', 'node_modules', '.venv-voice')) {
    Grant-ServiceAccess (Join-Path $root $directory) '(OI)(CI)(RX)'
}
Grant-ServiceAccess $data '(OI)(CI)(M)'
# La carpeta TLS tiene herencia desactivada: sólo requiere lectura.
Grant-ServiceAccess (Join-Path $data 'tls') '(OI)(CI)(RX)'
$venvConfig = Join-Path $root '.venv-voice/pyvenv.cfg'
if (Test-Path -LiteralPath $venvConfig) {
    $pythonHome = (Get-Content -LiteralPath $venvConfig | Where-Object { $_ -match '^home\s*=' } | Select-Object -First 1) -replace '^home\s*=\s*', ''
    if (-not $pythonHome -or -not (Test-Path -LiteralPath (Join-Path $pythonHome 'python.exe'))) { throw 'No se pudo localizar Python para la voz.' }
    Grant-ServiceAccess $pythonHome '(OI)(CI)(RX)'
}

$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + (Join-Path $root 'scripts/auto-start.mjs') + '"') -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT20S'
$principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Inicia Central ETAR y su IA local al encender Windows, sin iniciar sesión. Reintenta procesos terminados y espera la red.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
[ordered]@{ task = $taskName; account = 'LOCAL SERVICE'; installedAt = (Get-Date).ToString('o'); root = $root } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $data 'autostart-install.json') -Encoding utf8
Write-Output "Inicio automático instalado: $taskName. Estado en data/autostart.status.json."

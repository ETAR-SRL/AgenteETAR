$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $root '.env'))) { throw 'Falta el archivo .env local.' }
$settings = @{}
foreach ($line in [IO.File]::ReadAllLines((Join-Path $root '.env'))) {
    if ($line -match '^(PORT|LAN_HTTPS_ENABLED|LAN_PORT|LAN_ORIGINS)=(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
}
$httpPort = if ($settings.PORT) { [int]$settings.PORT } else { 4310 }
$lanEnabled = $settings.LAN_HTTPS_ENABLED -eq 'true'
$lanPort = if ($settings.LAN_PORT) { [int]$settings.LAN_PORT } else { 4311 }
$ports = @($httpPort)
if ($lanEnabled) { $ports += $lanPort }
if (Test-Path -LiteralPath (Join-Path $root 'data/llm-runtime/ollama.exe')) { & (Join-Path $root 'scripts/start-intelligence.ps1') }
if (Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue) {
    throw "Un puerto de Central ($($ports -join ', ')) ya está ocupado; no se inicia otro proceso."
}
$data = Join-Path $root 'data'
[System.IO.Directory]::CreateDirectory($data) | Out-Null
$node = (Get-Command node -ErrorAction Stop).Source
$process = Start-Process -FilePath $node -ArgumentList @('--env-file=.env','src/server.js') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'server.stdout.log') -RedirectStandardError (Join-Path $data 'server.stderr.log') -PassThru
[System.IO.File]::WriteAllText((Join-Path $data 'server.pid'), [string]$process.Id)
$ready = $false
for ($attempt=0; $attempt -lt 45; $attempt++) {
    $process.Refresh()
    if ($process.HasExited) { throw 'Central terminó durante el arranque. Revisá data/server.stderr.log.' }
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$httpPort/health" -TimeoutSec 2
        $lanReady = (-not $lanEnabled) -or [bool](Get-NetTCPConnection -State Listen -LocalPort $lanPort -ErrorAction SilentlyContinue)
        if ($health.status -eq 'up' -and $lanReady) { $ready=$true; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'Central aún no respondió. Revisá data/server.stderr.log antes de intentar otro arranque.' }
Write-Output "Central iniciado: proceso $($process.Id). Local: http://127.0.0.1:$httpPort/"
if ($lanEnabled) { Write-Output "Red HTTPS: $($settings.LAN_ORIGINS). Cada PC debe confiar en el certificado de data/lan-client." }

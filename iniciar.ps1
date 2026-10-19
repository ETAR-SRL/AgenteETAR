$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (Test-Path -LiteralPath (Join-Path $root 'data/llm-runtime/ollama.exe')) { & (Join-Path $root 'scripts/start-intelligence.ps1') }
if (Get-NetTCPConnection -State Listen -LocalPort 4310 -ErrorAction SilentlyContinue) {
    throw 'El puerto 4310 ya está ocupado; no se inicia otro proceso.'
}
if (-not (Test-Path -LiteralPath (Join-Path $root '.env'))) { throw 'Falta el archivo .env local.' }
$data = Join-Path $root 'data'
[System.IO.Directory]::CreateDirectory($data) | Out-Null
$node = (Get-Command node -ErrorAction Stop).Source
$process = Start-Process -FilePath $node -ArgumentList @('--env-file=.env','src/server.js') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'server.stdout.log') -RedirectStandardError (Join-Path $data 'server.stderr.log') -PassThru
[System.IO.File]::WriteAllText((Join-Path $data 'server.pid'), [string]$process.Id)
Write-Output ('Proceso iniciado: ' + $process.Id + '. Estado: http://127.0.0.1:4310/health')

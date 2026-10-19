$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$ready = $false
try { $health = Invoke-RestMethod 'http://127.0.0.1:4310/health' -TimeoutSec 3; $ready = $health.status -eq 'up' } catch {}
if (-not $ready) {
    & (Join-Path $root 'iniciar.ps1')
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try { $health = Invoke-RestMethod 'http://127.0.0.1:4310/health' -TimeoutSec 2; if ($health.status -eq 'up') { $ready=$true; break } } catch {}
    }
}
if (-not $ready) { throw 'No se pudo iniciar Central. Revisá la VPN y data/server.stderr.log.' }
Start-Process 'http://127.0.0.1:4310/'

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
try { $existing=Invoke-RestMethod 'http://127.0.0.1:11434/api/version' -TimeoutSec 2; if ($existing.version) { return } } catch {}
$exe=Join-Path $root 'data/llm-runtime/ollama.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Falta el motor local de inteligencia en data/llm-runtime.' }
$env:OLLAMA_HOST='127.0.0.1:11434'
$env:OLLAMA_MODELS=Join-Path $root 'data/llm-models'
$env:OLLAMA_NO_CLOUD='1'
$env:OLLAMA_NUM_PARALLEL='1'
$env:OLLAMA_IGPU_ENABLE='1'
$env:OLLAMA_VULKAN='1'
$env:OLLAMA_CONTEXT_LENGTH='8192'
$process=Start-Process -FilePath $exe -ArgumentList 'serve' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'data/ollama.stdout.log') -RedirectStandardError (Join-Path $root 'data/ollama.stderr.log') -PassThru
[IO.File]::WriteAllText((Join-Path $root 'data/ollama.pid'),[string]$process.Id)
for($i=0;$i -lt 30;$i++){Start-Sleep -Milliseconds 500;try{$version=Invoke-RestMethod 'http://127.0.0.1:11434/api/version' -TimeoutSec 2;if($version.version){Write-Output 'Motor de inteligencia local iniciado';return}}catch{}}
throw 'El motor local no inició a tiempo'

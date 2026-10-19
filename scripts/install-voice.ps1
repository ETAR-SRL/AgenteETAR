$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not (Test-Path '.venv-voice/Scripts/python.exe')) { python -m venv .venv-voice; if ($LASTEXITCODE) { throw 'No se pudo crear el entorno Python' } }
& ./.venv-voice/Scripts/python.exe -m pip install -r scripts/voice-requirements.txt
if ($LASTEXITCODE) { throw 'No se pudieron instalar las dependencias de voz' }
& ./.venv-voice/Scripts/python.exe -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-base', local_dir='data/models/whisper-base', allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.txt'])"
if ($LASTEXITCODE) { throw 'No se pudo descargar el modelo de voz' }

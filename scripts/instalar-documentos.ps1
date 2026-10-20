$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$python = Join-Path $root '.venv-documents/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    & python -m venv (Join-Path $root '.venv-documents')
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno. Instala Python 3.11 de 64 bits.' }
}
& $python -m pip install -r (Join-Path $PSScriptRoot 'requirements-documents.txt')
if ($LASTEXITCODE -ne 0) { throw 'Fallo al instalar dependencias del lector.' }
& $python -c "import openpyxl,xlrd,pdfplumber,pypdfium2; from rapidocr_onnxruntime import RapidOCR; RapidOCR(intra_op_num_threads=2,inter_op_num_threads=1)"
if ($LASTEXITCODE -ne 0) { throw 'Fallo al verificar Excel, PDF u OCR.' }
Set-Content -LiteralPath (Join-Path $root '.venv-documents/.ready') -Value 'local-documents-v1'
Write-Output 'Lector instalado. Si Central corre como servicio, aplica los permisos con instalar-inicio-automatico.ps1 desde una consola de administrador.'

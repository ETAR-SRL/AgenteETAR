"""Empaquetar sólo fuentes, configuración sin secretos e informes de conteos."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
files = []
for folder in ('src', 'public', 'test', 'docs', 'scripts', 'config'):
    files.extend(p for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
for name in ('README.md', 'AGENTS.md', 'package.json', 'package-lock.json', '.env.example', '.gitignore', 'iniciar.ps1', 'abrir-central.ps1'):
    files.append(root / name)
for name in ('erp-live-check.json', 'http-live-check.json', 'kaiqen-live-check.json', 'local-running-check.json', 'pwa-live-check.json', 'intelligence-live-check.json', 'learning-live-check.json', 'kaiqen-chat-live-check.json', 'ui-intelligence-check.json', 'quality-summary-live-check.json'):
    path = root / 'reports' / name
    if path.exists(): files.append(path)
output = root / 'centralizador-protheus-kaiqen.zip'
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(files):
        relative = path.relative_to(root)
        assert path.name != '.env' and relative.parts[0] not in ('data', 'node_modules', '.reference', '.venv-voice')
        archive.write(path, relative.as_posix())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    print(f'Paquete verificado: {len(archive.namelist())} archivos, {output.stat().st_size} bytes. Sin .env, bases locales, modelos ni capturas comerciales.')

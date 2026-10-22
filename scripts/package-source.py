"""Build verified source or explicitly private migration archives (stdlib only)."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
import socket
from pathlib import Path, PurePosixPath
import sqlite3
import stat
import subprocess
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

MANIFEST = 'PACKAGE-MANIFEST.json'
SOURCE_DIRS = {'src', 'public', 'test', 'docs', 'scripts', 'config'}
ROOT_FILES = {'README.md', 'AGENTS.md', 'package.json', 'package-lock.json',
              '.env.example', '.gitignore', 'iniciar.ps1', 'abrir-central.ps1',
              'Instalar-servicio.bat', 'Actualizar-app.bat'}
LOCAL_TREES = {'data/models', 'data/llm-models', 'data/llm-runtime', 'data/install-cache', 'data/aprendizaje'}
FORBIDDEN_SUFFIXES = {'.sqlite', '.db', '.key', '.pem', '.pfx', '.p12', '.log', '.zip'}


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)


def safe_file(root, relative):
    """Reject links/junctions anywhere in the path, including their ancestors."""
    relative = PurePosixPath(relative)
    if relative.is_absolute() or '..' in relative.parts or ':' in str(relative):
        raise ValueError('Ruta insegura en el paquete')
    current = root
    for part in relative.parts:
        current = current / part
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('El paquete no admite enlaces ni puntos de reanálisis')
    if not current.is_file():
        raise ValueError('El paquete requiere archivos regulares')
    return current


def source_files(root):
    result = {}
    for raw in git(root, 'ls-files', '-z').decode('utf-8').split('\0'):
        if not raw:
            continue
        path = PurePosixPath(raw)
        if raw not in ROOT_FILES and path.parts[0] not in SOURCE_DIRS:
            continue
        if (any(part in {'__pycache__', 'node_modules', 'reports', 'data'} for part in path.parts)
                or (path.name.startswith('.env') and raw != '.env.example')
                or path.suffix.lower() in FORBIDDEN_SUFFIXES
                or path.name.endswith(('-wal', '-shm'))):
            continue
        result[raw] = safe_file(root, raw)
    for required in ('package.json', 'package-lock.json', '.env.example', 'Instalar-servicio.bat'):
        if required not in result:
            raise ValueError('Falta un archivo de instalación obligatorio: ' + required)
    if 'src/maintenance.js' in result and 'scripts/update-release.mjs' in result and 'Actualizar-app.bat' not in result:
        raise ValueError('Falta el BAT de actualización de la versión con mantenimiento')
    return result


def add_tree(files, root, relative):
    directory = root / relative
    if not directory.is_dir():
        raise ValueError('No existe el directorio local solicitado: ' + relative)
    for base, directories, names in os.walk(directory, followlinks=False):
        directories[:] = [name for name in directories if name not in {'.cache', '__pycache__', '_logs'}]
        for name in directories + names:
            candidate = Path(base) / name
            info = candidate.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
                raise ValueError('El paquete no admite enlaces ni puntos de reanálisis')
        for name in names:
            if name.endswith('.log') or '.partial-' in name:
                continue
            if relative == 'data/llm-runtime' and name == 'ollama.zip':
                continue
            candidate = Path(base) / name
            archive_name = candidate.relative_to(root).as_posix()
            files[archive_name] = safe_file(root, archive_name)
    # Also check the requested directory itself and all ancestors, even if empty.
    current = root
    for part in PurePosixPath(relative).parts:
        current = current / part
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('El paquete no admite enlaces ni puntos de reanálisis')


def backup_database(source, destination):
    # SQLite backup includes committed WAL data without checkpointing the source.
    with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True, timeout=30)) as db:
        with closing(sqlite3.connect(destination)) as target:
            db.backup(target)
            if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('La copia SQLite no superó la comprobación de integridad')
            assert_no_active_operations(target)


def assert_no_active_operations(db):
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    checks = {
        'executions': ('executing',),
        'approval_escalations': ('executing',),
        'price_batches': ('checking', 'running'),
        'investigation_jobs': ('running',),
    }
    for table, statuses in checks.items():
        if table in tables:
            placeholders = ','.join('?' for _ in statuses)
            if db.execute(f'SELECT 1 FROM {table} WHERE status IN ({placeholders}) LIMIT 1', statuses).fetchone():
                raise ValueError('Hay operaciones en curso; esperar su finalización antes de migrar: ' + table)


def digest_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def verify_archive(path):
    with ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or MANIFEST not in names:
            raise ValueError('Manifiesto ausente o entradas duplicadas')
        manifest = json.loads(archive.read(MANIFEST))
        if manifest.get('schema') != 1 or not isinstance(manifest.get('files'), dict):
            raise ValueError('Manifiesto no compatible')
        expected = manifest['files']
        if set(names) != set(expected) | {MANIFEST}:
            raise ValueError('Archivos ausentes o adicionales respecto del manifiesto')
        for name, record in expected.items():
            pure = PurePosixPath(name)
            if (pure.is_absolute() or '..' in pure.parts or '\\' in name or ':' in name
                    or archive.getinfo(name).is_dir()):
                raise ValueError('Ruta insegura en el archivo ZIP')
            digest = hashlib.sha256()
            size = 0
            with archive.open(name) as stream:
                while block := stream.read(1024 * 1024):
                    size += len(block)
                    digest.update(block)
            if size != record['size'] or digest.hexdigest() != record['sha256']:
                raise ValueError('Archivo corrupto o modificado: ' + name)
        return manifest


def build_archive(root, output, private=False, include_local=()):
    root = root.resolve()
    if include_local and not private:
        raise ValueError('--include-local requiere --include-local-state')
    files = source_files(root)
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise ValueError('El destino ya existe; elija otro nombre para conservarlo')
    with tempfile.TemporaryDirectory(prefix='package-', dir=output.parent) as scratch_name:
        scratch = Path(scratch_name)
        if private:
            files['.env'] = safe_file(root, '.env')
            snapshot = scratch / 'agent.sqlite'
            backup_database(safe_file(root, 'data/agent.sqlite'), snapshot)
            files['data/agent.sqlite'] = snapshot
            origin = scratch / 'install-origin.json'
            origin.write_text(json.dumps({
                'sourceRoot': str(root), 'sourceHost': socket.gethostname(),
                'snapshotAt': datetime.now(timezone.utc).isoformat(),
            }, ensure_ascii=False, indent=2), encoding='utf-8')
            files['data/install-origin.json'] = origin
            if (root / 'data/tls').exists():
                add_tree(files, root, 'data/tls')
            for relative in include_local:
                relative = relative.replace('\\', '/').rstrip('/')
                if relative not in LOCAL_TREES:
                    raise ValueError('Directorio local no autorizado para migración')
                add_tree(files, root, relative)
        manifest = {
            'schema': 1,
            'updateProtocol': 1 if all(name in files for name in ('src/maintenance.js', 'scripts/update-maintenance.mjs', 'scripts/update-release.mjs')) else 0,
            'kind': 'private-migration' if private else 'source',
            'sensitive': private,
            'version': json.loads((root / 'package.json').read_text(encoding='utf-8'))['version'],
            'commit': git(root, 'rev-parse', 'HEAD').decode().strip(),
            'working_tree_dirty': bool(git(root, 'status', '--porcelain', '--untracked-files=no').strip()),
            'files': {},
        }
        temporary_zip = scratch / 'package.zip'
        with ZipFile(temporary_zip, 'w', ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for relative, path in sorted(files.items()):
                manifest['files'][relative] = {'size': path.stat().st_size, 'sha256': digest_file(path)}
                archive.write(path, relative)
            archive.writestr(MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2))
        verify_archive(temporary_zip)
        temporary_zip.replace(output)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--include-local-state', action='store_true', help='INCLUYE SECRETOS, usuarios, permisos y claves TLS; traslado privado solamente')
    parser.add_argument('--include-local', action='append', default=[], choices=sorted(LOCAL_TREES))
    parser.add_argument('--verify', type=Path, help='Verificar un paquete existente sin extraerlo')
    args = parser.parse_args()
    if args.verify:
        manifest = verify_archive(args.verify)
        print(f"Paquete verificado: {manifest['kind']}, {len(manifest['files'])} archivos.")
        return
    root = Path(__file__).resolve().parent.parent
    name = 'PRIVATE-migration.zip' if args.include_local_state else 'sources.zip'
    output = args.output or root / 'data' / 'install-package' / name
    manifest = build_archive(root, output, args.include_local_state, args.include_local)
    print(f"Paquete verificado: {manifest['kind']}, {len(manifest['files'])} archivos, {output.stat().st_size} bytes. {output.resolve()}")
    if args.include_local_state:
        print('PRIVADO: contiene credenciales, usuarios, permisos y claves TLS. No publicar ni versionar.')


if __name__ == '__main__':
    main()

"""Offline fixture tests: python -m unittest discover -s test -p test_package_source.py."""
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import warnings
from zipfile import ZipFile, ZIP_DEFLATED

spec = importlib.util.spec_from_file_location('packager', Path(__file__).resolve().parents[1] / 'scripts/package-source.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        contents = {
            'package.json': '{"version":"9.8.7"}', 'package-lock.json': '{}',
            '.env.example': 'SECRET=', 'Instalar-servicio.bat': '@echo off',
            'src/server.js': 'export const ok=true;', 'config/mapping.json': '{}',
            'reports/unsafe.json': '{"private":"customer"}',
            'docs/secret.key': 'private-key', '.env': 'SECRET=private-value',
            'data/tls/server.pfx': 'private-certificate',
            'data/models/voice.bin': 'model-fixture',
        }
        for relative, content in contents.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding='utf-8')
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True, capture_output=True)
        for args in (['add', '.'], ['-c', 'user.name=Tests', '-c', 'user.email=tests@example.invalid', 'commit', '-qm', 'Fixture']):
            subprocess.run(['git', '-C', str(self.root), *args], check=True, capture_output=True)
        self.db = sqlite3.connect(self.root / 'data/agent.sqlite')
        self.addCleanup(self.db.close)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE access_users(id TEXT, role_id TEXT)')
        self.db.execute("INSERT INTO access_users VALUES('personal-user','restricted-role')")
        self.db.execute('CREATE TABLE executions(status TEXT)')
        self.db.commit()

    def test_source_excludes_secrets_reports_and_database(self):
        output = self.root / 'source.zip'
        manifest = packager.build_archive(self.root, output)
        self.assertEqual(manifest['version'], '9.8.7')
        self.assertEqual(len(manifest['commit']), 40)
        self.assertFalse(manifest['sensitive'])
        self.assertEqual(set(manifest['files']), {'package.json', 'package-lock.json', '.env.example', 'Instalar-servicio.bat', 'src/server.js', 'config/mapping.json'})
        self.assertEqual(manifest, packager.verify_archive(output))

    def test_private_preserves_committed_wal_users_roles_and_models(self):
        output = self.root / 'private.zip'
        manifest = packager.build_archive(self.root, output, private=True, include_local=['data/models'])
        self.assertTrue(manifest['sensitive'])
        self.assertIn('.env', manifest['files'])
        self.assertIn('data/tls/server.pfx', manifest['files'])
        self.assertIn('data/models/voice.bin', manifest['files'])
        self.assertIn('data/install-origin.json', manifest['files'])
        self.assertNotIn('data/agent.sqlite-wal', manifest['files'])
        snapshot = self.root / 'snapshot.sqlite'
        with ZipFile(output) as archive:
            snapshot.write_bytes(archive.read('data/agent.sqlite'))
        with closing(sqlite3.connect(snapshot)) as copy:
            self.assertEqual(copy.execute('SELECT * FROM access_users').fetchall(), [('personal-user', 'restricted-role')])
        self.assertEqual(self.db.execute('SELECT * FROM access_users').fetchall(), [('personal-user', 'restricted-role')])

    def test_active_operation_refuses_private_archive(self):
        self.db.execute("INSERT INTO executions VALUES('executing')")
        self.db.commit()
        output = self.root / 'private.zip'
        with self.assertRaisesRegex(ValueError, 'operaciones en curso'):
            packager.build_archive(self.root, output, private=True)
        self.assertFalse(output.exists())

    def test_unauthorized_local_tree_refused(self):
        with self.assertRaises(ValueError):
            packager.build_archive(self.root, self.root / 'bad.zip', private=True, include_local=['data'])
        with self.assertRaises(ValueError):
            packager.build_archive(self.root, self.root / 'bad.zip', include_local=['data/models'])

    def test_manifest_detects_changed_missing_and_extra_files(self):
        output = self.root / 'source.zip'
        packager.build_archive(self.root, output)
        with ZipFile(output) as archive:
            original = {name: archive.read(name) for name in archive.namelist()}
        for mutation in ('changed', 'missing', 'extra', 'duplicate'):
            contents = dict(original)
            if mutation == 'changed':
                contents['src/server.js'] = b'changed'
            elif mutation == 'missing':
                del contents['src/server.js']
            elif mutation == 'extra':
                contents['extra.txt'] = b'extra'
            candidate = self.root / (mutation + '.zip')
            with ZipFile(candidate, 'w', ZIP_DEFLATED) as archive:
                for name, data in contents.items():
                    archive.writestr(name, data)
                if mutation == 'duplicate':
                    with warnings.catch_warnings():
                        warnings.simplefilter('ignore', UserWarning)
                        archive.writestr('src/server.js', b'duplicate')
            with self.assertRaises(ValueError):
                packager.verify_archive(candidate)

    def test_existing_output_never_overwritten(self):
        output = self.root / 'existing.zip'
        output.write_bytes(b'keep')
        with self.assertRaises(ValueError):
            packager.build_archive(self.root, output)
        self.assertEqual(output.read_bytes(), b'keep')

    def test_link_rejected(self):
        link = self.root / 'src/link.js'
        try:
            link.symlink_to(self.root / '.env')
        except (OSError, NotImplementedError):
            self.skipTest('Creating symlinks requires privileges on this Windows host')
        with self.assertRaises(ValueError):
            packager.safe_file(self.root, 'src/link.js')

    def test_windows_reparse_ancestor_rejected_without_link_privileges(self):
        real_lstat = Path.lstat

        def lstat(path):
            actual = real_lstat(path)
            if path == self.root / 'src':
                class ReparseInfo:
                    st_mode = actual.st_mode
                    st_file_attributes = 0x400
                return ReparseInfo()
            return actual

        with patch.object(Path, 'lstat', lstat):
            with self.assertRaisesRegex(ValueError, 'reanálisis'):
                packager.safe_file(self.root, 'src/server.js')

    def test_each_active_operation_guard(self):
        for table, statuses in {
            'executions': ['executing'],
            'approval_escalations': ['executing'],
            'price_batches': ['checking', 'running'],
            'investigation_jobs': ['running'],
        }.items():
            with closing(sqlite3.connect(':memory:')) as db:
                db.execute(f'CREATE TABLE {table}(status TEXT)')
                for status in statuses:
                    db.execute(f'DELETE FROM {table}')
                    db.execute(f'INSERT INTO {table} VALUES(?)', (status,))
                    with self.assertRaisesRegex(ValueError, 'operaciones en curso'):
                        packager.assert_no_active_operations(db)


if __name__ == '__main__':
    unittest.main()

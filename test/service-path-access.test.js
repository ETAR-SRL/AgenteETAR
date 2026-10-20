import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Windows: acceso de ruta no hereda permisos a hijos y preserva las ACL existentes', {skip: process.platform !== 'win32'}, () => {
  // Windows PowerShell no puede importar los módulos de PowerShell 7 del padre.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
  const result = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('./service-path-access.ps1', import.meta.url)),
  ], {encoding: 'utf8', windowsHide: true, timeout: 30_000, env});
  assert.match(result, /idempotente/);
});

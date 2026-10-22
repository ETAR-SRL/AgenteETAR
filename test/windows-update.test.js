import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Windows PS5: actualizacion y rollback conservan datos con SCM simulado en TEMP', {skip: process.platform !== 'win32'}, () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
  const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('./windows-update.ps1', import.meta.url))], {
    encoding: 'utf8', windowsHide: true, timeout: 120_000, env,
  });
  assert.match(output, /Actualizacion y rollback verificados/);
  assert.match(output, /SCM simulado; solo carpetas temporales/);
});

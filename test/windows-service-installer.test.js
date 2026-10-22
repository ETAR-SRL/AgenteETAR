import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Windows: instalador SCM compila y valida sin alterar el arranque de produccion', {skip: process.platform !== 'win32'}, () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
  const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('./windows-service-installer.ps1', import.meta.url))], {
    encoding: 'utf8', windowsHide: true, timeout: 60_000, env,
  });
  assert.match(output, /preview sin cambios ni secretos/);
  assert.match(output, /No se registro ni inicio ningun servicio/);
});

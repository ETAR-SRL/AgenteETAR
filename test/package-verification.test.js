import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/verificar-paquete.ps1', import.meta.url));
const record = text => ({size: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex')});
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));

test('Windows: verifica fuentes extraidas antes de instalar dependencias y detecta alteraciones', {skip: process.platform !== 'win32'}, t => {
  const root = mkdtempSync(join(tmpdir(), 'etar-package-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'data', 'models'), {recursive:true});
  const content = 'export const fixture = true;';
  writeFileSync(join(root, 'src', 'server.js'), content);
  writeFileSync(join(root, 'data', 'models', 'fixture.bin'), 'model');
  writeFileSync(join(root, '.env'), 'TOKEN=fixture');
  const files = {'src/server.js': record(content), 'data/models/fixture.bin': record('model'), '.env': record('TOKEN=fixture')};
  const save = value => writeFileSync(join(root, 'PACKAGE-MANIFEST.json'), typeof value === 'string' ? value : JSON.stringify(value));
  const invoke = installed => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Root', root, ...(installed ? ['-Installed'] : [])], {encoding:'utf8', windowsHide:true, timeout:30_000, env});
  save({schema:1, files});
  let result = invoke(false);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /verificada: 3 archivos/);

  writeFileSync(join(root, 'src', 'server.js'), content.replace('true', 'fake'));
  result = invoke(false);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Contenido distinto/);
  writeFileSync(join(root, 'src', 'server.js'), content);
  writeFileSync(join(root, '.env'), 'TOKEN=changed-after-install');
  assert.equal(invoke(false).status, 1);
  assert.equal(invoke(true).status, 0);
  writeFileSync(join(root, 'data', 'models', 'fixture.bin'), 'tampered-model');
  assert.equal(invoke(true).status, 1);
  writeFileSync(join(root, 'data', 'models', 'fixture.bin'), 'model');

  for (const invalid of ['../outside', '/absolute', 'C:/drive', 'src\\server.js', 'src/../server.js', 'src/server.js ']) {
    save({schema:1, files:{[invalid]:record('x')}});
    assert.equal(invoke(false).status, 1, invalid);
  }
  const metadata = JSON.stringify(record(content));
  save(`{"schema":1,"files":{"src/server.js":${metadata},"src/server.js":${metadata}}}`);
  assert.equal(invoke(false).status, 1);
  save({schema:1, files:{'src/server.js':record(content), 'SRC/server.js':record(content)}});
  assert.equal(invoke(false).status, 1);
  save({schema:1, files:{'src/missing.js':record(content)}});
  assert.equal(invoke(false).status, 1);
  save({schema:1, files:{}});
  assert.equal(invoke(false).status, 1);
});

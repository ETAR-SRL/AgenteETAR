import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Windows PS5: configuracion LAN valida SAN/EKU, conserva secretos y limpia certificados sin modificar Windows', {skip:process.platform!=='win32'},()=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath'));
  const output=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./server-network.ps1',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:60000,env});
  assert.match(output,/SAN y EKU separados/);assert.match(output,/rechazos antes de escribir/);assert.match(output,/limpieza en exito y fallo/);assert.ok(!output.includes('secreto-no-publicar-987654321'));
});

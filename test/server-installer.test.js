import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('full BAT routes preparation and offline install explicitly while preserving preview',()=>{
 const bat=readFileSync(new URL('../Instalar-servicio.bat',import.meta.url),'utf8');
 assert.match(bat,/:instalar\s+powershell[^\r\n]+instalar-servidor-completo\.ps1/);
 assert.match(bat,/:preview\s+powershell[^\r\n]+instalar-servicio-windows\.ps1[^\r\n]+-Check/);
 assert.match(bat,/:dependencias\s+powershell[^\r\n]+-PrepareOnly -Offline/);
 assert.match(bat,/:offline\s+powershell[^\r\n]+-Offline/);
});
test('Windows preparation refuses a live supervisor before touching private config or dependencies',{skip:process.platform!=='win32'},()=>{
 const root=mkdtempSync(join(tmpdir(),'ETAR servidor ocupado ñ '));
 try{
  mkdirSync(join(root,'scripts'));mkdirSync(join(root,'data'));
  copyFileSync(fileURLToPath(new URL('../scripts/instalar-servidor-completo.ps1',import.meta.url)),join(root,'scripts/instalar-servidor-completo.ps1'));
  const secret='API_READ_KEY=secret-not-to-print\n';writeFileSync(join(root,'.env'),secret);writeFileSync(join(root,'data/autostart.status.json'),JSON.stringify({pid:process.pid}));
  const child=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/instalar-servidor-completo.ps1'),'-PrepareOnly'],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.ifError(child.error);assert.equal(child.status,1);assert.match(child.stdout,/activo|ejecucion/i);assert.ok(!child.stdout.includes('secret-not-to-print'));
  assert.equal(readFileSync(join(root,'.env'),'utf8'),secret);assert.deepEqual(readdirSync(join(root,'data')),['autostart.status.json']);
 }finally{rmSync(root,{recursive:true,force:true});}
});

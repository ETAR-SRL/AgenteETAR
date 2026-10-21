import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/erp-connection-ui.js',import.meta.url),'utf8').replace('export ','');
test('PWA distinguishes ERP unavailable from Central offline and refreshes capabilities only on transitions without losing the chat',async()=>{
 const badge={textContent:'',classList:{toggle(){},add(){}}},banner={textContent:'',classList:{toggle(){},remove(){}}};let online=false,lastConnected=null,network=true,changes=0,tick;
 const context={document:{hidden:false,querySelector:s=>s==='#connection'?badge:banner,addEventListener(){}},window:{addEventListener(){}},setInterval:fn=>{tick=fn;return 1;},clearInterval(){}};
 vm.runInNewContext(source,context);
 const view=context.installErpConnection({api:async()=>{if(!network)throw Error('offline');return {state:online?'available':'unavailable',available:online,lastConnected};},initial:{available:false,state:'unavailable',lastConnected:null},onChange:async()=>{changes++;}});
 assert.match(banner.textContent,/sin verificar, no resueltos/);assert.match(badge.textContent,/Protheus sin conexión/);await view.check();assert.equal(changes,0);
 online=true;lastConnected='2026-10-21T20:00:00Z';await view.check();assert.equal(changes,1);assert.equal(badge.textContent,'Servicio real');await view.check();assert.equal(changes,1);
 online=false;await view.check();assert.equal(changes,2);network=false;await view.check();assert.match(badge.textContent,/Central/);assert.match(banner.textContent,/no se dieron por resueltos/);assert.equal(changes,2);assert.equal(typeof tick,'function');
});

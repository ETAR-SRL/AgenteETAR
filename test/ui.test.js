import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createDemoErp,createDemoKaiqen } from '../src/demo.js';
import { Store } from '../src/store.js';
import { plan } from '../src/planner.js';
import http from 'node:http';
import {Access} from '../src/access.js';
const readKey='reader-test-key-000000000000000000000',planKey='planner-test-key-00000000000000000000';
async function setup(t){
 const store=new Store(':memory:'),access=new Access(store,['0101']);
 const admin=await access.setup({username:'admin',name:'Admin prueba',password:'Clave-de-prueba-123'});
 const role=access.saveRole(admin.principal,{name:'Lector',permissions:['read:clientes','read:costos','read:catalogo'],branches:['0101']});
 await access.saveUser(admin.principal,{username:'lector',name:'Lector prueba',roleId:role.id,active:true,password:'Clave-de-prueba-123'});
 const server=createApp({erp:createDemoErp(),kaiqen:createDemoKaiqen(),store,mode:'demo',readKey,planKey,voice:{status:()=>({available:true}),transcribe:async()=>({text:'mostrar proyectos',externalAudio:false})}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();store.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 return {origin,request:(path,init)=>fetch(origin+path,init)};
}
test('local session requires exact origin, rejects DNS rebinding and cross-site, has reader role only',async t=>{
 const {origin,request}=await setup(t);
 assert.equal((await request('/api/ui/session',{method:'POST'})).status,403);
 assert.equal((await request('/api/ui/session',{method:'POST',headers:{origin:'https://other.example'}})).status,403);
 const rebind=await new Promise((resolve,reject)=>{http.get(origin+'/',{headers:{Host:'hostile.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(rebind,403);
 assert.equal((await request('/api/ui/session',{method:'POST',headers:{origin}})).status,401);
 const response=await request('/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:'lector',password:'Clave-de-prueba-123'})});assert.equal(response.status,200);
 const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 const headers={cookie:cookie.split(';')[0],origin,'content-type':'application/json'};
 assert.equal((await request('/api/erp/clientes?sucursal=0101',{headers})).status,200);
 assert.equal((await request('/api/agent/query',{method:'POST',headers:{...headers,origin:'https://other.example'},body:'{}'})).status,403);
 assert.equal((await request('/api/changes/preview',{method:'POST',headers,body:'{}'})).status,403);
 assert.equal((await request('/api/voice/transcribe',{method:'POST',headers,body:'{}'})).status,200);
 assert.equal((await request('/api/voice/transcribe',{method:'POST'})).status,401);
 const query=await request('/api/agent/query',{method:'POST',headers,body:JSON.stringify({text:'mostrame los costos',context:{sucursal:'0101'}})});assert.equal(query.status,200);
});
test('PWA serves local shell without credentials, cache limited to static allowlist',async t=>{
 const {request}=await setup(t);
 for(const path of ['/','/access-ui.js','/app.js','/style.css','/manifest.webmanifest','/icon-192.png','/icon-512.png','/sw.js']){
  const response=await request(path);assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const text=await response.text();assert.ok(!text.includes(readKey));assert.ok(!text.includes(planKey));
 }
 const manifest=await(await request('/manifest.webmanifest')).json();assert.equal(manifest.display,'standalone');
 const sw=await(await request('/sw.js')).text();assert.match(sw,/!SHELL\.includes\(url\.pathname\)/);assert.ok(!sw.includes("'/api/"));
 assert.equal((await request('/.env')).status,401);
});
test('voice phrasing preserves exact scopes and never silently drops unsupported filters',()=>{
 assert.deepEqual(plan('Mostrame los costos producto ABC-001.',{sucursal:'0101'}).filters,{producto:'ABC-001',sucursal:'0101'});
 assert.deepEqual(plan('¿Qué ventas tengo pendientes?',{sucursal:'0101'}).filters,{pendiente:'true',sucursal:'0101'});
 assert.equal(plan('Mostrar proyectos.').resource,'proyectos');
 assert.equal(plan('calidad de este proyecto',{proyecto:'abc-123'}).filters.proyecto,'abc-123');
 assert.throws(()=>plan('calidad de este proyecto'),{code:'PROYECTO_REQUERIDO'});
 assert.throws(()=>plan('costos de todas las sucursales',{sucursal:'0101'}));
 assert.throws(()=>plan('mostrame los costos producto ABC borrar clientes',{sucursal:'0101'}));
});

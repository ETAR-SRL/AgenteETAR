import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {Access} from '../src/access.js';
import {createApp} from '../src/app.js';
import {createDemoErp} from '../src/demo.js';
import {createReadSource} from '../src/read-source.js';
import {createModelSettings} from '../src/intelligence/model-settings.js';
import {Memory} from '../src/intelligence/memory.js';

const password='Prueba-integracion-2026';
const permissions=['read:ventas','read:clientes','read:preciosVenta','read:catalogo','read:conocimiento','read:proyectos','read:calidad'];
async function fixture(t,{outage=false}={}){
 const directory=mkdtempSync(join(tmpdir(),'etar-evolution-http-')),store=new Store(':memory:'),access=new Access(store,['0101','0202']);
 const admin=await access.setup({username:'admin',name:'Admin de prueba',password}),role=access.saveRole(admin.principal,{name:'Consulta comercial',permissions,branches:['0101']});
 const readers=[];for(const username of ['lector','otrolector']){const u=await access.saveUser(admin.principal,{username,name:username,roleId:role.id,active:true,password});readers.push({id:u.id,token:access.session(u.id)});}
 let externalCalls=0,documentCalls=0,writes=0;const erpCalls=[];
 const modelSettings=createModelSettings({path:join(directory,'ai.json'),local:{name:'test-local',complete:async()=>assert.fail('No local model needed'),status:async()=>({available:true,local:true})},fetchImpl:async()=>{externalCalls++;return Response.json({status:'completed',output:[{type:'function_call',name:'structured_result',arguments:JSON.stringify({action:'responder',args:{},answer:'¿Qué dato necesitás?'})}]});}});
 modelSettings.save({provider:'openai',model:'synthetic-test-model',apiKey:'synthetic-not-a-real-key'});
 const row={registro:'1',kind:'sale',sucursal:'0101',numero:'000123',serie:'',item:'01',producto:'Z1',tercero:'C1',tienda:'01',nombre:'CLIENTE FICTICIO',unidad:'UN',fecha:'2026-10-19',moneda:'2',monedaNombre:'DOLAR',cantidad:'500',pedida:'1500',atendida:'1000',precio:'0.06',importe:'30',devuelta:'0',vigente:1};
 const demo=createDemoErp(),erp={...demo,metadata:()=>({...demo.metadata(),entities:{...demo.metadata().entities,atencionVentas:{operational:true},atencionCompras:{operational:true},atencionRemitos:{operational:true}}}),list:async(resource,params)=>{erpCalls.push(resource);if(resource.startsWith('atencion'))return {data:resource==='atencionVentas'&&(!params.has('numero')||params.get('numero')==='000123')?[structuredClone(row)]:[],meta:{hasMore:false}};return demo.list(resource,params);},writes:{enabled:false,prepare:async()=>{writes++;},check:async()=>{writes++;},execute:async()=>{writes++;}}};
 const protectedProject={id:'p1',name:'Proyecto sintético privado',sin_ia_externa:true,sin_ia_externa_por_cliente:false};
 const kaiqen=createReadSource({factory:()=>({projects:async()=>{if(outage)throw Error('private-host-or-secret');return {data:[protectedProject]};},project:async()=>({data:{project:protectedProject}}),quality:async()=>({data:{domains:{}}})})});await kaiqen.run();
 const providers={google:{clientId:'synthetic-client',clientSecret:'synthetic-secret',redirectUri:'http://127.0.0.1/callback'}};
 const server=createApp({store,erp,kaiqen,branches:['0101','0202'],mode:'demo',readKey:'r'.repeat(40),planKey:'p'.repeat(40),modelSettings,attentionOptions:{intervalMs:30000},corporateOptions:{key:'ab'.repeat(32),providers,fetchImpl:async()=>{documentCalls++;throw Error('Network forbidden in integration');}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;providers.google.redirectUri=origin+'/api/corporate-documents/oauth/google/callback';
 t.after(async()=>{await server.jobs.stop();await server.attention.stop();await kaiqen.close();server.close();server.closeAllConnections();store.close();rmSync(directory,{recursive:true,force:true});});
 const request=async(path,{token=readers[0].token,method='GET',body,cookie}={})=>{const r=await fetch(origin+path,{method,redirect:'manual',headers:{origin,...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data,headers:r.headers};};
 return {store,access,admin,role,readers,server,request,origin,modelSettings,erpCalls,get externalCalls(){return externalCalls;},get documentCalls(){return documentCalls;},get writes(){return writes;}};
}

test('HTTP startup with KAIQEN down preserves ERP, personal daily scope and async investigation completion',async t=>{
 const f=await fixture(t,{outage:true}),req=f.request;
 assert.equal((await req('/health',{token:null})).status,200);const status=await req('/api/sources/status');assert.equal(status.status,200);assert.equal(status.data.kaiqen.state,'unavailable');assert.ok(!JSON.stringify(status.data).includes('private-host'));assert.equal((await req('/api/erp/productos?sucursal=0101')).status,200);
 const settings=await req('/api/attention/daily/settings',{method:'PUT',body:{enabled:true,time:'08:30',timeZone:'America/Argentina/Buenos_Aires'}});assert.equal(settings.status,200);assert.equal(settings.data.time,'08:30');assert.equal((await req('/api/attention/daily/settings',{token:f.readers[1].token})).data.enabled,false);assert.equal((await req('/api/attention/daily?sucursal=0202')).status,403);
 const follow=await req('/api/agent/chat',{method:'POST',body:{text:'Seguí el pedido de venta 123',context:{sucursal:'0101'}}});assert.equal(follow.status,200);const item=follow.data.attention.data[0];assert.equal(item.target.numero,'000123');
 const daily=await req('/api/attention/daily?sucursal=0101',{method:'POST',body:{sucursal:'0101'}});assert.equal(daily.status,200);assert.ok(Object.values(daily.data.sections).flat().some(i=>i.id===item.id));
 const created=await req('/api/investigations',{method:'POST',body:{itemId:item.id,branch:'0101'}});assert.equal(created.status,202);assert.equal(created.data.status,'queued');assert.equal((await req('/api/investigations/'+created.data.id,{token:f.readers[1].token})).status,404);
 await f.server.jobs.run();const result=await req('/api/investigations/'+created.data.id);assert.equal(result.status,200);assert.equal(result.data.status,'completed');assert.equal(result.data.result.background,true);assert.ok(result.data.result.investigation.facts.length>0);assert.equal((await req('/api/attention/'+item.id)).data.item.caseDetails.investigations.length,1);assert.equal(f.externalCalls,0);assert.equal(f.writes,0);
});

test('HTTP corporate documents require separate permission and delegated connection; OAuth callback is browser-bound without provider traffic',async t=>{
 const f=await fixture(t),req=f.request;
 const login=await req('/api/auth/login',{token:null,method:'POST',body:{username:'lector',password}});assert.equal(login.status,200);assert.ok(login.headers.get('set-cookie'));
 const source={id:'manuales',provider:'google',label:'Guías sintéticas',enabled:true,users:[f.readers[0].id],roles:[],locations:[{id:'planta',label:'Planta',folderId:'synthetic-folder'}]};assert.equal((await req('/api/corporate-documents',{token:f.admin.token,method:'POST',body:source})).status,200);
 const denied=await req('/api/corporate-documents');assert.equal(denied.status,200);assert.deepEqual(denied.data.sources,[]);assert.equal((await req('/api/corporate-documents/search?connectionId=manuales&locationId=planta&query=manual')).status,403);
 const update=await req('/api/admin/roles/'+f.role.id,{token:f.admin.token,method:'PUT',body:{name:'Con documentos',permissions:[...permissions,'read:documentos'],branches:['0101']}});assert.equal(update.status,200);
 const list=await req('/api/corporate-documents');assert.equal(list.data.sources[0].connected,false);assert.deepEqual((await req('/api/corporate-documents',{token:f.readers[1].token})).data.sources,[]);
 assert.notEqual((await req('/api/corporate-documents/search?connectionId=manuales&locationId=planta&query=manual')).status,200);
 // This HTTP loopback fixture cannot establish an HTTPS delegated redirect.
 // The callback must still reject a forged code before any provider request.
 const state='synthetic-browser-bound-state';
 const missing=await req('/api/corporate-documents/oauth/google/callback?state='+encodeURIComponent(state)+'&code=synthetic',{token:null});assert.equal(missing.status,303);assert.equal(missing.headers.get('location'),'/?documents=failed');
 const mismatch=await req('/api/corporate-documents/oauth/google/callback?state='+encodeURIComponent(state)+'&code=synthetic',{token:null,cookie:'central_docs_google=another-browser'});assert.equal(mismatch.status,303);assert.equal(mismatch.headers.get('location'),'/?documents=failed');assert.equal(f.documentCalls,0);assert.equal(f.externalCalls,0);
});

test('HTTP approved knowledge rechecks ACL and role changes while protected KAIQEN history blocks all external transport',async t=>{
 const f=await fixture(t),req=f.request;
 const input={title:'Guía sintética aprobada',text:'Verificá en el ERP antes de preparar el cambio.',provenance:'Responsable de prueba, edición 1',branch:'0101',requiredResources:['productos'],users:[f.readers[0].id],roles:[],status:'approved'};
 const saved=await req('/api/knowledge',{token:f.admin.token,method:'POST',body:input});assert.equal(saved.status,200);assert.equal((await req('/api/knowledge?branch=0101')).data.data.length,1);assert.equal((await req('/api/knowledge?branch=0101',{token:f.readers[1].token})).data.data.length,0);assert.equal((await req('/api/knowledge/'+saved.data.id,{token:f.readers[1].token})).status,404);assert.equal((await req('/api/knowledge?branch=0101&management=true')).status,403);
 const direct=await req('/api/kaiqen/projects');assert.equal(direct.status,200);assert.equal(direct.data.data[0].sin_ia_externa,true);assert.equal(f.externalCalls,0);
 const p=f.access.principal(f.readers[0].id),memory=new Memory(f.store),conversation=memory.conversation(undefined,p.actor);conversation.messages=[{role:'user',content:'Investigá el proyecto'},{role:'assistant',content:JSON.stringify({answer:'Detalle sintético privado',evidence:[{action:'calidad'}]})}];memory.save(conversation);
 const blocked=await req('/api/agent/chat',{method:'POST',body:{text:'¿Qué sugerís?',conversationId:conversation.id,context:{sucursal:'0101'}}});assert.equal(blocked.status,403);assert.equal(blocked.data.error.code,'IA_EXTERNA_RESTRINGIDA');assert.equal(f.externalCalls,0);
 const revoked=await req('/api/admin/roles/'+f.role.id,{token:f.admin.token,method:'PUT',body:{name:'Sin catálogo',permissions:permissions.filter(p=>p!=='read:catalogo'),branches:['0101']}});assert.equal(revoked.status,200);assert.equal((await req('/api/knowledge?branch=0101')).data.data.length,0);assert.equal((await req('/api/knowledge/'+saved.data.id)).status,404);
});


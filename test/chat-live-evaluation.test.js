import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {Store} from '../src/store.js';
import {Access} from '../src/access.js';
import {createApp} from '../src/app.js';
import {createDemoErp} from '../src/demo.js';
import {createChatEvaluationHarness,evaluateFullChat,readOnlyEvaluationEnv,chatEvaluationPermissions} from '../src/intelligence/chat-live-evaluation.js';

test('full-chat harness forces readonly environment without mutating operator configuration',()=>{
 const original={ERP_WRITE_ENABLED:'true',LOCAL_WRITE_ENABLED:'true',ERP_APPROVAL_AUTO_ESCALATE:'true',DATA_DIR:'production'};
 const safe=readOnlyEvaluationEnv(original);
 assert.equal(safe.ERP_WRITE_ENABLED,'false');assert.equal(safe.LOCAL_WRITE_ENABLED,'false');assert.equal(safe.ERP_APPROVAL_AUTO_ESCALATE,'false');assert.equal(original.ERP_WRITE_ENABLED,'true');
 assert.ok(chatEvaluationPermissions.every(p=>!p.startsWith('write:')));
});
test('controlled confirmation double requires fingerprint and local execution permission',async t=>{
 const store=new Store(':memory:'),access=new Access(store,['0101']);
 const password='Confirmacion-controlada-123';
 const admin=await access.setup({username:'confirmadmin',name:'Confirmación aislada',password});
 const role=access.saveRole(admin.principal,{name:'Escritor sólo doble',permissions:['read:catalogo','read:preciosVenta','plan:precioLista','write:precioLista'],branches:['0101']});
 const user=await access.saveUser(admin.principal,{username:'confirmuser',name:'Usuario doble',roleId:role.id,password,active:true});
 const principal=access.principal(user.id),token=access.session(user.id);let executed=0;
 const erp={...createDemoErp(),writes:{enabled:true,execute:async()=>{executed++;return {affected:1};}}};
 const server=createApp({store,erp,kaiqen:{},readKey:'r'.repeat(40),planKey:'p'.repeat(40),localWrites:false,attentionOptions:{enabled:false},notificationOptions:{enabled:false}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();});
 const proposal=store.save(principal.actor,{action:'precioLista',target:{sucursal:'0101',registro:'1'},fingerprint:'controlled-fingerprint',status:'proposed',writePlan:{}});
 const send=async body=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/changes/${proposal.id}/execute`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 assert.equal((await send({confirm:false,fingerprint:proposal.fingerprint})).status,400);
 assert.equal((await send({confirm:true,fingerprint:'wrong'})).status,400);
 const blocked=await send({confirm:true,fingerprint:proposal.fingerprint});assert.equal(blocked.status,403);assert.equal(blocked.data.error.code,'ESCRITURA_LOCAL_DESHABILITADA');assert.equal(executed,0);
});
test('full-chat harness rejects operational writers and external models before opening a store',async()=>{
 await assert.rejects(createChatEvaluationHarness({erp:{writes:{enabled:true}}}),/EVALUATION_WRITER_ENABLED/);
 await assert.rejects(createChatEvaluationHarness({erp:{},model:{local:false}}),/EVALUATION_LOCAL_MODEL_REQUIRED/);
});
test('HTTP full-chat harness preserves source denial, conversation isolation and revocation',async t=>{
 let modelCalls=0;
 const h=await createChatEvaluationHarness({erp:createDemoErp(),model:{name:'controlled',local:true,status:async()=>({available:true}),complete:async()=>{modelCalls++;return {action:'consultar_erp',args:{recurso:'costos',filtros:{}},answer:''};}}});
 t.after(()=>h.close());
 const before=h.counts.erpReads;
 const denied=await h.request('/api/erp/costos?sucursal=0101',{user:'restricted'});assert.equal(denied.status,403);assert.equal(h.counts.erpReads,before);
 const chat=await h.chat('Mostrame el producto DEMO-P01');assert.equal(chat.status,200);assert.ok(chat.data.conversationId);assert.equal(modelCalls,0);
 assert.equal((await h.request('/api/agent/conversations/'+chat.data.conversationId,{user:'peer'})).status,404);
 await assert.rejects(h.request('/api/changes/00000000-0000-0000-0000-000000000000/execute',{body:{confirm:true}}),/EVALUATION_CONFIRMATION_FORBIDDEN/);
 h.revoke();assert.equal((await h.request('/api/agent/conversations/'+chat.data.conversationId)).status,404);assert.equal(h.counts.executionCalls,0);
});
test('four complete controlled HTTP conversations verify current drafts and redact their report',async t=>{
 const rows={productos:[{codigo:'Z731',nombre:'Fixture reservado',unidadMedida:'UN'}],clientes:[{codigo:'C83',tienda:'02',nombre:'Cliente controlado'}],proveedores:[{codigo:'V72',tienda:'03',nombre:'Proveedor controlado'}]};
 const erp={...createDemoErp(),list:async(resource,params)=>{
  let data=structuredClone(rows[resource]||[]);
  for(const key of ['codigo','tienda'])if(params.has(key))data=data.filter(r=>r[key]===params.get(key));
  return {data,meta:{hasMore:false}};
 }};
 const h=await createChatEvaluationHarness({erp,model:{name:'controlled',local:true,status:async()=>({available:true}),complete:async(_messages,schema)=>schema.properties.answer.enum?.length?{action:'responder',args:{},answer:schema.properties.answer.enum[0]}:{action:'consultar_erp',args:{recurso:'costos',filtros:{}},answer:''}}});
 t.after(()=>h.close());
 const report=await evaluateFullChat(h);
 assert.equal(report.status,'passed',JSON.stringify(report.results));assert.equal(report.results.length,4);
 assert.equal(report.counts.executionCalls,0);assert.equal(report.liveModelInvoked,false);
 const serialized=JSON.stringify(report);for(const value of ['Z731','C83','V72','Fixture reservado','Cliente controlado','Proveedor controlado'])assert.ok(!serialized.includes(value));
});
test('indirect contextual HTTP follow-up actually invokes the local adapter and enforces its inference budget',async t=>{
 let calls=0,limited=false,contextSeen=false;
 const model={name:'controlled-local',local:true,status:async()=>({available:true}),complete:async(messages)=>{
  calls++;contextSeen||=messages.some(m=>m.role==='user'&&m.content==='Mostrame el producto DEMO-P01');
  return !limited&&calls===1?{action:'precio_venta',args:{producto:'DEMO-P01'},answer:''}:{action:'responder',args:{},answer:'Consulté la fuente actual.'};
 }};
 const h=await createChatEvaluationHarness({erp:createDemoErp(),model});t.after(()=>h.close());
 const first=await h.chat('Mostrame el producto DEMO-P01');
 const next=await h.withInferenceBudget(()=>h.chat('Del que vimos recién, decime cuánto le cobramos a quien nos compra. Tomá valores vigentes y no cambies nada.',first.data.conversationId));
 assert.equal(next.status,200);assert.ok(calls>=1&&calls<=2);assert.equal(contextSeen,true);assert.ok(next.data.evidence.some(e=>e.action==='precio_venta'&&e.result.data.length));
 limited=true;const before=calls;
 const blocked=await h.withInferenceBudget(()=>h.chat('Interpretá esta consulta que requiere verificar fuentes'),{maxCalls:1,timeoutMs:60000});
 assert.equal(calls-before,1);assert.equal(blocked.status,503);assert.equal(h.counts.executionCalls,0);
});

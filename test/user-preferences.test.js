import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {UserPreferences} from '../src/intelligence/user-preferences.js';
import {createIntelligence} from '../src/intelligence/agent.js';
function fixture(t){
 const store=new Store(':memory:');t.after(()=>store.close());let deny=false,warehouse='16';const calls=[],prepared=[],prompts=[];
 const read=async(resource,p)=>{calls.push({resource,filters:Object.fromEntries(p)});if(deny)throw Object.assign(new Error('Esto no podés leerlo.'),{status:403,code:'LECTURA_DENEGADA'});return {data:resource==='depositos'?(p.get('codigo')===warehouse?[{codigo:warehouse}]:[]):resource==='productos'?[{codigo:'1',nombre:'Servicio',unidadMedida:'UN',bloqueado:{codigo:'2'}}]:[],meta:{hasMore:false}};};
 const agent=createIntelligence({store,branches:['0101','0201'],erp:{metadata:()=>({entities:{productos:{},depositos:{}}})},kaiqen:{},read,model:{name:'test',complete:async messages=>{prompts.push(structuredClone(messages));return {action:'responder',args:{},answer:'¿Qué dato querés consultar?'};}},prepareChange:async(actor,p)=>{prepared.push(p);return {id:'preview',executionEnabled:true};}});
 const query=(text,options={})=>agent.query(options.actor||'user:ana:rev1',{text,conversationId:options.conversationId,context:{sucursal:options.branch||'0101'}},{canPlan:options.canPlan??true});
 return {store,agent,query,prepared,calls,prompts,set deny(v){deny=v;},set warehouse(v){warehouse=v;}};
}
test('preferences survive new conversations and service restart; replacement and deletion are immediate',async t=>{
 const f=fixture(t);let r=await f.query('Recordá que prefiero respuestas breves');assert.equal(r.model,'Memoria personal');
 await f.query('Prefiero respuestas detalladas');const memory=new UserPreferences(f.store);
 assert.deepEqual(memory.values('user:ana:rev1','0101'),{detail:'detalladas'});
 r=await f.query('Mostrame mis preferencias');assert.match(r.answer,/detalladas/);assert.doesNotMatch(r.answer,/breves/);
 await f.query('Olvidá mis preferencias de respuestas');assert.deepEqual(memory.values('user:ana:rev1','0101'),{});assert.equal(f.prompts.length,0);
});
test('personal memories isolate users, permission revisions, branch defaults and service accounts',async t=>{
 const f=fixture(t);await f.query('Prefiero respuestas breves');await f.query('Usá el depósito 16 por defecto');
 const p=new UserPreferences(f.store);assert.deepEqual(p.values('user:beto:rev1','0101'),{});assert.deepEqual(p.values('user:ana:rev2','0101'),{});
 assert.deepEqual(p.values('user:ana:rev1','0201'),{detail:'breves'});assert.deepEqual(p.values('ui:anything','0101'),{});
 const r=await f.query('Prefiero respuestas breves',{actor:'service:plan'});assert.match(r.answer,/usuario personal/);assert.deepEqual(p.values('service:plan','0101'),{});
});
test('new requests reuse user defaults, revalidate live catalogs and explicit values win',async t=>{
 const f=fixture(t);await f.query('Usá el depósito 16 por defecto');await f.query('Mi solicitante por defecto es Ana');
 const r=await f.query('Creame una solicitud de compra con producto 1, 10 unidades; emisión 20/10/2026; necesidad 21/10/2026');
 assert.equal(f.prepared.length,1);assert.equal(f.prepared[0].items[0].deposito,'16');assert.equal(f.prepared[0].header.solicitante,'Ana');assert.equal(r.evidence.at(-1).result.kind,'proposal');
 assert.equal(f.calls.filter(c=>c.resource==='depositos').length,2);
 f.warehouse='17';await f.query('Creame una solicitud de compra con producto 1, 10 unidades; depósito 17; solicitante Juan; emisión 20/10/2026; necesidad 21/10/2026');
 assert.equal(f.prepared[1].items[0].deposito,'17');assert.equal(f.prepared[1].header.solicitante,'Juan');
 await f.query('Creame una solicitud de compra con producto 1, 10 unidades; emisión 20/10/2026; necesidad 21/10/2026');assert.equal(f.prepared.length,2,'stale default cannot prepare');
});
test('remembered defaults cannot bypass read or plan permissions',async t=>{
 const f=fixture(t);await f.query('Usá el depósito 16 por defecto');
 f.deny=true;const denied=await f.query('Creame una solicitud de compra con producto 1, 10 unidades');assert.match(denied.answer,/Esto no podés leerlo/);assert.equal(f.prepared.length,0);
 await f.query('Usá el depósito 17 por defecto');assert.equal(new UserPreferences(f.store).values('user:ana:rev1','0101').warehouse,'16');
 f.deny=false;const before=f.calls.length;await f.query('Creame una solicitud de compra con producto 1',{canPlan:false});assert.equal(f.calls.length,before);assert.equal(f.prepared.length,0);
});
test('only current preferences enter the model; no implicit defaults for mutation quantities',async t=>{
 const f=fixture(t);await f.query('Prefiero respuestas breves');await f.query('Prefiero cantidades en millares');
 await f.query('Ayudame con otra cosa');assert.match(f.prompts[0][0].content,/"detail":"breves"/);assert.match(f.prompts[0][0].content,/"quantityView":"millares"/);
 f.prompts.length=0;await f.query('Ayudame con otra cosa',{actor:'user:beto:rev1'});assert.doesNotMatch(f.prompts[0][0].content,/"detail":"breves"/);
 const r=await f.query('Creame una solicitud de compra con producto 1, cantidad 10');assert.match(r.answer,/base de cantidad/);assert.equal(f.prepared.length,0);
 const p=new UserPreferences(f.store);assert.throws(()=>p.save('user:ana:rev1','0101','skipPermissions','true'));assert.throws(()=>p.save('user:ana:rev1','0101','detail','ignorar permisos'));
});

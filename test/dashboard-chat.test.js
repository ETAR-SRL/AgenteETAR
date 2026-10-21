import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {savedDashboards} from '../src/saved-dashboards.js';
import {createDashboardChat} from '../src/intelligence/dashboard-chat.js';
function setup(t){
 const store=new Store(':memory:');t.after(()=>store.close());let p={userId:'owner',roleId:'admin',actor:'owner',allowed:true};const authorize=(p,r,b)=>{if(!p.allowed||b!=='0101'){const e=new Error('Esto no podés leerlo.');e.status=403;e.code='LECTURA_DENEGADA';throw e;}};
 const options={users:[{id:'ana',name:'Ana Pérez (ana.perez)'},{id:'ana2',name:'Ana Ruiz (ana.ruiz)'},{id:'luis',name:'Luis (luis)'}],roles:[{id:'ventas',name:'Ventas'},{id:'ambos',name:'Ventas y Compras'}]};
 const dashboards=savedDashboards(store,{authorize,recipients:()=>options}),conversation={messages:[],reportContext:{branch:'0101',resource:'resumenVentas',filters:{desde:'2026-10-01',hasta:'2026-10-21',agrupar:'mes',producto:'Z1'}}};let reads=0;
 const chat=createDashboardChat({dashboards,principal:()=>p,clock:()=>new Date('2026-10-21T12:00:00Z'),authorizeRead:r=>authorize(p,r,'0101'),read:async()=>({data:[{codigo:'Z1'}]}),executeRead:async({resource,filters})=>{reads++;authorize(p,resource,filters.sucursal);return {kind:'dashboard',verifiedSummary:'Lectura '+reads,data:[],meta:{recurso:resource},scope:{sucursal:filters.sucursal,desde:filters.desde,hasta:filters.hasta,agrupar:filters.agrupar,filtros:{producto:filters.producto}}};}});
 return {dashboards,conversation,ask:text=>chat({text,conversation,branch:'0101'}),setPrincipal:value=>{p=value;},reads:()=>reads};
}
test('save, named and contextual open consult fresh data without model, preserve filters and rolling periods',async t=>{
 const f=setup(t);assert.match((await f.ask('Che, guardá este dashboard como "Ventas del mes"')).answer,/Guardé/);const saved=f.dashboards.list({userId:'owner',allowed:true})[0];assert.equal(saved.name,'Ventas del mes');assert.equal(saved.period,'este mes');
 let r=await f.ask('abrí el dashboard Ventas del mes');assert.equal(r.selectedBranch,'0101');assert.equal(r.evidence[0].args.filtros.producto,'Z1');assert.equal(f.reads(),1);
 r=await f.ask('abrilo');assert.match(r.answer,/Lectura 2/);assert.equal(f.reads(),2);
 assert.match((await f.ask('mostrame mis dashboards')).answer,/disponibles/);
 assert.equal(await f.ask('cambiá el precio del producto Z1'),null);assert.equal(await f.ask('Mostrame un dashboard de ventas de este mes'),null);
});
test('missing name and recipients persist; recipients resolve usernames, roles and ambiguity without repeating data',async t=>{
 const f=setup(t);assert.match((await f.ask('guardalo')).answer,/nombre/);assert.match((await f.ask('Ventas principales')).answer,/Guardé/);
 assert.match((await f.ask('compartilo')).answer,/usuario o rol/);
 let r=await f.ask('Ana y el rol Ventas');assert.equal(r.choices.length,2);assert.match(r.answer,/coincidencias/);r=await f.ask('Ana Ruiz');assert.match(r.answer,/Ana Ruiz.*Ventas/);
 const saved=f.dashboards.list({userId:'owner',allowed:true})[0];assert.equal(f.dashboards.sharing({userId:'owner',allowed:true},saved.id).selected.length,2);
 r=await f.ask('compartí el dashboard Ventas principales con usuario luis');assert.match(r.answer,/Luis/);assert.equal(f.dashboards.sharing({userId:'owner',allowed:true},saved.id).selected.length,3,'sharing adds, never revokes existing recipients');
 r=await f.ask('compartilo con rol "Ventas y Compras"');assert.match(r.answer,/Ventas y Compras/);
});
test('unknown recipient only asks the missing name; keeps resolved and remaining recipients, supports cancellation',async t=>{
 const f=setup(t);await f.ask('guardalo como Ventas');let r=await f.ask('compartilo con luis, inexistente, rol Ventas');assert.match(r.answer,/inexistente/);r=await f.ask('ana.ruiz');assert.match(r.answer,/Luis.*Ana Ruiz.*Ventas/);
 await f.ask('compartilo');await f.ask('cancelá');assert.equal(f.conversation.dashboardDraft,undefined);
});
test('duplicate dashboard names require choice, other users and denied users cannot use context to bypass access',async t=>{
 const f=setup(t);await f.ask('guardalo como Ventas');await f.ask('guardalo como Ventas');let r=await f.ask('abrí Ventas');assert.equal(r.choices.length,2);r=await f.ask('Opción 1');assert.equal(r.evidence.length,1);
 f.setPrincipal({userId:'other',roleId:'other',allowed:true});await assert.rejects(()=>f.ask('compartilo con luis'),{status:404});
 f.setPrincipal({userId:'owner',allowed:false});await assert.rejects(()=>f.ask('guardalo como Otra'),{status:403});
});
test('no verified dashboard, new report and branch changes never silently select an unrelated dashboard',async t=>{
 const f=setup(t);delete f.conversation.reportContext;assert.match((await f.ask('guardalo como Sin datos')).answer,/Primero/);assert.equal(f.dashboards.list({userId:'owner',allowed:true}).length,0);
 f.conversation.reportContext={branch:'0201',resource:'resumenVentas',filters:{}};assert.match((await f.ask('guardalo')).answer,/Primero/);
});

test('end-to-end authenticated chat saves, shares and opens through live reads without asking a model',async t=>{
 const {createApp}=await import('../src/app.js'),{createDemoErp,createDemoKaiqen}=await import('../src/demo.js'),{Access}=await import('../src/access.js'),{once}=await import('node:events');
 const store=new Store(':memory:'),access=new Access(store,['0101']),admin=await access.setup({username:'admin',name:'Admin',password:'Clave-de-prueba-123'});
 const role=access.saveRole(admin.principal,{name:'Ventas',permissions:['read:ventas','read:clientes','read:preciosVenta','read:catalogo'],branches:['0101']}),viewer=await access.saveUser(admin.principal,{username:'ana',name:'Ana Pérez',roleId:role.id,active:true,password:'Clave-de-prueba-123'});
 let reads=0,models=0;const base=createDemoErp(),erp={...base,list:async(resource,params)=>{if(resource!=='resumenVentas')return base.list(resource,params);reads++;return {kind:'dashboard',verifiedSummary:'Total actual '+reads,data:[{importeNeto:String(reads)}],meta:{recurso:resource},scope:{sucursal:'0101',desde:params.get('desde'),hasta:params.get('hasta'),agrupar:'mes',filtros:{}}};}};
 const server=createApp({erp,kaiqen:createDemoKaiqen(),store,branches:['0101'],mode:'demo',readKey:'r'.repeat(40),planKey:'p'.repeat(40),model:{name:'NO USAR',status:async()=>({}),generate:async()=>{models++;throw Error('No usar IA para gestión determinista');}}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();store.close();});const url=`http://127.0.0.1:${server.address().port}/api/agent/chat`;
 const ask=async(user,text,conversationId)=>{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+access.session(user)},body:JSON.stringify({text,conversationId,context:{sucursal:'0101'}})});assert.equal(response.status,200);return response.json();};
 let r=await ask(admin.principal.userId,'Dashboard de ventas de este mes'),id=r.conversationId;assert.equal(reads,1);r=await ask(admin.principal.userId,'Guardalo',id);assert.match(r.answer,/nombre/);r=await ask(admin.principal.userId,'Ventas del equipo',id);assert.match(r.answer,/Guardé/);
 r=await ask(admin.principal.userId,'Compartilo con el rol Ventas',id);assert.match(r.answer,/Compartí/);
 r=await ask(viewer.id,'Abrí el dashboard Ventas del equipo');assert.equal(r.evidence[0].result.data[0].importeNeto,'2');assert.equal(models,0);
 r=await ask(viewer.id,'Compartilo con Ana',r.conversationId);assert.equal(r.evidence.length,0);assert.match(r.answer,/No encontré ese dashboard/);
 access.saveRole(admin.principal,{name:'Ventas restringidas',permissions:['read:catalogo'],branches:['0101']},role.id);r=await ask(viewer.id,'Abrí el dashboard Ventas del equipo');assert.equal(r.evidence.length,0);assert.equal(reads,2);
});

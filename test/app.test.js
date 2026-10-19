import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createDemoErp,createDemoKaiqen } from '../src/demo.js';
import { Store } from '../src/store.js';
import { Changes } from '../src/changes.js';
import { plan } from '../src/planner.js';
const readKey='test-reader-key-000000000000000000000000';
const planKey='test-planner-key-00000000000000000000000';
async function setup(t,overrides={}){
  const store=new Store(':memory:');const erp=createDemoErp();
  const server=createApp({erp,kaiqen:createDemoKaiqen(),store,mode:'demo',readKey,planKey,...overrides});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.close();server.closeAllConnections();store.close();});
  return {erp,store,request:(path,{method='GET',key=readKey,body}={})=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})};
}
test('requires authentication and branch, never silently widens scope',async t=>{
  const {request}=await setup(t);
  assert.equal((await request('/api/erp/clientes?sucursal=0101',{key:'invalid'})).status,401);
  assert.equal((await request('/api/erp/clientes')).status,403);
  assert.equal((await request('/api/erp/clientes?sucursal=9999')).status,403);
  assert.equal((await request('/api/erp/clientes?sucursal=0101&sucursal=9999')).status,400);
  const response=await request('/api/erp/clientes?sucursal=0101');assert.equal(response.status,200);assert.equal((await response.json()).source.mode,'demo');
});
test('read key cannot create proposals and no key can execute changes',async t=>{
  const {request}=await setup(t);
  const body={action:'precioLista',target:{sucursal:'0101',registro:'4'},changes:{precio:'1350.00'}};
  assert.equal((await request('/api/changes/preview',{method:'POST',body})).status,403);
  const created=await request('/api/changes/preview',{method:'POST',key:planKey,body});assert.equal(created.status,201);
  const proposal=await created.json();assert.equal(proposal.diff[0].before,'1250.00');assert.equal(proposal.executionEnabled,false);
  assert.equal((await request(`/api/changes/${proposal.id}/check`,{method:'POST',key:planKey})).status,200);
  assert.equal((await request(`/api/changes/${proposal.id}/execute`,{method:'POST',key:planKey})).status,501);
  const prices=await (await request('/api/erp/preciosClientes?sucursal=0101')).json();assert.equal(prices.data[0].precio,'1250.00');
});
test('rejects missing records, unapproved fields, wrong types, excessive precision',async t=>{
  const {request}=await setup(t);
  for(const body of [
    {action:'precioLista',target:{sucursal:'0101',registro:'9999'},changes:{precio:'1.00'}},
    {action:'precioLista',target:{sucursal:'0101',registro:'4'},changes:{codigo:'OTHER'}},
    {action:'precioLista',target:{sucursal:'0101',registro:'4'},changes:{precio:10}},
    {action:'precioLista',target:{sucursal:'0101',registro:'4'},changes:{precio:'1.123'}},
    {action:'crearCliente',target:{sucursal:'0101',registro:'4'},changes:{nombre:'X'}}
  ]) assert.ok((await request('/api/changes/preview',{method:'POST',key:planKey,body})).status>=400);
});
test('concurrency and expiry invalidate proposals, actor isolation enforced',async()=>{
  const store=new Store(':memory:');let row={registro:4,precio:'10.00'};
  const manager=new Changes({erp:{metadata:()=>({})},store,read:async()=>({data:[structuredClone(row)],meta:{demo:true}})});
  const proposal=await manager.preview('alice',{action:'precioLista',target:{sucursal:'0101',registro:'4'},changes:{precio:'15.00'}});
  await assert.rejects(()=>manager.check('bob',proposal.id),{code:'PROPUESTA_NO_EXISTE'});
  row.precio='11.00';await assert.rejects(()=>manager.check('alice',proposal.id),{code:'CONFLICTO_CONCURRENCIA'});
  const saved=store.get(proposal.id,'alice');saved.expiresAt='2000-01-01T00:00:00Z';store.db.prepare('UPDATE proposals SET body=? WHERE id=?').run(JSON.stringify(saved),proposal.id);
  await assert.rejects(()=>manager.check('alice',proposal.id),{code:'PROPUESTA_VENCIDA'});store.close();
});
test('local interpreter preserves exact filters and rejects unsupported or destructive text',()=>{
  assert.deepEqual(plan('consultar compras pendientes sucursal 0101').filters,{pendiente:'true',sucursal:'0101'});
  assert.equal(plan('actualizar precio registro 4 a 1350,50 sucursal 0101').changes.precio,'1350.50');
  assert.throws(()=>plan('borrar todos los clientes sucursal 0101'));
  assert.throws(()=>plan('consultar compras de Juan ayer sucursal 0101'));
  assert.throws(()=>plan('consultar compras sucursal 0101 sucursal 9999'));
  assert.throws(()=>plan('consultar pendientes'));
  assert.throws(()=>plan('consultar productos codigo ÁBC sucursal 0101'));
  assert.equal(plan('consultar producción sucursal 0101').resource,'produccion');
});
test('agent query cannot execute a voice/text mutation',async t=>{
  const {request}=await setup(t);
  assert.equal((await request('/api/agent/query',{method:'POST',key:planKey,body:{text:'actualizar precio registro 4 a 1350.00 sucursal 0101'}})).status,409);
  const response=await request('/api/agent/query',{method:'POST',body:{text:'consultar compras pendientes sucursal 0101'}});
  assert.equal(response.status,200);assert.equal((await response.json()).result.source.mode,'demo');
});
test('physical delivery is explicitly unknown, not inferred from remittance',async t=>{
  const {request}=await setup(t);const result=await(await request('/api/erp/entregas?sucursal=0101')).json();
  assert.equal(result.status,'not_configured');assert.deepEqual(result.data,[]);
  assert.equal((await request('/api/erp/entregas')).status,403);
  assert.equal((await request('/api/erp/remitos?sucursal=0101&tipoDocumento=01')).status,400);
});
test('UUID-like project identifiers work; quality failure stays partial and ERP scope remains enforced',async t=>{
  const projectId='e292cb72-6582-4d56-a984-8d9cb9d8d881';
  const kaiqen={available:true,project:async id=>({data:{project:{id,sin_ia_externa:true}}}),quality:async()=>{throw Object.assign(new Error('Forbidden'),{status:403,code:'KAIQEN_FORBIDDEN'});},projectLink:async()=>({data:{articulo_referencia:{id:'prod-1'}}}),product:async()=>({data:{sucursal:'9999',codigo:'A'}})};
  const {request}=await setup(t,{kaiqen});
  const detail=await request(`/api/kaiqen/projects/${projectId}`);assert.equal(detail.status,200);assert.equal((await detail.json()).data.project.id,projectId);
  const overview=await (await request(`/api/overview/projects/${projectId}`)).json();
  assert.equal(overview.status,'partial');assert.equal(overview.quality.error.code,'KAIQEN_FORBIDDEN');assert.equal(overview.reference.error.code,'SUCURSAL_NO_AUTORIZADA');
});

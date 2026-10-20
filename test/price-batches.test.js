import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Changes} from '../src/changes.js';
import {createPriceBatches} from '../src/intelligence/price-batches.js';
import {createApp} from '../src/app.js';
import {createDemoKaiqen} from '../src/demo.js';
import {Access} from '../src/access.js';
import {once} from 'node:events';
const failure=(code,message=code)=>Object.assign(new Error(message),{code});
function fixture(t,options={}){
 const store=new Store(':memory:');t.after(()=>store.close());let checks=0,writes=0,allowed=true;
 const erp={writes:{enabled:true,
  check:async p=>{checks++;if(options.check)await options.check(p,checks);return {executionEnabled:true};},
  execute:async p=>{writes++;if(options.execute)await options.execute(p,writes);return {affected:1};}
 }};
 const changes=new Changes({store,erp,read:async()=>{throw Error('unused');}});
 const args={store,check:(...a)=>changes.check(...a),execute:(...a)=>changes.execute(...a),authorize:()=>{if(!allowed)throw failure('ACCION_DENEGADA');}};
 const batches=createPriceBatches(args),draft={id:'import-1',kind:'proveedor',branch:'0101',name:'lista.xlsx',expiresAt:new Date(Date.now()+86400000).toISOString()};
 const proposals=[1,2,3].map(i=>store.save('u',{action:'precioListaProveedor',target:{sucursal:'0101',registro:String(i)},fingerprint:'hash'+i,executionEnabled:true,origin:{importacion:draft.id,ubicacion:'Hoja 1 fila '+i},writePlan:{},calculation:{unidadMedida:'UN'},diff:[{field:'AIB_PRCCOM',before:'0.058000000000000003',after:'0.0600'}]}));
 const resolved=proposals.map((p,i)=>({fila:String(i+1),producto:'Z'+i,descripcion:'Producto '+i,registro:p.target.registro,lista:'001',precio:'60',base:'millar',moneda:'USD'}));
 const result={proposals,resolved,issues:[{fila:'4',producto:'inexistente',motivo:'No está en SB1'}]},batch=batches.create('u',draft,result);
 return {store,changes,batches,args,draft,result,batch,proposals,counts:()=>({checks,writes}),deny:()=>{allowed=false;},confirm:{confirm:true,fingerprint:batch.fingerprint}};
}
test('one confirmation applies the fixed valid set, with before/after in the reviewed base and excluded rows',async t=>{
 const f=fixture(t,{execute:async()=>assert.equal(f.counts().checks,3)});
 assert.equal(f.batch.counts.valid,3);assert.equal(f.batch.counts.excluded,1);
 assert.equal(f.batch.rows[0].anterior,'58');assert.equal(f.batch.rows[0].nuevo,'60');assert.equal(f.batch.rows[0].base,'millar');
 assert.equal(f.counts().writes,0);
 const r=await f.batches.run('u',f.batch.id,f.confirm);assert.equal(r.status,'completed');assert.equal(r.counts.executed,3);
 await f.batches.run('u',f.batch.id,f.confirm);assert.equal(f.counts().writes,3);
});
test('batch confirmation requires exact fingerprint, actor, permission, nonempty and unexpired review',async t=>{
 const f=fixture(t);
 await assert.rejects(f.batches.run('u',f.batch.id,{confirm:false,fingerprint:f.batch.fingerprint}),{code:'CONFIRMACION_REQUERIDA'});
 await assert.rejects(f.batches.run('u',f.batch.id,{confirm:true,fingerprint:'tampered'}),{code:'CONFIRMACION_REQUERIDA'});
 await assert.rejects(f.batches.run('other',f.batch.id,f.confirm),{code:'LOTE_NO_EXISTE'});
 f.deny();await assert.rejects(f.batches.run('u',f.batch.id,f.confirm),{code:'ACCION_DENEGADA'});assert.equal(f.counts().writes,0);
 const g=fixture(t);g.result.proposals.forEach(p=>{p.expiresAt='2000-01-01';});const expired=g.batches.create('u',g.draft,g.result);
 await assert.rejects(g.batches.run('u',expired.id,{confirm:true,fingerprint:expired.fingerprint}),{code:'LOTE_VENCIDO'});
 const empty=g.batches.create('u',g.draft,{proposals:[],resolved:[],issues:g.result.issues});
 await assert.rejects(g.batches.run('u',empty.id,{confirm:true,fingerprint:empty.fingerprint}),{code:'LOTE_VACIO'});
});
test('revised attachment supersedes its old batch and cannot silently change the confirmed membership',async t=>{
 const f=fixture(t),next=f.batches.create('u',f.draft,{...f.result,proposals:f.result.proposals.slice(0,1),resolved:f.result.resolved.slice(0,1)});
 await assert.rejects(f.batches.run('u',f.batch.id,f.confirm),{code:'LOTE_REEMPLAZADO'});
 assert.notEqual(next.fingerprint,f.batch.fingerprint);assert.equal(f.counts().writes,0);
});
test('revalidation failure on the last row prevents every write',async t=>{
 const f=fixture(t,{check:async(p,n)=>{if(n===3)throw failure('CONFLICTO_CONCURRENCIA');}});
 const r=await f.batches.run('u',f.batch.id,f.confirm);assert.equal(r.status,'blocked');assert.equal(r.counts.validation_failed,1);assert.equal(r.counts.pending,2);assert.equal(f.counts().writes,0);
 await f.batches.run('u',f.batch.id,f.confirm);assert.equal(f.counts().checks,3);
});
test('later SQL error stops remaining rows and reports applied and unattempted independently',async t=>{
 const f=fixture(t,{execute:async(p,n)=>{if(n===2)throw failure('CONFLICTO_CONCURRENCIA');}});
 const r=await f.batches.run('u',f.batch.id,f.confirm);assert.equal(r.status,'stopped');assert.equal(r.counts.executed,1);assert.equal(r.counts.failed,1);assert.equal(r.counts.pending,1);
 await f.batches.run('u',f.batch.id,f.confirm);assert.equal(f.counts().writes,2);
});
test('unknown commit never retries or continues the batch',async t=>{
 const f=fixture(t,{execute:async()=>{throw Object.assign(failure('RESULTADO_INCIERTO'),{outcomeUnknown:true});}});
 const r=await f.batches.run('u',f.batch.id,f.confirm);assert.equal(r.counts.unknown,1);assert.equal(r.counts.pending,2);
 await f.batches.run('u',f.batch.id,f.confirm);assert.equal(f.counts().writes,1);
});
test('double submission returns current status; preparing a replacement during execution is refused',async t=>{
 let release;const gate=new Promise(r=>{release=r;});const f=fixture(t,{check:async(p,n)=>{if(n===1)await gate;}});
 const pending=f.batches.run('u',f.batch.id,f.confirm);
 const second=await f.batches.run('u',f.batch.id,f.confirm);assert.equal(second.status,'checking');
 assert.throws(()=>f.batches.create('u',f.draft,f.result),{code:'LOTE_EN_CURSO'});
 release();await pending;assert.equal(f.counts().writes,3);
});
test('restart exposes partial receipts and leaves interrupted work stopped',async t=>{
 const f=fixture(t);f.store.claim(f.proposals[0].id,'u');f.store.finish(f.proposals[0].id,'u','executed',{affected:1});
 f.store.db.prepare("UPDATE price_batches SET status='running' WHERE id=?").run(f.batch.id);
 const restarted=createPriceBatches(f.args),r=restarted.get('u',f.batch.id);assert.equal(r.status,'interrupted');assert.equal(r.counts.executed,1);assert.equal(r.counts.pending,2);
 await restarted.run('u',f.batch.id,f.confirm);assert.equal(f.counts().writes,0);
});
test('permission revocation between rows stops the next update and prior independent execution is not repeated',async t=>{
 const f=fixture(t,{execute:async()=>f.deny()});
 const r=await f.batches.run('u',f.batch.id,f.confirm);assert.equal(r.status,'stopped');assert.equal(r.counts.executed,1);assert.equal(f.counts().writes,1);
 const g=fixture(t);await g.changes.execute('u',g.proposals[0].id,{confirm:true,fingerprint:g.proposals[0].fingerprint});
 const complete=await g.batches.run('u',g.batch.id,g.confirm);assert.equal(complete.counts.executed,3);assert.equal(g.counts().writes,3);
});
test('nonexecutable proposals and their blockers are excluded from collective confirmation',t=>{
 const f=fixture(t);f.result.proposals[0].executionEnabled=false;f.result.proposals[0].blockers=[{message:'Requiere revisión'}];
 const b=f.batches.create('u',f.draft,f.result);assert.equal(b.counts.valid,2);assert.equal(b.counts.excluded,2);assert.equal(b.issues[1].motivo,'Requiere revisión');
});
test('HTTP batch execution enforces plan/write separation, local switch and actor ownership',async t=>{
 const store=new Store(':memory:'),access=new Access(store,['0101']),admin=await access.setup({username:'admin',name:'Admin',password:'test-password-12345'});
 const role=access.saveRole(admin.principal,{name:'Planificador',permissions:['read:catalogo','read:proveedores','read:preciosCompra','plan:precioListaProveedor'],branches:['0101']});
 await access.saveUser(admin.principal,{username:'planner',name:'Planner',roleId:role.id,active:true,password:'test-password-12345'});const planner=await access.login({username:'planner',password:'test-password-12345'},'test');
 let writes=0;
 const erp={metadata:()=>({entities:{}}),writes:{enabled:true,check:async()=>({executionEnabled:true}),execute:async()=>{writes++;return {affected:1};}}};
 const server=createApp({erp,kaiqen:createDemoKaiqen(),store,readKey:'r'.repeat(40),planKey:'p'.repeat(40),localWrites:false});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();store.close();});
 const b=createPriceBatches({store}),make=actor=>{
  const p=store.save(actor,{action:'precioListaProveedor',target:{sucursal:'0101',registro:'1'},origin:{importacion:'doc'},fingerprint:'p',executionEnabled:true,writePlan:{},diff:[{field:'AIB_PRCCOM',before:'1',after:'2'}]});
  return b.create(actor,{id:'doc',kind:'proveedor',name:'test.xlsx',branch:'0101'},{proposals:[p],resolved:[{fila:'1',producto:'Z1',base:'unidad'}],issues:[]});
 };
 const request=(batch,token,method='POST')=>fetch(`http://127.0.0.1:${server.address().port}/api/price-imports/batches/${batch.id}${method==='POST'?'/execute':''}`,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({confirm:true,fingerprint:batch.fingerprint})}:{})});
 const p=make(planner.principal.actor),a=make(admin.principal.actor);
 assert.equal((await request(p,planner.token)).status,403);assert.equal((await request(p,admin.token,'GET')).status,404);assert.equal((await request(a,admin.token)).status,403);assert.equal(writes,0);
 assert.equal((await request(p,planner.token,'GET')).status,200);
 const enabled=createApp({erp,kaiqen:createDemoKaiqen(),store,readKey:'r'.repeat(40),planKey:'p'.repeat(40),localWrites:true});
 enabled.listen(0,'127.0.0.1');await once(enabled,'listening');t.after(()=>{enabled.close();enabled.closeAllConnections();});
 const post=()=>fetch(`http://127.0.0.1:${enabled.address().port}/api/price-imports/batches/${a.id}/execute`,{method:'POST',headers:{authorization:'Bearer '+admin.token,'content-type':'application/json'},body:JSON.stringify({confirm:true,fingerprint:a.fingerprint})});
 const done=await post();assert.equal(done.status,200);assert.equal((await done.json()).counts.executed,1);
 assert.equal((await post()).status,200);assert.equal(writes,1);
});

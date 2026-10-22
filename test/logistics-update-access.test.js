import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {Store} from '../src/store.js';
import {Access} from '../src/access.js';
import {createApp} from '../src/app.js';
import {createDemoKaiqen} from '../src/demo.js';
import {HttpError} from '../src/errors.js';
import {proposalDiffRows} from '../public/proposal-values.js';

async function fixture(t){
 const store=new Store(':memory:'),access=new Access(store,['0101']),password='Prueba-aislada-2026';
 const admin=await access.setup({username:'admin',name:'Admin',password});
 const permissions=['read:catalogo','read:compras','read:preciosCompra','read:proveedores','plan:pedidoCompra','write:pedidoCompra'];
 const role=access.saveRole(admin.principal,{name:'Compras',permissions,branches:['0101']});
 const user=await access.saveUser(admin.principal,{username:'compras',name:'Compras',roleId:role.id,active:true,password});
 const login=await access.login({username:'compras',password},'fixture');
 const state={prepared:0,executed:0,current:'v1'};
 const writes={enabled:true,prepare:async()=>{state.prepared++;return {resource:'compras',snapshotHash:state.current,executionEnabled:true,identity:{numero:'000001'},documentScope:{items:2},diff:[{table:'SC7',record:'1',field:'C7_COND',before:'001',after:'002'},{table:'SC7',record:'2',field:'C7_COND',before:'001',after:'002'}],calculation:{affectedItems:2}};},check:async p=>{if(p.fingerprint!==state.current)throw new HttpError(409,'CONFLICTO_CONCURRENCIA','Cambió el pedido');return {executionEnabled:true};},execute:async p=>{if(p.fingerprint!==state.current)throw new HttpError(409,'CONFLICTO_CONCURRENCIA','Cambió el pedido');state.executed++;return {affected:2};}};
 const erp={writes,metadata:()=>({entities:{compras:{fields:[]}}}),list:async()=>({data:[{registro:'1',numero:'000001'}],meta:{}})};
 const server=createApp({erp,kaiqen:createDemoKaiqen(),store,branches:['0101'],localWrites:true,attentionOptions:{enabled:false},readKey:'r'.repeat(40),planKey:'p'.repeat(40),writeKey:'w'.repeat(40)});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 t.after(()=>{server.close();server.closeAllConnections();store.close();});
 const request=async(path,body,token=login.token)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...body?{'content-type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{}});return {status:r.status,data:await r.json()};};
 const input={action:'pedidoCompra',target:{sucursal:'0101',registro:'1'},changes:{condicionPago:'002',fechaEntrega:'2026-11-05',deposito:'03'}};
 return {store,access,admin,role,user,permissions,state,request,input,login,password};
}

test('logistics preview exposes complete document scope and requires explicit fingerprint confirmation',async t=>{
 const f=await fixture(t),prepared=await f.request('/api/changes/preview',f.input);
 assert.equal(prepared.status,201);const p=prepared.data;
 assert.deepEqual(p.documentScope,{items:2});assert.equal(p.diff.length,2);assert.equal(p.writePlan,undefined);assert.equal(p.input,undefined);assert.equal(f.state.executed,0);
 for(const body of [{confirm:false,fingerprint:p.fingerprint},{confirm:true,fingerprint:'wrong'}])assert.equal((await f.request(`/api/changes/${p.id}/execute`,body)).status,400);
 assert.equal(f.state.executed,0);
 assert.equal((await f.request(`/api/changes/${p.id}/execute`,{confirm:true,fingerprint:p.fingerprint})).status,200);
 assert.equal((await f.request(`/api/changes/${p.id}/execute`,{confirm:true,fingerprint:p.fingerprint})).status,200);
 assert.equal(f.state.executed,1);
});

test('another user and revoked write permission cannot confirm a logistics proposal',async t=>{
 const f=await fixture(t),p=(await f.request('/api/changes/preview',f.input)).data;
 const confirm={confirm:true,fingerprint:p.fingerprint};
 assert.equal((await f.request(`/api/changes/${p.id}/execute`,confirm,f.admin.token)).status,404);
 f.access.saveRole(f.admin.principal,{name:'Compras sin escritura',permissions:f.permissions.filter(p=>!p.startsWith('write:')),branches:['0101']},f.role.id);
 assert.equal((await f.request(`/api/changes/${p.id}/execute`,confirm)).status,403);
 assert.equal(f.state.executed,0);
});

test('changed document must be reviewed again; old logistics summary cannot execute',async t=>{
 const f=await fixture(t),p=(await f.request('/api/changes/preview',f.input)).data;
 f.state.current='v2';
 const r=await f.request(`/api/changes/${p.id}/execute`,{confirm:true,fingerprint:p.fingerprint});
 assert.equal(r.status,409);assert.equal(r.data.error.code,'CONFLICTO_CONCURRENCIA');assert.equal(f.state.executed,0);
 const fresh=(await f.request('/api/changes/preview',f.input)).data;assert.notEqual(fresh.fingerprint,p.fingerprint);assert.equal(f.state.executed,0);
});

test('catalog and planning permissions are required before any logistics source read',async t=>{
 const f=await fixture(t);
 f.access.saveRole(f.admin.principal,{name:'Lectura de compras',permissions:['read:compras','read:proveedores','read:preciosCompra','read:catalogo'],branches:['0101']},f.role.id);
 assert.equal((await f.request('/api/changes/preview',f.input)).status,403);assert.equal(f.state.prepared,0);
});

test('proposal dates are readable while warehouse and payment codes preserve leading zeros',()=>{
 assert.deepEqual(proposalDiffRows([{field:'C1_DATPRF',before:'20261022',after:'20261105'},{table:'SC7',record:'2',field:'C7_COND',before:'001',after:'002'},{field:'C6_LOCAL',before:'01',after:'03'},{field:'C6_PRCVEN',before:'0.058',after:'0.06'}]),[
  {campo:'Fecha de necesidad',antes:'22/10/2026',despues:'05/11/2026'},
  {tabla:'SC7',registro:'2',secuencia:'',campo:'Condición de pago',antes:'001',despues:'002'},
  {campo:'Depósito',antes:'01',despues:'03'},
  {campo:'C6_PRCVEN',antes:'0.058',despues:'0.06'}
 ]);
});

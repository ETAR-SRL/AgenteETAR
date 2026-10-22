import test from 'node:test';
import assert from 'node:assert/strict';
import {businessChat} from '../src/intelligence/business-chat.js';

function fixture(kind='purchase',{metadata={},catalog={}}={}){
 const conversation={messages:[],businessContext:{branch:'0101',kind,refs:{number:'123'},pending:null}},prepared=[],calls=[];
 const row={registro:'1',numero:'123',item:'01',productoCodigo:'Z1',precioUnitario:'5',cantidadPedida:'2',moneda:{codigo:'1'},proveedorCodigo:'P1',proveedorTienda:'01',clienteCodigo:'C1',clienteTienda:'01'};
 const context={conversation,branch:'0101',canPlan:true,metadata,prepare:async(actor,input)=>{prepared.push(input);return {executionEnabled:true};},read:async(resource,params)=>{
  calls.push({resource,filters:Object.fromEntries(params)});
  const data=['compras','itemsVentas','solicitudesCompra'].includes(resource)?[row]:resource==='productos'?[{codigo:'Z1',unidadMedida:'UN'}]:resource==='depositos'?[{codigo:'03'}]:resource==='condicionesPago'?[{codigo:'001'}]:[];
  return {data:catalog[resource]??data,meta:{hasMore:false}};
 }};
 return {conversation,prepared,calls,context,ask:text=>businessChat({...context,text})};
}

test('existing documents prepare logistics through the confirmed writer contract',async()=>{
 for(const kind of ['request','sale','purchase']){
  const f=fixture(kind),r=await f.ask('Cambiá la fecha de emisión al 23/10/2026; entrega al 28/10/2026; depósito 03');
  assert.equal(f.prepared.length,1,r.answer);
  assert.deepEqual(f.prepared[0].changes,{fechaEmision:'2026-10-23',fechaEntrega:'2026-10-28',deposito:'03'});
  assert.match(r.answer,/confirmá las tarjetas/);assert.equal(f.prepared[0].target.registro,'1');
 }
});

test('payment retains zeroes and identifies document scope; SC1 rejects mixed payment',async()=>{
 for(const kind of ['sale','purchase']){
  const f=fixture(kind),r=await f.ask('Condición de pago 001');
  assert.equal(f.prepared[0].changes.condicionPago,'001');assert.match(r.answer,/todo el documento/);
  assert.equal(f.calls.find(c=>c.resource==='condicionesPago').filters.codigo,'001');
 }
 const f=fixture('request');f.conversation.businessContext.pending={price:'8',priceUnit:'unidad'};
 const r=await f.ask('condición de pago 001');assert.equal(f.prepared.length,0);assert.match(r.answer,/no tiene un campo estándar/);
 await f.ask('cancelar cambio de pago');assert.deepEqual(f.prepared[0].changes,{precioUnitario:'8'});
});

test('rejected logistics survive long history and resolve only affirmative replacements',async()=>{
 const f=fixture();f.conversation.businessContext.pending={price:'8',priceUnit:'unidad',quantity:'4',quantityUnit:'unidades'};
 await f.ask('Ese depósito no');
 f.conversation.messages=Array.from({length:100},()=>({role:'user',content:'consulta intermedia'}));
 await f.ask('depósito anterior');assert.equal(f.prepared.length,0);
 await f.ask('depósito 03');assert.deepEqual(f.prepared[0].changes,{deposito:'03',precioUnitario:'8',cantidadPedida:'4'});
});

test('ambiguous date candidate survives clarification and invalid calendar blocks mixed edits',async()=>{
 const f=fixture();let r=await f.ask('cambiá la fecha al 28/10/2026');assert.equal(f.prepared.length,0,r.answer);
 await f.ask('la de entrega');assert.deepEqual(f.prepared[0].changes,{fechaEntrega:'2026-10-28'});
 const g=fixture();g.conversation.businessContext.pending={price:'8',priceUnit:'unidad'};
 await g.ask('emisión 31/02/2026');await g.ask('confirmo');assert.equal(g.prepared.length,0);
 await g.ask('emisión 28/02/2026');assert.deepEqual(g.prepared[0].changes,{fechaEmision:'2026-02-28',precioUnitario:'8'});
});

test('mismatched and absent catalog codes cannot become previews or fallback names',async()=>{
 for(const rows of [[],[{codigo:'99'}]]){
  const f=fixture('purchase',{metadata:{entities:{depositos:{filters:{q:'nombre'}}}},catalog:{depositos:rows}});
  const r=await f.ask('depósito 03');assert.equal(f.prepared.length,0,r.answer);
  assert.ok(f.conversation.businessContext.unresolvedValues.includes('warehouse'));
  await f.ask('confirmo');assert.equal(f.prepared.length,0);assert.ok(!f.calls.some(c=>c.filters.q));
 }
});

test('catalog failure and revoked action authorization preserve pending changes',async()=>{
 const f=fixture();f.context.read=async()=>{throw Error('timeout');};
 await assert.rejects(f.ask('depósito 03'),/timeout/);assert.equal(f.prepared.length,0);assert.equal(f.conversation.businessContext.pending.warehouse,'03');
 const g=fixture();g.context.authorizePlan=async()=>{throw Object.assign(Error('denied'),{status:403});};
 await assert.rejects(g.ask('depósito 03'),{status:403});assert.equal(g.calls.length,0);assert.equal(g.prepared.length,0);
});

test('numeric logistics literals cannot replace an independently specified price',async()=>{
 const f=fixture();const r=await f.ask('Cambiá la entrega a 28/10/2026; depósito 03; precio a 8 por unidad');
 assert.equal(f.prepared.length,1,r.answer);
 assert.deepEqual(f.prepared[0].changes,{fechaEntrega:'2026-10-28',deposito:'03',precioUnitario:'8'});
});


test('header edits use one representative item; mixed multi-item edits retain scope for clarification',async()=>{
 for(const change of ['emisión 23/10/2026','pago 001']){
  const f=fixture();const read=f.context.read;
  f.context.read=async(resource,params)=>{const r=await read(resource,params);if(resource==='compras')r.data.push({...r.data[0],registro:'2',item:'02'});return r;};
  const r=await f.ask(change);assert.equal(f.prepared.length,1,r.answer);assert.match(r.answer,/todo el documento/);
 }
 const f=fixture();const read=f.context.read;
 f.context.read=async(resource,params)=>{const r=await read(resource,params);if(resource==='compras')r.data.push({...r.data[0],registro:'2',item:'02'});return r;};
 const r=await f.ask('Todos, emisión 23/10/2026; depósito 03');assert.equal(f.prepared.length,0);assert.match(r.answer,/único ítem/);
 assert.equal(f.conversation.businessContext.pending.emission,'2026-10-23');assert.equal(f.conversation.businessContext.pending.warehouse,'03');
});

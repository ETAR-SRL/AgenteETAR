import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {createIntelligence} from '../src/intelligence/agent.js';
import {createBusinessTools} from '../src/intelligence/tools.js';

function fixture(t){
 const store=new Store(':memory:');t.after(()=>store.close());
 const calls=[],prepared=[];
 const product={codigo:'1',nombre:'VARIOS-MIGRACION',tipo:{codigo:'SV',descripcion:'SERVICIO'},unidadMedida:'UN',depositoPredeterminado:'16',bloqueado:{codigo:'2'}};
 let found=true,denied=false,modelCalls=0;
 const read=async(resource,p)=>{
  calls.push({resource,filters:Object.fromEntries(p)});
  if(denied)throw Object.assign(new Error('Esto no podés leerlo.'),{code:'LECTURA_DENEGADA',status:403});
  return {data:resource==='productos'?(found&&p.get('codigo')===product.codigo?[{...product}]:[]):resource==='depositos'&&p.get('codigo')==='16'?[{codigo:'16'}]:[],meta:{hasMore:false},source:{system:'protheus'}};
 };
 const model={name:'fixture',complete:async()=>{modelCalls++;return {action:'responder',answer:'El producto es terminado Z. ¿Cantidad?',args:{}};}};
 const agent=createIntelligence({store,erp:{metadata:()=>({entities:{productos:{},depositos:{}}})},kaiqen:{},branches:['0101','0201'],read,model,prepareChange:async(actor,input)=>{prepared.push(input);return {id:'test',warnings:[],executionEnabled:true};}});
 const query=(text,conversationId,actor='user:a',branch='0101')=>agent.query(actor,{text,conversationId,context:{sucursal:branch}},{canPlan:true});
 return {query,read,calls,prepared,product,get modelCalls(){return modelCalls;},set found(v){found=v;},set denied(v){denied=v;}};
}
test('numeric product 1 is read exactly and its real type is returned without model calls',async t=>{
 const f=fixture(t);
 const r=await f.query('Creame una solicitud de compra con el producto 1.');
 assert.match(r.answer,/VARIOS-MIGRACION/);assert.match(r.answer,/SERVICIO/);assert.doesNotMatch(r.answer,/terminado|grupo Z/);
 assert.equal(f.modelCalls,0);assert.equal(f.calls.length,1);assert.equal(f.calls[0].filters.codigo,'1');assert.equal(f.prepared.length,0);
 assert.doesNotMatch(r.answer,/fecha de emisión|solicitante/);assert.ok(r.durationMs>=0);
});
test('SC1 intake keeps supplied fields and prepares only a reviewable proposal',async t=>{
 const f=fixture(t),first=await f.query('Creame una solicitud de compra con el producto 1');
 const second=await f.query('10 unidades a 25 pesos por unidad',first.conversationId);
 assert.doesNotMatch(second.answer,/Falta cantidad|Falta precio/);assert.equal(f.prepared.length,0);
 const third=await f.query('depósito 16; emisión 20/10/2026; necesidad 21/10/2026; solicitante Ana',first.conversationId);
 assert.equal(f.modelCalls,0);assert.equal(f.prepared.length,1);
 assert.deepEqual(f.prepared[0].items,[{producto:'1',deposito:'16',fechaNecesidad:'2026-10-21',cantidad:'10',precio:'25',baseCantidad:'unidades',basePrecio:'unidad'}]);
 assert.equal(f.prepared[0].header.moneda,'ARS');assert.match(third.answer,/No se creó ningún documento/);assert.equal(third.evidence.at(-1).result.kind,'proposal');
 assert.equal(f.calls.filter(c=>c.resource==='productos').length,3);
});
test('missing, duplicated and denied products cannot be claimed as verified',async t=>{
 const f=fixture(t);f.found=false;
 const missing=await f.query('Generame una solicitud de compra con producto 1');
 assert.match(missing.answer,/No encontré el código exacto 1/);assert.doesNotMatch(missing.answer,/Producto verificado/);
 f.denied=true;const denied=await f.query('Creá una solicitud de compra con el producto 1');
 assert.equal(denied.accessDenied,true);assert.equal(denied.evidence.length,0);assert.match(denied.answer,/Esto no podés leerlo/);assert.equal(f.modelCalls,0);
});
test('drafts do not cross owners or branches, and cancellation never prepares',async t=>{
 const f=fixture(t),r=await f.query('Creá una solicitud de compra con producto 1');
 await assert.rejects(f.query('10 unidades',r.conversationId,'user:b'),{code:'CONVERSACION_NO_EXISTE'});
 await f.query('10 unidades',r.conversationId,'user:a','0201');assert.equal(f.prepared.length,0);
 const other=await f.query('Creá una solicitud de compra con producto 1');
 const cancelled=await f.query('cancelalo',other.conversationId);assert.match(cancelled.answer,/Descarté/);assert.equal(f.prepared.length,0);
});
test('millares do not apply to KG and a currency does not infer importation',async t=>{
 const f=fixture(t);f.product.unidadMedida='KG';
 const r=await f.query('Creá una solicitud de compra con producto 1, 2 millares a 80 dólares por millar');
 assert.match(r.answer,/base de cantidad: KG/);assert.match(r.answer,/confirmar si corresponde una solicitud de importación/);assert.equal(f.prepared.length,0);
});
test('generic response cannot smuggle a fabricated assertion before a question',async t=>{
 const f=fixture(t),r=await f.query('Ayudame con una operación');
 assert.doesNotMatch(r.answer,/terminado Z/);assert.equal(r.evidence.length,0);assert.equal(f.modelCalls,2);
});
test('business search accepts one-character exact codes, without wildcard fallback',async t=>{
 const f=fixture(t),tools=createBusinessTools({read:f.read,branch:'0101',metadata:{entities:{}}});
 assert.equal((await tools.run('buscar',{recurso:'productos',texto:'1'})).data[0].codigo,'1');
 const missing=await tools.run('buscar',{recurso:'productos',texto:'9'});assert.equal(missing.data.length,0);
 assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>!c.filters.q));
});

test('SC1 asks only for quantity/logistics and prepares without price or currency',async t=>{
 const f=fixture(t),r=await f.query('Creame una solicitud de compra con producto 1');
 assert.doesNotMatch(r.answer,/necesito.*precio|necesito.*moneda/);
 const next=await f.query('10 unidades; depósito 16; emisión 20/10/2026; necesidad 21/10/2026; solicitante Ana',r.conversationId);
 assert.equal(f.prepared.length,1,next.answer);assert.equal(f.prepared[0].items[0].precio,undefined);assert.equal(f.prepared[0].header.moneda,'ARS');
});

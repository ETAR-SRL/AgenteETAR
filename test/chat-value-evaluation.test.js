import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoErp} from '../src/demo.js';
import {createChatEvaluationHarness} from '../src/intelligence/chat-live-evaluation.js';
import {evaluateValueChat} from '../src/intelligence/chat-value-evaluation.js';

const rows={productos:[{codigo:'Z731',nombre:'Reservado producto',unidadMedida:'UN',depositoPredeterminado:'01'}],preciosClientes:[{listaCodigo:'L71',productoCodigo:'Z731'}]};
const model={name:'controlled',local:true,complete:async(_messages,schema)=>({action:'responder',args:{},answer:schema.properties.answer.enum?.[0]||'Indicá el precio, la cantidad o la moneda que corresponde.'})};
const erp=()=>({...createDemoErp(),list:async(resource,params)=>{
 let data=structuredClone(rows[resource]||[]);
 for(const [filter,key] of Object.entries({codigo:'codigo',lista:'listaCodigo'}))if(params.has(filter))data=data.filter(r=>r[key]===params.get(filter));
 return {data,meta:{hasMore:false}};
}});

test('value evaluation reports insufficient source rows without inventing commercial references',async t=>{
 const h=await createChatEvaluationHarness({erp:{...createDemoErp(),list:async()=>({data:[],meta:{hasMore:false}})},model});t.after(()=>h.close());
 const report=await evaluateValueChat(h);
 assert.equal(report.status,'pending');assert.equal(report.cases.length,3);assert.ok(report.cases.every(c=>c.status==='pending'&&c.controlledDoubleRequired));assert.equal(report.counts.modelCalls,0);assert.equal(report.counts.executionCalls,0);
 await assert.rejects(evaluateValueChat(h,{distractorTurns:45}),/VALUE_EVALUATION_TURNS/);
});

test('value discovery bounds exact DA1 to SB1 reads and never substitutes a product from another source',async t=>{
 let exactReads=0;
 const h=await createChatEvaluationHarness({erp:{...erp(),list:async(resource,params)=>{
  if(resource==='preciosClientes')return {data:Array.from({length:30},(_,i)=>({productoCodigo:'Z'+i})),meta:{hasMore:true}};
  if(resource==='productos'){if(params.has('codigo'))exactReads++;return {data:[],meta:{hasMore:false}};}
  return {data:[],meta:{hasMore:false}};
 }},model});t.after(()=>h.close());
 const report=await evaluateValueChat(h);assert.equal(exactReads,10);assert.equal(report.references.exactProductQueries,10);assert.equal(report.references.verifiedDa1Sb1,false);assert.equal(report.counts.modelCalls,0);
});

test('controlled HTTP value suite verifies independent bases, long detours, pending corrections and user isolation',async t=>{
 const h=await createChatEvaluationHarness({erp:erp(),model});t.after(()=>h.close());
 const report=await evaluateValueChat(h);
 assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(report.unavailableCases,0);assert.equal(report.cases.length,3);
 assert.ok(report.cases.every(c=>c.history.distractorTurns===46&&c.checks.pendingCleared&&c.checks.noPrematureProposal&&c.checks.warehouseNotInferred));
 assert.equal(report.checks.peerIsolation,true);assert.equal(report.checks.peerCannotMutate,true);assert.equal(report.checks.deniedBeforeConnector,true);assert.equal(report.checks.revokedHistory,true);assert.equal(report.counts.executionCalls,0);assert.equal(report.confirmationRequests,0);
 for(const row of Object.values(rows).flat())for(const key of ['codigo','nombre','listaCodigo','productoCodigo'])if(row[key])assert.ok(!JSON.stringify(report).includes(row[key]));
});

test('controlled HTTP base corrections keep quantity base and price base independent',async t=>{
 const h=await createChatEvaluationHarness({erp:erp(),model});t.after(()=>h.close());
 const start=await h.chat('Creame una solicitud de compra con producto Z731, 3 millares a 80 pesos por unidad');const id=start.data.conversationId;
 const state=()=>h.conversation(id)?.purchaseDraft||h.conversation(id)?.pausedPurchase;
 let r=await h.chat('Por unidad no, por millar',id);
 assert.equal(r.status,200);assert.equal(state().values.quantity,'3');assert.equal(state().values.quantityUnit,'millares');assert.equal(state().values.price,'80');assert.equal(state().values.priceUnit,'millar');
 r=await h.chat('Cantidad en unidades, precio por millar',id);
 assert.equal(r.status,200);assert.equal(state().values.quantity,'3');assert.equal(state().values.quantityUnit,'unidades');assert.equal(state().values.price,'80');assert.equal(state().values.priceUnit,'millar');assert.equal(state().values.currency,'ARS');
 assert.ok(!r.data.evidence.some(e=>e.result?.kind==='proposal'));assert.equal(h.counts.executionCalls,0);
});

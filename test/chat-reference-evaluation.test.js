import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoErp} from '../src/demo.js';
import {createChatEvaluationHarness} from '../src/intelligence/chat-live-evaluation.js';
import {evaluateReferenceChat,referenceClarificationAsked} from '../src/intelligence/chat-reference-evaluation.js';

const rows={productos:[{codigo:'Z731',nombre:'Reservado producto',unidadMedida:'UN'},{codigo:'Z732',nombre:'Reservado otro',unidadMedida:'UN'}],clientes:[{codigo:'C71',tienda:'03',nombre:'Reservado cliente',listaPreciosCodigo:'L71'},{codigo:'C72',tienda:'04',nombre:'Reservado reemplazo',listaPreciosCodigo:'L72'}],listasPreciosClientes:[{codigo:'L71'},{codigo:'L72'}],preciosClientes:[{listaCodigo:'L71',productoCodigo:'Z731'},{listaCodigo:'L72',productoCodigo:'Z732'}],itemsVentas:[{numero:'731001',item:'01',productoCodigo:'Z731'},{numero:'731002',item:'02',productoCodigo:'Z732'}],compras:[]};
const model={name:'controlled',local:true,complete:async(_messages,schema)=>({action:'responder',args:{},answer:schema.properties.answer.enum?.[0]||'Indicá la referencia que corresponde.'})};
const erp=()=>({...createDemoErp(),list:async(resource,params)=>{
 let data=structuredClone(rows[resource]||[]);
 for(const [filter,key] of Object.entries({codigo:'codigo',tienda:'tienda',lista:'listaCodigo',numero:'numero',item:'item'}))if(params.has(filter))data=data.filter(r=>r[key]===params.get(filter));
 return {data,meta:{hasMore:false}};
}});

test('reference rubric requires a question or concrete request for a reference',()=>{
 assert.equal(referenceClarificationAsked('Indicá el producto que corresponde.'),true);
 assert.equal(referenceClarificationAsked('¿Qué cliente corresponde?'),true);
 assert.equal(referenceClarificationAsked('Conservé el cliente anterior.'),false);
});

test('reference evaluation never fabricates missing source rows or calls a model to discover them',async t=>{
 const h=await createChatEvaluationHarness({erp:{...createDemoErp(),list:async()=>({data:[],meta:{hasMore:false}})},model});t.after(()=>h.close());
 const report=await evaluateReferenceChat(h);
 assert.equal(report.status,'pending');
 assert.equal(report.cases.length,5);assert.ok(report.cases.every(c=>c.status==='pending'&&c.controlledDoubleRequired));assert.equal(report.counts.modelCalls,0);assert.equal(report.counts.executionCalls,0);
 await assert.rejects(evaluateReferenceChat(h,{distractorTurns:45}),/REFERENCE_EVALUATION_TURNS/);
});

test('reference discovery is bounded to ten exact DA1 to SB1 reads',async t=>{
 let exactReads=0;
 const h=await createChatEvaluationHarness({erp:{...erp(),list:async(resource,params)=>{
  if(resource==='preciosClientes')return {data:Array.from({length:30},(_,i)=>({productoCodigo:'Z'+i})),meta:{hasMore:true}};
  if(resource==='productos'){if(params.has('codigo'))exactReads++;return {data:[],meta:{hasMore:false}};}
  return {data:[],meta:{hasMore:false}};
 }},model});t.after(()=>h.close());
 const report=await evaluateReferenceChat(h);assert.equal(exactReads,10);assert.equal(report.references.exactProductQueries,10);assert.equal(report.references.verifiedProducts,0);assert.equal(report.counts.modelCalls,0);
});

test('reference HTTP evaluation checks long detours, corrections and access without exposing ERP identities',async t=>{
 const h=await createChatEvaluationHarness({erp:erp(),model});t.after(()=>h.close());
 const report=await evaluateReferenceChat(h);
 assert.equal(report.errorCode,undefined,JSON.stringify(report));
 assert.equal(report.status,'passed',JSON.stringify(report));
 assert.ok(report.cases.filter(c=>c.status!=='pending').every(c=>c.history?.distractorTurns===46));
 assert.equal(report.cases.find(c=>c.kind==='purchaseOrder').status,'pending');
 assert.equal(report.checks.peerIsolation,true);assert.equal(report.checks.deniedRead,true);assert.equal(report.checks.deniedBeforeConnector,true);assert.equal(report.checks.revokedHistory,true);assert.equal(report.checks.revokedBeforeConnector,true);assert.equal(report.counts.executionCalls,0);assert.equal(report.confirmationRequests,0);
 for(const row of Object.values(rows).flat())for(const key of ['codigo','nombre','numero','listaCodigo','productoCodigo'])if(row[key])assert.ok(!JSON.stringify(report).includes(row[key]));
});

test('SC7 absent from real samples is covered separately using controlled source rows',async t=>{
 const base=erp(),purchaseRows=[{numero:'831001',item:'01',productoCodigo:'Z731'},{numero:'831002',item:'02',productoCodigo:'Z732'}];
 const h=await createChatEvaluationHarness({erp:{...base,list:async(resource,params)=>{
  if(resource!=='compras')return base.list(resource,params);
  let data=structuredClone(purchaseRows);for(const key of ['numero','item'])if(params.has(key))data=data.filter(r=>r[key]===params.get(key));return {data,meta:{hasMore:false}};
 }},model});t.after(()=>h.close());
 const report=await evaluateReferenceChat(h);assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(report.unavailableCases,0);assert.equal(report.cases.find(c=>c.kind==='purchaseOrder').status,'passed');assert.equal(report.counts.executionCalls,0);
 for(const row of purchaseRows)assert.ok(!JSON.stringify(report).includes(row.numero));
});

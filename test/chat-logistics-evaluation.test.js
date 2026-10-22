import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoErp} from '../src/demo.js';
import {createChatEvaluationHarness} from '../src/intelligence/chat-live-evaluation.js';
import {evaluateLogisticsChat} from '../src/intelligence/chat-logistics-evaluation.js';

const rows={productos:[{codigo:'Z731',nombre:'Reservado producto',unidadMedida:'UN',depositoPredeterminado:'16'}],depositos:[{codigo:'16',nombre:'Reservado depósito'},{codigo:'17',nombre:'Otro depósito'}],condicionesPago:[{codigo:'001',nombre:'Reservado pago'},{codigo:'002',nombre:'Otro pago'}],proveedores:[{codigo:'009731',tienda:'01',nombre:'Reservado proveedor'}]};
const model={name:'controlled',local:true,complete:async(_messages,schema)=>({action:'responder',args:{},answer:schema.properties.answer.enum?.[0]||'Indicá el dato que corresponde.'})};
const erp=()=>({...createDemoErp(),list:async(resource,params)=>{
 let data=structuredClone(rows[resource]||[]);
 for(const key of ['codigo','tienda'])if(params.has(key))data=data.filter(r=>r[key]===params.get(key));
 return {data,meta:{hasMore:false}};
}});

test('logistics evaluation leaves unavailable real references pending without invented codes',async t=>{
 const h=await createChatEvaluationHarness({erp:{...createDemoErp(),list:async()=>({data:[],meta:{hasMore:false}})},model});t.after(()=>h.close());
 const report=await evaluateLogisticsChat(h);
 assert.equal(report.status,'pending');assert.equal(report.cases.length,4);assert.ok(report.cases.every(c=>c.status==='pending'&&c.controlledDoubleRequired));assert.equal(report.counts.modelCalls,0);assert.equal(report.counts.executionCalls,0);
 await assert.rejects(evaluateLogisticsChat(h,{distractorTurns:45}),/LOGISTICS_EVALUATION_TURNS/);
});

test('logistics discovery bounds exact catalog reads and rejects ambiguous references',async t=>{
 let exactReads=0;
 const h=await createChatEvaluationHarness({erp:{...createDemoErp(),list:async(resource,params)=>{
  if(params.has('codigo')){exactReads++;return {data:[{codigo:params.get('codigo')},{codigo:params.get('codigo')}],meta:{hasMore:true}};}
  return {data:Array.from({length:30},(_,i)=>({codigo:resource==='productos'?'Z'+i:String(i),tienda:'01',unidadMedida:'UN'})),meta:{hasMore:true}};
 }},model});t.after(()=>h.close());
 const report=await evaluateLogisticsChat(h);assert.equal(exactReads,40);assert.equal(report.references.exactQueries,40);assert.equal(report.references.productVerified,false);assert.equal(report.counts.modelCalls,0);assert.ok(report.cases.every(c=>c.status==='pending'));
});

test('controlled HTTP logistics suite preserves other values through real long detours and isolation',async t=>{
 const h=await createChatEvaluationHarness({erp:erp(),model});t.after(()=>h.close());
 const report=await evaluateLogisticsChat(h);
 assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(report.unavailableCases,0);assert.equal(report.cases.length,4);
 assert.ok(report.cases.every(c=>c.history.distractorTurns===46&&c.checks.pendingCleared&&c.checks.noPrematureProposal&&c.checks.stillIncomplete&&c.checks.correctedCatalogVerified));
 assert.equal(report.checks.peerIsolation,true);assert.equal(report.checks.peerCannotMutate,true);assert.equal(report.checks.deniedBeforeConnector,true);assert.equal(report.checks.revokedHistory,true);assert.equal(report.counts.executionCalls,0);assert.equal(report.confirmationRequests,0);
 for(const row of Object.values(rows).flat())if(row.nombre)assert.ok(!JSON.stringify(report).includes(row.nombre));
 assert.ok(!JSON.stringify(report).includes(rows.productos[0].codigo));assert.ok(!JSON.stringify(report).includes(rows.proveedores[0].codigo));
});

test('one catalog row cannot stand in for a distinct logistics correction',async t=>{
 const h=await createChatEvaluationHarness({erp:{...erp(),list:async(resource,params)=>{
  let data=structuredClone((rows[resource]||[]).slice(0,1));
  for(const key of ['codigo','tienda'])if(params.has(key))data=data.filter(r=>r[key]===params.get(key));
  return {data,meta:{hasMore:false}};
 }},model});t.after(()=>h.close());
 const report=await evaluateLogisticsChat(h);assert.ok(report.cases.filter(c=>['warehouse','payment'].includes(c.kind)).every(c=>c.status==='pending'));
 assert.equal(report.counts.executionCalls,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoErp} from '../src/demo.js';
import {createChatEvaluationHarness} from '../src/intelligence/chat-live-evaluation.js';
import {evaluateLongChat} from '../src/intelligence/chat-long-evaluation.js';

test('long-chat HTTP evaluator requires original recovered identity and source, without leaking rows',async t=>{
 const demo=createDemoErp(),target={codigo:'Z-REFERENCE1',nombre:'Controlado',unidadMedida:'UN'};
 const erp={...demo,list:async(resource,params)=>{
  if(resource==='productos'&&params.get('codigo')===target.codigo)return {data:[target],meta:{hasMore:false}};
  if(resource==='listasPreciosClientes')return {data:[{codigo:'DEMO',nombre:'Lista controlada',estado:{descripcion:'Activo'},vigenteDesde:'2026-01-01'}],meta:{hasMore:false}};
  const query=new URLSearchParams(params);if(resource==='preciosClientes')query.delete('producto');
  const result=await demo.list(resource,query);
  if(resource==='productos'&&!params.has('codigo'))return {...result,data:[target,...result.data]};
  if(resource==='preciosClientes')return {...result,data:result.data.map(p=>({...p,productoCodigo:target.codigo,activo:{descripcion:'Activo'}}))};
  return result;
 }};
 let remembered=false;
 const model={name:'controlled',local:true,status:async()=>({available:true}),complete:async messages=>{
  remembered=messages.some(m=>m.role==='user'&&m.content===`Mostrame el producto ${target.codigo}`);
  return {action:'precio_venta',args:{producto:target.codigo},answer:''};
 }};
 const h=await createChatEvaluationHarness({erp,model});t.after(()=>h.close());
 const report=await evaluateLongChat(h,{turns:32});
 assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(remembered,true);
 assert.equal(report.historyTurns,32);assert.equal(report.counts.executionCalls,0);
 assert.ok(!JSON.stringify(report).includes(target.codigo));
});

test('long-chat evaluator never approves a current-price question with empty DA1 evidence',async t=>{
 const demo=createDemoErp(),target={codigo:'Z-EMPTY1',nombre:'Sin precio controlado',unidadMedida:'UN'};
 const erp={...demo,list:async(resource,params)=>{
  if(resource==='productos'&&params.get('codigo')===target.codigo)return {data:[target],meta:{hasMore:false}};
  if(resource==='preciosClientes')return {data:params.has('producto')?[]:[{productoCodigo:target.codigo}],meta:{hasMore:false}};
  const r=await demo.list(resource,params);return resource==='productos'&&!params.has('codigo')?{...r,data:[target,...r.data]}:r;
 }};
 const h=await createChatEvaluationHarness({erp,model:{name:'controlled',local:true,complete:async()=>({action:'precio_venta',args:{producto:target.codigo},answer:''})}});t.after(()=>h.close());
 const report=await evaluateLongChat(h,{turns:12});assert.equal(report.status,'failed');assert.equal(report.checks.originalReferenceRecovered,true);assert.equal(report.checks.currentPriceAvailable,false);assert.equal(report.checks.unitAndThousandPricesVerified,false);
});

test('long-chat evaluator does not credit an invented model result or an absent sample',async t=>{
 const erp=createDemoErp(),model={local:true,name:'controlled',complete:async()=>({action:'responder',args:{},answer:'No consulté.'})};
 const h=await createChatEvaluationHarness({erp,model});t.after(()=>h.close());
 const report=await evaluateLongChat(h,{turns:12});
 assert.notEqual(report.status,'passed');assert.equal(report.counts.executionCalls,0);
 await assert.rejects(evaluateLongChat(h,{turns:100}),/LONG_EVALUATION_TURNS/);
});

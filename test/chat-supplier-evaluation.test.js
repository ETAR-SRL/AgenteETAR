import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoErp} from '../src/demo.js';
import {createChatEvaluationHarness} from '../src/intelligence/chat-live-evaluation.js';
import {evaluateSupplierChat,supplierClarificationAsked} from '../src/intelligence/chat-supplier-evaluation.js';

const rows={productos:[{codigo:'Z731',nombre:'Reservado producto',unidadMedida:'UN'},{codigo:'Z732',nombre:'Reservado distractor',unidadMedida:'UN'}],proveedores:[{codigo:'V72',tienda:'03',nombre:'Reservado origen'},{codigo:'V73',tienda:'04',nombre:'Reservado reemplazo'}]};
const erp=()=>({...createDemoErp(),list:async(resource,params)=>{
 let data=structuredClone(rows[resource]||[]);
 for(const key of ['codigo','tienda'])if(params.has(key))data=data.filter(r=>r[key]===params.get(key));
 return {data,meta:{hasMore:false}};
}});
const model={name:'controlled',local:true,complete:async(_messages,schema)=>({action:'responder',args:{},answer:schema.properties.answer.enum?.[0]||'¿Qué proveedor corresponde?'})};

test('supplier clarification rubric requires a question or concrete instruction',()=>{
 for(const text of ['¿Qué proveedor corresponde?','¿Con qué proveedor querés hacer el pedido?','Me falta confirmar el proveedor. ¿Con cuál hacemos esta compra?','Indicá de forma afirmativa el proveedor que corresponde.'])assert.equal(supplierClarificationAsked(text),true,text);
 for(const text of ['Conservé el proveedor anterior.','Ya preparé el proveedor. ¿Confirmás la ejecución?','No consulté proveedores.','¿Cuál es el precio?','Proveedor pendiente.'])assert.equal(supplierClarificationAsked(text),false,text);
});

test('supplier evaluation requires real source references and never synthesizes missing rows',async t=>{
 const h=await createChatEvaluationHarness({erp:{...createDemoErp(),list:async()=>({data:[],meta:{hasMore:false}})},model:{local:true,complete:async()=>{throw Error('UNEXPECTED_MODEL');}}});t.after(()=>h.close());
 const report=await evaluateSupplierChat(h);assert.equal(report.status,'pending');assert.equal(report.reason,'SUPPLIER_EVALUATION_REFERENCES_INSUFFICIENT');assert.equal(report.counts.modelCalls,0);assert.equal(report.counts.executionCalls,0);
 await assert.rejects(evaluateSupplierChat(h,{distractorTurns:45}),/SUPPLIER_EVALUATION_TURNS/);
});

test('supplier HTTP negation, long history, replacement and permissions produce only private checks',async t=>{
 const h=await createChatEvaluationHarness({erp:erp(),model});t.after(()=>h.close());
 const report=await evaluateSupplierChat(h);
 assert.equal(report.status,'passed',JSON.stringify(report));assert.ok(report.history.turns>45);assert.ok(report.history.messages>90);
 assert.equal(report.confirmationRequests,0);assert.equal(report.counts.executionCalls,0);assert.ok(report.fallback.modelCalls>0);
 const serialized=JSON.stringify(report);for(const row of Object.values(rows).flat())for(const key of ['codigo','nombre','tienda'])if(row[key]&&row[key].length>2)assert.ok(!serialized.includes(row[key]));
 assert.equal(report.checks.deniedBeforeConnector,true);assert.equal(report.checks.revokedBeforeConnector,true);
});

test('supplier evaluation discovers bounded DA1 references and verifies exact SB1 when initial page has no finished product',async t=>{
 const base=erp();let priceReads=0,exactReads=0;
 const h=await createChatEvaluationHarness({erp:{...base,list:async(resource,params)=>{
  if(resource==='preciosClientes'){priceReads++;assert.equal(params.get('limit'),'100');return {data:[{productoCodigo:'Z731'}],meta:{hasMore:false}};}
  if(resource==='productos'&&!params.has('codigo'))return {data:[{codigo:'A100',nombre:'Otro producto de muestra',unidadMedida:'KG'}],meta:{hasMore:true}};
  if(resource==='productos'&&params.get('codigo')==='A100')return {data:[{codigo:'A100',nombre:'Otro producto de muestra',unidadMedida:'KG'}],meta:{hasMore:false}};
  if(resource==='productos'&&params.has('codigo'))exactReads++;
  return base.list(resource,params);
 }},model});t.after(()=>h.close());
 const report=await evaluateSupplierChat(h);assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(priceReads,1);assert.ok(exactReads>0);assert.equal(report.references.exactProductQueries,1);assert.equal(report.references.priceReferenceVerified,true);
 for(const value of ['Z731','A100','Otro producto de muestra'])assert.ok(!JSON.stringify(report).includes(value));
});

test('supplier reference discovery stops after ten exact candidates and never invents a finished product',async t=>{
 let exactReads=0;
 const h=await createChatEvaluationHarness({erp:{...erp(),list:async(resource,params)=>{
  if(resource==='preciosClientes')return {data:Array.from({length:30},(_,i)=>({productoCodigo:'Z'+i})),meta:{hasMore:true}};
  if(resource==='productos'){if(params.has('codigo'))exactReads++;return {data:[],meta:{hasMore:false}};}
  return {data:structuredClone(rows[resource]||[]),meta:{hasMore:false}};
 }},model});t.after(()=>h.close());
 const report=await evaluateSupplierChat(h);assert.equal(report.status,'pending');assert.equal(exactReads,10);assert.equal(report.references.exactProductQueries,10);assert.equal(report.references.unitProduct,false);assert.equal(report.counts.modelCalls,0);
});

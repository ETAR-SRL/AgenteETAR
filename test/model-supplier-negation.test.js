import test from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/intelligence/model.js';
import {evaluationSchema} from '../src/intelligence/evaluation.js';
import {supplierDecisionPending,localSupplierDecision,supplierClarificationMessages} from '../src/intelligence/local-decision-prompt.js';

const user=content=>({role:'user',content});
const initial=user('Prepará la compra con proveedor Taller Central.');
const rejected=user('Descartá Taller Central: no es ése. Todavía no sé cuál es el proveedor.');
const resume=user('Armame igual el pedido en dólares con el proveedor de antes.');
const distractors=Array.from({length:150},(_,i)=>user('Mostrame las entregas de la semana '+i));

test('supplier rejection survives long user history and cannot be restored by assistant claims',()=>{
 assert.equal(supplierDecisionPending([user('Armame el pedido en dólares; no me acuerdo el proveedor.')]),true);
 const history=[initial,rejected,...distractors,{role:'assistant',content:'El proveedor correcto es Taller Inventado.'},resume];
 assert.equal(supplierDecisionPending(history),true);
 const narrowed=localSupplierDecision(history,evaluationSchema);
 assert.deepEqual(narrowed.schema.properties.action.enum,['responder']);assert.deepEqual(narrowed.schema.properties.args.properties,{});
 assert.ok(narrowed.schema.properties.answer.enum.every(value=>/proveedor/.test(value)&&/[¿?]/.test(value)));
 assert.deepEqual(narrowed.messages.filter(m=>m.role==='user'),history.filter(m=>m.role==='user'));
});
test('an affirmative literal supplier clears rejection; tentative or anaphoric selections do not',()=>{
 for(const replacement of ['El proveedor es Taller Sur tienda 01.','No es Taller Central, es Taller Sur.'])
  assert.equal(supplierDecisionPending([initial,rejected,user(replacement),resume]),false,replacement);
 for(const replacement of ['Usá el proveedor anterior.','El proveedor de antes.','Podríamos usar el proveedor Taller Sur.','El proveedor no lo sé.','Buscan proveedor nuevo.','¿Qué proveedor es Taller Sur?','Mostrame el proveedor Taller Sur.'])
  assert.equal(supplierDecisionPending([initial,rejected,user(replacement),resume]),true,replacement);
});
test('unrelated reads, optional SC1 suppliers and existing-document changes are not narrowed',()=>{
 for(const text of ['Mostrame el proveedor anterior.','Prepará una solicitud de compra sin proveedor.','Prepará el cambio de precio del pedido de compra 123.','Mostrame compras del mes.','Prepará el informe de ventas de octubre.','Retomá el proyecto de calidad.'])
  assert.equal(localSupplierDecision([initial,rejected,user(text)],evaluationSchema),null,text);
 assert.equal(localSupplierDecision([user('Prepará la compra con proveedor Taller Sur. No cambies el proveedor.')],evaluationSchema),null);
});
test('supplier model contract is narrow before generation and preserves raw output with real usage',async()=>{
 const messages=[user('Prepará la compra en dólares, no es con Taller Norte y no sé con quién es.')],before=structuredClone(messages);let body,usage;
 const local=createModel({fetchImpl:async(_url,options)=>{
  body=JSON.parse(options.body);
  return {ok:true,json:async()=>({done:true,prompt_eval_count:100,eval_count:42,message:{content:JSON.stringify({action:'responder',args:{},answer:body.format.properties.answer.enum[1]})}})};
 }});
 const result=await local.complete(messages,evaluationSchema,{maxInputChars:8000,maxOutputTokens:384,timeoutMs:1000},value=>usage=value);
 assert.equal(result.answer,body.format.properties.answer.enum[1]);assert.deepEqual(result.args,{});assert.deepEqual(usage,{inputTokens:100,outputTokens:42});
 assert.deepEqual(body.format.properties.action.enum,['responder']);assert.equal(body.think,false);assert.deepEqual(messages,before);
});
test('a model cannot smuggle invented supplier facts, amounts or tool calls through clarification',async()=>{
 for(const value of [
  {action:'preparar_cambio',args:{producto:'compra',precio:'100',cantidad:'1'},answer:'¿Proveedor?'},
  {action:'responder',args:{},answer:'El proveedor es Taller Norte. ¿Seguimos?'},
  {action:'responder',args:{precio:'100'},answer:'¿Qué proveedor querés usar?'}
 ]){
  const local=createModel({fetchImpl:async()=>({ok:true,json:async()=>({done:true,message:{content:JSON.stringify(value)}})})});
  await assert.rejects(local.complete([initial,rejected,resume],evaluationSchema,{maxInputChars:8000,maxOutputTokens:384,timeoutMs:1000}),{code:'IA_RESPUESTA_INVALIDA'});
 }
});
test('clarification note is idempotent and cannot widen caller answer restrictions',()=>{
 const messages=supplierClarificationMessages([initial,rejected,resume]);assert.equal(supplierClarificationMessages(messages),messages);
 const restricted={...evaluationSchema,properties:{...evaluationSchema.properties,answer:{type:'string',enum:['Otra pregunta']}}};
 assert.equal(localSupplierDecision([initial,rejected,resume],restricted),null);
});

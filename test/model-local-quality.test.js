import test from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/intelligence/model.js';
import {localDecisionMessages} from '../src/intelligence/local-decision-prompt.js';
import {evaluationSchema} from '../src/intelligence/evaluation.js';

const limits={maxInputChars:8000,maxOutputTokens:384,timeoutMs:1000};
test('local decision guidance preserves caller rules, history, schema, budgets and real telemetry',async()=>{
 const messages=[{role:'system',content:'Primero verificar registros. Nunca ejecutar.'},{role:'assistant',content:'Contexto anterior.'},{role:'user',content:'Pregunta inédita.'}],before=structuredClone(messages);
 const expected={action:'responder',args:{},answer:'Indicá el documento.'};let body,usage;
 const local=createModel({fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);assert.ok(options.signal);return {ok:true,json:async()=>({done:true,prompt_eval_count:53,eval_count:19,message:{content:JSON.stringify(expected)}})};}});
 assert.deepEqual(await local.complete(messages,evaluationSchema,limits,event=>{usage=event;}),expected);
 assert.deepEqual(messages,before);assert.ok(body.messages[0].content.startsWith(before[0].content));assert.deepEqual(body.messages.slice(1),before.slice(1));assert.deepEqual(body.format,evaluationSchema);
 assert.equal(body.think,false);assert.equal(body.options.num_predict,384);assert.equal(body.options.temperature,0);assert.deepEqual(usage,{inputTokens:53,outputTokens:19});
});
test('prompt overhead counts against input budget and never silently truncates caller context',async()=>{
 let calls=0;const local=createModel({fetchImpl:async()=>{calls++;throw Error('must not send');}});
 await assert.rejects(local.complete([{role:'user',content:'x'.repeat(1100)}],evaluationSchema,{...limits,maxInputChars:2000}),{code:'IA_CONTEXTO_EXCEDIDO'});assert.equal(calls,0);
});
test('unrelated structured tasks receive no decision prompt; decisions without system get one',()=>{
 const messages=[{role:'user',content:'Un texto'}];assert.equal(localDecisionMessages(messages,{type:'object',properties:{name:{type:'string'}}}),messages);
 const expanded=localDecisionMessages(messages,evaluationSchema);assert.equal(expanded[0].role,'system');assert.equal(expanded[1],messages[0]);
});
test('local output is validated without fixing or fabricating failed model decisions',async()=>{
 let calls=0;const local=createModel({fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify({action:'SQL',args:{},answer:'OK'})}})};}});
 await assert.rejects(local.complete([{role:'user',content:'Otra pregunta'}],evaluationSchema,limits),{code:'IA_RESPUESTA_INVALIDA'});assert.equal(calls,1);
});
test('long decision history reaches the local model intact with its corrections and negations',async()=>{
 const history=Array.from({length:100},(_,i)=>({role:i%2?'assistant':'user',content:`Turno sintético ${i}: conservar contexto.`}));
 const messages=[{role:'system',content:'Las fuentes y permisos se verifican en servidor.'},...history,{role:'user',content:'No es el proveedor anterior. Corregí sólo la cantidad.'}];
 let request;
 const decision={action:'responder',args:{},answer:'Indicá el proveedor.'};
 const local=createModel({fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify(decision)}})};}});
 assert.deepEqual(await local.complete(messages,evaluationSchema,{...limits,maxInputChars:24000}),decision);
 assert.deepEqual(request.messages.slice(1),messages.slice(1));
 assert.deepEqual(request.messages.at(-1),messages.at(-1));
 assert.ok(request.messages[0].content.startsWith(messages[0].content));
 assert.equal(request.options.num_ctx,8192);assert.equal(request.options.num_predict,limits.maxOutputTokens);
});
test('full long history and guide count against input budget without dropping turns',async()=>{
 const messages=Array.from({length:10},(_,i)=>({role:i%2?'user':'assistant',content:'Contexto sintético.'}));
 const expanded=localDecisionMessages(messages,evaluationSchema),before=structuredClone(messages);
 const justBelow=JSON.stringify({messages:expanded,schema:evaluationSchema}).length-1;
 let calls=0;const local=createModel({fetchImpl:async()=>{calls++;throw Error('must not send');}});
 await assert.rejects(local.complete(messages,evaluationSchema,{...limits,maxInputChars:justBelow}),{code:'IA_CONTEXTO_EXCEDIDO'});
 assert.equal(calls,0);assert.deepEqual(messages,before);
});
test('invalid extracted fields are rejected rather than coerced or removed',async()=>{
 for(const args of [{precio:2.5},{producto:'Z-SINTETICO',sql:'SELECT 1'}]){
  const local=createModel({fetchImpl:async()=>({ok:true,json:async()=>({done:true,message:{content:JSON.stringify({action:'preparar_cambio',args,answer:'Propuesta ficticia.'})}})})});
  await assert.rejects(local.complete([{role:'user',content:'Prepará una propuesta ficticia.'}],evaluationSchema,limits),{code:'IA_RESPUESTA_INVALIDA'});
 }
});

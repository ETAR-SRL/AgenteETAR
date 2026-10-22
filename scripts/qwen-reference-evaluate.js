import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {createModel} from '../src/intelligence/model.js';
import {evaluationSchema} from '../src/intelligence/evaluation.js';
import {validatedOutput} from '../src/intelligence/model-contract.js';
import {localReferenceDecision,referenceClarificationSchema} from '../src/intelligence/reference-corrections.js';
import {localDecisionMessages} from '../src/intelligence/local-decision-prompt.js';

// Frozen synthetic suite, 2026-10-22. No ERP identities, tools or credentials.
// Preserve these cases after inspecting model results; report failed cases.
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const system='Sos Central de Argentina. Esta evaluación usa solamente ejemplos sintéticos, sin ERP ni herramientas ejecutables. Una referencia descartada queda pendiente hasta una corrección literal. Pedí el dato concreto que falta; no recuperes el anterior ni prepares una operación con una referencia negada. Respondé sólo con el JSON del esquema y no afirmes ejecuciones.';
const identities=[
 {kind:'product',initial:'Che, el producto es Z-ENSAYO.',reject:'No es ese producto.',text:'Mostrame el producto anterior.',question:'¿Qué producto querés usar? La referencia anterior quedó descartada o sin definir.'},
 {kind:'customer',initial:'El cliente es CLIENTE-ENSAYO tienda 03.',reject:'No es ese cliente.',text:'Mostrame el cliente de antes.',question:'¿Qué cliente y tienda querés usar? La referencia anterior quedó descartada o sin definir.'},
 {kind:'order',initial:'El pedido de venta es 731001, ítem 01.',reject:'No es ese pedido.',text:'Mostrame el pedido de venta anterior.',question:'¿Qué pedido y si es de venta o de compra querés usar? La referencia anterior quedó descartada o sin definir.'},
 {kind:'list',initial:'La lista es LISTA-ENSAYO.',reject:'No es esa lista.',text:'Mostrame la lista de antes.',question:'¿Qué lista de precios querés usar? La referencia anterior quedó descartada o sin definir.'}
];
const detours=Array.from({length:45},(_,i)=>[
 {role:'user',content:`Consulta de ejemplo ${i+1}: contame qué datos lleva un informe semanal, sin elegir referencias comerciales.`},
 {role:'assistant',content:'Un informe necesita período y alcance. Este ejemplo no consulta fuentes ni selecciona producto, cliente, pedido o lista.'}
]).flat();
export const referenceEvaluationCases=freeze(identities.flatMap(identity=>['short','long'].map(length=>({
 id:`${identity.kind}_${length}`,kind:identity.kind,length,question:identity.question,distractorMessages:length==='long'?90:0,
 messages:[{role:'system',content:system},{role:'user',content:identity.initial},{role:'assistant',content:'Es una referencia sintética, pendiente de consultar en una fuente.'},{role:'user',content:identity.reject},{role:'assistant',content:'Esa referencia quedó descartada y falta indicar la correcta.'},...(length==='long'?structuredClone(detours):[]),{role:'user',content:identity.text}]
}))));
const limits=Object.freeze({maxInputChars:24000,maxOutputTokens:384,timeoutMs:60000});
const args=process.argv.slice(2),validationOnly=args.includes('--validate-fixtures');
if((!args.includes('--live')&&!validationOnly)||args.some((arg,index)=>!['--live','--validate-fixtures','--report'].includes(arg)&&args[index-1]!=='--report'))throw Error('Usá --live [--report data/evaluation/qwen-reference.json] o --validate-fixtures.');
const position=args.indexOf('--report'),path=resolve(position<0?`data/evaluation/qwen-reference-${Date.now()}.json`:args[position+1]||'');
const below=relative(resolve('data/evaluation'),path);
if(isAbsolute(below)||below.startsWith('..')||!below||!path.endsWith('.json'))throw Error('REFERENCE_EVALUATION_REPORT_PATH');
const report={suite:'reference-negations-frozen-v1',frozenDate:'2026-10-22',model:'qwen3:4b',mode:validationOnly?'fixture_validation_no_inference':'actual_local_model',limits,caseCount:referenceEvaluationCases.length,externalCalls:0,erpCalls:0,rawOutputsUnmodified:true,constrainedGeneration:true,unconstrainedModelAccuracyEvaluated:false,results:[]};
let current;
const local=createModel({url:'http://127.0.0.1:11434',model:'qwen3:4b',fetchImpl:async(url,options)=>{
 // Observe the actual adapter request. Forward its bytes without rewriting.
 const sent=JSON.parse(options.body);
 current.sentMessages=sent.messages;current.sentSchema=sent.format;current.sentOptions=sent.options;current.sentThink=sent.think;
 current.inputChars=JSON.stringify({messages:sent.messages,schema:sent.format}).length;
 const response=await fetch(url,options),payload=await response.json();
 current.rawResponse=payload;current.rawOutput=payload.message?.content;
 return {ok:response.ok,json:async()=>payload};
}});
const save=()=>{report.passed=report.results.filter(r=>r.passed).length;report.status=report.results.length===report.caseCount&&report.passed===report.caseCount?'passed':'failed';if(!validationOnly){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});}};
for(const fixture of referenceEvaluationCases){
 current={id:fixture.id,kind:fixture.kind,distractorMessages:fixture.distractorMessages};const started=performance.now();
 try{
  const decision=localReferenceDecision(fixture.messages,evaluationSchema),expected=referenceClarificationSchema(evaluationSchema,[fixture.kind]);
  const prepared=decision&&localDecisionMessages(decision.messages,decision.schema);
  current.checks={pendingCorrectKind:decision?.kinds.length===1&&decision.kinds[0]===fixture.kind,frozenQuestion:expected.properties.answer.enum.length===1&&expected.properties.answer.enum[0]===fixture.question,frozenLongHistory:fixture.length==='short'||fixture.distractorMessages===90&&fixture.messages.length>90,preparedInputWithinBudget:!!prepared&&JSON.stringify({messages:prepared,schema:decision.schema}).length<=limits.maxInputChars};
  if(!Object.values(current.checks).every(Boolean))throw Error('REFERENCE_FIXTURE_CONTRACT');
  if(!validationOnly){
   const value=validatedOutput(await local.complete(fixture.messages,evaluationSchema,limits,usage=>{current.usage=usage;}),evaluationSchema);current.decision=value;
   const sent=current.sentSchema,raw=JSON.parse(current.rawOutput);
   Object.assign(current.checks,{
    actualLocalCall:!!current.rawResponse,
    narrowedBeforeGeneration:sent.properties.action.enum.length===1&&sent.properties.action.enum[0]==='responder'&&Object.keys(sent.properties.args.properties).length===0&&sent.properties.args.additionalProperties===false,
    actualQuestionConstrained:JSON.stringify(sent.properties.answer.enum)===JSON.stringify(expected.properties.answer.enum),
    responder:value.action==='responder',emptyArguments:Object.keys(value.args).length===0,
    concreteCorrectQuestion:value.answer===fixture.question,
    noPostProcessing:JSON.stringify(raw)===JSON.stringify(value),
    actualInputWithinBudget:current.inputChars<=limits.maxInputChars,
    actualOutputBudget:current.sentOptions.num_predict===limits.maxOutputTokens,
    noExtendedThinking:current.sentThink===false
   });
  }
  current.passed=Object.values(current.checks).every(Boolean);
 }catch(error){current.passed=false;current.errorCode=/^[A-Z_]+$/.test(error.code||error.message||'')?(error.code||error.message):'REFERENCE_EVALUATION_FAILED';}
 current.durationMs=Math.round(performance.now()-started);report.results.push(current);save();
 console.log(JSON.stringify({id:current.id,passed:current.passed,checks:current.checks,errorCode:current.errorCode,durationMs:current.durationMs,usage:current.usage}));
}
console.log(JSON.stringify({status:report.status,passed:report.passed,caseCount:report.caseCount,...(!validationOnly?{path}:{})}));
process.exitCode=report.status==='passed'?0:2;

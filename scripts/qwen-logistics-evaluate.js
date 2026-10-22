import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {createModel} from '../src/intelligence/model.js';
import {evaluationSchema} from '../src/intelligence/evaluation.js';
import {validatedOutput} from '../src/intelligence/model-contract.js';
import {localValueDecision,valueClarificationSchema} from '../src/intelligence/value-decision.js';
import {localDecisionMessages} from '../src/intelligence/local-decision-prompt.js';

// Frozen synthetic suite, 2026-10-22. No ERP identities, tools or credentials.
// Preserve these cases after inspecting model results; report failed cases.
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const system='Sos Central de Argentina. Esta evaluación usa solamente ejemplos sintéticos, sin ERP ni herramientas ejecutables. Un valor comercial descartado queda pendiente hasta una corrección literal. Pedí el dato concreto que falta; no recuperes el anterior ni prepares una operación con un valor negado. Respondé sólo con el JSON del esquema y no afirmes ejecuciones.';
const identities=[
 {kind:'emission',label:'la fecha de emisión',reject:'No es esa fecha de emisión.',text:'Retomemos con la fecha de emisión anterior.'},
 {kind:'due',label:'la fecha de entrega o necesidad',reject:'No es esa fecha de necesidad.',text:'Retomemos con la fecha de necesidad anterior.'},
 {kind:'warehouse',label:'el depósito',reject:'No es ese depósito.',text:'Retomemos con el depósito anterior.'},
 {kind:'payment',label:'la condición de pago',reject:'No es esa condición de pago.',text:'Retomemos con la condición de pago anterior.'},
 {kind:'date',label:'la fecha que querés corregir (emisión o entrega/necesidad)',reject:'Esa fecha no.',text:'Retomemos con la fecha anterior.'}
];
const detours=Array.from({length:45},(_,i)=>[
 {role:'user',content:`Consulta de ejemplo ${i+1}: contame qué datos lleva un informe semanal, sin elegir referencias comerciales.`},
 {role:'assistant',content:'Un informe necesita período y alcance. Este ejemplo no consulta fuentes ni selecciona producto, cliente, pedido o lista.'}
]).flat();
export const logisticsEvaluationCases=freeze(identities.flatMap(identity=>['short','long'].map(length=>({
 id:`${identity.kind}_${length}`,kind:identity.kind,length,question:identity.kind==='date'?'¿Qué fecha querés corregir: emisión o entrega/necesidad? Conservo los demás datos; no preparé cambios.':`Descarté el dato anterior. ¿Cuál es ${identity.label}? Conservo los demás datos; no preparé cambios.`,distractorMessages:length==='long'?90:0,
 messages:[{role:'system',content:system},{role:'user',content:`Creame ${identity.kind==='payment'?'un pedido de compra':'una solicitud de compra'} con producto Z-ENSAYO, 3 millares a 80 pesos por millar; emisión 2026-10-22; necesidad 2026-11-10${identity.kind==='payment'?'; proveedor GAMMA-ENSAYO tienda DELTA-ENSAYO':''}; depósito ALFA-ENSAYO${identity.kind==='payment'?'; condición de pago BETA-ENSAYO':''}.`},{role:'assistant',content:'Conservo los datos literales. Todavía falta completar el documento.'},{role:'user',content:identity.reject},{role:'assistant',content:'Ese valor quedó descartado y falta indicar el correcto.'},...(length==='long'?structuredClone(detours):[]),{role:'user',content:identity.text}]
}))));
const limits=Object.freeze({maxInputChars:24000,maxOutputTokens:384,timeoutMs:60000});
const args=process.argv.slice(2),validationOnly=args.includes('--validate-fixtures');
if((!args.includes('--live')&&!validationOnly)||args.some((arg,index)=>!['--live','--validate-fixtures','--report'].includes(arg)&&args[index-1]!=='--report'))throw Error('Usá --live [--report data/evaluation/qwen-logistics.json] o --validate-fixtures.');
const position=args.indexOf('--report'),path=resolve(position<0?`data/evaluation/qwen-logistics-${Date.now()}.json`:args[position+1]||'');
const below=relative(resolve('data/evaluation'),path);
if(isAbsolute(below)||below.startsWith('..')||!below||!path.endsWith('.json'))throw Error('LOGISTICS_EVALUATION_REPORT_PATH');
const report={suite:'commercial-logistics-negations-frozen-v1',frozenDate:'2026-10-22',model:'qwen3:4b',mode:validationOnly?'fixture_validation_no_inference':'actual_local_model',limits,caseCount:logisticsEvaluationCases.length,externalCalls:0,erpCalls:0,rawOutputsUnmodified:true,constrainedGeneration:true,unconstrainedModelAccuracyEvaluated:false,results:[]};
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
for(const fixture of logisticsEvaluationCases){
 current={id:fixture.id,kind:fixture.kind,distractorMessages:fixture.distractorMessages};const started=performance.now();
 try{
  const decision=localValueDecision(fixture.messages,evaluationSchema),expected=valueClarificationSchema(evaluationSchema,[fixture.kind]);
  const prepared=decision&&localDecisionMessages(decision.messages,decision.schema);
  current.checks={pendingCorrectField:decision?.fields.length===1&&decision.fields[0]===fixture.kind,frozenQuestion:expected.properties.answer.enum.length===1&&expected.properties.answer.enum[0]===fixture.question,frozenLongHistory:fixture.length==='short'||fixture.distractorMessages===90&&fixture.messages.length>90,preparedInputWithinBudget:!!prepared&&JSON.stringify({messages:prepared,schema:decision.schema}).length<=limits.maxInputChars};
  if(!Object.values(current.checks).every(Boolean))throw Error('LOGISTICS_FIXTURE_CONTRACT');
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
 }catch(error){current.passed=false;current.errorCode=/^[A-Z_]+$/.test(error.code||error.message||'')?(error.code||error.message):'LOGISTICS_EVALUATION_FAILED';}
 current.durationMs=Math.round(performance.now()-started);report.results.push(current);save();
 console.log(JSON.stringify({id:current.id,passed:current.passed,checks:current.checks,errorCode:current.errorCode,durationMs:current.durationMs,usage:current.usage}));
}
console.log(JSON.stringify({status:report.status,passed:report.passed,caseCount:report.caseCount,...(!validationOnly?{path}:{})}));
process.exitCode=report.status==='passed'?0:2;

import {HttpError} from '../errors.js';
import {checkInput,validateLimits,validatedOutput} from './model-contract.js';
import {localDecisionMessages,localSupplierDecision} from './local-decision-prompt.js';
import {localReferenceDecision} from './reference-corrections.js';
import {localValueDecision} from './value-decision.js';
export function createModel({url=process.env.AI_LOCAL_URL||'http://127.0.0.1:11434',model=process.env.AI_MODEL||'qwen3:4b',fetchImpl=fetch}={}){
  const base=new URL(url);
  if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname)||base.username||base.password||base.pathname!=='/')throw new Error('El modelo debe ejecutarse en loopback local');
  return {name:model,local:true,
    async status(){try{const r=await fetchImpl(new URL('/api/tags',base),{signal:AbortSignal.timeout(1500),redirect:'error'});const j=await r.json();return {available:r.ok&&j.models?.some(m=>m.name===model),model,local:true};}catch{return {available:false,model,local:true};}},
    async complete(messages,schema,limits=validateLimits({timeoutMs:180000}),onUsage=()=>{}){
      checkInput(messages,schema,limits);
      const originalSchema=schema,clarification=localReferenceDecision(messages,schema)||localSupplierDecision(messages,schema)||localValueDecision(messages,schema);
      if(clarification){messages=clarification.messages;schema=clarification.schema;}
      messages=localDecisionMessages(messages,schema);
      checkInput(messages,schema,limits);
      try{
        const r=await fetchImpl(new URL('/api/chat',base),{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({model,messages,format:schema,stream:false,think:false,keep_alive:'30m',options:{temperature:0,num_ctx:8192,num_predict:limits.maxOutputTokens}}),signal:AbortSignal.timeout(limits.timeoutMs)});
        if(!r.ok)throw new Error();const result=await r.json();
        const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
        try{onUsage({inputTokens:count(result.prompt_eval_count),outputTokens:count(result.eval_count)});}catch{}
        if(result.done===false||result.done_reason==='length')throw new HttpError(502,'IA_RESPUESTA_INVALIDA','Respuesta incompleta del modelo local.');
        return validatedOutput(validatedOutput(JSON.parse(result.message.content),schema),originalSchema);
      }catch(e){if(e instanceof HttpError)throw e;throw new HttpError(503,'IA_LOCAL_NO_DISPONIBLE','No se pudo obtener respuesta del modelo local. Verificá que el motor de inteligencia esté iniciado.');}
    }
  };
}

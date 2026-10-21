import {HttpError,assert} from '../errors.js';
import {checkInput,validatedOutput} from './model-contract.js';
export const nativeUrls=Object.freeze({openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1'});
const invalid=()=>new HttpError(502,'IA_RESPUESTA_INVALIDA','Respuesta incompleta o inválida del proveedor. No se ejecutó una acción.');
const tokens=n=>Number.isSafeInteger(n)&&n>=0?n:0;

export async function completeRemote(c,messages,schema,{fetchImpl=fetch,onUsage=()=>{}}={}){
 checkInput(messages,schema,c.limits);
 const started=performance.now();let usage={},outcome='error';
 try{
  let endpoint,headers={'Content-Type':'application/json'},body;
  if(c.provider==='openai'){
   endpoint=nativeUrls.openai+'/responses';headers.Authorization='Bearer '+c.apiKey;
   // Non-strict preserves optional fields and string maps in the app schemas.
   // Server validation remains mandatory before a decision leaves this adapter.
   body={model:c.model,input:messages,store:false,max_output_tokens:c.limits.maxOutputTokens,tools:[{type:'function',name:'structured_result',description:'Devolver la decisión estructurada; no ejecutar operaciones.',parameters:schema,strict:false}],tool_choice:{type:'function',name:'structured_result'},parallel_tool_calls:false};
  }else if(c.provider==='anthropic'){
   endpoint=nativeUrls.anthropic+'/messages';headers['x-api-key']=c.apiKey;headers['anthropic-version']='2023-06-01';
   // Auto supports models that reject forced tool choice. Missing tool results
   // fail closed; plain text never becomes a business decision.
   body={model:c.model,max_tokens:c.limits.maxOutputTokens,system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n')+'\nDevolvé el resultado mediante structured_result. No ejecutes operaciones.',messages:messages.filter(m=>m.role!=='system'),tools:[{name:'structured_result',description:'Devolver exclusivamente la decisión estructurada, sin ejecutar operaciones.',input_schema:schema}],tool_choice:{type:'auto',disable_parallel_tool_use:true}};
  }else{
   endpoint=c.url.replace(/\/$/,'')+'/chat/completions';headers.Authorization='Bearer '+c.apiKey;
   body={model:c.model,messages:[...messages,{role:'system',content:'Devolvé solamente JSON válido que cumpla este esquema: '+JSON.stringify(schema)}],response_format:{type:'json_object'},max_tokens:c.limits.maxOutputTokens,stream:false};
  }
  const r=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(c.limits.timeoutMs)});
  if(!r.ok)throw new HttpError(503,'IA_EXTERNA_ERROR',r.status===401||r.status===403?'El proveedor rechazó las credenciales o permisos.':r.status===429?'El proveedor alcanzó su límite de uso.':'El proveedor no pudo completar la consulta. Revisá modelo y configuración.');
  const data=await readBoundedJson(r);usage=data.usage||{};let result;
  if(c.provider==='openai'){
   assert(data.status==='completed'&&!data.error&&!data.incomplete_details,502,'IA_RESPUESTA_INVALIDA',invalid().message);
   const calls=data.output?.filter(x=>x.type==='function_call');
   if(calls?.length!==1||calls[0].name!=='structured_result'||data.output.some(x=>x.type==='message'&&x.content?.some(p=>p.type==='refusal')))throw invalid();
   result=JSON.parse(calls[0].arguments);
  }else if(c.provider==='anthropic'){
   const calls=data.content?.filter(x=>x.type==='tool_use');
   if(data.stop_reason!=='tool_use'||calls?.length!==1||calls[0].name!=='structured_result')throw invalid();result=calls[0].input;
  }else{
   const choice=data.choices?.[0];if(choice?.finish_reason!=='stop'||choice.message?.refusal)throw invalid();result=JSON.parse(choice.message.content);
  }
  validatedOutput(result,schema);outcome='ok';return result;
 }catch(e){
  if(e instanceof HttpError)throw e;if(e instanceof SyntaxError)throw invalid();
  throw new HttpError(503,'IA_EXTERNA_NO_DISPONIBLE','No pude obtener una respuesta válida de la IA externa. Podés reintentar o elegir IA local en Conexiones.');
 }finally{
  // Numeric metadata only, never prompts, responses, key, URL or error text.
  try{onUsage({provider:c.provider,outcome,durationMs:Math.round(performance.now()-started),inputTokens:tokens(usage.input_tokens??usage.prompt_tokens),outputTokens:tokens(usage.output_tokens??usage.completion_tokens),cacheReadTokens:tokens(usage.cache_read_input_tokens??usage.input_tokens_details?.cached_tokens),cacheWriteTokens:tokens(usage.cache_creation_input_tokens)});}catch{}
 }
}
async function readBoundedJson(response){
 const maxBytes=1024*1024;
 if(response.body?.getReader){
  const reader=response.body.getReader();let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw invalid();}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
 const data=await response.json();if(JSON.stringify(data).length>maxBytes)throw invalid();return data;
}

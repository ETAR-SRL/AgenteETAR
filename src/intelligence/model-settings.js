import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {assert,HttpError} from '../errors.js';
import {createModel} from './model.js';
import {checkInput,validateLimits,validatedOutput} from './model-contract.js';
import {completeRemote,nativeUrls} from './model-providers.js';
export function createModelSettings({path=resolve(process.env.DATA_DIR||'data','ai-settings.json'),fetchImpl=fetch,local,onUsage=()=>{},now=Date.now}={}){
 let config,configurationError=false;
 try{config=validate(existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{provider:process.env.AI_PROVIDER||'local',url:process.env.AI_API_URL,model:process.env.AI_API_MODEL||'',apiKey:process.env.AI_API_KEY||''});}catch{configurationError=true;config={provider:'unconfigured',url:'',model:'',apiKey:'',limits:validateLimits()};}
 if(!local)try{local=createModel({fetchImpl});}catch{local={name:'',local:true,status:async()=>({available:false,local:true,state:'configuration_required'}),complete:async()=>{throw new HttpError(503,'IA_CONFIG_REQUERIDA','Revisá la configuración del motor local.');}};}
 const telemetry={requests:0,failures:0,durationMs:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0};
 let active=0,generation=0,health={failures:0,lastSuccessAt:null,lastErrorCode:null,nextRetryAt:null};
 function record(event){telemetry.requests++;if(event.outcome!=='ok')telemetry.failures++;for(const k of ['durationMs','inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'])telemetry[k]+=event[k]||0;try{onUsage(event);}catch{}}
 function validate(input){
  const c={...input,limits:validateLimits(input.limits)};
  assert(['local','external','openai','anthropic'].includes(c.provider),400,'IA_CONFIG_INVALIDA','Elegí IA local, OpenAI, Anthropic o API compatible.');
  if(nativeUrls[c.provider]){assert(!c.url||c.url.replace(/\/$/,'')===nativeUrls[c.provider],400,'IA_URL_INVALIDA','El adaptador nativo usa exclusivamente la URL oficial del proveedor.');c.url=nativeUrls[c.provider];}else c.url=c.url||nativeUrls.openai;
  if(c.provider!=='local'){
   let u;try{u=new URL(c.url);}catch{}
   assert(u&&u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.hostname.includes('.')&&!/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname),400,'IA_URL_INVALIDA','Usá una URL HTTPS pública del proveedor, sin claves ni parámetros.');
   assert(typeof c.model==='string'&&c.model.trim().length>0&&c.model.length<=120&&!/[\r\n]/.test(c.model),400,'IA_MODELO_REQUERIDO','Indicá el modelo del proveedor.');
   assert(typeof c.apiKey==='string'&&c.apiKey.length>=8&&c.apiKey.length<=4096&&!/[\r\n]/.test(c.apiKey),400,'IA_CLAVE_REQUERIDA','Ingresá la API key del proveedor.');
  }
  return c;
 }
 const view=()=>({provider:config.provider,url:config.url,model:config.model,hasKey:!!config.apiKey,configurationRequired:configurationError,limits:{...config.limits},telemetry:{...telemetry},health:{...health,active}});
 const model={get name(){return config.provider==='local'?local.name:config.model;},get local(){return !configurationError&&config.provider==='local';},
  async status(){
   if(configurationError)return {available:false,configured:false,local:false,provider:'unconfigured',state:'configuration_required',code:'IA_CONFIG_INVALIDA'};
   const meta={configured:true,local:config.provider==='local',model:model.name,provider:config.provider,...health,active};
   if(health.nextRetryAt&&now()<health.nextRetryAt)return {...meta,available:false,connectionVerified:false,state:'unavailable'};
   return config.provider==='local'?{...meta,...await local.status()}:{...meta,available:true,connectionVerified:!!health.lastSuccessAt&&!health.lastErrorCode,state:health.lastSuccessAt&&!health.lastErrorCode?'ready':'unverified'};
  },
  async complete(messages,schema){
   if(configurationError)throw new HttpError(503,'IA_CONFIG_REQUERIDA','Revisá la configuración de IA en Conexiones.');
   const c={...config,limits:{...config.limits}};checkInput(messages,schema,c.limits);
   if(health.nextRetryAt&&now()<health.nextRetryAt)throw new HttpError(503,'IA_EN_ESPERA','La IA está temporalmente sin conexión. Reintentá en unos segundos.');
   assert(active===0,429,'IA_OCUPADA','El asistente está procesando otra consulta. Reintentá en unos segundos.');
   active++;const version=generation,started=performance.now();let outcome='error',localUsage={};
   try{
    const result=c.provider!=='local'?await completeRemote(c,messages,schema,{fetchImpl,onUsage:record}):validatedOutput(await local.complete(messages,schema,c.limits,u=>{localUsage=u;}),schema);
    outcome='ok';if(generation===version)health={failures:0,lastSuccessAt:now(),lastErrorCode:null,nextRetryAt:null};return result;
   }catch(e){
    if(generation===version&&e instanceof HttpError&&e.status>=500){const failures=health.failures+1;health={...health,failures,lastErrorCode:e.code,nextRetryAt:now()+Math.min(60000,1000*2**Math.min(failures-1,6))};}throw e;
   }finally{active--;if(c.provider==='local')record({provider:'local',outcome,durationMs:Math.round(performance.now()-started),inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,...localUsage});}
  }
 };
 return {model,view,save(input){
  assert(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['provider','url','model','apiKey','clearKey','limits'].includes(k)),400,'IA_CONFIG_INVALIDA','Configuración inválida.');
  const providerChanged=input.provider!==config.provider;
  const url=input.url||(providerChanged?(nativeUrls[input.provider]||nativeUrls.openai):config.url);
  const c=validate({provider:input.provider,url,model:input.model??(providerChanged?'':config.model),limits:input.limits??config.limits,apiKey:input.clearKey?'':input.apiKey||((providerChanged||url!==config.url)?'':config.apiKey)});
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(c),{mode:0o600});renameSync(path+'.tmp',path);config=c;configurationError=false;generation++;health={failures:0,lastSuccessAt:null,lastErrorCode:null,nextRetryAt:null};return view();
 },async test(){await model.complete([{role:'user',content:'Respondé JSON con action responder, args {}, answer OK. No consultes información.'}],{type:'object',properties:{action:{type:'string',enum:['responder']},args:{type:'object',properties:{},additionalProperties:false},answer:{type:'string'}},required:['action','args','answer'],additionalProperties:false});return {ok:true,model:model.name,local:model.local};}};
}

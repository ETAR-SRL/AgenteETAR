import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {assert,HttpError} from '../errors.js';
import {createModel} from './model.js';
export function createModelSettings({path=resolve(process.env.DATA_DIR||'data','ai-settings.json'),fetchImpl=fetch,local=createModel()}={}){
 let config=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{provider:process.env.AI_PROVIDER||'local',url:process.env.AI_API_URL||'https://api.openai.com/v1',model:process.env.AI_API_MODEL||'',apiKey:process.env.AI_API_KEY||''};
 function validate(c){
  assert(['local','external'].includes(c.provider),400,'IA_CONFIG_INVALIDA','Elegí IA local o externa.');
  if(c.provider==='external'){
   let u;try{u=new URL(c.url);}catch{}
   assert(u&&u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.hostname.includes('.')&&!/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname),400,'IA_URL_INVALIDA','Usá una URL HTTPS pública del proveedor, sin claves ni parámetros.');
   assert(typeof c.model==='string'&&c.model.trim().length>0&&c.model.length<=120,400,'IA_MODELO_REQUERIDO','Indicá el modelo del proveedor.');
   assert(typeof c.apiKey==='string'&&c.apiKey.length>=8&&c.apiKey.length<=4096&&!/[\r\n]/.test(c.apiKey),400,'IA_CLAVE_REQUERIDA','Ingresá la API key del proveedor.');
  }
  return c;
 }
 validate(config);
 const view=()=>({provider:config.provider,url:config.url,model:config.model,hasKey:!!config.apiKey});
 async function remote(messages,schema,c){
  try{
   const response=await fetchImpl(c.url.replace(/\/$/,'')+'/chat/completions',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.apiKey},body:JSON.stringify({model:c.model,messages:[...messages,{role:'system',content:'Devolvé solamente JSON válido que cumpla este esquema: '+JSON.stringify(schema)}],response_format:{type:'json_object'},stream:false}),signal:AbortSignal.timeout(60000)});
   if(!response.ok)throw new HttpError(503,'IA_EXTERNA_ERROR',response.status===401?'El proveedor rechazó la API key.':response.status===429?'El proveedor alcanzó su límite de uso.':'El proveedor no pudo completar la consulta. Revisá modelo y configuración.');
   const data=await response.json(),choice=data.choices?.[0];
   assert(choice?.finish_reason==='stop'&&!choice.message?.refusal,502,'IA_RESPUESTA_INVALIDA','Respuesta incompleta del proveedor.');
   const result=JSON.parse(choice.message.content);
   assert(validOutput(result,schema),502,'IA_RESPUESTA_INVALIDA','Respuesta inválida del proveedor. No se ejecutó una acción.');
   return result;
  }catch(e){if(e instanceof HttpError)throw e;throw new HttpError(503,'IA_EXTERNA_NO_DISPONIBLE','No pude obtener una respuesta válida de la IA externa. Podés reintentar o elegir IA local en Conexiones.');}
 }
 const model={get name(){return config.provider==='local'?local.name:config.model;},get local(){return config.provider==='local';},async status(){return config.provider==='local'?local.status():{available:true,configured:true,connectionVerified:false,local:false,model:config.model,provider:'external'};},complete(messages,schema){const c={...config};return c.provider==='local'?local.complete(messages,schema):remote(messages,schema,c);}};
 return {model,view,save(input){assert(input&&typeof input==='object'&&Object.keys(input).every(k=>['provider','url','model','apiKey','clearKey'].includes(k)),400,'IA_CONFIG_INVALIDA','Configuración inválida.');const c=validate({provider:input.provider,url:input.url||config.url,model:input.model??config.model,apiKey:input.clearKey?'':input.apiKey||((input.url&&input.url!==config.url)?'':config.apiKey)});mkdirSync(dirname(path),{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(c),{mode:0o600});renameSync(path+'.tmp',path);config=c;return view();},async test(){await model.complete([{role:'user',content:'Respondé JSON con action responder, args {}, answer OK. No consultes información.'}],{type:'object',properties:{action:{enum:['responder']},args:{type:'object'},answer:{type:'string'}}});return {ok:true,model:model.name,local:model.local};}};
}

function validOutput(value,schema){
 if(schema.enum&&!schema.enum.includes(value))return false;
 if(schema.type==='object'){if(!value||typeof value!=='object'||Array.isArray(value))return false;if(schema.required?.some(k=>!Object.hasOwn(value,k)))return false;return Object.entries(value).every(([k,v])=>schema.properties?.[k]?validOutput(v,schema.properties[k]):schema.additionalProperties===false?false:typeof schema.additionalProperties==='object'?validOutput(v,schema.additionalProperties):true);}
 if(schema.type==='array')return Array.isArray(value)&&(!schema.maxItems||value.length<=schema.maxItems)&&value.every(v=>validOutput(v,schema.items||{}));
 if(schema.type&&typeof value!==schema.type)return false;return true;
}

import {assert} from '../errors.js';

// Only the JSON Schema vocabulary used by this app; unknown constraints fail closed.
export function validOutput(value,schema,depth=0){
 if(!schema||typeof schema!=='object'||depth>40)return false;
 if(Object.keys(schema).some(k=>!['type','properties','required','additionalProperties','items','enum','maxItems','minItems','minLength','maxLength','minimum','maximum','description','title'].includes(k)))return false;
 if(schema.enum&&!schema.enum.some(v=>JSON.stringify(v)===JSON.stringify(value)))return false;
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value)||schema.required?.some(k=>!Object.hasOwn(value,k)))return false;
  return Object.entries(value).every(([k,v])=>{
   if(['__proto__','constructor','prototype'].includes(k))return false;
   if(Object.hasOwn(schema.properties||{},k))return validOutput(v,schema.properties[k],depth+1);
   return schema.additionalProperties===false?false:typeof schema.additionalProperties==='object'?validOutput(v,schema.additionalProperties,depth+1):true;
  });
 }
 if(schema.type==='array')return Array.isArray(value)&&(schema.maxItems===undefined||value.length<=schema.maxItems)&&(schema.minItems===undefined||value.length>=schema.minItems)&&value.every(v=>validOutput(v,schema.items||{},depth+1));
 if(schema.type==='integer'&&!Number.isInteger(value))return false;
 if(schema.type==='number'&&(typeof value!=='number'||!Number.isFinite(value)))return false;
 if(schema.type==='null'&&value!==null)return false;
 if(schema.type&&!['integer','number','null'].includes(schema.type)&&typeof value!==schema.type)return false;
 if(typeof value==='string'&&((schema.maxLength!==undefined&&value.length>schema.maxLength)||(schema.minLength!==undefined&&value.length<schema.minLength)))return false;
 if(typeof value==='number'&&((schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum)))return false;
 return true;
}
export function validatedOutput(value,schema){assert(validOutput(value,schema),502,'IA_RESPUESTA_INVALIDA','Respuesta inválida del modelo. No se ejecutó una acción.');return value;}
export const defaultLimits=Object.freeze({maxInputChars:64000,maxOutputTokens:1200,timeoutMs:60000});
export function validateLimits(input={}){
 assert(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>Object.hasOwn(defaultLimits,k)),400,'IA_LIMITES_INVALIDOS','Límites de IA inválidos.');
 const limits={...defaultLimits,...input};
 for(const [k,min,max] of [['maxInputChars',2000,128000],['maxOutputTokens',128,8192],['timeoutMs',1000,180000]])assert(Number.isInteger(limits[k])&&limits[k]>=min&&limits[k]<=max,400,'IA_LIMITES_INVALIDOS','Límites de IA fuera del rango permitido.');
 return limits;
}
export function checkInput(messages,schema,limits){
 assert(Array.isArray(messages)&&messages.every(m=>m&&['system','user','assistant'].includes(m.role)&&typeof m.content==='string'),400,'IA_ENTRADA_INVALIDA','Contexto de IA inválido.');
 assert(JSON.stringify({messages,schema}).length<=limits.maxInputChars,413,'IA_CONTEXTO_EXCEDIDO','La consulta supera el presupuesto de contexto del modelo. Reducí el contexto o ajustá el límite.');
}

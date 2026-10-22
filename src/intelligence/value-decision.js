import {valueCorrections} from './value-corrections.js';
import {validatedOutput} from './model-contract.js';

const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const fields=['price','quantity','currency','priceUnit','quantityUnit'];
const labels={price:'el precio',quantity:'la cantidad',currency:'la moneda (pesos o dólares)',priceUnit:'la base del precio (por unidad o por millar)',quantityUnit:'la base de la cantidad (unidades o millares)'};
export const valueResume=text=>/\b(?:retoma\w*|continua\w*|segui\w*|prepara\w*|confirma\w*|usa|usar|cambia\w*|actualiza\w*|modifica\w*|deja\w*|subi\w*|baja\w*|hacelo|dale)\b/.test(norm(text));
export const independentValueRead=text=>{
 // A read detour may contain a real correction in a later clause. Do not let
 // the leading read verb hide an explicit rejected commercial value.
 if(valueCorrections(text).rejected.length&&/\b(?:no|sin|descarta\w*|quita\w*)\b/.test(norm(text)))return false;
 return /\b(?:informe|reporte|resumen|dashboard|stock|calidad|proyecto)\b/.test(norm(text))||/^\s*(?:mostra\w*|consulta\w*|ver|busca\w*)\b/.test(norm(text))&&!valueResume(text)&&!/\b(?:borrador|propuesta|precio anterior|cantidad anterior)\b/.test(norm(text));
};

// Full branch-scoped user history is inspected before the bounded model view.
// These are unverified user inputs; they never replace current ERP values.
export function valuePending(messages){
 let values={},pending=new Set(),last='',request=false;
 for(const message of messages||[]){
  if(message.role!=='user'||typeof message.content!=='string')continue;
  last=message.content;const n=norm(last);
  if(/\b(?:cancela(?:lo)?|cancelar|olvida(?:lo)?)\b/.test(n)){values={};pending.clear();continue;}
  if(/\b(?:crea\w*|genera\w*|arma\w*)\b/.test(n)&&/\b(?:solicitud|pedido|orden)\b/.test(n)){values={};pending.clear();request=/\bsolicitud\b/.test(n);}
  if(independentValueRead(last))continue;
  const correction=valueCorrections(last,{values});
  for(const field of correction.rejected){delete values[field];pending.add(field);}
  for(const [field,value] of Object.entries(correction.changes)){values[field]=value;pending.delete(field);}
  if(correction.optionalPriceRemoved){if(request){pending.delete('price');pending.delete('priceUnit');}else pending.add('price');delete values.price;delete values.priceUnit;}
 }
 if(independentValueRead(last))return [];
 const current=valueCorrections(last,{values}),explicit=Object.keys(current.changes).length||current.rejected.length||/\b(?:precio|cantidad|moneda|millar|millares|unidad|unidades)\b/.test(norm(last));
 return explicit||valueResume(last)?fields.filter(field=>pending.has(field)):[];
}
export function valueClarificationSchema(schema,pendingFields){
 const pending=fields.filter(field=>pendingFields.includes(field));
 if(!pending.length||schema?.properties?.action?.enum?.includes('responder')!==true||schema.properties?.args?.required?.length)return null;
 const answer=`Descarté el dato anterior. ¿Cuál es ${pending.map(field=>labels[field]).join(' y cuál es ')}? Conservo los demás datos; no preparé cambios.`;
 try{validatedOutput({action:'responder',args:{},answer},schema);}catch{return null;}
 return {...schema,properties:{...schema.properties,action:{...schema.properties.action,enum:['responder']},args:{...schema.properties.args,properties:{},additionalProperties:false},answer:{...schema.properties.answer,enum:[answer]}}};
}
export function valueClarificationMessages(messages,pendingFields){
 const note=`Datos comerciales pendientes: ${pendingFields.join(', ')}. Usá solamente la pregunta del esquema. No recuperes valores descartados, precios de memoria, monedas ni bases por defecto. Precio y cantidad tienen bases independientes. No ejecutes herramientas ni afirmes escrituras.`;
 if(messages.some(message=>message.role==='system'&&message.content.includes(note)))return messages;
 const index=messages.findIndex(message=>message.role==='system');
 return index<0?[{role:'system',content:note},...messages]:messages.map((message,i)=>i===index?{...message,content:message.content+'\n\n'+note}:message);
}
export function localValueDecision(messages,schema){
 const pending=valuePending(messages),narrowed=valueClarificationSchema(schema,pending);
 return narrowed?{schema:narrowed,messages:valueClarificationMessages(messages,pending),clarification:'value',fields:pending}:null;
}

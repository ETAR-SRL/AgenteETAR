import {commercialCorrections as valueCorrections,commercialFields as fields,commercialValueLabels as labels} from './commercial-corrections.js';
import {validatedOutput} from './model-contract.js';

const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const valueResume=text=>/\b(?:retoma\w*|continu\w*|segui\w*|prepara\w*|confirm\w*|usa|usar|cambia\w*|actualiza\w*|modifica\w*|deja\w*|subi\w*|baja\w*|hacelo|dale)\b/.test(norm(text));
export const independentValueRead=text=>{
 // A read detour may contain a real correction in a later clause. Do not let
 // the leading read verb hide an explicit rejected commercial value.
 if(valueCorrections(text).rejected.length&&/\b(?:no|sin|descarta\w*|quita\w*)\b/.test(norm(text)))return false;
 return /\b(?:informe|reporte|resumen|dashboard|stock|calidad|proyecto)\b/.test(norm(text))||/^\s*(?:mostra\w*|consulta\w*|ver|busca\w*)\b/.test(norm(text))&&!valueResume(text)&&!/\b(?:borrador|propuesta|precio anterior|cantidad anterior)\b/.test(norm(text));
};

// Full branch-scoped user history is inspected before the bounded model view.
// These are unverified user inputs; they never replace current ERP values.
export function valuePending(messages){
 let values={},pending=new Set(),last='',request=false,dateCandidate;
 for(const message of messages||[]){
  if(message.role!=='user'||typeof message.content!=='string')continue;
  last=message.content;const n=norm(last);
  if(/\b(?:cancela(?:lo)?|cancelar|olvida(?:lo)?)\b/.test(n)){values={};pending.clear();dateCandidate=undefined;continue;}
  if(/\b(?:crea\w*|genera\w*|arma\w*)\b/.test(n)&&/\b(?:solicitud|pedido|orden)\b/.test(n)){values={};pending.clear();dateCandidate=undefined;request=/\bsolicitud\b/.test(n);}
  if(independentValueRead(last))continue;
  const correction=valueCorrections(last,{values});
  if(correction.dateField&&pending.has('date')){pending.delete('date');if(dateCandidate){values[correction.dateField]=dateCandidate;pending.delete(correction.dateField);}else if(!correction.changes[correction.dateField]){delete values[correction.dateField];pending.add(correction.dateField);}dateCandidate=undefined;}
  for(const field of correction.rejected){delete values[field];pending.add(field);}
  for(const field of correction.pending)pending.add(field);
  if(correction.pending.includes('date'))dateCandidate=correction.dateCandidate;
  for(const [field,value] of Object.entries(correction.changes)){values[field]=value;pending.delete(field);}
  if(correction.optionalPriceRemoved){if(request){pending.delete('price');pending.delete('priceUnit');}else pending.add('price');delete values.price;delete values.priceUnit;}
 }
 if(independentValueRead(last))return [];
 const current=valueCorrections(last,{values}),explicit=Object.keys(current.changes).length||current.rejected.length||current.pending.length||/\b(?:precio|cantidad|moneda|millar|millares|unidad|unidades|fecha|emision|entrega|necesidad|deposito|almacen|pago)\b/.test(norm(last));
 return explicit||valueResume(last)?fields.filter(field=>pending.has(field)):[];
}
export function valueClarificationSchema(schema,pendingFields){
 const pending=fields.filter(field=>pendingFields.includes(field));
 if(!pending.length||schema?.properties?.action?.enum?.includes('responder')!==true||schema.properties?.args?.required?.length)return null;
 const answer=pending.length===1&&pending[0]==='date'?'¿Qué fecha querés corregir: emisión o entrega/necesidad? Conservo los demás datos; no preparé cambios.':`Descarté el dato anterior. ¿Cuál es ${pending.map(field=>labels[field]).join(' y cuál es ')}? Conservo los demás datos; no preparé cambios.`;
 try{validatedOutput({action:'responder',args:{},answer},schema);}catch{return null;}
 return {...schema,properties:{...schema.properties,action:{...schema.properties.action,enum:['responder']},args:{...schema.properties.args,properties:{},additionalProperties:false},answer:{...schema.properties.answer,enum:[answer]}}};
}
export function valueClarificationMessages(messages,pendingFields){
 const note=`Datos comerciales pendientes: ${pendingFields.join(', ')}. Usá solamente la pregunta del esquema. No recuperes valores descartados, precios de memoria, monedas, fechas, depósitos ni condiciones de pago por defecto. Emisión y entrega son fechas diferentes; precio y cantidad tienen bases independientes. No ejecutes herramientas ni afirmes escrituras.`;
 if(messages.some(message=>message.role==='system'&&message.content.includes(note)))return messages;
 const index=messages.findIndex(message=>message.role==='system');
 return index<0?[{role:'system',content:note},...messages]:messages.map((message,i)=>i===index?{...message,content:message.content+'\n\n'+note}:message);
}
export function localValueDecision(messages,schema){
 const pending=valuePending(messages),narrowed=valueClarificationSchema(schema,pending);
 return narrowed?{schema:narrowed,messages:valueClarificationMessages(messages,pending),clarification:'value',fields:pending}:null;
}

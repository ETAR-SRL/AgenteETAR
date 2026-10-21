import {assert} from '../errors.js';
import {importAction,importProfiles} from './price-imports.js';
import {importedNumber} from './document-reader.js';

const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const fields=['party','shop','list','number','currency','unit','quantityUnit','updateFields','emission','due','warehouse','payment','requester','requesterCode','buyer','costCenter','requestType'];
const properties=Object.fromEntries(fields.map(k=>[k,{type:'string'}]));
const schema={type:'object',properties:{kind:{type:'string',enum:['','proveedor','cliente','pedidoVenta','pedidoCompra','solicitudCompra']},update:{type:'boolean'},...properties,
 edits:{type:'array',maxItems:30,items:{type:'object',properties:{row:{type:'string'},product:{type:'string'},price:{type:'string'},quantity:{type:'string'},quantityUnit:{type:'string'},currency:{type:'string'},unit:{type:'string'},number:{type:'string'},item:{type:'string'},record:{type:'string'},exclude:{type:'boolean'}},required:['row'],additionalProperties:false}}},
 additionalProperties:false};
export function literalAttachmentIntent(text,state={}){
 const n=norm(text),out={edits:[]};
 out.update=/\b(actualiz|cambi|modific|reemplaz|aplic|ajust|prepar|carg)|\b(?:dejar|poner|pone|deja|dej[aá]r?|pon[eé]r?)\s+al\s+dia\b/.test(n);
 if(/\bsolicitud(?:es)?\b|\bsc1\b/.test(n))out.kind='solicitudCompra';
 else if(/\bpedido(?:s)? (?:\d+ )?(?:de )?venta|\bsc6\b/.test(n))out.kind='pedidoVenta';
 else if(/\bpedido(?:s)? (?:\d+ )?(?:de )?compra|\borden(?:es)?(?: \d+)? de compra|\bsc7\b/.test(n))out.kind='pedidoCompra';
 else if(/\bproveedor(?:es)?\b|\baib\b/.test(n))out.kind='proveedor';
 else if(/\bcliente(?:s)?\b|\bda1\b/.test(n))out.kind='cliente';
 if(/\bsolicitud(?: de)? importacion\b|^importacion[.!]?$/.test(n)&&! /\bno\b/.test(n))out.requestType='importacion';
 if(/\bsolicitud(?: de)? compra (?:comun|nacional)\b/.test(n))out.requestType='compra';
 const creating=/\b(crea(?:r|me)?|genera(?:r|me)?|arma(?:r|me)?)\b|\bdesde cero\b|\b(?:nuevo|nueva)\s+(?:pedido|solicitud)\b/.test(n);
 if(creating){
  out.create=true;
  out.update=true;
  const kind=out.kind||state.kind;
  if(['pedidoCompra','crearPedidoCompra'].includes(kind))out.kind='crearPedidoCompra';
  else if(['solicitudCompra','crearSolicitudCompra'].includes(kind))out.kind='crearSolicitudCompra';
  else if(kind==='proveedor'&&/\bpedidos?\b/.test(n))out.kind='crearPedidoCompra';
 }
 if(importProfiles[state.kind]?.creation){
  if(['proveedor','cliente'].includes(out.kind))delete out.kind;
  if(out.kind==='pedidoCompra'&&!/\bactualiz|\bmodific|\bcambi/.test(n))out.kind='crearPedidoCompra';
  if(out.kind==='solicitudCompra'&&!/\bactualiz|\bmodific|\bcambi/.test(n))out.kind='crearSolicitudCompra';
 }
 for(const [key,re] of Object.entries({
  emission:/\b(?:fecha de )?emisi[oó]n\s*(?::|es)?\s*(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/i,
  due:/\b(?:fecha de )?(?:necesidad|entrega)\s*(?::|es)?\s*(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/i,
  warehouse:/\bdep[oó]sito\s*(?::|es)?\s*([a-z0-9_-]+)/i,
  payment:/\b(?:condici[oó]n de pago|pago)\s*(?::|es)?\s*([^,;\n]+)/i,
  requester:/\bsolicitante\s*(?::|es)?\s*([^,;\n]+)/i,
  requesterCode:/\b(?:usuario (?:ERP|Protheus)|c[oó]digo solicitante)\s*(?::|es)?\s*([a-z0-9_-]+)/i,
  buyer:/\bcomprador\s*(?::|es)?\s*([a-z0-9_-]+)/i,
  costCenter:/\bcentro de costo\s*(?::|es)?\s*([a-z0-9_-]+)/i
 })){const m=re.exec(text);if(m)out[key]=m[1].trim();}
 if(state.missing?.length===1&&!Object.keys(out).some(k=>fields.includes(k))){
  const key=state.missing[0];
  if(['emission','due','warehouse','payment','requester','requesterCode','buyer'].includes(key)&&text.trim().length<=120)out[key]=text.trim();
 }
 // A party clarification must not turn an existing order into a price list.
 if(importProfiles[state.kind]?.order&&['cliente','proveedor'].includes(out.kind))delete out.kind;
 const party=/(?:proveedor|cliente)\s+(?:(?:es|se llama)\s+)?(.+?)(?=\s+(?:tienda|lista|en (?:d[oó]lares|pesos|usd|ars)|por (?:millar|unidad)|con (?:este|el|ese) (?:archivo|adjunto|excel|pdf)|usando|a partir de)\b|[,;\n]|$)/i.exec(text);
 if(party)out.party=party[1].trim().replace(/^["«]|["».]$/g,'');
 for(const [key,re] of Object.entries({shop:/\btienda\s+([a-z0-9-]+)/i,list:/\blista\s+(?:n[°º.]?\s*)?([0-9]+)/i,number:/\b(?:pedido|solicitud|documento|orden)(?:\s+de\s+(?:venta|compra))?\s*(?:es\s+(?:la|el)\s+)?(?:n(?:ro|[uú]mero)?[°º.]?\s*)?([0-9][a-z0-9-]*)/i})){
  const m=re.exec(text);if(m)out[key]=m[1];
 }
 if(state.missing?.includes('number')&&!out.number&&!/\bfila\b/.test(n)){
  const answer=/^(?:el|la|es|es el|es la)?\s*(\d{1,20})[.]?$/.exec(n);if(answer)out.number=answer[1];
 }
 if(/\b(usd|dolares?|dolar)\b|u\$s|us\$/i.test(n))out.currency='USD';
 else if(/\b(ars|pesos?)\b/.test(n))out.currency='ARS';
 else if(/\b(eur|euros?)\b/.test(n))out.currency='EUR';
 else{const code=/\bmoneda\s+(\d+)\b/.exec(n);if(code)out.currency=code[1];}
 if(/\b(millar(?:es)?|cada mil|por 1000)\b/.test(n))out.unit='millar';
 else if(/\b(por unidad|unitari[oa]s?|unidades)\b/.test(n)||n==='unidad'||n==='un')out.unit='unidad';
 else if(/^(kg|g|m|mt|l|lt)$/i.test(n))out.unit=text.trim().toUpperCase();
 const onlyQuantity=/\bsolo\s+(?:las\s+)?cantidades?\b|\bsin\s+(?:cambiar|modificar|tocar)\s+(?:los\s+)?precios?\b/.test(n);
 const onlyPrice=/\bsolo\s+(?:los\s+)?precios?\b|\bsin\s+(?:cambiar|modificar|tocar)\s+(?:las\s+)?cantidades?\b/.test(n);
 const asksQuantity=!onlyPrice&&/\bcantidades?\b/.test(n),asksPrice=!onlyQuantity&&/\bprecios?\b/.test(n);
 if(asksQuantity||asksPrice)out.updateFields=asksQuantity&&asksPrice?'both':asksQuantity?'quantities':'prices';
 if(/\bambos\b/.test(n)&&state.missing?.includes('updateFields'))out.updateFields='both';
 const quantityBase=/\bcantidades?\s+(?:en\s+)?(millares|millar|unidades|unidad|un|kg|g|m|mt|l|lt)\b/.exec(n)?.[1];
 const priceBase=/\bprecios?\s+(?:por\s+)?(millares|millar|unidades|unidad|un|kg|g|m|mt|l|lt)\b/.exec(n)?.[1];
 const quantityContext=out.updateFields==='quantities'||!asksPrice&&(asksQuantity||state.values?.updateFields==='quantities'||state.missing?.includes('quantityUnit')&&!state.missing?.includes('unit'));
 if(quantityBase)out.quantityUnit=quantityBase;
 else if(out.unit&&quantityContext)out.quantityUnit=out.unit;
 if(quantityContext&&!priceBase)delete out.unit;
 if(priceBase)out.unit=priceBase;
 if(state.values?.updateFields&&!out.update&&!onlyQuantity&&!onlyPrice&&(quantityBase||priceBase))delete out.updateFields;
 // When both bases are missing, an unqualified "millares" cannot select both.
 if(out.unit&&!asksPrice&&!asksQuantity&&state.missing?.includes('quantityUnit')&&state.missing?.includes('unit'))delete out.unit;
 const row=/\bfila\s+(\d+)\b/.exec(n);
 if(row){
  const edit={row:row[1]};
  for(const [key,re] of Object.entries({record:/\bregistro\s+(?:es\s+)?(\d+)/i,item:/\b[ií]tem\s+(?:es\s+)?([a-z0-9]+)/i,product:/\b(?:producto|c[oó]digo)\s+(?:es\s+)?([a-z0-9_-]+)/i,price:/\bprecio\s+(?:(?:a|es)\s+)?(\d+(?:[.,]\d+)?)/i})){const m=re.exec(text);if(m)edit[key]=key==='price'?importedNumber(m[1]):m[1];}
  if(out.number){edit.number=out.number;delete out.number;}
  const amount=/\bcantidad\s+(?:(?:a|es)\s+)?(\d+(?:[.,]\d+)?)/i.exec(text);
  if(amount)edit.quantity=importedNumber(amount[1]);
  if(/\b(exclui|omiti|quita|saca|descarta|ignora)/.test(n))edit.exclude=true;
  for(const k of ['unit','currency','quantityUnit','warehouse','due','costCenter'])if(out[k]){edit[k]=out[k];delete out[k];}
  delete out.updateFields; // A row correction must not change the selected columns for every other row.
  out.edits.push(edit);
 }
 return out;
}
// The model only extracts user-supplied references. File contents never enter its
// instruction context, and monetary edits must be literal in the user's message.
export async function attachmentIntent(text,state,model){
 const literal=literalAttachmentIntent(text,state);
 if(state.missing?.includes('quantityUnit')&&state.missing?.includes('unit')&&/^(millares?|unidades?|un|kg|g|m|mt|l|lt)[.]?$/i.test(norm(text)))return literal;
 if(literal.update&&literal.kind||Object.keys(literal).some(k=>!['update','edits'].includes(k))||literal.edits.some(e=>Object.keys(e).length>1))return literal;
 if(!model)return literal;
 const result=await model.complete([{role:'system',content:`Extraé datos del mensaje del usuario para actualizar precios o cantidades de un adjunto. Devolvé JSON, sin ejecutar nada. Contexto de destino: ${state.kind||'desconocido'}; dato que falta: ${state.missing?.join(', ')||'destino'}. kind proveedor/cliente significa lista de precios, pedidoVenta/pedidoCompra/solicitudCompra documento existente. update true sólo si pide aplicar/cambiar/actualizar, no consultar. party nombre o código literal, shop tienda, list código de lista, number número de documento (conservar ceros), currency USD/ARS/EUR o código, unit es la base del PRECIO: millar/unidad o UM literal. quantityUnit es la base de CANTIDAD: millares/unidades o UM literal, independiente del precio. Nunca trasladar una base de precio a cantidad. Omití lo no mencionado. NO repitas kind si no cambia ni lo menciona el usuario. edits sólo si identifica explícitamente fila N; price o quantity decimal positivo literal, record RECNO literal, exclude sólo al pedir omitir esa fila. Nunca inventes ni completes valores desde conocimiento. No hay campo para ejecutar ni confirmar.`},{role:'user',content:text}],schema);
 const safe={...literal};
 if(importAction(result.kind))safe.kind=result.kind;
 safe.update=literal.update||result.update===true;
 for(const k of fields.filter(k=>!['updateFields','quantityUnit','requestType'].includes(k)))if(typeof result[k]==='string'&&result[k].length<=120&&norm(text).includes(norm(result[k]))&&result[k].trim()){
  if(k==='party'&&state.kind&&importProfiles[state.kind]?.order&&!/\b(cliente|proveedor)\b/.test(norm(text)))continue;
  if(['list','shop','number'].includes(k)&&!/^[a-z0-9_-]{1,30}$/i.test(result[k]))continue;
  if(k==='list'&&['lista','precios'].includes(norm(result[k])))continue;
  safe[k]=result[k].trim();
 }
 // Enum translations are taken only from the deterministic extractor.
 for(const k of ['unit','currency','quantityUnit','updateFields'])if(literal[k])safe[k]=literal[k];
 if(Array.isArray(result.edits)){
  safe.edits=result.edits.filter(e=>new RegExp(`\\bfila\\s+${String(e.row).replace(/\D/g,'')}\\b`,'i').test(text)).map(e=>{
   const edit={row:e.row};
   for(const k of ['product','currency','unit','number','item','record','quantityUnit'])if(typeof e[k]==='string'&&e[k].trim()&&norm(text).includes(norm(e[k])))edit[k]=e[k].trim();
   if(e.price&&[...text.matchAll(/\d+(?:[.,]\d+)?/g)].some(m=>importedNumber(m[0])===e.price))edit.price=e.price;
   if(e.quantity&&[...text.matchAll(/\d+(?:[.,]\d+)?/g)].some(m=>importedNumber(m[0])===e.quantity))edit.quantity=e.quantity;
   if(e.exclude===true&&/\b(exclu|omiti|quita|saca|descart)/i.test(norm(text)))edit.exclude=true;
   return edit;
  });
 }
 return safe;
}

export function createAttachmentChat({imports,authorize,model}){
 return async function chat(actor,input,conversation,branch,preferences={}){
  if(input.attachmentId===null){
   if(conversation.attachment)imports.invalidate(actor,conversation.attachment.id);
   delete conversation.attachment;return null;
  }
  if(!input.attachmentId&&!conversation.attachment)return null;
  if(input.attachmentId)assert(typeof input.attachmentId==='string'&&/^[a-f0-9-]{36}$/.test(input.attachmentId),400,'ADJUNTO_INVALIDO','Identificador de adjunto inválido.');
  if(/\b(cancela|olvida|descarta)\b.*\b(archivo|adjunto|importacion)\b/i.test(norm(input.text))){
   if(conversation.attachment)imports.invalidate(actor,conversation.attachment.id);
   delete conversation.attachment;return {answer:'Descarté el adjunto de esta conversación. No se modificó el ERP.',attachment:null};
  }
  const id=input.attachmentId||conversation.attachment.id,draft=imports.get(actor,id);
  assert(draft.branch===branch,403,'SUCURSAL_ADJUNTO_DISTINTA','El archivo corresponde a otra sucursal. Adjuntalo nuevamente en la sucursal actual.');
  let state=conversation.attachment;
  if(!state||state.id!==id){
   if(state)imports.invalidate(actor,state.id);
   state={id,kind:importAction(draft.kind)?draft.kind:importAction(draft.defaults?.kind)?draft.defaults.kind:undefined,values:{...draft.defaults},rows:structuredClone(draft.rows),requested:false};
  }
  // Invalidate prior confirmations even when the next turn asks for missing data.
  imports.invalidate(actor,id);
  const intent=await attachmentIntent(input.text,state,model);
  if(conversation.attachment&& !state.missing?.length&&!intent.update&&!intent.kind&&!fields.some(k=>intent[k])&&!intent.edits?.length)return null;
  if(/\bno\s+(?:actuali|cambi|modifi|apli|cre[ae]|gener|arm)/i.test(norm(input.text)))return {answer:'No aplicaré cambios. El archivo sigue disponible para revisarlo.',attachment:{id,name:draft.name}};
  if(intent.create&&!importProfiles[intent.kind||state.kind]?.creation)return {answer:'Desde adjuntos puedo crear pedidos de compra o solicitudes. Indicá cuál de esos documentos querés crear; no preparé ninguna actualización.',attachment:{id,name:draft.name}};
  if(intent.kind&&intent.kind!==state.kind){
   if(state.kind){
    state.values={...draft.defaults};state.rows=structuredClone(draft.rows);
    if(importProfiles[state.kind]?.party!==importProfiles[intent.kind]?.party)for(const key of ['party','shop','list'])delete state.values[key];
   }
   state.kind=intent.kind;
  }
  state.requested||=intent.update;
  for(const k of fields)if(intent[k])state.values[k]=intent[k];
  for(const edit of intent.edits||[]){
   const row=state.rows.find(r=>r.id===edit.row);
   assert(row,400,'FILA_NO_EXISTE','No existe esa fila en el adjunto.');
   for(const k of ['product','price','quantity','quantityUnit','unit','currency','number','item','record','exclude','warehouse','due','costCenter'])if(edit[k]!==undefined)row[k]=edit[k];
  }
  conversation.attachment=state;
  const rows=state.rows.filter(r=>!r.exclude).map(r=>({...r,...Object.fromEntries(['unit','currency','quantityUnit','warehouse','due','costCenter'].filter(k=>state.values[k]&&intent[k]).map(k=>[k,state.values[k]]))}));
  // Persist explicit global corrections, preserving later row-specific corrections.
  state.rows=state.rows.map(r=>rows.find(x=>x.id===r.id)||r);
  if(importProfiles[state.kind]?.creation){
   authorize(state.kind,branch);
   const applied=[];
   for(const key of ['warehouse','requester'])if(!state.values[key]&&preferences[key]&&(key!=='warehouse'||rows.some(r=>!r.warehouse))){state.values[key]=preferences[key];applied.push(key==='warehouse'?'depósito '+preferences[key]:'solicitante '+preferences[key]);}
   const preferenceNote=applied.length?' Usé tu preferencia de '+applied.join(' y ')+', sujeta a la validación ERP y al resumen de confirmación.':'';
   const attachment={id,name:draft.name,kind:state.kind,rows:state.rows,defaults:state.values};
   if(!state.requested)return {answer:'¿Querés crear un documento nuevo con estas filas?',attachment};
   imports.classify(actor,id,state.kind);
   try{
    const result=await imports.preview(actor,id,{...state.values,rows,reviewed:true});
    state.missing=result.missing||[];
    return {answer:result.message+preferenceNote,attachment,proposal:result.proposal,issues:result.issues,choices:result.choices};
   }catch(error){
    if(['LECTURA_DENEGADA','ACCION_DENEGADA','ACCESO_CAMBIO'].includes(error.code)||!error.code)throw error;
    return {answer:`No preparé el alta: ${error.message}`,attachment};
   }
  }
  const missing=[],questions=[];
  const ask=(key,question)=>{missing.push(key);questions.push(question);};
  if(!state.requested)ask('instruction','¿Qué querés crear o actualizar con el archivo?');
  if(!state.kind)ask('kind','¿Actualizamos la lista de un proveedor o cliente, un pedido de venta/compra o una solicitud existente?');
  else{
   authorize(state.kind,branch); // before any ERP lookup
   const profile=importProfiles[state.kind];
   if(!profile.order&&!state.values.party)ask('party',`¿De qué ${state.kind} es la lista? Podés indicar nombre o código.`);
   if(profile.order&&!state.values.number&&rows.some(r=>!r.number))ask('number','¿Cuál es el número del documento existente?');
  }
  if(!state.values.updateFields){
   const hasQuantity=rows.some(r=>r.quantity||r.rawQuantity),hasPrice=rows.some(r=>r.price||r.rawPrice);
   if(hasQuantity&&hasPrice&&importProfiles[state.kind]?.order)ask('updateFields','El archivo contiene precios y cantidades. ¿Actualizo precios, cantidades o ambos?');
   else state.values.updateFields=hasQuantity&&!hasPrice?'quantities':'prices';
  }
  const withPrice=state.values.updateFields&&state.values.updateFields!=='quantities',withQuantity=state.values.updateFields&&state.values.updateFields!=='prices';
  if(!rows.length)ask('rows','No hay filas seleccionadas. Adjuntá una lista con producto y precio o cantidad.');
  if(withPrice&&rows.some(r=>!r.currency)&&!state.values.currency)ask('currency','¿En qué moneda están los precios?');
  if(withPrice&&rows.some(r=>!r.unit)&&!state.values.unit)ask('unit','¿Los precios son por unidad o por millar?');
  if(withQuantity&&rows.some(r=>!r.quantityUnit)&&!state.values.quantityUnit)ask('quantityUnit','¿Las cantidades son en unidades o en millares? Esta base es independiente de la del precio.');
  state.missing=missing;
  const attachment={id,name:draft.name,kind:state.kind,rows:state.rows,defaults:state.values};
  if(missing.length)return {answer:`Leí ${draft.rows.length} filas de ${draft.name}.\n${questions.join('\n')}`,attachment};
  imports.classify(actor,id,state.kind);
  let result;
  try{result=await imports.preview(actor,id,{...state.values,rows,reviewed:true});}
  catch(error){
   if(['LECTURA_DENEGADA','ACCION_DENEGADA','ACCESO_CAMBIO'].includes(error.code))throw error;
   if(!error.code)throw error;
   return {answer:`No preparé cambios: ${error.message}`,attachment};
  }
  state.missing=result.question?[result.question]:[];
  const choices=(result.choices||[]).map(c=>({label:`${c.codigo} / ${c.tienda} · ${c.nombre}`,text:`${importProfiles[state.kind].party==='proveedores'?'proveedor':'cliente'} ${c.codigo} tienda ${c.tienda}`}));
  for(const issue of result.issues||[])for(const c of issue.candidates||[])choices.push({label:`Fila ${issue.fila} · ${c.numero?'Documento '+c.numero:'Lista '+c.lista} · ítem ${c.item||'—'} · ${c.precio} · ${c.moneda||''} · desde ${c.desde||'—'} · registro ${c.registro}`,text:`fila ${issue.fila} registro ${c.registro}`});
  return {answer:result.message+(result.batch?`\nVerifiqué los productos en SB1 y los registros existentes. Revisá el resumen antes de confirmar. ${withQuantity?'Las cantidades indicadas reemplazan las actuales; no se suman.':'Las cantidades se conservan.'} Los totales de pedidos y solicitudes los calcula el ejecutor.`:''),attachment,batch:result.batch,choices};
 };
}

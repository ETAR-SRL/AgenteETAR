import {assert} from '../errors.js';
import {valueCorrections} from './value-corrections.js';
import {applyCommercialValueIntake} from './purchase-chat.js';
import {valueClarificationSchema,valueClarificationMessages,valueResume,independentValueRead} from './value-decision.js';
import {conversationContext} from './memory.js';
import {validatedOutput} from './model-contract.js';
import {referenceCorrections} from './reference-corrections.js';
import {referenceContext} from './reference-chat.js';

const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const operations={sale:'pedidoVenta',purchase:'pedidoCompra',request:'solicitudCompra',salePrice:'precioLista',saleList:'precioLista',supplierList:'precioListaProveedor'};
const resources={sale:['productos','itemsVentas'],purchase:['productos','compras'],request:['productos','solicitudesCompra'],salePrice:['productos','preciosClientes'],saleList:['productos','preciosClientes'],supplierList:['productos','proveedores','preciosProveedores']};

// A small preflight prevents rejected values being revived by a ranked history,
// list lookup or commercial defaults. Existing intakes own every proposal.
export async function valueChat({text,conversation,branch,authorizeRead=()=>{},authorizePlan,canPlan,prepare,model,schema,singleBranch=false}){
 if(independentValueRead(text))return null;
 const n=norm(text);
 if(/\b(?:cancela(?:lo)?|cancelar|olvida(?:lo)?)\b/.test(n)||/\b(?:crea\w*|genera\w*|arma\w*)\b/.test(n)&&/\b(?:solicitud|pedido|orden)\b/.test(n))return null;
 const numeric=/\b(?:precio|cantidad|moneda|millares?|unidades?|pesos?|dolares?|usd|ars)\b/.test(n);
 const relevant=valueResume(text)||numeric||/^\s*(?:no|perdon|en realidad|mejor|son|es)\b/.test(n);
 if(!relevant)return null;
 const scoped=state=>state?.branch===branch;
 const purchases=[conversation.purchaseDraft,conversation.pausedPurchase].filter(scoped);
 const businesses=[conversation.businessContext,conversation.pausedBusiness].filter(state=>scoped(state)&&state.pending);
 const target=/\bpedido(?: de)? venta\b/.test(n)?'sale':/\bsolicitud\b/.test(n)?'request':/\bpedido(?: de)? compra\b/.test(n)?'purchase':null;
 let state;
 if(target)state=target==='sale'?businesses.find(s=>s.kind==='sale'):purchases.find(s=>s.action===(target==='request'?'crearSolicitudCompra':'crearPedidoCompra'))||businesses.find(s=>s.kind===target);
 else state=scoped(conversation.purchaseDraft)?conversation.purchaseDraft:scoped(conversation.businessContext)&&conversation.businessContext.pending?conversation.businessContext:purchases[0]||businesses[0];
 if(!state)return null;
 const isPurchase=purchases.includes(state),values=isPurchase?state.values:state.pending;
 const correction=valueCorrections(text,{values});
 const pending=new Set(state.unresolvedValues||[]);
 for(const field of correction.rejected)pending.add(field);
 for(const field of correction.pending)pending.add(field);
 for(const field of Object.keys(correction.changes))pending.delete(field);
 if(correction.optionalPriceRemoved&&state.action==='crearSolicitudCompra'){pending.delete('price');pending.delete('priceUnit');}
 if(!correction.rejected.length&&!Object.keys(correction.changes).length&&!pending.size)return null;
 const action=isPurchase?state.action:operations[state.kind];
 assert(canPlan&&prepare,403,'ROL_INSUFICIENTE','Tu rol no permite preparar cambios.');
 if(action)await authorizePlan?.(action);
 for(const resource of isPurchase?['productos',...(action==='crearPedidoCompra'?['proveedores']:[])]:resources[state.kind]||[])await authorizeRead(resource,branch);
 if(isPurchase&&state===conversation.pausedPurchase){conversation.purchaseDraft=state;delete conversation.pausedPurchase;}
 if(!isPurchase&&state===conversation.pausedBusiness){conversation.businessContext=state;delete conversation.pausedBusiness;}
 // A turn can reject an identity and an amount together. Keep its literal
 // amounts but let the identity preflight invalidate and resolve the reference
 // first; neither clarification may revive the other discarded field.
 if(Object.keys(referenceCorrections(text,referenceContext(conversation,branch,text))).length){
  const input={};applyCommercialValueIntake(state,input,text,{purchase:isPurchase});Object.assign(values,input);
  return null;
 }
 if(!pending.size)return {continueIntake:true};
 // Store removal before inference so model/network failure cannot resurrect it.
 const input={};applyCommercialValueIntake(state,input,text,{purchase:isPurchase});Object.assign(values,input);
 const fields=state.unresolvedValues||[...pending];
 if(!fields.length)return {continueIntake:true};
 const narrowed=valueClarificationSchema(schema,fields);assert(narrowed,502,'IA_RESPUESTA_INVALIDA','No pude preparar la aclaración.');
 const recalled=conversationContext(conversation,text,branch,{singleBranch,budget:4000});
 const messages=valueClarificationMessages([{role:'system',content:'Sos Central de Argentina. Preguntá sólo el dato comercial descartado usando el JSON del esquema. Los demás datos se conservan. No se consultaron valores actuales ni se prepararon operaciones en este turno.'},...recalled,{role:'user',content:text}],fields);
 const result=validatedOutput(await model.complete(messages,narrowed,{maxInputChars:24000,maxOutputTokens:384,timeoutMs:60000}),narrowed);
 return {answer:result.answer,evidence:[],trace:[],model:model.name,local:model.local!==false,valueClarification:true};
}

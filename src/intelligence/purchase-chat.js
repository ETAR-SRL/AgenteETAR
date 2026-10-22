import {assertPriceCurrency} from './references.js';
import {supplierPrice} from './order-list-price.js';
import {assert} from '../errors.js';
import {literalAttachmentIntent} from './attachment-chat.js';
import {importDate} from './purchase-imports.js';
import {importedNumber} from './document-reader.js';

const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const number='(\\d+(?:[.,]\\d+)?)';
const quantity=new RegExp('\\b'+number+'\\s*(unidad(?:es)?|un|millar(?:es)?|kg|g|mt|m|lt|l)\\b','i');
const price=new RegExp('(?:\\bprecio\\s*(?:es|de|a|:)?\\s*|\\ba\\s+)'+number+'(?:\\s*(?:pesos?|d[oó]lares?|ars|usd))?\\s*(?:por\\s+(unidad|millar|kg|g|mt|m|lt|l))?','i');
const codePattern=/\b(?:producto|articulo|codigo)\s+(?:es\s+|codigo\s+)?([a-z0-9][a-z0-9_./-]*)(?=\s|[,;!?]|$)/i;
const quantityMatches=text=>[...text.matchAll(new RegExp(quantity.source,'ig'))].filter(match=>!/\b(?:lista|codigo|producto|articulo|pedido(?: de (?:compra|venta))?|solicitud(?: de compra)?|numero|item|tienda)\s*$/i.test(text.slice(0,match.index)));
export function purchaseValueAmbiguity(text){
 const n=norm(text);
 if(/\bno\s+(?:son?|es|eran?|serian?)\s+\d|\b(?:no|sin)\s+(?:(?:uses?|usar|tomes?|tomar|pongas?|poner)\s+)?(?:(?:el|la)\s+)?(?:precio|cantidad|importe|moneda)\s+(?:de\s+)?\d/.test(n))return 'No voy a usar el valor negado. Indicá de forma afirmativa el importe o cantidad que corresponde y su base. Conservo los datos anteriores; no preparé cambios.';
 if(/\b\d+(?:[.,]\d+)?\s+(?:lucas?|verdes?)\b/.test(n)||/\b\d+(?:[.,]\d+)?\b[^;\n.!?]*\b(?:o|u)\s+(?:a\s+)?\d+(?:[.,]\d+)?\b/.test(n))return 'Necesito un único importe exacto, su moneda y si el precio es por unidad o por millar. ¿Qué valor corresponde? Conservo los datos anteriores; no preparé cambios.';
 const currencies=[/\b(?:usd|dolares?|dolar)\b|u\$s|us\$/, /\b(?:ars|pesos?)\b/, /\b(?:eur|euros?)\b/].filter(re=>re.test(n));
 if(currencies.length>1)return 'Mencionaste más de una moneda. ¿Cuál corresponde al importe? Conservo los datos anteriores; no preparé cambios.';
 return null;
}
export function negatedReferences(text){
 const n=norm(text),keys=[];
 for(const [key,word] of [['product','producto|articulo|codigo'],['vendor','proveedor'],['customer','cliente'],['number','pedido|solicitud'],['list','lista'],['shop','tienda'],['item','item']])if(new RegExp('\\b(?:no|sin|excepto|menos)\\s+(?:(?:es|era|el|la|del|de|ese|esa)\\s+)*(?:'+word+')\\b').test(n))keys.push(key);
 return keys;
}
export function unambiguousPurchaseValues(text){
 const values=purchaseValues(text),rejected=negatedReferences(text),safe={};
 if(values.product&&!rejected.includes('product'))safe.product=values.product;
 // Only retain a separately stated quantity; alternative amounts stay unresolved.
 const clauses=text.split(/[;\n]|,(?=\s*[a-záéíóúñ])|\.(?=\s+[a-záéíóúñ])/i).map(clause=>clause.split(/\bprecio\b|\ba\s+\d/i)[0]);
 const matches=clauses.flatMap(clause=>quantityMatches(clause).map(match=>({match,clause})));
 if(matches.length===1&&!purchaseValueAmbiguity(matches[0].clause)){
  safe.quantity=importedNumber(matches[0].match[1]);safe.quantityUnit=norm(matches[0].match[2]);
 }
 return safe;
}
export function purchaseValues(text){
 const n=norm(text),literal=literalAttachmentIntent(text),values={};
 const list=/\blista(?: de precios)?\s+([a-z0-9_-]+)/i.exec(text);if(list)values.list=list[1];
 for(const key of ['currency','warehouse','requester','requesterCode','requestType','costCenter','party','shop','payment','buyer'])if(literal[key])values[key]=literal[key];
 for(const key of ['emission','due'])if(literal[key])values[key]=importDate(literal[key]);
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'});
 if(/\bemision\s+(?:para\s+)?hoy\b/.test(n))values.emission=today;
 if(/\b(?:necesidad|entrega)\s+(?:para\s+)?hoy\b/.test(n))values.due=today;
 const product=codePattern.exec(n);
 if(product&&!['de','del','el','nuevo','que','con','solicitante','comprador'].includes(product[1]))values.product=product[1].replace(/[.]$/,'').toUpperCase();
 const q=quantityMatches(text)[0],explicitQuantity=new RegExp('\\bcantidad\\s*(?:es|de|:)?\\s*'+number,'i').exec(text);
 if(q){values.quantity=importedNumber(q[1]);values.quantityUnit=norm(q[2]);}
 else if(explicitQuantity)values.quantity=importedNumber(explicitQuantity[1]);
 const p=[...text.matchAll(new RegExp(price.source,'ig'))].find(p=>p[2]||/^precio/i.test(p[0])||/\b(?:pesos?|d[oó]lares?|ars|usd)\b/i.test(p[0]));if(p){values.price=importedNumber(p[1]);if(p[2])values.priceUnit=norm(p[2]);}
 const priceBasis=/\bpor (unidad|millar|kg|g|mt|m|lt|l)\b/.exec(n);
 if(priceBasis)values.priceUnit=priceBasis[1];
 const quantityBasis=/\bcantidades?\s+(?:en\s+)?(unidades|millares|kg|g|mt|m|lt|l)\b/.exec(n);
 if(quantityBasis)values.quantityUnit=quantityBasis[1];
 return values;
}

// A bounded, single-item intake avoids repeated inference for explicit references.
// Values remain user input, never executed SQL or instructions from an ERP row.
export async function purchaseChat({text,conversation,branch,canPlan,authorizePlan,read,prepare,actor,preferences={}}){
 const n=norm(text),purchaseOrder=/\bpedido(?: de)? compra\b/.test(n),start=/\b(crea(?:r|me)?|genera(?:r|me)?|arma(?:r|me)?)\b/.test(n)&&/\b(?:solicitud(?: de)? (?:compra|importacion)|pedido(?: de)? compra)\b/.test(n);
 const resume=/\b(retoma(?:r|me)?|retomemos|continu(?:a(?:r|mos)?|emos)|segui(?:r|mos)?)\b/.test(n)&&/\b(solicitud|pedido de compra)\b/.test(n);
 if(resume&&conversation.pausedPurchase?.branch===branch&&conversation.pausedPurchase.action===(purchaseOrder?'crearPedidoCompra':'crearSolicitudCompra')){conversation.purchaseDraft=conversation.pausedPurchase;delete conversation.pausedPurchase;}
 let state=conversation.purchaseDraft;
 const pause=()=>{if(state?.branch===branch){conversation.pausedPurchase=structuredClone(state);delete conversation.pausedPurchase.values.resolvedPrice;}delete conversation.purchaseDraft;};
 if(start)delete conversation.pausedPurchase;
 const hadPaused=!!conversation.pausedPurchase;
 if(/\b(cancelar|cancela|cancelalo|olvidalo)\b/.test(n))delete conversation.pausedPurchase;
 const values=purchaseValues(text);if(/\b(?:sin precio|no tengo precio)\b/.test(n))values.withoutPrice=true;
 if(/\bno\s+(?:lo\s+|me\s+)?(?:cre|gener|arm)|\b(?:solo|solamente)\s+consult/.test(n)){delete conversation.purchaseDraft;return null;}
 if(/\b(cancelar|cancela|cancelalo|olvidalo)\b/.test(n)&&(state||hadPaused)){delete conversation.purchaseDraft;return {answer:'Descarté los datos de esta solicitud. No se creó ningún documento.',evidence:[],trace:[]};}
 // Do not turn a multi-item or another business operation into a single item.
 if(/\bproductos\b|\b(?:factura|venta)\b/.test(n)||/\bpedido\b/.test(n)&&!purchaseOrder&&state?.action!=='crearPedidoCompra'||(n.match(/\bproducto\b/g)||[]).length>1||/\bproducto\s+\S+\s+(?:y|e|,)\s*\d/.test(n)){
  pause();return null;
 }
 if(start&&!values.product){delete conversation.purchaseDraft;return null;}
 const ambiguous=purchaseValueAmbiguity(text);
 if(!start&&(!state||state.branch!==branch||(!Object.keys(values).length&&!resume&&!ambiguous))){pause();return null;}
 assert(canPlan&&prepare,403,'ROL_INSUFICIENTE','Tu rol no permite preparar solicitudes de compra.');
 const action=start&&purchaseOrder?'crearPedidoCompra':start?'crearSolicitudCompra':state.action||'crearSolicitudCompra',pc=action==='crearPedidoCompra';
 await authorizePlan?.(action);
 if(start)state={branch,action,values:{...(preferences.warehouse?{warehouse:preferences.warehouse}:{}),...(preferences.requester?{requester:preferences.requester}:{})}};
 if(ambiguous){
  if(start){state.values={...state.values,...unambiguousPurchaseValues(text)};conversation.purchaseDraft=state;}
  return {answer:ambiguous+(start?' Conservé el producto y las cantidades inequívocas; su verificación en SB1 queda pendiente de la aclaración.':''),evidence:[],trace:[]};
 }
 const rejected=negatedReferences(text).map(key=>key==='vendor'?'party':key).filter(key=>['product','party','shop','list'].includes(key));
 const unresolved=new Set(state.unresolvedReferences||[]);
 for(const key of Object.keys(values))if(!rejected.includes(key))unresolved.delete(key);
 for(const key of rejected){delete values[key];delete state.values[key];unresolved.add(key);}
 state.unresolvedReferences=[...unresolved];
 if(values.withoutPrice){delete state.values.price;delete state.values.priceUnit;delete state.values.resolvedPrice;}
 if(values.list&&!values.price){delete state.values.price;delete state.values.priceUnit;}
 state.values={...state.values,...values};
 conversation.purchaseDraft=state;
 if(unresolved.size)return {answer:'Conservo los demás datos. Indicá de forma afirmativa '+[...unresolved].map(key=>({product:'el producto',party:'el proveedor',shop:'la tienda',list:'la lista'})[key]).join(' y ')+' que corresponde; no usaré la referencia negada.',evidence:[],trace:[]};
 const v=state.values,evidence=[],trace=[];
 const query=async(resource,filters)=>{
  const result=await read(resource,new URLSearchParams({sucursal:branch,limit:'2',...filters}));
  evidence.push({id:'F'+(evidence.length+1),action:'consultar_erp',args:{recurso:resource,filtros:filters},result});
  trace.push({action:'consultar_erp',status:'ok',sourceId:evidence.at(-1).id});return result;
 };
 const productResult=await query('productos',{codigo:v.product});
 const matches=productResult.data?.filter(p=>p.codigo===v.product)||[];
 if(matches.length!==1||productResult.meta?.hasMore){
  delete conversation.purchaseDraft;
  return {answer:matches.length?'El código no identifica un producto único en SB1. ¿Podés precisar el producto?':`No encontré el código exacto ${v.product} en SB1 de esta sucursal. ¿Cuál es el código o nombre del producto? No se creó ninguna solicitud.`,evidence,trace};
 }
 const product=matches[0],unit=String(product.unidadMedida||'').trim().toUpperCase();
 const description=`Encontré ${product.codigo}: ${product.nombre||'sin descripción'} (${product.tipo?.descripcion||product.tipo?.codigo||'tipo no informado'}).`;
 const blocked=String(product.bloqueado?.codigo??product.bloqueado??'');
 if(blocked==='1'){delete conversation.purchaseDraft;return {answer:description+' Está bloqueado; no preparé el alta.',evidence,trace};}
 const basis=(value,isQuantity)=>{
  if(!value)return '';
  if(/^millar(?:es)?$/.test(value))return unit==='UN'?(isQuantity?'millares':'millar'):'';
  if(/^(unidad(?:es)?|un)$/.test(value)&&unit==='UN'||value.toUpperCase()===unit)return isQuantity?'unidades':'unidad';
  return '';
 };
 const baseCantidad=basis(v.quantityUnit,true);let basePrecio=basis(v.priceUnit,false);
 const missing=[];
 if(!v.quantity)missing.push(`cantidad en ${unit||'la unidad de SB1'}${unit==='UN'?' o millares':''}`);
 else if(!baseCantidad)missing.push(`confirmar la base de cantidad: ${unit||'unidad de SB1'}${unit==='UN'?' o millares':''}`);

 if(!v.currency&&v.price)missing.push('moneda');
 if(v.price&&!basePrecio)missing.push(`confirmar si el precio es por ${unit||'unidad'}${unit==='UN'?' o por millar':''}`);
 if(!v.warehouse)missing.push(`depósito${product.depositoPredeterminado?` (SB1 indica ${product.depositoPredeterminado}; podés elegirlo)` :''}`);
 if(!v.emission)missing.push('fecha de emisión');
 if(!v.due)missing.push('fecha de necesidad');
 if(!pc&&!v.requester)missing.push('solicitante');
 if(!pc&&v.currency&&v.currency!=='ARS'&&v.currency!=='1'&&!v.requestType)missing.push('confirmar si corresponde una solicitud de importación (MATA113)');
 if(v.warehouse){
  const result=await query('depositos',{codigo:v.warehouse});
  if(result.data?.length!==1||result.meta?.hasMore){delete v.warehouse;missing.push('un depósito válido');}
 }
 const resolve=async(resource,term,extra={})=>{
  let r=await query(resource,{codigo:term,...extra});
  if(!r.data.length&&term.length>1)r=await query(resource,{q:term,...extra});
  return r;
 };
 let vendor,payment;
 if(pc){
  if(!v.party)missing.push('proveedor');
  else{const r=await resolve('proveedores',v.party,v.shop?{tienda:v.shop}:{});if(r.data.length===1&&!r.meta?.hasMore){vendor=r.data[0];v.party=vendor.codigo;v.shop=vendor.tienda;}else missing.push('proveedor y tienda únicos (ver coincidencias)');}
  if(!v.payment)missing.push('condición de pago');
  else{const r=await resolve('condicionesPago',v.payment);if(r.data.length===1&&!r.meta?.hasMore){payment=r.data[0];v.payment=payment.codigo;}else missing.push('una condición de pago válida');}
 }
 if(pc&&vendor&&!v.price){
  delete v.resolvedPrice;
  const found=await supplierPrice({query,product:product.codigo,vendor:vendor.codigo,shop:vendor.tienda,list:v.list,at:v.emission||new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'})});
  if(found.row){
   try{if(v.currency)assertPriceCurrency(/^\d+$/.test(v.currency)?'moneda '+v.currency:v.currency,found.row,assert);v.resolvedPrice=found.row;}catch{missing.push('confirmar la moneda: la lista está en '+found.row.moneda.descripcion);}
  }else missing.push(found.message);
 }
 if(pc&&!vendor&&!v.price)delete v.resolvedPrice;
 conversation.purchaseDraft=state;
 if(missing.length){
  const essentials=missing.filter(x=>/cantidad|precio|moneda|importación|proveedor/.test(x));
  const questions=essentials.length?essentials:missing;
  return {answer:description+`\n\nPara preparar ${pc?'el pedido':'la solicitud'}, me falta:\n${questions.map(q=>'• '+q).join('\n')}\n\n${!pc&&!v.price?'La solicitud puede ir sin precio. ':''}Conservo lo que ya me pasaste. Antes de crear el documento te muestro el resumen para confirmar.`,evidence,trace};
 }

 const resolved=v.price?null:v.resolvedPrice;
 const proposal=await prepare(actor,{action,target:{sucursal:branch},header:{fechaEmision:v.emission,moneda:v.currency||resolved?.moneda.codigo||'ARS',...(pc?{proveedor:vendor.codigo,tienda:vendor.tienda,condicionPago:payment.codigo,...(v.buyer?{comprador:v.buyer}:{})}:{solicitante:v.requester,...(v.requestType?{tipoSolicitud:v.requestType}:{}),...(v.requesterCode?{solicitanteCodigo:v.requesterCode}:{})})},items:[{producto:product.codigo,deposito:v.warehouse,fechaNecesidad:v.due,cantidad:v.quantity,...(v.price?{precio:v.price,basePrecio}:resolved?{precio:resolved.precio,basePrecio:'unidad'}:{}),baseCantidad,...(v.costCenter?{centroCosto:v.costCenter}:{})}]});
 delete conversation.purchaseDraft;
 evidence.push({id:'P1',action:'preparar_alta',args:{accion:action},result:{kind:'proposal',proposal}});
 trace.push({action:'preparar_alta',status:'ok'});
 return {answer:description+(resolved?`\nPrecio tomado de la lista ${resolved.listaCodigo}: ${resolved.precio} ${resolved.moneda.descripcion||resolved.moneda.codigo} por ${unit}.`:'')+`\n\nPreparé ${pc?'un pedido de compra NUEVO':'una solicitud NUEVA'} desde cero. Revisá el resumen antes de confirmar. No se creó ningún documento. `+(proposal.approval?.label||''),evidence,trace};
}

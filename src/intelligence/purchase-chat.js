import {assert} from '../errors.js';
import {literalAttachmentIntent} from './attachment-chat.js';
import {importDate} from './purchase-imports.js';
import {importedNumber} from './document-reader.js';

const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const number='(\\d+(?:[.,]\\d+)?)';
const quantity=new RegExp('\\b'+number+'\\s*(unidad(?:es)?|un|millar(?:es)?|kg|g|mt|m|lt|l)\\b','i');
const price=new RegExp('(?:\\bprecio\\s*(?:es|de|a|:)?\\s*|\\ba\\s+)'+number+'(?:\\s*(?:pesos?|d[oó]lares?|ars|usd))?\\s*(?:por\\s+(unidad|millar|kg|g|mt|m|lt|l))?','i');
const codePattern=/\b(?:producto|articulo|codigo)\s+(?:es\s+|codigo\s+)?([a-z0-9][a-z0-9_./-]*)(?=\s|[,;!?]|$)/i;
function extract(text){
 const n=norm(text),literal=literalAttachmentIntent(text),values={};
 for(const key of ['currency','warehouse','requester','requesterCode','requestType','costCenter'])if(literal[key])values[key]=literal[key];
 for(const key of ['emission','due'])if(literal[key])values[key]=importDate(literal[key]);
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'});
 if(/\bemision\s+(?:para\s+)?hoy\b/.test(n))values.emission=today;
 if(/\b(?:necesidad|entrega)\s+(?:para\s+)?hoy\b/.test(n))values.due=today;
 const product=codePattern.exec(n);
 if(product&&!['de','del','el','nuevo','que','con','solicitante','comprador'].includes(product[1]))values.product=product[1].replace(/[.]$/,'').toUpperCase();
 const q=quantity.exec(text),explicitQuantity=new RegExp('\\bcantidad\\s*(?:es|de|:)?\\s*'+number,'i').exec(text);
 if(q){values.quantity=importedNumber(q[1]);values.quantityUnit=norm(q[2]);}
 else if(explicitQuantity)values.quantity=importedNumber(explicitQuantity[1]);
 const p=price.exec(text);if(p&&(p[2]||/^precio/i.test(p[0])||/\b(?:pesos?|d[oó]lares?|ars|usd)\b/i.test(p[0]))){values.price=importedNumber(p[1]);if(p[2])values.priceUnit=norm(p[2]);}
 const priceBasis=/\bpor (unidad|millar|kg|g|mt|m|lt|l)\b/.exec(n);
 if(priceBasis)values.priceUnit=priceBasis[1];
 const quantityBasis=/\bcantidades?\s+(?:en\s+)?(unidades|millares|kg|g|mt|m|lt|l)\b/.exec(n);
 if(quantityBasis)values.quantityUnit=quantityBasis[1];
 return values;
}

// A bounded, single-item intake avoids repeated inference for explicit references.
// Values remain user input, never executed SQL or instructions from an ERP row.
export async function purchaseChat({text,conversation,branch,canPlan,authorizePlan,read,prepare,actor}){
 const n=norm(text),start=/\b(crea(?:r|me)?|genera(?:r|me)?|arma(?:r|me)?)\b/.test(n)&&/\bsolicitud(?: de)? (?:compra|importacion)\b/.test(n);
 let state=conversation.purchaseDraft;
 const values=extract(text);
 if(/\bno\b|\b(?:solo|solamente)\s+consult/.test(n)){delete conversation.purchaseDraft;return null;}
 if(/\b(cancelar|cancela|cancelalo|olvidalo)\b/.test(n)&&state){delete conversation.purchaseDraft;return {answer:'Descarté los datos de esta solicitud. No se creó ningún documento.',evidence:[],trace:[]};}
 // Do not turn a multi-item or another business operation into a single item.
 if(/\bproductos\b|\b(?:pedido|factura|venta|lista)\b/.test(n)||(n.match(/\bproducto\b/g)||[]).length>1||/\bproducto\s+\S+\s+(?:y|e|,)\s*\d/.test(n)){
  delete conversation.purchaseDraft;return null;
 }
 if(start&&!values.product)return null;
 if(!start&&(!state||state.branch!==branch||!Object.keys(values).length)){delete conversation.purchaseDraft;return null;}
 assert(canPlan&&prepare,403,'ROL_INSUFICIENTE','Tu rol no permite preparar solicitudes de compra.');
 await authorizePlan?.('crearSolicitudCompra');
 if(start)state={branch,values:{}};
 state.values={...state.values,...values};
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
 const description=`Producto verificado en SB1: ${product.codigo} — ${product.nombre||'sin descripción'}. Tipo: ${product.tipo?.descripcion||product.tipo?.codigo||'no informado'}. Unidad: ${unit||'no informada'}.`;
 const blocked=String(product.bloqueado?.codigo??product.bloqueado??'');
 if(blocked==='1'){delete conversation.purchaseDraft;return {answer:description+' Está bloqueado; no preparé el alta.',evidence,trace};}
 const basis=(value,isQuantity)=>{
  if(!value)return '';
  if(/^millar(?:es)?$/.test(value))return unit==='UN'?(isQuantity?'millares':'millar'):'';
  if(/^(unidad(?:es)?|un)$/.test(value)&&unit==='UN'||value.toUpperCase()===unit)return isQuantity?'unidades':'unidad';
  return '';
 };
 const baseCantidad=basis(v.quantityUnit,true),basePrecio=basis(v.priceUnit,false);
 const missing=[];
 if(!v.quantity)missing.push(`cantidad en ${unit||'la unidad de SB1'}${unit==='UN'?' o millares':''}`);
 else if(!baseCantidad)missing.push(`confirmar la base de cantidad: ${unit||'unidad de SB1'}${unit==='UN'?' o millares':''}`);
 if(!v.price)missing.push('precio');
 if(!v.currency)missing.push('moneda');
 if(!basePrecio)missing.push(`confirmar si el precio es por ${unit||'unidad'}${unit==='UN'?' o por millar':''}`);
 if(!v.warehouse)missing.push(`depósito${product.depositoPredeterminado?` (SB1 indica ${product.depositoPredeterminado}; podés elegirlo)` :''}`);
 if(!v.emission)missing.push('fecha de emisión');
 if(!v.due)missing.push('fecha de necesidad');
 if(!v.requester)missing.push('solicitante');
 if(v.currency&&v.currency!=='ARS'&&v.currency!=='1'&&!v.requestType)missing.push('confirmar si corresponde una solicitud de importación (MATA113)');
 if(v.warehouse){
  const result=await query('depositos',{codigo:v.warehouse});
  if(result.data?.length!==1||result.meta?.hasMore){delete v.warehouse;missing.push('un depósito válido');}
 }
 conversation.purchaseDraft=state;
 if(missing.length)return {answer:description+`\n\nVamos a crear una solicitud nueva. Falta ${missing.join('; ')}. ¿Me pasás esos datos? Podés responder en un solo mensaje; conservo lo ya indicado.\n\nAntes de crearla te mostraré el resumen para confirmar.`,evidence,trace};
 const proposal=await prepare(actor,{action:'crearSolicitudCompra',target:{sucursal:branch},header:{fechaEmision:v.emission,solicitante:v.requester,moneda:v.currency,...(v.requestType?{tipoSolicitud:v.requestType}:{}),...(v.requesterCode?{solicitanteCodigo:v.requesterCode}:{})},items:[{producto:product.codigo,deposito:v.warehouse,fechaNecesidad:v.due,cantidad:v.quantity,precio:v.price,baseCantidad,basePrecio,...(v.costCenter?{centroCosto:v.costCenter}:{})}]});
 delete conversation.purchaseDraft;
 evidence.push({id:'P1',action:'preparar_alta',args:{accion:'crearSolicitudCompra'},result:{kind:'proposal',proposal}});
 trace.push({action:'preparar_alta',status:'ok'});
 return {answer:description+'\n\nPreparé una solicitud NUEVA desde cero. Revisá el resumen antes de confirmar. No se creó ningún documento. '+(proposal.approval?.label||''),evidence,trace};
}

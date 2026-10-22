import {assert} from '../errors.js';
import {validatedOutput} from './model-contract.js';
import {referenceCorrections,referencePending,referenceClarificationSchema,referenceClarificationMessages,invalidateReferenceContext,unresolvedReference} from './reference-corrections.js';
import {conversationContext} from './memory.js';

const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const labels={product:'producto',customer:'cliente',order:'pedido',list:'lista'};
const words={product:'producto|articulo',customer:'cliente',order:'pedido|orden',list:'lista'};
// Persist only pending user references, never historical amounts or permissions.
export function markReferenceResolution(conversation,reply,branch){
 const state=conversation.referenceValidation?.byBranch?.[branch];if(!state||reply.accessDenied)return;
 for(const [kind,term] of Object.entries(state.pending)){
  if(!term)continue;
  const resource=kind==='product'?'productos':kind==='customer'?'clientes':kind==='order'?null:'listasPrecios';
  const confirmed=(reply.evidence||[]).some(e=>{
   const name=e.args?.recurso,filters=e.args?.filtros||{},rows=e.result?.data;
   if(kind==='order'?!['itemsVentas','compras'].includes(name):kind==='list'?!name?.startsWith(resource):name!==resource)return false;
   const scope=state.scopes?.[kind]||{};
   if(kind==='order'&&(!scope.orderType||name!==(scope.orderType==='venta'?'itemsVentas':'compras')))return false;
   if(kind==='list'&&(!scope.listType||name!==(scope.listType==='supplier'?'listasPreciosProveedores':'listasPreciosClientes')))return false;
   if(kind==='list'&&scope.listType==='supplier'&&(scope.party&&filters.proveedor!==scope.party||scope.shop&&filters.tienda!==scope.shop))return false;
   if(kind==='customer'&&scope.shop&&filters.tienda!==scope.shop)return false;
   if(rows?.length!==1||e.result.meta?.hasMore)return false;
   const requested=kind==='order'?filters.numero:filters.codigo||filters.q||e.args.texto;
   return typeof requested==='string'&&(norm(requested)===norm(term)||kind==='order'&&/^\d+$/.test(term)&&/^\d+$/.test(requested)&&BigInt(term)===BigInt(requested));
  });
  if(confirmed)delete state.pending[kind];
 }
}
export function referenceContext(conversation,branch,text=''){
 const scoped=state=>state?.branch===branch;
 const current=scoped(conversation.businessContext)?conversation.businessContext:null;
 const paused=scoped(conversation.pausedBusiness)?conversation.pausedBusiness:null;
 const resuming=/\b(?:correct[oa]|no es|no uses|descarta|usa|retoma\w*|continua\w*|prepara\w*|confirma\w*)\b/.test(norm(text));
 const business=paused&&resuming&&Object.entries(words).some(([kind,word])=>new RegExp(`\\b(?:${word})\\b`).test(norm(text))&&(paused.refs?.[kind==='order'?'number':kind]!==undefined||paused.unresolvedReferences?.includes(kind==='order'?'number':kind)))?paused:current;
 const remembered=conversation.referenceValidation?.byBranch?.[branch];
 const purchase=[conversation.purchaseDraft,conversation.pausedPurchase].find(s=>scoped(s));
 const known={...business?.refs,...(purchase?.values.product?{product:purchase.values.product}:{})};
 if(scoped(conversation.productJourney))known.product=conversation.productJourney.code;
 if(scoped(conversation.customerJourney))known.customer=conversation.customerJourney.code;
 if(scoped(conversation.salesOrderJourney))known.order=conversation.salesOrderJourney.code;
 if(known.number)known.order=known.number;
 const type=[...norm(text).matchAll(/\bpedido(?: de)?\s+(venta|compra)\b/g)].at(-1)?.[1];
 const orderType=type||(/^\s*(?:de |es de |el de )?(?:venta|compra)[.!?]*\s*$/.test(norm(text))?norm(text).includes('compra')?'compra':'venta':undefined)||(['sale','purchase'].includes(business?.kind)?business.kind==='sale'?'venta':'compra':scoped(conversation.salesOrderJourney)?'venta':remembered?.scopes?.order?.orderType);
 const listType=/\bproveedor(?:es)?\b/.test(norm(text))?'supplier':/\bclientes?\b/.test(norm(text))?'customer':business?.kind==='supplierList'?'supplier':['saleList','salePrice'].includes(business?.kind)||scoped(conversation.customerJourney)?'customer':remembered?.scopes?.list?.listType;
 return {known,activeKinds:Object.keys(labels).filter(k=>known[k]!==undefined||business?.unresolvedReferences?.includes(k==='order'?'number':k)||Object.hasOwn(remembered?.pending||{},k)),orderType,listType,shop:business?.refs.shop||remembered?.scopes?.list?.shop,party:business?.refs.vendor||remembered?.scopes?.list?.party,purchase,business};
}
function resources(kind,scope){return kind==='product'?['productos']:kind==='customer'?['clientes']:kind==='order'?(scope.orderType?[scope.orderType==='venta'?'itemsVentas':'compras']:[]):!scope.listType?[]:scope.listType==='supplier'?['listasPreciosProveedores','preciosProveedores']:['listasPreciosClientes','preciosClientes'];}
const answer=(text,evidence=[],extra={})=>({answer:text,evidence,trace:[],...extra});
// Preflight shares the existing permissions and source readers. It only resolves
// identities or asks a bounded clarification; all mutations use normal intakes.
export async function referenceChat({text,conversation,history,branch,read,authorizeRead=()=>{},authorizePlan,canPlan,prepare,model,schema,metadata,singleBranch=false}){
 const scope=referenceContext(conversation,branch,text);
 const changes=referenceCorrections(text,scope);
 const validation=conversation.referenceValidation?.byBranch?.[branch];
 if(validation?.pending?.customer&&/^\s*tienda\s+\S+[.!?]*\s*$/i.test(text))changes.customer={replacement:validation.pending.customer};
 if(validation?.pending?.order&&/^\s*(?:(?:de |es de )?(?:venta|compra)|[ií]tem\s+\S+)[.!?]*\s*$/i.test(text))changes.order={replacement:validation.pending.order};
 if(validation?.pending?.list&&/^\s*(?:de |es de |para )?(?:clientes|proveedores)[.!?]*\s*$/i.test(text))changes.list={replacement:validation.pending.list};
 const changed=Object.keys(changes);
 // Unlabelled supplier corrections stay on their mature, separate route.
 if(!/\b(?:producto|articulo|cliente|pedido|orden|lista)\b/.test(norm(text))&&(scope.party||scope.purchase?.values.party||scope.purchase?.unresolvedReferences?.includes('party')||scope.business?.kind==='vendor'))return null;
 const pending=referencePending([...history,{role:'user',content:text}],scope);
 for(const kind of Object.keys(validation?.pending||{})){
  if(changes[kind]?.replacement)continue;
  const alias=new RegExp(`\\b(?:${words[kind]})\\s+(?:(?:de|del|el|la|ese|esa)\\s+)*(?:anterior|antes|mism[oa]|ese|esa|correct[oa])\\b|\\b(?:ese|esa|este|esta|mism[oa]|anterior)\\s+(?:${words[kind]})\\b`).test(norm(text));
  const bare=scope.activeKinds.includes(kind)&&/^(?:(?:usa|mostrame|consulta|retoma)\s+)?(?:ese|esa|el mismo|la misma|el de antes|la de antes)[.!?]*$/.test(norm(text));
  const implicit=/\b(?:prepara\w*|confirma\w*|retoma\w*|continua\w*|baja\w*|subi\w*|ajusta\w*|cambia\w*|actualiza\w*|modifica\w*|aumenta\w*|incrementa\w*|reduci\w*|deja\w*)\b/.test(norm(text))&&!/\b(?:informe|resumen|dashboard|reporte|proyecto|calidad)\b/.test(norm(text))&&!Object.keys(words).some(k=>new RegExp(`\\b(?:${words[k]})\\s+(?!anterior\\b|de antes\\b|ese\\b|esa\\b)[a-z0-9_-]+`).test(norm(text)));
  if(alias||bare||implicit)pending[kind]={rejected:true};
 }
 const n=norm(text),write=/\b(?:cambia\w*|modifica\w*|actualiza\w*|subi\w*|baja\w*|prepara\w*|crea\w*|arma\w*|confirma\w*)\b/.test(n);
 const kinds=[...new Set([...changed,...Object.keys(pending)])];
 if(!kinds.length)return null;
 for(const kind of kinds)for(const resource of resources(kind,scope))await authorizeRead(resource,branch);
 if(write){
  const action=scope.purchase?.action||({sale:'pedidoVenta',purchase:'pedidoCompra',request:'solicitudCompra',salePrice:'precioLista',saleList:'precioLista',supplierList:'precioListaProveedor'}[scope.business?.kind]);
  assert(canPlan&&prepare,403,'ROL_INSUFICIENTE','Tu rol no permite preparar cambios.');
  if(action)await authorizePlan?.(action);
 }
 if(changed.length){
  conversation.referenceValidation||={byBranch:{}};
  conversation.referenceValidation.byBranch||={};
  const state=conversation.referenceValidation.byBranch[branch]||={pending:{},scopes:{}};
  for(const kind of changed){state.pending[kind]=changes[kind].replacement||null;state.scopes[kind]={...(state.scopes[kind]||{}),...(kind==='customer'?{shop:/\btienda\s+([a-z0-9_-]+)/i.exec(text)?.[1]}:{}),...(kind==='order'&&scope.orderType?{orderType:scope.orderType}:{}),...(kind==='list'&&scope.listType?{listType:scope.listType,party:scope.party,shop:scope.shop}:{})};}
 }
 // Both rejection and affirmative correction invalidate old dependent rows.
 invalidateReferenceContext(conversation,Object.fromEntries(changed.map(k=>[k,{rejected:true}])),{branch});
 if(Object.keys(pending).length){
  const narrowed=referenceClarificationSchema(schema,Object.keys(pending),scope);assert(narrowed,502,'IA_RESPUESTA_INVALIDA','No pude preparar la aclaración.');
  const recalled=conversationContext(conversation,text,branch,{singleBranch,budget:4000});
  const messages=referenceClarificationMessages([{role:'system',content:'Sos Central de Argentina. Preguntá sólo la referencia pendiente con el JSON del esquema. No se verificaron datos actuales ni se prepararon operaciones en este turno.'},...recalled,{role:'user',content:text}],Object.keys(pending));
  const decision=validatedOutput(await model.complete(messages,narrowed,{maxInputChars:24000,maxOutputTokens:384,timeoutMs:60000}),narrowed);
  return answer(decision.answer,[],{model:model.name,local:model.local!==false,referenceClarification:true});
 }
 // Existing drafts must keep their normal proposal/confirmation pipeline. Their
 // parser receives the original correction, not invented canonical values.
 if(scope.purchase&&changed.some(kind=>kind==='product'||kind==='list')||scope.business?.pending||write){
  if(!conversation.purchaseDraft&&scope.purchase===conversation.pausedPurchase){conversation.purchaseDraft=conversation.pausedPurchase;delete conversation.pausedPurchase;}
  if(scope.business===conversation.pausedBusiness){conversation.businessContext=conversation.pausedBusiness;delete conversation.pausedBusiness;}
  return {continueIntake:true,changes};
 }
 const replacements=changed.filter(k=>changes[k].replacement&&!unresolvedReference(changes[k].replacement,k));
 if(!replacements.length)return null;
 const evidence=[],lines=[];
 const query=async(resource,filters)=>{await authorizeRead(resource,branch);const result=await read(resource,new URLSearchParams({sucursal:branch,limit:'2',...filters}));
  for(const [filter,field] of Object.entries({codigo:'codigo',numero:'numero',item:'item',lista:'listaCodigo'}))if(filters[filter])assert((result.data||[]).every(row=>norm(row[field])===norm(filters[filter])),409,'REFERENCIA_NO_VERIFICADA','La fuente no devolvió la identidad que pediste; no usé otra referencia.');
  if(filters.tienda&&['clientes','proveedores'].includes(resource))assert((result.data||[]).every(row=>row.tienda===filters.tienda),409,'REFERENCIA_NO_VERIFICADA','No pude verificar esa tienda.');
  evidence.push({id:'F'+(evidence.length+1),action:'consultar_erp',args:{recurso:resource,filtros:filters},result});return result;};
 const find=async(resource,term,extra={})=>{let r=await query(resource,{codigo:term,...extra});if(!r.data?.length&&term.length>1)r=await query(resource,{q:term,...extra});return r;};
 const pad=(resource,field,value)=>{const size=Number(metadata?.entities?.[resource]?.fields?.find(f=>f.salida===field)?.diccionario?.X3_TAMANHO);return /^\d+$/.test(value)&&Number.isInteger(size)&&size>0&&size<=32?value.padStart(size,'0'):value;};
 for(const kind of replacements){
  const term=changes[kind].replacement;let r,identity;
  if(kind==='product'){
   r=await find('productos',term);
   if(r.data?.length===1&&!r.meta?.hasMore){identity=r.data[0];conversation.businessContext={branch,kind:'product',refs:{product:identity.codigo},pending:null};lines.push(`Producto verificado en SB1: ${identity.codigo} · ${identity.nombre||'sin descripción'}. Unidad: ${identity.unidadMedida||'sin informar'}.`);}
  }else if(kind==='customer'){
   const shop=/\btienda\s+([a-z0-9_-]+)/i.exec(text)?.[1];r=await find('clientes',term,shop?{tienda:shop}:{});
   if(r.data?.length===1&&!r.meta?.hasMore){identity=r.data[0];conversation.businessContext={branch,kind:'customer',refs:{customer:identity.codigo,shop:identity.tienda},pending:null};lines.push(`Cliente verificado: ${identity.codigo} / tienda ${identity.tienda} · ${identity.nombre||'sin nombre'}. Lista asignada en el ERP: ${identity.listaPreciosCodigo||'sin lista asignada'}.`);}
  }else if(kind==='order'){
   if(!scope.orderType)return answer('¿El pedido correcto es de venta o de compra? Conservo los demás datos.',evidence);
   const resource=scope.orderType==='venta'?'itemsVentas':'compras',code=pad(resource,'numero',term),item=/\bitem\s+([a-z0-9_-]+)/i.exec(n)?.[1];
   r=await query(resource,{numero:code,...(item?{item:pad(resource,'item',item)}:{})});
   if(r.data?.length===1&&!r.meta?.hasMore&&r.data[0].numero===code){identity=r.data[0];conversation.businessContext={branch,kind:scope.orderType==='venta'?'sale':'purchase',refs:{number:identity.numero,item:identity.item},pending:null};lines.push(`Pedido de ${scope.orderType} verificado: ${identity.numero}, ítem ${identity.item}. Producto: ${identity.productoCodigo||'sin código informado'}.`);}
  }else{
   if(!scope.listType)return answer('¿La lista de precios correcta es de clientes o de proveedores? Conservo el código que me pasaste.',evidence);
   const supplier=scope.listType==='supplier',resource=supplier?'listasPreciosProveedores':'listasPreciosClientes',extra=supplier?{...(scope.party?{proveedor:scope.party}:{}),...(scope.shop?{tienda:scope.shop}:{})}:{};
   r=await find(resource,term,extra);
   if(r.data?.length===1&&!r.meta?.hasMore){identity=r.data[0];const details=await query(supplier?'preciosProveedores':'preciosClientes',{lista:identity.codigo,...extra});
    if(details.data?.some(row=>row.listaCodigo!==identity.codigo))return answer('No pude verificar que los precios pertenezcan a esa lista. No preparé cambios.',[]);
    conversation.businessContext={branch,kind:supplier?'supplierList':'saleList',refs:{list:identity.codigo,...(supplier?{vendor:scope.party,shop:scope.shop}:{})},pending:null};lines.push(`Lista de precios verificada: ${identity.codigo} · ${identity.nombre||'sin nombre'}. Los precios actuales están en la fuente adjunta.`);}
  }
  if(!identity)return answer(`No identifiqué de forma única ${labels[kind]==='lista'?'la lista': 'el '+labels[kind]}. Indicame el código${kind==='customer'?' y la tienda':''} correcto; no voy a usar el anterior.`,evidence);
 }
 return answer(lines.join('\n\n'),evidence,{referenceCorrection:true});
}

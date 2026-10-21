import {supplierPrice} from './order-list-price.js';
import Decimal from 'decimal.js';
import {assert} from '../errors.js';
import {purchaseValues} from './purchase-chat.js';
import {priceCommand,priceWriteIntent,preparePriceCommand,requestedPriceBase} from './price-commands.js';
import {assertPriceCurrency} from './references.js';
import {createBusinessTools} from './tools.js';

const D=Decimal.clone({precision:50});
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const kinds={
 product:{resource:'productos',title:'Producto'},
 customer:{resource:'clientes',title:'Cliente',action:'clienteContacto'},
 vendor:{resource:'proveedores',title:'Proveedor',action:'proveedorContacto'},
 sale:{resource:'itemsVentas',title:'Pedido de venta',action:'pedidoVenta',order:true},
 purchase:{resource:'compras',title:'Pedido de compra',action:'pedidoCompra',order:true},
 request:{resource:'solicitudesCompra',title:'Solicitud de compra',action:'solicitudCompra',order:true},
 saleList:{resource:'preciosClientes',title:'Lista de venta',action:'precioLista'},
 supplierList:{resource:'preciosProveedores',title:'Lista de proveedor',action:'precioListaProveedor'},
 salePrice:{resource:'preciosClientes',title:'Precio de venta',action:'precioLista'}
};
const identifier=row=>Object.fromEntries(['registro','codigo','tienda','numero','item','productoCodigo','listaCodigo','proveedorCodigo','proveedorTienda','clienteCodigo','clienteTienda'].filter(k=>row[k]!=null).map(k=>[k,String(row[k])]));
const sameIdentity=(row,identity)=>Object.entries(identity).every(([k,v])=>String(row[k])===v);
const label=row=>[row.codigo||row.numero||row.productoCodigo,row.tienda&&'tienda '+row.tienda,row.item&&'ítem '+row.item,row.nombre||row.descripcion,row.listaCodigo&&'lista '+row.listaCodigo].filter(Boolean).join(' · ');
function reference(text,word){
 const re=new RegExp('\\b'+word+'\\s+(?:(?:de(?:l)?|es|codigo)\\s+)?(.+?)(?=\\s+(?:a|en|un|una)\\s+\\d|\\s+(?:tienda|item|producto|articulo|cliente|proveedor|lista|cantidad|precio|por|con|para)\\b|[;!?]|$)','i');
 const value=re.exec(text)?.[1]?.trim().replace(/^["“]|["”.,]+$/g,'').replace(/\s+de(?:l)?$/i,'');
 return value&&!/^(?:de|del|precio|precios|venta|compra|proveedor|cliente|actual|ese|esa|este|esta|el|la)$/i.test(value)?value:undefined;
}
function parse(text,state){
 const n=norm(text),values=purchaseValues(text),refs={};
 let kind;
 if(/\bpedido(?:s)?(?: de)? venta\b|\bsc6\b/.test(n))kind='sale';
 else if(/\bpedido(?:s)?(?: de)? compra\b|\bsc7\b/.test(n))kind='purchase';
 else if(/\bsolicitud(?:es)?(?: de)? compra\b|\bsc1\b/.test(n))kind='request';
 else if(/\bpedidos?\b/.test(n))kind=state&&kinds[state.kind]?.order?state.kind:'order';
 else if(state?.kind==='order'&&/^(?:de )?(compra|venta)[.!]?$/.test(n))kind=n.includes('compra')?'purchase':'sale';
 const pricing=/\b(precios?|listas?|listados?)\b|\ba cuan[td]o\b|\b(?:vendemos|vendiendo|vale|cuesta)\b/.test(n);
 if(!kind&&pricing)kind=/\bproveedor(?:es)?\b|\baib\b/.test(n)?'supplierList':/\blistas?\b/.test(n)?'saleList':'salePrice';
 if(pricing&&state?.kind==='vendor'&&!/\bcliente\b/.test(n))kind='supplierList';
 if(!kind&&/\bproveedor\b/.test(n))kind=state&&['supplierList','purchase'].includes(state.kind)?state.kind:'vendor';
 if(!kind&&/\bcliente\b/.test(n))kind=state&&['saleList','salePrice','sale'].includes(state.kind)?state.kind:'customer';
 if(!kind&&/\b(producto|articulo)\b/.test(n))kind=state&&(kinds[state.kind]?.order||['saleList','salePrice','supplierList'].includes(state.kind))?state.kind:'product';
 if(kind==='salePrice'&&state&&['purchase','sale','request','supplierList','saleList'].includes(state.kind)&&!/\bventa\b|\blistas?\b|\bproveedor\b/.test(n))kind=state.kind;
 for(const [key,word] of [['product','(?:producto|articulo)'],['customer','cliente'],['vendor','proveedor']]){
  const value=reference(text,word);if(value)refs[key]=value;
 }
 // Bare finished-product codes are also references, never a group classification.
 const z=[...text.matchAll(/\bZ[A-Z0-9_/-]*\d[A-Z0-9_/-]*\b/ig)];
 if(!refs.product&&z.length===1)refs.product=z[0][0].toUpperCase();
 const list=reference(text,'lista(?: de precios)?');
 if(list&&!/^(?:proveedor|cliente|precios|de precios|de venta|de compra)\b/i.test(list))refs.list=list;
 const order=/\b(?:pedido|solicitud)(?: de (?:venta|compra))?\s*(?:n(?:ro|umero)?[°º.]?\s*)?(\d+)\b/.exec(n);
 if(order)refs.number=order[1];
 for(const [key,re] of [['shop',/\btienda\s+([a-z0-9_-]+)/i],['item',/\b[ií]tem\s+([a-z0-9_-]+)/i]]){const m=re.exec(text);if(m)refs[key]=m[1];}
 const listIntent=/\b(usa|usar|utiliza|utilizar|aplica|aplicar|toma|tomar|actualiza)\b/.test(n)&&/\blista\b/.test(n);
 if(listIntent&&state&&kinds[state.kind]?.order&&!/pedido(?: de)? (compra|venta)/.test(n))kind=state.kind;
 const write=listIntent||priceWriteIntent(text)||/\b(subilo|bajalo|aumentalo|reducilo)\b/.test(n);
 const percent=/(\d+(?:[.,]\d+)?)\s*(?:%|por ciento)/.exec(n);
 const edits={};if(listIntent)edits.useList=true;
 if(values.price!==undefined)edits.price=values.price;
 if(values.priceUnit)edits.priceUnit=values.priceUnit;
 if(values.quantity!==undefined)edits.quantity=values.quantity;
 if(values.quantityUnit)edits.quantityUnit=values.quantityUnit;
 if(values.currency)edits.currency=values.currency;
 if(percent&&write){edits.percent=percent[1].replace(',','.');edits.direction=/\b(baja|bajame|bajalo|reduci|reducime|reduce|reducilo|descuento)\b/.test(n)?-1:1;delete edits.price;}
 const absolute=/\b(?:a|en)\s+(\d+(?:[.,]\d+)?)(?![\d.,])/.exec(n);
 if(write&&!percent&&absolute&&!/\bcantidad\b/.test(n))edits.price=absolute[1].replace(',','.');
 for(const field of ['email','telefono','contacto']){
  const pattern=field==='email'?/\b(?:email|correo)\s+(?:a\s+)?([^\s;,]+@[^\s;,]+)/i:new RegExp('\\b'+(field==='telefono'?'tel[eé]fono':'contacto')+'\\s+(?:a\\s+)?([^;\\n]+)','i');
  const m=pattern.exec(text);if(m)edits[field]=m[1].trim();
 }
 return {kind,refs,edits,write};
}

export async function businessChat({text,conversation,branch,read,executeRead,kaiqen,metadata,prepare,authorizePlan,canPlan,actor}){
 const n=norm(text);
 if(/\b(recorda|recordar|recuerda|aprende|clasifica|llamamos|guarda)\b/.test(n))return null;
 if(/\b(crea(?:r|me)?|genera(?:r|me)?|arma(?:r|me)?)\b/.test(n))return null;
 let old=conversation.businessContext;
 if(old?.branch!==branch){delete conversation.businessContext;old=null;}
 if(/\b(cancelar|cancela|cancelalo|olvidalo)\b/.test(n)&&old){delete conversation.businessContext;return {answer:'Descarté el cambio pendiente de esta conversación. No se modificó el ERP.',evidence:[],trace:[]};}
 if(/\b(resumen|dashboard|facturas?|remitos?|ventas del|compras del|total vendido|stock|costos?|calidad|proyecto)\b/.test(n)){delete conversation.businessContext;return null;}
 if(/\b(no|nunca|sin)\s+(?:lo\s+|me\s+)?(?:cambi|modifi|actuali|ajust|sub|baj)|\b(simula|simular|que pasaria)\b/.test(n)){delete conversation.businessContext;return null;}
 const parsed=parse(text,old);
 // Non-explicit references continue through the general reasoning tools.
 if(!old&&['salePrice','saleList'].includes(parsed.kind)&&!Object.keys(parsed.refs).length&&!/^(?:precio(?: de venta)?|lista(?: de precios)?)[?!.]?$/.test(n))return null;
 if(!old&&/precio de lista de\b/.test(n)&&!parsed.refs.product)return null;
 // Keep the mature DA1 bulk-price route and its validations.
 if(priceCommand(text,conversation.messages,branch,true)&&!['purchase','sale','request','supplierList'].includes(parsed.kind||old?.kind))return null;
 const ordinal=/\b(?:el|la)\s+(primero|primera|segundo|segunda|tercero|tercera)\b/.exec(n);
 const follow=old&&(Object.keys(parsed.edits).length||Object.keys(parsed.refs).length||/\b(ese|esa|este|esta|su|lo mismo|verlo|verla|confirmar|confirmo)\b/.test(n)||ordinal);
 if(!parsed.kind&&!follow){delete conversation.businessContext;return null;}
 const kind=parsed.kind||old.kind;
 if(!kinds[kind]&&kind!=='order')return null;
 const changed=old&&kind!==old.kind&&!(old.kind==='order'&&['sale','purchase'].includes(kind));
 const inherited=changed&&old.kind==='product'&&['salePrice','saleList'].includes(kind)?{product:old.refs.product}
  :changed&&old.kind==='vendor'&&kind==='supplierList'?{vendor:old.refs.vendor,shop:old.refs.shop}
  :changed&&old.kind==='customer'&&['saleList','salePrice'].includes(kind)?{customer:old.refs.customer,shop:old.refs.shop}:{};
 const state=old&&!changed?old:{branch,kind,refs:inherited,pending:null};
 state.kind=kind;
 const explicitTarget=Object.entries(parsed.refs).some(([k,v])=>state.refs[k]!==undefined&&state.refs[k]!==v);
 if(explicitTarget){delete state.selected;delete state.candidates;if(!parsed.write)state.pending=null;}
 Object.assign(state.refs,parsed.refs);
 if(parsed.write)state.pending={...parsed.edits};
 else if(state.pending)Object.assign(state.pending,parsed.edits);
 state.base=parsed.edits.priceUnit||state.base;
 if(ordinal&&state.candidates){
  const index={primero:0,primera:0,segundo:1,segunda:1,tercero:2,tercera:2}[ordinal[1]];
  const candidate=state.candidates[index];
  if(candidate){
   if(state.candidateRef){state.refs[state.candidateRef]=candidate.codigo;if(['vendor','customer'].includes(state.candidateRef))state.refs.shop=candidate.tienda;}
   else state.selected=candidate;
  }
 }
 conversation.businessContext=state;
 const evidence=[],trace=[],answer=message=>({answer:message,evidence,trace,priceBase:state.base});
 const add=(action,args,result)=>{evidence.push({id:'F'+(evidence.length+1),action,args,result});trace.push({action,status:'ok'});};
 const query=async(resource,filters,limit=25)=>{const result=await read(resource,new URLSearchParams({sucursal:branch,limit:String(limit),...filters}));add('consultar_erp',{recurso:resource,filtros:filters},result);return result;};
 const find=async(resource,term,extra={})=>{
  let r=await query(resource,{codigo:term,...extra});
  if(!r.data.length&&term.length>1)r=await query(resource,{q:term,...extra});
  return r;
 };
 const choose=(result,what,ref)=>{
  state.candidates=(result.data||[]).slice(0,25).map(identifier);
  state.candidateRef=ref;
  return answer(result.data?.length?`Encontré varias coincidencias de ${what}. ¿Cuál corresponde?\n${result.data.slice(0,10).map((r,i)=>`${i+1}. ${label(r)}`).join('\n')}${result.meta?.hasMore?'\nHay más resultados; precisá el código o filtro.':''}`:`No encontré ${what} con ese dato en esta sucursal. ¿Podés precisar el código o nombre?`);
 };
 if(kind==='order')return answer('¿El pedido es de compra o de venta? Conservo el número que indicaste.');
 const profile=kinds[kind],refs=state.refs;
 if(state.pending){
  assert(canPlan&&prepare,403,'ROL_INSUFICIENTE','Tu rol no permite preparar cambios.');
  if(!profile.action)return answer('Puedo verificar el producto en SB1, pero la modificación de su ficha no tiene un ejecutor habilitado. No modifiqué el ERP.');
  await authorizePlan?.(profile.action);
 }
 const numeric=(resource,key,value)=>{
  const size=Number(metadata.entities?.[resource]?.fields?.find(f=>f.salida===key)?.diccionario?.X3_TAMANHO);
  return /^\d+$/.test(value||'')&&Number.isInteger(size)&&size>0&&size<=20?value.padStart(size,'0'):value;
 };
 if(['product','customer','vendor'].includes(kind)){
  const key={product:'product',customer:'customer',vendor:'vendor'}[kind],term=refs[key];
  if(!term&&!state.selected)return answer(`¿Qué ${profile.title.toLowerCase()} querés consultar? Indicame código o nombre.`);
  const r=state.selected?.registro?await query(profile.resource,{registro:state.selected.registro}):await find(profile.resource,term,refs.shop&&kind!=='product'?{tienda:refs.shop}:{});
  if(r.data.length!==1||r.meta?.hasMore)return choose(r,profile.title.toLowerCase());
  const row=r.data[0];
  assert(!state.selected||sameIdentity(row,state.selected),409,'REFERENCIA_CAMBIADA','La identidad cambió desde la selección; consultala nuevamente.');
  refs[key]=row.codigo;if(row.tienda)refs.shop=row.tienda;
  state.selected=identifier(row);
  const description=kind==='product'?`Producto verificado en SB1: ${row.codigo} — ${row.nombre}. Tipo: ${row.tipo?.descripcion||row.tipo?.codigo||'no informado'}. Unidad: ${row.unidadMedida||'no informada'}.`:`${profile.title} verificado: ${label(row)}.${row.listaPreciosCodigo?' Lista de precios: '+row.listaPreciosCodigo+'.':''}`;
  if(!state.pending)return answer(description+' Los datos actuales están en la fuente adjunta.');
  const changes=Object.fromEntries(['email','telefono','contacto'].filter(k=>state.pending[k]!==undefined).map(k=>[k,state.pending[k]]));
  if(!Object.keys(changes).length)return answer(description+' ¿Qué dato querés cambiar? Para contactos puedo preparar email, teléfono o contacto; su ejecución sigue deshabilitada.');
  const proposal=await prepare(actor,{action:profile.action,target:{sucursal:branch,registro:String(row.registro)},changes});
  add('preparar_cambio',{accion:profile.action},{kind:'proposal',proposal});state.pending=null;
  return answer(description+' Preparé el resumen antes/después. Esta acción de contactos no tiene ejecutor habilitado; no se modificó el ERP.');
 }
 if(kind==='salePrice'||kind==='saleList'){
  if(refs.customer){
   const r=await find('clientes',refs.customer,refs.shop?{tienda:refs.shop}:{});
   if(r.data.length!==1||r.meta?.hasMore)return choose(r,'cliente','customer');
   assert(r.data[0].listaPreciosCodigo,409,'LISTA_NO_ASIGNADA','El cliente no tiene lista en A1_TABELA.');
   refs.customer=r.data[0].codigo;refs.shop=r.data[0].tienda;refs.list=r.data[0].listaPreciosCodigo;
  }
  if(refs.list){
   const r=await find('listasPreciosClientes',refs.list);
   if(r.data.length!==1||r.meta?.hasMore)return choose(r,'lista','list');
   refs.list=r.data[0].codigo;
  }
  if(!refs.product&&!refs.list)return answer('¿Qué producto, cliente o lista de precios querés consultar?');
  const tools=createBusinessTools({read,executeRead,kaiqen,branch,metadata});
  if(state.pending){
   const v=state.pending;
   if(v.price===undefined&&v.percent===undefined)return answer('Conservo el producto/lista. ¿Cuál es el precio nuevo o porcentaje?');
   const base=v.priceUnit||state.base;
   const synthetic=`${v.direction===-1?'Bajame':'Cambiame'} ${refs.product?'el producto '+refs.product:'la lista '+refs.list} ${refs.product&&refs.list?'en la lista '+refs.list:''} a ${v.percent!==undefined?v.percent+'%':v.price} ${v.currency||''}${base?' por '+base:''}`;
   const result=await preparePriceCommand({text:synthetic,args:{...(refs.product?{producto:refs.product}:{}),...(refs.list?{lista:refs.list}:{})},messages:[],branch,singleBranch:false,tools,read,metadata,prepare:p=>prepare(actor,p),addEvidence:add});
   if(evidence.some(e=>e.result.kind==='proposal'))state.pending=null;
   return answer(result.answer);
  }
  if(refs.product){
   const result=await tools.run('precio_venta',{producto:refs.product,...(refs.list?{lista:refs.list}:{})});add('precio_venta',{producto:refs.product,...(refs.list?{lista:refs.list}:{})},result);
   if(result.kind==='prices'){refs.product=result.product.codigo;const lists=[...new Set(result.data.map(r=>r.listaCodigo))];if(lists.length===1)refs.list=lists[0];state.base=requestedPriceBase(text)||(result.data.every(r=>r.productoCodigo.startsWith('Z')&&r.unidadMedida==='UN')?'millar':state.base);}
   return answer(result.answer||result.message||'No encontré precios para esa referencia.');
  }
  const result=await query(profile.resource,{lista:refs.list});
  return answer(`Lista ${refs.list}: ${result.data.length} precios en esta página${result.meta?.hasMore?'; hay más páginas':''}. Valores actuales del ERP; no se calculó un total global.`);
 }
 let filters={};
 if(profile.order){
  if(!refs.number&&!state.selected)return answer('¿Cuál es el número del documento existente?');
  if(refs.number)filters.numero=numeric(profile.resource,'numero',refs.number);
  if(refs.item)filters.item=numeric(profile.resource,'item',refs.item);
 }else{
  if(!refs.vendor)return answer('¿De qué proveedor es la lista?');
  const vendor=await find('proveedores',refs.vendor,refs.shop?{tienda:refs.shop}:{});
  if(vendor.data.length!==1||vendor.meta?.hasMore)return choose(vendor,'proveedor y tienda','vendor');
  refs.vendor=vendor.data[0].codigo;refs.shop=vendor.data[0].tienda;
  filters={proveedor:refs.vendor,tienda:refs.shop};
  if(refs.list){
   const list=await find('listasPreciosProveedores',refs.list,filters);
   if(list.data.length!==1||list.meta?.hasMore)return choose(list,'lista del proveedor','list');
   refs.list=list.data[0].codigo;filters.lista=refs.list;
  }
 }
 if(refs.product){
  const product=await find('productos',refs.product);
  if(product.data.length!==1||product.meta?.hasMore)return choose(product,'producto','product');
  refs.product=product.data[0].codigo;filters.producto=refs.product;
 }
 if(state.selected?.registro)filters.registro=state.selected.registro;
 let result=await query(profile.resource,filters,100),rows=result.data;
 if(state.selected)assert(rows.length===1&&sameIdentity(rows[0],state.selected),409,'REFERENCIA_CAMBIADA','Cambió la identidad seleccionada; consultá de nuevo.');
 if(!state.pending){
  state.candidates=rows.slice(0,25).map(identifier);
  delete state.candidateRef;
  if(rows.length===1&&!result.meta?.hasMore)state.selected=identifier(rows[0]);
  return answer(rows.length?`${profile.title} verificado: ${rows.length} ítems en esta página${result.meta?.hasMore?'; hay más páginas':''}. Revisá producto, moneda, precio y cantidades en la fuente. No se modificó el ERP.`:'No encontré registros con esos datos. Revisá número, proveedor o lista.');
 }
 const v=state.pending;
 if(!rows.length)return choose(result,profile.title.toLowerCase());
 const all=/\b(todos|todas|completa|completo)\b/.test(n)||kind==='supplierList'&&!!refs.list&&!refs.product;
 if(!all&&(rows.length!==1||result.meta?.hasMore))return choose(result,'ítem a modificar');
 if(all)for(let page=2;result.meta?.hasMore;page++){
  assert(page<=100,409,'ALCANCE_EXCEDIDO','Demasiados registros. Acotá el alcance.');
  result=await query(profile.resource,{...filters,page:String(page)},100);assert(result.data.length,409,'PAGINACION_INVALIDA','La paginación cambió.');rows.push(...result.data);
 }
 assert(new Set(rows.map(r=>String(r.registro))).size===rows.length,409,'REGISTROS_DUPLICADOS','La lectura contiene registros duplicados.');
 if(v.price===undefined&&v.percent===undefined&&v.quantity===undefined&&!v.useList)return answer('Conservo el documento y sus referencias. ¿Qué precio o cantidad querés cambiar?');
 const plans=[];
 for(const row of rows){
  const p=await query('productos',{codigo:row.productoCodigo},2);
  assert(p.data.length===1&&!p.meta?.hasMore&&p.data[0].codigo===row.productoCodigo,409,'PRODUCTO_NO_VERIFICADO','El producto no existe de forma única en SB1.');
  const unit=p.data[0].unidadMedida,base=value=>/^millar(?:es)?$/.test(value||'')?(unit==='UN'?'millar':null):/^(unidad(?:es)?|un)$/i.test(value||'')||value?.toUpperCase()===unit?'unidad':null;
  let price=v.price,priceUnit=base(v.priceUnit||state.base),quantityUnit=base(v.quantityUnit);
  if(v.currency)assertPriceCurrency(v.currency,row,assert);
  if(v.useList&&['sale','purchase'].includes(kind)){
   let selected;
   if(kind==='purchase'){
    const found=await supplierPrice({query,product:row.productoCodigo,vendor:row.proveedorCodigo,shop:row.proveedorTienda,list:refs.list,at:new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'})});
    if(!found.row)return answer(found.message);selected=found.row;
   }else{
    const tools=createBusinessTools({read,executeRead,kaiqen,branch,metadata,allowExplicitList:true});
    const args={producto:row.productoCodigo,cliente:row.clienteCodigo,tienda:row.clienteTienda,...(refs.list?{lista:refs.list}:{})};
    const priced=await tools.prices(args);add('precio_venta',args,priced);
    const eligible=priced.data?.filter(r=>r.aplicableSegunCampos)||[];
    if(priced.kind!=='prices'||eligible.length!==1||priced.meta?.hasMore)return answer(priced.message||'No encontré un precio único vigente. Indicá una lista o el precio acordado.');
    selected=eligible[0];
   }
   assert(String(selected.moneda?.codigo)===String(row.moneda?.codigo),409,'MONEDA_DISTINTA','La lista y el pedido tienen monedas distintas. No convertí el precio.');
   price=selected.precio;priceUnit='unidad';
  }

  if(v.percent!==undefined){
   assert(new D(v.percent).gt(0)&&!(v.direction===-1&&new D(v.percent).gte(100)),400,'PORCENTAJE_INVALIDO','Porcentaje fuera de rango.');
   const field=profile.order?'precioUnitario':'precio',scale=Number(metadata.entities?.[profile.resource]?.fields?.find(f=>f.salida===field)?.diccionario?.X3_DECIMAL);
   assert(Number.isInteger(scale)&&scale>=0&&scale<=12,409,'PRECISION_DESCONOCIDA','No pude verificar precisión SX3.');
   price=new D(row[field]).mul(new D(1).plus(new D(v.percent).mul(v.direction||1).div(100))).toDecimalPlaces(scale).toFixed();priceUnit='unidad';
  }
  if(price!==undefined&&!priceUnit)return answer(`Conservo el importe ${price}. ¿Es por ${unit} o por millar? No asumí una conversión.`);
  if(v.quantity!==undefined&&!quantityUnit)return answer(`Conservo la cantidad ${v.quantity}. ¿Está en ${unit} o en millares?`);
  const identity={producto:row.productoCodigo,moneda:String(row.moneda?.codigo||''),...(profile.order?{numero:row.numero,item:row.item,...(kind==='purchase'?{proveedor:row.proveedorCodigo,tienda:row.proveedorTienda}:kind==='sale'?{cliente:row.clienteCodigo,tienda:row.clienteTienda}:{})}:{lista:row.listaCodigo,proveedor:row.proveedorCodigo,tienda:row.proveedorTienda})};
  plans.push({row,input:{action:profile.action,target:{sucursal:branch,registro:String(row.registro)},changes:{...(price!==undefined?{[profile.order?'precioUnitario':'precio']:price}:{}),...(v.quantity!==undefined?{cantidadPedida:v.quantity}:{})},...(price!==undefined?{priceUnit}:{}),...(v.quantity!==undefined?{quantityUnit:quantityUnit==='millar'?'millares':'unidades',expectedQuantity:row.cantidadPedida}:{}),expectedPrice:profile.order?row.precioUnitario:row.precio,expectedIdentity:identity}});
 }
 const failures=[];let count=0;
 for(const plan of plans)try{const proposal=await prepare(actor,plan.input);add('preparar_cambio',{accion:profile.action},{kind:'proposal',proposal});count++;}catch(e){if(e.status===403)throw e;failures.push({registro:plan.row.registro,producto:plan.row.productoCodigo,motivo:e.message});}
 if(failures.length)add('preparar_cambio',{accion:profile.action},{kind:'validation',data:failures});
 if(count)state.pending=null;
 return answer(`Preparé ${count} propuestas con precios y cantidades actuales del ERP.${v.percent!==undefined?' Ajuste del '+(v.direction===-1?'-':'+')+v.percent+'%, redondeado a la precisión SX3.':''}${failures.length?' Hay '+failures.length+' registros con errores, detallados abajo.':''} Revisá el resumen antes/después y confirmá las tarjetas. No se modificó el ERP.`);
}

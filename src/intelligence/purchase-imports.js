import {assertPriceCurrency} from './references.js';
import {supplierPrice} from './order-list-price.js';
import {assert} from '../errors.js';
import {purchaseCurrency} from '../protheus/purchase-currency.js';

const importCurrency=value=>purchaseCurrency(value)==='1'?'ARS':purchaseCurrency(value);
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
export function importDate(value){
 const s=String(value||'').trim().replace(/[ T]00:00:00(?:\.000)?$/,''),m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
 const iso=m?`${m[3]}-${m[2]}-${m[1]}`:s;
 const d=new Date(iso+'T00:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(iso)&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===iso?iso:'';
}
// The attachment is data, never an instruction to create or confirm a document.
export async function prepareAttachmentCreation({actor,draft,input,read,prepare}){
 assert(input?.reviewed===true&&Array.isArray(input.rows),400,'REVISION_REQUERIDA','Revisá las filas del archivo.');
 assert(input.rows.length>0&&input.rows.length<=50,400,'ITEMS_INVALIDOS','Cada documento admite de 1 a 50 ítems.');
 const ids=new Set(),issues=[],missing=[],questions=[],items=[],references=[];
 const pc=draft.kind==='crearPedidoCompra';
 const query=(resource,filters)=>read(resource,new URLSearchParams({sucursal:draft.branch,limit:'100',...filters}));
 const ask=(key,text)=>{if(!missing.includes(key)){missing.push(key);questions.push(text);}};
 const lookup=async(resource,term)=>{
  let r=await query(resource,{codigo:term});if(!r.data.length)r=await query(resource,{q:term});return r;
 };
 const emission=importDate(input.emission);
 if(!emission)ask('emission','¿Qué fecha de emisión usamos? Indicá DD/MM/AAAA.');
 const currencies=[...new Set(input.rows.map(r=>importCurrency(r.currency||input.currency)).filter(Boolean))];
 const header={fechaEmision:emission,moneda:importCurrency(input.currency)||currencies[0]||(!pc&&!input.rows.some(r=>r.price)?'ARS':undefined)};
 if(!pc){
  if(input.requestType)header.tipoSolicitud=input.requestType;
  else if(header.moneda&&!['ARS','1'].includes(header.moneda))ask('requestType','Para conservar dólares en SC1, Protheus utiliza Solicitud de importación (MATA113), para productos importados. Indicá «solicitud de importación» si ése es el documento que necesitás.');
 }
 if(!header.moneda&&!pc)ask('currency','¿En qué moneda están los precios: pesos o dólares?');
 if(pc){
  if(!input.party)ask('party','¿Cuál es el proveedor del pedido nuevo?');
  else{
   const r=await lookup('proveedores',input.party),matches=r.data.filter(p=>!input.shop||p.tienda===input.shop);
   if(matches.length!==1||r.meta?.hasMore)return {missing:['party'],issues,choices:matches.map(p=>({label:`${p.codigo} / ${p.tienda} · ${p.nombre}`,text:`proveedor ${p.codigo} tienda ${p.tienda}`})),message:'Indicá un proveedor y tienda únicos para el pedido nuevo.'};
   header.proveedor=matches[0].codigo;header.tienda=matches[0].tienda;
  }
  if(!input.payment)ask('payment','¿Qué condición de pago usamos? Indicá el código o nombre.');
  else{
   const r=await lookup('condicionesPago',input.payment);
   if(r.data.length===1&&!r.meta?.hasMore)header.condicionPago=r.data[0].codigo;
   else ask('payment','No identifiqué una condición de pago única. Indicá su código en Protheus.');
  }
  if(input.buyer)header.comprador=input.buyer;
 }else{
  if(!input.requester)ask('requester','¿Quién es el solicitante de la solicitud nueva?');
  else header.solicitante=input.requester;
 }
 if(input.requesterCode)header.solicitanteCodigo=input.requesterCode;
 const links=[];
 if(pc&&header.proveedor)for(let page=1;;page++){
  assert(page<=100,409,'RELACIONES_EXCEDIDAS','Demasiadas relaciones SA5 para el proveedor.');
  const result=await query('productoProveedor',{proveedor:header.proveedor,tienda:header.tienda,page:String(page)});
  links.push(...result.data);if(!result.meta?.hasMore)break;
  assert(result.data.length,409,'PAGINACION_INVALIDA','No se pudieron leer las relaciones SA5.');
 }
 for(const sourceRow of input.rows){
  const r={...sourceRow};
  assert(typeof r.id==='string'&&draft.rows.some(x=>x.id===r.id)&&!ids.has(r.id),400,'FILA_INVALIDA','Filas duplicadas o ajenas al archivo.');ids.add(r.id);
  try{
   assert(r.product||r.description,400,'PRODUCTO_REQUERIDO','Falta producto.');
   const result=r.product?await query('productos',{codigo:r.product}):await lookup('productos',String(r.description));
   const products=[...result.data];
   assert(!result.meta?.hasMore,409,'PRODUCTO_AMBIGUO','Producto ambiguo en SB1.');
   for(const code of new Set(links.filter(l=>norm(l.codigoProductoProveedor)===norm(r.product)).map(l=>l.productoCodigo))){
    const related=await query('productos',{codigo:code});
    assert(!related.meta?.hasMore,409,'PRODUCTO_AMBIGUO','Relación SA5 ambigua.');products.push(...related.data);
   }
   const unique=[...new Map(products.map(p=>[p.codigo,p])).values()];
   assert(unique.length===1,409,'PRODUCTO_AMBIGUO','Producto inexistente o ambiguo en SB1/SA5; indicá su código.');
   const product=unique[0],unit=norm(product.unidadMedida);
   if(pc&&!r.price&&header.proveedor){
    const found=await supplierPrice({query,product:product.codigo,vendor:header.proveedor,shop:header.tienda,list:input.list,at:emission||new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'})});
    assert(found.row,409,'PRECIO_LISTA_REQUERIDO',found.message);r.price=found.row.precio;r.unit='unidad';if(header.moneda)assertPriceCurrency(/^\d+$/.test(header.moneda)?'moneda '+header.moneda:header.moneda,found.row,assert);r.currency=header.moneda||found.row.moneda.codigo;if(!header.moneda)header.moneda=importCurrency(r.currency);
   }
   if(!pc&&header.tipoSolicitud==='importacion')assert(norm(product.importadoCodigo?.codigo??product.importadoCodigo)==='S',400,'PRODUCTO_NO_IMPORTADO','El producto no está marcado como importado en SB1. No se modifica su clasificación.');
   const basis=(value,quantity)=>{
    const n=norm(value);
    if(['MILLAR','MILLARES','1000'].includes(n)){assert(unit==='UN',400,'MILLARES_NO_APLICAN','Millares sólo para productos UN.');return quantity?'millares':'millar';}
    if(['UNIDAD','UNIDADES','UNITARIO'].includes(n)||n&&n===unit)return quantity?'unidades':'unidad';
    return '';
   };
   const baseCantidad=basis(r.quantityUnit||input.quantityUnit,true),basePrecio=basis(r.unit||input.unit,false);
   if(!baseCantidad)ask('quantityUnit','¿Las cantidades son en unidades o millares?');
   if((pc||r.price)&&!basePrecio)ask('unit','¿Los precios son por unidad o por millar?');
   const currency=r.currency||input.currency||(!pc&&!r.price?header.moneda:undefined);
   if(!currency)ask('currency','¿En qué moneda están los precios de las filas sin moneda?');
   else{
    assert(importCurrency(currency),400,'MONEDA_NO_SOPORTADA','Moneda de la fila no reconocida.');
    assert(importCurrency(currency)===header.moneda,400,'MONEDAS_MEZCLADAS','El documento debe tener una sola moneda explícita. Separá las filas de distinta moneda; no se convierten ni se suman entre sí.');
   }
   for(const [key,label] of [['quantity','cantidad'],...((pc||r.price)?[['price','precio']]:[])])assert(/^\d+(?:\.\d+)?$/.test(String(r[key]||''))&&Number(r[key])>0,400,'DATO_FILA_REQUERIDO',`Falta ${label} positivo en fila ${r.id}. Indicá «fila ${r.id} ${label} …».`);
   const warehouse=r.warehouse||input.warehouse,due=importDate(r.due||input.due);
   if(!warehouse)ask('warehouse','¿En qué depósito se reciben los productos?');
   else{const w=await query('depositos',{codigo:warehouse});assert(w.data.length===1&&!w.meta?.hasMore,409,'DEPOSITO_INVALIDO',`Depósito ${warehouse} inexistente o ambiguo.`);}
   if(!due)ask('due','¿Cuál es la fecha de necesidad o entrega? Indicá DD/MM/AAAA.');
   if(due&&emission)assert(due>=emission,400,'FECHA_INVALIDA','La fecha de necesidad es anterior a la emisión.');
   items.push({producto:product.codigo,deposito:warehouse,fechaNecesidad:due,cantidad:r.quantity,...(r.price?{precio:r.price,basePrecio}:{}),baseCantidad,...(r.costCenter||input.costCenter?{centroCosto:r.costCenter||input.costCenter}:{}),...(r.observation?{observacion:r.observation}:{})});
   references.push({fila:r.id,producto:product.codigo,descripcion:product.nombre,origen:r.location});
  }catch(e){if(['LECTURA_DENEGADA','ACCION_DENEGADA'].includes(e.code))throw e;issues.push({fila:r.id,producto:r.product,motivo:e.message});}
 }
 if(missing.length||issues.length)return {missing,issues,...(missing.includes('requestType')?{choices:[{label:'Solicitud de importación en dólares',text:'Crear solicitud de importación'}]}:{}),message:['El documento se creará desde cero. Falta completar la revisión:',...questions,...issues.map(i=>`Fila ${i.fila}: ${i.motivo}`),'No preparé un documento incompleto. Corregí las filas o excluilas expresamente.'].join('\n')};
 const excluded=draft.rows.filter(r=>!ids.has(r.id)).map(r=>r.id);
 const selection=`${items.length} de ${draft.rows.length} filas seleccionadas${excluded.length?`; filas excluidas: ${excluded.join(', ')}`:''}`;
 let proposal;
 try{proposal=await prepare(actor,{action:draft.kind,target:{sucursal:draft.branch},header,items,origin:{importacion:draft.id,archivo:draft.name,ubicacion:selection,lecturaOriginal:JSON.stringify(references)}});}
 catch(e){
  if(['COTIZACION_NO_UNICA','COTIZACION_INVALIDA'].includes(e.code))return {missing:['emission'],issues:[],message:e.message};
  throw e;
 }
 const blockers=proposal.blockers||[];
 if(blockers.some(b=>b.code==='COMPRADOR_REQUERIDO'))ask('buyer','Indicá el código de comprador para resolver su grupo de aprobación.');
 if(blockers.some(b=>/solicitanteCodigo/.test(b.message)))ask('requesterCode','Indicá el código de usuario Protheus del solicitante para validar sus restricciones.');
 return {proposal:missing.length?undefined:proposal,missing,issues,message:missing.length?questions.join('\n'):`Documento nuevo desde cero: ${selection}. Productos verificados en SB1. Revisá cantidades, precios, total y aprobación antes de confirmar. El número y los RECNO se asignan al crear, en una sola transacción. No se creó ningún documento.`};
}

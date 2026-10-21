import {randomUUID} from 'node:crypto';
import {assert} from '../errors.js';
import {assertPriceCurrency} from './references.js';
import {prepareAttachmentCreation} from './purchase-imports.js';
import Decimal from 'decimal.js';
import {supplierPriceImpact} from './supplier-price-impact.js';
const normalized=value=>String(value||'').trim().toUpperCase();
export const importProfiles=Object.freeze({
 crearPedidoCompra:{action:'crearPedidoCompra',resource:'compras',party:'proveedores',creation:true},
 crearSolicitudCompra:{action:'crearSolicitudCompra',resource:'solicitudesCompra',creation:true},
 proveedor:{action:'precioListaProveedor',resource:'preciosProveedores',party:'proveedores',price:'AIB_PRCCOM'},
 cliente:{action:'precioLista',resource:'preciosClientes',party:'clientes',price:'DA1_PRCVEN'},
 pedidoVenta:{action:'pedidoVenta',resource:'itemsVentas',party:'clientes',price:'C6_PRCVEN',order:true},
 pedidoCompra:{action:'pedidoCompra',resource:'compras',party:'proveedores',price:'C7_PRECO',order:true},
 solicitudCompra:{action:'solicitudCompra',resource:'solicitudesCompra',price:'C1_VUNIT',order:true}
});
export const importAction=kind=>Object.hasOwn(importProfiles,kind)?importProfiles[kind].action:null;
export function createPriceImports({store,read,prepare,createBatch,metadata=()=>({}),authorizeRead,clock=()=>new Date()}){
 const db=store.db,busy=new Set();
 db.exec('CREATE TABLE IF NOT EXISTS price_imports(id TEXT PRIMARY KEY,actor TEXT NOT NULL,expires TEXT NOT NULL,body TEXT NOT NULL)');
 function save(actor,kind,branch,document){
  db.prepare('DELETE FROM price_imports WHERE expires<?').run(new Date().toISOString());
  assert(db.prepare('SELECT count(*) n FROM price_imports WHERE actor=?').get(actor).n<30,429,'MUCHOS_ADJUNTOS','Máximo 30 adjuntos pendientes por usuario en 24 horas.');
  const result={id:randomUUID(),kind,branch,...document,expiresAt:new Date(Date.now()+86400000).toISOString()};
  db.prepare('INSERT INTO price_imports VALUES(?,?,?,?)').run(result.id,actor,result.expiresAt,JSON.stringify(result));store.audit(actor,'price-import.extracted',result.id);return result;
 }
 function get(actor,id){const r=db.prepare('SELECT body FROM price_imports WHERE id=? AND actor=? AND expires>?').get(id,actor,new Date().toISOString());assert(r,404,'ADJUNTO_NO_EXISTE','Adjunto inexistente o vencido para este usuario.');return JSON.parse(r.body);}
 function classify(actor,id,kind){
  assert(!busy.has(actor),409,'IMPORTACION_EN_CURSO','Esperá a que termine la revisión actual del adjunto.');
  assert(importAction(kind),400,'DESTINO_INVALIDO','Indicá lista de proveedor/cliente, pedido de venta/compra o solicitud.');
  const draft=get(actor,id);
  db.prepare('UPDATE price_imports SET body=? WHERE id=? AND actor=?').run(JSON.stringify({...draft,kind}),id,actor);
  return {...draft,kind};
 }
 function invalidate(actor,id){
  assert(!busy.has(actor),409,'IMPORTACION_EN_CURSO','Esperá a que termine la revisión actual del adjunto.');
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='price_batches'").get()){
   assert(!db.prepare("SELECT 1 FROM price_batches WHERE actor=? AND import_id=? AND status IN ('checking','running')").get(actor,id),409,'LOTE_EN_CURSO','Esperá el resultado del lote en curso antes de modificar su revisión.');
   db.prepare("UPDATE price_batches SET status='superseded' WHERE actor=? AND import_id=? AND status='ready'").run(actor,id);
  }
  const proposals=db.prepare("SELECT id,body FROM proposals WHERE actor=? AND json_extract(body,'$.origin.importacion')=? AND json_extract(body,'$.operation')='insert'").all(actor,id);
  assert(!proposals.some(p=>store.execution(p.id,actor)?.status==='executing'),409,'LOTE_EN_CURSO','Esperá el resultado del documento en curso.');
  for(const p of proposals)if(!store.execution(p.id,actor)){
   const body=JSON.parse(p.body);body.status='superseded';body.executionEnabled=false;
   db.prepare('UPDATE proposals SET body=? WHERE id=? AND actor=?').run(JSON.stringify(body),p.id,actor);
  }
 }
 const query=(resource,branch,filters={})=>read(resource,new URLSearchParams({sucursal:branch,limit:'100',...filters}));
 const canonical=(resource,field,value)=>{
  const text=String(value||'').trim(),spec=metadata().entities?.[resource]?.fields?.find(f=>f.salida===field)?.diccionario,width=Number(spec?.X3_TAMANHO);
  return /^\d+$/.test(text)&&Number.isInteger(width)&&width>text.length&&width<=20?text.padStart(width,'0'):text;
 };
 async function lookup(resource,branch,term){let r=await query(resource,branch,{codigo:term});if(!r.data.length)r=await query(resource,branch,{q:term});return r;}
 async function preview(actor,id,input){
  const draft=get(actor,id);
  const profile=importProfiles[draft.kind];assert(profile,400,'DESTINO_INVALIDO','Falta indicar qué actualizar.');
  if(profile.creation){
   assert(!busy.has(actor),409,'IMPORTACION_EN_CURSO','Esperá la revisión del adjunto.');busy.add(actor);
   try{
    const prior=db.prepare("SELECT id FROM proposals WHERE actor=? AND json_extract(body,'$.origin.importacion')=? AND json_extract(body,'$.operation')='insert'").all(actor,id);
    assert(!prior.some(p=>store.execution(p.id,actor)),409,'ALTA_YA_INICIADA','Este archivo ya inició un alta. Consultá su resultado; no se creará otro documento con la misma revisión.');
    invalidateCreationProposals();
    const result=await prepareAttachmentCreation({actor,draft,input,read,prepare});
    db.prepare('UPDATE price_imports SET body=? WHERE id=? AND actor=?').run(JSON.stringify({...draft,lastResult:result}),id,actor);
    return result;
    function invalidateCreationProposals(){
     for(const p of prior){const old=store.get(p.id,actor);old.status='superseded';old.executionEnabled=false;db.prepare('UPDATE proposals SET body=? WHERE id=?').run(JSON.stringify(old),p.id);}
    }
   }finally{busy.delete(actor);}
  }
  const updateFields=input?.updateFields||'prices';
  assert(['prices','quantities','both'].includes(updateFields),400,'CAMPOS_INVALIDOS','Elegí precios, cantidades o ambos.');
  const changePrice=updateFields!=='quantities',changeQuantity=updateFields!=='prices';
  assert(!changeQuantity||profile.order,400,'CANTIDAD_NO_ADMITIDA','Las cantidades sólo se actualizan en pedidos o solicitudes existentes.');
  assert(input&&input.reviewed===true,400,'REVISION_REQUERIDA','Revisá la lectura del archivo y marcá la confirmación antes de preparar.');
  assert(profile.order||typeof input.party==='string'&&input.party.trim()&&input.party.length<=120,400,'TERCERO_REQUERIDO','Indicá el proveedor o cliente.');
  assert(Array.isArray(input.rows)&&input.rows.length>0&&input.rows.length<=500,400,'FILAS_REQUERIDAS','Seleccioná entre 1 y 500 filas.');
  const sourceIds=new Set();
  for(const row of input.rows){
   assert(row&&typeof row.id==='string'&&(draft.rows.some(r=>r.id===row.id)||/^manual-\d+$/.test(row.id)),400,'FILA_NO_EXISTE','La fila no pertenece a este adjunto.');
   assert(!sourceIds.has(row.id),400,'FILA_DUPLICADA','La misma fila se envió más de una vez.');sourceIds.add(row.id);
  }
  assert(!busy.has(actor),429,'IMPORTACION_EN_CURSO','Ya hay una importación de este usuario en preparación.');busy.add(actor);
  try{
   const supplier=profile.party==='proveedores';
   let party;
   if(profile.party&&input.party){
    const match=await lookup(profile.party,draft.branch,input.party.trim()),parties=match.data.filter(r=>!input.shop||r.tienda===input.shop);
    if(parties.length!==1||match.meta?.hasMore)return {proposals:[],issues:[],choices:parties.map(r=>({codigo:r.codigo,tienda:r.tienda,nombre:r.nombre})),message:'No identifiqué un único proveedor/cliente y tienda. Indicá su código y tienda.',question:'party'};
    party=parties[0];
   }
   const list=String(input.list||(draft.kind==='cliente'?party.listaPreciosCodigo:'')||'').trim();
   if(draft.kind==='cliente')assert(party.listaPreciosCodigo&&list===party.listaPreciosCodigo,409,'LISTA_CLIENTE_INVALIDA','La lista debe ser la asignada al cliente en A1_TABELA.');
   const links=[];
   if(supplier&&party){
    for(let page=1;;page++){
     assert(page<=100,409,'RELACIONES_EXCEDIDAS','Demasiadas relaciones SA5 para este proveedor.');
     const r=await query('productoProveedor',draft.branch,{proveedor:party.codigo,tienda:party.tienda,page:String(page)});links.push(...r.data);
     if(!r.meta?.hasMore)break;assert(r.data.length,409,'PAGINACION_INVALIDA','No se pudieron leer todas las relaciones del proveedor.');
    }
   }
   const proposals=[],issues=[],resolved=[],seen=new Set();
   for(const inputRow of input.rows){
    const original=draft.rows.find(r=>r.id===inputRow.id);
    assert(original||/^manual-\d+$/.test(inputRow.id),400,'FILA_NO_EXISTE','La fila no pertenece a este adjunto.');
    const origin={archivo:draft.name,ubicacion:original?.location||'Fila agregada manualmente',lecturaOriginal:original?.source||'Entrada manual',importacion:id};
    try{
     const code=String(inputRow.product||'').trim(),description=String(inputRow.description||'').trim();
     assert(code||description,400,'PRODUCTO_REQUERIDO','Falta código o descripción del producto.');assert(code.length<=120&&description.length<=200,400,'PRODUCTO_INVALIDO','Código o descripción demasiado largo.');
     let candidates=[];
     if(code){
      const direct=await query('productos',draft.branch,{codigo:code});assert(direct.data.length<=1&&!direct.meta?.hasMore,409,'PRODUCTO_AMBIGUO','Más de un producto con ese código.');candidates.push(...direct.data);
      const linked=[...new Set(links.filter(l=>normalized(l.codigoProductoProveedor)===normalized(code)).map(l=>l.productoCodigo))];
      for(const linkedCode of linked){const r=await query('productos',draft.branch,{codigo:linkedCode});assert(r.data.length<=1&&!r.meta?.hasMore,409,'PRODUCTO_AMBIGUO','Código relacionado ambiguo.');candidates.push(...r.data);}
     }else{const r=await lookup('productos',draft.branch,description);assert(r.data.length<=1&&!r.meta?.hasMore,409,'PRODUCTO_AMBIGUO','Hay más productos; indicá el código.');candidates=r.data;}
     const unique=[...new Map(candidates.map(r=>[r.codigo,r])).values()];assert(unique.length===1,409,'PRODUCTO_AMBIGUO',unique.length?'El código propio y/o la relación SA5 identifican varios productos. Indicá el código correcto.':'No encontré el producto en SB1 ni una relación SA5 para este proveedor.');const product=unique[0];
     let currency=String(inputRow.currency||input.currency||'').trim();
     let priceUnit,value;
     if(changePrice){
     assert(currency,400,'MONEDA_REQUERIDA','Falta moneda: indicá ARS, USD, EUR o el código de moneda ERP. No interpreto $ automáticamente.');
     const unit=normalized(inputRow.unit||input.unit);
     if(['MILLAR','MILLARES','1000'].includes(unit)){assert(normalized(product.unidadMedida)==='UN',400,'UNIDAD_INCOMPATIBLE','Sólo productos UN admiten precio por millar.');priceUnit='millar';}
     else if(['UNIDAD','UNITARIO'].includes(unit)||unit&&unit===normalized(product.unidadMedida))priceUnit='unidad';
     else assert(false,400,'BASE_PRECIO_REQUERIDA',`Falta base compatible: unidad ERP (${product.unidadMedida}) o millar para UN.`);
     value=String(inputRow.price||'').trim().replace(',','.');assert(/^\d{1,16}(?:\.\d{1,12})?$/.test(value)&&Number(value)>0,400,'PRECIO_INVALIDO','Precio positivo en decimal sin separadores de miles.');
     }
     let quantityUnit,quantity;
     if(changeQuantity){
      quantity=String(inputRow.quantity??'').trim().replace(',','.');
      assert(/^\d{1,16}(?:\.\d{1,12})?$/.test(quantity)&&Number(quantity)>0,400,'CANTIDAD_INVALIDA','Cantidad positiva en decimal sin separadores de miles.');
      const base=normalized(inputRow.quantityUnit||input.quantityUnit);
      if(['MILLAR','MILLARES','1000'].includes(base)){
       assert(normalized(product.unidadMedida)==='UN',400,'UNIDAD_INCOMPATIBLE','Sólo productos UN admiten cantidades en millares.');quantityUnit='millares';
      }else if(['UNIDAD','UNIDADES'].includes(base)||base&&base===normalized(product.unidadMedida))quantityUnit='unidades';
      else assert(false,400,'BASE_CANTIDAD_REQUERIDA',`Falta la base de cantidad: unidades (${product.unidadMedida}) o millares para UN. Es independiente de la base del precio.`);
     }
     if(inputRow.record)assert(typeof inputRow.record==='string'&&/^[1-9]\d{0,18}$/.test(inputRow.record),400,'REGISTRO_INVALIDO','Registro de precio inválido.');
     const number=canonical(profile.resource,'numero',inputRow.number||input.number),item=canonical(profile.resource,'item',inputRow.item);
     if(profile.order&&input.number&&inputRow.number)assert(canonical(profile.resource,'numero',input.number)===number,409,'DOCUMENTO_CONTRADICTORIO','El documento del archivo no coincide con el indicado en el chat. Corregí el número de esta fila.');
     if(profile.order)assert(number&&number.length<=30,400,'DOCUMENTO_REQUERIDO','Indicá el número del documento existente.');
     const resource=profile.resource,filters={producto:product.codigo,
      ...(party&&(supplier||profile.order)?{[supplier?'proveedor':'cliente']:party.codigo,tienda:party.tienda}:{}),
      ...(!profile.order&&list?{lista:list}:{}),...(profile.order?{numero:number,...(item?{item}: {})}:{}),
      ...(inputRow.record?{registro:inputRow.record}:{})};
     const prices=await query(resource,draft.branch,filters);
     if(prices.data.length!==1||prices.meta?.hasMore){
      issues.push({fila:inputRow.id,producto:product.codigo,ubicacion:origin.ubicacion,codigo:'PRECIO_NO_UNICO',motivo:prices.data.length?'Hay varios registros. Indicá el ítem o registro ERP de esta fila.':'No existe un registro para este producto y alcance. No se crean registros.',hasMore:!!prices.meta?.hasMore,candidates:prices.data.map(r=>({registro:r.registro,numero:r.numero,lista:r.listaCodigo,item:r.item,precio:r.precio??r.precioUnitario,moneda:r.moneda?.descripcion,desde:r.vigenteDesde,rango:r.rangoCompra}))});continue;
     }
     const row=prices.data[0];assert(row.productoCodigo===product.codigo&&(!supplier||!party||row.proveedorCodigo===party.codigo&&row.proveedorTienda===party.tienda)&&(!profile.order||row.numero===number&&(!item||row.item===item)),409,'REGISTRO_INCORRECTO','El registro no corresponde al documento, tercero y producto.');
     if(profile.order&&draft.kind==='pedidoVenta'){
      const headers=await query('ventas',draft.branch,{numero:number});
      assert(headers.data.length===1&&!headers.meta?.hasMore,409,'CABECERA_NO_UNICA','No identifiqué una cabecera única del pedido.');
      const header=headers.data[0];assert(!party||header.clienteCodigo===party.codigo&&header.clienteTienda===party.tienda,409,'REGISTRO_INCORRECTO','El pedido pertenece a otro cliente.');
      row.moneda=header.moneda;
      row.clienteCodigo=header.clienteCodigo;row.clienteTienda=header.clienteTienda;
     }
     if(changePrice){
     const currencyText=/^\d+$/.test(currency)?'moneda '+currency:currency;
     assert(/^(USD|ARS|EUR|D[OÓ]LAR(?:ES)?|PESOS?|EUROS?|\d+)$/i.test(currency),400,'MONEDA_INVALIDA','Usá ARS, USD, EUR o código ERP.');assertPriceCurrency(currencyText,row,assert);
     }else currency=row.moneda?.descripcion||`Moneda ${row.moneda?.codigo||'sin identificar'}`;
     assert(!seen.has(String(row.registro)),409,'DESTINO_DUPLICADO','Otro renglón del adjunto apunta al mismo registro. Prepará una sola fila por precio.');seen.add(String(row.registro));
     const expectedIdentity=profile.order?{producto:product.codigo,numero:row.numero,item:row.item,moneda:String(row.moneda?.codigo||''),...(draft.kind==='pedidoCompra'?{proveedor:row.proveedorCodigo,tienda:row.proveedorTienda}:draft.kind==='pedidoVenta'?{cliente:row.clienteCodigo,tienda:row.clienteTienda}:{})}:{producto:product.codigo,lista:row.listaCodigo,moneda:String(row.moneda?.codigo||''),...(supplier?{proveedor:party.codigo,tienda:party.tienda}:{})};
     const changes={...(changePrice?{[profile.order?'precioUnitario':'precio']:value}:{}),...(changeQuantity?{cantidadPedida:quantity}:{})};
     const proposal=await prepare(actor,{action:profile.action,target:{sucursal:draft.branch,registro:String(row.registro)},changes,...(changePrice?{priceUnit}:{}),...(changeQuantity?{quantityUnit,expectedQuantity:row.cantidadPedida}:{}),expectedPrice:profile.order?row.precioUnitario:row.precio,expectedIdentity,origin});
     proposals.push({...proposal,origin});resolved.push({fila:inputRow.id,producto:product.codigo,descripcion:product.nombre,registro:row.registro,lista:row.listaCodigo,numero:row.numero,item:row.item,tercero:party?.nombre||row.proveedor?.nombre||row.proveedorCodigo||row.clienteCodigo,tienda:party?.tienda||row.proveedorTienda||row.clienteTienda,precio:value,base:priceUnit,moneda:currency,cantidad:row.cantidadPedida});
     Object.assign(resolved.at(-1),{base:priceUnit||'unidad',quantityUnit,quantityChanged:changeQuantity,priceChanged:changePrice,monedaCodigo:String(row.moneda?.codigo||''),unidadMedida:product.unidadMedida,proveedorCodigo:supplier?party?.codigo:undefined,precioPorUnidad:changePrice?new Decimal(value).div(priceUnit==='millar'?1000:1).toFixed():row.precioUnitario??row.precio,evidenceAt:clock().toISOString(),vigenciaAnterior:{desde:row.vigenteDesde??null,hasta:row.vigenteHasta??null},vigenciaNueva:{desde:row.vigenteDesde??null,hasta:row.vigenteHasta??null},vigenciaModificada:false});
    }catch(error){if(['LECTURA_DENEGADA','ACCION_DENEGADA','ACCESO_CAMBIO'].includes(error.code))throw error;issues.push({fila:inputRow.id,producto:inputRow.product,ubicacion:origin.ubicacion,motivo:error.message,codigo:error.code||'ERROR_VERIFICACION'});}
   }
   const result={proposals,issues,resolved,message:`Cambios preparados: ${proposals.length}. Filas para revisar: ${issues.length}. No se modificó el ERP.`};
   if(draft.kind==='proveedor'&&resolved.length){result.impact=await supplierPriceImpact({rows:resolved,branch:draft.branch,read,authorizeRead,clock});for(const row of resolved)row.impact=result.impact.rows.find(r=>r.fila===row.fila)||{state:result.impact.state,message:result.impact.message,evidenceAt:result.impact.evidenceAt};}
   if(createBatch)result.batch=createBatch(actor,draft,result);
   db.prepare('UPDATE price_imports SET body=? WHERE id=? AND actor=?').run(JSON.stringify({...draft,lastResult:result}),id,actor);store.audit(actor,'price-import.prepared',id);return result;
  }finally{busy.delete(actor);}
 }
 return {save,get,preview,classify,invalidate};
}

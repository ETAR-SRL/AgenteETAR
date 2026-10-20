import {randomUUID} from 'node:crypto';
import {assert} from '../errors.js';
import {assertPriceCurrency} from './references.js';
const normalized=value=>String(value||'').trim().toUpperCase();
export const importAction=kind=>kind==='proveedor'?'precioListaProveedor':kind==='cliente'?'precioLista':null;
export function createPriceImports({store,read,prepare}){
 const db=store.db,busy=new Set();
 db.exec('CREATE TABLE IF NOT EXISTS price_imports(id TEXT PRIMARY KEY,actor TEXT NOT NULL,expires TEXT NOT NULL,body TEXT NOT NULL)');
 function save(actor,kind,branch,document){
  db.prepare('DELETE FROM price_imports WHERE expires<?').run(new Date().toISOString());
  assert(db.prepare('SELECT count(*) n FROM price_imports WHERE actor=?').get(actor).n<30,429,'MUCHOS_ADJUNTOS','Máximo 30 adjuntos pendientes por usuario en 24 horas.');
  const result={id:randomUUID(),kind,branch,...document,expiresAt:new Date(Date.now()+86400000).toISOString()};
  db.prepare('INSERT INTO price_imports VALUES(?,?,?,?)').run(result.id,actor,result.expiresAt,JSON.stringify(result));store.audit(actor,'price-import.extracted',result.id);return result;
 }
 function get(actor,id){const r=db.prepare('SELECT body FROM price_imports WHERE id=? AND actor=? AND expires>?').get(id,actor,new Date().toISOString());assert(r,404,'ADJUNTO_NO_EXISTE','Adjunto inexistente o vencido para este usuario.');return JSON.parse(r.body);}
 const query=(resource,branch,filters={})=>read(resource,new URLSearchParams({sucursal:branch,limit:'100',...filters}));
 async function lookup(resource,branch,term){let r=await query(resource,branch,{codigo:term});if(!r.data.length)r=await query(resource,branch,{q:term});return r;}
 async function preview(actor,id,input){
  const draft=get(actor,id);
  assert(input&&input.reviewed===true,400,'REVISION_REQUERIDA','Revisá la lectura del archivo y marcá la confirmación antes de preparar.');
  assert(typeof input.party==='string'&&input.party.trim()&&input.party.length<=120,400,'TERCERO_REQUERIDO','Indicá el proveedor o cliente.');
  assert(Array.isArray(input.rows)&&input.rows.length>0&&input.rows.length<=500,400,'FILAS_REQUERIDAS','Seleccioná entre 1 y 500 filas.');
  const sourceIds=new Set();
  for(const row of input.rows){
   assert(row&&typeof row.id==='string'&&(draft.rows.some(r=>r.id===row.id)||/^manual-\d+$/.test(row.id)),400,'FILA_NO_EXISTE','La fila no pertenece a este adjunto.');
   assert(!sourceIds.has(row.id),400,'FILA_DUPLICADA','La misma fila se envió más de una vez.');sourceIds.add(row.id);
  }
  assert(!busy.has(actor),429,'IMPORTACION_EN_CURSO','Ya hay una importación de este usuario en preparación.');busy.add(actor);
  try{
   const supplier=draft.kind==='proveedor',partyResource=supplier?'proveedores':'clientes';
   const match=await lookup(partyResource,draft.branch,input.party.trim()),parties=match.data.filter(r=>!input.shop||r.tienda===input.shop);
   if(parties.length!==1||match.meta?.hasMore)return {proposals:[],issues:[],choices:parties.map(r=>({codigo:r.codigo,tienda:r.tienda,nombre:r.nombre})),message:'Elegí un único proveedor/cliente y tienda; no preparé cambios.'};
   const party=parties[0],list=String(input.list||(!supplier?party.listaPreciosCodigo:'')||'').trim();
   if(!supplier)assert(party.listaPreciosCodigo&&list===party.listaPreciosCodigo,409,'LISTA_CLIENTE_INVALIDA','La lista debe ser la asignada al cliente en A1_TABELA.');
   const links=[];
   if(supplier){
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
     const currency=String(inputRow.currency||input.currency||'').trim();assert(currency,400,'MONEDA_REQUERIDA','Falta moneda: indicá ARS, USD, EUR o el código de moneda ERP. No interpreto $ automáticamente.');
     const unit=normalized(inputRow.unit||input.unit);let priceUnit;
     if(['MILLAR','MILLARES','1000'].includes(unit)){assert(normalized(product.unidadMedida)==='UN',400,'UNIDAD_INCOMPATIBLE','Sólo productos UN admiten precio por millar.');priceUnit='millar';}
     else if(['UNIDAD','UNITARIO'].includes(unit)||unit&&unit===normalized(product.unidadMedida))priceUnit='unidad';
     else assert(false,400,'BASE_PRECIO_REQUERIDA',`Falta base compatible: unidad ERP (${product.unidadMedida}) o millar para UN.`);
     const value=String(inputRow.price||'').trim().replace(',','.');assert(/^\d{1,16}(?:\.\d{1,12})?$/.test(value)&&Number(value)>0,400,'PRECIO_INVALIDO','Precio positivo en decimal sin separadores de miles.');
     if(inputRow.record)assert(typeof inputRow.record==='string'&&/^[1-9]\d{0,18}$/.test(inputRow.record),400,'REGISTRO_INVALIDO','Registro de precio inválido.');
     const resource=supplier?'preciosProveedores':'preciosClientes',filters={producto:product.codigo,...(supplier?{proveedor:party.codigo,tienda:party.tienda}:{}),...(list?{lista:list}:{}),...(inputRow.record?{registro:inputRow.record}:{})};
     const prices=await query(resource,draft.branch,filters);
     if(prices.data.length!==1||prices.meta?.hasMore){
      issues.push({fila:inputRow.id,producto:product.codigo,ubicacion:origin.ubicacion,codigo:'PRECIO_NO_UNICO',motivo:prices.data.length?'Hay varias listas, fechas o tramos. Elegí el registro ERP de esta fila y volvé a preparar.':'No existe un precio en AIB/DA1 para este alcance. No se crean registros.',hasMore:!!prices.meta?.hasMore,candidates:prices.data.map(r=>({registro:r.registro,lista:r.listaCodigo,item:r.item,precio:r.precio,moneda:r.moneda?.descripcion,desde:r.vigenteDesde,rango:r.rangoCompra}))});continue;
     }
     const row=prices.data[0];assert(row.productoCodigo===product.codigo&&(!supplier||row.proveedorCodigo===party.codigo&&row.proveedorTienda===party.tienda),409,'REGISTRO_INCORRECTO','El registro no corresponde al proveedor y producto.');
     const currencyText=/^\d+$/.test(currency)?'moneda '+currency:currency;
     assert(/^(USD|ARS|EUR|D[OÓ]LAR(?:ES)?|PESOS?|EUROS?|\d+)$/i.test(currency),400,'MONEDA_INVALIDA','Usá ARS, USD, EUR o código ERP.');assertPriceCurrency(currencyText,row,assert);
     assert(!seen.has(String(row.registro)),409,'DESTINO_DUPLICADO','Otro renglón del adjunto apunta al mismo registro. Prepará una sola fila por precio.');seen.add(String(row.registro));
     const proposal=await prepare(actor,{action:importAction(draft.kind),target:{sucursal:draft.branch,registro:String(row.registro)},changes:{precio:value},priceUnit,expectedPrice:row.precio,expectedIdentity:{producto:product.codigo,lista:row.listaCodigo,moneda:String(row.moneda?.codigo||''),...(supplier?{proveedor:party.codigo,tienda:party.tienda}:{})},origin});
     proposals.push({...proposal,origin});resolved.push({fila:inputRow.id,producto:product.codigo,descripcion:product.nombre,registro:row.registro,lista:row.listaCodigo,precio:value,base:priceUnit,moneda:currency});
    }catch(error){if(['LECTURA_DENEGADA','ACCION_DENEGADA','ACCESO_CAMBIO'].includes(error.code))throw error;issues.push({fila:inputRow.id,producto:inputRow.product,ubicacion:origin.ubicacion,motivo:error.message,codigo:error.code||'ERROR_VERIFICACION'});}
   }
   const result={proposals,issues,resolved,message:`Preparé ${proposals.length} propuestas y ${issues.length} filas requieren revisión. No se modificó el ERP. Cada tarjeta confirma un registro existente.`};
   db.prepare('UPDATE price_imports SET body=? WHERE id=? AND actor=?').run(JSON.stringify({...draft,lastResult:result}),id,actor);store.audit(actor,'price-import.prepared',id);return result;
  }finally{busy.delete(actor);}
 }
 return {save,get,preview};
}

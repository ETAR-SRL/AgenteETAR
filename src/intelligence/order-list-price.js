import Decimal from 'decimal.js';
const date=d=>d?String(d).slice(0,10):'';
export async function supplierPrice({query,product,vendor,shop,list,at}){
 const headers=await query('listasPreciosProveedores',{proveedor:vendor,tienda:shop,...(list?{codigo:list}:{})});
 if(headers.meta?.hasMore)return {message:'Hay varias listas del proveedor. ¿Qué lista querés usar?'};
 const valid=headers.data.filter(r=>(!list||r.codigo===list)&&r.proveedorCodigo===vendor&&r.proveedorTienda===shop&&(!date(r.vigenteDesde)||date(r.vigenteDesde)<=at)&&(!date(r.vigenteHasta)||date(r.vigenteHasta)>=at));
 const prices=[];
 for(const h of valid){
  const result=await query('preciosProveedores',{lista:h.codigo,proveedor:vendor,tienda:shop,producto:product});
  if(result.meta?.hasMore)return {message:'Hay varios precios para ese producto. Indicá la lista y el precio que corresponde.'};
  for(const row of result.data){
   if(row.listaCodigo!==h.codigo||row.productoCodigo!==product||row.proveedorCodigo!==vendor||row.proveedorTienda!==shop||date(row.vigenteDesde)>at)continue;
   if(!row.moneda?.codigo||!new Decimal(row.precio||0).gt(0))continue;
   if(new Decimal(row.rangoCompra||0).gt(0)||new Decimal(row.fleteUnitario||0).gt(0)||String(row.indiceRango||'').trim()&&!['0'].includes(String(row.indiceRango)))return {message:'La lista tiene condiciones por rango o flete. Indicá el precio acordado para este pedido; no voy a asumir un valor.'};
   prices.push(row);
  }
 }
 if(prices.length===1)return {row:prices[0]};
 return {message:prices.length?'Encontré más de un precio vigente. ¿Qué lista querés usar?':list?'No encontré un precio vigente del producto en esa lista. ¿Qué precio acordaron?':'No encontré una lista vigente con precio para ese producto. ¿Qué precio y moneda acordaron?'};
}

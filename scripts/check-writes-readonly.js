// Verifica el esquema y PREPARA propuestas con datos reales. Jamás llama execute.
import Decimal from 'decimal.js';
import {createErp} from '../src/protheus/index.js';
const erp=await createErp(),results=[];
try{
 for(const [action,resource] of [['precioLista','preciosClientes'],['precioListaProveedor','preciosProveedores'],['pedidoVenta','itemsVentas'],['pedidoCompra','compras']]){
  const list=await erp.list(resource,new URLSearchParams({sucursal:'0101',limit:'3'}));const attempts=[];
  for(const row of list.data){
   const order=action.startsWith('pedido');
   const input={action,target:{sucursal:'0101',registro:String(row.registro)},changes:order?{cantidadPedida:new Decimal(row.cantidadPedida).plus(1).toFixed()}:{precio:new Decimal(row.precio).toDecimalPlaces(action==='precioLista'?6:4).plus('0.001').toFixed()},priceUnit:'unidad',...(order?{quantityUnit:'unidades'}:{})};
   try{const proposal=await erp.writes.prepare(action,input);attempts.push({status:'prepared',fields:proposal.diff.map(d=>d.field),executionEnabled:proposal.executionEnabled});break;}
   catch(error){attempts.push({status:'rejected',code:error.code||'SOURCE_ERROR'});}
  }
  results.push({action,rowsSampled:list.data.length,attempts});
 }
 console.log(JSON.stringify({readOnly:true,erpUpdates:0,results},null,2));
}finally{await erp.close();}

import Decimal from 'decimal.js';
const D=Decimal.clone({precision:50});
const numeric=v=>typeof v==='string'||typeof v==='number';
const value=v=>{if(!numeric(v)||String(v).trim()==='')return null;try{const n=new D(v);return n.isFinite()?n:null;}catch{return null;}};

// This is an advisory reading of existing orders, never a proposal for SC7.
export async function supplierPriceImpact({rows,branch,read,authorizeRead,clock=()=>new Date()}){
 const evidenceAt=clock().toISOString(),base={evidenceAt,consultative:true,partial:false,groups:[],rows:[],limitations:[],scope:'Saldo técnico leído de pedidos existentes; simulación sin impuestos ni fletes. Actualizar AIB no cambia pedidos SC7.'};
 try{if(!authorizeRead)throw Object.assign(new Error(),{code:'LECTURA_DENEGADA'});authorizeRead('pedidosCompraPendientes');}
 catch(e){if(e.code==='ACCESO_CAMBIO')throw e;return {...base,state:'denied',message:'Esto no podés leerlo.'};}
 const groups=new Map(),identity=r=>[r.proveedorCodigo,r.tienda,r.producto,r.monedaCodigo,r.unidadMedida].join(':'),counts=new Map();
 for(const r of rows)counts.set(identity(r),(counts.get(identity(r))||0)+1);
 let products=0;
 for(const source of rows){
  const item={fila:source.fila,producto:source.producto,state:'available',partial:false,groups:[],orders:[],limitations:[]};base.rows.push(item);
  if(++products>20){item.state='unavailable';item.partial=true;item.limitations.push('Límite de veinte productos; no se consultó este producto.');base.partial=true;continue;}
  if(counts.get(identity(source))>1){item.state='unavailable';item.limitations.push('Hay más de un registro AIB para el mismo producto/tercero: no se elige un rango ni se duplica el saldo.');base.partial=true;continue;}
  const proposed=value(source.precioPorUnidad),currency=String(source.monedaCodigo??'').trim(),unit=String(source.unidadMedida||'').trim();
  if(!source.proveedorCodigo||!source.tienda||!source.producto||!currency||!unit||!proposed||proposed.lte(0)){item.state='unavailable';item.limitations.push('Falta identidad, moneda, unidad o precio propuesto verificable.');base.partial=true;continue;}
  const local=new Map(),seen=new Set();
  try{
   for(let page=1;page<=3;page++){
    authorizeRead('pedidosCompraPendientes');const result=await read('pedidosCompraPendientes',new URLSearchParams({sucursal:branch,proveedor:source.proveedorCodigo,tienda:source.tienda,producto:source.producto,limit:'100',page:String(page)}));authorizeRead('pedidosCompraPendientes');
    if(!Array.isArray(result?.data))throw new Error('Lectura sin filas verificables.');
    for(const r of result.data.slice(0,100)){
     const id=[r.origen,r.registro,r.numero,r.item].join(':'),quantity=value(r.cantidad),price=value(r.precioUnitario);
     if(seen.has(id)){item.partial=true;item.limitations.push('La paginación devolvió una fila repetida; se contó una sola vez.');continue;}seen.add(id);
     if(r.tercero!==source.proveedorCodigo||r.tienda!==source.tienda||r.producto!==source.producto||(r.sucursal||result.scope?.sucursal)!==branch||!r.numero||!r.item||!r.registro){item.partial=true;item.limitations.push('Una fila no verificó la identidad completa; se excluyó.');continue;}
     if(String(r.moneda??'')!==currency||r.unidad!==unit){item.partial=true;item.limitations.push('Se excluyeron pedidos con moneda o unidad diferente; no se aplicó conversión.');continue;}
     if(!quantity||quantity.lte(0)||!price||price.lt(0)){item.partial=true;item.limitations.push('Se excluyeron cantidades o precios no verificables.');continue;}
     const current=quantity.times(price),simulated=quantity.times(proposed),difference=simulated.minus(current),key=JSON.stringify([currency,unit]);
     const g=local.get(key)||{monedaCodigo:currency,monedaNombre:r.monedaNombre||currency,unidad:unit,cantidad:new D(0),importeActual:new D(0),importeSimulado:new D(0),diferencia:new D(0)};
     for(const [field,n]of [['cantidad',quantity],['importeActual',current],['importeSimulado',simulated],['diferencia',difference]])g[field]=g[field].plus(n);local.set(key,g);
     item.orders.push({numero:r.numero,item:r.item,registro:r.registro,monedaCodigo:currency,unidad:unit,cantidad:quantity.toFixed(),...(unit==='UN'?{millares:quantity.div(1000).toFixed()}:{}),precioPedidoPorUnidad:price.toFixed(),precioPropuestoPorUnidad:proposed.toFixed(),importeActual:current.toFixed(),importeSimulado:simulated.toFixed(),diferencia:difference.toFixed()});
    }
    if(result.data.length>100){item.partial=true;item.limitations.push('La fuente excedió cien filas por página.');}
    if(!result.meta||typeof result.meta.hasMore!=='boolean'){item.partial=true;item.limitations.push('La fuente no confirmó la completitud de la página.');break;}
    if(!result.meta.hasMore)break;
    if(!result.data.length||page===3){item.partial=true;item.limitations.push('Lectura incompleta: límite de tres páginas de cien filas por producto.');break;}
   }
  }catch(e){if(['LECTURA_DENEGADA','ACCION_DENEGADA','ACCESO_CAMBIO'].includes(e.code))throw e;item.state='unavailable';item.partial=true;item.limitations.push('No se pudo verificar el recurso de pedidos o su esquema. Los valores leídos son parciales.');}
  const serialize=g=>({...g,...Object.fromEntries(['cantidad','importeActual','importeSimulado','diferencia'].map(k=>[k,g[k].toFixed()])),...(g.unidad==='UN'?{millares:g.cantidad.div(1000).toFixed()}: {})});
  item.groups=[...local.values()].map(serialize);item.limitations=[...new Set(item.limitations)];base.partial ||=item.partial||item.state!=='available';
  for(const [key,g]of local){const total=groups.get(key)||{...g,cantidad:new D(0),importeActual:new D(0),importeSimulado:new D(0),diferencia:new D(0)};for(const k of ['cantidad','importeActual','importeSimulado','diferencia'])total[k]=total[k].plus(g[k]);groups.set(key,total);}
 }
 base.groups=[...groups.values()].map(g=>({...g,...Object.fromEntries(['cantidad','importeActual','importeSimulado','diferencia'].map(k=>[k,g[k].toFixed()])),...(g.unidad==='UN'?{millares:g.cantidad.div(1000).toFixed()}: {})}));
 base.state=base.partial?'partial':'available';return base;
}

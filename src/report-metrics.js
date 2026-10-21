import Decimal from 'decimal.js';
const D=Decimal.clone({precision:50});
export const reportDetails={resumenVentas:'comprobantesVentas',resumenCompras:'comprobantesCompras',resumenRemitosPendientes:'remitosPendientes',resumenPedidosVenta:'pedidosVentaPendientes',resumenPedidosCompra:'pedidosCompraPendientes'};
export function reportDrilldown(resource,scope,row={}){
 if(!reportDetails[resource]||!scope)return undefined;
 const filters={...scope.filtros,sucursal:scope.sucursal,desde:scope.desde,hasta:scope.hasta,...(row.moneda?{moneda:row.moneda}:{}),...(row.unidad?{unidad:row.unidad}:{})};
 if(row.agrupacion==='detalle'){
  if(scope.agrupar==='producto')filters.producto=row.dimension;
  if(scope.agrupar==='clase')filters.clase=row.dimension;
  if(scope.agrupar==='tercero'){const [party,store]=String(row.dimension).split(' / ');filters[resource==='resumenCompras'||resource==='resumenPedidosCompra'?'proveedor':'cliente']=party;filters.tienda=store;}
  if(scope.agrupar==='mes'&&/^\d{6}$/.test(row.dimension)){const month=row.dimension.slice(0,4)+'-'+row.dimension.slice(4),end=new Date(Date.UTC(Number(row.dimension.slice(0,4)),Number(row.dimension.slice(4)),0)).toISOString().slice(0,10);filters.desde=filters.desde>month+'-01'?filters.desde:month+'-01';filters.hasta=filters.hasta<end?filters.hasta:end;}
 }
 return {report:resource,resource:reportDetails[resource],filters};
}
export function currencyIdentity(code,description){
 const name=String(description||'').trim(),n=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/^(?:pesos?(?: argentinos?)?|ars)$/.test(n))return {monedaNombre:'Pesos',monedaISO:'ARS'};
 if(/^(?:dolar(?:es)?(?: estadounidenses?| americanos?)?|usd|u\$s)$/.test(n))return {monedaNombre:'Dólares',monedaISO:'USD'};
 return {monedaNombre:name||`Moneda sin identificar (${code||'sin código'})`,monedaISO:null};
}
export const currencyTitle=row=>row.monedaNombre?`${row.monedaNombre}${row.monedaISO?' ('+row.monedaISO+')':''}`:`Moneda ${row.moneda||'sin determinar'}`;
export function previousMonthRange({desde,hasta}){
 if(!desde||!hasta||desde.slice(0,7)!==hasta.slice(0,7))return null;
 const [year,month,day]=desde.split('-').map(Number),endDay=Number(hasta.slice(8));
 const last=new Date(Date.UTC(year,month-1,0)),max=last.getUTCDate(),prefix=last.toISOString().slice(0,7);
 return {desde:prefix+'-'+String(Math.min(day,max)).padStart(2,'0'),hasta:prefix+'-'+String(Math.min(endDay,max)).padStart(2,'0')};
}
export function compareReports(current,previous){
 const totals=r=>new Map((r.data||[]).filter(x=>x.agrupacion==='total').map(x=>[`${x.moneda}\0${x.unidad}`,x]));
 const a=totals(current),b=totals(previous),rows=[];
 for(const key of new Set([...a.keys(),...b.keys()])){
  const row=a.get(key)||b.get(key),now=new D(a.get(key)?.importeNeto||0),before=new D(b.get(key)?.importeNeto||0),diff=now.minus(before);
  const quantityNow=new D(a.get(key)?.cantidad||0),quantityBefore=new D(b.get(key)?.cantidad||0),millares=row.unidad==='UN',divisor=millares?1000:1;
  rows.push({moneda:row.moneda,monedaNombre:row.monedaNombre,monedaISO:row.monedaISO,unidad:row.unidad,monedaUnidad:`${currencyTitle(row)} · ${millares?'millares':row.unidad}`,importeActual:now.toFixed(),importeAnterior:before.toFixed(),diferencia:diff.toFixed(),variacionPorcentual:before.isZero()?null:diff.div(before.abs()).mul(100).toFixed(2),cantidadActual:quantityNow.div(divisor).toFixed(),cantidadAnterior:quantityBefore.div(divisor).toFixed(),diferenciaCantidad:quantityNow.minus(quantityBefore).div(divisor).toFixed(),unidadCantidad:millares?'millares':row.unidad,currentDrilldown:reportDrilldown(current.meta?.recurso,current.scope,row),previousDrilldown:reportDrilldown(previous.meta?.recurso,previous.scope,row)});
 }
 return {available:true,current:{desde:current.scope.desde,hasta:current.scope.hasta},previous:{desde:previous.scope.desde,hasta:previous.scope.hasta},rows};
}

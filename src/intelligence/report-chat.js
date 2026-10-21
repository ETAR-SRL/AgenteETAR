import Decimal from 'decimal.js';
const D=Decimal.clone({precision:50});
const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?!. ,]+/g,' ').trim();
const iso=d=>d.toISOString().slice(0,10);
export function reportPeriod(name,today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'})){
 const [y,m]=today.split('-').map(Number);
 if(name==='mes pasado')return {desde:iso(new Date(Date.UTC(y,m-2,1))),hasta:iso(new Date(Date.UTC(y,m-1,0)))};
 if(name==='año pasado')return {desde:`${y-1}-01-01`,hasta:`${y-1}-12-31`};
 if(name==='este año')return {desde:`${y}-01-01`,hasta:today};
 return {desde:`${y}-${String(m).padStart(2,'0')}-01`,hasta:today};
}
export function reportRequest(text,today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'})){
 let n=norm(text).replace(/^(?:(?:ok|perfecto|bueno|por favor) )+/,'').replace(/^(?:mostrame|mostra|dame|haceme|hace|quiero|necesito|armame|arma|generame|genera) /,'').replace(/^(?:un |una |el |la )/,'');
 const head=/^(?:dashboard|resumen|informe|reporte|grafico|ranking|evolucion)(?: de)? (?:(?:las|los) )?(ventas y compras|compras y ventas|pedidos de venta pendientes|pedidos de compra pendientes|pedidos de venta|pedidos de compra|remitos pendientes|ventas|compras)(?: facturadas)?\b/.exec(n);
 if(!head)return null;
 const resources={'ventas':'resumenVentas','compras':'resumenCompras','pedidos de venta':'resumenPedidosVenta','pedidos de compra':'resumenPedidosCompra','pedidos de venta pendientes':'resumenPedidosVenta','pedidos de compra pendientes':'resumenPedidosCompra','remitos pendientes':'resumenRemitosPendientes'};
 let tail=n.slice(head[0].length).trim(),filters={},group;
 tail=tail.replace(/\b(?:por|agrupado por|agrupadas por) (mes|cliente|proveedor|producto|clase)\b/g,(_,g)=>{group={cliente:'tercero',proveedor:'tercero'}[g]||g;return '';}).trim();
 tail=tail.replace(/^(?:de |del |en )/,'').trim();
 let period;
 if(!tail||/^(?:este mes|mes actual|mes pasado|ano pasado|este ano)$/.test(tail))period=reportPeriod(tail.replace('ano','año'),today);
 else if(/^(?:hoy|ayer)$/.test(tail)){const d=new Date(today+'T12:00:00Z');if(tail==='ayer')d.setUTCDate(d.getUTCDate()-1);period={desde:iso(d),hasta:iso(d)};}
 else {const days=/^(?:los )?ultimos? (\d{1,3}|dos|tres|siete) dias?$/.exec(tail);if(days){const count=Number(({dos:2,tres:3,siete:7})[days[1]]||days[1]);if(count<1||count>366)return null;const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-count+1);period={desde:iso(d),hasta:today};}}
 if(!period)return null; // Unrecognized filters must go through the validated tools, never disappear.
 filters={...period,...(group?{agrupar:group}:{})};
 return {resources:head[1].includes(' y ')?['resumenVentas','resumenCompras']:[resources[head[1]]],filters};
}
export function rememberReport(conversation,branch,evidence){
 const reports=evidence.filter(e=>e.result?.kind==='dashboard');
 if(reports.length!==1)return;
 const e=reports[0],s=e.result.scope;
 if(s)conversation.reportContext={branch,resource:e.result.meta?.recurso||({ventas:'resumenVentas',compras:'resumenCompras',remitosPendientes:'resumenRemitosPendientes',pedidosVenta:'resumenPedidosVenta',pedidosCompra:'resumenPedidosCompra'}[e.args.recurso]||e.args.recurso),filters:{...s.filtros,desde:s.desde,hasta:s.hasta,agrupar:s.agrupar}};
}
export async function reportChat({text,conversation={},branch,executeRead,today}) {
 const n=norm(text),old=conversation.reportContext?.branch===branch?conversation.reportContext:null;
 const follow=/^(?:y |comparalo con |compara con )?(?:el |este )?(mes|ano)? ?(pasado|anterior|actual)?$/.test(n)||/^(?:y )?(?:este mes|este ano|el mes pasado|el ano pasado|el pasado)$/.test(n);
 const match=reportRequest(text,today);
 if(!match&&!(follow&&old)||!executeRead)return null;
 const period=/ano/.test(n)?/pasado|anterior/.test(n)?'año pasado':'este año':/pasado|anterior/.test(n)?'mes pasado':'este mes';
 if(match?.resources.length>1){
  const evidence=[];for(const resource of match.resources){const filters={...match.filters,sucursal:branch};const result=await executeRead({resource,filters});evidence.push({id:'F'+(evidence.length+1),action:'consultar_erp',args:{recurso:resource,filtros:filters},result});}
  delete conversation.reportContext;
  return {answer:'**Ventas y compras**\n\n'+evidence.map(e=>e.result.verifiedSummary).join('\n\n'),evidence,trace:evidence.map(e=>({action:'consultar_erp',status:'ok',sourceId:e.id}))};
 }
 const resource=match?match.resources[0]:old.resource;
 const filters={...(!match?old.filters:{}),...(match?match.filters:reportPeriod(period,today)),sucursal:branch};
 const result=await executeRead({resource,filters});
 const evidence=[{id:'F1',action:'consultar_erp',args:{recurso:resource,filtros:filters},result}];
 let answer=result.verifiedSummary,comparison;
 if(!match&&old){
  const previous=await executeRead({resource,filters:{...old.filters,sucursal:branch}});
  evidence.push({id:'F2',action:'consultar_erp',args:{recurso:resource,filtros:old.filters},result:previous});
  const totals=r=>new Map(r.data.filter(x=>x.agrupacion==='total').map(x=>[`${x.moneda} · ${x.unidad}`,x]));
  const a=totals(result),b=totals(previous),lines=[],rows=[];
  for(const key of new Set([...a.keys(),...b.keys()])){
   const current=new D(a.get(key)?.importeNeto||0),before=new D(b.get(key)?.importeNeto||0),diff=current.minus(before);
   rows.push({monedaUnidad:key,importeActual:current.toFixed(),importeAnterior:before.toFixed(),diferencia:diff.toFixed(),variacionPorcentual:before.isZero()?null:diff.div(before.abs()).mul(100).toFixed(2)});
   lines.push(`Moneda ${key}: ${current.toFixed()} frente a ${before.toFixed()}; diferencia ${diff.gt(0)?'+':''}${diff.toFixed()}${before.isZero()?' (sin porcentaje: base anterior cero)':` (${diff.div(before.abs()).mul(100).toFixed(2)}%)`}.`);
  }
  answer=`Comparé ${filters.desde} a ${filters.hasta} con ${old.filters.desde} a ${old.filters.hasta}.\n\n${lines.join('\n')||'No encontré movimientos en ninguno de los dos períodos.'}\n\nEl mes/año actual llega hasta hoy; los períodos pasados están completos. Importes netos de ítems, por moneda y unidad. Ambos períodos se volvieron a consultar.`;
  comparison={current:{desde:filters.desde,hasta:filters.hasta},previous:{desde:old.filters.desde,hasta:old.filters.hasta},rows};
 }
 conversation.reportContext={branch,resource,filters:Object.fromEntries(Object.entries(filters).filter(([k])=>k!=='sucursal'))};
 return {answer,evidence,...(comparison?{comparison}:{}),trace:evidence.map(e=>({action:'consultar_erp',status:'ok',sourceId:e.id}))};
}

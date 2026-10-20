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
export function rememberReport(conversation,branch,evidence){
 const reports=evidence.filter(e=>e.result?.kind==='dashboard');
 if(reports.length!==1)return;
 const e=reports[0],s=e.result.scope;
 if(s)conversation.reportContext={branch,resource:e.result.meta?.recurso||({ventas:'resumenVentas',compras:'resumenCompras',remitosPendientes:'resumenRemitosPendientes',pedidosVenta:'resumenPedidosVenta',pedidosCompra:'resumenPedidosCompra'}[e.args.recurso]||e.args.recurso),filters:{...s.filtros,desde:s.desde,hasta:s.hasta,agrupar:s.agrupar}};
}
export async function reportChat({text,conversation={},branch,executeRead,today}) {
 const n=norm(text),old=conversation.reportContext?.branch===branch?conversation.reportContext:null;
 const follow=/^(?:y |comparalo con |compara con )?(?:el |este )?(mes|ano)? ?(pasado|anterior|actual)?$/.test(n)||/^(?:y )?(?:este mes|este ano|el mes pasado|el ano pasado|el pasado)$/.test(n);
 const match=/^(?:(?:mostrame|mostra|dame|haceme|quiero|necesito) )?(?:un |el )?(?:dashboard|resumen|informe) de (ventas|compras)(?: facturadas)?(?: (?:de|del|en) (?:este mes|mes actual|mes pasado|ano pasado|este ano))?$/.exec(n);
 if(!match&&!(follow&&old)||!executeRead)return null;
 const period=/ano/.test(n)?/pasado|anterior/.test(n)?'año pasado':'este año':/pasado|anterior/.test(n)?'mes pasado':'este mes';
 const resource=match?(match[1]==='ventas'?'resumenVentas':'resumenCompras'):old.resource;
 const filters={...(!match?old.filters:{}),...reportPeriod(period,today),sucursal:branch};
 const result=await executeRead({resource,filters});
 const evidence=[{id:'F1',action:'consultar_erp',args:{recurso:resource,filtros:filters},result}];
 let answer=result.verifiedSummary;
 if(!match&&old){
  const previous=await executeRead({resource,filters:{...old.filters,sucursal:branch}});
  evidence.push({id:'F2',action:'consultar_erp',args:{recurso:resource,filtros:old.filters},result:previous});
  const totals=r=>new Map(r.data.filter(x=>x.agrupacion==='total').map(x=>[`${x.moneda} · ${x.unidad}`,x]));
  const a=totals(result),b=totals(previous),lines=[];
  for(const key of new Set([...a.keys(),...b.keys()])){
   const current=new D(a.get(key)?.importeNeto||0),before=new D(b.get(key)?.importeNeto||0),diff=current.minus(before);
   lines.push(`Moneda ${key}: ${current.toFixed()} frente a ${before.toFixed()}; diferencia ${diff.gt(0)?'+':''}${diff.toFixed()}${before.isZero()?' (sin porcentaje: base anterior cero)':` (${diff.div(before.abs()).mul(100).toFixed(2)}%)`}.`);
  }
  answer=`Comparé ${filters.desde} a ${filters.hasta} con ${old.filters.desde} a ${old.filters.hasta}.\n\n${lines.join('\n')||'No encontré movimientos en ninguno de los dos períodos.'}\n\nEl mes/año actual llega hasta hoy; los períodos pasados están completos. Importes netos de ítems, por moneda y unidad. Ambos períodos se volvieron a consultar.`;
 }
 conversation.reportContext={branch,resource,filters:Object.fromEntries(Object.entries(filters).filter(([k])=>k!=='sucursal'))};
 return {answer,evidence,trace:evidence.map(e=>({action:'consultar_erp',status:'ok',sourceId:e.id}))};
}

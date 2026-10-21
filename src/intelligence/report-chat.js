import {compareReports,reportDetails,previousMonthRange} from '../report-metrics.js';
import {dashboardInput,reportReferences,resolveReportReferences} from './report-input.js';
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
 if(s)conversation.reportContext={branch,resource:e.result.meta?.recurso||({ventas:'resumenVentas',compras:'resumenCompras',remitosPendientes:'resumenRemitosPendientes',pedidosVenta:'resumenPedidosVenta',pedidosCompra:'resumenPedidosCompra'}[e.args.recurso]||e.args.recurso),filters:{...s.filtros,desde:s.desde,hasta:s.hasta,agrupar:s.agrupar},currencies:[...new Map((e.result.data||[]).map(r=>[r.moneda,{code:r.moneda,iso:r.monedaISO,name:r.monedaNombre}])).values()]};
}
export async function reportChat({text,conversation={},branch,executeRead,read,authorizeRead=()=>{},request,today}) {
 const n=norm(text),old=conversation.reportContext?.branch===branch?conversation.reportContext:null;
 const follow=/^(?:y |comparalo con |compara con )?(?:el |este )?(mes|ano)? ?(pasado|anterior|actual)?$/.test(n)||/^(?:y )?(?:este mes|este ano|el mes pasado|el ano pasado|el pasado)$/.test(n);
 const reportStart=/^(?:(?:mostrame|mostra|dame|haceme|hace|quiero|necesito|armame|arma|generame|genera|ok|perfecto|bueno|por favor) )*(?:un |una |el |la )?(?:dashboard|resumen|informe|reporte|grafico|ranking|evolucion)\b/.test(n);
 const contextual=(old||conversation.reportDraft?.branch===branch)&&(/^(?:filtra|filtrar|solo|y |para |cliente |proveedor |producto |tienda )/.test(n)||/\b(documentos|comprobantes|facturas|detalle)\b/.test(n)&&/^(?:mostrame|mostra|dame|ver|abrir|abri|detalle|quiero ver|necesito ver)/.test(n));
 if(!request&&!reportStart&&!(follow&&old)&&!contextual){delete conversation.reportDraft;return null;}
 const extracted=reportReferences(text);
 let match=request?dashboardInput(request,branch):reportRequest(extracted.text,today);
 if(match)match.filters={...match.filters,...extracted.filters};
 const filterFollow=Object.keys(extracted.filters).length&&/^(?:filtra por|filtrar por|solo|y|para|para el|para la)?$/.test(norm(extracted.text));
 if(!match&&filterFollow&&(conversation.reportDraft?.branch===branch||old)){const prior=conversation.reportDraft?.branch===branch?conversation.reportDraft:{resources:[old.resource],filters:old.filters};match={...prior,filters:{...prior.filters,...extracted.filters}};}
 if(!match&&old&&/\b(documentos|comprobantes|facturas|detalle)\b/.test(n)&&/^(?:mostrame|mostra|dame|ver|abrir|abri|detalle|quiero ver|necesito ver|y )/.test(n)){
  const filters={...old.filters,...extracted.filters};delete filters.agrupar;
  const currency=/\bpesos\b/.test(n)?'ARS':/\b(dolares|usd)\b/.test(n)?'USD':null;
  if(currency){const found=old.currencies?.find(c=>c.iso===currency);if(!found)return {answer:'No pude identificar esa moneda en el informe anterior.',evidence:[],trace:[]};filters.moneda=found.code;}
  if(!filters.moneda&&/\bese (?:importe|monto)\b/.test(n)&&old.currencies?.length>1)return {answer:'El dashboard tiene varias monedas. ¿De qué importe querés ver los documentos?',choices:old.currencies.filter(c=>c.iso).map(c=>({label:c.name,text:'Mostrame los documentos en '+(c.iso==='ARS'?'pesos':'dólares')})),evidence:[],trace:[]};
  if(/\b(referencia|mes anterior)\b/.test(n)){const range=previousMonthRange(filters);if(!range)return {answer:'Indicame el período del detalle que querés consultar.',evidence:[],trace:[]};Object.assign(filters,range);}
  else if(/\bmes pasado\b/.test(n))Object.assign(filters,reportPeriod('mes pasado',today));
  if(/\bmillares\b/.test(n))filters.unidad='UN';
  match={resources:[old.resource],filters,mode:'documents'};
 }
 if(!match&&!(follow&&old)||!executeRead){delete conversation.reportDraft;return null;}
 const resources=match?.resources||[old.resource];for(const resource of resources)authorizeRead(resource);
 if(match?.mode==='documents'){
  const resource=reportDetails[match.resources[0]];authorizeRead(resource);
  if(Object.keys(extracted.filters).length){const resolved=await resolveReportReferences({request:match,read,branch,conversation});if(resolved.reply){conversation.reportDraft.branch=branch;return resolved.reply;}match.filters=resolved.filters;}
  delete conversation.reportDraft;
  const filters={...match.filters,sucursal:branch,limit:'50',page:'1'};delete filters.agrupar;
  const result=await executeRead({resource,filters});conversation.reportContext={...old,branch,resource:match.resources[0],filters:Object.fromEntries(Object.entries(filters).filter(([k])=>!['sucursal','limit','page'].includes(k))),currencies:result.data?.length?[...new Map(result.data.map(r=>[r.moneda,{code:r.moneda,iso:r.monedaISO,name:r.monedaNombre}])).values()]:old?.currencies||[]};
  return {answer:'Estos son los ítems de los documentos que componen el importe, con los mismos filtros, período, moneda y unidad. Un documento puede ocupar varias filas. El detalle se vuelve a consultar y puede cambiar si hubo movimientos nuevos.',evidence:[{id:'F1',action:'consultar_erp',args:{recurso:resource,filtros:filters},result}],trace:[{action:'consultar_erp',status:'ok',sourceId:'F1'}]};
 }
 if(match){const resolved=await resolveReportReferences({request:match,read,branch,conversation});if(resolved.reply){conversation.reportDraft.branch=branch;return resolved.reply;}match.filters=resolved.filters;delete conversation.reportDraft;}
 const period=/ano/.test(n)?/pasado|anterior/.test(n)?'año pasado':'este año':/pasado|anterior/.test(n)?'mes pasado':'este mes';
 if(match?.resources.length>1){
  const evidence=[];for(const resource of match.resources){const filters={...match.filters,sucursal:branch};const result=await executeRead({resource,filters});evidence.push({id:'F'+(evidence.length+1),action:'consultar_erp',args:{recurso:resource,filtros:filters},result});}
  delete conversation.reportContext;
  return {answer:'**Ventas y compras**\n\n'+evidence.map(e=>e.result.verifiedSummary).join('\n\n'),evidence,trace:evidence.map(e=>({action:'consultar_erp',status:'ok',sourceId:e.id}))};
 }
 const resource=match?match.resources[0]:old.resource;
 const filters={...(!match?old.filters:{}),...(match?match.filters:reportPeriod(period,today)),sucursal:branch};
 const result=await executeRead({resource,filters});
 if(result.scope?.desde)filters.desde=result.scope.desde;if(result.scope?.hasta)filters.hasta=result.scope.hasta;if(result.scope?.agrupar)filters.agrupar=result.scope.agrupar;
 const evidence=[{id:'F1',action:'consultar_erp',args:{recurso:resource,filtros:filters},result}];
 let answer=result.verifiedSummary,comparison;
 if(!match&&old){
  const previous=await executeRead({resource,filters:{...old.filters,sucursal:branch}});
  evidence.push({id:'F2',action:'consultar_erp',args:{recurso:resource,filtros:old.filters},result:previous});
  comparison=compareReports({...result,scope:result.scope||filters},{...previous,scope:previous.scope||old.filters});
  const lines=comparison.rows.map(r=>`${r.monedaUnidad}: ${r.importeActual} frente a ${r.importeAnterior}; diferencia ${Number(r.diferencia)>0?'+':''}${r.diferencia}${r.variacionPorcentual===null?' (sin porcentaje: base anterior cero)':` (${r.variacionPorcentual}%)`}.`);
  answer=`Comparé ${filters.desde} a ${filters.hasta} con ${old.filters.desde} a ${old.filters.hasta}.\n\n${lines.join('\n')||'No encontré movimientos en ninguno de los dos períodos.'}\n\nEl mes/año actual llega hasta hoy; los períodos pasados están completos. Importes netos de ítems, por moneda y unidad. Ambos períodos se volvieron a consultar.`;
 }
 conversation.reportContext={branch,resource,filters:Object.fromEntries(Object.entries(filters).filter(([k])=>k!=='sucursal')),currencies:[...new Map((result.data||[]).map(r=>[r.moneda,{code:r.moneda,iso:r.monedaISO,name:r.monedaNombre}])).values()]};
 return {answer,evidence,...(comparison?{comparison}:{}),trace:evidence.map(e=>({action:'consultar_erp',status:'ok',sourceId:e.id}))};
}

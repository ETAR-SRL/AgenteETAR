// Durante un reinicio administrativo pendiente el servidor anterior puede seguir
// entregando la interfaz. Un módulo nuevo ausente no debe inutilizar el chat vigente.
let operationalPending=false;
const pendingModule=()=>{operationalPending=true;const ui=()=>({load(){},render(){},destroy(){}});return {installCorporateDocumentsUI:ui,installApprovedKnowledgeUI:ui,installInvestigations:ui,addReportDownload(){}};};
const [{installCorporateDocumentsUI},{installApprovedKnowledgeUI},{installInvestigations},{addReportDownload}]=await Promise.all([
 import('./corporate-documents-ui.js').catch(pendingModule),import('./knowledge-ui.js').catch(pendingModule),import('./investigation-ui.js').catch(pendingModule),import('./report-download-ui.js').catch(pendingModule)
]);
import {installAttention} from './attention-ui.js';
import {installErpConnection} from './erp-connection-ui.js';
import {accessReady,loadAccessPanel} from './access-ui.js';
import {installPriceImports} from './import-ui.js';
import {renderImportBatch,formatAnswer} from './import-batch-ui.js';

const $=s=>document.querySelector(s);
const labels={liberacionesVentas:'Liberaciones del pedido · SC9',documentosPedidoVenta:'Remitos y facturas del pedido',saldosProveedores:'Saldos financieros de proveedores · SE2',saldosClientes:'Saldos financieros de clientes · SE1',recepcionesCompras:'Entradas registradas de proveedores · SD1',comprobantesVentas:'Ventas facturadas · NF/NC/ND',comprobantesCompras:'Compras facturadas · NF/NC/ND',remitosEmitidos:'Remitos emitidos',remitosPendientes:'Remitos pendientes de facturar',pedidosVentaPendientes:'Pedidos de venta pendientes',pedidosCompraPendientes:'Pedidos de compra pendientes',resumenVentas:'Resumen de ventas facturadas',resumenCompras:'Resumen de compras',resumenRemitosPendientes:'Resumen de remitos pendientes',resumenPedidosVenta:'Resumen de pedidos de venta',resumenPedidosCompra:'Resumen de pedidos de compra',condicionesPago:'Condiciones de pago',depositos:'Depósitos',centrosCosto:'Centros de costo',solicitudesCompra:'Solicitudes de compra',costos:'Costos',compras:'Órdenes de compra',produccion:'Producción',ventas:'Pedidos de venta',itemsVentas:'Ítems de ventas / pendientes',documentosSalida:'Documentos de salida',itemsDocumentosSalida:'Ítems de documentos de salida',remitos:'Remitos',entregas:'Entregas físicas',clientes:'Clientes',proveedores:'Proveedores',productos:'Productos',listasPreciosClientes:'Listas de precios de clientes',preciosClientes:'Precios de clientes · DA1',listasPreciosProveedores:'Listas de precios de proveedores',preciosProveedores:'Precios de proveedores',productoProveedor:'Productos por proveedor',productoCliente:'Productos por cliente',entradasCompras:'Entradas de compras',estructuras:'Estructuras',cotizaciones:'Cotizaciones',itemsCotizaciones:'Ítems de cotizaciones',proyectos:'Proyectos KAIQEN',calidad:'Calidad KAIQEN'};
const fieldLabels={monedaVista:'Moneda',importe:'Importe',fecha:'Fecha',clase:'Tipo',tercero:'Cliente / proveedor',serie:'Serie',item:'Ítem',precioPorMillar:'Precio por millar',cantidadMillares:'Cantidad en millares',registro:'Registro',codigo:'Código',descripcion:'Descripción',sucursal:'Sucursal',producto:'Producto',cliente:'Cliente',proveedor:'Proveedor',nombre:'Nombre',tienda:'Tienda',numero:'Número',lista:'Lista',precio:'Precio',desde:'Desde',hasta:'Hasta',pendiente:'Pendientes',status_name:'Estado registrado',phase_no:'Fase',name:'Nombre',code:'Código',customer:'Cliente',current_phase_name:'Fase actual',planned_start:'Inicio previsto',planned_end:'Fin previsto',actual_start:'Inicio real',actual_end:'Fin real',updated_at:'Actualizado',part_number:'N.º de pieza',part_name:'Pieza',sin_ia_externa:'Restricción IA externa',sin_ia_externa_por_cliente:'Restricción IA del cliente'};
let capabilities,selectedProject=null,projectOffset=0,projectQuery='',page=1,activeParams=null,activeResource=null,deferredInstall;
let conversationId=localStorage.getItem('central-conversation-id')||undefined,attachments,attention,investigations,corporateUI,knowledgeUI;
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
function notice(text){$('#notice').textContent=text;$('#notice').classList.toggle('hidden',!text);}
function busy(where,text='Consultando la fuente…'){where.replaceChildren(node('div','loading',text));}
async function session(){const res=await fetch('/api/ui/session',{method:'POST',credentials:'same-origin',cache:'no-store'});if(!res.ok)throw new Error('No se pudo abrir la sesión local');}
async function api(path,options={},retry=true){
  let response;
  try{response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});}catch{throw Object.assign(new Error('No se puede acceder al servicio local. Iniciá Central en este equipo y verificá la red o VPN.'),{code:'SIN_CONEXION'});}
  if(response.status===401&&retry){await accessReady();await session();return api(path,options,false);}
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error?.message||'No se pudo realizar la consulta'),{code:data.error?.code});return data;
}
function showError(where,error){
  const friendly={SUCURSAL_CONFIGURACION:'Este recurso requiere confirmar la sucursal en el conector de Protheus.',SUCURSAL_NO_CONFIGURADA:'Este recurso todavía requiere confirmar la sucursal en el conector de Protheus.',ERP_BRANCH_MAPPING_REQUIRED:'Este recurso requiere configurar la sucursal en el conector.',CONSULTA_AMBIGUA:'No reconocí la consulta. Probá “mostrame los costos”, “ventas pendientes” o usá Explorar ERP.',PROPUESTA_REQUERIDA:'Pedí la modificación por texto o voz en el chat.',RESULTADO_INCIERTO:'No se pudo confirmar el resultado. Consultá el estado de la propuesta y verificá el registro en Protheus; no repitas el cambio.',EJECUCION_NO_REPETIBLE:'La ejecución ya se inició. Consultá el estado; no repitas el cambio.'};
  const box=node('div','error-box',friendly[error.code]||error.message);box.setAttribute('role','alert');box.append(node('small','',error.code||'CONEXIÓN'));where.replaceChildren(box);
}
function display(value){if(value===null||value===undefined||value==='')return '—';if(typeof value==='boolean')return value?'Sí':'No';if(typeof value==='object')return JSON.stringify(value);return String(value);}
function visual(value){
  if(value&&typeof value==='object'&&!Array.isArray(value))return Object.entries(value).map(([key,v])=>`${title(key)}: ${display(v)}`).join(' · ');
  if(typeof value==='string'&&/^-?\d+\.\d+(?:e[+-]\d+)?$/i.test(value)){
    const number=Number(value);if(Number.isFinite(number))return number!==0&&Math.abs(number)<0.000001?number.toLocaleString('es-AR',{maximumSignificantDigits:6}):number.toLocaleString('es-AR',{maximumFractionDigits:6});
  }
  return display(value);
}
function title(key){return fieldLabels[key]||key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/^./,x=>x.toUpperCase());}
function stamp(value){return value?new Date(value).toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'}):'Ahora';}
function downloadRows(rows,name){
  const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  const csvCell=value=>'"'+display(value).replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';
  const csv='\uFEFF'+[columns.map(csvCell).join(';'),...rows.map(row=>columns.map(k=>csvCell(row[k])).join(';'))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=node('a');a.href=url;a.download=name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function table(rows,preferredColumns){
  const wrap=node('div','table-wrap');wrap.tabIndex=0;wrap.setAttribute('aria-label','Tabla de resultados, desplazable');
  const t=node('table'),head=node('thead'),hr=node('tr'),body=node('tbody');
  const priority=['codigo','code','numero','productoCodigo','nombre','name','producto','cliente','proveedor','phase_no','status_name','estado','cantidad','costoMedio','precio','saldoTecnico','sucursal'];
  const columns=preferredColumns||[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(key=>!['sin_ia_externa','sin_ia_externa_por_cliente'].includes(key)).sort((a,b)=>{
    const rank=k=>priority.includes(k)?priority.indexOf(k):k==='id'||k.endsWith('_id')||k==='registro'?200:100;
    return rank(a)-rank(b);
  });
  columns.forEach(key=>{const th=node('th','',title(key));th.scope='col';hr.append(th);});head.append(hr);
  rows.forEach(row=>{const tr=node('tr');columns.forEach(key=>{const td=node('td','',visual(row[key]));td.title=display(row[key]);tr.append(td);});body.append(tr);});
  t.append(head,body);wrap.append(t);return wrap;
}
function renderResult(where,envelope,heading,{append=false,columns}={}){
  if(envelope.kind==='dashboard')return renderDashboard(where,envelope,heading,{append});
  const rows=Array.isArray(envelope.data)?envelope.data:[],meta=envelope.meta||envelope.pagination||{},source=envelope.source;
  const system=typeof source==='object'?source.system:envelope.origen==='kaiqen'?'KAIQEN':'Protheus';
  const card=node('article','result-card'),header=node('div','result-header'),left=node('div');
  left.append(node('h3','',heading),node('div','result-meta',`${system||'Fuente'} · ${stamp(source?.fetchedAt||envelope.fetchedAt)} · ${rows.length} registros en esta página${meta.hasMore?' · hay más resultados':''}`));header.append(left);
  if(rows.length){const exportButton=node('button','secondary','↓ CSV');exportButton.title='Exportar los registros de esta página';exportButton.onclick=()=>downloadRows(rows,heading.toLowerCase().replace(/[^a-z0-9]/g,'-'));header.append(exportButton);}
  card.append(header);
  if(envelope.status==='not_configured')card.append(node('div','empty','No hay una fuente configurada para confirmar entregas físicas. Los remitos emitidos se consultan por separado.'));
  else if(rows.length)card.append(table(rows,columns));else card.append(node('div','empty','No se encontraron registros para esta consulta. Esto no implica un importe o saldo igual a cero.'));
  const notes=node('div','result-notes',`Alcance: ${rows.length} registros recibidos${meta.page?' · página '+meta.page:''}. La consulta no calcula totales globales.`);
  if(rows.some(row=>Object.values(row).some(v=>typeof v==='string'&&/e[+-]\d+$/i.test(v))))notes.append(node('p','','Números en pantalla redondeados a 6 decimales. El valor original está en la ayuda de cada celda y en el CSV.'));
  const limitations=[...(envelope.limitations||[]),...(envelope.limitaciones||[]),...(meta.advertencias||[])];
  if(meta.sucursalEfectiva!==undefined)notes.append(node('p','',`Sucursal física consultada: ${meta.sucursalEfectiva||'(compartida)'}.`));
  if(limitations.length){const details=node('details');details.append(node('summary','','Ver alcance y limitaciones'),node('p','',limitations.join(' · ')));notes.append(details);}
  card.append(notes);if(append)where.append(card);else where.replaceChildren(card);return card;
}
function reportCurrency(row){return row.monedaNombre?`${row.monedaNombre}${row.monedaISO?' ('+row.monedaISO+')':''}`:`Moneda ${row.moneda||'sin identificar'}`;}
function reportNumber(value){const match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));if(!match)return visual(value);const fraction=(match[3]||'').replace(/0+$/,'');return match[1]+BigInt(match[2]).toLocaleString('es-AR')+(fraction?','+fraction:'');}
function dashboardRows(rows){return rows.map(row=>{const {drilldown,monedaNombre,monedaISO,cantidadMillares,...rest}=row;return {...rest,moneda:reportCurrency(row),codigoMoneda:row.moneda,...(row.unidad==='UN'&&cantidadMillares!==undefined?{unidad:'millares',cantidad:cantidadMillares,cantidadUnidades:row.cantidad}:{})};});}
function openDashboardDocuments(target){if(!target)return;if(target.filters.sucursal!==$('#branch').value){notice('Este gráfico pertenece a otra sucursal. Volvé a generar el dashboard en la sucursal seleccionada.');return;}query('Mostrame los documentos de este importe',{mode:'documents',resource:target.report,filters:target.filters});}
function dashboardFilterForm(report){
 const resource=report.meta?.recurso;if(!resource)return node('div');
 const form=node('form','dashboard-filters'),fields={},purchase=['resumenCompras','resumenPedidosCompra'].includes(resource),filters=report.scope.filtros||{};
 for(const [key,label,type] of [[purchase?'proveedor':'cliente',purchase?'Proveedor':'Cliente','text'],['producto','Producto','text'],['tienda','Tienda','text'],['desde','Desde','date'],['hasta','Hasta','date']]){const wrap=node('label','',label),input=node('input');input.type=type;input.maxLength=120;input.value=filters[key]||report.scope[key]||'';if(type==='text')input.placeholder=key==='tienda'?'Opcional':'Nombre o código';wrap.append(input);form.append(wrap);fields[key]=input;}
 const apply=node('button','secondary','Aplicar filtros');apply.type='submit';form.append(apply);const clear=node('button','text-button','Quitar filtros');clear.type='button';clear.onclick=()=>{if(report.scope.sucursal!==$('#branch').value)return notice('Volvé a consultar en la sucursal seleccionada.');query('Quitar filtros del dashboard',{mode:'summary',resource,filters:{sucursal:report.scope.sucursal,desde:report.scope.desde,hasta:report.scope.hasta,agrupar:report.scope.agrupar}});};form.append(clear);
 form.onsubmit=event=>{event.preventDefault();const values={...filters,sucursal:report.scope.sucursal,agrupar:report.scope.agrupar};delete values.cliente;delete values.proveedor;delete values.producto;delete values.tienda;for(const [k,v] of Object.entries(fields))if(v.value.trim())values[k]=v.value.trim();if(values.sucursal!==$('#branch').value)return notice('Volvé a consultar en la sucursal seleccionada.');query('Aplicar filtros del dashboard',{mode:'summary',resource,filters:values});};return form;
}
function renderDocuments(where,result,heading){
 const resource=result.meta?.recurso,scope=result.scope,displayRows=result.data.map(r=>({...r,monedaVista:reportCurrency(r)}));renderResult(where,{...result,data:displayRows},heading,{columns:['fecha','numero','serie','clase','producto','monedaVista','importe',...(result.data.some(r=>r.cantidadMillares!==undefined)?['cantidadMillares']:[]),'cantidad','unidad','tercero','tienda','item']});where.append(node('p','metrics-note','Detalle por ítem: un comprobante puede tener varias filas. Esta página no es una suma del importe total.'));
 if(!scope||!resource)return;
 const nav=node('div','document-pagination'),previous=node('button','secondary','Anterior'),next=node('button','secondary','Siguiente'),page=result.meta.page||1;previous.disabled=page<=1;next.disabled=!result.meta.hasMore;
 const load=async number=>{if(scope.sucursal!==$('#branch').value)return notice('El detalle pertenece a otra sucursal. Volvé a consultar.');previous.disabled=next.disabled=true;try{const filters=new URLSearchParams({...scope.filtros,sucursal:scope.sucursal,desde:scope.desde,hasta:scope.hasta,limit:String(result.meta.limit||50),page:String(number)});renderDocuments(where,await api('/api/erp/'+encodeURIComponent(resource)+'?'+filters),heading);}catch(error){showError(where,error);}};
 previous.onclick=()=>load(page-1);next.onclick=()=>load(page+1);nav.append(previous,node('span','',`Página ${page}`),next);where.append(nav);
}
function printReport(card){document.querySelectorAll('.printing-report').forEach(e=>e.classList.remove('printing-report'));card.classList.add('printing-report');document.body.classList.add('printing-dashboard');window.print();}
function comparisonChart(comparison){
  const visibleRows=(comparison.rows||[]).map(({currentDrilldown,previousDrilldown,...row})=>row);
  const box=node('section','result-card comparison-card'),header=node('div','result-header');header.append(node('h3','',comparison.label||'Comparación de períodos'));
  const csv=node('button','secondary','↓ CSV');csv.disabled=!comparison.rows?.length;csv.onclick=()=>downloadRows(visibleRows,'comparacion');header.append(csv);const print=node('button','secondary','Imprimir / PDF');print.onclick=()=>printReport(box);header.append(print);box.append(header);
  box.append(node('p','metrics-note',`Consultado: ${comparison.current.desde} a ${comparison.current.hasta} · Referencia: ${comparison.previous.desde} a ${comparison.previous.hasta}`));
  if(comparison.available===false){box.append(node('p','empty',comparison.message));return box;}
  if(!comparison.rows?.length){box.append(node('p','empty','Sin movimientos en ambos períodos.'));return box;}
  for(const row of comparison.rows){
    const group=node('div','comparison-group');group.append(node('h4','',row.monedaUnidad));
    const panels=node('div','comparison-panels');
    for(const spec of [{title:'Importe neto · '+reportCurrency(row),current:row.importeActual,previous:row.importeAnterior},{title:'Cantidad · '+(row.unidadCantidad||row.unidad),current:row.cantidadActual,previous:row.cantidadAnterior}]){
      if(spec.current===undefined||spec.previous===undefined)continue;
      const panel=node('div','comparison-panel'),max=Math.max(Math.abs(Number(spec.current)),Math.abs(Number(spec.previous)),1);panel.append(node('h5','',spec.title));
      for(const [key,label] of [['current','Consultado'],['previous','Referencia']]){const value=String(spec[key]),line=node(row[key+'Drilldown']?'button':'div','comparison-line'),bar=node('div','comparison-bar '+key);if(row[key+'Drilldown']){line.type='button';line.title='Ver documentos de '+label.toLowerCase();line.onclick=()=>openDashboardDocuments(row[key+'Drilldown']);}line.append(node('span','',label),node('strong','',reportNumber(value)));bar.style.width=`${Math.abs(Number(value))/max*100}%`;bar.classList.toggle('negative',Number(value)<0);line.append(bar);panel.append(line);}panels.append(panel);
    }
    group.append(panels,node('p','metrics-note',`Diferencia de importe: ${reportNumber(row.diferencia)} · ${row.variacionPorcentual===null?'Sin porcentaje: referencia cero':reportNumber(row.variacionPorcentual)+' %'}${row.diferenciaCantidad!==undefined?' · Diferencia de cantidad: '+reportNumber(row.diferenciaCantidad)+' '+row.unidadCantidad:''}`));box.append(group);
  }
  const details=node('details','dashboard-values');details.append(node('summary','','Ver tabla comparativa'),table(visibleRows));box.append(details);return box;
}
function renderDashboard(where,envelope,heading,{append=false,comparison=true}={}){
  const card=node('article','result-card'),header=node('div','result-header'),rows=envelope.data||[];
  card.classList.add('dashboard-card');
  header.append(node('h3','',heading));
  const saveButton=node('button','secondary','Guardar dashboard');saveButton.onclick=()=>saveDashboardDialog(envelope,heading);header.append(saveButton);
  const exportButton=node('button','secondary','↓ CSV');exportButton.onclick=()=>downloadRows(dashboardRows(rows),'resumen');header.append(exportButton);
  const printButton=node('button','secondary','Imprimir / PDF');printButton.onclick=()=>printReport(card);header.append(printButton);
  addReportDownload(header,envelope,{request:(path,options)=>fetch(path,{credentials:'same-origin',cache:'no-store',...options}),notice});
  card.append(header,node('p','result-meta',`Protheus · ${stamp(envelope.source?.fetchedAt)} · ${envelope.scope.desde} a ${envelope.scope.hasta} · sucursal ${envelope.scope.sucursal}`));
  card.append(dashboardFilterForm(envelope));
  if(Object.keys(envelope.scope.filtros||{}).length)card.append(node('p','metrics-note','Filtros aplicados: '+visual(envelope.scope.filtros)));
  const metrics=node('div','metrics');
  for(const row of rows.filter(r=>r.agrupacion==='total')){
    const quantity=row.unidad==='UN'&&row.cantidadMillares!==undefined?`${reportNumber(row.cantidadMillares)} millares`:`${reportNumber(row.cantidad)} ${row.unidad}`;
    const metric=node('div','metric');metric.append(node('span','',reportCurrency(row)),node('strong','',reportNumber(row.importeNeto)),node('span','',quantity),node('span','',`${row.documentos} documentos · ${row.lineas} ítems`));if(row.drilldown){const detail=node('button','text-button','Ver documentos');detail.onclick=()=>openDashboardDocuments(row.drilldown);metric.append(detail);}metrics.append(metric);
  }
  card.append(metrics,node('p','metrics-note','Totales del alcance completo. Monedas y unidades separadas; los importes no incluyen automáticamente impuestos ni fletes.'));
  if(!rows.length)card.append(node('p','empty','No hay movimientos para estos filtros.'));
  if(comparison&&envelope.comparison)card.append(comparisonChart(envelope.comparison));
  const groups=new Map();
  for(const row of rows.filter(r=>r.agrupacion==='detalle')){
    const key=`${reportCurrency(row)} · ${row.unidad==='UN'?'millares':row.unidad}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
  }
  if(comparison&&envelope.comparison?.available&&envelope.scope.agrupar==='mes')groups.clear();
  for(const [key,items] of groups){
    if(envelope.scope.agrupar!=='mes')items.sort((a,b)=>Number(b.importeNeto)-Number(a.importeNeto));
    card.append(node('h4','',key));
    const chart=node('div','summary-bars'),max=Math.max(...items.map(r=>Math.abs(Number(r.importeNeto))),1);
    for(const row of items.slice(0,24)){
      const line=node(row.drilldown?'button':'div','summary-bar'),bar=node('div','summary-bar-fill');if(row.drilldown){line.type='button';line.title='Ver documentos de '+row.dimension;line.onclick=()=>openDashboardDocuments(row.drilldown);}
      bar.style.width=`${Math.abs(Number(row.importeNeto))/max*100}%`;bar.classList.toggle('negative',Number(row.importeNeto)<0);
      const dimension=envelope.scope.agrupar==='mes'&&/^\d{6}$/.test(row.dimension)?new Date(Number(row.dimension.slice(0,4)),Number(row.dimension.slice(4))-1,1).toLocaleDateString('es-AR',{month:'long',year:'numeric'}):row.dimension;
      line.append(node('span','',`${dimension} · ${visual(String(row.importeNeto))}`),bar);line.title=`${row.dimension}: ${row.importeNeto} · ${key}`;chart.append(line);
    }
    card.append(chart);if(items.length>24)card.append(node('p','metrics-note',envelope.scope.agrupar==='mes'?'Gráfico: primeros 24 meses. Tabla y CSV incluyen todo el período.':'Gráfico: las 24 agrupaciones con mayor importe neto. Tabla y CSV incluyen todas.'));
  }
  if(rows.length){const details=node('details','dashboard-values');details.append(node('summary','','Ver tabla completa'),table(dashboardRows(rows)));card.append(details);}
  if(envelope.limitations?.length){const details=node('details');details.append(node('summary','','Cómo se calculó'),node('p','result-notes',envelope.limitations.join(' ')));card.append(details);}
  if(append)where.append(card);else where.replaceChildren(card);return card;
}
window.addEventListener('afterprint',()=>{document.body.classList.remove('printing-dashboard');document.querySelectorAll('.printing-report').forEach(e=>e.classList.remove('printing-report'));});
function renderQuality(where,envelope,append=false){
  const data=envelope.data||{},section=node('div');section.append(node('h3','','Calidad · estados registrados'));
  const metrics=node('div','metrics'),names={noConformidades:'No conformidades',problemas:'Problemas',ppap:'PPAP',msa:'Estudios MSA',capacidad:'Capacidad'};
  Object.entries(data.domains||{}).forEach(([key,domain])=>{
    const count=(domain.conteos||[]).reduce((n,row)=>n+Number(row.cantidad||0),0),m=node('div','metric');m.append(node('span','',names[key]||key),node('strong','',(domain.hasMore?'≥ ':'')+count),node('span','','registros en el alcance'));metrics.append(m);
  });section.append(metrics,node('p','metrics-note',`KAIQEN · ${stamp(envelope.fetchedAt)}. Estos son conteos de registros por dominio; no un semáforo de aprobación. La etapa de vida y el semáforo global no se recalculan en esta conexión.`));
  Object.entries(data.domains||{}).forEach(([key,domain])=>{
    if(domain.conteos?.length)renderResult(section,{data:domain.conteos,origen:'kaiqen',fetchedAt:envelope.fetchedAt},(names[key]||key)+' · conteos por estado',{append:true});
    if(domain.registros?.length)renderResult(section,{data:domain.registros,origen:'kaiqen',fetchedAt:envelope.fetchedAt,pagination:{hasMore:domain.recordsHasMore}},(names[key]||key)+' · registros',{append:true});
  });
  if(data.issueStatusCatalog?.length){const d=node('details','result-notes');d.append(node('summary','','Catálogo de estados de problemas'),table(data.issueStatusCatalog));section.append(d);}
  if(!Object.keys(data.domains||{}).length)section.append(node('p','empty','La fuente no devolvió dominios de calidad.'));
  if(append)where.append(section);else where.replaceChildren(section);
}
function switchView(view){
  if(view==='access')loadAccessPanel();
  if(view==='attention')attention?.load();
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!==view));document.querySelectorAll('.nav').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);el.setAttribute('aria-current',el.dataset.view===view?'page':'false');});
  $('#page-name').textContent={attention:'Necesita tu atención',assistant:'Asistente',explorer:'Explorar ERP',projects:'Proyectos y calidad',sources:'Conexiones',access:'Usuarios y roles'}[view];
  if(view==='projects'&&!$('#project-list').children.length)loadProjects();if(view==='sources')renderSources();
}
document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>switchView(el.dataset.view));
async function query(text,dashboard,extraContext={}){
  if(!text.trim()||$('#send').disabled)return;
  if(attachments?.busy){notice('Esperá a que termine la lectura del archivo.');return;}
  if(attachments?.id)document.dispatchEvent(new CustomEvent('attachment-revised',{detail:attachments.id}));
  attachments?.setChatBusy(true);
  switchView('assistant');const conversation=$('#conversation'),q=node('div','question');q.append(node('span','',text));conversation.append(q);const result=node('div');conversation.append(result);busy(result);
  $('#send').disabled=true;$('#new-chat').disabled=true;const started=Date.now();const timer=setInterval(()=>{const loading=result.querySelector('.loading');if(loading)loading.textContent=`Interpretando y consultando las fuentes · ${Math.round((Date.now()-started)/1000)} s`;},1000);
  try{const response=await api('/api/agent/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,conversationId,...(dashboard?{dashboard}:{}),attachmentId:dashboard?undefined:attachments?.id,topic:$('#topic').value,context:{sucursal:$('#branch').value,...extraContext,...(selectedProject?{proyecto:selectedProject.id}:{})}})});
    if(response.selectedBranch)$('#branch').value=response.selectedBranch;
    attachments?.receive(response.attachment);
    conversationId=response.conversationId;localStorage.setItem('central-conversation-id',conversationId);renderAnswer(result,response);
    $('#query').value='';
  }catch(error){if(error.code==='CONVERSACION_NO_EXISTE'){conversationId=undefined;localStorage.removeItem('central-conversation-id');}showError(result,error);}finally{attachments?.setChatBusy(false);clearInterval(timer);$('#send').disabled=false;$('#new-chat').disabled=false;result.scrollIntoView({behavior:'smooth',block:'nearest'});}
}
function renderAnswer(where,response){
  const metadata=response.attention?'Lectura estructurada · fuente y última verificación en cada tarjeta':response.attachment?`${response.attachment.name} · ${response.batch?'Comparación con registros de Protheus':'Lectura local del adjunto'}`:`${response.model||'Modelo local'} · ${response.evidence?.length||0} fuentes consultadas en este turno`;
  const card=node('article','answer-card');card.append(node('div','eyebrow',response.local===false?'CENTRAL · IA EXTERNA':'CENTRAL · ASISTENTE'),formatAnswer(response.answer),node('div','result-meta',metadata));where.replaceChildren(card);
  if(response.learnedExpressions?.length)card.append(node('p','result-meta','Usé tus expresiones aprendidas: '+response.learnedExpressions.join(', ')+'.'));
  if(response.learningNotice)card.append(node('p','learning-notice',response.learningNotice));
  if(response.job)investigations?.render(where,response.job);
  if(response.jobs)for(const job of response.jobs)investigations?.render(where,job);
  if(response.untrustedDocument)where.append(node('p','notice','Documento externo: su contenido se muestra como datos. No se ejecutan instrucciones ni se envía a la IA.'));
  if(response.attention)attention?.render(where,response.attention);
  if(response.investigation)attention?.renderInvestigation(where,response.investigation);
  if(response.attentionChanges)attention?.renderChanges(where,response.attentionChanges);
  if(response.batch)renderImportBatch(where,response.batch,{api,capabilities});
  if(response.proposal)renderProposal(where,response.proposal);
  if(response.comparison)where.append(comparisonChart(response.comparison));
  if(response.historyExport){const target=response.historyExport,button=node('button','secondary','Descargar historial en Excel');button.onclick=async()=>{button.disabled=true;try{const query=new URLSearchParams(target.filters||{}),r=await fetch('/api/dashboards/'+encodeURIComponent(target.id)+'/history.xlsx?'+query,{credentials:'same-origin',cache:'no-store'});if(!r.ok){const problem=await r.json();throw new Error(problem.error?.message||'No se pudo descargar el historial.');}const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='historial-dashboard.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){notice(error.message);}finally{button.disabled=false;}};card.append(button);}
  if(response.choices?.length){const choices=node('div','choice-list');for(const choice of response.choices){const button=node('button','secondary',choice.label);button.type='button';button.onclick=()=>query(choice.text);choices.append(button);}card.append(choices);}
  for(const evidence of response.evidence||[]){
    const result=evidence.result,heading=evidence.id+' · '+(evidence.action==='precio_venta'?(result.kind==='prices'?'Precios de lista verificados':'Consulta de precios'):labels[evidence.args.recurso]||evidence.action);
    const details=node('details','evidence');details.append(node('summary','',heading));
    if(response.investigation&&result.kind==='dashboard'){renderDashboard(details,result,result.title||heading,{append:true});where.append(details);continue;}
    if(response.investigation&&result.kind==='commercial'){renderDocuments(details,result,labels[evidence.args.recurso]||'Documentos vinculados');where.append(details);continue;}
    if(result.kind==='dashboard'){renderDashboard(where,result,result.title||heading,{append:true,comparison:!response.comparison});continue;}
    if(result.kind==='commercial'){const detail=node('section');where.append(detail);renderDocuments(detail,result,labels[evidence.args.recurso]||'Documentos del importe');continue;}
    if(result.kind==='prices'){renderResult(where,{...result,data:result.data.map(r=>({producto:r.productoCodigo,descripcion:r.productoNombre,lista:r.listaCodigo,clienteLista:r.listaNombre,moneda:r.moneda,precioPorUnidad:r.precio,precioPorMillar:r.precioPorMillar,unidad:r.unidadMedida,elegibilidad:r.elegibilidad}))},heading,{append:true});continue;}
    if(result.kind==='priceAdjustment'){renderResult(where,result,heading,{append:true});if(result.excluded?.length)renderResult(where,{data:result.excluded},'Registros excluidos: sin vigencia activa',{append:true});if(result.failures?.length)renderResult(where,{data:result.failures},'Registros que requieren revisión',{append:true});continue;}
    if(result.kind==='proposal'){renderProposal(where,result.proposal);continue;}
    if(result.candidates?.length){const choices=node('div','choice-list');result.candidates.forEach(candidate=>{const code=candidate.codigo||candidate.id;const b=node('button','secondary',[code,candidate.nombre||candidate.name,candidate.tienda?'Tienda '+candidate.tienda:''].filter(Boolean).join(' · '));b.onclick=()=>query(`Me refiero a ${code}${candidate.tienda?' tienda '+candidate.tienda:''}. Respondé la consulta anterior para esa opción.`);choices.append(b);});card.append(choices);renderResult(details,{...result,data:result.candidates},heading,{append:true});}
    else if(evidence.action==='calidad')renderQuality(details,result,true);
    else if(Array.isArray(result.data))renderResult(details,result,'Detalle de la fuente',{append:true});
    else{const pre=node('pre','raw-evidence',JSON.stringify(result.data||result,null,2));details.append(pre);}
    where.append(details);
  }
  if(response.trace?.some(t=>t.status==='error'))card.append(node('p','metrics-note','Alguna fuente no estuvo disponible: '+response.trace.filter(t=>t.status==='error').map(t=>t.code).join(', ')));
}
$('#new-chat').onclick=()=>{attachments?.clear();conversationId=undefined;localStorage.removeItem('central-conversation-id');$('#conversation').replaceChildren();notice('Nueva conversación. Las clasificaciones guardadas siguen disponibles.');};
async function loadKnowledge(){const content=$('#knowledge-list');busy(content);try{const result=await api('/api/agent/knowledge');content.replaceChildren();if(!result.data.length)content.append(node('p','metrics-note','Todavía no guardaste clasificaciones.'));for(const item of result.data){const row=node('div','knowledge-row');row.append(node('strong','',item.term),node('p','',item.meaning),node('small','',item.topic));const remove=node('button','text-button','Olvidar');remove.onclick=async()=>{await api('/api/agent/knowledge/'+item.id,{method:'DELETE'});loadKnowledge();};row.append(remove);content.append(row);}}catch(error){showError(content,error);}}
$('#teach').onclick=()=>{$('#knowledge-dialog').showModal();loadKnowledge();};$('#close-knowledge').onclick=()=>$('#knowledge-dialog').close();
$('#knowledge-form').onsubmit=async event=>{event.preventDefault();const status=$('#knowledge-status');try{await api('/api/agent/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:$('#topic').value,term:$('#knowledge-term').value,meaning:$('#knowledge-meaning').value})});status.textContent='Guardado. Se usará para interpretar las próximas consultas; los valores se leerán nuevamente en las fuentes.';$('#knowledge-form').reset();loadKnowledge();}catch(error){status.textContent=error.message;}};
$('#query-form').onsubmit=event=>{event.preventDefault();query($('#query').value);};
$('#query').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();query($('#query').value);}};
document.querySelectorAll('[data-query]').forEach(el=>el.onclick=()=>query(el.dataset.query));
function resourceMeta(resource){return capabilities?.erp?.entities?.[resource==='remitos'?'documentosSalida':resource]||{};}
function updateErpResources(){
 const selected=$('#resource').value,values=new Map([...document.querySelectorAll('#filters [name]')].map(n=>[n.name,n.value]));
 $('#resource').replaceChildren();
 const resources=Object.keys(capabilities.erp.entities||{}).filter(k=>!capabilities.erp.entities[k].operational);
 const keys=[...resources,...(resources.includes('documentosSalida')&&!resources.includes('remitosEmitidos')?['remitos']:[]),...(resources.includes('ventas')?['entregas']:[])];
 for(const key of keys){const o=node('option','',labels[key]||key);o.value=key;$('#resource').append(o);}
 $('#resource').value=keys.includes(selected)?selected:resources.includes('costos')?'costos':resources[0]||'';
 if(resources.length){buildFilters();if($('#resource').value===selected)for(const n of document.querySelectorAll('#filters [name]'))if(values.has(n.name))n.value=values.get(n.name);}
 else $('#resource-status').textContent='El catálogo estará disponible cuando se conecte Protheus.';
}
function buildFilters(){
  const resource=$('#resource').value,meta=resourceMeta(resource),container=$('#filters');container.replaceChildren();
  const keys=Object.keys(meta.filters||{}).filter(k=>k!=='sucursal'&&!(resource==='remitos'&&k==='tipoDocumento'));
  if(meta.fechaFiltro)keys.push('desde','hasta');if(meta.pendiente)keys.push('pendiente');
  for(const key of keys){const label=node('label','',title(key));let input;
    if(key==='pendiente'){input=node('select');[['','Todos'],['true','Con saldo técnico'],['false','Sin saldo técnico']].forEach(([v,t])=>{const o=node('option','',t);o.value=v;input.append(o);});}
    else if(key==='agrupar'||key==='clase'){input=node('select');const options=key==='agrupar'?['mes','tercero','producto','clase']:['','NF','NC','ND'];options.forEach(v=>{const o=node('option','',v||'Todas');o.value=v;input.append(o);});}
    else{input=node('input');input.type=['desde','hasta'].includes(key)?'date':'text';input.placeholder=key==='registro'?'Registro exacto':'Código exacto';input.maxLength=128;}
    if(key==='q')input.placeholder='Nombre o parte del código';input.name=key;label.append(input);container.append(label);
  }
  $('#resource-status').textContent=resource==='entregas'?'La confirmación de recepción física requiere un conector logístico.':meta.requiereConfigurarSucursal?'Pendiente de confirmar sucursal en el conector. No se interpretará como cero registros.':`${meta.alias||''} · Filtros exactos${meta.pendiente?' · Pendientes = saldo técnico':''}`;
  $('#explorer-result').replaceChildren();$('#pagination').classList.add('hidden');activeParams=null;
}
$('#resource').onchange=buildFilters;
$('#branch').onchange=()=>{buildFilters();notice('Sucursal cambiada. Los resultados anteriores conservan el alcance de su consulta; volvé a consultar para actualizarlos.');};
$('#explorer-form').onsubmit=event=>{event.preventDefault();page=1;activeResource=$('#resource').value;activeParams=new URLSearchParams({sucursal:$('#branch').value,limit:$('#limit').value});for(const [k,v] of new FormData($('#explorer-form')))if(String(v).trim())activeParams.set(k,String(v).trim());loadResource();};
let resourceBusy=false;
async function loadResource(){
  if(!activeParams||resourceBusy)return;resourceBusy=true;const where=$('#explorer-result');busy(where);$('#pagination').classList.add('hidden');$('#explorer-form button[type=submit]').disabled=true;
  try{const params=new URLSearchParams(activeParams);params.set('page',String(page));const result=await api('/api/erp/'+activeResource+'?'+params);renderResult(where,result,labels[activeResource]);$('#pagination').classList.toggle('hidden',result.status==='not_configured'||result.kind==='dashboard');$('#page-label').textContent='Página '+page;$('#prev').disabled=page<=1;$('#next').disabled=!(result.meta?.hasMore||result.pagination?.hasMore);}
  catch(error){showError(where,error);}finally{resourceBusy=false;$('#explorer-form button[type=submit]').disabled=false;}
}
$('#prev').onclick=()=>{if(!resourceBusy){page--;loadResource();}};$('#next').onclick=()=>{if(!resourceBusy){page++;loadResource();}};
let projectsBusy=false,detailVersion=0;
async function loadProjects(more=false){
  if(projectsBusy)return;projectsBusy=true;const where=$('#project-list');if(!more){projectOffset=0;busy(where);}
  $('#more-projects').disabled=true;
  try{const response=await api('/api/kaiqen/projects?'+new URLSearchParams({limit:'50',offset:String(projectOffset),...(projectQuery?{q:projectQuery}:{})}));if(!more)where.replaceChildren();
    const rows=response.data||[];if(!rows.length&&!more)where.append(node('div','empty','No se encontraron proyectos.'));
    rows.forEach(p=>{const card=node('button','project-card');card.dataset.id=p.id;card.classList.toggle('selected',p.id===selectedProject?.id);card.append(node('span','code',p.code||'PROYECTO'),node('h3','',p.name||'Sin nombre'),node('p','',p.customer||'Sin cliente informado'),node('p','',p.part_number?[p.part_number,p.part_name].filter(Boolean).join(' · '):'Pieza sin informar'));const foot=node('div','project-foot');foot.append(node('span','',p.current_phase_name||'Fase no informada'),node('span','','Ver proyecto →'));card.append(foot);card.onclick=()=>loadProject(p);where.append(card);});
    projectOffset+=rows.length;$('#more-projects').classList.toggle('hidden',!response.pagination?.hasMore);
  }catch(error){showError(where,error);}finally{projectsBusy=false;$('#more-projects').disabled=false;}
}
$('#project-search').onsubmit=event=>{event.preventDefault();projectQuery=$('#project-q').value.trim();loadProjects();};$('#refresh-projects').onclick=()=>loadProjects();$('#more-projects').onclick=()=>loadProjects(true);
async function loadProject(project){
  selectedProject=project;document.querySelectorAll('.project-card').forEach(el=>el.classList.toggle('selected',el.dataset.id===project.id));
  const version=++detailVersion,where=$('#project-detail');busy(where,'Consultando proyecto, calidad y vínculo ERP…');
  try{const overview=await api('/api/overview/projects/'+encodeURIComponent(project.id));if(version!==detailVersion)return;where.replaceChildren();const heading=node('div','project-detail-heading');heading.append(node('div','eyebrow','PROYECTO SELECCIONADO'),node('h2','',project.name));where.append(heading);
    const detail=overview.project.data;
    if(detail.derivedStateAvailable===false)where.append(node('p','metrics-note','La fuente proporciona fases y estados guardados. La etapa de vida oficial y el semáforo global no están disponibles en esta conexión.'));
    renderResult(where,{data:detail.phases||[],origen:'kaiqen',fetchedAt:overview.project.fetchedAt},'Fases del proyecto',{append:true});
    if(detail.gates?.length)renderResult(where,{data:detail.gates,origen:'kaiqen',fetchedAt:overview.project.fetchedAt},'Gates / revisiones',{append:true});
    if(detail.lifecycleEvents?.length)renderResult(where,{data:detail.lifecycleEvents,origen:'kaiqen',fetchedAt:overview.project.fetchedAt},'Eventos de ciclo de vida',{append:true});
    if(Object.values(detail.truncated||{}).some(Boolean))where.append(node('p','metrics-note','Algunas secciones del proyecto alcanzaron el límite de lectura; la lista es parcial.'));
    if(overview.quality.status==='ok')renderQuality(where,overview.quality,true);else where.append(node('div','error-box','No se pudo consultar la calidad. El resto del proyecto sigue disponible.'));
    const link=overview.erpLink.data,ref=overview.reference;const panel=node('div','panel');panel.append(node('h3','','Referencia ERP para cotización'));
    if(link?.articulo_referencia){const item=link.articulo_referencia;panel.append(node('p','metrics-note',`${item.codigo} · ${item.nombre} · Sucursal ${item.sucursal}`));}else panel.append(node('p','metrics-note','No se encontró una referencia de cotización vinculada explícitamente.'));
    panel.append(node('p','metrics-note','La referencia para cotizar puede diferir del producto definitivo. No se cruzan artículos por similitud de nombre.'));where.append(panel);
    if(ref.status==='ok')renderResult(where,ref.costs,'Costos del artículo de referencia',{append:true});else if(ref.status==='unavailable')where.append(node('div','error-box','La referencia existe, pero no se pudieron consultar sus costos.'));
    if(link?.piezasDetalle?.length)renderResult(where,{data:link.piezasDetalle,origen:'kaiqen',pagination:{hasMore:link.hasMore}},'Piezas del proyecto y vínculos ERP',{append:true});
    const ask=node('button','secondary','Consultar la calidad de este proyecto por texto →');ask.onclick=()=>{$('#query').value='calidad de este proyecto';switchView('assistant');$('#query').focus();};where.append(ask);heading.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){if(version===detailVersion)showError(where,error);}
}
function renderSources(){
  const where=$('#sources-content');corporateUI?.destroy?.();knowledgeUI?.destroy?.();where.replaceChildren();if(!capabilities)return;
  const request=(path,options={})=>api(path,{...options,...(options.body&&typeof options.body==='object'?{headers:{'Content-Type':'application/json'},body:JSON.stringify(options.body)}:{})});
  corporateUI=installCorporateDocumentsUI({container:where,request,isAdmin:capabilities.user?.admin===true});
  knowledgeUI=installApprovedKnowledgeUI({container:where,request,isAdmin:capabilities.user?.admin===true});
  const states=node('p','notice','Comprobando disponibilidad de las fuentes…');where.append(states);void api('/api/sources/status').then(s=>{if(states.isConnected)states.textContent='Protheus: '+(s.erp.available?'disponible':'pendiente de conexión')+' · KAIQEN: '+(s.kaiqen.available?'disponible':s.kaiqen.state==='not_configured'?'sin configurar':'pendiente de conexión')+' · IA: '+(s.ai.available?(s.ai.local||s.ai.connectionVerified?'disponible':'configurada, sin verificar'):'pendiente de conexión o configuración');if(states.isConnected){const details=node('details'),asOf=(label,value)=>node('p','result-meta',label+': '+(value?new Date(value).toLocaleString('es-AR'):'sin lectura exitosa en este proceso'));details.append(node('summary','','Últimas comprobaciones'),asOf('Protheus · última lectura',s.erp.lastReadSuccess),asOf('Protheus · conexión',s.erp.lastConnected),asOf('KAIQEN · última lectura',s.kaiqen.lastSuccess),asOf('IA · última respuesta',s.ai.lastSuccessAt));states.after(details);}}).catch(()=>{states.textContent='No se pudo comprobar la disponibilidad actual.';});
  const erp=node('div','source-card');erp.append(node('h3','','Protheus · Argentina 2510'),node('p','',`Modo ${capabilities.mode==='live'?'real':'DEMO'} · sucursales permitidas: ${capabilities.branches.join(', ')}. Las consultas se realizan al pedir información; la disponibilidad de cada recurso se verifica con su respuesta.`));
  const list=node('div','source-list');Object.entries(capabilities.erp.entities||{}).forEach(([key,m])=>{const row=node('div','source-item');row.append(node('span','',labels[key]||key),node('small','',!m.disponible?'No disponible':m.requiereConfigurarSucursal?'Requiere sucursal':'Configurado · '+m.alias));list.append(row);});erp.append(list);where.append(erp);
  if(capabilities.writePolicy){const writes=node('div','source-card');writes.append(node('h3','','Actualizaciones · SQL controlado'),node('p','',capabilities.writePolicy.description),node('p','',capabilities.writePolicy.creditLimitation));where.append(writes);}
  const k=node('div','source-card');k.append(node('h3','','KAIQEN'),node('p','',`${capabilities.kaiqen.configured?'Conexión configurada':'Sin conexión configurada'} · ${capabilities.kaiqen.source==='postgres'?'Lectura PostgreSQL de la planta configurada':'API'}. Proyectos, fases, registros de calidad y referencias ERP. No reproduce los permisos individuales ni el semáforo calculado de la aplicación.`));where.append(k);
  const voice=node('div','source-card');voice.append(node('h3','','Voz y aplicación local'),node('p','',`${capabilities.voice.available?'Whisper base instalado':'Transcripción no disponible'} · Audio procesado en este equipo. Los archivos temporales se borran al terminar. La PWA conserva únicamente su interfaz para abrir sin conexión; no guarda los datos consultados.`),node('p','','Asistente con IA configurable, búsqueda por nombre, consultas encadenadas y memoria del negocio. Prepara modificaciones; la ejecución se confirma desde la tarjeta de revisión.'));where.append(voice);
}
let recorder,recordStream,recordTimer,elapsedTimer,voiceBusy=false;
function stopRecording(){if(recorder?.state==='recording')recorder.stop();clearTimeout(recordTimer);clearInterval(elapsedTimer);recordStream?.getTracks().forEach(track=>track.stop());$('#mic').classList.remove('recording');}
async function record(){
  if(recorder?.state==='recording'){stopRecording();return;}if(voiceBusy)return;
  const status=$('#voice-status');
  if(!capabilities?.voice.available){status.textContent='La transcripción local no está instalada. Podés consultar por texto.';return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){status.textContent='Este navegador no permite grabar. Abrí http://127.0.0.1:4310 en Microsoft Edge.';return;}
  voiceBusy=true;$('#mic').disabled=true;
  try{
    recordStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
    const type=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
    recorder=new MediaRecorder(recordStream,type?{mimeType:type}:{});const chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=async()=>{
      stopRecording();$('#mic').disabled=true;status.textContent='Transcribiendo en este equipo…';
      try{const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});const result=await api('/api/voice/transcribe',{method:'POST',headers:{'Content-Type':blob.type},body:blob});if(!result.text.trim()){status.textContent='No se detectó voz. Acercate al micrófono y probá otra vez.';}else{$('#query').value=result.text;status.textContent='Texto listo. Revisalo y presioná Consultar.';$('#query').focus();}}
      catch(error){status.textContent=error.message;}finally{voiceBusy=false;$('#mic').disabled=false;$('#mic').textContent='♩ Dictar';$('#mic').setAttribute('aria-label','Grabar consulta de voz');}
    };
    recorder.onerror=()=>{status.textContent='No se pudo grabar. Probá otra vez.';stopRecording();};
    recorder.start();$('#mic').disabled=false;$('#mic').classList.add('recording');$('#mic').textContent='■ Detener';$('#mic').setAttribute('aria-label','Detener grabación');
    const started=Date.now();const tick=()=>{status.textContent=`Grabando · ${Math.floor((Date.now()-started)/1000)} / 45 s · Presioná Detener al terminar.`;};tick();elapsedTimer=setInterval(tick,1000);recordTimer=setTimeout(stopRecording,45_000);
  }catch(error){recordStream?.getTracks().forEach(track=>track.stop());voiceBusy=false;$('#mic').disabled=false;status.textContent=error.name==='NotAllowedError'?'Permití el uso del micrófono desde el icono de permisos del navegador.':error.name==='NotFoundError'?'No se encontró un micrófono conectado.':'No se pudo acceder al micrófono. Cerrá otras aplicaciones que lo estén usando.';}
}
$('#mic').onclick=record;window.addEventListener('pagehide',stopRecording);
$('#install-top').onclick=()=>$('#install').click();
window.addEventListener('appinstalled',()=>{$('#install-top').textContent='App instalada';$('#install-top').disabled=true;});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;$('#install').textContent='＋ Instalar Central';});
$('#install').onclick=async()=>{if(deferredInstall){await deferredInstall.prompt();deferredInstall=null;}else{$('#help-dialog').showModal();}};
$('#help').onclick=()=>$('#help-dialog').showModal();$('#close-help').onclick=()=>$('#help-dialog').close();
window.addEventListener('offline',()=>notice('Sin conexión. La interfaz está disponible, pero las consultas requieren el servicio local y acceso a las fuentes.'));
window.addEventListener('online',()=>notice('Conexión recuperada. Volvé a consultar para actualizar la información.'));
const canExecuteAction=action=>capabilities?.canExecute&&(capabilities.user?.admin||capabilities.user?.unrestricted||capabilities.user?.permissions?.includes('write:'+action));
async function start(){
  try{const user=await accessReady();if(localStorage.getItem('central-access-actor')!==user.actor){conversationId=undefined;for(const key of Object.keys(localStorage))if(key.startsWith('central-'))localStorage.removeItem(key);localStorage.setItem('central-access-actor',user.actor);}await session();capabilities=await api('/api/capabilities');if(capabilities.user?.admin)loadAiSettings();renderAutomationStatus(capabilities.approvalAutomation);$('#automation-refresh').disabled=!capabilities.canExecute;$('#connection').textContent=capabilities.mode==='live'?'Servicio real':'Modo DEMO';$('#connection').classList.toggle('warn',capabilities.mode!=='live');
    capabilities.branches.forEach(v=>{const o=node('option','',v);o.value=v;$('#branch').append(o);});
    updateErpResources();
    $('#voice-status').textContent=capabilities.voice.available?'Dictado en español · transcripción local · hasta 45 segundos':'Transcripción local no instalada. Las consultas por texto están disponibles.';
    api('/api/agent/status').then(status=>{if(status.languageLearningVersion)languageButton.classList.remove('hidden');if(status.priceContextVersion<3||!status.priceContextVersion)notice('Está activo el servicio anterior. Reiniciá Central para aplicar las correcciones del chat y del contexto de precios.');$('#ai-status').textContent=status.available?(status.local===false?'IA externa configurada · ':'IA local activa · ')+status.model:'Motor de IA no disponible';}).catch(()=>{$('#ai-status').textContent='No se pudo verificar el modelo';});
    if(conversationId){try{const history=await api('/api/agent/conversations/'+conversationId);const conversation=$('#conversation');for(const message of history.messages){if(message.role==='user'){const q=node('div','question');q.append(node('span','',message.content));conversation.append(q);}else{let saved;try{saved=JSON.parse(message.content);}catch{continue;}const a=node('article','answer-card');a.append(node('div','result-meta','Conversación anterior · valores históricos, consultá nuevamente para actualizarlos'),formatAnswer(saved.answer));conversation.append(a);}}}catch{conversationId=undefined;localStorage.removeItem('central-conversation-id');}}
    attention=installAttention({api,branch:()=>$('#branch').value,switchView,notice,revision:capabilities.user?.revision,canPrepare:kind=>Boolean(capabilities.proposalActions?.[kind==='sale'?'pedidoVenta':kind==='purchase'?'pedidoCompra':'']),ask:(text,id,targetBranch)=>{if(targetBranch)$('#branch').value=targetBranch;return query(text,undefined,{attentionId:id});}});void attention.load();
    if(new URLSearchParams(location.search).get('attention')==='updates'){void attention.openUpdates();history.replaceState(null,'',location.pathname);}
    if(operationalPending)notice('Actualización pendiente de reinicio. Las funciones anteriores siguen disponibles.');
    investigations?.destroy();investigations=installInvestigations({api,container:document.querySelector('#attention'),branch:()=>$('#branch').value,notice,onResult:result=>{switchView('assistant');const target=node('div','');$('#conversation').append(target);renderAnswer(target,result);target.scrollIntoView({behavior:'smooth',block:'start'});}});
    $('#branch').addEventListener('change',()=>{attention?.load();investigations?.load();});
    if(capabilities.mode==='live'&&capabilities.erp.connection)installErpConnection({api,initial:capabilities.erp.connection,onChange:async()=>{
      const next=await api('/api/capabilities');if(next.user?.actor!==capabilities.user?.actor){location.reload();return;}
      Object.assign(capabilities,next);updateErpResources();await attention.load();
    }});
    attachments=installPriceImports({api,capabilities});
    $('#branch').addEventListener('change',()=>attachments?.clear());
    await restoreProposal();
  }catch(error){$('#connection').textContent='Sin servicio';$('#connection').classList.add('warn');notice(error.message);$('#send').disabled=true;$('#mic').disabled=true;}
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>notice('El navegador no permitió el modo instalable. Las consultas siguen disponibles.'));
}
start();

function renderProposal(where,proposal,{append=true}={}){
  localStorage.setItem('central-last-proposal',proposal.id);
  const card=node('article','result-card'),result=node('div'),controls=node('div','filter-bottom');
  if(proposal.origin){const source=node('details');source.append(node('summary','',`Origen: ${proposal.origin.archivo} · ${proposal.origin.ubicacion}`),node('pre','',proposal.origin.lecturaOriginal));card.append(source);}
  card.append(node('h3','',proposal.operation==='insert'?'Revisar documento nuevo · '+(proposal.action==='crearPedidoCompra'?'Pedido de compra':proposal.identity.tipoSolicitud||'Solicitud de compra'):'Revisar cambio · '+proposal.action),node('p','',`Sucursal ${proposal.target.sucursal} · ${proposal.operation==='insert'?'documento nuevo — numeración al confirmar':proposal.operation==='workflow'?'circuito del documento '+proposal.identity.numero:'registro '+proposal.target.registro} · vence ${stamp(proposal.expiresAt)}`));
  if(proposal.operation==='insert'){
    if(proposal.calculation?.tipoCambio)card.append(node('p','',`Moneda del archivo: ${proposal.calculation.monedaOrigen}. Cotización: 1 ${proposal.calculation.monedaOrigen} = ${proposal.calculation.tipoCambio} ${proposal.calculation.monedaLocal} · ${proposal.calculation.fechaCotizacion} · ${proposal.calculation.fuenteCotizacion}.`));
    if(proposal.calculation?.tratamiento)card.append(node('p','notice',proposal.calculation.tratamiento));
    card.append(table([{proveedor:proposal.identity.proveedor,tienda:proposal.identity.tienda,solicitante:proposal.identity.solicitante,fechaEmision:proposal.identity.fechaEmision,condicionPago:proposal.identity.condicionPago,moneda:proposal.identity.moneda}]),
      table(proposal.items.map(r=>({producto:r.producto,descripcion:r.descripcion,cantidad:r.cantidadComercial,baseCantidad:r.baseCantidad,precio:r.precioComercial,monedaOrigen:r.monedaOriginal,basePrecio:r.basePrecio,totalOriginal:r.totalOriginal,totalERP:r.total,monedaERP:r.moneda}))),
      table(proposal.items.map(r=>({producto:r.producto,deposito:r.deposito,fechaNecesidad:r.fechaNecesidad,cantidadERP:r.cantidad,unidad:r.unidad,precioUnitario:r.precioUnitario}))));
    const full=node('details');full.append(node('summary','','Ver todos los datos del documento'),table([proposal.identity]),table(proposal.items));card.append(full);
  }else card.append(table([proposal.identity||{}]),table(proposal.diff.map(d=>({...d.table?{tabla:d.table,registro:d.record,secuencia:d.sequence||''}:{},campo:d.field,antes:d.before,despues:d.after}))));
  if(proposal.before?.moneda)card.append(node('p','',`Moneda conservada: ${visual(proposal.before.moneda)}`));
  if(proposal.calculation)card.append(table([proposal.calculation]));
  if(proposal.approval){card.append(node('h4','','Aprobación · '+proposal.approval.field),node('p','',proposal.approval.label));for(const reason of proposal.approval.reasons)card.append(node('p','',reason));card.append(table(proposal.approval.parameters.map(p=>({...p,filial:p.filial||'Global',valor:p.valor??'No disponible'}))));}
  if(proposal.approval?.circuit?.entries.length){card.append(node('h4','','Circuito pendiente en Protheus'),table(proposal.approval.circuit.entries.map(e=>({tipo:e.tipo,grupo:e.grupo,itemGrupo:e.itemGrupo,nivel:e.nivel,aprobador:e.aprobador,usuario:e.usuario,importe:e.total,perfil:e.perfil,estado:e.estado==='02'?'Pendiente':'Espera nivel anterior',liberacion:e.tipoLiberacion}))));}
  if(proposal.approval?.circuit?.stages?.length)card.append(node('h4','','Etapas'),table(proposal.approval.circuit.stages));
  if(proposal.approval?.circuit?.deferred?.length)card.append(node('h4','','PC después de IP'),table(proposal.approval.circuit.deferred.map(e=>({grupo:e.grupo,nivel:e.nivel,aprobador:e.aprobador,importe:e.total}))));
  const routes=[...(proposal.approval?.circuit?.entries||[]),...(proposal.approval?.circuit?.deferred||[])].filter(e=>e.superiores?.length);if(routes.length)card.append(node('h4','','Superiores configurados'),table(routes.map(e=>({tipo:e.tipo,grupo:e.grupo,aprobador:e.aprobador,superiores:e.superiores.map(u=>u.aprobador+' ('+u.usuario+', '+u.origen+')').join(' → ')}))));
  if(proposal.approval?.circuit?.excluded.length)card.append(node('h4','','Reglas no aplicables a este importe o documento'),table(proposal.approval.circuit.excluded));
  for(const warning of proposal.warnings||[])card.append(node('p','notice',warning.message));
  for(const blocker of proposal.blockers||[])card.append(node('p','notice',blocker.message));
  const check=node('input');check.type='checkbox';const label=node('label','confirm-change');label.append(check,document.createTextNode(' Revisé el registro, la moneda, los valores y las condiciones indicadas. Confirmo este cambio en el ERP.'));
  const execute=node('button','primary',proposal.operation==='insert'?'Confirmar y crear documento':'Confirmar y actualizar ERP'),refresh=node('button','secondary','Consultar estado');execute.type=refresh.type='button';
  execute.disabled=true;check.onchange=()=>{execute.disabled=!check.checked||!canExecuteAction(proposal.action)||!proposal.executionEnabled;};
  controls.append(execute,refresh);card.append(label,controls,result);let terminal=false;
  if(proposal.origin?.importacion)document.addEventListener('attachment-revised',event=>{
   if(event.detail===proposal.origin.importacion){terminal=true;check.checked=false;check.disabled=true;execute.disabled=true;result.textContent='La revisión cambió. Confirmá el resumen más reciente.';}
  });
  function status(execution){
    const names={executed:'Cambio SQL guardado y verificado. No implica aprobación nativa.',executing:'Ejecución en curso. No repitas el cambio.',failed:'No se confirmó el cambio. Revisá el error y generá una nueva propuesta.',unknown:'Resultado incierto. Verificá el registro en Protheus antes de preparar otro cambio.'};
    if(!execution){result.replaceChildren(node('p','',proposal.blockers?.length?'Propuesta sin ejecución habilitada: requiere revisión en Protheus.':'Propuesta pendiente de confirmación.'));return;}
    terminal=true;execute.disabled=true;check.disabled=true;result.replaceChildren(node('p','',names[execution.status]||execution.status));
    for(const warning of execution.result?.warnings||[])result.append(node('p','notice',warning.message));
    if(execution.result?.fields)result.append(table([execution.result.fields]));
    if(execution.result?.records)result.append(table(execution.result.records.map((registro,i)=>({registro,...execution.result.items[i]}))));
    if(execution.result?.relatedUpdates?.length)result.append(table(execution.result.relatedUpdates.map(u=>({tabla:u.alias,registro:u.record,secuencia:u.sequence,...u.updates}))));
    if(execution.result?.workflowRecords?.length)result.append(table(execution.result.workflowRecords));
    if(execution.status==='executed'&&(proposal.operation==='workflow'||proposal.operation==='insert'&&(routes.length||proposal.approval?.circuit?.twoStage))){const manage=node('button','secondary','Gestionar circuito de este documento');manage.type='button';manage.onclick=()=>{const origin=proposal.target.propuesta||proposal.id;const scr=execution.result?.circuits?.find(c=>c.table==='SCR');const ix=proposal.approval?.circuit?.entries.findIndex(e=>e.superiores?.length);const record=proposal.target.registro||(ix>=0?scr?.records[ix]:'')||'';$('#query').value=proposal.approval?.circuit?.twoStage?'Continuar aprobación de la propuesta '+origin:'Escalar al superior la aprobación de la propuesta '+origin+' registro SCR '+record;switchView('assistant');$('#query').focus();};result.append(node('p','','ID de propuesta de alta: '+(proposal.target.propuesta||proposal.id)),manage);}
    if(execution.result?.circuits?.length)result.append(node('h4','','Circuito creado'),table(execution.result.circuits.map(c=>({tabla:c.table,registros:c.affected,recnos:c.records.join(', ')}))));
    if(execution.result?.code)result.append(node('p','',execution.result.code));
  }
  refresh.onclick=async()=>{try{status((await api('/api/changes/'+proposal.id)).execution);}catch(e){showError(result,e);}};
  execute.onclick=async()=>{
    if(terminal||!check.checked)return;terminal=true;execute.disabled=true;check.disabled=true;busy(result,'Actualizando y verificando el registro…');
    localStorage.setItem('central-last-proposal',proposal.id);
    try{if(proposal.origin?.attention)await api('/api/changes/'+proposal.id+'/check',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},false);status(await api('/api/changes/'+proposal.id+'/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true,fingerprint:proposal.fingerprint})},false));}
    catch(e){if(proposal.origin?.attention&&['CONFLICTO_CONCURRENCIA','PROPUESTA_CAMBIO'].includes(e.code)){try{const renewed=await api('/api/changes/'+proposal.id+'/renew-attention',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},false);result.replaceChildren(node('p','notice',renewed.message));renderProposal(result,renewed.proposal,{append:true});return;}catch(error){showError(result,error);return;}}showError(result,e);result.append(node('p','','Consultá el estado con el botón de esta tarjeta. No se reenvía automáticamente el UPDATE.'));}
  };
  if(append)where.append(card);else where.replaceChildren(card);
  return {status};
}
async function restoreProposal(){
  const id=localStorage.getItem('central-last-proposal');if(!id||!Object.keys(capabilities?.proposalActions||{}).length)return;
  try{const saved=await api('/api/changes/'+id);if(saved.proposal.origin?.importacion&&saved.proposal.operation!=='insert')return;const where=$('#conversation');where.append(node('h2','','Última propuesta'));renderProposal(where,saved.proposal).status(saved.execution);}catch{/* La sesión anterior puede haber vencido. No reenviar escrituras. */}
}
function renderAutomationStatus(status){
  $('#automation-status').textContent=status?.enabled?`Activo · revisa vencimientos cada ${Math.round(status.intervalMs/1000)} segundos mientras el servicio local está funcionando. Última revisión: ${status.lastRun?stamp(status.lastRun):'iniciando'}. Transferencias: ${status.receipts?.executed||0}. ${status.lastError?'Error: '+status.lastError+'. ':''}${(status.receipts?.unknown||status.receipts?.executing)?'Hay resultados pendientes de conciliación. ':''}Usa el plazo y la transferencia habilitada en Protheus; no aprueba documentos.`:'Escalamiento automático desactivado en esta instalación.';
}
$('#automation-refresh').onclick=async()=>{
  const where=$('#automation-result');where.replaceChildren();
  try{const result=await api('/api/approvals/automation');renderAutomationStatus(result.status);where.append(node('h4','','Últimas transferencias'),table(result.receipts.map(r=>({fecha:r.at,estado:r.status,documento:r.identity.numero,tipo:r.identity.tipo,registro:r.identity.registro,vencimiento:r.identity.plazo,desde:r.result?.from||r.result?.planned?.from||'',hacia:r.result?.to||r.result?.planned?.to||'',motivo:r.result?.code||''}))),node('h4','','Incidencias registradas'),table(result.issues.map(r=>({fecha:r.at,...r.target,motivo:r.code}))));}catch(error){where.append(node('p','error-box',error.message));}
};

let aiSavedSettings;
const aiNativeUrls={openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1'};
function aiControls(){
 const provider=$('#ai-provider').value,local=provider==='local',native=Object.hasOwn(aiNativeUrls,provider);
 if(native)$('#ai-url').value=aiNativeUrls[provider];
 $('#ai-url').readOnly=native;$('#ai-url').disabled=local;$('#ai-model').disabled=local;$('#ai-key').disabled=local;
 $('#ai-url').required=!local;$('#ai-model').required=!local;
 const sameDestination=aiSavedSettings?.provider===provider&&aiSavedSettings?.url===$('#ai-url').value;
 $('#ai-key').required=!local&&(!sameDestination||!aiSavedSettings?.hasKey);
 $('#ai-key').placeholder=sameDestination&&aiSavedSettings?.hasKey?'Dejá vacío para conservar la clave':'Ingresá una nueva clave para este proveedor';
 $('#ai-clear-key').disabled=!local;if(!local)$('#ai-clear-key').checked=false;
}
function renderAiSettings(c){
 aiSavedSettings=c;$('#ai-provider').value=['local','external','openai','anthropic'].includes(c.provider)?c.provider:'';
 $('#ai-url').value=c.url||'';$('#ai-model').value=c.model||'';$('#ai-key').value='';$('#ai-clear-key').checked=false;
 for(const [id,key,fallback] of [['ai-input-limit','maxInputChars',64000],['ai-output-limit','maxOutputTokens',1200],['ai-timeout-limit','timeoutMs',60000]])$('#'+id).value=c.limits?.[key]??fallback;
 const h=c.health||{},count=n=>Number.isFinite(n)&&n>=0?n:0,t=c.telemetry||{};
 $('#ai-settings-health').textContent=c.configurationRequired?'Configuración pendiente: revisá proveedor, modelo y clave.':h.nextRetryAt>Date.now()?`Sin conexión por ahora. Próximo intento permitido: ${new Date(h.nextRetryAt).toLocaleTimeString()}.`:h.lastErrorCode?'La última consulta no pudo completarse. Ya podés reintentar con la configuración guardada.':(h.lastSuccessAt?'Última respuesta verificada: '+new Date(h.lastSuccessAt).toLocaleString()+'.':'Configuración guardada; conexión todavía sin verificar.');
 $('#ai-settings-usage').textContent=`En este inicio: ${count(t.requests)} consultas · ${count(t.failures)} fallos · ${count(t.durationMs)} ms · tokens informados: ${count(t.inputTokens)} de entrada y ${count(t.outputTokens)} de salida. Caché: ${count(t.cacheReadTokens)} leídos y ${count(t.cacheWriteTokens)} creados. Un contador ausente no acredita consumo cero.`;
 aiControls();
}
async function loadAiSettings(){
 $('#ai-settings-panel').classList.remove('hidden');
 try{const c=await api('/api/admin/ai');renderAiSettings(c);$('#ai-settings-status').textContent=c.hasKey?'Hay una clave guardada en el servidor.':'No hay clave externa guardada.';}catch(e){$('#ai-settings-status').textContent=e.message;}
}
$('#ai-provider').onchange=()=>{$('#ai-key').value='';$('#ai-clear-key').checked=false;if($('#ai-provider').value!==aiSavedSettings?.provider)$('#ai-model').value='';else $('#ai-model').value=aiSavedSettings?.model||'';aiControls();$('#ai-settings-status').textContent=$('#ai-provider').value==='local'?'Cambio a IA local pendiente. Guardá la configuración.':'Cambio pendiente. Ingresá modelo y clave del proveedor elegido y guardá la configuración.';};
$('#ai-url').oninput=()=>{$('#ai-key').value='';aiControls();};
$('#ai-settings-form').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button[type="submit"],button.primary');button.disabled=true;try{const c=await api('/api/admin/ai',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:$('#ai-provider').value,url:$('#ai-url').value,model:$('#ai-model').value,apiKey:$('#ai-key').value,clearKey:$('#ai-clear-key').checked,limits:{maxInputChars:Number($('#ai-input-limit').value),maxOutputTokens:Number($('#ai-output-limit').value),timeoutMs:Number($('#ai-timeout-limit').value)}})});renderAiSettings(c);$('#ai-settings-status').textContent='Guardado. Se aplica a las próximas consultas, sin reiniciar.';const s=await api('/api/agent/status');$('#ai-status').textContent=(s.local?'IA local · ':'IA externa · ')+(s.model||'Configuración pendiente');}catch(error){$('#ai-settings-status').textContent=error.message;}finally{button.disabled=false;}};
$('#ai-test').onclick=async()=>{const b=$('#ai-test');b.disabled=true;$('#ai-settings-status').textContent='Probando la configuración guardada, sin datos del ERP…';try{const r=await api('/api/admin/ai/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});renderAiSettings(await api('/api/admin/ai'));$('#ai-settings-status').textContent='Conexión verificada: '+r.model;}catch(e){$('#ai-settings-status').textContent=e.message;try{renderAiSettings(await api('/api/admin/ai'));}catch{}}finally{b.disabled=false;}};
async function historyList(){
 const where=$('#history-list');busy(where);
 try{const result=await api('/api/agent/conversations');where.replaceChildren();if(!result.data.length)where.append(node('p','','Todavía no hay conversaciones.'));
 for(const c of result.data){const row=node('div','knowledge-row'),open=node('button','secondary',c.title),rename=node('button','text-button','Renombrar'),remove=node('button','text-button','Eliminar');
 open.onclick=async()=>{try{const h=await api('/api/agent/conversations/'+c.id);attachments?.clear();conversationId=c.id;localStorage.setItem('central-conversation-id',c.id);const area=$('#conversation');area.replaceChildren();for(const m of h.messages){if(m.role==='user')area.append(node('div','question',m.content));else{try{const saved=JSON.parse(m.content);const a=node('article','answer-card');a.append(node('div','result-meta','Historial · valores de la consulta original'),formatAnswer(saved.answer));area.append(a);}catch{}}}$('#history-dialog').close();switchView('assistant');}catch(e){showError(where,e);}};
 rename.onclick=async()=>{const title=prompt('Nombre de la conversación',c.title);if(!title?.trim())return;try{await api('/api/agent/conversations/'+c.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});await historyList();}catch(e){showError(where,e);}};
 remove.onclick=async()=>{if(!confirm('¿Eliminar esta conversación? Las propuestas y su auditoría se conservan.'))return;try{await api('/api/agent/conversations/'+c.id,{method:'DELETE'});if(conversationId===c.id)$('#new-chat').click();await historyList();}catch(e){showError(where,e);}};
 row.append(open,rename,remove);where.append(row);}
 }catch(e){showError(where,e);}
}
$('#chat-history').onclick=()=>{if($('#send').disabled)return;$('#history-dialog').showModal();historyList();};$('#history-close').onclick=()=>$('#history-dialog').close();

window.addEventListener('offline',()=>{$('#notice').textContent='Sin conexión. Podés ver la interfaz, pero necesitás conexión al servidor para consultar datos o confirmar cambios.';$('#notice').classList.remove('hidden');});
window.addEventListener('online',()=>{$('#notice').textContent='Conexión restablecida. Volvé a intentar tu consulta.';$('#notice').classList.remove('hidden');});
const languageButton=node('button','secondary hidden','Mis expresiones');languageButton.type='button';languageButton.onclick=()=>query('¿Qué expresiones aprendiste?');$('.assistant-toolbar').append(languageButton);

function dashboardDialog(title){
 const dialog=node('dialog','saved-dashboard-dialog'),head=node('h2','',title),close=node('button','secondary','Cerrar');close.onclick=()=>dialog.close();dialog.append(head,close);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();return dialog;
}
function saveDashboardDialog(report,title){
 const dialog=dashboardDialog('Guardar dashboard'),form=node('form','dashboard-filters'),label=node('label','','Nombre'),name=node('input');name.required=true;name.maxLength=100;name.value=title;label.append(name);
 const periodLabel=node('label','','Período'),period=node('select');for(const [value,text] of [['fijo','Estas fechas exactas'],['este mes','Este mes · se actualiza al abrir'],['mes pasado','Mes anterior · se actualiza al abrir'],['este año','Este año · se actualiza al abrir'],['año pasado','Año anterior · se actualiza al abrir']]){const option=node('option','',text);option.value=value;period.append(option);}periodLabel.append(period);
 const save=node('button','primary','Guardar'),status=node('p','','Se guardan los filtros, no los resultados. Al abrir se consultan datos actuales con tus permisos.');save.type='submit';form.append(label,periodLabel,save);dialog.append(form,status);
 form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await api('/api/dashboards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.value,period:period.value,dashboard:{mode:'summary',resource:report.meta.recurso,filters:{...report.scope.filtros,sucursal:report.scope.sucursal,desde:report.scope.desde,hasta:report.scope.hasta,agrupar:report.scope.agrupar||'mes'}}})});dialog.close();notice('Dashboard guardado en Mis dashboards.');}catch(error){status.textContent=error.message;}finally{save.disabled=false;}};
}
const savedButton=node('button','secondary','Mis dashboards');savedButton.type='button';$('.assistant-toolbar').append(savedButton);
savedButton.onclick=async()=>{
 const dialog=dashboardDialog('Mis dashboards'),content=node('div'),status=node('p','','Cargando…');dialog.append(status,content);
 try{const {data}=await api('/api/dashboards');status.textContent=data.length?'Tus dashboards y los compartidos con vos. Se consultan con tus permisos al abrirlos.':'Todavía no guardaste dashboards. Usá Guardar dashboard en un resultado.';
 for(const entry of data){const row=node('article','result-card'),open=node('button','secondary',entry.name),remove=node('button','text-button','Quitar');row.append(open,node('p','result-meta',`${entry.period==='fijo'?'Fechas fijas':entry.period} · sucursal ${entry.dashboard.filters.sucursal} · ${visual(entry.dashboard.filters)}`),remove);content.append(row);if(entry.owned){const share=node('button','secondary','Compartir');share.onclick=()=>shareDashboardDialog(entry);row.append(share);}else{remove.remove();row.prepend(node('p','result-meta','Compartido con vos · sólo lectura'));}
 open.onclick=async()=>{open.disabled=true;try{const current=await api('/api/dashboards/'+entry.id);$('#branch').value=current.dashboard.filters.sucursal;dialog.close();await query('Abrir dashboard guardado: '+entry.name,current.dashboard);}catch(error){status.textContent=error.message;open.disabled=false;}};
 remove.onclick=async()=>{try{await api('/api/dashboards/'+entry.id,{method:'DELETE'});row.remove();}catch(error){status.textContent=error.message;}};
 }}catch(error){status.textContent=error.message;}
};

async function shareDashboardDialog(entry){
 const dialog=dashboardDialog('Compartir · '+entry.name),status=node('p','','Cargando destinatarios…'),form=node('form');dialog.append(status,form);
 try{const options=await api('/api/dashboards/'+entry.id+'/sharing'),checks=[];status.textContent='Compartís la configuración, no tus permisos ni una copia de los datos. Cada persona consulta el ERP con su propio acceso. Desmarcá para dejar de compartir.';
 for(const [kind,title,items] of [['user','Usuarios',options.users],['role','Roles',options.roles]]){const group=node('fieldset'),legend=node('legend','',title);group.append(legend);for(const item of items){const label=node('label','share-recipient'),check=node('input');check.type='checkbox';check.checked=options.selected.some(t=>t.kind===kind&&t.target===item.id);label.append(check,document.createTextNode(item.name));group.append(label);checks.push({check,kind,target:item.id});}if(!items.length)group.append(node('p','','No hay destinatarios con los permisos necesarios.'));form.append(group);}
 if(options.selected.some(t=>!(t.kind==='user'?options.users:options.roles).some(r=>r.id===t.target)))form.append(node('p','','Hay destinatarios que ya no están disponibles. Se quitarán al guardar.'));
 const save=node('button','primary','Guardar acceso compartido');save.type='submit';form.append(save);form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const result=await api('/api/dashboards/'+entry.id+'/sharing',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({targets:checks.filter(t=>t.check.checked).map(({kind,target})=>({kind,target}))})});dialog.close();notice(result.shared?'Dashboard compartido. Cada destinatario conserva sus permisos.':'El dashboard ya no está compartido.');}catch(error){status.textContent=error.message;}finally{save.disabled=false;}};
 }catch(error){status.textContent=error.message;}
}

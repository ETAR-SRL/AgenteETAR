const $=s=>document.querySelector(s);
const labels={condicionesPago:'Condiciones de pago',depositos:'Depósitos',centrosCosto:'Centros de costo',solicitudesCompra:'Solicitudes de compra',costos:'Costos',compras:'Órdenes de compra',produccion:'Producción',ventas:'Pedidos de venta',itemsVentas:'Ítems de ventas / pendientes',documentosSalida:'Documentos de salida',itemsDocumentosSalida:'Ítems de documentos de salida',remitos:'Remitos',entregas:'Entregas físicas',clientes:'Clientes',proveedores:'Proveedores',productos:'Productos',listasPreciosClientes:'Listas de precios de clientes',preciosClientes:'Precios de clientes · DA1',listasPreciosProveedores:'Listas de precios de proveedores',preciosProveedores:'Precios de proveedores',productoProveedor:'Productos por proveedor',productoCliente:'Productos por cliente',entradasCompras:'Entradas de compras',estructuras:'Estructuras',cotizaciones:'Cotizaciones',itemsCotizaciones:'Ítems de cotizaciones',proyectos:'Proyectos KAIQEN',calidad:'Calidad KAIQEN'};
const fieldLabels={precioPorMillar:'Precio por millar',cantidadMillares:'Cantidad en millares',registro:'Registro',codigo:'Código',descripcion:'Descripción',sucursal:'Sucursal',producto:'Producto',cliente:'Cliente',proveedor:'Proveedor',nombre:'Nombre',tienda:'Tienda',numero:'Número',lista:'Lista',precio:'Precio',desde:'Desde',hasta:'Hasta',pendiente:'Pendientes',status_name:'Estado registrado',phase_no:'Fase',name:'Nombre',code:'Código',customer:'Cliente',current_phase_name:'Fase actual',planned_start:'Inicio previsto',planned_end:'Fin previsto',actual_start:'Inicio real',actual_end:'Fin real',updated_at:'Actualizado',part_number:'N.º de pieza',part_name:'Pieza',sin_ia_externa:'Restricción IA externa',sin_ia_externa_por_cliente:'Restricción IA del cliente'};
let capabilities,selectedProject=null,projectOffset=0,projectQuery='',page=1,activeParams=null,activeResource=null,deferredInstall;
let conversationId=localStorage.getItem('central-conversation-id')||undefined;
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
function notice(text){$('#notice').textContent=text;$('#notice').classList.toggle('hidden',!text);}
function busy(where,text='Consultando la fuente…'){where.replaceChildren(node('div','loading',text));}
async function session(){const res=await fetch('/api/ui/session',{method:'POST',credentials:'same-origin',cache:'no-store'});if(!res.ok)throw new Error('No se pudo abrir la sesión local');}
async function api(path,options={},retry=true){
  let response;
  try{response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});}catch{throw Object.assign(new Error('No se puede acceder al servicio local. Iniciá Central en este equipo y verificá la red o VPN.'),{code:'SIN_CONEXION'});}
  if(response.status===401&&retry){await session();return api(path,options,false);}
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error?.message||'No se pudo realizar la consulta'),{code:data.error?.code});return data;
}
function showError(where,error){
  const friendly={SUCURSAL_CONFIGURACION:'Este recurso requiere confirmar la sucursal en el conector de Protheus.',SUCURSAL_NO_CONFIGURADA:'Este recurso todavía requiere confirmar la sucursal en el conector de Protheus.',ERP_BRANCH_MAPPING_REQUIRED:'Este recurso requiere configurar la sucursal en el conector.',CONSULTA_AMBIGUA:'No reconocí la consulta. Probá “mostrame los costos”, “ventas pendientes” o usá Explorar ERP.',PROPUESTA_REQUERIDA:'Prepará la modificación desde Actualizaciones o desde el chat.',RESULTADO_INCIERTO:'No se pudo confirmar el resultado. Consultá el estado de la propuesta y verificá el registro en Protheus; no repitas el cambio.',EJECUCION_NO_REPETIBLE:'La ejecución ya se inició. Consultá el estado; no repitas el cambio.'};
  const box=node('div','error-box',friendly[error.code]||error.message);box.setAttribute('role','alert');box.append(node('small','',error.code||'CONEXIÓN'));where.replaceChildren(box);
}
function display(value){if(value===null||value===undefined||value==='')return '—';if(typeof value==='boolean')return value?'Sí':'No';if(typeof value==='object')return JSON.stringify(value);return String(value);}
function visual(value){
  if(value&&typeof value==='object'&&!Array.isArray(value))return Object.entries(value).map(([key,v])=>`${title(key)}: ${display(v)}`).join(' · ');
  if(typeof value==='string'&&/^-?\d+\.\d+e[+-]\d+$/i.test(value)){
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
function table(rows){
  const wrap=node('div','table-wrap');wrap.tabIndex=0;wrap.setAttribute('aria-label','Tabla de resultados, desplazable');
  const t=node('table'),head=node('thead'),hr=node('tr'),body=node('tbody');
  const priority=['codigo','code','numero','productoCodigo','nombre','name','producto','cliente','proveedor','phase_no','status_name','estado','cantidad','costoMedio','precio','saldoTecnico','sucursal'];
  const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(key=>!['sin_ia_externa','sin_ia_externa_por_cliente'].includes(key)).sort((a,b)=>{
    const rank=k=>priority.includes(k)?priority.indexOf(k):k==='id'||k.endsWith('_id')||k==='registro'?200:100;
    return rank(a)-rank(b);
  });
  columns.forEach(key=>{const th=node('th','',title(key));th.scope='col';hr.append(th);});head.append(hr);
  rows.forEach(row=>{const tr=node('tr');columns.forEach(key=>{const td=node('td','',visual(row[key]));td.title=display(row[key]);tr.append(td);});body.append(tr);});
  t.append(head,body);wrap.append(t);return wrap;
}
function renderResult(where,envelope,heading,{append=false}={}){
  const rows=Array.isArray(envelope.data)?envelope.data:[],meta=envelope.meta||envelope.pagination||{},source=envelope.source;
  const system=typeof source==='object'?source.system:envelope.origen==='kaiqen'?'KAIQEN':'Protheus';
  const card=node('article','result-card'),header=node('div','result-header'),left=node('div');
  left.append(node('h3','',heading),node('div','result-meta',`${system||'Fuente'} · ${stamp(source?.fetchedAt||envelope.fetchedAt)} · ${rows.length} registros en esta página${meta.hasMore?' · hay más resultados':''}`));header.append(left);
  if(rows.length){const exportButton=node('button','secondary','↓ CSV');exportButton.title='Exportar los registros de esta página';exportButton.onclick=()=>downloadRows(rows,heading.toLowerCase().replace(/[^a-z0-9]/g,'-'));header.append(exportButton);}
  card.append(header);
  if(envelope.status==='not_configured')card.append(node('div','empty','No hay una fuente configurada para confirmar entregas físicas. Los remitos emitidos se consultan por separado.'));
  else if(rows.length)card.append(table(rows));else card.append(node('div','empty','No se encontraron registros para esta consulta. Esto no implica un importe o saldo igual a cero.'));
  const notes=node('div','result-notes',`Alcance: ${rows.length} registros recibidos${meta.page?' · página '+meta.page:''}. La consulta no calcula totales globales.`);
  if(rows.some(row=>Object.values(row).some(v=>typeof v==='string'&&/e[+-]\d+$/i.test(v))))notes.append(node('p','','Números en pantalla redondeados a 6 decimales. El valor original está en la ayuda de cada celda y en el CSV.'));
  const limitations=[...(envelope.limitations||[]),...(envelope.limitaciones||[]),...(meta.advertencias||[])];
  if(meta.sucursalEfectiva!==undefined)notes.append(node('p','',`Sucursal física consultada: ${meta.sucursalEfectiva||'(compartida)'}.`));
  if(limitations.length){const details=node('details');details.append(node('summary','','Ver alcance y limitaciones'),node('p','',limitations.join(' · ')));notes.append(details);}
  card.append(notes);if(append)where.append(card);else where.replaceChildren(card);return card;
}
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
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!==view));document.querySelectorAll('.nav').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);el.setAttribute('aria-current',el.dataset.view===view?'page':'false');});
  $('#page-name').textContent={assistant:'Asistente',explorer:'Explorar ERP',updates:'Actualizaciones',projects:'Proyectos y calidad',sources:'Conexiones'}[view];
  if(view==='projects'&&!$('#project-list').children.length)loadProjects();if(view==='sources')renderSources();
}
document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>switchView(el.dataset.view));
async function query(text){
  if(!text.trim()||$('#send').disabled)return;
  switchView('assistant');const conversation=$('#conversation'),q=node('div','question');q.append(node('span','',text));conversation.append(q);const result=node('div');conversation.append(result);busy(result);
  $('#send').disabled=true;$('#new-chat').disabled=true;const started=Date.now();const timer=setInterval(()=>{const loading=result.querySelector('.loading');if(loading)loading.textContent=`Interpretando y consultando las fuentes · ${Math.round((Date.now()-started)/1000)} s`;},1000);
  try{const response=await api('/api/agent/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,conversationId,topic:$('#topic').value,context:{sucursal:$('#branch').value,...(selectedProject?{proyecto:selectedProject.id}:{})}})});
    conversationId=response.conversationId;localStorage.setItem('central-conversation-id',conversationId);renderAnswer(result,response);
    $('#query').value='';
  }catch(error){if(error.code==='CONVERSACION_NO_EXISTE'){conversationId=undefined;localStorage.removeItem('central-conversation-id');}showError(result,error);}finally{clearInterval(timer);$('#send').disabled=false;$('#new-chat').disabled=false;result.scrollIntoView({behavior:'smooth',block:'nearest'});}
}
function renderAnswer(where,response){
  const card=node('article','answer-card');card.append(node('div','eyebrow','CENTRAL · INTELIGENCIA LOCAL'),node('div','answer-text',response.answer),node('div','result-meta',`${response.model||'Modelo local'} · ${response.evidence?.length||0} fuentes consultadas en este turno`));where.replaceChildren(card);
  for(const evidence of response.evidence||[]){
    const result=evidence.result,heading=evidence.id+' · '+(evidence.action==='precio_venta'?(result.kind==='prices'?'Precios de lista verificados':'Consulta de precios'):labels[evidence.args.recurso]||evidence.action);
    const details=node('details','evidence');details.append(node('summary','',heading));
    if(result.kind==='proposal'){renderProposal(where,result.proposal);continue;}
    if(result.candidates?.length){const choices=node('div','choice-list');result.candidates.forEach(candidate=>{const code=candidate.codigo||candidate.id;const b=node('button','secondary',[code,candidate.nombre||candidate.name,candidate.tienda?'Tienda '+candidate.tienda:''].filter(Boolean).join(' · '));b.onclick=()=>query(`Me refiero a ${code}${candidate.tienda?' tienda '+candidate.tienda:''}. Respondé la consulta anterior para esa opción.`);choices.append(b);});card.append(choices);renderResult(details,{...result,data:result.candidates},heading,{append:true});}
    else if(evidence.action==='calidad')renderQuality(details,result,true);
    else if(Array.isArray(result.data))renderResult(details,result,heading,{append:true});
    else{const pre=node('pre','raw-evidence',JSON.stringify(result.data||result,null,2));details.append(pre);}
    where.append(details);
  }
  if(response.trace?.some(t=>t.status==='error'))card.append(node('p','metrics-note','Alguna fuente no estuvo disponible: '+response.trace.filter(t=>t.status==='error').map(t=>t.code).join(', ')));
}
$('#new-chat').onclick=()=>{conversationId=undefined;localStorage.removeItem('central-conversation-id');$('#conversation').replaceChildren();notice('Nueva conversación. Las clasificaciones guardadas siguen disponibles.');};
async function loadKnowledge(){const content=$('#knowledge-list');busy(content);try{const result=await api('/api/agent/knowledge');content.replaceChildren();if(!result.data.length)content.append(node('p','metrics-note','Todavía no guardaste clasificaciones.'));for(const item of result.data){const row=node('div','knowledge-row');row.append(node('strong','',item.term),node('p','',item.meaning),node('small','',item.topic));const remove=node('button','text-button','Olvidar');remove.onclick=async()=>{await api('/api/agent/knowledge/'+item.id,{method:'DELETE'});loadKnowledge();};row.append(remove);content.append(row);}}catch(error){showError(content,error);}}
$('#teach').onclick=()=>{$('#knowledge-dialog').showModal();loadKnowledge();};$('#close-knowledge').onclick=()=>$('#knowledge-dialog').close();
$('#knowledge-form').onsubmit=async event=>{event.preventDefault();const status=$('#knowledge-status');try{await api('/api/agent/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:$('#topic').value,term:$('#knowledge-term').value,meaning:$('#knowledge-meaning').value})});status.textContent='Guardado. Se usará para interpretar las próximas consultas; los valores se leerán nuevamente en las fuentes.';$('#knowledge-form').reset();loadKnowledge();}catch(error){status.textContent=error.message;}};
$('#query-form').onsubmit=event=>{event.preventDefault();query($('#query').value);};
$('#query').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();query($('#query').value);}};
document.querySelectorAll('[data-query]').forEach(el=>el.onclick=()=>query(el.dataset.query));
function resourceMeta(resource){return capabilities?.erp?.entities?.[resource==='remitos'?'documentosSalida':resource]||{};}
function buildFilters(){
  const resource=$('#resource').value,meta=resourceMeta(resource),container=$('#filters');container.replaceChildren();
  const keys=Object.keys(meta.filters||{}).filter(k=>k!=='sucursal'&&!(resource==='remitos'&&k==='tipoDocumento'));
  if(meta.fechaFiltro)keys.push('desde','hasta');if(meta.pendiente)keys.push('pendiente');
  for(const key of keys){const label=node('label','',title(key));let input;
    if(key==='pendiente'){input=node('select');[['','Todos'],['true','Con saldo técnico'],['false','Sin saldo técnico']].forEach(([v,t])=>{const o=node('option','',t);o.value=v;input.append(o);});}
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
  try{const params=new URLSearchParams(activeParams);params.set('page',String(page));const result=await api('/api/erp/'+activeResource+'?'+params);renderResult(where,result,labels[activeResource]);$('#pagination').classList.toggle('hidden',result.status==='not_configured');$('#page-label').textContent='Página '+page;$('#prev').disabled=page<=1;$('#next').disabled=!(result.meta?.hasMore||result.pagination?.hasMore);}
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
  const where=$('#sources-content');where.replaceChildren();if(!capabilities)return;
  const erp=node('div','source-card');erp.append(node('h3','','Protheus · Argentina 2510'),node('p','',`Modo ${capabilities.mode==='live'?'real':'DEMO'} · sucursales permitidas: ${capabilities.branches.join(', ')}. Las consultas se realizan al pedir información; la disponibilidad de cada recurso se verifica con su respuesta.`));
  const list=node('div','source-list');Object.entries(capabilities.erp.entities||{}).forEach(([key,m])=>{const row=node('div','source-item');row.append(node('span','',labels[key]||key),node('small','',!m.disponible?'No disponible':m.requiereConfigurarSucursal?'Requiere sucursal':'Configurado · '+m.alias));list.append(row);});erp.append(list);where.append(erp);
  if(capabilities.writePolicy){const writes=node('div','source-card');writes.append(node('h3','','Actualizaciones · SQL controlado'),node('p','',capabilities.writePolicy.description),node('p','',capabilities.writePolicy.creditLimitation));where.append(writes);}
  const k=node('div','source-card');k.append(node('h3','','KAIQEN'),node('p','',`${capabilities.kaiqen.configured?'Conexión configurada':'Sin conexión configurada'} · ${capabilities.kaiqen.source==='postgres'?'Lectura PostgreSQL de la planta configurada':'API'}. Proyectos, fases, registros de calidad y referencias ERP. No reproduce los permisos individuales ni el semáforo calculado de la aplicación.`));where.append(k);
  const voice=node('div','source-card');voice.append(node('h3','','Voz y aplicación local'),node('p','',`${capabilities.voice.available?'Whisper base instalado':'Transcripción no disponible'} · Audio procesado en este equipo. Los archivos temporales se borran al terminar. La PWA conserva únicamente su interfaz para abrir sin conexión; no guarda los datos consultados.`),node('p','','Asistente con modelo de lenguaje local, búsqueda por nombre, consultas encadenadas y memoria del negocio. Prepara modificaciones; la ejecución se confirma desde la tarjeta de revisión.'));where.append(voice);
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
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;$('#install').textContent='＋ Instalar Central';});
$('#install').onclick=async()=>{if(deferredInstall){await deferredInstall.prompt();deferredInstall=null;}else{$('#help-dialog').showModal();}};
$('#help').onclick=()=>$('#help-dialog').showModal();$('#close-help').onclick=()=>$('#help-dialog').close();
window.addEventListener('offline',()=>notice('Sin conexión. La interfaz está disponible, pero las consultas requieren el servicio local y acceso a las fuentes.'));
window.addEventListener('online',()=>notice('Conexión recuperada. Volvé a consultar para actualizar la información.'));
async function start(){
  try{await session();capabilities=await api('/api/capabilities');$('#update-preview').disabled=!capabilities.canExecute;$('#create-preview').disabled=!capabilities.canExecute;$('#update-access').textContent=capabilities.canExecute?'UPDATE SQL habilitados. La ejecución depende de las validaciones de cada propuesta; este modo no revalida crédito en Protheus.':'Esta sesión no tiene ejecución de cambios habilitada.';if(capabilities.purchaseCreation){$('#creation-status').textContent='Altas SC1/SC7 disponibles en el formulario de abajo. Numeración automática al confirmar; documentos bloqueados para revisión en Protheus.';}restoreProposal();$('#connection').textContent=capabilities.mode==='live'?'Servicio real':'Modo DEMO';$('#connection').classList.toggle('warn',capabilities.mode!=='live');
    capabilities.branches.forEach(v=>{const o=node('option','',v);o.value=v;$('#branch').append(o);});
    const resources=Object.keys(capabilities.erp.entities||{});for(const key of [...resources,'remitos','entregas']){const o=node('option','',labels[key]||key);o.value=key;$('#resource').append(o);}$('#resource').value='costos';buildFilters();
    $('#voice-status').textContent=capabilities.voice.available?'Dictado en español · transcripción local · hasta 45 segundos':'Transcripción local no instalada. Las consultas por texto están disponibles.';
    api('/api/agent/status').then(status=>{$('#ai-status').textContent=status.available?'IA local activa · '+status.model:'Motor de IA no disponible';}).catch(()=>{$('#ai-status').textContent='No se pudo verificar el modelo';});
    if(conversationId){try{const history=await api('/api/agent/conversations/'+conversationId);const conversation=$('#conversation');for(const message of history.messages){if(message.role==='user'){const q=node('div','question');q.append(node('span','',message.content));conversation.append(q);}else{let saved;try{saved=JSON.parse(message.content);}catch{continue;}const a=node('article','answer-card');a.append(node('div','result-meta','Conversación anterior · valores históricos, consultá nuevamente para actualizarlos'),node('div','answer-text',saved.answer));conversation.append(a);}}}catch{conversationId=undefined;localStorage.removeItem('central-conversation-id');}}
  }catch(error){$('#connection').textContent='Sin servicio';$('#connection').classList.add('warn');notice(error.message);$('#send').disabled=true;$('#mic').disabled=true;}
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>notice('El navegador no permitió el modo instalable. Las consultas siguen disponibles.'));
}
start();

function renderProposal(where,proposal,{append=true}={}){
  const card=node('article','result-card'),result=node('div'),controls=node('div','filter-bottom');
  card.append(node('h3','','Revisar cambio · '+proposal.action),node('p','',`Sucursal ${proposal.target.sucursal} · ${proposal.operation==='insert'?'documento nuevo — numeración al confirmar':'registro '+proposal.target.registro} · vence ${stamp(proposal.expiresAt)}`),table([proposal.identity||{}]),proposal.operation==='insert'?table(proposal.items):table(proposal.diff.map(d=>({...d.table?{tabla:d.table,registro:d.record,secuencia:d.sequence||''}:{},campo:d.field,antes:d.before,despues:d.after}))));
  if(proposal.before?.moneda)card.append(node('p','',`Moneda conservada: ${visual(proposal.before.moneda)}`));
  if(proposal.calculation)card.append(table([proposal.calculation]));
  for(const warning of proposal.warnings||[])card.append(node('p','notice',warning.message));
  for(const blocker of proposal.blockers||[])card.append(node('p','notice',blocker.message));
  const check=node('input');check.type='checkbox';const label=node('label','confirm-change');label.append(check,document.createTextNode(' Revisé el registro, la moneda, los valores y las condiciones indicadas. Confirmo este cambio en el ERP.'));
  const execute=node('button','primary',proposal.operation==='insert'?'Confirmar y crear documento':'Confirmar y actualizar ERP'),refresh=node('button','secondary','Consultar estado');execute.type=refresh.type='button';
  execute.disabled=true;check.onchange=()=>{execute.disabled=!check.checked||!capabilities?.canExecute||!proposal.executionEnabled;};
  controls.append(execute,refresh);card.append(label,controls,result);let terminal=false;
  function status(execution){
    const names={executed:'Cambio SQL guardado y verificado. No implica aprobación nativa.',executing:'Ejecución en curso. No repitas el cambio.',failed:'No se confirmó el cambio. Revisá el error y generá una nueva propuesta.',unknown:'Resultado incierto. Verificá el registro en Protheus antes de preparar otro cambio.'};
    if(!execution){result.replaceChildren(node('p','',proposal.blockers?.length?'Propuesta sin ejecución habilitada: requiere revisión en Protheus.':'Propuesta pendiente de confirmación.'));return;}
    terminal=true;execute.disabled=true;check.disabled=true;result.replaceChildren(node('p','',names[execution.status]||execution.status));
    for(const warning of execution.result?.warnings||[])result.append(node('p','notice',warning.message));
    if(execution.result?.fields)result.append(table([execution.result.fields]));
    if(execution.result?.records)result.append(table(execution.result.records.map((registro,i)=>({registro,...execution.result.items[i]}))));
    if(execution.result?.relatedUpdates?.length)result.append(table(execution.result.relatedUpdates.map(u=>({tabla:u.alias,registro:u.record,secuencia:u.sequence,...u.updates}))));
    if(execution.result?.code)result.append(node('p','',execution.result.code));
  }
  refresh.onclick=async()=>{try{status((await api('/api/changes/'+proposal.id)).execution);}catch(e){showError(result,e);}};
  execute.onclick=async()=>{
    if(terminal||!check.checked)return;terminal=true;execute.disabled=true;check.disabled=true;busy(result,'Actualizando y verificando el registro…');
    localStorage.setItem('central-last-proposal',proposal.id);
    try{status(await api('/api/changes/'+proposal.id+'/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true,fingerprint:proposal.fingerprint})},false));}
    catch(e){showError(result,e);result.append(node('p','','Consultá el estado con el botón de esta tarjeta. No se reenvía automáticamente el UPDATE.'));}
  };
  if(append)where.append(card);else where.replaceChildren(card);
  return {status};
}
async function restoreProposal(){
  const id=localStorage.getItem('central-last-proposal');if(!id||!capabilities?.canExecute)return;
  try{const saved=await api('/api/changes/'+id);const where=$('#update-pending');where.replaceChildren(node('h2','','Última propuesta'));renderProposal(where,saved.proposal).status(saved.execution);}catch{/* La sesión anterior puede haber vencido. No reenviar escrituras. */}
}
$('#update-form').onsubmit=async event=>{
  event.preventDefault();const where=$('#update-result'),action=$('#update-action').value,order=['pedidoVenta','pedidoCompra','solicitudCompra'].includes(action),changes={};
  const price=$('#update-price').value.trim(),quantity=$('#update-quantity').value.trim();
  if(price)changes[order?'precioUnitario':'precio']=price;if(quantity)changes.cantidadPedida=quantity;
  $('#update-preview').disabled=true;busy(where,'Leyendo el registro y calculando diferencias…');
  try{const proposal=await api('/api/changes/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,target:{sucursal:$('#branch').value,registro:$('#update-record').value.trim()},changes,...(price?{priceUnit:$('#update-price-unit').value}:{}),...(quantity?{quantityUnit:$('#update-quantity-unit').value}:{})})});localStorage.setItem('central-last-proposal',proposal.id);renderProposal(where,proposal,{append:false});}
  catch(e){showError(where,e);}finally{$('#update-preview').disabled=!capabilities?.canExecute;}
};

function addCreateItem(){
 const container=$('#create-items');if(container.children.length>=50)return;
 const row=node('fieldset','panel');row.append(node('legend','','Ítem '+(container.children.length+1)));const fields=node('div','filters');
 for(const [key,label,type] of [['producto','Producto (código)','text'],['deposito','Depósito (código)','text'],['fechaNecesidad','Fecha de necesidad','date'],['cantidad','Cantidad','text'],['precio','Precio','text']]){const l=node('label','',label),i=node('input');i.dataset.field=key;i.type=type;i.required=true;if(['cantidad','precio'].includes(key))i.inputMode='decimal';l.append(i);fields.append(l);}
 for(const [key,label,options] of [['baseCantidad','Base de cantidad',[['millares','Millares'],['unidades','Unidades']]],['basePrecio','Base de precio',[['millar','Por millar'],['unidad','Por unidad']]]]){const l=node('label','',label),select=node('select');select.dataset.field=key;for(const [value,title] of options){const o=node('option','',title);o.value=value;select.append(o);}l.append(select);fields.append(l);}
 const remove=node('button','secondary','Quitar ítem');remove.type='button';remove.onclick=()=>{if(container.children.length>1)row.remove();};row.append(fields,remove);container.append(row);
}
$('#create-add').onclick=addCreateItem;addCreateItem();
$('#create-date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
$('#create-action').onchange=()=>{const purchase=$('#create-action').value==='crearPedidoCompra';for(const id of ['create-vendor','create-store','create-payment']){$('#'+id).disabled=!purchase;$('#'+id).required=purchase;}$('#create-requester').disabled=purchase;$('#create-requester').required=!purchase;};
$('#create-form').onsubmit=async event=>{
 event.preventDefault();const action=$('#create-action').value,header={fechaEmision:$('#create-date').value,moneda:'1'};
 if(action==='crearSolicitudCompra')header.solicitante=$('#create-requester').value.trim();else Object.assign(header,{proveedor:$('#create-vendor').value.trim(),tienda:$('#create-store').value.trim(),condicionPago:$('#create-payment').value.trim()});
 const items=[...$('#create-items').children].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(i=>[i.dataset.field,i.value.trim()]))),where=$('#create-result');$('#create-preview').disabled=true;busy(where,'Verificando catálogos y preparando el documento…');
 try{const proposal=await api('/api/changes/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,target:{sucursal:$('#branch').value},header,items})});localStorage.setItem('central-last-proposal',proposal.id);renderProposal(where,proposal,{append:false});}catch(e){showError(where,e);}finally{$('#create-preview').disabled=!capabilities?.canExecute;}
};

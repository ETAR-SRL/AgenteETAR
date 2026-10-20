const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const states={ready:'Listo para confirmar',checking:'Revalidando precios',running:'Aplicando precios',completed:'Lote terminado',blocked:'Revalidación detenida',stopped:'Ejecución detenida',interrupted:'Ejecución interrumpida: revisar resultados',superseded:'Reemplazado por otra revisión'};
const rowStates={pending:'Pendiente',executed:'Aplicado',failed:'Falló',unknown:'Resultado incierto',executing:'En curso',validation_failed:'Revisión requerida'};
function grid(headers,rows){
 const wrap=el('div',undefined,'table-wrap'),table=el('table'),head=el('thead'),tr=el('tr'),body=el('tbody');
 for(const label of headers)tr.append(el('th',label));head.append(tr);table.append(head,body);
 for(const row of rows){const line=el('tr');for(const value of row)line.append(el('td',String(value??'—')));body.append(line);}
 wrap.append(table);return wrap;
}
export function renderImportBatch(where,initial,{api,capabilities}){
 let batch=initial,invalidated=false,submitted=false,timer;
 const card=el('section',undefined,'import-batch'),summary=el('div'),status=el('p'),outcome=el('div'),check=el('input'),label=el('label',undefined,'confirm-change');
 const confirm=el('button',undefined,'primary'),refresh=el('button','Consultar resultado del lote','secondary');
 check.type='checkbox';confirm.type=refresh.type='button';status.setAttribute('role','status');
 label.append(check,document.createTextNode(` Revisé el resumen y confirmo actualizar estos precios (${batch.counts.valid}). Filas excluidas por errores: ${batch.counts.excluded}.`));
 const permitted=capabilities.canExecute&&(capabilities.user?.admin||capabilities.user?.unrestricted||capabilities.user?.permissions?.includes('write:'+batch.action));
 card.append(el('h3','Resumen de precios revisados'),summary,label,confirm,refresh,status,outcome);where.append(card);
 localStorage.setItem('central-last-price-batch',batch.id);
 function draw(){
  clearTimeout(timer);
  summary.replaceChildren(el('p',`${batch.name} · sucursal ${batch.branch} · Precios válidos: ${batch.counts.valid} · Filas con errores: ${batch.counts.excluded}.`),
   el('p','Se aplica una transacción por precio. Si hay un fallo, se detiene el resto; los cambios ya aplicados se conservan. No se crean registros ni se cambia la moneda.'),
   grid(['Producto','Descripción','Lista','Antes','Nuevo','Moneda','Base del precio','Unidad ERP','Origen'],batch.rows.map(r=>[r.producto,r.descripcion,r.lista,r.anterior,r.nuevo,r.moneda,r.base,r.unidadMedida,r.origen])));
  for(const row of batch.rows)for(const warning of row.warnings||[])summary.append(el('p',`${row.producto}: ${warning.message}`,'notice'));
  if(batch.issues.length)summary.append(el('h4','Filas con errores · no se actualizarán'),grid(['Fila / origen','Producto','Motivo'],batch.issues.map(r=>[r.ubicacion||r.fila,r.producto,r.motivo])));
  else summary.append(el('p','No hay filas con errores.'));
  confirm.textContent=`Confirmar y actualizar ${batch.counts.valid} precios`;
  confirm.disabled=invalidated||submitted||!check.checked||!permitted||batch.status!=='ready'||!batch.counts.valid||Date.parse(batch.expiresAt)<=Date.now();
  check.disabled=invalidated||submitted||batch.status!=='ready'||!batch.counts.valid||!permitted;
  if(!permitted)status.textContent='Tu rol permite revisar este resumen, pero no ejecutar los cambios.';
  else if(invalidated)status.textContent='Editaste la revisión. Volvé a verificar para confirmar un resumen actualizado.';
  else status.textContent=`${states[batch.status]||batch.status}. Vence ${new Date(batch.expiresAt).toLocaleString('es-AR')}.`;
  outcome.replaceChildren();
  if(batch.status!=='ready'){
   outcome.append(el('p',`${batch.counts.executed} aplicados · ${batch.counts.failed} fallidos · ${batch.counts.unknown} inciertos · ${batch.counts.executing} en curso · ${batch.counts.pending} sin aplicar · ${batch.counts.validation_failed} requieren revisión.`),
    grid(['Producto','Registro','Resultado','Detalle'],batch.rows.map(r=>[r.producto,r.registro,rowStates[r.status]||r.status,r.code||''])));
   if(batch.error)outcome.append(el('p',batch.error.message,'notice'));
   if(['stopped','blocked','interrupted'].includes(batch.status))outcome.append(el('p','No se reenvía este lote. Verificá los resultados inciertos en Protheus y prepará una nueva revisión de los pendientes.','notice'));
  }
  if(['checking','running'].includes(batch.status)&&card.isConnected)timer=setTimeout(poll,2000);
 }
 async function poll(){
  try{batch=await api('/api/price-imports/batches/'+batch.id);draw();}
  catch(error){clearTimeout(timer);status.textContent=error.message+' Consultá el resultado nuevamente; no se reenvían cambios.';}
 }
 check.onchange=draw;refresh.onclick=poll;
 confirm.onclick=async()=>{
  if(confirm.disabled||!check.checked)return;submitted=true;check.disabled=true;confirm.disabled=true;
  status.textContent='Revalidando el lote completo antes de actualizar…';timer=setTimeout(poll,2000);
  try{
   batch=await api('/api/price-imports/batches/'+batch.id+'/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirm:true,fingerprint:batch.fingerprint})},false);draw();
  }catch(error){clearTimeout(timer);status.textContent=error.message+' Usá Consultar resultado del lote; no vuelvas a enviar la confirmación.';}
 };
 draw();
 return ()=>{invalidated=true;check.checked=false;draw();};
}

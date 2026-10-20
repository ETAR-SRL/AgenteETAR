import {renderImportBatch} from './import-batch-ui.js';
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
export function installPriceImports({api,capabilities,renderProposal}){
 const actions=capabilities.proposalActions||{},kinds=[];
 if(actions.precioListaProveedor)kinds.push(['proveedor','Proveedor · AIB']);
 if(actions.precioLista)kinds.push(['cliente','Cliente · DA1']);
 if(!kinds.length)return;
 const controls=el('div',undefined,'attachment-control'),menu=el('div',undefined,'attachment-menu'),file=el('input'),button=el('button','＋','attach-button');
 let destination=kinds[0][0];
 button.setAttribute('aria-label','Adjuntar archivo');button.title='Adjuntar Excel, foto o PDF';button.setAttribute('aria-expanded','false');
 menu.hidden=true;
 for(const [value] of kinds){const item=el('button',value==='proveedor'?'Lista de precios de proveedor':'Lista de precios de cliente');item.type='button';item.onclick=()=>{destination=value;menu.hidden=true;button.setAttribute('aria-expanded','false');file.click();};menu.append(item);}
 file.type='file';file.className='attachment-file';file.accept='.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp';file.hidden=true;button.type='button';
 button.disabled=!capabilities.documents?.available;
 menu.append(el('small','Excel, foto o PDF · hasta 20 MB'));
 controls.append(button,menu,file);
 document.querySelector('.compose-actions').prepend(controls);
 button.onclick=()=>{menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden));};
 document.addEventListener('click',e=>{if(!controls.contains(e.target)){menu.hidden=true;button.setAttribute('aria-expanded','false');}});
 controls.addEventListener('keydown',e=>{if(e.key==='Escape'){menu.hidden=true;button.setAttribute('aria-expanded','false');button.focus();}});
 file.onchange=async()=>{
  const selected=file.files[0];if(!selected)return;
  const where=document.querySelector('#conversation'),card=el('article',undefined,'answer-card'),status=el('p','Leyendo '+selected.name+'…');
  where.append(card);card.append(status);card.scrollIntoView({block:'start',behavior:'smooth'});button.disabled=true;
  try{
   if(selected.size>capabilities.documents.maxBytes)throw new Error('El archivo supera 20 MB.');
   const params=new URLSearchParams({kind:destination,sucursal:document.querySelector('#branch').value});
   const draft=await api('/api/price-imports?'+params,{method:'POST',headers:{'content-type':'application/octet-stream','x-file-name':encodeURIComponent(selected.name)},body:selected});
   localStorage.setItem('central-last-import',draft.id);review(card,draft);
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;file.value='';}
 };
 function field(parent,label,value='',placeholder=''){
  const wrap=el('label',label),input=el('input');input.value=value;input.placeholder=placeholder;wrap.append(input);parent.append(wrap);return input;
 }
 function review(card,draft){
  let invalidateBatch=()=>{},revision=0;
  const changed=()=>{revision++;invalidateBatch();};
  card.replaceChildren(el('div',draft.name,'attachment-chip'),el('h3',`Leí ${draft.rows.length} precios del archivo`),el('p',`${draft.kind==='proveedor'?'Lista de proveedor':'Lista de cliente'} · sucursal ${draft.branch}. Voy a compararlos con el ERP antes de proponer cambios.`));
  const advanced=el('details',undefined,'import-corrections');advanced.open=draft.rows.length===0;advanced.append(el('summary','Corregir lectura o completar datos'));
  for(const text of draft.notices||[])advanced.append(el('p',text,'notice'));
  const fields=el('div',undefined,'import-fields');advanced.append(fields);
  const missing=el('div',undefined,'import-missing');card.append(missing);
  const party=field(draft.defaults.party?fields:missing,draft.kind==='proveedor'?'Proveedor':'Cliente',draft.defaults.party,'Nombre o código ERP');
  if(!draft.defaults.party)missing.prepend(el('p',`¿De qué ${draft.kind} es esta lista?`));
  else card.append(el('p',`${draft.kind==='proveedor'?'Proveedor':'Cliente'}: ${draft.defaults.party}`));
  const shop=field(fields,'Tienda','','Opcional si es única'),list=field(fields,'Lista','','Opcional si es única / A1_TABELA');
  const currency=field(draft.rows.some(r=>!r.currency)&&!draft.defaults.currency?missing:fields,'Moneda de los precios',draft.defaults.currency,'ARS, USD, EUR o código ERP');
  const unit=field(draft.rows.some(r=>!r.unit)&&!draft.defaults.unit?missing:fields,'Base de los precios',draft.defaults.unit,'unidad, millar o UM del producto');
  advanced.append(el('p','Importes sin separadores de miles. “unidad” usa la UM del producto en SB1; “millar” divide por 1000 para productos UN. Los valores por fila prevalecen sobre los generales.'));
  const reading=el('div',undefined,'table-wrap'),readTable=el('table'),readHead=el('tr');
  for(const text of ['Producto','Precio leído','Moneda','Base'])readHead.append(el('th',text));readTable.append(readHead);
  for(const row of draft.rows){const line=el('tr');for(const text of [row.product||row.description,row.rawPrice||row.price,row.currency||'A confirmar',row.unit||'A confirmar'])line.append(el('td',text));readTable.append(line);}reading.append(readTable);card.append(reading,advanced);
  const scroll=el('div',undefined,'table-wrap'),table=el('table'),head=el('tr'),body=el('tbody');table.append(head,body);scroll.append(table);advanced.append(scroll);
  for(const text of ['Usar','Producto / código proveedor','Descripción','Precio nuevo','Moneda','Base','Registro ERP','Lectura original'])head.append(el('th',text));
  const entries=[];let manual=0;
  function add(row){
   const tr=el('tr'),select=el('input');select.type='checkbox';select.checked=true;select.setAttribute('aria-label','Usar fila '+row.id);const td=el('td');td.append(select);tr.append(td);
   const entry={id:row.id,select};
   for(const key of ['product','description','price','currency','unit']){const cell=el('td'),input=el('input');input.value=row[key]||'';input.setAttribute('aria-label',`${key} fila ${row.id}`);if(key==='price')input.inputMode='decimal';cell.append(input);tr.append(cell);entry[key]=input;}
   const recordCell=el('td'),record=el('select'),automatic=el('option','Resolver al verificar');automatic.value='';record.append(automatic);record.setAttribute('aria-label','Registro ERP fila '+row.id);recordCell.append(record);tr.append(recordCell);entry.record=record;
   const source=el('td');source.append(el('small',row.location||'Entrada manual'),el('p',row.source||''));
   if(row.ocr)source.append(el('small','OCR · verificá contra la imagen'));
   if(row.warning)source.append(el('p',row.warning,'notice'));tr.append(source);body.append(tr);entries.push(entry);
  }
  draft.rows.forEach(add);
  const more=el('button','Agregar fila','secondary');more.type='button';more.onclick=()=>{add({id:'manual-'+(++manual)});changed();};advanced.append(more);
  const details=el('details');details.append(el('summary','Ver texto extraído'),el('pre',draft.text));advanced.append(details);
  const prepare=el('button','Preparar resumen','primary'),result=el('div');prepare.type='button';card.append(prepare,result);
  // Editing any reviewed value invalidates the review confirmation.
  card.addEventListener('input',e=>{if(!result.contains(e.target))changed();});
  prepare.onclick=async()=>{
   const reviewedRevision=revision;invalidateBatch();
   prepare.disabled=true;result.replaceChildren(el('p','Verificando productos y precios actuales en el ERP…'));
   try{
    const rows=entries.filter(e=>e.select.checked).map(e=>Object.fromEntries(['id','product','description','price','currency','unit','record'].map(key=>[key,key==='id'?e.id:e[key].value])));
    const response=await api('/api/price-imports/'+draft.id+'/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reviewed:true,party:party.value,shop:shop.value,list:list.value,currency:currency.value,unit:unit.value,rows})});
    result.replaceChildren(el('p',response.message));
    for(const choice of response.choices||[]){const pick=el('button',`${choice.codigo} / ${choice.tienda} · ${choice.nombre}`,'secondary');pick.type='button';pick.onclick=()=>{party.value=choice.codigo;shop.value=choice.tienda;changed();prepare.click();};result.append(pick);}
    for(const issue of response.issues||[]){
     if(!response.batch)result.append(el('p',`${issue.ubicacion} · ${issue.producto||'Producto sin código'}: ${issue.motivo}`,'notice'));
     const entry=entries.find(e=>e.id===issue.fila);
     if(entry&&issue.candidates?.length){
      advanced.open=true;
      entry.record.replaceChildren();const blank=el('option','Elegir registro ERP');blank.value='';entry.record.append(blank);
      for(const c of issue.candidates){const option=el('option',`${c.lista} · ítem ${c.item||'—'} · ${Number(c.precio).toLocaleString('es-AR',{maximumFractionDigits:8})} ${c.moneda||''} · desde ${c.desde||'—'} · tramo ${c.rango||'—'} · registro ${c.registro}`);option.value=c.registro;entry.record.append(option);}
      if(issue.hasMore)result.append(el('p','Hay más registros: completá la lista para reducir las opciones.','notice'));
     }
    }
    if(response.batch){invalidateBatch=renderImportBatch(result,response.batch,{api,capabilities});if(revision!==reviewedRevision)invalidateBatch();}
    else for(const proposal of response.proposals||[])renderProposal(result,proposal);
   }catch(error){result.replaceChildren(el('p',error.message,'error-box'));}finally{prepare.disabled=false;}
  };
 }
 const saved=localStorage.getItem('central-last-import');
 if(saved){const restore=el('button','Retomar último adjunto');restore.type='button';menu.append(restore);restore.onclick=async()=>{menu.hidden=true;try{const draft=await api('/api/price-imports/'+saved),card=el('article',undefined,'answer-card');document.querySelector('#conversation').append(card);review(card,draft);card.scrollIntoView({block:'start'});}catch(error){restore.textContent=error.message;restore.disabled=true;}};}
 const previousBatch=localStorage.getItem('central-last-price-batch');
 if(previousBatch){const restore=el('button','Ver último lote');restore.type='button';menu.append(restore);restore.onclick=async()=>{menu.hidden=true;try{const batch=await api('/api/price-imports/batches/'+previousBatch);renderImportBatch(document.querySelector('#conversation'),batch,{api,capabilities});}catch(error){restore.textContent=error.message;}};}
}

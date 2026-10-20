import {renderImportBatch} from './import-batch-ui.js';
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
export function installPriceImports({api,capabilities}){
 const actions=capabilities.proposalActions||{};
 if(!['precioListaProveedor','precioLista','pedidoVenta','pedidoCompra','solicitudCompra'].some(k=>actions[k]))return;
 const controls=el('div',undefined,'attachment-control'),menu=el('div',undefined,'attachment-menu'),file=el('input'),button=el('button','＋','attach-button');
 const chip=el('div',undefined,'chat-attachment');
 let current,loading=false,revision=0,clearRequested=false,chatBusy=false;
 button.type='button';button.setAttribute('aria-label','Adjuntar archivo');button.title='Adjuntar Excel, foto o PDF';button.setAttribute('aria-expanded','false');
 button.disabled=!capabilities.documents?.available;menu.hidden=true;chip.hidden=true;
 const choose=el('button','Adjuntar Excel, foto o PDF');choose.type='button';choose.onclick=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false');file.click();};
 file.type='file';file.className='attachment-file';file.accept='.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp';file.hidden=true;
 menu.append(choose,el('small','Hasta 20 MB · indicá qué cambiar en el chat'));
 controls.append(button,menu,file);document.querySelector('.compose-actions').prepend(controls);
 document.querySelector('#query').before(chip);
 button.onclick=()=>{menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden));};
 document.addEventListener('click',e=>{if(!controls.contains(e.target)){menu.hidden=true;button.setAttribute('aria-expanded','false');}});
 controls.addEventListener('keydown',e=>{if(e.key==='Escape'){menu.hidden=true;button.setAttribute('aria-expanded','false');button.focus();}});
 function clear(){
  if(current){const id=current.id;document.dispatchEvent(new CustomEvent('attachment-revised',{detail:id}));api('/api/price-imports/'+id+'/invalidate',{method:'POST'},false).catch(error=>{document.querySelector('#notice').textContent=error.message;document.querySelector('#notice').classList.remove('hidden');});}
  revision++;current=undefined;clearRequested=true;chip.hidden=true;chip.replaceChildren();localStorage.removeItem('central-chat-attachment');
 }
 function receive(draft){
  if(draft===null){clear();return;}
  if(!draft)return;
  current=draft;clearRequested=false;chip.hidden=false;chip.replaceChildren(el('span',draft.name));
  const remove=el('button','×');remove.type='button';remove.setAttribute('aria-label','Quitar adjunto');remove.disabled=chatBusy;remove.onclick=clear;chip.append(remove);
  localStorage.setItem('central-chat-attachment',draft.id);
 }
 file.onchange=async()=>{
  const selected=file.files[0];if(!selected)return;
  const version=++revision,branch=document.querySelector('#branch').value;
  const card=el('article',undefined,'answer-card'),status=el('p','Leyendo '+selected.name+'…');
  document.querySelector('#conversation').append(card);card.append(status);loading=true;button.disabled=true;
  try{
   if(selected.size>capabilities.documents.maxBytes)throw new Error('El archivo supera 20 MB.');
   const draft=await api('/api/price-imports?'+new URLSearchParams({sucursal:branch}),{method:'POST',headers:{'content-type':'application/octet-stream','x-file-name':encodeURIComponent(selected.name)},body:selected},false);
   if(version!==revision)return;
   if(current)clear();receive(draft);status.textContent=`${draft.name} · ${draft.rows.length} filas leídas. Decime qué querés actualizar, por texto o voz.`;
   const details=el('details',undefined,'import-corrections');details.append(el('summary','Ver lectura del archivo'));
   const wrap=el('div',undefined,'table-wrap'),table=el('table'),head=el('tr');
   for(const name of ['Fila','Producto','Descripción','Precio','Moneda','Base precio','Cantidad','Base cantidad','Documento','Ítem','Origen'])head.append(el('th',name));table.append(head);
   for(const row of draft.rows){
    const tr=el('tr');for(const value of [row.id,row.product,row.description,row.rawPrice,row.currency,row.unit,row.rawQuantity,row.quantityUnit,row.number,row.item,row.location])tr.append(el('td',value||'—'));table.append(tr);
    if(row.warning)details.append(el('p',`Fila ${row.id}: ${row.warning}`,'notice'));
   }
   wrap.append(table);details.append(wrap);
   for(const notice of draft.notices||[])details.append(el('p',notice,'notice'));
   details.append(el('p','Podés corregirlo en el chat: «fila 2 precio 60», «fila 2 cantidad 2,5 millares», «fila 2 producto Z1304003» o «excluí fila 2».'));
   card.append(details);document.querySelector('#query').focus();
  }catch(error){status.textContent=error.message;}finally{loading=false;button.disabled=!capabilities.documents?.available;file.value='';}
 };
 const previousBatch=localStorage.getItem('central-last-price-batch');
 if(previousBatch){
  const restore=el('button','Ver último resumen');restore.type='button';menu.append(restore);
  restore.onclick=async()=>{menu.hidden=true;try{renderImportBatch(document.querySelector('#conversation'),await api('/api/price-imports/batches/'+previousBatch),{api,capabilities});}catch(error){restore.textContent=error.message;}};
 }
 const saved=localStorage.getItem('central-chat-attachment');
 if(saved){const version=revision;api('/api/price-imports/'+saved).then(draft=>{if(version===revision&&draft.branch===document.querySelector('#branch').value)receive(draft);}).catch(()=>{if(version===revision)clear();});}
 return {clear,receive,setChatBusy(value){chatBusy=value;button.disabled=value||loading||!capabilities.documents?.available;const remove=chip.querySelector('button');if(remove)remove.disabled=value;if(value){menu.hidden=true;button.setAttribute('aria-expanded','false');}},get id(){return current?.id||(clearRequested?null:undefined);},get busy(){return loading;}};
}

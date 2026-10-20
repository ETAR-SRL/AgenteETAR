const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
export function installPriceImports({api,capabilities,renderProposal}){
 const actions=capabilities.proposalActions||{},kinds=[];
 if(actions.precioListaProveedor)kinds.push(['proveedor','Proveedor · AIB']);
 if(actions.precioLista)kinds.push(['cliente','Cliente · DA1']);
 if(!kinds.length)return;
 const controls=el('div',undefined,'import-controls'),kind=el('select'),file=el('input'),button=el('button','Adjuntar precios','secondary');
 kind.setAttribute('aria-label','Destino de la lista de precios');kinds.forEach(([value,label])=>{const o=el('option',label);o.value=value;kind.append(o);});
 file.type='file';file.accept='.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp';file.hidden=true;button.type='button';
 button.disabled=!capabilities.documents?.available;
 controls.append(kind,button,file,el('small',button.disabled?'Lector de documentos no instalado.':'Excel, foto o PDF · hasta 20 MB · lectura local'));
 document.querySelector('#query-form').after(controls);
 button.onclick=()=>file.click();
 file.onchange=async()=>{
  const selected=file.files[0];if(!selected)return;
  const where=document.querySelector('#conversation'),card=el('article',undefined,'answer-card'),status=el('p','Leyendo '+selected.name+'…');
  where.append(card);card.append(status);card.scrollIntoView({block:'start',behavior:'smooth'});button.disabled=true;
  try{
   if(selected.size>capabilities.documents.maxBytes)throw new Error('El archivo supera 20 MB.');
   const params=new URLSearchParams({kind:kind.value,sucursal:document.querySelector('#branch').value});
   const draft=await api('/api/price-imports?'+params,{method:'POST',headers:{'content-type':'application/octet-stream','x-file-name':encodeURIComponent(selected.name)},body:selected});
   localStorage.setItem('central-last-import',draft.id);review(card,draft);
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;file.value='';}
 };
 function field(parent,label,value='',placeholder=''){
  const wrap=el('label',label),input=el('input');input.value=value;input.placeholder=placeholder;wrap.append(input);parent.append(wrap);return input;
 }
 function review(card,draft){
  card.replaceChildren(el('h3','Precios desde '+draft.name),el('p',`Sucursal ${draft.branch} · ${draft.kind==='proveedor'?'Proveedor / AIB':'Cliente / DA1'} · primero revisá la lectura; después se verifica contra el ERP.`));
  for(const text of draft.notices||[])card.append(el('p',text,'notice'));
  const fields=el('div',undefined,'import-fields');card.append(fields);
  const party=field(fields,draft.kind==='proveedor'?'Proveedor':'Cliente',draft.defaults.party,'Nombre o código ERP');
  const shop=field(fields,'Tienda','','Opcional si es única'),list=field(fields,'Lista','','Opcional si es única / A1_TABELA');
  const currency=field(fields,'Moneda por defecto',draft.defaults.currency,'ARS, USD, EUR o código ERP');
  const unit=field(fields,'Base por defecto',draft.defaults.unit,'unidad, millar o UM del producto');
  card.append(el('p','Los importes se ingresan sin separadores de miles. “unidad” significa la unidad de medida del producto en SB1. Un precio por millar se divide por 1000 para productos UN. Los valores por fila prevalecen sobre los valores por defecto.'));
  const scroll=el('div',undefined,'table-wrap'),table=el('table'),head=el('tr'),body=el('tbody');table.append(head,body);scroll.append(table);card.append(scroll);
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
  const more=el('button','Agregar fila','secondary');more.type='button';more.onclick=()=>{add({id:'manual-'+(++manual)});checked.checked=false;prepare.disabled=true;};card.append(more);
  const details=el('details');details.append(el('summary','Ver texto extraído'),el('pre',draft.text));card.append(details);
  const checked=el('input');checked.type='checkbox';const label=el('label',undefined,'confirm-change');label.append(checked,document.createTextNode(' Revisé códigos, importes, moneda y unidad contra el archivo.'));card.append(label);
  const prepare=el('button','Verificar y preparar cambios','primary'),result=el('div');prepare.type='button';prepare.disabled=true;checked.onchange=()=>{prepare.disabled=!checked.checked;};card.append(prepare,result);
  // Editing any reviewed value invalidates the review confirmation.
  card.addEventListener('input',e=>{if(e.target!==checked&&!result.contains(e.target)){checked.checked=false;prepare.disabled=true;}});
  prepare.onclick=async()=>{
   prepare.disabled=true;result.replaceChildren(el('p','Verificando productos y precios actuales en el ERP…'));
   try{
    const rows=entries.filter(e=>e.select.checked).map(e=>Object.fromEntries(['id','product','description','price','currency','unit','record'].map(key=>[key,key==='id'?e.id:e[key].value])));
    const response=await api('/api/price-imports/'+draft.id+'/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reviewed:checked.checked,party:party.value,shop:shop.value,list:list.value,currency:currency.value,unit:unit.value,rows})});
    result.replaceChildren(el('p',response.message));
    for(const choice of response.choices||[]){const pick=el('button',`${choice.codigo} / ${choice.tienda} · ${choice.nombre}`,'secondary');pick.type='button';pick.onclick=()=>{party.value=choice.codigo;shop.value=choice.tienda;checked.checked=false;prepare.disabled=true;};result.append(pick);}
    for(const issue of response.issues||[]){
     result.append(el('p',`${issue.ubicacion} · ${issue.producto||'Producto sin código'}: ${issue.motivo}`,'notice'));
     const entry=entries.find(e=>e.id===issue.fila);
     if(entry&&issue.candidates?.length){
      entry.record.replaceChildren();const blank=el('option','Elegir registro ERP');blank.value='';entry.record.append(blank);
      for(const c of issue.candidates){const option=el('option',`${c.lista} · ítem ${c.item||'—'} · ${Number(c.precio).toLocaleString('es-AR',{maximumFractionDigits:8})} ${c.moneda||''} · desde ${c.desde||'—'} · tramo ${c.rango||'—'} · registro ${c.registro}`);option.value=c.registro;entry.record.append(option);}
      if(issue.hasMore)result.append(el('p','Hay más registros: completá la lista para reducir las opciones.','notice'));
     }
    }
    for(const proposal of response.proposals||[])renderProposal(result,proposal);
   }catch(error){result.replaceChildren(el('p',error.message,'error-box'));}finally{prepare.disabled=!checked.checked;}
  };
 }
 const saved=localStorage.getItem('central-last-import');
 if(saved){const restore=el('button','Retomar último adjunto','secondary');restore.type='button';controls.append(restore);restore.onclick=async()=>{try{const draft=await api('/api/price-imports/'+saved),card=el('article',undefined,'answer-card');document.querySelector('#conversation').append(card);review(card,draft);card.scrollIntoView({block:'start'});}catch(error){restore.textContent=error.message;restore.disabled=true;}};}
}

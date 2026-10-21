/** Approved guides are displayed locally as text; this module never calls an LLM. */
export function installApprovedKnowledgeUI({container,request,isAdmin=false}){
 const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 const root=node('section');root.className='panel';container.append(root);let destroyed=false,sequence=0,editing=null,directory;
 const status=node('p');status.setAttribute('role','status');
 const list=node('div'),branch=node('select'),query=node('input'),management=node('input');management.type='checkbox';query.type='search';query.maxLength=150;query.placeholder='Buscar una guía';
 const label=(text,input,parent)=>{const e=node('label',text+' ');e.append(input);parent.append(e);return input;};
 const action=(text,fn)=>{const b=node('button',text);b.type='button';b.className='secondary';b.addEventListener('click',async()=>{b.disabled=true;try{await fn();}catch(e){status.textContent=e.message||'No se pudo completar la operación.';}finally{b.disabled=false;}});return b;};
 root.append(node('h2','Conocimiento de la empresa'),node('p','Guías aportadas y aprobadas por personas. Verificá precios, cantidades y estados en su fuente actual. Las guías no autorizan cambios ni se envían automáticamente a IA.'),status);
 const search=node('form');label('Sucursal',branch,search);label('Buscar por título o contenido',query,search);const find=node('button','Buscar guías');find.type='submit';search.append(find);
 if(isAdmin)label('Administrar borradores y archivadas',management,search);root.append(search,list);
 search.addEventListener('submit',e=>{e.preventDefault();refresh().catch(showError);});management.addEventListener('change',()=>refresh().catch(showError));branch.addEventListener('change',()=>refresh().catch(showError));
 const editor=node('div');if(isAdmin)root.append(editor);
 const showError=e=>{status.textContent=e.message||'No se pudo consultar el conocimiento de la empresa.';};
 const date=s=>s?new Date(s).toLocaleString():'Pendiente';
 async function refresh(){
  if(destroyed||!branch.value)return;const turn=++sequence;status.textContent='Consultando guías autorizadas…';
  const params=new URLSearchParams({branch:branch.value,q:query.value,...(isAdmin&&management.checked?{management:'true'}:{})});
  const result=await request('/api/knowledge?'+params);if(destroyed||turn!==sequence)return;list.replaceChildren();
  for(const guide of result.data||[]){const card=node('article');card.className='source-card';
   card.append(node('h3',guide.title),node('p',`Guía ${guide.id} · revisión ${guide.revision} · ${guide.status==='approved'?'Aprobada':guide.status==='draft'?'Borrador':'Archivada'} · ${date(guide.approvedAt||guide.updatedAt)}`));
   const content=node('p',guide.text);content.style.whiteSpace='pre-wrap';card.append(content,node('p','Procedencia: '+guide.provenance),node('p',guide.policy||result.policy||'Guía aportada; no es una consulta actual del ERP.'));
   if(isAdmin)card.append(action('Revisar o corregir',async()=>{const current=await request('/api/knowledge/'+encodeURIComponent(guide.id)+'?management=true');edit(current.guide||current.data||current);}),action('Archivar guía',async()=>{await request('/api/knowledge/'+encodeURIComponent(guide.id)+'/archive',{method:'POST',body:{revision:guide.revision}});if(editing?.id===guide.id)edit();await refresh();status.textContent='Guía archivada. Sus revisiones anteriores se conservan.';}));
   list.append(card);
  }
  if(!result.data?.length)list.append(node('p','No hay guías que coincidan dentro de tu alcance.'));status.textContent='Consulta completada.';
 }
 function edit(guide){
  editing=guide||null;editor.replaceChildren(node('h3',guide?'Revisar guía · revisión '+guide.revision:'Nueva guía empresarial'));
  const form=node('form'),title=node('input'),text=node('textarea'),provenance=node('textarea'),scope=node('select'),state=node('select');
  title.maxLength=160;text.maxLength=4000;text.rows=6;provenance.maxLength=1000;provenance.rows=3;for(const input of [title,text,provenance,scope])input.required=true;
  title.value=guide?.title||'';text.value=guide?.text||'';provenance.value=guide?.provenance||'';
  for(const value of directory.branches||[]){const o=node('option',value);o.value=value;scope.append(o);}scope.value=guide?.branch||branch.value;
  for(const [value,name] of [['draft','Borrador: todavía sin publicar'],['approved','Aprobar y publicar para los destinatarios'],['archived','Archivar conservando revisiones']]){const o=node('option',name);o.value=value;state.append(o);}state.value='draft';
  label('Título',title,form);label('Guía aportada (hasta 4000 caracteres)',text,form);label('Procedencia: documento, responsable y fecha o edición',provenance,form);label('Sucursal de la guía',scope,form);
  const selections={requiredResources:new Set(guide?.requiredResources||[]),users:new Set(guide?.users||[]),roles:new Set(guide?.roles||[])};
  const names={productos:'Productos',clientes:'Clientes',proveedores:'Proveedores',costos:'Costos',ventas:'Ventas',compras:'Compras',proyectos:'Proyectos KAIQEN',calidad:'Calidad KAIQEN',preciosClientes:'Precios de venta',preciosProveedores:'Precios de compra',conocimientoEmpresa:'Conocimiento empresarial'};
  const resources=Object.keys(directory.resourceRequirements||{}).map(id=>({id,name:names[id]||id.replace(/([A-Z])/g,' $1')}));
  for(const [key,heading,items] of [['requiredResources','Fuentes que el lector debe tener autorizadas',resources],['users','Usuarios destinatarios',directory.users||[]],['roles','Roles destinatarios',directory.roles||[]]]){
   const group=node('fieldset');group.append(node('legend',heading));
   for(const item of items){const check=node('input');check.type='checkbox';check.checked=selections[key].has(item.id);check.addEventListener('change',()=>check.checked?selections[key].add(item.id):selections[key].delete(item.id));label((item.name||item.username||item.id)+(item.active===0?' (inactivo)':''),check,group);}
   if(!items.length)group.append(node('p','No hay opciones disponibles.'));form.append(group);
  }
  label('Estado de esta nueva revisión',state,form);form.append(node('p','Corregir crea una revisión nueva. Elegí aprobar explícitamente para publicarla; por defecto se guarda como borrador.'));
  const save=node('button','Guardar nueva revisión');save.type='submit';save.className='primary';form.append(save,action('Empezar otra guía',()=>edit()));
  form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{
   const value={...(editing?{id:editing.id,revision:editing.revision}:{}),title:title.value,text:text.value,provenance:provenance.value,branch:scope.value,status:state.value,requiredResources:[...selections.requiredResources],users:[...selections.users],roles:[...selections.roles]};
   const saved=await request('/api/knowledge',{method:'POST',body:value});edit(saved.guide||saved.data||saved);await refresh();status.textContent='Nueva revisión guardada. Los destinatarios sólo ven guías aprobadas.';
  }catch(e){showError(e);}finally{save.disabled=false;}});editor.append(form);
 }
 async function initialize(){
  const capabilities=await request('/api/capabilities');if(destroyed)return;
  if(isAdmin)directory=await request('/api/admin/access');if(destroyed)return;
  for(const value of capabilities.branches||[]){const o=node('option',value);o.value=value;branch.append(o);}if(isAdmin)edit();await refresh();
 }
 initialize().catch(showError);return {refresh,destroy(){destroyed=true;sequence++;root.remove();}};
}

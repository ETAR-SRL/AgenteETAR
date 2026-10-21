const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const labels={queued:'En espera',running:'Investigando las fuentes',waiting_source:'Esperando que vuelva la fuente',paused:'Pausada',paused_access:'Pausada: cambiaron los accesos',cancelled:'Cancelada',failed:'No se pudo completar',completed:'Lista para consultar'};
export function installInvestigations({api,container,onResult,notice,branch}){
 let timer,loading=false,stopped=false;
 const cards=new Map();
 async function paint(where,job){
  if(stopped)return;where.replaceChildren();where.className='source-card investigation-card';where.append(node('h3','Investigación del caso'),node('p',labels[job.status]||'Pendiente'),node('small',`Última revisión: ${new Date(job.updated).toLocaleString('es-AR')}. Sólo lectura; no ejecuta cambios.`));
  const actions=node('div');actions.className='result-actions';
  const action=(label,fn)=>{const b=node('button',label);b.type='button';b.className='secondary';b.onclick=async()=>{if(stopped)return;b.disabled=true;try{await fn();}catch(e){if(!stopped){where.replaceChildren(node('p','No pude comprobar tus accesos o el estado actual. Volvé a abrir el caso.'));notice(e.message);}}finally{b.disabled=false;}};actions.append(b);};
  if(job.status==='completed'&&job.result)action('Ver hallazgos',async()=>{const current=await api(`/api/investigations/${encodeURIComponent(job.id)}`);if(stopped)return;if(current.status==='completed'&&current.result)onResult({...current.result,job:undefined});else await paint(where,current);});
  if(['queued','running','waiting_source'].includes(job.status))action('Pausar',async()=>paint(where,await api(`/api/investigations/${job.id}/action`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pause'})})));
  if(['paused','paused_access','failed'].includes(job.status))action('Retomar',async()=>paint(where,await api(`/api/investigations/${job.id}/action`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'resume'})})));
  if(!['completed','cancelled'].includes(job.status))action('Cancelar investigación',async()=>paint(where,await api(`/api/investigations/${job.id}/action`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel'})})));
  where.append(actions);
 }
 async function load(){if(stopped||loading||document.hidden)return;loading=true;try{const result=await api('/api/investigations');if(stopped)return;list.replaceChildren();const jobs=result.data.filter(j=>j.branch===branch());if(!jobs.length)list.append(node('p','No tenés investigaciones en esta sucursal. Podés iniciarlas desde un caso o por chat.'));for(const job of jobs){const card=node('article');list.append(card);await paint(card,job);}for(const [where,id] of cards){if(!where.isConnected){cards.delete(where);continue;}const job=result.data.find(j=>j.id===id);if(job)await paint(where,job);else where.replaceChildren(node('p','La investigación ya no está disponible con tus accesos actuales.'));}}catch(e){if(stopped)return;notice(e.message);for(const where of cards.keys())where.replaceChildren(node('p','No pude comprobar tus accesos o el estado actual. Volvé a abrir el caso.'));list.replaceChildren(node('p','No pude consultar tus trabajos.'));}finally{loading=false;}}
 const section=node('details');section.className='source-card';section.append(node('summary','Mis trabajos e investigaciones'));const list=node('div');section.append(list);container.append(section);section.addEventListener('toggle',()=>{if(section.open)void load();});
 timer=setInterval(()=>{if(section.open||cards.size)void load();},10000);
 return {load,render(where,job){if(stopped)return;const card=node('article');where.append(card);cards.set(card,job.id);void paint(card,job);},destroy(){stopped=true;clearInterval(timer);for(const card of cards.keys())card.remove();cards.clear();section.remove();}};
}

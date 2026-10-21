import {reportChat,reportPeriod} from './report-chat.js';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?!.,]+$/g,'').replace(/\s+/g,' ').trim();
const clean=s=>String(s||'').trim().replace(/^["«]|["»]$/g,'').trim();
const reply=(answer,choices)=>({answer,evidence:[],trace:[],...(choices?.length?{choices}:{})});
const fingerprint=r=>JSON.stringify(r&&{branch:r.branch,resource:r.resource,filters:r.filters});
function command(text){
 const s=text.trim().replace(/^(?:(?:che|por favor|porfa|ahora|perfecto|bueno)[, ]+|(?:quiero|necesito|podes|podés)\s+)+/i,'');
 if(/^(?:mostrame|mostrar|ver|lista|listar)\s+(?:mis |los )?dashboards(?: guardados| compartidos)?[?!.]*$/i.test(s))return {action:'list'};
 const revoke=/^(?:dej[aá](?:r)? de compartir|no (?:lo )?compartas(?: m[aá]s)?|quit[aá](?:le|les|r)? (?:el )?acceso|sac[aá](?:le|les|r)? (?:el )?acceso|revoc[aá](?:r)? (?:el )?acceso)(?=\s|$)\s*(.*)$/i.exec(s);
 if(revoke){
  const parts=(' '+revoke[1]).split(/\s+(?:con|a|al)\s+/i);
  let reference=clean(parts[0]),recipientText=parts.slice(1).join(' con ');
  if(/^(?:quit|sac|revoc)/i.test(s)){
   const m=/^(.+?)\s+(?:en|del|de este|de ese)\s+(?:el )?(?:dashboard|informe|reporte)?\s*(.*)$/i.exec(recipientText);
   if(m){recipientText=m[1];reference=m[2];}
  }
  return {action:'unshare',reference:clean(reference.replace(/^(?:el |mi |este |ese )?(?:dashboard|informe|reporte)(?: guardado)?\s*/i,'')),recipientText};
 }
 let m=/^(?:guard[aá](?:me|lo)?|guardar|salv[aá](?:me|lo)?)(?=\s|$)\s*(.*)$/i.exec(s);
 if(m&&(/dashboard|informe|reporte|resumen|grafico|gráfico|como|nombre/i.test(m[1])||!m[1]||/^(?:esto|este|ese)$/i.test(m[1])))return {action:'save',name:clean(((/\b(?:como|con (?:el )?nombre)\s+(.+)$/i.exec(m[1])||[])[1]||'').replace(/\s+(?:con )?fechas (?:fijas|exactas)$/i,'')),fixed:/fechas (?:fijas|exactas)/i.test(m[1])};
 if(/^abr[ií]lo[.!]?$/i.test(s))return {action:'open',reference:''};
 m=/^(?:abr[ií](?:me|lo)?|abrir|mostr[aá]me|ver)\s+(.*)$/i.exec(s);
 if(m&&(/^abr/i.test(s)||/\bguardado\b/i.test(m[1])||/^(?:ese|este|el mismo|lo)$/i.test(m[1])))return {action:'open',reference:clean(m[1].replace(/^(?:el |mi |un )?(?:dashboard|informe|reporte)(?: guardado)?\s*/i,''))};
 m=/^(?:compart[ií](?:me|lo)?|compartir)(?=\s|$)\s*(.*)$/i.exec(s);
 if(m){const parts=(' '+m[1]).split(/\s+con\s+/i);return {action:'share',reference:clean(clean(parts[0]).replace(/^(?:el |mi |este |ese )?(?:dashboard|informe|reporte)(?: guardado)?\s*/i,'')),recipientText:parts.slice(1).join(' con ')};}
 return null;
}
function recipientParts(text){
 const segments=[];let part='',quoted=false;
 const value=String(text||'').replace(/^con\s+/i,'');
 for(let i=0;i<value.length;i++){const c=value[i];if(c==='"'||c==='«'||c==='»')quoted=!quoted;
  const separator=!quoted&&(/[,;]/.test(c)||value.slice(i).match(/^\s+y\s+/i));
  if(separator){segments.push(part);part='';if(typeof separator==='object')i+=separator[0].length-1;}else part+=c;
 }segments.push(part);
 return segments.map(value=>{const m=/^(?:el |la |los |las |al |a la )?(usuario(?:s)?|rol|roles|grupo)\s+(.+)$/i.exec(value.trim());return {kind:m?/rol|grupo/i.test(m[1])?'role':'user':undefined,text:clean(m?m[2]:value)};}).filter(p=>p.text);
}
export function createDashboardChat({dashboards,principal,executeRead,read,authorizeRead,clock=()=>new Date()}){
 return async function dashboardChat({text,conversation,branch}){
  let draft=conversation.dashboardDraft;
  if(draft?.branch!==branch){delete conversation.dashboardDraft;draft=null;}
  if(draft&&/^(?:cancel[aá](?:r|lo)?|dej[aá](?:lo)?|olvid[aá](?:lo)?|no gracias)[.!]?$/i.test(text.trim())){delete conversation.dashboardDraft;return reply('Listo, cancelé la gestión del dashboard.');}
  const intent=command(text);
  if(!intent&&!draft)return null;
  if(!intent&&draft&&/^(?:mostrame|creame|crea|actualiza|cambia|dashboard|resumen|cuanto|cuál|cual|a que precio)\b/i.test(text.trim())){delete conversation.dashboardDraft;return null;}
  const p=principal();
  const available=()=>dashboards.list(p);
  const today=clock().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'});
  if(intent?.action==='list'){delete conversation.dashboardDraft;const rows=available();return reply(rows.length?'Estos son tus dashboards disponibles:':'Todavía no tenés dashboards guardados ni compartidos.',rows.map(r=>({label:`${r.name} · ${r.owned?'propio':'compartido'} · ${r.dashboard.filters.sucursal}`,text:`Abrí el dashboard "${r.name}"`})) );}
  // A new command replaces an unfinished one. Plain replies only fill the outstanding slot.
  if(intent){draft={...intent,branch,targets:[]};conversation.dashboardDraft=draft;}
  else if(draft.choices){
   const n=/^(?:opci[oó]n |el |la )?(\d+)[.!]?$/i.exec(text.trim()),q=norm(text).replace(/^(?:el |la )?(?:usuario|rol)[: ]+/,''),matches=draft.choices.filter(c=>norm(c.label).includes(q));
   const selected=n?draft.choices[Number(n[1])-1]:matches.length===1?matches[0]:null;
   if(!selected)return reply('Elegí una de estas opciones para continuar.',draft.choices.map((c,i)=>({label:`${i+1}. ${c.label}`,text:`Opción ${i+1}`})));
   if(draft.wait==='dashboard')draft.dashboardId=selected.id;
   else{draft.targets.push(selected.target);draft.parts.shift();}
   delete draft.choices;delete draft.wait;
  }else if(draft.wait==='name'){draft.name=clean(text.replace(/^(?:llam[aá]lo|ponele|que se llame|con (?:el )?nombre)\s+/i,''));delete draft.wait;}
  else if(draft.wait==='recipientCorrection'){draft.parts=[...recipientParts(text),...draft.parts.slice(1)];delete draft.wait;}
  else if(draft.wait==='recipients'){draft.parts=recipientParts(text);delete draft.wait;}
  else if(draft.wait==='dashboard'){draft.reference=clean(text);delete draft.wait;}
  else if(!intent){delete conversation.dashboardDraft;return null;}
  const choose=(question,choices,wait)=>{draft.choices=choices;draft.wait=wait;return reply(question,choices.map((c,i)=>({label:`${i+1}. ${c.label}`,text:`Opción ${i+1}`})));};
  if(draft.action==='save'){
   if(!draft.report){const r=conversation.reportContext;if(!r||r.branch!==branch){delete conversation.dashboardDraft;return reply('Primero pedime el dashboard que querés guardar, con sus filtros. Después decime «guardalo como…».');}draft.report=structuredClone(r);}
   if(!draft.name){draft.wait='name';return reply('¿Qué nombre querés ponerle a este dashboard?');}
   const r=draft.report;let period='fijo';if(!draft.fixed){for(const name of ['este mes','mes pasado','este año','año pasado']){const range=reportPeriod(name,today);if(r.filters.desde===range.desde&&r.filters.hasta===range.hasta){period=name;break;}}}
   const saved=dashboards.save(p,{name:draft.name,period,dashboard:{mode:'summary',resource:r.resource,filters:{...r.filters,sucursal:r.branch}}});conversation.dashboardFocus={id:saved.id,fingerprint:fingerprint(conversation.reportContext)};delete conversation.dashboardDraft;
   return reply(`Guardé **${saved.name}**, con sus filtros y sucursal ${r.branch}. Período: **${period==='fijo'?'fechas fijas':period}**. Al abrirlo vuelvo a consultar los datos con tus permisos.`);
  }
  if(!draft.dashboardId){
   const reference=norm(draft.reference),contextual=!reference||/^(?:este|ese|esto|el mismo|lo)$/.test(reference);
   if(contextual&&conversation.dashboardFocus&&conversation.dashboardFocus.fingerprint===fingerprint(conversation.reportContext))draft.dashboardId=conversation.dashboardFocus.id;
   else{
    let rows=available();if(['share','unshare'].includes(draft.action))rows=rows.filter(r=>r.owned);
    if(!contextual){const exact=rows.filter(r=>norm(r.name)===reference);rows=exact.length?exact:rows.filter(r=>norm(r.name).includes(reference));}
    if(contextual&&conversation.reportContext){
     const same=rows.filter(r=>{const opened=dashboards.open(p,r.id),current=conversation.reportContext;return opened.dashboard.resource===current.resource&&opened.dashboard.filters.sucursal===current.branch&&Object.entries(opened.dashboard.filters).every(([k,v])=>k==='sucursal'||current.filters[k]===v);});if(same.length)rows=same;
    }
    if(rows.length===1)draft.dashboardId=rows[0].id;
    else if(rows.length)return choose('¿Qué dashboard querés '+(draft.action==='share'?'compartir':draft.action==='unshare'?'dejar de compartir':'abrir')+'?',rows.map(r=>({id:r.id,label:`${r.name} · ${r.owned?'propio':'compartido'} · sucursal ${r.dashboard.filters.sucursal}`})),'dashboard');
    else{draft.wait='dashboard';return reply('No encontré un dashboard disponible con ese nombre. ¿Cómo se llama el que querés '+(draft.action==='share'?'compartir':draft.action==='unshare'?'dejar de compartir':'abrir')+'?');}
   }
  }
  if(draft.action==='open'){
   const saved=dashboards.open(p,draft.dashboardId),savedBranch=saved.dashboard.filters.sucursal;
   const report=await reportChat({text:'Abrir dashboard guardado',conversation,branch:savedBranch,executeRead,read,authorizeRead,request:saved.dashboard});
   if(!report.evidence?.some(e=>e.result.kind==='dashboard'))return report;
   conversation.dashboardFocus={id:saved.id,fingerprint:fingerprint(conversation.reportContext)};delete conversation.dashboardDraft;
   return {...report,selectedBranch:savedBranch,answer:`**${saved.name}** · datos actualizados\n\n${report.answer}`};
  }
  const revoking=draft.action==='unshare';
  const assigned=revoking?dashboards.revocation(p,draft.dashboardId).assigned:null;
  const options=revoking?{users:assigned.filter(t=>t.kind==='user').map(t=>({id:t.target,name:t.name})),roles:assigned.filter(t=>t.kind==='role').map(t=>({id:t.target,name:t.name})),selected:assigned.map(({kind,target})=>({kind,target}))}:dashboards.sharing(p,draft.dashboardId); // Reauthorize ownership before looking up any recipient.
  if(revoking&&!assigned.length){delete conversation.dashboardDraft;return reply('Este dashboard ya no está compartido con ningún usuario ni rol. No cambié nada.');}
  draft.parts ||= recipientParts(draft.recipientText);
  if(!draft.parts.length&&!draft.targets.length){draft.wait='recipients';return reply(revoking?'¿Con qué usuario o rol querés dejar de compartirlo? Podés decirme varios nombres.':'¿Con qué usuario o rol querés compartirlo? Podés decirme varios nombres.');}
  while(draft.parts.length){
   const part=draft.parts[0],pool=[...options.users.map(r=>({...r,kind:'user'})),...options.roles.map(r=>({...r,kind:'role'}))].filter(r=>!part.kind||r.kind===part.kind),q=norm(part.text);
   const aliases=r=>[norm(r.name),norm(r.name.replace(/\s*\([^)]*\)\s*$/,'')),norm(/\(([^)]+)\)$/.exec(r.name)?.[1])];
   const exact=pool.filter(r=>aliases(r).includes(q)),matches=exact.length?exact:pool.filter(r=>aliases(r).some(a=>a.includes(q)));
   if(matches.length===1){draft.targets.push({kind:matches[0].kind,target:matches[0].id});draft.parts.shift();}
   else if(matches.length)return choose(`Encontré varias coincidencias para «${part.text}». ¿Cuál querés?`,matches.map(r=>({label:`${r.kind==='user'?'Usuario':'Rol'}: ${r.name}`,target:{kind:r.kind,target:r.id}})),'recipient');
   else{if(revoking){delete conversation.dashboardDraft;return reply(`No encontré una asignación compartida para «${part.text}» en este dashboard. No quité ningún acceso.`);}draft.wait='recipientCorrection';return reply(`No encontré «${part.text}» entre los usuarios o roles habilitados para este dashboard. Decime el destinatario correcto. Conservé los que ya identifiqué.`);}
  }
  if(revoking){
   const targets=[...new Map(draft.targets.map(t=>[t.kind+':'+t.target,t])).values()],names=targets.map(t=>(t.kind==='user'?options.users:options.roles).find(r=>r.id===t.target)?.name||t.target),result=dashboards.unshare(p,draft.dashboardId,{targets});delete conversation.dashboardDraft;
   return reply(result.removed?`Dejé de compartir el dashboard con **${names.join(', ')}**. Conservé las asignaciones de los demás.${targets.some(t=>t.kind==='user')&&options.roles.length?' Si esa persona también recibe acceso por un rol que sigue compartido, conservará ese acceso.':''}`:'Esas asignaciones ya se habían quitado. Conservé las de los demás.');
  }
  const targets=[...new Map([...options.selected,...draft.targets].map(t=>[t.kind+':'+t.target,t])).values()];
  dashboards.share(p,draft.dashboardId,{targets});const names=draft.targets.map(t=>(t.kind==='user'?options.users:options.roles).find(r=>r.id===t.target)?.name).filter(Boolean);delete conversation.dashboardDraft;
  return reply(`Compartí el dashboard con **${[...new Set(names)].join(', ')}**. Se conservan los destinatarios anteriores. Cada persona lo abre con datos actuales y sus propios permisos; sólo vos administrás el original.`);
 };
}

import {assert} from '../errors.js';
import {reportChat,reportPeriod} from './report-chat.js';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?!.,]+$/g,'').replace(/\s+/g,' ').trim();
const clean=s=>String(s||'').trim().replace(/^["«]|["»]$/g,'').trim();
const reply=(answer,choices)=>({answer,evidence:[],trace:[],...(choices?.length?{choices}:{})});
const fingerprint=r=>JSON.stringify(r&&{branch:r.branch,resource:r.resource,filters:r.filters});
function command(text){
 const s=text.trim().replace(/^[¿¡]/,'').replace(/[?!.]+$/,'').replace(/^(?:(?:che|por favor|porfa|ahora|perfecto|bueno)[, ]+|(?:quiero|necesito|podes|podés)\s+)+/i,'');
 if(/^(?:mostrame|mostrar|ver|lista|listar) (?:mis |los )?filtros(?: guardados)?(?: de historial)?$/i.test(s))return {action:'presetList'};
 const contextualPreset=/^guard[aá]los(?: como (.*))?$/i.exec(s);if(contextualPreset)return {action:'presetSave',name:clean((contextualPreset[1]||'').replace(/\s+(?:con )?fechas (?:fijas|exactas)$/i,'')),fixed:/fechas (?:fijas|exactas)/i.test(s)};
 let presetMatch=/^(?:guard[aá](?:me|lo|los)?|guardar) (?:estos |los |mis )?filtros(?: del? historial)?(?: como | con (?:el )?nombre )?(.*)$/i.exec(s);
 if(presetMatch)return {action:'presetSave',name:clean(presetMatch[1].replace(/\s+(?:con )?fechas (?:fijas|exactas)$/i,'')),fixed:/fechas (?:fijas|exactas)/i.test(s)};
 presetMatch=/^(?:aplic[aá](?:me|r)?|us[aá](?:r)?|consult[aá](?:r)? con|export[aá](?:r)? con|descarg[aá](?:r)? con) (?:los |mis )?filtros(?: guardados)?(?: de historial)?\s*(.*)$/i.exec(s);
 if(presetMatch)return {action:'presetApply',name:clean(presetMatch[1].replace(/\s+en excel$/i,''))};
 if(/^(?:mostrame|mostrar|ver|lista|listar)\s+(?:mis |los )?dashboards(?: guardados| compartidos)?[?!.]*$/i.test(s))return {action:'list'};
 const historyQuery=/^(?:(?:mostrame|mostrar|ver|consultar|decime|dame|descarg[aá](?:me|lo|r)?|export[aá](?:me|lo|r)?|baj[aá](?:me|lo|r)?)\s+)?(?:el )?(?:historial|historia|hist[oó]rico)(?:\s+(?:del|de))?\s*(.*)$/i.exec(s);
 const historyWho=/^qui[eé]n (?:lo )?(?:comparti[oó]|quit[oó] (?:los )?accesos|revoc[oó] (?:los )?accesos)(?:\s+(?:del|de|al))?\s*(.*)$/i.exec(s);
 if(historyQuery||historyWho){const reference=(historyQuery||historyWho)[1];return {action:'history',reference:clean(reference.replace(/^(?:el |mi |este |ese )?(?:dashboard|informe|reporte)(?: guardado)?\s*/i,''))};}
 const accessQuery=/^(?:(?:decime|mostrame|quiero saber|saber) )?(?:con qui[eé]n(?:es)? (?:est[aá]|est[aá]s|est[aá]n|estoy|lo tengo|tengo) compartido|con qui[eé]n(?:es)? (?:lo )?compart[ií]|a qui[eé]n(?:es)? (?:le |les )?compart[ií]|qui[eé]n(?:es)? (?:puede|pueden) ver|qui[eé]n(?:es)? (?:tiene|tienen) acceso (?:al|a)|mostrame (?:los )?(?:accesos|destinatarios)(?: de)?|ver (?:los )?accesos(?: de)?)\s*(.*)$/i.exec(s);
 const userAccess=/^(?:(?:decime|mostrame) si )?(?:y )?(?:el usuario |la usuaria )?(.+?)\s+(?:accede|tiene acceso|puede ver)(?:\s+(?:directamente|por un rol|directamente o por un rol))?(?:\s+(?:a|al|en)\s+(.+?))?(?:\s+(?:directamente o por un rol|directamente|por un rol))?$/i.exec(s);
 if(accessQuery||userAccess){const reference=accessQuery?accessQuery[1]:userAccess[2]||'';return {action:'inspect',reference:clean(reference.replace(/^(?:el |mi |este |ese )?(?:dashboard|informe|reporte)(?: guardado)?\s*/i,'')),userQuery:userAccess?clean(userAccess[1]):undefined};}
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
function historyFilterText(text,today){
 const filters={},names={};let period;let remaining=String(text||'').replace(/\b(?:descarg[aá](?:lo|r)?|export[aá](?:lo|r)?|baj[aá](?:lo|r)?)\b/gi,'').replace(/\b(?:en |a )?excel\b/gi,'');
 remaining=remaining.replace(/\b(?:(?:solo|solamente)\s+)?(?:(?:los )?accesos\s+|(?:por )?tipo(?: de cambio)?\s+)?(?:los\s+)?(agregados|quitados|sin cambios)\b/gi,(_,kind)=>{assert(!filters.tipo,400,'TIPO_AMBIGUO','Elegí un único tipo: accesos agregados, quitados o sin cambios.');filters.tipo=norm(kind)==='sin cambios'?'sin_cambios':norm(kind);return ' ';});
 const date=value=>{if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const [d,m,y]=value.split('/');return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;};
 remaining=remaining.replace(/\b(desde|hasta)\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/gi,(_,k,v)=>{assert(!Object.hasOwn(filters,k.toLowerCase()),400,'FILTRO_DUPLICADO','Indicá una sola fecha '+k+'.');period='fijo';filters[k.toLowerCase()]=date(v);return ' ';});
 remaining=remaining.replace(/\b(este mes|mes pasado|este a[nñ]o|a[nñ]o pasado|hoy|ayer)\b/gi,(_,p)=>{assert(!filters.desde&&!filters.hasta,400,'FECHAS_AMBIGUAS','Usá un período relativo o fechas exactas, sin mezclarlos.');period=norm(p).replace('ano','año');if(/hoy|ayer/i.test(p)){const d=new Date(today+'T12:00:00Z');if(/ayer/i.test(p))d.setUTCDate(d.getUTCDate()-1);filters.desde=filters.hasta=d.toISOString().slice(0,10);}else Object.assign(filters,reportPeriod(norm(p).replace('ano','año'),today));return ' ';});
 remaining=remaining.replace(/\b(?:realizados|realizadas|hechos|hechas|efectuados|efectuadas)\s+por\s+(?:el usuario )?/gi,'autor ');
 const keyPattern='autor|usuario(?: destinatario)?|destinatario(?: usuario| rol)?|rol(?: destinatario)?';
 const subjects=new RegExp('(?:(?:\\by\\s+)?(?:el\\s+)?)?(?:\\b(?:del?|por|para)\\s+(?:el )?)?\\b('+keyPattern+')\\s+(?:"([^\"]+)"|«([^»]+)»|(.+?))(?=\\s+(?:(?:y )?(?:(?:del?|por|para) )?(?:el )?(?:'+keyPattern+')\\b)|$)','gi');
 remaining=remaining.replace(subjects,(_,k,q,a,v)=>{const key=/autor/i.test(k)?'autor':/rol/i.test(k)?'rol':'destinatario';assert(!Object.hasOwn(names,key),400,'FILTRO_DUPLICADO','Indicá un solo '+key+' para filtrar.');names[key]=clean(q||a||v).replace(/\s+y$/i,'');return ' ';});
 assert(!/\b(autor|destinatario|usuario|rol|desde|hasta|tipo)\b/i.test(remaining),400,'FILTRO_INCOMPLETO','Completá el autor o destinatario, o indicá las fechas como DD/MM/AAAA o AAAA-MM-DD. No apliqué un filtro incompleto.');
 remaining=remaining.replace(/\s+/g,' ').replace(/(?:\s+|^)(?:y|por|para|del?|el)$/gi,'').trim();
 return {reference:remaining,filters,names,period};
}
export function createDashboardChat({dashboards,principal,executeRead,read,authorizeRead,clock=()=>new Date()}){
 return async function dashboardChat({text,conversation,branch}){
  let draft=conversation.dashboardDraft;
  if(draft?.branch!==branch){delete conversation.dashboardDraft;draft=null;}
  if(draft&&/^(?:cancel[aá](?:r|lo)?|dej[aá](?:lo)?|olvid[aá](?:lo)?|no gracias)[.!]?$/i.test(text.trim())){delete conversation.dashboardDraft;return reply('Listo, cancelé la gestión del dashboard.');}
  const more=/^(?:mostrame |ver )?m[aá]s historial(?: de este dashboard)?[.!]?$/i.test(text.trim());
  let intent=more?(conversation.dashboardHistory?.branch===branch&&conversation.dashboardFocus?.id===conversation.dashboardHistory.id?{action:'history',dashboardId:conversation.dashboardHistory.id,page:conversation.dashboardHistory.page+1}:{action:'history',reference:''}):command(text);
  if(conversation.dashboardHistory?.branch===branch&&conversation.dashboardFocus?.id===conversation.dashboardHistory.id&&/^(?:mostrame |dame |y |filtr[aá](?:lo|r)? |solo |solamente )*(?:los )?(?:accesos )?(?:agregados|quitados|sin cambios)[.!?]?$/i.test(text.trim()))intent={action:'history',dashboardId:conversation.dashboardHistory.id,reference:text.replace(/^(?:mostrame |dame |y |filtr[aá](?:lo|r)? )+/i,''),inheritFilters:true};
  if(!intent&&conversation.dashboardHistory?.branch===branch&&conversation.dashboardFocus?.id===conversation.dashboardHistory.id&&/^(?:y |filtr[aá](?:lo|r)? |solo |desde |hasta |descarg[aá](?:me|lo|r)? |export[aá](?:me|lo|r)? |baj[aá](?:me|lo|r)? )/i.test(text.trim()))intent={action:'history',dashboardId:conversation.dashboardHistory.id,reference:text.replace(/^(?:y |filtr[aá](?:lo|r)? |solo )/i,''),inheritFilters:true};
  if(!intent&&!draft)return null;
  if(!intent&&draft&&/^(?:mostrame|creame|crea|actualiza|cambia|dashboard|resumen|cuanto|cuál|cual|a que precio)\b/i.test(text.trim())){delete conversation.dashboardDraft;return null;}
  const p=principal();
  const available=()=>dashboards.list(p);
  const today=clock().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'});
  if(intent?.action==='presetList'){delete conversation.dashboardDraft;const rows=dashboards.listHistoryFilters(p);return reply(rows.length?'Estos son tus filtros de historial guardados:':'Todavía no guardaste filtros de historial.',rows.map(r=>({label:`${r.name} · ${r.dashboardName} · ${r.period}`,text:`Aplicá los filtros "${r.name}"`})) );}
  if(intent?.action==='list'){delete conversation.dashboardDraft;const rows=available();return reply(rows.length?'Estos son tus dashboards disponibles:':'Todavía no tenés dashboards guardados ni compartidos.',rows.map(r=>({label:`${r.name} · ${r.owned?'propio':'compartido'} · ${r.dashboard.filters.sucursal}`,text:`Abrí el dashboard "${r.name}"`})) );}
  // A new command replaces an unfinished one. Plain replies only fill the outstanding slot.
  if(intent){draft={...intent,branch,targets:[]};if(intent.action==='history'){const parsed=historyFilterText(intent.reference||'',today);draft.reference=parsed.reference;draft.filters={...(intent.inheritFilters||intent.page?conversation.dashboardHistory?.filters:{}),...parsed.filters};draft.period=parsed.period||((intent.inheritFilters||intent.page)?conversation.dashboardHistory?.period:undefined)||'fijo';draft.filterNames=parsed.names;if(parsed.names.destinatario)delete draft.filters.usuario;}conversation.dashboardDraft=draft;}
  else if(draft.choices){
   const n=/^(?:opci[oó]n |el |la )?(\d+)[.!]?$/i.exec(text.trim()),q=norm(text).replace(/^(?:el |la )?(?:usuario|rol)[: ]+/,''),matches=draft.choices.filter(c=>norm(c.label).includes(q));
   const selected=n?draft.choices[Number(n[1])-1]:matches.length===1?matches[0]:null;
   if(!selected)return reply('Elegí una de estas opciones para continuar.',draft.choices.map((c,i)=>({label:`${i+1}. ${c.label}`,text:`Opción ${i+1}`})));
   if(draft.wait==='preset')draft.presetId=selected.id;
   else if(draft.wait==='dashboard')draft.dashboardId=selected.id;
   else if(draft.wait==='accessUser')draft.userId=selected.id;
   else if(['historyUser','historyRole','historyAuthor','historyDestination'].includes(draft.wait)){const key={historyUser:'usuario',historyRole:'rol',historyAuthor:'autor',historyDestination:'destinatario'}[draft.wait];draft.filters[key]=selected.id;delete draft.filterNames[key];}
   else{draft.targets.push(selected.target);draft.parts.shift();}
   delete draft.choices;delete draft.wait;
  }else if(draft.wait==='name'){draft.name=clean(text.replace(/^(?:llam[aá]lo|ponele|que se llame|con (?:el )?nombre)\s+/i,''));delete draft.wait;}
  else if(draft.wait==='recipientCorrection'){draft.parts=[...recipientParts(text),...draft.parts.slice(1)];delete draft.wait;}
  else if(draft.wait==='recipients'){draft.parts=recipientParts(text);delete draft.wait;}
  else if(draft.wait==='presetName'){draft.name=clean(text);delete draft.wait;}
  else if(draft.wait==='dashboard'){draft.reference=clean(text);delete draft.wait;}
  else if(!intent){delete conversation.dashboardDraft;return null;}
  const choose=(question,choices,wait)=>{draft.choices=choices;draft.wait=wait;return reply(question,choices.map((c,i)=>({label:`${i+1}. ${c.label}`,text:`Opción ${i+1}`})));};
  if(draft.action==='presetSave'){
   const history=conversation.dashboardHistory;if(!history||history.branch!==branch||conversation.dashboardFocus?.id!==history.id){delete conversation.dashboardDraft;return reply('Primero consultá el historial con los filtros que querés guardar. Después decime «guardá estos filtros como…».');}
   if(!draft.name){draft.wait='name';return reply('¿Qué nombre querés ponerle a estos filtros de historial?');}
   let period=draft.fixed?'fijo':history.period||'fijo';if(!draft.fixed&&!history.period)for(const name of ['hoy','ayer','este mes','mes pasado','este año','año pasado']){let range;if(['hoy','ayer'].includes(name)){const d=new Date(today+'T12:00:00Z');if(name==='ayer')d.setUTCDate(d.getUTCDate()-1);range={desde:d.toISOString().slice(0,10),hasta:d.toISOString().slice(0,10)};}else range=reportPeriod(name,today);if(history.filters?.desde===range.desde&&history.filters?.hasta===range.hasta){period=name;break;}}
   const saved=dashboards.saveHistoryFilters(p,{name:draft.name,dashboardId:history.id,filters:history.filters||{},period});delete conversation.dashboardDraft;return reply(`Guardé para vos **${saved.name}**, del historial de **${saved.dashboardName}**. Período: ${period==='fijo'?'fechas fijas':period}. Para consultarlo o descargarlo decime «aplicá los filtros ${saved.name}». Se verifican tus permisos cada vez.`);
  }
  if(draft.action==='presetApply'){
   if(!draft.presetId){const q=norm(draft.name);let rows=dashboards.listHistoryFilters(p);if(q){const exact=rows.filter(r=>norm(r.name)===q);rows=exact.length?exact:rows.filter(r=>norm(r.name).includes(q));}if(rows.length===1)draft.presetId=rows[0].id;else if(rows.length)return choose('¿Qué filtros guardados querés aplicar?',rows.map(r=>({id:r.id,label:`${r.name} · ${r.dashboardName} · ${r.period}`})),'preset');else{draft.wait='presetName';return reply('No encontré filtros guardados disponibles con ese nombre. ¿Cómo se llaman?');}}
   const saved=dashboards.getHistoryFilters(p,draft.presetId);draft={action:'history',branch:saved.branch,dashboardId:saved.dashboardId,filters:saved.filters,period:saved.period,filterNames:{}};conversation.dashboardDraft=draft;branch=saved.branch;
  }
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
    let rows=available();if(['share','unshare','inspect','history'].includes(draft.action))rows=rows.filter(r=>r.owned);
    if(!contextual){const exact=rows.filter(r=>norm(r.name)===reference);rows=exact.length?exact:rows.filter(r=>norm(r.name).includes(reference));}
    if(contextual&&conversation.reportContext){
     const same=rows.filter(r=>{const opened=dashboards.open(p,r.id),current=conversation.reportContext;return opened.dashboard.resource===current.resource&&opened.dashboard.filters.sucursal===current.branch&&Object.entries(opened.dashboard.filters).every(([k,v])=>k==='sucursal'||current.filters[k]===v);});if(same.length)rows=same;
    }
    if(rows.length===1)draft.dashboardId=rows[0].id;
    else if(rows.length)return choose('¿Qué dashboard querés '+(draft.action==='share'?'compartir':draft.action==='unshare'?'dejar de compartir':['inspect','history'].includes(draft.action)?'consultar':'abrir')+'?',rows.map(r=>({id:r.id,label:`${r.name} · ${r.owned?'propio':'compartido'} · sucursal ${r.dashboard.filters.sucursal}`})),'dashboard');
    else{draft.wait='dashboard';return reply('No encontré un dashboard disponible con ese nombre. ¿Cómo se llama el que querés '+(draft.action==='share'?'compartir':draft.action==='unshare'?'dejar de compartir':['inspect','history'].includes(draft.action)?'consultar':'abrir')+'?');}
   }
  }
  if(draft.action==='open'){
   const saved=dashboards.open(p,draft.dashboardId),savedBranch=saved.dashboard.filters.sucursal;
   const report=await reportChat({text:'Abrir dashboard guardado',conversation,branch:savedBranch,executeRead,read,authorizeRead,request:saved.dashboard});
   if(!report.evidence?.some(e=>e.result.kind==='dashboard'))return report;
   conversation.dashboardFocus={id:saved.id,fingerprint:fingerprint(conversation.reportContext)};delete conversation.dashboardDraft;
   return {...report,selectedBranch:savedBranch,answer:`**${saved.name}** · datos actualizados\n\n${report.answer}`};
  }
  if(draft.action==='history'){
   const subjects=dashboards.historySubjects(p,draft.dashboardId);
   for(const key of ['autor','destinatario','usuario','rol'])if(draft.filterNames?.[key]){const q=norm(draft.filterNames[key]),pool=key==='autor'?subjects.authors:key==='destinatario'?subjects.destinations:key==='usuario'?subjects.users:subjects.roles,aliases=r=>[...(r.aliases||[]),r.name].flatMap(n=>[norm(n),norm(n.replace(/\s*\([^)]*\)\s*$/,'')),norm(/\(([^)]+)\)$/.exec(n)?.[1])]),exact=pool.filter(r=>aliases(r).includes(q)),matches=exact.length?exact:pool.filter(r=>aliases(r).some(n=>n.includes(q)));
    if(matches.length>1)return choose(`¿Qué ${key} querés usar para filtrar el historial?`,matches.map(r=>({id:r.id,label:r.name})),{autor:'historyAuthor',destinatario:'historyDestination',usuario:'historyUser',rol:'historyRole'}[key]);
    if(!matches.length){delete conversation.dashboardDraft;return reply(`No encontré «${draft.filterNames[key]}» entre las identidades registradas en el historial de este dashboard. No apliqué otro filtro en su lugar.`);}
    draft.filters[key]=matches[0].id;delete draft.filterNames[key];
   }
   const report=dashboards.history(p,draft.dashboardId,{page:draft.page||1,filters:draft.filters||{}}),format=ts=>new Date(ts).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',dateStyle:'short',timeStyle:'medium'}),label=t=>`${t.kind==='user'?'usuario':'rol'} ${t.name}`;
   const lines=report.data.map(e=>e.legacy?`• ${format(e.at)} · auditoría anterior (${e.event==='dashboard.sharing.updated'?'cambio de destinatarios':'solicitud de revocación'}). Autor: ${e.who.name}${e.who.currentName?' (nombre actual; no conservado en el evento)':''}. Sin detalle histórico verificable de los destinatarios ni del resultado.`:`• ${format(e.at)} · **${e.who.name}**: ${[e.added.length?'compartió con '+e.added.map(label).join(', '):'',e.removed.length?'quitó acceso a '+e.removed.map(label).join(', '):''].filter(Boolean).join('; ')||'sin cambios en los accesos'}.`);
   conversation.dashboardFocus={id:report.id,fingerprint:fingerprint(conversation.reportContext)};conversation.dashboardHistory={id:report.id,page:report.page,branch,filters:report.filters,period:draft.period||'fijo'};delete conversation.dashboardDraft;
   const filterLabel=Object.entries(report.filters||{}).map(([k,v])=>`${k==='destinatario'?'usuario destinatario':k==='rol'?'rol destinatario':k==='usuario'?'usuario (autor o destinatario)':k}: ${k==='autor'?subjects.authors.find(r=>r.id===v)?.name||v:k==='destinatario'?subjects.destinations.find(r=>r.id===v)?.name||v:k==='usuario'?subjects.users.find(r=>r.id===v)?.name||v:k==='rol'?subjects.roles.find(r=>r.id===v)?.name||v:k==='tipo'?v==='sin_cambios'?'sin cambios':'accesos '+v:v}`).join(' · ');
   return {...reply(`**Historial de ${report.name}**${filterLabel?' · '+filterLabel:''}\n\n${lines.join('\n')||(Object.keys(report.filters||{}).length?'No hay eventos que coincidan con estos filtros.':'No hay cambios de acceso registrados para este dashboard.')}\n\nPágina ${report.page} · ${report.total} evento(s). Horarios de Argentina.\n\n${report.limitations.join(' ')}`,report.hasMore?[{label:'Ver más historial',text:'Mostrame más historial de este dashboard'}]:undefined),selectedBranch:branch,historyExport:{id:report.id,filters:report.filters||{}}};
  }
  if(draft.action==='inspect'){
   const report=dashboards.inspect(p,draft.dashboardId);
   let users=report.users;
   if(draft.userId)users=users.filter(u=>u.id===draft.userId);
   else if(draft.userQuery){const q=norm(draft.userQuery),aliases=u=>[norm(u.name),norm(u.name.replace(/\s*\([^)]*\)\s*$/,'')),norm(/\(([^)]+)\)$/.exec(u.name)?.[1])],exact=users.filter(u=>aliases(u).includes(q));users=exact.length?exact:users.filter(u=>aliases(u).some(n=>n.includes(q)));
    if(users.length>1)return choose(`Encontré varios usuarios para «${draft.userQuery}». ¿Cuál querés consultar?`,users.map(u=>({id:u.id,label:u.name})),'accessUser');
   }
   conversation.dashboardFocus={id:report.id,fingerprint:fingerprint(conversation.reportContext)};delete conversation.dashboardDraft;
   const lines=users.map(u=>{const paths=[...(u.owner?['dueño']:[]),...(u.direct?['directamente']:[]),...u.roles.map(r=>'por el rol '+r.name)];return `• **${u.name}**: ${paths.join(' y ')}. ${u.status}.`;});
   const roles=report.roles.map(r=>`• **${r.name}**: ${r.exists?r.members+' usuario(s) con ese rol actualmente':'rol eliminado'}.`);
   return reply(`**Accesos de ${report.name}** · sucursal ${report.branch}\n\n${draft.userQuery?(lines.join('\n')||'No encontré una asignación ni pertenencia a un rol compartido para ese usuario. No implica una búsqueda en todos los usuarios.'):['**Roles compartidos**',roles.join('\n')||'Ninguno.','**Usuarios y vías de acceso**',lines.join('\n')||'Ninguno.'].join('\n\n')}\n\nLas asignaciones no reemplazan los permisos: para abrirlo se verifican el usuario activo, el informe y la sucursal.`);
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

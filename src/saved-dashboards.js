import {reportPeriod} from './intelligence/report-chat.js';
import {historyFilters,historyWhere} from './history-filters.js';
import {randomUUID} from 'node:crypto';
import {assert} from './errors.js';
import {dashboardInput} from './intelligence/report-input.js';
import {commercialParams} from './protheus/commercial.js';
export function savedDashboards(store,{authorize,clock=()=>new Date(),recipients=()=>({users:[],roles:[]}),assignedNames=targets=>targets.map(t=>({...t,name:t.target})),accessReport=()=>({roles:[],users:[]}),legacyActor=actor=>({name:actor,currentName:false})}={}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS saved_dashboards(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,definition TEXT NOT NULL,created TEXT NOT NULL); CREATE INDEX IF NOT EXISTS saved_dashboard_owner ON saved_dashboards(owner);`);
 store.db.exec(`CREATE TABLE IF NOT EXISTS dashboard_shares(dashboard_id TEXT NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,PRIMARY KEY(dashboard_id,kind,target)); CREATE INDEX IF NOT EXISTS dashboard_shares_target ON dashboard_shares(kind,target);`);
 store.db.exec(`CREATE TABLE IF NOT EXISTS dashboard_history(seq INTEGER PRIMARY KEY,dashboard_id TEXT NOT NULL,at TEXT NOT NULL,audit_id INTEGER UNIQUE,body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS dashboard_history_dashboard ON dashboard_history(dashboard_id,seq); CREATE INDEX IF NOT EXISTS audit_dashboard_events ON audit(event,reference);`);
 function recordHistory(p,id,added,removed){const auditId=store.db.prepare('SELECT last_insert_rowid() id').get().id;store.db.prepare('INSERT INTO dashboard_history(dashboard_id,at,audit_id,body) VALUES(?,?,?,?)').run(id,clock().toISOString(),auditId,JSON.stringify({who:{id:p.userId,name:p.name?`${p.name}${p.username?' ('+p.username+')':''}`:p.userId},added:assignedNames(added),removed:assignedNames(removed)}));}
 store.db.exec(`CREATE TABLE IF NOT EXISTS history_filter_presets(id TEXT PRIMARY KEY,owner TEXT NOT NULL,dashboard_id TEXT NOT NULL,name TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL); CREATE INDEX IF NOT EXISTS history_filter_presets_owner ON history_filter_presets(owner);`);
 function preset(p,id){const row=store.db.prepare('SELECT * FROM history_filter_presets WHERE id=? AND owner=?').get(id,owner(p));assert(row,404,'FILTROS_NO_EXISTEN','No encontré esos filtros guardados.');const dashboard=get(p,row.dashboard_id,true);return {id:row.id,name:row.name,dashboardId:row.dashboard_id,dashboardName:dashboard.name,branch:dashboard.dashboard.filters.sucursal,...JSON.parse(row.body)};}
 const owner=p=>{assert(p.userId,403,'USUARIO_REQUERIDO','Ingresá con tu usuario para guardar dashboards.');return p.userId;};
 function validate(p,input){
  assert(input&&typeof input==='object'&&Object.keys(input).every(k=>['name','dashboard','period'].includes(k)),400,'DASHBOARD_INVALIDO','Datos de dashboard inválidos.');
  assert(typeof input.name==='string'&&input.name.trim().length>0&&input.name.trim().length<=100,400,'NOMBRE_INVALIDO','Elegí un nombre de hasta 100 caracteres.');
  assert(['fijo','este mes','mes pasado','este año','año pasado'].includes(input.period),400,'PERIODO_INVALIDO','Elegí el período del dashboard.');
  const branch=input.dashboard?.filters?.sucursal;
  const parsed=dashboardInput(input.dashboard,branch);assert(parsed.mode==='summary',400,'DASHBOARD_INVALIDO','Sólo se guardan dashboards.');
  authorize(p,input.dashboard.resource,branch);
  const validated=commercialParams(input.dashboard.resource,new URLSearchParams({...parsed.filters,sucursal:branch}),clock());
  const filters={...validated.filters};if(input.period!=='fijo'){delete filters.desde;delete filters.hasta;}
  return {name:input.name.trim(),period:input.period,dashboard:{mode:'summary',resource:input.dashboard.resource,filters}};
 }
 function get(p,id,owned=false){
  const user=owner(p),row=store.db.prepare(`SELECT * FROM saved_dashboards d WHERE id=? AND (owner=? OR (?=0 AND EXISTS(SELECT 1 FROM dashboard_shares s WHERE s.dashboard_id=d.id AND ((s.kind='user' AND s.target=?) OR (s.kind='role' AND s.target=?)))))`).get(id,user,Number(owned),user,p.roleId||'');
  assert(row,404,'DASHBOARD_NO_EXISTE','No encontré ese dashboard.');const value={id:row.id,...JSON.parse(row.definition),owned:row.owner===user};authorize(p,value.dashboard.resource,value.dashboard.filters.sucursal);return value;
 }
 function sharing(p,id){const value=get(p,id,true);return {...recipients(value.dashboard.resource,value.dashboard.filters.sucursal),selected:store.db.prepare('SELECT kind,target FROM dashboard_shares WHERE dashboard_id=? ORDER BY kind,target').all(id)};}
 return {
  save(p,input){const user=owner(p),value=validate(p,input);assert(store.db.prepare('SELECT count(*) n FROM saved_dashboards WHERE owner=?').get(user).n<100,400,'LIMITE_DASHBOARDS','Podés guardar hasta 100 dashboards.');const id=randomUUID();store.db.prepare('INSERT INTO saved_dashboards VALUES(?,?,?,?,?)').run(id,user,value.name,JSON.stringify(value),clock().toISOString());return {id,...value};},
  list(p){const user=owner(p);return store.db.prepare(`SELECT id FROM saved_dashboards d WHERE owner=? OR EXISTS(SELECT 1 FROM dashboard_shares s WHERE s.dashboard_id=d.id AND ((s.kind='user' AND s.target=?) OR (s.kind='role' AND s.target=?))) ORDER BY created DESC`).all(user,user,p.roleId||'').flatMap(r=>{try{return [get(p,r.id)];}catch(e){if(e.status===403||e.statusCode===403||e.code==='LECTURA_DENEGADA')return [];throw e;}});},
  sharing,
  saveHistoryFilters(p,input){
   const user=owner(p);assert(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['name','dashboardId','filters','period'].includes(k)),400,'FILTROS_INVALIDOS','Datos de filtros guardados inválidos.');assert(typeof input.name==='string'&&input.name.trim().length>0&&input.name.length<=100,400,'NOMBRE_INVALIDO','Elegí un nombre de hasta 100 caracteres.');assert(typeof input.dashboardId==='string'&&/^[a-f0-9-]{36}$/.test(input.dashboardId),400,'DASHBOARD_INVALIDO','Indicá el dashboard del historial.');get(p,input.dashboardId,true);const filters=historyFilters(input.filters);assert(['fijo','este mes','mes pasado','este año','año pasado','hoy','ayer'].includes(input.period||'fijo'),400,'PERIODO_INVALIDO','Período de filtros inválido.');assert(store.db.prepare('SELECT count(*) n FROM history_filter_presets WHERE owner=?').get(user).n<100,400,'LIMITE_FILTROS','Podés guardar hasta 100 filtros de historial.');const period=input.period||'fijo';if(period!=='fijo'){delete filters.desde;delete filters.hasta;}const id=randomUUID();store.db.prepare('INSERT INTO history_filter_presets VALUES(?,?,?,?,?,?)').run(id,user,input.dashboardId,input.name.trim(),JSON.stringify({filters,period}),clock().toISOString());store.audit(p.actor||user,'dashboard.history-filters.saved',id);return preset(p,id);
  },
  listHistoryFilters(p){return store.db.prepare('SELECT id FROM history_filter_presets WHERE owner=? ORDER BY created DESC,id').all(owner(p)).flatMap(r=>{try{return [preset(p,r.id)];}catch(e){if(e.status===403||e.status===404)return [];throw e;}});},
  getHistoryFilters(p,id){const value=preset(p,id);if(value.period!=='fijo'){const today=clock().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'});if(['hoy','ayer'].includes(value.period)){const date=new Date(today+'T12:00:00Z');if(value.period==='ayer')date.setUTCDate(date.getUTCDate()-1);value.filters.desde=value.filters.hasta=date.toISOString().slice(0,10);}else Object.assign(value.filters,reportPeriod(value.period,today));}return value;},

  history(p,id,{page=1,filters={}}={}){
   const value=get(p,id,true);assert(Number.isInteger(page)&&page>=1&&page<=100000,400,'PAGINACION_INVALIDA','Página de historial inválida.');
   const combined=`SELECT seq AS seq,audit_id AS ord,at,0 AS legacy,body,NULL AS actor,NULL AS event FROM dashboard_history WHERE dashboard_id=? UNION ALL SELECT a.id AS seq,a.id AS ord,a.at,1 AS legacy,NULL AS body,a.actor,a.event FROM audit a LEFT JOIN dashboard_history h ON h.audit_id=a.id WHERE h.seq IS NULL AND ((a.event='dashboard.sharing.updated' AND a.reference=?) OR (a.event='dashboard.sharing.revoked' AND CASE WHEN json_valid(a.reference) THEN json_extract(a.reference,'$.dashboard') END=?))`;
   filters=historyFilters(filters);const where=historyWhere(filters),filtered='SELECT * FROM ('+combined+')'+where.sql;
   const args=[id,id,id,...where.args],total=store.db.prepare('SELECT count(*) n FROM ('+filtered+')').get(...args).n,limit=25;
   const rows=store.db.prepare('SELECT * FROM ('+filtered+') ORDER BY at DESC,ord DESC LIMIT ? OFFSET ?').all(...args,limit+1,(page-1)*limit);
   const events=rows.slice(0,limit).map(r=>r.legacy?{key:'audit:'+r.seq,at:r.at,legacy:true,who:legacyActor(r.actor),event:r.event}:{key:'history:'+r.seq,at:r.at,legacy:false,...JSON.parse(r.body)});
   return {id,name:value.name,page,filters,hasMore:rows.length>limit,total,data:events.map(e=>!e.legacy&&filters.tipo?{...e,added:filters.tipo==='quitados'?[]:e.added,removed:filters.tipo==='agregados'?[]:e.removed}:e),limitations:['El detalle exacto de destinatarios se registra desde esta versión. Los eventos anteriores se muestran como auditoría incompleta; no acreditan quién recibió o perdió acceso.','Los nombres de los eventos nuevos son los registrados al ejecutar el cambio; no se reemplazan por nombres actuales.','No reconstruye cambios de rol, pertenencia o permisos generales: registra asignaciones de este dashboard.']};
  },
  historySubjects(p,id){get(p,id,true);const users=new Map(),roles=new Map(),authors=new Map(),destinations=new Map();const add=(map,id,name)=>{if(!id)return;const old=map.get(id);map.set(id,{id,name,aliases:[...new Set([...(old?.aliases||[]),name])]});};
   for(const row of store.db.prepare('SELECT body FROM dashboard_history WHERE dashboard_id=? ORDER BY seq').all(id)){const e=JSON.parse(row.body);add(users,e.who.id,e.who.name);add(authors,e.who.id,e.who.name);for(const t of [...e.added,...e.removed]){add(t.kind==='user'?users:roles,t.target,t.name);if(t.kind==='user')add(destinations,t.target,t.name);}}
   for(const row of store.db.prepare("SELECT a.actor FROM audit a LEFT JOIN dashboard_history h ON h.audit_id=a.id WHERE h.seq IS NULL AND ((a.event='dashboard.sharing.updated' AND a.reference=?) OR (a.event='dashboard.sharing.revoked' AND CASE WHEN json_valid(a.reference) THEN json_extract(a.reference,'$.dashboard') END=?))").all(id,id)){const who=legacyActor(row.actor),uid=/^user:([^:]+)/.exec(row.actor)?.[1];if(uid){const prior=authors.get(uid)?.name;add(users,uid,who.name);add(authors,uid,who.name);if(prior){authors.get(uid).name=prior;users.get(uid).name=prior;}}}
   return {users:[...users.values()],roles:[...roles.values()],authors:[...authors.values()],destinations:[...destinations.values()]};
  },
  inspect(p,id){const value=get(p,id,true),targets=store.db.prepare('SELECT kind,target FROM dashboard_shares WHERE dashboard_id=? ORDER BY kind,target').all(id);return {id,name:value.name,branch:value.dashboard.filters.sucursal,...accessReport({resource:value.dashboard.resource,branch:value.dashboard.filters.sucursal,targets,ownerId:p.userId})};},
  revocation(p,id){get(p,id,true);return {assigned:assignedNames(store.db.prepare('SELECT kind,target FROM dashboard_shares WHERE dashboard_id=? ORDER BY kind,target').all(id))};},
  unshare(p,id,input){
   get(p,id,true);assert(input&&Object.keys(input).length===1&&Array.isArray(input.targets)&&input.targets.length>0&&input.targets.length<=200&&input.targets.every(t=>t&&Object.keys(t).length===2&&['user','role'].includes(t.kind)&&typeof t.target==='string'&&t.target.length>0&&t.target.length<=128),400,'DESTINATARIOS_INVALIDOS','Indicá usuarios o roles concretos para dejar de compartir.');
   let removed=0;const removedTargets=[];store.db.exec('BEGIN IMMEDIATE');try{for(const t of input.targets){const count=store.db.prepare('DELETE FROM dashboard_shares WHERE dashboard_id=? AND kind=? AND target=?').run(id,t.kind,t.target).changes;removed+=count;if(count)removedTargets.push(t);}store.audit(p.actor||p.userId,'dashboard.sharing.revoked',JSON.stringify({dashboard:id,targets:input.targets}));recordHistory(p,id,[],removedTargets);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}return {removed};
  },
  share(p,id,input){
   const options=sharing(p,id);assert(input&&Object.keys(input).length===1&&Array.isArray(input.targets)&&input.targets.length<=200,400,'DESTINATARIOS_INVALIDOS','Elegí hasta 200 usuarios o roles.');
   const targets=input.targets;assert(targets.every(t=>t&&Object.keys(t).length===2&&['user','role'].includes(t.kind)&&typeof t.target==='string'&&(t.kind==='user'?options.users:options.roles).some(r=>r.id===t.target)),400,'DESTINATARIOS_INVALIDOS','Un destinatario no existe, está inactivo o no tiene permisos para este dashboard.');
   assert(new Set(targets.map(t=>t.kind+':'+t.target)).size===targets.length,400,'DESTINATARIOS_INVALIDOS','Hay destinatarios repetidos.');
   store.db.exec('BEGIN IMMEDIATE');try{const previous=store.db.prepare('SELECT kind,target FROM dashboard_shares WHERE dashboard_id=?').all(id),key=t=>t.kind+':'+t.target,added=targets.filter(t=>!previous.some(v=>key(v)===key(t))),removed=previous.filter(t=>!targets.some(v=>key(v)===key(t)));store.db.prepare('DELETE FROM dashboard_shares WHERE dashboard_id=?').run(id);for(const t of targets)store.db.prepare('INSERT INTO dashboard_shares VALUES(?,?,?)').run(id,t.kind,t.target);store.audit(p.actor||p.userId,'dashboard.sharing.updated',id);recordHistory(p,id,added,removed);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}
   return {shared:targets.length};
  },
  open(p,id){const value=get(p,id);if(value.period!=='fijo')Object.assign(value.dashboard.filters,reportPeriod(value.period,clock().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'})));return value;},
  remove(p,id){get(p,id,true);store.db.exec('BEGIN IMMEDIATE');try{store.db.prepare('DELETE FROM dashboard_shares WHERE dashboard_id=?').run(id);store.db.prepare('DELETE FROM saved_dashboards WHERE id=? AND owner=?').run(id,owner(p));store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}return {deleted:true};}
 };
}


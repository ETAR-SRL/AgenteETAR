import {randomUUID} from 'node:crypto';
import {assert} from './errors.js';
import {dashboardInput} from './intelligence/report-input.js';
import {reportPeriod} from './intelligence/report-chat.js';
import {commercialParams} from './protheus/commercial.js';
export function savedDashboards(store,{authorize,clock=()=>new Date(),recipients=()=>({users:[],roles:[]})}={}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS saved_dashboards(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,definition TEXT NOT NULL,created TEXT NOT NULL); CREATE INDEX IF NOT EXISTS saved_dashboard_owner ON saved_dashboards(owner);`);
 store.db.exec(`CREATE TABLE IF NOT EXISTS dashboard_shares(dashboard_id TEXT NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,PRIMARY KEY(dashboard_id,kind,target)); CREATE INDEX IF NOT EXISTS dashboard_shares_target ON dashboard_shares(kind,target);`);
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
  share(p,id,input){
   const options=sharing(p,id);assert(input&&Object.keys(input).length===1&&Array.isArray(input.targets)&&input.targets.length<=200,400,'DESTINATARIOS_INVALIDOS','Elegí hasta 200 usuarios o roles.');
   const targets=input.targets;assert(targets.every(t=>t&&Object.keys(t).length===2&&['user','role'].includes(t.kind)&&typeof t.target==='string'&&(t.kind==='user'?options.users:options.roles).some(r=>r.id===t.target)),400,'DESTINATARIOS_INVALIDOS','Un destinatario no existe, está inactivo o no tiene permisos para este dashboard.');
   assert(new Set(targets.map(t=>t.kind+':'+t.target)).size===targets.length,400,'DESTINATARIOS_INVALIDOS','Hay destinatarios repetidos.');
   store.db.exec('BEGIN IMMEDIATE');try{store.db.prepare('DELETE FROM dashboard_shares WHERE dashboard_id=?').run(id);for(const t of targets)store.db.prepare('INSERT INTO dashboard_shares VALUES(?,?,?)').run(id,t.kind,t.target);store.audit(p.actor||p.userId,'dashboard.sharing.updated',id);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}
   return {shared:targets.length};
  },
  open(p,id){const value=get(p,id);if(value.period!=='fijo')Object.assign(value.dashboard.filters,reportPeriod(value.period,clock().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'})));return value;},
  remove(p,id){get(p,id,true);store.db.exec('BEGIN IMMEDIATE');try{store.db.prepare('DELETE FROM dashboard_shares WHERE dashboard_id=?').run(id);store.db.prepare('DELETE FROM saved_dashboards WHERE id=? AND owner=?').run(id,owner(p));store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}return {deleted:true};}
 };
}


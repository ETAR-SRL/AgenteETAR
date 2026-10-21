import {randomUUID} from 'node:crypto';
import {assert} from './errors.js';
import {dashboardInput} from './intelligence/report-input.js';
import {reportPeriod} from './intelligence/report-chat.js';
import {commercialParams} from './protheus/commercial.js';
export function savedDashboards(store,{authorize,clock=()=>new Date()}={}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS saved_dashboards(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,definition TEXT NOT NULL,created TEXT NOT NULL); CREATE INDEX IF NOT EXISTS saved_dashboard_owner ON saved_dashboards(owner);`);
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
 function get(p,id){const row=store.db.prepare('SELECT * FROM saved_dashboards WHERE id=? AND owner=?').get(id,owner(p));assert(row,404,'DASHBOARD_NO_EXISTE','No encontré ese dashboard.');const value={id:row.id,...JSON.parse(row.definition)};authorize(p,value.dashboard.resource,value.dashboard.filters.sucursal);return value;}
 return {
  save(p,input){const user=owner(p),value=validate(p,input);assert(store.db.prepare('SELECT count(*) n FROM saved_dashboards WHERE owner=?').get(user).n<100,400,'LIMITE_DASHBOARDS','Podés guardar hasta 100 dashboards.');const id=randomUUID();store.db.prepare('INSERT INTO saved_dashboards VALUES(?,?,?,?,?)').run(id,user,value.name,JSON.stringify(value),clock().toISOString());return {id,...value};},
  list(p){return store.db.prepare('SELECT id FROM saved_dashboards WHERE owner=? ORDER BY created DESC').all(owner(p)).flatMap(r=>{try{return [get(p,r.id)];}catch(e){if(e.status===403||e.statusCode===403||e.code==='LECTURA_DENEGADA')return [];throw e;}});},
  open(p,id){const value=get(p,id);if(value.period!=='fijo')Object.assign(value.dashboard.filters,reportPeriod(value.period,clock().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'})));return value;},
  remove(p,id){get(p,id);store.db.prepare('DELETE FROM saved_dashboards WHERE id=? AND owner=?').run(id,owner(p));return {deleted:true};}
 };
}


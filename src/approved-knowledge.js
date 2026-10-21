import {randomUUID} from 'node:crypto';
import {assert} from './errors.js';
import {canRead,resourceDomains} from './access.js';
export const knowledgePolicy='Guía aportada y aprobada por una persona. No es una consulta actual del ERP ni autoriza escrituras. Verificá los datos operativos en su fuente.';
export function createApprovedKnowledge({store,principal,user}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS approved_knowledge(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS approved_knowledge_revisions(id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(id,revision));`);
 const fresh=()=>{const old=principal(),p=old?.userId&&user(old.userId);assert(p&&p.revision===old.revision,403,'ACCESO_CAMBIO','Ingresá de nuevo para consultar conocimiento empresarial.');return p;};
 const manage=p=>assert(p.admin===true,403,'CONOCIMIENTO_ADMIN','Sólo un administrador puede revisar guías empresariales.');
 const branch=(p,b)=>{assert(typeof b==='string'&&p.branches?.includes(b),403,'SUCURSAL_NO_AUTORIZADA','Sucursal fuera del alcance.');return b;};
 const row=id=>{assert(typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id),404,'CONOCIMIENTO_NO_ENCONTRADO','Guía no encontrada.');const r=db.prepare('SELECT body FROM approved_knowledge WHERE id=?').get(id);return r?JSON.parse(r.body):null;};
 function readable(p,k,management=false){
  if(!p.branches?.includes(k.branch))return false;
  if(management)return p.admin===true;
  return k.status==='approved'&&(p.admin||p.permissions?.includes('read:conocimiento'))&&(k.users.includes(p.userId)||k.roles.includes(p.roleId))&&k.requiredResources.every(r=>Object.hasOwn(resourceDomains,r)&&canRead(p,r));
 }
 function get(id,{management=false}={}){const p=fresh();if(management)manage(p);const k=row(id);assert(k&&readable(p,k,management),404,'CONOCIMIENTO_NO_ENCONTRADO','Guía no encontrada.');return {...k,policy:knowledgePolicy};}
 function save(input){
  const p=fresh();manage(p);
  assert(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['id','revision','title','text','provenance','requiredResources','branch','users','roles','status'].includes(k)),400,'CONOCIMIENTO_INVALIDO','Guía inválida.');
  const old=input.id?row(input.id):null;assert(!input.id||old,404,'CONOCIMIENTO_NO_ENCONTRADO','Guía no encontrada.');
  if(old){branch(p,old.branch);assert(input.revision===old.revision,409,'CONOCIMIENTO_REVISION','La guía cambió; volvé a leer la revisión vigente.');}
  const clean=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/\u0000/.test(v);
  assert(clean(input.title,160)&&clean(input.text,4000)&&clean(input.provenance,1000),400,'CONOCIMIENTO_TEXTO','Indicá título, texto de hasta 4000 caracteres y procedencia verificable.');
  assert(Array.isArray(input.requiredResources)&&input.requiredResources.length>0&&input.requiredResources.length<=30&&input.requiredResources.every(r=>typeof r==='string'&&Object.hasOwn(resourceDomains,r)),400,'CONOCIMIENTO_RECURSOS','Indicá recursos conocidos para autorizar la guía.');
  for(const key of ['users','roles'])assert(Array.isArray(input[key])&&input[key].length<=100&&input[key].every(v=>typeof v==='string'&&/^[a-z0-9_-]{1,120}$/i.test(v)),400,'CONOCIMIENTO_ACL','Indicá usuarios y roles explícitos, sin comodines.');
  assert(input.users.length+input.roles.length>0,400,'CONOCIMIENTO_ACL','Indicá al menos un usuario o rol autorizado.');
  assert(input.users.every(id=>!!user(id)),400,'CONOCIMIENTO_ACL','La lista contiene un usuario inexistente o inactivo.');
  const roleExists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='access_roles'").get();
  assert(!input.roles.length||roleExists&&input.roles.every(id=>!!db.prepare('SELECT 1 FROM access_roles WHERE id=?').get(id)),400,'CONOCIMIENTO_ACL','La lista contiene un rol inexistente.');
  const status=input.status||'draft';assert(['draft','approved','archived'].includes(status),400,'CONOCIMIENTO_ESTADO','Estado de guía inválido.');
  const at=new Date().toISOString(),k={id:old?.id||randomUUID(),revision:(old?.revision||0)+1,title:input.title.trim(),text:input.text.trim(),provenance:input.provenance.trim(),requiredResources:[...new Set(input.requiredResources)],branch:branch(p,input.branch),users:[...new Set(input.users)],roles:[...new Set(input.roles)],status,createdAt:old?.createdAt||at,updatedAt:at,updatedBy:p.userId,approvedBy:status==='approved'?p.userId:null,approvedAt:status==='approved'?at:null};
  db.exec('BEGIN IMMEDIATE');try{
   const current=db.prepare('SELECT revision FROM approved_knowledge WHERE id=?').get(k.id);assert(!old&&!current||old&&current?.revision===old.revision,409,'CONOCIMIENTO_REVISION','La guía cambió; volvé a leerla.');
   const body=JSON.stringify(k);db.prepare('INSERT INTO approved_knowledge_revisions VALUES(?,?,?)').run(k.id,k.revision,body);
   db.prepare('INSERT INTO approved_knowledge VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(k.id,k.revision,body);
   store.audit(p.actor,'knowledge.'+status,k.id+':'+k.revision);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}return {...k,policy:knowledgePolicy};
 }
 return {list({branch:b,q='',management=false}={}){
  const p=fresh();branch(p,b);if(management)manage(p);assert(typeof q==='string'&&q.length<=150,400,'CONOCIMIENTO_BUSQUEDA','Buscá hasta 150 caracteres.');
  const term=q.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const data=db.prepare('SELECT body FROM approved_knowledge').all().map(r=>JSON.parse(r.body)).filter(k=>k.branch===b&&readable(p,k,management)).filter(k=>(k.title+' '+k.text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(term)).slice(0,100).map(k=>({...k,policy:knowledgePolicy}));return {data,policy:knowledgePolicy};
 },get,save,archive(id,revision){const current=get(id,{management:true});return save({...Object.fromEntries(['id','title','text','provenance','requiredResources','branch','users','roles'].map(k=>[k,current[k]])),revision:revision??current.revision,status:'archived'});}};
}

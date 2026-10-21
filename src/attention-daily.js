import {randomUUID} from 'node:crypto';
import {assert} from './errors.js';

export const localDailyTime=(date,timeZone)=>{
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
 return {day:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
};
export function createAttentionDaily({db,current,users,runAs,list,canPrepare=()=>false,clock=()=>new Date()}){
 db.db.exec(`CREATE TABLE IF NOT EXISTS op_daily_settings(owner TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,time TEXT NOT NULL,time_zone TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS op_daily(owner TEXT NOT NULL,day TEXT NOT NULL,branch TEXT NOT NULL,generated TEXT NOT NULL,revision TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,day,branch));`);
 const token=randomUUID();let running=null;
 const settings=input=>{const owner=current().userId,old=db.db.prepare('SELECT * FROM op_daily_settings WHERE owner=?').get(owner)||{enabled:0,time:'08:00',time_zone:'America/Argentina/Buenos_Aires'};
  if(input!==undefined){assert(input&&typeof input==='object',400,'CONFIGURACION_INVALIDA','Configuración inválida.');const time=input.time??old.time,timeZone=input.timeZone??old.time_zone,enabled=input.enabled??!!old.enabled;
   assert(typeof enabled==='boolean'&&typeof time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time),400,'HORARIO_INVALIDO','Indicá hora y minutos válidos.');try{assert(typeof timeZone==='string'&&timeZone.length<=100,400,'ZONA_INVALIDA','Zona horaria inválida.');localDailyTime(clock(),timeZone);}catch{assert(false,400,'ZONA_INVALIDA','Elegí una zona horaria IANA válida.');}
   db.db.prepare('INSERT INTO op_daily_settings VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET enabled=excluded.enabled,time=excluded.time,time_zone=excluded.time_zone').run(owner,Number(enabled),time,timeZone);return {enabled,time,timeZone};}
  return {enabled:!!old.enabled,time:old.time,timeZone:old.time_zone};};
 const daily=({branch,generate=false}={})=>{
  // Reading the inbox revalidates current owner, branch and each resource. Stored
  // summaries contain identifiers only, so revoked data cannot survive in prose.
  const inbox=list({branch,all:true}),p=current(),s=settings(),day=localDailyTime(clock(),s.timeZone).day;
  let stored=db.db.prepare('SELECT * FROM op_daily WHERE owner=? AND day=? AND branch=?').get(p.userId,day,branch);
  if(generate||!stored){const ids=inbox.data.map(x=>x.id);db.db.prepare('INSERT INTO op_daily VALUES(?,?,?,?,?,?) ON CONFLICT(owner,day,branch) DO UPDATE SET generated=excluded.generated,revision=excluded.revision,body=excluded.body').run(p.userId,day,branch,db.now(),String(p.revision),JSON.stringify({ids}));stored=db.db.prepare('SELECT * FROM op_daily WHERE owner=? AND day=? AND branch=?').get(p.userId,day,branch);}
  const ids=new Set(JSON.parse(stored.body).ids),rows=inbox.data.filter(x=>ids.has(x.id)&&x.caseState!=='cancelled'),active=rows.filter(x=>x.caseState!=='paused'),today=at=>at&&localDailyTime(new Date(at),s.timeZone).day===day;
  const sections={needsAttention:active.filter(x=>x.visible&&x.status==='active'),changes:rows.filter(x=>today(x.lastChange)&&x.hasNews),resolved:rows.filter(x=>x.status!=='unknown'&&x.follow_state==='completed'&&today(x.lastChange)),unverified:rows.filter(x=>x.status==='unknown'),preparable:active.filter(x=>x.status!=='unknown'&&x.status!=='resolved'&&canPrepare(x))};
  current();return {day,generatedAt:stored.generated,timeZone:s.timeZone,accessRevision:p.revision,sections,sources:inbox.sources,partial:true,scope:'Resumen personal por sucursal sobre la bandeja revisada por tandas. Una fuente caída o una ausencia no acredita resolución. Las tarjetas se revalidan al consultar; no representa un censo ni valores históricos actuales.'};
 };
 async function cycle(){const key='dailyLease',now=+clock();const claimed=db.db.prepare('INSERT INTO op_worker VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(op_worker.value,\'$.until\')<?').run(key,JSON.stringify({token,until:now+60000}),now);if(!claimed.changes)return;
  try{for(const user of users()){if(!user?.userId)continue;await runAs(user.userId,async()=>{const p=current(),s=settings(),local=localDailyTime(clock(),s.timeZone);if(!s.enabled||local.time<s.time)return;for(const branch of p.branches){const exists=db.db.prepare('SELECT generated FROM op_daily WHERE owner=? AND day=? AND branch=?').get(p.userId,local.day,branch);if(!exists||localDailyTime(new Date(exists.generated),s.timeZone).time<s.time)daily({branch,generate:true});}}).catch(()=>{});}}
  finally{db.db.prepare('DELETE FROM op_worker WHERE key=? AND json_extract(value,\'$.token\')=?').run(key,token);}}
 return {settings,currentDaily:daily,drain:()=>running||Promise.resolve(),run(){if(running)return running;running=cycle().finally(()=>running=null);return running;}};
}

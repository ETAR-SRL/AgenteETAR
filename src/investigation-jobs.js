import {randomUUID} from 'node:crypto';
import {assert,HttpError} from './errors.js';

// Únicamente investigaciones consultivas. Nunca almacena ni reenvía comandos comerciales.
export function createInvestigationJobs({store,attention,principal,user,runAs,investigate,clock=()=>new Date(),intervalMs=2000}){
 const db=store.db;db.exec(`CREATE TABLE IF NOT EXISTS investigation_jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,revision TEXT NOT NULL,item TEXT NOT NULL,branch TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_retry TEXT,lease_until TEXT,token TEXT,result TEXT,error TEXT);
 CREATE INDEX IF NOT EXISTS investigation_jobs_due ON investigation_jobs(status,next_retry,lease_until);`);
 let running,timer,stopped=false;
 const now=()=>clock().toISOString(),current=()=>{const p=principal();assert(p?.userId,403,'USUARIO_REQUERIDO','Ingresá con tu usuario para investigar un caso.');return p;};
 const own=id=>{const p=current(),j=db.prepare('SELECT * FROM investigation_jobs WHERE id=? AND owner=?').get(id,p.userId);assert(j,404,'TRABAJO_NO_EXISTE','No encontré ese trabajo.');attention.get(j.item);return {p,j};};
 const view=(p,j)=>({id:j.id,itemId:j.item,branch:j.branch,status:p.revision===j.revision?j.status:'paused_access',created:j.created,updated:j.updated,attempts:j.attempts,nextRetry:j.next_retry,result:p.revision===j.revision&&j.status==='completed'?JSON.parse(j.result):undefined,error:j.error});
 const service={
  create(itemId,branch){const p=current(),item=attention.get(itemId);assert(item.branch===branch,403,'LECTURA_DENEGADA','Esto no podés leerlo.');
   const old=db.prepare("SELECT * FROM investigation_jobs WHERE owner=? AND item=? AND revision=? AND status IN ('queued','running','waiting_source','paused') ORDER BY created DESC LIMIT 1").get(p.userId,itemId,p.revision);if(old)return view(p,old);
   assert(db.prepare("SELECT count(*) n FROM investigation_jobs WHERE owner=? AND status IN ('queued','running','waiting_source','paused')").get(p.userId).n<30,429,'TRABAJOS_LIMITE','Tenés varias investigaciones pendientes. Terminá o cancelá alguna antes de iniciar otra.');
   const id=randomUUID();db.prepare("INSERT INTO investigation_jobs(id,owner,revision,item,branch,status,created,updated) VALUES(?,?,?,?,?,'queued',?,?)").run(id,p.userId,p.revision,itemId,branch,now(),now());store.audit(p.actor,'investigation.queued',id);return service.get(id);
  },
  get(id){const {p,j}=own(id);return view(p,j);},
  list(){const p=current();return {data:db.prepare('SELECT * FROM investigation_jobs WHERE owner=? ORDER BY created DESC LIMIT 50').all(p.userId).flatMap(j=>{try{attention.get(j.item);return [view(p,j)];}catch{return [];}})};},
  act(id,action){const {p,j}=own(id);assert(['pause','resume','cancel'].includes(action),400,'ACCION_INVALIDA','Elegí pausar, retomar o cancelar.');
   if(action==='cancel'){db.prepare("UPDATE investigation_jobs SET status='cancelled',updated=?,token=NULL,result=NULL WHERE id=? AND owner=?").run(now(),id,p.userId);}
   else if(action==='pause'){assert(j.status!=='completed',409,'TRABAJO_TERMINADO','La investigación ya terminó.');db.prepare("UPDATE investigation_jobs SET status='paused',updated=?,token=NULL WHERE id=? AND owner=?").run(now(),id,p.userId);}
   else{assert(!['completed','cancelled'].includes(j.status),409,'TRABAJO_TERMINADO','Pedí otra investigación para volver a consultar.');db.prepare("UPDATE investigation_jobs SET status='queued',revision=?,updated=?,attempts=0,next_retry=NULL,token=NULL,result=NULL,error=NULL WHERE id=? AND owner=?").run(p.revision,now(),id,p.userId);}
   store.audit(p.actor,'investigation.'+action,id);return service.get(id);
  },
  run(){if(stopped)return Promise.resolve();if(running)return running;
   running=(async()=>{
    const j=db.prepare("SELECT * FROM investigation_jobs WHERE (status IN ('queued','waiting_source') AND (next_retry IS NULL OR next_retry<=?)) OR (status='running' AND lease_until<=?) ORDER BY created LIMIT 1").get(now(),now());if(!j)return;
    const p=user(j.owner);if(!p||p.revision!==j.revision){db.prepare("UPDATE investigation_jobs SET status='paused_access',updated=?,token=NULL,result=NULL WHERE id=?").run(now(),j.id);return;}
    const token=randomUUID(),lease=new Date(+clock()+300000).toISOString();
    const claim=db.prepare("UPDATE investigation_jobs SET status='running',updated=?,lease_until=?,token=?,attempts=attempts+1 WHERE id=? AND ((status IN ('queued','waiting_source') AND (next_retry IS NULL OR next_retry<=?)) OR (status='running' AND lease_until<=?))").run(now(),lease,token,j.id,now(),now());if(!claim.changes)return;
    const check=()=>{const row=db.prepare('SELECT status,token FROM investigation_jobs WHERE id=?').get(j.id),fresh=user(j.owner);if(!fresh||fresh.revision!==j.revision)throw new HttpError(403,'ACCESO_CAMBIO','Tus permisos cambiaron.');if(stopped||row?.status!=='running'||row.token!==token)throw new HttpError(409,'TRABAJO_CANCELADO','La investigación se detuvo.');};
    const heartbeat=setInterval(()=>{try{check();db.prepare("UPDATE investigation_jobs SET lease_until=? WHERE id=? AND token=? AND status='running'").run(new Date(+clock()+300000).toISOString(),j.id,token);}catch{}},30000);heartbeat.unref?.();
    try{const result=await runAs(j.owner,async()=>{check();const item=attention.get(j.item);assert(!['paused','cancelled'].includes(item.caseState),409,'CASO_PAUSADO','El caso está pausado o cancelado.');return investigate(j.item,j.branch,{check});});check();
     if(!result?.attention?.data?.some(i=>i.id===j.item&&i.branch===j.branch&&['active','resolved'].includes(i.status))||result.attention.data.some(i=>i.status==='unknown'))throw new HttpError(503,'FUENTE_NO_DISPONIBLE','No se pudo verificar la fuente.');
     db.prepare("UPDATE investigation_jobs SET status='completed',updated=?,result=?,error=NULL,token=NULL,lease_until=NULL WHERE id=? AND status='running' AND token=?").run(now(),JSON.stringify({...result,background:true,evidenceAt:now()}),j.id,token);
    }catch(e){const denied=['LECTURA_DENEGADA','ACCESO_CAMBIO'].includes(e.code),paused=e.code==='CASO_PAUSADO',retry=!denied&&!paused&&j.attempts<4,status=denied?'paused_access':paused?'paused':retry?'waiting_source':'failed';
     db.prepare('UPDATE investigation_jobs SET status=?,updated=?,next_retry=?,error=?,token=NULL,lease_until=NULL WHERE id=? AND status=\'running\' AND token=?').run(status,now(),retry?new Date(+clock()+Math.min(300000,15000*2**j.attempts)).toISOString():null,denied?'Tus permisos cambiaron.':'No pude completar la lectura; no se dio el caso por resuelto.',j.id,token);
    }finally{clearInterval(heartbeat);}
   })().catch(()=>{}).finally(()=>{running=null;});return running;
  },
  start(){if(timer||stopped)return;void service.run();timer=setInterval(()=>void service.run(),intervalMs);timer.unref?.();},
  resume(){stopped=false;timer=null;service.start();},
  async stop(){stopped=true;clearInterval(timer);await running;}
 };
 return service;
}

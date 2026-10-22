import webpush from 'web-push';
import {randomUUID} from 'node:crypto';
import {assert} from './errors.js';
import {permitted} from './attention.js';

// Sólo servicios de entrega Web Push conocidos. Nunca admitir destinos de red arbitrarios.
export function validateSubscription(input){
 assert(input&&typeof input.endpoint==='string'&&input.endpoint.length<=4096,400,'PUSH_INVALIDO','La suscripción del navegador no es válida.');
 let u;try{u=new URL(input.endpoint);}catch{}
 const host=u?.hostname;
 assert(u&&u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&!u.hash&&(
  host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host==='web.push.apple.com'||host?.endsWith('.notify.windows.com')
 ),400,'PUSH_INVALIDO','El servicio de notificaciones de este navegador no está admitido.');
 for(const [key,size] of [['p256dh',65],['auth',16]]){const v=input.keys?.[key];assert(typeof v==='string'&&/^[\w-]+$/.test(v)&&Buffer.from(v,'base64url').length===size&&(key!=='p256dh'||Buffer.from(v,'base64url')[0]===4),400,'PUSH_INVALIDO','La suscripción del navegador no es válida.');}
 return {endpoint:input.endpoint,keys:{p256dh:input.keys.p256dh,auth:input.keys.auth}};
}

export function createAttentionNotifications({attention,principal,user,clock=()=>new Date(),enabled=true,intervalMs=60000,contact='https://github.com/ETAR-SRL/AgenteETAR',send=webpush.sendNotification}){
 const db=attention.db.db;
 db.exec(`CREATE TABLE IF NOT EXISTS op_push_subscriptions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,revision TEXT NOT NULL,origin TEXT NOT NULL,endpoint TEXT NOT NULL UNIQUE,subscription TEXT NOT NULL,baseline INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,next_attempt TEXT,failures INTEGER NOT NULL DEFAULT 0,last_sent TEXT);
 CREATE TABLE IF NOT EXISTS op_push_deliveries(subscription TEXT NOT NULL,event INTEGER NOT NULL,at TEXT NOT NULL,PRIMARY KEY(subscription,event));`);
 let running,timer,stopped=false;
 const now=()=>clock().toISOString();
 const maxEvent=()=>Number(db.prepare('SELECT coalesce(max(id),0) id FROM op_events').get().id);
 const current=()=>{const p=principal();assert(p?.userId,403,'USUARIO_REQUERIDO','Ingresá con tu usuario para activar tus avisos.');return p;};
 function keys(){db.exec('BEGIN IMMEDIATE');try{let value=attention.db.value('pushVapid');if(!value){value=webpush.generateVAPIDKeys();attention.db.set('pushVapid',value);}db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
 function owned(id,origin){const p=current();assert(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),400,'PUSH_INVALIDO','La suscripción del navegador no es válida.');const s=db.prepare('SELECT * FROM op_push_subscriptions WHERE id=? AND owner=? AND origin=?').get(id,p.userId,origin);assert(s,404,'PUSH_NO_EXISTE','No hay avisos activos para tu usuario en este navegador.');return {p,s};}
 function eligible(s,p){
  if(!enabled||!s.enabled||!p||p.revision!==s.revision)return [];
  const allowed=[];for(const branch of p.branches||[])for(const kind of ['sale','purchase','remit','kaiqen'])if(permitted(p,{kind,branch}))allowed.push([branch,kind]);
  if(!allowed.length)return [];
  // El último evento por caso agrupa cambio + objetivo del mismo ciclo. Una cancelación o
  // un nuevo seguimiento invalida los eventos del seguimiento anterior, incluso en el mismo ms.
  return db.prepare(`SELECT e.id,e.type,e.body FROM op_events e JOIN op_items i ON i.id=e.item AND i.owner=e.owner
   JOIN op_follows f ON f.item=i.id AND f.owner=i.owner
   WHERE e.owner=? AND e.id>? AND e.type IN ('changed','goal') AND f.state NOT IN ('cancelled','paused') AND i.status<>'unknown'
   AND (i.preference='visible' OR (i.preference='snoozed' AND i.until_at<=?))
   AND (${allowed.map(()=>'(i.branch=? AND i.kind=?)').join(' OR ')})
   AND e.id>(SELECT coalesce(max(id),0) FROM op_events WHERE owner=e.owner AND item=e.item AND type='followed')
   AND e.id=(SELECT max(id) FROM op_events WHERE owner=e.owner AND item=e.item AND type IN ('changed','goal'))
   AND e.id>coalesce((SELECT last_event FROM op_seen WHERE owner=e.owner AND item=e.item),0)
   AND NOT EXISTS(SELECT 1 FROM op_push_deliveries WHERE subscription=? AND event=e.id)
   ORDER BY e.id LIMIT 100`).all(s.owner,s.baseline,now(),...allowed.flat(),s.id);
 }
 const service={
  settings(){current();return {available:enabled,publicKey:enabled?keys().publicKey:null};},
  status(id,origin){const {p,s}=owned(id,origin);return {enabled:enabled&&!!s.enabled&&p.revision===s.revision};},
  subscribe(input,origin){
   const p=current();assert(enabled,503,'PUSH_DESHABILITADO','El servidor tiene desactivadas las notificaciones.');
   const sub=validateSubscription(input),old=db.prepare('SELECT * FROM op_push_subscriptions WHERE endpoint=?').get(sub.endpoint);
   assert(!old||old.owner===p.userId&&old.origin===origin,409,'PUSH_OTRO_USUARIO','Este navegador está vinculado a otro usuario. Desactivá sus avisos antes de cambiar de cuenta.');
   // Repetir el alta activa es idempotente: no borra novedades ni duplica entregas.
   if(old?.enabled&&old.revision===p.revision)return {id:old.id,enabled:true};
   const id=old?.id||randomUUID();keys();
   assert(old||db.prepare('SELECT count(*) n FROM op_push_subscriptions WHERE owner=? AND enabled=1').get(p.userId).n<10,400,'PUSH_LIMITE','Ya tenés diez navegadores activos. Desactivá alguno antes de agregar otro.');
   db.prepare(`INSERT INTO op_push_subscriptions(id,owner,revision,origin,endpoint,subscription,baseline,created) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,subscription=excluded.subscription,baseline=excluded.baseline,enabled=1,failures=0,next_attempt=NULL`).run(id,p.userId,p.revision,origin,sub.endpoint,JSON.stringify(sub),maxEvent(),now());
   return {id,enabled:true};
  },
  disable(id,origin){const {s}=owned(id,origin);db.prepare('UPDATE op_push_subscriptions SET enabled=0 WHERE id=?').run(s.id);return {enabled:false};},
  claim(id,origin){
   db.exec('BEGIN IMMEDIATE');try{
    const {p,s}=owned(id,origin);
    // Se decide y se registra en una transacción: pestañas, push repetidos y reinicios no duplican.
    const events=eligible(s,p);for(const e of events)db.prepare('INSERT OR IGNORE INTO op_push_deliveries VALUES(?,?,?)').run(s.id,e.id,now());
    db.exec('COMMIT');
    if(!events.length)return {notification:null};
    const complete=events.some(e=>e.type==='goal'&&JSON.parse(e.body).state==='completed');
    return {notification:{title:complete?'Se cumplió un objetivo':'Cambió un seguimiento',body:'Tenés novedades en Central. Abrí la app para verlas.',tag:'central-follow-'+s.id+'-'+events.at(-1).id}};
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  run(){if(stopped||!enabled)return Promise.resolve();if(running)return running;
   running=(async()=>{
    const subscriptions=db.prepare("SELECT * FROM op_push_subscriptions WHERE enabled=1 AND (next_attempt IS NULL OR next_attempt<=?) ORDER BY coalesce(next_attempt,''),created LIMIT 20").all(now());
    for(const s of subscriptions){if(stopped)break;const p=user(s.owner);
     if(!p||p.revision!==s.revision){db.prepare('UPDATE op_push_subscriptions SET enabled=0 WHERE id=?').run(s.id);continue;}
     if(!eligible(s,p).length){db.prepare('UPDATE op_push_subscriptions SET next_attempt=? WHERE id=?').run(new Date(+clock()+intervalMs).toISOString(),s.id);continue;}
     // Reserva durable antes de salir a la red; tampoco duplica envíos entre procesos.
     const lease=new Date(+clock()+300000).toISOString();
     if(!db.prepare('UPDATE op_push_subscriptions SET next_attempt=?,last_sent=? WHERE id=? AND enabled=1 AND (next_attempt IS NULL OR next_attempt<=?)').run(lease,now(),s.id,now()).changes)continue;
     try{await send(JSON.parse(s.subscription),JSON.stringify({kind:'attention',subscription:s.id}),{TTL:300,urgency:'normal',topic:'central-attention',timeout:5000,vapidDetails:{subject:contact,...keys()}});
      db.prepare('UPDATE op_push_subscriptions SET failures=0 WHERE id=?').run(s.id);
     }catch(e){if([404,410].includes(e.statusCode))db.prepare('UPDATE op_push_subscriptions SET enabled=0 WHERE id=?').run(s.id);
      else db.prepare('UPDATE op_push_subscriptions SET failures=failures+1,next_attempt=? WHERE id=?').run(new Date(+clock()+Math.min(3600000,60000*2**Math.min(s.failures,6))).toISOString(),s.id);
     }
    }
   })().catch(()=>{}).finally(()=>{running=null;});return running;
  },
  start(){if(timer||stopped||!enabled)return;void service.run();timer=setInterval(()=>void service.run(),intervalMs);timer.unref?.();},
  resume(){stopped=false;timer=null;service.start();},
  async stop(){stopped=true;clearInterval(timer);await running;}
 };
 return service;
}

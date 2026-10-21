import {randomUUID,createHash} from 'node:crypto';
export const signature=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class AttentionStore {
 constructor(store,{clock=()=>new Date()}={}){
  this.db=store.db;this.clock=clock;
  this.db.exec(`CREATE TABLE IF NOT EXISTS op_items(id TEXT PRIMARY KEY,owner TEXT NOT NULL,key TEXT NOT NULL,branch TEXT NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,snapshot TEXT NOT NULL,signature TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL,checked TEXT,last_success TEXT,failures INTEGER NOT NULL DEFAULT 0,next_check TEXT,preference TEXT NOT NULL DEFAULT 'visible',until_at TEXT,on_change INTEGER NOT NULL DEFAULT 0,UNIQUE(owner,key));
   CREATE TABLE IF NOT EXISTS op_follows(owner TEXT NOT NULL,item TEXT NOT NULL,goal TEXT NOT NULL,state TEXT NOT NULL,started TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(owner,item));
   CREATE TABLE IF NOT EXISTS op_events(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,item TEXT NOT NULL,at TEXT NOT NULL,type TEXT NOT NULL,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS op_events_owner ON op_events(owner,item,id);
   CREATE TABLE IF NOT EXISTS op_seen(owner TEXT NOT NULL,item TEXT NOT NULL,last_event INTEGER NOT NULL,PRIMARY KEY(owner,item));
   CREATE TABLE IF NOT EXISTS op_sources(owner TEXT NOT NULL,branch TEXT NOT NULL,source TEXT NOT NULL,state TEXT NOT NULL,cursor TEXT NOT NULL DEFAULT '0',checked TEXT,last_success TEXT,failures INTEGER NOT NULL DEFAULT 0,next_check TEXT,PRIMARY KEY(owner,branch,source));
   CREATE TABLE IF NOT EXISTS op_worker(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 }
 now(){return this.clock().toISOString();}
 decode(r){return r?{...r,target:JSON.parse(r.target),snapshot:JSON.parse(r.snapshot),on_change:!!r.on_change}:null;}
 get(owner,id){return this.decode(this.db.prepare('SELECT i.*,f.goal,f.state follow_state,f.started FROM op_items i LEFT JOIN op_follows f ON f.owner=i.owner AND f.item=i.id WHERE i.owner=? AND i.id=?').get(owner,id));}
 byKey(owner,key){return this.decode(this.db.prepare('SELECT * FROM op_items WHERE owner=? AND key=?').get(owner,key));}
 rows(owner,branch){return this.db.prepare('SELECT i.*,f.goal,f.state follow_state,f.started FROM op_items i LEFT JOIN op_follows f ON f.owner=i.owner AND f.item=i.id WHERE i.owner=? AND i.branch=? ORDER BY i.created DESC').all(owner,branch).map(r=>this.decode(r));}
 event(owner,id,type,body){this.db.prepare('INSERT INTO op_events(owner,item,at,type,body) VALUES(?,?,?,?,?)').run(owner,id,this.now(),type,JSON.stringify(body));}
 upsert(owner,{key,branch,kind,target,snapshot,status='active'}){
  const now=this.now(),sig=signature(snapshot),old=this.byKey(owner,key),id=old?.id||randomUUID();
  this.db.exec('BEGIN IMMEDIATE');try{
   if(!old){this.db.prepare('INSERT INTO op_items(id,owner,key,branch,kind,target,snapshot,signature,status,created,checked,last_success) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,key,branch,kind,JSON.stringify(target),JSON.stringify(snapshot),sig,status,now,now,now);this.event(owner,id,'detected',{summary:'Se detectó la situación',status});}
   else{
    const changed=old.signature!==sig||(old.status!=='unknown'&&old.status!==status),recovered=old.status==='unknown';
    this.db.prepare('UPDATE op_items SET snapshot=?,signature=?,status=?,checked=?,last_success=?,failures=0,next_check=NULL,preference=CASE WHEN ? AND on_change=1 THEN \'visible\' ELSE preference END,until_at=CASE WHEN ? AND on_change=1 THEN NULL ELSE until_at END WHERE owner=? AND id=?').run(JSON.stringify(snapshot),sig,status,now,now,Number(changed),Number(changed),owner,id);
    if(recovered&&!changed)this.event(owner,id,'verified',{summary:'La fuente volvió a estar disponible; no cambiaron los datos del documento.'});
    if(changed){const changes=Object.keys(snapshot).filter(k=>JSON.stringify(snapshot[k])!==JSON.stringify(old.snapshot[k])).map(field=>({field,before:old.snapshot[field]??null,after:snapshot[field]??null}));this.event(owner,id,'changed',{summary:status==='resolved'?'La condición que generó el aviso dejó de cumplirse':'Cambió la situación',beforeStatus:old.status,status,changes});}
   }
   this.db.exec('COMMIT');return this.get(owner,id);
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 unavailable(owner,id){const r=this.get(owner,id);if(!r)return;const failures=r.failures+1,next=new Date(+this.clock()+Math.min(3600000,30000*2**Math.min(failures-1,7))).toISOString();this.db.prepare("UPDATE op_items SET status='unknown',checked=?,failures=?,next_check=? WHERE owner=? AND id=?").run(this.now(),failures,next,owner,id);if(r.status!=='unknown')this.event(owner,id,'unavailable',{summary:'No se pudo verificar la fuente. No se considera resuelto.'});}
 follow(owner,id,goal){const now=this.now();const old=this.db.prepare('SELECT * FROM op_follows WHERE owner=? AND item=?').get(owner,id);if(old&&old.state!=='cancelled'&&old.goal===goal)return;this.db.prepare("INSERT INTO op_follows VALUES(?,?,?,'active',?,?) ON CONFLICT(owner,item) DO UPDATE SET goal=excluded.goal,state='active',started=CASE WHEN op_follows.state='cancelled' THEN excluded.started ELSE op_follows.started END,updated=excluded.updated").run(owner,id,goal,now,now);this.event(owner,id,'followed',{summary:'Empezaste a seguirlo',goal});}
 finish(owner,id,state){const old=this.db.prepare('SELECT * FROM op_follows WHERE owner=? AND item=?').get(owner,id);if(!old||old.state===state)return;this.db.prepare('UPDATE op_follows SET state=?,updated=? WHERE owner=? AND item=?').run(state,this.now(),owner,id);this.event(owner,id,state==='cancelled'?'cancelled':'goal',{summary:state==='cancelled'?'Dejaste de seguirlo':state==='completed'?'Se cumplió el objetivo según los registros del ERP':state==='active'?'El objetivo volvió a estar pendiente.':'El documento se cerró sin poder acreditar el objetivo completo',state});}
 preference(owner,id,{mode,until=null,onChange=false}){this.db.prepare('UPDATE op_items SET preference=?,until_at=?,on_change=? WHERE owner=? AND id=?').run(mode,until,Number(onChange),owner,id);this.event(owner,id,'preference',{summary:mode==='visible'?'Volver a mostrar':mode==='snoozed'?'Aviso pospuesto':'Aviso descartado',mode,until,onChange});}
 events(owner,id,following=false){const f=following?this.db.prepare('SELECT started FROM op_follows WHERE owner=? AND item=?').get(owner,id):null;return this.db.prepare('SELECT id,at,type,body FROM op_events WHERE owner=? AND item=? AND at>=? ORDER BY id DESC LIMIT 50').all(owner,id,f?.started||'').map(r=>({...r,...JSON.parse(r.body),body:undefined}));}
 news(owner,id){const event=this.db.prepare("SELECT id,at,type FROM op_events WHERE owner=? AND item=? AND type IN ('detected','changed','goal','unavailable') ORDER BY id DESC LIMIT 1").get(owner,id),seen=this.db.prepare('SELECT last_event FROM op_seen WHERE owner=? AND item=?').get(owner,id)?.last_event||0;return {hasNews:!!event&&event.id>seen,lastChange:event?.at||null};}
 seen(owner,id){const event=this.db.prepare('SELECT MAX(id) id FROM op_events WHERE owner=? AND item=?').get(owner,id);this.db.prepare('INSERT INTO op_seen VALUES(?,?,?) ON CONFLICT(owner,item) DO UPDATE SET last_event=excluded.last_event').run(owner,id,event?.id||0);}
 source(owner,branch,source){return this.db.prepare('SELECT * FROM op_sources WHERE owner=? AND branch=? AND source=?').get(owner,branch,source);}
 sourceResult(owner,branch,source,{ok,cursor='0'}){const old=this.source(owner,branch,source),failures=ok?0:(old?.failures||0)+1;this.db.prepare('INSERT INTO op_sources VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,branch,source) DO UPDATE SET state=excluded.state,cursor=excluded.cursor,checked=excluded.checked,last_success=excluded.last_success,failures=excluded.failures,next_check=excluded.next_check').run(owner,branch,source,ok?'available':'unavailable',ok?cursor:old?.cursor||'0',this.now(),ok?this.now():old?.last_success||null,failures,ok?null:new Date(+this.clock()+Math.min(3600000,30000*2**Math.min(failures-1,7))).toISOString());}
 value(key,fallback=null){const r=this.db.prepare('SELECT value FROM op_worker WHERE key=?').get(key);return r?JSON.parse(r.value):fallback;}
 set(key,value){this.db.prepare('INSERT INTO op_worker VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
 lease(token,ttl=300000){const now=+this.clock(),r=this.db.prepare("INSERT INTO op_worker VALUES('lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(op_worker.value,'$.until')<? OR json_extract(op_worker.value,'$.token')=?").run(JSON.stringify({token,until:now+ttl}),now,token);return r.changes===1;}
 release(token){this.db.prepare("DELETE FROM op_worker WHERE key='lease' AND json_extract(value,'$.token')=?").run(token);}
}

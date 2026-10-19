import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export class Store {
  constructor(path){
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, actor TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS executions(id TEXT PRIMARY KEY, actor TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL, result TEXT);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL, reference TEXT);`);
    // Un proceso anterior pudo perder la respuesta del COMMIT. Nunca reenviar esos UPDATE.
    this.db.prepare("UPDATE executions SET status='unknown' WHERE status='executing'").run();
  }
  audit(actor,event,reference=null){this.db.prepare('INSERT INTO audit(at,actor,event,reference) VALUES(?,?,?,?)').run(new Date().toISOString(),actor,event,reference);}
  save(actor,body){
    const proposal={id:randomUUID(),actor,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+15*60_000).toISOString(),...body};
    this.db.exec('BEGIN IMMEDIATE');
    try{this.db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?)').run(proposal.id,actor,proposal.createdAt,proposal.expiresAt,JSON.stringify(proposal));this.audit(actor,'proposal.created',proposal.id);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
    return proposal;
  }
  get(id,actor){const row=this.db.prepare('SELECT body FROM proposals WHERE id=? AND actor=?').get(id,actor);return row?JSON.parse(row.body):null;}
  execution(id,actor){const row=this.db.prepare('SELECT status,at,result FROM executions WHERE id=? AND actor=?').get(id,actor);return row?{id,status:row.status,at:row.at,result:row.result?JSON.parse(row.result):null}:null;}
  claim(id,actor){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const result=this.db.prepare("INSERT OR IGNORE INTO executions VALUES(?,?,'executing',?,NULL)").run(id,actor,new Date().toISOString());
      if(result.changes)this.audit(actor,'execution.started',id);
      this.db.exec('COMMIT');return result.changes===1;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  finish(id,actor,status,result){
    this.db.exec('BEGIN IMMEDIATE');
    try{this.db.prepare('UPDATE executions SET status=?,at=?,result=? WHERE id=? AND actor=?').run(status,new Date().toISOString(),JSON.stringify(result),id,actor);this.audit(actor,'execution.'+status,id);this.db.exec('COMMIT');}
    catch(error){this.db.exec('ROLLBACK');throw error;}
    return this.execution(id,actor);
  }
  close(){this.db.close();}
}

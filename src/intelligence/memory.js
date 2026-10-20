import {randomUUID} from 'node:crypto';
import {assert} from '../errors.js';
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const stop=new Set('para como este esta esto ese esa esos esas del las los una uno que con por del me te lo el la de en un al y o ya ahora antes quiero podes favor mismo misma'.split(' '));
const terms=text=>new Set((normalize(text).match(/[a-z0-9_./-]+/g)||[]).filter(w=>w.length>2&&!stop.has(w)));
function saved(message){try{return JSON.parse(message.content);}catch{return {};}}
// History is durable; only the model view is bounded. No summarizer/model call.
export function conversationContext(conversation,text,branch,{singleBranch=false,budget=12000}={}){
 const turns=[];
 for(let i=0;i<conversation.messages.length;i++){
  const message=conversation.messages[i];if(message.role!=='user')continue;
  const assistant=conversation.messages[i+1]?.role==='assistant'?conversation.messages[i+1]:null;
  const reply=assistant?saved(assistant):{};
  const scope=message.sucursal||reply.sucursal;
  if(scope!==branch&&!(scope===undefined&&singleBranch))continue;
  const concise={answer:String(reply.answer||assistant?.content||'').slice(0,500),sucursal:scope,priceBase:reply.priceBase,evidence:reply.evidence};
  // Large old tables cannot monopolize the context window.
  if(JSON.stringify(concise).length>2400)concise.evidence=(reply.evidence||[]).map(e=>({action:e.action,args:e.args,identities:e.identities?.slice?.(0,2)}));
  const messages=[{role:'user',content:message.content},...(assistant?[{role:'assistant',content:JSON.stringify(concise).slice(0,3000)}]:[])];
  turns.push({index:i,messages,words:terms(message.content+' '+JSON.stringify(concise)),size:messages.reduce((n,m)=>n+m.content.length,0)});
 }
 const selected=new Map();let used=0;
 const add=t=>{if(!t||selected.has(t.index)||used+t.size>budget)return;selected.set(t.index,t);used+=t.size;};
 // Reserve half for recent dialog, half for relevant older exchanges.
 for(const t of turns.slice().reverse()){if(used+t.size>budget/2)break;add(t);}
 const query=terms(text),anchors=terms(turns.at(-1)?.messages[0]?.content||'');
 const ranked=turns.map(t=>({...t,score:[...query].reduce((n,w)=>n+(t.words.has(w)?(/\d/.test(w)?8:3):0),0)+[...anchors].reduce((n,w)=>n+(t.words.has(w)?0.25:0),0)})).filter(t=>t.score>0).sort((a,b)=>b.score-a.score||b.index-a.index);
 for(const t of ranked)add(t);
 return [...selected.values()].sort((a,b)=>a.index-b.index).flatMap(t=>t.messages);
}
export class Memory{
 constructor(store){this.db=store.db;this.db.exec(`CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,updated TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS knowledge(id TEXT PRIMARY KEY,owner TEXT NOT NULL,created TEXT NOT NULL,topic TEXT NOT NULL,term TEXT NOT NULL,meaning TEXT NOT NULL);`);}
 owner(actor){return actor.startsWith('ui:')?'local-user':actor;}
 conversation(id,actor){const owner=this.owner(actor);if(!id)return {id:randomUUID(),owner,messages:[]};assert(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),400,'CONVERSACION_INVALIDA','Conversación inválida');const row=this.db.prepare('SELECT body FROM conversations WHERE id=? AND owner=?').get(id,owner);assert(row,404,'CONVERSACION_NO_EXISTE','Conversación no encontrada');return JSON.parse(row.body);}
 save(conversation){conversation.title ||= conversation.messages.find(m=>m.role==='user')?.content.slice(0,80)||'Nueva conversación';this.db.prepare('INSERT INTO conversations VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,body=excluded.body').run(conversation.id,conversation.owner,new Date().toISOString(),JSON.stringify(conversation));}
 context(conversation,text,branch,options){return conversationContext(conversation,text,branch,options);}
 conversations(actor){return this.db.prepare("SELECT id,updated,json_extract(body,'$.title') AS title,json_extract(body,'$.messages[0].content') AS first FROM conversations WHERE owner=? ORDER BY updated DESC LIMIT 100").all(this.owner(actor)).map(r=>({id:r.id,updated:r.updated,title:r.title||r.first?.slice(0,80)||'Nueva conversación'}));}
 rename(actor,id,title){assert(typeof title==='string'&&title.trim().length>0&&title.length<=120,400,'TITULO_INVALIDO','Usá un nombre de hasta 120 caracteres.');const c=this.conversation(id,actor);c.title=title.trim();this.save(c);return {id,title:c.title};}
 deleteConversation(actor,id){this.conversation(id,actor);return this.db.prepare('DELETE FROM conversations WHERE id=? AND owner=?').run(id,this.owner(actor)).changes>0;}
 list(actor){return this.db.prepare('SELECT id,created,topic,term,meaning FROM knowledge WHERE owner=? ORDER BY created DESC LIMIT 100').all(this.owner(actor));}
 relevant(actor,text,topic){const query=normalize(text);return this.list(actor).map((item,index)=>({item,score:(query.includes(normalize(item.term))?100:0)+(item.topic===topic?10:0)+normalize(item.term).split(/\s+/).filter(w=>w.length>2&&query.includes(w)).length*5-index/1000})).sort((a,b)=>b.score-a.score).slice(0,20).map(x=>x.item);}
 add(actor,input){assert(input&&typeof input==='object',400,'MEMORIA_INVALIDA','Memoria inválida');const {topic='general',term,meaning}=input;assert(typeof topic==='string'&&topic.length<=40&&typeof term==='string'&&term.trim().length>=2&&term.length<=100&&typeof meaning==='string'&&meaning.trim().length>=2&&meaning.length<=800,400,'MEMORIA_INVALIDA','Indicar tema, término y significado');const id=randomUUID();this.db.prepare('INSERT INTO knowledge VALUES(?,?,?,?,?,?)').run(id,this.owner(actor),new Date().toISOString(),topic,term.trim(),meaning.trim());return {id,topic,term,meaning};}
 remove(actor,id){return this.db.prepare('DELETE FROM knowledge WHERE id=? AND owner=?').run(id,this.owner(actor)).changes>0;}
}

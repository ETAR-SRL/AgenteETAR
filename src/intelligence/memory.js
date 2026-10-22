import {randomUUID} from 'node:crypto';
import {assert} from '../errors.js';
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const stop=new Set('para como este esta esto ese esa esos esas del las los una uno que con por del me te lo el la de en un al y o ya ahora antes quiero podes favor mismo misma'.split(' '));
const terms=text=>new Set((normalize(text).match(/[a-z0-9_./-]+/g)||[]).filter(w=>w.length>2&&!stop.has(w)));
function saved(message){try{return JSON.parse(message.content);}catch{return {};}}
const fromBeginning=text=>/\b(?:al principio|al comienzo|al arranque|(?:la |el )?primer(?:a|o)? (?:consulta|producto|pedido|cliente|proveedor|solicitud|lista)|(?:producto|pedido|cliente|proveedor|solicitud|lista) (?:de |del )?(?:la )?primera consulta)\b/.test(normalize(text));
const correcting=text=>/^(?:no\b|perdon\b|correccion\b|mejor\b|en realidad\b|ese\b|esa\b|eso\b|descarta(?:lo)?\b|olvida(?:lo)?\b)/.test(normalize(text).trim());
// A historical identity is a search reference, never a current ERP value or
// permission. Only a unique SB1 identity actually returned in this scope qualifies.
export function firstProductReference(conversation,text,branch,{singleBranch=false}={}){
 if(!fromBeginning(text)||normalize(text).match(/\b(producto|pedido|cliente|proveedor|solicitud|lista)\b/)?.[1]!=='producto')return null;
 const request=normalize(text);
 if(/\bno\s+(?:(?:es|era|fue|uses|usar|quiero|el|al|ese|este)\s+)*(?:primer(?:o|a)?|principio|comienzo|arranque)\b|\b(?:descarta|descartalo|olvida|olvidalo)\b[^.!?]*\bprimer/.test(request))return null;
 const turns=[];
 for(let i=0;i<conversation.messages.length;i++){
  const user=conversation.messages[i];if(user.role!=='user')continue;
  const reply=conversation.messages[i+1]?.role==='assistant'?saved(conversation.messages[i+1]):{};
  const scope=user.sucursal||reply.sucursal;
  if(scope===branch||scope===undefined&&singleBranch)turns.push({user,reply});
 }
 const index=turns.findIndex(t=>/\bproducto\b/.test(normalize(t.user.content)));if(index<0)return null;
 const matches=(turns[index].reply.evidence||[]).flatMap(e=>e.args?.recurso==='productos'?(e.identities||[]):e.action==='precio_venta'?(e.identities||[]).map(row=>({codigo:row.productoCodigo})):[]);
 const codes=[...new Set(matches.map(row=>row.codigo).filter(code=>typeof code==='string'&&/^[a-z0-9_./-]{1,120}$/i.test(code)))];
 if(codes.length!==1)return null;
 const code=codes[0];
 if(turns.slice(index+1,index+4).some(t=>correcting(t.user.content)))return null;
 if(turns.slice(index+1).some(t=>normalize(t.user.content).includes(normalize(code))&&/\b(?:no|descarta|descartalo|correccion|perdon|reemplaza|cambia)\b/.test(normalize(t.user.content))))return null;
 return {kind:'product',code,source:'verified_historical_SB1_identity',currentValuesVerified:false};
}
// History is durable; only the model view is bounded. No summarizer/model call.
export function conversationContext(conversation,text,branch,{singleBranch=false,budget=12000}={}){
 const turns=[];
 for(let i=0;i<conversation.messages.length;i++){
  const message=conversation.messages[i];if(message.role!=='user')continue;
  const assistant=conversation.messages[i+1]?.role==='assistant'?conversation.messages[i+1]:null;
  const reply=assistant?saved(assistant):{};
  const scope=message.sucursal||reply.sucursal;
  if(scope!==branch&&!(scope===undefined&&singleBranch))continue;
  const concise={answer:String(reply.answer||assistant?.content||'').slice(0,500),sucursal:scope,historyTurn:turns.length+1,priceBase:reply.priceBase,evidence:reply.evidence};
  // Large old tables cannot monopolize the context window.
  if(JSON.stringify(concise).length>2400)concise.evidence=(reply.evidence||[]).map(e=>({action:e.action,args:e.args,identities:e.identities?.slice?.(0,2)}));
  const messages=[{role:'user',content:message.content},...(assistant?[{role:'assistant',content:JSON.stringify(concise).slice(0,3000)}]:[])];
  turns.push({index:i,messages,words:terms(message.content+' '+JSON.stringify(concise)),size:messages.reduce((n,m)=>n+m.content.length,0)});
 }
 const selected=new Map(),positions=new Map(turns.map((turn,index)=>[turn.index,index]));let used=0;
 const add=t=>{if(!t||selected.has(t.index)||used+t.size>budget)return;selected.set(t.index,t);used+=t.size;};
 const addContext=t=>{
  if(!t)return;
  const group=[t],position=positions.get(t.index);
  // Keep adjacent corrections with their reference, including «no, ese no»
  // that contains none of the original code/name's search terms.
  for(let j=position+1;j<Math.min(turns.length,position+4);j++){
   const next=turns[j];
   if(!correcting(next.messages[0].content))break;
   group.push(next);
  }
  if(used+group.filter(item=>!selected.has(item.index)).reduce((size,item)=>size+item.size,0)>budget)return;
  for(const item of group)add(item);
 };
 // An explicit reference to the beginning must not compete only by recency.
 // Restrict it to the requested subject and the already authorized branch.
 const normalized=normalize(text),fromStart=fromBeginning(text);
 const subject=fromStart&&normalized.match(/\b(producto|pedido|cliente|proveedor|solicitud|lista)\b/)?.[1];
 const initial=fromStart?turns.find(t=>!subject||new RegExp('\\b'+subject+'\\b').test(normalize(t.messages[0].content))):null;
 addContext(initial);
 // Reserve half for recent dialog, half for relevant older exchanges.
 if(!initial)for(const t of turns.slice().reverse()){if(used+t.size>budget/2)break;add(t);}
 const query=terms(text+' '+(initial?.messages[0]?.content||'')),anchors=terms(turns.at(-1)?.messages[0]?.content||'');
 const frequency=new Map();for(const t of turns)for(const word of t.words)if(query.has(word))frequency.set(word,(frequency.get(word)||0)+1);
 const initialAnchors=initial?[...terms(initial.messages[0].content)].filter(word=>(frequency.get(word)||0)<=Math.max(1,turns.length/4)):[];
 // Rare references outrank repeated conversational words in a long thread.
 const weight=word=>(/\d/.test(word)?8:3)*(1+Math.log2((turns.length+1)/((frequency.get(word)||0)+1)));
 const ranked=turns.map(t=>({turn:t,score:[...query].reduce((n,w)=>n+(t.words.has(w)?weight(w):0),0)+[...anchors].reduce((n,w)=>n+(t.words.has(w)?0.25:0),0)})).filter(t=>t.score>0&&(!initialAnchors.length||initialAnchors.some(word=>t.turn.words.has(word)))).sort((a,b)=>b.score-a.score||b.turn.index-a.turn.index);
 for(const t of ranked)addContext(t.turn);
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

import {mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?¡!.,;:]+/g,' ').replace(/\s+/g,' ').trim();
const concepts=new Map(['dashboard','resumen','reporte','informe','precio de venta','producto','cliente','proveedor','solicitud de compra','pedido de compra','pedido de venta','lista de precios','ventas','compras','produccion','calidad'].map(c=>[c,c]));concepts.set('tablero','dashboard');
const protectedWords=/\b(?:crear|crea|alta|nuevo|nueva|pedido|solicitud|actualizar|actualiza|cambiar|cambia|subir|subi|bajar|baja|confirmar|confirma|aprobar|aproba|borrar|borra|eliminar|elimina|permiso|rol|sql|clave|token|password|precio|cantidad|stock|saldo|millar|millares|unidades|unidad|mil|lucas|palos|verdes|dolar|dolares|pesos|plata|no|sin|todo|todos)\b/;
export function argentineText(text){
 return String(text).replace(/^\s*(?:(?:che|dale|bueno|ok|perfecto|porfa|por favor)[,!.\s]+)+/i,'')
  .replace(/^(?:tirame|pasame|sacame|mandame)\b/i,'mostrame')
  .replace(/^((?:(?:mostrame|dame|haceme|armame) )?)(?:un pantallazo|un paneo|un tablero)\b/i,'$1un dashboard')
  .replace(/^c[oó]mo (?:venimos|andamos) (?:con|de) (ventas|compras)\b/i,'dashboard de $1')
  .replace(/^(?:mostrame|dame) los n[uú]meros de (?:las )?(ventas|compras)\b/i,'dashboard de $1');
}
export class LanguageLearning{
 constructor(store){
  this.db=store.db;this.db.exec(`CREATE TABLE IF NOT EXISTS language_aliases(owner TEXT NOT NULL,branch TEXT NOT NULL,term TEXT NOT NULL,concept TEXT NOT NULL,uses INTEGER NOT NULL DEFAULT 0,updated TEXT NOT NULL,PRIMARY KEY(owner,branch,term));`);
  const file=this.db.prepare('PRAGMA database_list').get()?.file;
  this.directory=file?join(dirname(file),'aprendizaje'):null;
  if(this.directory)mkdirSync(this.directory,{recursive:true});
 }
 list(actor,branch){return this.db.prepare('SELECT term,concept,uses,updated FROM language_aliases WHERE owner=? AND branch=? ORDER BY updated DESC LIMIT 200').all(actor,branch);}
 snapshot(actor,branch){if(!this.directory)return;const name=createHash('sha256').update(actor+'\0'+branch).digest('hex');const target=join(this.directory,name+'.json');try{writeFileSync(target+'.tmp',JSON.stringify({version:1,expressions:this.list(actor,branch)},null,2),{mode:0o600});renameSync(target+'.tmp',target);}catch{/* SQLite is authoritative; a snapshot failure must not lose a correction. */}}
 chat(actor,text,branch){
  const n=norm(text);
  if(/^(?:que aprendiste|que expresiones (?:aprendiste|recordas)|mis expresiones)$/.test(n)){const rows=this.list(actor,branch);return {answer:rows.length?'Estas son tus expresiones aprendidas en esta sucursal:\n'+rows.map(r=>`• **${r.term}** → ${r.concept}`).join('\n'):'Todavía no guardé expresiones tuyas. Podés explicarme qué significa una palabra que usás en el trabajo.'};}
  const forget=/^(?:olvida|olvidate de|borra) (?:la expresion |el termino )?["«“]?([a-z ]{2,60})["»”]?$/.exec(n);
  if(forget&&this.list(actor,branch).some(r=>r.term===forget[1].trim())){this.db.prepare('DELETE FROM language_aliases WHERE owner=? AND branch=? AND term=?').run(actor,branch,forget[1].trim());this.snapshot(actor,branch);return {answer:`Olvidé la expresión **${forget[1].trim()}**.`};}
  const clean=n.replace(/["«»“”]/g,'').replace(/^(?:no |recorda que |acordate que )/,'');
  const definition=/^(?:(?:cuando|si) digo |(?:con|por) )([a-z ]{2,60}?) (?:me refiero a|quiero decir|digo|hablo de) (?:un |una |el |la )?([a-z ]{2,40})$/.exec(clean)
   ||/^(?:aca )?le decimos ([a-z ]{2,60}?) a (?:un |una |el |la )?([a-z ]{2,40})$/.exec(clean)
   ||/^(?:para mi |aca )?([a-z ]{2,60}?) (?:significa|es lo mismo que|le decimos a) (?:un |una |el |la )?([a-z ]{2,40})$/.exec(clean);
  if(!definition)return null;
  const term=definition[1].trim(),concept=concepts.get(definition[2].trim());
  if(!concept||protectedWords.test(term)||term.split(' ').length>5)return {answer:'Puedo aprender expresiones para informes, productos, clientes, proveedores, listas, ventas, compras, producción, calidad, solicitudes y pedidos. Los códigos, importes y reglas de operaciones se validan por separado.'};
  this.db.prepare(`INSERT INTO language_aliases(owner,branch,term,concept,updated) VALUES(?,?,?,?,?) ON CONFLICT(owner,branch,term) DO UPDATE SET concept=excluded.concept,uses=0,updated=excluded.updated`).run(actor,branch,term,concept,new Date().toISOString());this.snapshot(actor,branch);
  return {answer:`Aprendí que para vos **${term}** significa **${concept}**. Lo recordaré entre conversaciones en esta sucursal. Podés corregirlo con otra aclaración o decir «olvidá ${term}».`};
 }
 interpret(actor,text,branch){
  let interpreted=String(text);const applied=[],candidates=[];
  // Learned vocabulary can assist consultation, never turn a message into a write request.
  if(/\b(?:crea\w*|genera\w*|alta|nuevo|nueva|cambia\w*|actualiza\w*|modifica\w*|subi\w*|baja\w*|confirma\w*|aproba\w*)\b/.test(norm(text)))return {text:argentineText(interpreted),applied,candidates};
  for(const term of ['pantallazo','paneo','tablero'])if(new RegExp('\\bun '+term+'\\b').test(norm(text)))candidates.push({term,concept:'dashboard'});
  for(const row of this.list(actor,branch).sort((a,b)=>b.term.length-a.term.length)){
   const words=interpreted.match(/[\p{L}\p{N}_/-]+|[^\p{L}\p{N}_/-]+/gu)||[];
   // Whole phrases only; never substitute inside product codes or other words.
   const pattern=row.term.split(' ').map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join(' ');
   const normalized=norm(interpreted);if(!new RegExp('(?:^| )'+pattern+'(?: |$)').test(normalized))continue;
   let changed=false;const terms=row.term.split(' ');
   for(let i=0;i<words.length;i++){const prefix=norm(words.slice(0,i).join(''));if(!/^(?:(?:che|dale|porfa|por|favor|bueno|ok|perfecto|mostrame|mostra|dame|haceme|hace|armame|arma|tirame|pasame|sacame|un|una|el|la)(?: |$))*$/.test(prefix)&&prefix!=='')continue;if(terms.every((w,k)=>norm(words[i+k*2])===w)&&terms.every((_,k)=>k===0||/^\s+$/.test(words[i+k*2-1]))){words.splice(i,terms.length*2-1,row.concept);changed=true;}}
   if(changed){interpreted=words.join('');applied.push(row.term);}
  }
  return {text:argentineText(interpreted),applied,candidates};
 }
 observe(actor,branch,{applied,candidates=[]},reply){
  if(reply.accessDenied||reply.trace?.some(t=>['error','denied'].includes(t.status))||!reply.evidence?.some(e=>['dashboard','prices'].includes(e.result?.kind)))return;
  const learned=[];
  if(reply.evidence.some(e=>e.result?.kind==='dashboard'))for(const {term,concept} of candidates){const found=this.db.prepare('SELECT concept FROM language_aliases WHERE owner=? AND branch=? AND term=?').get(actor,branch,term);if(found)continue;this.db.prepare('INSERT INTO language_aliases(owner,branch,term,concept,uses,updated) VALUES(?,?,?,?,1,?)').run(actor,branch,term,concept,new Date().toISOString());learned.push({term,concept});}
  for(const term of applied)this.db.prepare('UPDATE language_aliases SET uses=uses+1 WHERE owner=? AND branch=? AND term=?').run(actor,branch,term);
  if(applied.length||learned.length)this.snapshot(actor,branch);
  return learned;
 }
}

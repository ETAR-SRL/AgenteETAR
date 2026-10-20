import {interpretPreference} from './preference-language.js';
import {assert} from '../errors.js';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[.!?]+$/,'');
const labels={detail:'Extensión de respuestas',format:'Formato de respuestas',quantityView:'Presentación de cantidades',warehouse:'Depósito habitual',requester:'Solicitante habitual'};
const choices={detail:['breves','detalladas'],format:['texto','tabla'],quantityView:['unidades','millares']};
// Only typed preferences entered by the authenticated user. No documents, rows,
// prices, permission flags or arbitrary executable instructions are remembered.
export class UserPreferences{
 constructor(store){this.db=store.db;this.db.exec('CREATE TABLE IF NOT EXISTS user_preferences(owner TEXT NOT NULL,scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(owner,scope,key))');}
 personal(actor){return /^user:[^:]+:[^:]+$/.test(actor);}
 list(actor,branch){if(!this.personal(actor))return [];return this.db.prepare("SELECT scope,key,value,updated FROM user_preferences WHERE owner=? AND (scope='' OR scope=?) ORDER BY key").all(actor,branch);}
 values(actor,branch){return Object.fromEntries(this.list(actor,branch).map(p=>[p.key,p.value]));}
 save(actor,branch,key,value){
  assert(this.personal(actor),403,'USUARIO_PERSONAL_REQUERIDO','Ingresá con tu usuario personal para guardar preferencias.');
  assert(Object.hasOwn(labels,key)&&typeof value==='string',400,'PREFERENCIA_INVALIDA','Preferencia no admitida.');
  if(choices[key])assert(choices[key].includes(value),400,'PREFERENCIA_INVALIDA','Valor de preferencia no admitido.');
  else assert(typeof branch==='string'&&branch.length>0&&value.length>0&&value.length<=80&&(key!=='warehouse'||/^[a-z0-9_-]{1,12}$/i.test(value)),400,'PREFERENCIA_INVALIDA','Valor de preferencia no admitido.');
  this.db.prepare('INSERT INTO user_preferences VALUES(?,?,?,?,?) ON CONFLICT(owner,scope,key) DO UPDATE SET value=excluded.value,updated=excluded.updated').run(actor,choices[key]?'':branch,key,value,new Date().toISOString());
 }
 forget(actor,branch,key){if(!this.personal(actor))return;this.db.prepare("DELETE FROM user_preferences WHERE owner=? AND (scope='' OR scope=?) AND (? IS NULL OR key=?)").run(actor,branch,key||null,key||null);}
 async validateWarehouse(read,branch,value){const result=await read('depositos',new URLSearchParams({sucursal:branch,codigo:value,limit:'2'}));assert(result.data?.length===1&&!result.meta?.hasMore&&result.data[0].codigo===value,409,'DEPOSITO_NO_VERIFICADO','No encontré un depósito único con ese código en esta sucursal. No guardé cambios.');}
 async chat(actor,text,branch,{read,model,conversation}){
  const n=norm(text),prefix='(?:(?:recorda|recuerda|guarda) (?:que )?)?';
  let key,value;
  if(/^(?:mostra(?:me)?|ver|cuales son|que recordas de) mis preferencias$/.test(n)){
   const data=this.list(actor,branch);return {answer:data.length?'Tus preferencias guardadas:\n'+data.map(p=>`• ${labels[p.key]}: ${p.value}${p.scope?' (sucursal '+p.scope+')':''}`).join('\n'):'Todavía no guardaste preferencias con este usuario. Podés decir «Prefiero respuestas breves» o «Usá el depósito 16 por defecto».',data};
  }
  const forget=/^(?:olvida|borra|elimina) (?:todas )?mis preferencias(?: de (respuestas|formato|cantidades|deposito|solicitante))?$/.exec(n);
  if(forget){key={respuestas:'detail',formato:'format',cantidades:'quantityView',deposito:'warehouse',solicitante:'requester'}[forget[1]];this.forget(actor,branch,key);return {answer:'Olvidé '+(key?labels[key].toLowerCase():'tus preferencias generales y las de esta sucursal')+'. No cambié documentos ni datos del ERP.',data:[]};}
  let match=new RegExp('^'+prefix+'(?:prefiero|quiero) respuestas (breves|cortas|detalladas|largas)$').exec(n);
  if(match){key='detail';value=['breves','cortas'].includes(match[1])?'breves':'detalladas';}
  match=new RegExp('^'+prefix+'(?:prefiero|quiero) (?:las )?respuestas en (texto|tabla)$').exec(n);
  if(match){key='format';value=match[1];}
  match=new RegExp('^'+prefix+'(?:prefiero|quiero) (?:ver |mostrar )?(?:las )?cantidades en (unidades|millares)$').exec(n);
  if(match){key='quantityView';value=match[1];}
  match=/^(?:(?:recorda|recuerda) que )?(?:usa|usar) (?:el )?deposito ([a-z0-9_-]{1,12}) por defecto$/.exec(n);
  if(match){key='warehouse';value=match[1].toUpperCase();}
  match=/^(?:(?:recordá|recorda|recuerda) que )?mi solicitante por defecto es ([^\r\n;]{1,80})[.!]?$/i.exec(text.trim());
  if(match){key='requester';value=match[1].trim().replace(/[.!]$/,'');}
  if(!key){
   const last=conversation?.lastPreference;
   const currentLast=last?.branch===branch&&last.messageCount===conversation.messages.length?last.keys:null;
   let parsed;
   try{parsed=await interpretPreference(text,currentLast,model);}catch{return {answer:'No pude interpretar con seguridad qué preferencia querés guardar. No guardé cambios. ¿Qué querés que recuerde para próximas conversaciones?',data:[]};}
   if(!parsed||parsed.intent==='none')return null;
   if(parsed.intent==='clarify')return {answer:'¿Qué preferencia querés dejar para próximas conversaciones? No guardé cambios porque hay más de una interpretación posible.',data:[]};
   if(parsed.intent==='list')return this.chat(actor,'Mostrame mis preferencias',branch,{read});
   if(parsed.intent==='forget'){
    if(!/\b(olvida|borra|elimina|deja de recordar|no recuerdes|deshace)\b/.test(n))return {answer:'No borré preferencias. ¿Querés que olvide alguna de las guardadas?',data:[]};
    for(const change of parsed.changes)assert(Object.hasOwn(labels,change.key)&&typeof change.quote==='string'&&change.quote.length>0&&text.includes(change.quote),400,'PREFERENCIA_INVALIDA','No pude verificar qué preferencia querés borrar.');
    if(!parsed.changes.length&&!/\b(todas|todo|mis preferencias)\b/.test(n))return {answer:'¿Qué preferencia querés que olvide? No borré ninguna.',data:[]};
    if(parsed.changes.length)for(const change of parsed.changes)this.forget(actor,branch,change.key);else this.forget(actor,branch);
    if(conversation)delete conversation.lastPreference;
    return {answer:'Olvidé '+(parsed.changes.length?parsed.changes.map(c=>labels[c.key].toLowerCase()).join(', '):'tus preferencias generales y las de esta sucursal')+'. No modifiqué el ERP.',data:this.list(actor,branch)};
   }
   if(/\b(no guardes|no recuerdes|no memorices)\b/.test(n))return {answer:'No guardé ninguna preferencia.',data:[]};
   assert(parsed.changes.length>0&&new Set(parsed.changes.map(c=>c.key)).size===parsed.changes.length,400,'PREFERENCIA_INVALIDA','No guardé cambios: necesito una preferencia inequívoca.');
   if(currentLast&&/^(?:no[, ]|mejor |en realidad |perdon[, ])/.test(n)&&!/(deposito|solicitante|respuestas|formato|cantidades)/.test(n))assert(currentLast.length===1&&parsed.changes.every(c=>c.key===currentLast[0].key),400,'PREFERENCIA_AMBIGUA','¿Cuál de las preferencias querés corregir? No guardé cambios.');
   for(const change of parsed.changes){
    assert(Object.hasOwn(labels,change.key)&&typeof change.value==='string'&&typeof change.quote==='string'&&change.quote.length>0&&text.includes(change.quote),400,'PREFERENCIA_INVALIDA','No guardé cambios: la preferencia no está respaldada por tu mensaje.');
    if(choices[change.key])assert(choices[change.key].includes(change.value),400,'PREFERENCIA_INVALIDA','Valor de preferencia no admitido.');
    else assert(change.value.length>0&&change.value.length<=80&&norm(change.quote).includes(norm(change.value))&&(change.key!=='warehouse'||/^[a-z0-9_-]{1,12}$/i.test(change.value)&&(norm(change.quote).match(/[a-z0-9_-]+/g)||[]).includes(norm(change.value))),400,'PREFERENCIA_INVALIDA','No guardé cambios: falta un nombre o código explícito.');
   }
   assert(this.personal(actor),403,'USUARIO_PERSONAL_REQUERIDO','Ingresá con tu usuario personal para guardar preferencias.');
   // Validate every read before committing any preference in a compound sentence.
   for(const change of parsed.changes)if(change.key==='warehouse')await this.validateWarehouse(read,branch,change.value);
   const previous=this.values(actor,branch);
   this.db.exec('SAVEPOINT preferences');
   try{for(const change of parsed.changes)this.save(actor,branch,change.key,change.value);this.db.exec('RELEASE preferences');}catch(error){this.db.exec('ROLLBACK TO preferences; RELEASE preferences');throw error;}
   if(conversation)conversation.lastPreference={branch,keys:parsed.changes.map(c=>({key:c.key,value:c.value})),messageCount:conversation.messages.length+2};
   return {answer:'Guardé para tus próximas conversaciones:\n'+parsed.changes.map(c=>`• ${labels[c.key]}: ${c.value}${previous[c.key]&&previous[c.key]!==c.value?' (antes: '+previous[c.key]+')':''}${choices[c.key]?'':' · sucursal '+branch}`).join('\n')+'\nPodés corregirme ahora o pedirme que lo olvide. Los permisos, la validación ERP y la confirmación de cambios siguen vigentes.',data:this.list(actor,branch)};
  }
  assert(this.personal(actor),403,'USUARIO_PERSONAL_REQUERIDO','Ingresá con tu usuario personal para guardar preferencias.');
  if(key==='warehouse'){
   await this.validateWarehouse(read,branch,value);
  }
  this.save(actor,branch,key,value);
  if(conversation)conversation.lastPreference={branch,keys:[{key,value}],messageCount:conversation.messages.length+2};
  return {answer:`Guardé tu preferencia: ${labels[key].toLowerCase()}, ${value}. La usaré en tus próximas conversaciones${choices[key]?'':` de la sucursal ${branch}`}. Podés cambiarla repitiendo la indicación o decir «Olvidá mis preferencias».`+(key==='warehouse'||key==='requester'?' Antes de preparar un documento volveré a validar los datos y mostrarte el resumen.':key==='quantityView'?' Es una preferencia de presentación; no define cantidades ni bases de nuevas operaciones.':''),data:this.list(actor,branch)};
 }
}

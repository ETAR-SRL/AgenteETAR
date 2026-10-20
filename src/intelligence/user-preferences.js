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
 async chat(actor,text,branch,{read}){
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
  if(!key)return null;
  assert(this.personal(actor),403,'USUARIO_PERSONAL_REQUERIDO','Ingresá con tu usuario personal para guardar preferencias.');
  if(key==='warehouse'){
   const result=await read('depositos',new URLSearchParams({sucursal:branch,codigo:value,limit:'2'}));
   assert(result.data?.length===1&&!result.meta?.hasMore&&result.data[0].codigo===value,409,'DEPOSITO_NO_VERIFICADO','No encontré un depósito único con ese código en esta sucursal. No guardé la preferencia.');
  }
  this.save(actor,branch,key,value);
  return {answer:`Guardé tu preferencia: ${labels[key].toLowerCase()}, ${value}. La usaré en tus próximas conversaciones${choices[key]?'':` de la sucursal ${branch}`}. Podés cambiarla repitiendo la indicación o decir «Olvidá mis preferencias».`+(key==='warehouse'||key==='requester'?' Antes de preparar un documento volveré a validar los datos y mostrarte el resumen.':key==='quantityView'?' Es una preferencia de presentación; no define cantidades ni bases de nuevas operaciones.':''),data:this.list(actor,branch)};
 }
}

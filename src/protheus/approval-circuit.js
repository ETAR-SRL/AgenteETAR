import {assert} from '../errors.js';
import {identifier as q} from './config.js';
import {D,clean,sourceNumber} from './write-policy.js';

const fields={
 SAL:['AL_COD','AL_ITEM','AL_APROV','AL_PERFIL','AL_USER','AL_NIVEL','AL_APROSUP','AL_USERSUP','AL_LIBAPR','AL_AUTOLIM','AL_TPLIBER','AL_DOCPC','AL_DOCIP','AL_DOCSC'],
 SAK:['AK_COD','AK_USER','AK_MOEDA','AK_LIMITE','AK_TIPO','AK_APROSUP'],
 DHL:['DHL_COD','DHL_LIMMIN','DHL_LIMMAX','DHL_MOEDA'],
 DBL:['DBL_GRUPO','DBL_ITEM','DBL_CC','DBL_CONTA','DBL_ITEMCT','DBL_CLVL'],
 DHM:['DHM_GRUPO','DHM_APROV','DHM_TIPCOM'],
 SAI:['AI_USER','AI_GRUSER','AI_ITEM','AI_GRUPO','AI_PRODUTO','AI_DOMINIO','AI_QUANT']
};
const branchFields={SAL:'AL_FILIAL',SAK:'AK_FILIAL',DHL:'DHL_FILIAL',DBL:'DBL_FILIAL',DHM:'DHM_FILIAL',SAI:'AI_FILIAL'};
export async function readApprovalCatalog(connection,catalog,alias,branch,lock){
 const table=catalog.table(alias),wanted=fields[alias],bf=branchFields[alias];
 for(const field of [...wanted,bf,'D_E_L_E_T_','R_E_C_N_O_'])assert(table.columns.has(field),409,'CIRCUITO_ESQUEMA',`Falta ${alias}.${field}`);
 const selected=wanted.map(f=>['float','real'].includes(table.columns.get(f).type)?`CONVERT(varchar(100),${q(f)},3) AS ${q(f)}`:q(f));
 const rows=await connection.query(`SELECT TOP (1001) ${selected.join(',')} FROM ${q(table.schema)}.${q(table.name)}${lock?' WITH (UPDLOCK,HOLDLOCK)':''} WHERE [D_E_L_E_T_]=' ' AND ${q(bf)}=@branch ORDER BY [R_E_C_N_O_]`,{branch:catalog.branch(alias,branch)});
 assert(rows.length<=1000,409,'CIRCUITO_EXCEDIDO',`${alias}: más de 1000 referencias; no se usa una muestra`);
 return rows;
}
const check=(condition,message)=>assert(condition,409,'CIRCUITO_INVALIDO',message);
const flag=value=>{check(['T','F'].includes(clean(value)),'Flag lógico SAL no reconocido');return clean(value)==='T';};
const one=(rows,field,value)=>{const found=rows.filter(r=>clean(r[field])===value);check(found.length===1,`${field}=${value}: referencia inexistente o duplicada`);return found[0];};
const amount=(v,f)=>{const n=sourceNumber(v,f);check(n.gte(0),`${f}: importe negativo`);return n;};
const sum=items=>items.reduce((n,i)=>n.plus(i.total),new D(0));

// The current purchase form only supplies cost centre; the other accounting
// entities are blank in the new document. Never match a rule for another entity.
export function entityGroup(rules,item,fallback){
 const candidates=rules.filter(r=>['DBL_CONTA','DBL_ITEMCT','DBL_CLVL'].every(f=>clean(r[f])==='')&&clean(r.DBL_CC)===item.centroCosto);
 check(candidates.length<=1,'Más de un grupo para la misma combinación contable');
 if(candidates.length)return candidates[0];
 if(!fallback)return null;
 const parts=fallback.split(';');check(parts.length===2&&parts.every(p=>p.trim()),'MV_APGRDFL debe ser grupo;ítem');
 const found=rules.filter(r=>clean(r.DBL_GRUPO)===parts[0].trim()&&clean(r.DBL_ITEM)===parts[1].trim());
 check(found.length===1,'Grupo/ítem de MV_APGRDFL inexistente o ambiguo');return found[0];
}

// Builds only pending approval entries. Limits already consumed in SCS are
// evaluated by Protheus when the approver acts, never consumed or reset here.
export function buildApprovalCircuit({alias,group='',values,items,catalogs}){
 const {SAL,SAK,DHL,DHM,DBL=[]}=catalogs,entity=alias==='SC1'?values.MV_APRSCEC:values.MV_APRPCEC;
 const type=alias==='SC1'?'SC':entity?'IP':'PC',batches=new Map(),excluded=[],routes=[];
 if(entity){
  check(['1','2'].includes(values.MV_PERFALC),'MV_PERFALC debe ser 1 o 2');
  if(alias==='SC7')check(values.MV_APRIPPC==='2','MV_APRIPPC=1 requiere generación diferida de PC tras IP; este circuito de dos etapas no está implementado');
  for(const item of items){
   const rule=entityGroup(DBL,item,values.MV_APGRDFL),g=rule?clean(rule.DBL_GRUPO):'',it=rule?clean(rule.DBL_ITEM):'';
   routes.push({item:item.item,grupo:g,itemGrupo:it});
   if(!g)continue;
   const key=g+'|'+it;if(!batches.has(key))batches.set(key,{group:g,groupItem:it,items:[]});batches.get(key).items.push(item);
  }
 }else if(group)batches.set(group,{group,groupItem:'',items});
 const entries=[];
 for(const batch of batches.values()){
  const members=SAL.filter(r=>clean(r.AL_COD)===batch.group);check(members.length>0,'Grupo de aprobación inexistente: '+batch.group);
  check(new Set(members.map(r=>clean(r.AL_ITEM))).size===members.length,'Ítems SAL duplicados');
  check(new Set(members.map(r=>clean(r.AL_USER))).size===members.length,'Usuario repetido en el grupo; circuito ambiguo');
  const pending=[];
  for(const member of members){
   if(values.MV_ALTPDOC&&!flag(member['AL_DOC'+type])){excluded.push({grupo:batch.group,itemGrupo:batch.groupItem,aprobador:clean(member.AL_APROV),motivo:'Tipo de documento no habilitado'});continue;}
   const approver=one(SAK,'AK_COD',clean(member.AL_APROV)),profile=one(DHL,'DHL_COD',clean(member.AL_PERFIL));
   const user=clean(approver.AK_USER),level=clean(member.AL_NIVEL);
   check(user&&user===clean(member.AL_USER),'SAL y SAK no coinciden en el usuario aprobador');
   check(/^\d{1,2}$/.test(level)&&Number(level)>0,'Nivel SAL inválido');
   check(['A','V'].includes(clean(member.AL_LIBAPR))&&['U','N','P'].includes(clean(member.AL_TPLIBER))&&['S','N'].includes(clean(member.AL_AUTOLIM)),'Tipo de aprobación, liberación o límite automático inválido');
   check(!DHM.some(r=>clean(r.DHM_GRUPO)===batch.group&&clean(r.DHM_APROV)===clean(member.AL_APROV)),'El aprobador tiene reglas por tipo de compra; este formulario no informa ese tipo');
   check(!clean(member.AL_APROSUP)&&!clean(member.AL_USERSUP)&&!clean(approver.AK_APROSUP),'El aprobador tiene un superior configurado; debe verificarse su circuito de escalamiento');
   check(amount(profile.DHL_MOEDA,'DHL_MOEDA').eq(1)&&amount(approver.AK_MOEDA,'AK_MOEDA').eq(1),'Perfil y aprobador deben usar moneda local 1');
   const min=amount(profile.DHL_LIMMIN,'DHL_LIMMIN'),max=amount(profile.DHL_LIMMAX,'DHL_LIMMAX');check(max.gte(min),'Rango de perfil invertido');
   const automatic=clean(member.AL_AUTOLIM)==='S',eligible=n=>!automatic||(n.gte(min)&&n.lte(max));
   const selected=entity&&values.MV_PERFALC==='2'?batch.items.filter(i=>eligible(new D(i.total))):eligible(sum(batch.items))?batch.items:[];
   if(!selected.length){excluded.push({grupo:batch.group,itemGrupo:batch.groupItem,aprobador:clean(member.AL_APROV),motivo:'Importe fuera del rango del perfil'});continue;}
   pending.push({tipo:type,grupo:batch.group,itemGrupo:batch.groupItem,aprobador:clean(member.AL_APROV),usuario:user,nivel:level,perfil:clean(member.AL_PERFIL),minimo:min.toFixed(),maximo:max.toFixed(),tipoAprobacion:clean(member.AL_LIBAPR),tipoLiberacion:clean(member.AL_TPLIBER),limiteAutomatico:automatic,total:sum(selected).toFixed(2),items:selected.map(i=>({item:i.item,total:i.total})),limiteAprobador:amount(approver.AK_LIMITE,'AK_LIMITE').toFixed(),periodicidad:clean(approver.AK_TIPO)});
  }
  const first=Math.min(...pending.map(e=>Number(e.nivel)));
  for(const e of pending)entries.push({...e,estado:Number(e.nivel)===first?'02':'01'});
 }
 check(entries.length<=500,'El circuito supera 500 aprobaciones');
 const blocked=new Set(entries.flatMap(e=>e.items.map(i=>i.item)));
 const itemStates=Object.fromEntries(items.map(i=>[i.item,alias==='SC7'&&entries.length&&!values.MV_IPAPREC?'B':blocked.has(i.item)?'B':'L']));
 return {type,entity,entries,excluded,routes,itemStates,status:entries.length?'B':'L'};
}

export function buildSimpleRequestApproval({items,requester,rows,values}){
 check(requester&&/^[A-Za-z0-9]{1,6}$/.test(requester),'Indicar solicitanteCodigo (usuario ERP) para evaluar sus restricciones');
 check(!values.MV_RESTSCC,'MV_RESTSCC requiere derechos de solicitante por entidades contables');
 check(!rows.some(r=>!clean(r.AI_USER)&&clean(r.AI_GRUSER)),'Hay permisos por grupo de usuarios; falta resolver membresía ERP');
 const own=rows.filter(r=>clean(r.AI_USER)===requester),states={};
 check(own.every(r=>['I','E'].includes(clean(r.AI_DOMINIO))),'Reglas R (redefine) del solicitante no verificadas');
 const match=(rule,value)=>!clean(rule)||clean(rule)==='*'||clean(rule)===value;
 for(const item of items){
  const matched=own.filter(r=>match(r.AI_PRODUTO,item.producto)&&match(r.AI_GRUPO,item.grupoProducto));
  const permitted=matched.some(r=>clean(r.AI_DOMINIO)==='I'&&(amount(r.AI_QUANT,'AI_QUANT').eq(0)||amount(r.AI_QUANT,'AI_QUANT').gte(item.cantidad)))&&!matched.some(r=>clean(r.AI_DOMINIO)==='E');
  check(['S','N'].includes(item.restriccionProducto),'B1_SOLICIT debe ser S o N');
  check(permitted||item.restriccionProducto==='N','El solicitante no tiene permiso para este producto restringido');
  check(permitted||!values.MV_CHKSOLI,'MV_CHKSOLI exige autorización del solicitante');
  states[item.item]=permitted||!values.MV_APROVSC?'L':'B';
 }
 return {type:'SC-simple',entity:false,entries:[],excluded:[],routes:[],itemStates:states,status:Object.values(states).includes('B')?'B':'L'};
}

import {createHash} from 'node:crypto';
import {assert} from '../errors.js';
import {identifier as q} from './config.js';
import {clean,sourceNumber,D} from './write-policy.js';
import {readApprovalCatalog,superiorRoute} from './approval-circuit.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date=value=>{const s=clean(value),d=new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}T00:00:00Z`);return /^\d{8}$/.test(s)&&Number(s.slice(0,4))>=1900&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10).replaceAll('-','')===s;};
const pending=row=>clean(row.CR_STATUS)==='02'&&!clean(row.CR_DATALIB)&&!clean(row.CR_USERLIB)&&!clean(row.CR_LIBAPRO)&&sourceNumber(row.CR_VALLIB,'CR_VALLIB').eq(0);
// CR_PRAZO is the deadline already resolved by Protheus. CR_ESCALON only
// controls mail: it never grants permission to transfer an approval.
export function deadlineDecision(row,today){
 assert(date(today),409,'FECHA_ERP_INVALIDA','Fecha del servidor SQL inválida');
 if(!['SC','IP','PC'].includes(clean(row.CR_TIPO))||clean(row.CR_STATUS)!=='02')return {due:false,reason:'NO_PENDIENTE'};
 if(clean(row.CR_ESCALSP)!=='T')return {due:false,reason:'TRANSFERENCIA_DESACTIVADA'};
 let valid=false;try{valid=date(row.CR_PRAZO);}catch{}
 assert(valid,409,'PLAZO_INVALIDO','La aprobación no tiene un vencimiento válido');
 if(clean(row.CR_PRAZO)>=today)return {due:false,reason:'NO_VENCIDO'};
 if(!pending(row))return {due:false,reason:'YA_LIBERADO'};
 // A transfer is one hop to the immediate superior, not a rapid cascade
 // through the hierarchy using the same expired deadline. Also recognizes
 // transfers made by Protheus or by the manual workflow, without local history.
 if(clean(row.CR_APRORI)||clean(row.CR_USERORI)||clean(row.CR_TPTRAN))return {due:false,reason:'YA_TRANSFERIDO'};
 return {due:true};
}

export function createApprovalEscalation({db,catalog,getWriteDb,enabled,allowedBranches,selection,schema,text}){
 const tableName=a=>{const t=catalog.table(a);return `${q(t.schema)}.${q(t.name)}`;};
 function requireFields(alias,fields){for(const f of fields)assert(catalog.table(alias).columns.has(f),409,'ESCALAMIENTO_ESQUEMA',`Falta ${alias}.${f}`);}
 async function today(connection){const rows=await connection.query('SELECT CONVERT(char(8),GETDATE(),112) AS today');assert(rows.length===1&&date(rows[0].today),409,'FECHA_ERP_INVALIDA','Fecha SQL no verificable');return rows[0].today;}
 async function rows(connection,alias,target,lock){
  const prefix={SC1:'C1',SC7:'C7',SCR:'CR',DBM:'DBM'}[alias],limit=alias==='DBM'?25000:1000;
  requireFields(alias,[prefix+'_FILIAL',prefix+'_NUM','R_E_C_N_O_','D_E_L_E_T_']);
  const result=await connection.query(`SELECT TOP (${limit+1}) ${selection(catalog.table(alias))} FROM ${tableName(alias)}${lock?' WITH (UPDLOCK,HOLDLOCK)':''} WHERE ${q(prefix+'_FILIAL')}=@branch AND ${q(prefix+'_NUM')}=@number AND [D_E_L_E_T_]=' ' ORDER BY [R_E_C_N_O_]`,{branch:catalog.branch(alias,target.sucursal),number:target.numero});
  assert(result.length<=limit,409,'CIRCUITO_EXCEDIDO','No se transfiere un circuito truncado');
  return result;
 }
 async function snapshot(connection,target,lock){
  const alias=target.tipo==='SC'?'SC1':'SC7';
  // Same lock order as creation and the manual workflow.
  const doc=await rows(connection,alias,target,lock),scr=await rows(connection,'SCR',target,lock),dbm=await rows(connection,'DBM',target,lock);
  return {doc,scr,dbm};
 }
 async function plan(connection,target,lock=false){
  assert(allowedBranches.includes(target.sucursal)&&['SC','IP','PC'].includes(target.tipo)&&/^[1-9]\d{0,18}$/.test(target.registro)&&BigInt(target.registro)<=9223372036854775807n&&typeof target.numero==='string'&&target.numero.length<=20,400,'ESCALAMIENTO_OBJETIVO','Objetivo fuera del alcance');
  requireFields('SCR',['CR_EMISSAO','CR_STATUS','CR_PRAZO','CR_ESCALSP','CR_APROV','CR_USER','CR_USERORI','CR_APRORI','CR_TPTRAN','CR_DATALIB','CR_USERLIB','CR_LIBAPRO','CR_VALLIB','CR_GRUPO','CR_ITGRP','CR_NIVEL','CR_TOTAL','CR_MOEDA','CR_TXMOEDA','CR_FLUIG','CR_WF']);
  const live=await snapshot(connection,target,lock),found=live.scr.filter(r=>clean(r.R_E_C_N_O_)===target.registro&&clean(r.CR_TIPO)===target.tipo);
  assert(found.length===1,409,'CIRCUITO_OBJETIVO','La aprobación ya no pertenece al documento');
  const row=found[0],decision=deadlineDecision(row,await today(connection));
  assert(decision.due,409,decision.reason,'El vencimiento no requiere transferencia');
  assert(!clean(row.CR_FLUIG)&&['','N'].includes(clean(row.CR_WF)),409,'FLUJO_EXTERNO','La aprobación pertenece a un flujo externo');
  assert(sourceNumber(row.CR_MOEDA,'CR_MOEDA').eq(1)&&sourceNumber(row.CR_TXMOEDA,'CR_TXMOEDA').eq(1),409,'MONEDA_NO_SOPORTADA','Se requiere moneda local');
  const SAK=await readApprovalCatalog(connection,catalog,'SAK',target.sucursal,lock),SAL=await readApprovalCatalog(connection,catalog,'SAL',target.sucursal,lock);
  const approvers=SAK.filter(r=>clean(r.AK_COD)===clean(row.CR_APROV)&&clean(r.AK_USER)===clean(row.CR_USER));
  assert(approvers.length===1,409,'APROBADOR_AMBIGUO','No coincide el usuario y aprobador actual');
  const members=SAL.filter(r=>clean(r.AL_COD)===clean(row.CR_GRUPO)&&clean(r.AL_APROV)===clean(row.CR_APROV)&&clean(r.AL_USER)===clean(row.CR_USER)&&clean(r.AL_NIVEL)===clean(row.CR_NIVEL));
  assert(members.length===1,409,'GRUPO_CAMBIO','No coincide el grupo, usuario y nivel actual');
  const next=superiorRoute(approvers[0],members[0],SAK,SAL)[0];
  assert(next&&next.usuario!==clean(row.CR_USER),409,'SIN_SUPERIOR','No hay un superior inmediato válido');
  const sameGroup=r=>clean(r.CR_TIPO)===target.tipo&&clean(r.CR_GRUPO)===clean(row.CR_GRUPO)&&clean(r.CR_ITGRP)===clean(row.CR_ITGRP);
  assert(!live.scr.some(r=>r!==row&&sameGroup(r)&&[clean(row.CR_USER),next.usuario].includes(clean(r.CR_USER))),409,'SUPERIOR_DUPLICADO','El usuario tiene otro paso en este grupo');
  const alias=target.tipo==='SC'?'SC1':'SC7',prefix=alias==='SC1'?'C1':'C7',state=alias==='SC1'?'C1_APROV':'C7_CONAPRO';
  requireFields(alias,[prefix+'_ITEM',prefix+'_TOTAL',prefix+'_QUJE',prefix+'_RESIDUO',state]);
  const links=live.dbm.filter(r=>clean(r.DBM_TIPO)===target.tipo&&clean(r.DBM_GRUPO)===clean(row.CR_GRUPO)&&clean(r.DBM_ITGRP)===clean(row.CR_ITGRP)&&clean(r.DBM_USER)===clean(row.CR_USER));
  if(target.tipo!=='PC'){
   requireFields('DBM',['DBM_ITEM','DBM_TIPO','DBM_GRUPO','DBM_ITGRP','DBM_USER','DBM_USEROR','DBM_APROV','DBM_VALOR']);
   assert(links.length>0&&new Set(links.map(r=>clean(r.DBM_ITEM))).size===links.length,409,'CIRCUITO_CAMBIO','Vínculos DBM vacíos o duplicados');
   assert(!live.dbm.some(r=>clean(r.DBM_TIPO)===target.tipo&&clean(r.DBM_GRUPO)===clean(row.CR_GRUPO)&&clean(r.DBM_ITGRP)===clean(row.CR_ITGRP)&&clean(r.DBM_USER)===next.usuario),409,'SUPERIOR_DUPLICADO','El superior ya tiene vínculos DBM');
   for(const r of links)assert(clean(r.DBM_APROV)==='2'&&!clean(r.DBM_USEROR),409,'CIRCUITO_CAMBIO','Vínculo aprobado o transferido previamente');
  }
  const items=target.tipo==='PC'?live.doc:links.map(r=>{const matches=live.doc.filter(d=>clean(d[prefix+'_ITEM'])===clean(r.DBM_ITEM));assert(matches.length===1,409,'DOCUMENTO_CAMBIO','Ítem DBM inexistente o duplicado');assert(sourceNumber(matches[0][prefix+'_TOTAL'],prefix+'_TOTAL').eq(sourceNumber(r.DBM_VALOR,'DBM_VALOR')),409,'DOCUMENTO_CAMBIO','Importe DBM distinto del documento');return matches[0];});
  assert(items.length>0&&new Set(items.map(r=>clean(r[prefix+'_ITEM']))).size===items.length,409,'DOCUMENTO_CAMBIO','Documento vacío o duplicado');
  for(const r of items){assert(clean(r[state])==='B'&&sourceNumber(r[prefix+'_QUJE'],prefix+'_QUJE').eq(0)&&!clean(r[prefix+'_RESIDUO'])&&!clean(r[prefix+'_ENCER']),409,'DOCUMENTO_CAMBIO','Ítem liberado, atendido o cerrado');}
  const total=items.reduce((n,r)=>n.plus(sourceNumber(r[prefix+'_TOTAL'],prefix+'_TOTAL')),new D(0));
  assert(total.gte(0)&&total.eq(sourceNumber(row.CR_TOTAL,'CR_TOTAL')),409,'IMPORTE_CAMBIO','El total pendiente no coincide');
  if(target.tipo==='PC'){
   const ip=live.scr.filter(r=>clean(r.CR_TIPO)==='IP');
   assert(ip.every(r=>['03','05'].includes(clean(r.CR_STATUS)))&&(!ip.length||ip.some(r=>clean(r.CR_STATUS)==='03'))&&ip.filter(r=>clean(r.CR_STATUS)==='03').every(r=>clean(r.CR_USERLIB)&&date(r.CR_DATALIB)),409,'IP_PENDIENTE','PC todavía depende de IP');
   assert(live.dbm.filter(r=>clean(r.DBM_TIPO)==='IP').every(r=>clean(r.DBM_APROV)==='1'),409,'IP_PENDIENTE','IP tiene vínculos pendientes');
  }
  const updates=[{alias:'SCR',before:row,changes:{CR_USER:next.usuario,CR_APROV:next.aprobador,CR_USERORI:clean(row.CR_USER),CR_APRORI:clean(row.CR_APROV),CR_TPTRAN:'3'}},...links.filter(()=>target.tipo!=='PC').map(r=>({alias:'DBM',before:r,changes:{DBM_USER:next.usuario,DBM_USEROR:clean(row.CR_USER)}}))];
  for(const u of updates)for(const [f,v] of Object.entries(u.changes))text(v,f,u.alias);
  const metadata={SCR:await schema(connection,'SCR'),...(target.tipo==='PC'?{}:{DBM:await schema(connection,'DBM')})};
  const identity={tabla:tableName('SCR'),filial:catalog.branch('SCR',target.sucursal),registro:target.registro,numero:target.numero,tipo:target.tipo,emision:clean(row.CR_EMISSAO),plazo:clean(row.CR_PRAZO)};
  return {target,identity,key:hash(identity),fingerprint:hash({target,live,SAK,SAL,metadata,updates}),live,updates,metadata,from:clean(row.CR_APROV),to:next.aprobador};
 }
 function verifyRows(alias,actual,expected){
  assert(actual.length===expected.length,409,'LECTURA_POSTERIOR_DIFIERE',alias);
  for(let i=0;i<expected.length;i++)for(const [field,value] of Object.entries(expected[i]))if(!['S_T_A_M_P_','I_N_S_D_T_'].includes(field))assert(clean(actual[i][field])===clean(value),409,'LECTURA_POSTERIOR_DIFIERE',`${alias}.${field}`);
 }
 return {enabled,branches:[...allowedBranches],async scan(branch,after='0'){
  assert(allowedBranches.includes(branch)&&/^\d+$/.test(after),400,'SUCURSAL_NO_AUTORIZADA','Sucursal inválida');
  requireFields('SCR',['CR_FILIAL','CR_NUM','CR_TIPO','CR_STATUS','CR_ESCALSP','CR_PRAZO','CR_APRORI','CR_USERORI','CR_TPTRAN','R_E_C_N_O_','D_E_L_E_T_']);
  const result=await db.query(`SELECT TOP (100) CONVERT(varchar(30),[R_E_C_N_O_]) AS record,[CR_NUM] AS number,[CR_TIPO] AS type FROM ${tableName('SCR')} WHERE [CR_FILIAL]=@branch AND [D_E_L_E_T_]=' ' AND [CR_STATUS]='02' AND [CR_ESCALSP]='T' AND [CR_APRORI]='' AND [CR_USERORI]='' AND [CR_TPTRAN]='' AND [CR_PRAZO]<>'' AND [CR_PRAZO]<@today AND [CR_TIPO] IN ('SC','IP','PC') AND [R_E_C_N_O_]>CONVERT(bigint,@after) ORDER BY [R_E_C_N_O_]`,{branch:catalog.branch('SCR',branch),today:await today(db),after});
  return result.map(r=>({sucursal:branch,registro:clean(r.record),numero:clean(r.number),tipo:clean(r.type)}));
 },prepare:target=>plan(db,target),async execute(proposal){
  assert(enabled,503,'ESCRITURA_DESHABILITADA','Escalamiento SQL deshabilitado');
  const connection=await getWriteDb();return connection.transaction(async tx=>{
   const current=await plan(tx,proposal.target,true);
   assert(current.fingerprint===proposal.fingerprint,409,'CONFLICTO_CONCURRENCIA','Cambió el plazo, configuración o documento');
   const expected=structuredClone(current.live);
   for(const u of current.updates){
    const fields=Object.keys(u.changes),allowed=u.alias==='SCR'?['CR_USER','CR_APROV','CR_USERORI','CR_APRORI','CR_TPTRAN']:['DBM_USER','DBM_USEROR'];
    assert(fields.every(f=>allowed.includes(f)),409,'CAMPO_NO_HABILITADO','Campo fuera del escalamiento');
    const params={record:clean(u.before.R_E_C_N_O_),branch:catalog.branch(u.alias,proposal.target.sucursal)};fields.forEach((f,i)=>params['v'+i]=u.changes[f]);
    const prefix=u.alias==='SCR'?'CR':'DBM';
    const result=await tx.query(`DECLARE @affected TABLE(id bigint); UPDATE ${tableName(u.alias)} SET ${fields.map((f,i)=>`${q(f)}=@v${i}`).join(',')} OUTPUT inserted.[R_E_C_N_O_] INTO @affected WHERE [R_E_C_N_O_]=CONVERT(bigint,@record) AND ${q(prefix+'_FILIAL')}=@branch AND [D_E_L_E_T_]=' '; SELECT COUNT(*) AS affected FROM @affected;`,params);
    assert(result.length===1&&Number(result[0].affected)===1,409,'FILAS_AFECTADAS_INVALIDAS','UPDATE de escalamiento incorrecto');
    Object.assign(expected[u.alias==='SCR'?'scr':'dbm'].find(r=>clean(r.R_E_C_N_O_)===params.record),u.changes);
   }
   const after=await snapshot(tx,proposal.target,true);verifyRows(proposal.target.tipo==='SC'?'SC1':'SC7',after.doc,expected.doc);verifyRows('SCR',after.scr,expected.scr);verifyRows('DBM',after.dbm,expected.dbm);
   return {identity:current.identity,from:current.from,to:current.to,affected:current.updates.length,approval:false};
  });
 }};
}

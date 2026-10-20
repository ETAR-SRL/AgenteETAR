import {createHash} from 'node:crypto';
import {assert} from '../errors.js';
import {identifier as q} from './config.js';
import {D,clean,sourceNumber,plain} from './write-policy.js';
export const approvalWorkflowActions=Object.freeze({continuarAprobacionCompra:'PC',escalarAprobacionCompra:'superior'});
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const name=t=>`${q(t.schema)}.${q(t.name)}`;
const numeric=new Set(['float','real','decimal','numeric','money','smallmoney','bigint','int','smallint','tinyint']);
const same=(a,b,col)=>a===null||b===null?a===b:numeric.has(col?.type)?sourceNumber(a,'comparación').toSignificantDigits(15).eq(new D(b).toSignificantDigits(15)):clean(a)===clean(b);
export function createApprovalWorkflow({db,catalog,getWriteDb,enabled,allowedBranches,selection,creationPlan,schema,defaults,text,fit,allocate}){
 async function read(connection,alias,branch,number,lock){
  const t=catalog.table(alias),p={SC1:'C1',SC7:'C7',SCR:'CR',DBM:'DBM'}[alias];
  const types=alias==='SCR'||alias==='DBM'?` AND ${q(p+'_TIPO')} IN ('SC','IP','PC')`:'';
  const limit=alias==='DBM'?25000:1000;
  const rows=await connection.query(`SELECT TOP (${limit+1}) ${selection(t)} FROM ${name(t)}${lock?' WITH (UPDLOCK,HOLDLOCK)':''} WHERE ${q(p+'_FILIAL')}=@branch AND ${q(p+'_NUM')}=@number AND [D_E_L_E_T_]=' '${types} ORDER BY [R_E_C_N_O_]`,{branch:catalog.branch(alias,branch),number});
  assert(rows.length<=limit,409,'CIRCUITO_EXCEDIDO','Circuito excede el límite de lectura completa');return rows;
 }
 async function snapshot(connection,input,lock){
  const {source,target}=input,alias=source.writePlan.alias,branch=target.sucursal,number=source.result.number;
  const doc=await read(connection,alias,branch,number,lock),allScr=await read(connection,'SCR',branch,number,lock),allDbm=await read(connection,'DBM',branch,number,lock);
  // SC1 and SC7 number spaces are independent.
  const types=alias==='SC1'?['SC']:['IP','PC'];
  return {doc,scr:allScr.filter(r=>types.includes(clean(r.CR_TIPO))),dbm:allDbm.filter(r=>types.includes(clean(r.DBM_TIPO)))};
 }
 function verifyDocument(input,current,live){
  const {source}=input,p=current.p,table=catalog.table(current.alias);
  assert(live.doc.length===source.result.records.length&&live.doc.length===current.rows.length,409,'DOCUMENTO_CAMBIO','Cambió la cantidad de ítems');
  for(let i=0;i<live.doc.length;i++){
   const row=live.doc[i];assert(clean(row.R_E_C_N_O_)===source.result.records[i],409,'DOCUMENTO_CAMBIO','Documento sustituido o renumerado');
   for(const [field,value] of Object.entries(current.rows[i]))if(!['R_E_C_N_O_',p+'_NUM',current.approval.field].includes(field))assert(same(row[field],value,table.columns.get(field)),409,'DOCUMENTO_CAMBIO',`Cambió ${field}; revisar el documento en Protheus`);
   assert(['B','L'].includes(clean(row[current.approval.field])),409,'DOCUMENTO_CAMBIO','Estado de documento incompatible');
   for(const f of [p+'_RESIDUO',p+'_ENCER',p+'_NUMSC',p+'_ITEMSC'])if(Object.hasOwn(row,f))assert(!clean(row[f]),409,'DOCUMENTO_CAMBIO','Documento con cierre, residuo o vínculo');
  }
 }
 const matches=(r,e)=>clean(r.CR_TIPO)===e.tipo&&clean(r.CR_GRUPO)===e.grupo&&clean(r.CR_ITGRP)===e.itemGrupo&&clean(r.CR_NIVEL)===e.nivel&&(clean(r.CR_APRORI)||clean(r.CR_APROV))===e.aprobador;
 function verifyStage(rows,entries){
  assert(rows.length===entries.length,409,'CIRCUITO_CAMBIO','Faltan o sobran pasos del circuito');
  for(const e of entries){
   const found=rows.filter(r=>matches(r,e));assert(found.length===1,409,'CIRCUITO_CAMBIO','Paso duplicado o distinto de la configuración');
   const r=found[0],users=[{aprobador:e.aprobador,usuario:e.usuario},...e.superiores];
   assert(users.some(u=>u.aprobador===clean(r.CR_APROV)&&u.usuario===clean(r.CR_USER))&&sourceNumber(r.CR_TOTAL,'CR_TOTAL').eq(e.total),409,'CIRCUITO_CAMBIO','Cambió el aprobador o el importe');
  }
 }
 function requireCompletedIp(live,entries){
  const ip=live.scr.filter(r=>clean(r.CR_TIPO)==='IP'),ipExpected=entries.filter(e=>e.tipo==='IP');
  verifyStage(ip,ipExpected);
  assert(ip.every(r=>['03','05'].includes(clean(r.CR_STATUS)))&&(!ip.length||ip.some(r=>clean(r.CR_STATUS)==='03'))&&ip.filter(r=>clean(r.CR_STATUS)==='03').every(r=>/^\d{8}$/.test(clean(r.CR_DATALIB))&&clean(r.CR_USERLIB)),409,'IP_PENDIENTE','IP todavía tiene aprobaciones pendientes, bloqueadas o rechazadas');
  const links=live.dbm.filter(r=>clean(r.DBM_TIPO)==='IP');
  const expectedLinks=ipExpected.flatMap(e=>e.items.map(i=>({e,i})));
  assert(links.length===expectedLinks.length,409,'CIRCUITO_CAMBIO','DBM incompleto para IP');
  for(const {e,i} of expectedLinks){const scr=ip.find(r=>matches(r,e));const found=links.filter(r=>clean(r.DBM_ITEM)===i.item&&clean(r.DBM_GRUPO)===e.grupo&&clean(r.DBM_ITGRP)===e.itemGrupo&&clean(r.DBM_USER)===clean(scr.CR_USER));assert(found.length===1&&clean(found[0].DBM_APROV)==='1'&&sourceNumber(found[0].DBM_VALOR,'DBM_VALOR').eq(i.total),409,'IP_PENDIENTE','Ítem IP sin aprobación verificada');}
 }
 async function plan(connection,action,input,lock=false){
  assert(Object.hasOwn(approvalWorkflowActions,action)&&plain(input.source)&&allowedBranches.includes(input.target?.sucursal),400,'CIRCUITO_OBJETIVO','Alta de origen y sucursal autorizada requeridas');
  const source=input.source;assert(['crearSolicitudCompra','crearPedidoCompra'].includes(source.action)&&source.input.target.sucursal===input.target.sucursal,400,'CIRCUITO_OBJETIVO','Origen de otra sucursal o tipo');
  const current=await creationPlan(connection,source.action,source.input,lock);
  assert(current.executionEnabled,409,'CIRCUITO_CAMBIO',current.blockers.map(b=>b.message).join(' '));
  assert(current.approval.circuit.type!=='SI',409,'CIRCUITO_OBJETIVO','La solicitud de importación se aprueba en MATA113; no usa el circuito SC de SCR/DBM.');
  const live=await snapshot(connection,input,lock);verifyDocument(input,current,live);
  for(const r of live.scr)assert(sourceNumber(r.CR_MOEDA,'CR_MOEDA').eq(current.rows[0][current.p+'_MOEDA'])&&sourceNumber(r.CR_TXMOEDA,'CR_TXMOEDA').eq(current.alias==='SC7'?current.rows[0].C7_TXMOEDA:'1'),409,'CIRCUITO_CAMBIO','Cambió la moneda o cotización del circuito');
  const circuit=current.approval.circuit,entries=[...circuit.entries,...(circuit.deferred||[])];
  const metadata={SCR:await schema(connection,'SCR'),DBM:await schema(connection,'DBM')};
  let inserts=[],updates=[],message='',already=false;
  if(action==='continuarAprobacionCompra'){
   assert(current.alias==='SC7'&&circuit.twoStage,409,'CIRCUITO_OBJETIVO','El pedido no usa IP+PC');
   const pc=live.scr.filter(r=>clean(r.CR_TIPO)==='PC'),pcExpected=entries.filter(e=>e.tipo==='PC');
   requireCompletedIp(live,entries);
   if(pc.length){verifyStage(pc,pcExpected);already=true;message='PC ya existe en Protheus; no se duplica ni reinicia.';}
   else if(!pcExpected.length){already=true;message='La configuración no requiere pasos PC; no se modifica el estado del documento.';}
   else{
    const previous=await connection.query(`SELECT TOP (1) [R_E_C_N_O_] FROM ${name(catalog.table('SCR'))}${lock?' WITH (UPDLOCK,HOLDLOCK)':''} WHERE [CR_FILIAL]=@branch AND [CR_NUM]=@number AND [CR_TIPO]=@type`,{branch:catalog.branch('SCR',input.target.sucursal),number:source.result.number,type:'PC'});
    assert(!previous.length,409,'CIRCUITO_EXISTENTE','PC tiene registros previos, incluso borrados; no se regenera');
    assert(live.doc.every(r=>clean(r.C7_CONAPRO)==='B'),409,'DOCUMENTO_CAMBIO','El pedido debe conservar B hasta completar PC');
    for(const e of pcExpected){
     const row={R_E_C_N_O_:'@asignar',R_E_C_D_E_L_:'0',D_E_L_E_T_:' ',CR_FILIAL:catalog.branch('SCR',input.target.sucursal),CR_NUM:source.result.number,CR_TIPO:'PC',CR_USER:e.usuario,CR_APROV:e.aprobador,CR_GRUPO:e.grupo,CR_ITGRP:e.itemGrupo,CR_NIVEL:e.nivel,CR_STATUS:e.estado,CR_EMISSAO:current.rows[0].C7_EMISSAO,CR_TOTAL:e.total,CR_MOEDA:current.rows[0].C7_MOEDA,CR_TXMOEDA:current.rows[0].C7_TXMOEDA};
     for(const [f,v] of Object.entries(row))if(!['R_E_C_N_O_','R_E_C_D_E_L_','D_E_L_E_T_'].includes(f))row[f]=catalog.dictionary.get(f)?.X3_TIPO==='N'?fit(v,f,catalog,'SCR'):text(v,f,'SCR',true);
     inserts.push({row,defaults:defaults(metadata.SCR,row)});
    }
    message='Generar PC pendiente después de IP aprobado. El pedido continúa en B.';
   }
  }else{
   const selected=live.scr.filter(r=>clean(r.R_E_C_N_O_)===input.target.registro);assert(selected.length===1,409,'CIRCUITO_OBJETIVO','RECNO SCR inexistente en este documento');
   const row=selected[0];assert(clean(row.CR_STATUS)==='02'&&!clean(row.CR_DATALIB)&&!clean(row.CR_USERLIB)&&sourceNumber(row.CR_VALLIB,'CR_VALLIB').eq(0),409,'APROBACION_NO_PENDIENTE','Sólo se transfiere una aprobación pendiente sin liberación');
   const candidates=entries.filter(e=>matches(row,e));assert(candidates.length===1,409,'CIRCUITO_CAMBIO','Aprobación ajena a la configuración actual');const e=candidates[0];verifyStage([row],[e]);
   const chain=[{aprobador:e.aprobador,usuario:e.usuario},...e.superiores],index=chain.findIndex(u=>u.aprobador===clean(row.CR_APROV)&&u.usuario===clean(row.CR_USER)),next=chain[index+1];assert(index>=0&&next,409,'SIN_SUPERIOR','No hay un superior siguiente configurado');
   assert(!live.scr.some(r=>r!==row&&clean(r.CR_TIPO)===e.tipo&&clean(r.CR_GRUPO)===e.grupo&&clean(r.CR_ITGRP)===e.itemGrupo&&clean(r.CR_USER)===next.usuario),409,'SUPERIOR_DUPLICADO','El superior ya tiene una aprobación en este grupo; no se fusionan pasos');
   assert(e.items.every(i=>live.doc.some(r=>clean(r[current.p+'_ITEM'])===i.item&&clean(r[current.approval.field])==='B')),409,'DOCUMENTO_CAMBIO','El paso no corresponde a ítems pendientes B');
   if(e.tipo==='PC'&&circuit.twoStage)requireCompletedIp(live,entries);
   updates.push({alias:'SCR',before:row,changes:{CR_USER:next.usuario,CR_APROV:next.aprobador,CR_USERORI:clean(row.CR_USERORI)||e.usuario,CR_APRORI:clean(row.CR_APRORI)||e.aprobador,CR_TPTRAN:'3'}});
   if(['SC','IP'].includes(e.tipo)){
    const links=live.dbm.filter(r=>clean(r.DBM_TIPO)===e.tipo&&clean(r.DBM_GRUPO)===e.grupo&&clean(r.DBM_ITGRP)===e.itemGrupo&&clean(r.DBM_USER)===clean(row.CR_USER));
    assert(links.length===e.items.length,409,'CIRCUITO_CAMBIO','DBM incompleto para transferir');
    for(const item of e.items){const found=links.filter(r=>clean(r.DBM_ITEM)===item.item);assert(found.length===1&&clean(found[0].DBM_APROV)==='2'&&sourceNumber(found[0].DBM_VALOR,'DBM_VALOR').eq(item.total),409,'CIRCUITO_CAMBIO','DBM no está pendiente o cambió su importe');}
    for(const r of links)updates.push({alias:'DBM',before:r,changes:{DBM_USER:next.usuario,DBM_USEROR:clean(r.DBM_USEROR)||e.usuario}});
   }
   for(const u of updates)for(const [field,value] of Object.entries(u.changes))text(value,field,u.alias);
   message=`Transferir pendiente al superior ${next.aprobador} (${next.usuario}); conserva nivel, importe y estado 02.`;
  }
  const payload={version:1,action,source:source.result.number,current:current.snapshotHash,live,metadata,inserts,updates};
  const previewEntries=inserts.length?entries.filter(e=>e.tipo==='PC'):updates.filter(u=>u.alias==='SCR').map(u=>({...entries.find(e=>matches(u.before,e)),usuario:u.changes.CR_USER,aprobador:u.changes.CR_APROV,estado:clean(u.before.CR_STATUS)}));
  const approvalView={...current.approval,label:message,circuit:{...circuit,entries:previewEntries,deferred:[],stages:action==='continuarAprobacionCompra'?[{tipo:'IP',estado:'Aprobación verificada',pasos:live.scr.filter(r=>clean(r.CR_TIPO)==='IP').length},{tipo:'PC',estado:already?'Ya existe o no aplica':'Se generará pendiente',pasos:entries.filter(e=>e.tipo==='PC').length}]:[]}};
  const diffs=[{field:'Circuito de aprobación',before:null,after:message},...updates.flatMap(u=>Object.entries(u.changes).map(([field,after])=>({table:u.alias,record:clean(u.before.R_E_C_N_O_),field,before:clean(u.before[field]),after})))];
  return {kind:'approval-workflow',operation:'workflow',resource:'aprobacionesCompras',snapshotHash:hash(payload),snapshot:payload,sourcePlan:current,live,inserts,updates,already,executionEnabled:enabled,identity:{numero:source.result.number,sucursal:input.target.sucursal,accion:action},diff:diffs,items:[],approval:approvalView,blockers:[],warnings:[{code:'CIRCUITO_SQL',message:'Operación SQL de circuito pendiente. No aprueba documentos ni consume saldos de aprobadores.'}]};
 }
 function compareRows(alias,actual,expected){
  assert(actual.length===expected.length,409,'LECTURA_POSTERIOR_DIFIERE','Cantidad de registros del circuito');
  const t=catalog.table(alias);
  for(let i=0;i<expected.length;i++)for(const [f,v] of Object.entries(expected[i])){
   if(['S_T_A_M_P_','I_N_S_D_T_'].includes(f)||v?.generatedTime)continue;
   assert(same(actual[i][f],v,t.columns.get(f)),409,'LECTURA_POSTERIOR_DIFIERE',f);
  }
 }
 async function verify(connection,proposal,lock){const p=await plan(connection,proposal.action,proposal.input,lock);assert(p.snapshotHash===proposal.writePlan.snapshotHash,409,'CONFLICTO_CONCURRENCIA','Cambió el documento, circuito o configuración; preparar otra propuesta');return p;}
 return {prepare:(action,input)=>plan(db,action,input),check:async proposal=>({executionEnabled:(await verify(db,proposal,false)).executionEnabled}),async execute(proposal){
  assert(enabled,503,'ESCRITURA_DESHABILITADA','Escritura deshabilitada');const connection=await getWriteDb();return connection.transaction(async tx=>{
   const p=await verify(tx,proposal,true),expected=structuredClone(p.live),records=[];
   if(p.inserts.length){
    const ids=await allocate(tx,catalog.table('SCR'),p.inserts.length);
    for(let i=0;i<p.inserts.length;i++){
     const row={...p.inserts[i].row,R_E_C_N_O_:ids[i]},fields=Object.keys(row),params=Object.fromEntries(fields.map((f,j)=>['v'+j,row[f]]));
     const values=fields.map((f,j)=>f==='R_E_C_N_O_'||f==='R_E_C_D_E_L_'?`CONVERT(bigint,@v${j})`:catalog.dictionary.get(f)?.X3_TIPO==='N'?`CONVERT(decimal(38,12),@v${j})`:`@v${j}`);
     const output=await tx.query(`DECLARE @inserted TABLE(id bigint); INSERT INTO ${name(catalog.table('SCR'))} (${fields.map(q).join(',')}) OUTPUT inserted.[R_E_C_N_O_] INTO @inserted VALUES (${values.join(',')}); SELECT CONVERT(varchar(30),id) AS record FROM @inserted;`,params);
     assert(output.length===1&&output[0].record===ids[i],409,'FILAS_AFECTADAS_INVALIDAS','INSERT SCR incorrecto');expected.scr.push({...p.inserts[i].defaults,...row});records.push({tabla:'SCR',registro:ids[i]});
    }
   }
   const allowed={SCR:['CR_USER','CR_APROV','CR_USERORI','CR_APRORI','CR_TPTRAN'],DBM:['DBM_USER','DBM_USEROR']};
   for(const u of p.updates){
    const fields=Object.keys(u.changes);assert(fields.every(f=>allowed[u.alias].includes(f)),409,'CAMPO_NO_HABILITADO','Campo ajeno a transferencia');
    const params={record:clean(u.before.R_E_C_N_O_),branch:catalog.branch(u.alias,proposal.target.sucursal)},prefix=u.alias==='SCR'?'CR':'DBM';fields.forEach((f,i)=>params['v'+i]=u.changes[f]);
    const output=await tx.query(`DECLARE @affected TABLE(id bigint); UPDATE ${name(catalog.table(u.alias))} SET ${fields.map((f,i)=>`${q(f)}=@v${i}`).join(',')} OUTPUT inserted.[R_E_C_N_O_] INTO @affected WHERE [R_E_C_N_O_]=CONVERT(bigint,@record) AND ${q(prefix+'_FILIAL')}=@branch AND [D_E_L_E_T_]=' '; SELECT COUNT(*) AS affected FROM @affected;`,params);
    assert(output.length===1&&output[0].affected===1,409,'FILAS_AFECTADAS_INVALIDAS','UPDATE circuito incorrecto');const list=u.alias==='SCR'?expected.scr:expected.dbm;Object.assign(list.find(r=>clean(r.R_E_C_N_O_)===params.record),u.changes);records.push({tabla:u.alias,registro:params.record});
   }
   const after=await snapshot(tx,proposal.input,true);compareRows(p.sourcePlan.alias,after.doc,expected.doc);compareRows('SCR',after.scr,expected.scr);compareRows('DBM',after.dbm,expected.dbm);
   const rechecked=await creationPlan(tx,proposal.input.source.action,proposal.input.source.input,true);assert(rechecked.snapshotHash===p.sourcePlan.snapshotHash,409,'CONFLICTO_CONCURRENCIA','Cambió la configuración durante la operación');
   return {operation:'workflow',affected:p.inserts.length+p.updates.length,alreadyApplied:p.already,fields:{numero:p.identity.numero,accion:proposal.action,resultado:p.diff[0].after},workflowRecords:records,warnings:p.warnings,nativeValidation:false};
  });
 }};
}

import {approvalWorkflowActions} from './approval-workflow.js';
import {createHash} from 'node:crypto';
import {assert} from '../errors.js';
import {identifier as q} from './config.js';
import {writeProfiles,calculateUpdate,clean,sourceNumber,numericSpec,sqlExecutionPolicy} from './write-policy.js';
import {releaseProfile,salesBalanceContext,planSalesBalance} from './sales-balance.js';
import {purchaseCreationStatus,purchaseCreationActions,createPurchasing} from './purchase-creation.js';

export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const qualified=t=>`${q(t.schema)}.${q(t.name)}`;
const numericTypes=['decimal','numeric','money','smallmoney','int','bigint','smallint','tinyint','float','real'];
export function selection(table){
 return [...table.columns].sort(([a],[b])=>a.localeCompare(b)).map(([field,col])=>{
  const type=col.type.toLowerCase();let expr=q(field);
  if(numericTypes.includes(type))expr=`CONVERT(varchar(100),${expr}${['float','real'].includes(type)?',3':['money','smallmoney'].includes(type)?',2':''})`;
  else if(['datetime','datetime2','smalldatetime','date','datetimeoffset','time'].includes(type))expr=`CONVERT(varchar(100),${expr},126)`;
  else if(['binary','varbinary','timestamp','rowversion','image'].includes(type))expr=`CONVERT(varchar(max),${expr},2)`;
  return `${expr} AS ${q(field)}`;
 }).join(',');
}
export function updateStatement(table,profile,updates,catalog){
 const allowed=new Set([profile.price,profile.quantity,profile.total,profile.thousands,profile.priceThousands,...(profile.alias==='SC6'?['C6_PRUNIT']:[])].filter(Boolean));
 const fields=Object.keys(updates);assert(fields.length&&fields.every(f=>allowed.has(f)),400,'CAMPO_NO_HABILITADO','UPDATE fuera de la lista permitida');
 const parameters={};const setters=fields.map((f,i)=>{const {scale,width}=numericSpec(f,catalog,profile.alias);parameters['v'+i]=updates[f];return `${q(f)}=CONVERT(decimal(${width},${scale}),@v${i})`;});
 // OUTPUT INTO admite los triggers STAMP existentes; no modifica otras tablas de negocio.
 return {parameters,text:`DECLARE @affected TABLE (id bigint); UPDATE ${qualified(table)} SET ${setters.join(',')} OUTPUT inserted.[R_E_C_N_O_] INTO @affected WHERE ${q(profile.branch)}=@branch AND [R_E_C_N_O_]=CONVERT(bigint,@record) AND [D_E_L_E_T_]=' '; SELECT COUNT(*) AS affected FROM @affected;`};
}
export function createWriter({db,catalog,getWriteDb,enabled=false,allowedBranches=['0101'],triggerHashes={}}){
 const purchasing=createPurchasing({db,catalog,getWriteDb,enabled,allowedBranches,triggerHashes,selection});
 function profileFor(action,target){
  const p=writeProfiles[action];assert(p,400,'ACCION_NO_HABILITADA','No hay UPDATE para esta acción');
  assert(target&&typeof target.sucursal==='string'&&allowedBranches.includes(target.sucursal)&&typeof target.registro==='string'&&/^[1-9]\d{0,18}$/.test(target.registro)&&BigInt(target.registro)<=9223372036854775807n,400,'CLAVE_INVALIDA','Sucursal autorizada y registro existente requeridos');
  const table=catalog.table(p.alias);for(const f of ['R_E_C_N_O_','D_E_L_E_T_',p.branch,p.product,p.price,...p.keys,...(p.quantity?[p.quantity,p.total,p.unit]:[])])assert(table.columns.has(f),409,'ESQUEMA_INCOMPATIBLE',`Falta ${f}`);
  return p;
 }
 async function rows(connection,alias,fields,branch,lock,collection=false){
  const table=catalog.table(alias),clauses=[],params={branch:catalog.branch(alias,branch)};
  for(const [field,value] of Object.entries(fields)){assert(table.columns.has(field),409,'ESQUEMA_INCOMPATIBLE',`Falta ${field}`);const key='k'+clauses.length;params[key]=value;clauses.push(field==='R_E_C_N_O_'?`${q(field)}=CONVERT(bigint,@${key})`:`${q(field)}=@${key}`);}
  const branchField=alias==='DA1'?'DA1_FILIAL':alias==='AIB'?'AIB_FILIAL':({SB1:'B1_FILIAL',SC1:'C1_FILIAL',SC5:'C5_FILIAL',SC6:'C6_FILIAL',SC7:'C7_FILIAL',SC9:'C9_FILIAL',SD1:'D1_FILIAL',SD2:'D2_FILIAL'})[alias];
  assert(branchField&&table.columns.has(branchField)&&table.columns.has('D_E_L_E_T_'),409,'ESQUEMA_INCOMPATIBLE',alias);
  const result=await connection.query(`SELECT TOP (${collection?501:2}) ${selection(table)} FROM ${qualified(table)}${lock?' WITH (UPDLOCK,HOLDLOCK)':''} WHERE ${q(branchField)}=@branch AND [D_E_L_E_T_]=' ' AND ${clauses.join(' AND ')} ORDER BY [R_E_C_N_O_]`,params);
  if(collection){
   assert(result.length<=500,409,'DEPENDENCIAS_EXCEDIDAS','El ítem supera 500 dependencias; no se acepta una lectura truncada');
   assert(result.every(r=>/^[1-9]\d*$/.test(clean(r.R_E_C_N_O_)))&&new Set(result.map(r=>clean(r.R_E_C_N_O_))).size===result.length,409,'DEPENDENCIAS_NO_UNICAS','No se identifican todas las dependencias por RECNO');
  }
  return result;
 }
 async function salesParameters(connection,branch,lock){
  const table=catalog.table('SX6');for(const f of ['X6_FIL','X6_VAR','X6_CONTEUD','D_E_L_E_T_'])assert(table.columns.has(f),409,'ESQUEMA_INCOMPATIBLE',`Falta ${f}`);
  // SX6 uses X6_FIL, with the logical branch overriding the company-wide blank value.
  const result=await connection.query(`SELECT TOP (5) [X6_FIL],[X6_VAR],[X6_CONTEUD] FROM ${qualified(table)}${lock?' WITH (UPDLOCK,HOLDLOCK)':''} WHERE [D_E_L_E_T_]=' ' AND [X6_FIL] IN (@branch,' ') AND [X6_VAR] IN ('MV_ALTPREC','MV_BLOQUEI') ORDER BY [X6_VAR],[X6_FIL]`,{branch});
  assert(result.length<=4,409,'PARAMETRO_AMBIGUO','Parámetros SX6 duplicados');const values={};
  for(const name of ['MV_ALTPREC','MV_BLOQUEI']){
   const matches=result.filter(r=>clean(r.X6_VAR)===name),specific=matches.filter(r=>clean(r.X6_FIL)===branch),global=matches.filter(r=>!clean(r.X6_FIL));
   assert(specific.length<=1&&global.length<=1,409,'PARAMETRO_AMBIGUO',name);values[name]=clean((specific[0]||global[0])?.X6_CONTEUD).toUpperCase();
  }
  return values;
 }
 async function triggers(connection,p){
  const table=catalog.table(p.alias);const result=await connection.query('SELECT name,OBJECT_DEFINITION(object_id) AS definition FROM sys.triggers WHERE parent_id=OBJECT_ID(@tableName) AND is_disabled=0',{tableName:`${table.schema}.${table.name}`});
  for(const trigger of result)assert(typeof trigger.definition==='string'&&triggerHashes[trigger.name]===createHash('sha256').update(trigger.definition).digest('hex'),409,'TRIGGER_NO_VERIFICADO','Un trigger de la tabla no coincide con la definición verificada');
  return result.map(r=>({name:r.name,hash:triggerHashes[r.name]})).sort((a,b)=>a.name.localeCompare(b.name));
 }
 async function context(connection,action,target,lock=false){
  const p=profileFor(action,target),activeTriggers=await triggers(connection,p);
  const records=await rows(connection,p.alias,{R_E_C_N_O_:target.registro},target.sucursal,lock);
  assert(records.length===1,409,'REGISTRO_NO_UNICO','Debe existir exactamente un registro activo; no se crean registros');
  const row=records[0];const products=await rows(connection,'SB1',{B1_COD:clean(row[p.product])},target.sucursal,lock);
  assert(products.length===1,409,'PRODUCTO_NO_UNICO','El producto no se identifica de forma única');
  const product=products[0];let header=null,balance=null,parameters={},releases=[],documents=[],releaseTriggers=[];
  if(p.alias==='SC6'){
   const headers=await rows(connection,'SC5',{C5_NUM:clean(row.C6_NUM)},target.sucursal,lock);assert(headers.length===1,409,'CABECERA_NO_UNICA','No se encontró una única cabecera SC5');header=headers[0];
   for(const f of ['C5_NOTA','C5_LIBEROK','C5_BLQ','C5_CONAPRO'])assert(Object.hasOwn(header,f),409,'ESTADO_NO_VERIFICABLE',`Falta ${f}`);
   for(const f of ['C5_BLQ','C5_CONAPRO'])assert(!clean(header[f]),409,'PEDIDO_CON_DEPENDENCIAS',`${f} requiere Protheus`);
   for(const [f,v] of Object.entries(header))if(/^C5_(?:DESC\d|DESCFI|DESCONT|PDESCAB|ACRSFIN|FRETE|FRETAUT|SEGURO|DESPESA)$/.test(f))assert(sourceNumber(v,f).eq(0),409,'PEDIDO_CON_DESCUENTOS','La cabecera contiene descuentos');
   releases=await rows(connection,'SC9',{C9_PEDIDO:clean(row.C6_NUM),C9_ITEM:clean(row.C6_ITEM)},target.sucursal,lock,true);
   documents=await rows(connection,'SD2',{D2_PEDIDO:clean(row.C6_NUM),D2_ITEMPV:clean(row.C6_ITEM)},target.sucursal,lock,true);
   balance=salesBalanceContext(row,header,releases,documents,catalog);
   if(balance.advanced){parameters=await salesParameters(connection,target.sucursal,lock);if(balance.pending.length)releaseTriggers=await triggers(connection,releaseProfile);}
   else for(const f of ['C5_NOTA','C5_LIBEROK'])assert(!clean(header[f]),409,'PEDIDO_CON_DEPENDENCIAS',`${f} requiere Protheus`);
  }
  if(p.alias==='SC1'){
   assert((await rows(connection,'SC7',{C7_NUMSC:clean(row.C1_NUM),C7_ITEMSC:clean(row.C1_ITEM)},target.sucursal,lock)).length===0,409,'SOLICITUD_CON_PEDIDO','Hay un pedido de compra vinculado a esta solicitud');
  }
  if(p.alias==='SC7'){
   assert(sourceNumber(row.C7_QUJE,'C7_QUJE').eq(0),409,'COMPRA_ATENDIDA_REQUIERE_PROTHEUS','Pedido de compra atendido: MATA121 restringe precio/valor y cantidad incluso con MV_ALTEPEDC habilitado. No se sobrescribe por SQL ni se altera SD1.');
   assert((await rows(connection,'SD1',{D1_PEDIDO:clean(row.C7_NUM),D1_ITEMPC:clean(row.C7_ITEM),D1_FORNECE:clean(row.C7_FORNECE),D1_LOJA:clean(row.C7_LOJA)},target.sucursal,lock)).length===0,409,'PEDIDO_DOCUMENTADO','Existen entradas SD1 vinculadas');
  }
  const identity=Object.fromEntries([...p.keys,...['DA1_MOEDA','DA1_DATVIG','DA1_QTDLOT','DA1_TIPPRE','AIB_MOEDA','C6_CLI','C6_LOJA','C7_MOEDA'].filter(k=>Object.hasOwn(row,k))].map(k=>[k,clean(row[k])]));
  identity.productoDescripcion=clean(product.B1_DESC);identity.unidadMedida=clean(product.B1_UM);
  if(header)for(const k of ['C5_CLIENTE','C5_LOJACLI','C5_TABELA','C5_MOEDA'])if(Object.hasOwn(header,k))identity[k]=clean(header[k]);
  return {p,row,product,header,activeTriggers,identity,balance,parameters,releases,documents,releaseTriggers,scope:{table:qualified(catalog.table(p.alias)),branch:catalog.branch(p.alias,target.sucursal),...(p.alias==='SC6'?{releaseTable:qualified(catalog.table('SC9')),releaseBranch:catalog.branch('SC9',target.sucursal)}:{})}};
 }
 function snapshot(c){return {policyVersion:3,row:c.row,product:c.product,header:c.header,triggers:c.activeTriggers,scope:c.scope,releases:c.releases,documents:c.documents,parameters:c.parameters,releaseTriggers:c.releaseTriggers};}
 function calculate(action,input,c){return planSalesBalance(calculateUpdate(action,input,c.row,c.product,catalog,{salesBalance:c.balance?.advanced}),c,catalog);}
 function verifyAfter(before,after,updates,p){
  for(const [field,value] of Object.entries(updates))assert(sourceNumber(after[field],field).toFixed(numericSpec(field,catalog,p.alias).scale)===value,409,'LECTURA_POSTERIOR_DIFIERE',`No se guardó el valor esperado de ${field}`);
  for(const field of Object.keys(before))if(!Object.hasOwn(updates,field)&&field!=='S_T_A_M_P_')assert(JSON.stringify(after[field])===JSON.stringify(before[field]),409,'EFECTO_NO_PREVISTO',`Cambió un campo no solicitado: ${field}`);
 }
 return {
  enabled,escalation:purchasing.escalation,policy:{...sqlExecutionPolicy,existingRecordsOnly:false},creation:purchaseCreationStatus(catalog,enabled),
  async prepare(action,input){
   if(Object.hasOwn(approvalWorkflowActions,action))return purchasing.workflow.prepare(action,input);
   if(Object.hasOwn(purchaseCreationActions,action))return purchasing.prepare(action,input);
   const c=await context(db,action,input.target),plan=calculate(action,input,c);
   return {version:3,resource:c.p.resource,identity:c.identity,snapshot:snapshot(c),snapshotHash:fingerprint(snapshot(c)),...plan,executionEnabled:enabled&&!plan.blockers.length};
  },
  async check(proposal){
   if(Object.hasOwn(approvalWorkflowActions,proposal.action))return purchasing.workflow.check(proposal);
   if(Object.hasOwn(purchaseCreationActions,proposal.action))return purchasing.check(proposal);
   const c=await context(db,proposal.action,proposal.target);assert(fingerprint(snapshot(c))===proposal.writePlan.snapshotHash,409,'CONFLICTO_CONCURRENCIA','El registro o sus dependencias cambiaron desde la propuesta');return {executionEnabled:enabled&&!calculate(proposal.action,proposal.input,c).blockers.length};
  },
  async execute(proposal){
   if(Object.hasOwn(approvalWorkflowActions,proposal.action))return purchasing.workflow.execute(proposal);
   if(Object.hasOwn(purchaseCreationActions,proposal.action))return purchasing.execute(proposal);
   assert(enabled,503,'ESCRITURA_DESHABILITADA','La ejecución SQL está deshabilitada');
   const connection=await getWriteDb();
   return connection.transaction(async tx=>{
    const c=await context(tx,proposal.action,proposal.target,true);
    assert(fingerprint(snapshot(c))===proposal.writePlan.snapshotHash,409,'CONFLICTO_CONCURRENCIA','El registro, unidad, cabecera o triggers cambiaron desde la propuesta');
    const calculated=calculate(proposal.action,proposal.input,c);
    assert(!calculated.blockers.length,409,calculated.blockers[0]?.code||'CIRCUITO_PROTHEUS_REQUERIDO',calculated.blockers[0]?.message||'Requiere Protheus');
    assert(fingerprint([calculated.updates,calculated.relatedUpdates])===fingerprint([proposal.writePlan.updates,proposal.writePlan.relatedUpdates]),409,'PROPUESTA_CAMBIO','La validación actual no coincide con el cambio confirmado');
    const statement=updateStatement(catalog.table(c.p.alias),c.p,calculated.updates,catalog);
    const result=await tx.query(statement.text,{...statement.parameters,branch:c.scope.branch,record:proposal.target.registro});
    assert(result.length===1&&Number(result[0].affected)===1,409,'FILAS_AFECTADAS_INVALIDAS','El UPDATE debe afectar exactamente una fila');
    for(const update of calculated.relatedUpdates){
     const statement=updateStatement(catalog.table('SC9'),releaseProfile,update.updates,catalog);
     const result=await tx.query(statement.text,{...statement.parameters,branch:c.scope.releaseBranch,record:update.record});
     assert(result.length===1&&Number(result[0].affected)===1,409,'FILAS_AFECTADAS_INVALIDAS','Cada UPDATE SC9 debe afectar exactamente una liberación pendiente');
    }
    const [after]=await rows(tx,c.p.alias,{R_E_C_N_O_:proposal.target.registro},proposal.target.sucursal,true);
    assert(after,409,'REGISTRO_DESAPARECIDO','No se pudo releer el registro');verifyAfter(c.row,after,calculated.updates,c.p);
    // Re-read whole dependency sets: never confirm a write that also changed a document,
    // an approval, a delivered release or another quantity through an unexpected effect.
    const final=await context(tx,proposal.action,proposal.target,true);
    verifyAfter(c.row,final.row,calculated.updates,c.p);
    assert(fingerprint(final.activeTriggers)===fingerprint(c.activeTriggers)&&fingerprint(final.releaseTriggers)===fingerprint(c.releaseTriggers),409,'TRIGGER_NO_VERIFICADO','Cambió el conjunto de triggers durante la ejecución');
    assert(fingerprint(final.documents)===fingerprint(c.documents),409,'HISTORICO_MODIFICADO','Cambió un documento emitido');
    assert(fingerprint(final.header)===fingerprint(c.header)&&fingerprint(final.product)===fingerprint(c.product)&&fingerprint(final.parameters)===fingerprint(c.parameters),409,'EFECTO_NO_PREVISTO','Cambió una dependencia no solicitada');
    assert(final.releases.length===c.releases.length,409,'EFECTO_NO_PREVISTO','Cambió el conjunto de liberaciones');
    for(const before of c.releases){const current=final.releases.find(r=>clean(r.R_E_C_N_O_)===clean(before.R_E_C_N_O_));assert(current,409,'EFECTO_NO_PREVISTO','Desapareció una liberación');const update=calculated.relatedUpdates.find(u=>u.record===clean(before.R_E_C_N_O_));if(update)verifyAfter(before,current,update.updates,releaseProfile);else assert(fingerprint(before)===fingerprint(current),409,'HISTORICO_MODIFICADO','Cambió una liberación que debía conservarse');}
    return {affected:1+calculated.relatedUpdates.length,identity:c.identity,fields:Object.fromEntries(Object.keys(calculated.updates).map(f=>[f,after[f]])),relatedUpdates:calculated.relatedUpdates,afterHash:fingerprint(snapshot(final)),calculation:calculated.calculation,warnings:calculated.warnings,nativeCreditRevalidation:false};
   });
  }
 };
}

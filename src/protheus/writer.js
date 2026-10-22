import {approvalWorkflowActions} from './approval-workflow.js';
import {createHash} from 'node:crypto';
import {assert} from '../errors.js';
import {identifier as q} from './config.js';
import {writeProfiles,calculateUpdate,clean,sourceNumber,numericSpec,sqlExecutionPolicy,isLogistics,logisticsFields,textSpec,logisticsValue,guardOrder} from './write-policy.js';
import {logisticsMapping,logisticsMetadata,logisticsPlan,documentKeys} from './logistics-update.js';
import {validateSalesListLogistics} from './sales-list-logistics.js';
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
 const allowed=new Set([profile.price,profile.quantity,profile.total,profile.thousands,profile.priceThousands,...(profile.alias==='SC6'?['C6_PRUNIT']:[]),...Object.values(logisticsFields).flatMap(m=>Object.values(m).filter(([a])=>a===profile.alias).map(([,f])=>f))].filter(Boolean));
 const fields=Object.keys(updates);assert(fields.length&&fields.every(f=>allowed.has(f)),400,'CAMPO_NO_HABILITADO','UPDATE fuera de la lista permitida');
 const parameters={};const setters=fields.map((f,i)=>{parameters['v'+i]=updates[f];if(catalog.dictionary.get(f)?.X3_TIPO!=='N'){textSpec(f,catalog,profile.alias,catalog.dictionary.get(f)?.X3_TIPO==='D');return `${q(f)}=@v${i}`;}const {scale,width}=numericSpec(f,catalog,profile.alias);return `${q(f)}=CONVERT(decimal(${width},${scale}),@v${i})`;});
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
  const branchField=alias==='DA0'?'DA0_FILIAL':alias==='DA1'?'DA1_FILIAL':alias==='AIB'?'AIB_FILIAL':({SB1:'B1_FILIAL',NNR:'NNR_FILIAL',SE4:'E4_FILIAL',SC1:'C1_FILIAL',SC5:'C5_FILIAL',SC6:'C6_FILIAL',SC7:'C7_FILIAL',SC9:'C9_FILIAL',SD1:'D1_FILIAL',SD2:'D2_FILIAL'})[alias];
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
 async function context(connection,action,target,lock=false,input=null,preservedReferences=[]){
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
   assert(Number(row.C1_TIPO)!==2&&(!Object.hasOwn(row,'C1_MOEDA')||[0,1].includes(Number(row.C1_MOEDA))),409,'SOLICITUD_IMPORTACION','Esta acción modifica estimaciones de SC comunes. No altera C1_PRECO de una solicitud de importación.');
   assert((await rows(connection,'SC7',{C7_NUMSC:clean(row.C1_NUM),C7_ITEMSC:clean(row.C1_ITEM)},target.sucursal,lock)).length===0,409,'SOLICITUD_CON_PEDIDO','Hay un pedido de compra vinculado a esta solicitud');
  }
  if(p.alias==='SC7'){
   assert(sourceNumber(row.C7_QUJE,'C7_QUJE').eq(0),409,'COMPRA_ATENDIDA_REQUIERE_PROTHEUS','Pedido de compra atendido: MATA121 restringe precio/valor y cantidad incluso con MV_ALTEPEDC habilitado. No se sobrescribe por SQL ni se altera SD1.');
   assert((await rows(connection,'SD1',{D1_PEDIDO:clean(row.C7_NUM),D1_ITEMPC:clean(row.C7_ITEM),D1_FORNECE:clean(row.C7_FORNECE),D1_LOJA:clean(row.C7_LOJA)},target.sucursal,lock)).length===0,409,'PEDIDO_DOCUMENTADO','Existen entradas SD1 vinculadas');
  }
  const identity=Object.fromEntries([...p.keys,...['DA1_MOEDA','DA1_DATVIG','DA1_QTDLOT','DA1_TIPPRE','AIB_MOEDA','C6_CLI','C6_LOJA','C7_MOEDA'].filter(k=>Object.hasOwn(row,k))].map(k=>[k,clean(row[k])]));
  identity.productoDescripcion=clean(product.B1_DESC);identity.unidadMedida=clean(product.B1_UM);
  if(header)for(const k of ['C5_CLIENTE','C5_LOJACLI','C5_TABELA','C5_MOEDA'])if(Object.hasOwn(header,k))identity[k]=clean(header[k]);
  const c={p,row,product,header,activeTriggers,identity,balance,parameters,releases,documents,releaseTriggers,scope:{table:qualified(catalog.table(p.alias)),branch:catalog.branch(p.alias,target.sucursal),...(p.alias==='SC6'?{releaseTable:qualified(catalog.table('SC9')),releaseBranch:catalog.branch('SC9',target.sucursal)}:{})}};
  if(input&&isLogistics(input))await logisticsContext(connection,c,action,target,input,lock,preservedReferences);
  return c;
 }
 async function logisticsContext(connection,c,action,target,input,lock,preservedReferences){
  const mapping=logisticsMapping(c.p.alias,input.changes);assert(mapping.length,400,'CAMPO_NO_HABILITADO','Logística no disponible para esta acción');
  const metadataMapping=[...mapping];
  if(Object.keys(input.changes).some(k=>c.p.fields.includes(k)))for(const field of [c.p.price,c.p.quantity,c.p.total,c.p.thousands,...(c.p.alias==='SC6'?['C6_PRUNIT']:[])].filter(f=>f&&catalog.table(c.p.alias).columns.has(f)))metadataMapping.push({key:'numeric',alias:c.p.alias,field});
  for(const [key,[alias,field]] of Object.entries(logisticsFields[c.p.alias]).filter(([k])=>k.startsWith('fecha')))if(!metadataMapping.some(m=>m.field===field))metadataMapping.push({key,alias,field});
  c.logisticsMetadata=await logisticsMetadata(connection,catalog,metadataMapping,lock);c.references=[];c.documentContexts=[];c.headerTriggers=[];
  if(mapping.some(m=>documentKeys.has(m.key))){
   const prefix={SC1:'C1',SC6:'C6',SC7:'C7'}[c.p.alias],numberField=prefix+'_NUM';
   const items=await rows(connection,c.p.alias,{[numberField]:clean(c.row[numberField])},target.sucursal,lock,true);
   assert(items.length&&items.some(r=>clean(r.R_E_C_N_O_)===target.registro),409,'DOCUMENTO_NO_VERIFICABLE','No se identificó el documento completo');
   for(const item of items){
    if(clean(item.R_E_C_N_O_)===target.registro)continue;
    const sibling=await context(connection,action,{...target,registro:clean(item.R_E_C_N_O_)},lock);c.documentContexts.push(sibling);
    for(const field of c.p.alias==='SC7'?['C7_FORNECE','C7_LOJA','C7_MOEDA','C7_COND','C7_EMISSAO']:c.p.alias==='SC1'?['C1_EMISSAO']:['C6_CLI','C6_LOJA'])assert(clean(sibling.row[field])===clean(c.row[field]),409,'DOCUMENTO_INCONSISTENTE',`${field}: cabecera repetida inconsistente`);
   }
   if(mapping.some(m=>m.alias==='SC5')){c.headerTriggers=await triggers(connection,{alias:'SC5'});c.scope.headerTable=qualified(catalog.table('SC5'));c.scope.headerBranch=catalog.branch('SC5',target.sucursal);}
  }
  for(const x of [c,...c.documentContexts]){
   assert(!x.balance?.advanced&&!x.releases.length&&!x.documents.length,409,'LOGISTICA_CON_DEPENDENCIAS','La logística exige ítems sin liberación, atención ni documentos.');guardOrder(x.p,x.row);
  }
  for(const m of mapping){
   if(m.key==='deposito'){
    const prefix={SC1:'C1',SC6:'C6',SC7:'C7'}[c.p.alias];
    for(const suffix of ['LOTECTL','NUMLOTE','LOCALIZ','NUMSERI','REGWMS','IDDCF','ORDSEP','CARGA','ROMEMB','IDENTB6']){const field=prefix+'_'+suffix;if(Object.hasOwn(c.row,field))assert(!clean(c.row[field]),409,'DEPOSITO_CON_DEPENDENCIAS',`${field}: ítem vinculado a lote, ubicación o circuito logístico Protheus.`);}
    const value=logisticsValue(m.value,m.field,catalog,m.alias),refs=await rows(connection,'NNR',{NNR_CODIGO:value},target.sucursal,lock);assert(refs.length===1,409,'DEPOSITO_NO_UNICO','Depósito NNR activo inexistente o ambiguo');
    if(Object.hasOwn(refs[0],'NNR_MSBLQL'))assert(['','2'].includes(clean(refs[0].NNR_MSBLQL)),409,'DEPOSITO_BLOQUEADO','El depósito está bloqueado');
    for(const field of ['NNR_CODCLI','NNR_LOJCLI','NNR_CTRAB'])if(Object.hasOwn(refs[0],field))assert(!clean(refs[0][field]),409,'DEPOSITO_CON_DEPENDENCIAS',`${field}: depósito con vínculos especiales`);
    if(Object.hasOwn(refs[0],'NNR_TIPO'))assert(['','1'].includes(clean(refs[0].NNR_TIPO)),409,'DEPOSITO_CON_DEPENDENCIAS','Depósito de terceros o propio requiere circuito Protheus');
    if(Object.hasOwn(refs[0],'NNR_VDADMS'))assert(sourceNumber(refs[0].NNR_VDADMS,'NNR_VDADMS').eq(0),409,'DEPOSITO_CON_DEPENDENCIAS','Depósito administrado WMS requiere Protheus');
    if(Object.hasOwn(refs[0],'NNR_AMZUNI'))assert(['','2'].includes(clean(refs[0].NNR_AMZUNI)),409,'DEPOSITO_CON_DEPENDENCIAS','Almacenamiento especial requiere Protheus');
    c.references.push({alias:'NNR',branch:catalog.branch('NNR',target.sucursal),table:qualified(catalog.table('NNR')),row:refs[0]});
   }
   if(m.key==='condicionPago'){
    const newValue=logisticsValue(m.value,m.field,catalog,m.alias),oldValue=clean((m.alias==='SC5'?c.header:c.row)[m.field]);
    for(const value of new Set([oldValue,newValue,...preservedReferences.filter(r=>r.alias==='SE4').map(r=>clean(r.row.E4_CODIGO))])){
    assert(value,409,'CONDICION_PAGO_ORIGEN_NO_VERIFICABLE','Se requiere verificar la condición de pago actual.');
    const refs=await rows(connection,'SE4',{E4_CODIGO:value},target.sucursal,lock);assert(refs.length===1,409,'CONDICION_PAGO_NO_UNICA','Condición SE4 actual o nueva inexistente o ambigua');
    const ref=refs[0];if(Object.hasOwn(ref,'E4_MSBLQL'))assert(['','2'].includes(clean(ref.E4_MSBLQL)),409,'CONDICION_PAGO_BLOQUEADA','Condición de pago bloqueada');
    for(const [field,value] of Object.entries(ref))if(/^E4_(?:ACRSFIN|ACRESC|JUROS|DESCFIN|DESCONT|MULTA|ENTRADA|ANTECIP|FINANC)/.test(field))assert(!clean(value)||/^0+(?:\.0+)?$/.test(clean(value)),409,'CONDICION_FINANCIERA_NO_SOPORTADA',`${field}: requiere recalcular condiciones financieras en Protheus`);
    for(const field of ['E4_DIADESC','E4_PERCOM','E4_SUPER','E4_INFER','E4_FATOR'])if(Object.hasOwn(ref,field))assert(!clean(ref[field])||sourceNumber(ref[field],field).eq(0),409,'CONDICION_FINANCIERA_NO_SOPORTADA',`${field}: condición financiera no neutra`);
    for(const field of ['E4_PLANO','E4_JURCART','E4_TIPOPG','E4_CCORREN','E4_FMPAGEX','E4_TPAY'])if(Object.hasOwn(ref,field))assert(!clean(ref[field]),409,'CONDICION_FINANCIERA_NO_SOPORTADA',`${field}: requiere circuito financiero Protheus`);
    if(Object.hasOwn(ref,'E4_TIPO'))assert(clean(ref.E4_TIPO)==='1',409,'CONDICION_FINANCIERA_NO_SOPORTADA','Sólo condición de pago normal tipo 1');
    if(Object.hasOwn(ref,'E4_ADFIN'))assert(['','2'].includes(clean(ref.E4_ADFIN)),409,'CONDICION_FINANCIERA_NO_SOPORTADA','Adelanto financiero requiere Protheus');
    c.references.push({alias:'SE4',branch:catalog.branch('SE4',target.sucursal),table:qualified(catalog.table('SE4')),row:ref});
    }
   }
  }
  if(mapping.some(m=>m.alias==='SC5'))await validateSalesListLogistics(connection,catalog,rows,c,input,lock);
  c.references.sort((a,b)=>(a.alias+clean(a.row?.E4_CODIGO||a.row?.NNR_CODIGO||a.producto)).localeCompare(b.alias+clean(b.row?.E4_CODIGO||b.row?.NNR_CODIGO||b.producto)));
 }
 function snapshot(c){return {policyVersion:4,row:c.row,product:c.product,header:c.header,triggers:c.activeTriggers,scope:c.scope,releases:c.releases,documents:c.documents,parameters:c.parameters,releaseTriggers:c.releaseTriggers,...(c.logisticsMetadata?{logisticsMetadata:c.logisticsMetadata,references:c.references,headerTriggers:c.headerTriggers,documentContexts:c.documentContexts.map(snapshot)}:{})};}
 function calculate(action,input,c){
  if(input.expectedQuantity!==undefined){
   assert(c.p.quantity,400,'PRECONDICION_INVALIDA','Esta acción no modifica cantidades.');
   const scale=numericSpec(c.p.quantity,catalog,c.p.alias).scale;
   assert(sourceNumber(c.row[c.p.quantity],'cantidad actual').toDecimalPlaces(scale).eq(sourceNumber(input.expectedQuantity,'cantidad esperada').toDecimalPlaces(scale)),409,'CONFLICTO_CONCURRENCIA','La cantidad cambió durante la preparación; volvé a revisar.');
  }
  if(input.expectedPrice!==undefined||input.expectedIdentity!==undefined){
   assert(input.expectedPrice!==undefined&&input.expectedIdentity,400,'PRECONDICION_INVALIDA','Falta precio o identidad esperada.');
   const scale=numericSpec(c.p.price,catalog,c.p.alias).scale;
   assert(sourceNumber(c.row[c.p.price],c.p.price).toDecimalPlaces(scale).eq(sourceNumber(input.expectedPrice,'precio esperado').toDecimalPlaces(scale)),409,'CONFLICTO_CONCURRENCIA','El precio cambió durante la preparación; volvé a solicitar el ajuste.');
   const expected=input.expectedIdentity;
   if(c.p.quantity){
    const prefix={SC6:'C6',SC7:'C7',SC1:'C1'}[c.p.alias];
    const currency=c.p.alias==='SC6'?c.header.C5_MOEDA:c.p.alias==='SC7'?c.row.C7_MOEDA:'1';
    if(c.p.alias==='SC6')assert(clean(c.header.C5_CLIENTE)===expected.cliente&&clean(c.header.C5_LOJACLI)===expected.tienda,409,'CONFLICTO_CONCURRENCIA','El cliente del pedido cambió durante la preparación.');
    assert(clean(c.row[c.p.product])===expected.producto&&clean(c.row[prefix+'_NUM'])===expected.numero&&clean(c.row[prefix+'_ITEM'])===expected.item&&sourceNumber(currency,'moneda').eq(sourceNumber(expected.moneda,'moneda esperada'))&&(c.p.alias!=='SC7'||clean(c.row.C7_FORNECE)===expected.proveedor&&clean(c.row.C7_LOJA)===expected.tienda),409,'CONFLICTO_CONCURRENCIA','El documento, ítem, producto o moneda cambió durante la preparación.');
   }else assert(clean(c.row[c.p.product])===expected.producto&&clean(c.row[c.p.alias+'_CODTAB'])===expected.lista&&sourceNumber(c.row[c.p.alias+'_MOEDA'],'moneda').eq(sourceNumber(expected.moneda,'moneda esperada'))&&(c.p.alias!=='AIB'||clean(c.row.AIB_CODFOR)===expected.proveedor&&clean(c.row.AIB_LOJFOR)===expected.tienda),409,'CONFLICTO_CONCURRENCIA','La identidad o moneda del precio cambió durante la preparación.');
  }
  const mapping=isLogistics(input)?logisticsMapping(c.p.alias,input.changes):[];
  if(mapping.length){
   assert(Object.keys(input.changes).every(k=>c.p.fields.includes(k)||mapping.some(m=>m.key===k)),400,'CAMPO_NO_HABILITADO','Campos fuera del alcance');
   const numericChanges=Object.fromEntries(Object.entries(input.changes).filter(([k])=>c.p.fields.includes(k)));
   let numeric={updates:{},diff:[],calculation:{}};
   if(Object.keys(numericChanges).length)try{numeric=calculateUpdate(action,{...input,changes:numericChanges},c.row,c.product,catalog);}catch(error){if(error.code!=='SIN_CAMBIOS')throw error;}
   const logistical=logisticsPlan(mapping,input,c,catalog);const updates={...numeric.updates,...logistical.updates};
   assert(Object.keys(updates).length||logistical.relatedUpdates.length,400,'SIN_CAMBIOS','No hay diferencias para actualizar');
   return {...logistical,updates,diff:[...numeric.diff,...logistical.diff],calculation:{...numeric.calculation,...logistical.calculation},blockers:[],warnings:[{code:'LOGISTICA_SQL',message:'UPDATE SQL controlado; no ejecuta validadores ADVPL ni recalcula crédito, precios, impuestos o condiciones financieras.'}]};
  }
  return planSalesBalance(calculateUpdate(action,input,c.row,c.product,catalog,{salesBalance:c.balance?.advanced}),c,catalog);}
 function verifyAfter(before,after,updates,p){
  for(const [field,value] of Object.entries(updates))assert(catalog.dictionary.get(field)?.X3_TIPO==='N'?sourceNumber(after[field],field).toFixed(numericSpec(field,catalog,p.alias).scale)===value:clean(after[field])===value,409,'LECTURA_POSTERIOR_DIFIERE',`No se guardó el valor esperado de ${field}`);
  for(const field of Object.keys(before))if(!Object.hasOwn(updates,field)&&field!=='S_T_A_M_P_')assert(JSON.stringify(after[field])===JSON.stringify(before[field]),409,'EFECTO_NO_PREVISTO',`Cambió un campo no solicitado: ${field}`);
 }
 return {
  enabled,escalation:purchasing.escalation,policy:{...sqlExecutionPolicy,existingRecordsOnly:false},creation:purchaseCreationStatus(catalog,enabled),
  async prepare(action,input){
   if(Object.hasOwn(approvalWorkflowActions,action))return purchasing.workflow.prepare(action,input);
   if(Object.hasOwn(purchaseCreationActions,action))return purchasing.prepare(action,input);
   const c=await context(db,action,input.target,false,input),plan=calculate(action,input,c);
   return {version:3,resource:c.p.resource,identity:c.identity,snapshot:snapshot(c),snapshotHash:fingerprint(snapshot(c)),...plan,executionEnabled:enabled&&!plan.blockers.length};
  },
  async check(proposal){
   if(Object.hasOwn(approvalWorkflowActions,proposal.action))return purchasing.workflow.check(proposal);
   if(Object.hasOwn(purchaseCreationActions,proposal.action))return purchasing.check(proposal);
   const c=await context(db,proposal.action,proposal.target,false,proposal.input);assert(fingerprint(snapshot(c))===proposal.writePlan.snapshotHash,409,'CONFLICTO_CONCURRENCIA','El registro o sus dependencias cambiaron desde la propuesta');return {executionEnabled:enabled&&!calculate(proposal.action,proposal.input,c).blockers.length};
  },
  async execute(proposal){
   if(Object.hasOwn(approvalWorkflowActions,proposal.action))return purchasing.workflow.execute(proposal);
   if(Object.hasOwn(purchaseCreationActions,proposal.action))return purchasing.execute(proposal);
   assert(enabled,503,'ESCRITURA_DESHABILITADA','La ejecución SQL está deshabilitada');
   const connection=await getWriteDb();
   return connection.transaction(async tx=>{
    const c=await context(tx,proposal.action,proposal.target,true,proposal.input);
    assert(fingerprint(snapshot(c))===proposal.writePlan.snapshotHash,409,'CONFLICTO_CONCURRENCIA','El registro, unidad, cabecera o triggers cambiaron desde la propuesta');
    const calculated=calculate(proposal.action,proposal.input,c);
    assert(!calculated.blockers.length,409,calculated.blockers[0]?.code||'CIRCUITO_PROTHEUS_REQUERIDO',calculated.blockers[0]?.message||'Requiere Protheus');
    assert(fingerprint([calculated.updates,calculated.relatedUpdates])===fingerprint([proposal.writePlan.updates,proposal.writePlan.relatedUpdates]),409,'PROPUESTA_CAMBIO','La validación actual no coincide con el cambio confirmado');
    if(Object.keys(calculated.updates).length){
     const statement=updateStatement(catalog.table(c.p.alias),c.p,calculated.updates,catalog);
     const result=await tx.query(statement.text,{...statement.parameters,branch:c.scope.branch,record:proposal.target.registro});
     assert(result.length===1&&Number(result[0].affected)===1,409,'FILAS_AFECTADAS_INVALIDAS','El UPDATE debe afectar exactamente una fila');
    }
    for(const update of calculated.relatedUpdates){
     const alias=update.alias||'SC9',profile=alias==='SC9'?releaseProfile:alias==='SC5'?{alias,branch:'C5_FILIAL'}:c.p;
     const statement=updateStatement(catalog.table(alias),profile,update.updates,catalog);
     const result=await tx.query(statement.text,{...statement.parameters,branch:update.branch||c.scope.releaseBranch,record:update.record});
     assert(result.length===1&&Number(result[0].affected)===1,409,'FILAS_AFECTADAS_INVALIDAS','Cada UPDATE relacionado debe afectar exactamente una fila');
    }
    const [after]=await rows(tx,c.p.alias,{R_E_C_N_O_:proposal.target.registro},proposal.target.sucursal,true);
    assert(after,409,'REGISTRO_DESAPARECIDO','No se pudo releer el registro');verifyAfter(c.row,after,calculated.updates,c.p);
    // Re-read whole dependency sets: never confirm a write that also changed a document,
    // an approval, a delivered release or another quantity through an unexpected effect.
    const final=await context(tx,proposal.action,proposal.target,true,proposal.input,c.references||[]);
    verifyAfter(c.row,final.row,calculated.updates,c.p);
    assert(fingerprint(final.activeTriggers)===fingerprint(c.activeTriggers)&&fingerprint(final.releaseTriggers)===fingerprint(c.releaseTriggers),409,'TRIGGER_NO_VERIFICADO','Cambió el conjunto de triggers durante la ejecución');
    assert(fingerprint(final.documents)===fingerprint(c.documents),409,'HISTORICO_MODIFICADO','Cambió un documento emitido');
    const headerUpdate=calculated.relatedUpdates.find(u=>u.alias==='SC5');
    if(headerUpdate)verifyAfter(c.header,final.header,headerUpdate.updates,{alias:'SC5'});else assert(fingerprint(final.header)===fingerprint(c.header),409,'EFECTO_NO_PREVISTO','Cambió la cabecera no solicitada');
    assert(fingerprint(final.product)===fingerprint(c.product)&&fingerprint(final.parameters)===fingerprint(c.parameters),409,'EFECTO_NO_PREVISTO','Cambió una dependencia no solicitada');
    if(c.logisticsMetadata){
     assert(fingerprint([final.logisticsMetadata,final.references,final.headerTriggers])===fingerprint([c.logisticsMetadata,c.references,c.headerTriggers]),409,'EFECTO_NO_PREVISTO','Cambió el catálogo, SX3 o los triggers de cabecera');
     assert(final.documentContexts.length===c.documentContexts.length,409,'EFECTO_NO_PREVISTO','Cambió el conjunto de ítems del documento');
     for(const before of c.documentContexts){
      const after=final.documentContexts.find(x=>clean(x.row.R_E_C_N_O_)===clean(before.row.R_E_C_N_O_));assert(after,409,'EFECTO_NO_PREVISTO','Desapareció un ítem del documento');
      const update=calculated.relatedUpdates.find(u=>u.alias===before.p.alias&&u.record===clean(before.row.R_E_C_N_O_));verifyAfter(before.row,after.row,update?.updates||{},before.p);
      if(headerUpdate)verifyAfter(before.header,after.header,headerUpdate.updates,{alias:'SC5'});else assert(fingerprint(before.header)===fingerprint(after.header),409,'EFECTO_NO_PREVISTO','Cambió una cabecera');
      for(const key of ['product','activeTriggers','scope','releases','documents','parameters','releaseTriggers'])assert(fingerprint(before[key])===fingerprint(after[key]),409,'EFECTO_NO_PREVISTO',`Cambió dependencia de otro ítem: ${key}`);
     }
    }
    assert(final.releases.length===c.releases.length,409,'EFECTO_NO_PREVISTO','Cambió el conjunto de liberaciones');
    for(const before of c.releases){const current=final.releases.find(r=>clean(r.R_E_C_N_O_)===clean(before.R_E_C_N_O_));assert(current,409,'EFECTO_NO_PREVISTO','Desapareció una liberación');const update=calculated.relatedUpdates.find(u=>u.record===clean(before.R_E_C_N_O_));if(update)verifyAfter(before,current,update.updates,releaseProfile);else assert(fingerprint(before)===fingerprint(current),409,'HISTORICO_MODIFICADO','Cambió una liberación que debía conservarse');}
    return {affected:(Object.keys(calculated.updates).length?1:0)+calculated.relatedUpdates.length,identity:c.identity,fields:Object.fromEntries(Object.keys(calculated.updates).map(f=>[f,after[f]])),relatedUpdates:calculated.relatedUpdates,afterHash:fingerprint(snapshot(final)),calculation:calculated.calculation,warnings:calculated.warnings,nativeCreditRevalidation:false};
   });
  }
 };
}

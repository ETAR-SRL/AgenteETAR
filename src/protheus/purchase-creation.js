import {createHash} from 'node:crypto';
import {assert} from '../errors.js';
import {identifier as q} from './config.js';
import {D,clean,plain,inputNumber,sourceNumber,fit} from './write-policy.js';
import {purchaseApproval} from './purchase-approval.js';
export const purchaseCreationActions=Object.freeze({crearSolicitudCompra:'SC1',crearPedidoCompra:'SC7'});
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const name=t=>`${q(t.schema)}.${q(t.name)}`;
const warnings=[
 {code:'ALTA_SQL',message:'Alta directa SQL, sin rutinas ADVPL: estado inicial según configuración verificada de Protheus. Genera SCR y, para alçadas por ítem, DBM pendientes en la misma transacción; no ejecuta aprobaciones, recepción ni vínculo con otra solicitud.'},
 {code:'NUMERACION_SQL',message:'RECNO y número se asignan al confirmar bajo bloqueo exclusivo SQL, incluyendo registros borrados. No sincroniza números reservados en memoria de DBAccess/AppServer. Si esta alta detecta una colisión, falla y revierte sin reintentar; otro proceso con números previamente reservados también podría recibir un error de duplicado.'}
];
export function purchaseCreationStatus(catalog,enabled=false){
 return Object.fromEntries(Object.entries(purchaseCreationActions).map(([action,alias])=>{
  const recno=catalog.tables?.get(alias)?.columns.get('R_E_C_N_O_');
  return [action,{alias,executionEnabled:enabled&&recno?.identity===false,recnoIdentity:recno?.identity??null,allocation:'MAX(R_E_C_N_O_)+1; MAX(número numérico)+1; TABLOCKX/HOLDLOCK',approval:'SX6/SY1 y grupos/perfiles; circuito pendiente SCR/DBM en la transacción del alta',warnings,blockers:recno?.identity===false?[]:[{code:'RECNO_INCOMPATIBLE',message:'Se requiere RECNO sin IDENTITY verificado.'}]}];
 }));
}
export async function allocatePurchaseNumbers(tx,table,numberField,width,count){
 assert(Number.isInteger(width)&&width>0&&width<=12&&Number.isInteger(count)&&count>0&&count<=50,400,'NUMERACION_INVALIDA','Longitud o cantidad de ítems inválida');
 // No WHERE: physical-table scope includes every branch and logically deleted row.
 const [row]=await tx.query(`SELECT CONVERT(varchar(30),COALESCE(MAX([R_E_C_N_O_]),0)) AS maxRecno,CONVERT(varchar(30),COALESCE(MAX(CASE WHEN LTRIM(RTRIM(${q(numberField)})) NOT LIKE '%[^0-9]%' THEN TRY_CONVERT(bigint,${q(numberField)}) END),0)) AS maxNumber FROM ${name(table)} WITH (TABLOCKX,HOLDLOCK)`);
 assert(row&&/^\d+$/.test(row.maxRecno)&&/^\d+$/.test(row.maxNumber),409,'NUMERACION_NO_VERIFICABLE','No se pudieron leer los máximos');
 const first=BigInt(row.maxRecno)+1n,number=BigInt(row.maxNumber)+1n;
 assert(first+BigInt(count)-1n<=9223372036854775807n,409,'RECNO_AGOTADO','Se agotó bigint para RECNO');
 assert(number.toString().length<=width,409,'NUMERO_AGOTADO','Se agotó la numeración; no se reinicia ni reutiliza');
 return {number:number.toString().padStart(width,'0'),records:Array.from({length:count},(_,i)=>(first+BigInt(i)).toString())};
}
export async function allocateCircuitRecords(tx,table,count){
 assert(Number.isInteger(count)&&count>0&&count<=25000,409,'CIRCUITO_EXCEDIDO','Cantidad de registros de circuito inválida');
 const [row]=await tx.query(`SELECT CONVERT(varchar(30),COALESCE(MAX([R_E_C_N_O_]),0)) AS maxRecno FROM ${name(table)} WITH (TABLOCKX,HOLDLOCK)`);
 assert(row&&/^\d+$/.test(row.maxRecno),409,'NUMERACION_NO_VERIFICABLE','Máximo RECNO de circuito inválido');
 const first=BigInt(row.maxRecno)+1n;assert(first+BigInt(count)-1n<=9223372036854775807n,409,'RECNO_AGOTADO','Se agotó RECNO del circuito');
 return Array.from({length:count},(_,i)=>(first+BigInt(i)).toString());
}
export function createPurchasing({db,catalog,getWriteDb,enabled,allowedBranches,triggerHashes,selection}){
 function text(value,field,alias,optional=false){
  const sx=catalog.dictionary.get(field),col=catalog.table(alias).columns.get(field);
  assert(sx&&col&&['C','D'].includes(sx.X3_TIPO),409,'CAMPO_NO_DISPONIBLE',field);
  assert(typeof value==='string'&&value.length<=Number(sx.X3_TAMANHO)&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value)&&(optional||value.trim()),400,'TEXTO_INVALIDO',`Revisar ${field}`);return value.trim();
 }
 function date(value,field,alias){
  assert(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=1900,400,'FECHA_INVALIDA',field);
  const parsed=new Date(value+'T00:00:00Z');assert(Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value,400,'FECHA_INVALIDA',field);return text(value.replaceAll('-',''),field,alias);
 }
 async function lookup(connection,alias,keys,branch,lock){
  const table=catalog.table(alias),bf=({SB1:'B1_FILIAL',SA2:'A2_FILIAL',SE4:'E4_FILIAL',NNR:'NNR_FILIAL',CTT:'CTT_FILIAL'})[alias];
  assert(bf&&table.columns.has(bf)&&table.columns.has('D_E_L_E_T_'),409,'ESQUEMA_INCOMPATIBLE',alias);
  const params={branch:catalog.branch(alias,branch)},where=[];
  for(const [field,value] of Object.entries(keys)){assert(table.columns.has(field),409,'ESQUEMA_INCOMPATIBLE',field);const param='k'+where.length;params[param]=value;where.push(`${q(field)}=@${param}`);}
  const rows=await connection.query(`SELECT TOP (2) ${selection(table)} FROM ${name(table)}${lock?' WITH (UPDLOCK,HOLDLOCK)':''} WHERE ${q(bf)}=@branch AND [D_E_L_E_T_]=' ' AND ${where.join(' AND ')}`,params);
  assert(rows.length===1,409,'REFERENCIA_NO_UNICA',`${alias}: referencia activa inexistente o ambigua`);return rows[0];
 }
 async function schema(connection,alias){
  const table=catalog.table(alias),params={tableName:`${table.schema}.${table.name}`};
  const columns=await connection.query(`SELECT c.name field,ty.name type,c.max_length width,c.is_nullable nullable,c.is_identity identityColumn,c.is_computed computed,OBJECT_DEFINITION(c.default_object_id) definition FROM sys.columns c JOIN sys.types ty ON c.user_type_id=ty.user_type_id WHERE c.object_id=OBJECT_ID(@tableName) ORDER BY c.column_id`,params);
  const recno=columns.find(c=>c.field==='R_E_C_N_O_');assert(recno&&!recno.identityColumn&&recno.type==='bigint',409,'RECNO_INCOMPATIBLE','Se requiere RECNO bigint sin IDENTITY');
  const unique=await connection.query(`SELECT i.name FROM sys.indexes i JOIN sys.index_columns ic ON i.object_id=ic.object_id AND i.index_id=ic.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=OBJECT_ID(@tableName) AND i.is_unique=1 AND i.is_disabled=0 AND i.has_filter=0 AND ic.key_ordinal=1 AND c.name='R_E_C_N_O_' AND NOT EXISTS (SELECT 1 FROM sys.index_columns x WHERE x.object_id=i.object_id AND x.index_id=i.index_id AND x.key_ordinal>1)`,params);
  assert(unique.length,409,'RECNO_SIN_UNICIDAD','Falta índice único habilitado de RECNO');
  const triggers=await connection.query('SELECT name,OBJECT_DEFINITION(object_id) AS definition FROM sys.triggers WHERE parent_id=OBJECT_ID(@tableName) AND is_disabled=0',params);
  for(const t of triggers)assert(typeof t.definition==='string'&&triggerHashes[t.name]===createHash('sha256').update(t.definition).digest('hex'),409,'TRIGGER_NO_VERIFICADO','Trigger de alta no verificado');
  const dictionary=await connection.query(`SELECT X3_CAMPO,X3_TIPO,X3_TAMANHO,X3_DECIMAL,X3_OBRIGAT FROM ${name(catalog.table('SX3'))} WHERE X3_ARQUIVO=@alias AND D_E_L_E_T_=' ' ORDER BY X3_CAMPO`,{alias});
  for(const sx of dictionary){const cached=catalog.dictionary.get(clean(sx.X3_CAMPO));assert(cached&&['X3_TIPO','X3_TAMANHO','X3_DECIMAL'].every(k=>clean(cached[k])===clean(sx[k])),409,'DICCIONARIO_CAMBIO','Recargar el servicio tras un cambio SX3');}
  return {columns,unique,triggers,dictionary};
 }
 function defaults(metadata,row){
  const expected={};
  for(const c of metadata.columns){
   if(Object.hasOwn(row,c.field))continue;
   assert(!c.identityColumn&&!c.computed,409,'COLUMNA_AUTOMATICA_NO_SOPORTADA',c.field);
   const d=c.definition;
   if(d==null&&c.nullable){expected[c.field]=null;continue;}
   if(/^\(\(?0\)?\)$/.test(d||'')){expected[c.field]='0';continue;}
   const literal=/^\('([ F]*)'\)$/.exec(d||'');if(literal){expected[c.field]=literal[1];continue;}
   if(/^\(getutcdate\(\)\)$/i.test(d||'')&&['datetime','datetime2'].includes(c.type)){expected[c.field]={generatedTime:true};continue;}
   assert(false,409,'DEFAULT_NO_VERIFICADO',`Valor inicial no verificado: ${c.field}`);
  }
  for(const sx of metadata.dictionary)if(clean(sx.X3_OBRIGAT)==='1')assert(Object.hasOwn(row,clean(sx.X3_CAMPO))&&clean(row[clean(sx.X3_CAMPO)]),409,'CAMPO_OBLIGATORIO',`Falta ${clean(sx.X3_CAMPO)}`);
  return expected;
 }
 async function plan(connection,action,input,lock=false){
  const alias=purchaseCreationActions[action];assert(alias,400,'ACCION_NO_HABILITADA','Alta inválida');
  assert(plain(input)&&Object.keys(input).every(k=>['action','target','header','items'].includes(k))&&plain(input.target)&&Object.keys(input.target).every(k=>k==='sucursal')&&allowedBranches.includes(input.target.sucursal),400,'CLAVE_INVALIDA','Sólo sucursal autorizada; RECNO y número son automáticos');
  const branch=input.target.sucursal,p=alias==='SC1'?'C1':'C7',h=input.header;
  assert(plain(h)&&Object.keys(h).every(k=>['fechaEmision','solicitante','proveedor','tienda','condicionPago','contacto','moneda','comprador','solicitanteCodigo'].includes(k)),400,'CABECERA_INVALIDA','Cabecera inválida');
  assert(h.moneda==='1',400,'MONEDA_NO_SOPORTADA','Altas en moneda local 1, cotización 1');
  assert(Array.isArray(input.items)&&input.items.length>0&&input.items.length<=50,400,'ITEMS_INVALIDOS','Indicar de 1 a 50 ítems');
  const metadata=await schema(connection,alias),refs=[],rows=[],initials=[],summary=[],approvalItems=[];
  const emission=date(h.fechaEmision,p+'_EMISSAO',alias),filial=catalog.branch(alias,branch);let vendor,payment;
  if(alias==='SC7'){
   vendor=await lookup(connection,'SA2',{A2_COD:text(h.proveedor,'C7_FORNECE',alias),A2_LOJA:text(h.tienda,'C7_LOJA',alias)},branch,lock);
   assert(Object.hasOwn(vendor,'A2_MSBLQL'),409,'ESTADO_NO_VERIFICABLE','Falta estado de bloqueo SA2');
   assert(['','2'].includes(clean(vendor.A2_MSBLQL)),409,'PROVEEDOR_BLOQUEADO','Proveedor bloqueado');
   payment=await lookup(connection,'SE4',{E4_CODIGO:text(h.condicionPago,'C7_COND',alias)},branch,lock);refs.push(vendor,payment);
  }else assert(!h.proveedor&&!h.tienda&&!h.condicionPago&&!h.contacto&&!h.comprador,400,'CABECERA_INVALIDA','SC1 no admite datos de pedido de compra');
  for(let i=0;i<input.items.length;i++){
   const item=input.items[i];assert(plain(item)&&Object.keys(item).every(k=>['producto','deposito','fechaNecesidad','cantidad','precio','baseCantidad','basePrecio','centroCosto','observacion'].includes(k)),400,'ITEM_INVALIDO','Campos de ítem fuera del alcance');
   const product=await lookup(connection,'SB1',{B1_COD:text(item.producto,p+'_PRODUTO',alias)},branch,lock);refs.push(product);
   for(const field of ['B1_DESC','B1_UM','B1_MSBLQL','B1_GRADE','B1_SEGUM','B1_CONV','B1_TIPCONV','B1_CC'])assert(Object.hasOwn(product,field),409,'ESTADO_NO_VERIFICABLE',`Falta ${field}`);
   assert(['','2'].includes(clean(product.B1_MSBLQL)),409,'PRODUCTO_BLOQUEADO','Producto bloqueado');
   assert(['','N'].includes(clean(product.B1_GRADE)),409,'GRADE_NO_SOPORTADA','Producto con grilla requiere otro circuito');
   const unit=text(clean(product.B1_UM),p+'_UM',alias),second=clean(product.B1_SEGUM);
   assert(['unidades','millares'].includes(item.baseCantidad)&&['unidad','millar'].includes(item.basePrecio),400,'BASE_REQUERIDA','Indicar bases de cantidad y precio');
   assert(unit==='UN'||(item.baseCantidad==='unidades'&&item.basePrecio==='unidad'),400,'MILLARES_NO_APLICAN','Millares sólo para UN');
   const qty=inputNumber(item.cantidad,'cantidad').mul(item.baseCantidad==='millares'?1000:1),price=inputNumber(item.precio,'precio').div(item.basePrecio==='millar'?1000:1);
   const quantity=fit(qty,p+'_QUANT',catalog,alias),unitPrice=fit(price,alias==='SC1'?'C1_VUNIT':'C7_PRECO',catalog,alias),total=fit(qty.mul(price),p+'_TOTAL',catalog,alias,{round:true});
   const warehouse=text(item.deposito,p+'_LOCAL',alias);refs.push(await lookup(connection,'NNR',{NNR_CODIGO:warehouse},branch,lock));
   const due=date(item.fechaNecesidad,p+'_DATPRF',alias);assert(due>=emission,400,'FECHA_INVALIDA','Necesidad anterior a emisión');
   const cost=text(item.centroCosto??clean(product.B1_CC),p+'_CC',alias,true);if(cost)refs.push(await lookup(connection,'CTT',{CTT_CUSTO:cost},branch,lock));
   const itemWidth=Number(catalog.dictionary.get(p+'_ITEM')?.X3_TAMANHO);assert(Number.isInteger(itemWidth)&&itemWidth>0&&itemWidth<=6,409,'ESQUEMA_INCOMPATIBLE','Longitud de ítem');
   const row={R_E_C_N_O_:'@asignar',D_E_L_E_T_:' ',R_E_C_D_E_L_:'0',[p+'_FILIAL']:filial,[p+'_NUM']:'@asignar',[p+'_ITEM']:text(String(i+1).padStart(itemWidth,'0'),p+'_ITEM',alias),[p+'_PRODUTO']:clean(product.B1_COD),[p+'_DESCRI']:text(clean(product.B1_DESC),p+'_DESCRI',alias),[p+'_UM']:unit,[p+'_LOCAL']:warehouse,[p+'_EMISSAO']:emission,[p+'_DATPRF']:due,[p+'_QUANT']:quantity,[alias==='SC1'?'C1_VUNIT':'C7_PRECO']:unitPrice,[p+'_TOTAL']:total,[p+'_QUJE']:'0',[p+'_MOEDA']:'1',[p+'_TIPO']:'1',[p+'_FILENT']:filial,[p+'_CC']:cost,[p+'_OBS']:text(item.observacion??'',p+'_OBS',alias,true)};
   if(second){const factor=sourceNumber(product.B1_CONV,'B1_CONV'),method=clean(product.B1_TIPCONV);assert(factor.gt(0)&&['M','D'].includes(method),409,'CONVERSION_NO_VERIFICABLE','Revisar factor SB1');row[p+'_SEGUM']=text(second,p+'_SEGUM',alias);row[p+'_QTSEGUM']=fit(method==='M'?qty.mul(factor):qty.div(factor),p+'_QTSEGUM',catalog,alias);}
   if(alias==='SC1')Object.assign(row,{C1_SOLICIT:text(h.solicitante,'C1_SOLICIT',alias),C1_QTDORIG:fit(qty,'C1_QTDORIG',catalog,alias),C1_APROV:' '});
   else Object.assign(row,{C7_FORNECE:clean(vendor.A2_COD),C7_LOJA:clean(vendor.A2_LOJA),C7_COND:clean(payment.E4_CODIGO),C7_CONTATO:text(h.contacto??'','C7_CONTATO',alias,true),C7_TXMOEDA:fit('1','C7_TXMOEDA',catalog,alias),C7_CONAPRO:' ',C7_COMPRA:text(h.comprador??'','C7_COMPRA',alias,true)});
   for(const field of Object.keys(row))assert(metadata.columns.some(c=>c.field===field&&!c.computed&&!c.identityColumn),409,'ESQUEMA_INCOMPATIBLE',field);
   rows.push(row);approvalItems.push({item:row[p+'_ITEM'],producto:row[p+'_PRODUTO'],cantidad:quantity,total,centroCosto:cost,grupoProducto:clean(product.B1_GRUPO),restriccionProducto:clean(product.B1_SOLICIT)});summary.push({item:row[p+'_ITEM'],producto:row[p+'_PRODUTO'],descripcion:row[p+'_DESCRI'],deposito:warehouse,unidad:unit,cantidad:quantity,precioUnitario:unitPrice,total,segundaUnidad:second||null,cantidadSegundaUnidad:row[p+'_QTSEGUM']||null,aprobacion:null});
  }
  const approval=await purchaseApproval({connection,catalog,alias,branch,buyerCode:alias==='SC7'?text(h.comprador??'','C7_COMPRA',alias,true):'',requester:h.solicitanteCodigo,items:approvalItems,lock});
  for(let i=0;i<rows.length;i++){
   rows[i][approval.field]=approval.status?approval.circuit.itemStates[summary[i].item]:' ';
   if(alias==='SC7'&&approval.group)rows[i].C7_APROV=text(approval.group,'C7_APROV',alias);
   summary[i].aprobacion=approval.status?rows[i][approval.field]:null;
   initials.push(defaults(metadata,rows[i]));
  }
  const circuits=[];
  if(!approval.blockers.length&&approval.circuit.entries.length){
   const scr=[],dbm=[],common=a=>({R_E_C_N_O_:'@asignar',R_E_C_D_E_L_:'0',D_E_L_E_T_:' ',[a==='SCR'?'CR_FILIAL':'DBM_FILIAL']:catalog.branch(a,branch)});
   if(approval.circuit.entity)assert(catalog.branch('SCR',branch)===catalog.branch('DBM',branch),409,'CIRCUITO_ESQUEMA','SCR y DBM deben compartir filial');
   for(const e of approval.circuit.entries){
    scr.push({...common('SCR'),CR_NUM:'@asignar',CR_TIPO:e.tipo,CR_USER:e.usuario,CR_APROV:e.aprobador,CR_GRUPO:e.grupo,CR_ITGRP:e.itemGrupo,CR_NIVEL:e.nivel,CR_STATUS:e.estado,CR_EMISSAO:emission,CR_TOTAL:e.total,CR_MOEDA:'1',CR_TXMOEDA:'1'});
    if(approval.circuit.entity)for(const item of e.items)dbm.push({...common('DBM'),DBM_TIPO:e.tipo,DBM_NUM:'@asignar',DBM_ITEM:item.item,DBM_GRUPO:e.grupo,DBM_ITGRP:e.itemGrupo,DBM_USER:e.usuario,DBM_APROV:'2',DBM_VALOR:item.total});
   }
   for(const [a,list,numberField,branchField,typeField] of [['SCR',scr,'CR_NUM','CR_FILIAL','CR_TIPO'],['DBM',dbm,'DBM_NUM','DBM_FILIAL','DBM_TIPO']])if(list.length){
    const meta=await schema(connection,a),initial=[];
    for(const row of list){
     for(const [field,value] of Object.entries(row)){
      assert(meta.columns.some(c=>c.field===field&&!c.computed&&!c.identityColumn),409,'CIRCUITO_ESQUEMA',field);
      if(['R_E_C_N_O_','R_E_C_D_E_L_','D_E_L_E_T_',numberField].includes(field))continue;
      row[field]=catalog.dictionary.get(field)?.X3_TIPO==='N'?fit(value,field,catalog,a):text(value,field,a,true);
     }
     initial.push(defaults(meta,row));
    }
    circuits.push({alias:a,rows:list,initials:initial,metadata:meta,numberField,branchField,typeField});
   }
  }
  const {evidence,...approvalView}=approval;
  const snapshot={version:3,action,branch,metadata,refs,rows,initials,approval,circuits};
  return {kind:'purchase-create',version:3,resource:alias==='SC1'?'solicitudesCompra':'compras',snapshotHash:hash(snapshot),snapshot,rows,initials,circuits,alias,p,identity:{tabla:alias,sucursal:branch,numero:'Automático al confirmar',moneda:'1',proveedor:h.proveedor||null,solicitante:h.solicitante||null,aprobacion:approval.status},diff:summary.map(r=>({field:`Ítem ${r.item}`,before:null,after:JSON.stringify(r)})),items:summary,calculation:{total:rows.reduce((acc,r)=>acc.plus(r[p+'_TOTAL']),new D(0)).toFixed(2),moneda:'1',aprobacion:approval.status},approval:approvalView,warnings,blockers:approval.blockers,executionEnabled:enabled&&!approval.blockers.length};
 }
 async function verifyInput(connection,proposal,lock){const current=await plan(connection,proposal.action,proposal.input,lock);assert(current.snapshotHash===proposal.writePlan.snapshotHash,409,'CONFLICTO_CONCURRENCIA','Cambió un catálogo, esquema o dato de la propuesta; preparar otra');return current;}
 return {
  prepare:(action,input)=>plan(db,action,input),
  async check(proposal){const current=await verifyInput(db,proposal,false);return {executionEnabled:current.executionEnabled};},
  async execute(proposal){
   assert(enabled,503,'ESCRITURA_DESHABILITADA','Altas SQL deshabilitadas');const connection=await getWriteDb();
   return connection.transaction(async tx=>{
    const alias=purchaseCreationActions[proposal.action],table=catalog.table(alias),p=alias==='SC1'?'C1':'C7';
    const allocated=await allocatePurchaseNumbers(tx,table,p+'_NUM',Number(catalog.dictionary.get(p+'_NUM')?.X3_TAMANHO),proposal.input.items.length);
    const current=await verifyInput(tx,proposal,true);
    assert(!current.blockers.length,409,'ALTA_NO_HABILITADA',current.blockers.map(b=>b.message).join(' '));
    const existing=await tx.query(`SELECT TOP (1) [R_E_C_N_O_] FROM ${name(table)} WHERE ${q(p+'_NUM')}=@number`,{number:allocated.number});assert(!existing.length,409,'NUMERO_DUPLICADO','El número ya existe');
    const batches=[{alias,rows:current.rows,initials:current.initials,metadata:current.snapshot.metadata,numberField:p+'_NUM',records:allocated.records}];
    // Fixed lock order: document, SCR, DBM. Maxima include deleted and every branch.
    for(const circuit of current.circuits)batches.push({...circuit,records:await allocateCircuitRecords(tx,catalog.table(circuit.alias),circuit.rows.length)});
    const circuitReceipt=[];
    for(const batch of batches){
     const t=catalog.table(batch.alias),paramsScope={number:allocated.number};
     let scope=`${q(batch.numberField)}=@number`;
     if(batch.alias!==alias){
      paramsScope.branch=catalog.branch(batch.alias,current.identity.sucursal);paramsScope.type=current.approval.circuit.type;
      scope+=` AND ${q(batch.branchField)}=@branch AND ${q(batch.typeField)}=@type`;
      const orphan=await tx.query(`SELECT TOP (1) [R_E_C_N_O_] FROM ${name(t)} WHERE ${scope}`,paramsScope);
      assert(!orphan.length,409,'CIRCUITO_EXISTENTE','El número tiene un circuito previo; no se reutiliza ni sobrescribe');
     }
     for(let i=0;i<batch.rows.length;i++){
      const row={...batch.rows[i],R_E_C_N_O_:batch.records[i],[batch.numberField]:allocated.number},params={},fields=Object.keys(row),values=[];
      fields.forEach((field,j)=>{params['v'+j]=row[field];values.push(field==='R_E_C_N_O_'||field==='R_E_C_D_E_L_'?`CONVERT(bigint,@v${j})`:catalog.dictionary.get(field)?.X3_TIPO==='N'?`CONVERT(decimal(38,12),@v${j})`:`@v${j}`);});
      const result=await tx.query(`DECLARE @inserted TABLE(id bigint); INSERT INTO ${name(t)} (${fields.map(q).join(',')}) OUTPUT inserted.[R_E_C_N_O_] INTO @inserted VALUES (${values.join(',')}); SELECT CONVERT(varchar(30),id) AS record FROM @inserted;`,params);
      assert(result.length===1&&result[0].record===batch.records[i],409,'FILAS_AFECTADAS_INVALIDAS','El INSERT no devolvió el RECNO asignado');
     }
     const saved=await tx.query(`SELECT ${selection(t)} FROM ${name(t)} WHERE ${scope} ORDER BY [R_E_C_N_O_]`,paramsScope);
     assert(saved.length===batch.rows.length,409,'FILAS_AFECTADAS_INVALIDAS','No coincide la cantidad de registros creados');
     for(let i=0;i<saved.length;i++){
      const expected={...batch.initials[i],...batch.rows[i],R_E_C_N_O_:batch.records[i],[batch.numberField]:allocated.number};
      for(const [field,value] of Object.entries(expected)){
       const actual=saved[i][field],column=batch.metadata.columns.find(c=>c.field===field);
       if(value?.generatedTime){assert(actual&&Number.isFinite(Date.parse(actual)),409,'LECTURA_POSTERIOR_DIFIERE',field);continue;}
       if(value===null){assert(actual===null,409,'LECTURA_POSTERIOR_DIFIERE',field);continue;}
       const numeric=['float','real','decimal','numeric','bigint','int','smallint','tinyint','money','smallmoney'].includes(column.type),floating=['float','real'].includes(column.type);
       const equal=numeric?(floating?sourceNumber(actual,field).toSignificantDigits(15).eq(new D(value).toSignificantDigits(15)):sourceNumber(actual,field).eq(value)):clean(actual)===clean(value);
       assert(equal,409,'LECTURA_POSTERIOR_DIFIERE',field);
      }
     }
     if(batch.alias!==alias)circuitReceipt.push({table:batch.alias,affected:saved.length,records:batch.records});
    }
    await verifyInput(tx,proposal,true);
    return {affected:current.rows.length,circuits:circuitReceipt,operation:'insert',table:alias,number:allocated.number,records:allocated.records,items:current.items,fields:{numero:allocated.number,aprobacion:current.approval.status},approval:current.approval,warnings,allocation:'MAX+1 bajo TABLOCKX/HOLDLOCK',nativeValidation:false};
   });
  }
 };
}

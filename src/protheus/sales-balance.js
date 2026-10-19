import {assert} from '../errors.js';
import {D,clean,sourceNumber,numericSpec,fit} from './write-policy.js';

// This profile is internal: SC9 cannot be selected as an independent write action.
export const releaseProfile=Object.freeze({alias:'SC9',branch:'C9_FILIAL',price:'C9_PRCVEN'});
export const releaseFields=['C9_FILIAL','C9_PEDIDO','C9_ITEM','C9_PRODUTO','C9_CLIENTE','C9_LOJA','C9_QTDLIB','C9_PRCVEN','C9_SEQUEN','C9_NFISCAL','C9_SERIENF','C9_REMITO','C9_SERIREM','C9_BLCRED','C9_BLEST'];
const documentFields=['C9_NFISCAL','C9_REMITO'];
const logisticsFields=['C9_BLWMS','C9_BLTMS','C9_BLOQUEI','C9_CARGA','C9_SERVIC','C9_STSERV','C9_IDENTB6','C9_NUMCP','C9_ORDSEP','C9_TICKETC','C9_ROMEMB','C9_SD3SEQ','C9_REGWMS','C9_IDDCF'];
const requireFields=(row,fields)=>{for(const f of fields)assert(Object.hasOwn(row,f),409,'ESTADO_NO_VERIFICABLE',`Falta ${f}`);};
const normalized=(row,field,catalog,alias)=>sourceNumber(row[field],field).toDecimalPlaces(numericSpec(field,catalog,alias).scale);

export function salesBalanceContext(row,header,releases,documents,catalog){
 const delivered=normalized(row,'C6_QTDENT',catalog,'SC6'),ordered=normalized(row,'C6_QTDVEN',catalog,'SC6');
 const advanced=delivered.gt(0)||releases.length>0||documents.length>0||clean(header.C5_LIBEROK)!==''||clean(row.C6_NOTA)!=='';
 if(!advanced)return {advanced:false,pending:[],historical:[]};
 assert(delivered.gte(0)&&ordered.gt(delivered),409,'SIN_SALDO_PENDIENTE','El ítem está totalmente atendido o tiene un saldo inconsistente');
 requireFields(header,['C5_CLIENTE','C5_LOJACLI','C5_TIPO']);
 assert(clean(header.C5_TIPO)==='N',409,'TIPO_PEDIDO_NO_SOPORTADO','El reajuste de saldo sólo admite pedidos normales, sin complemento ni entrega futura');
 assert(['','S'].includes(clean(header.C5_LIBEROK)),409,'ESTADO_NO_VERIFICABLE','Estado C5_LIBEROK desconocido');
 const remaining=ordered.minus(delivered),pending=[],historical=[];
 for(const r of releases){
  requireFields(r,releaseFields);
  assert(clean(r.C9_PEDIDO)===clean(row.C6_NUM)&&clean(r.C9_ITEM)===clean(row.C6_ITEM)&&clean(r.C9_PRODUTO)===clean(row.C6_PRODUTO)&&clean(r.C9_CLIENTE)===clean(header.C5_CLIENTE)&&clean(r.C9_LOJA)===clean(header.C5_LOJACLI),409,'LIBERACION_INCONSISTENTE','La liberación no coincide con el pedido, producto o cliente');
  const qty=normalized(r,'C9_QTDLIB',catalog,'SC9');assert(qty.gt(0),409,'LIBERACION_INCONSISTENTE','Cantidad liberada no positiva');
  if(documentFields.some(f=>clean(r[f]))){historical.push(r);continue;}
  // 10 is a processed/documented release, never an open release to reprice.
  assert(!['C9_BLCRED','C9_BLEST'].some(f=>clean(r[f])==='10'),409,'LIBERACION_INCONSISTENTE','Liberación procesada sin documento identificable');
  assert(!['C9_SERIENF','C9_SERIREM','C9_DTREMIT','C9_ITEMREM','C9_SDOCNF','C9_SDOCREM'].some(f=>clean(r[f])),409,'LIBERACION_INCONSISTENTE','Referencia parcial a un documento en SC9');
  assert(!clean(r.C9_BLCRED)&&['','02'].includes(clean(r.C9_BLEST)),409,'LIBERACION_BLOQUEADA','La liberación requiere análisis de crédito/estado en Protheus');
  for(const f of logisticsFields)assert(!clean(r[f]),409,'LOGISTICA_NO_SOPORTADA',`${f} requiere el circuito logístico Protheus`);
  if(Object.hasOwn(r,'C9_QTDLIB2'))assert(sourceNumber(r.C9_QTDLIB2,'C9_QTDLIB2').eq(0),409,'SEGUNDA_UNIDAD_NO_SOPORTADA','Liberación en segunda unidad');
  pending.push(r);
 }
 const sum=items=>items.reduce((acc,r)=>acc.plus(normalized(r,'C9_QTDLIB',catalog,'SC9')),new D(0));
 const released=sum(pending),documented=sum(historical);
 assert(released.lte(remaining)&&documented.lte(delivered),409,'SALDO_LIBERADO_INCONSISTENTE','Las cantidades de SC9 exceden el saldo o lo atendido en SC6');
 if(pending.length&&delivered.gt(0))assert(documented.eq(delivered),409,'HISTORICO_NO_VERIFICABLE','Con liberaciones pendientes, SC9 documentada debe explicar toda la cantidad atendida; no se presume qué liberación ya se facturó');
 assert(!documents.length||delivered.gt(0),409,'HISTORICO_NO_VERIFICABLE','Existen documentos pero SC6 no registra atención; revisar el circuito antes de reajustar');
 assert(!delivered.gt(0)||documents.length>0,409,'HISTORICO_NO_VERIFICABLE','La cantidad atendida no tiene documentos SD2 verificables');
 assert(!clean(row.C6_NOTA)||documents.length>0,409,'HISTORICO_NO_VERIFICABLE','La referencia de factura del ítem no tiene documentos SD2');
 for(const doc of documents){
  requireFields(doc,['D2_COD','D2_CLIENTE','D2_LOJA','D2_DOC','D2_SERIE']);
  assert(clean(doc.D2_COD)===clean(row.C6_PRODUTO)&&clean(doc.D2_CLIENTE)===clean(header.C5_CLIENTE)&&clean(doc.D2_LOJA)===clean(header.C5_LOJACLI)&&clean(doc.D2_DOC),409,'DOCUMENTO_INCONSISTENTE','Documento SD2 sin identidad coherente con el ítem');
 }
 for(const field of ['C6_QTDLIB','C6_QTDRESE','C6_QTDEMP'])if(Object.hasOwn(row,field)){
  const qty=sourceNumber(row[field],field);assert(qty.gte(0)&&qty.lte(ordered),409,'SALDO_INCONSISTENTE',`${field} fuera de rango`);
 }
 return {advanced:true,pending,historical,remaining:remaining.toFixed(),delivered:delivered.toFixed(),released:released.toFixed()};
}

export function planSalesBalance(plan,context,catalog){
 const {balance,parameters,row,documents}=context;
 if(!balance?.advanced)return {...plan,relatedUpdates:[],blockers:[]};
 const blockers=[];
 const permitted=parameters.MV_ALTPREC==='T'||(parameters.MV_ALTPREC==='F'&&balance.delivered==='0'&&documents.length===0&&balance.historical.length===0);
 if(!permitted)blockers.push({code:'PARAMETRO_REPRECIO',message:'MV_ALTPREC no permite este reajuste por estado; revisar en Protheus sin modificar parámetros desde el agente.'});
 // SQL does not run the native credit checks or update the customer credit balances.
 // A preview remains useful, but it must not become an executable credit bypass.
 if(balance.pending.length&&parameters.MV_BLOQUEI!=='.F.')blockers.push({code:'REQUIERE_REVALIDACION_CREDITO',message:'Hay liberaciones pendientes y el control de crédito está activo o no es verificable. Esta instalación usa sólo UPDATE SQL, que no ejecutan la revalidación nativa de Protheus. La propuesta no puede confirmarse aquí; requiere el circuito nativo. No se desactiva crédito ni se cambian sus aprobaciones.'});
 const relatedUpdates=[];
 for(const release of balance.pending){
  const after=fit(plan.calculation.precioPorUnidad,'C9_PRCVEN',catalog,'SC9');
  const before=normalized(release,'C9_PRCVEN',catalog,'SC9');
  const oldPrice=normalized(row,'C6_PRCVEN',catalog,'SC6');
  assert(before.eq(oldPrice),409,'PRECIO_LIBERADO_DIFERENTE','SC9 y SC6 tienen precios diferentes; revisar el acuerdo de cada liberación en Protheus');
  if(!before.eq(after))relatedUpdates.push({alias:'SC9',record:clean(release.R_E_C_N_O_),updates:{C9_PRCVEN:after},sequence:clean(release.C9_SEQUEN)});
 }
 const pendingTotal=fit(new D(balance.remaining).mul(plan.calculation.precioPorUnidad),'C6_VALOR',catalog,'SC6',{round:true});
 return {...plan,relatedUpdates,blockers,
  diff:[...plan.diff.map(d=>({...d,table:'SC6',record:clean(row.R_E_C_N_O_)})),...relatedUpdates.map(u=>({field:'C9_PRCVEN',table:'SC9',record:u.record,sequence:u.sequence,before:balance.pending.find(r=>clean(r.R_E_C_N_O_)===u.record).C9_PRCVEN,after:u.updates.C9_PRCVEN}))],
  calculation:{...plan.calculation,alcance:'Precio del saldo pendiente; documentos emitidos conservados',cantidadAtendida:balance.delivered,cantidadPendiente:balance.remaining,millaresPendientes:plan.calculation.unidadMedida==='UN'?new D(balance.remaining).div(1000).toFixed():null,cantidadLiberadaPendiente:balance.released,totalPendiente:pendingTotal,totalPedidoReferencia:plan.calculation.total,documentosPreservados:documents.length,liberacionesDocumentadasPreservadas:balance.historical.length,liberacionesAActualizar:relatedUpdates.length,notaTotal:'C6_VALOR = cantidad total pedida × nuevo precio. No representa el importe histórico facturado ni la suma de facturas.'}
 };
}

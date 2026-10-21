import {randomUUID,createHash} from 'node:crypto';
import Decimal from 'decimal.js';
import {assert} from '../errors.js';
import {importAction,importProfiles} from './price-imports.js';

// A batch records the exact reviewed set. Individual Changes receipts remain
// authoritative, including when a response or the process is lost.
export function createPriceBatches({store,check,execute,authorize=()=>{}}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS price_batches(
  id TEXT PRIMARY KEY,actor TEXT NOT NULL,import_id TEXT NOT NULL,status TEXT NOT NULL,
  body TEXT NOT NULL,updated TEXT NOT NULL,error TEXT);
  UPDATE price_batches SET status='interrupted' WHERE status IN ('checking','running');`);
 function raw(actor,id){
  const row=db.prepare('SELECT * FROM price_batches WHERE id=? AND actor=?').get(id,actor);
  assert(row,404,'LOTE_NO_EXISTE','Lote inexistente para este usuario.');return {...row,data:JSON.parse(row.body)};
 }
 function get(actor,id){
  const row=raw(actor,id),error=row.error?JSON.parse(row.error):null;
  const rows=row.data.rows.map(item=>{
   const receipt=store.execution(item.proposalId,actor);
   return {...item,status:receipt?.status||(error?.proposalId===item.proposalId?'validation_failed':'pending'),code:receipt?.result?.code|| (error?.proposalId===item.proposalId?error.code:null)};
  });
  const counts={valid:rows.length,excluded:row.data.issues.length,executed:0,failed:0,unknown:0,executing:0,pending:0,validation_failed:0};
  for(const item of rows)counts[item.status]=(counts[item.status]||0)+1;
  return {...row.data,status:row.status,rows,counts,error,updatedAt:row.updated};
 }
 function create(actor,draft,result){
  assert(!db.prepare("SELECT 1 FROM price_batches WHERE actor=? AND import_id=? AND status IN ('checking','running')").get(actor,draft.id),409,'LOTE_EN_CURSO','Este adjunto tiene una confirmación en curso. Consultá su resultado.');
  const rows=[],issues=[...result.issues],action=importAction(draft.kind);
  for(let i=0;i<result.proposals.length;i++){
   const proposal=result.proposals[i],resolved=result.resolved[i];
   if(!proposal.executionEnabled||proposal.blockers?.length){
    issues.push({fila:resolved.fila,producto:resolved.producto,ubicacion:proposal.origin?.ubicacion,codigo:'PRECIO_NO_EJECUTABLE',motivo:proposal.blockers?.map(b=>b.message).join(' · ')||'La ejecución de este precio no está habilitada.'});continue;
   }
   const field=importProfiles[draft.kind].price,priceDiff=proposal.diff.find(d=>d.field===field);
   const quantityField={pedidoVenta:'C6_QTDVEN',pedidoCompra:'C7_QUANT',solicitudCompra:'C1_QUANT'}[action];
   const quantityDiff=proposal.diff.find(d=>d.field===quantityField);
   const retainedPrice=proposal.calculation?.precioPorUnidad??proposal.before?.precioUnitario;
   const diff=priceDiff|| (resolved.quantityChanged?{before:retainedPrice,after:retainedPrice}:null);
   assert(diff&&proposal.action===action&&proposal.target.sucursal===draft.branch,409,'LOTE_INVALIDO','La propuesta no corresponde al adjunto.');
   const factor=resolved.base==='millar'?1000:1,scale=String(diff.after).split('.')[1]?.length||0;
   const totalField={pedidoVenta:'C6_VALOR',pedidoCompra:'C7_TOTAL',solicitudCompra:'C1_TOTAL'}[action],total=proposal.diff.find(d=>d.field===totalField);
   rows.push({...resolved,proposalId:proposal.id,fingerprint:proposal.fingerprint,expiresAt:proposal.expiresAt,
    anterior:new Decimal(diff.before).toDecimalPlaces(scale).times(factor).toFixed(),
    nuevo:new Decimal(diff.after).times(factor).toFixed(),
    diferenciaAbsoluta:new Decimal(diff.after).minus(diff.before).times(factor).toFixed(),
    diferenciaPorcentaje:new Decimal(diff.before).eq(0)?null:new Decimal(diff.after).minus(diff.before).div(diff.before).times(100).toFixed(4),
    unidadMedida:proposal.calculation?.unidadMedida||proposal.identity?.unidadMedida||resolved.unidadMedida,totalAnterior:total?.before??proposal.before?.total,totalNuevo:total?.after??proposal.before?.total,
    cantidadAnterior:quantityDiff?.before??resolved.cantidad,cantidadNueva:quantityDiff?.after??resolved.cantidad,
    cantidadAnteriorComercial:resolved.quantityChanged?new Decimal(quantityDiff?.before??resolved.cantidad).div(resolved.quantityUnit==='millares'?1000:1).toFixed():undefined,
    cantidadNuevaComercial:resolved.quantityChanged?new Decimal(quantityDiff?.after??resolved.cantidad).div(resolved.quantityUnit==='millares'?1000:1).toFixed():undefined,
    origen:proposal.origin?.ubicacion,warnings:proposal.warnings||[],diff:proposal.diff});
  }
  const data={id:randomUUID(),importId:draft.id,kind:draft.kind,action,branch:draft.branch,name:draft.name,rows,issues,...(result.impact?{impact:result.impact}:{}),
   expiresAt:rows.length?rows.reduce((min,r)=>r.expiresAt<min?r.expiresAt:min,rows[0].expiresAt):draft.expiresAt};
  data.fingerprint=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare("UPDATE price_batches SET status='superseded' WHERE actor=? AND import_id=? AND status='ready'").run(actor,draft.id);
   db.prepare('INSERT INTO price_batches VALUES(?,?,?,?,?,?,NULL)').run(data.id,actor,draft.id,'ready',JSON.stringify(data),new Date().toISOString());
   store.audit(actor,'price-batch.prepared',data.id);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return get(actor,data.id);
 }
 function state(actor,id,status,error=null){
  db.prepare('UPDATE price_batches SET status=?,updated=?,error=? WHERE id=? AND actor=?').run(status,new Date().toISOString(),error?JSON.stringify(error):null,id,actor);
  store.audit(actor,'price-batch.'+status,id);
 }
 async function run(actor,id,confirmation){
  const row=raw(actor,id),data=row.data;
  authorize(data);
  assert(confirmation?.confirm===true&&confirmation.fingerprint===data.fingerprint,400,'CONFIRMACION_REQUERIDA','Confirmá el resumen exacto del lote revisado.');
  assert(row.status!=='superseded',409,'LOTE_REEMPLAZADO','Hay una revisión más reciente de este adjunto. Confirmá su resumen.');
  // Retrying the same request only returns its durable status; it never resumes writes.
  if(row.status!=='ready')return get(actor,id);
  assert(data.rows.length>0,409,'LOTE_VACIO','No hay precios válidos para confirmar.');
  assert(Date.parse(data.expiresAt)>Date.now(),409,'LOTE_VENCIDO','El resumen venció. Volvé a verificar los precios.');
  const claimed=db.prepare("UPDATE price_batches SET status='checking',updated=? WHERE id=? AND actor=? AND status='ready'").run(new Date().toISOString(),id,actor);
  if(!claimed.changes)return get(actor,id);
  let current;
  try{
   // Recheck the entire set before the first write; each execution also checks
   // its snapshot under SQL transaction locks.
   for(const item of data.rows){
    current=item;authorize(data);
    const proposal=store.get(item.proposalId,actor),receipt=store.execution(item.proposalId,actor);
    assert(proposal&&proposal.fingerprint===item.fingerprint&&proposal.action===data.action&&proposal.target.sucursal===data.branch&&proposal.origin?.importacion===data.importId,409,'LOTE_INVALIDO','El lote no coincide con sus propuestas.');
    if(receipt?.status==='executed')continue;
    assert(!receipt,409,'EJECUCION_NO_REPETIBLE','Hay un precio con ejecución iniciada o resultado incierto. Consultá el resultado.');
    const verified=await check(actor,item.proposalId);assert(verified.executionEnabled,409,'ESCRITURA_DESHABILITADA','Este precio no está habilitado para actualizar.');
   }
  }catch(error){state(actor,id,'blocked',{proposalId:current?.proposalId,code:error.code||'ERROR_VERIFICACION',message:error.code?error.message:'No se pudo revalidar el lote. Volvé a consultar.'});return get(actor,id);}
  state(actor,id,'running');
  for(const item of data.rows){
   try{
    authorize(data);
    if(store.execution(item.proposalId,actor)?.status==='executed')continue;
    await execute(actor,item.proposalId,{confirm:true,fingerprint:item.fingerprint});
   }catch(error){
    state(actor,id,'stopped',{proposalId:item.proposalId,code:error.code||'ERROR_EJECUCION',message:'La ejecución se detuvo. Revisá los resultados antes de preparar los pendientes.'});
    return get(actor,id);
   }
  }
  state(actor,id,'completed');return get(actor,id);
 }
 return {create,get,run};
}

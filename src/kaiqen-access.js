// The HTTP connector can return more columns than the PostgreSQL connector.
// Restricted users only receive the verified contract for each area.
const fields={
 project:'id code name part_number part_name start_date sop_date updated_at origin sin_ia_externa sin_ia_externa_por_cliente customer current_phase_no current_phase_name erp_producto_referencia_id status estado_general referencia',
 product:'id clave codigo nombre sucursal habilitacion tipo_kaiqen ultima_vez_en baja_en_erp_en bloqueado_en_erp',
 phase:'id phase_id phase_no name status_id status_code status_name planned_start planned_end actual_start actual_end',
 gate:'id name status_id review_date decision updated_at',
 event:'id part_id event_type effective_date annuls_event_id created_at',
 quality:'id nc_no state title part_id production_order report_date closure_date qty_rejected updated_at status_id severity due_date closed_date action_nature approval_status_id submission_date disposition_date interim_expiry study_type verdict study_date grr_percent ndc customer_approved index_type value required_threshold is_capable'
};
const pick=(value,keys)=>Object.fromEntries(keys.split(' ').filter(k=>Object.hasOwn(value||{},k)&&[null,'string','number','boolean'].includes(value[k]===null?null:typeof value[k])).map(k=>[k,value[k]]));
const rows=(value,keys)=>Array.isArray(value)?value.map(row=>pick(row,keys)):[];
export function scopeKaiqen(method,envelope){
 const data=envelope.data||{};
 let safe;
 if(method==='projects')safe=rows(data,fields.project);
 else if(method==='project')safe=data.project?{
  ...pick(data,'etapa_de_vida derivedStateAvailable'),project:pick(data.project,fields.project),
  phases:rows(data.phases,fields.phase),gates:rows(data.gates,fields.gate),lifecycleEvents:rows(data.lifecycleEvents,fields.event),
  truncated:pick(data.truncated,'phases gates lifecycleEvents')
 }:pick(data,fields.project);
 else if(method==='product')safe=pick(data,fields.product);
 else if(method==='projectLink')safe={
  ...pick(data,'piezas vinculadas hasMore integracion_activa'),
  articulo_referencia:data.articulo_referencia?pick(data.articulo_referencia,fields.product):null,
  piezasDetalle:rows(data.piezasDetalle,'id part_no name erp_producto_id'),
  sin_vincular:rows(data.sin_vincular,'id part_no name erp_producto_id'),
  sugerencias_referencia:rows(data.sugerencias_referencia,fields.product)
 };
 else if(method==='quality'){
  const domains={};
  for(const key of ['noConformidades','problemas','ppap','msa','capacidad'])if(data.domains?.[key]){
   const d=data.domains[key];domains[key]={...pick(d,'hasMore recordsHasMore'),conteos:rows(d.conteos,'project_id estado cantidad'),registros:rows(d.registros,fields.quality)};
  }
  safe={...pick(data,'projectId semaforo_global computedQuality nota pendientes'),domains,issueStatusCatalog:rows(data.issueStatusCatalog,'id code name')};
 }
 else throw new Error('Unmapped KAIQEN method');
 return {...envelope,data:safe};
}

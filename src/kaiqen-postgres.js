import pg from 'pg';
import { readFileSync } from 'node:fs';
import { HttpError,assert } from './errors.js';

const projectColumns=`p.id,p.code,p.name,p.part_number,p.part_name,p.start_date,p.sop_date,p.updated_at,p.origin,
  p.sin_ia_externa,COALESCE(c.sin_ia_externa,false) AS sin_ia_externa_por_cliente,
  c.name AS customer,ph.phase_no AS current_phase_no,ph.name AS current_phase_name,p.erp_producto_referencia_id`;
const projectFrom=`public.project p LEFT JOIN public.customer c ON c.id=p.customer_id AND c.tenant_id=p.tenant_id
  LEFT JOIN public.cat_phase ph ON ph.id=p.current_phase_id`;
const qualitySources={
  noConformidades:{table:'nc_report',state:'state',fields:'id,nc_no,state,title,part_id,production_order,report_date,closure_date,qty_rejected,updated_at'},
  problemas:{table:'open_issue',state:'status_id',fields:'id,title,status_id,severity,due_date,closed_date,action_nature,updated_at'},
  ppap:{table:'ppap_package',state:'approval_status_id',fields:'id,part_id,approval_status_id,submission_date,disposition_date,interim_expiry,updated_at'},
  msa:{table:'msa_study',state:'verdict',fields:'id,study_type,verdict,study_date,grr_percent,ndc,customer_approved,updated_at'},
  capacidad:{table:'capability_study',state:'status_id',fields:'id,index_type,value,required_threshold,is_capable,study_date,status_id,updated_at'}
};
function id(value){assert(typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value),400,'KAIQEN_INVALID_INPUT','Identificador inválido');return value;}
function integer(value,fallback,max,min=0){const raw=value??fallback;assert(/^\d+$/.test(String(raw))&&Number(raw)>=min&&Number(raw)<=max,400,'PAGINACION_INVALIDA','Paginación inválida');return Number(raw);}
export function createKaiqenPostgres({connectionString,tenantId,caFile,pool:providedPool}={}){
  assert(connectionString || providedPool,503,'KAIQEN_NOT_CONFIGURED','Falta conexión de KAIQEN');id(tenantId);
  let secureUrl,ca;
  if(!providedPool){
    try{
      const url=new URL(connectionString);
      assert(['postgres:','postgresql:'].includes(url.protocol),503,'KAIQEN_NOT_CONFIGURED','Conexión inválida');
      for(const name of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])url.searchParams.delete(name);
      secureUrl=url.toString();ca=caFile?readFileSync(caFile,'utf8'):undefined;
    }catch{throw new HttpError(503,'KAIQEN_TLS_CONFIG','Revisar conexión y certificado CA local');}
  }
  const pool=providedPool||new pg.Pool({connectionString:secureUrl,ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,query_timeout:15000,application_name:'centralizador-kaiqen-readonly',types:{getTypeParser:(oid,format)=>oid===1082?value=>value:pg.types.getTypeParser(oid,format)}});
  pool.on?.('error',()=>{});
  async function snapshot(callback){
    let client;
    try{
      client=await pool.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const check=await client.query('SHOW transaction_read_only');
      assert(check.rows[0]?.transaction_read_only==='on',503,'KAIQEN_READ_ONLY_REQUIRED','El origen no confirmó transacción de sólo lectura');
      await client.query("SET LOCAL statement_timeout = '15000'");
      await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      return await callback(async(text,params=[])=>{
        assert(/^SELECT\b/i.test(text.trim()),500,'QUERY_NOT_ALLOWED','Sólo consultas predefinidas');
        return (await client.query(text,params)).rows;
      });
    }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,'KAIQEN_DATABASE_UNAVAILABLE','No se pudo consultar KAIQEN');}
    finally{if(client){try{await client.query('ROLLBACK');client.release();}catch{client.release(true);}}}
  }
  const envelope=(data,extra={})=>({origen:'kaiqen',source:'postgres',fetchedAt:new Date().toISOString(),data,...extra,limitaciones:[
    'Lectura directa de una sola planta; no reproduce permisos individuales de la API de KAIQEN.',
    'Datos y estados guardados; no recalcula la etapa de vida ni el semáforo de la torre de calidad.',
    'No enviar información a IA externa cuando sin_ia_externa o sin_ia_externa_por_cliente sea verdadero.'
  ]});
  async function requireProject(query,projectId){
    const rows=await query(`SELECT ${projectColumns} FROM ${projectFrom} WHERE p.tenant_id=$1 AND p.id=$2`,[tenantId,id(projectId)]);
    assert(rows.length===1,404,'KAIQEN_NOT_FOUND','Proyecto inexistente en la planta configurada');return rows[0];
  }
  return {
    available:true,source:'postgres',computedQuality:false,
    async projects(params={}){
      assert(params&&typeof params==='object'&&!Array.isArray(params),400,'FILTRO_INVALIDO','Filtros inválidos');
      assert(Object.keys(params).every(k=>['q','limit','offset'].includes(k)),400,'FILTRO_NO_ADMITIDO','Lectura DB admite q, limit y offset; no estado derivado');
      const limit=integer(params.limit,100,500,1),offset=integer(params.offset,0,1000000);
      assert(params.q===undefined || (typeof params.q==='string'&&params.q.length<=100),400,'FILTRO_INVALIDO','Búsqueda demasiado larga');
      return snapshot(async query=>{
        const all=await query(`SELECT ${projectColumns} FROM ${projectFrom} WHERE p.tenant_id=$1 AND ($2='' OR strpos(lower(p.code||' '||p.name),lower($2))>0) ORDER BY p.id LIMIT $3 OFFSET $4`,[tenantId,params.q||'',limit+1,offset]);
        return envelope(all.slice(0,limit),{pagination:{limit,offset,hasMore:all.length>limit,upstreamPagination:true}});
      });
    },
    async project(projectId){return snapshot(async query=>{
      const project=await requireProject(query,projectId);
      const phases=await query(`SELECT i.id,i.phase_id,ph.phase_no,ph.name,i.status_id,s.code AS status_code,s.name AS status_name,i.planned_start,i.planned_end,i.actual_start,i.actual_end FROM public.apqp_phase_instance i LEFT JOIN public.cat_phase ph ON ph.id=i.phase_id LEFT JOIN public.cat_deliverable_status s ON s.id=i.status_id WHERE i.tenant_id=$1 AND i.project_id=$2 ORDER BY ph.phase_no,i.id LIMIT 201`,[tenantId,projectId]);
      const gates=await query(`SELECT r.id,g.name,r.status_id,r.review_date,r.decision,r.updated_at FROM public.gate_review r LEFT JOIN public.cat_gate g ON g.id=r.gate_id WHERE r.tenant_id=$1 AND r.project_id=$2 ORDER BY r.id LIMIT 201`,[tenantId,projectId]);
      const events=await query('SELECT id,part_id,event_type,effective_date,annuls_event_id,created_at FROM public.program_lifecycle_event WHERE tenant_id=$1 AND project_id=$2 ORDER BY effective_date DESC,id LIMIT 201',[tenantId,projectId]);
      return envelope({project,phases:phases.slice(0,200),gates:gates.slice(0,200),lifecycleEvents:events.slice(0,200),etapa_de_vida:null,derivedStateAvailable:false,truncated:{phases:phases.length>200,gates:gates.length>200,lifecycleEvents:events.length>200}});
    });},
    async quality(projectId){
      if(projectId!==undefined)id(projectId);
      return snapshot(async query=>{
        if(projectId!==undefined)await requireProject(query,projectId);
        const domains={};
        for(const [name,spec] of Object.entries(qualitySources)){
          const rows=await query(`SELECT d.project_id,d.${spec.state}::text AS estado,count(*)::int AS cantidad FROM public.${spec.table} d JOIN public.project p ON p.id=d.project_id AND p.tenant_id=d.tenant_id WHERE d.tenant_id=$1 AND ($2::text IS NULL OR d.project_id=$2) GROUP BY d.project_id,d.${spec.state} ORDER BY d.project_id,d.${spec.state} LIMIT 501`,[tenantId,projectId??null]);
          const domain={conteos:rows.slice(0,500),hasMore:rows.length>500};
          if(projectId!==undefined){
            const records=await query(`SELECT ${spec.fields} FROM public.${spec.table} WHERE tenant_id=$1 AND project_id=$2 ORDER BY id LIMIT 201`,[tenantId,projectId]);
            domain.registros=records.slice(0,200);domain.recordsHasMore=records.length>200;
          }
          domains[name]=domain;
        }
        const statuses=await query('SELECT id,code,name FROM public.cat_issue_status ORDER BY id');
        return envelope({projectId:projectId??null,domains,issueStatusCatalog:statuses,semaforo_global:null,computedQuality:false});
      });
    },
    async projectLink(projectId){return snapshot(async query=>{
      const project=await requireProject(query,projectId);
      const parts=await query('SELECT id,part_no,name,erp_producto_id FROM public.part WHERE tenant_id=$1 AND project_id=$2 ORDER BY id LIMIT 501',[tenantId,projectId]);
      const reference=project.erp_producto_referencia_id?await query('SELECT id,clave,codigo,nombre,sucursal,ultima_vez_en,baja_en_erp_en,bloqueado_en_erp FROM public.erp_producto WHERE tenant_id=$1 AND id=$2',[tenantId,project.erp_producto_referencia_id]):[];
      const counts=await query('SELECT count(*)::int AS piezas,count(erp_producto_id)::int AS vinculadas FROM public.part WHERE tenant_id=$1 AND project_id=$2',[tenantId,projectId]);
      return envelope({...counts[0],articulo_referencia:reference[0]??null,piezasDetalle:parts.slice(0,500),hasMore:parts.length>500,sin_vincular:parts.slice(0,500).filter(x=>!x.erp_producto_id),sugerencias_referencia:[]});
    });},
    async product(productId){return snapshot(async query=>{
      const rows=await query('SELECT id,clave,codigo,nombre,sucursal,habilitacion,tipo_kaiqen,ultima_vez_en,baja_en_erp_en,bloqueado_en_erp FROM public.erp_producto WHERE tenant_id=$1 AND id=$2',[tenantId,id(productId)]);
      assert(rows.length===1,404,'KAIQEN_NOT_FOUND','Producto inexistente en la planta configurada');return envelope(rows[0]);
    });},
    close:()=>pool.end()
  };
}

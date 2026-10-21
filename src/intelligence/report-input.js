import {assert} from '../errors.js';
import {reportDetails} from '../report-metrics.js';
export function dashboardInput(request,branch){
 assert(request&&typeof request==='object'&&!Array.isArray(request)&&Object.keys(request).every(k=>['mode','resource','filters'].includes(k)),400,'DASHBOARD_INVALIDO','Solicitud de dashboard inválida.');
 assert(Object.hasOwn(reportDetails,request.resource)&&['summary','documents'].includes(request.mode||'summary'),400,'DASHBOARD_INVALIDO','Informe no disponible.');
 const filters=request.filters||{};
 assert(filters&&typeof filters==='object'&&!Array.isArray(filters),400,'FILTROS_INVALIDOS','Filtros inválidos.');
 for(const [k,v] of Object.entries(filters))assert(['sucursal','desde','hasta','cliente','proveedor','producto','tienda','moneda','unidad','clase','numero','serie',...(request.mode!=='documents'?['agrupar']:[])].includes(k)&&typeof v==='string'&&v.length<=128,400,'FILTROS_INVALIDOS','Filtro no admitido.');
 assert(!filters.sucursal||filters.sucursal===branch,403,'SUCURSAL_NO_AUTORIZADA','El gráfico pertenece a otra sucursal.');
 return {resources:[request.resource],filters:Object.fromEntries(Object.entries(filters).filter(([k,v])=>k!=='sucursal'&&v.trim()).map(([k,v])=>[k,v.trim()])),mode:request.mode||'summary'};
}
export function reportReferences(text){
 const filters={};
 const re=/(?:\by\s+)?(?:\bdel?\s+|\bpara\s+(?:el\s+)?|\bel\s+)?\b(cliente|proveedor|producto|tienda)\s+(?:"([^"]+)"|«([^»]+)»|(.+?))(?=\s+(?:(?:y\s+)?(?:del?\s+|para\s+(?:el\s+)?)?(?:cliente|proveedor|producto|tienda)\s+|(?:de[l]?\s+)?(?:este mes|mes pasado|este a[nñ]o|a[nñ]o pasado|hoy|ayer|los [uú]ltimos)\b)|[?!.]*$)/gi;
 const remaining=String(text).replace(re,(all,key,quoted,angle,plain,index)=>{
  if(/\bpor\s*$/i.test(String(text).slice(0,index))&&!/^\s*(?:filtr[aá]|filtrar)/i.test(text))return all;
  assert(!Object.hasOwn(filters,key.toLowerCase()),400,'FILTRO_DUPLICADO','Indicá un único valor para '+key+'.');filters[key.toLowerCase()]=(quoted||angle||plain).trim().replace(/[?!.]+$/,'');return ' ';
 }).replace(/\s+/g,' ').trim();
 return {text:remaining,filters};
}
export async function resolveReportReferences({request,read,branch,conversation}){
 const filters={...request.filters};
 for(const key of ['cliente','proveedor','producto']){
  if(!filters[key])continue;
  const purchase=request.resources.every(r=>['resumenCompras','resumenPedidosCompra'].includes(r));
  assert(key==='producto'||request.resources.length===1,400,'FILTRO_INCOMPATIBLE','Para filtrar un tercero elegí el dashboard de ventas o de compras.');
  assert(key==='producto'||(key==='proveedor')===purchase,400,'FILTRO_INCOMPATIBLE','Usá cliente para ventas y proveedor para compras.');
  assert(read,400,'REFERENCIA_NO_VERIFICADA','Necesito verificar el filtro en el ERP.');
  const resource={cliente:'clientes',proveedor:'proveedores',producto:'productos'}[key],value=filters[key];
  const params={sucursal:branch,limit:'12',...(key!=='producto'&&filters.tienda?{tienda:filters.tienda}:{})};
  let result=await read(resource,new URLSearchParams({...params,codigo:value}));
  if(!result.data?.length)result=await read(resource,new URLSearchParams({...params,q:value}));
  if(result.data?.length!==1||result.meta?.hasMore){
   conversation.reportDraft=structuredClone(request);
   return {reply:{answer:result.data?.length?`Encontré varias opciones para ${key}. ¿Cuál querés usar?`:`No encontré ese ${key} en el ERP. Indicame su código o probá otra parte del nombre.`,choices:(result.data||[]).map(r=>({label:[r.codigo,r.nombre,r.tienda&&'tienda '+r.tienda].filter(Boolean).join(' · '),text:`Filtrá por ${key} "${r.codigo}"${key!=='producto'&&r.tienda?' tienda '+r.tienda:''}`})),evidence:[{id:'F1',action:'consultar_erp',args:{recurso:resource},result}],trace:[]}};
  }
  filters[key]=result.data[0].codigo;if(key!=='producto'&&result.data[0].tienda)filters.tienda=result.data[0].tienda;
 }
 return {filters};
}

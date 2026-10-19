import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { assert, HttpError } from './errors.js';
import { plan, examples } from './planner.js';
import { Changes, changePolicies } from './changes.js';
import { readFileSync } from 'node:fs';
import { createUi } from './ui.js';
import { createVoice } from './voice.js';
import { createIntelligence } from './intelligence/agent.js';

const safeEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b||'');return x.length===y.length && timingSafeEqual(x,y);};
function send(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));}
async function body(req){
  assert((req.headers['content-type']||'').split(';')[0]==='application/json',415,'JSON_REQUERIDO','Usar Content-Type: application/json');
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;assert(bytes<=16384,413,'CUERPO_GRANDE','Máximo 16 KiB');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'JSON_INVALIDO','JSON inválido');}
}
export function createApp({erp,kaiqen,store,mode='live',branches=['0101'],readKey,planKey,writeKey,localWrites=false,voice=createVoice(),model}){
  assert(readKey?.length>=32 && planKey?.length>=32 && readKey!==planKey,500,'CLAVES_INVALIDAS','Configurar dos claves distintas de al menos 32 caracteres');
  assert(!writeKey || (writeKey.length>=32 && writeKey!==readKey && writeKey!==planKey),500,'CLAVES_INVALIDAS','La clave de escritura debe ser distinta y de al menos 32 caracteres');
  const rate=new Map(),ui=createUi({operator:localWrites&&erp.writes?.enabled===true});
  function auth(req){
    const token=/^Bearer ([^\s]+)$/.exec(req.headers.authorization||'')?.[1]||'';
    const session=token?null:ui.principal(req);
    const role=writeKey&&safeEqual(token,writeKey)?'writer':safeEqual(token,planKey)?'planner':safeEqual(token,readKey)?'reader':session?.role;
    assert(role,401,'NO_AUTORIZADO','Bearer token requerido');
    const actor=session?.actor || role+':'+createHash('sha256').update(token).digest('hex').slice(0,12);
    const now=Date.now(),bucket=rate.get(actor);
    if(!bucket || bucket.until<now)rate.set(actor,{count:1,until:now+60_000});
    else {bucket.count++;assert(bucket.count<=120,429,'LIMITE_CONSULTAS','Máximo 120 solicitudes por minuto');}
    return {role,actor};
  }
  async function read(resource,params){
    assert(params.has('sucursal') && branches.includes(params.get('sucursal')),403,'SUCURSAL_NO_AUTORIZADA','Sucursal fuera del alcance de esta instalación');
    const page=params.get('page')??'1',limit=params.get('limit')??'100';
    assert(/^[1-9]\d*$/.test(page) && Number(page)<=100000 && /^[1-9]\d*$/.test(limit) && Number(limit)<=500,400,'PAGINACION_INVALIDA','page 1..100000; limit 1..500');
    for(const key of params.keys())assert(params.getAll(key).length===1,400,'FILTRO_DUPLICADO','Filtro repetido');
    const result=await erp.list(resource,params);
    return {...result,source:{system:'protheus',mode,fetchedAt:new Date().toISOString(),companyScope:'configured_database'},limitations:['Consulta paginada; no representa un total global','Saldo técnico no prueba entrega física']};
  }
  const changes=new Changes({erp,store,read});
  async function executeRead(command){
    const params=new URLSearchParams(command.filters);
    if(command.resource==='proyectos'){
      assert(params.size===0,400,'FILTRO_NO_ADMITIDO','La consulta de proyectos por texto no admite filtros; usar /api/kaiqen/projects');
      return kaiqen.projects();
    }
    if(command.resource==='calidad'){
      assert([...params.keys()].every(k=>k==='proyecto'),400,'FILTRO_NO_ADMITIDO','Calidad admite sólo proyecto');
      return kaiqen.quality(params.get('proyecto')||undefined);
    }
    if(command.resource==='entregas'){
      assert(params.has('sucursal') && branches.includes(params.get('sucursal')),403,'SUCURSAL_NO_AUTORIZADA','Sucursal fuera del alcance de esta instalación');
      return {data:[],source:{system:'sin_conector_logistico',mode},status:'not_configured',limitations:['No se configuró evidencia de recepción física. Un remito emitido no es una entrega confirmada.']};
    }
    if(command.resource==='remitos'){
      assert(!params.has('tipoDocumento') || params.get('tipoDocumento')==='50',400,'TIPO_INCOMPATIBLE','remitos incluye el tipo 50; para otros tipos usar documentosSalida');
      params.set('tipoDocumento','50');
      const result=await read('documentosSalida',params);
      return {...result,limitations:[...result.limitations,'Remitos normales MI tipo 50; devoluciones y transferencias excluidas; clasificación sujeta al diccionario local']};
    }
    return read(command.resource,params);
  }
  const intelligence=createIntelligence({erp,kaiqen,store,read,executeRead,branches,model,prepareChange:(actor,input)=>changes.preview(actor,input)});
  const server=http.createServer(async(req,res)=>{
    try{
      assert(req.url.length<=4096,414,'URL_LARGA','URL demasiado larga');
      const url=new URL(req.url,'http://localhost');
      if(ui.handle(req,res,url.pathname))return;
      if(url.pathname==='/health' && req.method==='GET')return send(res,200,{status:'up',mode});
      const principal=auth(req);
      if(req.method==='GET'&&url.pathname==='/api/agent/status')return send(res,200,await intelligence.status());
      if(req.method==='POST'&&url.pathname==='/api/agent/chat')return send(res,200,await intelligence.query(principal.actor,await body(req),{canPlan:['planner','writer'].includes(principal.role)}));
      if(url.pathname==='/api/agent/knowledge'){
        if(req.method==='GET')return send(res,200,{data:intelligence.memory.list(principal.actor)});
        if(req.method==='POST')return send(res,201,intelligence.memory.add(principal.actor,await body(req)));
      }
      const memoryMatch=/^\/api\/agent\/(knowledge|conversations)\/([a-f0-9-]{36})$/.exec(url.pathname);
      if(memoryMatch?.[1]==='knowledge'&&req.method==='DELETE')return send(res,200,{deleted:intelligence.memory.remove(principal.actor,memoryMatch[2])});
      if(memoryMatch?.[1]==='conversations'&&req.method==='GET')return send(res,200,intelligence.memory.conversation(memoryMatch[2],principal.actor));
      for(const key of url.searchParams.keys())assert(url.searchParams.getAll(key).length===1,400,'FILTRO_DUPLICADO','Filtro repetido');
      if(req.method==='GET' && url.pathname==='/api/capabilities')return send(res,200,{mode,erp:erp.metadata(),kaiqen:{configured:kaiqen.available,source:kaiqen.source||'api',computedQuality:kaiqen.computedQuality!==false},branches,writeExecution:erp.writes?.enabled===true,canExecute:principal.role==='writer'&&erp.writes?.enabled===true,writePolicy:erp.writes?.policy||null,proposalActions:changePolicies,voice:voice.status(),externalAI:false});
      if(req.method==='GET' && url.pathname==='/api/voice/status')return send(res,200,voice.status());
      if(req.method==='POST' && url.pathname==='/api/voice/transcribe')return send(res,200,await voice.transcribe(req));
      if(req.method==='GET' && url.pathname==='/api/openapi.json')return send(res,200,JSON.parse(readFileSync(new URL('../docs/openapi.json',import.meta.url))));
      if(req.method==='GET' && url.pathname==='/api/agent/examples')return send(res,200,{examples});
      let match;
      if(req.method==='GET' && (match=/^\/api\/erp\/([A-Za-z]+)$/.exec(url.pathname))){for(const key of url.searchParams.keys())assert(url.searchParams.getAll(key).length===1,400,'FILTRO_DUPLICADO','Filtro repetido');const result=await executeRead({resource:match[1],filters:Object.fromEntries(url.searchParams)});store.audit(principal.actor,'erp.read',match[1]);return send(res,200,result);}
      if(req.method==='GET' && url.pathname==='/api/kaiqen/projects')return send(res,200,await kaiqen.projects(Object.fromEntries(url.searchParams)));
      if(req.method==='GET' && (match=/^\/api\/kaiqen\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(url.pathname)))return send(res,200,await kaiqen.project(match[1]));
      if(req.method==='GET' && (match=/^\/api\/kaiqen\/quality(?:\/([A-Za-z0-9][A-Za-z0-9_-]{0,127}))?$/.exec(url.pathname)))return send(res,200,await kaiqen.quality(match[1]));
      if(req.method==='GET' && (match=/^\/api\/overview\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(url.pathname))){
        const project=await kaiqen.project(match[1]);
        const results=await Promise.allSettled([kaiqen.quality(match[1]),kaiqen.projectLink?.(match[1])??Promise.reject(new HttpError(503,'VINCULO_NO_CONFIGURADO','Vínculo ERP no configurado'))]);
        let partial=results.some(x=>x.status==='rejected') || project.data?.derivedStateAvailable===false;
        const section=r=>r.status==='fulfilled'?{status:'ok',...r.value}:{status:'unavailable',error:{code:r.reason.code||'SOURCE_ERROR',message:'Fuente no disponible o sin permiso'}};
        let reference={status:'not_linked'};
        const linked=results[1].status==='fulfilled'?results[1].value.data?.articulo_referencia:null;
        if(linked){
          try{
            const product=await kaiqen.product(linked.id);
            const params=new URLSearchParams({sucursal:product.data.sucursal,producto:product.data.codigo,limit:'100'});
            const costs=await read('costos',params);
            reference={status:'ok',purpose:'articulo_de_referencia_para_cotizar',product,costs};
          }catch(error){partial=true;reference={status:'unavailable',error:{code:error.code||'SOURCE_ERROR'}};}
        }
        return send(res,200,{status:partial?'partial':'complete',project,quality:section(results[0]),erpLink:section(results[1]),reference,mode,limitations:['Sin cruces por nombre; el vínculo ERP debe contener una clave explícita','La referencia de cotización puede diferir del producto definitivo; no cubre todas las piezas del proyecto','Consultar source y limitaciones: la lectura DB tiene alcance de planta y no reproduce permisos individuales ni estados derivados de la API']});
      }
      if(req.method==='POST' && ['/api/agent/plan','/api/agent/query'].includes(url.pathname)){
        const input=await body(req);assert(input && typeof input==='object' && !Array.isArray(input),400,'CUERPO_INVALIDO','Objeto JSON requerido');const command=plan(input.text,input.context);
        if(url.pathname.endsWith('/plan'))return send(res,200,command);
        assert(command.kind==='read',409,'PROPUESTA_REQUERIDA','Las modificaciones deben previsualizarse en /api/changes/preview');
        const result=await executeRead(command);store.audit(principal.actor,'agent.read',command.resource);return send(res,200,{plan:command,result});
      }
      if(req.method==='POST' && url.pathname==='/api/changes/preview'){
        assert(['planner','writer'].includes(principal.role),403,'ROL_INSUFICIENTE','Se requiere clave de planificación');
        return send(res,201,await changes.preview(principal.actor,await body(req)));
      }
      if(req.method==='POST' && (match=/^\/api\/changes\/([a-f0-9-]{36})\/check$/.exec(url.pathname))){assert(['planner','writer'].includes(principal.role),403,'ROL_INSUFICIENTE','Se requiere clave de planificación');return send(res,200,await changes.check(principal.actor,match[1]));}
      if(req.method==='GET' && (match=/^\/api\/changes\/([a-f0-9-]{36})$/.exec(url.pathname))){assert(['planner','writer'].includes(principal.role),403,'ROL_INSUFICIENTE','Se requiere permiso de planificación');return send(res,200,changes.status(principal.actor,match[1]));}
      if(req.method==='POST' && (match=/^\/api\/changes\/([a-f0-9-]{36})\/execute$/.exec(url.pathname))){assert(principal.role==='writer',403,'ROL_INSUFICIENTE','Se requiere permiso de escritura');return send(res,200,await changes.execute(principal.actor,match[1],await body(req)));}
      throw new HttpError(404,'RUTA_NO_EXISTE','Ruta inexistente');
    }catch(error){
      const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:503;
      send(res,status,{error:{code:error.code||'FUENTE_NO_DISPONIBLE',message:status<500?error.message:'Fuente o función no disponible; consultar diagnóstico local'},mode});
    }
  });
  server.requestTimeout=20_000;server.headersTimeout=10_000;
  return server;
}

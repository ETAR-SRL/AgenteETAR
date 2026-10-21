import {createAttention} from './attention.js';
import {createInvestigationJobs} from './investigation-jobs.js';
import {CorporateDocuments} from './corporate-documents.js';
import {createCorporateDocumentExtractor} from './corporate-document-extract.js';
import {createApprovedKnowledge} from './approved-knowledge.js';
import {createOperationalChat} from './operational-chat.js';
import {exportFinishedReport} from './finished-reports.js';
import {createExternalPrivacy} from './intelligence/external-privacy.js';
import {createAttentionNotifications} from './attention-notifications.js';
import {createAttentionChat} from './intelligence/attention-chat.js';
import {historyExcel} from './history-excel.js';
import {dashboardAccess} from './dashboard-access.js';
import {createDashboardChat} from './intelligence/dashboard-chat.js';
import {savedDashboards} from './saved-dashboards.js';
import {createFederatedLogin} from './federated-login.js';
import {createModelSettings} from './intelligence/model-settings.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {Access,assertRead,assertAction,canRead,denied} from './access.js';
import {scopeKaiqen} from './kaiqen-access.js';
import {createNetworkAccess} from './network-access.js';
import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { assert, HttpError } from './errors.js';
import { plan, examples } from './planner.js';
import { Changes, changePolicies } from './changes.js';
import { readFileSync } from 'node:fs';
import { createUi } from './ui.js';
import { createVoice } from './voice.js';
import {createDocumentReader} from './intelligence/document-reader.js';
import {createPriceImports,importAction,importProfiles} from './intelligence/price-imports.js';
import {createAttachmentChat} from './intelligence/attachment-chat.js';
import {createModel} from './intelligence/model.js';
import {createPriceBatches} from './intelligence/price-batches.js';
import { createIntelligence } from './intelligence/agent.js';

const safeEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b||'');return x.length===y.length && timingSafeEqual(x,y);};
function rawSend(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));}
async function body(req,maxBytes=16384){
  assert((req.headers['content-type']||'').split(';')[0]==='application/json',415,'JSON_REQUERIDO','Usar Content-Type: application/json');
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;assert(bytes<=maxBytes,413,'CUERPO_GRANDE','Solicitud demasiado grande');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'JSON_INVALIDO','JSON inválido');}
}
export function createApp({erp,kaiqen,store,mode='live',approvalScheduler,branches=['0101'],readKey,planKey,writeKey,localWrites=false,attentionOptions={},notificationOptions={},corporateOptions={},voice=createVoice(),documents=createDocumentReader(),model,modelSettings,network=createNetworkAccess()}){
  assert(readKey?.length>=32 && planKey?.length>=32 && readKey!==planKey,500,'CLAVES_INVALIDAS','Configurar dos claves distintas de al menos 32 caracteres');
  assert(!writeKey || (writeKey.length>=32 && writeKey!==readKey && writeKey!==planKey),500,'CLAVES_INVALIDAS','La clave de escritura debe ser distinta y de al menos 32 caracteres');
  const access=new Access(store,branches),context=new AsyncLocalStorage(),privacy=createExternalPrivacy();
  const principalNow=()=>access.refresh(context.getStore());
  const send=(res,status,value)=>{if(context.getStore())principalNow();return rawSend(res,status,value);};
  const guard=resource=>{const p=principalNow();assertRead(p,resource);return p;};
  const branchGuard=branch=>{const p=principalNow();assert(p?.unrestricted||p?.branches.includes(branch),403,'LECTURA_DENEGADA',denied);};
  const dashboards=savedDashboards(store,{authorize:(_p,resource,branch)=>{guard(resource);branchGuard(branch);assert(branches.includes(branch),403,'LECTURA_DENEGADA',denied);},recipients:(resource,branch)=>{
    const eligible=p=>p&&canRead(p,resource)&&p.branches.includes(branch);
    return {users:access.db.prepare('SELECT id,name,username FROM access_users WHERE active=1 ORDER BY name').all().filter(u=>eligible(access.principal(u.id))).map(({id,name,username})=>({id,name:`${name} (${username})`})),roles:access.db.prepare('SELECT id,name,permissions,branches FROM access_roles ORDER BY name').all().filter(r=>eligible({admin:r.id==='admin',permissions:JSON.parse(r.permissions),branches:JSON.parse(r.branches)})).map(({id,name})=>({id,name}))};
  },legacyActor:actor=>{const id=/^user:([^:]+)/.exec(actor)?.[1],u=id&&access.user(id);return {name:u?`${u.name} (${u.username})`:id?'Usuario eliminado · '+id:'Identidad de servicio',currentName:!!u};},accessReport:input=>dashboardAccess(access,input),assignedNames:targets=>targets.map(t=>{const value=t.kind==='user'?access.user(t.target):access.role(t.target);return {...t,name:value?(t.kind==='user'?`${value.name} (${value.username})`:value.name):'Destinatario eliminado · '+t.target};})});
  const rawErp=erp,rawKaiqen=kaiqen;
  erp={...rawErp,list:async(resource,params)=>{guard(resource);branchGuard(params.get('sucursal'));const value=await rawErp.list(resource,params);principalNow();return value;}};
  if(rawErp.writes){erp.writes={...rawErp.writes};for(const property of ['enabled','policy','creation','escalation'])Object.defineProperty(erp.writes,property,{enumerable:true,get:()=>rawErp.writes[property]});for(const method of ['prepare','check','execute'])erp.writes[method]=async(...args)=>{
    const action=method==='prepare'?args[0]:args[0].action,target=method==='prepare'?args[1].target:args[0].target;
    const p=principalNow();assertAction(p,action,method==='execute');if(method==='execute'&&p.userId)assert(localWrites,403,'ESCRITURA_LOCAL_DESHABILITADA','La ejecución está deshabilitada para usuarios en esta instalación.');branchGuard(target.sucursal);
    return rawErp.writes[method](...args);
  };}
  kaiqen={...rawKaiqen};Object.defineProperty(kaiqen,'computedQuality',{enumerable:true,get:()=>rawKaiqen.computedQuality});for(const [method,resource] of Object.entries({projects:'proyectos',project:'proyectos',quality:'calidad',projectLink:'proyectos',product:'productos'}))if(rawKaiqen[method])kaiqen[method]=async(...args)=>{guard(resource);const value=await rawKaiqen[method](...args);privacy.observe(value);const p=principalNow();return p.admin||p.unrestricted?value:scopeKaiqen(method,value);};
  const rate=new Map(),ui=createUi({access,network});
  function auth(req){
    const token=/^Bearer ([^\s]+)$/.exec(req.headers.authorization||'')?.[1]||'';
    const session=token?null:ui.principal(req);
    const managed=token?access.fromToken(token):session?.userId?session:null;
    const role=managed?.role||(writeKey&&safeEqual(token,writeKey)?'writer':safeEqual(token,planKey)?'planner':safeEqual(token,readKey)?'reader':session?.role);
    assert(role,401,'NO_AUTORIZADO','Bearer token requerido');
    const actor=managed?.actor || session?.actor || role+':'+createHash('sha256').update(token).digest('hex').slice(0,12);
    const now=Date.now(),bucket=rate.get(actor);
    if(!bucket || bucket.until<now)rate.set(actor,{count:1,until:now+60_000});
    else {bucket.count++;assert(bucket.count<=120,429,'LIMITE_CONSULTAS','Máximo 120 solicitudes por minuto');}
    return managed||{role,actor,unrestricted:true};
  }
  async function read(resource,params){
    assert(params.has('sucursal') && branches.includes(params.get('sucursal')),403,'SUCURSAL_NO_AUTORIZADA','Sucursal fuera del alcance de esta instalación');
    const page=params.get('page')??'1',limit=params.get('limit')??'100';
    assert(/^[1-9]\d*$/.test(page) && Number(page)<=100000 && /^[1-9]\d*$/.test(limit) && Number(limit)<=500,400,'PAGINACION_INVALIDA','page 1..100000; limit 1..500');
    for(const key of params.keys())assert(params.getAll(key).length===1,400,'FILTRO_DUPLICADO','Filtro repetido');
    const result=await erp.list(resource,params);
    return {...result,source:{system:'protheus',mode,fetchedAt:new Date().toISOString(),companyScope:'configured_database'},limitations:result.limitations||['Consulta paginada; no representa un total global','Saldo técnico no prueba entrega física']};
  }
  const changes=new Changes({erp,store,read});
  const importGuard=kind=>{
    const profile=importProfiles[kind];assert(profile,400,'DESTINO_INVALIDO','Destino de adjunto inválido.');
    guard('productos');guard(profile.resource);if(profile.party)guard(profile.party);
    if(profile.creation){guard('depositos');if(kind==='crearPedidoCompra')guard('condicionesPago');}
  };
  const authorizeImport=(kind,branch)=>{assertAction(principalNow(),importAction(kind));importGuard(kind);branchGuard(branch);};
  const canUpload=()=>{
    const p=principalNow();
    assert(['planner','writer'].includes(p.role)&&Object.values(importProfiles).some(profile=>canRead(p,profile.resource)&&(p.admin||p.unrestricted||p.permissions?.includes('plan:'+profile.action))),403,'ACCION_DENEGADA','Tu rol no permite preparar actualizaciones desde archivos.');
  };
  const priceBatches=createPriceBatches({store,check:(actor,id)=>changes.check(actor,id),execute:(actor,id,confirmation)=>changes.execute(actor,id,confirmation),authorize:batch=>{
    const p=principalNow();assert(p.role==='writer',403,'ROL_INSUFICIENTE','Se requiere permiso para ejecutar precios.');assertAction(p,batch.action,true);importGuard(batch.kind);branchGuard(batch.branch);
    assert(erp.writes?.enabled,503,'ESCRITURA_DESHABILITADA','El ejecutor no está habilitado.');
    if(p.userId)assert(localWrites,403,'ESCRITURA_LOCAL_DESHABILITADA','La ejecución está deshabilitada para usuarios en esta instalación.');
  }});
  const priceImports=createPriceImports({store,read,authorizeRead:guard,metadata:()=>erp.metadata(),prepare:(actor,input)=>{assertAction(principalNow(),input.action);return changes.preview(actor,input);},createBatch:priceBatches.create});
  async function executeRead(command){
    guard(command.resource);
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
      branchGuard(params.get('sucursal'));
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
  const aiSettings=modelSettings||(model?null:createModelSettings());
  model=privacy.model(model||aiSettings.model);
  const attachmentChat=createAttachmentChat({imports:priceImports,authorize:authorizeImport,model:model||createModel()});
  const dashboardChat=createDashboardChat({dashboards,principal:principalNow,executeRead,read,authorizeRead:guard});
  const attention=createAttention({store,principal:principalNow,read,kaiqen,users:()=>access.db.prepare('SELECT id FROM access_users WHERE active=1 ORDER BY id').all().map(u=>access.principal(u.id)),runAs:async(id,fn)=>{const p=access.principal(id);if(p)return context.run(p,fn);},...attentionOptions});
  const notifications=createAttentionNotifications({attention,principal:principalNow,user:id=>access.principal(id),...notificationOptions});
  let jobs;
  const attentionChat=createAttentionChat({attention,read,executeRead,authorizeRead:guard,authorizePlan:action=>assertAction(principalNow(),action),metadata:()=>erp.metadata(),kaiqen,enqueueInvestigation:(id,branch)=>jobs.create(id,branch)});
  jobs=createInvestigationJobs({store,attention,principal:principalNow,user:id=>access.principal(id),runAs:(id,fn)=>{const p=access.principal(id);assert(p,403,'ACCESO_CAMBIO','Tus permisos cambiaron.');return context.run(p,()=>privacy.run(fn));},investigate:attentionChat.investigate});
  const corporate=new CorporateDocuments({db:store.db,...corporateOptions,resolvePrincipal:id=>access.principal(id),authorize:(p,action)=>action==='manage'?p.admin===true:canRead(p,'documentosCorporativos'),extractBinary:createCorporateDocumentExtractor({documents,root:process.cwd()})});
  const knowledge=createApprovedKnowledge({store,principal:principalNow,user:id=>access.principal(id)});
  async function prepareCase(actor,input){
    assertAction(principalNow(),input.action);const id=input.origin?.attention;
    if(id){const item=attention.get(id);assert(item.branch===input.target?.sucursal&&((item.kind==='sale'&&input.action==='pedidoVenta')||(item.kind==='purchase'&&input.action==='pedidoCompra'))&&item.snapshot.rows.some(r=>String(r.registro)===String(input.target.registro)),403,'LECTURA_DENEGADA',denied);}
    const proposal=await changes.preview(actor,input);if(id)attention.linkProposal(id,{id:proposal.id,status:'prepared',reason:'Propuesta preparada; requiere confirmación explícita.',requiredResources:[changePolicies[input.action].resource]});return proposal;
  }
  const operationalChat=createOperationalChat({documents:corporate,knowledge,jobs,principal:principalNow});
  const prepareConversationCase=(actor,input)=>{if(input.origin?.attention){const item=attention.get(input.origin.attention),related=item.branch===input.target?.sucursal&&((item.kind==='sale'&&input.action==='pedidoVenta')||(item.kind==='purchase'&&input.action==='pedidoCompra'))&&item.snapshot.rows.some(r=>String(r.registro)===String(input.target.registro));if(!related){const {attention:_,...origin}=input.origin;input={...input,origin};}}return prepareCase(actor,input);};
  const intelligence=createIntelligence({attentionChat,operationalChat,privacy,erp,kaiqen,store,read,executeRead,branches,dashboardChat,model,attachmentChat,authorizeRead:guard,authorizePlan:action=>assertAction(principalNow(),action),prepareChange:prepareConversationCase});
  const federated=createFederatedLogin({access,ui});
  const server=http.createServer(async(req,res)=>{
    try{
      network.origin(req);
      assert(req.url.length<=4096,414,'URL_LARGA','URL demasiado larga');
      const url=new URL(req.url,'http://localhost');
      const documentCallback=/^\/api\/corporate-documents\/oauth\/(google|microsoft)\/callback$/.exec(url.pathname);
      if(documentCallback&&req.method==='GET'){
        const name='central_docs_'+documentCallback[1],cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1),state=url.searchParams.get('state');
        res.setHeader('set-cookie',`${name}=; HttpOnly; SameSite=Lax; Path=/api/corporate-documents/oauth; Max-Age=0${req.socket.encrypted?'; Secure':''}`);
        let ok=false;try{assert(typeof state==='string'&&state.length<=100&&cookie&&safeEqual(state,cookie),400,'DOCUMENTOS_STATE','La conexión no corresponde a este navegador.');await corporate.completeConnect({state,code:url.searchParams.get('code'),error:url.searchParams.get('error'),expectedProvider:documentCallback[1],expectedOrigin:ui.local(req)});ok=true;}catch{}
        res.writeHead(303,{location:'/?documents='+(ok?'connected':'failed'),'cache-control':'no-store'});res.end();return;
      }
      if(url.pathname.startsWith('/api/auth/')){
        ui.local(req);
        if(req.method==='GET'&&url.pathname==='/api/auth/providers')return rawSend(res,200,{providers:federated.status(ui.local(req))});
        const oidc=/^\/api\/auth\/oidc\/(google|microsoft)\/(start|callback)$/.exec(url.pathname);
        if(oidc&&oidc[2]==='start'&&req.method==='POST')return rawSend(res,200,await federated.start(oidc[1],req,res));
        if(oidc&&oidc[2]==='callback'&&req.method==='GET'){try{await federated.callback(oidc[1],req,res);res.writeHead(303,{location:'/', 'cache-control':'no-store'});}catch{res.writeHead(303,{location:'/?login=failed','cache-control':'no-store'});}res.end();return;}
        if(req.method==='GET'&&url.pathname==='/api/auth/state')return rawSend(res,200,{setupRequired:!access.hasUsers(),setupAllowed:network.isLocal(req),user:access.fromToken(ui.token(req))});
        if(req.method==='POST'){
          ui.sameOrigin(req);
          if(url.pathname==='/api/auth/logout'){access.logout(ui.token(req));res.setHeader('set-cookie',ui.authCookie('',req));return rawSend(res,200,{ok:true});}
          if(['/api/auth/setup','/api/auth/login'].includes(url.pathname)){
            if(url.pathname.endsWith('/setup'))assert(network.isLocal(req),403,'ALTA_INICIAL_LOCAL','Creá el primer administrador desde la PC que ejecuta Central.');
            const input=await body(req),result=url.pathname.endsWith('/setup')?await access.setup(input):await access.login(input,req.socket.remoteAddress);
            res.setHeader('set-cookie',ui.authCookie(result.token,req));return rawSend(res,200,{user:result.principal});
          }
        }
        throw new HttpError(404,'RUTA_NO_EXISTE','Ruta inexistente');
      }
      if(ui.handle(req,res,url.pathname))return;
      if(url.pathname==='/health' && req.method==='GET')return send(res,200,{status:'up',mode});
      const principal=auth(req);
      return await context.run(principal,()=>privacy.run(async()=>{
      if(url.pathname.startsWith('/api/admin/')){
        access.admin(principal);
        if(url.pathname==='/api/admin/ai'&&aiSettings){
          if(req.method==='GET')return send(res,200,aiSettings.view());
          if(req.method==='PUT'){const result=aiSettings.save(await body(req));store.audit(principal.actor,'ai.configure');return send(res,200,result);}
        }
        if(url.pathname==='/api/admin/ai/test'&&req.method==='POST'&&aiSettings)return send(res,200,await aiSettings.test());
        if(req.method==='GET'&&url.pathname==='/api/admin/access')return send(res,200,access.list(principal));
        if(req.method==='GET'&&url.pathname==='/api/admin/corporate-documents')return send(res,200,{sources:corporate.adminList(principalNow())});
        const target=/^\/api\/admin\/(roles|users)(?:\/([a-f0-9-]{36}|admin))?$/.exec(url.pathname);
        if(target&&['POST','PUT'].includes(req.method)){
          const result=target[1]==='roles'?access.saveRole(principal,await body(req),target[2]):await access.saveUser(principal,await body(req),target[2]);
          return rawSend(res,200,{...result,reauthenticate:target[1]==='users'&&target[2]===principal.userId});
        }
        throw new HttpError(404,'RUTA_NO_EXISTE','Ruta inexistente');
      }
      if(req.method==='GET'&&url.pathname==='/api/sources/status')return send(res,200,{erp:erp.status?.()||{state:'available',available:true},kaiqen:rawKaiqen.status?.()||{state:kaiqen.available?'configured':'not_configured'},ai:await model.status()});
      if(req.method==='POST'&&url.pathname==='/api/reports/export'){
        const report=await exportFinishedReport(await body(req),{read,authorizeRead:guard});principalNow();res.writeHead(200,{'content-type':report.contentType,'content-disposition':`attachment; filename="${report.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(report.buffer);return;
      }
      if(url.pathname==='/api/knowledge'){
        if(req.method==='GET')return send(res,200,knowledge.list({branch:url.searchParams.get('branch')||principal.branches?.[0],q:url.searchParams.get('q')||'',management:url.searchParams.get('management')==='true'}));
        if(req.method==='POST')return send(res,200,knowledge.save(await body(req)));
      }
      const guide=/^\/api\/knowledge\/([a-f0-9-]{36})(\/archive)?$/.exec(url.pathname);
      if(guide){if(req.method==='GET'&&!guide[2])return send(res,200,knowledge.get(guide[1],{management:url.searchParams.get('management')==='true'}));if(req.method==='POST'&&guide[2])return send(res,200,knowledge.archive(guide[1],(await body(req)).revision));}
      if(url.pathname==='/api/corporate-documents'){
        if(req.method==='GET')return send(res,200,{sources:corporate.list(principalNow())});
        if(req.method==='POST'){access.admin(principalNow());const input=await body(req);assert(input?.users?.every(id=>access.user(id)?.active)&&input?.roles?.every(id=>access.role(id)),400,'DOCUMENTOS_DESTINOS','Elegí usuarios activos y roles existentes.');const saved=corporate.configure(principalNow(),input);store.audit(principal.actor,'documents.configure',saved.id);return send(res,200,saved);}
      }
      if(['/api/corporate-documents/search','/api/corporate-documents/read'].includes(url.pathname)&&req.method==='GET'){const args=Object.fromEntries(url.searchParams);if(args.limit)args.limit=Number(args.limit);return send(res,200,await corporate[url.pathname.endsWith('/search')?'search':'read'](principalNow(),args));}
      const docConnection=/^\/api\/corporate-documents\/([\w-]+)\/(connect|disconnect)$/.exec(url.pathname);
      if(docConnection&&req.method==='POST'){
        const p=principalNow();
        if(docConnection[2]==='disconnect'){const result=await corporate.disconnect(p,docConnection[1]);store.audit(p.actor,'documents.disconnect',docConnection[1]);return send(res,200,result);}
        const source=corporate.source(docConnection[1]);corporate.check(p,'connect',source);const settings=corporate.settings(source);assert(new URL(settings.redirectUri).origin===ui.local(req),400,'DOCUMENTOS_REDIRECT','La dirección de retorno debe coincidir con esta dirección HTTPS de Central.');
        const result=corporate.beginConnect(p,source.id);res.setHeader('set-cookie',`central_docs_${source.provider}=${result.state}; HttpOnly; SameSite=Lax; Path=/api/corporate-documents/oauth; Max-Age=300${req.socket.encrypted?'; Secure':''}`);store.audit(p.actor,'documents.connect.start',source.id);return send(res,200,result);
      }
      if(url.pathname==='/api/investigations'){
        if(req.method==='GET')return send(res,200,jobs.list());
        if(req.method==='POST'){const input=await body(req);return send(res,202,jobs.create(input.itemId,input.branch));}
      }
      const investigation=/^\/api\/investigations\/([a-f0-9-]{36})(\/action)?$/.exec(url.pathname);
      if(investigation){if(req.method==='GET'&&!investigation[2])return send(res,200,jobs.get(investigation[1]));if(req.method==='POST'&&investigation[2])return send(res,200,jobs.act(investigation[1],(await body(req)).action));}
      if(req.method==='GET'&&url.pathname==='/api/approvals/automation'){guard('aprobacionesCompras');assert(principal.role==='writer',403,'ROL_REQUERIDO','Requiere operador de escritura');return send(res,200,{status:approvalScheduler?.status()||{enabled:false},...store.escalationHistory()});}
      if(url.pathname.startsWith('/api/price-imports')){
        assert(['planner','writer'].includes(principal.role),403,'ROL_INSUFICIENTE','Se requiere permiso para preparar precios.');
        const batchMatch=/^\/api\/price-imports\/batches\/([a-f0-9-]{36})(\/execute)?$/.exec(url.pathname);
        if(batchMatch){
          const batch=priceBatches.get(principal.actor,batchMatch[1]);assertAction(principalNow(),batch.action);importGuard(batch.kind);branchGuard(batch.branch);
          if(req.method==='GET'&&!batchMatch[2])return send(res,200,batch);
          if(req.method==='POST'&&batchMatch[2])return send(res,200,await priceBatches.run(principal.actor,batch.id,await body(req)));
        }
        if(req.method==='POST'&&url.pathname==='/api/price-imports'){
          const kind=url.searchParams.get('kind')||'pendiente',branch=url.searchParams.get('sucursal');
          canUpload();if(kind!=='pendiente')authorizeImport(kind,branch);branchGuard(branch);assert(branches.includes(branch),403,'SUCURSAL_NO_AUTORIZADA','Sucursal no autorizada.');
          const document=await documents.extract(req);canUpload();branchGuard(branch);if(kind!=='pendiente')authorizeImport(kind,branch);
          return send(res,201,priceImports.save(principal.actor,kind,branch,document));
        }
        const match=/^\/api\/price-imports\/([a-f0-9-]{36})(\/preview|\/invalidate)?$/.exec(url.pathname);
        if(match){const draft=priceImports.get(principal.actor,match[1]);canUpload();branchGuard(draft.branch);if(draft.kind!=='pendiente')authorizeImport(draft.kind,draft.branch);
          if(req.method==='GET'&&!match[2])return send(res,200,draft);
          if(req.method==='POST'&&match[2]==='/invalidate'){priceImports.invalidate(principal.actor,match[1]);return send(res,200,{invalidated:true});}
          if(req.method==='POST'&&match[2]==='/preview')return send(res,200,await priceImports.preview(principal.actor,match[1],await body(req,512000)));
        }
        throw new HttpError(404,'RUTA_NO_EXISTE','Ruta de adjuntos inexistente.');
      }
      if(url.pathname==='/api/dashboards'){
        if(req.method==='GET')return send(res,200,{data:dashboards.list(principal)});
        if(req.method==='POST')return send(res,201,dashboards.save(principal,await body(req)));
      }
      if(url.pathname==='/api/history-filters'){
        if(req.method==='GET')return send(res,200,{data:dashboards.listHistoryFilters(principal)});
        if(req.method==='POST')return send(res,201,dashboards.saveHistoryFilters(principal,await body(req)));
      }
      const presetMatch=/^\/api\/history-filters\/([a-f0-9-]{36})$/.exec(url.pathname);
      if(presetMatch){
        if(req.method==='GET')return send(res,200,dashboards.getHistoryFilters(principal,presetMatch[1]));
        if(req.method==='PATCH'){const input=await body(req);assert(input&&typeof input==='object'&&!Array.isArray(input),400,'FILTROS_INVALIDOS','Objeto JSON requerido.');return send(res,200,Object.hasOwn(input,'filters')||Object.hasOwn(input,'period')?dashboards.updateHistoryFilters(principal,presetMatch[1],input):dashboards.renameHistoryFilters(principal,presetMatch[1],input));}
        if(req.method==='DELETE')return send(res,200,dashboards.removeHistoryFilters(principal,presetMatch[1]));
      }
      const presetVersions=/^\/api\/history-filters\/([a-f0-9-]{36})\/versions$/.exec(url.pathname);
      if(presetVersions&&req.method==='GET'){assert([...url.searchParams.keys()].every(k=>k==='page')&&url.searchParams.getAll('page').length<=1,400,'FILTROS_INVALIDOS','Sólo se admite página.');return send(res,200,dashboards.historyFilterVersions(principal,presetVersions[1],{page:Number(url.searchParams.get('page')||'1')}));}
      if(presetVersions&&req.method==='POST')return send(res,200,dashboards.restoreHistoryFilterVersion(principal,presetVersions[1],await body(req)));
      const undoPreset=/^\/api\/history-filters\/([a-f0-9-]{36})\/undo$/.exec(url.pathname);
      if(undoPreset&&req.method==='POST')return send(res,200,dashboards.undoHistoryFilters(principal,undoPreset[1]));
      const redoPreset=/^\/api\/history-filters\/([a-f0-9-]{36})\/redo$/.exec(url.pathname);
      if(redoPreset&&req.method==='POST')return send(res,200,dashboards.redoHistoryFilters(principal,redoPreset[1]));
      const restorePreset=/^\/api\/history-filters\/([a-f0-9-]{36})\/restore$/.exec(url.pathname);
      if(restorePreset&&req.method==='POST')return send(res,200,dashboards.restoreHistoryFilters(principal,restorePreset[1]));
      const historyMatch=/^\/api\/dashboards\/([a-f0-9-]{36})\/history(\.xlsx)?$/.exec(url.pathname);
      if(historyMatch&&req.method==='GET'){
        assert([...url.searchParams.keys()].every(k=>['page','usuario','autor','destinatario','rol','desde','hasta','tipo'].includes(k)&&url.searchParams.getAll(k).length===1),400,'FILTROS_INVALIDOS','Filtros inválidos o repetidos.');
        const filters=Object.fromEntries([...url.searchParams].filter(([k])=>k!=='page'));
        if(historyMatch[2]){assert(!url.searchParams.has('page'),400,'PAGINACION_INVALIDA','El Excel incluye todo el filtro.');const buffer=await historyExcel({dashboards,principal,id:historyMatch[1],filters});principalNow();res.writeHead(200,{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':'attachment; filename="historial-dashboard.xlsx"','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(buffer);return;}
        return send(res,200,dashboards.history(principal,historyMatch[1],{page:Number(url.searchParams.get('page')||'1'),filters}));
      }
      const inspectMatch=/^\/api\/dashboards\/([a-f0-9-]{36})\/access$/.exec(url.pathname);
      if(inspectMatch&&req.method==='GET')return send(res,200,dashboards.inspect(principal,inspectMatch[1]));
      const revokeMatch=/^\/api\/dashboards\/([a-f0-9-]{36})\/unshare$/.exec(url.pathname);
      if(revokeMatch&&req.method==='POST')return send(res,200,dashboards.unshare(principal,revokeMatch[1],await body(req)));
      const shareMatch=/^\/api\/dashboards\/([a-f0-9-]{36})\/sharing$/.exec(url.pathname);
      if(shareMatch){
        if(req.method==='GET')return send(res,200,dashboards.sharing(principal,shareMatch[1]));
        if(req.method==='PUT')return send(res,200,dashboards.share(principal,shareMatch[1],await body(req)));
      }
      const savedMatch=/^\/api\/dashboards\/([a-f0-9-]{36})$/.exec(url.pathname);
      if(savedMatch){
        if(req.method==='GET')return send(res,200,dashboards.open(principal,savedMatch[1]));
        if(req.method==='DELETE')return send(res,200,dashboards.remove(principal,savedMatch[1]));
      }
      if(url.pathname.startsWith('/api/attention')){
        assert(principal.userId,403,'USUARIO_REQUERIDO','Ingresá con tu usuario para ver tus avisos.');
        if(url.pathname.startsWith('/api/attention/notifications')){
          const origin=ui.local(req);
          if(req.method==='GET'&&url.pathname==='/api/attention/notifications')return send(res,200,notifications.settings());
          if(req.method==='POST'){
            const input=await body(req);
            if(url.pathname==='/api/attention/notifications/subscribe')return send(res,200,notifications.subscribe(input.subscription,origin));
            if(url.pathname==='/api/attention/notifications/status')return send(res,200,notifications.status(input.id,origin));
            if(url.pathname==='/api/attention/notifications/disable')return send(res,200,notifications.disable(input.id,origin));
            if(url.pathname==='/api/attention/notifications/claim')return send(res,200,notifications.claim(input.id,origin));
          }
          throw new HttpError(404,'RUTA_NO_EXISTE','Ruta inexistente');
        }
        const branch=url.searchParams.get('sucursal')||principal.branches[0];branchGuard(branch);
        if(url.pathname==='/api/attention/daily/settings'){if(req.method==='GET')return send(res,200,attention.settings());if(req.method==='PUT')return send(res,200,attention.settings(await body(req)));}
        if(url.pathname==='/api/attention/daily'&&['GET','POST'].includes(req.method)){const b=req.method==='POST'?(await body(req)).sucursal||branch:branch;branchGuard(b);return send(res,200,attention.currentDaily({branch:b,generate:req.method==='POST'}));}
        if(req.method==='GET'&&url.pathname==='/api/attention')return send(res,200,attention.list({branch,following:url.searchParams.get('following')==='true',all:url.searchParams.get('all')==='true'}));
        if(req.method==='POST'&&url.pathname==='/api/attention/review'){void attention.run();return send(res,202,{queued:true,message:'La revisión sigue en segundo plano.'});}
        const alert=/^\/api\/attention\/([a-f0-9-]{36})(\/action)?$/.exec(url.pathname);
        if(alert&&req.method==='GET'&&!alert[2])return send(res,200,{item:attention.get(alert[1])});
        if(alert&&req.method==='POST'&&alert[2])return send(res,200,await attention.act(alert[1],await body(req)));
        throw new HttpError(404,'RUTA_NO_EXISTE','Ruta inexistente');
      }
      if(req.method==='GET'&&url.pathname==='/api/agent/status')return send(res,200,await intelligence.status());
      if(req.method==='POST'&&url.pathname==='/api/agent/chat')return send(res,200,await intelligence.query(principal.actor,await body(req),{canPlan:['planner','writer'].includes(principal.role),allowedBranches:principal.branches||branches}));
      if(url.pathname==='/api/agent/knowledge'){
        if(req.method==='GET')return send(res,200,{data:intelligence.memory.list(principal.actor)});
        if(req.method==='POST')return send(res,201,intelligence.memory.add(principal.actor,await body(req)));
      }
      if(url.pathname==='/api/agent/conversations'&&req.method==='GET')return send(res,200,{data:intelligence.memory.conversations(principal.actor)});
      const memoryMatch=/^\/api\/agent\/(knowledge|conversations)\/([a-f0-9-]{36})$/.exec(url.pathname);
      if(memoryMatch?.[1]==='knowledge'&&req.method==='DELETE')return send(res,200,{deleted:intelligence.memory.remove(principal.actor,memoryMatch[2])});
      if(memoryMatch?.[1]==='conversations'&&['PATCH','DELETE'].includes(req.method))assert(!intelligence.busy(principal.actor),409,'CONVERSACION_OCUPADA','Esperá a que termine la respuesta antes de cambiar conversaciones.');
      if(memoryMatch?.[1]==='conversations'&&req.method==='PATCH')return send(res,200,intelligence.memory.rename(principal.actor,memoryMatch[2],(await body(req)).title));
      if(memoryMatch?.[1]==='conversations'&&req.method==='DELETE')return send(res,200,{deleted:intelligence.memory.deleteConversation(principal.actor,memoryMatch[2])});
      if(memoryMatch?.[1]==='conversations'&&req.method==='GET')return send(res,200,intelligence.memory.conversation(memoryMatch[2],principal.actor));
      for(const key of url.searchParams.keys())assert(url.searchParams.getAll(key).length===1,400,'FILTRO_DUPLICADO','Filtro repetido');
      if(req.method==='GET' && url.pathname==='/api/capabilities')return send(res,200,{mode,user:principal,erp:{...erp.metadata(),entities:Object.fromEntries(Object.entries(erp.metadata().entities).filter(([name])=>canRead(principal,name)))},kaiqen:{configured:kaiqen.available,source:kaiqen.source||'api',computedQuality:kaiqen.computedQuality!==false},branches:principal.branches||branches,writeExecution:erp.writes?.enabled===true,canExecute:principal.role==='writer'&&erp.writes?.enabled===true&&(!principal.userId||localWrites),writePolicy:erp.writes?.policy||null,purchaseCreation:erp.writes?.creation||null,approvalAutomation:canRead(principal,'aprobacionesCompras')?(approvalScheduler?.status()||{enabled:false}):{enabled:false},proposalActions:Object.fromEntries(Object.entries(changePolicies).filter(([action,policy])=>canRead(principal,policy.resource)&&(principal.admin||principal.unrestricted||principal.permissions.includes('plan:'+action)))),voice:voice.status(),documents:documents.status(),externalAI:model.local===false});
      if(req.method==='GET' && url.pathname==='/api/voice/status')return send(res,200,voice.status());
      if(req.method==='POST' && url.pathname==='/api/voice/transcribe')return send(res,200,await voice.transcribe(req));
      if(req.method==='GET' && url.pathname==='/api/openapi.json')return send(res,200,JSON.parse(readFileSync(new URL('../docs/openapi.json',import.meta.url))));
      if(req.method==='GET' && url.pathname==='/api/agent/examples')return send(res,200,{examples});
      let match;
      if(req.method==='GET'&&url.pathname==='/api/erp/status')return send(res,200,erp.status?.()||{state:'available',available:true});
      if(req.method==='GET' && (match=/^\/api\/erp\/([A-Za-z]+)$/.exec(url.pathname))){for(const key of url.searchParams.keys())assert(url.searchParams.getAll(key).length===1,400,'FILTRO_DUPLICADO','Filtro repetido');const result=await executeRead({resource:match[1],filters:Object.fromEntries(url.searchParams)});store.audit(principal.actor,'erp.read',match[1]);return send(res,200,result);}
      if(req.method==='GET' && url.pathname==='/api/kaiqen/projects')return send(res,200,await kaiqen.projects(Object.fromEntries(url.searchParams)));
      if(req.method==='GET' && (match=/^\/api\/kaiqen\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(url.pathname)))return send(res,200,await kaiqen.project(match[1]));
      if(req.method==='GET' && (match=/^\/api\/kaiqen\/quality(?:\/([A-Za-z0-9][A-Za-z0-9_-]{0,127}))?$/.exec(url.pathname)))return send(res,200,await kaiqen.quality(match[1]));
      if(req.method==='GET' && (match=/^\/api\/overview\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/.exec(url.pathname))){
        guard('proyectos');guard('calidad');guard('costos');
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
        const input=await body(req);assertAction(principal,input.action);return send(res,201,await prepareCase(principal.actor,input));
      }
      if(req.method==='POST' && (match=/^\/api\/changes\/([a-f0-9-]{36})\/renew-attention$/.exec(url.pathname))){const p=store.get(match[1],principal.actor);assert(p,404,'PROPUESTA_NO_EXISTE','Propuesta inexistente');assertAction(principalNow(),p.action);assert(p.origin?.attention&&['pedidoVenta','pedidoCompra'].includes(p.action),404,'PROPUESTA_NO_EXISTE','No hay una propuesta del seguimiento para revisar.');const item=attention.get(p.origin.attention);assert(item.branch===p.target.sucursal&&item.snapshot.rows?.some(r=>r.registro===p.target.registro)&&((p.action==='pedidoVenta'&&item.kind==='sale')||(p.action==='pedidoCompra'&&item.kind==='purchase')),403,'LECTURA_DENEGADA',denied);return send(res,200,await changes.renewAttention(principal.actor,p.id));}
      if(req.method==='POST' && (match=/^\/api\/changes\/([a-f0-9-]{36})\/check$/.exec(url.pathname))){assert(['planner','writer'].includes(principal.role),403,'ROL_INSUFICIENTE','Se requiere clave de planificación');return send(res,200,await changes.check(principal.actor,match[1]));}
      if(req.method==='GET' && (match=/^\/api\/changes\/([a-f0-9-]{36})$/.exec(url.pathname))){assert(['planner','writer'].includes(principal.role),403,'ROL_INSUFICIENTE','Se requiere permiso de planificación');const saved=store.get(match[1],principal.actor);if(saved)assertAction(principal,saved.action);return send(res,200,changes.status(principal.actor,match[1]));}
      if(req.method==='POST' && (match=/^\/api\/changes\/([a-f0-9-]{36})\/execute$/.exec(url.pathname))){assert(principal.role==='writer',403,'ROL_INSUFICIENTE','Se requiere permiso de escritura');const saved=store.get(match[1],principal.actor);if(saved?.origin?.attention)attention.get(saved.origin.attention);const result=await changes.execute(principal.actor,match[1],await body(req));if(saved?.origin?.attention)attention.linkProposal(saved.origin.attention,{id:saved.id,status:result.status||'verified',reason:'Resultado registrado por el circuito de confirmación; consultar el comprobante de ejecución.',requiredResources:[changePolicies[saved.action].resource]});return send(res,200,result);}
      throw new HttpError(404,'RUTA_NO_EXISTE','Ruta inexistente');
      }));
    }catch(error){
      const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:503;
      send(res,status,{error:{code:error.code||'FUENTE_NO_DISPONIBLE',message:error.code==='PROTHEUS_NO_DISPONIBLE'?'Protheus está sin conexión. Voy a reconectar automáticamente cuando vuelva la red o VPN.':status<500?error.message:'Fuente o función no disponible; consultar diagnóstico local'},mode});
    }
  });
  server.requestTimeout=20_000;server.headersTimeout=10_000;
  server.attention=attention;
  server.notifications=notifications;
  server.jobs=jobs;
  return server;
}

import Decimal from 'decimal.js';
import {randomUUID} from 'node:crypto';
import {AttentionStore} from './attention-store.js';
import {canRead} from './access.js';
import {assert} from './errors.js';
const resources={sale:'atencionVentas',purchase:'atencionCompras',remit:'atencionRemitos'};
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const day=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}).format(d);
const age=(date,today)=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')?Math.max(0,Math.floor((Date.parse(today)-Date.parse(date))/86400000)):null;
const denied=e=>e.status===403||['LECTURA_DENEGADA','ACCESO_CAMBIO'].includes(e.code);
export const itemResources=item=>item.kind==='kaiqen'?['proyectos','calidad','productos']: [resources[item.kind]];
export function permitted(principal,item){return !!principal?.userId&&principal.branches.includes(item.branch)&&itemResources(item).every(r=>canRead(principal,r));}
const identity=(kind,branch,r)=>({kind,branch,numero:r.numero,serie:r.serie||'',tercero:r.tercero,tienda:r.tienda});
const key=t=>[t.kind,t.branch,t.numero,t.serie,t.tercero,t.tienda].join(':');
const fields='registro numero serie item producto tercero tienda nombre unidad fecha moneda monedaNombre cantidad pedida atendida precio importe devuelta vigente pedidoVenta itemPedidoVenta'.split(' ');
export function documentSnapshot(target,rows,today){
 assert(rows.length>0,503,'DOCUMENTO_NO_VERIFICADO','No se pudo verificar el documento.');
 assert(rows.every(r=>r.kind===target.kind&&r.sucursal===target.branch&&r.numero===target.numero&&(r.serie||'')===(target.serie||'')&&r.tercero===target.tercero&&r.tienda===target.tienda),503,'VINCULO_NO_VERIFICADO','No se pudo verificar la identidad del documento.');
 assert(new Set(rows.map(r=>r.registro)).size===rows.length,503,'VINCULO_NO_VERIFICADO','Hay registros duplicados.');
 const pending=rows.filter(r=>Number(r.vigente)===1&&new Decimal(r.cantidad).gt(0));
 const overdue=target.kind==='remit'?pending:pending.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.fecha||'')&&r.fecha<today);
 const groups=new Map();for(const r of pending){const k=JSON.stringify([r.moneda,r.unidad]);const g=groups.get(k)||{moneda:r.moneda,monedaNombre:r.monedaNombre,unidad:r.unidad,cantidad:new Decimal(0),importe:new Decimal(0)};g.cantidad=g.cantidad.plus(r.cantidad);g.importe=g.importe.plus(r.importe);groups.set(k,g);}
 const complete=rows.every(r=>new Decimal(r.pedida).gt(0)&&new Decimal(r.atendida).gte(r.pedida));
 return {title:target.kind==='sale'?'Pedido de venta con entrega vencida':target.kind==='purchase'?'Pedido de compra con fecha prevista vencida':'Remito pendiente de facturar',numero:target.numero,serie:target.serie,tercero:target.tercero,tienda:target.tienda,nombre:rows[0].nombre||null,fecha:overdue.map(r=>r.fecha).filter(Boolean).sort()[0]||pending.map(r=>r.fecha).filter(Boolean).sort()[0]||null,fechaTipo:target.kind==='remit'?'Emisión del remito':'Entrega prevista',attention:overdue.length>0,overdueItems:overdue.length,pendingItems:pending.length,goalComplete:complete,closedOther:pending.length===0&&!complete,groups:[...groups.values()].map(g=>({...g,cantidad:g.cantidad.toFixed(),importe:g.importe.toFixed(),...(g.unidad==='UN'?{millares:g.cantidad.div(1000).toFixed()}:{})})),rows:rows.map(r=>Object.fromEntries(fields.filter(f=>r[f]!==undefined).map(f=>[f,r[f]])))};
}
export function createAttention({store,principal,users,runAs,read,kaiqen,clock=()=>new Date(),enabled=true,intervalMs=300000,maxDocuments=5,maxUsers=5}){
 assert(Number.isInteger(intervalMs)&&intervalMs>=30000&&intervalMs<=86400000,500,'CONFIGURACION_INVALIDA','ATTENTION_POLL_MS debe estar entre 30000 y 86400000.');
 const db=new AttentionStore(store,{clock}),token=randomUUID();let timer,running=null,stopped=false;
 const current=()=>{const p=principal();assert(p?.userId,403,'USUARIO_REQUERIDO','Ingresá con tu usuario para usar tus seguimientos.');return p;};
 const authorize=item=>{const p=current();assert(permitted(p,item),403,'LECTURA_DENEGADA','Esto no podés leerlo.');return p;};
 const owner=()=>current().userId;
 const lookup=id=>{const r=db.get(owner(),id);assert(r,404,'AVISO_NO_EXISTE','No encontré ese aviso o seguimiento.');authorize(r);return r;};
 const readRows=async target=>{
  authorize({kind:target.kind,branch:target.branch});const result=[];let cursor='0';
  for(let page=0;page<5;page++){
   const filters={sucursal:target.branch,hoy:day(clock()),numero:target.numero,tercero:target.tercero,tienda:target.tienda,cursor,limit:'100',...(target.kind==='remit'?{serie:target.serie}:{})};
   const r=await read(resources[target.kind],new URLSearchParams(filters));result.push(...r.data);if(!r.meta?.hasMore)return result;cursor=r.meta.cursor;
  }
  throw Object.assign(new Error('El documento supera el alcance de la revisión.'),{status:503,code:'ALCANCE_PARCIAL'});
 };
 const applyGoals=row=>{const f=db.db.prepare('SELECT * FROM op_follows WHERE owner=? AND item=?').get(owner(),row.id);if(f&&f.state!=='cancelled')db.finish(owner(),row.id,row.snapshot.goalComplete?'completed':row.snapshot.closedOther?'needs_review':'active');return db.get(owner(),row.id);};
 const putDocument=async(target,beforeSave=()=>{})=>{const rows=await readRows(target),snapshot=documentSnapshot(target,rows,day(clock())),previous=db.byKey(owner(),key(target));const present=new Set(rows.map(r=>r.registro));snapshot.missingItems=[...new Set([...(previous?.snapshot.missingItems||[]),...(previous?.snapshot.rows||[]).map(r=>r.registro)])].filter(id=>!present.has(id));if(snapshot.missingItems.length){snapshot.goalComplete=false;if(!snapshot.pendingItems)snapshot.closedOther=true;}authorize({kind:target.kind,branch:target.branch});beforeSave();return applyGoals(db.upsert(owner(),{key:key(target),branch:target.branch,kind:target.kind,target,snapshot,status:snapshot.attention?'active':'resolved'}));};
 function projectProblems(detail,quality,today){
  const problems=[];
  for(const p of detail.data.phases||[])if(p.planned_end?.slice(0,10)<today&&!p.actual_end&&/^\d{4}-\d{2}-\d{2}/.test(p.planned_end))problems.push({id:'phase:'+p.id,type:'phase',title:p.name||'Fase',date:p.planned_end.slice(0,10),fact:'La fecha prevista de cierre venció y no hay cierre real registrado.'});
  for(const r of quality.data.domains?.noConformidades?.registros||[])if(!r.closure_date&&['open','abierta','abierto','in_progress','en tratamiento','en_tratamiento','en_proceso'].includes(norm(r.state)))problems.push({id:'nc:'+r.id,type:'nc',title:r.title||r.nc_no||'No conformidad',date:r.report_date?.slice(0,10)||null,fact:'No conformidad en estado '+r.state+' y sin fecha de cierre.'});
  const states=quality.data.issueStatusCatalog||[];
  for(const r of quality.data.domains?.problemas?.registros||[]){const s=states.find(s=>String(s.id)===String(r.status_id));if(!r.closed_date&&['open','in_progress','abierto','abierta','en_curso','blocked'].includes(norm(s?.code)))problems.push({id:'issue:'+r.id,type:'issue',title:r.title||'Problema',date:r.due_date?.slice(0,10)||null,fact:'Problema registrado en estado '+(s.name||s.code)+'.'});}
  return problems;
 }
 const projectSnapshot=async(projectId,branch)=>{
  authorize({kind:'kaiqen',branch});
  const [detail,link,quality]=await Promise.all([kaiqen.project(projectId),kaiqen.projectLink(projectId),kaiqen.quality(projectId)]);
  const candidates=[];if(link.data.articulo_referencia)candidates.push(link.data.articulo_referencia);
  for(const part of (link.data.piezasDetalle||[]).slice(0,20))if(part.erp_producto_id&&!candidates.some(p=>p.id===part.erp_producto_id))candidates.push((await kaiqen.product(part.erp_producto_id)).data);
  const products=[];
  for(const ref of candidates.slice(0,20)){if(!ref?.codigo||!ref.sucursal||ref.baja_en_erp_en)continue;const r=await read('productos',new URLSearchParams({sucursal:branch,codigo:ref.codigo,limit:'2'}));if(r.data.length===1&&!r.meta?.hasMore&&r.data[0].codigo===ref.codigo&&r.data[0].sucursal===ref.sucursal)products.push({codigo:ref.codigo,sucursal:ref.sucursal});}
  assert(products.length>0,503,'RELACION_NO_VERIFICADA','No hay una relación de producto verificable con esta sucursal.');
  const complete=!link.data.hasMore&&!(link.data.piezasDetalle?.length>20)&&!Object.values(detail.data.truncated||{}).some(Boolean)&&!Object.values(quality.data.domains||{}).some(d=>d.hasMore||d.recordsHasMore);
  const problems=projectProblems(detail,quality,day(clock()));
  assert(complete||problems.length>0,503,'ALCANCE_PARCIAL','La lectura parcial no permite dar el problema por resuelto.');
  authorize({kind:'kaiqen',branch});return {title:'Proyecto o calidad necesita atención',projectId,projectName:detail.data.project?.name||projectId,products,problems,complete,attention:problems.length>0,fecha:problems.map(p=>p.date).filter(Boolean).sort()[0]||null,fechaTipo:'Fecha registrada en KAIQEN',goalComplete:!problems.length&&complete,groups:[]};
 };
 const review=async(item,beforeSave=()=>{})=>{
  authorize(item);try{let row;if(item.kind==='kaiqen'){const snapshot=await projectSnapshot(item.target.projectId,item.branch);beforeSave();row=db.upsert(owner(),{key:item.key,branch:item.branch,kind:item.kind,target:item.target,snapshot,status:snapshot.attention?'active':'resolved'});}else row=await putDocument(item.target,beforeSave);authorize(row);
   const f=db.db.prepare('SELECT * FROM op_follows WHERE owner=? AND item=?').get(owner(),row.id);if(f&&f.state!=='cancelled'){if(row.snapshot.goalComplete)db.finish(owner(),row.id,'completed');else if(row.snapshot.closedOther)db.finish(owner(),row.id,'needs_review');else if(f.state!=='active')db.finish(owner(),row.id,'active');}return db.get(owner(),row.id);
  }catch(e){if(denied(e))throw e;authorize(item);beforeSave();db.unavailable(owner(),item.id);return db.get(owner(),item.id);}
 };
 const view=item=>{authorize(item);const now=clock(),s=item.snapshot;return {...item,...db.news(owner(),item.id),ageDays:age(s.fecha,day(now)),historical:item.status==='unknown',visible:item.preference==='visible'||item.preference==='snoozed'&&item.until_at<=now.toISOString(),evidence:{source:item.kind==='kaiqen'?'KAIQEN · vínculo de catálogo verificado':'Protheus · lectura estructurada',checkedAt:item.checked,lastSuccess:item.last_success},kindLabel:item.kind==='sale'?'Pedido de venta':item.kind==='purchase'?'Pedido de compra':item.kind==='remit'?'Remito':'Proyecto y calidad'};};
 const list=({branch,following=false,all=false}={})=>{
  const p=current();assert(p.branches.includes(branch),403,'LECTURA_DENEGADA','Esto no podés leerlo.');
  const rows=db.rows(p.userId,branch).filter(i=>permitted(p,i)&&(!following||i.follow_state&&i.follow_state!=='cancelled')).map(view);
  const data=all||following?rows:rows.filter(i=>i.visible&&(i.status!=='resolved'||i.hasNews||i.follow_state==='active'||i.follow_state==='needs_review'));
  const sources=Object.entries(resources).filter(([kind])=>permitted(p,{kind,branch})).map(([kind,r])=>({name:kind==='sale'?'Pedidos de venta':kind==='purchase'?'Pedidos de compra':'Remitos',...db.source(p.userId,branch,r)}));
  if(permitted(p,{kind:'kaiqen',branch}))sources.push({name:'Proyectos y calidad',...db.source(p.userId,branch,'kaiqen')});
  return {data,sources,accessRevision:p.revision,status:{enabled,intervalMs,running:!!running,lastReview:db.value('lastRun'),nextReview:db.value('nextRun')},summary:'Avisos personales. Los datos sin verificar conservan la última lectura, identificada como histórica.'};
 };
 const resolve=async({kind,branch,numero,serie,tercero,tienda})=>{
  authorize({kind,branch});assert(resources[kind],400,'REFERENCIA_INVALIDA','Indicá pedido de venta, compra o remito.');
  const r=await read(resources[kind],new URLSearchParams({sucursal:branch,hoy:day(clock()),numero,limit:'100',...(serie?{serie}:{}),...(tercero?{tercero}:{}),...(tienda?{tienda}:{})}));
  const choices=[...new Map(r.data.map(row=>{const t=identity(kind,branch,row);return [key(t),t];})).values()];
  assert(choices.length,404,'DOCUMENTO_NO_EXISTE','No encontré ese documento en esta sucursal.');
  if(choices.length>1)return {choices};return {item:await putDocument(choices[0])};
 };
 const act=async(id,input)=>{
  assert(input&&['follow','cancel','snooze','dismiss','show','changes','review','seen'].includes(input.action),400,'ACCION_INVALIDA','Acción de seguimiento inválida.');
  let item=lookup(id);
  if(input.action==='seen'){db.seen(owner(),id);return {item:view(lookup(id))};}
  if(input.action==='review')return {item:view(await review(item))};
  if(input.action==='changes')return {item:view(item),changes:db.events(owner(),id,true),historical:true};
  if(input.action==='follow'){item=await review(item);assert(item.status!=='unknown',503,'FUENTE_NO_DISPONIBLE','No pude verificar el documento. No guardé un objetivo con datos sin verificar.');const goal=item.kind==='remit'?'invoice_recorded':item.kind==='kaiqen'?'problem_cleared':'attention_recorded';db.follow(owner(),id,goal);if(item.snapshot.goalComplete)db.finish(owner(),id,'completed');}
  if(input.action==='cancel')db.finish(owner(),id,'cancelled');
  if(input.action==='snooze'){const until=new Date(input.until);assert(Number.isFinite(+until)&&until>clock()&&+until-+clock()<=366*86400000,400,'FECHA_INVALIDA','Elegí una fecha futura dentro de un año.');db.preference(owner(),id,{mode:'snoozed',until:until.toISOString(),onChange:input.onChange===true});}
  if(input.action==='dismiss')db.preference(owner(),id,{mode:'dismissed',onChange:input.onChange===true});
  if(input.action==='show')db.preference(owner(),id,{mode:'visible'});
  store.audit(current().actor,'attention.'+input.action,id);item=lookup(id);return {item:view(item),saved:true};
 };
 async function cycle(){
  if(!db.lease(token))return;const start=clock();try{
   const people=users().filter(p=>p?.userId),offset=db.value('usersCursor',0)%Math.max(1,people.length),selected=Array.from({length:Math.min(maxUsers,people.length)},(_,i)=>people[(offset+i)%people.length]);
   for(const p of selected){if(stopped)break;await runAs(p.userId,async()=>{
    for(const branch of current().branches){
     const due=db.rows(owner(),branch).filter(i=>permitted(current(),i)&&(!i.next_check||i.next_check<=db.now())&&(i.status!=='resolved'||['active','needs_review'].includes(i.follow_state))).sort((a,b)=>(a.checked||'').localeCompare(b.checked||''));
     const tracked=i=>['active','needs_review'].includes(i.follow_state);
     for(const item of [...due.filter(tracked).slice(0,maxDocuments),...due.filter(i=>!tracked(i)).slice(0,maxDocuments)]){if(stopped)break;assert(db.lease(token),503,'REVISION_OCUPADA','Otra revisión está en curso.');await review(item,()=>assert(db.lease(token),503,'REVISION_OCUPADA','Otra revisión está en curso.'));}
     for(const [kind,resource]of Object.entries(resources)){
      if(stopped||!permitted(current(),{kind,branch}))continue;const state=db.source(owner(),branch,resource);if(state?.next_check>db.now())continue;
      try{const result=await read(resource,new URLSearchParams({sucursal:branch,hoy:day(clock()),cursor:state?.cursor||'0',limit:'100'}));const documents=new Set();let cursor=state?.cursor||'0',ended=true;
       for(const r of result.data){const target=identity(kind,branch,r),k=key(target);if(!documents.has(k)){if(documents.size>=maxDocuments){ended=false;break;}documents.add(k);assert(db.lease(token),503,'REVISION_OCUPADA','Otra revisión está en curso.');await putDocument(target,()=>assert(db.lease(token),503,'REVISION_OCUPADA','Otra revisión está en curso.'));}cursor=r.registro;}
       authorize({kind,branch});db.sourceResult(owner(),branch,resource,{ok:true,cursor:ended&&!result.meta?.hasMore?'0':cursor});
      }catch(e){if(denied(e))throw e;db.sourceResult(owner(),branch,resource,{ok:false});}
     }
     if(!stopped&&permitted(current(),{kind:'kaiqen',branch})){
      const state=db.source(owner(),branch,'kaiqen');if(!state?.next_check||state.next_check<=db.now())try{const offset=Number(state?.cursor||0),r=await kaiqen.projects({offset,limit:5});for(const p of r.data){try{const snapshot=await projectSnapshot(p.id,branch);if(snapshot.attention||db.byKey(owner(),'kaiqen:'+branch+':'+p.id)){assert(db.lease(token),503,'REVISION_OCUPADA','Otra revisión está en curso.');applyGoals(db.upsert(owner(),{key:'kaiqen:'+branch+':'+p.id,kind:'kaiqen',branch,target:{projectId:p.id,branch,kind:'kaiqen'},snapshot,status:snapshot.attention?'active':'resolved'}));}}catch(e){if(denied(e))throw e;if(e.code!=='RELACION_NO_VERIFICADA')throw e;}}authorize({kind:'kaiqen',branch});db.sourceResult(owner(),branch,'kaiqen',{ok:true,cursor:(r.pagination?.hasMore||r.pagination?.total>offset+r.data.length)?String(offset+r.data.length):'0'});}catch(e){if(denied(e))throw e;db.sourceResult(owner(),branch,'kaiqen',{ok:false});}
     }
    }
   }).catch(()=>{});}
   db.set('usersCursor',offset+selected.length);db.set('lastRun',start.toISOString());db.set('nextRun',new Date(+clock()+intervalMs).toISOString());
  }finally{db.release(token);}
 }
 const service={db,list,resolve,act,get:id=>view(lookup(id)),review,projectSnapshot,
  acknowledge(id){const item=lookup(id);db.seen(owner(),item.id);},
  async refresh(id){return view(await review(lookup(id)));},
  run(){if(stopped||!enabled)return Promise.resolve();if(running)return running;running=cycle().catch(()=>{try{db.set('lastFailure',clock().toISOString());db.set('nextRun',new Date(+clock()+intervalMs).toISOString());}catch{}}).finally(()=>{running=null;});return running;},
  start(){if(timer||!enabled||stopped)return;void service.run();timer=setInterval(()=>void service.run(),intervalMs);timer.unref?.();},
  async stop(){stopped=true;clearInterval(timer);await running;}
 };
 return service;
}

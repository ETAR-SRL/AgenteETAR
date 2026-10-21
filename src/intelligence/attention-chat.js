import {salesOrderJourney} from './sales-order-journey.js';
import {supplierJourney} from './supplier-journey.js';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^[¿¡]|[?!.]+$/g,'').trim();
export function snoozeUntil(text,now=new Date()){
 const n=norm(text),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}).format(now),d=new Date(today+'T12:00:00Z');
 const days=['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
 if(/manana/.test(n))d.setUTCDate(d.getUTCDate()+1);
 else if(days.some(day=>n.includes(day))){const target=days.findIndex(day=>n.includes(day));d.setUTCDate(d.getUTCDate()+((target-d.getUTCDay()+7)%7||7));}
 else{const date=/\b(\d{4}-\d{2}-\d{2})\b/.exec(n)?.[1];if(!date)return null;return date+'T08:00:00-03:00';}
 return d.toISOString().slice(0,10)+'T08:00:00-03:00';
}
export function createAttentionChat({attention,read,executeRead,authorizeRead,authorizePlan=()=>{},metadata,kaiqen,clock=()=>new Date()}){
 const response=(answer,extra={})=>({answer,evidence:[],trace:[],...extra});
 const formatChoice=t=>`${t.kind==='sale'?'pedido de venta':t.kind==='purchase'?'pedido de compra':'remito'} ${t.numero}${t.serie?' serie '+t.serie:''} · ${t.tercero} / ${t.tienda}`;
 async function investigate(item,conversation,branch){
  item=await attention.refresh(item.id);conversation.attentionContext={id:item.id,branch};
  if(item.status==='unknown')return response('No pude verificar la fuente ahora. El aviso sigue abierto; la última lectura está identificada como histórica.',{attention:{data:[item]},investigation:{facts:[],possibleCauses:[],unavailable:['No hay una lectura actual del documento. No lo di por resuelto.']}});
  const s=item.snapshot,facts=[],possibleCauses=[],unavailable=[];let journey;
  if(item.kind==='sale'){
   journey=await salesOrderJourney({text:'Analizá el pedido de venta '+item.target.numero,conversation,branch,read,executeRead,authorizeRead,metadata:metadata()});
   const releases=journey?.evidence?.find(e=>e.args.recurso==='liberacionesVentas')?.result.data||[];
   for(const r of releases)if(!r.remito&&!r.factura){for(const [field,label]of [['bloqueoCredito','crédito'],['bloqueoStock','stock']])if(r[field]?.descripcion&&(field==='bloqueoCredito'?['01','04','09']:['02','03']).includes(r[field].codigo)){facts.push('La liberación del ítem '+r.item+' registra '+label+': '+r[field].descripcion+'.');possibleCauses.push('Ese bloqueo requiere revisión; el registro por sí solo no prueba que haya causado toda la demora.');}}
  }else if(item.kind==='purchase'){
   journey=await supplierJourney({text:`Analizá el proveedor ${item.target.tercero} tienda ${item.target.tienda}`,conversation,branch,read,executeRead,authorizeRead,metadata:metadata()});
   try{authorizeRead('recepcionesCompras');const receipts=await read('recepcionesCompras',new URLSearchParams({sucursal:branch,pedido:item.target.numero,proveedor:item.target.tercero,tienda:item.target.tienda,limit:'100'}));const rows=receipts.data.filter(r=>s.rows.some(i=>i.item===r.itemPedidoCompra&&i.producto===r.productoCodigo));facts.push(rows.length+' entradas documentales vinculadas por pedido, ítem y producto en las filas leídas; no certifican recepción física.');journey.evidence.push({id:'F'+(journey.evidence.length+1),action:'consultar_erp',args:{recurso:'recepcionesCompras'},result:{...receipts,data:rows}});}catch{unavailable.push('No pude verificar las entradas documentales de este pedido con tus permisos actuales.');}
  }else if(item.kind==='kaiqen'){
   facts.push(...s.problems.map(p=>p.title+': '+p.fact));facts.push('Vínculo confirmado con productos '+s.products.map(p=>p.codigo).join(', ')+'. No demuestra que afecte una entrega.');
  }else{
   const refs=[...new Set(s.rows.map(r=>r.pedidoVenta).filter(Boolean))];
   for(const order of refs.slice(0,3))try{authorizeRead('documentosPedidoVenta');const linked=await read('documentosPedidoVenta',new URLSearchParams({sucursal:branch,pedido:order,numero:s.numero,serie:s.serie,cliente:s.tercero,tienda:s.tienda,documentos:'remitos',limit:'100'}));if(linked.data.some(d=>s.rows.some(r=>r.registro===d.registro))){const context=refs.length===1?conversation:structuredClone(conversation);const result=await salesOrderJourney({text:'Analizá el pedido de venta '+order,conversation:context,branch,read,executeRead,authorizeRead,metadata:metadata()});if(result){journey=journey?{answer:journey.answer+'\n\n'+result.answer,evidence:[...journey.evidence,...result.evidence],trace:[...journey.trace,...result.trace]}:result;facts.push('El remito tiene una relación verificada con el pedido de venta '+order+'. El recorrido de ese pedido puede incluir otros remitos y facturas.');}}}catch{unavailable.push('No pude verificar un recorrido de pedido asociado con tus permisos actuales.');}
   facts.push('El saldo de facturación se obtuvo del remito normal, por documento, serie, cliente, tienda e ítem.');unavailable.push('El saldo no identifica por sí solo la factura ni confirma recepción física. Pedime el recorrido del pedido si querés investigar su circuito documental.');}
  if(item.kind!=='kaiqen'){
   facts.unshift(`${item.kind==='remit'?'Remito':'Pedido'} ${s.numero}${s.serie?' / '+s.serie:''}: ${s.pendingItems} ítems con cantidad pendiente; ${s.overdueItems} requieren atención por la condición verificada.`);
   const products=new Set(s.rows.map(r=>r.producto));
   const related=attention.list({branch,all:true}).data.filter(i=>i.kind==='kaiqen'&&i.status!=='unknown'&&i.snapshot.products.some(p=>products.has(p.codigo)));
   for(const p of related){const fresh=await attention.refresh(p.id);if(fresh.status==='unknown'){unavailable.push('No pude releer el estado del proyecto relacionado.');continue;}facts.push('Proyecto relacionado por producto verificado: '+fresh.snapshot.projectName+'.');facts.push(...fresh.snapshot.problems.map(p=>p.title+': '+p.fact));possibleCauses.push('El problema de proyecto/calidad está relacionado por producto, pero no hay evidencia de que haya causado esta demora.');}
   if(!related.length)unavailable.push('No hay un problema de KAIQEN verificado y accesible relacionado en la última revisión. No atribuí la demora a calidad o al proyecto.');
  }
  if(journey){for(const t of journey.trace||[])if(t.status!=='ok')unavailable.push('Una sección del recorrido no estuvo disponible con tus permisos actuales.');}
  if(!possibleCauses.length)possibleCauses.push('No hay evidencia suficiente para determinar una causa. Hace falta una comprobación operativa; no la atribuí a stock, crédito, calidad ni producción.');
  attention.acknowledge(item.id);item=attention.get(item.id);
  return response('Revisé el caso con datos actuales. Abajo tenés los hechos, lo que conviene investigar y el recorrido disponible.',{attention:{data:[item]},investigation:{facts,possibleCauses:[...new Set(possibleCauses)],unavailable:[...new Set(unavailable)],details:journey?(item.kind==='purchase'?'Contexto general del proveedor: los precios, compras y saldos pueden incluir otros pedidos.\n\n':'')+journey.answer:null,evidenceAt:item.checked},evidence:journey?.evidence||[]});
 }
 return async({text,conversation,branch,attentionId})=>{
  if(attentionId!==undefined&&(typeof attentionId!=='string'||!/^[a-f0-9-]{36}$/.test(attentionId)))return response('No pude identificar ese aviso. Volvé a abrir su tarjeta.');
  const n=norm(text),id=typeof attentionId==='string'&&/^[a-f0-9-]{36}$/.test(attentionId)?attentionId:/\baviso\s+([a-f0-9-]{36})\b/.exec(n)?.[1];
  if(conversation.attentionContext?.branch!==branch)delete conversation.attentionContext;
  const listWatch=/\b(?:mis seguimientos|que (?:estamos|estoy) siguiendo)\b/.test(n),listInbox=/necesita(?:n)? (?:tu|mi) atencion|bandeja(?: de atencion)?|que necesita atencion/.test(n);
  if(listWatch||listInbox){delete conversation.attentionContext;delete conversation.attentionDraft;const inbox=attention.list({branch,following:listWatch});if(inbox.data.length===1)conversation.attentionContext={id:inbox.data[0].id,branch};return response(inbox.data.length?`${listWatch?'Tus seguimientos':'Necesita tu atención'}: ${inbox.data.length} ${inbox.data.length===1?'caso disponible':'casos disponibles'}. La fecha de cada tarjeta indica cuándo se verificó.`:'No hay '+(listWatch?'seguimientos activos':'avisos visibles')+' para vos en esta sucursal. La disponibilidad de las fuentes se muestra abajo.',{attention:inbox});}
  let action=/prepara(?:r|me)? (?:el|un) cambio/.test(n)?'prepare':/deja(?:r)? de seguir|no (?:lo )?sigas|cancela(?:r)? (?:el )?seguimiento/.test(n)?'cancel':/que cambio|cambios desde|novedades de(?:l)? seguimiento/.test(n)?'changes':/no me (?:avises|avisar).*hasta|pospone|posponelo|posponer/.test(n)?'snooze':/no me interesa|descarta|descartalo|no (?:me )?avises (?:mas|de nuevo)/.test(n)?'dismiss':/volve a mostrarlo si cambia|avisame (?:solo )?si cambia/.test(n)?'dismiss':/volve a mostrar|mostra(?:lo)? de nuevo|reactiva(?:r)? (?:el )?aviso/.test(n)?'show':/\bsegui(?:r|lo|la)?\b|avisame cuando|haceme (?:un )?seguimiento|crea(?:me)? (?:un )?seguimiento|pone(?:lo)? en seguimiento/.test(n)?'follow':/por que|que paso|que le pasa|que esta pasando|cual es la causa|ver recorrido|explica(?:me)? (?:este|el|ese) (?:aviso|pedido|caso|remito)|investiga(?:r|lo)? (?:este|el|ese)?/.test(n)?'investigate':null;
  const selection=/^(?:opcion )?(\d+)$/.exec(n);
  let draft=conversation.attentionDraft;
  if(selection&&draft?.branch===branch){const target=draft.choices[Number(selection[1])-1];if(!target)return response('Elegí una de las opciones que te mostré.');action=draft.action;draft={...draft,target};}
  if(!action&&conversation.attentionPending?.branch===branch&&snoozeUntil(text,clock()))action='snooze';
  if(!action)return null;
  const until=action==='snooze'?(draft?.until||snoozeUntil(text,clock())):null;
  if(action==='snooze'&&!until){conversation.attentionPending={branch};return response('¿Hasta cuándo lo pospongo? Podés decir «posponelo hasta mañana» o «hasta el lunes».');}
  const onChange=/si cambia/.test(n)||draft?.onChange===true;
  let item;
  if(id)item=attention.get(id);
  else if(draft?.target&&selection){const r=await attention.resolve(draft.target);item=r.item;}
  else{
   const explicit=/\b(pedido(?: de)? (venta|compra)|remito)\s+(?:numero\s+)?([a-z0-9_-]+)\b/.exec(n);
   if(explicit){const kind=explicit[1]==='remito'?'remit':explicit[2]==='venta'?'sale':'purchase',number=explicit[3].toUpperCase(),target={kind,branch,numero:/^\d+$/.test(number)&&kind!=='remit'?number.padStart(6,'0'):number,serie:/\bserie\s+([a-z0-9_-]+)/.exec(n)?.[1]?.toUpperCase()};const r=await attention.resolve(target);if(r.choices){conversation.attentionDraft={branch,action,until,onChange,choices:r.choices};return response('Encontré más de un documento con ese número. ¿Cuál querés seguir?',{choices:r.choices.map((t,i)=>({label:formatChoice(t),text:'Opción '+(i+1)}))});}item=r.item;}
   else if(/este remito|ese remito|el remito/.test(n)&&conversation.remitContext?.branch===branch&&conversation.remitContext.targets?.length){const targets=conversation.remitContext.targets;if(targets.length>1){conversation.attentionDraft={branch,action,until,onChange,choices:targets};return response('¿Cuál de estos remitos?',{choices:targets.map((t,i)=>({label:formatChoice(t),text:'Opción '+(i+1)}))});}item=(await attention.resolve(targets[0])).item;}
   else if(conversation.attentionContext?.id){const candidate=attention.get(conversation.attentionContext.id);if(/este pedido|ese pedido|el pedido/.test(n)&&candidate.kind==='remit'&&conversation.salesOrderJourney?.branch===branch)item=(await attention.resolve({kind:'sale',branch,numero:conversation.salesOrderJourney.code})).item;else if(/este pedido|ese pedido|el pedido/.test(n)&&!['sale','purchase'].includes(candidate.kind))return response('¿Qué pedido querés seguir? Indicame si es de venta o compra y su número.');else item=candidate;}
   else if(conversation.salesOrderJourney?.branch===branch){const r=await attention.resolve({kind:'sale',branch,numero:conversation.salesOrderJourney.code});item=r.item;}
   else if(conversation.businessContext?.branch===branch&&['sale','purchase'].includes(conversation.businessContext.kind)&&conversation.businessContext.refs?.number){const c=conversation.businessContext,r=await attention.resolve({kind:c.kind==='sale'?'sale':'purchase',branch,numero:c.refs.number.padStart(6,'0')});if(r.choices){conversation.attentionDraft={branch,action,until,onChange,choices:r.choices};return response('¿Cuál de estos documentos?',{choices:r.choices.map((t,i)=>({label:formatChoice(t),text:'Opción '+(i+1)}))});}item=r.item;}
  }
  if(item&&item.branch!==branch)return response('Este aviso corresponde a la sucursal '+item.branch+'. Cambiá a esa sucursal para continuar con el mismo documento.');
  if(!item)return response('¿Qué querés seguir? Indicame el pedido de venta, pedido de compra o remito, o abrí su tarjeta.');
  delete conversation.attentionDraft;delete conversation.attentionPending;conversation.attentionContext={id:item.id,branch};
  if(action==='investigate')return investigate(item,conversation,branch);
  if(action==='prepare'){if(!['sale','purchase'].includes(item.kind))return response('Indicame qué precio o cantidad querés cambiar y el documento o lista correspondiente. El aviso no habilita nuevas operaciones. Siempre te mostraré el resumen antes de confirmar.');authorizePlan(item.kind==='sale'?'pedidoVenta':'pedidoCompra');item=await attention.refresh(item.id);if(item.status==='unknown')return response('No pude verificar el documento ahora. Conservé el caso, sin preparar ni ejecutar cambios.');conversation.businessContext={branch,kind:item.kind==='sale'?'sale':'purchase',refs:{number:item.target.numero},pending:null};return response('¿Qué precio o cantidad querés cambiar en el pedido '+item.target.numero+'? Indicá el ítem o producto y el nuevo valor, por unidad o millar. Te mostraré el resumen para confirmar; todavía no se modificó nada.');}
  if(action==='changes'){await attention.refresh(item.id);const result=await attention.act(item.id,{action});return response(result.item.status==='unknown'?'La fuente no está disponible ahora. Estos son los cambios verificados previamente; no di el caso por resuelto.':result.changes.some(e=>e.type==='changed')?'Estos son los cambios verificados desde que empezaste a seguirlo.':'Todavía no registré cambios desde que empezaste a seguirlo.',{attention:{data:[result.item]},attentionChanges:result.changes});}
  const result=await attention.act(item.id,{action,until,onChange});
  const message={follow:item.kind==='remit'?'Lo sigo hasta que el ERP registre la facturación completa del remito.':item.kind==='kaiqen'?'Sigo los problemas verificados del proyecto.':'Lo sigo hasta que el ERP registre toda la cantidad atendida. Eso no certifica recepción física.',cancel:'Dejaste de seguir este documento. Podés volver a seguirlo cuando quieras.',snooze:'Guardé: no te mostraré este aviso hasta '+new Date(until).toLocaleDateString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'})+'. El seguimiento sigue revisándose.',dismiss:onChange?'Guardé: lo oculto y vuelvo a mostrarlo si cambia.':'Guardé: este aviso ya no te interesa. Podés pedir «volvé a mostrarlo».',show:'Volví a mostrar este aviso.'}[action];
  return response(message,{attention:{data:[result.item]},attentionNotice:true});
 };
}

import Decimal from 'decimal.js';
import {createBusinessTools} from './tools.js';
import {reportPeriod,rememberReport,reportChat} from './report-chat.js';
import {priceWriteIntent} from './price-commands.js';
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?!.,]+$/g,'').trim();
const number=v=>{try{return new Decimal(v).toFixed().replace('.',',');}catch{return 'sin dato';}};
const denied=e=>e.status===403||e.code==='LECTURA_DENEGADA'||e.code==='ACCESO_CAMBIO';
const reply=(answer,evidence=[],trace=[],extra={})=>({answer,evidence,trace,...extra});
// Only identities and scope are remembered. Every amount and permission is read again.
export async function productJourney({text,conversation,branch,read,executeRead,authorizeRead=()=>{},metadata,clock=()=>new Date()}){
 const n=norm(text);let old=conversation.productJourney;
 if(old?.branch!==branch){delete conversation.productJourney;old=null;}
 if(priceWriteIntent(text)||/\b(actualiza|actualizame|cambia|cambiame|modifica|subi|subime|subilo|baja|bajalo|aumenta|aumentalo|crea|creame|genera|confirma)\b/.test(n))return null;
 const integral=/\b(?:analiza|analizame|ficha integral|recorrido integral|panorama|todo (?:sobre|del)|como estamos con)\b/.test(n)&&(/\bproducto\b/.test(n)||/\bz[\w/-]*\d[\w/-]*\b/.test(n));
 const explicit=/\b(?:producto|articulo)\s+([\w/-]+)\b/i.exec(text)?.[1]||/\bZ[A-Z0-9_/-]*\d[A-Z0-9_/-]*\b/i.exec(text)?.[0];
 const pendingChoice=old?.candidates&&/^(?:opcion |el |la )?\d+$/.test(n);
 const contextual=old&&(/^(?:(?:y|ahora|mostrame|dame|ver|necesito saber|quiero ver)\s+)*(?:(?:el|la|los|las|su|sus)\s+)?(?:precios?|clientes?|ventas?|ultimas ventas|facturas|comprobantes|costos?|pedidos?|pendientes|ficha|resumen integral)\b/.test(n)||/\b(?:este|ese|mismo) producto\b/.test(n));
 const periodFollow=old&&/^(?:y |comparalo con |compara con )?(?:el |este )?(?:mes|ano)? ?(?:pasado|anterior|actual)?$/.test(n);
 if(!integral&&!pendingChoice&&!contextual&&!periodFollow){if(explicit&&old?.code!==explicit||/\b(?:cliente|proveedor|pedido|solicitud)\s+[\w/-]+/.test(n))delete conversation.productJourney;return null;}
 if(/\b(?:desde|hasta|ultimos|ultimas)\b/.test(n))return reply('Para este recorrido puedo usar este mes, mes pasado, este año o año pasado. ¿Qué período querés consultar? No apliqué otro período por mi cuenta.');
 if(integral&&/\b(?:cliente|proveedor|lista|deposito)\s+\S+/.test(n))return reply('La ficha integral reúne todas las listas y depósitos del producto. Para acotar por cliente, proveedor o lista, pedime el informe específico con esos datos. No descarté esos filtros para mostrarte un resultado general.');
 // Do not silently discard filters, other products, or unrelated operations.
 if(!integral&&!pendingChoice&&/\b(cliente|proveedor)\s+\S+/.test(n)&&!/^clientes\b|^(?:y |mostrame )?(?:los |sus )?clientes[?!.]*$/.test(n))return null;
 if((text.match(/\bZ[A-Z0-9_/-]*\d[A-Z0-9_/-]*\b/ig)||[]).length>1)return reply('Consultemos un producto por vez. ¿Cuál querés analizar primero?');
 let term=explicit||old?.code;
 if(pendingChoice){const index=Number(n.replace(/^(?:opcion |el |la )/,''))-1;term=old.candidates[index]?.codigo;if(!term)return reply('Elegí uno de los productos de la lista.');}
 if(!term)return reply('¿Qué producto querés analizar? Indicame el código de Protheus.');
 const tools=createBusinessTools({read,executeRead,branch,metadata});
 let productResult;try{authorizeRead('productos',branch);productResult=await tools.run('buscar',{recurso:'productos',texto:term});}catch(e){if(denied(e))return reply('Esto no podés leerlo.',[],[],{accessDenied:true});throw e;}
 if(productResult.data?.length!==1||productResult.meta?.hasMore){
  const candidates=productResult.data||[];conversation.productJourney={branch,candidates:candidates.map(r=>({codigo:r.codigo,nombre:r.nombre}))};
  return reply(candidates.length?'Encontré varios productos. Elegí cuál querés analizar.':'No encontré ese producto en SB1. Revisá el código o probá con su descripción.',[{id:'F1',action:'buscar',args:{recurso:'productos',texto:term},result:productResult}],[],{choices:candidates.map((r,i)=>({label:`${r.codigo} · ${r.nombre}`,text:`Opción ${i+1}`}))});
 }
 const product=productResult.data[0],code=product.codigo;
 const evidence=[{id:'F1',action:'buscar',args:{recurso:'productos',texto:code},result:productResult}],trace=[];
 const add=(resource,filters,result)=>{evidence.push({id:'F'+(evidence.length+1),action:'consultar_erp',args:{recurso:resource,filtros:{...filters,sucursal:branch}},result});};
 const query=async(resource,filters={})=>{authorizeRead(resource,branch);return read(resource,new URLSearchParams({...filters,sucursal:branch}));};
 const pages=async(resource,filters)=>{const data=[];let last;for(let page=1;page<=10;page++){last=await query(resource,{...filters,page:String(page),limit:'100'});data.push(...last.data);if(!last.meta?.hasMore)break;}return {...last,data,meta:{...last.meta,page:1,limit:data.length,hasMore:!!last.meta?.hasMore,complete:!last.meta?.hasMore},limitations:[...(last.limitations||[]),'Recorrido de hasta 1000 filas; si hay más se informa alcance parcial.']};};
 let sections=integral||pendingChoice||/ficha|resumen integral/.test(n)?['prices','customers','sales','saleDocs','costs','pending']:/costos?/.test(n)?['costs']:/clientes?/.test(n)?['customers']:/pendientes|pedidos/.test(n)?['pending']:/ultimas ventas|facturas|comprobantes/.test(n)?['saleDocs']:/ventas?/.test(n)?['sales']:['prices'];
 const today=clock().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'});
 const period=/ano pasado/.test(n)?'año pasado':/este ano/.test(n)?'este año':/mes pasado|mes anterior/.test(n)?'mes pasado':/este mes/.test(n)?'este mes':old?.period||'este mes';
 conversation.productJourney={branch,code,lastSection:sections.at(-1),period};
 conversation.businessContext={branch,kind:'product',refs:{product:code},pending:null};
 if(periodFollow){
  if(old.lastSection==='costs')return reply('El costo que leí es el costo medio actual de SB2. No puedo reconstruir el costo del mes pasado con ese saldo. Para comparar ventas del producto, decime «sus ventas del mes pasado».');
  const range=reportPeriod(old.period||'este mes',today);
  conversation.reportContext={branch,resource:'resumenVentas',filters:{producto:code,...range,agrupar:'mes'}};
  const result=await reportChat({text,conversation,branch,read,executeRead,authorizeRead,today});conversation.productJourney={branch,code,lastSection:'sales',period};return result;
 }
 const title=`**${code} · ${product.nombre}**\nProducto verificado en SB1 · sucursal ${branch} · unidad ${product.unidadMedida||'sin informar'}.`;
 const tasks=[];let prices;
 const section=(label,fn)=>{tasks.push((async()=>{try{const body=await fn();trace.push({action:label,status:'ok'});return `**${label}**\n${body}`;}catch(e){if(e.code==='ACCESO_CAMBIO')throw e;const body=`**${label}**\n${denied(e)?'Esto no podés leerlo.':e.code==='ETIMEOUT'?'El ERP tardó demasiado. Podés volver a pedirme esta sección.':'No pude verificar esta sección ('+(e.code||'FUENTE_NO_DISPONIBLE')+'). No lo interpreto como cero.'}`;trace.push({action:label,status:denied(e)?'denied':'error',code:e.code||'FUENTE_NO_DISPONIBLE'});return body;}})());};
 if(sections.includes('prices'))await section('Precios de lista',async()=>{authorizeRead('preciosClientes',branch);authorizeRead('listasPreciosClientes',branch);prices=await tools.prices({producto:code});add('preciosClientes',{producto:code},prices);return prices.answer;});
 if(sections.includes('customers'))await section('Clientes vinculados',async()=>{
  authorizeRead('clientes',branch);authorizeRead('preciosClientes',branch);
  const items=await pages('preciosClientes',{producto:code});add('preciosClientes',{producto:code},items);
  const lists=[...new Set(items.data.map(r=>r.listaCodigo).filter(Boolean))];if(lists.length>30)throw Object.assign(new Error('Demasiadas listas'),{code:'ALCANCE_EXTENSO'});
  const results=await Promise.all(lists.map(async lista=>({lista,result:await pages('clientes',{lista})})));
  for(const r of results)add('clientes',{lista:r.lista},r.result);
  const lines=results.flatMap(({lista,result})=>result.data.map(c=>`• ${c.codigo} / ${c.tienda} · ${c.nombre} · lista ${lista}`));
  return (lines.slice(0,20).join('\n')||'No encontré clientes con A1_TABELA asignada a las listas de este producto.')+'\nVínculo SA1.A1_TABELA → DA1; no demuestra compras ni exclusividad.'+(items.meta.hasMore||results.some(r=>r.result.meta.hasMore)||lines.length>20?' Alcance parcial; consultá las fuentes para ver las demás filas.':'');
 });
 if(sections.includes('sales'))await section('Ventas facturadas',async()=>{const filters={producto:code,...reportPeriod(period,today),agrupar:'mes'},result=await query('resumenVentas',filters);add('resumenVentas',filters,result);rememberReport(conversation,branch,evidence);return result.verifiedSummary||'El informe verificado está en la fuente adjunta.';});
 if(sections.includes('saleDocs'))await section('Últimos comprobantes de venta',async()=>{const result=await query('comprobantesVentas',{producto:code,orden:'reciente',limit:'5'});add('comprobantesVentas',{producto:code,orden:'reciente'},result);if(!result.data.length)return 'No encontré comprobantes NF/NC/ND para este producto. No son precios de lista.';return result.data.map(r=>`• ${r.fecha} · ${r.clase} ${r.serie||''} ${r.numero} / ${r.item} · cliente ${r.tercero} / ${r.tienda}: ${number(r.precioUnitario)} ${r.monedaNombre||'moneda '+r.moneda} por ${r.unidad||'unidad sin informar'}${r.unidad==='UN'&&r.precioUnitario!=null?' = '+number(new Decimal(r.precioUnitario).mul(1000))+' por millar':''}; cantidad ${r.cantidadMillares!==undefined?number(r.cantidadMillares)+' millares':number(r.cantidad)+' '+r.unidad}.`).join('\n')+'\nHasta cinco ítems recientes, sin recorte de fechas. NF, NC y ND se distinguen por su clase; no es un total global ni el precio vigente de lista.';});
 if(sections.includes('costs'))await section('Costos y existencias',async()=>{const result=await query('costos',{producto:code,limit:'100'});add('costos',{producto:code},result);if(!result.data.length)return 'No encontré costos SB2 para este producto en esta sucursal. No significa costo cero.';return result.data.slice(0,8).map(r=>`• Depósito ${r.depositoCodigo||r.deposito||'sin informar'}: costo medio moneda de valuación 1 ${number(r.costoMedio)} por ${product.unidadMedida||'unidad'}${product.unidadMedida==='UN'&&r.costoMedio!=null?' ('+number(new Decimal(r.costoMedio).mul(1000))+' por millar)':''}; existencia ${number(r.cantidadActual)} ${product.unidadMedida||''}${product.unidadMedida==='UN'&&r.cantidadActual!=null?' = '+number(new Decimal(r.cantidadActual).div(1000))+' millares':''}.`).join('\n')+'\nCosto medio almacenado por depósito; moneda de valuación 1 sin conversión. No equivale a costo de fabricación ni permite inferir margen contra otra moneda.'+(result.meta?.hasMore||result.data.length>8?' Se muestran depósitos parciales; ver fuente.':'');});
 if(sections.includes('pending'))for(const [resource,label]of [['pedidosVentaPendientes','Pedidos de venta pendientes'],['pedidosCompraPendientes','Pedidos de compra pendientes']]){if(!integral&&(/compra/.test(n)&&resource==='pedidosVentaPendientes'||/venta/.test(n)&&resource==='pedidosCompraPendientes'))continue;await section(label,async()=>{const result=await pages(resource,{producto:code});add(resource,{producto:code},result);if(!result.data.length)return 'No encontré ítems con saldo técnico pendiente para este producto.';return `${result.data.length} ítems leídos${result.meta.hasMore?' (alcance parcial)':''}. Sin recorte por fecha de emisión; incluye pedidos anteriores.\n`+result.data.slice(0,8).map(r=>`• ${r.numero} · ítem ${r.item} · tercero ${r.tercero} / ${r.tienda}: saldo ${r.cantidadMillares!==undefined?number(r.cantidadMillares)+' millares':number(r.cantidad)+' '+(r.unidad||'sin unidad')}; importe pendiente ${number(r.importe)} ${r.monedaNombre||'moneda '+r.moneda}.`).join('\n')+'\nSaldo técnico actual, no confirma entrega física, deuda ni aprobación. Documentos en la fuente adjunta.';});}
 const settled=await Promise.allSettled(tasks);const failed=settled.find(r=>r.status==='rejected');if(failed)throw failed.reason;const blocks=settled.map(r=>r.value);
 return reply(title+'\n\n'+blocks.join('\n\n')+'\n\nPodés seguir con «sus ventas», «y los costos» o «mostrame sus pedidos pendientes».',evidence,trace,{priceBase:product.codigo.startsWith('Z')&&product.unidadMedida==='UN'?'millar':undefined});
}

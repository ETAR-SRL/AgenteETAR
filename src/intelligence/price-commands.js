import Decimal from 'decimal.js';
import {assert} from '../errors.js';
import {previousPrice,assertPriceCurrency} from './references.js';
import {valueCorrections} from './value-corrections.js';
import {commercialLiteralText} from './purchase-chat.js';
const D=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const decimal=s=>s.replace(',','.');
export function requestedPriceBase(text){
 const correction=valueCorrections(text);
 const n=norm(commercialLiteralText(text)),millar=/\b(?:por|el|cada)\s+(?:un\s+)?millar(?:es)?\b|\bprecios?\s+(?:en\s+)?millares\b/.test(n),unidad=/\b(?:por|la|cada)\s+unidad(?:es)?\b|\bunitario\b/.test(n);
 if(millar&&unidad&&!correction.rejected.includes('priceUnit'))return null;
 if(correction.changes.priceUnit)return correction.changes.priceUnit;
 if(correction.rejected.includes('priceUnit'))return null;
 return millar&&unidad?null:millar?'millar':unidad?'unidad':null;
}
export const priceWriteIntent=text=>/\b(cambia(?:r|me)?|cambies|modifica(?:r|me)?|actualiza(?:r|me)?|ajusta(?:r|me)?|subi(?:r|me)?|subas|baja(?:r|me)?|bajes|aumenta(?:r|me)?|incrementa(?:r|me)?|reduci(?:r|me)?|reduce|deja(?:r|lo|me)?)\b/.test(norm(text))&&!/\b(no|nunca|sin)\s+(?:lo\s+|me\s+)?(?:cambi|modifi|actuali|ajust|sub|baj|aument|increment|reduc|dej)|\b(solo consultar|sin modificar|que pasaria|simula|simular)\b/.test(norm(text));
export function priceOperation(text){
 const literal=commercialLiteralText(text);
 if(!priceWriteIntent(literal)||/\b(pedidos?|proveedores?|compras?|costos?|cantidad(?:es)?|stock|saldos?|produccion|solicitudes?)\b/.test(norm(text)))return null;
 const correction=valueCorrections(text);
 if(correction.pending.length||correction.optionalPriceRemoved)return null;
 const n=norm(literal),percent=[...n.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|por ciento)/g)];
 if(percent.length===1){const down=/\b(baja|bajame|bajar|bajes|reduci|reducime|reducir|reduce|descuento|disminui|disminuir)\b/.test(n);return {kind:'percentage',value:decimal(percent[0][1]),direction:down?-1:1};}
 if(percent.length)return null;
 if(correction.changes.price!==undefined)return {kind:'absolute',value:correction.changes.price};
 const match=/\b(?:a|en)\s*\$?\s*(\d+(?:[.,]\d+)?)(?![\d.,])(?:\s*(?:dolares?|usd|pesos?|ars|euros?|eur))?(?=\s|[.!?]|$)/.exec(n);
 return match?{kind:'absolute',value:decimal(match[1])}:null;
}
// The model selects references; arithmetic and scope validation stay in code.
// Common contextual commands bypass an unnecessary model round trip.
export function priceCommand(text,messages,branch,singleBranch){
 if(!priceOperation(text))return null;
 const previous=previousPrice(messages,branch,{singleBranch,allowMultiple:true}),n=norm(text);
 const codes=[...text.matchAll(/\bZ[A-Z0-9_/-]*\d[A-Z0-9_/-]*\b/ig)].map(m=>m[0].toUpperCase());
 const code=codes.length===1?codes[0]:null;
 const list=/\blista(?:\s+de\s+precios)?\s+(?:de(?:l)?\s+)?["“]?(.+?)(?=\s+(?:a|en|un|una|por)\s+(?:un\s+)?\d|["”!?]|$)/i.exec(text);
 if(list&&!/precio de lista de\b/.test(n)&&!/^(?:un|a|en|por)\s+\d|^\d+(?:[.,]\d+)?\s*(?:%|por ciento)/.test(list[1])&&!/^(?:precios?|venta|actual|esa|esta)$/i.test(list[1].trim()))return {action:'ajustar_precios',args:{lista:list[1].trim().replace(/[.,]+$/,''),...(code?{producto:code}:{})}};
 const previousLists=[...new Set(previous?.identities.map(r=>r.listaCodigo).filter(Boolean)||[])];
 if(previousLists.length===1&&/\b(?:esa|esta|la) lista\s+(?:(?:a|en|un|por)\s+)*(?:\d|$)/.test(n))return {action:'ajustar_precios',args:{lista:previousLists[0],contextualList:true}};
 if(code)return {action:'ajustar_precios',args:{producto:code.toUpperCase()}};
 if(previous?.product&&/\b(?:el|ese|este|su) precio\s+(?:a|en)\b|\b(?:el|del|ese|este) producto\s+(?:a|en)\b|\b(?:subilo|bajalo|dejalo|aumentalo)\b/.test(n)&&!/(?:\blista\b|\bcliente\b|\btodos\b)/.test(n))return {action:'ajustar_precios',args:{producto:previous.product,contextual:true}};
 return null;
}
const number=n=>new D(n).toSignificantDigits(15).toFixed().replace('.',',');
export async function preparePriceCommand({text,args,messages,branch,singleBranch,tools,read,metadata,prepare,addEvidence}){
 const operation=priceOperation(text);assert(operation,400,'OPERACION_PRECIO_REQUERIDA','Indicar un precio nuevo o un porcentaje de aumento/reducción.');
 assert(new D(operation.value).gt(0),400,'IMPORTE_INVALIDO','El importe o porcentaje debe ser mayor que cero.');
 assert(operation.direction!==-1||new D(operation.value).lt(100),400,'PORCENTAJE_INVALIDO','La reducción debe ser menor al 100%.');
 const previous=previousPrice(messages,branch,{singleBranch,allowMultiple:true});
 const explicitProducts=[...new Set([...text.matchAll(/\bZ[A-Z0-9_/-]*\d[A-Z0-9_/-]*\b/ig)].map(m=>m[0].toUpperCase()))];
 assert(explicitProducts.length<=1,400,'VARIOS_PRODUCTOS','Indicá una lista completa o un producto por instrucción para revisar el alcance.');
 const supplied=Object.fromEntries(['producto','lista','cliente'].filter(k=>typeof args[k]==='string'&&args[k].trim()).map(k=>[k,args[k].trim()]));
 for(const [key,value] of Object.entries(supplied))assert(norm(text).includes(norm(value))||(key==='producto'&&previous?.product===value&&priceCommand(text,messages,branch,singleBranch)?.args.contextual)||(key==='lista'&&priceCommand(text,messages,branch,singleBranch)?.args.contextualList&&priceCommand(text,messages,branch,singleBranch).args.lista===value),409,'REFERENCIA_NO_VERIFICADA','La referencia propuesta no está en tu instrucción ni en el contexto verificado.');
 const contextual=supplied.producto===previous?.product&&!norm(text).includes(norm(supplied.producto));
 if(contextual){
   const codes=text.match(/\b[A-Z][A-Z0-9_/-]*\d[A-Z0-9_/-]*\b/ig)||[];
   assert(codes.every(c=>c.toUpperCase()===previous.product.toUpperCase()),409,'REFERENCIA_DISTINTA','La instrucción identifica otro producto; necesito verificarlo.');
 }
 assert(Object.keys(supplied).length,400,'REFERENCIA_REQUERIDA','¿Qué producto o lista querés modificar?');
 let listCode,allRows=[],excluded=[],targetDescription='',rows=[];
 if(!supplied.producto){
  // Naming a list means the whole list, never the last product in the chat.
  const resource=supplied.cliente?'clientes':'listasPreciosClientes',term=supplied.cliente||supplied.lista;
  const found=await tools.run('buscar',{recurso:resource,texto:term});
  addEvidence('buscar',{recurso:resource,texto:term},found);
  if(found.data?.length!==1||found.meta?.hasMore)return {answer:found.message||'¿Qué lista corresponde? Encontré más de una alternativa.'};
  listCode=supplied.cliente?found.data[0].listaPreciosCodigo:found.data[0].codigo;
  assert(listCode,409,'LISTA_NO_ASIGNADA','El cliente no tiene lista asignada en A1_TABELA.');
  targetDescription=`lista ${listCode} (${found.data[0].nombre}) completa`;
  const seen=new Set();
  for(let page=1;;page++){
   assert(page<=100,409,'LISTA_DEMASIADO_GRANDE','La lista supera 10.000 registros; acotá el alcance antes de preparar cambios.');
   const result=await read('preciosClientes',new URLSearchParams({sucursal:branch,lista:listCode,limit:'100',page:String(page)}));
   for(const r of result.data){assert(r.listaCodigo===listCode&&!seen.has(String(r.registro)),409,'LISTA_CAMBIO_DURANTE_LECTURA','La lista cambió durante la lectura; volvé a solicitar la propuesta.');seen.add(String(r.registro));allRows.push(r);}
   if(!result.meta?.hasMore)break;
   assert(result.data.length,409,'PAGINACION_INCONSISTENTE','No se pudo completar la lectura de la lista.');
  }
  for(const product of [...new Set(allRows.map(r=>r.productoCodigo))]){
   const result=await tools.run('precio_venta',{producto:product,lista:listCode});
   assert(result.kind==='prices'&&!result.meta?.hasMore,409,'PRODUCTO_NO_VERIFICADO',`No pude verificar todos los precios de ${product} en SB1/DA1.`);
   // Exact set check avoids silently narrowing an incomplete or concurrently changed list.
   const expected=allRows.filter(r=>r.productoCodigo===product).map(r=>String(r.registro)).sort();
   assert(JSON.stringify(result.data.map(r=>String(r.registro)).sort())===JSON.stringify(expected),409,'LISTA_CAMBIO_DURANTE_LECTURA','Cambió la lista durante la lectura. Volvé a pedir el ajuste.');
   rows.push(...result.data);
  }
  addEvidence('precio_venta',{lista:listCode},{kind:'prices',data:rows,meta:{hasMore:false,scope:'lista completa'},source:{system:'protheus'},limitations:['Todos los registros de la lista fueron leídos; sólo se proponen precios activos y vigentes.']});
 }else{
  const filters={...supplied};
  if(contextual){
   const lists=[...new Set(previous.identities.map(r=>r.listaCodigo).filter(Boolean))];
   if(lists.length===1&&!filters.lista&&!filters.cliente)filters.lista=lists[0];
  }
  const result=await tools.run('precio_venta',filters);addEvidence('precio_venta',filters,result);
  if(result.kind!=='prices')return {answer:result.message||'No pude identificar el precio.'};
  assert(!result.meta?.hasMore,409,'PRECIO_INCOMPLETO','Hay más precios; indicá la lista para elegir el registro.');
  rows=result.data;targetDescription=`producto ${result.product.codigo} — ${result.product.nombre}`;
  if(contextual){
   const old=previous.identities;
   assert(rows.every(r=>old.some(o=>String(o.registro)===String(r.registro)&&o.productoCodigo===r.productoCodigo&&o.listaCodigo===r.listaCodigo)),409,'REFERENCIA_CAMBIADA','El registro cambió desde la consulta anterior; volvé a consultarlo.');
  }
 }
 excluded=rows.filter(r=>!r.aplicableSegunCampos);rows=rows.filter(r=>r.aplicableSegunCampos);
 if(!rows.length)return {answer:'No hay precios activos y vigentes para preparar este ajuste.'};
 if(supplied.producto&&rows.length!==1)return {answer:'¿Qué lista o tramo querés modificar? Hay varios precios vigentes para ese producto; te mostré las alternativas.'};
 const explicitBase=requestedPriceBase(text);
 const plans=[];
 for(const row of rows){
  assertPriceCurrency(text,row,assert);
  let base=explicitBase;
  // Use the primary commercial base just shown, and make that interpretation visible.
  if(!base&&contextual&&['unidad','millar'].includes(previous?.base))base=previous.base;
  if(!base&&operation.kind==='absolute'&&row.productoCodigo.startsWith('Z')&&row.unidadMedida?.trim()==='UN')base='millar';
  if(operation.kind==='absolute'&&!base)return {answer:`¿El precio de ${operation.value} es por unidad o por millar? El producto ${row.productoCodigo} usa ${row.unidadMedida}; no asumí una conversión.`};
  let next=operation.value,calculation;
  if(operation.kind==='percentage'){
   const field=metadata.entities?.preciosClientes?.fields?.find(f=>f.salida==='precio'),scale=Number(field?.diccionario?.X3_DECIMAL);
   assert(/^\d+$/.test(String(field?.diccionario?.X3_DECIMAL))&&Number.isInteger(scale)&&scale>=0&&scale<=12,409,'PRECISION_DESCONOCIDA','No pude verificar los decimales SX3 del precio de venta.');
   const before=new D(row.precio).toDecimalPlaces(scale),exact=before.mul(new D(1).plus(new D(operation.value).mul(operation.direction).div(100)));
   next=exact.toDecimalPlaces(scale).toFixed();base='unidad';
   calculation={porcentaje:(operation.direction<0?'-':'+')+operation.value+'%',precioAnteriorUnidad:before.toFixed(),precioCalculadoUnidad:exact.toFixed(),precioPropuestoUnidad:next,redondeo:exact.eq(next)?'No requerido':`HALF_UP a ${scale} decimales SX3, visible para confirmar`};
  }
  plans.push({row,base,next,calculation});
 }
 const summary=[],failures=[];let count=0;
 for(const plan of plans){
  const {row,base,next,calculation}=plan;
  try{
   const proposal=await prepare({action:'precioLista',target:{sucursal:branch,registro:String(row.registro)},changes:{precio:next},priceUnit:base,expectedPrice:row.precio,expectedIdentity:{producto:row.productoCodigo,lista:row.listaCodigo,moneda:String(row.moneda?.codigo||'')}});
   count++;addEvidence('ajustar_precios',{producto:row.productoCodigo,lista:row.listaCodigo},{kind:'proposal',proposal});
   summary.push({producto:row.productoCodigo,lista:row.listaCodigo,registro:row.registro,moneda:row.moneda?.descripcion,antesPorUnidad:number(row.precio),despuesPorUnidad:number(base==='millar'?new D(next).div(1000):next),...(row.unidadMedida==='UN'?{despuesPorMillar:number(base==='millar'?next:new D(next).mul(1000))}:{}),...calculation,estado:proposal.blockers?.length?'Revisar restricciones':'Pendiente de confirmación'});
  }catch(error){if(['LECTURA_DENEGADA','ACCION_DENEGADA','ACCESO_CAMBIO'].includes(error.code))throw error;failures.push({producto:row.productoCodigo,registro:row.registro,motivo:error.message,codigo:error.code});}
 }
 addEvidence('ajustar_precios',supplied,{kind:'priceAdjustment',data:summary,excluded:excluded.map(r=>({producto:r.productoCodigo,registro:r.registro,motivo:r.elegibilidad})),failures,meta:{hasMore:false}});
 const basis=operation.kind==='percentage'?`${operation.direction<0?'reducción':'aumento'} del ${operation.value}% sobre cada precio actual`:`precio de ${operation.value} ${rows[0].moneda?.descripcion||''} por ${plans[0].base}`;
 return {answer:`${count?'Preparé '+count+' propuesta'+(count===1?'':'s'):'No pude preparar propuestas'} para ${targetDescription}: ${basis}. Productos verificados en SB1 y precios releídos en DA1/DA0.`+(!explicitBase&&operation.kind==='absolute'?` Interpreté el importe por ${plans[0].base.toUpperCase()}, conservando la base comercial del contexto; revisá esa base en la tarjeta antes de confirmar.`:'')+(operation.kind==='percentage'?' Se calcula desde los precios actuales del ERP, no desde propuestas anteriores sin confirmar.':'')+(excluded.length?` Excluí ${excluded.length} registros inactivos o fuera de vigencia; están detallados abajo.`:'')+(failures.length?` ${failures.length} registros no se pudieron preparar; cada motivo figura abajo.`:'')+' No se modificó el ERP. Revisá y confirmá cada tarjeta para aplicar su cambio.'};
}

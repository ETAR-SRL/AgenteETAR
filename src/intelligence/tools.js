import Decimal from 'decimal.js';
import {assert} from '../errors.js';
import {isFinishedProduct,pricePerThousand} from '../etar.js';
const text=value=>typeof value==='string'?value.trim():'';
const genericList=value=>/^(?:(?:la|una|las)\s+)?listas?(?:\s+de\s+(?:precios?|venta))?$/.test(text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());
const state=value=>{const label=(value?.descripcion||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();return ['si','activo','activa','yes','sim'].includes(label)?'activo':['no','inactivo','inactiva','nao'].includes(label)?'inactivo':'sin_confirmar';};
const amount=value=>{try{return new Decimal(value).toSignificantDigits(15).toFixed().replace('.',',');}catch{return 'sin importe';}};
export function createBusinessTools({read,executeRead,kaiqen,branch,metadata}){
 const query=(resource,filters={})=>read(resource,new URLSearchParams({...filters,sucursal:branch,limit:String(filters.limit||25)}));
 async function resolve(resource,term){
   assert(text(term).length>=2&&term.length<=120,400,'TERMINO_REQUERIDO','Indicar código o nombre');
   const generic=term.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/^(un|una|el|la|los|las|ese|esa|este|esta)\s+/,'');
   if(/^(producto|articulo|pieza|cliente|proveedor|lista)s?$/.test(generic))return {kind:'clarification',message:'¿Cuál es el nombre, código o descripción del producto, cliente o lista que querés consultar?',data:[],meta:{needsIdentifier:true,hasMore:false}};
   const exact=await query(resource,{codigo:term,limit:12});if(exact.data.length)return exact;
   const words=term.split(/\s+/).filter(w=>!['de','del','la','el','los','las'].includes(w.toLowerCase()));
   const search=words.join(' ')||term;return query(resource,{q:search,limit:12});
 }
 async function prices(args){
   if(!text(args.producto))return {kind:'clarification',message:'¿De qué producto necesitás el precio? Podés decirme su código o describirlo.'};
   const products=await resolve('productos',args.producto);
   if(products.meta?.needsIdentifier)return products;
   if(products.data.length!==1||products.meta?.hasMore)return {kind:products.data.length?'clarification':'not_found',message:products.data.length?'Encontré varios productos. Elegí cuál querés consultar.':'No encontré ese producto. Probá otra parte del nombre con buscar; no inventes un código.',candidates:products.data,source:products.source};
   const product=products.data[0],filters={producto:product.codigo,limit:100};let customer=null;
   if(text(args.cliente)){
     const customers=await resolve('clientes',args.cliente);const matches=args.tienda?customers.data.filter(c=>c.tienda===args.tienda):customers.data;
     if(matches.length!==1||customers.meta?.hasMore)return {kind:'clarification',message:'Necesito identificar un único cliente y tienda para usar su lista asignada.',candidates:matches,source:customers.source};
     customer=matches[0];if(!customer.listaPreciosCodigo)return {kind:'clarification',message:'El cliente no tiene una lista de precios asignada en SA1. No elegí otra lista automáticamente.',customer};filters.lista=customer.listaPreciosCodigo;
   }
   if(text(args.lista)&&!genericList(args.lista)){
     const lists=await resolve('listasPreciosClientes',args.lista);if(lists.data.length!==1||lists.meta?.hasMore)return {kind:'clarification',message:'La lista indicada no se identificó de forma única.',candidates:lists.data};
     assert(!filters.lista||filters.lista===lists.data[0].codigo,409,'LISTA_DISTINTA','La lista indicada no coincide con la asignada al cliente');filters.lista=lists.data[0].codigo;
   }
   const items=await query('preciosClientes',filters),headers=new Map();
   for(const code of [...new Set(items.data.map(r=>r.listaCodigo))]){const h=await query('listasPreciosClientes',{codigo:code,limit:2});headers.set(code,h.data.length===1&&!h.meta?.hasMore?h.data[0]:null);}
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   const data=items.data.map(row=>{
     const header=headers.get(row.listaCodigo),lineState=state(row.activo),headerState=state(header?.estado);
     const reasons=[];if(!header)reasons.push('cabecera ausente o ambigua');if(lineState!=='activo')reasons.push('ítem '+lineState);if(headerState!=='activo')reasons.push('lista '+headerState);
     if(!row.vigenteDesde||!header?.vigenteDesde)reasons.push('inicio de vigencia incompleto');
     if(row.vigenteDesde>today||header?.vigenteDesde>today)reasons.push('vigencia futura');if(header?.vigenteHasta&&header.vigenteHasta<today)reasons.push('lista vencida');
     return {productoCodigo:product.codigo,productoNombre:product.nombre,listaCodigo:row.listaCodigo,listaNombre:header?.nombre||null,precio:row.precio,moneda:row.moneda,unidadMedida:product.unidadMedida,vigenteDesde:row.vigenteDesde,listaDesde:header?.vigenteDesde,listaHasta:header?.vigenteHasta,estadoItem:row.activo,estadoLista:header?.estado,elegibilidad:reasons.length?reasons.join('; '):'activo y dentro de fechas',intervaloPrecio:row.intervaloPrecio,tipoPrecio:row.tipoPrecio,descuentoImporte:row.descuentoImporte,factorAumentoDescuento:row.factorAumentoDescuento,flete:row.flete,registro:row.registro,aplicableSegunCampos:!reasons.length};
   });
   const inThousands=isFinishedProduct(product.codigo)&&product.unidadMedida?.trim().toUpperCase()==='UN';
   if(inThousands)for(const row of data){if(typeof row.precio==='string'&&/^\d+(\.\d+)?([eE][+-]?\d{1,3})?$/.test(row.precio))row.precioPorMillar=pricePerThousand(new Decimal(row.precio).toFixed());}
   const applicable=data.filter(r=>r.aplicableSegunCampos);
   let answer=`Consulté ${product.codigo} · ${product.nombre} en las listas de venta DA1 y sus cabeceras DA0${customer?' para '+customer.nombre+' (tienda '+customer.tienda+')':''}.`;
   if(!data.length)answer+=' No encontré un precio de lista para este alcance. No significa que el precio sea cero.';
   else{
     const show=applicable.length?applicable:data;
     answer+='\n\n'+show.slice(0,8).map(r=>`• Lista ${r.listaCodigo} (${r.listaNombre||'sin nombre'}): ${r.precioPorMillar!==undefined?amount(r.precioPorMillar):amount(r.precio)} ${r.moneda?.descripcion||'moneda código '+(r.moneda?.codigo||'sin informar')} por ${r.precioPorMillar!==undefined?'MILLAR ('+amount(r.precio)+' por UN en TOTVS)':r.unidadMedida||'unidad sin informar'}. ${r.aplicableSegunCampos?'Ítem y lista activos, dentro de fechas.':r.elegibilidad+'.'}`).join('\n');
     if(!applicable.length)answer+='\n\nLos registros encontrados no permiten confirmar un precio de lista vigente y activo. No los presento como el precio al que estamos vendiendo hoy.';
     else if(applicable.length>1)answer+='\n\nHay varias alternativas. El cliente, lista o tramo de cantidad determina cuál corresponde; no elegí una por mi cuenta.';
     if(show.length>8)answer+='\nLa tabla contiene las demás alternativas de esta página.';
   }
   answer+='\n\nEstos son precios de lista; no demuestran el precio efectivamente facturado ni incorporan automáticamente impuestos, bonificaciones o condiciones comerciales.';
   if(items.meta?.hasMore)answer+=' La consulta es parcial: hay más registros.';
   return {kind:'prices',answer,product,customer,data,source:items.source,meta:items.meta,limitations:['Valores leídos en esta consulta; no recuperados de memoria','Vigencia comprobada con campos almacenados, sin ejecutar la rutina comercial Protheus']};
 }
 return {
   prices,
   async run(action,args){
     assert(args&&typeof args==='object'&&!Array.isArray(args),400,'ARGUMENTOS_INVALIDOS','Argumentos inválidos');
     if(action==='buscar'){
       assert(['productos','clientes','proveedores','listasPreciosClientes'].includes(args.recurso),400,'RECURSO_INVALIDO','Búsqueda no admitida');const result=await resolve(args.recurso,args.texto);
       if(result.data.length>1||result.meta?.hasMore)return {...result,kind:'clarification',message:'Encontré varias coincidencias. Elegí la que corresponde o agregá una característica para acotar la búsqueda.',candidates:result.data};return result;
     }
     if(action==='precio_venta')return prices(args);
     if(action==='consultar_erp'){
       assert(Object.hasOwn(metadata.entities,args.recurso)||['remitos','entregas'].includes(args.recurso),400,'RECURSO_INVALIDO','Recurso inválido');
       assert(!args.filtros||typeof args.filtros==='object'&&!Array.isArray(args.filtros),400,'FILTROS_INVALIDOS','Filtros inválidos');
       const filters=args.filtros||{};assert(!Object.hasOwn(filters,'sucursal')||filters.sucursal===branch,403,'SUCURSAL_NO_AUTORIZADA','No se cambia el alcance de sucursal desde la IA');
       for(const value of Object.values(filters))assert(typeof value==='string'&&value.length<=256,400,'FILTROS_INVALIDOS','Valores de filtro deben ser texto');
       assert(!filters.limit||Number(filters.limit)<=100,400,'LIMITE_IA','La IA consulta hasta 100 filas por llamada');
       return executeRead({resource:args.recurso,filters:{...filters,sucursal:branch,limit:filters.limit||'25'}});
     }
     if(action==='proyectos'){
       const search=text(args.texto),sourceNames=['kaiqen','kaiquen','todos','todos los proyectos','proyectos'];
       assert(!/^[a-f0-9]{32}$|^[a-f0-9-]{36}$/i.test(search),400,'ID_YA_IDENTIFICADO_USAR_PROYECTO_O_CALIDAD','El identificador ya está resuelto; usá proyecto o calidad con args.id');
       const result=await kaiqen.projects(search&&!sourceNames.includes(search.toLowerCase())?{q:search,limit:25}:{limit:25});
       const lines=result.data.map(p=>`${p.name||'Sin nombre'}${p.code?' ('+p.code+')':''}: fase guardada ${p.current_phase_name||'sin informar'}${p.customer?'. Cliente: '+p.customer:''}.`);
       return {...result,verifiedSummary:lines.length?`Proyectos encontrados en esta consulta de KAIQEN:\n\n${lines.map(line=>'• '+line).join('\n')}\n\nLa fase guardada no equivale al estado general del proyecto. Esta lectura no recalcula la etapa de vida ni el semáforo de calidad.${result.pagination?.hasMore?' Hay más proyectos; la lista está paginada.':''}`:'No encontré proyectos con ese nombre. Esto no determina si existen registros de calidad; para consultarlos hace falta identificar el proyecto.'};
     }
     if(action==='proyecto'){assert(text(args.id),400,'ID_REQUERIDO','Identificar proyecto');return kaiqen.project(args.id);}
     if(action==='calidad'){
       const result=await kaiqen.quality(args.id||undefined);if(!result.data?.domains)return result;
       const labels={noConformidades:'No conformidades',problemas:'Problemas',ppap:'PPAP',msa:'MSA',capacidad:'Estudios de capacidad'};
       const lines=Object.entries(result.data.domains).map(([name,domain])=>{
         if(!Array.isArray(domain.conteos))return `• ${labels[name]||name}: conteo no disponible.`;
         const count=domain.conteos.reduce((n,row)=>n+Number(row.cantidad||0),0);
         const states=new Map();for(const row of domain.conteos){const key=row.estado||'sin estado';states.set(key,(states.get(key)||0)+Number(row.cantidad||0));}
         const catalogue=name==='problemas'?result.data.issueStatusCatalog||[]:[];
         const detail=[...states].slice(0,8).map(([state,count])=>`${catalogue.find(s=>s.id===state)?.name||state}: ${count}`).join('; ');
         return `• ${labels[name]||name}: ${domain.hasMore?'al menos ':''}${count} registros${detail?' ('+detail+')':''}.`;
       });
       return {...result,verifiedSummary:`Información de calidad leída en KAIQEN${args.id?' para el proyecto '+args.id:' en la planta configurada'}:\n\n${lines.join('\n')}\n\nLos conteos describen los registros guardados; no determinan por sí solos si el proyecto está aprobado o libre de problemas. El catálogo de estados es una referencia, no el estado del proyecto. El semáforo global y la etapa de vida no se calculan en esta conexión. Los registros disponibles y sus campos se pueden revisar en la fuente adjunta.`};
     }
     assert(false,400,'HERRAMIENTA_INVALIDA','Herramienta fuera de la lista permitida');
   }
 };
}

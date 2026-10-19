import { assert } from './errors.js';
const resources = new Map([
  ['costos','costos'],['compras','compras'],['produccion','produccion'],['ventas','ventas'],['items de venta','itemsVentas'],
  ['documentos de salida','documentosSalida'],['remitos','remitos'],['entregas','entregas'],['clientes','clientes'],['proveedores','proveedores'],
  ['productos','productos'],['precios','preciosClientes'],['cotizaciones','cotizaciones'],['proyectos','proyectos'],['calidad','calidad'],
  ['pedidos de venta','ventas'],['pedidos','ventas'],['ordenes de compra','compras'],['ordenes de produccion','produccion'],
  ['items de ventas','itemsVentas'],['ventas pendientes','itemsVentas'],['pendientes de venta','itemsVentas'],
  ['listas de precios de clientes','listasPreciosClientes'],['listas de precios de proveedores','listasPreciosProveedores'],
  ['precios de proveedores','preciosProveedores'],['precios de clientes','preciosClientes'],
  ['productos por proveedor','productoProveedor'],['productos por cliente','productoCliente'],
  ['entradas de compras','entradasCompras'],['estructuras','estructuras'],['items de cotizaciones','itemsCotizaciones'],['items de documentos de salida','itemsDocumentosSalida']
]);
export const examples = [
  'consultar compras pendientes sucursal 0101',
  'mostrame los costos',
  'consultar proyectos',
  'calidad de este proyecto',
  'actualizar precio registro 4 a 1350.00 sucursal 0101'
];
export function plan(text, context={}) {
  assert(context && typeof context==='object' && !Array.isArray(context),400,'CONTEXTO_INVALIDO','context debe ser un objeto');
  assert(typeof text==='string' && text.length>0 && text.length<=2000,400,'TEXTO_INVALIDO','Indicar un texto de hasta 2000 caracteres');
  let input=text.normalize('NFC').trim();
  const keyword=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const changes=/^actualizar precio registro (\d+) a (\d+(?:[.,]\d+)?) sucursal ([A-Za-z0-9]+)$/i.exec(input);
  if(changes) return {kind:'proposal',action:'precioLista',target:{registro:changes[1],sucursal:changes[3]},changes:{precio:changes[2].replace(',','.')},executable:false};
  assert(!/\b(actualiz|modific|aument|baj|borr|elimin|crea|insert|subi|cambi)/i.test(input),422,'ORDEN_REQUIERE_PRECISION','Para modificar usá una propuesta estructurada o: actualizar precio registro 123 a 1500.00 sucursal 0101. No se admiten altas.');
  input=input.replace(/[.?!¿¡]+$/g,'').replace(/^¿/,'').trim().replace(/,?\s+por favor$/i,'');
  input=input.replace(/^(?:(?:quiero|necesito)\s+(?:ver|consultar)|consultar|consulta|consultame|consultá|mostrar|mostrame|muéstrame|muestrame|mostrá|ver|leer|dame|listar)\s+/i,'').replace(/^(los|las|el|la)\s+/i,'');
  if(/^(?:que|qué) ventas (?:tengo|hay) pendientes$/i.test(input))input='ventas pendientes';
  if(/^calidad de (?:este|ese|mi) proyecto$/i.test(input)){
    assert(typeof context.proyecto==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(context.proyecto),422,'PROYECTO_REQUERIDO','Seleccioná un proyecto en la sección Proyectos para consultar su calidad');
    input='calidad proyecto '+context.proyecto;
  }
  let found,labelFound;
  for(const [label,resource] of [...resources].sort((a,b)=>b[0].length-a[0].length)){
    if(keyword(input.slice(0,label.length))===label && (input.length===label.length || input[label.length]===' ')){found=resource;labelFound=label;input=input.slice(label.length).trim();break;}
  }
  assert(found,422,'CONSULTA_AMBIGUA','Indicá el recurso y filtros exactos; consultar /api/agent/examples');
  const filters={};
  if(['ventas pendientes','pendientes de venta'].includes(labelFound))filters.pendiente='true';
  while(input){
    const pending=/^pendientes(?:\s+|$)/i.exec(input);
    if(pending){assert(!filters.pendiente,400,'FILTRO_DUPLICADO','Pendientes duplicado');filters.pendiente='true';input=input.slice(pending[0].length);continue;}
    const match=/^(sucursal|producto|cliente|proveedor|c[oó]digo|tienda|n[uú]mero|lista|desde|hasta|proyecto|registro)\s+([A-Za-z0-9_.-]+)(?:\s+|$)/i.exec(input);
    assert(match,422,'FILTRO_AMBIGUO',`No pude interpretar el filtro: ${input.slice(0,120)}. Usá códigos exactos y fechas AAAA-MM-DD.`);
    const key=keyword(match[1]);assert(!Object.hasOwn(filters,key),400,'FILTRO_DUPLICADO',`Filtro repetido: ${key}`);
    filters[key]=match[2];input=input.slice(match[0].length);
  }
  if(!['proyectos','calidad'].includes(found)){
    filters.sucursal??=context.sucursal;
    assert(typeof filters.sucursal==='string',422,'SUCURSAL_REQUERIDA','Indicar sucursal');
  }
  return {kind:'read',resource:found,filters,executable:true,interpreter:'gramatica_local_sin_modelo_externo'};
}

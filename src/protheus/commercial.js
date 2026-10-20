import Decimal from 'decimal.js';
import {ApiError, identifier as q} from './config.js';
import {pagination} from './service.js';

// Especie + sentido del documento: una NC de compra sale por SD2; una NC
// de venta entra por SD1. No clasificar todo SD2 como venta ni todo SD1 como compra.
export const commercialResources = {
  comprobantesVentas: {scope:'ventas', label:'Ventas facturadas · NF / NC / ND'},
  comprobantesCompras: {scope:'compras', label:'Comprobantes de compra · NF / NC / ND'},
  remitosEmitidos: {scope:'remitos', emitted:true, label:'Remitos emitidos'},
  remitosPendientes: {scope:'remitos', label:'Remitos pendientes de facturar'},
  pedidosVentaPendientes: {scope:'pedidosVenta', label:'Pedidos de venta pendientes'},
  pedidosCompraPendientes: {scope:'pedidosCompra', label:'Pedidos de compra pendientes'},
  resumenVentas: {scope:'ventas', summary:true, label:'Resumen de ventas facturadas'},
  resumenCompras: {scope:'compras', summary:true, label:'Resumen de compras'},
  resumenRemitosPendientes: {scope:'remitos', summary:true, label:'Resumen de remitos pendientes de facturar'},
  resumenPedidosVenta: {scope:'pedidosVenta', summary:true, label:'Resumen de pedidos de venta pendientes'},
  resumenPedidosCompra: {scope:'pedidosCompra', summary:true, label:'Resumen de pedidos de compra pendientes'},
};
const numeric = new Set(['float','real','decimal','numeric','int','bigint','smallint','money','smallmoney']);
const rules = {
  ventas: [[2,'NF','NF',1],[2,'NDC','ND',1],[1,'NCC','NC',-1]],
  compras: [[1,'NF','NF',1],[1,'NDP','ND',1],[2,'NCP','NC',-1]],
  remitos: [[2,'RFN','REMITO',1]],
};
const fail = (code,message) => {throw new ApiError(400,code,message);};
const trim = value => String(value ?? '').trim();
const decimal = column => `CONVERT(decimal(28,6),${column})`;
const str = column => `CONVERT(varchar(80),${column})`;
const text = column => `RTRIM(LTRIM(${column}))`;
export function commercialParams(resource, params, now = new Date()) {
  const spec = commercialResources[resource];
  if (!spec) fail('RECURSO_NO_EXISTE','Informe inexistente');
  const allowed = new Set(['sucursal','desde','hasta','numero','serie','producto','cliente','proveedor','tienda','clase','moneda','page','limit','orden',...(spec.summary?['agrupar']:[])]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) fail('FILTRO_INVALIDO',`Filtro inválido o duplicado: ${key}`);
  if (!params.has('sucursal')) fail('SUCURSAL_REQUERIDA','Indicar sucursal');
  const filters = Object.fromEntries(params);
  const purchase = ['compras','pedidosCompra'].includes(spec.scope);
  if (filters[purchase?'cliente':'proveedor']) fail('FILTRO_INVALIDO','El tercero no corresponde al informe');
  if (spec.summary) {
    const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}).format(now);
    filters.desde ||= filters.hasta ? filters.hasta.slice(0,7)+'-01' : today.slice(0,7)+'-01';
    filters.hasta ||= today;
  }
  for (const key of ['desde','hasta']) if (filters[key]) {
    const date = new Date(filters[key]+'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || !Number.isFinite(+date) || date.toISOString().slice(0,10)!==filters[key]) fail('FECHA_INVALIDA','Usar fechas válidas AAAA-MM-DD');
  }
  if (filters.desde && filters.hasta && filters.desde>filters.hasta) fail('FECHA_INVALIDA','desde debe ser anterior a hasta');
  if (spec.summary && (new Date(filters.hasta)-new Date(filters.desde))/86400000>366) fail('PERIODO_EXTENSO','El resumen admite hasta 367 días; acotá el período');
  for (const [key,value] of Object.entries(filters)) if (!value || value.length>128) fail('FILTRO_INVALIDO',`Valor inválido: ${key}`);
  if (filters.clase && !['NF','NC','ND'].includes(filters.clase)) fail('FILTRO_INVALIDO','clase debe ser NF, NC o ND');
  if (filters.clase && !['ventas','compras'].includes(spec.scope)) fail('FILTRO_INVALIDO','clase sólo corresponde a comprobantes');
  if (filters.orden && filters.orden!=='reciente') fail('FILTRO_INVALIDO','orden debe ser reciente');
  const group = filters.agrupar || 'mes';
  if (!['mes','tercero','producto','clase'].includes(group)) fail('FILTRO_INVALIDO','Agrupar por mes, tercero, producto o clase');
  const paging = pagination(params);
  if (spec.summary && paging.page!==1) fail('PAGINACION_INVALIDA','El resumen calcula todo el alcance, no admite otras páginas');
  return {...spec, filters, group, ...paging};
}

export class Commercial {
  constructor(db,catalog) {this.db=db;this.catalog=catalog;}
  require(alias, fields, amounts=[]) {
    const table=this.catalog.table(alias);
    for (const f of ['R_E_C_N_O_','D_E_L_E_T_',...fields]) if (!table.columns.has(f)) throw new ApiError(503,'ESQUEMA_INCOMPATIBLE',`Falta ${alias}.${f}`);
    for (const f of amounts) if (!numeric.has(table.columns.get(f)?.type?.toLowerCase())) throw new ApiError(503,'ESQUEMA_INCOMPATIBLE',`Campo no numérico: ${alias}.${f}`);
  }
  base(spec,bindings) {
    const c=this.catalog, branch=spec.filters.sucursal;
    const physical=alias=>{const key='branch'+alias;bindings[key]=c.branch(alias,branch);return '@'+key;};
    const invoice=(n,especie,clase,sign) => {
      const a='SD'+n,h='SF'+n,d='D'+n,f='F'+n,party=n===1?'FORNECE':'CLIENTE';
      const amounts=['QUANT','TOTAL',n===1?'VUNIT':'PRCVEN',...(spec.scope==='remitos'?['QTDAFAT','QTDEFAT','QTDEDEV']:[])].map(x=>d+'_'+x);
      this.require(a,['FILIAL','DOC','SERIE','ITEM',party,'LOJA','COD','UM','ESPECIE','TIPO','TIPODOC','EMISSAO',...amounts.map(x=>x.slice(3))].map(x=>d+'_'+x),amounts);
      this.require(h,['FILIAL','DOC','SERIE',party,'LOJA','TIPO','ESPECIE','TIPODOC','MOEDA'].map(x=>f+'_'+x),[f+'_MOEDA']);
      const value=field=>`i.${q(d+'_'+field)}`;
      const rem=spec.scope==='remitos', baseQty=decimal(value(rem&&!spec.emitted?'QTDAFAT':'QUANT')), qty=sign===-1?`-ABS(${baseQty})`:baseQty;
      const total=rem&&!spec.emitted?`${qty}*${decimal(value('PRCVEN'))}`:decimal(value('TOTAL'));
      const signed=sign===-1?`-ABS(${total})`:total;
      return `SELECT '${a}' origen,${str('i.R_E_C_N_O_')} registro,${text(value('DOC'))} numero,${text(value('SERIE'))} serie,${text(value('ITEM'))} item,
        '${clase}' clase,'${especie}' especie,${text(value('TIPODOC'))} tipoDocumento,${text(value('TIPO'))} tipo,
        ${text(value(party))} tercero,${text(value('LOJA'))} tienda,${text(value('COD'))} producto,${text(value('UM'))} unidad,
        ${text(value('EMISSAO'))} fecha,h.moneda,h.cabeceras,CONCAT('${h}:',h.recno) documentoClave,
        ${qty} cantidad,${decimal(value(n===1?'VUNIT':'PRCVEN'))} precioUnitario,${decimal(signed)} importe,
        ${decimal(value('QUANT'))} cantidadOriginal,${rem?decimal(value('QTDEFAT')):'CAST(NULL AS decimal(28,6))'} cantidadFacturada,
        ${rem?decimal(value('QTDEDEV')):'CAST(NULL AS decimal(28,6))'} cantidadDevuelta,'' estado
        FROM ${c.name(a)} i OUTER APPLY (
          SELECT COUNT_BIG(*) cabeceras,MAX(x.R_E_C_N_O_) recno,${str('MAX(x.'+q(f+'_MOEDA')+')')} moneda
          FROM ${c.name(h)} x WHERE x.D_E_L_E_T_=' ' AND x.${q(f+'_FILIAL')}=${physical(h)}
          AND ${['DOC','SERIE',party,'LOJA','TIPO','ESPECIE','TIPODOC'].map(field=>`x.${q(f+'_'+field)}=${value(field)}`).join(' AND ')}
        ) h WHERE i.D_E_L_E_T_=' ' AND ${value('FILIAL')}=${physical(a)} AND ${value('ESPECIE')}='${especie}'
        ${rem?`AND ${value('TIPODOC')}='50' AND ${value('TIPO')}='N' ${spec.emitted?'':`AND ${value('QTDAFAT')}>0`}`:''}`;
    };
    if (rules[spec.scope]) return rules[spec.scope].map(r=>invoice(...r)).join('\nUNION ALL\n');
    const sale=spec.scope==='pedidosVenta',alias=sale?'SC6':'SC7',p=sale?'C6':'C7';
    const field=x=>`i.${q(p+'_'+x)}`, ordered=sale?'QTDVEN':'QUANT', applied=sale?'QTDENT':'QUJE', price=sale?'PRCVEN':'PRECO';
    this.require(alias,['FILIAL','NUM','ITEM','PRODUTO','UM',ordered,applied,price,...(sale?['CLI','LOJA','ENTREG','BLQ']:['FORNECE','LOJA','EMISSAO','MOEDA','RESIDUO','ENCER','CONAPRO'])].map(x=>p+'_'+x),[ordered,applied,price,...(sale?[]:['MOEDA'])].map(x=>p+'_'+x));
    if(sale)this.require('SC5',['C5_FILIAL','C5_NUM','C5_MOEDA','C5_EMISSAO'],['C5_MOEDA']);
    const qty=`(${decimal(field(ordered))}-${decimal(field(applied))})`;
    return `SELECT '${alias}' origen,${str('i.R_E_C_N_O_')} registro,${text(field('NUM'))} numero,'' serie,${text(field('ITEM'))} item,
      'PEDIDO' clase,'' especie,'' tipoDocumento,'' tipo,${text(field(sale?'CLI':'FORNECE'))} tercero,${text(field('LOJA'))} tienda,
      ${text(field('PRODUTO'))} producto,${text(field('UM'))} unidad,${sale?'h.fecha':text(field('EMISSAO'))} fecha,
      ${sale?'h.moneda':str(field('MOEDA'))} moneda,${sale?'h.cabeceras':'CAST(1 AS bigint)'} cabeceras,${text(field('NUM'))} documentoClave,
      ${qty} cantidad,${decimal(field(price))} precioUnitario,${decimal(`${qty}*${decimal(field(price))}`)} importe,
      ${decimal(field(ordered))} cantidadOriginal,CAST(NULL AS decimal(28,6)) cantidadFacturada,CAST(NULL AS decimal(28,6)) cantidadDevuelta,
      ${text(field(sale?'BLQ':'CONAPRO'))} estado FROM ${c.name(alias)} i
      ${sale?`OUTER APPLY (SELECT COUNT_BIG(*) cabeceras,MAX(C5_EMISSAO) fecha,${str('MAX(C5_MOEDA)')} moneda FROM ${c.name('SC5')} WHERE D_E_L_E_T_=' ' AND C5_FILIAL=${physical('SC5')} AND C5_NUM=i.C6_NUM) h`:''}
      WHERE i.D_E_L_E_T_=' ' AND ${field('FILIAL')}=${physical(alias)} AND ${qty}>0
      ${sale?"AND i.C6_BLQ<>'R'":"AND i.C7_RESIDUO=' ' AND i.C7_ENCER=' '"}`;
  }
  build(resource,params) {
    const spec=commercialParams(resource,params),bindings={};
    const base=this.base(spec,bindings),where=[];
    for(const [key,col] of Object.entries({numero:'numero',serie:'serie',producto:'producto',cliente:'tercero',proveedor:'tercero',tienda:'tienda',clase:'clase',moneda:'moneda'})) if(spec.filters[key]) {
      bindings[key]=spec.filters[key];where.push(`${q(col)}=@${key}`);
    }
    for(const [key,op] of [['desde','>='],['hasta','<=']]) if(spec.filters[key]) {bindings[key]=spec.filters[key].replaceAll('-','');where.push(`fecha${op}@${key}`);}
    const cte=`WITH movimientos AS (${base}), alcance AS (SELECT * FROM movimientos${where.length?' WHERE '+where.join(' AND '):''})`;
    if (!spec.summary) {
      bindings.offset=(spec.page-1)*spec.limit;bindings.take=spec.limit+1;
      return {spec,bindings,text:`${cte} SELECT origen,registro,numero,serie,item,clase,especie,tipoDocumento,tipo,tercero,tienda,producto,unidad,fecha,moneda,cabeceras,estado,
        ${str('cantidad')} cantidad,${str('precioUnitario')} precioUnitario,${str('importe')} importe,
        ${str('cantidadOriginal')} cantidadOriginal,${str('cantidadFacturada')} cantidadFacturada,${str('cantidadDevuelta')} cantidadDevuelta
        FROM alcance ORDER BY fecha DESC,origen,registro OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY`};
    }
    const dimensions={mes:'SUBSTRING(fecha,1,6)',tercero:"CONCAT(tercero,' / ',tienda)",producto:'producto',clase:'clase'};
    const dimension=dimensions[spec.group];
    return {spec,bindings,text:`${cte}, grupos AS (SELECT *,${dimension} dimension FROM alcance)
      SELECT TOP (5001) CASE WHEN GROUPING(dimension)=1 THEN 'total' ELSE 'detalle' END agrupacion,dimension,moneda,unidad,
      ${str('COUNT_BIG(*)')} lineas,${str('COUNT(DISTINCT documentoClave)')} documentos,
      ${str('SUM(cantidad)')} cantidad,${str('SUM(importe)')} importeNeto,
      ${str("SUM(CASE WHEN clase='NF' THEN importe ELSE 0 END)")} facturas,
      ${str("SUM(CASE WHEN clase='NC' THEN -importe ELSE 0 END)")} notasCredito,
      ${str("SUM(CASE WHEN clase='ND' THEN importe ELSE 0 END)")} notasDebito,
      ${str('SUM(CASE WHEN cabeceras<>1 THEN 1 ELSE 0 END)')} cabecerasInvalidas
      FROM grupos GROUP BY GROUPING SETS ((moneda,unidad),(moneda,unidad,dimension))
      ORDER BY GROUPING(dimension) DESC,moneda,unidad,dimension`};
  }
  async list(resource,params) {
    const {text:sql,bindings,spec}=this.build(resource,params);
    let rows=await this.db.query(sql,bindings);
    if (rows.some(r=>spec.summary?Number(r.cabecerasInvalidas)>0:Number(r.cabeceras)!==1)) throw new ApiError(503,'CABECERA_AMBIGUA_O_AUSENTE','No se puede determinar una cabecera única y su moneda; no se publicaron importes');
    if(spec.summary && rows.length>5000) throw new ApiError(422,'RESUMEN_EXTENSO','Hay más de 5000 grupos; acotá filtros o agrupá por mes');
    const more=!spec.summary&&rows.length>spec.limit;
    if(!spec.summary) rows=rows.slice(0,spec.limit);
    const data=rows.map(row=>{
      const r=Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='string'?v.trim():v]));
      delete r.cabeceras;delete r.cabecerasInvalidas;delete r.documentoClave;
      if(r.fecha?.length===8)r.fecha=`${r.fecha.slice(0,4)}-${r.fecha.slice(4,6)}-${r.fecha.slice(6,8)}`;
      if(r.unidad==='UN' && r.cantidad!=null)r.cantidadMillares=new Decimal(r.cantidad).div(1000).toFixed();
      return r;
    });
    const pending=!spec.emitted&&!['ventas','compras'].includes(spec.scope);
    const limitations=[
      'Lectura consultiva; no crea ni modifica documentos.',
      'Importes almacenados agrupados por moneda de cabecera y unidad, sin conversión cambiaria. No sumar monedas ni unidades distintas.',
      'Precisión del informe: 6 decimales. Cantidades en la unidad original; millares sólo para UN.',
      pending?'Importe pendiente estimado = saldo actual × precio. El período filtra emisión, no reconstruye saldos históricos. No es facturación, deuda ni confirmación de entrega física.':'Total de ítems SD1/SD2: no incluye automáticamente impuestos, fletes ni el total final de cabecera. NC resta su valor absoluto.',
      spec.emitted?'Remitos emitidos RFN/50: no representan facturación ni recepción física.':
      spec.scope==='remitos'?'Pendiente de facturar = D2_QTDAFAT en remito normal RFN/50. No indica recepción física por el cliente.':
      pending?'Saldo positivo de cantidad pedida menos atendida; excluye residuos/cierres conocidos. Puede incluir ítems bloqueados o pendientes de aprobación.':
      'Ventas: SD2 NF/NDC y SD1 NCC. Compras: SD1 NF/NDP y SD2 NCP. Otras especies no se incluyen.',
    ];
    const filters=Object.fromEntries(Object.entries(spec.filters).filter(([k])=>!['sucursal','desde','hasta','page','limit','orden','agrupar'].includes(k)));
    const scope={sucursal:spec.filters.sucursal,desde:spec.filters.desde||null,hasta:spec.filters.hasta||null,fecha:'emisión',agrupar:spec.group,filtros:filters};
    const result={kind:spec.summary?'dashboard':'commercial',title:spec.label,data,scope,meta:{recurso:resource,page:spec.summary?1:spec.page,limit:spec.limit,hasMore:more,complete:spec.summary,aggregate:spec.summary||false},limitations};
    if(spec.summary) {
      const totals=data.filter(r=>r.agrupacion==='total');
      result.verifiedSummary=`${spec.label}, del ${scope.desde} al ${scope.hasta}, sucursal ${scope.sucursal}.${Object.keys(filters).length?' Filtros: '+JSON.stringify(filters)+'.':''}\n`+
        (totals.length?totals.map(r=>`Moneda ${r.moneda||'sin determinar'} · ${r.unidad||'unidad no informada'}: ${r.documentos} documentos, ${r.lineas} ítems, ${pending?'importe pendiente estimado':'NF + ND − NC'} ${r.importeNeto}; cantidad ${r.cantidad}${r.cantidadMillares!==undefined?' ('+r.cantidadMillares+' millares)':''}.`).join('\n'):'No hay movimientos de las especies incluidas para estos filtros.')+
        '\nSe calculó todo el alcance filtrado en SQL, no una suma de la primera página. '+limitations.slice(1).join(' ');
    }
    return result;
  }
  metadata() {
    return Object.fromEntries(Object.entries(commercialResources).map(([name,s])=>[name,{
      alias:s.label,disponible:true,requiereConfigurarSucursal:false,fechaFiltro:'emisión',aggregate:!!s.summary,
      filters:{numero:'documento',producto:'producto',...(['compras','pedidosCompra'].includes(s.scope)?{proveedor:'código'}:{cliente:'código'}),tienda:'tienda',moneda:'código',...(['ventas','compras'].includes(s.scope)?{clase:'NF | NC | ND'}:{}),...(s.summary?{agrupar:'mes | tercero | producto | clase'}:{serie:'serie'})},
      advertencias:['Consulta de solo lectura; moneda y unidad separadas'],fields:[],
    }]));
  }
}

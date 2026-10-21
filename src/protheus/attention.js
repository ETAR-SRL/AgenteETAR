import Decimal from 'decimal.js';
import {ApiError,identifier as q} from './config.js';
import {Commercial} from './commercial.js';
export const attentionResources={atencionVentas:'sale',atencionCompras:'purchase',atencionRemitos:'remit'};
const numeric=new Set(['float','real','decimal','numeric','int','bigint','smallint','money','smallmoney']);
const tr=x=>`RTRIM(LTRIM(${x}))`,dec=x=>`CONVERT(decimal(28,6),${x})`;
export class AttentionReader {
 constructor(db,catalog){this.db=db;this.c=catalog;this.commercial=new Commercial(db,catalog);}
 build(resource,params){
  const kind=attentionResources[resource];if(!kind)throw new ApiError(404,'RECURSO_NO_EXISTE','Consulta inexistente');
  for(const key of params.keys())if(!['sucursal','hoy','cursor','registro','numero','serie','item','tercero','tienda','limit'].includes(key)||params.getAll(key).length!==1)throw new ApiError(400,'FILTRO_INVALIDO','Consulta operativa inválida');
  const branch=params.get('sucursal'),today=params.get('hoy');
  if(!branch||!/^\d{4}-\d{2}-\d{2}$/.test(today||'')||!Number.isFinite(Date.parse(today))||new Date(today).toISOString().slice(0,10)!==today)throw new ApiError(400,'FECHA_INVALIDA','Indicar sucursal y fecha válidas');
  const limit=Number(params.get('limit')||100);if(!Number.isInteger(limit)||limit<1||limit>100)throw new ApiError(400,'PAGINACION_INVALIDA','Hasta 100 ítems por revisión');
  const bindings={today:today.replaceAll('-',''),take:limit+1};
  const physical=alias=>{bindings['b'+alias]=this.c.branch(alias,branch);return '@b'+alias;};
  const req=(alias,fields)=>{const t=this.c.table(alias);for(const f of ['R_E_C_N_O_','D_E_L_E_T_',...fields])if(!t.columns.has(f))throw new ApiError(503,'ESQUEMA_INCOMPATIBLE','Falta un campo para verificar pendientes');};
  const remit=kind==='remit',sale=kind==='sale',alias=remit?'SD2':sale?'SC6':'SC7',p=alias.slice(1),f=x=>`i.${q(p+'_'+x)}`;
  const ordered=remit?'QUANT':sale?'QTDVEN':'QUANT',applied=remit?'QTDEFAT':sale?'QTDENT':'QUJE',price=remit||sale?'PRCVEN':'PRECO',date=remit?'EMISSAO':sale?'ENTREG':'DATPRF',party=remit?'CLIENTE':sale?'CLI':'FORNECE';
  const needed=[remit?'DOC':'NUM','ITEM',remit?'COD':'PRODUTO','UM',ordered,applied,price,date,party,'LOJA',...(remit?['SERIE','ESPECIE','TIPODOC','TIPO','QTDAFAT','QTDEDEV']:sale?['BLQ']:['MOEDA','RESIDUO','ENCER'])];
  req(alias,['FILIAL',...needed].map(x=>p+'_'+x));
  for(const name of [ordered,applied,price,...(remit?['QTDAFAT','QTDEDEV']:[])])if(!numeric.has(this.c.table(alias).columns.get(p+'_'+name).type?.toLowerCase()))throw new ApiError(503,'ESQUEMA_INCOMPATIBLE','Cantidad o importe no numérico');
  const qty=remit?dec(f('QTDAFAT')):`(${dec(f(ordered))}-${dec(f(applied))})`,live=remit?`${f('ESPECIE')}='RFN' AND ${f('TIPODOC')}='50' AND ${f('TIPO')}='N'`:sale?`${f('BLQ')}<>'R'`:`${f('RESIDUO')}=' ' AND ${f('ENCER')}=' '`;
  let header='',currency,partyName='NULL',headers='1';
  if(sale){req('SC5',['C5_FILIAL','C5_NUM','C5_CLIENTE','C5_LOJACLI','C5_MOEDA']);header=`OUTER APPLY (SELECT COUNT_BIG(*) n,MAX(C5_MOEDA) moneda FROM ${this.c.name('SC5')} h WHERE h.D_E_L_E_T_=' ' AND h.C5_FILIAL=${physical('SC5')} AND h.C5_NUM=i.C6_NUM AND h.C5_CLIENTE=i.C6_CLI AND h.C5_LOJACLI=i.C6_LOJA) h`;currency='h.moneda';headers='h.n';}
  else if(remit){req('SF2',['F2_FILIAL','F2_DOC','F2_SERIE','F2_CLIENTE','F2_LOJA','F2_ESPECIE','F2_TIPO','F2_TIPODOC','F2_MOEDA']);header=`OUTER APPLY(SELECT COUNT_BIG(*) n,MAX(F2_MOEDA) moneda FROM ${this.c.name('SF2')} h WHERE h.D_E_L_E_T_=' ' AND h.F2_FILIAL=${physical('SF2')} AND ${['DOC','SERIE','CLIENTE','LOJA','ESPECIE','TIPO','TIPODOC'].map(x=>`h.${q('F2_'+x)}=${f(x)}`).join(' AND ')}) h`;currency='h.moneda';headers='h.n';}
  else currency=f('MOEDA');
  const a=kind==='purchase'?'SA2':'SA1',ap=a.slice(1);req(a,[ap+'_FILIAL',ap+'_COD',ap+'_LOJA',ap+'_NOME']);
  header+=` OUTER APPLY(SELECT COUNT_BIG(*) n,MAX(${q(ap+'_NOME')}) nome FROM ${this.c.name(a)} t WHERE t.D_E_L_E_T_=' ' AND t.${q(ap+'_FILIAL')}=${physical(a)} AND t.${q(ap+'_COD')}=${f(party)} AND t.${q(ap+'_LOJA')}=${f('LOJA')}) party`;
  partyName='CASE WHEN party.n=1 THEN RTRIM(party.nome) ELSE NULL END';
  const where=[`i.D_E_L_E_T_=' '`,`${f('FILIAL')}=${physical(alias)}`];
  if(remit)where.push(live);
  for(const [key,col]of [['tercero',party],['tienda','LOJA']])if(params.has(key)){bindings[key]=params.get(key);where.push(`${f(col)}=@${key}`);}
  if(params.has('cursor')){if(!/^\d{1,19}$/.test(params.get('cursor')))throw new ApiError(400,'FILTRO_INVALIDO','Cursor inválido');bindings.cursor=params.get('cursor');where.push('i.R_E_C_N_O_>@cursor');}
  const exact=params.has('registro')||params.has('numero');
  if(params.has('registro')){const v=params.get('registro');if(!/^[1-9]\d{0,18}$/.test(v))throw new ApiError(400,'FILTRO_INVALIDO','Registro inválido');bindings.record=v;where.push('i.R_E_C_N_O_=@record');}
  if(params.has('numero')){bindings.number=params.get('numero');where.push(`${f(remit?'DOC':'NUM')}=@number`);}
  for(const [key,col]of [['serie','SERIE'],['item','ITEM']])if(params.has(key)){if(key==='serie'&&!remit)throw new ApiError(400,'FILTRO_INVALIDO','Serie sólo para remitos');bindings[key]=params.get(key);where.push(`${f(col)}=@${key}`);}
  if(!exact){if(params.has('cursor')&&!/^\d{1,19}$/.test(params.get('cursor')))throw new ApiError(400,'FILTRO_INVALIDO','Cursor inválido');bindings.cursor=params.get('cursor')||'0';where.push('i.R_E_C_N_O_>@cursor',qty+'>0',live);if(!remit)where.push(`TRY_CONVERT(date,${f(date)},112)<CONVERT(date,@today,112)`);}
  const sql=`SELECT TOP(@take) CONVERT(varchar(30),i.R_E_C_N_O_) registro,${tr(f(remit?'DOC':'NUM'))} numero,${remit?tr(f('SERIE')):"''"} serie,${tr(f('ITEM'))} item,
   ${tr(f(remit?'COD':'PRODUTO'))} producto,${tr(f(party))} tercero,${tr(f('LOJA'))} tienda,${partyName} nombre,${headers} cabeceras,
   ${remit&&this.c.table(alias).columns.has('D2_PEDIDO')?tr(f('PEDIDO')): 'NULL'} pedidoVenta,${remit&&this.c.table(alias).columns.has('D2_ITEMPV')?tr(f('ITEMPV')):'NULL'} itemPedidoVenta,
   ${tr(f('UM'))} unidad,${tr(f(date))} fecha,CONVERT(varchar(12),${currency}) moneda,
   CONVERT(varchar(80),${qty}) cantidad,CONVERT(varchar(80),${dec(f(ordered))}) pedida,CONVERT(varchar(80),${dec(f(applied))}) atendida,
   CONVERT(varchar(80),${dec(f(price))}) precio,CONVERT(varchar(80),${qty}*${dec(f(price))}) importe,
   ${remit?'CONVERT(varchar(80),'+dec(f('QTDEDEV'))+')':"'0'"} devuelta,CASE WHEN ${live} THEN 1 ELSE 0 END vigente
   FROM ${this.c.name(alias)} i ${header} WHERE ${where.join(' AND ')} ORDER BY i.R_E_C_N_O_`;
  return {text:sql,bindings,kind,branch,today,limit};
 }
 async list(resource,params){
  const b=this.build(resource,params),all=await this.db.query(b.text,b.bindings);
  if(all.some(r=>Number(r.cabeceras)!==1))throw new ApiError(503,'CABECERA_NO_VERIFICADA','No se pudo verificar una cabecera y moneda únicas');
  const currencies=await this.commercial.currencies(b.branch),hasMore=all.length>b.limit;
  const data=all.slice(0,b.limit).map(row=>{const r=Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='string'?v.trim():v]));delete r.cabeceras;if(/^\d{8}$/.test(r.fecha))r.fecha=r.fecha.slice(0,4)+'-'+r.fecha.slice(4,6)+'-'+r.fecha.slice(6,8);r.monedaNombre=currencies[r.moneda]||'Moneda sin descripción ('+r.moneda+')';r.kind=b.kind;r.sucursal=b.branch;if(r.unidad==='UN')r.cantidadMillares=new Decimal(r.cantidad).div(1000).toFixed();return r;});
  return {data,meta:{recurso:resource,hasMore,cursor:data.at(-1)?.registro||null,limit:b.limit},source:{system:'protheus',fetchedAt:new Date().toISOString()},limitations:['Lectura consultiva. Pendientes de cantidades, no recepción física confirmada. Importes estimados sin impuestos/fletes y separados por moneda.']};
 }
 metadata(){return Object.fromEntries(Object.keys(attentionResources).map(name=>[name,{operational:true,disponible:true,alias:'Atención operativa · consulta acotada',fields:[],filters:{hoy:'AAAA-MM-DD',cursor:'registro anterior',registro:'registro exacto',numero:'documento',item:'ítem'}}]));}
}

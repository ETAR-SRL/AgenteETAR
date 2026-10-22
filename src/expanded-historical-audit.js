import Decimal from 'decimal.js';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const safeCode=e=>/^[A-Z][A-Z0-9_]{0,63}$/.test(e?.code||'')?e.code:'AUDIT_READ_FAILED';
const value=v=>v&&typeof v==='object'?v.codigo:v;
const unit=row=>String(value(row.unidadMedida)||value(row.producto?.unidadMedida)||'').trim().toUpperCase();
const safeUnit=u=>['UN','KG','M','MT','M2','M3','LT','L','CJ','PC'].includes(u)?u:u?'OTHER':'UNKNOWN';
const numeric=v=>v!==null&&v!==undefined&&v!==''&&new Decimal(v).isFinite();
export function summarizeHistoricalRows(resource,rows,fields=[]){
 const precision=fields.find(f=>(f.salida||f.output)==='cantidadMillares')?.diccionario?.X3_DECIMAL;
 const dp=/^\d{1,2}$/.test(String(precision??''))?Number(precision):null;
 const summary={rows:rows.length,precision:dp,units:{},statuses:{},exactMatches:0,precisionMatches:0,differences:0,zeroDifferences:0,nonzeroDifferences:0,unknownUnit:0,excludedOtherUnit:0,missingValues:0,invalidValues:0,dateMin:null,dateMax:null};
 for(const row of rows){
  const um=unit(row),u=safeUnit(um);summary.units[u]=(summary.units[u]||0)+1;
  let status='unknown';try{const ordered=row.cantidadPedida,applied=row.cantidadAtendida??row.cantidadEnPedidos;if(numeric(ordered)&&numeric(applied))status=new Decimal(ordered).minus(applied).gt(0)?'positive_balance':'no_positive_balance';}catch{}
  const state=[status,value(row.bloqueoCodigo)?'block_code_present':'no_block_code',row.documentoSalida?'document_reference_present':'no_document_reference'].join('|');summary.statuses[state]=(summary.statuses[state]||0)+1;
  const date=resource==='entradasCompras'?row.fechaRegistro:row.fechaEmision??row.fechaEntregaPrevista;if(/^\d{4}-\d{2}-\d{2}$/.test(date||'')){if(!summary.dateMin||date<summary.dateMin)summary.dateMin=date;if(!summary.dateMax||date>summary.dateMax)summary.dateMax=date;}
  if(!['itemsVentas','itemsDocumentosSalida'].includes(resource))continue;
  if(!um){summary.unknownUnit++;continue;}if(um!=='UN'){summary.excludedOtherUnit++;continue;}
  const qty=row.cantidadPedida??row.cantidadDocumentada,stored=row.cantidadMillares;
  if([qty,stored].some(v=>v===null||v===undefined||v==='')){summary.missingValues++;continue;}
  try{if(!numeric(qty)||!numeric(stored))throw Error();const expected=new Decimal(qty).div(1000),actual=new Decimal(stored);if(expected.eq(actual))summary.exactMatches++;else if(dp!==null&&expected.toDecimalPlaces(dp,Decimal.ROUND_HALF_UP).eq(actual.toDecimalPlaces(dp,Decimal.ROUND_HALF_UP)))summary.precisionMatches++;else{summary.differences++;summary[actual.isZero()?'zeroDifferences':'nonzeroDifferences']++;}}catch{summary.invalidValues++;}
 }
 return summary;
}

// Only existing adapter contracts; no proposal, Store or writer methods are invoked.
export async function runExpandedHistoricalAudit({erp,branch,today,windows,limit=25,pages=2}){
 if(erp.writes?.enabled!==false)fail('AUDIT_WRITER_NOT_DISABLED');
 if(!branch||!/^\d{4}-\d{2}-\d{2}$/.test(today)||!Array.isArray(windows)||!windows.length||windows.length>4||!Number.isInteger(limit)||limit<1||limit>25||!Number.isInteger(pages)||pages<1||pages>2)fail('AUDIT_ARGUMENTS');
 for(const w of windows)if(!/^\d{4}-\d{2}-\d{2}$/.test(w.desde)||!/^\d{4}-\d{2}-\d{2}$/.test(w.hasta)||w.desde>w.hasta||w.hasta>today)fail('AUDIT_ARGUMENTS');
 const metadata=erp.metadata(),report={version:1,checkedAt:new Date().toISOString(),readOnly:true,erpWrites:0,realValidation:'partial_requires_review',scope:{windows,limit,pages,dateSC6:'C6_ENTREG (fecha prevista, no emisión)',dateSD2:'D2_EMISSAO',dateSD1:'D1_DTDIGIT (registro)',comparison:'Decimal exacto; si difiere, ambos valores redondeados HALF_UP a SX3',branches:1},reads:0,maxReads:5*windows.length*pages+8+24,results:[],links:[]},samples={};
 const physical=name=>{const rule=metadata.entities?.[name]?.sucursalesConfiguradas;return String(typeof rule==='string'?rule:rule?.[branch]??branch).trim();};
 const read=async(name,params)=>{report.reads++;if(report.reads>report.maxReads)fail('AUDIT_BUDGET');const r=await erp.list(name,new URLSearchParams({sucursal:branch,page:'1',limit:String(limit),...params}));if(!Array.isArray(r.data)||r.data.length>Number(params.limit||limit))fail('AUDIT_CONTRACT');if(!['documentosPedidoVenta'].includes(name)&&r.data.some(row=>String(row.sucursal??'').trim()!==physical(name)))fail('AUDIT_BRANCH_IDENTITY');return r;};
 for(const name of ['solicitudesCompra','compras','itemsVentas','itemsDocumentosSalida','entradasCompras']){
  samples[name]=[];
  const scopes=['solicitudesCompra','compras'].includes(name)?[{unfiltered:true},...windows]:windows;
  for(const w of scopes){const found=[];let hasMore=false,readPages=0,error=null;
   for(let p=1;p<=pages;p++){try{const r=await read(name,{...(w.unfiltered?{}:{desde:w.desde,hasta:w.hasta,orden:'reciente'}),page:String(p)});found.push(...r.data);readPages++;hasMore=r.meta?.hasMore===true;if(!hasMore)break;}catch(e){error=safeCode(e);break;}}
   samples[name].push(...found);report.results.push({resource:name,scope:w,readPages,hasMore,status:error?'failed':found.length?'observed':'pending',...(error?{code:error}:{}),summary:summarizeHistoricalRows(name,found,metadata.entities?.[name]?.fields||[])});
  }
 }
 // Reverse exact links are selected from SD2 that actually carries origin keys, rather than guessing a historical order.
 report.schema=Object.fromEntries(['itemsVentas','itemsDocumentosSalida','solicitudesCompra','compras','entradasCompras'].map(name=>[name,{dateField:metadata.entities?.[name]?.fechaFiltro??null,fields:(metadata.entities?.[name]?.fields||[]).filter(f=>/MILLAR|QTDVEN|QUANT|_UM$/.test(f.origen||'')).map(f=>({field:f.origen,available:f.disponible===true,type:f.tipoFisico??null,decimalPlaces:/^\d{1,2}$/.test(String(f.diccionario?.X3_DECIMAL??''))?Number(f.diccionario.X3_DECIMAL):null}))}]));
 const unique=new Map(samples.itemsDocumentosSalida.map(r=>[r.registro,r])),verifiedOrigins=[];
 const candidates=[...unique.values()].filter(r=>r.pedidoVenta&&r.itemPedidoVenta&&r.productoCodigo&&r.terceroCodigo&&r.terceroTienda).slice(0,5);
 report.linkSelection={sampledUniqueSD2:unique.size,withCompleteOrigin:[...unique.values()].filter(r=>r.pedidoVenta&&r.itemPedidoVenta&&r.productoCodigo&&r.terceroCodigo&&r.terceroTienda).length,selected:candidates.length};
 for(const row of candidates){try{
  const r=await read('itemsVentas',{numero:String(row.pedidoVenta),item:String(row.itemPedidoVenta),producto:String(row.productoCodigo),cliente:String(row.terceroCodigo),tienda:String(row.terceroTienda),limit:'2'});
  const matches=r.data.filter(v=>v.numero===row.pedidoVenta&&String(v.item)===String(row.itemPedidoVenta)&&v.productoCodigo===row.productoCodigo&&v.clienteCodigo===row.terceroCodigo&&v.clienteTienda===row.terceroTienda);
  const verified=matches.length===1&&r.data.length===1&&!r.meta?.hasMore;
  if(verified)verifiedOrigins.push(matches[0]);
  report.links.push({name:'SD2_SC6_exact_origin',status:verified?'observed':'pending',rows:r.data.length,hasMore:r.meta?.hasMore===true,identity:verified?'unique_exact':'missing_ambiguous_or_mismatched',...(verified?{SC6:summarizeHistoricalRows('itemsVentas',matches,metadata.entities?.itemsVentas?.fields||[]),SD2:summarizeHistoricalRows('itemsDocumentosSalida',[row],metadata.entities?.itemsDocumentosSalida?.fields||[]),quantityRelation:'individual_document_vs_order_not_assumed_equal'}:{})});
 }catch(e){report.links.push({name:'SD2_SC6_exact_origin',status:'failed',code:safeCode(e)});}}
 const purchaseOrigins=[...new Map(samples.entradasCompras.map(r=>[r.registro,r])).values()].filter(r=>r.pedidoCompra&&r.itemPedidoCompra&&r.productoCodigo&&r.terceroCodigo&&r.terceroTienda).slice(0,5);
 report.purchaseLinkSelection={selected:purchaseOrigins.length};
 for(const row of purchaseOrigins){try{const r=await read('compras',{numero:String(row.pedidoCompra),item:String(row.itemPedidoCompra),producto:String(row.productoCodigo),proveedor:String(row.terceroCodigo),tienda:String(row.terceroTienda),limit:'2'});const valid=r.data.length===1&&!r.meta?.hasMore&&r.data.every(v=>v.numero===row.pedidoCompra&&v.item===row.itemPedidoCompra&&v.productoCodigo===row.productoCodigo&&v.proveedorCodigo===row.terceroCodigo&&v.proveedorTienda===row.terceroTienda);report.links.push({name:'SD1_SC7_exact_origin',status:valid?'observed':'pending',rows:r.data.length,hasMore:r.meta?.hasMore===true,identity:valid?'unique_exact':'missing_ambiguous_or_mismatched'});}catch(e){report.links.push({name:'SD1_SC7_exact_origin',status:'failed',code:safeCode(e)});}}
 const orders=[...new Map([...verifiedOrigins,...samples.itemsVentas].filter(r=>r.numero&&r.clienteCodigo&&r.clienteTienda).map(r=>[JSON.stringify([r.numero,r.clienteCodigo,r.clienteTienda]),r])).values()].slice(0,3);
 for(const row of orders)for(const documents of ['remitos','facturas']){try{const r=await read('documentosPedidoVenta',{pedido:String(row.numero),cliente:String(row.clienteCodigo),tienda:String(row.clienteTienda),documentos:documents});const valid=r.data.every(v=>v.tercero===row.clienteCodigo&&v.tienda===row.clienteTienda);report.links.push({name:'SC6_documentosPedidoVenta_'+documents,status:valid?(r.data.length?'observed':'pending'):'failed',rows:r.data.length,hasMore:r.meta?.hasMore===true,identity:valid?'exact_existing_resource_contract':'party_mismatch'});}catch(e){report.links.push({name:'SC6_documentosPedidoVenta_'+documents,status:'failed',code:safeCode(e)});}}
 report.checksStatus=report.results.some(r=>r.status==='failed')||report.links.some(r=>r.status==='failed')?'failed':'bounded_reads_completed';
 report.historicalReview=report.results.some(r=>r.summary.differences>0)?'differences_observed_no_correction':'bounded_sample_only';
 return report;
}

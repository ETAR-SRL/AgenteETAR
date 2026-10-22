import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeHistoricalRows,runExpandedHistoricalAudit} from '../src/expanded-historical-audit.js';
const fields=[{salida:'cantidadMillares',diccionario:{X3_DECIMAL:'4'}}];
const windows=[{desde:'2025-01-01',hasta:'2025-12-31'}];
function adapter(list=async()=>({data:[],meta:{hasMore:false}})){return {writes:{enabled:false,execute(){throw Error('MUST NEVER EXECUTE');}},metadata:()=>({entities:Object.fromEntries(['compras','solicitudesCompra','itemsVentas','itemsDocumentosSalida','entradasCompras'].map(n=>[n,{fields,sucursalesConfiguradas:{TEST:'TEST'}}]))}),list};}
test('historical comparisons separate stored zero, nonzero, SX3 rounding, units and invalid values',()=>{
 const base={unidadMedida:'UN',cantidadDocumentada:'1234.56'};
 const result=summarizeHistoricalRows('itemsDocumentosSalida',[{...base,cantidadMillares:'0'},{...base,cantidadMillares:'8'},{...base,cantidadMillares:'1.2346'},{...base,cantidadMillares:'1.23456'},{...base,cantidadMillares:null},{...base,cantidadMillares:'oops'},{...base,unidadMedida:'KG',cantidadMillares:'0'},{cantidadDocumentada:'1000',cantidadMillares:'0'}],fields);
 assert.equal(result.zeroDifferences,1);assert.equal(result.nonzeroDifferences,1);assert.equal(result.precisionMatches,1);assert.equal(result.exactMatches,1);assert.equal(result.missingValues,1);assert.equal(result.invalidValues,1);assert.equal(result.excludedOtherUnit,1);assert.equal(result.unknownUnit,1);
 assert.equal(summarizeHistoricalRows('itemsDocumentosSalida',[{...base,cantidadMillares:'1.2346'}],[]).differences,1);
 assert.equal(summarizeHistoricalRows('itemsDocumentosSalida',[{...base,cantidadMillares:'1.2346000000000001'}],fields).precisionMatches,1);
});
test('writer and invalid bounds fail before reads; empty bounded pages remain pending',async()=>{
 let calls=0;const erp=adapter(async()=>{calls++;return {data:[],meta:{hasMore:false}};});erp.writes.enabled=true;
 await assert.rejects(runExpandedHistoricalAudit({erp,branch:'TEST',today:'2026-10-22',windows}),{code:'AUDIT_WRITER_NOT_DISABLED'});assert.equal(calls,0);erp.writes.enabled=false;
 await assert.rejects(runExpandedHistoricalAudit({erp,branch:'TEST',today:'2026-10-22',windows,limit:26}),{code:'AUDIT_ARGUMENTS'});assert.equal(calls,0);
 const r=await runExpandedHistoricalAudit({erp,branch:'TEST',today:'2026-10-22',windows});assert.equal(r.realValidation,'partial_requires_review');assert.equal(r.erpWrites,0);assert(r.results.every(v=>v.status==='pending'));assert.equal(calls,7);
});
test('two pages maximum retain hasMore, use date filters and persist sanitized aggregates only',async()=>{
 const calls=[];const erp=adapter(async(name,params)=>{calls.push({name,p:Object.fromEntries(params)});return {data:[{registro:params.get('page'),sucursal:'TEST',productoCodigo:'PRIVATE_PRODUCT',descripcion:'PRIVATE_NAME',unidadMedida:'UN',cantidadPedida:'1000',cantidadMillares:'0'}],meta:{hasMore:true}};});
 const r=await runExpandedHistoricalAudit({erp,branch:'TEST',today:'2026-10-22',windows});assert.equal(calls.length,14);assert(calls.every(c=>Number(c.p.page)<=2&&c.p.sucursal==='TEST'));assert(r.results.every(v=>v.hasMore));assert.equal(r.historicalReview,'differences_observed_no_correction');assert(!JSON.stringify(r).includes('PRIVATE'));assert(calls.filter(c=>c.name==='itemsVentas').every(c=>c.p.desde==='2025-01-01'&&c.p.orden==='reciente'));
});
test('cross-branch rows and controller messages never become accepted or leak',async()=>{
 const erp=adapter(async(name)=>{if(name==='compras')throw Object.assign(Error('secret password customer'),{code:'DB_DOWN'});return {data:[{sucursal:'OTHER'}],meta:{}};});const r=await runExpandedHistoricalAudit({erp,branch:'TEST',today:'2026-10-22',windows});assert.equal(r.checksStatus,'failed');assert(r.results.every(v=>v.status==='failed'));assert(!JSON.stringify(r).includes('secret'));assert(r.results.some(v=>v.code==='AUDIT_BRANCH_IDENTITY'));
});
test('reverse document links require exact order item product party and unique result',async()=>{
 const calls=[];const erp=adapter(async(name,params)=>{
  calls.push({name,p:Object.fromEntries(params)});
  if(name==='itemsDocumentosSalida')return {data:[{sucursal:'TEST',registro:'55',pedidoVenta:'PRIVATE_ORDER',itemPedidoVenta:'01',productoCodigo:'PRIVATE_PRODUCT',terceroCodigo:'PRIVATE_CLIENT',terceroTienda:'01',producto:{unidadMedida:'UN'},cantidadDocumentada:'2000',cantidadMillares:'0'}],meta:{hasMore:false}};
  if(name==='itemsVentas'&&params.has('numero'))return {data:[{sucursal:'TEST',numero:'PRIVATE_ORDER',item:'01',productoCodigo:'PRIVATE_PRODUCT',clienteCodigo:'WRONG',clienteTienda:'01'}],meta:{hasMore:false}};
  return {data:[],meta:{hasMore:false}};
 });
 const r=await runExpandedHistoricalAudit({erp,branch:'TEST',today:'2026-10-22',windows});assert.equal(r.links[0].status,'pending');assert.equal(r.links[0].identity,'missing_ambiguous_or_mismatched');const c=calls.find(c=>c.name==='itemsVentas'&&c.p.numero);assert.deepEqual(c.p,{sucursal:'TEST',page:'1',limit:'2',numero:'PRIVATE_ORDER',item:'01',producto:'PRIVATE_PRODUCT',cliente:'PRIVATE_CLIENT',tienda:'01'});assert(!JSON.stringify(r).includes('PRIVATE'));
});
test('verified SD2 origin selects forward documents first and SD1 keeps exact purchase identity',async()=>{
 const calls=[];const erp=adapter(async(name,params)=>{calls.push({name,p:Object.fromEntries(params)});
  if(name==='itemsDocumentosSalida')return {data:[{registro:'55',sucursal:'TEST',pedidoVenta:'ORDER',itemPedidoVenta:'01',productoCodigo:'PROD',terceroCodigo:'CLIENT',terceroTienda:'01',producto:{unidadMedida:'UN'},cantidadDocumentada:'1000',cantidadMillares:'0'}],meta:{}};
  if(name==='itemsVentas'&&params.has('numero'))return {data:[{sucursal:'TEST',numero:'ORDER',item:'01',productoCodigo:'PROD',clienteCodigo:'CLIENT',clienteTienda:'01',unidadMedida:'UN',cantidadPedida:'1000',cantidadMillares:'0'}],meta:{}};
  if(name==='entradasCompras')return {data:[{registro:'70',sucursal:'TEST',pedidoCompra:'PC',itemPedidoCompra:'02',productoCodigo:'P',terceroCodigo:'SUPPLIER',terceroTienda:'01'}],meta:{}};
  if(name==='compras'&&params.has('numero'))return {data:[{sucursal:'TEST',numero:'PC',item:'02',productoCodigo:'P',proveedorCodigo:'SUPPLIER',proveedorTienda:'01'}],meta:{}};
  if(name==='documentosPedidoVenta')return {data:[{tercero:'CLIENT',tienda:'01'}],meta:{}};
  return {data:[],meta:{}};
 });
 const r=await runExpandedHistoricalAudit({erp,branch:'TEST',today:'2026-10-22',windows});assert(r.links.every(v=>v.status==='observed'));assert.equal(r.links.find(v=>v.name==='SD2_SC6_exact_origin').SC6.zeroDifferences,1);assert.equal(r.links.find(v=>v.name==='SD1_SC7_exact_origin').identity,'unique_exact');assert.deepEqual(calls.find(c=>c.name==='documentosPedidoVenta').p,{sucursal:'TEST',page:'1',limit:'25',pedido:'ORDER',cliente:'CLIENT',tienda:'01',documentos:'remitos'});assert(!JSON.stringify(r).includes('SUPPLIER'));
});

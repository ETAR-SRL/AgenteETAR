import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Commercial,commercialParams,commercialResources} from '../src/protheus/commercial.js';
import {Catalog} from '../src/protheus/catalog.js';
import {resourceDomains} from '../src/access.js';
const params=extra=>new URLSearchParams({sucursal:'0101',desde:'2026-10-01',hasta:'2026-10-20',...extra});
function fixture(rows=[]){
  const c=new Catalog(null,{branches:{},entities:{}}),queries=[];
  for(const [alias,fields] of Object.entries({
    SD1:'FILIAL DOC SERIE ITEM FORNECE LOJA COD UM ESPECIE TIPO TIPODOC EMISSAO QUANT TOTAL VUNIT',
    SD2:'FILIAL DOC SERIE ITEM CLIENTE LOJA COD UM ESPECIE TIPO TIPODOC EMISSAO QUANT TOTAL PRCVEN QTDAFAT QTDEFAT QTDEDEV',
    SF1:'FILIAL DOC SERIE FORNECE LOJA TIPO ESPECIE TIPODOC MOEDA',
    SF2:'FILIAL DOC SERIE CLIENTE LOJA TIPO ESPECIE TIPODOC MOEDA',
    SC5:'FILIAL NUM MOEDA EMISSAO',
    SC6:'FILIAL NUM ITEM PRODUTO UM QTDVEN QTDENT PRCVEN CLI LOJA ENTREG BLQ',
    SC7:'FILIAL NUM ITEM PRODUTO UM QUANT QUJE PRECO FORNECE LOJA EMISSAO MOEDA RESIDUO ENCER CONAPRO',
  })){
    const names=['R_E_C_N_O_','D_E_L_E_T_',...fields.split(' ').map(f=>alias.slice(1)+'_'+f)];
    c.tables.set(alias,{schema:'dbo',name:alias+'010',columns:new Map(names.map(name=>[name,{type:'decimal'}]))});
    c.config.branches[alias]={'0101':alias==='SD1'?'01':'0101'};
  }
  const service=new Commercial({query:async(sql,bindings)=>{queries.push({sql,bindings});return structuredClone(rows);}},c);
  return {service,c,queries,build:(r,p=params())=>service.build(r,p)};
}
test('commercial SQL classifies customer and supplier credit notes across SD1/SD2',()=>{
  const {build}=fixture(),sale=build('comprobantesVentas').text,purchase=build('comprobantesCompras').text;
  assert.match(sale,/'SD1' origen[\s\S]*'NC' clase,'NCC' especie/);
  assert.match(purchase,/'SD2' origen[\s\S]*'NC' clase,'NCP' especie/);
  assert.match(sale,/-ABS\(CONVERT\(decimal\(28,6\),i\.\[D1_TOTAL\]\)\)/);
  assert.match(purchase,/-ABS\(CONVERT\(decimal\(28,6\),i\.\[D2_TOTAL\]\)\)/);
  assert.doesNotMatch(sale,/'NCP'/);assert.doesNotMatch(purchase,/'NCC'/);
  assert.match(sale,/'NDC'/);assert.match(purchase,/'NDP'/);
});
test('commercial queries bind filters, isolate branches and require undeleted unique headers',()=>{
  const {build,c}=fixture(),r=build('resumenVentas',params({producto:"Z'; DELETE FROM SB1010;--"}));
  assert.doesNotMatch(r.text,/DELETE/);assert.equal(r.bindings.producto,"Z'; DELETE FROM SB1010;--");
  assert.equal(r.bindings.branchSD1,'01');assert.equal(r.bindings.branchSD2,'0101');
  assert.match(r.text,/i\.D_E_L_E_T_=' '/);assert.match(r.text,/x\.D_E_L_E_T_=' '/);
  assert.match(r.text,/x\.\[F1_FILIAL\]=@branchSF1/);assert.match(r.text,/x\.\[F2_MOEDA\]/);
  delete c.config.branches.SF1;
  assert.throws(()=>build('resumenVentas'),{code:'SUCURSAL_CONFIGURACION'});
});
test('pending remittances use billable balance; emitted remittances include fully billed rows',()=>{
  const {build}=fixture(),pending=build('remitosPendientes').text,emitted=build('remitosEmitidos').text;
  assert.match(pending,/\[D2_QTDAFAT\]>0/);assert.match(pending,/\[D2_TIPODOC\]='50'/);
  assert.doesNotMatch(emitted,/\[D2_QTDAFAT\]>0/);
  assert.match(emitted,/CONVERT\(decimal\(28,6\),i\.\[D2_QUANT\]\) cantidad/);
  assert.match(build('pedidosVentaPendientes').text,/C6_BLQ<>'R'/);
  assert.match(build('pedidosCompraPendientes').text,/C7_RESIDUO=' ' AND i.C7_ENCER=' '/);
});
test('summaries aggregate all matching lines and separate currencies and units',()=>{
  const {build}=fixture(),r=build('resumenCompras',params({agrupar:'tercero',limit:'1'}));
  assert.match(r.text,/GROUP BY GROUPING SETS \(\(moneda,unidad\),\(moneda,unidad,dimension\)\)/);
  assert.match(r.text,/COUNT\(DISTINCT documentoClave\)/);assert.doesNotMatch(r.text,/OFFSET|FETCH/);
  assert.match(r.text,/SUM\(CASE WHEN clase='NC' THEN -importe ELSE 0 END\)/);
});
test('summary validation rejects ambiguous dates, unsupported SQL/grouping and partial pages',()=>{
  for(const extra of [{desde:'2026-02-30'},{desde:'2027-01-01'},{desde:'2020-01-01'},{agrupar:'moneda;drop'},{page:'2'},{proveedor:'001'},{clase:'RFN'},{sql:'SELECT 1'}])
    assert.throws(()=>commercialParams('resumenVentas',params(extra)),JSON.stringify(extra));
  const duplicate=params();duplicate.append('cliente','1');duplicate.append('cliente','2');assert.throws(()=>commercialParams('resumenVentas',duplicate));
  const defaulted=commercialParams('resumenVentas',new URLSearchParams({sucursal:'0101'}),new Date('2026-10-20T15:00:00Z'));
  assert.equal(defaulted.filters.desde,'2026-10-01');assert.equal(defaulted.filters.hasta,'2026-10-20');
});
test('missing or ambiguous currency header aborts rather than presenting misleading totals',async()=>{
  for(const row of [{cabeceras:0},{cabeceras:2}])await assert.rejects(fixture([row]).service.list('comprobantesVentas',params()),{code:'CABECERA_AMBIGUA_O_AUSENTE'});
  await assert.rejects(fixture([{cabecerasInvalidas:'1'}]).service.list('resumenVentas',params()),{code:'CABECERA_AMBIGUA_O_AUSENTE'});
  await assert.rejects(fixture(Array.from({length:5001},()=>({cabecerasInvalidas:'0'}))).service.list('resumenVentas',params()),{code:'RESUMEN_EXTENSO'});
});
test('summary preserves decimal amounts and only converts UN quantities to millares',async()=>{
  const rows=['UN','KG'].map(unidad=>({agrupacion:'total',moneda:'1',unidad,importeNeto:'12345678901234567890.123456',cantidad:'2500.123456',cabecerasInvalidas:'0',lineas:'3',documentos:'2'}));
  const result=await fixture(rows).service.list('resumenVentas',params());
  assert.equal(result.kind,'dashboard');assert.equal(result.meta.complete,true);assert.equal(result.data[0].cantidadMillares,'2.500123456');
  assert.equal(result.data[1].cantidadMillares,undefined);assert.equal(result.data[0].importeNeto,rows[0].importeNeto);
  assert.match(result.verifiedSummary,/12345678901234567890.123456/);
});
test('dashboards resolve SX6 currencies and compare the same filters in the prior month',async()=>{
 const {service,c}=fixture(),calls=[];
 c.tables.set('SX6',{schema:'dbo',name:'SX6010',columns:new Map(['X6_VAR','X6_CONTEUD','X6_FIL','D_E_L_E_T_'].map(k=>[k,{}]))});c.config.branches.SX6={'0101':'01'};
 service.db.query=async(sql,bindings)=>{calls.push({sql,bindings});if(sql.includes('[X6_VAR]'))return [{X6_VAR:'MV_MOEDA1',X6_CONTEUD:'PESOS'},{X6_VAR:'MV_MOEDA2',X6_CONTEUD:'DOLAR'}];return ['1','2'].map(moneda=>({agrupacion:'total',moneda,unidad:'UN',cantidad:'2000.125',importeNeto:bindings.desde==='20260901'?'80':'100',cabecerasInvalidas:'0'}));};
 const result=await service.list('resumenVentas',params({cliente:'C1',producto:'Z1'}));
 assert.equal(result.data[0].monedaNombre,'Pesos');assert.equal(result.data[1].monedaISO,'USD');assert.match(result.verifiedSummary,/Dólares \(USD\)/);assert.doesNotMatch(result.verifiedSummary,/Moneda 1/);
 assert.equal(calls.filter(q=>q.sql.includes('[X6_VAR]')).length,1);assert.equal(calls.find(q=>q.sql.includes('[X6_VAR]')).bindings.branch,'01');
 const prior=calls.find(q=>q.bindings.desde==='20260901');assert.equal(prior.bindings.hasta,'20260920');assert.equal(prior.bindings.cliente,'C1');assert.equal(prior.bindings.producto,'Z1');assert.equal(prior.bindings.branchSD2,'0101');
 assert.equal(result.comparison.available,true);assert.equal(result.comparison.rows[0].diferencia,'20');assert.equal(result.comparison.rows[0].variacionPorcentual,'25.00');assert.equal(result.comparison.rows[0].cantidadActual,'2.000125');
});
test('a failed comparison is unavailable rather than a fabricated zero; duplicate currency names cannot be used',async()=>{
 const {service,c}=fixture();service.db.query=async(sql,b)=>{if(b.desde==='20260901')throw Object.assign(new Error('timeout'),{code:'ETIMEOUT'});return [{agrupacion:'total',moneda:'1',unidad:'UN',cantidad:'1000',importeNeto:'50',cabecerasInvalidas:'0'}];};
 const result=await service.list('resumenVentas',params());assert.equal(result.data[0].importeNeto,'50');assert.equal(result.comparison.available,false);assert.equal(result.comparison.rows,undefined);assert.equal(result.comparison.code,'ETIMEOUT');
 c.tables.set('SX6',{schema:'dbo',name:'SX6010',columns:new Map(['X6_VAR','X6_CONTEUD','X6_FIL','D_E_L_E_T_'].map(k=>[k,{}]))});c.config.branches.SX6={'0101':'01'};
 service.db.query=async sql=>sql.includes('[X6_VAR]')?[{X6_VAR:'MV_MOEDA1',X6_CONTEUD:'PESOS'},{X6_VAR:'MV_MOEDA1',X6_CONTEUD:'DOLAR'}]:[];
 await assert.rejects(service.list('resumenVentas',params()),{code:'TRADUCCION_AMBIGUA'});
});
test('every commercial resource declares domain permissions; raw mixed ledgers need both domains',()=>{
  for(const resource of Object.keys(commercialResources))assert.ok(resourceDomains[resource]?.includes('catalogo'),resource);
  for(const resource of ['documentosSalida','itemsDocumentosSalida','entradasCompras']){
    assert.ok(resourceDomains[resource].includes('ventas'));assert.ok(resourceDomains[resource].includes('compras'));
  }
});
test('PWA uses chat confirmations and summaries without standalone mutation forms',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.doesNotMatch(html,/id="(?:updates|update-form|create-form|workflow-form)"/);
  assert.doesNotMatch(js,/\$\('#(?:update-|create-|workflow-)/);
  assert.match(js,/function renderProposal/);assert.match(js,/confirm:true,fingerprint:proposal.fingerprint/);
  assert.match(js,/function renderDashboard/);assert.match(html,/id="automation-status"/);
});

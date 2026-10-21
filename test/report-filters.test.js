import test from 'node:test';
import assert from 'node:assert/strict';
import {reportChat} from '../src/intelligence/report-chat.js';
import {dashboardInput,reportReferences} from '../src/intelligence/report-input.js';
import {reportDrilldown,compareReports} from '../src/report-metrics.js';
function fixture(){
 const calls=[],reads=[],conversation={};
 const read=async(resource,p)=>{reads.push({resource,filters:Object.fromEntries(p)});let data=resource==='productos'?[{codigo:'Z1',nombre:'RESORTE'}]:resource==='clientes'?[{codigo:'000001',nombre:'MILORDI',tienda:'01'}]:[{codigo:'000002',nombre:'ACME',tienda:'02'}];if(p.has('codigo'))data=data.filter(r=>r.codigo===p.get('codigo'));return {data,meta:{hasMore:false}};};
 const executeRead=async q=>{calls.push(q);return {kind:q.resource.startsWith('resumen')?'dashboard':'commercial',verifiedSummary:'Verificado',data:[{agrupacion:'total',moneda:'2',monedaISO:'USD',monedaNombre:'Dólares',unidad:'UN',cantidad:'1000',importeNeto:'60'}],scope:{...q.filters,filtros:{}},meta:{recurso:q.resource}};};
 return {read,executeRead,calls,reads,conversation,branch:'01',today:'2026-10-21'};
}
test('natural filters resolve ERP names, codes and stores and survive relative comparisons',async()=>{
 const f=fixture();await reportChat({...f,text:'Dashboard de ventas del cliente MILORDI y producto Z1 de este mes'});
 assert.equal(f.calls[0].filters.cliente,'000001');assert.equal(f.calls[0].filters.tienda,'01');assert.equal(f.calls[0].filters.producto,'Z1');
 await reportChat({...f,text:'¿Y el mes pasado?'});assert.equal(f.calls[1].filters.cliente,'000001');assert.equal(f.calls[1].filters.producto,'Z1');assert.equal(f.calls[1].filters.desde,'2026-09-01');
 const g=fixture();await reportChat({...g,text:'Dashboard de compras de este mes del proveedor ACME'});assert.equal(g.calls[0].filters.proveedor,'000002');assert.equal(g.calls[0].filters.tienda,'02');
});
test('unknown and ambiguous references stop and preserve the report draft until selection',async()=>{
 const f=fixture();f.read=async(resource,p)=>({data:p.get('tienda')?[{codigo:'000001',tienda:'02',nombre:'ACME'}]:[{codigo:'000001',tienda:'01',nombre:'ACME'},{codigo:'000001',tienda:'02',nombre:'ACME'}],meta:{hasMore:false}});
 const first=await reportChat({...f,text:'Dashboard de ventas del cliente ACME'});assert.equal(f.calls.length,0);assert.equal(first.choices.length,2);
 await reportChat({...f,text:first.choices[1].text});assert.equal(f.calls[0].filters.tienda,'02');assert.equal(f.conversation.reportDraft,undefined);
 const g=fixture();g.read=async()=>({data:[],meta:{hasMore:false}});const result=await reportChat({...g,text:'Dashboard de ventas del producto INEXISTENTE'});assert.match(result.answer,/No encontré/);assert.equal(g.calls.length,0);
});
test('structured UI filters and details enforce resource, branch, field and current read permissions',async()=>{
 for(const request of [{resource:'costos',filters:{}},{resource:'resumenVentas',filters:{sql:'DELETE'}},{resource:'resumenVentas',filters:{sucursal:'02'}},{resource:'resumenVentas',filters:{producto:1}},{resource:'resumenVentas',mode:'execute',filters:{}}])assert.throws(()=>dashboardInput(request,'01'));
 const f=fixture();await assert.rejects(reportChat({...f,text:'Aplicar filtros del dashboard',request:{resource:'resumenVentas',mode:'summary',filters:{cliente:'MILORDI'}},authorizeRead:()=>{throw Object.assign(new Error('denied'),{code:'LECTURA_DENEGADA'});}}),{code:'LECTURA_DENEGADA'});assert.equal(f.reads.length,0);assert.equal(f.calls.length,0);
 await reportChat({...f,text:'Aplicar filtros del dashboard',request:{resource:'resumenVentas',mode:'summary',filters:{desde:'2026-10-01',hasta:'2026-10-21',cliente:'MILORDI',producto:'Z1'}}});assert.equal(f.calls[0].filters.cliente,'000001');
 await assert.rejects(reportChat({...f,text:'Dashboard de ventas del proveedor ACME'}),{code:'FILTRO_INCOMPATIBLE'});
});
test('drilldown uses identical period, currency, unit and dimension filters including the reference bars',()=>{
 const scope={sucursal:'01',desde:'2026-10-15',hasta:'2026-11-10',agrupar:'mes',filtros:{cliente:'000001',tienda:'01',producto:'Z1'}},row={agrupacion:'detalle',dimension:'202610',moneda:'2',unidad:'UN'};
 const target=reportDrilldown('resumenVentas',scope,row);assert.equal(target.resource,'comprobantesVentas');assert.equal(target.filters.hasta,'2026-10-31');assert.equal(target.filters.desde,'2026-10-15');assert.equal(target.filters.moneda,'2');assert.equal(target.filters.unidad,'UN');assert.equal(target.filters.cliente,'000001');
 const party=reportDrilldown('resumenCompras',{...scope,agrupar:'tercero',filtros:{}},{...row,dimension:'000002 / 02'});assert.equal(party.filters.proveedor,'000002');assert.equal(party.filters.tienda,'02');
 const current={scope,meta:{recurso:'resumenVentas'},data:[{...row,agrupacion:'total',cantidad:'1000',importeNeto:'60'}]},previous={...current,scope:{...scope,desde:'2026-09-01',hasta:'2026-09-21'}};
 const compared=compareReports(current,previous);assert.equal(compared.rows[0].previousDrilldown.filters.desde,'2026-09-01');assert.equal(compared.rows[0].previousDrilldown.filters.producto,'Z1');
});
test('voice/text document requests preserve context and currency and can target the previous month',async()=>{
 const f=fixture();await reportChat({...f,text:'Dashboard de ventas del producto Z1'});
 const reply=await reportChat({...f,text:'Mostrame los documentos en dólares del mes anterior'});assert.equal(reply.evidence[0].result.kind,'commercial');const q=f.calls.at(-1);assert.equal(q.resource,'comprobantesVentas');assert.equal(q.filters.moneda,'2');assert.equal(q.filters.producto,'Z1');assert.equal(q.filters.desde,'2026-09-01');assert.equal(q.filters.limit,'50');assert.equal(q.filters.agrupar,undefined);
 assert.deepEqual(reportReferences('Dashboard de compras por proveedor de este mes').filters,{});
});
test('report filters never intercept multi-product creation or price changes',async()=>{
 const f=fixture();assert.equal(await reportChat({...f,text:'Creame un pedido de compra con producto Z1 y producto Z2'}),null);
 assert.equal(await reportChat({...f,text:'Cambiame el precio del producto Z1 y del producto Z2'}),null);assert.equal(f.reads.length,0);
});
test('clicking an older bar replaces the document context even after an empty filtered dashboard',async()=>{
 const f=fixture();f.conversation.reportContext={branch:'01',resource:'resumenVentas',filters:{cliente:'OTHER'},currencies:[]};
 await reportChat({...f,text:'Mostrame los documentos de este importe',request:{mode:'documents',resource:'resumenVentas',filters:{desde:'2026-10-01',hasta:'2026-10-21',moneda:'2',unidad:'UN'}}});
 const result=await reportChat({...f,text:'Mostrame los documentos en dólares'});assert.equal(result.evidence[0].result.kind,'commercial');assert.equal(f.calls.at(-1).filters.cliente,undefined);assert.equal(f.calls.at(-1).filters.moneda,'2');
});

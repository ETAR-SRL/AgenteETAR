import test from 'node:test';
import assert from 'node:assert/strict';
import {reportChat} from '../src/intelligence/report-chat.js';
import {createBusinessTools} from '../src/intelligence/tools.js';
test('dashboards understand recent days, rankings, grouping and pending documents directly',async()=>{
 for(const [text,resource,from,to,group] of [
  ['Haceme un resumen de ventas de los últimos dos días','resumenVentas','2026-10-20','2026-10-21',undefined],
  ['Ok, haceme un resumen de las ventas de los ultimos dos dias.','resumenVentas','2026-10-20','2026-10-21',undefined],
  ['Armame un dashboard de compras por proveedor de este mes','resumenCompras','2026-10-01','2026-10-21','tercero'],
  ['Ranking de ventas por producto de ayer','resumenVentas','2026-10-20','2026-10-20','producto'],
  ['Dashboard de remitos pendientes de este año','resumenRemitosPendientes','2026-01-01','2026-10-21',undefined],
  ['Reporte de pedidos de compra pendientes del mes pasado','resumenPedidosCompra','2026-09-01','2026-09-30',undefined],
 ]){let command;const r=await reportChat({text,branch:'01',today:'2026-10-21',executeRead:async q=>{command=q;return {kind:'dashboard',data:[],verifiedSummary:'Datos verificados'};}});assert.ok(r,text);assert.equal(command.resource,resource);assert.equal(command.filters.desde,from);assert.equal(command.filters.hasta,to);assert.equal(command.filters.agrupar,group);}
});
test('sales and purchases each query their authorized aggregate and never sum currencies',async()=>{
 const calls=[];const r=await reportChat({text:'Dashboard de ventas y compras de este mes',branch:'01',today:'2026-10-21',executeRead:async q=>{calls.push(q);return {kind:'dashboard',data:[],verifiedSummary:q.resource};}});
 assert.deepEqual(calls.map(q=>q.resource),['resumenVentas','resumenCompras']);assert.equal(r.evidence.length,2);
 await assert.rejects(reportChat({text:'Dashboard de ventas y compras',branch:'01',executeRead:async q=>{if(q.resource==='resumenCompras')throw Object.assign(new Error('denied'),{code:'LECTURA_DENEGADA'});return {kind:'dashboard',data:[]};}}),{code:'LECTURA_DENEGADA'});
});
test('monthly dashboard does not invent entity filters',async()=>{
 const calls=[];
 const r=await reportChat({text:'Mostrame un dashboard de ventas facturadas de este mes',branch:'0101',today:'2026-10-20',executeRead:async q=>{calls.push(q);return {kind:'dashboard',verifiedSummary:'Ventas verificadas',data:[]};}});
 assert.deepEqual(calls,[{resource:'resumenVentas',filters:{desde:'2026-10-01',hasta:'2026-10-20',sucursal:'0101'}}]);assert.equal(r.answer,'Ventas verificadas');
});
test('direct report never drops requested filters or periods',async()=>{
 for(const text of ['Dashboard de ventas del cliente X','Resumen de compras en dólares','Dashboard de ventas de los últimos 0 días','Resumen de ventas desde enero hasta mayo'])assert.equal(await reportChat({text,branch:'01',executeRead:()=>assert.fail('filter dropped')}),null);
});
test('report denies access without claiming zero sales',async()=>{
 await assert.rejects(reportChat({text:'Resumen de ventas de este mes',branch:'01',executeRead:async()=>{throw Object.assign(new Error('denied'),{code:'LECTURA_DENEGADA'});}}),{code:'LECTURA_DENEGADA'});
});
test('model placeholder filters never reach ERP',async()=>{
 const tools=createBusinessTools({branch:'01',metadata:{entities:{resumenVentas:{aggregate:true}}},executeRead:()=>assert.fail('placeholder sent')});
 for(const value of ['código','codigo','string'])await assert.rejects(tools.run('consultar_erp',{recurso:'resumenVentas',filtros:{cliente:value}}),{code:'FILTRO_NO_IDENTIFICADO'});
});

test('relative periods compare fresh totals and keep filters and currency boundaries',async()=>{
 const conversation={reportContext:{branch:'01',resource:'resumenVentas',filters:{desde:'2026-10-01',hasta:'2026-10-20',cliente:'C1',agrupar:'tercero'}}},calls=[];
 const executeRead=async q=>{calls.push(q);return {kind:'dashboard',data:[{agrupacion:'total',moneda:'2',unidad:'UN',importeNeto:q.filters.desde==='2026-09-01'?'120':'100'}],verifiedSummary:'summary'};};
 const r=await reportChat({text:'¿y el pasado?',conversation,branch:'01',today:'2026-10-20',executeRead});
 assert.equal(calls.length,2);assert.equal(calls[0].filters.desde,'2026-09-01');assert.equal(calls[0].filters.hasta,'2026-09-30');assert.equal(calls[0].filters.cliente,'C1');assert.match(r.answer,/20.00%/);
 assert.equal(r.comparison.rows[0].diferencia,'20');assert.equal(r.comparison.rows[0].variacionPorcentual,'20.00');
 await reportChat({text:'¿y el año pasado?',conversation,branch:'01',today:'2026-10-20',executeRead});assert.equal(calls[2].filters.desde,'2025-01-01');assert.equal(calls[2].filters.hasta,'2025-12-31');
 await reportChat({text:'y este mes?',conversation,branch:'01',today:'2026-10-20',executeRead});assert.equal(calls[4].filters.desde,'2026-10-01');
 assert.equal(await reportChat({text:'y el pasado?',conversation,branch:'02',executeRead}),null);
});

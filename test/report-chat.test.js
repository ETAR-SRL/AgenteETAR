import test from 'node:test';
import assert from 'node:assert/strict';
import {reportChat} from '../src/intelligence/report-chat.js';
import {createBusinessTools} from '../src/intelligence/tools.js';
test('monthly dashboard does not invent entity filters',async()=>{
 const calls=[];
 const r=await reportChat({text:'Mostrame un dashboard de ventas facturadas de este mes',branch:'0101',today:'2026-10-20',executeRead:async q=>{calls.push(q);return {kind:'dashboard',verifiedSummary:'Ventas verificadas',data:[]};}});
 assert.deepEqual(calls,[{resource:'resumenVentas',filters:{desde:'2026-10-01',hasta:'2026-10-20',sucursal:'0101'}}]);assert.equal(r.answer,'Ventas verificadas');
});
test('direct report never drops requested filters or periods',async()=>{
 for(const text of ['Resumen de ventas de ayer','Dashboard de ventas del cliente X','Resumen de compras en dólares'])assert.equal(await reportChat({text,branch:'01',executeRead:()=>assert.fail('filter dropped')}),null);
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
 await reportChat({text:'¿y el año pasado?',conversation,branch:'01',today:'2026-10-20',executeRead});assert.equal(calls[2].filters.desde,'2025-01-01');assert.equal(calls[2].filters.hasta,'2025-12-31');
 await reportChat({text:'y este mes?',conversation,branch:'01',today:'2026-10-20',executeRead});assert.equal(calls[4].filters.desde,'2026-10-01');
 assert.equal(await reportChat({text:'y el pasado?',conversation,branch:'02',executeRead}),null);
});

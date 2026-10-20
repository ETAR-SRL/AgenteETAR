import test from 'node:test';
import assert from 'node:assert/strict';
import {reportChat} from '../src/intelligence/report-chat.js';
import {createBusinessTools} from '../src/intelligence/tools.js';
test('monthly dashboard does not invent entity filters',async()=>{
 const calls=[];
 const r=await reportChat({text:'Mostrame un dashboard de ventas facturadas de este mes',branch:'0101',executeRead:async q=>{calls.push(q);return {kind:'dashboard',verifiedSummary:'Ventas verificadas',data:[]};}});
 assert.deepEqual(calls,[{resource:'resumenVentas',filters:{sucursal:'0101'}}]);assert.equal(r.answer,'Ventas verificadas');
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

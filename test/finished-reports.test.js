import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {exportFinishedReport} from '../src/finished-reports.js';
const clock=()=>new Date('2026-10-21T15:00:00Z');
const request=format=>({resource:'resumenVentas',filters:{sucursal:'0101',desde:'2026-10-01',hasta:'2026-10-21',agrupar:'producto'},format});
const row=(extra={})=>({agrupacion:'total',dimension:null,moneda:'1',monedaNombre:'Pesos',unidad:'UN',documentos:'1',lineas:'2',cantidad:'1000',importeNeto:'100',facturas:'100',notasCredito:'0',notasDebito:'0',...extra});
const data=()=>({kind:'dashboard',meta:{recurso:'resumenVentas',complete:true,hasMore:false},scope:{sucursal:'0101',desde:'2026-10-01',hasta:'2026-10-21',fecha:'emisión',agrupar:'producto',filtros:{}},data:[row(),row({agrupacion:'detalle',dimension:'Z1'}),row({moneda:'2',monedaNombre:'Dólares',unidad:'KG',importeNeto:'50'})],limitations:['Sin impuestos ni fletes.']});
test('HTML rereads protected source, escapes source text and displays date, currencies and coverage',async()=>{
 let calls=0,checks=0;const report=data();report.data[1].dimension='<img src=x onerror="alert(1)">';report.limitations.push('<script>bad()</script>');
 const result=await exportFinishedReport(request('html'),{clock,authorizeRead:(resource,branch)=>{checks++;assert.equal(resource,'resumenVentas');assert.equal(branch,'0101');},read:async(resource,params)=>{calls++;assert.equal(params.get('agrupar'),'producto');return report;}});const text=result.buffer.toString('utf8');assert.equal(calls,1);assert.equal(checks,3);assert.ok(text.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));assert.ok(!text.includes('<img'));assert.ok(!text.includes('<script>'));assert.ok(text.includes('2026-10-21T15:00:00.000Z'));assert.ok(text.includes('Pesos'));assert.ok(text.includes('Dólares'));assert.ok(text.includes('KG'));assert.ok(text.includes('no se suman entre sí'));assert.ok(text.includes('Content-Security-Policy'));assert.equal(result.filename,'resumenVentas-2026-10-21.html');
});
test('XLSX uses separate currency/unit sheets and does not sum totals plus detail or fabricate document counts',async()=>{
 const report=data();report.data[1].dimension='=HYPERLINK("https://bad.test")';const output=await exportFinishedReport(request('xlsx'),{clock,authorizeRead:()=>{},read:async()=>report});const book=new ExcelJS.Workbook();await book.xlsx.load(output.buffer);assert.equal(book.worksheets.length,3);const peso=book.getWorksheet('Grupo 1'),usd=book.getWorksheet('Grupo 2');assert.equal(peso.getCell('F6').value,'100');assert.equal(peso.getCell('F7').value,'100');assert.equal(peso.getCell('C6').value,'1');assert.equal(peso.getCell('B7').type,ExcelJS.ValueType.String);assert.equal(peso.getCell('B7').value,'=HYPERLINK("https://bad.test")');assert.equal(usd.getCell('F6').value,'50');assert.ok(!book.worksheets.some(s=>/general/i.test(s.name)));
});
test('closed contract rejects client rows, unknown resources and bad filters before source access',async()=>{
 let calls=0;const deps={clock,authorizeRead:()=>{},read:async()=>calls++};for(const input of [{...request('html'),rows:[row()]},{...request('html'),resource:'compras'},{...request('html'),filters:{...request('html').filters,sql:'SELECT *'}},{...request('html'),format:'pdf'}])await assert.rejects(()=>exportFinishedReport(input,deps),{status:400});assert.equal(calls,0);
});
test('denial and revocation prevent exporting data, including a completed XLSX build',async()=>{
 let calls=0;await assert.rejects(()=>exportFinishedReport(request('html'),{clock,authorizeRead:()=>{throw Object.assign(new Error('denied'),{status:403});},read:async()=>calls++}),{status:403});assert.equal(calls,0);
 for(const format of ['html','xlsx']){let checks=0;await assert.rejects(()=>exportFinishedReport(request(format),{clock,authorizeRead:()=>{if(++checks===3)throw Object.assign(new Error('revoked'),{status:403});},read:async()=>data()}),{status:403});assert.equal(checks,3);}
});
test('partial and missing totals remain explicit and source identity errors fail closed',async()=>{
 const report=data();report.data=report.data.filter(r=>r.agrupacion!=='total');const output=await exportFinishedReport(request('html'),{clock,authorizeRead:()=>{},read:async()=>report});assert.match(output.buffer.toString(),/Alcance parcial/);assert.match(output.buffer.toString(),/No hay total verificado/);
 report.meta.recurso='resumenCompras';await assert.rejects(()=>exportFinishedReport(request('html'),{clock,authorizeRead:()=>{},read:async()=>report}),{code:'INFORME_NO_VERIFICADO'});
});

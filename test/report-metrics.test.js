import test from 'node:test';
import assert from 'node:assert/strict';
import {currencyIdentity,compareReports,previousMonthRange} from '../src/report-metrics.js';
test('currency names come from configuration, not assumed numeric codes',()=>{
 assert.equal(currencyIdentity('9','PESOS').monedaISO,'ARS');assert.equal(currencyIdentity('1','DOLAR').monedaISO,'USD');
 assert.equal(currencyIdentity('2','DÓLAR ESTADOUNIDENSE').monedaNombre,'Dólares');
 assert.equal(currencyIdentity('1','').monedaISO,null);assert.match(currencyIdentity('1','').monedaNombre,/sin identificar/);
 assert.equal(currencyIdentity('2','DOLAR CANADIENSE').monedaNombre,'DOLAR CANADIENSE');assert.equal(currencyIdentity('2','DOLAR CANADIENSE').monedaISO,null);
});
test('previous-month periods align dates, cross years and clamp leap months',()=>{
 assert.deepEqual(previousMonthRange({desde:'2026-10-01',hasta:'2026-10-21'}),{desde:'2026-09-01',hasta:'2026-09-21'});
 assert.deepEqual(previousMonthRange({desde:'2026-01-01',hasta:'2026-01-31'}),{desde:'2025-12-01',hasta:'2025-12-31'});
 assert.deepEqual(previousMonthRange({desde:'2024-03-01',hasta:'2024-03-31'}),{desde:'2024-02-01',hasta:'2024-02-29'});
 assert.equal(previousMonthRange({desde:'2026-01-01',hasta:'2026-10-21'}),null);
});
test('comparison separates currency and units, handles previous-only groups, negatives and zero baselines precisely',()=>{
 const scope={desde:'2026-10-01',hasta:'2026-10-21'},row=(moneda,unidad,importeNeto,cantidad)=>({agrupacion:'total',moneda,unidad,importeNeto,cantidad,...currencyIdentity(moneda,moneda==='1'?'PESOS':'DOLAR')});
 const result=compareReports({scope,data:[row('1','UN','12345678901234567890.123456','2500.123456'),row('2','UN','-5','-1000')]},{scope,data:[row('1','UN','12345678901234567889.123456','2000.123456'),row('1','KG','10','5')]});
 assert.equal(result.rows.length,3);assert.equal(result.rows[0].diferencia,'1');assert.equal(result.rows[0].cantidadActual,'2.500123456');assert.equal(result.rows[0].diferenciaCantidad,'0.5');
 assert.equal(result.rows[1].variacionPorcentual,null);assert.equal(result.rows[1].importeActual,'-5');assert.equal(result.rows[1].cantidadActual,'-1');
 assert.equal(result.rows[2].importeActual,'0');assert.equal(result.rows[2].variacionPorcentual,'-100.00');assert.equal(result.rows[2].unidadCantidad,'KG');assert.equal(result.rows[2].cantidadAnterior,'5');
});

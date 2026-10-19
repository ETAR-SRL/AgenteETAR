import test from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import {isFinishedProduct,unitsFromThousands,thousandsFromUnits,pricePerThousand,pricePerUnit} from '../src/etar.js';
import {Changes} from '../src/changes.js';
import {Store} from '../src/store.js';

test('ETAR converts quantities and prices in opposite directions while preserving total',()=>{
 assert.equal(unitsFromThousands('2.5'),'2500');assert.equal(thousandsFromUnits('2500'),'2.5');
 assert.equal(pricePerUnit('80'),'0.08');assert.equal(pricePerThousand('0.00189'),'1.89');
 assert.ok(new Decimal(unitsFromThousands('2.5')).mul(pricePerUnit('80')).eq(new Decimal('2.5').mul('80')));
 assert.equal(thousandsFromUnits(unitsFromThousands('0.000001')),'0.000001');
 assert.throws(()=>unitsFromThousands('2,5'));assert.throws(()=>pricePerUnit(-1));
 assert.equal(isFinishedProduct('Z129001A'),true);assert.equal(isFinishedProduct('S687069'),false);
});
test('AIB existing-record price proposals validate AIB precision, isolate actors and do not write ERP',async()=>{
 const store=new Store(':memory:');const row={registro:'15',precio:'0.1234',listaCodigo:'001',proveedorCodigo:'001',proveedorTienda:'01',productoCodigo:'P1'};
 const erp={metadata:()=>({entities:{preciosProveedores:{fields:[{salida:'precio',origen:'AIB_PRCCOM',disponible:true,diccionario:{X3_DECIMAL:4,X3_TAMANHO:14}}]}}})};
 const changes=new Changes({erp,store,read:async resource=>{assert.equal(resource,'preciosProveedores');return {data:[{...row}],meta:{}};}});
 const target={sucursal:'0101',registro:'15'};const p=await changes.preview('planner:test',{action:'precioListaProveedor',target,changes:{precio:'0.5678'}});
 assert.equal(p.resource,'preciosProveedores');assert.equal(p.executionEnabled,false);assert.equal(row.precio,'0.1234');assert.equal(p.diff[0].after,'0.5678');
 await assert.rejects(()=>changes.preview('planner:test',{action:'precioListaProveedor',target,changes:{precio:'0.12345'}}),error=>error.code==='PRECISION_INVALIDA'&&error.message.includes('AIB_PRCCOM'));
 await assert.rejects(()=>changes.check('planner:other',p.id),{code:'PROPUESTA_NO_EXISTE'});store.close();
});

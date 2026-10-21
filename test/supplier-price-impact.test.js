import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {supplierPriceImpact} from '../src/intelligence/supplier-price-impact.js';
import {createPriceImports} from '../src/intelligence/price-imports.js';
import {createPriceBatches} from '../src/intelligence/price-batches.js';
const source=(extra={})=>({fila:'1',producto:'Z1',proveedorCodigo:'P1',tienda:'01',monedaCodigo:'2',unidadMedida:'UN',precioPorUnidad:'0.06',...extra});
const order=(extra={})=>({registro:'1',numero:'123',item:'01',tercero:'P1',tienda:'01',producto:'Z1',unidad:'UN',moneda:'2',monedaNombre:'Dólares',cantidad:'1000',precioUnitario:'0.04',...extra});
const result=(data,hasMore=false)=>({data,scope:{sucursal:'0101'},meta:{hasMore}});
test('consultative impact preflights permission and never calls a source when denied',async()=>{
 let calls=0;const impact=await supplierPriceImpact({rows:[source()],branch:'0101',authorizeRead:()=>{throw Object.assign(new Error(),{code:'LECTURA_DENEGADA'});},read:async()=>calls++});assert.equal(calls,0);assert.equal(impact.state,'denied');assert.deepEqual(impact.rows,[]);assert.deepEqual(impact.groups,[]);assert.equal(impact.message,'Esto no podés leerlo.');
});
test('current SC7 price drives simulation independently of AIB and separates currencies and units',async()=>{
 const rows=[source(),source({fila:'2',producto:'Z2',monedaCodigo:'1',unidadMedida:'KG',precioPorUnidad:'20'})];
 const impact=await supplierPriceImpact({rows,branch:'0101',authorizeRead:()=>{},read:async(resource,params)=>{assert.equal(resource,'pedidosCompraPendientes');assert.equal(params.get('proveedor'),'P1');assert.equal(params.get('tienda'),'01');assert.equal(params.get('limit'),'100');return result(params.get('producto')==='Z1'?[order(),order({registro:'2',moneda:'1'})]:[order({producto:'Z2',moneda:'1',monedaNombre:'Pesos',unidad:'KG',cantidad:'5',precioUnitario:'10'})]);}});
 assert.equal(impact.state,'partial');assert.equal(impact.groups.length,2);assert.equal(impact.groups[0].importeActual,'40');assert.equal(impact.groups[0].importeSimulado,'60');assert.equal(impact.groups[0].diferencia,'20');assert.equal(impact.groups[0].millares,'1');assert.equal(impact.groups[1].importeActual,'50');assert.equal(impact.groups[1].importeSimulado,'100');assert.equal(impact.groups[1].millares,undefined);
});
test('bounded pages, product cap, incomplete schema and ambiguous duplicate AIB records remain explicit',async()=>{
 let calls=0;const impact=await supplierPriceImpact({rows:[source()],branch:'0101',authorizeRead:()=>{},read:async(_,params)=>{calls++;return result([order({registro:params.get('page')})],true);}});assert.equal(calls,3);assert.equal(impact.partial,true);assert.equal(impact.rows[0].orders.length,3);
 calls=0;const cap=await supplierPriceImpact({rows:Array.from({length:21},(_,i)=>source({producto:'Z'+i,fila:String(i)})),branch:'0101',authorizeRead:()=>{},read:async()=>{calls++;return result([]);}});assert.equal(calls,20);assert.equal(cap.rows[20].state,'unavailable');assert.equal(cap.partial,true);
 const absent=await supplierPriceImpact({rows:[source()],branch:'0101',authorizeRead:()=>{},read:async()=>result([order({precioUnitario:undefined})])});assert.equal(absent.rows[0].orders.length,0);assert.equal(absent.partial,true);
 calls=0;const duplicate=await supplierPriceImpact({rows:[source(),source({fila:'2'})],branch:'0101',authorizeRead:()=>{},read:async()=>calls++});assert.equal(calls,0);assert.equal(duplicate.partial,true);
});
test('supplier preview fingerprints advisory evidence and prepares only AIB without order writes',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const prepared=[],clock=()=>new Date('2026-10-21T15:00:00Z');
 const batches=createPriceBatches({store,check:async()=>{},execute:async()=>{throw new Error('must not execute');}});
 const imports=createPriceImports({store,authorizeRead:()=>{},clock,createBatch:batches.create,read:async(name,params)=>{
  if(name==='proveedores')return result([{codigo:'P1',tienda:'01',nombre:'ACME'}]);
  if(name==='productoProveedor')return result([]);
  if(name==='productos')return result([{codigo:'Z1',nombre:'Producto',unidadMedida:'UN'}]);
  if(name==='preciosProveedores')return result([{registro:'4',productoCodigo:'Z1',proveedorCodigo:'P1',proveedorTienda:'01',listaCodigo:'001',precio:'0.05',moneda:{codigo:'2',descripcion:'DOLAR'},vigenteDesde:'2026-01-01'}]);
  if(name==='pedidosCompraPendientes')return result([order()]);throw new Error('unexpected '+name);
 },prepare:async(actor,input)=>{prepared.push(input);return {id:'proposal-1',action:input.action,target:input.target,executionEnabled:true,fingerprint:'p1',expiresAt:'2099-01-01',diff:[{field:'AIB_PRCCOM',before:'0.05',after:'0.06'}],origin:input.origin};}});
 const rows=[{id:'1',product:'Z1',price:'60',currency:'USD',unit:'millar'}],draft=imports.save('a','proveedor','0101',{name:'lista.xlsx',rows}),preview=await imports.preview('a',draft.id,{reviewed:true,party:'P1',rows});
 assert.equal(prepared.length,1);assert.equal(prepared[0].action,'precioListaProveedor');assert.equal(preview.impact.groups[0].importeActual,'40');assert.equal(preview.impact.groups[0].importeSimulado,'60');const row=preview.batch.rows[0];assert.equal(row.monedaCodigo,'2');assert.equal(row.unidadMedida,'UN');assert.equal(row.diferenciaAbsoluta,'10');assert.equal(row.diferenciaPorcentaje,'20.0000');assert.equal(row.evidenceAt,clock().toISOString());assert.equal(row.vigenciaAnterior.desde,'2026-01-01');assert.equal(row.vigenciaModificada,false);assert.deepEqual(row.vigenciaNueva,row.vigenciaAnterior);assert.ok(preview.batch.fingerprint);assert.deepEqual(preview.batch.impact,preview.impact);assert.equal(store.db.prepare('SELECT count(*) n FROM executions').get().n,0);
});

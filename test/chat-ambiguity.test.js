import test from 'node:test';
import assert from 'node:assert/strict';
import {businessChat} from '../src/intelligence/business-chat.js';
import {purchaseChat,purchaseValues,purchaseValueAmbiguity} from '../src/intelligence/purchase-chat.js';

function fixture(){
 const conversation={messages:[]},prepared=[],calls=[];
 const data={productos:[{codigo:'Z731',nombre:'ENVASE',unidadMedida:'UN'}],itemsVentas:[{registro:'73',numero:'824',item:'04',productoCodigo:'Z731',clienteCodigo:'C8',clienteTienda:'02',precioUnitario:'1.7',cantidadPedida:'9000',moneda:{codigo:'2',descripcion:'DOLAR'}}],proveedores:[{codigo:'V7',tienda:'03',nombre:'PAPELERA'}],preciosProveedores:[{registro:'74',productoCodigo:'Z731',proveedorCodigo:'V7',proveedorTienda:'03',listaCodigo:'LP8',precio:'1.7',moneda:{codigo:'2',descripcion:'DOLAR'}}]};
 const read=async(resource,params)=>{calls.push({resource,filters:Object.fromEntries(params)});let rows=data[resource]||[];for(const [key,value] of params){const field={codigo:'codigo',producto:'productoCodigo',numero:'numero',proveedor:'proveedorCodigo',tienda:resource==='proveedores'?'tienda':'proveedorTienda',registro:'registro'}[key];if(field)rows=rows.filter(row=>String(row[field])===value);}return {data:structuredClone(rows),meta:{hasMore:false}};};
 const args={conversation,branch:'0101',canPlan:true,metadata:{entities:{}},read,prepare:async(actor,input)=>{prepared.push(input);return {id:'preview'};},actor:'test'};
 return {conversation,prepared,calls,data,business:text=>businessChat({...args,text}),purchase:text=>purchaseChat({...args,text})};
}

test('independent quantity and price bases survive corrections and preparame requests',async()=>{
 const f=fixture();await f.business('Mostrame el pedido de venta 824');
 let r=await f.business('Preparame el precio a 4,75 dólares por unidad y cantidad 7');
 assert.match(r.answer,/cantidad 7/);assert.equal(f.prepared.length,0);
 r=await f.business('Cambiá la cantidad a 7 millares');
 assert.equal(f.prepared.length,1,r.answer);
 const p=f.prepared[0];assert.equal(p.changes.precioUnitario,'4.75');assert.equal(p.priceUnit,'unidad');assert.equal(p.changes.cantidadPedida,'7');assert.equal(p.quantityUnit,'millares');
});

test('price plus quantity requires a document operation and retains both after clarification',async()=>{
 const f=fixture();let r=await f.business('Preparame precio del producto Z731 a 6,25 dólares por unidad y cantidad 4 millares');
 assert.match(r.answer,/documento nuevo o uno existente/);assert.equal(f.prepared.length,0);
 r=await f.business('Pedido de venta 824');assert.equal(f.prepared.length,1,r.answer);assert.equal(f.prepared[0].changes.precioUnitario,'6.25');assert.equal(f.prepared[0].changes.cantidadPedida,'4');
});

test('numerical alternatives and colloquial currency never become partial values',async()=>{
 assert.equal(purchaseValueAmbiguity('7 millares y precio 4,75 dólares por unidad'),null);
 for(const text of ['precio 8 lucas','precio 5 verdes','precio 18 o 24 dólares por unidad','precio 18 pesos y 24 dólares'])assert.ok(purchaseValueAmbiguity(text),text);
 const f=fixture();await f.business('Mostrame el pedido de venta 824');await f.business('Cambiá precio a 9 dólares');
 const before=structuredClone(f.conversation.businessContext);const calls=f.calls.length;
 const r=await f.business('Cambiá precio a 8 lucas o 5 verdes');assert.match(r.answer,/único importe exacto/);assert.deepEqual(f.conversation.businessContext,before);assert.equal(f.calls.length,calls);
 await f.business('por unidad');assert.equal(f.prepared[0].changes.precioUnitario,'9');
});

test('negated references cannot select or later reuse an excluded product',async()=>{
 const f=fixture();await f.business('Mostrame el pedido de venta 824');
 const count=f.calls.length;let r=await f.business('Preparame precio a 8 dólares por unidad, no el producto Z731');
 assert.match(r.answer,/referencia negada/);assert.equal(f.calls.length,count);assert.equal(f.prepared.length,0);
 r=await f.business('por unidad');assert.match(r.answer,/referencia negada/);assert.equal(f.prepared.length,0);
 r=await f.business('producto Z731');assert.equal(f.prepared.length,1,r.answer);
});

test('purchase drafts preserve given values across rejected references and demand a supplier for USD',async()=>{
 const f=fixture();let r=await f.purchase('Creame un pedido de compra con producto Z731, 5 millares a 13 dólares por unidad');
 assert.match(r.answer,/proveedor/);assert.equal(f.prepared.length,0);
 r=await f.purchase('no el proveedor V7');assert.match(r.answer,/referencia negada/);assert.equal(f.conversation.purchaseDraft.values.quantity,'5');assert.equal(f.conversation.purchaseDraft.values.price,'13');
 r=await f.purchase('proveedor V7');assert.doesNotMatch(r.answer,/referencia negada/);assert.equal(f.conversation.purchaseDraft.values.party,'V7');assert.equal(f.conversation.purchaseDraft.values.priceUnit,'unidad');
});

test('a denied proposed operation performs no reference reads',async()=>{
 let calls=0;
 await assert.rejects(()=>businessChat({text:'Preparame el pedido de venta 824 a 12 dólares por unidad',conversation:{},branch:'0101',canPlan:false,read:async()=>{calls++;},metadata:{entities:{}}}),{status:403});
 assert.equal(calls,0);
 assert.deepEqual(purchaseValues('precio 6,25 por unidad y cantidad 4 millares'),{price:'6.25',priceUnit:'unidad',quantity:'4',quantityUnit:'millares'});
});

test('an ambiguous new purchase keeps the explicit product and independent quantity for clarification',async()=>{
 const f=fixture();let r=await f.purchase('Creame un pedido de compra con producto Z731, 5 millares a 8 lucas o 9 verdes');
 assert.match(r.answer,/verificación en SB1 queda pendiente/);assert.equal(f.calls.length,0);
 const v=f.conversation.purchaseDraft.values;assert.equal(v.product,'Z731');assert.equal(v.quantity,'5');assert.equal(v.quantityUnit,'millares');assert.equal(v.price,undefined);assert.equal(v.currency,undefined);
 r=await f.purchase('precio 13 dólares por unidad');assert.match(r.answer,/Encontré Z731/);assert.match(r.answer,/proveedor/);assert.equal(f.conversation.purchaseDraft.values.price,'13');assert.equal(f.prepared.length,0);
});

test('comparative currency questions remain reads rather than ambiguous mutation requests',async()=>{
 const f=fixture();await f.business('Mostrame el pedido de venta 824');const count=f.calls.length;
 const r=await f.business('Mostrame el pedido de venta 824 en dólares y pesos');
 assert.doesNotMatch(r.answer,/Mencionaste más de una moneda/);assert.ok(f.calls.length>count);assert.equal(f.prepared.length,0);
});

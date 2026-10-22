import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommercialValueIntake,purchaseChat,purchaseValues,updateSupplierPendingDraft} from '../src/intelligence/purchase-chat.js';
import {businessChat} from '../src/intelligence/business-chat.js';
import {priceOperation,requestedPriceBase} from '../src/intelligence/price-commands.js';
import {assertPriceCurrency} from '../src/intelligence/references.js';

test('replacement overwrites rejected parser output and retains independent fields and bases',()=>{
 const state={values:{product:'Z1',price:'80',priceUnit:'unidad',quantity:'2',quantityUnit:'millares',currency:'ARS',warehouse:'16',resolvedPrice:{precio:'80'}}};
 const input={price:'80',quantity:'2'};
 applyCommercialValueIntake(state,input,'No son 80, son 90 dólares por millar; cantidad 2 millares',{purchase:true});
 Object.assign(state.values,input);
 assert.deepEqual(state.unresolvedValues,[]);
 assert.equal(state.values.price,'90');assert.equal(state.values.currency,'USD');
 assert.equal(state.values.priceUnit,'millar');assert.equal(state.values.quantityUnit,'millares');
 assert.equal(state.values.warehouse,'16');assert.equal(state.values.product,'Z1');assert.equal(state.values.resolvedPrice,undefined);
});

test('SC7 rejection stays pending across logistics and cannot recover a list price',async()=>{
 const conversation={purchaseDraft:{branch:'0101',action:'crearPedidoCompra',values:{product:'Z1',quantity:'2',quantityUnit:'unidades',price:'80',priceUnit:'unidad',currency:'USD',party:'P1',resolvedPrice:{precio:'80'}}}};
 let reads=0,prepared=0;
 const context={conversation,branch:'0101',canPlan:true,read:async()=>{reads++;return {data:[]};},prepare:async()=>{prepared++;}};
 await purchaseChat({...context,text:'Ese precio no'});
 assert.equal(conversation.purchaseDraft.values.price,undefined);assert.equal(conversation.purchaseDraft.values.resolvedPrice,undefined);
 assert.ok(conversation.purchaseDraft.unresolvedValues.includes('price'));
 await purchaseChat({...context,text:'depósito 16; emisión 22/10/2026'});
 assert.equal(conversation.purchaseDraft.values.warehouse,'16');assert.equal(conversation.purchaseDraft.values.quantity,'2');
 assert.equal(reads,0);assert.equal(prepared,0);
});

test('existing order rejection clears percentage/list source and cannot prepare another field',async()=>{
 const conversation={businessContext:{branch:'0101',kind:'purchase',refs:{number:'123'},pending:{price:'80',priceUnit:'unidad',quantity:'2',quantityUnit:'unidades',currency:'USD',percent:'5',useList:true}}};
 let reads=0,prepared=0;
 const context={conversation,branch:'0101',canPlan:true,read:async()=>{reads++;return {data:[]};},prepare:async()=>{prepared++;}};
 await businessChat({...context,text:'Ese precio no; cantidad 3 unidades'});
 const state=conversation.businessContext;
 assert.equal(state.pending.price,undefined);assert.equal(state.pending.percent,undefined);assert.equal(state.pending.useList,undefined);
 assert.equal(state.pending.quantity,'3');assert.equal(state.pending.priceUnit,'unidad');assert.equal(state.pending.quantityUnit,'unidades');
 await businessChat({...context,text:'confirmo'});
 assert.equal(reads,0);assert.equal(prepared,0);
});

test('currency replacement uses existing currency guard without conversion',()=>{
 const verify=(ok,status,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code});};
 assert.doesNotThrow(()=>assertPriceCurrency('no pesos, dólares',{moneda:{codigo:'2',descripcion:'DOLAR'}},verify));
 assert.throws(()=>assertPriceCurrency('no dólares, pesos',{moneda:{codigo:'2',descripcion:'DOLAR'}},verify),{code:'MONEDA_DISTINTA'});
 assert.throws(()=>assertPriceCurrency('no dólares',{moneda:{codigo:'2',descripcion:'DOLAR'}},verify),{code:'MONEDA_REQUERIDA'});
});

test('price commands use affirmed replacement and reject a missing replacement',()=>{
 assert.deepEqual(priceOperation('Cambiame el precio: no son 80, son 90 dólares por millar'),{kind:'absolute',value:'90'});
 assert.equal(priceOperation('Cambiame el precio; no son 80 dólares'),null);
 assert.equal(requestedPriceBase('no es por unidad, es por millar'),'millar');
 assert.equal(priceOperation('Por ejemplo, cambiame el precio a 80 dólares por unidad'),null);
 assert.equal(priceOperation('no cambies el precio a 80 dólares por unidad'),null);
 assert.equal(priceOperation('La frase "Cambiame el precio a 80 dólares por unidad"'),null);
});

test('SC1 explicit omission removes optional price while preserving quantities',()=>{
 const state={action:'crearSolicitudCompra',values:{price:'80',priceUnit:'unidad',quantity:'2',quantityUnit:'millares',currency:'USD',resolvedPrice:{precio:'80'}},unresolvedValues:['price']};
 const input={};applyCommercialValueIntake(state,input,'sin precio',{purchase:true});
 assert.equal(input.withoutPrice,true);assert.deepEqual(state.unresolvedValues,[]);
 assert.equal(state.values.price,undefined);assert.equal(state.values.priceUnit,undefined);assert.equal(state.values.resolvedPrice,undefined);
 assert.equal(state.values.quantity,'2');assert.equal(state.values.currency,'USD');
});

test('legacy numeric extraction ignores quoted and preservation clauses while retaining an affirmative quantity',()=>{
 const values=purchaseValues('no cambies el precio a 80 dólares por millar; cantidad 3 unidades');
 assert.equal(values.price,undefined);assert.equal(values.priceUnit,undefined);assert.equal(values.currency,undefined);
 assert.equal(values.quantity,'3');assert.equal(values.quantityUnit,'unidades');
 const quoted=purchaseValues('La frase "precio 80 dólares por millar"; cantidad 4 unidades');
 assert.equal(quoted.price,undefined);assert.equal(quoted.currency,undefined);
});

function previewFixture(kind){
 const product={codigo:'Z1',nombre:'ENVASE',unidadMedida:'UN',bloqueado:{codigo:'2'}};
 const row={registro:'71',numero:'123',item:'01',productoCodigo:'Z1',clienteCodigo:'C1',clienteTienda:'01',proveedorCodigo:'P1',proveedorTienda:'01',listaCodigo:'L1',precioUnitario:'17.5',cantidadPedida:'4000',precio:'17.5',moneda:{codigo:'2',descripcion:'DOLAR'},activo:{descripcion:'Si'},vigenteDesde:'2020-01-01'};
 const resource={sale:'itemsVentas',purchase:'compras',supplierList:'preciosProveedores',salePrice:'preciosClientes'}[kind];
 const refs=['sale','purchase'].includes(kind)?{number:'123',item:'01'}:kind==='supplierList'?{vendor:'P1',shop:'01',list:'L1',product:'Z1'}:{list:'L1',product:'Z1'};
 const conversation={messages:[],businessContext:{branch:'0101',kind,refs,pending:{price:'80',priceUnit:'unidad',currency:'USD',...(['sale','purchase'].includes(kind)?{quantity:'2',quantityUnit:'millares'}:{})}}};
 const calls=[],prepared=[];
 const read=async(name,params)=>{
  calls.push({resource:name,filters:Object.fromEntries(params)});
  assert.equal(params.get('sucursal'),'0101');
  const data=name==='productos'?[product]:name===resource?[row]:name==='proveedores'?[{codigo:'P1',tienda:'01',nombre:'PROVEEDOR'}]:name==='listasPreciosProveedores'?[{codigo:'L1',proveedorCodigo:'P1',proveedorTienda:'01'}]:name==='listasPreciosClientes'?[{codigo:'L1',nombre:'LISTA',estado:{descripcion:'Si'},vigenteDesde:'2020-01-01',vigenteHasta:'2099-01-01'}]:[];
  return {data:structuredClone(data),meta:{hasMore:false},source:{system:'controlled'}};
 };
 const prepare=async(actor,input)=>{prepared.push(structuredClone(input));return {id:'review-'+prepared.length,confirmationRequired:true};};
 const args={conversation,branch:'0101',canPlan:true,read,prepare,actor:'controlled',metadata:{entities:{[resource]:{fields:[{salida:'precio',diccionario:{X3_DECIMAL:6}}]}}}};
 return {conversation,row,calls,prepared,query:text=>businessChat({...args,text})};
}

for(const [kind,action] of [['sale','pedidoVenta'],['purchase','pedidoCompra']]){
 test(`${action} corrected amounts prepare a fresh preview with independent literal bases`,async()=>{
  const f=previewFixture(kind);
  // The draft amount is unrelated to the ERP preconditions read on this turn.
  f.row.precioUnitario='19.25';f.row.cantidadPedida='4500';
  const result=await f.query('No son 80, son 90 dólares por millar; cantidad 3 unidades');
  assert.equal(f.prepared.length,1,result.answer);
  const plan=f.prepared[0];assert.equal(plan.action,action);
  assert.deepEqual(plan.changes,{precioUnitario:'90',cantidadPedida:'3'});
  assert.equal(plan.priceUnit,'millar');assert.equal(plan.quantityUnit,'unidades');
  assert.equal(plan.expectedPrice,'19.25');assert.equal(plan.expectedQuantity,'4500');
  assert.equal(plan.expectedIdentity.moneda,'2');assert.equal(plan.header,undefined);
  assert.ok(f.calls.some(call=>call.resource==='productos'&&call.filters.codigo==='Z1'));
  assert.match(result.answer,/confirmá las tarjetas/);assert.match(result.answer,/No se modificó el ERP/);
  assert.equal(result.evidence.at(-1).result.kind,'proposal');
 });
}

test('a currency mismatch retains a corrected order and the next currency correction prepares against a fresh ERP price',async()=>{
 const f=previewFixture('purchase');
 await assert.rejects(f.query('No son 80, son 90 pesos por unidad; cantidad 3 millares'),{code:'MONEDA_DISTINTA'});
 assert.equal(f.prepared.length,0);assert.equal(f.conversation.businessContext.pending.price,'90');
 f.row.precioUnitario='21.75';f.row.cantidadPedida='6000';
 const result=await f.query('No pesos, dólares');
 assert.equal(f.prepared.length,1,result.answer);
 const plan=f.prepared[0];assert.equal(plan.expectedPrice,'21.75');assert.equal(plan.expectedQuantity,'6000');
 assert.equal(plan.changes.precioUnitario,'90');assert.equal(plan.changes.cantidadPedida,'3');
 assert.equal(plan.priceUnit,'unidad');assert.equal(plan.quantityUnit,'millares');
 assert.equal(plan.expectedIdentity.moneda,'2');assert.equal(plan.header,undefined);
 assert.match(result.answer,/confirmá las tarjetas/);
});

test('a rejected currency blocks a later quantity edit until an affirmative currency prepares the retained edits',async()=>{
 const f=previewFixture('purchase');
 await f.query('No dólares');const reads=f.calls.length;
 const pending=await f.query('cantidad 5 unidades');
 assert.match(pending.answer,/moneda/);assert.equal(f.prepared.length,0);assert.equal(f.calls.length,reads);
 assert.equal(f.conversation.businessContext.pending.quantity,'5');
 const result=await f.query('moneda dólares');
 assert.equal(f.prepared.length,1,result.answer);assert.equal(f.prepared[0].changes.cantidadPedida,'5');
 assert.equal(f.prepared[0].expectedPrice,'17.5');assert.equal(f.prepared[0].expectedQuantity,'4000');
 assert.match(result.answer,/confirmá las tarjetas/);
});

for(const [kind,action] of [['supplierList','precioListaProveedor'],['salePrice','precioLista']]){
 test(`${action} corrected price uses current list price in a confirmation preview`,async()=>{
  const f=previewFixture(kind);f.row.precio='23.75';
  const result=await f.query('No son 80, son 95 dólares por unidad');
  assert.equal(f.prepared.length,1,result.answer);
  const plan=f.prepared[0];assert.equal(plan.action,action);assert.deepEqual(plan.changes,{precio:'95'});
  assert.equal(plan.priceUnit,'unidad');assert.equal(plan.expectedPrice,'23.75');
  assert.equal(plan.expectedIdentity.moneda,'2');assert.equal(plan.expectedIdentity.lista,'L1');
  assert.equal(plan.header,undefined);assert.ok(result.evidence.some(e=>e.result.kind==='proposal'));
  assert.match(result.answer,/confirm/);assert.match(result.answer,/No se modificó el ERP/);
 });
}

test('SC1 optional price omission prepares once all remaining literal fields are complete',async()=>{
 const conversation={purchaseDraft:{branch:'0101',action:'crearSolicitudCompra',values:{product:'Z1',quantity:'2',quantityUnit:'millares',price:'80',priceUnit:'unidad',currency:'ARS',warehouse:'16',emission:'2026-10-22',due:'2026-10-23',requester:'Ana'}}};
 const prepared=[],calls=[];
 const result=await purchaseChat({text:'sin precio',conversation,branch:'0101',canPlan:true,actor:'controlled',
  read:async(resource,params)=>{calls.push(resource);assert.equal(params.get('sucursal'),'0101');return {data:resource==='productos'?[{codigo:'Z1',nombre:'ENVASE',unidadMedida:'UN'}]:resource==='depositos'?[{codigo:'16'}]:[],meta:{hasMore:false}};},
  prepare:async(actor,input)=>{prepared.push(input);return {id:'review',confirmationRequired:true};}
 });
 assert.equal(prepared.length,1,result.answer);assert.equal(prepared[0].action,'crearSolicitudCompra');
 assert.deepEqual(prepared[0].items,[{producto:'Z1',deposito:'16',fechaNecesidad:'2026-10-23',cantidad:'2',baseCantidad:'millares'}]);
 assert.equal(prepared[0].header.moneda,'ARS');assert.deepEqual(calls,['productos','depositos']);
 assert.match(result.answer,/confirmar/);assert.match(result.answer,/No se creó ningún documento/);
 assert.equal(conversation.purchaseDraft,undefined);
});

test('a fresh SC1 starts without a previous draft rejected value or reference',async()=>{
 const conversation={purchaseDraft:{branch:'0101',action:'crearSolicitudCompra',values:{product:'ZOLD',priceUnit:'unidad',currency:'USD'},unresolvedValues:['price'],unresolvedReferences:['product']}};
 const calls=[];
 const result=await purchaseChat({text:'Creame una solicitud de compra con producto ZOTHER, 5 unidades',conversation,branch:'0101',canPlan:true,
  read:async(resource,params)=>{calls.push({resource,code:params.get('codigo')});return {data:resource==='productos'?[{codigo:'ZOTHER',nombre:'OTRO',unidadMedida:'UN'}]:[],meta:{hasMore:false}};},
  prepare:()=>assert.fail('new logistics are not yet complete')
 });
 const draft=conversation.purchaseDraft;
 assert.equal(draft.values.product,'ZOTHER');assert.equal(draft.values.quantity,'5');assert.equal(draft.values.quantityUnit,'unidades');
 assert.equal(draft.values.price,undefined);assert.equal(draft.values.currency,undefined);assert.equal(draft.values.priceUnit,undefined);
 assert.deepEqual(draft.unresolvedValues,[]);assert.deepEqual(draft.unresolvedReferences,[]);
 assert.deepEqual(calls,[{resource:'productos',code:'ZOTHER'}]);assert.match(result.answer,/Encontré ZOTHER/);
 assert.doesNotMatch(result.answer,/valor negado|referencia negada/);
});

test('a fresh guarded PC cannot inherit rejected values from active or paused drafts',()=>{
 for(const slot of ['purchaseDraft','pausedPurchase']){
  const conversation={[slot]:{branch:'0101',action:'crearPedidoCompra',values:{product:'ZOLD',quantity:'9',priceUnit:'millar'},unresolvedValues:['price','currency'],unresolvedReferences:['product','party']}};
  updateSupplierPendingDraft(conversation,'Creame un pedido de compra nuevo con producto ZOTHER, 5 unidades; no sé el proveedor','0101');
  const draft=conversation.purchaseDraft;
  assert.deepEqual(draft.values,{product:'ZOTHER',quantity:'5',quantityUnit:'unidades'});
  assert.deepEqual(draft.unresolvedValues,[]);assert.deepEqual(draft.unresolvedReferences,['party']);
  assert.equal(conversation.pausedPurchase,undefined);
 }
});

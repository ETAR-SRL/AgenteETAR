import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierReferenceIntent,invalidateSupplierContext,unresolvedSupplierReference} from '../src/intelligence/supplier-reference.js';
import {purchaseChat,updateSupplierPendingDraft} from '../src/intelligence/purchase-chat.js';
import {businessChat} from '../src/intelligence/business-chat.js';

test('supplier corrections distinguish rejection, unknown identity and preservation',()=>{
 for(const value of ['el anterior','de antes','antes','ese','el mismo','desconocido','el nuevo','otro'])assert.equal(unresolvedSupplierReference(value),true,value);
 for(const value of ['Nuevo Norte','Otra Estrella','Taller Central','V72'])assert.equal(unresolvedSupplierReference(value),false,value);
 for(const text of ['Descartá Taller Central: no es ése','no uses Estrella','No sé el proveedor todavía','El proveedor es desconocido','Prepará el pedido de compra en dólares no es con Taller Norte','Ese proveedor no','Ese no va'])assert.equal(supplierReferenceIntent(text,{active:true}).rejected,true,text);
 for(const text of ['no cambies proveedor','No descartes el proveedor','no tengo precio','no uses el cliente MILORDI'])assert.equal(supplierReferenceIntent(text,{active:false}).rejected,false,text);
 for(const text of ['no es el precio','descarta producto X','no uses el cliente MILORDI','no uses la lista 001'])assert.equal(supplierReferenceIntent(text,{active:true}).rejected,false,text);
 assert.deepEqual(supplierReferenceIntent('no es Estrella, es Taller Central',{active:true}),{rejected:true,replacement:'Taller Central'});
 assert.deepEqual(supplierReferenceIntent('no uses proveedor Estrella; proveedor Taller Central',{active:true}),{rejected:true,replacement:'Taller Central'});
 assert.deepEqual(supplierReferenceIntent('no uses Estrella, proveedor de antes',{active:true}),{rejected:true});
 for(const text of ['No me acuerdo del proveedor','No recuerdo el proveedor','Se me borró el proveedor','El proveedor no lo sé'])assert.equal(supplierReferenceIntent(text,{active:true}).rejected,true,text);
 assert.deepEqual(supplierReferenceIntent('El proveedor es Estrella, no es Norte',{active:true}),{rejected:true,replacement:'Estrella'});
 assert.deepEqual(supplierReferenceIntent('El proveedor es Estrella, no es Estrella',{active:true}),{rejected:true});
 assert.deepEqual(supplierReferenceIntent('Usá V72 tienda 03',{active:true}),{rejected:false,replacement:'V72'});
 assert.deepEqual(supplierReferenceIntent('Todavía no sé con quién es',{active:true}),{rejected:true});
 assert.deepEqual(supplierReferenceIntent('Todavía no sé con quién es'),{rejected:false});
 for(const text of ['Si te digo no uses Norte','Supongamos que no es el proveedor Norte','Mi ejemplo es "no uses proveedor Norte"','no, ese no'])assert.equal(supplierReferenceIntent(text,{active:false}).rejected,false,text);
 for(const text of ['Si te digo no uses Norte','Mi ejemplo es "no uses proveedor Norte"'])assert.equal(supplierReferenceIntent(text,{active:true}).rejected,false,text);
});

test('supplier uncertainty remains optional for SC1 and never reads suppliers',async()=>{
 for(const text of ['sin proveedor','No sé el proveedor']){
  const conversation={purchaseDraft:{branch:'0101',action:'crearSolicitudCompra',values:{product:'1',quantity:'10',quantityUnit:'unidades',warehouse:'16',emission:'2026-10-21',due:'2026-10-22',requester:'Ana'}}};
  const read=async(resource)=>{assert.notEqual(resource,'proveedores');return {data:resource==='productos'?[{codigo:'1',unidadMedida:'UN'}]:resource==='depositos'?[{codigo:'16'}]:[],meta:{hasMore:false}};};
  let prepared=0;
  const result=await purchaseChat({text,conversation,branch:'0101',canPlan:true,read,prepare:async()=>{prepared++;return {id:'preview'};}});
  assert.equal(prepared,1,text);assert.match(result.answer,/Preparé.*solicitud/);assert.doesNotMatch(result.answer,/proveedor.*corresponde/);
 }
});

test('purchase anaphoric supplier cannot resolve a rejected identity',async()=>{
 for(const text of ['El proveedor es el anterior','Usá el proveedor de antes']){
  const conversation={purchaseDraft:{branch:'0101',action:'crearPedidoCompra',values:{product:'1',quantity:'3'},unresolvedReferences:['party']}};
  const result=await purchaseChat({text,conversation,branch:'0101',canPlan:true,read:()=>assert.fail('unexpected read'),prepare:()=>assert.fail('unexpected proposal')});
  assert.match(result.answer,/proveedor/);assert.equal(conversation.purchaseDraft.values.party,undefined);assert.equal(conversation.purchaseDraft.values.quantity,'3');assert.ok(conversation.purchaseDraft.unresolvedReferences.includes('party'));
 }
});

test('global supplier invalidation clears active and paused dependencies only in this branch',()=>{
 const values={party:'P1',shop:'01',list:'001',resolvedPrice:{precio:'1'},price:'80',priceUnit:'millar',product:'Z1',quantity:'3',quantityUnit:'millares',currency:'USD'};
 const conversation={purchaseDraft:{branch:'0101',action:'crearPedidoCompra',values:structuredClone(values)},pausedPurchase:{branch:'0101',action:'crearPedidoCompra',values:structuredClone(values)},businessContext:{branch:'0201',kind:'vendor',refs:{vendor:'OTHER'}}};
 invalidateSupplierContext(conversation,{branch:'0101'});
 for(const key of ['purchaseDraft','pausedPurchase']){
  assert.deepEqual(conversation[key].values,{price:'80',priceUnit:'millar',product:'Z1',quantity:'3',quantityUnit:'millares',currency:'USD'});
  assert.deepEqual(conversation[key].unresolvedReferences,['party']);
 }
 assert.equal(conversation.businessContext.refs.vendor,'OTHER');
 const optional={purchaseDraft:{branch:'0101',action:'crearSolicitudCompra',values:{product:'1'}}};
 invalidateSupplierContext(optional,{branch:'0101'});assert.deepEqual(optional.purchaseDraft,{branch:'0101',action:'crearSolicitudCompra',values:{product:'1'}});
});

test('guarded purchase inputs retain literals and resume the same branch without supplier inference',()=>{
 const conversation={};
 updateSupplierPendingDraft(conversation,'Armá un pedido de compra producto Z73, 3 millares a 80 dólares por millar; no sé el proveedor','0101');
 assert.deepEqual(conversation.purchaseDraft.values,{product:'Z73',quantity:'3',quantityUnit:'millares',price:'80',priceUnit:'millar',currency:'USD'});
 conversation.pausedPurchase=conversation.purchaseDraft;delete conversation.purchaseDraft;
 updateSupplierPendingDraft(conversation,'Retomá el pedido de compra con el proveedor de antes','0201');
 assert.equal(conversation.purchaseDraft,undefined);
 updateSupplierPendingDraft(conversation,'Retomá el pedido de compra con el proveedor de antes','0101');
 assert.equal(conversation.pausedPurchase,undefined);assert.equal(conversation.purchaseDraft.values.party,undefined);assert.equal(conversation.purchaseDraft.values.quantity,'3');assert.equal(conversation.purchaseDraft.values.price,'80');
 const other={};updateSupplierPendingDraft(other,'Armá un pedido de compra con productos Z1 y Z2; no sé el proveedor','0101');assert.equal(other.purchaseDraft,undefined);
 const fresh={purchaseDraft:{branch:'0101',action:'crearPedidoCompra',values:{product:'VIEJO'}}};
 updateSupplierPendingDraft(fresh,'Creame un pedido de compra nuevo, no sé el proveedor','0101');assert.equal(fresh.purchaseDraft,undefined);
 updateSupplierPendingDraft(fresh,'Armá una compra con producto Z73, no sé el proveedor','0101',{warehouse:'03'});assert.equal(fresh.purchaseDraft.values.warehouse,'03');
 fresh.pausedPurchase=fresh.purchaseDraft;delete fresh.purchaseDraft;
 updateSupplierPendingDraft(fresh,'Retomá esa compra con el proveedor de antes','0101');assert.equal(fresh.purchaseDraft.values.product,'Z73');assert.equal(fresh.pausedPurchase,undefined);
});

test('purchase supplier rejection clears derived identity and prices before pausing or numeric ambiguity',async()=>{
 for(const text of ['Descartá Taller Central: no es ése','no uses Estrella','No sé el proveedor todavía','El proveedor no lo sé','No me acuerdo del proveedor','No uses Estrella; precio 10 o 20']){
  const conversation={purchaseDraft:{branch:'0101',action:'crearPedidoCompra',values:{party:'P1',shop:'01',list:'001',resolvedPrice:{precio:'9'},product:'1',quantity:'12',quantityUnit:'unidades',price:'25',priceUnit:'unidad'}}};
  let authorized=0;
  const result=await purchaseChat({text,conversation,branch:'0101',canPlan:true,authorizePlan:async()=>authorized++,prepare:()=>assert.fail('unexpected proposal'),read:()=>assert.fail('unexpected read')});
  assert.ok(result,text);assert.equal(authorized,1);assert.ok(conversation.purchaseDraft);
  const v=conversation.purchaseDraft.values;
  for(const key of ['party','shop','list','resolvedPrice'])assert.equal(v[key],undefined,text+' '+key);
  assert.equal(v.product,'1');assert.equal(v.quantity,'12');assert.equal(v.price,'25');
 }
});

test('business supplier rejection clears selected rows without erasing unrelated customer or product',async()=>{
 for(const text of ['Descartá Taller Central: no es ése','no uses Estrella','No sé el proveedor todavía']){
  const conversation={businessContext:{branch:'0101',kind:'supplierList',refs:{vendor:'P1',shop:'01',list:'001',product:'1',customer:'C1'},selected:{registro:'4'},candidates:[{codigo:'P1'}]}};
  const result=await businessChat({text,conversation,branch:'0101',read:()=>assert.fail('unexpected read')});
  assert.match(result.answer,/proveedor/);
  const state=conversation.businessContext;
  assert.equal(state.refs.vendor,undefined);assert.equal(state.refs.list,undefined);assert.equal(state.selected,undefined);assert.equal(state.candidates,undefined);
  assert.equal(state.refs.product,'1');assert.equal(state.refs.customer,'C1');assert.equal(state.refs.shop,'01');
 }
});

test('affirmative supplier replacement is freshly verified without the old shop',async()=>{
 const conversation={purchaseDraft:{branch:'0101',action:'crearPedidoCompra',values:{party:'P1',shop:'99',resolvedPrice:{precio:'9'},product:'1'}}},calls=[];
 const read=async(resource,params)=>{
  calls.push({resource,filters:Object.fromEntries(params)});
  return {data:resource==='productos'?[{codigo:'1',unidadMedida:'UN'}]:resource==='proveedores'&&params.get('q')==='Taller Central'?[{codigo:'P2',tienda:'02'}]:[],meta:{hasMore:false}};
 };
 const result=await purchaseChat({text:'no es Estrella, es Taller Central',conversation,branch:'0101',canPlan:true,prepare:()=>assert.fail('unexpected proposal'),read});
 assert.ok(result);assert.equal(conversation.purchaseDraft.values.party,'P2');assert.equal(conversation.purchaseDraft.values.shop,'02');
 assert.ok(calls.some(c=>c.resource==='proveedores'&&c.filters.q==='Taller Central'));
 assert.ok(calls.filter(c=>c.resource==='proveedores').every(c=>!c.filters.tienda));
});

test('a short affirmative supplier after rejection reuses explicit amounts and verifies its supplied shop',async()=>{
 const conversation={purchaseDraft:{branch:'0101',action:'crearPedidoCompra',unresolvedReferences:['party'],values:{product:'1',quantity:'3',quantityUnit:'millares',price:'80',priceUnit:'millar',currency:'USD'}}},calls=[];
 const read=async(resource,params)=>{calls.push({resource,filters:Object.fromEntries(params)});return {data:resource==='productos'?[{codigo:'1',unidadMedida:'UN'}]:resource==='proveedores'?[{codigo:'V72',tienda:'03'}]:[],meta:{hasMore:false}};};
 await purchaseChat({text:'Usá V72 tienda 03',conversation,branch:'0101',canPlan:true,prepare:()=>assert.fail('unexpected proposal'),read});
 assert.equal(conversation.purchaseDraft.values.party,'V72');assert.equal(conversation.purchaseDraft.values.shop,'03');
 for(const [key,value] of Object.entries({quantity:'3',quantityUnit:'millares',price:'80',priceUnit:'millar',currency:'USD'}))assert.equal(conversation.purchaseDraft.values[key],value);
 assert.ok(calls.some(c=>c.resource==='proveedores'&&c.filters.codigo==='V72'&&c.filters.tienda==='03'));
});

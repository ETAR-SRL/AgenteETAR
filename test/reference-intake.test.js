import test from 'node:test';
import assert from 'node:assert/strict';
import {businessChat} from '../src/intelligence/business-chat.js';
import {purchaseChat,applyReferenceIntake,updateSupplierPendingDraft} from '../src/intelligence/purchase-chat.js';

const branch='0101';
const pending={price:'80',priceUnit:'millar',quantity:'2',quantityUnit:'millares',currency:'ARS'};

test('rejected product drops source selections and retains explicit commercial inputs',()=>{
 const state={kind:'sale',refs:{product:'Z1',number:'123'},pending:{...pending},base:'millar',selected:{registro:'99'},candidates:[{registro:'99'}]};
 const input={product:'Z1'};
 applyReferenceIntake(state,input,'No uses el producto Z1');
 assert.equal(state.refs.product,undefined);assert.equal(state.selected,undefined);assert.equal(state.base,undefined);
 assert.deepEqual(state.pending,pending);assert.ok(state.unresolvedReferences.includes('product'));
 const previous={product:'anterior'};
 applyReferenceIntake(state,previous,'el producto anterior');
 assert.equal(previous.product,undefined);assert.ok(state.unresolvedReferences.includes('product'));
});

test('customer correction invalidates its store and assigned price list',()=>{
 const state={kind:'saleList',refs:{customer:'C1',shop:'01',list:'059',product:'Z1'},pending:{...pending},selected:{registro:'4'}};
 const input={customer:'C1'};
 applyReferenceIntake(state,input,'No es el cliente C1, es C2');
 assert.equal(input.customer,'C2');assert.equal(state.refs.customer,undefined);
 assert.equal(state.refs.shop,undefined);assert.equal(state.refs.list,undefined);assert.equal(state.refs.product,'Z1');
 assert.deepEqual(state.pending,pending);
});

function fixture(conversation){
 const calls=[],prepared=[];
 const data={productos:[{codigo:'Z2',nombre:'Nuevo',unidadMedida:'KG'}],compras:[{registro:'22',numero:'000124',item:'02',productoCodigo:'Z2',precioUnitario:'10',cantidadPedida:'20',moneda:{codigo:'1'}}],proveedores:[{codigo:'P1',tienda:'01'}],listasPreciosProveedores:[{codigo:'002'}],preciosProveedores:[]};
 const read=async(resource,params)=>{
  const filters=Object.fromEntries(params);calls.push({resource,filters});
  const dataRows=(data[resource]||[]).filter(row=>Object.entries(filters).every(([key,value])=>['sucursal','limit'].includes(key)||String(row[{producto:'productoCodigo',lista:'listaCodigo',proveedor:'proveedorCodigo',tienda:'tienda',q:'nombre'}[key]||key])===value));
  return {data:dataRows,meta:{hasMore:false}};
 };
 const args={conversation,branch,read,metadata:{entities:{compras:{fields:[{salida:'numero',diccionario:{X3_TAMANHO:6}},{salida:'item',diccionario:{X3_TAMANHO:2}}]}}},prepare:async(actor,input)=>{prepared.push(input);return {id:'test'};},canPlan:true};
 return {calls,prepared,args};
}

test('order replacement re-reads new number and item without old RECNO',async()=>{
 const conversation={businessContext:{branch,kind:'purchase',refs:{number:'123',item:'01'},selected:{registro:'11',numero:'000123',item:'01'},pending:{price:'12',priceUnit:'unidad'}}};
 const f=fixture(conversation);
 const result=await businessChat({...f.args,text:'No es el pedido de compra 123, es 124; ítem 02'});
 assert.equal(f.prepared.length,1,result.answer);assert.equal(f.prepared[0].target.registro,'22');
 const lookup=f.calls.find(call=>call.resource==='compras');
 assert.equal(lookup.filters.numero,'000124');assert.equal(lookup.filters.item,'02');assert.equal(lookup.filters.registro,undefined);
});

test('supplier list correction preserves AIB route and provider identity',async()=>{
 const conversation={businessContext:{branch,kind:'supplierList',refs:{vendor:'P1',shop:'01',list:'001'},selected:{registro:'8'}}};
 const f=fixture(conversation);
 await businessChat({...f.args,text:'No es la lista 001, es 002'});
 assert.equal(conversation.businessContext.kind,'supplierList');
 assert.ok(f.calls.some(call=>call.resource==='listasPreciosProveedores'&&call.filters.codigo==='002'));
 assert.ok(!f.calls.some(call=>call.resource==='listasPreciosClientes'));
});

test('correcting sale to purchase verifies SC7 and retains explicit pending price',async()=>{
 const conversation={businessContext:{branch,kind:'sale',refs:{number:'123',item:'01'},selected:{registro:'11'},pending:{price:'12',priceUnit:'unidad'}}};
 const f=fixture(conversation);
 const result=await businessChat({...f.args,text:'No es el pedido de venta 123, es el pedido de compra 124; ítem 02'});
 assert.equal(f.prepared.length,1,result.answer);assert.equal(f.prepared[0].action,'pedidoCompra');
 assert.equal(f.prepared[0].target.registro,'22');assert.equal(f.prepared[0].changes.precioUnitario,'12');
 assert.ok(!f.calls.some(call=>call.resource==='itemsVentas'));
});

test('replacement product revalidates SB1 and asks incompatible bases without losing amounts',async()=>{
 const conversation={purchaseDraft:{branch,action:'crearSolicitudCompra',values:{product:'Z1',...pending}}};
 const f=fixture(conversation);
 const result=await purchaseChat({...f.args,text:'No es el producto Z1, es Z2'});
 assert.equal(f.prepared.length,0);assert.match(result.answer,/base de cantidad: KG/);
 assert.equal(conversation.purchaseDraft.values.price,'80');assert.equal(conversation.purchaseDraft.values.quantity,'2');
 assert.ok(f.calls.some(call=>call.resource==='productos'&&call.filters.codigo==='Z2'));
});

for(const [kind,refs,marker]of [['customer',{},'customer'],['sale',{item:'01'},'number'],['supplierList',{vendor:'P1',shop:'01'},'list']]){
 test(`independent literal product read pauses ${kind} pending without inheriting its unresolved reference`,async()=>{
  const original={branch,kind,refs,unresolvedReferences:[marker],pending:{...pending}};
  const conversation={businessContext:structuredClone(original)},f=fixture(conversation);
  const result=await businessChat({...f.args,text:'Mostrame el producto Z2'});
  assert.match(result.answer,/Producto verificado en SB1: Z2/);
  assert.ok(f.calls.some(call=>call.resource==='productos'&&call.filters.codigo==='Z2'));
  assert.deepEqual(conversation.pausedBusiness,original);
  assert.equal(conversation.businessContext.kind,'product');
  assert.deepEqual(conversation.businessContext.unresolvedReferences,[]);
  assert.equal(f.prepared.length,0);
 });
}

test('an unresolved product anaphora cannot interrupt a pending operation as a literal catalog read',async()=>{
 const conversation={businessContext:{branch,kind:'sale',refs:{number:'123'},unresolvedReferences:['product'],pending:{...pending}}},f=fixture(conversation);
 const result=await businessChat({...f.args,text:'Mostrame el producto anterior'});
 assert.match(result.answer,/forma afirmativa el producto/);assert.equal(f.calls.length,0);
 assert.equal(conversation.pausedBusiness,undefined);
});

test('untyped affirmative supplier command cannot overwrite the pending product',()=>{
 const state={values:{product:'Z1',quantity:'3',price:'80',currency:'USD'},unresolvedReferences:['party']};
 const input={};applyReferenceIntake(state,input,'Usá V72 tienda 03',{purchase:true});
 assert.equal(state.values.product,'Z1');assert.equal(input.product,undefined);
 assert.ok(!state.unresolvedReferences.includes('product'));
});

test('supplier guard preserves an explicitly supplied product while rejecting an untyped supplier',()=>{
 const conversation={};
 updateSupplierPendingDraft(conversation,'Creame un pedido de compra con producto Z1; 3 unidades; no es con Taller Norte y no sé con quién es.',branch);
 assert.equal(conversation.purchaseDraft.values.product,'Z1');assert.equal(conversation.purchaseDraft.values.quantity,'3');
 assert.deepEqual(conversation.purchaseDraft.unresolvedReferences,['party']);
 updateSupplierPendingDraft(conversation,'No es con Taller Norte',branch);
 assert.equal(conversation.purchaseDraft.values.product,'Z1');
 assert.ok(!conversation.purchaseDraft.unresolvedReferences.includes('product'));
});

for(const customer of [true,false])for(const matched of [false,true]){
 test(`${customer?'SA1 customer':'SA2 supplier'} correction ${matched?'allows only a matching order':'blocks a mismatching existing order'} without losing pending values`,async()=>{
  const kind=customer?'sale':'purchase',key=customer?'customer':'vendor',oldCode=customer?'C1':'P1',newCode=customer?'C2':'P2';
  const values={price:'12',priceUnit:'unidad',quantity:'4',quantityUnit:'unidades'};
  const conversation={businessContext:{branch,kind,refs:{number:'123',item:'01',[key]:oldCode,shop:'99'},pending:{...values},selected:{registro:'old'}}};
  const calls=[],prepared=[];
  const party={codigo:newCode,tienda:'02',listaPreciosCodigo:'060'};
  const row={registro:'fresh',numero:'000123',item:'01',productoCodigo:'Z1',precioUnitario:'10',cantidadPedida:'20',moneda:{codigo:'1'},[customer?'clienteCodigo':'proveedorCodigo']:matched?newCode:oldCode,[customer?'clienteTienda':'proveedorTienda']:matched?'02':'01'};
  const resource=customer?'itemsVentas':'compras',catalog=customer?'clientes':'proveedores';
  const read=async(name,params)=>{calls.push({resource:name,filters:Object.fromEntries(params)});return {data:name===catalog?[party]:name===resource?[row]:name==='productos'?[{codigo:'Z1',unidadMedida:'UN'}]:[],meta:{hasMore:false}};};
  const result=await businessChat({text:`No es el ${customer?'cliente':'proveedor'} ${oldCode}, es ${newCode}`,conversation,branch,read,canPlan:true,metadata:{entities:{[resource]:{fields:[{salida:'numero',diccionario:{X3_TAMANHO:6}},{salida:'item',diccionario:{X3_TAMANHO:2}}]}}},prepare:async(actor,input)=>{prepared.push(input);return {id:'test'};}});
  assert.ok(calls.some(call=>call.resource===catalog&&call.filters.codigo===newCode));
  assert.ok(calls.filter(call=>call.resource===catalog).every(call=>!call.filters.tienda));
  assert.ok(calls.filter(call=>call.resource===resource).every(call=>!call.filters.registro));
  if(matched){
   assert.equal(prepared.length,1,result.answer);assert.equal(prepared[0].target.registro,'fresh');
   assert.deepEqual(prepared[0].changes,{precioUnitario:'12',cantidadPedida:'4'});
   assert.equal(prepared[0].expectedIdentity[customer?'cliente':'proveedor'],newCode);assert.equal(prepared[0].expectedIdentity.tienda,'02');
  }else{
   assert.equal(prepared.length,0);assert.match(result.answer,/no corresponde/);
   assert.deepEqual(conversation.businessContext.pending,values);
  }
 });
}

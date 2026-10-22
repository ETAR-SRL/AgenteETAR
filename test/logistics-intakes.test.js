import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommercialValueIntake,purchaseChat} from '../src/intelligence/purchase-chat.js';
import {businessChat} from '../src/intelligence/business-chat.js';
const values=()=>({product:'Z1',quantity:'2',quantityUnit:'unidades',price:'10',priceUnit:'unidad',currency:'ARS',warehouse:'16',emission:'2026-10-22',due:'2026-10-25',requester:'ANA',party:'P1',shop:'01',payment:'001'});
test('logistics rejection removes draft values and cache while retaining independent numeric fields',()=>{
 const state={values:{...values(),resolvedPrice:{precio:'10'}}},input={warehouse:'16',emission:'2026-10-22'};
 applyCommercialValueIntake(state,input,'Ese depósito no; esa fecha de emisión no',{purchase:true});
 assert.equal(state.values.warehouse,undefined);assert.equal(state.values.emission,undefined);assert.equal(state.values.resolvedPrice,undefined);
 assert.equal(state.values.quantity,'2');assert.equal(state.values.price,'10');assert.ok(state.unresolvedValues.includes('warehouse'));assert.ok(state.unresolvedValues.includes('emission'));
});
test('generic corrected date survives a kind clarification without repeating the literal',()=>{
 const state={values:values()};let input={};
 applyCommercialValueIntake(state,input,'cambiá la fecha al 28/10/2026',{purchase:true});
 assert.ok(state.unresolvedValues.includes('date'));assert.equal(state.values.due,'2026-10-25');
 input={};applyCommercialValueIntake(state,input,'la de entrega',{purchase:true});Object.assign(state.values,input);
 assert.equal(state.values.due,'2026-10-28');assert.deepEqual(state.unresolvedValues,[]);
});
function fixture({pc=false,rows={},metadata={},error}={}){
 const conversation={purchaseDraft:{branch:'0101',action:pc?'crearPedidoCompra':'crearSolicitudCompra',values:values()}},prepared=[],calls=[];
 const context={conversation,branch:'0101',canPlan:true,metadata,preferences:{warehouse:'16'},prepare:async(a,p)=>{prepared.push(p);return {};},read:async(resource,params)=>{
  calls.push({resource,filters:Object.fromEntries(params)});if(error&&resource==='depositos')throw error;
  return {data:rows[resource]??({productos:[{codigo:'Z1',nombre:'PRODUCTO',unidadMedida:'UN'}],depositos:[{codigo:'16'}],proveedores:[{codigo:'P1',tienda:'01'}],condicionesPago:[{codigo:'001'}]})[resource]??[],meta:{hasMore:false}};
 }};return {conversation,prepared,calls,context};
}
test('rejected warehouse cannot recover preferences during later confirmation',async()=>{
 const f=fixture();await purchaseChat({...f.context,text:'Ese depósito no'});await purchaseChat({...f.context,text:'confirmo'});
 assert.equal(f.conversation.purchaseDraft.values.warehouse,undefined);assert.equal(f.prepared.length,0);assert.equal(f.calls.length,0);
});
test('warehouse and payment code must equal returned catalog identity',async()=>{
 for(const resource of ['depositos','condicionesPago']){
  const f=fixture({pc:true,rows:{[resource]:[{codigo:'999'}]}});await purchaseChat({...f.context,text:'continuemos solicitud'});
  assert.equal(f.prepared.length,0);assert.equal(f.conversation.purchaseDraft.values[resource==='depositos'?'warehouse':'payment'],undefined);
 }
});
test('catalog names use bounded q only when metadata advertises it',async()=>{
 const f=fixture({rows:{depositos:[]},metadata:{entities:{depositos:{filters:{q:'nombre'}}}}});f.conversation.purchaseDraft.values.warehouse='GENERAL';
 f.context.read=async(resource,params)=>{f.calls.push({resource,filters:Object.fromEntries(params)});return {data:resource==='productos'?[{codigo:'Z1',unidadMedida:'UN'}]:params.has('q')?[{codigo:'16',nombre:'GENERAL'}]:[],meta:{hasMore:false}};};
 await purchaseChat({...f.context,text:'continuemos solicitud'});assert.equal(f.prepared.length,1);assert.equal(f.prepared[0].items[0].deposito,'16');assert.ok(f.calls.some(c=>c.filters.q==='GENERAL'&&c.filters.limit==='2'));
});
test('source failures and denied catalog reads never produce proposals',async()=>{
 for(const error of [new Error('timeout'),Object.assign(new Error('denied'),{status:403})]){const f=fixture({error});await assert.rejects(purchaseChat({...f.context,text:'continuemos solicitud'}));assert.equal(f.prepared.length,0);}
});
test('existing logistics cannot bypass permission checks',async()=>{
 const conversation={businessContext:{branch:'0101',kind:'purchase',refs:{number:'123'},pending:{price:'10'}}};
 await assert.rejects(businessChat({text:'depósito 03',conversation,branch:'0101',canPlan:false,prepare:async()=>{},read:async()=>{throw Error('unexpected read');}}),{code:'ROL_INSUFICIENTE'});
});
test('explicit cancellation of unsupported logistics resumes only retained numeric edits',async()=>{
 const conversation={businessContext:{branch:'0101',kind:'purchase',refs:{number:'123'},pending:{price:'10',priceUnit:'unidad',warehouse:'03'}}},prepared=[];
 const result=await businessChat({text:'cancelar cambio de depósito',conversation,branch:'0101',canPlan:true,metadata:{},prepare:async(a,p)=>{prepared.push(p);return {};},read:async(resource)=>({data:resource==='compras'?[{registro:'1',numero:'123',item:'01',productoCodigo:'Z1',precioUnitario:'5',cantidadPedida:'2',moneda:{codigo:'1'},proveedorCodigo:'P1',proveedorTienda:'01'}]:[{codigo:'Z1',unidadMedida:'UN'}],meta:{hasMore:false}})});
 assert.equal(prepared.length,1,result.answer);assert.deepEqual(prepared[0].changes,{precioUnitario:'10'});assert.equal(prepared[0].expectedIdentity.numero,'123');
});

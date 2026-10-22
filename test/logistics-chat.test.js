import test from 'node:test';
import assert from 'node:assert/strict';
import {valueChat} from '../src/intelligence/value-chat.js';
import {valuePending,localValueDecision} from '../src/intelligence/value-decision.js';
import {commercialCorrections} from '../src/intelligence/commercial-corrections.js';
import {applyCommercialValueIntake,purchaseChat} from '../src/intelligence/purchase-chat.js';
import {evaluationSchema} from '../src/intelligence/evaluation.js';
import {referenceCorrections} from '../src/intelligence/reference-corrections.js';
import {supplierReferenceIntent} from '../src/intelligence/supplier-reference.js';

const initial={product:'Z1',price:'80',priceUnit:'millar',quantity:'3',quantityUnit:'millares',currency:'ARS',emission:'2026-10-22',due:'2026-10-26',warehouse:'01',payment:'001'};
function fixture(){
 const conversation={messages:[],purchaseDraft:{branch:'0101',action:'crearSolicitudCompra',values:{...initial}}},calls=[];
 const options={conversation,branch:'0101',canPlan:true,prepare:()=>assert.fail('No proposal'),authorizePlan:async action=>calls.push(['plan',action]),authorizeRead:async resource=>calls.push(['permission',resource]),schema:evaluationSchema,singleBranch:true,model:{name:'controlled',local:true,complete:async(_messages,schema)=>{calls.push(['model']);return {action:'responder',args:{},answer:schema.properties.answer.enum[0]};}}};
 return {conversation,options,calls,query:text=>valueChat({...options,text})};
}
test('date, warehouse and payment rejections survive model failure without changing commercial amounts',async()=>{
 for(const [text,field] of [['No es esa emisión','emission'],['No es esa entrega','due'],['No es ese depósito','warehouse'],['No es esa condición de pago','payment']]){
  const f=fixture();f.options.model.complete=async()=>{throw Error('offline');};
  await assert.rejects(f.query(text),/offline/);const state=f.conversation.purchaseDraft;
  assert.equal(state.values[field],undefined);assert.ok(state.unresolvedValues.includes(field));assert.equal(state.values.price,'80');assert.equal(state.values.quantity,'3');
 }
});
test('a warehouse correction checks catalog authorization before mutation or inference',async()=>{
 const f=fixture();f.options.authorizeRead=resource=>{if(resource==='depositos')throw Object.assign(Error('denied'),{code:'LECTURA_DENEGADA'});};
 await assert.rejects(f.query('No es ese depósito'),{code:'LECTURA_DENEGADA'});assert.deepEqual(f.conversation.purchaseDraft.values,initial);assert.ok(!f.calls.some(c=>c[0]==='model'));
});
test('common resume and confirmation expressions keep a paused date rejection pending',async()=>{
 for(const text of ['Continuemos','Confirmo']){
  const f=fixture();await f.query('No es esa entrega');f.conversation.pausedPurchase=f.conversation.purchaseDraft;delete f.conversation.purchaseDraft;
  const result=await f.query(text);assert.equal(result.valueClarification,true);assert.ok(f.conversation.purchaseDraft.unresolvedValues.includes('due'));assert.equal(f.conversation.purchaseDraft.values.due,undefined);
 }
});
test('date-kind clarification resumes a paused draft without repeating its candidate',async()=>{
 const f=fixture();let r=await f.query('Cambiá la fecha al 25/10/2026');assert.equal(r.valueClarification,true);assert.equal(f.conversation.purchaseDraft.dateCandidate,'2026-10-25');
 f.conversation.pausedPurchase=f.conversation.purchaseDraft;delete f.conversation.purchaseDraft;
 r=await f.query('La de entrega');assert.equal(r.continueIntake,true);assert.ok(f.conversation.purchaseDraft);
 const state=f.conversation.purchaseDraft,input={};applyCommercialValueIntake(state,input,'La de entrega',{purchase:true});Object.assign(state.values,input);
 assert.equal(state.values.due,'2026-10-25');assert.equal(state.values.emission,'2026-10-22');assert.equal(state.values.price,'80');assert.deepEqual(state.unresolvedValues,[]);
});
test('full user history preserves logistics pending and generic date candidates through independent reads',()=>{
 const detours=Array.from({length:50},()=>[{role:'user',content:'Mostrame el producto Z2'},{role:'assistant',content:'Usá el depósito 01 y pago 001'}]).flat();
 const messages=[{role:'user',content:'Creame una solicitud de compra; emisión 22/10/2026; entrega 26/10/2026; depósito 01'},{role:'user',content:'No es ese depósito'},...detours,{role:'user',content:'Retomá con el depósito anterior'}];
 assert.deepEqual(valuePending(messages),['warehouse']);assert.deepEqual(localValueDecision(messages,evaluationSchema).fields,['warehouse']);
 const date=[{role:'user',content:'emisión 22/10/2026; entrega 26/10/2026'},{role:'user',content:'Cambiá la fecha al 25/10/2026'},...detours,{role:'user',content:'La de entrega'}];assert.deepEqual(valuePending(date),[]);
});
test('relative dates are stored as fixed dates and invalid calendar input cannot become a draft value',()=>{
 const c=commercialCorrections('Entrega mañana',{today:'2026-10-22'});assert.equal(c.changes.due,'2026-10-23');
 assert.ok(commercialCorrections('Entrega 31/02/2027').pending.includes('due'));
 const state={action:'crearSolicitudCompra',values:{...initial,due:c.changes.due}};applyCommercialValueIntake(state,{},'Retomá la solicitud',{purchase:true});assert.equal(state.values.due,'2026-10-23');
});
test('a new date overrides its older candidate and a rejected candidate never returns by kind',()=>{
 for(const [last,expected] of [['La entrega es 26/10/2026','2026-10-26'],['No es esa fecha',undefined]]){
  const state={action:'crearSolicitudCompra',values:{...initial}},apply=text=>{const input={};applyCommercialValueIntake(state,input,text,{purchase:true});Object.assign(state.values,input);};
  apply('Cambiá la fecha al 25/10/2026');apply(last);
  if(expected)assert.equal(state.values.due,expected);
  else{apply('La de entrega');assert.equal(state.values.due,undefined);assert.ok(state.unresolvedValues.includes('due'));}
 }
});
test('catalog identifiers and logistic owners cannot be mistaken for prices or rejected document references',()=>{
 const result=commercialCorrections('3 millares a 80 pesos por millar; proveedor 000001 tienda 01; condición de pago 001; emisión 2026-10-22');assert.equal(result.changes.price,'80');assert.ok(!result.pending.includes('price'));
 for(const text of ['El depósito del pedido de venta no es 01','La fecha del producto Z1 no es 22/10/2026','La condición de pago del pedido no es 001'])assert.deepEqual(referenceCorrections(text),{});
 for(const text of ['No es esa condición de pago','No es la entrega','No uses depósito 01; usá 03','La condición de pago del proveedor P1 no es 001; es 003'])assert.deepEqual(supplierReferenceIntent(text,{active:true}),{rejected:false});
});

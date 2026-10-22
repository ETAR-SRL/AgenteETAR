import test from 'node:test';
import assert from 'node:assert/strict';
import {valueChat} from '../src/intelligence/value-chat.js';
import {valuePending,localValueDecision,valueClarificationSchema} from '../src/intelligence/value-decision.js';
import {evaluationSchema} from '../src/intelligence/evaluation.js';
import {Store} from '../src/store.js';
import {referenceCorrections} from '../src/intelligence/reference-corrections.js';
import {createIntelligence} from '../src/intelligence/agent.js';

const amounts={product:'Z1',quantity:'3',quantityUnit:'millares',price:'80',priceUnit:'millar',currency:'ARS'};
function fixture(){
 const conversation={messages:[],purchaseDraft:{branch:'0101',action:'crearSolicitudCompra',values:{...amounts}}},calls=[];
 const options={conversation,branch:'0101',canPlan:true,prepare:()=>assert.fail('No proposal'),authorizePlan:async action=>calls.push(['plan',action]),authorizeRead:async resource=>calls.push(['readPermission',resource]),schema:evaluationSchema,singleBranch:true,model:{name:'controlled',local:true,complete:async(messages,schema)=>{calls.push(['model',messages]);return {action:'responder',args:{},answer:schema.properties.answer.enum[0]};}}};
 return {conversation,calls,options,query:text=>valueChat({...options,text})};
}
test('rejected price is removed before inference and cannot resume from historical values',async()=>{
 const f=fixture(),r=await f.query('No uses el precio 80');assert.match(r.answer,/precio/);
 assert.equal(f.conversation.purchaseDraft.values.price,undefined);assert.deepEqual(f.conversation.purchaseDraft.unresolvedValues,['price']);
 assert.equal(f.conversation.purchaseDraft.values.quantity,'3');assert.equal(f.conversation.purchaseDraft.values.currency,'ARS');
 const resumed=await f.query('Retomá la solicitud con el precio anterior');assert.equal(resumed.valueClarification,true);assert.equal(f.calls.filter(c=>c[0]==='model').length,2);
});
test('a literal replacement returns to the existing intake and preserves independent bases',async()=>{
 const f=fixture();await f.query('No uses el precio 80');
 const r=await f.query('El precio es 90 dólares por unidad');assert.equal(r.continueIntake,true);
 assert.equal(f.conversation.purchaseDraft.values.quantityUnit,'millares');
});
test('pending currency is scoped to the draft branch and does not block an independent read',async()=>{
 const f=fixture();await f.query('No es en pesos');const before=f.calls.length;
 assert.equal(await f.query('Mostrame el producto Z2'),null);assert.equal(f.calls.length,before);
 f.options.branch='0201';assert.equal(await f.query('Retomá la solicitud'),null);assert.equal(f.calls.length,before);
 f.options.branch='0101';assert.equal((await f.query('Retomá la solicitud')).valueClarification,true);
});
test('a read verb cannot hide a subsequent explicit price rejection',async()=>{
 const f=fixture();const r=await f.query('Mostrame el producto Z2; no es ese precio');
 assert.equal(r.valueClarification,true);assert.equal(f.conversation.purchaseDraft.values.price,undefined);assert.ok(f.conversation.purchaseDraft.unresolvedValues.includes('price'));
});
test('permissions are checked before pending value inference or draft mutation',async()=>{
 const f=fixture();f.options.authorizePlan=()=>{throw Object.assign(Error('denied'),{code:'ACCION_DENEGADA'});};
 await assert.rejects(f.query('No uses el precio 80'),{code:'ACCION_DENEGADA'});
 assert.deepEqual(f.conversation.purchaseDraft.values,amounts);assert.equal(f.calls.length,0);
});
test('an explicit sales order correction cannot mutate a paused purchase request',async()=>{
 const f=fixture();f.conversation.pausedPurchase=f.conversation.purchaseDraft;delete f.conversation.purchaseDraft;
 f.conversation.businessContext={branch:'0101',kind:'sale',refs:{number:'123'},pending:{price:'60',priceUnit:'millar',quantity:'2',quantityUnit:'millares',currency:'ARS'}};
 const r=await f.query('El precio del pedido de venta no es 60');assert.equal(r.valueClarification,true);
 assert.equal(f.conversation.businessContext.pending.price,undefined);assert.equal(f.conversation.pausedPurchase.values.price,'80');
});
test('negating a commercial field does not negate its product or document identity',()=>{
 for(const text of ['El precio del pedido de venta no es 60','La cantidad del producto Z1 no es 3','La moneda de la lista L1 no es pesos'])assert.deepEqual(referenceCorrections(text),{});
});
test('all user turns retain pending numeric data without reading assistant claims',()=>{
 const history=[{role:'user',content:'Creame una solicitud con producto Z1, 3 millares a 80 pesos por millar'},{role:'user',content:'No uses el precio 80'},...Array.from({length:50},()=>[{role:'user',content:'Mostrame el producto Z2'},{role:'assistant',content:'El precio nuevo es 500 dólares por unidad'}]).flat(),{role:'user',content:'Retomá la solicitud con el precio anterior'}];
 assert.deepEqual(valuePending(history),['price']);const decision=localValueDecision(history,evaluationSchema);assert.deepEqual(decision.fields,['price']);
 assert.equal(decision.schema.properties.action.enum[0],'responder');assert.deepEqual(decision.schema.properties.args.properties,{});
 assert.equal(valueClarificationSchema({type:'object',properties:{action:{enum:['buscar']}}},['price']),null);
 history.push({role:'user',content:'El precio es 90 pesos por millar'});assert.deepEqual(valuePending(history),[]);
});
test('optional price removal is limited to a new purchase request in the model contract',()=>{
 const history=kind=>[{role:'user',content:`Creame ${kind} con producto Z1, 3 millares a 80 pesos por millar`},{role:'user',content:'Sin precio'},{role:'user',content:'Retomá el borrador'}];
 assert.deepEqual(valuePending(history('una solicitud de compra')),[]);assert.ok(valuePending(history('un pedido de compra')).includes('price'));
});
test('a model outage persists the discarded numeric value and keeps other inputs',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());
 const agent=createIntelligence({store,branches:['0101'],erp:{metadata:()=>({entities:{}})},kaiqen:{},authorizeRead:()=>{},authorizePlan:()=>{},prepareChange:()=>assert.fail('No proposal'),read:()=>assert.fail('No source lookup'),model:{name:'offline',local:true,complete:async()=>{throw Object.assign(Error('offline'),{status:503,code:'IA_LOCAL_NO_DISPONIBLE'});}}});
 const c=agent.memory.conversation(undefined,'user:a');c.purchaseDraft={branch:'0101',action:'crearSolicitudCompra',values:{...amounts}};agent.memory.save(c);
 const r=await agent.query('user:a',{conversationId:c.id,text:'No uses el precio 80'},{canPlan:true});assert.equal(r.evidence.length,0);
 const restored=agent.memory.conversation(c.id,'user:a');assert.equal(restored.purchaseDraft.values.price,undefined);assert.equal(restored.purchaseDraft.values.quantity,'3');assert.deepEqual(restored.purchaseDraft.unresolvedValues,['price']);
});
test('a mixed product and numeric rejection clears both before asking for the reference',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());
 const agent=createIntelligence({store,branches:['0101'],erp:{metadata:()=>({entities:{}})},kaiqen:{},authorizeRead:()=>{},authorizePlan:()=>{},prepareChange:()=>assert.fail('No proposal'),read:()=>assert.fail('No source lookup'),model:{name:'controlled',local:true,complete:async(_messages,schema)=>({action:'responder',args:{},answer:schema.properties.answer.enum[0]})}});
 const c=agent.memory.conversation(undefined,'user:a');c.purchaseDraft={branch:'0101',action:'crearSolicitudCompra',values:{...amounts}};agent.memory.save(c);
 const r=await agent.query('user:a',{conversationId:c.id,text:'No es ese producto; no uses el precio 80; cantidad 4 millares'},{canPlan:true});
 assert.match(r.answer,/producto/);const state=agent.memory.conversation(c.id,'user:a').purchaseDraft;
 assert.equal(state.values.product,undefined);assert.equal(state.values.price,undefined);assert.equal(state.values.quantity,'4');assert.equal(state.values.currency,'ARS');assert.ok(state.unresolvedValues.includes('price'));assert.ok(state.unresolvedReferences.includes('product'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {createIntelligence} from '../src/intelligence/agent.js';

function setup(t,{messages=[],branches=['0101'],modelReply,canRead=true,canPrepare=true}={}){
 const store=new Store(':memory:');t.after(()=>store.close());
 const calls={model:[],read:[],plan:[],authorizeRead:[],prepare:0};
 const agent=createIntelligence({store,branches,erp:{metadata:()=>({entities:{productos:{filters:{codigo:''}},proveedores:{filters:{codigo:''}}}})},kaiqen:{},
  read:async(resource)=>{calls.read.push(resource);return {data:[],meta:{hasMore:false}};},
  executeRead:async command=>{calls.read.push(command.resource);return {data:[],meta:{hasMore:false}};},
  prepareChange:async()=>{calls.prepare++;assert.fail('Supplier clarification must not prepare a proposal');},
  authorizePlan:async action=>{calls.plan.push(action);if(!canPrepare)throw Object.assign(new Error('Denied'),{code:'ACCESO_CAMBIO',status:403});},
  authorizeRead:async(resource,branch)=>{calls.authorizeRead.push([resource,branch]);if(!canRead)throw Object.assign(new Error('Denied'),{code:'LECTURA_DENEGADA',status:403});},
  model:{name:'test-local',local:true,complete:async(messages,schema)=>{calls.model.push({messages,schema});return modelReply?modelReply(messages,schema,calls.model.length):{action:'responder',args:{},answer:schema.properties.answer.enum[0]};}}
 });
 const conversation=agent.memory.conversation(undefined,'writer');conversation.messages=messages;agent.memory.save(conversation);
 return {agent,calls,conversationId:conversation.id};
}
const turn=(content,sucursal='0101')=>({role:'user',content,sucursal});

test('supplier clarification terminates on the first model answer without reading or preparing',async t=>{
 const {agent,calls}=setup(t);
 const reply=await agent.query('writer',{text:'Prepará la compra en dólares, no es con Taller Norte y no sé con quién es.'},{canPlan:true});
 assert.equal(calls.model.length,1);assert.deepEqual(calls.model[0].schema.properties.action.enum,['responder']);
 assert.equal(Object.keys(calls.model[0].schema.properties.args.properties).length,0);
 assert.match(reply.answer,/proveedor/i);assert.match(reply.answer,/[¿?]/);assert.deepEqual(reply.evidence,[]);
 assert.deepEqual(calls.read,[]);assert.equal(calls.prepare,0);
 assert.deepEqual(calls.plan,['crearPedidoCompra']);assert.deepEqual(calls.authorizeRead,[['proveedores','0101']]);
 assert.ok(calls.model[0].messages.find(message=>message.role==='system').content.length<1500,'Supplier clarification does not need the ERP tool catalogue');
});

test('supplier rejection remains effective outside ranked history and preserves the draft',async t=>{
 const messages=[turn('Prepará la compra con proveedor Taller Norte.'),turn('No es con Taller Norte y no sé con quién es.'),...Array.from({length:40},(_,i)=>turn('Seguimos revisando el detalle '+i+' '+ 'observaciones '.repeat(30)))];
 const {agent,calls,conversationId}=setup(t,{messages});
 const conversation=agent.memory.conversation(conversationId,'writer');conversation.purchaseDraft={branch:'0101',action:'crearPedidoCompra',values:{currency:'USD',product:'Z1',quantity:'3'}};agent.memory.save(conversation);
 const reply=await agent.query('writer',{text:'Retomá la compra, usá el proveedor de antes.',conversationId},{canPlan:true});
 assert.equal(calls.model.length,1);assert.deepEqual(calls.model[0].schema.properties.action.enum,['responder']);assert.deepEqual(calls.read,[]);
 assert.match(reply.answer,/proveedor/i);
 assert.deepEqual(agent.memory.conversation(conversationId,'writer').purchaseDraft.values,{currency:'USD',product:'Z1',quantity:'3'});
 const userView=calls.model[0].messages.filter(message=>message.role==='user');
 assert.ok(userView.length<messages.length,'Full history is for the guard, not sent to the model');
 assert.ok(userView.reduce((size,message)=>size+message.content.length,0)<7000);
});

test('supplier clarification preserves plan and read authorization before inference',async t=>{
 for(const options of [{canRead:false},{canPrepare:false}]){
  const {agent,calls}=setup(t,options);
  const reply=await agent.query('writer',{text:'Prepará la compra, no es con Taller Norte y no sé con quién es.'},{canPlan:true});
  assert.equal(reply.accessDenied,true);assert.equal(calls.model.length,0);assert.deepEqual(calls.read,[]);assert.equal(calls.prepare,0);
 }
});

test('supplier guard invalidates dependent references across active and paused drafts',async t=>{
 const {agent,conversationId}=setup(t);
 const conversation=agent.memory.conversation(conversationId,'writer');
 const values={party:'Taller Norte',shop:'01',list:'LN',resolvedPrice:{precio:'12'},product:'Z1',quantity:'3',currency:'USD',price:'15',priceUnit:'millar'};
 conversation.purchaseDraft={branch:'0101',action:'crearPedidoCompra',values:structuredClone(values)};
 conversation.pausedPurchase={branch:'0101',action:'crearPedidoCompra',values:structuredClone(values)};
 conversation.businessContext={branch:'0101',kind:'purchase',refs:{vendor:'Taller Norte',shop:'01',list:'LN',product:'Z1',number:'17'},pending:{price:'15',priceUnit:'millar',quantity:'3',currency:'USD'},selected:{registro:'2'},candidates:[{registro:'2'}]};
 agent.memory.save(conversation);
 await agent.query('writer',{text:'Prepará la compra en dólares, no es con Taller Norte y no sé con quién es.',conversationId},{canPlan:true});
 const saved=agent.memory.conversation(conversationId,'writer');
 for(const key of ['purchaseDraft','pausedPurchase']){
  assert.deepEqual(saved[key].values,{product:'Z1',quantity:'3',currency:'USD',price:'15',priceUnit:'millar'});
  assert.ok(saved[key].unresolvedReferences.includes('party'));
 }
 assert.deepEqual(saved.businessContext.refs,{product:'Z1',number:'17'});assert.equal(saved.businessContext.selected,undefined);assert.equal(saved.businessContext.candidates,undefined);
 assert.deepEqual(saved.businessContext.pending,{price:'15',priceUnit:'millar',quantity:'3',currency:'USD'});
 assert.ok(saved.businessContext.unresolvedReferences.includes('vendor'));
});

test('supplier clarification retains the initial explicit purchase fields without resolving the rejected party',async t=>{
 const {agent,calls}=setup(t);
 const reply=await agent.query('writer',{text:'Prepará un pedido de compra del producto Z1, 3 unidades, precio 15 dólares por unidad. No es con Taller Norte y no sé con quién es.'},{canPlan:true});
 const saved=agent.memory.conversation(reply.conversationId,'writer');
 assert.equal(saved.purchaseDraft.action,'crearPedidoCompra');assert.equal(saved.purchaseDraft.branch,'0101');
 assert.equal(saved.purchaseDraft.values.product,'Z1');assert.equal(saved.purchaseDraft.values.quantity,'3');assert.equal(saved.purchaseDraft.values.currency,'USD');
 assert.equal(saved.purchaseDraft.values.price,'15');assert.equal(saved.purchaseDraft.values.party,undefined);
 assert.ok(saved.purchaseDraft.unresolvedReferences.includes('party'));assert.deepEqual(calls.read,[]);assert.equal(calls.prepare,0);
});

test('supplier clarification resumes a paused purchase without retaining supplier dependencies',async t=>{
 const {agent,conversationId}=setup(t,{messages:[turn('Prepará un pedido de compra con proveedor Taller Norte.'),turn('No es con Taller Norte y no sé con quién es.')]});
 const conversation=agent.memory.conversation(conversationId,'writer');
 conversation.pausedPurchase={branch:'0101',action:'crearPedidoCompra',values:{party:'Taller Norte',shop:'01',list:'LN',resolvedPrice:{precio:'12'},product:'Z1',quantity:'3',currency:'USD'}};agent.memory.save(conversation);
 await agent.query('writer',{text:'Retomá el pedido de compra con el proveedor de antes.',conversationId},{canPlan:true});
 const saved=agent.memory.conversation(conversationId,'writer');
 assert.equal(saved.pausedPurchase,undefined);assert.equal(saved.purchaseDraft.action,'crearPedidoCompra');
 assert.deepEqual(saved.purchaseDraft.values,{product:'Z1',quantity:'3',currency:'USD'});assert.ok(saved.purchaseDraft.unresolvedReferences.includes('party'));
});

test('supplier clarification cannot accept an invalid model action or invented arguments',async t=>{
 for(const modelReply of [()=>({action:'consultar_erp',args:{recurso:'proveedores'},answer:'Busco'}),()=>({action:'responder',args:{proveedor:'Inventado'},answer:'¿Qué proveedor corresponde?'})]){
  const {agent,calls}=setup(t,{modelReply});
  await assert.rejects(agent.query('writer',{text:'Prepará la compra, no es con Taller Norte y no sé con quién es.'},{canPlan:true}),{code:'IA_RESPUESTA_INVALIDA'});
  assert.deepEqual(calls.read,[]);assert.equal(calls.prepare,0);assert.equal(calls.model.length,1);
 }
});

test('a pending supplier does not restrict an unrelated read turn',async t=>{
 const {agent,calls,conversationId}=setup(t,{messages:[turn('Prepará la compra, no es con Taller Norte y no sé con quién es.')],modelReply:(_messages,_schema,step)=>step===1?{action:'consultar_erp',args:{recurso:'productos',filtros:{}},answer:'Reviso'}:{action:'responder',args:{},answer:'No hay coincidencias en esta lectura.'}});
 await agent.query('writer',{text:'Necesito revisar información administrativa reciente.',conversationId},{canPlan:true});
 assert.ok(calls.model[0].schema.properties.action.enum.includes('consultar_erp'));assert.deepEqual(calls.read,['productos']);assert.deepEqual(calls.plan,[]);
});

test('another branch supplier rejection does not constrain the current purchase',async t=>{
 const {agent,calls,conversationId}=setup(t,{branches:['0101','0201'],messages:[turn('Prepará la compra, no es con Taller Norte y no sé con quién es.','0201')],modelReply:()=>({action:'responder',args:{},answer:'¿Qué documento querés preparar?'})});
 await agent.query('writer',{text:'Prepará la compra de nuevo.',conversationId,context:{sucursal:'0101'}},{canPlan:true});
 assert.ok(calls.model.length>0);assert.ok(calls.model[0].schema.properties.action.enum.includes('preparar_alta'));assert.deepEqual(calls.plan,[]);
});

test('a purchase request with optional supplier is not constrained by the supplier guard',async t=>{
 const {agent,calls,conversationId}=setup(t,{messages:[turn('Prepará la compra, no es con Taller Norte y no sé con quién es.')],modelReply:()=>({action:'responder',args:{},answer:'¿Qué producto lleva la solicitud?'})});
 const reply=await agent.query('writer',{text:'Prepará una solicitud de compra nueva.',conversationId},{canPlan:true});
 assert.ok(calls.model.every(call=>call.schema.properties.action.enum.includes('preparar_alta')));assert.ok(!calls.plan.includes('crearPedidoCompra'));assert.doesNotMatch(reply.answer,/proveedor/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceChat,markReferenceResolution} from '../src/intelligence/reference-chat.js';
import {evaluationSchema} from '../src/intelligence/evaluation.js';
import {Store} from '../src/store.js';
import {createIntelligence} from '../src/intelligence/agent.js';

function fixture(conversation={}){
 conversation.messages||=[];
 const calls=[],permissions=[],modelCalls=[];
 const options={conversation,branch:'0101',history:[],schema:evaluationSchema,singleBranch:true,metadata:{entities:{}},
  authorizeRead:async resource=>permissions.push(resource),
  read:async(resource,params)=>{calls.push({resource,filters:Object.fromEntries(params)});return {data:[],meta:{hasMore:false}};},
  model:{name:'controlled',local:true,complete:async(messages,schema)=>{modelCalls.push({messages,schema});return {action:'responder',args:{},answer:schema.properties.answer.enum[0]};}}
 };
 const query=async text=>{const result=await referenceChat({...options,text});if(result&&!result.continueIntake)markReferenceResolution(conversation,result,options.branch);options.history.push({role:'user',content:text});return result;};
 return {conversation,options,query,calls,permissions,modelCalls};
}
test('an ERP lookup failure keeps a durable barrier for pronouns and prior references',async()=>{
 const f=fixture({businessContext:{branch:'0101',kind:'product',refs:{product:'Z1'}}});
 const failed=await f.query('No es el producto Z1, es Z-INEXISTENTE');assert.equal(failed.evidence.length,2);
 for(const text of ['Mostrame ese producto','Usá el producto anterior']){
  const before=f.calls.length,result=await f.query(text);assert.equal(f.calls.length,before);assert.match(result.answer,/producto/);assert.equal(result.evidence.length,0);
 }
 f.options.read=async(resource,params)=>{f.calls.push({resource,filters:Object.fromEntries(params)});return {data:[{codigo:'Z2',nombre:'Controlado',unidadMedida:'UN'}],meta:{hasMore:false}};};
 await f.query('El producto correcto es Z2');assert.deepEqual(f.conversation.referenceValidation.byBranch['0101'].pending,{});
 assert.equal(f.conversation.businessContext.refs.product,'Z2');
});
test('failed references remain separate when switching authorized branches',async()=>{
 const f=fixture();await f.query('El producto correcto es Z-NOEXISTE');
 f.options.branch='0201';f.options.history=[];await f.query('No es ese cliente');
 assert.equal(f.conversation.referenceValidation.byBranch['0101'].pending.product,'Z-NOEXISTE');
 assert.ok(Object.hasOwn(f.conversation.referenceValidation.byBranch['0201'].pending,'customer'));
 f.options.branch='0101';f.options.history=[];const before=f.calls.length;await f.query('Mostrame ese producto');assert.equal(f.calls.length,before);
});
test('supplier price list scope and supplier/store survive an unrelated product detour',async()=>{
 const f=fixture({businessContext:{branch:'0101',kind:'supplierList',refs:{vendor:'P1',shop:'01',list:'L1'}}});
 await f.query('No es esa lista');
 f.conversation.businessContext={branch:'0101',kind:'product',refs:{product:'Z2'}};
 f.options.read=async(resource,params)=>{f.calls.push({resource,filters:Object.fromEntries(params)});return {data:resource==='listasPreciosProveedores'?[{codigo:'L2'}]:[],meta:{hasMore:false}};};
 const result=await f.query('La lista correcta es L2');
 assert.ok(result.evidence.some(e=>e.args.recurso==='listasPreciosProveedores'));assert.ok(!f.calls.some(c=>c.resource==='listasPreciosClientes'));
 assert.ok(f.calls.every(c=>c.filters.proveedor==='P1'&&c.filters.tienda==='01'));
});
test('an unknown list type asks only its scope and reuses its supplied code',async()=>{
 const f=fixture();const result=await f.query('La lista correcta es L2');assert.match(result.answer,/clientes o de proveedores/);assert.equal(f.calls.length,0);
 f.options.read=async(resource,params)=>{f.calls.push({resource,filters:Object.fromEntries(params)});return {data:resource==='listasPreciosClientes'?[{codigo:'L2'}]:[],meta:{hasMore:false}};};
 const clarified=await f.query('De clientes');assert.ok(clarified.evidence.some(e=>e.args.filtros.codigo==='L2'));assert.equal(f.conversation.businessContext.refs.list,'L2');
});
test('read permission is checked before inference or reading any correction source',async()=>{
 const f=fixture();f.options.authorizeRead=async()=>{throw Object.assign(Error('denied'),{code:'LECTURA_DENEGADA'});};
 await assert.rejects(f.query('No es ese cliente'),{code:'LECTURA_DENEGADA'});assert.equal(f.calls.length,0);assert.equal(f.modelCalls.length,0);assert.equal(f.conversation.referenceValidation,undefined);
});
test('a source cannot substitute a different exact identity during correction',async()=>{
 const f=fixture();f.options.read=async()=>({data:[{codigo:'Z-OTRO',unidadMedida:'UN'}],meta:{hasMore:false}});
 await assert.rejects(f.query('El producto correcto es Z2'),{code:'REFERENCIA_NO_VERIFICADA'});
 assert.equal(f.conversation.referenceValidation.byBranch['0101'].pending.product,'Z2');assert.equal(f.conversation.businessContext,undefined);
});
test('an interrupted commercial draft is resumed only in its authorized branch',async()=>{
 const pending={price:'80',priceUnit:'millar',quantity:'3',quantityUnit:'millares',currency:'USD'};
 const draft={branch:'0101',kind:'sale',refs:{number:'123'},unresolvedReferences:['number'],pending};
 const f=fixture({pausedBusiness:structuredClone(draft),businessContext:{branch:'0101',kind:'product',refs:{product:'Z2'}}});
 const result=await f.query('El pedido de venta correcto es 124');assert.equal(result.continueIntake,true);
 assert.equal(f.conversation.pausedBusiness,undefined);assert.equal(f.conversation.businessContext.kind,'sale');assert.deepEqual(f.conversation.businessContext.pending,pending);
 assert.equal(f.conversation.businessContext.refs.number,undefined);assert.equal(f.calls.length,0);
 const other=fixture({pausedBusiness:structuredClone(draft)});other.options.branch='0201';await other.query('El pedido de venta correcto es 124');assert.deepEqual(other.conversation.pausedBusiness,draft);
});
test('a same-number document or list in a different commercial scope cannot resolve a failed reference',()=>{
 const conversation={referenceValidation:{byBranch:{'0101':{pending:{order:'123',list:'001',customer:'C1'},scopes:{order:{orderType:'compra'},list:{listType:'supplier',party:'P1',shop:'01'},customer:{shop:'02'}}}}}};
 const evidence=(recurso,filtros,row)=>({args:{recurso,filtros},result:{data:[row],meta:{hasMore:false}}});
 markReferenceResolution(conversation,{evidence:[evidence('itemsVentas',{numero:'000123'},{numero:'000123'}),evidence('listasPreciosClientes',{codigo:'001'},{codigo:'001'}),evidence('clientes',{codigo:'C1',tienda:'01'},{codigo:'C1',tienda:'01'})]},'0101');
 assert.deepEqual(conversation.referenceValidation.byBranch['0101'].pending,{order:'123',list:'001',customer:'C1'});
 markReferenceResolution(conversation,{evidence:[evidence('compras',{numero:'000123'},{numero:'000123'}),evidence('listasPreciosProveedores',{codigo:'001',proveedor:'P1',tienda:'01'},{codigo:'001'}),evidence('clientes',{codigo:'C1',tienda:'02'},{codigo:'C1',tienda:'02'})]},'0101');
 assert.deepEqual(conversation.referenceValidation.byBranch['0101'].pending,{});
});
test('contextual price commands cannot revive a rejected product or widen an unrelated report',async()=>{
 const f=fixture({businessContext:{branch:'0101',kind:'product',refs:{product:'Z1'}}});f.options.canPlan=true;f.options.prepare=()=>assert.fail('No proposal');
 await f.query('No es el producto Z1');
 for(const text of ['Bajá el precio a 80 por millar','Subilo un 20%','Ajustá el precio a 90 pesos por unidad','Dejalo a 80 pesos por millar']){
  const before=f.calls.length,reply=await f.query(text);assert.match(reply.answer,/producto/);assert.equal(f.calls.length,before);assert.ok(!reply.continueIntake);
 }
 const report=await f.query('Prepará el informe de ventas de este mes');assert.equal(report,null);
});
test('local model outage preserves explicit draft values after invalidating the rejected product',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());
 const agent=createIntelligence({store,branches:['0101'],erp:{metadata:()=>({entities:{}})},kaiqen:{},authorizeRead:()=>{},read:()=>assert.fail('No source lookup'),model:{name:'offline',local:true,complete:async()=>{throw Object.assign(Error('offline'),{status:503,code:'IA_LOCAL_NO_DISPONIBLE'});}}});
 const c=agent.memory.conversation(undefined,'user:a');c.purchaseDraft={branch:'0101',action:'crearPedidoCompra',values:{product:'Z1',quantity:'3',quantityUnit:'millares',price:'80',priceUnit:'millar',currency:'USD'}};agent.memory.save(c);
 const result=await agent.query('user:a',{conversationId:c.id,text:'No es ese producto'});
 assert.equal(result.evidence.length,0);const values=agent.memory.conversation(c.id,'user:a').purchaseDraft.values;
 assert.deepEqual(values,{quantity:'3',quantityUnit:'millares',price:'80',priceUnit:'millar',currency:'USD'});
});

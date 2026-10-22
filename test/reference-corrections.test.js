import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceCorrections,unresolvedReference,referencePending,invalidateReferenceContext,localReferenceDecision} from '../src/intelligence/reference-corrections.js';

test('typed literal corrections distinguish entities, preservation, examples and replacements',()=>{
 for(const [kind,entity,a,b]of [['product','producto','Z1','Z2'],['customer','cliente','Acme','MILORDI'],['order','pedido','123','456'],['list','lista','001','002']]){
  for(const text of [`no es ${entity} ${a}, es ${b}`,`no es ${entity} ${a} es ${b}`,`${entity} ${b}, no es ${a}`])assert.deepEqual(referenceCorrections(text,{activeKinds:[kind],known:{[kind]:a}}),{[kind]:{rejected:true,replacement:b}},text);
  assert.deepEqual(referenceCorrections(`no uses ${entity} ${a}`,{activeKinds:['product','customer','order','list']}),{[kind]:{rejected:true}});
  assert.deepEqual(referenceCorrections(`no sé el ${entity}`),{[kind]:{rejected:true}});
  assert.deepEqual(referenceCorrections(`No cambies ${entity} ${a}`,{activeKinds:[kind]}),{});
  assert.deepEqual(referenceCorrections(`Si te digo no uses ${entity} ${a}`,{activeKinds:[kind]}),{});
  assert.deepEqual(referenceCorrections(`Mi ejemplo es "no uses ${entity} ${a}"`,{activeKinds:[kind]}),{});
  assert.deepEqual(referenceCorrections(`usá ${entity} ${b}`,{activeKinds:[kind]}),{[kind]:{rejected:false,replacement:b}});
  assert.equal(unresolvedReference(`el ${entity} anterior`,kind),true);
  assert.equal(unresolvedReference(b,kind),false);
 }
 assert.deepEqual(referenceCorrections('no uses proveedor Norte',{activeKinds:['product']}),{});
 assert.deepEqual(referenceCorrections('producto Z2, no es Z2',{activeKinds:['product'],known:{product:'Z2'}}),{product:{rejected:true}});
 assert.deepEqual(referenceCorrections('cliente Acme, no es Z1',{activeKinds:['product','customer'],known:{product:'Z1',customer:'Acme'}}),{product:{rejected:true},customer:{rejected:false,replacement:'Acme'}});
});

test('untyped supplier language cannot hijack an active product reference',()=>{
 const scope={activeKinds:['product'],known:{product:'Z1'}};
 assert.deepEqual(referenceCorrections('No es Taller Norte',scope),{});
 assert.deepEqual(referenceCorrections('Usá V72 tienda 03',scope),{});
 assert.deepEqual(referenceCorrections('No es Z1',scope),{product:{rejected:true}});
 assert.deepEqual(referenceCorrections('No es Z10',scope),{});
 assert.deepEqual(referenceCorrections('Ese no',scope),{product:{rejected:true}});
 assert.deepEqual(referenceCorrections('Prepará un pedido de compra del producto Z1, 3 millares; No es con Taller Norte y no sé con quién es.',{activeKinds:['product'],known:{}}),{});
});

test('bounded conversational corrections preserve typed literal provenance',()=>{
 for(const [kind,entity,a,b]of [['product','producto','Z1','Z2'],['customer','cliente','C1','C2'],['order','pedido','123','124'],['list','lista','001','002']]){
  const scope={activeKinds:[kind],known:{[kind]:a}};
  for(const text of [`No es el ${entity} ${a} sino ${b}`,`El ${entity} no era ${a}, era ${b}`,`No era el ${entity} ${a} era ${b}`])assert.deepEqual(referenceCorrections(text,scope),{[kind]:{rejected:true,replacement:b}},text);
  assert.deepEqual(referenceCorrections(`En realidad es el ${entity} ${b}`,scope),{[kind]:{rejected:false,replacement:b}});
  for(const text of [`No cambies el ${entity} ${a} sino el precio`,`Supongamos que no era ${entity} ${a}, era ${b}`,`Mi ejemplo es "No es el ${entity} ${a} sino ${b}"`])assert.deepEqual(referenceCorrections(text,scope),{},text);
 }
 assert.deepEqual(referenceCorrections('No es Taller Norte sino Estrella',{activeKinds:['product'],known:{product:'Z1'}}),{});
});

test('quoted identifiers are data while quoted corrections stay inert',()=>{
 const scope={activeKinds:['product'],known:{product:'Z1'}};
 assert.deepEqual(referenceCorrections('El producto correcto es "Z2"',scope),{product:{rejected:false,replacement:'Z2'}});
 assert.deepEqual(referenceCorrections('No es el producto "Z1", es «Z2»',scope),{product:{rejected:true,replacement:'Z2'}});
 assert.deepEqual(referenceCorrections('El cliente correcto es “Sin Frontera”',{activeKinds:['customer']}),{customer:{rejected:false,replacement:'Sin Frontera'}});
 for(const text of ['La frase "no uses producto Z1" no es mi orden','"no uses producto Z1"','Mi ejemplo es «descarta producto Z1»','"usá producto Z2"'])assert.deepEqual(referenceCorrections(text,scope),{},text);
});

test('pending references use user history and independent reads do not select replacements',()=>{
 const user=content=>({role:'user',content});
 const history=[user('no es producto Z1'),{role:'assistant',content:'El producto es Z2'},user('Usá el producto de antes')];
 assert.deepEqual(referencePending(history,{activeKinds:['product']}),{product:{rejected:true}});
 assert.deepEqual(referencePending([...history,user('Mostrame producto Z2')],{activeKinds:['product']}),{});
 assert.deepEqual(referencePending([...history,user('Mostrame producto Z2'),user('usá el producto anterior')],{activeKinds:['product']}),{product:{rejected:true}});
 assert.deepEqual(referencePending([...history,user('usá producto Z2'),user('usá el producto anterior')],{activeKinds:['product']}),{});
 for(const text of ['resumen de ventas del mes','stock','ventas del mes pasado'])assert.deepEqual(referencePending([...history,user(text)],{activeKinds:['product']}),{},text);
 for(const [kind,entity]of [['customer','cliente'],['order','pedido'],['list','lista']]){
  const detached=[user(`no es ${entity} ANTERIOR`),user('Mostrame producto Z2')];
  assert.deepEqual(referencePending(detached,{activeKinds:[kind]}),{},kind);
  assert.deepEqual(referencePending([...detached,user(`Usá el ${entity} de antes`)],{activeKinds:[kind]}),{[kind]:{rejected:true}},kind);
 }
});

test('invalidation removes only branch scoped dependent identities preserving explicit commercial inputs',()=>{
 const conversation={businessContext:{branch:'01',kind:'sale',refs:{customer:'C1',shop:'01',list:'L1',product:'Z1',number:'123',item:'01'},selected:{codigo:'Z1'},base:{price:'7'},pending:{price:'9',quantity:'2'}},purchaseDraft:{branch:'01',action:'crearPedidoCompra',values:{product:'Z1',party:'V1',price:'9',quantity:'2',currency:'USD',resolvedPrice:{precio:'7'}}},productJourney:{branch:'02',code:'OTHER'},reportContext:{branch:'01',filters:{producto:'Z1',cliente:'C1',tienda:'01',desde:'2026-10-01'}}};
 invalidateReferenceContext(conversation,{product:{rejected:true,replacement:'Z2'},customer:{rejected:true},order:{rejected:true}},{branch:'01'});
 assert.deepEqual(conversation.businessContext.refs,{});
 assert.deepEqual(conversation.businessContext.pending,{price:'9',quantity:'2'});
 assert.deepEqual(conversation.purchaseDraft.values,{party:'V1',price:'9',quantity:'2',currency:'USD'});
 assert.equal(conversation.reportContext,undefined);
 assert.equal(conversation.productJourney.code,'OTHER');
 assert.equal(conversation.businessContext.kind,'sale');
});

test('filter rejection cannot broaden a remembered report and respects other branches',()=>{
 const conversation={reportContext:{branch:'01',filters:{cliente:'C1',desde:'2026-10-01'}},reportDraft:{branch:'02',filters:{producto:'Z1'}},remitContext:{branch:'01',filters:{pedido:'123'}}};
 invalidateReferenceContext(conversation,{customer:{rejected:true},order:{rejected:true},product:{rejected:true}},{branch:'01'});
 assert.equal(conversation.reportContext,undefined);assert.equal(conversation.remitContext,undefined);
 assert.equal(conversation.reportDraft.filters.producto,'Z1');
});

test('legacy report drafts and customer-linked remit targets cannot resurrect rejected filters',()=>{
 const conversation={reportDraft:{resources:['resumenVentas'],filters:{cliente:'C1',desde:'2026-10-01'}},remitContext:{branch:'01',orderCode:'123',targets:[{tercero:'C1',tienda:'01',numero:'77'}]}};
 invalidateReferenceContext(conversation,{customer:{rejected:true}},{branch:'01'});
 assert.equal(conversation.reportDraft,undefined);assert.equal(conversation.remitContext,undefined);
 const other={reportDraft:{branch:'02',filters:{cliente:'C1'}},remitContext:{branch:'02',targets:[{tercero:'C1'}]}};
 invalidateReferenceContext(other,{customer:{rejected:true}},{branch:'01'});
 assert.equal(other.reportDraft.filters.cliente,'C1');assert.equal(other.remitContext.targets[0].tercero,'C1');
 const product={reportDraft:{resources:['resumenVentas'],filters:{producto:'Z1'}}};
 invalidateReferenceContext(product,{product:{rejected:true}},{branch:'01'});assert.equal(product.reportDraft,undefined);
});

test('paused business drafts invalidate typed references and derived rows while preserving edits',()=>{
 const conversation={businessContext:{branch:'01',kind:'product',refs:{product:'Z2'}},pausedBusiness:{branch:'01',kind:'sale',refs:{number:'123',item:'01',customer:'C1',shop:'01',list:'001',product:'Z1'},pending:{price:'80',priceUnit:'millar',quantity:'3',quantityUnit:'millares'},selected:{registro:'9'},base:{price:'70'},candidates:[{registro:'9'}]}};
 invalidateReferenceContext(conversation,{customer:{rejected:true},order:{rejected:true}},{branch:'01'});
 assert.deepEqual(conversation.businessContext.refs,{product:'Z2'});
 assert.deepEqual(conversation.pausedBusiness.refs,{product:'Z1'});
 assert.deepEqual(conversation.pausedBusiness.pending,{price:'80',priceUnit:'millar',quantity:'3',quantityUnit:'millares'});
 assert.deepEqual(conversation.pausedBusiness.unresolvedReferences,['customer','number']);
 for(const key of ['selected','base','candidates'])assert.equal(conversation.pausedBusiness[key],undefined);
 const other={pausedBusiness:{branch:'02',kind:'sale',refs:{number:'123'}}};
 invalidateReferenceContext(other,{order:{rejected:true}},{branch:'01'});assert.equal(other.pausedBusiness.refs.number,'123');
});

test('local decision narrows only caller compatible responder schemas',()=>{
 const schema={type:'object',properties:{action:{type:'string',enum:['responder','consultar_erp']},args:{type:'object',additionalProperties:true},answer:{type:'string'}},required:['action','args','answer'],additionalProperties:false};
 const messages=[{role:'user',content:'no es el producto Z1'},{role:'user',content:'usá el producto anterior'}];
 const result=localReferenceDecision(messages,schema,{activeKinds:['product']});
 assert.deepEqual(result.schema.properties.action.enum,['responder']);assert.equal(result.schema.properties.answer.enum.length,1);
 assert.equal(localReferenceDecision(messages,{...schema,properties:{...schema.properties,args:{type:'object',required:['producto']}}},{activeKinds:['product']}),null);
});

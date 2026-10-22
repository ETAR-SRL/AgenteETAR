import test from 'node:test';
import assert from 'node:assert/strict';
import {businessChat} from '../src/intelligence/business-chat.js';

function setup(kind='purchase'){
 const conversation={businessContext:{branch:'0101',kind,refs:{product:'Z1',...(kind==='purchase'?{number:'17'}:{})},pending:{price:'12',priceUnit:'unidad'},unresolvedReferences:['vendor']}};
 const calls={read:[],plan:[],prepare:0};
 const options={conversation,branch:'0101',actor:'writer',canPlan:true,metadata:{entities:{}},
  read:async(resource,params)=>{calls.read.push([resource,Object.fromEntries(params)]);return {data:[],meta:{hasMore:false}};},
  authorizePlan:async action=>calls.plan.push(action),prepare:async()=>{calls.prepare++;assert.fail('A pending supplier cannot prepare a proposal');}};
 return {conversation,calls,options};
}

test('anaphoric supplier choices preserve the rejection without reading or preparing',async()=>{
 for(const kind of ['purchase','supplierList'])for(const text of ['Usá el proveedor de antes','El proveedor es el anterior','Usá el proveedor nuevo','El proveedor es el mismo']){
  const {conversation,calls,options}=setup(kind);
  const result=await businessChat({...options,text});
  assert.equal(conversation.businessContext.refs.vendor,undefined,text);assert.ok(conversation.businessContext.unresolvedReferences.includes('vendor'),text);
  assert.deepEqual(conversation.businessContext.pending,{price:'12',priceUnit:'unidad'},text);assert.match(result.answer,/proveedor/);assert.deepEqual(calls.read,[],text);assert.equal(calls.prepare,0,text);
  assert.equal(calls.plan.length,1,text);
 }
});

test('an affirmative concrete supplier can replace the pending reference',async()=>{
 const {conversation,calls,options}=setup();
 await businessChat({...options,text:'Usá el proveedor Taller Sur'});
 assert.equal(conversation.businessContext.refs.vendor,'Taller Sur');assert.ok(!conversation.businessContext.unresolvedReferences.includes('vendor'));
 assert.ok(calls.read.length>0);assert.equal(calls.prepare,0);
});

test('pending supplier clarification retains the plan permission check',async()=>{
 const {calls,options}=setup();
 await assert.rejects(businessChat({...options,canPlan:false,text:'Usá el proveedor de antes'}),{code:'ROL_INSUFICIENTE'});
 assert.deepEqual(calls.read,[]);assert.equal(calls.prepare,0);
});

test('confirming a draft with an unresolved supplier cannot prepare it',async()=>{
 const {conversation,calls,options}=setup();
 const result=await businessChat({...options,text:'Confirmo'});
 assert.ok(conversation.businessContext.unresolvedReferences.includes('vendor'));assert.match(result.answer,/proveedor/);assert.deepEqual(calls.read,[]);assert.equal(calls.prepare,0);
});

test('an unrelated summary retains its original routing with a pending supplier',async()=>{
 const {conversation,calls,options}=setup();
 assert.equal(await businessChat({...options,text:'Resumen de ventas del mes'}),null);assert.equal(conversation.businessContext,undefined);assert.deepEqual(calls.read,[]);assert.deepEqual(calls.plan,[]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createExternalPrivacy} from '../src/intelligence/external-privacy.js';
import {createModelSettings} from '../src/intelligence/model-settings.js';
import {createIntelligence} from '../src/intelligence/agent.js';
import {Store} from '../src/store.js';
import {Memory} from '../src/intelligence/memory.js';

const schema={type:'object',properties:{action:{type:'string',enum:['responder']},args:{type:'object',properties:{},additionalProperties:false},answer:{type:'string'}},required:['action','args','answer'],additionalProperties:false};
const decision={action:'responder',args:{},answer:'¿Qué detalle necesitás?'};
function fixture(t,{isLocal=false}={}){
 const directory=mkdtempSync(join(tmpdir(),'etar-privacy-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));let externalCalls=0,localCalls=0;
 const manager=createModelSettings({path:join(directory,'settings.json'),local:{local:true,name:'local',complete:async()=>{localCalls++;return decision;},status:async()=>({local:true,available:true})},fetchImpl:async()=>{externalCalls++;return {ok:true,json:async()=>({status:'completed',output:[{type:'function_call',name:'structured_result',arguments:JSON.stringify(decision)}]})};}});
 if(!isLocal)manager.save({provider:'openai',model:'test-model',apiKey:'synthetic-secret'});
 const privacy=createExternalPrivacy(),model=privacy.model(manager.model);return {privacy,model,manager,get externalCalls(){return externalCalls;},get localCalls(){return localCalls;}};
}
const privateProject={id:'project-synthetic',sin_ia_externa:true,sin_ia_externa_por_cliente:false};
const publicProject={id:'project-public',sin_ia_externa:false,sin_ia_externa_por_cliente:false};

for(const project of [privateProject,{...publicProject,sin_ia_externa_por_cliente:true},{id:'unknown'},{...publicProject,sin_ia_externa:undefined}])test('restricted or unknown project never calls the external transport: '+JSON.stringify(project),async t=>{
 const f=fixture(t),conversation={messages:[]};let saved=0;
 await f.privacy.run(async()=>{f.privacy.attach(conversation,()=>saved++);f.privacy.observe({data:{project}});await assert.rejects(async()=>f.model.complete([{role:'user',content:'resumilo'}],schema),{code:'IA_EXTERNA_RESTRINGIDA'});});
 assert.equal(f.externalCalls,0);assert.equal(conversation.externalAIRestricted,true);assert.equal(saved,1);
});
test('all read methods are observed; one unknown project taints a mixed project list',async t=>{
 const f=fixture(t);
 for(const method of ['projects','project','quality','projectLink','product']){
  const wrapped=f.privacy.kaiqen({[method]:async()=>({data:method==='projects'?[publicProject,{id:'missing-flags'}]:{detail:'synthetic'}})});
  await f.privacy.run(async()=>{f.privacy.attach({messages:[]},()=>{});await wrapped[method]();await assert.rejects(async()=>f.model.complete([],schema),{code:'IA_EXTERNA_RESTRINGIDA'});});
 }
 assert.equal(f.externalCalls,0);
});
test('local inference remains permitted for restricted and unknown data',async t=>{
 const f=fixture(t,{isLocal:true});await f.privacy.run(async()=>{f.privacy.attach({messages:[]},()=>{});f.privacy.observe({data:{project:privateProject}});assert.deepEqual(await f.model.complete([],schema),decision);});assert.equal(f.externalCalls,0);assert.equal(f.localCalls,1);
});
test('only explicitly public project evidence permits external inference',async t=>{
 const f=fixture(t);await f.privacy.run(async()=>{f.privacy.attach({messages:[]},()=>{});f.privacy.observe({data:[publicProject]});assert.deepEqual(await f.model.complete([],schema),decision);});assert.equal(f.externalCalls,1);
});
test('protected persisted history blocks before any external request on the next turn',async t=>{
 const f=fixture(t);for(const conversation of [{externalAIRestricted:true,externalAIReviewed:true,messages:[]},{messages:[{role:'assistant',content:JSON.stringify({answer:'synthetic sensitive',evidence:[{action:'calidad',args:{}}]})}]},{messages:[{role:'assistant',content:JSON.stringify({evidence:[{action:'consultar_erp',args:{recurso:'proyectos'}}]})}]}]){
  await f.privacy.run(async()=>{f.privacy.attach(conversation,()=>{});await assert.rejects(async()=>f.model.complete([],schema),{code:'IA_EXTERNA_RESTRINGIDA'});});
 }
 assert.equal(f.externalCalls,0);
});
test('separate async query scopes do not share restricted data or permissions',async t=>{
 const f=fixture(t);await Promise.all([
  f.privacy.run(async()=>{f.privacy.attach({messages:[]},()=>{});f.privacy.observe({data:{project:privateProject}});await new Promise(resolve=>setTimeout(resolve,10));await assert.rejects(async()=>f.model.complete([],schema),{code:'IA_EXTERNA_RESTRINGIDA'});}),
  f.privacy.run(async()=>{f.privacy.attach({messages:[]},()=>{});f.privacy.observe({data:[publicProject]});assert.deepEqual(await f.model.complete([],schema),decision);})
 ]);assert.equal(f.externalCalls,1);
});
test('regression: generic public metadata must never override a restrictive project flag',async t=>{
 const f=fixture(t);await f.privacy.run(async()=>{f.privacy.attach({messages:[]},()=>{});f.privacy.observe({data:{project:privateProject},privacy:{externalAIAllowed:true}});await assert.rejects(async()=>f.model.complete([],schema),{code:'IA_EXTERNA_RESTRINGIDA'});});assert.equal(f.externalCalls,0);
});
test('regression: old direct attention history without provenance is unknown, not public',async t=>{
 const f=fixture(t);const conversation={messages:[{role:'user',content:'investigá este seguimiento'},{role:'assistant',content:JSON.stringify({answer:'Detalle sintético de calidad de un proyecto privado.',sucursal:'0101'})}]};
 await f.privacy.run(async()=>{f.privacy.attach(conversation,()=>{});await assert.rejects(async()=>f.model.complete([],schema),{code:'IA_EXTERNA_RESTRINGIDA'});});assert.equal(f.externalCalls,0);
});
test('agent blocks a protected historical conversation before invoking its external model',async t=>{
 const f=fixture(t),store=new Store(':memory:');t.after(()=>store.close());const memory=new Memory(store),conversation=memory.conversation(undefined,'reader:a');conversation.externalAIRestricted=true;conversation.externalAIReviewed=true;conversation.messages.push({role:'assistant',content:JSON.stringify({answer:'protected synthetic history'})});memory.save(conversation);
 const agent=createIntelligence({store,model:f.manager.model,privacy:f.privacy,branches:['0101'],erp:{metadata:()=>({entities:{}})},kaiqen:{},read:async()=>({data:[]})});
 await assert.rejects(agent.query('reader:a',{text:'¿Qué sugerís?',conversationId:conversation.id}),{code:'IA_EXTERNA_RESTRINGIDA'});assert.equal(f.externalCalls,0);
});
test('attention read taints the conversation before a follow-up can use external inference',async t=>{
 const f=fixture(t),store=new Store(':memory:');t.after(()=>store.close());const wrapped=f.privacy.kaiqen({quality:async()=>({data:{details:'synthetic restricted quality'}})});
 const agent=createIntelligence({store,model:f.manager.model,privacy:f.privacy,branches:['0101'],erp:{metadata:()=>({entities:{}})},kaiqen:{},read:async()=>({data:[]}),attentionChat:async({text})=>{if(text==='investigá el seguimiento'){await wrapped.quality();return {answer:'Detalle sintético verificado.',evidence:[],trace:[]};}return null;}});
 const first=await agent.query('reader:a',{text:'investigá el seguimiento'});assert.equal(f.externalCalls,0);await assert.rejects(agent.query('reader:a',{text:'¿Qué sugerís?',conversationId:first.conversationId}),{code:'IA_EXTERNA_RESTRINGIDA'});assert.equal(f.externalCalls,0);
});



import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createModelSettings} from '../src/intelligence/model-settings.js';
import {Memory} from '../src/intelligence/memory.js';
import {Store} from '../src/store.js';
const schema={type:'object',properties:{action:{enum:['responder']},args:{type:'object'},answer:{type:'string'}},required:['action','args','answer'],additionalProperties:false};
test('external provider validates configuration, hides secrets and uses JSON without redirects',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'central-ai-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const calls=[];
 const local={name:'local',complete:async()=>({action:'responder',args:{},answer:'local'}),status:async()=>({available:true,local:true})};
 const manager=createModelSettings({path:join(dir,'ai.json'),local,fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'responder',args:{},answer:'OK'})}}]})};}});
 assert.equal(manager.model.local,true);assert.throws(()=>manager.save({provider:'external',url:'http://example.com',model:'chosen',apiKey:'test-secret'}));
 manager.save({provider:'external',url:'https://example.com/v1',model:'chosen',apiKey:'test-secret'});assert.ok(!JSON.stringify(manager.view()).includes('test-secret'));
 const r=await manager.model.complete([{role:'user',content:'hola'}],schema);assert.equal(r.answer,'OK');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].url,'https://example.com/v1/chat/completions');assert.equal(JSON.parse(calls[0].options.body).model,'chosen');
 assert.throws(()=>manager.save({provider:'external',url:'https://other.example/v1',model:'chosen'}),{code:'IA_CLAVE_REQUERIDA'});
 manager.save({provider:'local',clearKey:true});assert.equal(manager.model.local,true);assert.ok(!readFileSync(join(dir,'ai.json'),'utf8').includes('test-secret'));
});
test('invalid external JSON cannot become a tool call and errors never echo credentials',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'central-ai-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const manager=createModelSettings({path:join(dir,'config.json'),local:{},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"action":"executeSQL","args":{},"answer":"done"}'}}]})})});
 manager.save({provider:'external',url:'https://example.com/v1',model:'chosen',apiKey:'test-secret'});await assert.rejects(manager.model.complete([],schema),e=>!e.message.includes('test-secret')&&e.code==='IA_RESPUESTA_INVALIDA');
});
test('conversation list, rename and delete isolate owners',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const m=new Memory(store),a=m.conversation(undefined,'user:a');a.messages.push({role:'user',content:'Ventas de este mes'});m.save(a);
 assert.equal(m.conversations('user:a').length,1);assert.equal(m.conversations('user:b').length,0);assert.throws(()=>m.rename('user:b',a.id,'robado'));
 m.rename('user:a',a.id,'Ventas');assert.equal(m.conversations('user:a')[0].title,'Ventas');assert.throws(()=>m.deleteConversation('user:b',a.id));assert.equal(m.deleteConversation('user:a',a.id),true);
});

test('configuration HTTP endpoints are admin-only and never return the key',async t=>{
 const {Access}=await import('../src/access.js'),{createApp}=await import('../src/app.js'),{createDemoErp,createDemoKaiqen}=await import('../src/demo.js'),{once}=await import('node:events');
 const dir=mkdtempSync(join(tmpdir(),'central-http-ai-')),store=new Store(':memory:'),access=new Access(store,['0101']);
 const login=await access.setup({username:'admin',name:'Admin',password:'Prueba-1234567890'});
 const manager=createModelSettings({path:join(dir,'settings.json'),local:{name:'local',status:async()=>({available:true,local:true}),complete:async()=>({action:'responder',args:{},answer:'OK'})}});
 const server=createApp({erp:createDemoErp(),kaiqen:createDemoKaiqen(),store,readKey:'r'.repeat(40),planKey:'p'.repeat(40),modelSettings:manager});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{server.close();server.closeAllConnections();store.close();rmSync(dir,{recursive:true,force:true});});
 const request=(path,token,method='GET',body)=>fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await request('/api/admin/ai','r'.repeat(40))).status,403);
 const r=await request('/api/admin/ai',login.token,'PUT',{provider:'external',url:'https://example.com/v1',model:'chosen',apiKey:'test-secret'});assert.equal(r.status,200);assert.ok(!(await r.text()).includes('test-secret'));
 const saved=await request('/api/admin/ai',login.token);assert.equal((await saved.json()).hasKey,true);
 const memory=new Memory(store),c=memory.conversation(undefined,login.principal.actor);c.messages.push({role:'user',content:'Ventas'});memory.save(c);
 const list=await request('/api/agent/conversations',login.token);assert.equal((await list.json()).data.length,1);
 assert.equal((await request('/api/agent/conversations/'+c.id,'r'.repeat(40),'DELETE')).status,404);
 assert.equal((await request('/api/agent/conversations/'+c.id,login.token,'PATCH',{title:'Ventas 2026'})).status,200);
 assert.equal((await request('/api/agent/conversations/'+c.id,login.token,'DELETE')).status,200);
});

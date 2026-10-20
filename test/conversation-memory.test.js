import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Memory,conversationContext} from '../src/intelligence/memory.js';
const turn=(text,branch='0101',answer='Entendido')=>[{role:'user',content:text,sucursal:branch},{role:'assistant',content:JSON.stringify({answer,sucursal:branch})}];
test('complete history survives saves, rename and reload beyond 1000 messages',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const memory=new Memory(store);let c=memory.conversation(null,'user:a:1');
 c.messages.push(...turn('El depósito para ALFA es 16'));
 for(let i=0;i<600;i++)c.messages.push(...turn('Conversación de seguimiento '+i));
 memory.save(c);memory.rename('user:a:1',c.id,'Larga');c=memory.conversation(c.id,'user:a:1');
 assert.equal(c.messages.length,1202);assert.match(c.messages[0].content,/ALFA/);
 assert.throws(()=>memory.conversation(c.id,'user:b:1'));assert.throws(()=>memory.conversation(c.id,'user:a:2'));
 memory.deleteConversation('user:a:1',c.id);assert.throws(()=>memory.conversation(c.id,'user:a:1'));
});
test('retrieves old references and corrections with bounded prompt and branch isolation',()=>{
 const c={messages:[...turn('Para el proyecto ALFA usá depósito 16'),...turn('Corrección: para ALFA el depósito es 17')]};
 for(let i=0;i<600;i++)c.messages.push(...turn('Informe distinto '+i+' '+('detalle '.repeat(90))));
 c.messages.push(...turn('ALFA depósito secreto 99','0201'));
 const start=performance.now(),context=conversationContext(c,'¿Qué depósito te pasé para ALFA?','0101');
 const texts=context.map(m=>m.content).join('');assert.match(texts,/depósito 16/);assert.match(texts,/depósito es 17/);assert.doesNotMatch(texts,/secreto/);
 assert.ok(texts.indexOf('depósito es 17')>texts.indexOf('depósito 16'));assert.ok(texts.length<=12000);
 assert.ok(performance.now()-start<1000,'retrieval is local and bounded without model calls');
});
test('legacy unscoped history requires a single authorized branch and remains readable',()=>{
 const c={messages:[{role:'user',content:'Depósito 16'},{role:'assistant',content:'Guardado'}]};
 assert.equal(conversationContext(c,'depósito','0101').length,0);
 assert.equal(conversationContext(c,'depósito','0101',{singleBranch:true}).length,2);
});

test('agent actually sends recovered older data to the model without an extra inference',async t=>{
 const {createIntelligence}=await import('../src/intelligence/agent.js');
 const store=new Store(':memory:');t.after(()=>store.close());const prompts=[];
 const agent=createIntelligence({store,branches:['0101'],erp:{metadata:()=>({entities:{productos:{}}})},kaiqen:{},read:async()=>({data:[{codigo:'ABC',nombre:'Producto ABC'}],meta:{hasMore:false}}),model:{name:'test',complete:async messages=>{prompts.push(structuredClone(messages));return prompts.length===1?{action:'buscar',args:{recurso:'productos',texto:'ABC'},answer:''}:{action:'responder',args:{},answer:'¿Usamos los datos que ya me pasaste para ALFA?'};}}});
 const c=agent.memory.conversation(null,'user:a');c.messages.push(...turn('Para ALFA el solicitante es Roberto y el depósito 16'));
 for(let i=0;i<100;i++)c.messages.push(...turn('Otro asunto '+i));agent.memory.save(c);
 await agent.query('user:a',{conversationId:c.id,text:'Ayudame con lo que te dije de ALFA'});
 assert.equal(prompts.length,2);assert.match(JSON.stringify(prompts[0]),/solicitante es Roberto/);
 assert.equal(agent.memory.conversation(c.id,'user:a').messages.length,204);
});

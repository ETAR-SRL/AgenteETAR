import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Memory,conversationContext,firstProductReference} from '../src/intelligence/memory.js';
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

test('Argentine references to the beginning retrieve the first relevant subject and later corrections',()=>{
 const c={messages:[...turn('Buenas, necesito ayuda'),...turn('Mostrame el producto Z-ANCHOR'),...turn('Mostrame el cliente C-UNO')]};
 for(let i=0;i<100;i++)c.messages.push(...turn('Mostrame el producto Z-OTRO-'+i));
 c.messages.push(...turn('Corrección del producto Z-ANCHOR: su depósito sugerido es 17'));
 for(let i=0;i<100;i++)c.messages.push(...turn('Mostrame el producto Z-NUEVO-'+i));
 c.messages.unshift(...turn('Mostrame el producto Z-OTRA-FILIAL','0201'));
 for(const text of ['El primer producto, ¿cuánto sale hoy?', 'Volvamos al producto del arranque, al principio']){
  const result=conversationContext(c,text,'0101'),encoded=JSON.stringify(result);
  assert.match(encoded,/Z-ANCHOR/);assert.match(encoded,/sugerido es 17/);assert.doesNotMatch(encoded,/Z-OTRA-FILIAL/);
  const firstProduct=result.find(m=>m.role==='user'&&m.content.includes('Z-ANCHOR'));
  assert.equal(firstProduct.content,'Mostrame el producto Z-ANCHOR');
  assert.doesNotMatch(encoded,/Z-NUEVO-|Z-OTRO-/);
  assert.ok(result.reduce((size,m)=>size+m.content.length,0)<=12000);
 }
});

test('old anaphoric corrections stay with a recovered reference instead of reviving a rejected code',()=>{
 const c={messages:[...turn('Mostrame el producto Z-UNO'),...turn('Corrección: ese código está descartado, no lo uses para el pedido.'),...turn('No, todavía no tengo el código correcto.')]};
 for(let i=0;i<100;i++)c.messages.push(...turn('Mostrame el producto Z-OTRO-'+i));
 const result=conversationContext(c,'El primer producto que vimos al principio','0101');
 const encoded=JSON.stringify(result);assert.match(encoded,/Z-UNO/);assert.match(encoded,/ese código está descartado/);assert.match(encoded,/todavía no tengo el código correcto/);
 assert.ok(result.reduce((size,m)=>size+m.content.length,0)<=12000);
});

test('first-product hint requires a unique verified SB1 identity, scope and no discarded reference',()=>{
 const verified=(codes=['Z-UNO'])=>({messages:turn('Mostrame el producto Z-UNO','0101')});
 const make=codes=>{const c=verified();c.messages[1].content=JSON.stringify({sucursal:'0101',evidence:[{args:{recurso:'productos'},identities:codes.map(codigo=>({codigo}))}]});return c;};
 const question='El primer producto que consultamos al principio';
 assert.deepEqual(firstProductReference(make(['Z-UNO']),question,'0101'),{kind:'product',code:'Z-UNO',source:'verified_historical_SB1_identity',currentValuesVerified:false});
 assert.equal(firstProductReference(verified(),question,'0101'),null);
 assert.equal(firstProductReference(make(['Z-UNO','Z-DOS']),question,'0101'),null);
 assert.equal(firstProductReference(make(['Z-UNO']),question,'0201'),null);
 const rejected=make(['Z-UNO']);rejected.messages.push(...turn('No, ese código no es, descartalo.'));assert.equal(firstProductReference(rejected,question,'0101'),null);
 const late=make(['Z-UNO']);for(let i=0;i<20;i++)late.messages.push(...turn('Otro tema '+i));late.messages.push(...turn('Corrección: Z-UNO no corresponde.'));assert.equal(firstProductReference(late,question,'0101'),null);
 assert.equal(firstProductReference(make(['Z-UNO']),'Mostrame el último producto','0101'),null);
 assert.equal(firstProductReference(make(['Z-UNO']),'No es el primer producto, quiero otro','0101'),null);
 assert.equal(firstProductReference(make(['Z-UNO']),'Descartá el primer producto','0101'),null);
 assert.equal(firstProductReference(make(['Z-UNO']),'Del primer cliente, mostrame el precio del producto que compra','0101'),null);
 const fromPrice=verified();fromPrice.messages[1].content=JSON.stringify({sucursal:'0101',evidence:[{action:'precio_venta',args:{producto:'Z-UNO'},identities:[{productoCodigo:'Z-UNO',listaCodigo:'LISTA'}]}]});
 assert.equal(firstProductReference(fromPrice,question,'0101').code,'Z-UNO');
});

test('agent actually sends recovered older data to the model without an extra inference',async t=>{
 const {createIntelligence}=await import('../src/intelligence/agent.js');
 const store=new Store(':memory:');t.after(()=>store.close());const prompts=[];
 const agent=createIntelligence({store,branches:['0101'],erp:{metadata:()=>({entities:{productos:{}}})},kaiqen:{},read:async()=>({data:[{codigo:'ABC',nombre:'Producto ABC'}],meta:{hasMore:false}}),model:{name:'test',complete:async messages=>{prompts.push(structuredClone(messages));return prompts.length===1?{action:'buscar',args:{recurso:'productos',texto:'ABC'},answer:''}:{action:'responder',args:{},answer:'¿Usamos los datos que ya me pasaste para ALFA?'};}}});
 const c=agent.memory.conversation(null,'user:a');c.messages.push(...turn('Para ALFA el solicitante es Roberto y el depósito 16'));
 for(let i=0;i<100;i++)c.messages.push(...turn('Otro asunto '+i));agent.memory.save(c);
 await agent.query('user:a',{conversationId:c.id,text:'Ayudame con lo que te dije de ALFA'});
 assert.equal(prompts.length,2);assert.match(JSON.stringify(prompts[0]),/solicitante es Roberto/);
 assert.ok(prompts[0].filter(m=>m.role!=='system').slice(0,-1).reduce((size,m)=>size+m.content.length,0)<=6000);
 assert.equal(agent.memory.conversation(c.id,'user:a').messages.length,204);
});

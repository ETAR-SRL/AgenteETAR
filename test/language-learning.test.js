import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {LanguageLearning,argentineText} from '../src/intelligence/language-learning.js';
import {createIntelligence} from '../src/intelligence/agent.js';
test('Argentine expressions become reporting queries without altering codes or amounts',()=>{
 assert.equal(argentineText('Che, tirame un pantallazo de ventas de este mes'),'mostrame un dashboard de ventas de este mes');
 assert.equal(argentineText('Cómo venimos de compras del mes pasado'),'dashboard de compras del mes pasado');
 assert.equal(argentineText('pasame los números de ventas'),'dashboard de ventas');
 assert.equal(argentineText('precio del producto UN TABLERO 500'),'precio del producto UN TABLERO 500');
 assert.equal(argentineText('Che, subime el Z1304003 a 60 dólares por millar'),'subime el Z1304003 a 60 dólares por millar');
});
test('natural corrections persist locally and stay private by actor and branch',t=>{
 const dir=mkdtempSync(join(tmpdir(),'etar-learning-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let store=new Store(join(dir,'agent.sqlite')),language=new LanguageLearning(store);
 assert.match(language.chat('user:a','Cuando digo radiografía me refiero a un dashboard','01').answer,/Aprendí/);
 assert.equal(language.interpret('user:a','mostrame una radiografía de ventas','01').text,'mostrame una dashboard de ventas');
 assert.deepEqual(language.interpret('user:b','radiografía de ventas','01').applied,[]);
 assert.deepEqual(language.interpret('user:a','radiografía de ventas','02').applied,[]);
 assert.equal(language.interpret('user:a','precio del producto radiografía','01').text,'precio del producto radiografía');
 const file=readdirSync(join(dir,'aprendizaje')).find(f=>f.endsWith('.json'));assert.ok(file);assert.equal(JSON.parse(readFileSync(join(dir,'aprendizaje',file))).expressions[0].concept,'dashboard');
 store.close();store=new Store(join(dir,'agent.sqlite'));language=new LanguageLearning(store);
 assert.equal(language.list('user:a','01').length,1);
 language.chat('user:a','No, por radiografía me refiero a un informe','01');assert.equal(language.list('user:a','01')[0].concept,'informe');
 language.chat('user:a','Olvidá radiografía','01');assert.equal(language.list('user:a','01').length,0);store.close();
});
test('only successful verified reports auto-learn supported expressions, never errors or denied reads',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const language=new LanguageLearning(store),input=language.interpret('u','tirame un paneo de ventas','01');
 language.observe('u','01',input,{accessDenied:true,evidence:[{result:{kind:'dashboard'}}]});assert.equal(language.list('u','01').length,0);
 language.observe('u','01',input,{trace:[{status:'error'}],evidence:[]});assert.equal(language.list('u','01').length,0);
 const learned=language.observe('u','01',input,{evidence:[{result:{kind:'dashboard'}}]});assert.equal(learned[0].term,'paneo');assert.equal(language.list('u','01')[0].uses,1);
 assert.equal(language.observe('u','01',input,{evidence:[{result:{kind:'dashboard'}}]}).length,0);
});
test('learned expressions cannot rewrite mutations, permissions, currencies or entity identities',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const l=new LanguageLearning(store);
 for(const term of ['confirmar','no','millar','lucas','crear pedido','borrar','precio']){l.chat('u',`cuando digo ${term} me refiero a un dashboard`,'01');assert.equal(l.list('u','01').length,0);}
 l.chat('u','cuando digo radiografia me refiero a un dashboard','01');
 assert.deepEqual(l.interpret('u','creame una radiografia de ventas','01').applied,[]);
 assert.deepEqual(l.interpret('u','necesito el producto radiografia','01').applied,[]);
 assert.equal(l.chat('u','cuando digo radiografia me refiero a desactivar permisos','01').answer.includes('Puedo aprender'),true);
 assert.equal(l.list('u','01')[0].concept,'dashboard');
});
test('chat uses colloquial dashboards without a model call, remembers corrections and retains original messages',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());let calls=0;
 const agent=createIntelligence({store,branches:['01'],erp:{metadata:()=>({entities:{}})},kaiqen:{},read:()=>assert.fail('Unexpected read'),executeRead:async()=>{calls++;return {kind:'dashboard',data:[],verifiedSummary:'Verificado'};},model:{name:'test',complete:()=>assert.fail('No model round trip expected')}});
 const first=await agent.query('u',{text:'Che, tirame un pantallazo de ventas de este mes'});assert.match(first.learningNotice,/pantallazo/);assert.equal(calls,1);assert.equal(agent.memory.conversation(first.conversationId,'u').messages[0].content,'Che, tirame un pantallazo de ventas de este mes');
 await agent.query('u',{text:'Cuando digo radiografia me refiero a un dashboard'});
 const next=await agent.query('u',{text:'mostrame una radiografia de ventas de este mes'});assert.equal(calls,2);assert.deepEqual(next.learnedExpressions,['radiografia']);
 const show=await agent.query('u',{text:'¿Qué aprendiste?'});assert.match(show.answer,/radiografia/);
});
test('a learned phrase still checks current permissions before reading or counting a successful use',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());
 const agent=createIntelligence({store,branches:['01'],erp:{metadata:()=>({entities:{}})},kaiqen:{},executeRead:async()=>{throw Object.assign(new Error('denied'),{code:'LECTURA_DENEGADA',status:403});},model:{name:'test',complete:()=>assert.fail('Must stop at denied read')}});
 await agent.query('u',{text:'Acá le decimos radiografia a un dashboard'});
 const result=await agent.query('u',{text:'mostrame una radiografia de ventas de este mes'});assert.equal(result.accessDenied,true);assert.equal(result.evidence.length,0);assert.equal(agent.language.list('u','01')[0].uses,0);assert.match(result.answer,/Esto no podés leerlo/);
});

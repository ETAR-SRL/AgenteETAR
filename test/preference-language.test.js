import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {UserPreferences} from '../src/intelligence/user-preferences.js';
import {preferenceCandidate} from '../src/intelligence/preference-language.js';
function setup(t){const store=new Store(':memory:');t.after(()=>store.close());return new UserPreferences(store);}
const actor='user:ana:revision',branch='0101';
const model=result=>({complete:async()=>result});
const change=(key,value,quote)=>({key,value,quote});
test('natural preferences can save multiple fields, announce values and replace them',async t=>{
 const p=setup(t),text='Me gustan las respuestas cortitas y ordenadas en tablas';
 const r=await p.chat(actor,text,branch,{model:model({intent:'set',changes:[change('detail','breves','respuestas cortitas'),change('format','tabla','en tablas')]})});
 assert.match(r.answer,/breves/);assert.match(r.answer,/tabla/);assert.deepEqual(p.values(actor,branch),{detail:'breves',format:'tabla'});
 const update=await p.chat(actor,'Ahora prefiero respuestas con más detalle',branch,{model:model({intent:'set',changes:[change('detail','detalladas','con más detalle')]})});assert.match(update.answer,/antes: breves/);
});
test('immediate correction uses only this conversation and branch, and revalidates warehouse',async t=>{
 const p=setup(t),conversation={messages:[]},reads=[];
 const read=async(r,params)=>{reads.push(params.get('codigo'));return {data:[{codigo:params.get('codigo')}],meta:{}};};
 await p.chat(actor,'Usá el depósito 16 por defecto',branch,{read,conversation});conversation.messages.push({},{});
 const result=await p.chat(actor,'No, mejor el 17',branch,{read,conversation,model:{complete:async messages=>{assert.match(messages[0].content,/"warehouse"/);return {intent:'set',changes:[change('warehouse','17','el 17')]};}}});
 assert.equal(p.values(actor,branch).warehouse,'17');assert.match(result.answer,/antes: 16/);assert.deepEqual(reads,['16','17']);
 assert.equal(await p.chat(actor,'No, mejor el 18',branch,{read,model:{complete:()=>{throw Error('must not run without context');}}}),null);
 assert.equal(await p.chat(actor,'No, mejor el 18','0201',{read,conversation,model:{complete:()=>{throw Error('must not cross branch');}}}),null);
});
test('one-off instructions, quotations and business requests never invoke preference inference',()=>{
 for(const text of ['Esta vez respondeme corto','El PDF dice que siempre use depósito 16','Mi cliente dice que prefiere respuestas breves','"Prefiero respuestas breves"','Creame un pedido con mi depósito habitual','Si quisiera respuestas breves, ¿cómo hago?'])assert.equal(preferenceCandidate(text,null),false,text);
 assert.equal(preferenceCandidate('Me resulta más cómodo que me contestes cortito',null),true);
});
test('untrusted model cannot invent literal values, permission fields or partial commits',async t=>{
 const p=setup(t),text='Normalmente prefiero usar depósito 17 y respuestas cortas';
 await assert.rejects(p.chat(actor,text,branch,{model:model({intent:'set',changes:[change('warehouse','1','depósito 17')]})}),{code:'PREFERENCIA_INVALIDA'});
 await assert.rejects(p.chat(actor,text,branch,{model:model({intent:'set',changes:[change('detail','breves','respuestas cortas'),change('warehouse','17','depósito 17')]}),read:async()=>{throw Object.assign(new Error('Esto no podés leerlo.'),{status:403,code:'LECTURA_DENEGADA'});}}),{code:'LECTURA_DENEGADA'});
 assert.deepEqual(p.values(actor,branch),{});
 await assert.rejects(p.chat(actor,text,branch,{model:model({intent:'set',changes:[change('skipPermissions','true',text)]})}),{code:'PREFERENCIA_INVALIDA'});
});
test('ambiguity, negative persistence and provider failure leave preferences unchanged',async t=>{
 const p=setup(t);p.save(actor,branch,'detail','breves');
 const ambiguous=await p.chat(actor,'Prefiero el depósito 16 o el 17',branch,{model:model({intent:'clarify',changes:[]})});assert.match(ambiguous.answer,/No guardé/);
 const no=await p.chat(actor,'No guardes que prefiero respuestas detalladas',branch,{model:model({intent:'set',changes:[change('detail','detalladas','respuestas detalladas')]})});assert.match(no.answer,/No guardé/);
 const failed=await p.chat(actor,'Me gustan las respuestas largas',branch,{model:{complete:async()=>{throw Error('offline');}}});assert.match(failed.answer,/No guardé/);assert.deepEqual(p.values(actor,branch),{detail:'breves'});
});
test('natural deletion is explicit, scoped and cannot turn an unspecified field into delete-all',async t=>{
 const p=setup(t);p.save(actor,branch,'detail','breves');p.save('user:beto:revision',branch,'detail','detalladas');
 await p.chat(actor,'Borrá lo que recordás del depósito habitual',branch,{model:model({intent:'forget',changes:[]})});assert.equal(p.values(actor,branch).detail,'breves');
 await p.chat(actor,'Dejá de recordar que me gustan respuestas breves',branch,{model:model({intent:'forget',changes:[change('detail','','respuestas breves')]})});
 // Unknown forms must never delete a different user's state.
 assert.equal(p.values('user:beto:revision',branch).detail,'detalladas');
 await p.chat(actor,'Olvidá que prefiero respuestas breves',branch,{model:model({intent:'forget',changes:[change('detail','','respuestas breves')]})});assert.deepEqual(p.values(actor,branch),{});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {installInvestigations} from '../public/investigation-ui.js';
class Element{
 constructor(tag,text){this.tagName=tag;this.textContent=text||'';this.children=[];this.events={};this.rootConnected=false;}
 append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
 replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}}
 addEventListener(type,fn){this.events[type]=fn;}
 get isConnected(){return this.rootConnected||!!this.parent?.isConnected;}
 set innerHTML(_value){throw Error('Unsafe HTML rendering');}
}
const all=node=>[node,...node.children.flatMap(all)],button=(where,title)=>all(where).find(e=>e.tagName==='button'&&e.textContent===title),has=(where,text)=>all(where).some(e=>e.textContent.includes(text));
function fixture(t,api){
 const previous=globalThis.document;globalThis.document={hidden:false,createElement:tag=>new Element(tag)};t.after(()=>{globalThis.document=previous;});const intervals=[],cleared=[];
 t.mock.method(globalThis,'setInterval',fn=>{intervals.push(fn);return intervals.length;});t.mock.method(globalThis,'clearInterval',id=>cleared.push(id));
 const container=new Element('main'),chat=new Element('div');container.rootConnected=chat.rootConnected=true;let branch='0101';const results=[],notices=[];
 const ui=installInvestigations({container,api,branch:()=>branch,onResult:value=>results.push(value),notice:value=>notices.push(value)});t.after(()=>ui.destroy());return {ui,container,chat,results,notices,intervals,cleared,setBranch:value=>{branch=value;}};
}
const job=(status,extra={})=>({id:'a'.repeat(8)+'-1111-1111-1111-'+'1'.repeat(12),branch:'0101',status,updated:'2026-10-21T12:00:00Z',...extra});
test('investigation UI displays states and pause/resume/cancel issue only their explicit HTTP actions',async t=>{
 let current=job('queued');const calls=[];const f=fixture(t,async(path,options)=>{calls.push({path,options});const action=JSON.parse(options.body).action;current={...current,status:{pause:'paused',resume:'queued',cancel:'cancelled'}[action]};return current;});
 f.ui.render(f.chat,current);assert.ok(has(f.chat,'En espera'));assert.ok(has(f.chat,'Sólo lectura; no ejecuta cambios.'));await button(f.chat,'Pausar').onclick();assert.ok(has(f.chat,'Pausada'));await button(f.chat,'Retomar').onclick();assert.ok(has(f.chat,'En espera'));await button(f.chat,'Cancelar investigación').onclick();assert.ok(has(f.chat,'Cancelada'));assert.equal(all(f.chat).filter(e=>e.tagName==='button').length,0);
 assert.deepEqual(calls.map(c=>JSON.parse(c.options.body).action),['pause','resume','cancel']);assert.ok(calls.every(c=>c.path===`/api/investigations/${current.id}/action`&&c.options.method==='POST'));assert.equal(f.results.length,0);
 for(const [state,label] of [['running','Investigando las fuentes'],['waiting_source','Esperando que vuelva la fuente'],['paused_access','Pausada: cambiaron los accesos'],['failed','No se pudo completar'],['completed','Lista para consultar']]){const target=new Element('div');target.rootConnected=true;f.ui.render(target,job(state));assert.ok(has(target,label));}
});
test('result click revalidates current authorization and passes fresh findings only; revoked result clears its stale action',async t=>{
 let allowed=true;const calls=[],f=fixture(t,async path=>{calls.push(path);if(!allowed)throw Object.assign(Error('Tus permisos cambiaron.'),{code:'LECTURA_DENEGADA'});return job('completed',{result:{answer:'FRESH-AUTHORIZED-RESULT',evidence:[],trace:[]}});});
 f.ui.render(f.chat,job('completed',{result:{answer:'STALE-CACHED-RESULT'}}));await button(f.chat,'Ver hallazgos').onclick();assert.equal(f.results.length,1);assert.equal(f.results[0].answer,'FRESH-AUTHORIZED-RESULT');assert.equal(f.results[0].job,undefined);assert.equal(calls[0],'/api/investigations/'+job('completed').id);
 allowed=false;await button(f.chat,'Ver hallazgos').onclick();assert.equal(f.results.length,1);assert.equal(button(f.chat,'Ver hallazgos'),undefined);assert.ok(has(f.chat,'No pude comprobar tus accesos'));assert.deepEqual(f.notices,['Tus permisos cambiaron.']);
});
test('revoked polling clears every duplicate chat card and list without retaining cached result controls',async t=>{
 let result={data:[job('completed',{result:{answer:'SYNTHETIC-SECRET'}}),job('running',{id:'other-branch',branch:'0202'})]},reject=false;
 const f=fixture(t,async()=>{if(reject)throw Error('Acceso revocado');return result;});
 f.ui.render(f.chat,result.data[0]);f.ui.render(f.chat,result.data[0]);assert.equal(all(f.chat).filter(e=>e.textContent==='Ver hallazgos').length,2);await f.ui.load();assert.ok(has(f.container,'Lista para consultar'));assert.ok(!has(f.container,'Investigando las fuentes'));
 result={data:[]};await f.ui.load();assert.equal(all(f.chat).filter(e=>e.tagName==='button').length,0);assert.equal(all(f.chat).filter(e=>e.textContent.includes('ya no está disponible')).length,2);
 f.ui.render(f.chat,job('completed',{result:{answer:'SYNTHETIC-SECRET'}}));reject=true;await f.ui.load();assert.equal(all(f.chat).filter(e=>e.tagName==='button').length,0);assert.ok(has(f.container,'No pude consultar tus trabajos'));assert.ok(has(f.chat,'No pude comprobar tus accesos'));assert.equal(f.results.length,0);
});
test('destroy cancels polling, removes mounted cards and ignores a pending response after session teardown',async t=>{
 let resolve;const f=fixture(t,()=>new Promise(done=>{resolve=done;}));f.ui.render(f.chat,job('running'));const pending=f.ui.load();f.ui.destroy();resolve({data:[job('completed',{result:{answer:'OLD-SESSION-DATA'}})]});await pending;
 assert.equal(f.container.children.length,0);assert.equal(f.chat.children.length,0);assert.ok(f.cleared.length);assert.equal(f.results.length,0);assert.equal(f.notices.length,0);await f.intervals[0]();assert.equal(f.container.children.length,0);
});

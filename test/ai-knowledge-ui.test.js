import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installApprovedKnowledgeUI} from '../public/knowledge-ui.js';
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.events={};this.style={};this.value='';this.textContent='';this.classList={remove(){},add(){}};}
 append(...items){for(const item of items){item.parent=this;this.children.push(item);if(this.tagName==='select'&&!this.value&&item.tagName==='option')this.value=item.value;}}
 replaceChildren(...items){this.children=[];this.append(...items);}
 setAttribute(k,v){this[k]=v;}
 addEventListener(type,fn){this.events[type]=fn;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
 set innerHTML(_value){throw Error('HTML injection is forbidden');}
 querySelector(){return flatten(this).find(e=>e.tagName==='button');}
 async fire(type){return this.events[type]?.({preventDefault(){},currentTarget:this});}
}
const flatten=root=>[root,...root.children.flatMap(flatten)];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('AI controls pin native destinations, clear typed keys on destination changes and send numeric budgets',async()=>{
 const ids=Object.fromEntries(['ai-provider','ai-url','ai-model','ai-key','ai-clear-key','ai-input-limit','ai-output-limit','ai-timeout-limit','ai-settings-panel','ai-settings-form','ai-settings-status','ai-settings-health','ai-settings-usage','ai-test','ai-status'].map(id=>[id,new Element('input')]));const button=new Element('button');ids['ai-settings-form'].append(button);const calls=[];
 const saved={provider:'openai',url:'https://api.openai.com/v1',model:'selected-model',hasKey:true,limits:{maxInputChars:24000,maxOutputTokens:900,timeoutMs:10000},health:{},telemetry:{requests:2,inputTokens:25,outputTokens:6}};
 const context=vm.createContext({$:selector=>ids[selector.slice(1)],Date,Number,Object,console,api:async(path,opts)=>{calls.push({path,opts});return path==='/api/agent/status'?{local:false,model:'selected-model'}:{...saved,...JSON.parse(opts?.body||'{}'),hasKey:true};}});
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),start=source.indexOf('let aiSavedSettings;'),end=source.indexOf('async function historyList()',start);vm.runInContext(source.slice(start,end),context);context.saved=saved;vm.runInContext('renderAiSettings(saved)',context);
 assert.equal(ids['ai-url'].readOnly,true);assert.equal(ids['ai-key'].required,false);assert.match(ids['ai-settings-usage'].textContent,/25 de entrada/);
 ids['ai-key'].value='do-not-forward';ids['ai-provider'].value='anthropic';ids['ai-provider'].onchange();assert.equal(ids['ai-key'].value,'');assert.equal(ids['ai-key'].required,true);assert.equal(ids['ai-url'].value,'https://api.anthropic.com/v1');assert.equal(ids['ai-url'].readOnly,true);
 ids['ai-key'].value='synthetic-new-key';await ids['ai-settings-form'].onsubmit({preventDefault(){},currentTarget:ids['ai-settings-form']});const put=calls.find(c=>c.opts?.method==='PUT'),body=JSON.parse(put.opts.body);assert.equal(body.provider,'anthropic');assert.deepEqual(body.limits,{maxInputChars:24000,maxOutputTokens:900,timeoutMs:10000});assert.equal(body.apiKey,'synthetic-new-key');assert.equal(ids['ai-key'].value,'');assert.ok(!ids['ai-settings-status'].textContent.includes('synthetic-new-key'));
 ids['ai-provider'].value='external';ids['ai-provider'].onchange();assert.equal(ids['ai-url'].readOnly,false);ids['ai-key'].value='typed';ids['ai-url'].value='https://another.example/v1';ids['ai-url'].oninput();assert.equal(ids['ai-key'].value,'');assert.equal(ids['ai-key'].required,true);
});
test('approved knowledge UI renders content as text and edits/archives using explicit current revision without model requests',async t=>{
 const oldDocument=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};t.after(()=>{globalThis.document=oldDocument;});
 const container=new Element('div'),calls=[],guide={id:'synthetic-id',revision:7,title:'<img src=x onerror=alert(1)>',text:'<script>not executable</script>',provenance:'Manual aportado',branch:'0101',requiredResources:['productos'],users:['reader'],roles:[],status:'approved',approvedAt:'2026-10-21T12:00:00Z'};
 const request=async(path,options={})=>{calls.push({path,options});if(path==='/api/capabilities')return {branches:['0101']};if(path==='/api/admin/access')return {branches:['0101'],resourceRequirements:{productos:['catalogo']},users:[{id:'reader',name:'Lector',active:1}],roles:[]};if(options.method==='POST'&&path.endsWith('/archive'))return {ok:true};if(options.method==='POST')return {...guide,...options.body,revision:8};if(path.startsWith('/api/knowledge?'))return {data:[guide]};if(path.includes('/api/knowledge/'))return guide;throw Error('Unexpected route '+path);};
 const ui=installApprovedKnowledgeUI({container,request,isAdmin:true});for(let n=0;n<4;n++)await tick();assert.ok(flatten(container).some(e=>e.textContent===guide.title));assert.ok(flatten(container).some(e=>e.textContent===guide.text));
 await flatten(container).find(e=>e.tagName==='button'&&e.textContent==='Revisar o corregir').fire('click');
 const forms=flatten(container).filter(e=>e.tagName==='form'),editor=forms[1],textField=flatten(editor).find(e=>e.tagName==='textarea');textField.value='Corrección humana explícita';await editor.fire('submit');
 const save=calls.find(c=>c.path==='/api/knowledge'&&c.options.method==='POST');assert.equal(save.options.body.revision,7);assert.equal(save.options.body.id,guide.id);assert.equal(save.options.body.status,'draft');assert.equal(save.options.body.text,'Corrección humana explícita');assert.deepEqual(save.options.body.users,['reader']);
 await flatten(container).find(e=>e.tagName==='button'&&e.textContent==='Archivar guía').fire('click');assert.deepEqual(calls.find(c=>c.path.endsWith('/archive')).options.body,{revision:7});assert.ok(calls.every(c=>!c.path.includes('/agent/chat')&&!c.path.includes('/admin/ai')));ui.destroy();assert.equal(container.children.length,0);
});

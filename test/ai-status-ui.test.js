import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/ai-status-ui.js',import.meta.url),'utf8').replaceAll('export ','');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Surface{
 listeners=new Map();
 addEventListener(name,fn){const group=this.listeners.get(name)||new Set();group.add(fn);this.listeners.set(name,group);}
 removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
 emit(name,event={}){for(const fn of [...this.listeners.get(name)||[]])fn(event);}
}
function setup(){
 const badge={textContent:''},logout=new Surface(),document=new Surface(),window=new Surface(),timers=new Map();let serial=0,actor='A',authActor='A',fail=false,status={available:true,local:true,model:'local'};const calls=[];
 document.hidden=false;document.querySelector=s=>s==='#ai-status'?badge:s==='#logout'?logout:null;
 const context={document,window,localStorage:{getItem:()=>actor},AbortController,setTimeout:(fn,delay)=>{timers.set(++serial,{fn,delay});return serial;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(source,context);
 const api=async(path,options)=>{calls.push({path,signal:options?.signal});if(fail)throw Error('offline');return path==='/api/auth/state'?{user:authActor?{actor:authActor}:null}:status;};
 return {context,document,window,logout,badge,calls,timers,api,install:options=>context.installAiStatus({api,actor:'A',...options}),tick:()=>{for(const [id,t] of timers)if(t.delay===15000){timers.delete(id);t.fn();break;}},setStatus:v=>status=v,setFail:v=>fail=v,setActor:v=>actor=v,setAuthActor:v=>authActor=v};
}

test('visible status polling recovers from model and service failures without inference',async()=>{
 const h=setup();h.install();await flush();assert.equal(h.badge.textContent,'IA local activa · local');
 h.setStatus({available:false,local:true});h.tick();await flush();assert.equal(h.badge.textContent,'Motor de IA no disponible');
 h.setFail(true);h.tick();await flush();assert.match(h.badge.textContent,/No se pudo comprobar/);
 h.setFail(false);h.setStatus({available:true,local:true,model:'recovered'});h.window.emit('online');await flush();assert.match(h.badge.textContent,/activa · recovered/);
 assert.deepEqual([...new Set(h.calls.map(c=>c.path))],['/api/agent/status','/api/auth/state']);assert.equal([...h.timers.values()].filter(t=>t.delay===15000).length,1);
});

test('hidden pages suspend polling; foreground and restored pages refresh',async()=>{
 const h=setup();h.install();await flush();const count=h.calls.length;
 h.document.hidden=true;h.document.emit('visibilitychange');h.tick();h.window.emit('online');await flush();assert.equal(h.calls.length,count);assert.equal(h.timers.size,0);
 h.document.hidden=false;h.document.emit('visibilitychange');await flush();assert.equal(h.calls.length,count+2);
 h.window.emit('pagehide');assert.equal(h.timers.size,0);h.window.emit('pageshow');await flush();assert.equal(h.calls.length,count+4);
});

test('single-flight checks discard aborted and superseded installation responses',async()=>{
 const h=setup();let resolveOld;const view=h.install({api:async path=>path==='/api/agent/status'?new Promise(resolve=>resolveOld=resolve):{user:{actor:'A'}}});
 await view.check();h.window.emit('online');h.document.emit('visibilitychange');assert.equal([...h.timers.values()].filter(t=>t.delay===10000).length,1);
 h.install();await flush();assert.equal(h.badge.textContent,'IA local activa · local');
 resolveOld({available:true,local:true,model:'obsolete'});await flush();assert.equal(h.badge.textContent,'IA local activa · local');assert.equal([...h.timers.values()].filter(t=>t.delay===15000).length,1);assert.equal(h.window.listeners.get('online').size,1);
});

test('session changes during requests cannot publish another actor status',async()=>{
 const h=setup();let changed=0;h.setAuthActor('B');h.install({onSessionChanged:()=>changed++});await flush();assert.equal(changed,1);assert.match(h.badge.textContent,/Sesión cambiada/);assert.equal(h.timers.size,0);
 const q=setup();let resolveStatus;q.install({api:async path=>path==='/api/agent/status'?new Promise(resolve=>resolveStatus=resolve):{user:{actor:'A'}}});q.setActor('B');resolveStatus({available:true,local:true,model:'other'});await flush();assert.match(q.badge.textContent,/Sesión cambiada/);assert(!q.badge.textContent.includes('other'));
});

test('cross-tab actor changes and logout stop listeners and discard late responses',async()=>{
 for(const action of ['storage','logout']){
  const h=setup();let finish;h.install({api:async()=>new Promise(resolve=>finish=resolve)});const signal=[...h.timers.values()];assert.equal(signal.length,1);
  if(action==='storage')h.window.emit('storage',{key:'central-access-actor',newValue:'B'});else h.logout.emit('click');
  finish({available:true,local:true,model:'obsolete'});await flush();assert(!h.badge.textContent.includes('obsolete'));assert.equal(h.timers.size,0);assert.equal(h.window.listeners.get('online').size,0);
 }
});

test('external configuration remains unverified until the server confirms a successful response',()=>{
 const h=setup();assert.match(h.context.aiStatusText({available:true,local:false,model:'external',connectionVerified:false}),/configurada, sin verificar/);
 assert.match(h.context.aiStatusText({available:true,local:false,model:'external',connectionVerified:true}),/externa verificada/);
 assert.equal(h.context.aiStatusText({available:false,local:false}),'Motor de IA no disponible');
 assert(!h.context.aiStatusText({available:true}).includes('local'));
});

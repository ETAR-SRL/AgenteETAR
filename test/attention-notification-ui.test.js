import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/notifications-ui.js',import.meta.url),'utf8').replaceAll('export ','');
const tick=()=>new Promise(r=>setImmediate(r));
function ui({permission='default',supported=true}={}){
 const button={setAttribute(){}},status={},requests=[],memory=new Map(),notices=[];let prompts=0,unsubscribed=0,closed=0,subscription=null,offline=false;
 const sub={toJSON:()=>({endpoint:'test'}),unsubscribe:async()=>{unsubscribed++;subscription=null;}},reg={pushManager:{getSubscription:async()=>subscription,subscribe:async()=>{subscription=sub;return sub;}},getNotifications:async()=>[{tag:'central-follow-test',close:()=>{closed++;}}]};
 const context={AbortSignal,Uint8Array,atob,Notification:{permission,requestPermission:async()=>{prompts++;return permission==='default'?'granted':permission;}},navigator:supported?{serviceWorker:{ready:Promise.resolve(reg),getRegistration:async()=>reg}}:{},window:{isSecureContext:true,Notification:{},PushManager:{}},document:{querySelector:s=>s==='#attention-notifications'?button:status,addEventListener(){}},localStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},fetch:async(path,options)=>{requests.push({path,options});if(offline)throw new Error('Network unavailable');return {ok:true,json:async()=>path.endsWith('/subscribe')?{id:'test-sub'}:{enabled:true}};}};
 vm.runInNewContext(source,context);const api=async()=>({available:true,publicKey:Buffer.alloc(65,1).toString('base64url')}),controls=context.installNotifications({api,notice:t=>notices.push(t)});
 return {button,status,requests,memory,notices,check:controls.check,offline:value=>{offline=value;context.Notification.permission='granted';},prompts:()=>prompts,unsubscribed:()=>unsubscribed,closed:()=>closed,stop:()=>context.stopNotifications()};
}
test('notification permission is never requested on load; explicit opt in registers once; logout unsubscribes and closes notices',async()=>{
 const w=ui();await tick();assert.equal(w.prompts(),0);assert.match(w.button.textContent,/Activar/);await w.button.onclick();assert.equal(w.prompts(),1);assert.ok(w.requests.some(r=>r.path.endsWith('/subscribe')));assert.equal(w.button.textContent,'Desactivar notificaciones');assert.ok(w.memory.has('central-push'));
 await w.stop();assert.equal(w.unsubscribed(),1);assert.equal(w.closed(),1);assert.equal(w.memory.size,0);assert.ok(w.requests.some(r=>r.path.endsWith('/disable')));
});
test('blocked permission does not subscribe; unsupported browser explains availability without prompting',async()=>{
 const denied=ui({permission:'denied'});await tick();await denied.button.onclick();assert.equal(denied.requests.length,0);assert.match(denied.status.textContent,/bloqueó/);
 const unsupported=ui({supported:false});await tick();assert.equal(unsupported.button.disabled,true);assert.equal(unsupported.prompts(),0);assert.match(unsupported.status.textContent,/no admite/);
});
test('a temporary network failure preserves the opt-in and subscription for recovery',async()=>{
 const w=ui();await tick();await w.button.onclick();w.offline(true);await w.check();assert.equal(w.unsubscribed(),0);assert.ok(w.memory.has('central-push'));assert.match(w.status.textContent,/conexión/);assert.equal(w.button.textContent,'Desactivar notificaciones');w.offline(false);await w.check();assert.equal(w.button.textContent,'Desactivar notificaciones');assert.equal(w.prompts(),1);
});

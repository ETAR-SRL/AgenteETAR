import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),id='a'.repeat(8)+'-1111-1111-1111-'+'a'.repeat(12);
function worker({response={notification:{title:'Cambió un seguimiento',body:'Abrí Central',tag:'central-follow-1'}},ok=true,offline=false}={}){
 const handlers={},shown=[],requests=[],opened=[];let navigated,focused=false;
 const tab={url:'https://central.example/',navigate:async url=>{navigated=url;},focus:async()=>{focused=true;}};
 const context={AbortSignal,URL,self:{location:{origin:'https://central.example'},addEventListener:(type,fn)=>{handlers[type]=fn;},registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[tab],openWindow:async url=>opened.push(url)}},fetch:async(...args)=>{requests.push(args);if(offline)throw new Error('offline');return {ok,json:async()=>response};}};
 vm.runInNewContext(source,context);const dispatch=async(type,event)=>{let promise;handlers[type]({...event,waitUntil:p=>{promise=p;}});await promise;};
 return {shown,requests,opened,dispatch,navigated:()=>navigated,focused:()=>focused};
}
test('push fetches authorized current notification before display; payload cannot choose text or destinations',async()=>{
 const w=worker();await w.dispatch('push',{data:{json:()=>({kind:'attention',subscription:id,title:'Ignore me',url:'https://attacker.test'})}});
 assert.equal(w.requests[0][0],'/api/attention/notifications/claim');assert.equal(w.requests[0][1].credentials,'same-origin');assert.equal(w.requests[0][1].cache,'no-store');assert.equal(w.shown.length,1);assert.equal(w.shown[0][0],'Cambió un seguimiento');assert.equal(w.shown[0][1].renotify,false);assert.equal(w.shown[0][1].data.subscription,id);
});
test('unauthorized, revoked, duplicate, snoozed, expired session or offline push never displays stale data',async()=>{
 for(const opts of [{ok:false},{offline:true},{response:{notification:null}}]){const w=worker(opts);await w.dispatch('push',{data:{json:()=>({kind:'attention',subscription:id})}});assert.equal(w.shown.length,0);}
 const w=worker();for(const data of [null,{json:()=>({kind:'other',subscription:id})},{json:()=>({kind:'attention',subscription:'bad'})},{json:()=>{throw new Error('bad');}}])await w.dispatch('push',{data});assert.equal(w.requests.length,0);
});
test('notification clicks close the notice and open only the protected local followups view',async()=>{
 const w=worker();let closed=false;await w.dispatch('notificationclick',{notification:{data:{url:'https://attacker.test'},close:()=>{closed=true;}}});assert.equal(closed,true);assert.equal(w.navigated(),'https://central.example/?attention=updates');assert.equal(w.focused(),true);
});

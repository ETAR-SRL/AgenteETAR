import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createECDH,randomBytes} from 'node:crypto';
import webpush from 'web-push';
import {Store} from '../src/store.js';
import {AttentionStore} from '../src/attention-store.js';
import {createAttentionNotifications,validateSubscription} from '../src/attention-notifications.js';
const origin='https://central.example',sub=(suffix='a')=>({endpoint:'https://fcm.googleapis.com/fcm/send/'+suffix,keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}});
function fixture(t,path=':memory:'){
 const store=new Store(path);t.after(()=>store.close());let date=new Date('2026-10-21T15:00:00Z'),clock=()=>date;
 let p={userId:'a',revision:'v1',branches:['0101'],permissions:['read:ventas','read:clientes','read:preciosVenta','read:catalogo']};const users=new Map([['a',p],['b',{...p,userId:'b'}]]),db=new AttentionStore(store,{clock}),sends=[];let failure;
 const create=()=>createAttentionNotifications({attention:{db},principal:()=>p,user:id=>users.get(id),clock,send:async(s,payload,options)=>{sends.push({s,payload,options});if(failure)throw failure;}});
 const push=create();t.after(()=>push.stop());
 const item=db.upsert('a',{key:'sale:1',branch:'0101',kind:'sale',target:{numero:'123'},snapshot:{cantidad:'1000',goalComplete:false}});db.follow('a',item.id,'attention_recorded');
 const change=(amount='500')=>db.upsert('a',{key:'sale:1',branch:'0101',kind:'sale',target:{numero:'123'},snapshot:{cantidad:amount,goalComplete:amount==='0'},status:amount==='0'?'resolved':'active'});
 return {store,db,item,push,create,sends,users,change,advance:ms=>{date=new Date(+date+ms);},as:value=>{p=value;},fail:value=>{failure=value;},p};
}
test('opt in starts at current event; repeat subscription preserves cursor and duplicate pushes/claims collapse',async t=>{
 const f=fixture(t);f.change('800');await f.push.run();assert.equal(f.sends.length,0);
 const a=f.push.subscribe(sub(),origin);assert.equal(f.push.claim(a.id,origin).notification,null);const key=f.push.settings().publicKey;
 f.change();assert.equal(f.push.subscribe(sub(),origin).id,a.id);await Promise.all([f.push.run(),f.push.run()]);assert.equal(f.sends.length,1);
 const payload=JSON.parse(f.sends[0].payload);assert.deepEqual(payload,{kind:'attention',subscription:a.id});assert.equal(f.sends[0].options.TTL,300);assert.ok(!f.sends[0].payload.includes('123'));
 const n=f.push.claim(a.id,origin).notification;assert.match(n.title,/Cambió/);assert.equal(f.push.claim(a.id,origin).notification,null);
 const other=f.create();assert.equal(other.settings().publicKey,key);assert.equal(other.claim(a.id,origin).notification,null);await other.stop();
 f.advance(300001);await f.push.run();assert.equal(f.sends.length,1);f.change('0');f.db.finish('a',f.item.id,'completed');
 const done=f.push.claim(a.id,origin).notification;assert.match(done.title,/cumplió/);assert.equal(f.push.claim(a.id,origin).notification,null);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM op_push_deliveries').get().n,2);
});
test('only followed changes and goals notify; outages, seen, cancelled and hidden situations do not',async t=>{
 const f=fixture(t),a=f.push.subscribe(sub(),origin);f.db.unavailable('a',f.item.id);assert.equal(f.push.claim(a.id,origin).notification,null);
 f.change();f.db.preference('a',f.item.id,{mode:'dismissed'});assert.equal(f.push.claim(a.id,origin).notification,null);
 f.db.preference('a',f.item.id,{mode:'snoozed',until:'2026-10-22T15:00:00.000Z'});assert.equal(f.push.claim(a.id,origin).notification,null);
 f.advance(86400001);assert.ok(f.push.claim(a.id,origin).notification);f.change('400');f.db.seen('a',f.item.id);assert.equal(f.push.claim(a.id,origin).notification,null);
 f.change('300');f.db.unavailable('a',f.item.id);assert.equal(f.push.claim(a.id,origin).notification,null);f.change('300');assert.ok(f.push.claim(a.id,origin).notification);
 f.change('200');f.db.finish('a',f.item.id,'cancelled');assert.equal(f.push.claim(a.id,origin).notification,null);f.db.follow('a',f.item.id,'attention_recorded');assert.equal(f.push.claim(a.id,origin).notification,null);
 f.db.upsert('a',{key:'sale:2',branch:'0101',kind:'sale',target:{},snapshot:{x:1}});f.db.upsert('a',{key:'sale:2',branch:'0101',kind:'sale',target:{},snapshot:{x:2}});assert.equal(f.push.claim(a.id,origin).notification,null);
});
test('on-change dismissal wakes only after a real change; disabling and re-enabling does not replay history',t=>{
 const f=fixture(t),a=f.push.subscribe(sub(),origin);f.db.preference('a',f.item.id,{mode:'dismissed',onChange:true});assert.equal(f.push.claim(a.id,origin).notification,null);f.change();assert.ok(f.push.claim(a.id,origin).notification);
 f.push.disable(a.id,origin);f.change('200');assert.equal(f.push.claim(a.id,origin).notification,null);const b=f.push.subscribe(sub(),origin);assert.equal(a.id,b.id);assert.equal(f.push.claim(a.id,origin).notification,null);
});
test('ownership, origins, current role and branch permissions are rechecked before sending and claiming',async t=>{
 const f=fixture(t),a=f.push.subscribe(sub(),origin);f.change();f.as(f.users.get('b'));assert.throws(()=>f.push.claim(a.id,origin),{status:404});assert.throws(()=>f.push.disable(a.id,origin),{status:404});assert.throws(()=>f.push.subscribe(sub(),origin),{status:409});
 f.as(f.p);assert.throws(()=>f.push.claim(a.id,'https://other.example'),{status:404});
 f.p.permissions=[];assert.equal(f.push.claim(a.id,origin).notification,null);await f.push.run();assert.equal(f.sends.length,0);
 f.p.permissions=['read:ventas','read:clientes','read:preciosVenta','read:catalogo'];f.p.branches=['0201'];assert.equal(f.push.claim(a.id,origin).notification,null);
 f.p.branches=['0101'];f.users.set('a',{...f.p,revision:'v2'});f.as(f.users.get('a'));assert.equal(f.push.status(a.id,origin).enabled,false);f.advance(60001);await f.push.run();assert.equal(f.sends.length,0);assert.equal(f.push.claim(a.id,origin).notification,null);
});
test('delivery reservations and receipts survive reopening SQLite; no duplicate between server instances',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'etar-push-'));assert.ok(folder.startsWith(join(tmpdir(),'etar-push-')));const f=fixture(t,join(folder,'test.sqlite')),a=f.push.subscribe(sub(),origin);f.change();await f.push.run();
 const store2=new Store(join(folder,'test.sqlite'));t.after(()=>store2.close());const second=createAttentionNotifications({attention:{db:new AttentionStore(store2)},principal:()=>f.p,user:()=>f.p,clock:()=>new Date('2026-10-21T15:00:01Z'),send:async()=>assert.fail('Duplicate send')});
 await second.run();assert.ok(second.claim(a.id,origin).notification);assert.equal(f.push.claim(a.id,origin).notification,null);await second.stop();t.after(()=>rmSync(folder,{recursive:true,force:true}));
});
test('push failures back off, expire subscriptions and never resolve an ERP objective',async t=>{
 const f=fixture(t),a=f.push.subscribe(sub(),origin);f.change();f.fail({statusCode:503});await f.push.run();await f.push.run();assert.equal(f.sends.length,1);f.advance(60001);await f.push.run();assert.equal(f.sends.length,2);f.advance(120001);f.fail({statusCode:410});await f.push.run();assert.equal(f.push.status(a.id,origin).enabled,false);assert.equal(f.db.get('a',f.item.id).follow_state,'active');
});
test('no notification privileges for service keys and no arbitrary endpoints or invalid encryption keys',t=>{
 const f=fixture(t);f.as({unrestricted:true});assert.throws(()=>f.push.settings(),{status:403});
 for(const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.attacker.test/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a','https://attacker.test/a','not a URL'])assert.throws(()=>validateSubscription({...sub(),endpoint}),{status:400});
 assert.throws(()=>validateSubscription({...sub(),keys:{auth:'bad',p256dh:'bad'}}),{status:400});assert.deepEqual(validateSubscription(sub()),sub());
});
test('the installed Web Push transport signs VAPID and encrypts the opaque wake-up payload without a network call',()=>{
 const ecdh=createECDH('prime256v1');ecdh.generateKeys();const subscription={...sub(),keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}},payload=JSON.stringify({kind:'attention',subscription:'opaque-id'});
 const request=webpush.generateRequestDetails(subscription,payload,{TTL:300,topic:'central-attention',vapidDetails:{subject:'https://github.com/ETAR-SRL/AgenteETAR',...webpush.generateVAPIDKeys()}});
 assert.equal(request.method,'POST');assert.equal(request.headers['Content-Encoding'],'aes128gcm');assert.match(request.headers.Authorization,/vapid /);assert.equal(request.body.includes(Buffer.from(payload)),false);
});

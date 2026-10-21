import test from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {createInvestigationJobs} from '../src/investigation-jobs.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(t,path=':memory:'){
 const store=new Store(path),stores=[store],services=[],ctx=new AsyncLocalStorage();let time=Date.parse('2026-10-21T15:00:00Z'),invocations=0,handler;
 const people=new Map(['a','b'].map(id=>[id,{userId:id,actor:'user:'+id,revision:'r1',allowed:true}])),cards=new Map([['A',{id:'A',branch:'0101',owner:'a',status:'active',caseState:'open'}],['B',{id:'B',branch:'0101',owner:'b',status:'active',caseState:'open'}]]);
 const principal=()=>people.get(ctx.getStore()),runAs=async(id,fn)=>ctx.run(id,fn),attention={get:id=>{const p=principal(),item=cards.get(id);assert(p?.allowed,Object.assign(new Error('denied'),{status:403,code:'LECTURA_DENEGADA'}));assert(item?.owner===p.userId,Object.assign(new Error('missing'),{status:404,code:'AVISO_NO_EXISTE'}));return {...item};}};
 const success=id=>({answer:'Hechos verificados',attention:{data:[attention.get(id)]},investigation:{facts:['Dato público'],possibleCauses:[],unavailable:[]}});
 const make=(target=store)=>{const jobs=createInvestigationJobs({store:target,attention,principal,user:id=>people.get(id),runAs,clock:()=>new Date(time),investigate:async(id,branch,options)=>{invocations++;assert.equal(principal()?.userId,cards.get(id).owner);return handler?handler(id,branch,options):success(id);}});services.push(jobs);return jobs;};const jobs=make();
 t.after(async()=>{for(const job of services)await job.stop();for(const database of stores)database.close();});
 return {store,jobs,people,cards,run:fn=>runAs('a',fn),as:runAs,make,reopen:()=>{const other=new Store(path);stores.push(other);return make(other);},advance:ms=>time+=ms,setHandler:fn=>handler=fn,calls:()=>invocations,success};
}
test('personal queue deduplicates active requests and completes using owner context',async t=>{
 const f=fixture(t),job=await f.run(()=>f.jobs.create('A','0101')),same=await f.run(()=>f.jobs.create('A','0101'));assert.equal(job.id,same.id);const a=f.jobs.run(),b=f.jobs.run();assert.equal(a,b);await a;const result=await f.run(()=>f.jobs.get(job.id));assert.equal(result.status,'completed');assert.equal(result.result.background,true);assert.equal(result.result.attention.data[0].id,'A');assert.equal(f.calls(),1);
});
test('another user cannot inspect, act on or list a job and branch selection is checked',async t=>{
 const f=fixture(t),job=await f.run(()=>f.jobs.create('A','0101'));await assert.rejects(()=>f.as('b',()=>f.jobs.get(job.id)),{status:404});await assert.rejects(()=>f.as('b',()=>f.jobs.act(job.id,'cancel')),{status:404});assert.equal((await f.as('b',()=>f.jobs.list())).data.length,0);await assert.rejects(()=>f.run(()=>f.jobs.create('A','9999')),{status:403});
});
test('separate workers respect a durable running lease and recover only after expiry',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'etar-jobs-')),path=join(folder,'jobs.sqlite'),f=fixture(t,path);t.after(()=>rmSync(folder,{recursive:true,force:true}));const job=await f.run(()=>f.jobs.create('A','0101'));
 f.store.db.prepare("UPDATE investigation_jobs SET status='running',token='crashed',lease_until=? WHERE id=?").run('2026-10-21T15:05:00.000Z',job.id);const restarted=f.reopen();await restarted.run();assert.equal(f.calls(),0);f.advance(300001);await restarted.run();assert.equal(f.calls(),1);assert.equal((await f.run(()=>restarted.get(job.id))).status,'completed');
});
test('two workers cannot execute the same running investigation concurrently',async t=>{
 const f=fixture(t),job=await f.run(()=>f.jobs.create('A','0101')),started=deferred(),release=deferred();f.setHandler(async(id,branch,{check})=>{started.resolve();await release.promise;check();return f.success(id);});const other=f.make(),first=f.jobs.run();await started.promise;await other.run();assert.equal(f.calls(),1);release.resolve();await first;assert.equal((await f.run(()=>f.jobs.get(job.id))).status,'completed');
});
test('pause and resume persist, while cancellation during IO prevents completing the job',async t=>{
 const f=fixture(t),job=await f.run(()=>f.jobs.create('A','0101'));await f.run(()=>f.jobs.act(job.id,'pause'));await f.jobs.run();assert.equal(f.calls(),0);await f.run(()=>f.jobs.act(job.id,'resume'));
 const started=deferred(),release=deferred();f.setHandler(async(id,branch,{check})=>{started.resolve();await release.promise;check();return f.success(id);});const running=f.jobs.run();await started.promise;await f.run(()=>f.jobs.act(job.id,'cancel'));release.resolve();await running;const final=await f.run(()=>f.jobs.get(job.id));assert.equal(final.status,'cancelled');assert.equal(final.result,undefined);await assert.rejects(()=>f.run(()=>f.jobs.act(job.id,'resume')),{status:409});
});
test('revoked users pause before reads, changed revision hides stored results and revocation during IO stops publication',async t=>{
 const f=fixture(t),job=await f.run(()=>f.jobs.create('A','0101'));f.people.set('a',{...f.people.get('a'),revision:'r2'});await f.jobs.run();assert.equal(f.calls(),0);assert.equal((await f.run(()=>f.jobs.get(job.id))).status,'paused_access');await f.run(()=>f.jobs.act(job.id,'resume'));
 const started=deferred(),release=deferred();f.setHandler(async(id,branch,{check})=>{started.resolve();await release.promise;check();return f.success(id);});const running=f.jobs.run();await started.promise;f.people.set('a',{...f.people.get('a'),revision:'r3'});release.resolve();await running;const result=await f.run(()=>f.jobs.get(job.id));assert.equal(result.status,'paused_access');assert.equal(result.result,undefined);
});
test('unknown or empty source results never complete and retry only after the persisted delay',async t=>{
 const f=fixture(t),job=await f.run(()=>f.jobs.create('A','0101'));f.setHandler(async()=>({attention:{data:[{id:'A',branch:'0101',status:'unknown'}]}}));await f.jobs.run();let result=await f.run(()=>f.jobs.get(job.id));assert.equal(result.status,'waiting_source');assert.equal(result.result,undefined);await f.jobs.run();assert.equal(f.calls(),1);f.advance(15001);f.setHandler(async()=>undefined);await f.jobs.run();assert.equal((await f.run(()=>f.jobs.get(job.id))).status,'waiting_source');assert.equal(f.calls(),2);
});
test('case pause prevents investigation without changing the operational document state',async t=>{
 const f=fixture(t),job=await f.run(()=>f.jobs.create('A','0101'));f.cards.get('A').caseState='paused';await f.jobs.run();assert.equal(f.calls(),0);assert.equal((await f.run(()=>f.jobs.get(job.id))).status,'paused');assert.equal(f.cards.get('A').status,'active');
});

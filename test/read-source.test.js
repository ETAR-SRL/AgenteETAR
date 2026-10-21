import test from 'node:test';
test('PostgreSQL never advertises derived quality, including before lazy adapter construction',async()=>{
 const source=createReadSource({source:'postgres',factory:()=>({computedQuality:false,projects:async()=>({data:[]})})});
 assert.equal(source.computedQuality,false);await source.run();assert.equal(source.computedQuality,false);await source.close();
});
import assert from 'node:assert/strict';
import {createReadSource} from '../src/read-source.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(t,options={}){let time=Date.parse('2026-10-21T15:00:00Z');const states=[],source=createReadSource({clock:()=>new Date(time),onState:s=>states.push(s),...options});t.after(()=>source.close());return {source,states,advance:ms=>time+=ms};}
test('unconfigured source never invokes factory or returns empty results',async t=>{
 let calls=0;const f=fixture(t,{configured:false,factory:()=>calls++});await f.source.run();assert.equal(calls,0);assert.equal(f.source.status().state,'not_configured');await assert.rejects(()=>f.source.projects(),{code:'KAIQEN_NOT_CONFIGURED'});
});
test('synchronous configuration failure is isolated and factory retries back off on every failure',async t=>{
 let attempts=0;const f=fixture(t,{factory:()=>{attempts++;throw new Error('bad config');}});await f.source.run();assert.equal(attempts,1);assert.equal(f.source.status().failures,1);f.advance(4999);await f.source.run();assert.equal(attempts,1);f.advance(1);await f.source.run();assert.equal(attempts,2);assert.equal(f.source.status().failures,2);f.advance(9999);await f.source.run();assert.equal(attempts,2);f.advance(1);await f.source.run();assert.equal(attempts,3);assert.equal(f.source.status().failures,3);
});
test('factory recovery performs a real probe and preserves adapter data',async t=>{
 let ready=false;const f=fixture(t,{factory:()=>{if(!ready)throw new Error();return {projects:async()=>({data:[{id:'P1'}]})};}});await f.source.run();ready=true;f.advance(5000);await f.source.run();assert.equal(f.source.status().available,true);assert.equal(f.source.status().failures,0);assert.deepEqual((await f.source.projects()).data,[{id:'P1'}]);assert.equal(f.states.at(-1).state,'available');
});
test('source outage rejects without fallback, respects retry and recovers independently',async t=>{
 let offline=false;const f=fixture(t,{factory:()=>({projects:async()=>{if(offline)throw new Error('offline');return {data:[1]};}})});await f.source.run();offline=true;await assert.rejects(()=>f.source.projects(),{code:'KAIQEN_SOURCE_UNAVAILABLE'});assert.equal(f.source.status().available,false);await assert.rejects(()=>f.source.projects(),{code:'KAIQEN_SOURCE_UNAVAILABLE'});offline=false;f.advance(5000);await f.source.run();assert.equal(f.source.status().available,true);
});
test('inflight stale response cannot undo a later successful recovery',async t=>{
 const slow=deferred();let mode='normal';const f=fixture(t,{factory:()=>({projects:async()=>({data:[]}),project:async()=>{if(mode==='slow')return slow.promise;throw new Error('outage');}})});await f.source.run();mode='slow';const pending=f.source.project('A');const rejected=assert.rejects(pending,{code:'KAIQEN_STALE'});mode='fail';await assert.rejects(()=>f.source.project('B'));f.advance(5000);await f.source.run();assert.equal(f.source.status().available,true);const failures=f.source.status().failures;slow.resolve({data:{id:'A'}});await rejected;assert.equal(f.source.status().available,true);assert.equal(f.source.status().failures,failures);
});
test('concurrency limit rejects excess requests without marking source unavailable',async t=>{
 const slow=deferred();const f=fixture(t,{maxConcurrent:1,factory:()=>({projects:async()=>({data:[]}),project:async()=>slow.promise})});await f.source.run();const pending=f.source.project('A');await assert.rejects(()=>f.source.project('B'),{code:'KAIQEN_BUSY'});assert.equal(f.source.status().available,true);slow.resolve({data:{id:'A'}});await pending;
});
test('run shares a probe and close waits for it while preventing publication after shutdown',async t=>{
 const slow=deferred();let closes=0;const f=fixture(t,{factory:()=>({projects:async()=>slow.promise,close:async()=>closes++})});const a=f.source.run(),b=f.source.run();assert.equal(a,b);const close=f.source.close();slow.resolve({data:[]});await close;assert.equal(closes,1);assert.equal(f.source.status().state,'stopped');assert.equal(f.source.status().available,false);await assert.rejects(()=>f.source.projects());
});
test('an old inflight rejection cannot overwrite a newer recovered epoch',async t=>{
 const slow=deferred();let first=true;const f=fixture(t,{factory:()=>({projects:async()=>({data:[]}),project:async()=>{if(first){first=false;return slow.promise;}throw new Error('outage');}})});await f.source.run();const pending=f.source.project('A'),rejected=assert.rejects(pending,{code:'KAIQEN_STALE'});await assert.rejects(()=>f.source.project('B'));f.advance(5000);await f.source.run();slow.reject(new Error('old request failure'));await rejected;assert.equal(f.source.status().available,true);
});
test('probe capacity contention does not trip the circuit breaker',async t=>{
 const slow=deferred();const f=fixture(t,{maxConcurrent:1,probeMs:1,factory:()=>({projects:async()=>({data:[]}),project:async()=>slow.promise})});await f.source.run();const pending=f.source.project('A');f.advance(2);await f.source.run();assert.equal(f.source.status().available,true);assert.equal(f.source.status().failures,0);slow.resolve({data:{}});await pending;
});

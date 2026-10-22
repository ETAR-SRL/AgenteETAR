import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createKaiqenPostgres} from '../src/kaiqen-postgres.js';
import {createReadSource} from '../src/read-source.js';
function fixture(){
 const pool=new EventEmitter(),released=[];let phase='',client;
 function fresh(){client=new EventEmitter();client.release=destroy=>released.push(destroy===true);client.query=async text=>{
  if(text==='SHOW transaction_read_only')return {rows:[{transaction_read_only:'on'}]};
  if(phase==='select'&&text.includes('FROM public.project p'))queueMicrotask(()=>client.emit('error',new Error('private socket details')));
  if(phase==='rollback'&&text==='ROLLBACK')client.emit('error',new Error('private socket details'));
  return {rows:[]};
 };return client;}
 fresh();pool.connect=async()=>{pool.emit('connect',client);if(phase==='acquire')client.emit('error',new Error('private socket details'));return client;};pool.end=async()=>{};
 const adapter=createKaiqenPostgres({tenantId:'tenant-test',pool});
 return {adapter,pool,released,get client(){return client;},phase:value=>phase=value,fresh};
}
for(const phase of ['acquire','select','rollback'])test('checked-out PostgreSQL error during '+phase+' rejects evidence and destroys client without crashing',async()=>{
 const f=fixture();f.phase(phase);await assert.rejects(()=>f.adapter.projects(),e=>e.code==='KAIQEN_DATABASE_UNAVAILABLE'&&!e.message.includes('private'));assert.deepEqual(f.released,[true]);await f.adapter.close();
});
test('one lifetime guard covers late errors and repeated healthy snapshots without accumulating listeners',async()=>{
 const f=fixture();for(let i=0;i<30;i++)await f.adapter.projects();assert.equal(f.client.listenerCount('error'),1);assert(f.released.every(x=>!x));assert.doesNotThrow(()=>f.client.emit('error',new Error('late disconnect')));await assert.rejects(()=>f.adapter.projects(),{code:'KAIQEN_DATABASE_UNAVAILABLE'});assert.equal(f.released.at(-1),true);await f.adapter.close();
});
test('source circuit fails closed on client error and recovers only through a fresh successful read',async()=>{
 const f=fixture();let now=new Date('2026-10-22T12:00:00Z');const source=createReadSource({factory:()=>f.adapter,clock:()=>now});await source.run();assert.equal(source.status().available,true);
 f.phase('select');await assert.rejects(()=>source.projects(),{code:'KAIQEN_SOURCE_UNAVAILABLE'});assert.equal(source.status().available,false);const count=f.released.length;await assert.rejects(()=>source.projects(),{status:503});assert.equal(f.released.length,count);
 f.phase('');f.fresh();now=new Date(+now+5001);await source.run();assert.equal(source.status().available,true);await source.close();
});

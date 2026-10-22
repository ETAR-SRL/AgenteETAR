import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createKaiqenPostgres} from '../src/kaiqen-postgres.js';
import {createReadSource} from '../src/read-source.js';
import pg from 'pg';
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

// Usa la implementacion real de pg-pool: quita su listener de cliente ocioso
// al prestar una conexion y administra las esperas; solo el transporte es doble.
function actualPoolFixture(){
 const clients=[];let blockSelect,enteredSelect;
 class TransportClient extends EventEmitter {
  constructor(){super();this._queryable=true;this._ending=false;clients.push(this);}
  connect(callback){queueMicrotask(()=>callback(null));}
  async query(text){
   if(text==='SHOW transaction_read_only')return {rows:[{transaction_read_only:'on'}]};
   if(text.includes('FROM public.project p')&&blockSelect){const wait=blockSelect;blockSelect=null;enteredSelect();await wait;}
   return {rows:[]};
  }
  end(callback){this._ending=true;queueMicrotask(()=>{this.emit('end');callback?.();});}
  ref(){} unref(){}
 }
 const pool=new pg.Pool({Client:TransportClient,max:1,connectionTimeoutMillis:1000,idleTimeoutMillis:0});
 const adapter=createKaiqenPostgres({tenantId:'tenant-test',pool});
 return {pool,adapter,clients,block(){let release;blockSelect=new Promise(r=>release=r);const entered=new Promise(r=>enteredSelect=r);return {release,entered};}};
}
test('real pg pool: idle socket error is consumed, removed client is replaced by a successful read',async t=>{
 const f=actualPoolFixture();t.after(()=>f.adapter.close());
 await f.adapter.projects();assert.equal(f.pool.idleCount,1);
 const idle=f.clients[0];assert.doesNotThrow(()=>idle.emit('error',Object.assign(new Error('private idle transport'),{code:'ECONNRESET'})));
 await f.adapter.projects();assert.equal(f.clients.length,2);assert.equal(f.pool.idleCount,1);
 // El guard permanece aun despues de retirar el cliente del pool.
 assert.doesNotThrow(()=>idle.emit('error',new Error('late closed socket')));
});
test('real pg pool: checked-out disconnect rejects snapshot and wakes queued read on a fresh client',async t=>{
 const f=actualPoolFixture();t.after(()=>f.adapter.close());
 const blocked=f.block(),first=f.adapter.projects(),rejected=assert.rejects(first,{code:'KAIQEN_DATABASE_UNAVAILABLE'});
 await blocked.entered;
 const second=f.adapter.projects();assert.equal(f.pool.waitingCount,1);
 const client=f.clients[0];assert.equal(client.listenerCount('error'),1);
 assert.doesNotThrow(()=>client.emit('error',Object.assign(new Error('private checked-out transport'),{code:'ECONNRESET'})));
 blocked.release();await rejected;assert.deepEqual((await second).data,[]);assert.equal(f.clients.length,2);assert.equal(f.pool.waitingCount,0);
});
test('real pg pool: source stays unavailable after socket loss until a new successful probe',async t=>{
 const f=actualPoolFixture();let now=new Date('2026-10-22T12:00:00Z');
 const source=createReadSource({factory:()=>f.adapter,clock:()=>now});t.after(()=>source.close());await source.run();
 const blocked=f.block(),pending=source.projects(),rejected=assert.rejects(pending,{code:'KAIQEN_SOURCE_UNAVAILABLE'});await blocked.entered;
 f.clients[0].emit('error',new Error('private socket reset'));blocked.release();await rejected;
 assert.equal(source.status().state,'unavailable');assert.equal(source.status().available,false);
 await assert.rejects(source.projects(),{code:'KAIQEN_SOURCE_UNAVAILABLE'});assert.equal(f.clients.length,1);
 now=new Date(+now+5001);await source.run();assert.equal(source.status().state,'available');assert.equal(f.clients.length,2);
});

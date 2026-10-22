import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createMaintenance,maintenanceDurableCounts} from '../src/maintenance.js';
import {createApp} from '../src/app.js';
import {Store} from '../src/store.js';
import {createDemoErp,createDemoKaiqen} from '../src/demo.js';
import {createApprovalScheduler} from '../src/approval-scheduler.js';

function gate(t){
 const dir=mkdtempSync(join(tmpdir(),'central-maintenance-'));mkdirSync(join(dir,'maintenance'));
 const maintenance=createMaintenance({dataDir:dir});
 t.after(async()=>{await maintenance.close();rmSync(dir,{recursive:true,force:true});});
 return {maintenance,signal:(mode='drain')=>writeFileSync(maintenance.controlPath,JSON.stringify({id:'test-update',mode}))};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('ack waits for active HTTP, stopping workers and durable operations; deletion stays latched',async t=>{
 const {maintenance,signal}=gate(t);let finishWorker,counts={executions:1,escalations:0,jobs:0};
 const worker=new Promise(resolve=>{finishWorker=resolve;});let stopped=0;
 maintenance.attach({workers:[{stop(){stopped++;return worker;}}],durable:()=>counts});
 const release=maintenance.begin();signal();assert.equal(maintenance.enter(),true);await settle();
 assert.equal(stopped,1);assert.equal(maintenance.status().status,'draining');
 release();finishWorker();await settle();assert.equal(maintenance.status().status,'draining');
 counts={executions:0,escalations:0,jobs:0};maintenance.tick();
 const ack=JSON.parse(readFileSync(maintenance.runtimePath));assert.equal(ack.status,'quiescent');assert.equal(ack.id,'test-update');
 rmSync(maintenance.controlPath);assert.equal(maintenance.active(),true);assert.equal(stopped,1);
});

test('malformed control and failed workers remain blocked',async t=>{
 const {maintenance}=gate(t);writeFileSync(maintenance.controlPath,'{');
 maintenance.attach({workers:[{async stop(){throw new Error('failed');}}]});await settle();
 assert.equal(maintenance.active(),true);assert.equal(maintenance.status().status,'blocked');assert.equal(maintenance.status().workersStopped,false);
});

test('only an explicit matching release resumes; deleting probe does not activate',async t=>{
 const {maintenance,signal}=gate(t);let activations=0;
 signal('probe');maintenance.attach({onRelease:()=>{activations++;}});await settle();maintenance.tick();
 assert.equal(maintenance.status().status,'quiescent');
 rmSync(maintenance.controlPath);maintenance.tick();await settle();assert.equal(maintenance.active(),true);assert.equal(activations,0);
 signal('release');maintenance.tick();await settle();assert.equal(activations,1);assert.equal(maintenance.active(),false);assert.equal(maintenance.status().status,'active');
 maintenance.tick();await settle();assert.equal(activations,1);
});

test('release for another update cannot open the gate',async t=>{
 const {maintenance,signal}=gate(t);signal('probe');maintenance.attach();await settle();
 writeFileSync(maintenance.controlPath,JSON.stringify({id:'other-update',mode:'release'}));maintenance.tick();
 assert.equal(maintenance.active(),true);assert.equal(maintenance.status().status,'blocked');
});

test('all business routes and login close immediately, existing ERP read completes, probes retain authentication',async t=>{
 const {maintenance,signal}=gate(t),store=new Store(':memory:'),erp=createDemoErp();
 let resolveRead,started;const waiting=new Promise(resolve=>{started=resolve;});
 erp.list=async()=>{started();return new Promise(resolve=>{resolveRead=resolve;});};
 const readKey='maintenance-read-00000000000000000000',planKey='maintenance-plan-00000000000000000000';
 const server=createApp({erp,kaiqen:createDemoKaiqen(),store,maintenance,mode:'demo',readKey,planKey});
 maintenance.attach({workers:[server.attention,server.notifications,server.jobs],durable:()=>maintenanceDurableCounts(store.db)});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();});
 const request=(path,method='GET',key=readKey)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{authorization:`Bearer ${key}`}});
 const existing=request('/api/erp/clientes?sucursal=0101');await waiting;
 signal();
 for(const [path,method] of [['/api/erp/clientes?sucursal=0101','GET'],['/api/auth/login','POST'],['/api/changes/preview','POST'],['/api/chat','POST'],['/','GET']])assert.equal((await request(path,method,planKey)).status,503);
 assert.equal(maintenance.status().activeRequests,1);assert.equal(maintenance.status().status,'draining');
 assert.equal((await request('/health')).status,200);assert.equal((await request('/api/voice/status','GET','bad')).status,401);assert.equal((await request('/api/voice/status')).status,200);
 resolveRead({data:[],meta:{}});assert.equal((await existing).status,200);await settle();maintenance.tick();assert.equal(maintenance.status().status,'quiescent');
});

test('durable inspector reads existing database without recovering executions',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec("CREATE TABLE executions(status TEXT); INSERT INTO executions VALUES('executing'),('unknown');CREATE TABLE approval_escalations(status TEXT); INSERT INTO approval_escalations VALUES('executing');CREATE TABLE investigation_jobs(status TEXT); INSERT INTO investigation_jobs VALUES('running'),('queued');");
 assert.deepEqual(maintenanceDurableCounts(db),{executions:1,escalations:1,jobs:1,uncertainExecutions:1,uncertainEscalations:0,priceBatches:0});assert.equal(db.prepare("SELECT count(*) n FROM executions WHERE status='executing'").get().n,1);
});

test('uncertain executions, escalations and active price batches prevent quiescence before stop',async t=>{
 const {maintenance,signal}=gate(t),db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec("CREATE TABLE executions(status TEXT);CREATE TABLE approval_escalations(status TEXT);CREATE TABLE price_batches(status TEXT);INSERT INTO executions VALUES('unknown');INSERT INTO approval_escalations VALUES('unknown');INSERT INTO price_batches VALUES('checking'),('running'),('completed');");
 signal();maintenance.attach({durable:()=>maintenanceDurableCounts(db)});await settle();maintenance.tick();
 const state=maintenance.status();assert.equal(state.workersStopped,true);assert.equal(state.activeRequests,0);assert.equal(state.status,'draining');
 assert.equal(state.durable.uncertainExecutions,1);assert.equal(state.durable.uncertainEscalations,1);assert.equal(state.durable.priceBatches,2);
 db.exec('DELETE FROM executions;DELETE FROM approval_escalations;');maintenance.tick();assert.equal(maintenance.status().status,'draining');
 db.exec("UPDATE price_batches SET status='completed';");maintenance.tick();assert.equal(maintenance.status().status,'quiescent');
});

test('approval service resumes only after stop has drained and does not keep a stale timer',async()=>{
 let scans=0;
 const adapter={enabled:true,branches:['0101'],async scan(){scans++;return [];}};
 const scheduler=createApprovalScheduler({adapter,enabled:true,store:{escalationSummary:()=>({})}});
 await scheduler.run();assert.equal(scans,1);await scheduler.stop();await scheduler.run();assert.equal(scans,1);
 scheduler.resume();await scheduler.run();assert.equal(scans,2);await scheduler.stop();
});

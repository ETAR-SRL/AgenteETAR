import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createErpConnection} from '../src/protheus/connection.js';
import {createApp} from '../src/app.js';
import {Store} from '../src/store.js';
import {Access} from '../src/access.js';
import {createDemoKaiqen} from '../src/demo.js';
import {createAttention} from '../src/attention.js';
const outage=()=>Object.assign(new Error('sensitive connection details must not escape'),{code:'ESOCKET'});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function adapter(extra={}){return {metadata:()=>({entities:{productos:{fields:[]}}}),list:async()=>({data:[{codigo:'Z1'}]}),ping:async()=>{},writes:{enabled:true,policy:{configured:true},creation:{supported:true},prepare:async()=>({}),check:async()=>({}),execute:async()=>({affected:1}),escalation:{enabled:true,scan:async()=>[],prepare:async()=>{},execute:async()=>{}}},close:async()=>{},...extra};}
function fixture(t,connect,options={}){let time=Date.parse('2026-10-21T20:00:00Z');const states=[],erp=createErpConnection({connect,clock:()=>new Date(time),onState:s=>states.push(s),writeEnabled:true,...options});t.after(()=>erp.close());return {erp,states,advance:ms=>{time+=ms;}};}
test('HTTP, login, memory and status start while the initial ERP connection is still pending; capabilities recover without restarting',async t=>{
 const pending=deferred();t.after(()=>pending.resolve(adapter()));const f=fixture(t,()=>pending.promise),store=new Store(':memory:'),access=new Access(store,['0101']),admin=await access.setup({username:'admin',name:'Prueba',password:'Prueba-Reconexion-123'});
 const server=createApp({erp:f.erp,store,kaiqen:createDemoKaiqen(),readKey:'r'.repeat(40),planKey:'p'.repeat(40),localWrites:true,model:{name:'must-not-run',status:async()=>({available:false}),complete:async()=>assert.fail('No model needed for a direct ERP lookup')}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await server.attention.stop();await server.notifications.stop();server.close();server.closeAllConnections();store.close();});
 const request=path=>fetch(`http://127.0.0.1:${server.address().port}`+path,{headers:{authorization:'Bearer '+admin.token}});
 const connecting=f.erp.run();assert.equal((await request('/health')).status,200);assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/erp/status`)).status,401);
 let r=await(await request('/api/capabilities')).json();assert.equal(r.canExecute,false);assert.deepEqual(r.erp.entities,{});assert.equal((await request('/api/agent/conversations')).status,200);
 const unavailable=await request('/api/erp/productos?sucursal=0101');assert.equal(unavailable.status,503);assert.match((await unavailable.json()).error.message,/sin conexión/);
 const chat=await fetch(`http://127.0.0.1:${server.address().port}/api/agent/chat`,{method:'POST',headers:{authorization:'Bearer '+admin.token,'content-type':'application/json'},body:JSON.stringify({text:'A cuánto vendemos el Z1304003',context:{sucursal:'0101'}})});assert.equal(chat.status,200);assert.match((await chat.json()).answer,/sin conexión/);
 pending.resolve(adapter());await connecting;r=await(await request('/api/capabilities')).json();assert.equal(r.canExecute,true);assert.ok(r.erp.entities.productos);assert.equal((await request('/api/erp/productos?sucursal=0101')).status,200);
 const status=await(await request('/api/erp/status')).json();assert.equal(status.available,true);assert.ok(!JSON.stringify(status).includes('sensitive'));
});
test('failed connections share one attempt, back off with a ceiling, then replace the entire catalog on recovery',async t=>{
 let attempts=0,online=false;const f=fixture(t,async()=>{attempts++;if(!online)throw outage();return adapter();});
 await Promise.all(Array.from({length:20},()=>f.erp.run()));assert.equal(attempts,1);assert.equal(f.erp.status().state,'unavailable');await f.erp.run();assert.equal(attempts,1);
 f.advance(4999);await f.erp.run();assert.equal(attempts,1);f.advance(1);await f.erp.run();assert.equal(attempts,2);f.advance(9999);await f.erp.run();assert.equal(attempts,2);
 for(let i=0;i<6;i++){f.advance(60000);await f.erp.run();assert.ok(Date.parse(f.erp.status().nextRetry)-Date.parse(f.erp.status().lastFailure)<=60000);}
 online=true;f.advance(60000);await f.erp.run();assert.equal(f.erp.status().available,true);assert.equal(f.erp.status().failures,0);assert.equal(f.erp.writes.enabled,true);assert.ok(f.erp.metadata().entities.productos);
});
test('a connection loss fails fast without empty data, health probes reconnect, and business validation errors do not drop the connection',async t=>{
 let closes=0,fail=false,generation=0;const f=fixture(t,async()=>adapter({metadata:()=>({entities:{['generation'+ ++generation]:{}}}),list:async()=>{if(fail)throw outage();throw Object.assign(new Error('Invalid product'),{status:400,code:'FILTRO_INVALIDO'});},ping:async()=>{if(fail)throw outage();},close:async()=>{closes++;}}));
 await f.erp.run();await assert.rejects(()=>f.erp.list('productos',new URLSearchParams()),{code:'FILTRO_INVALIDO'});assert.equal(f.erp.status().available,true);
 fail=true;f.advance(15000);await f.erp.run();assert.equal(f.erp.status().available,false);assert.equal(f.erp.writes.enabled,false);assert.equal(closes,1);await assert.rejects(()=>f.erp.list('productos',new URLSearchParams()),{status:503});
 fail=false;f.advance(5000);await f.erp.run();assert.ok(f.erp.metadata().entities.generation2);assert.equal(f.erp.metadata().entities.generation1,undefined);
 fail=true;await assert.rejects(()=>f.erp.list('productos',new URLSearchParams()),{status:503,code:'PROTHEUS_NO_DISPONIBLE'});assert.equal(f.erp.status().available,false);
});
test('writes are never replayed, unknown outcomes remain unknown, and old pools wait for in-flight operations',async t=>{
 const first=deferred();let writes=0,closes=0;const unknown=Object.assign(new Error('Commit uncertain'),{code:'RESULTADO_INCIERTO',outcomeUnknown:true});
 const a=adapter({list:()=>first.promise,close:async()=>{closes++;}});a.writes.execute=async()=>{writes++;throw unknown;};const f=fixture(t,async()=>a);await f.erp.run();
 const reading=f.erp.list('productos',new URLSearchParams()),stale=assert.rejects(()=>reading,{status:503,code:'PROTHEUS_NO_DISPONIBLE'});await assert.rejects(()=>f.erp.writes.execute({}),e=>e===unknown);assert.equal(closes,0);assert.equal(f.erp.status().available,false);await assert.rejects(()=>f.erp.writes.execute({}),{status:503});assert.equal(writes,1);
 first.resolve({data:[{codigo:'Z1'}]});await stale;await Promise.resolve();assert.equal(closes,1);
 f.advance(5000);await f.erp.run();assert.equal(writes,1);
});
test('a late failure of a retired pool cannot disconnect a new generation; shutdown waits and closes a pending connection',async t=>{
 const old=deferred();let connects=0,closes=0;const f=fixture(t,async()=>{connects++;return adapter({list:()=>old.promise,ping:async()=>{throw outage();},close:async()=>{closes++;}});});await f.erp.run();
 const result=f.erp.list('productos',new URLSearchParams());const rejected=assert.rejects(()=>result,{status:503});f.advance(15000);await f.erp.run();f.advance(5000);await f.erp.run();assert.equal(connects,2);old.reject(outage());await rejected;assert.equal(f.erp.status().available,true);assert.equal(closes,1);
 const pending=deferred();const other=createErpConnection({connect:()=>pending.promise});const attempt=other.run(),closing=other.close();pending.resolve(adapter({close:async()=>{closes++;}}));await Promise.all([attempt,closing]);assert.equal(other.status().state,'stopped');assert.equal(other.status().available,false);assert.equal(closes,2);
});
test('a late complete-delivery response cannot resolve a followup during an outage; only a fresh post-reconnection read completes it',async t=>{
 const store=new Store(':memory:');let attention,time=Date.parse('2026-10-21T20:00:00Z'),held=false,delivered=false;const late=deferred(),clock=()=>new Date(time),p={userId:'a',revision:'r1',actor:'user:a:r1',branches:['0101'],permissions:['read:ventas','read:clientes','read:preciosVenta','read:catalogo']};
 const rows=()=>({data:[{registro:'1',kind:'sale',sucursal:'0101',numero:'000123',serie:'',item:'01',producto:'Z1',tercero:'C1',tienda:'01',nombre:'Cliente de prueba',unidad:'UN',fecha:'2026-10-19',moneda:'2',monedaNombre:'DOLAR',cantidad:delivered?'0':'500',pedida:'1500',atendida:delivered?'1500':'1000',precio:'0.06',importe:delivered?'0':'30',devuelta:'0',vigente:1}],meta:{hasMore:false}});
 const erp=createErpConnection({connect:async()=>adapter({list:()=>held?late.promise:Promise.resolve(rows()),ping:async()=>{throw outage();}}),clock,onState:s=>{if(s.state==='unavailable')attention?.erpUnavailable();if(s.state==='available')attention?.erpAvailable();}});
 attention=createAttention({store,principal:()=>p,users:()=>[p],runAs:async(_id,fn)=>fn(),read:(...args)=>erp.list(...args),kaiqen:createDemoKaiqen(),clock,enabled:false});t.after(async()=>{await attention.stop();await erp.close();store.close();});
 await erp.run();const {item}=await attention.resolve({kind:'sale',branch:'0101',numero:'000123'});await attention.act(item.id,{action:'follow'});
 held=true;const review=attention.refresh(item.id);time+=15000;await erp.run();assert.equal(attention.db.get('a',item.id).status,'unknown');delivered=true;late.resolve(rows());await review;
 let row=attention.db.get('a',item.id);assert.equal(row.status,'unknown');assert.equal(row.follow_state,'active');assert.equal(row.snapshot.goalComplete,false);assert.equal(attention.db.events('a',item.id).filter(e=>e.type==='goal').length,0);
 held=false;time+=5000;await erp.run();row=await attention.refresh(item.id);assert.equal(row.id,item.id);assert.equal(row.follow_state,'completed');assert.equal(row.snapshot.goalComplete,true);assert.equal(attention.db.events('a',item.id).filter(e=>e.type==='goal').length,1);
});

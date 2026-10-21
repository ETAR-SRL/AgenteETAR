import test from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {createAttention} from '../src/attention.js';
import {createAttentionChat} from '../src/intelligence/attention-chat.js';
import {localDailyTime} from '../src/attention-daily.js';
function fixture(t,path=':memory:'){
 const store=new Store(path),ctx=new AsyncLocalStorage();t.after(()=>store.close());let now=new Date('2026-10-21T10:59:00Z'),offline=false;
 const people=new Map(['a','b'].map(id=>[id,{userId:id,actor:'user:'+id,revision:'r1',branches:['0101'],permissions:['read:ventas','read:clientes','read:preciosVenta','read:catalogo','read:finanzasClientes','plan:pedidoVenta']}]));
 const principal=()=>{const p=people.get(ctx.getStore());assert(p);return p;},runAs=async(id,fn)=>ctx.run(id,fn),row={registro:'1',kind:'sale',sucursal:'0101',numero:'000123',serie:'',item:'01',producto:'Z1',tercero:'C1',tienda:'01',unidad:'UN',fecha:'2026-10-19',moneda:'2',monedaNombre:'DOLAR',cantidad:'500',pedida:'1500',atendida:'1000',precio:'0.06',importe:'30',vigente:1};
 const read=async resource=>{if(offline)throw new Error('offline');return {data:resource==='atencionVentas'?[{...row}]:[],meta:{hasMore:false}};};
 const attention=createAttention({store,principal,users:()=>[...people.values()],runAs,read,kaiqen:{projects:async()=>({data:[]})},clock:()=>now,intervalMs:30000});t.after(()=>attention.stop());
 const chat=createAttentionChat({attention,read,executeRead:()=>{},authorizeRead:()=>{},metadata:()=>({entities:{}}),clock:()=>now});
 return {store,attention,people,row,read,chat,principal,run:fn=>runAs('a',fn),as:runAs,setNow:value=>now=new Date(value),fail:value=>offline=value,resolve:()=>runAs('a',async()=>(await attention.resolve({kind:'sale',branch:'0101',numero:'000123'})).item)};
}

test('natural personal priority applies by kind and branch, case override wins, revocation and owner isolation remain effective',async t=>{
 const f=fixture(t),item=await f.resolve();await f.as('b',()=>f.attention.resolve({kind:'sale',branch:'0101',numero:'000123'}));
 await f.run(()=>f.chat({text:'Priorizá mis pedidos vencidos',branch:'0101',conversation:{messages:[]}}));
 assert.equal((await f.run(()=>f.attention.get(item.id))).caseDetails.preference,'high');
 assert.equal((await f.as('b',()=>f.attention.list({branch:'0101',all:true}))).data[0].caseDetails.preference,'normal');
 await f.run(()=>f.attention.act(item.id,{action:'case-update',preference:'low'}));assert.equal((await f.run(()=>f.attention.get(item.id))).caseDetails.preference,'low');
 await f.run(()=>f.chat({text:'Dejá de priorizar mis pedidos vencidos',branch:'0101',conversation:{messages:[]}}));assert.equal((await f.run(()=>f.attention.get(item.id))).caseDetails.preference,'low');
 assert.equal(f.store.db.prepare("SELECT preference FROM op_priority_preferences WHERE owner='a'").get().preference,'normal');
 f.people.set('a',{...f.people.get('a'),revision:'r2',permissions:[]});await assert.rejects(f.run(()=>f.chat({text:'Priorizá mis pedidos vencidos',branch:'0101',conversation:{messages:[]}})),{code:'LECTURA_DENEGADA'});assert.equal((await f.run(()=>f.attention.list({branch:'0101',all:true}))).data.length,0);
 await assert.rejects(f.as('b',()=>f.chat({text:'Priorizá mis pedidos vencidos',branch:'9999',conversation:{messages:[]}})),{code:'LECTURA_DENEGADA'});
});
test('what should I review today retrieves the scoped personal daily summary deterministically',async t=>{
 const f=fixture(t),item=await f.resolve();const result=await f.run(()=>f.chat({text:'¿Qué tengo que mirar hoy?',branch:'0101',conversation:{messages:[]}}));assert.match(result.answer,/Tu resumen del día/);assert.equal(result.daily.timeZone,'America/Argentina/Buenos_Aires');assert.ok(result.daily.sections.needsAttention.some(i=>i.id===item.id));
 assert.equal((await f.as('b',()=>f.chat({text:'¿Qué tengo que mirar hoy?',branch:'0101',conversation:{messages:[]}}))).daily.sections.needsAttention.length,0);
});
test('same persistent case survives chats and restart, pause cannot complete until explicit fresh resume',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'etar-cases-'));const path=join(folder,'case.sqlite'),f=fixture(t,path),item=await f.resolve();
 await f.run(()=>f.attention.act(item.id,{action:'follow'}));await f.run(()=>f.chat({text:'Pausá este caso',branch:'0101',conversation:{messages:[]},attentionId:item.id}));
 Object.assign(f.row,{cantidad:'0',atendida:'1500'});await f.run(()=>f.attention.refresh(item.id));let paused=await f.run(()=>f.attention.get(item.id));assert.equal(paused.follow_state,'paused');assert.equal(paused.caseState,'paused');assert.equal(paused.visible,false);assert.equal(f.attention.db.events('a',item.id).filter(e=>e.type==='goal'&&e.state==='completed').length,0);
 const other=fixture(t,path);t.after(()=>rmSync(folder,{recursive:true,force:true}));assert.equal((await other.run(()=>other.attention.get(item.id))).caseState,'paused');
 f.fail(true);await assert.rejects(()=>f.run(()=>f.attention.act(item.id,{action:'resume'})),{code:'FUENTE_NO_DISPONIBLE'});assert.equal((await f.run(()=>f.attention.get(item.id))).follow_state,'paused');f.fail(false);
 const response=await f.run(()=>f.chat({text:'Retomá este caso',branch:'0101',conversation:{messages:[]},attentionId:item.id}));assert.equal(response.attention.data[0].id,item.id);assert.equal(response.attention.data[0].follow_state,'completed');
});
test('objectives, next steps, explainable priority, evidence and proposal links revalidate permissions',async t=>{
 const f=fixture(t),item=await f.resolve();await f.run(()=>f.attention.act(item.id,{action:'case-update',objective:'Revisar la fecha con ventas',nextSteps:['Verificar nueva fecha'],preference:'high'}));
 let card=await f.run(()=>f.attention.recordInvestigation(item.id,{facts:['Saldo verificado'],possibleCauses:['Causa sin confirmar'],unavailable:['Recepción física'],requiredResources:['saldosClientes']}));assert.equal(card.caseDetails.investigations.length,1);assert.match(card.priority.reasons[0],/alta/);assert.equal(card.nextSteps[0],'Verificar nueva fecha');
 card=await f.run(()=>f.attention.linkProposal(item.id,{id:'proposal-1',status:'prepared',reason:'Ajustar fecha solicitada',requiredResources:['saldosClientes']}));assert.equal(card.caseDetails.links.length,1);
 f.people.set('a',{...f.people.get('a'),revision:'r2',permissions:f.people.get('a').permissions.filter(x=>x!=='read:finanzasClientes')});card=await f.run(()=>f.attention.get(item.id));assert.equal(card.caseDetails.investigations.length,0);assert.equal(card.caseDetails.links.length,0);
 assert.equal((await f.as('b',()=>f.attention.list({branch:'0101',all:true}))).data.length,0);await assert.rejects(()=>f.as('b',()=>f.attention.act(item.id,{action:'pause'})),{status:404});
});
test('daily server scheduling uses local day, durable dedup, exclusion, owner and fresh scope',async t=>{
 const f=fixture(t),item=await f.resolve();await f.run(()=>f.attention.settings({enabled:true,time:'08:00',timeZone:'America/Argentina/Buenos_Aires'}));await f.attention.dailyRun();assert.equal(f.store.db.prepare('SELECT count(*) n FROM op_daily').get().n,0);
 f.setNow('2026-10-21T11:01:00Z');const a=f.attention.dailyRun(),b=f.attention.dailyRun();assert.equal(a,b);await a;await f.attention.dailyRun();assert.equal(f.store.db.prepare('SELECT count(*) n FROM op_daily').get().n,1);
 let daily=await f.run(()=>f.attention.currentDaily({branch:'0101'}));assert.equal(daily.sections.needsAttention[0].id,item.id);assert.equal(daily.sections.preparable.length,1);assert.equal(daily.partial,true);
 f.fail(true);await f.run(()=>f.attention.refresh(item.id));daily=await f.run(()=>f.attention.currentDaily({branch:'0101'}));assert.equal(daily.sections.unverified.length,1);assert.equal(daily.sections.resolved.length,0);assert.equal(daily.sections.preparable.length,0);
 f.people.set('a',{...f.people.get('a'),revision:'r2',permissions:[]});daily=await f.run(()=>f.attention.currentDaily({branch:'0101'}));assert.equal(Object.values(daily.sections).flat().length,0);
 await assert.rejects(()=>f.run(()=>f.attention.currentDaily({branch:'9999'})),{status:403});assert.equal((await f.as('b',()=>f.attention.currentDaily({branch:'0101'}))).sections.needsAttention.length,0);
});
test('daily timezone configuration validates IANA zones and handles a DST local date',async t=>{
 const f=fixture(t);await assert.rejects(()=>f.run(()=>f.attention.settings({time:'25:00'})),{status:400});await assert.rejects(()=>f.run(()=>f.attention.settings({timeZone:'somewhere'})),{status:400});assert.deepEqual(localDailyTime(new Date('2026-11-01T06:30:00Z'),'America/New_York'),{day:'2026-11-01',time:'01:30'});
});
test('investigation dispatch returns promptly and cancellation prevents findings persistence',async t=>{
 const f=fixture(t),item=await f.resolve();let queued=0;
 const chat=createAttentionChat({attention:f.attention,read:f.read,executeRead:()=>{},authorizeRead:()=>{},metadata:()=>({entities:{}}),enqueueInvestigation:async(id,branch)=>{assert.equal(id,item.id);assert.equal(branch,'0101');queued++;return {id:'job-1',state:'queued'};}});
 const reply=await f.run(()=>chat({text:'Investigá este caso',attentionId:item.id,branch:'0101',conversation:{messages:[]}}));assert.equal(queued,1);assert.equal(reply.job.state,'queued');
 f.fail(true);let checked=0;await assert.rejects(()=>f.run(()=>chat.investigate(item.id,'0101',{check:()=>{if(++checked===2)throw Object.assign(new Error('cancelled'),{code:'CANCELLED'});}})),{code:'CANCELLED'});assert.equal((await f.run(()=>f.attention.get(item.id))).caseDetails.investigations.length,0);
});

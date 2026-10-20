import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
const cleanup=dir=>{const resolved=resolve(dir);assert.equal(dirname(resolved),resolve(tmpdir()));assert.ok(basename(resolved).startsWith('approval-test-'));rmSync(resolved,{recursive:true,force:true});};
import {once} from 'node:events';
import {createApprovalEscalation,deadlineDecision} from '../src/protheus/approval-escalation.js';
import {selection} from '../src/protheus/writer.js';
import {createApprovalScheduler} from '../src/approval-scheduler.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/app.js';
import {createDemoErp,createDemoKaiqen} from '../src/demo.js';

function fixture(type='PC',options={}){
 const alias=type==='SC'?'SC1':'SC7',p=type==='SC'?'C1':'C7',stateField=type==='SC'?'C1_APROV':'C7_CONAPRO';
 const base={R_E_C_N_O_:'100',D_E_L_E_T_:' ',R_E_C_D_E_L_:'0'};
 const scr={...base,CR_FILIAL:'0101',CR_NUM:'000001',CR_TIPO:type,CR_EMISSAO:'20261001',CR_USER:'USR001',CR_APROV:'APR001',CR_GRUPO:'G1',CR_ITGRP:type==='PC'?'':'01',CR_NIVEL:'01',CR_STATUS:'02',CR_TOTAL:'200',CR_MOEDA:'1',CR_TXMOEDA:'1',CR_PRAZO:'20261018',CR_ESCALSP:'T',CR_ESCALON:'F',CR_AVISO:'20261017',CR_ULTAVIS:'',CR_DATALIB:'',CR_USERLIB:'',CR_LIBAPRO:'',CR_VALLIB:'0',CR_APRORI:'',CR_USERORI:'',CR_TPTRAN:'',CR_FLUIG:'',CR_WF:''};
 const member={...base,AL_FILIAL:'0101',AL_COD:'G1',AL_ITEM:'01',AL_APROV:'APR001',AL_USER:'USR001',AL_NIVEL:'01',AL_APROSUP:'',AL_USERSUP:'',AL_PERFIL:'P1',AL_LIBAPR:'A',AL_AUTOLIM:'N',AL_TPLIBER:'U',AL_DOCPC:'T',AL_DOCIP:'T',AL_DOCSC:'T'};
 const approver=(id,user,superior)=>({...base,AK_FILIAL:'0101',AK_COD:id,AK_USER:user,AK_APROSUP:superior,AK_MOEDA:'1',AK_LIMITE:'99999',AK_TIPO:'D'});
 const state={rows:{SCR:[scr],DBM:type==='PC'?[]:[{...base,DBM_FILIAL:'0101',DBM_NUM:'000001',DBM_TIPO:type,DBM_ITEM:'0001',DBM_GRUPO:'G1',DBM_ITGRP:'01',DBM_USER:'USR001',DBM_USEROR:'',DBM_APROV:'2',DBM_VALOR:'200'}],[alias]:[{...base,[p+'_FILIAL']:'0101',[p+'_NUM']:'000001',[p+'_ITEM']:'0001',[p+'_TOTAL']:'200',[p+'_QUJE']:'0',[p+'_RESIDUO']:'',[stateField]:'B'}],SAK:[approver('APR001','USR001','APR002'),approver('APR002','USR002','APR003'),approver('APR003','USR003','')],SAL:[member]},today:'20261019',updates:0,commits:0,rollbacks:0,calls:[]};
 const tables=new Map(Object.entries(state.rows).map(([a,r])=>[a,{schema:'dbo',name:a+'010',columns:new Map(Object.keys(r[0]||{...base,DBM_FILIAL:'',DBM_NUM:''}).map(f=>[f,{type:'varchar'}]))}]));
 const catalog={table:a=>{assert.ok(tables.has(a));return tables.get(a);},branch:(a,b)=>b};
 let queue=Promise.resolve();
 async function query(sql,params={}){
  state.calls.push({sql,params});
  if(sql==='SELECT CONVERT(char(8),GETDATE(),112) AS today')return [{today:state.today}];
  if(sql.startsWith('DECLARE')){
   const a=/UPDATE \[dbo\]\.\[(\w+)010\]/.exec(sql)?.[1];assert.ok(['SCR','DBM'].includes(a));
   state.updates++;if(options.failAt===state.updates)throw Object.assign(new Error('rollback'),{code:'TEST_ROLLBACK'});
   const r=state.rows[a].find(r=>r.R_E_C_N_O_===params.record);assert.ok(r);assert.equal(params.branch,r[a==='SCR'?'CR_FILIAL':'DBM_FILIAL']);
   for(const [,field,value] of sql.matchAll(/\[(\w+)\]=@(v\d+)/g))r[field]=params[value];
   if(options.collateral)state.rows[alias][0][p+'_TOTAL']='201';
   return [{affected:options.wrongCount?0:1}];
  }
  const a=/FROM \[dbo\]\.\[(\w+)010\]/.exec(sql)?.[1];assert.ok(a,sql);
  if(sql.includes('AS record'))return state.rows.SCR.filter(r=>r.CR_FILIAL===params.branch&&r.D_E_L_E_T_===' '&&r.CR_STATUS==='02'&&r.CR_ESCALSP==='T'&&r.CR_PRAZO&&r.CR_PRAZO<params.today&&!r.CR_APRORI&&!r.CR_USERORI&&!r.CR_TPTRAN&&BigInt(r.R_E_C_N_O_)>BigInt(params.after)).slice(0,100).map(r=>({record:r.R_E_C_N_O_,number:r.CR_NUM,type:r.CR_TIPO}));
  const prefix={SCR:'CR',DBM:'DBM',SC1:'C1',SC7:'C7',SAK:'AK',SAL:'AL'}[a];
  return structuredClone(state.rows[a].filter(r=>r.D_E_L_E_T_===' '&&r[prefix+'_FILIAL']===params.branch&&(!params.number||r[prefix+'_NUM']===params.number)));
 }
 const db={query,async transaction(fn){let release;const prev=queue;queue=new Promise(r=>release=r);await prev;const before=structuredClone(state.rows);try{const result=await fn({query});state.commits++;if(options.unknown)throw Object.assign(new Error('lost commit'),{outcomeUnknown:true});return result;}catch(e){if(!e.outcomeUnknown){state.rows=before;state.rollbacks++;}throw e;}finally{release();}}};
 const adapter=createApprovalEscalation({db,catalog,getWriteDb:async()=>db,enabled:options.enabled!==false,allowedBranches:['0101'],selection,schema:async()=>{if(options.badSchema)throw Object.assign(new Error('schema'),{code:'TRIGGER_NO_VERIFICADO'});return {};},text:(v)=>assert.ok(v&&v.length<=6)});
 return {state,adapter,db,catalog,target:{sucursal:'0101',registro:'100',numero:'000001',tipo:type},alias,p,stateField};
}

test('deadline uses ERP day, strictly past due, and transfer flag independently of mail',()=>{
 const r=fixture().state.rows.SCR[0];
 assert.equal(deadlineDecision(r,'20261018').due,false);
 assert.equal(deadlineDecision(r,'20261019').due,true);
 for(const flags of [{CR_ESCALSP:'F',CR_ESCALON:'T'},{CR_ESCALSP:''},{CR_STATUS:'01'},{CR_STATUS:'03'},{CR_APRORI:'APR001'},{CR_USERORI:'USR001'},{CR_TPTRAN:'3'},{CR_DATALIB:'20261018'},{CR_LIBAPRO:'APR001'}])assert.equal(deadlineDecision({...r,...flags},'20261019').due,false);
 for(const deadline of ['','20260230','20261301','20260000','2026101X'])assert.throws(()=>deadlineDecision({...r,CR_PRAZO:deadline},'20261019'),{code:'PLAZO_INVALIDO'});
 assert.equal(deadlineDecision({...r,CR_PRAZO:'20260228'},'20260301').due,true);
});
for(const type of ['SC','IP','PC'])test(type+' automatic transfer preserves state, deadline, amounts and original user; one hop only',async()=>{
 const f=fixture(type),before=structuredClone(f.state.rows),p=await f.adapter.prepare(f.target);
 assert.equal(f.state.updates,0);const result=await f.adapter.execute(p);
 assert.equal(result.to,'APR002');assert.equal(result.approval,false);assert.equal(result.affected,type==='PC'?1:2);
 const r=f.state.rows.SCR[0];assert.equal(r.CR_APROV,'APR002');assert.equal(r.CR_USERORI,'USR001');assert.equal(r.CR_APRORI,'APR001');assert.equal(r.CR_PRAZO,before.SCR[0].CR_PRAZO);assert.equal(r.CR_STATUS,'02');assert.equal(r.CR_TOTAL,'200');
 assert.deepEqual(f.state.rows[f.alias],before[f.alias]);assert.deepEqual(f.state.rows.SAL,before.SAL);assert.deepEqual(f.state.rows.SAK,before.SAK);
 if(type!=='PC'){assert.equal(f.state.rows.DBM[0].DBM_USER,'USR002');assert.equal(f.state.rows.DBM[0].DBM_USEROR,'USR001');assert.equal(f.state.rows.DBM[0].DBM_APROV,'2');}
 await assert.rejects(f.adapter.execute(p),{code:'YA_TRANSFERIDO'});assert.equal((await f.adapter.scan('0101')).length,0);
});
test('current SAK precedence, SAL fallback and cyclic/same-user superiors',async()=>{
 const f=fixture();f.state.rows.SAL[0].AL_APROSUP='APR003';f.state.rows.SAL[0].AL_USERSUP='USR003';assert.equal((await f.adapter.prepare(f.target)).to,'APR002');
 f.state.rows.SAK[0].AK_APROSUP='';assert.equal((await f.adapter.prepare(f.target)).to,'APR003');
 f.state.rows.SAK[2].AK_APROSUP='APR001';await assert.rejects(f.adapter.prepare(f.target),{code:'CIRCUITO_INVALIDO'});
});
test('stale date, switch, amount, document, user or config cannot execute a previous snapshot',async()=>{
 for(const mutate of [f=>f.state.rows.SCR[0].CR_PRAZO='20261020',f=>f.state.rows.SCR[0].CR_ESCALSP='F',f=>f.state.rows.SCR[0].CR_TOTAL='201',f=>f.state.rows[f.alias][0][f.stateField]='L',f=>f.state.rows.SAK[1].AK_USER='OTHER',f=>f.state.rows.SAL[0].AL_NIVEL='02',f=>f.state.rows.SCR[0].CR_DATALIB='20261018']){
  const f=fixture(),p=await f.adapter.prepare(f.target);mutate(f);await assert.rejects(f.adapter.execute(p));assert.equal(f.state.updates,0);
 }
});
test('rollback of SCR and DBM on later error, unexpected affected rows or collateral writes',async()=>{
 for(const options of [{failAt:2},{wrongCount:true},{collateral:true}]){
  const f=fixture('SC',options),before=structuredClone(f.state.rows),p=await f.adapter.prepare(f.target);await assert.rejects(f.adapter.execute(p));assert.deepEqual(f.state.rows,before);assert.equal(f.state.rollbacks,1);
 }
});
test('IP DBM integrity, collisions, external workflows, nonlocal currency and missing superior reject',async()=>{
 for(const mutate of [f=>f.state.rows.DBM=[],f=>f.state.rows.DBM[0].DBM_APROV='1',f=>f.state.rows.DBM[0].DBM_VALOR='201',f=>f.state.rows.SCR[0].CR_FLUIG='123',f=>f.state.rows.SCR[0].CR_MOEDA='2',f=>f.state.rows.SAK[0].AK_APROSUP='',f=>f.state.rows[f.alias][0][f.p+'_QUJE']='1',f=>f.state.rows.SCR.push({...f.state.rows.SCR[0],R_E_C_N_O_:'101',CR_USER:'USR002',CR_APROV:'APR002'})]){
  const f=fixture('IP');mutate(f);await assert.rejects(f.adapter.prepare(f.target));assert.equal(f.state.updates,0);
 }
});
test('PC never escalates ahead of pending IP',async()=>{
 const f=fixture();f.state.rows.SCR.push({...f.state.rows.SCR[0],R_E_C_N_O_:'101',CR_TIPO:'IP'});await assert.rejects(f.adapter.prepare(f.target),{code:'IP_PENDIENTE'});
 Object.assign(f.state.rows.SCR[1],{CR_STATUS:'03',CR_DATALIB:'20261017',CR_USERLIB:'USR001'});assert.ok(await f.adapter.prepare(f.target));
});
test('scope, schema, disabled writes and native transfer races are enforced',async()=>{
 const f=fixture();await assert.rejects(f.adapter.scan('9999'));await assert.rejects(f.adapter.prepare({...f.target,sucursal:'9999'}));
 const bad=fixture('PC',{badSchema:true});await assert.rejects(bad.adapter.prepare(bad.target),{code:'TRIGGER_NO_VERIFICADO'});
 const disabled=fixture('PC',{enabled:false});await assert.rejects(disabled.adapter.execute(await disabled.adapter.prepare(disabled.target)),{code:'ESCRITURA_DESHABILITADA'});
 const a=await f.adapter.prepare(f.target),b=await f.adapter.prepare(f.target);const results=await Promise.allSettled([f.adapter.execute(a),f.adapter.execute(b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.state.updates,1);
});
test('scheduler is automatic, coalesces runs, persists receipt and never cascades on another poll',async t=>{
 const f=fixture('IP'),store=new Store(':memory:');t.after(()=>store.close());const worker=createApprovalScheduler({adapter:f.adapter,store,enabled:true});
 await Promise.all([worker.run(),worker.run()]);await worker.run();assert.equal(f.state.updates,2);assert.equal(worker.status().receipts.executed,1);assert.equal(store.escalationHistory().receipts[0].result.to,'APR002');
 await worker.stop();await worker.run();assert.equal(f.state.updates,2);
});
test('disabled scheduler never scans or writes',async t=>{
 const f=fixture(),store=new Store(':memory:');t.after(()=>store.close());const w=createApprovalScheduler({adapter:f.adapter,store});await w.run();w.start();assert.equal(f.state.calls.length,0);await w.stop();
});
test('unknown commit and durable in-flight claim survive restart without retry',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'approval-test-'));t.after(()=>cleanup(dir));
 const path=join(dir,'audit.sqlite'),f=fixture('PC',{unknown:true});let store=new Store(path);const worker=createApprovalScheduler({adapter:f.adapter,store,enabled:true});await worker.run();assert.equal(worker.status().receipts.unknown,1);assert.equal(store.escalationHistory().receipts[0].result.planned.to,'APR002');const planIdentity=store.escalationHistory().receipts[0];store.close();
 store=new Store(path);assert.equal(store.claimEscalation({...planIdentity,identity:planIdentity.identity}),false);store.close();
});
test('SQL success followed by local receipt failure is uncertain, never marked retry',async t=>{
 const f=fixture(),store=new Store(':memory:');t.after(()=>store.close());const finish=store.finishEscalation.bind(store);let first=true;store.finishEscalation=(...a)=>{if(first){first=false;throw new Error('disk');}return finish(...a);};
 const worker=createApprovalScheduler({adapter:f.adapter,store,enabled:true});await worker.run();assert.equal(worker.status().receipts.unknown,1);assert.equal(f.state.updates,1);
});
test('safe rollback retries automatically',async t=>{
 const options={failAt:1},f=fixture('PC',options),store=new Store(':memory:');t.after(()=>store.close());const worker=createApprovalScheduler({adapter:f.adapter,store,enabled:true});
 await worker.run();assert.equal(worker.status().receipts.retry,1);options.failAt=0;await worker.run();assert.equal(worker.status().receipts.executed,1);
});
test('two service instances share durable claim, and old executing claims are not recycled',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'approval-test-'));const path=join(dir,'audit.sqlite'),a=new Store(path),b=new Store(path);t.after(()=>{a.close();b.close();cleanup(dir);});
 const f=fixture(),p=await f.adapter.prepare(f.target);assert.equal(a.claimEscalation(p),true);assert.equal(b.claimEscalation(p),false);assert.equal(a.claimEscalation(p),false);
});
test('bounded keyset pages advance between runs so early errors cannot starve later rows',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const cursors=[];
 const adapter={enabled:true,branches:['0101'],scan:async(b,after)=>{cursors.push(after);return Array.from({length:100},(_,i)=>({sucursal:b,registro:String(Number(after)+i+1),numero:'N',tipo:'PC'}));},prepare:async()=>{throw {code:'SIN_SUPERIOR'};}};
 const w=createApprovalScheduler({adapter,store,enabled:true,maxPages:1});await w.run();await w.run();assert.deepEqual(cursors,['0','100']);assert.equal(store.escalationHistory().issues.length,100);
});
test('automation receipts endpoint requires writer and capabilities exposes aggregate status',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const server=createApp({erp:createDemoErp(),kaiqen:createDemoKaiqen(),store,readKey:'r'.repeat(40),planKey:'p'.repeat(40),writeKey:'w'.repeat(40),approvalScheduler:{status:()=>({enabled:true})}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();});const base=`http://127.0.0.1:${server.address().port}`;
 for(const key of ['r','p'])assert.equal((await fetch(base+'/api/approvals/automation',{headers:{authorization:'Bearer '+key.repeat(40)}})).status,403);
 const response=await fetch(base+'/api/approvals/automation',{headers:{authorization:'Bearer '+'w'.repeat(40)}});assert.equal(response.status,200);assert.equal((await response.json()).status.enabled,true);
 const caps=await (await fetch(base+'/api/capabilities',{headers:{authorization:'Bearer '+'r'.repeat(40)}})).json();assert.equal(caps.approvalAutomation.enabled,true);
});

test('one invalid document or unavailable branch does not starve a valid pending approval',async t=>{
 const f=fixture(),store=new Store(':memory:');t.after(()=>store.close());
 f.state.rows.SCR.unshift({...f.state.rows.SCR[0],R_E_C_N_O_:'99',CR_NUM:'000002'});
 const scan=f.adapter.scan;f.adapter.branches=['9999','0101'];f.adapter.scan=(branch,after)=>branch==='9999'?Promise.reject({code:'SOURCE_ERROR'}):scan(branch,after);
 const worker=createApprovalScheduler({adapter:f.adapter,store,enabled:true});await worker.run();assert.equal(f.state.updates,1);assert.equal(worker.status().receipts.executed,1);assert.equal(worker.status().lastError,'SOURCE_ERROR');assert.equal(store.escalationHistory().issues.length,1);
});
for(const type of ['IP','PC'])test(type+' foreign currency escalation preserves the agreed rate and rejects mismatches',async()=>{
 const f=fixture(type);Object.assign(f.state.rows.SCR[0],{CR_MOEDA:'2',CR_TXMOEDA:'1518'});Object.assign(f.state.rows.SC7[0],{C7_MOEDA:'2',C7_TXMOEDA:'1518'});
 const p=await f.adapter.prepare(f.target);await f.adapter.execute(p);assert.equal(f.state.rows.SCR[0].CR_TXMOEDA,'1518');assert.equal(f.state.rows.SCR[0].CR_MOEDA,'2');assert.equal(f.state.rows.SCR[0].CR_TOTAL,'200');
 const other=fixture(type);Object.assign(other.state.rows.SCR[0],{CR_MOEDA:'2',CR_TXMOEDA:'1518'});Object.assign(other.state.rows.SC7[0],{C7_MOEDA:'2',C7_TXMOEDA:'1500'});await assert.rejects(other.adapter.prepare(other.target),{code:'MONEDA_NO_SOPORTADA'});
});

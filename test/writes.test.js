import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWriter} from '../src/protheus/writer.js';
import {writeProfiles} from '../src/protheus/write-policy.js';
import {transact} from '../src/protheus/database.js';
import {Changes} from '../src/changes.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/app.js';
import {createDemoKaiqen} from '../src/demo.js';
import {createIntelligence} from '../src/intelligence/agent.js';

function fixture(action='pedidoVenta',options={}){
 const p=writeProfiles[action],prefix=p.alias==='SC6'?'C6':p.alias==='SC7'?'C7':p.alias;
 const row={R_E_C_N_O_:'9007199254740993',D_E_L_E_T_:' ',[p.branch]:p.alias==='DA1'?'01':'0101',[p.product]:'ZTEST',[p.price]:'0.08',S_T_A_M_P_:'2026-01-01'};
 for(const key of p.keys)row[key]=key===p.product?'ZTEST':'001';
 if(p.priceThousands)row[p.priceThousands]='80';
 if(p.quantity)Object.assign(row,{[p.quantity]:'1000',[p.total]:'80',[p.unit]:'UN'});
 if(p.thousands&&p.alias==='SC6')row[p.thousands]='1';
 for(const f of p.zero||[])row[f]='0';for(const f of p.blank||[])row[f]=' ';
 if(p.alias==='SC6')row.C6_PRUNIT='0.08';
 const state={row,product:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',B1_FILIAL:'0101',B1_COD:'ZTEST',B1_UM:'UN',B1_DESC:'Prueba'},header:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',C5_FILIAL:'0101',C5_NUM:'001',C5_NOTA:' ',C5_LIBEROK:' ',C5_BLQ:' ',C5_CONAPRO:' ',C5_FRETE:'0'},SC9:[],SD1:[],SD2:[],triggers:[],writes:0,commits:0,rollbacks:0,sql:[]};
 const specs={[p.price]:[p.alias==='AIB'||p.alias==='SC7'?4:6,14],...(p.quantity?{[p.quantity]:[2,12],[p.total]:[2,14]}:{}),DA1_PRCMIL:[4,12],C6_MILLAR:[6,14],C6_PRUNIT:[6,11]};
 const tables=new Map(),dictionary=new Map();
 function add(alias,data){const columns=new Map(Object.keys(data).map(k=>[k,{type:specs[k]||p.zero?.includes(k)||k==='C5_FRETE'?'float':'varchar'}]));tables.set(alias,{schema:'dbo',name:alias+'010',columns});}
 add(p.alias,row);add('SB1',state.product);add('SC5',state.header);
 for(const [alias,cols] of Object.entries({SC9:['C9_FILIAL','C9_PEDIDO','C9_ITEM'],SD2:['D2_FILIAL','D2_PEDIDO','D2_ITEMPV'],SD1:['D1_FILIAL','D1_PEDIDO','D1_ITEMPC','D1_FORNECE','D1_LOJA']}))add(alias,Object.fromEntries([...cols,'D_E_L_E_T_','R_E_C_N_O_'].map(k=>[k,''])));
 for(const [field,[scale,width]] of Object.entries(specs))dictionary.set(field,{X3_TIPO:'N',X3_DECIMAL:String(scale),X3_TAMANHO:String(width)});
 const catalog={table:a=>{assert.ok(tables.has(a),a);return tables.get(a);},dictionary,branch:(a,b)=>{assert.equal(b,'0101');return a==='DA1'?'01':'0101';}};
 async function query(sql,params={}){
  state.sql.push({sql,params});if(sql.includes('sys.triggers'))return state.triggers;
  if(sql.startsWith('DECLARE')){
   assert.match(sql,/WHERE \[\w+_FILIAL\]=@branch AND \[R_E_C_N_O_\]=CONVERT\(bigint,@record\) AND \[D_E_L_E_T_\]=' '/);
   assert.equal(params.record,row.R_E_C_N_O_);assert.equal(params.branch,catalog.branch(p.alias,'0101'));
   for(const m of sql.matchAll(/\[([A-Z0-9_]+)\]=CONVERT\(decimal\(\d+,\d+\),@(v\d+)\)/g))state.row[m[1]]=params[m[2]];
   state.row.S_T_A_M_P_='2026-10-19';state.writes++;
   if(options.unexpected)state.row[p.product]='OTHER';
   return [{affected:options.affected??1}];
  }
  const alias=/FROM \[dbo\]\.\[([A-Z0-9]+)010\]/.exec(sql)?.[1];
  const rows=alias===p.alias?[state.row]:alias==='SB1'?[state.product]:alias==='SC5'?[state.header]:state[alias];assert.ok(rows,sql);
  if(alias===p.alias&&params.k0!==row.R_E_C_N_O_)return [];
  return structuredClone(rows);
 }
 const db={query,async transaction(callback){const before=structuredClone(state.row);try{const result=await callback({query});if(options.unknown)throw Object.assign(new Error('commit lost'),{outcomeUnknown:true,code:'RESULTADO_INCIERTO'});state.commits++;return result;}catch(e){if(!e.outcomeUnknown){state.row=before;state.rollbacks++;}throw e;}}};
 const writes=createWriter({db,catalog,getWriteDb:async()=>db,enabled:options.enabled??true});
 const erp={writes,metadata:()=>({entities:{[p.resource]:{filters:{registro:''}}}}),list:async()=>({data:[{registro:row.R_E_C_N_O_}],meta:{}})};
 const input={action,target:{sucursal:'0101',registro:row.R_E_C_N_O_},changes:p.quantity?{precioUnitario:'80',cantidadPedida:'2.5'}:{precio:'90'},priceUnit:'millar',...(p.quantity?{quantityUnit:'millares'}:{})};
 const proposal=async()=>({action,target:input.target,input,writePlan:await writes.prepare(action,input)});
 return {p,state,catalog,db,writes,erp,input,proposal};
}

for(const action of Object.keys(writeProfiles))test(action+': updates one existing row; units, millares and totals agree',async()=>{
 const f=fixture(action),proposal=await f.proposal();assert.equal(f.state.writes,0);
 const result=await f.writes.execute(proposal);assert.equal(result.affected,1);assert.equal(f.state.commits,1);
 assert.equal(f.state.sql.filter(x=>x.sql.startsWith('DECLARE')).length,1);
 if(f.p.quantity){assert.equal(f.state.row[f.p.quantity],'2500.00');assert.equal(f.state.row[f.p.total],'200.00');if(action==='pedidoVenta')assert.equal(f.state.row.C6_MILLAR,'2.500000');else assert.equal(Object.hasOwn(f.state.row,'C7_MILLAR'),false);}
 else {assert.equal(Number(f.state.row[f.p.price]),0.09);if(action==='precioLista')assert.equal(f.state.row.DA1_PRCMIL,'90.0000');}
 const mutations=f.state.sql.filter(x=>x.sql.startsWith('DECLARE'));assert.ok(mutations.every(x=>!/(?:INSERT INTO \[|DELETE FROM|MERGE|CREATE TABLE)/i.test(x.sql)));
 assert.ok(f.state.sql.some(x=>x.sql.includes('WITH (UPDLOCK,HOLDLOCK)')));
});
test('price change updates net, base list price and total atomically',async()=>{
 const f=fixture();f.input.changes={precioUnitario:'85.123'};const p=await f.proposal();await f.writes.execute(p);
 assert.equal(f.state.row.C6_PRCVEN,'0.085123');assert.equal(f.state.row.C6_PRUNIT,'0.085123');assert.equal(f.state.row.C6_VALOR,'85.12');assert.equal(f.state.row.C6_QTDVEN,'1000');
});
test('rejects injected keys, nonexistent rows, forbidden fields, precision loss, arbitrary total and non-UN conversion',async()=>{
 for(const mutate of [f=>f.input.target.registro='1 OR 1=1',f=>f.input.target.sucursal='9999',f=>f.input.target.registro='99',f=>f.input.changes.C6_NUM='2',f=>f.input.changes.precioUnitario='80.1234',f=>f.input.changes.total='201',f=>f.input.quantityUnit=undefined,f=>f.state.product.B1_UM='KG',f=>f.catalog.dictionary.delete('C6_VALOR'),f=>f.catalog.table('SC6').columns.get('C6_VALOR').computed=true]){
  const f=fixture();mutate(f);await assert.rejects(f.proposal());assert.equal(f.state.writes,0);
 }
});
test('rejects stale price, product unit, header and new releases/documents inside the transaction',async()=>{
 for(const mutate of [f=>f.state.row.C6_PRCVEN='0.09',f=>f.state.product.B1_DESC='changed',f=>f.state.header.C5_NUM='002',f=>f.state.SC9.push({id:1}),f=>f.state.SD2.push({id:1})]){
  const f=fixture(),p=await f.proposal();mutate(f);await assert.rejects(f.writes.execute(p));assert.equal(f.state.writes,0);assert.equal(f.state.rollbacks,1);
 }
});
test('rejects fulfilled, discounted, fiscal or dependent orders and unknown triggers before UPDATE',async()=>{
 for(const [action,mutate] of [
  ['pedidoVenta',f=>f.state.row.C6_QTDENT='1'],['pedidoVenta',f=>f.state.row.C6_VALOR='81'],['pedidoVenta',f=>f.state.row.C6_PRUNIT='0.1'],['pedidoVenta',f=>f.state.header.C5_FRETE='10'],['pedidoVenta',f=>f.state.row.C6_BLQ='S'],['pedidoCompra',f=>f.state.row.C7_QUJE='1'],['pedidoCompra',f=>f.state.row.C7_VALICM='1'],['pedidoCompra',f=>f.state.row.C7_DESC='2'],['pedidoCompra',f=>f.state.row.C7_CONAPRO='L'],['pedidoCompra',f=>f.state.SD1.push({id:1})],['precioLista',f=>f.state.triggers.push({name:'unreviewed',definition:'...'})]
 ]){const f=fixture(action);mutate(f);await assert.rejects(f.proposal());assert.equal(f.state.writes,0);}
});
test('post-write mismatch and affected count failures roll back everything',async()=>{
 for(const options of [{affected:0},{affected:2},{unexpected:true}]){const f=fixture('pedidoVenta',options),before=structuredClone(f.state.row);await assert.rejects(f.writes.execute(await f.proposal()));assert.deepEqual(f.state.row,before);assert.equal(f.state.commits,0);assert.equal(f.state.rollbacks,1);}
});
function changesFixture(t,options={}){const f=fixture('pedidoVenta',options),store=new Store(':memory:');t.after(()=>store.close());return {...f,store,changes:new Changes({erp:f.erp,store,read:f.erp.list})};}
test('proposal is actor scoped; confirmation required; execution receipt makes retries idempotent',async t=>{
 const f=changesFixture(t),p=await f.changes.preview('actor',f.input);assert.equal(p.writePlan,undefined);assert.ok(p.diff.length);
 await assert.rejects(f.changes.execute('other',p.id,{confirm:true,fingerprint:p.fingerprint}),{code:'PROPUESTA_NO_EXISTE'});
 await assert.rejects(f.changes.execute('actor',p.id,{confirm:false,fingerprint:p.fingerprint}),{code:'CONFIRMACION_REQUERIDA'});
 const confirm={confirm:true,fingerprint:p.fingerprint};const a=await f.changes.execute('actor',p.id,confirm),b=await f.changes.execute('actor',p.id,confirm);
 assert.equal(a.status,'executed');assert.deepEqual(a,b);assert.equal(f.state.writes,1);
});
test('expired, failed, concurrent and uncertain attempts cannot execute a second time',async t=>{
 const f=changesFixture(t,{unknown:true}),p=await f.changes.preview('actor',f.input),confirm={confirm:true,fingerprint:p.fingerprint};
 const results=await Promise.allSettled([f.changes.execute('actor',p.id,confirm),f.changes.execute('actor',p.id,confirm)]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(f.state.writes,1);assert.equal(f.changes.status('actor',p.id).execution.status,'unknown');
 await assert.rejects(f.changes.execute('actor',p.id,confirm),{code:'EJECUCION_NO_REPETIBLE'});
 const g=changesFixture(t),expired=await g.changes.preview('a',g.input);const raw=g.store.get(expired.id,'a');raw.expiresAt='2000-01-01';g.store.db.prepare('UPDATE proposals SET body=? WHERE id=?').run(JSON.stringify(raw),expired.id);
 await assert.rejects(g.changes.execute('a',expired.id,{confirm:true,fingerprint:expired.fingerprint}),{code:'PROPUESTA_VENCIDA'});assert.equal(g.state.writes,0);
 const failed=await g.changes.preview('a',g.input);g.state.row.C6_QTDENT='1';await assert.rejects(g.changes.execute('a',failed.id,{confirm:true,fingerprint:failed.fingerprint}));assert.equal(g.changes.status('a',failed.id).execution.status,'failed');await assert.rejects(g.changes.execute('a',failed.id,{confirm:true,fingerprint:failed.fingerprint}),{code:'EJECUCION_NO_REPETIBLE'});
});
test('restart changes an interrupted execution to unknown, preserving receipt and preventing retry',()=>{
 const dir=mkdtempSync(join(tmpdir(),'etar-writes-')),path=join(dir,'test.sqlite');try{let store=new Store(path);const p=store.save('a',{});assert.equal(store.claim(p.id,'a'),true);store.close();store=new Store(path);assert.equal(store.execution(p.id,'a').status,'unknown');assert.equal(store.claim(p.id,'a'),false);store.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('driver transaction commits only on success; rollback and lost COMMIT are handled distinctly',async()=>{
 for(const mode of ['ok','body','begin','commit','rollback']){
  const tx=new EventEmitter(),calls=[];tx.begin=async()=>{calls.push('begin');if(mode==='begin')throw new Error('begin');};tx.commit=async()=>{calls.push('commit');if(mode==='commit')throw new Error('commit');};tx.rollback=async()=>{calls.push('rollback');if(mode==='rollback')throw new Error('rollback');};
  const run=()=>transact(tx,async()=>{calls.push('body');if(['body','rollback'].includes(mode))throw new Error('body');return 'ok';},()=>({query:async sql=>{assert.match(sql,/XACT_ABORT ON/);}}),4);
  if(mode==='ok')assert.equal(await run(),'ok');else await assert.rejects(run(),e=>['commit','rollback'].includes(mode)?e.outcomeUnknown===true:e.message===mode);
  if(mode==='begin')assert.deepEqual(calls,['begin']);if(mode==='body')assert.deepEqual(calls,['begin','body','rollback']);
 }
});

test('HTTP writer key executes; planner, reader and cross-origin sessions cannot execute',async t=>{
 const f=changesFixture(t),readKey='r'.repeat(40),planKey='p'.repeat(40),writeKey='w'.repeat(40);
 const server=createApp({erp:f.erp,kaiqen:createDemoKaiqen(),store:f.store,readKey,planKey,writeKey,localWrites:true});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();});
 const base=`http://127.0.0.1:${server.address().port}`,post=(path,key,body)=>fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)});
 const res=await post('/api/changes/preview',writeKey,f.input);assert.equal(res.status,201);const p=await res.json();const confirm={confirm:true,fingerprint:p.fingerprint};
 for(const key of [readKey,planKey])assert.equal((await post('/api/changes/'+p.id+'/execute',key,confirm)).status,403);
 const session=await fetch(base+'/api/ui/session',{method:'POST',headers:{origin:base}});assert.equal((await session.json()).role,'writer');const cookie=session.headers.get('set-cookie').split(';')[0];
 const cross=await fetch(base+'/api/changes/preview',{method:'POST',headers:{cookie,origin:'https://foreign.example','content-type':'application/json'},body:JSON.stringify(f.input)});assert.equal(cross.status,403);
 assert.equal((await post('/api/changes/'+p.id+'/execute',writeKey,confirm)).status,200);assert.equal(f.state.writes,1);
});
test('chat prepares from an observed RECNO and never invokes execute, including dictated text',async t=>{
 const f=changesFixture(t);const decisions=[{action:'consultar_erp',args:{recurso:'itemsVentas',filtros:{registro:f.input.target.registro}}},{action:'preparar_cambio',args:{accion:'pedidoVenta',registro:f.input.target.registro,precio:'80',basePrecio:'millar',cantidad:'2.5',baseCantidad:'millares'}}];
 const agent=createIntelligence({erp:f.erp,store:f.store,kaiqen:createDemoKaiqen(),branches:['0101'],read:f.erp.list,executeRead:f.erp.list,prepareChange:(actor,input)=>f.changes.preview(actor,input),model:{name:'test',complete:async()=>decisions.shift()}});
 const result=await agent.query('a',{text:'Cambiar este ítem a 2,5 millares a 80 por millar'},{canPlan:true});assert.equal(result.evidence.at(-1).result.kind,'proposal');assert.equal(f.state.writes,0);assert.match(result.answer,/Todavía no se modificó/);
});

test('binary float noise does not create an apparent price change at SX3 precision',async()=>{
 const f=fixture('precioLista');f.state.row.DA1_PRCVEN='0.080000000000000001';f.input.changes.precio='80';
 await assert.rejects(f.proposal(),{code:'SIN_CAMBIOS'});assert.equal(f.state.writes,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWriter,fingerprint} from '../src/protheus/writer.js';
import {purchaseCreationStatus} from '../src/protheus/purchase-creation.js';
import {writeProfiles} from '../src/protheus/write-policy.js';
import {releaseFields} from '../src/protheus/sales-balance.js';
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
 const state={row,product:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',B1_FILIAL:'0101',B1_COD:'ZTEST',B1_UM:'UN',B1_DESC:'Prueba'},header:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',C5_FILIAL:'0101',C5_NUM:'001',C5_NOTA:' ',C5_LIBEROK:' ',C5_BLQ:' ',C5_CONAPRO:' ',C5_FRETE:'0'},SC7:[],SC9:[],SD1:[],SD2:[],triggers:[],writes:0,commits:0,rollbacks:0,sql:[]};
 Object.assign(state.header,{C5_CLIENTE:'CLI001',C5_LOJACLI:'01',C5_TIPO:'N'});
 state.SX6=[{X6_FIL:' ',X6_VAR:'MV_ALTPREC',X6_CONTEUD:'T'},{X6_FIL:' ',X6_VAR:'MV_BLOQUEI',X6_CONTEUD:'.F.'}];
 const specs={[p.price]:[p.alias==='SC1'?2:p.alias==='AIB'||p.alias==='SC7'?4:6,14],...(p.quantity?{[p.quantity]:[2,12],[p.total]:[2,14]}:{}),DA1_PRCMIL:[4,12],C6_MILLAR:[6,14],C6_PRUNIT:[6,11],C6_QTDENT:[2,9],C9_QTDLIB:[2,9],C9_PRCVEN:[4,14]};
 const tables=new Map(),dictionary=new Map();
 function add(alias,data){const columns=new Map(Object.keys(data).map(k=>[k,{type:specs[k]||p.zero?.includes(k)||k==='C5_FRETE'?'float':'varchar'}]));tables.set(alias,{schema:'dbo',name:alias+'010',columns});}
 add(p.alias,row);if(p.alias==='SC1')add('SC7',{C7_FILIAL:'',C7_NUMSC:'',C7_ITEMSC:'',R_E_C_N_O_:'',D_E_L_E_T_:''});add('SB1',state.product);add('SC5',state.header);
 for(const [alias,cols] of Object.entries({SC9:releaseFields,SD2:['D2_FILIAL','D2_PEDIDO','D2_ITEMPV'],SD1:['D1_FILIAL','D1_PEDIDO','D1_ITEMPC','D1_FORNECE','D1_LOJA'],SX6:['X6_FIL','X6_VAR','X6_CONTEUD']}))add(alias,Object.fromEntries([...cols,'D_E_L_E_T_','R_E_C_N_O_'].map(k=>[k,''])));
 for(const [field,[scale,width]] of Object.entries(specs))dictionary.set(field,{X3_TIPO:'N',X3_DECIMAL:String(scale),X3_TAMANHO:String(width)});
 const catalog={table:a=>{assert.ok(tables.has(a),a);return tables.get(a);},dictionary,branch:(a,b)=>{assert.equal(b,'0101');return a==='DA1'?'01':'0101';}};
 async function query(sql,params={}){
  state.sql.push({sql,params});if(sql.includes('sys.triggers'))return state.triggers;
  if(sql.startsWith('DECLARE')){
   assert.match(sql,/WHERE \[\w+_FILIAL\]=@branch AND \[R_E_C_N_O_\]=CONVERT\(bigint,@record\) AND \[D_E_L_E_T_\]=' '/);
   const alias=/UPDATE \[dbo\]\.\[([A-Z0-9]+)010\]/.exec(sql)[1];
   assert.equal(params.branch,catalog.branch(alias,'0101'));
   const target=alias===p.alias?state.row:state.SC9.find(r=>r.R_E_C_N_O_===params.record);assert.ok(target);assert.equal(params.record,target.R_E_C_N_O_);
   for(const m of sql.matchAll(/\[([A-Z0-9_]+)\]=CONVERT\(decimal\(\d+,\d+\),@(v\d+)\)/g))target[m[1]]=params[m[2]];
   target.S_T_A_M_P_='2026-10-19';state.writes++;
   if(options.unexpected)state.row[p.product]='OTHER';
   if(options.afterWrite)options.afterWrite(state,alias);
   return [{affected:alias==='SC9'?(options.releaseAffected??1):(options.affected??1)}];
  }
  const alias=/FROM \[dbo\]\.\[([A-Z0-9]+)010\]/.exec(sql)?.[1];
  const rows=alias===p.alias?[state.row]:alias==='SB1'?[state.product]:alias==='SC5'?[state.header]:state[alias];assert.ok(rows,sql);
  if(alias===p.alias&&params.k0!==row.R_E_C_N_O_)return [];
  return structuredClone(rows).sort((a,b)=>BigInt(a.R_E_C_N_O_||0)<BigInt(b.R_E_C_N_O_||0)?-1:1);
 }
 const db={query,async transaction(callback){const before=structuredClone({row:state.row,SC9:state.SC9,SD2:state.SD2,header:state.header,product:state.product});try{const result=await callback({query});if(options.unknown)throw Object.assign(new Error('commit lost'),{outcomeUnknown:true,code:'RESULTADO_INCIERTO'});state.commits++;return result;}catch(e){if(!e.outcomeUnknown){Object.assign(state,before);state.rollbacks++;}throw e;}}};
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
 const session=await fetch(base+'/api/auth/setup',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({username:'admin',name:'Admin prueba',password:'Clave-de-prueba-123'})});assert.equal((await session.json()).user.role,'writer');const cookie=session.headers.get('set-cookie').split(';')[0];
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

function release(record,quantity,extra={}){
 return {...Object.fromEntries(releaseFields.map(f=>[f,' '])),R_E_C_N_O_:record,D_E_L_E_T_:' ',C9_FILIAL:'0101',C9_PEDIDO:'001',C9_ITEM:'001',C9_PRODUTO:'ZTEST',C9_CLIENTE:'CLI001',C9_LOJA:'01',C9_QTDLIB:quantity,C9_PRCVEN:'0.08',C9_SEQUEN:record,...extra};
}
function partialFixture(options={}){
 const f=fixture('pedidoVenta',options);f.input.changes={precioUnitario:'90'};
 f.state.row.C6_QTDENT='400';f.state.row.C6_NOTA='F001';f.state.header.C5_LIBEROK='S';
 f.state.SC9=[release('1','400',{C9_NFISCAL:'F001',C9_SERIENF:'A',C9_BLCRED:'10',C9_BLEST:'10'}),release('2','200'),release('3','100',{C9_BLEST:'02'}),release('4','100')];
 f.state.SD2=[{R_E_C_N_O_:'12',D_E_L_E_T_:' ',D2_FILIAL:'0101',D2_PEDIDO:'001',D2_ITEMPV:'001',D2_DOC:'F001',D2_SERIE:'A',D2_COD:'ZTEST',D2_CLIENTE:'CLI001',D2_LOJA:'01',D2_QUANT:'400',D2_TOTAL:'32',D2_PRCVEN:'0.08',D2_MILLAR:'0.4'}];
 return f;
}
test('partial sale reprices SC6 and ALL pending SC9 rows, retaining invoices, quantities and release states',async()=>{
 const f=partialFixture(),before=structuredClone(f.state),p=await f.proposal();
 assert.equal(p.writePlan.relatedUpdates.length,3);assert.equal(p.writePlan.calculation.totalPendiente,'54.00');assert.equal(p.writePlan.calculation.millaresPendientes,'0.6');assert.equal(p.writePlan.calculation.totalPedidoReferencia,'90.00');
 const receipt=await f.writes.execute(p);assert.equal(receipt.affected,4);assert.equal(f.state.row.C6_VALOR,'90.00');
 for(const field of ['C6_QTDENT','C6_QTDVEN','C6_MILLAR','C6_NOTA','C6_QTDLIB','C6_QTDEMP'])assert.equal(f.state.row[field],before.row[field]);
 assert.deepEqual(f.state.SC9[0],before.SC9[0]);assert.deepEqual(f.state.SD2,before.SD2);assert.deepEqual(f.state.header,before.header);
 for(const r of f.state.SC9.slice(1)){assert.equal(r.C9_PRCVEN,'0.0900');const old=before.SC9.find(x=>x.R_E_C_N_O_===r.R_E_C_N_O_);for(const k of Object.keys(old))if(k!=='C9_PRCVEN')assert.equal(r[k],old[k]);}
 assert.ok(f.state.sql.filter(x=>x.sql.startsWith('DECLARE')).every(x=>/UPDATE \[dbo\]\.\[SC[69]010\]/.test(x.sql)));
 assert.ok(f.state.sql.some(x=>x.sql.includes('TOP (501)')&&x.sql.includes('WITH (UPDLOCK,HOLDLOCK)')&&x.sql.includes('ORDER BY [R_E_C_N_O_]')));
});
test('released unbilled sale changes only price fields, preserving inconsistent legacy MILLAR rather than rewriting quantity',async()=>{
 const f=fixture();f.input.changes={precioUnitario:'90'};f.state.header.C5_LIBEROK='S';f.state.SC9=[release('2','1000')];f.state.row.C6_QTDEMP='1000';f.state.row.C6_MILLAR='0';
 const p=await f.proposal();assert.equal(p.writePlan.updates.C6_MILLAR,undefined);await f.writes.execute(p);assert.equal(f.state.row.C6_MILLAR,'0');assert.equal(f.state.SC9[0].C9_PRCVEN,'0.0900');
});
test('partial without pending releases can update future balance with credit control enabled, freezing remito and factura',async()=>{
 const f=partialFixture();f.state.SC9=f.state.SC9.slice(0,1);f.state.SC9[0].C9_REMITO='R001';f.state.SX6[1].X6_CONTEUD='.T.';
 const before=structuredClone(f.state.SC9),p=await f.proposal();assert.equal(p.writePlan.executionEnabled,true);assert.equal((await f.writes.execute(p)).affected,1);assert.deepEqual(f.state.SC9,before);
});
test('authorized SQL repricing with active credit preserves flags, documents and parameters and discloses missing revalidation',async t=>{
 const f=partialFixture();f.state.SX6[1].X6_CONTEUD='.T.';const before=structuredClone(f.state);const store=new Store(':memory:');t.after(()=>store.close());const changes=new Changes({erp:f.erp,store,read:f.erp.list});
 const p=await changes.preview('a',f.input);assert.equal(p.executionEnabled,true);assert.deepEqual(p.blockers,[]);assert.equal(p.warnings[0].code,'PRECIO_SQL_SIN_REVALIDACION');assert.equal((await changes.check('a',p.id)).executionEnabled,true);
 const receipt=await changes.execute('a',p.id,{confirm:true,fingerprint:p.fingerprint});assert.equal(receipt.status,'executed');assert.equal(receipt.result.nativeCreditRevalidation,false);assert.deepEqual(receipt.result.warnings,p.warnings);
 assert.equal(f.state.writes,4);assert.deepEqual(f.state.SX6,before.SX6);assert.deepEqual(f.state.SD2,before.SD2);assert.deepEqual(f.state.SC9[0],before.SC9[0]);
 for(let i=1;i<f.state.SC9.length;i++)for(const k of ['C9_BLCRED','C9_BLEST','C9_QTDLIB'])assert.equal(f.state.SC9[i][k],before.SC9[i][k]);
});

test('price-only repricing preserves all secondary-unit quantities and identifiers',async()=>{
 const f=partialFixture();Object.assign(f.state.row,{C6_SEGUM:'MI',C6_QTDENT2:'0.4',C6_QTDLIB2:'0.4',C6_QTDEMP2:'1'});f.state.SC9[1].C9_QTDLIB2='0.2';const before=structuredClone(f.state);
 await f.writes.execute(await f.proposal());for(const k of ['C6_SEGUM','C6_QTDENT2','C6_QTDLIB2','C6_QTDEMP2'])assert.equal(f.state.row[k],before.row[k]);assert.equal(f.state.SC9[1].C9_QTDLIB2,'0.2');
});

test('SC1 refuses attended, approved or linked requests and updates only an existing uncommitted item',async()=>{
 for(const mutate of [f=>f.state.row.C1_QUJE='1',f=>f.state.row.C1_APROV='L',f=>f.state.row.C1_COTACAO='001',f=>f.state.row.C1_PEDIDO='001',f=>f.state.SC7.push({R_E_C_N_O_:'1'}),f=>f.state.row.C1_SEGUM='MI']){
  const f=fixture('solicitudCompra');mutate(f);await assert.rejects(f.proposal());assert.equal(f.state.writes,0);
 }
 const f=fixture('solicitudCompra'),p=await f.proposal();f.state.SC7.push({R_E_C_N_O_:'1'});await assert.rejects(f.writes.execute(p));assert.equal(f.state.writes,0);
});

test('missing credit parameter and restrictive repricing policy cannot become executable',async()=>{
 for(const mutate of [f=>f.state.SX6.pop(),f=>f.state.SX6[0].X6_CONTEUD='F',f=>f.state.SX6[0].X6_CONTEUD='L',f=>f.state.SX6[0].X6_CONTEUD='']){
  const f=partialFixture();mutate(f);const p=await f.proposal();assert.equal(p.writePlan.executionEnabled,false);await assert.rejects(f.writes.execute(p));assert.equal(f.state.writes,0);
 }
});
test('branch-specific SX6 overrides global values; duplicates fail closed',async()=>{
 const f=partialFixture();f.state.SX6.push({X6_FIL:'0101',X6_VAR:'MV_BLOQUEI',X6_CONTEUD:'.T.'});assert.equal((await f.proposal()).writePlan.warnings[0].code,'PRECIO_SQL_SIN_REVALIDACION');
 f.state.SX6.push({...f.state.SX6[2]});await assert.rejects(f.proposal(),{code:'PARAMETRO_AMBIGUO'});
});
test('fulfilment, quantity changes, negative secondary quantities, logistics and ambiguous releases are rejected',async()=>{
 for(const mutate of [f=>f.state.row.C6_QTDENT='1000',f=>f.state.row.C6_QTDENT='0',f=>f.state.SC9[0].C9_QTDLIB='300',f=>f.input.changes.cantidadPedida='2',f=>f.state.SC9[1].C9_QTDLIB='700',f=>f.state.SC9[1].C9_NFISCAL='F002',f=>f.state.SC9[1].C9_BLCRED='10',f=>f.state.SC9[1].C9_BLCRED='01',f=>f.state.SC9[1].C9_BLWMS='01',f=>f.state.SC9[1].C9_CARGA='001',f=>f.state.SC9[1].C9_SERIENF='A',f=>f.state.SC9[1].C9_QTDLIB2='-1',f=>f.state.SC9[1].C9_PRODUTO='OTHER',f=>f.state.SC9[1].C9_CLIENTE='OTHER',f=>f.state.SC9[1].C9_PRCVEN='0.1',f=>f.state.SD2=[],f=>f.state.SD2[0].D2_COD='OTHER',f=>f.state.header.C5_TIPO='C',f=>f.state.header.C5_CONAPRO='L',f=>delete f.state.SC9[1].C9_REMITO]){
  const f=partialFixture();mutate(f);await assert.rejects(f.proposal());assert.equal(f.state.writes,0);
 }
});
test('SC9 lower precision rejects silent rounding of a unit price valid in SC6',async()=>{
 const f=partialFixture();f.input.changes.precioUnitario='90.001';await assert.rejects(f.proposal(),{code:'PRECISION_INVALIDA'});
});
test('new billing, remito, release, price, parameter or invoice amount after preview prevents every UPDATE',async()=>{
 for(const mutate of [f=>f.state.row.C6_QTDENT='500',f=>f.state.SC9[1].C9_REMITO='R002',f=>f.state.SC9[1].C9_PRCVEN='0.09',f=>f.state.SC9.push(release('5','50')),f=>f.state.SD2[0].D2_TOTAL='33',f=>f.state.SX6[1].X6_CONTEUD='.T.',f=>f.state.SC9[1].C9_BLEST='02']){
  const f=partialFixture(),p=await f.proposal();mutate(f);await assert.rejects(f.writes.execute(p));assert.equal(f.state.writes,0);assert.equal(f.state.rollbacks,1);
 }
});
test('failure on a later SC9 row or collateral invoice/history update rolls back SC6 and all releases',async()=>{
 for(const options of [{releaseAffected:0},{releaseAffected:2},{afterWrite:(s,a)=>{if(a==='SC9')s.SD2[0].D2_TOTAL='999';}},{afterWrite:(s,a)=>{if(a==='SC9')s.SC9[0].C9_PRCVEN='99';}},{afterWrite:(s,a)=>{if(a==='SC9')s.SC9[1].C9_QTDLIB='201';}}]){
  const f=partialFixture(options),before=structuredClone({row:f.state.row,releases:f.state.SC9,documents:f.state.SD2});await assert.rejects(f.writes.execute(await f.proposal()));assert.deepEqual({row:f.state.row,releases:f.state.SC9,documents:f.state.SD2},before);assert.equal(f.state.commits,0);
 }
});
test('oversized and duplicate dependency sets are never silently truncated',async()=>{
 const f=partialFixture();f.state.SC9=Array.from({length:501},(_,i)=>release(String(i+1),'1'));await assert.rejects(f.proposal(),{code:'DEPENDENCIAS_EXCEDIDAS'});
 f.state.SC9=[release('1','1'),release('1','1')];await assert.rejects(f.proposal(),{code:'DEPENDENCIAS_NO_UNICAS'});
});
test('purchase receipts remain protected with a precise native-circuit reason',async()=>{
 const f=fixture('pedidoCompra');f.input.changes={precioUnitario:'90'};f.state.row.C7_QUJE='400';await assert.rejects(f.proposal(),{code:'COMPRA_ATENDIDA_REQUIERE_PROTHEUS'});assert.equal(f.state.writes,0);
});
test('chat explains blocked credit preview and HTTP execute rejects it without business UPDATE',async t=>{
 const f=partialFixture();f.state.SX6.pop();const store=new Store(':memory:');t.after(()=>store.close());const changes=new Changes({erp:f.erp,store,read:f.erp.list});
 const decisions=[{action:'consultar_erp',args:{recurso:'itemsVentas',filtros:{registro:f.input.target.registro}}},{action:'preparar_cambio',args:{accion:'pedidoVenta',registro:f.input.target.registro,precio:'90',basePrecio:'millar'}}];
 const agent=createIntelligence({erp:f.erp,store,kaiqen:createDemoKaiqen(),branches:['0101'],read:f.erp.list,executeRead:f.erp.list,prepareChange:(actor,input)=>changes.preview(actor,input),model:{name:'test',complete:async()=>decisions.shift()}});
 const reply=await agent.query('a',{text:'Cambiar a 90 por millar el saldo pendiente de este pedido liberado'},{canPlan:true});assert.match(reply.answer,/no puede ejecutarse/);assert.match(reply.answer,/MV_BLOQUEI/);assert.doesNotMatch(reply.answer,/requiere tu confirmación/);
 const key='w'.repeat(40),server=createApp({erp:f.erp,kaiqen:createDemoKaiqen(),store,readKey:'r'.repeat(40),planKey:'p'.repeat(40),writeKey:key});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();});
 const base=`http://127.0.0.1:${server.address().port}`,post=(path,body)=>fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)});
 const res=await post('/api/changes/preview',f.input);assert.equal(res.status,201);const p=await res.json();assert.equal(p.executionEnabled,false);assert.equal(p.blockers[0].code,'CREDITO_NO_VERIFICABLE');
 const capabilities=await (await fetch(base+'/api/capabilities',{headers:{authorization:'Bearer '+key}})).json();
 assert.equal(capabilities.canExecute,true);assert.equal(capabilities.writePolicy.transport,'sql');assert.equal(capabilities.writePolicy.nativeCreditRevalidation,false);assert.equal(capabilities.writePolicy.protheusRest,false);
 assert.match(p.blockers[0].message,/MV_BLOQUEI/);assert.match(p.blockers[0].message,/verificar/);
 const result=await post('/api/changes/'+p.id+'/execute',{confirm:true,fingerprint:p.fingerprint});assert.equal(result.status,409);assert.equal(f.state.writes,0);
});


test('creation reports real RECNO identity but never enables incomplete inserts or saves a fake proposal',async t=>{
 const tables=new Map(['SC1','SC7'].map(alias=>[alias,{columns:new Map([['R_E_C_N_O_',{identity:false}]])}]));
 const status=purchaseCreationStatus({tables});assert.equal(status.crearSolicitudCompra.recnoIdentity,false);assert.equal(status.crearPedidoCompra.executionEnabled,false);
 tables.get('SC1').columns.get('R_E_C_N_O_').identity=true;assert.equal(purchaseCreationStatus({tables}).crearSolicitudCompra.executionEnabled,false);
 const f=changesFixture(t);for(const action of ['crearSolicitudCompra','crearPedidoCompra'])await assert.rejects(f.changes.preview('a',{action,target:{sucursal:'0101'},items:[]}),{code:'CABECERA_INVALIDA'});
 assert.equal(f.state.writes,0);assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM proposals').get().n,0);
});

test('proposals prepared under an older credit policy cannot execute after upgrade',async()=>{
 const f=partialFixture(),p=await f.proposal();delete p.writePlan.snapshot.policyVersion;p.writePlan.snapshotHash=fingerprint(p.writePlan.snapshot);
 await assert.rejects(f.writes.execute(p),{code:'CONFLICTO_CONCURRENCIA'});assert.equal(f.state.writes,0);
});

test('HTTP executes active-credit price-only proposal and chat discloses retained credit state',async t=>{
 const f=partialFixture();f.state.SX6[1].X6_CONTEUD='.T.';const store=new Store(':memory:');t.after(()=>store.close());const changes=new Changes({erp:f.erp,store,read:f.erp.list});
 const decisions=[{action:'consultar_erp',args:{recurso:'itemsVentas',filtros:{registro:f.input.target.registro}}},{action:'preparar_cambio',args:{accion:'pedidoVenta',registro:f.input.target.registro,precio:'90',basePrecio:'millar'}}];
 const agent=createIntelligence({erp:f.erp,store,kaiqen:createDemoKaiqen(),branches:['0101'],read:f.erp.list,executeRead:f.erp.list,prepareChange:(actor,input)=>changes.preview(actor,input),model:{name:'test',complete:async()=>decisions.shift()}});
 const reply=await agent.query('a',{text:'Cambiar el precio a 90 por millar de este pedido liberado'},{canPlan:true});assert.match(reply.answer,/requiere tu confirmación/);assert.match(reply.answer,/No ejecuta análisis nativo/);assert.equal(f.state.writes,0);
 const key='w'.repeat(40),server=createApp({erp:f.erp,kaiqen:createDemoKaiqen(),store,readKey:'r'.repeat(40),planKey:'p'.repeat(40),writeKey:key});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();});
 const base=`http://127.0.0.1:${server.address().port}`,post=(path,body)=>fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)});
 const res=await post('/api/changes/preview',f.input);assert.equal(res.status,201);const p=await res.json();assert.equal(p.executionEnabled,true);assert.equal(p.warnings[0].code,'PRECIO_SQL_SIN_REVALIDACION');
 const result=await post('/api/changes/'+p.id+'/execute',{confirm:true,fingerprint:p.fingerprint});assert.equal(result.status,200);assert.equal(f.state.writes,4);assert.equal((await result.json()).result.nativeCreditRevalidation,false);
});

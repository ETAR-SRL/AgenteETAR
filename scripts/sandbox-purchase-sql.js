// Opt-in SQL Server LocalDB fixture. Does not load .env, Store, or remote ERP data.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sandboxConnection} from './sandbox-sql-transport.js';
import {sandboxFixture} from './sandbox-purchase-fixture.js';
import {writeProfiles} from '../src/protheus/write-policy.js';
import {createWriter} from '../src/protheus/writer.js';
import {sandboxHttpConfirmation} from './sandbox-http-confirmation.js';
if(process.argv[2]!=='--run-local-synthetic')throw Error('Explicit --run-local-synthetic required');
const database='AgenteSqlSandbox_'+randomBytes(8).toString('hex'),token=randomBytes(32).toString('hex');
const admin=sandboxConnection({database,token,bootstrap:true});
const q=s=>'['+s.replaceAll(']',']]')+']';
const connections=[admin];
const report={kind:'SQL Server LocalDB synthetic fixture',database,productionBusinessWrites:0,cases:[],nativeProtheusValidated:false};
async function insert(table,row){const keys=Object.keys(row);await admin.query(`INSERT dbo.${q(table)} (${keys.map(q)}) VALUES (${keys.map((_,i)=>'@p'+i)})`,Object.fromEntries(keys.map((key,i)=>['p'+i,row[key]])));}
async function seed(alias){
 const f=sandboxFixture(alias,{sqlDb:admin});
 const profile=writeProfiles[alias==='SC1'?'solicitudCompra':'pedidoCompra'];
 for(const [fields,type]of [[profile.zero,'float'],[profile.blank,'varchar']])for(const field of fields)if(!f.catalog.table(alias).columns.has(field)){
  f.columns.push({field,type,definition:type==='float'?'((0))':"(' ')"});f.catalog.table(alias).columns.set(field,{type});
 }
 const related=alias==='SC1'?{SC7:['C7_FILIAL','C7_NUMSC','C7_ITEMSC','D_E_L_E_T_','R_E_C_N_O_']}:{SD1:['D1_FILIAL','D1_PEDIDO','D1_ITEMPC','D1_FORNECE','D1_LOJA','D_E_L_E_T_','R_E_C_N_O_']};
 for(const [a,fields]of Object.entries(related))f.catalog.tables.set(a,{schema:'dbo',name:a+'010',columns:new Map(fields.map(field=>[field,{type:'varchar'}]))});
 // Each scenario has its own schema state; the identity marker survives.
 const existing=await admin.query("SELECT name FROM sys.tables WHERE name<>'SandboxIdentity'");
 for(const {name}of existing)await admin.query('DROP TABLE dbo.'+q(name));
 for(const [a,t]of f.catalog.tables){
  const fields=a==='SX3'?['X3_ARQUIVO','X3_CAMPO','X3_TIPO','X3_TAMANHO','X3_DECIMAL','X3_OBRIGAT','D_E_L_E_T_']:Array.from(t.columns.keys());
  const metadata=a===alias?f.columns:f.circuitColumns[a];
  const definitions=fields.map(field=>{const c=metadata?.find(c=>c.field===field);const type=c?.type||t.columns.get(field)?.type||'varchar';return `${q(field)} ${type==='varchar'?'varchar(512)':type} NOT NULL DEFAULT ${c?.definition||(type==='varchar'?"(' ')":'((0))')}${field==='R_E_C_N_O_'?' PRIMARY KEY':''}`;});
  await admin.query(`CREATE TABLE dbo.${q(t.name)} (${definitions})`);
 }
 for(const sx of f.dictionary.values())await insert('SX3010',{...sx,D_E_L_E_T_:' '});
 for(const [a,row]of Object.entries(f.refs))await insert(a+'010',row);
 for(const row of [...f.state.parameters,...f.state.currencyParameters,...f.state.importParameters])await insert('SX6010',{...row,D_E_L_E_T_:' '});
 for(const row of f.state.rows)await insert(alias+'010',row);
 return f;
}
try{
 await admin.query('SELECT 1 ready');
 const wrongIdentity=sandboxConnection({database,token:'0'.repeat(64)});connections.push(wrongIdentity);
 await assert.rejects(wrongIdentity.query("CREATE TABLE dbo.UnsafeAttempt(id int)"),/SANDBOX_IDENTITY_MISMATCH/);
 assert.equal((await admin.query("SELECT COUNT(*) count FROM sys.tables WHERE name='UnsafeAttempt'"))[0].count,0);
 report.cases.push({case:'wrong fixture token refuses DDL before mutation',before:0,after:0});
 for(const alias of ['SC1','SC7']){
  const f=await seed(alias);f.input.items.push({...f.input.items[0],cantidad:'1'});
  const proposal=await f.proposal();const before=await admin.query(`SELECT COUNT(*) count FROM dbo.${alias}010`);assert.equal(before[0].count,1);
  const receipt=await f.writes.execute(proposal);assert.equal(receipt.affected,2);assert.equal(receipt.number,'000100');assert.deepEqual(receipt.records,['9007199254740994','9007199254740995']);
  assert.equal((await admin.query(`SELECT COUNT(*) count FROM dbo.${alias}010`))[0].count,3);
  report.cases.push({alias,case:'existing executor committed two items',before:1,after:3,records:receipt.records});
  // Change a catalog after preparing: the executor must reject and leave count unchanged.
  const stale=await f.proposal();await admin.query("UPDATE dbo.SB1010 SET B1_DESC='Changed fixture'");
  await assert.rejects(f.writes.execute(stale),{code:'CONFLICTO_CONCURRENCIA'});
  assert.equal((await admin.query(`SELECT COUNT(*) count FROM dbo.${alias}010`))[0].count,3);
  report.cases.push({alias,case:'catalog revalidation rejects stale preview',before:3,after:3});
  await admin.query("UPDATE dbo.SB1010 SET B1_DESC='Prueba'");
  // Fault after the second INSERT; same SQL connection/transaction must remove both.
  const rollback=await f.proposal();let inserts=0;
  const faultDb={query:admin.query,transaction:callback=>admin.transaction(tx=>callback({query:async(sql,params)=>{const rows=await tx.query(sql,params);if(sql.startsWith('DECLARE @inserted')&&++inserts===2)throw Error('SYNTHETIC_FAILURE_AFTER_SECOND_INSERT');return rows;}}))};
  const faulty=createWriter({db:faultDb,catalog:f.catalog,getWriteDb:async()=>faultDb,enabled:true});
  await assert.rejects(faulty.execute(rollback),/SYNTHETIC_FAILURE_AFTER_SECOND_INSERT/);
  assert.equal(inserts,2);assert.equal((await admin.query(`SELECT COUNT(*) count FROM dbo.${alias}010`))[0].count,3);
  report.cases.push({alias,case:'same-session transaction rolls back two actual inserts',before:3,after:3});
  const a=sandboxConnection({database,token}),b=sandboxConnection({database,token});connections.push(a,b);
  const fa=createWriter({db:a,catalog:f.catalog,getWriteDb:async()=>a,enabled:true}),fb=createWriter({db:b,catalog:f.catalog,getWriteDb:async()=>b,enabled:true});
  const makeProposal=async writer=>{const input=structuredClone(f.input);input.items=input.items.slice(0,1);return {action:f.action,input,target:input.target,writePlan:await writer.prepare(f.action,input)};};
  const [pa,pb]=await Promise.all([makeProposal(fa),makeProposal(fb)]);
  const concurrent=await Promise.all([fa.execute(pa),fb.execute(pb)]);
  assert.equal(new Set(concurrent.map(r=>r.number)).size,2);assert.equal(new Set(concurrent.flatMap(r=>r.records)).size,2);
  assert.equal((await admin.query(`SELECT COUNT(*) count FROM dbo.${alias}010`))[0].count,5);
  report.cases.push({alias,case:'two concurrent SQL sessions allocate unique document and bigint RECNO',before:3,after:5,numbers:concurrent.map(r=>r.number),records:concurrent.flatMap(r=>r.records)});
  // Separate synthetic simple existing item: creation L/second-unit states are not
  // silently accepted by the UPDATE executor, so make this setup explicit.
  const prefix=alias==='SC1'?'C1':'C7',record=receipt.records[0];
  await admin.query(`UPDATE dbo.${alias}010 SET ${prefix}_SEGUM=' ',${prefix}_QTSEGUM=0,${prefix}_${alias==='SC1'?'APROV':'CONAPRO'}=' ' WHERE R_E_C_N_O_=CONVERT(bigint,@record)`,{record});
  const action=alias==='SC1'?'solicitudCompra':'pedidoCompra',target={sucursal:'0101',registro:record},input={target,changes:{precioUnitario:'0.1'}};
  const writePlan=await f.writes.prepare(action,input);assert.equal(writePlan.executionEnabled,true);
  const updated=await f.writes.execute({action,target,input,writePlan});assert.equal(updated.affected,1);
  const saved=await admin.query(`SELECT CONVERT(varchar(30),${prefix}_${alias==='SC1'?'VUNIT':'PRECO'}) price,CONVERT(varchar(30),${prefix}_TOTAL) total FROM dbo.${alias}010 WHERE R_E_C_N_O_=CONVERT(bigint,@record)`,{record});
  assert.equal(Number(saved[0].price),0.1);assert.equal(Number(saved[0].total),250);
  report.cases.push({alias,case:'existing UPDATE executor changes simple item price and derived total',affected:1,price:0.1,total:250});
  report.cases.push(...await sandboxHttpConfirmation(f,admin,alias));
 }
 console.log(JSON.stringify(report,null,2));
}finally{for(const connection of connections)connection.close();}

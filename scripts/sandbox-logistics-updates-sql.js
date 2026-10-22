// SQL genuino únicamente en una LocalDB nueva identificada por token; sin .env ni datos ERP.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {sandboxConnection} from './sandbox-sql-transport.js';
import {createWriter} from '../src/protheus/writer.js';
import {writeProfiles,logisticsFields} from '../src/protheus/write-policy.js';
if(process.argv[2]!=='--run-local-synthetic')throw Error('Explicit --run-local-synthetic required');
const database='AgenteSqlSandbox_'+randomBytes(8).toString('hex'),token=randomBytes(32).toString('hex');
const db=sandboxConnection({database,token,bootstrap:true}),q=s=>'['+s.replaceAll(']',']]')+']';
const report={kind:'SQL Server LocalDB synthetic logistics',productionBusinessWrites:0,nativeProtheusValidated:false,cases:[]};
async function insert(alias,row){const keys=Object.keys(row);await db.query(`INSERT dbo.${q(alias+'010')} (${keys.map(q).join(',')}) VALUES (${keys.map((_,i)=>'@p'+i).join(',')})`,Object.fromEntries(keys.map((key,i)=>['p'+i,row[key]])));}
async function seed(action,count=1){
 const p=writeProfiles[action],prefix={SC1:'C1',SC7:'C7',SC6:'C6'}[p.alias],tables=new Map(),dictionary=new Map(),data=new Map();
 const add=(alias,rows,extra=[])=>{data.set(alias,rows);const names=new Set(['R_E_C_N_O_','D_E_L_E_T_',...extra,...rows.flatMap(row=>Object.keys(row))]);const columns=new Map([...names].map(field=>[field,{type:field==='R_E_C_N_O_'?'bigint':dictionary.get(field)?.X3_TIPO==='N'?'float':'varchar',identity:false}]));tables.set(alias,{schema:'dbo',name:alias+'010',columns});};
 const number=(field,scale=2,width=14)=>dictionary.set(field,{X3_ARQUIVO:field.startsWith('C1')?'SC1':field.startsWith('C7')?'SC7':'SC6',X3_CAMPO:field,X3_TIPO:'N',X3_TAMANHO:String(width),X3_DECIMAL:String(scale),X3_VALID:'',X3_F3:''});
 for(const field of [p.price,p.quantity,p.total,...p.zero||[]])number(field,field===p.price?6:2);
 const rows=[];
 for(let i=0;i<count;i++){
  const row={R_E_C_N_O_:String(9007199254740993n+BigInt(i)),D_E_L_E_T_:' ',[p.branch]:'0101',[p.product]:'TEST',[p.price]:'1',[p.quantity]:'10',[p.total]:'10',[p.unit]:'UN',[prefix+'_NUM']:'000001',[prefix+'_ITEM']:String(i+1).padStart(4,'0'),[prefix+'_LOCAL']:'01'};
  for(const field of p.zero||[])row[field]='0';for(const field of p.blank||[])row[field]=' ';
  if(p.alias==='SC6')Object.assign(row,{C6_ENTREG:'20261025',C6_CLI:'000001',C6_LOJA:'01'});
  else Object.assign(row,{[prefix+'_EMISSAO']:'20261020',[prefix+'_DATPRF']:'20261025',[prefix+'_MOEDA']:'1',[prefix+'_TIPO']:'1'});
  if(p.alias==='SC7')Object.assign(row,{C7_FORNECE:'000001',C7_LOJA:'01',C7_COND:'001'});
  rows.push(row);
 }
 for(const [alias,mapping] of Object.entries(logisticsFields))for(const [key,[owner,field]] of Object.entries(mapping))dictionary.set(field,{X3_ARQUIVO:owner,X3_CAMPO:field,X3_TIPO:key.startsWith('fecha')?'D':'C',X3_TAMANHO:String(key.startsWith('fecha')?8:key==='deposito'?2:3),X3_DECIMAL:'0',X3_VALID:key==='deposito'?'ExistCpo("NNR")':key==='condicionPago'?'ExistCpo("SE4")':'',X3_F3:key==='deposito'?'NNR':key==='condicionPago'?'SE4':''});
 add(p.alias,rows);
 add('SB1',[{R_E_C_N_O_:'1',D_E_L_E_T_:' ',B1_FILIAL:'0101',B1_COD:'TEST',B1_UM:'UN',B1_DESC:'Synthetic only',B1_RASTRO:'N',B1_LOCALIZ:'N'}]);
 add('SC5',[{R_E_C_N_O_:'1',D_E_L_E_T_:' ',C5_FILIAL:'0101',C5_NUM:'000001',C5_NOTA:' ',C5_LIBEROK:' ',C5_BLQ:' ',C5_CONAPRO:' ',C5_CLIENTE:'000001',C5_LOJACLI:'01',C5_TIPO:'N',C5_EMISSAO:'20261020',C5_CONDPAG:'001'}]);
 if(p.alias!=='SC7')add('SC7',[],['C7_FILIAL','C7_NUMSC','C7_ITEMSC']);
 add('SC9',[],['C9_FILIAL','C9_PEDIDO','C9_ITEM']);add('SD2',[],['D2_FILIAL','D2_PEDIDO','D2_ITEMPV']);add('SD1',[],['D1_FILIAL','D1_PEDIDO','D1_ITEMPC','D1_FORNECE','D1_LOJA']);
 add('NNR',[{R_E_C_N_O_:'1',D_E_L_E_T_:' ',NNR_FILIAL:'0101',NNR_CODIGO:'02',NNR_DESCRI:'Synthetic warehouse'}]);
 add('SE4',['001','002'].map((code,i)=>({R_E_C_N_O_:String(i+1),D_E_L_E_T_:' ',E4_FILIAL:'0101',E4_CODIGO:code,E4_DESCRI:'Synthetic term',E4_TIPO:'1',E4_ACRSFIN:'0',E4_DESCFIN:'0'})));
 const sxRows=[...dictionary.values()].map((sx,i)=>({...sx,R_E_C_N_O_:String(i+1),D_E_L_E_T_:' '}));add('SX3',sxRows);
 for(const {name} of await db.query("SELECT name FROM sys.tables WHERE name<>'SandboxIdentity'"))await db.query('DROP TABLE dbo.'+q(name));
 for(const [alias,table] of tables){const cols=[...table.columns].map(([field,col])=>`${q(field)} ${col.type==='varchar'?'varchar(512)':col.type} NOT NULL DEFAULT ${col.type==='varchar'?"(' ')":'((0))'}${field==='R_E_C_N_O_'?' PRIMARY KEY':''}`);await db.query(`CREATE TABLE dbo.${q(table.name)} (${cols.join(',')})`);for(const row of data.get(alias))await insert(alias,row);}
 const catalog={tables,dictionary,table:alias=>{assert.ok(tables.has(alias),alias);return tables.get(alias);},branch:()=> '0101'};
 const writes=createWriter({db,catalog,getWriteDb:async()=>db,enabled:true});
 const proposal=async changes=>{const target={sucursal:'0101',registro:rows[0].R_E_C_N_O_},input={action,target,changes};return {action,target,input,writePlan:await writes.prepare(action,input)};};
 const read=async()=>db.query(`SELECT * FROM dbo.${q(p.alias+'010')} ORDER BY R_E_C_N_O_`);
 return {p,prefix,catalog,writes,proposal,read};
}
try{
 await db.query('SELECT 1 ready');
 for(const action of ['solicitudCompra','pedidoCompra','pedidoVenta']){
  const f=await seed(action),before=await f.read(),changes={fechaEntrega:'2026-10-26',deposito:'02'};
  const receipt=await f.writes.execute(await f.proposal(changes)),after=await f.read();assert.equal(receipt.affected,1);
  assert.equal(after[0][f.prefix+'_LOCAL'],'02');assert.equal(after[0][f.p.alias==='SC6'?'C6_ENTREG':f.prefix+'_DATPRF'],'20261026');
  for(const field of [f.p.price,f.p.quantity,f.p.total])assert.equal(after[0][field],before[0][field]);
  report.cases.push({action,case:'date and warehouse actual SQL commit preserves quantities and prices',affected:1});
 }
 for(const action of ['pedidoVenta','pedidoCompra','solicitudCompra']){
  const f=await seed(action,2),changes=action==='solicitudCompra'?{fechaEmision:'2026-10-21'}:{condicionPago:'002'},proposal=await f.proposal(changes);
  const receipt=await f.writes.execute(proposal),after=await f.read();
  if(action==='pedidoVenta'){const header=await db.query('SELECT C5_CONDPAG FROM dbo.SC5010');assert.equal(header[0].C5_CONDPAG,'002');assert.equal(receipt.affected,1);}
  else{const field=action==='pedidoCompra'?'C7_COND':'C1_EMISSAO',value=action==='pedidoCompra'?'002':'20261021';assert.ok(after.every(row=>row[field]===value));assert.equal(receipt.affected,2);}
  report.cases.push({action,case:'whole document update verifies both items and commits atomically',affected:receipt.affected,itemsChecked:2});
 }
 {
  const f=await seed('pedidoCompra',2),proposal=await f.proposal({condicionPago:'002'}),before=await f.read();let mutations=0;
  const faultDb={query:db.query,transaction:callback=>db.transaction(tx=>callback({query:async(sql,params)=>{const rows=await tx.query(sql,params);if(sql.startsWith('DECLARE @affected')&&++mutations===2)throw Error('SYNTHETIC_SECOND_UPDATE_FAILURE');return rows;}}))};
  const writer=createWriter({db:faultDb,catalog:f.catalog,getWriteDb:async()=>faultDb,enabled:true});
  await assert.rejects(writer.execute(proposal),/SYNTHETIC_SECOND_UPDATE_FAILURE/);assert.equal(mutations,2);assert.deepEqual(await f.read(),before);
  report.cases.push({case:'second actual UPDATE failure rolls back every document item',updatesAttempted:2,rowsPreserved:2});
 }
 {
  const f=await seed('pedidoCompra'),proposal=await f.proposal({condicionPago:'002'}),before=await f.read();await db.query("UPDATE dbo.SE4010 SET E4_DESCRI='Changed synthetic catalog'");
  await assert.rejects(f.writes.execute(proposal),{code:'CONFLICTO_CONCURRENCIA'});assert.deepEqual(await f.read(),before);
  report.cases.push({case:'catalog changed after preview rejects confirmation',rowsPreserved:1});
 }
 await mkdir('reports',{recursive:true});await writeFile('reports/live-logistics-sandbox-sql.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{db.close();}

import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createWriter} from '../src/protheus/writer.js';
import {allocatePurchaseNumbers} from '../src/protheus/purchase-creation.js';
import {Changes} from '../src/changes.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/app.js';
import {createDemoKaiqen} from '../src/demo.js';
import {createIntelligence} from '../src/intelligence/agent.js';

function fixture(alias='SC1',options={}){
 const p=alias==='SC1'?'C1':'C7',action=alias==='SC1'?'crearSolicitudCompra':'crearPedidoCompra',dictionary=new Map(),tables=new Map();
 const chars={FILIAL:4,NUM:6,ITEM:4,PRODUTO:15,DESCRI:50,UM:2,LOCAL:2,EMISSAO:8,DATPRF:8,FILENT:4,CC:9,OBS:120,SEGUM:2,...(alias==='SC1'?{SOLICIT:25,APROV:1}:{FORNECE:6,LOJA:2,COND:3,CONTATO:20,CONAPRO:1,COMPRA:3})};
 const numbers={QUANT:[12,2],TOTAL:[14,2],QUJE:[12,2],MOEDA:[2,0],TIPO:[1,0],QTSEGUM:[12,2],...(alias==='SC1'?{VUNIT:[12,2],QTDORIG:[12,2]}:{PRECO:[14,4],TXMOEDA:[11,4]})};
 const columns=[{field:'R_E_C_N_O_',type:'bigint',identityColumn:false,definition:'((0))'},{field:'D_E_L_E_T_',type:'varchar',definition:"(' ')"},{field:'R_E_C_D_E_L_',type:'bigint',definition:'((0))'}];
 for(const [suffix,width] of Object.entries(chars)){const field=p+'_'+suffix;dictionary.set(field,{X3_ARQUIVO:alias,X3_CAMPO:field,X3_TIPO:['EMISSAO','DATPRF'].includes(suffix)?'D':'C',X3_TAMANHO:String(width),X3_DECIMAL:'0',X3_OBRIGAT:''});columns.push({field,type:'varchar',width,definition:"(' ')"});}
 for(const [suffix,[width,scale]] of Object.entries(numbers)){const field=p+'_'+suffix;dictionary.set(field,{X3_ARQUIVO:alias,X3_CAMPO:field,X3_TIPO:'N',X3_TAMANHO:String(width),X3_DECIMAL:String(scale),X3_OBRIGAT:''});columns.push({field,type:'float',definition:'((0))'});}
 columns.push({field:p+'_RESIDUO',type:'varchar',definition:"(' ')"},{field:'S_T_A_M_P_',type:'datetime',definition:'(getutcdate())'});
 tables.set(alias,{schema:'dbo',name:alias+'010',columns:new Map(columns.map(c=>[c.field,{type:c.type,identity:c.identityColumn||false}]))});tables.set('SX3',{schema:'dbo',name:'SX3010',columns:new Map()});
 for(const [a,fields] of Object.entries({SX6:['X6_FIL','X6_VAR','X6_TIPO','X6_CONTEUD','D_E_L_E_T_'],SY1:['Y1_FILIAL','Y1_COD','Y1_GRAPROV','Y1_PEDIDO','D_E_L_E_T_','R_E_C_N_O_']}))tables.set(a,{schema:'dbo',name:a+'010',columns:new Map(fields.map(k=>[k,{type:'varchar'}]))});
 const refs={SB1:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',B1_FILIAL:'0101',B1_COD:'ZTEST',B1_DESC:'Prueba',B1_UM:'UN',B1_SEGUM:'MI',B1_CONV:'1000',B1_TIPCONV:'D',B1_CC:'',B1_GRADE:'N',B1_MSBLQL:'2'},SA2:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',A2_FILIAL:'01',A2_COD:'000001',A2_LOJA:'01',A2_MSBLQL:'2'},NNR:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',NNR_FILIAL:'0101',NNR_CODIGO:'01'},SE4:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',E4_FILIAL:'0101',E4_CODIGO:'001'},CTT:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',CTT_FILIAL:'0101',CTT_CUSTO:'001'}};
 for(const [a,row] of Object.entries(refs))tables.set(a,{schema:'dbo',name:a+'010',columns:new Map(Object.keys(row).map(k=>[k,{type:'varchar'}]))});
 const catalog={tables,dictionary,table:a=>{assert.ok(tables.has(a),a);return tables.get(a);},branch:(a,b)=>{assert.equal(b,'0101');return ['SA2','SY1'].includes(a)?'01':b;}};
 const parameters=Object.entries({MV_APROVSC:['L','.F.'],MV_APRSCEC:['L','F'],MV_RESTSOL:['C','N'],MV_APRPCEC:['L','F'],MV_PCAPROV:['C',''],MV_ALTPDOC:['L','T']}).map(([X6_VAR,[X6_TIPO,X6_CONTEUD]])=>({X6_FIL:' ',X6_VAR,X6_TIPO,X6_CONTEUD}));
 const state={parameters,buyers:[],rows:[{R_E_C_N_O_:'9007199254740993',D_E_L_E_T_:'*',[p+'_NUM']:'000099',[p+'_FILIAL']:'9999'}],calls:[],inserts:0,commits:0,rollbacks:0};let queue=Promise.resolve();
 async function query(sql,params={}){
  state.calls.push({sql,params});
  if(sql.includes('[SX6010]'))return structuredClone(state.parameters.filter(r=>Object.values(params).includes(r.X6_VAR)&&['',params.branch].includes(r.X6_FIL.trim())));
  if(sql.includes('[SY1010]')){assert.equal(params.branch,'01');return structuredClone(state.buyers);}
  if(sql.includes('FROM sys.columns'))return structuredClone(columns);
  if(sql.includes('FROM sys.indexes'))return options.noIndex?[]:[{name:'PK'}];
  if(sql.includes('FROM sys.triggers'))return options.trigger?[{name:'other',definition:'unexpected'}]:[];
  if(sql.includes('X3_ARQUIVO=@alias'))return structuredClone([...dictionary.values()]);
  if(sql.includes('AS maxRecno')){assert.match(sql,/WITH \(TABLOCKX,HOLDLOCK\)/);assert.doesNotMatch(sql,/WHERE/);return [{maxRecno:state.rows.reduce((v,r)=>BigInt(r.R_E_C_N_O_)>v?BigInt(r.R_E_C_N_O_):v,0n).toString(),maxNumber:state.rows.reduce((v,r)=>/^\d+$/.test(r[p+'_NUM'])&&BigInt(r[p+'_NUM'])>v?BigInt(r[p+'_NUM']):v,0n).toString()}];}
  if(sql.startsWith('DECLARE @inserted')){
   state.inserts++;if(options.failAt===state.inserts)throw new Error('insert failed');
   const fields=/INSERT INTO \[dbo\]\.\[\w+\] \(([^)]+)\)/.exec(sql)[1].split(',').map(v=>v.slice(1,-1));const row={};
   for(const c of columns)row[c.field]=c.type==='datetime'?'2026-10-19T10:00:00':c.type==='float'||c.type==='bigint'?'0':' ';
   fields.forEach((f,i)=>row[f]=params['v'+i]);assert.equal(row.D_E_L_E_T_,' ');assert.equal(row.R_E_C_D_E_L_,'0');assert.equal(row[p+'_FILIAL'],'0101');
   assert.ok(!state.rows.some(r=>r.R_E_C_N_O_===row.R_E_C_N_O_));state.rows.push(row);
   if(options.unexpected)row[p+'_RESIDUO']='S';return [{record:options.wrongOutput?'1':row.R_E_C_N_O_}];
  }
  if(params.number)return structuredClone(state.rows.filter(r=>r[p+'_NUM']===params.number));
  const a=/FROM \[dbo\]\.\[(\w+)010\]/.exec(sql)?.[1];assert.ok(refs[a],sql);assert.match(sql,/D_E_L_E_T_.*=' '/);assert.equal(params.branch,catalog.branch(a,'0101'));return options.missing===a?[]:[structuredClone(refs[a])];
 }
 const db={query,async transaction(callback){let release;const previous=queue;queue=new Promise(r=>release=r);await previous;const before=structuredClone(state.rows);try{const result=await callback({query});if(options.unknown)throw Object.assign(new Error('lost commit'),{outcomeUnknown:true});state.commits++;return result;}catch(e){if(!e.outcomeUnknown){state.rows=before;state.rollbacks++;}throw e;}finally{release();}}};
 const writes=createWriter({db,catalog,getWriteDb:async()=>db,enabled:true}),erp={writes,metadata:()=>({entities:{productos:{},depositos:{},proveedores:{},condicionesPago:{}}})};
 const input={action,target:{sucursal:'0101'},header:{fechaEmision:'2026-10-19',moneda:'1',...(alias==='SC1'?{solicitante:'Operador'}:{proveedor:'000001',tienda:'01',condicionPago:'001'})},items:[{producto:'ZTEST',deposito:'01',fechaNecesidad:'2026-10-20',cantidad:'2.5',precio:'80',baseCantidad:'millares',basePrecio:'millar'}]};
 const proposal=async()=>({action,input,target:input.target,writePlan:await writes.prepare(action,input)});
 return {action,p,columns,dictionary,refs,state,catalog,db,writes,erp,input,proposal};
}
for(const alias of ['SC1','SC7'])test(alias+' creates all items atomically, includes deleted/other branch maxima and preserves bigint IDs',async()=>{
 const f=fixture(alias);f.input.items.push({...f.input.items[0],cantidad:'1'});const proposal=await f.proposal();assert.equal(f.state.inserts,0);const receipt=await f.writes.execute(proposal);
 assert.equal(receipt.number,'000100');assert.deepEqual(receipt.records,['9007199254740994','9007199254740995']);assert.equal(receipt.affected,2);assert.equal(f.state.commits,1);
 const row=f.state.rows[1];assert.equal(row[f.p+'_QUANT'],'2500.00');assert.equal(row[f.p+'_QTSEGUM'],'2.50');assert.equal(row[f.p+'_TOTAL'],'200.00');assert.equal(row[alias==='SC1'?'C1_APROV':'C7_CONAPRO'],'L');assert.equal(row[f.p+'_QUJE'],'0');
 assert.equal(receipt.approval.mode,'sin-aprobacion-requerida');assert.equal(receipt.fields.aprobacion,'L');
 assert.equal(f.state.rows[0].D_E_L_E_T_,'*');assert.ok(f.state.calls.every(c=>!/^UPDATE|^DELETE|^MERGE/.test(c.sql)));
});
test('two concurrent confirmations allocate different documents and non-overlapping RECNO ranges',async()=>{
 const f=fixture(),a=await f.proposal(),b=await f.proposal();const results=await Promise.all([f.writes.execute(a),f.writes.execute(b)]);assert.deepEqual(results.map(r=>r.number),['000100','000101']);assert.equal(new Set(results.flatMap(r=>r.records)).size,2);
});
test('allocator handles empty tables and refuses bigint/document overflow without reusing numbers',async()=>{
 const table={schema:'dbo',name:'SC1010'};
 const allocate=(maxRecno,maxNumber,width=6)=>allocatePurchaseNumbers({query:async()=>[{maxRecno,maxNumber}]},table,'C1_NUM',width,2);
 assert.deepEqual(await allocate('0','0'),{number:'000001',records:['1','2']});
 await assert.rejects(allocate('9223372036854775806','1'),{code:'RECNO_AGOTADO'});await assert.rejects(allocate('1','999999'),{code:'NUMERO_AGOTADO'});await assert.rejects(allocate('-1','1'),{code:'NUMERACION_NO_VERIFICABLE'});
});
test('failed later insert, wrong output or unexpected defaults roll back the whole document',async()=>{
 for(const options of [{failAt:2},{wrongOutput:true},{unexpected:true}]){const f=fixture('SC7',options);f.input.items.push({...f.input.items[0]});const before=structuredClone(f.state.rows);await assert.rejects(f.writes.execute(await f.proposal()));assert.deepEqual(f.state.rows,before);assert.equal(f.state.commits,0);assert.equal(f.state.rollbacks,1);}
});
test('catalog, definition and approval changes after preview invalidate creation before any INSERT',async()=>{
 for(const mutate of [f=>f.refs.SB1.B1_CONV='100',f=>f.refs.SA2.A2_MSBLQL='1',f=>f.columns.push({field:'C7_CUSTOM',type:'varchar',definition:"(' ')"}),f=>f.columns.find(c=>c.field==='C7_CONAPRO').definition="('L')"]){const f=fixture('SC7'),proposal=await f.proposal();mutate(f);await assert.rejects(f.writes.execute(proposal));assert.equal(f.state.inserts,0);}
});
test('invalid references, schema, prices, bases, dates, injected IDs and native links are rejected',async()=>{
 for(const mutate of [f=>f.input.target.registro='123',f=>f.input.target.sucursal='9999',f=>f.input.header.moneda='2',f=>f.input.header.fechaEmision='2026-02-30',f=>f.input.items[0].fechaNecesidad='2026-01-01',f=>f.input.items[0].precio='80.123',f=>f.input.items[0].cantidad='0',f=>f.input.items[0].basePrecio='unknown',f=>f.input.items[0].C1_APROV='L',f=>f.input.items[0].solicitud='001',f=>f.refs.SB1.B1_UM='KG',f=>f.refs.SB1.B1_MSBLQL='1',f=>f.refs.SB1.B1_TIPCONV='?',f=>f.columns.find(c=>c.field==='R_E_C_N_O_').identityColumn=true,f=>f.columns.push({field:'CUSTOM',type:'varchar',definition:null,nullable:false})]){const f=fixture();mutate(f);await assert.rejects(f.proposal());assert.equal(f.state.inserts,0);}
 for(const options of [{noIndex:true},{trigger:true},{missing:'SB1'},{missing:'NNR'}])await assert.rejects(fixture('SC1',options).proposal());
});
test('confirmed creation is actor-scoped, idempotent and never retries a lost COMMIT',async t=>{
 for(const unknown of [false,true]){const f=fixture('SC1',{unknown}),store=new Store(':memory:');t.after(()=>store.close());const changes=new Changes({erp:f.erp,store,read:()=>{throw new Error('no existing row');}}),p=await changes.preview('a',f.input),confirm={confirm:true,fingerprint:p.fingerprint};
 assert.equal(p.operation,'insert');assert.equal(p.writePlan,undefined);await assert.rejects(changes.execute('b',p.id,confirm),{code:'PROPUESTA_NO_EXISTE'});
 if(unknown){await assert.rejects(changes.execute('a',p.id,confirm));await assert.rejects(changes.execute('a',p.id,confirm),{code:'EJECUCION_NO_REPETIBLE'});assert.equal(changes.status('a',p.id).execution.status,'unknown');}
 else{const receipt=await changes.execute('a',p.id,confirm);assert.deepEqual(await changes.execute('a',p.id,confirm),receipt);assert.equal(receipt.status,'executed');}
 assert.equal(f.state.inserts,1);}
});
test('HTTP creation requires writer confirmation and rejects reader/planner execution',async t=>{
 const f=fixture('SC7'),store=new Store(':memory:');t.after(()=>store.close());const key='w'.repeat(40),server=createApp({erp:f.erp,kaiqen:createDemoKaiqen(),store,readKey:'r'.repeat(40),planKey:'p'.repeat(40),writeKey:key});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();});
 const base=`http://127.0.0.1:${server.address().port}`,post=(path,key,body)=>fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('/api/changes/preview','r'.repeat(40),f.input)).status,403);const preview=await post('/api/changes/preview',key,f.input);assert.equal(preview.status,201);const p=await preview.json(),confirm={confirm:true,fingerprint:p.fingerprint};
 assert.equal((await post('/api/changes/'+p.id+'/execute','p'.repeat(40),confirm)).status,403);assert.equal((await post('/api/changes/'+p.id+'/execute',key,{...confirm,confirm:false})).status,400);assert.equal((await post('/api/changes/'+p.id+'/execute',key,confirm)).status,200);assert.equal(f.state.inserts,1);
});
test('chat prepares creation from observed catalogs, never executes it or invents a receipt',async t=>{
 const f=fixture(),store=new Store(':memory:');t.after(()=>store.close());const changes=new Changes({erp:f.erp,store});
 const decisions=[{action:'consultar_erp',args:{recurso:'productos',filtros:{codigo:'ZTEST'}}},{action:'consultar_erp',args:{recurso:'depositos',filtros:{codigo:'01'}}},{action:'preparar_alta',args:{accion:f.action,cabecera:f.input.header,items:f.input.items}}];
 const read=async({resource})=>({data:[{codigo:resource==='productos'?'ZTEST':'01'}]});const agent=createIntelligence({erp:f.erp,kaiqen:createDemoKaiqen(),store,read,executeRead:read,branches:['0101'],prepareChange:(actor,input)=>changes.preview(actor,input),model:{name:'test',complete:async()=>decisions.shift()}});
 const reply=await agent.query('a',{text:'Creá una solicitud nueva con estos datos'},{canPlan:true});assert.equal(reply.evidence.at(-1).result.kind,'proposal');assert.equal(reply.evidence.at(-1).result.proposal.operation,'insert');assert.match(reply.answer,/No se creó ningún documento/);assert.equal(f.state.inserts,0);
});

test('approval parameters use branch overrides, global fallback and strict logical types',async()=>{
 for(const alias of ['SC1','SC7']){
  const key=alias==='SC1'?'MV_APROVSC':'MV_APRPCEC',f=fixture(alias);
  f.state.parameters.find(r=>r.X6_VAR===key).X6_CONTEUD='T';
  f.state.parameters.push({X6_VAR:key,X6_FIL:'0101',X6_TIPO:'L',X6_CONTEUD:'.F.'});
  f.state.parameters.push({X6_VAR:key,X6_FIL:'9999',X6_TIPO:'L',X6_CONTEUD:'T'});
  const p=await f.proposal();assert.equal(p.writePlan.approval.status,'L');
  assert.equal(p.writePlan.approval.parameters.find(r=>r.parametro===key).filial,'0101');
  await f.writes.execute(p);assert.equal(f.state.inserts,1);
 }
 for(const mutate of [
  f=>f.state.parameters.splice(0,1),
  f=>f.state.parameters[0].X6_CONTEUD='',
  f=>f.state.parameters[0].X6_CONTEUD=null,
  f=>f.state.parameters[0].X6_CONTEUD='NO',
  f=>f.state.parameters[0].X6_TIPO='C',
  f=>f.state.parameters.push({...f.state.parameters[0]}),
  f=>{f.state.parameters.push({...f.state.parameters[0],X6_FIL:'0101'});f.state.parameters.push({...f.state.parameters[0],X6_FIL:'0101'});}
 ]){
  const f=fixture();mutate(f);const p=await f.proposal();assert.equal(p.writePlan.executionEnabled,false);assert.equal(p.writePlan.approval.status,null);
  assert.ok(p.writePlan.blockers.some(b=>b.code==='APROBACION_NO_VERIFICABLE'));
  assert.equal((await f.writes.check(p)).executionEnabled,false);
  await assert.rejects(f.writes.execute(p),{code:'ALTA_NO_HABILITADA'});assert.equal(f.state.inserts,0);
 }
});

test('active approval circuits and requester restrictions never create a released or stranded B document',async()=>{
 for(const [alias,key,value] of [['SC1','MV_APROVSC','.T.'],['SC1','MV_APRSCEC','T'],['SC1','MV_RESTSOL','S'],['SC7','MV_APRPCEC','.T.'],['SC7','MV_PCAPROV','000001']]){
  const f=fixture(alias);f.state.parameters.find(r=>r.X6_VAR===key).X6_CONTEUD=value;
  const p=await f.proposal();assert.equal(p.writePlan.executionEnabled,false);assert.equal(p.writePlan.approval.status,null);
  await assert.rejects(f.writes.execute(p),{code:'ALTA_NO_HABILITADA'});assert.equal(f.state.inserts,0);assert.equal(f.state.commits,0);
 }
});

test('buyer group takes precedence, blank buyer group falls back, and omission cannot bypass a buyer group',async()=>{
 const f=fixture('SC7');f.state.buyers=[{Y1_COD:'001',Y1_GRAPROV:'BUYER',Y1_PEDIDO:'1'},{Y1_COD:'002',Y1_GRAPROV:'',Y1_PEDIDO:'1'}];
 f.state.parameters.find(r=>r.X6_VAR==='MV_PCAPROV').X6_CONTEUD='GLOBAL';
 let p=await f.proposal();assert.ok(p.writePlan.blockers.some(b=>b.code==='COMPRADOR_REQUERIDO'));
 f.input.header.comprador='001';p=await f.proposal();assert.equal(p.writePlan.approval.group,'BUYER');assert.equal(p.writePlan.executionEnabled,false);
 f.input.header.comprador='002';p=await f.proposal();assert.equal(p.writePlan.approval.group,'GLOBAL');assert.equal(p.writePlan.executionEnabled,false);
 f.state.parameters.find(r=>r.X6_VAR==='MV_PCAPROV').X6_CONTEUD='';p=await f.proposal();assert.equal(p.writePlan.approval.status,'L');
 const receipt=await f.writes.execute(p);assert.equal(receipt.fields.aprobacion,'L');assert.equal(f.state.rows[1].C7_COMPRA,'002');
 f.state.buyers[1].Y1_PEDIDO='2';p=await f.proposal();assert.ok(p.writePlan.blockers.some(b=>b.code==='COMPRADOR_REQUIERE_SOLICITUD'));
 await assert.rejects(f.writes.execute(p),{code:'ALTA_NO_HABILITADA'});assert.equal(f.state.inserts,1);
 f.input.header.comprador='999';await assert.rejects(f.proposal(),{code:'COMPRADOR_NO_UNICO'});
 f.input.header.comprador='002';f.state.buyers.push({...f.state.buyers[1]});await assert.rejects(f.proposal(),{code:'COMPRADOR_NO_UNICO'});
});

test('approval changes invalidate previews and all approval reads are locked during execution',async()=>{
 for(const mutate of [
  f=>f.state.parameters.find(r=>r.X6_VAR==='MV_APRPCEC').X6_CONTEUD='T',
  f=>f.state.parameters.push({X6_VAR:'MV_PCAPROV',X6_FIL:'0101',X6_TIPO:'C',X6_CONTEUD:'000001'}),
  f=>f.state.buyers.push({Y1_COD:'001',Y1_GRAPROV:'000001',Y1_PEDIDO:'1'})
 ]){
  const f=fixture('SC7'),p=await f.proposal();mutate(f);await assert.rejects(f.writes.execute(p),{code:'CONFLICTO_CONCURRENCIA'});assert.equal(f.state.inserts,0);
 }
 const f=fixture('SC7'),p=await f.proposal();f.state.calls=[];await f.writes.execute(p);
 const reads=f.state.calls.filter(c=>c.sql.includes('[SX6010]')||c.sql.includes('[SY1010]'));assert.equal(reads.length,4);
 for(const call of reads)assert.match(call.sql,/WITH \(UPDLOCK,HOLDLOCK\)/);
 // Old B previews and caller-supplied state cannot be used to bypass the resolver.
 const old=await f.proposal();old.writePlan.snapshotHash='old-version-B';await assert.rejects(f.writes.execute(old),{code:'CONFLICTO_CONCURRENCIA'});
 f.input.header.aprobacion='L';await assert.rejects(f.proposal(),{code:'CABECERA_INVALIDA'});
});

test('HTTP cannot execute a blocked approval proposal even with writer permission and correct confirmation',async t=>{
 const f=fixture('SC7');f.state.parameters.find(r=>r.X6_VAR==='MV_PCAPROV').X6_CONTEUD='000001';
 const store=new Store(':memory:');t.after(()=>store.close());const key='w'.repeat(40);
 const server=createApp({erp:f.erp,kaiqen:createDemoKaiqen(),store,readKey:'r'.repeat(40),planKey:'p'.repeat(40),writeKey:key});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();});
 const base=`http://127.0.0.1:${server.address().port}`,post=(path,body)=>fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)});
 const response=await post('/api/changes/preview',f.input);assert.equal(response.status,201);const p=await response.json();
 assert.equal(p.executionEnabled,false);assert.equal(p.approval.status,null);assert.equal(p.approval.evidence,undefined);
 const execute=await post('/api/changes/'+p.id+'/execute',{confirm:true,fingerprint:p.fingerprint});assert.equal(execute.status,409);assert.equal(f.state.inserts,0);
});

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
 const chars={FILIAL:4,NUM:6,ITEM:4,PRODUTO:15,DESCRI:50,UM:2,LOCAL:2,EMISSAO:8,DATPRF:8,FILENT:4,CC:9,OBS:120,SEGUM:2,...(alias==='SC1'?{SOLICIT:25,APROV:1}:{FORNECE:6,LOJA:2,COND:3,CONTATO:20,CONAPRO:1,COMPRA:3,APROV:6})};
 const numbers={QUANT:[12,2],TOTAL:[14,2],QUJE:[12,2],MOEDA:[2,0],TIPO:[1,0],QTSEGUM:[12,2],...(alias==='SC1'?{VUNIT:[12,2],QTDORIG:[12,2]}:{PRECO:[14,4],TXMOEDA:[11,4]})};
 const columns=[{field:'R_E_C_N_O_',type:'bigint',identityColumn:false,definition:'((0))'},{field:'D_E_L_E_T_',type:'varchar',definition:"(' ')"},{field:'R_E_C_D_E_L_',type:'bigint',definition:'((0))'}];
 for(const [suffix,width] of Object.entries(chars)){const field=p+'_'+suffix;dictionary.set(field,{X3_ARQUIVO:alias,X3_CAMPO:field,X3_TIPO:['EMISSAO','DATPRF'].includes(suffix)?'D':'C',X3_TAMANHO:String(width),X3_DECIMAL:'0',X3_OBRIGAT:''});columns.push({field,type:'varchar',width,definition:"(' ')"});}
 for(const [suffix,[width,scale]] of Object.entries(numbers)){const field=p+'_'+suffix;dictionary.set(field,{X3_ARQUIVO:alias,X3_CAMPO:field,X3_TIPO:'N',X3_TAMANHO:String(width),X3_DECIMAL:String(scale),X3_OBRIGAT:''});columns.push({field,type:'float',definition:'((0))'});}
 columns.push({field:p+'_RESIDUO',type:'varchar',definition:"(' ')"},{field:'S_T_A_M_P_',type:'datetime',definition:'(getutcdate())'});
 tables.set(alias,{schema:'dbo',name:alias+'010',columns:new Map(columns.map(c=>[c.field,{type:c.type,identity:c.identityColumn||false}]))});tables.set('SX3',{schema:'dbo',name:'SX3010',columns:new Map()});
 for(const [a,fields] of Object.entries({SX6:['X6_FIL','X6_VAR','X6_TIPO','X6_CONTEUD','D_E_L_E_T_'],SY1:['Y1_FILIAL','Y1_COD','Y1_GRAPROV','Y1_PEDIDO','D_E_L_E_T_','R_E_C_N_O_']}))tables.set(a,{schema:'dbo',name:a+'010',columns:new Map(fields.map(k=>[k,{type:'varchar'}]))});
 const refs={SB1:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',B1_FILIAL:'0101',B1_COD:'ZTEST',B1_DESC:'Prueba',B1_UM:'UN',B1_SEGUM:'MI',B1_CONV:'1000',B1_TIPCONV:'D',B1_CC:'',B1_GRADE:'N',B1_MSBLQL:'2',B1_GRUPO:'0001',B1_SOLICIT:'N'},SA2:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',A2_FILIAL:'01',A2_COD:'000001',A2_LOJA:'01',A2_MSBLQL:'2'},NNR:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',NNR_FILIAL:'0101',NNR_CODIGO:'01'},SE4:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',E4_FILIAL:'0101',E4_CODIGO:'001'},CTT:{R_E_C_N_O_:'1',D_E_L_E_T_:' ',CTT_FILIAL:'0101',CTT_CUSTO:'001'}};
 for(const [a,row] of Object.entries(refs))tables.set(a,{schema:'dbo',name:a+'010',columns:new Map(Object.keys(row).map(k=>[k,{type:'varchar'}]))});
 const catalog={tables,dictionary,table:a=>{assert.ok(tables.has(a),a);return tables.get(a);},branch:(a,b)=>{assert.equal(b,'0101');return ['SA2','SY1'].includes(a)?'01':b;}};
 const parameters=Object.entries({MV_APROVSC:['L','.F.'],MV_APRSCEC:['L','F'],MV_RESTSOL:['C','N'],MV_APRPCEC:['L','F'],MV_PCAPROV:['C',''],MV_ALTPDOC:['L','T']}).map(([X6_VAR,[X6_TIPO,X6_CONTEUD]])=>({X6_FIL:' ',X6_VAR,X6_TIPO,X6_CONTEUD}));
 const state={parameters,catalogs:{SAL:[],SAK:[],DHL:[],DHM:[],DBL:[],SAI:[]},circuits:{SCR:[],DBM:[]},buyers:[],rows:[{R_E_C_N_O_:'9007199254740993',D_E_L_E_T_:'*',[p+'_NUM']:'000099',[p+'_FILIAL']:'9999'}],calls:[],inserts:0,commits:0,rollbacks:0};let queue=Promise.resolve();
 const circuitColumns={};
 for(const [a,chars,nums] of [
  ['SCR',{CR_FILIAL:4,CR_NUM:50,CR_TIPO:2,CR_USER:6,CR_APROV:6,CR_GRUPO:6,CR_ITGRP:2,CR_NIVEL:2,CR_STATUS:2,CR_EMISSAO:8,CR_USERLIB:6,CR_LIBAPRO:6,CR_DATALIB:8},{CR_TOTAL:[14,2],CR_MOEDA:[2,0],CR_TXMOEDA:[11,2],CR_VALLIB:[14,2]}],
  ['DBM',{DBM_FILIAL:4,DBM_NUM:50,DBM_TIPO:2,DBM_ITEM:4,DBM_ITEMRA:2,DBM_GRUPO:6,DBM_ITGRP:2,DBM_USER:6,DBM_APROV:1,DBM_USAPRO:6},{DBM_VALOR:[14,2]}]
 ]){
  const cols=structuredClone(columns.slice(0,3));
  for(const [field,width] of Object.entries(chars)){dictionary.set(field,{X3_ARQUIVO:a,X3_CAMPO:field,X3_TIPO:'C',X3_TAMANHO:String(width),X3_DECIMAL:'0',X3_OBRIGAT:''});cols.push({field,type:'varchar',definition:"(' ')"});}
  for(const [field,[width,scale]] of Object.entries(nums)){dictionary.set(field,{X3_ARQUIVO:a,X3_CAMPO:field,X3_TIPO:'N',X3_TAMANHO:String(width),X3_DECIMAL:String(scale),X3_OBRIGAT:''});cols.push({field,type:'float',definition:'((0))'});}
  circuitColumns[a]=cols;tables.set(a,{schema:'dbo',name:a+'010',columns:new Map(cols.map(c=>[c.field,{type:c.type,identity:false}]))});
 }
 const referenceFields={SAL:'AL_COD AL_ITEM AL_APROV AL_PERFIL AL_USER AL_NIVEL AL_APROSUP AL_USERSUP AL_LIBAPR AL_AUTOLIM AL_TPLIBER AL_DOCPC AL_DOCIP AL_DOCSC',SAK:'AK_COD AK_USER AK_MOEDA AK_LIMITE AK_TIPO AK_APROSUP',DHL:'DHL_COD DHL_LIMMIN DHL_LIMMAX DHL_MOEDA',DBL:'DBL_GRUPO DBL_ITEM DBL_CC DBL_CONTA DBL_ITEMCT DBL_CLVL',DHM:'DHM_GRUPO DHM_APROV DHM_TIPCOM',SAI:'AI_USER AI_GRUSER AI_ITEM AI_GRUPO AI_PRODUTO AI_DOMINIO AI_QUANT'};
 for(const [a,fields] of Object.entries(referenceFields))tables.set(a,{schema:'dbo',name:a+'010',columns:new Map((fields+' '+({SAL:'AL',SAK:'AK',SAI:'AI'}[a]||a)+'_FILIAL D_E_L_E_T_ R_E_C_N_O_').split(' ').map(f=>[f,{type:'varchar'}]))});
 async function query(sql,params={}){
  state.calls.push({sql,params});
  const source=/(?:FROM|INSERT INTO) \[dbo\]\.\[(\w+)010\]/.exec(sql)?.[1];
  if(state.catalogs[source]){assert.equal(params.branch,'0101');return structuredClone(state.catalogs[source]);}
  const cols=circuitColumns[source]||circuitColumns[params.tableName?.slice(4,-3)]||columns,tableRows=state.circuits[source]||state.rows,numberField=source==='SCR'?'CR_NUM':source==='DBM'?'DBM_NUM':p+'_NUM';
  if(sql.includes('[SX6010]'))return structuredClone(state.parameters.filter(r=>Object.values(params).includes(r.X6_VAR)&&['',params.branch].includes(r.X6_FIL.trim())));
  if(sql.includes('[SY1010]')){assert.equal(params.branch,'01');return structuredClone(state.buyers);}
  if(sql.includes('FROM sys.columns'))return structuredClone(cols);
  if(sql.includes('FROM sys.indexes'))return options.noIndex?[]:[{name:'PK'}];
  if(sql.includes('FROM sys.triggers'))return options.trigger?[{name:'other',definition:'unexpected'}]:[];
  if(sql.includes('X3_ARQUIVO=@alias'))return structuredClone([...dictionary.values()].filter(r=>r.X3_ARQUIVO===params.alias));
  if(sql.includes('AS maxRecno')){assert.match(sql,/WITH \(TABLOCKX,HOLDLOCK\)/);assert.doesNotMatch(sql,/WHERE/);return [{maxRecno:tableRows.reduce((v,r)=>BigInt(r.R_E_C_N_O_)>v?BigInt(r.R_E_C_N_O_):v,0n).toString(),maxNumber:tableRows.reduce((v,r)=>/^\d+$/.test(r[p+'_NUM'])&&BigInt(r[p+'_NUM'])>v?BigInt(r[p+'_NUM']):v,0n).toString()}];}
  if(sql.startsWith('DECLARE @inserted')){
   state.inserts++;if(options.failAt===state.inserts)throw new Error('insert failed');
   const fields=/INSERT INTO \[dbo\]\.\[\w+\] \(([^)]+)\)/.exec(sql)[1].split(',').map(v=>v.slice(1,-1));const row={};
   for(const c of cols)row[c.field]=c.type==='datetime'?'2026-10-19T10:00:00':c.type==='float'||c.type==='bigint'?'0':' ';
   fields.forEach((f,i)=>row[f]=params['v'+i]);assert.equal(row.D_E_L_E_T_,' ');assert.equal(row.R_E_C_D_E_L_,'0');assert.equal(row[source==='SCR'?'CR_FILIAL':source==='DBM'?'DBM_FILIAL':p+'_FILIAL'],'0101');
   assert.ok(!tableRows.some(r=>r.R_E_C_N_O_===row.R_E_C_N_O_));tableRows.push(row);
   if(options.unexpected)row[p+'_RESIDUO']='S';return [{record:options.wrongOutput?'1':row.R_E_C_N_O_}];
  }
  if(params.number)return structuredClone(tableRows.filter(r=>r[numberField]===params.number&&(!params.type||r[source==='SCR'?'CR_TIPO':'DBM_TIPO']===params.type)&&(!params.branch||r[source==='SCR'?'CR_FILIAL':'DBM_FILIAL']===params.branch)));
  const a=/FROM \[dbo\]\.\[(\w+)010\]/.exec(sql)?.[1];assert.ok(refs[a],sql);assert.match(sql,/D_E_L_E_T_.*=' '/);assert.equal(params.branch,catalog.branch(a,'0101'));return options.missing===a?[]:[structuredClone(refs[a])];
 }
 const db={query,async transaction(callback){let release;const previous=queue;queue=new Promise(r=>release=r);await previous;const before=structuredClone(state.rows),beforeCircuits=structuredClone(state.circuits);try{const result=await callback({query});if(options.unknown)throw Object.assign(new Error('lost commit'),{outcomeUnknown:true});state.commits++;return result;}catch(e){if(!e.outcomeUnknown){state.rows=before;state.circuits=beforeCircuits;state.rollbacks++;}throw e;}finally{release();}}};
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

test('missing active circuit configuration does not silently release documents',async()=>{
 for(const [alias,key,value] of [['SC1','MV_APRSCEC','T'],['SC1','MV_RESTSOL','S'],['SC7','MV_APRPCEC','.T.'],['SC7','MV_PCAPROV','000001']]){
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
function parameter(f,key,value,type=typeof value==='boolean'?'L':'C'){
 const row=f.state.parameters.find(r=>r.X6_VAR===key),next={X6_FIL:' ',X6_VAR:key,X6_TIPO:type,X6_CONTEUD:typeof value==='boolean'?(value?'T':'F'):value};
 if(row)Object.assign(row,next);else f.state.parameters.push(next);
}
function configuredCircuit(f,{entity=false}={}){
 for(const [key,value] of Object.entries({MV_PCAPROV:entity?'':'000001',MV_APRSCEC:entity&&f.p==='C1',MV_APRPCEC:entity&&f.p==='C7',MV_APGRDFL:'000001;01',MV_PERFALC:'1',MV_IPAPREC:false,MV_APRIPPC:'2'}))parameter(f,key,value);
 const cats=f.state.catalogs;
 cats.SAL=[['01','A00001','USER01','01','U'],['02','A00002','USER02','02','N'],['03','A00003','USER03','02','P']].map(([AL_ITEM,AL_APROV,AL_USER,AL_NIVEL,AL_TPLIBER])=>({AL_COD:'000001',AL_ITEM,AL_APROV,AL_USER,AL_NIVEL,AL_TPLIBER,AL_PERFIL:'PROF01',AL_APROSUP:'',AL_USERSUP:'',AL_LIBAPR:'A',AL_AUTOLIM:'S',AL_DOCPC:'T',AL_DOCSC:'T',AL_DOCIP:'T'}));
 cats.SAK=cats.SAL.map(r=>({AK_COD:r.AL_APROV,AK_USER:r.AL_USER,AK_MOEDA:'1',AK_LIMITE:'100000',AK_TIPO:'D',AK_APROSUP:''}));
 cats.DHL=[{DHL_COD:'PROF01',DHL_LIMMIN:'100',DHL_LIMMAX:'500',DHL_MOEDA:'1'}];
 cats.DBL=[{DBL_GRUPO:'000001',DBL_ITEM:'01',DBL_CC:'',DBL_CONTA:'',DBL_ITEMCT:'',DBL_CLVL:''}];
 return cats;
}

test('standard PC generates pending SCR with levels, preserves SAL liberation rules and converts millares once',async()=>{
 const f=fixture('SC7');configuredCircuit(f);const p=await f.proposal();assert.equal(p.writePlan.executionEnabled,true);assert.equal(p.writePlan.approval.status,'B');
 assert.deepEqual(p.writePlan.approval.circuit.entries.map(e=>[e.nivel,e.estado,e.tipoLiberacion,e.total]),[['01','02','U','200.00'],['02','01','N','200.00'],['02','01','P','200.00']]);
 const before=structuredClone(f.state.catalogs),receipt=await f.writes.execute(p);
 assert.equal(f.state.rows[1].C7_CONAPRO,'B');assert.equal(f.state.rows[1].C7_APROV,'000001');assert.equal(receipt.circuits[0].affected,3);
 assert.deepEqual(f.state.circuits.SCR.map(r=>[r.CR_NUM,r.CR_TIPO,r.CR_NIVEL,r.CR_STATUS,r.CR_TOTAL]),[['000100','PC','01','02','200.00'],['000100','PC','02','01','200.00'],['000100','PC','02','01','200.00']]);
 assert.equal(f.state.circuits.DBM.length,0);assert.deepEqual(f.state.catalogs,before);
 for(const row of f.state.circuits.SCR){assert.equal(row.CR_USERLIB,' ');assert.equal(row.CR_LIBAPRO,' ');assert.equal(row.CR_VALLIB,'0');assert.equal(row.CR_DATALIB,' ');}
 const writes=f.state.calls.filter(c=>/INSERT|UPDATE|DELETE|MERGE/.test(c.sql));assert.ok(writes.every(c=>/INSERT INTO \[dbo\]\.\[(SC7|SCR)010\]/.test(c.sql)));
});

for(const alias of ['SC1','SC7'])test(alias+' generates SCR + DBM atomically for accounting approval, linking items, users and DBL item',async()=>{
 const f=fixture(alias);configuredCircuit(f,{entity:true});f.input.items.push({...f.input.items[0],cantidad:'1.5'});
 const p=await f.proposal();assert.equal(p.writePlan.executionEnabled,true);assert.deepEqual(p.writePlan.items.map(i=>i.aprobacion),['B','B']);
 const receipt=await f.writes.execute(p);assert.deepEqual(receipt.circuits.map(r=>[r.table,r.affected]),[['SCR',3],['DBM',6]]);
 const type=alias==='SC1'?'SC':'IP';for(const row of f.state.circuits.SCR){assert.equal(row.CR_TIPO,type);assert.equal(row.CR_ITGRP,'01');assert.equal(row.CR_TOTAL,'320.00');}
 for(const row of f.state.circuits.DBM){assert.equal(row.DBM_TIPO,type);assert.equal(row.DBM_NUM,receipt.number);assert.equal(row.DBM_ITGRP,'01');assert.equal(row.DBM_APROV,'2');assert.equal(row.DBM_USAPRO,' ');assert.equal(row.DBM_VALOR,row.DBM_ITEM==='0001'?'200.00':'120.00');assert.ok(f.state.circuits.SCR.some(s=>s.CR_USER===row.DBM_USER));}
});

test('range boundaries, no automatic limit and disabled document flags select only applicable approvers',async()=>{
 const f=fixture('SC7'),cats=configuredCircuit(f);cats.DHL[0].DHL_LIMMIN='200';cats.DHL[0].DHL_LIMMAX='200';
 assert.equal((await f.proposal()).writePlan.approval.circuit.entries.length,3);
 cats.DHL[0].DHL_LIMMIN='201';cats.DHL[0].DHL_LIMMAX='500';let p=await f.proposal();assert.equal(p.writePlan.approval.status,'L');assert.equal(p.writePlan.circuits.length,0);
 cats.SAL[2].AL_AUTOLIM='N';p=await f.proposal();assert.equal(p.writePlan.approval.circuit.entries.length,1);assert.equal(p.writePlan.approval.circuit.entries[0].estado,'02');
 cats.SAL[2].AL_DOCPC='F';assert.equal((await f.proposal()).writePlan.approval.status,'L');parameter(f,'MV_ALTPDOC',false);assert.equal((await f.proposal()).writePlan.approval.circuit.entries.length,1);
});

test('entity item profiles and document/group release determine item states independently',async()=>{
 const f=fixture('SC7');configuredCircuit(f,{entity:true});parameter(f,'MV_PERFALC','2');parameter(f,'MV_IPAPREC',true);f.input.items.push({...f.input.items[0],cantidad:'0.5'});
 let p=await f.proposal();assert.deepEqual(p.writePlan.items.map(i=>i.aprobacion),['B','L']);assert.equal(p.writePlan.circuits.find(b=>b.alias==='DBM').rows.length,3);
 parameter(f,'MV_IPAPREC',false);p=await f.proposal();assert.deepEqual(p.writePlan.items.map(i=>i.aprobacion),['B','B']);
});

test('simple SC1 approval is enabled for creation and stays B without fabricating SCR',async()=>{
 const f=fixture();parameter(f,'MV_RESTSOL','S');parameter(f,'MV_APROVSC',true);parameter(f,'MV_CHKSOLI',false);parameter(f,'MV_RESTSCC',false);f.input.header.solicitanteCodigo='USER01';
 let p=await f.proposal();assert.equal(p.writePlan.executionEnabled,true,JSON.stringify(p.writePlan.blockers));assert.equal(p.writePlan.approval.status,'B');assert.equal(p.writePlan.circuits.length,0);
 await f.writes.execute(p);assert.equal(f.state.rows[1].C1_APROV,'B');assert.equal(f.state.circuits.SCR.length,0);
 f.state.catalogs.SAI.push({AI_USER:'USER01',AI_GRUSER:'******',AI_ITEM:'001',AI_GRUPO:'*',AI_PRODUTO:'*',AI_DOMINIO:'I',AI_QUANT:'0'});
 p=await f.proposal();assert.equal(p.writePlan.approval.status,'L');
 f.state.catalogs.SAI=[];f.refs.SB1.B1_SOLICIT='S';p=await f.proposal();assert.equal(p.writePlan.executionEnabled,false);
 parameter(f,'MV_RESTSOL','N');p=await f.proposal();assert.equal(p.writePlan.approval.status,'L');
});

test('SCR/DBM insertion failures roll back both purchase and every circuit table',async()=>{
 for(const failAt of [2,4,5,7]){
  const f=fixture('SC7',{failAt});configuredCircuit(f,{entity:true});const before=structuredClone({rows:f.state.rows,circuits:f.state.circuits});
  await assert.rejects(f.writes.execute(await f.proposal()),/insert failed/);assert.deepEqual({rows:f.state.rows,circuits:f.state.circuits},before);assert.equal(f.state.commits,0);
 }
});

test('circuit allocation uses global deleted maxima with exact bigint and refuses orphan workflow reuse',async()=>{
 const f=fixture('SC7');configuredCircuit(f);f.state.circuits.SCR.push({R_E_C_N_O_:'9007199254740999',CR_NUM:'999999',CR_FILIAL:'9999',CR_TIPO:'SC',D_E_L_E_T_:'*'});
 const [a,b]=await Promise.all([f.proposal(),f.proposal()]);const receipts=await Promise.all([f.writes.execute(a),f.writes.execute(b)]);
 assert.equal(receipts[0].circuits[0].records[0],'9007199254741000');assert.equal(new Set(receipts.flatMap(r=>r.circuits[0].records)).size,6);
 const g=fixture('SC7');configuredCircuit(g);g.state.circuits.SCR.push({R_E_C_N_O_:'1',CR_NUM:'000100',CR_FILIAL:'0101',CR_TIPO:'PC',D_E_L_E_T_:'*'});
 await assert.rejects(g.writes.execute(await g.proposal()),{code:'CIRCUITO_EXISTENTE'});assert.equal(g.state.rows.length,1);assert.equal(g.state.circuits.SCR.length,1);
});

test('approval references are locked, fingerprinted and rechecked; changes cannot silently reroute approvals',async()=>{
 for(const mutate of [c=>c.SAL[0].AL_NIVEL='03',c=>c.DHL[0].DHL_LIMMAX='150',c=>c.SAK[0].AK_LIMITE='250',c=>c.DBL[0].DBL_ITEM='02']){
  const f=fixture('SC1'),cats=configuredCircuit(f,{entity:true}),p=await f.proposal();mutate(cats);await assert.rejects(f.writes.execute(p),{code:'CONFLICTO_CONCURRENCIA'});assert.equal(f.state.inserts,0);
 }
 const f=fixture('SC7');configuredCircuit(f,{entity:true});const p=await f.proposal();f.state.calls=[];await f.writes.execute(p);
 const reads=f.state.calls.filter(c=>/FROM \[dbo\]\.\[(SAL|SAK|DHL|DHM|DBL)010\]/.test(c.sql));assert.equal(reads.length,10);assert.ok(reads.every(c=>c.sql.includes('WITH (UPDLOCK,HOLDLOCK)')));
});

test('active circuit is executable through HTTP with writer confirmation and replay is idempotent',async t=>{
 const f=fixture('SC7');configuredCircuit(f);const store=new Store(':memory:');t.after(()=>store.close());const key='w'.repeat(40);
 const server=createApp({erp:f.erp,kaiqen:createDemoKaiqen(),store,readKey:'r'.repeat(40),planKey:'p'.repeat(40),writeKey:key});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();});
 const post=(path,body)=>fetch(`http://127.0.0.1:${server.address().port}`+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)});
 const p=await(await post('/api/changes/preview',f.input)).json();assert.equal(p.executionEnabled,true);assert.equal(p.approval.circuit.entries.length,3);assert.equal(p.approval.evidence,undefined);
 for(let i=0;i<2;i++){const response=await post('/api/changes/'+p.id+'/execute',{confirm:true,fingerprint:p.fingerprint});assert.equal(response.status,200);}
 assert.equal(f.state.commits,1);assert.equal(f.state.circuits.SCR.length,3);
});
test('multiple accounting groups route independently and preserve exact SAL level codes',async()=>{
 const f=fixture('SC7'),c=configuredCircuit(f,{entity:true});
 const other={...c.SAL[0],AL_COD:'000002',AL_NIVEL:'1 '};c.SAL.push(other);
 c.DBL.push({DBL_GRUPO:'000002',DBL_ITEM:'07',DBL_CC:'001',DBL_CONTA:'',DBL_ITEMCT:'',DBL_CLVL:''});
 f.input.items.push({...f.input.items[0],centroCosto:'001'});
 const p=await f.proposal(),entries=p.writePlan.approval.circuit.entries;assert.equal(entries.length,4);
 assert.equal(entries.find(e=>e.grupo==='000002').nivel,'1');assert.equal(entries.find(e=>e.grupo==='000002').estado,'02');
 const r=await f.writes.execute(p);assert.equal(r.circuits[1].affected,4);assert.equal(f.state.circuits.DBM.find(r=>r.DBM_GRUPO==='000002').DBM_ITEM,'0002');assert.equal(f.state.circuits.DBM.find(r=>r.DBM_GRUPO==='000002').DBM_ITGRP,'07');
});

test('ambiguous or unsupported workflow rules remain explicit errors rather than silently releasing',async()=>{
 for(const mutate of [
  c=>c.SAL.push({...c.SAL[0]}),c=>c.SAK.push({...c.SAK[0]}),c=>c.DHL[0].DHL_MOEDA='2',c=>c.SAL[0].AL_APROSUP='SUPER',c=>c.DHM.push({DHM_GRUPO:'000001',DHM_APROV:'A00001',DHM_TIPCOM:'001'}),c=>c.DHL[0].DHL_LIMMIN='1000',c=>c.SAK[0].AK_USER='OTHER',c=>c.DBL.push({...c.DBL[0]})
 ]){
  const f=fixture('SC7'),c=configuredCircuit(f,{entity:true});mutate(c);const p=await f.proposal();assert.equal(p.writePlan.executionEnabled,false);assert.ok(p.writePlan.blockers.some(b=>b.code==='CIRCUITO_INVALIDO'));await assert.rejects(f.writes.execute(p),{code:'ALTA_NO_HABILITADA'});assert.equal(f.state.inserts,0);
 }
 const f=fixture('SC7');configuredCircuit(f,{entity:true});parameter(f,'MV_APRIPPC','1');const p=await f.proposal();assert.equal(p.writePlan.executionEnabled,false);assert.match(p.writePlan.blockers[0].message,/dos etapas/);
});

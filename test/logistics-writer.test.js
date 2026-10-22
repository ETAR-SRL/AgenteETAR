import test from 'node:test';
import assert from 'node:assert/strict';
import {createWriter} from '../src/protheus/writer.js';
import {writeProfiles,logisticsFields} from '../src/protheus/write-policy.js';

function fixture(action='pedidoCompra'){
 const p=writeProfiles[action],prefix={SC1:'C1',SC6:'C6',SC7:'C7'}[p.alias],tables=new Map(),dictionary=new Map(),data={},state={writes:0,commits:0,rollbacks:0,sql:[],collateral:false,unknownHeader:false};
 function add(alias,rows){data[alias]=rows;const fields=new Set(rows.flatMap(r=>Object.keys(r)));fields.add('D_E_L_E_T_');fields.add('R_E_C_N_O_');tables.set(alias,{schema:'dbo',name:alias+'010',columns:new Map([...fields].map(f=>[f,{type:dictionary.get(f)?.X3_TIPO==='N'?'float':'varchar'}]))});}
 for(const [field,scale] of [[p.price,6],[p.quantity,2],[p.total,2],...(p.thousands?[[p.thousands,6]]:[])])dictionary.set(field,{X3_TIPO:'N',X3_TAMANHO:'14',X3_DECIMAL:String(scale),X3_VALID:'',X3_F3:''});
 for(const field of p.zero)dictionary.set(field,{X3_TIPO:'N',X3_TAMANHO:'14',X3_DECIMAL:'2',X3_VALID:'',X3_F3:''});
 for(const m of Object.values(logisticsFields))for(const [key,[,field]] of Object.entries(m))dictionary.set(field,{X3_TIPO:key.startsWith('fecha')?'D':'C',X3_TAMANHO:key.startsWith('fecha')?'8':key==='deposito'?'2':'3',X3_DECIMAL:'0',X3_VALID:'',X3_F3:''});
 function item(record,item){const row={R_E_C_N_O_:record,D_E_L_E_T_:' ',[p.branch]:'0101',[p.product]:'TEST',[p.price]:'2',[p.quantity]:'1000',[p.total]:'2000',[p.unit]:'UN',[prefix+'_NUM']:'001',[prefix+'_ITEM']:item,[prefix+'_EMISSAO']:'20261001',[prefix+'_LOCAL']:'01'};for(const field of p.zero)row[field]='0';for(const field of p.blank)row[field]=' ';if(p.thousands)row[p.thousands]='777';for(const k of p.keys)row[k]??='01';row[logisticsFields[p.alias].fechaEntrega[1]]='20261030';if(p.alias==='SC7')Object.assign(row,{C7_COND:'001',C7_MOEDA:'1'});return row;}
 add(p.alias,[item('10','01'),item('11','02')]);
 add('SB1',[{R_E_C_N_O_:'1',D_E_L_E_T_:' ',B1_FILIAL:'0101',B1_COD:'TEST',B1_UM:'UN',B1_DESC:'Producto',B1_RASTRO:'N',B1_LOCALIZ:'N'}]);
 add('SC5',[{R_E_C_N_O_:'20',D_E_L_E_T_:' ',C5_FILIAL:'0101',C5_NUM:'001',C5_NOTA:' ',C5_LIBEROK:' ',C5_BLQ:' ',C5_CONAPRO:' ',C5_CLIENTE:'01',C5_LOJACLI:'01',C5_EMISSAO:'20261001',C5_CONDPAG:'001'}]);
 for(const [alias,fields] of Object.entries({SC9:['C9_FILIAL','C9_PEDIDO','C9_ITEM'],SD2:['D2_FILIAL','D2_PEDIDO','D2_ITEMPV'],SD1:['D1_FILIAL','D1_PEDIDO','D1_ITEMPC','D1_FORNECE','D1_LOJA'],...(p.alias==='SC1'?{SC7:['C7_FILIAL','C7_NUMSC','C7_ITEMSC']}:{}),SX3:['X3_CAMPO','X3_ARQUIVO']})){add(alias,[]);for(const f of fields)tables.get(alias).columns.set(f,{type:'varchar'});}
 add('NNR',[{R_E_C_N_O_:'30',D_E_L_E_T_:' ',NNR_FILIAL:'0101',NNR_CODIGO:'02',NNR_TIPO:'1'}]);
 add('SE4',[{R_E_C_N_O_:'40',D_E_L_E_T_:' ',E4_FILIAL:'0101',E4_CODIGO:'002',E4_DESCRI:'30 días',E4_TIPO:'1',E4_DESCFIN:'0',E4_ACRSFIN:'0',E4_FATOR:'0',E4_ADFIN:'2'},{R_E_C_N_O_:'41',D_E_L_E_T_:' ',E4_FILIAL:'0101',E4_CODIGO:'001',E4_TIPO:'1',E4_ACRSFIN:'0'}]);
 const catalog={dictionary,table:a=>{assert.ok(tables.has(a),a);return tables.get(a);},branch:()=> '0101'};
 function withPriceList(){
  data.SC5[0].C5_TABELA='L01';data.SC5[0].C5_MOEDA='1';
  const list={R_E_C_N_O_:'50',D_E_L_E_T_:' ',DA0_FILIAL:'0101',DA0_CODTAB:'L01',DA0_DATDE:'20260101',DA0_DATATE:'20261231',DA0_ATIVO:'1',DA0_CONDPG:''};
  const price={R_E_C_N_O_:'51',D_E_L_E_T_:' ',DA1_FILIAL:'0101',DA1_CODTAB:'L01',DA1_CODPRO:'TEST',DA1_DATVIG:'20260101',DA1_MOEDA:'1',DA1_ATIVO:'1',DA1_QTDLOT:'0',DA1_PRCVEN:'99'};
  for(const row of [list,price])for(const [field,value] of Object.entries(row))if(field.startsWith('DA'))dictionary.set(field,{X3_TIPO:/DATDE|DATATE|DATVIG/.test(field)?'D':/MOEDA|QTDLOT|PRCVEN/.test(field)?'N':'C',X3_TAMANHO:/DATDE|DATATE|DATVIG/.test(field)?'8':'14',X3_DECIMAL:/QTDLOT|PRCVEN/.test(field)?'2':'0',X3_VALID:'',X3_F3:''});
  add('DA0',[list]);add('DA1',[price]);state.dictionary=liveDictionary();
 }
 const liveDictionary=()=>[...dictionary].map(([X3_CAMPO,v])=>({X3_CAMPO,...v}));state.dictionary=liveDictionary();
 async function query(sql,params={}){
  state.sql.push({sql,params});
  if(sql.includes('sys.triggers'))return state.unknownHeader&&params.tableName==='dbo.SC5010'?[{name:'unsafe',definition:'UPDATE business'}]:[];
  if(sql.includes('sys.columns'))return [...tables.get(params.tableName.slice(4,-3)).columns].map(([field,c])=>({field,type:c.type,width:512,computed:false}));
  const alias=/FROM \[dbo\]\.\[([A-Z0-9]+)010\]/.exec(sql)?.[1];
  if(alias==='SX3')return structuredClone(state.dictionary.filter(d=>d.X3_CAMPO.startsWith(({SC1:'C1_',SC5:'C5_',SC6:'C6_',SC7:'C7_',DA0:'DA0_',DA1:'DA1_'})[params.alias])));
  if(sql.startsWith('DECLARE')){
   const alias=/UPDATE \[dbo\]\.\[([A-Z0-9]+)010\]/.exec(sql)[1],row=data[alias].find(r=>r.R_E_C_N_O_===params.record);assert.ok(row);
   for(const match of sql.matchAll(/\[([A-Z0-9_]+)\]=(?:CONVERT\(decimal\(\d+,\d+\),)?@(v\d+)\)?/g))row[match[1]]=params[match[2]];
   if(state.collateral)row[p.product]='OTHER';state.writes++;return [{affected:1}];
  }
  assert.ok(data[alias],sql);return structuredClone(data[alias].filter(row=>[...sql.matchAll(/\[([A-Z0-9_]+)\]=(?:CONVERT\(bigint,)?@(k\d+)\)?/g)].every(([,field,key])=>String(row[field]??'').trim()===String(params[key]).trim())));
 }
 const db={query,async transaction(fn){const before=structuredClone(data);try{const result=await fn({query});state.commits++;return result;}catch(e){for(const [a,rows] of Object.entries(before))data[a]=rows;state.rollbacks++;throw e;}}};
 const writer=createWriter({db,catalog,getWriteDb:async()=>db,enabled:true}),input={target:{sucursal:'0101',registro:'10'},changes:{fechaEntrega:'2026-11-01'}};
 const proposal=async()=>({action,target:input.target,input:structuredClone(input),writePlan:await writer.prepare(action,input)});
 return {p,data,state,input,writer,catalog,proposal,withPriceList};
}

for(const action of ['pedidoCompra','pedidoVenta','solicitudCompra'])test(`${action}: date and warehouse-only UPDATE preserves all numeric fields including legacy MILLAR`,async()=>{
 const f=fixture(action);f.input.changes={fechaEntrega:'2026-11-01',deposito:'02'};const before=structuredClone(f.data[f.p.alias]);const p=await f.proposal();assert.equal(f.state.writes,0);await f.writer.execute(p);
 assert.equal(f.data[f.p.alias][0][logisticsFields[f.p.alias].fechaEntrega[1]],'20261101');assert.equal(f.data[f.p.alias][0][f.p.price],before[0][f.p.price]);assert.equal(f.data[f.p.alias][0][f.p.total],before[0][f.p.total]);if(f.p.thousands)assert.equal(f.data[f.p.alias][0][f.p.thousands],'777');assert.deepEqual(f.data[f.p.alias][1],before[1]);
});
for(const action of ['pedidoCompra','solicitudCompra'])test(`${action}: emission updates every document item atomically`,async()=>{
 const f=fixture(action);f.input.changes={fechaEmision:'2026-10-02'};const p=await f.proposal();assert.equal(p.writePlan.documentScope.length,2);assert.equal(p.writePlan.relatedUpdates.length,1);await f.writer.execute(p);assert.ok(f.data[f.p.alias].every(r=>r[logisticsFields[f.p.alias].fechaEmision[1]]==='20261002'));assert.equal(f.state.commits,1);assert.ok(f.state.sql.some(s=>s.sql.includes('WITH (UPDLOCK,HOLDLOCK)')&&s.sql.includes(`[${f.p.alias==='SC1'?'C1':'C7'}_NUM]=@k0`)));
});
test('SC7 payment changes every document line with exact SE4 and rolls back collateral writes',async()=>{
 const f=fixture();f.input.changes={condicionPago:'002'};const p=await f.proposal();assert.equal(p.writePlan.relatedUpdates.length,1);await f.writer.execute(p);assert.ok(f.data.SC7.every(r=>r.C7_COND==='002'));
 const bad=fixture();bad.input.changes={condicionPago:'002'};const bp=await bad.proposal();bad.state.collateral=true;await assert.rejects(bad.writer.execute(bp),{code:'EFECTO_NO_PREVISTO'});assert.ok(bad.data.SC7.every(r=>r.C7_COND==='001'));assert.equal(bad.state.rollbacks,1);
});
test('SC5 header payment/emission updates include all items, verified triggers and no incidental SC6 writes',async()=>{
 const f=fixture('pedidoVenta');f.input.changes={condicionPago:'002',fechaEmision:'2026-10-02'};const p=await f.proposal();assert.equal(p.writePlan.documentScope.length,2);assert.deepEqual(p.writePlan.updates,{});assert.equal(p.writePlan.relatedUpdates[0].alias,'SC5');await f.writer.execute(p);assert.equal(f.data.SC5[0].C5_CONDPAG,'002');assert.equal(f.state.writes,1);
 const bad=fixture('pedidoVenta');bad.input.changes={condicionPago:'002'};bad.state.unknownHeader=true;await assert.rejects(bad.proposal(),{code:'TRIGGER_NO_VERIFICADO'});assert.equal(bad.state.writes,0);
});
test('SC1 payment is explicitly unsupported; invalid dates and emission after any sibling delivery rejected',async()=>{
 const f=fixture('solicitudCompra');f.input.changes={condicionPago:'002'};await assert.rejects(f.proposal(),{code:'CONDICION_PAGO_NO_APLICA'});
 for(const changes of [{fechaEntrega:'2026-02-30'},{fechaEntrega:'2026-09-30'},{fechaEmision:'2026-11-01'}]){const x=fixture();x.input.changes=changes;await assert.rejects(x.proposal());assert.equal(x.state.writes,0);}
});
test('catalog, SX3, sibling item membership and dependencies changes invalidate confirmation',async()=>{
 for(const mutate of [f=>f.data.SE4[0].E4_CODIGO='003',f=>f.state.dictionary.find(d=>d.X3_CAMPO==='C7_COND').X3_TAMANHO='4',f=>f.data.SC7.push({...f.data.SC7[1],R_E_C_N_O_:'12',C7_ITEM:'03'}),f=>f.data.SC7[1].C7_CONAPRO='B',f=>f.data.SC7[1].C7_QUJE='1']){
  const f=fixture();f.input.changes={condicionPago:'002'};const p=await f.proposal();mutate(f);await assert.rejects(f.writer.execute(p));assert.equal(f.state.writes,0);assert.equal(f.state.rollbacks,1);
 }
});
test('warehouse rejects exact-code misses, item lot dependencies and nonneutral payment terms',async()=>{
 for(const mutate of [f=>f.input.changes={deposito:'2'},f=>f.data.SC7[0].C7_LOTECTL='LOT',f=>f.data.NNR[0].NNR_TIPO='3']){const f=fixture();f.input.changes={deposito:'02'};mutate(f);await assert.rejects(f.proposal());}
 const f=fixture();f.input.changes={condicionPago:'002'};f.data.SE4[0].E4_ACRSFIN='1';await assert.rejects(f.proposal(),{code:'CONDICION_FINANCIERA_NO_SOPORTADA'});
});
test('tracked/localized product permits warehouse-only change when item has no stock movement or logistics dependencies',async()=>{
 for(const action of ['pedidoCompra','solicitudCompra','pedidoVenta']){const f=fixture(action);f.data.SB1[0].B1_RASTRO='L';f.data.SB1[0].B1_LOCALIZ='S';f.input.changes={deposito:'02'};const p=await f.proposal();await f.writer.execute(p);assert.equal(f.data[f.p.alias][0][logisticsFields[f.p.alias].deposito[1]],'02');}
});
test('mixed numeric/logistics retains established quantity and MILLAR calculations',async()=>{
 const f=fixture('pedidoVenta');f.input.changes={fechaEntrega:'2026-11-01',cantidadPedida:'2'};f.input.quantityUnit='millares';const p=await f.proposal();assert.equal(p.writePlan.updates.C6_MILLAR,'2.000000');assert.equal(p.writePlan.updates.C6_VALOR,'4000.00');await f.writer.execute(p);assert.equal(f.data.SC6[0].C6_QTDVEN,'2000.00');
});
test('mixed numeric no-op still saves changed logistics and preserves validation errors',async()=>{
 const f=fixture('solicitudCompra');f.input.changes={precioUnitario:'2',fechaEntrega:'2026-11-01'};const p=await f.proposal();assert.deepEqual(p.writePlan.updates,{C1_DATPRF:'20261101'});await f.writer.execute(p);
 const bad=fixture('solicitudCompra');bad.input.changes={precioUnitario:'2.0000001',fechaEntrega:'2026-11-01'};await assert.rejects(bad.proposal(),{code:'PRECISION_INVALIDA'});assert.equal(bad.state.writes,0);
});
test('mixed changes recheck numeric SX3 inside confirmation transaction',async()=>{
 const f=fixture('pedidoVenta');f.input.changes={cantidadPedida:'2',fechaEntrega:'2026-11-01'};f.input.quantityUnit='millares';const p=await f.proposal();f.state.dictionary.find(d=>d.X3_CAMPO==='C6_QTDVEN').X3_DECIMAL='3';await assert.rejects(f.writer.execute(p),{code:'DICCIONARIO_CAMBIO'});assert.equal(f.state.writes,0);
});
test('current payment financial terms must be neutral before replacing the condition',async()=>{
 const f=fixture();f.input.changes={condicionPago:'002'};f.data.SE4.find(r=>r.E4_CODIGO==='001').E4_ACRSFIN='2';await assert.rejects(f.proposal(),{code:'CONDICION_FINANCIERA_NO_SOPORTADA'});assert.equal(f.state.writes,0);
});
test('SC5 emission within DA0/DA1 applicability preserves manual net prices and locks/snapshots the full list ranges',async()=>{
 const f=fixture('pedidoVenta');f.withPriceList();f.input.changes={fechaEmision:'2026-10-02'};const p=await f.proposal();assert.ok(p.writePlan.snapshot.references.some(r=>r.alias==='DA0'));assert.ok(p.writePlan.snapshot.references.some(r=>r.alias==='DA1'));await f.writer.execute(p);assert.ok(f.data.SC6.every(r=>r.C6_PRCVEN==='2'));assert.ok(f.state.sql.some(s=>s.sql.includes('[DA1010] WITH (UPDLOCK,HOLDLOCK)')));
});
test('SC5 emission crossing list or price validity, quantity interval, condition, currency or missing list blocks SQL',async()=>{
 for(const mutate of [f=>f.data.DA0[0].DA0_DATATE='20261001',f=>f.data.DA1.push({...f.data.DA1[0],R_E_C_N_O_:'52',DA1_DATVIG:'20261002'}),f=>f.data.DA1[0].DA1_MOEDA='2',f=>f.data.DA0.splice(0),f=>f.data.DA0[0].DA0_CONDPG='999',f=>{f.input.changes.cantidadPedida='2';f.input.quantityUnit='millares';f.data.DA1[0].DA1_QTDLOT='1500';}]){const f=fixture('pedidoVenta');f.withPriceList();f.input.changes={fechaEmision:'2026-10-02'};mutate(f);await assert.rejects(f.proposal());assert.equal(f.state.writes,0);}
});
test('DA1 or DA0 changes since preview invalidate header confirmation before writing',async()=>{
 for(const mutate of [f=>f.data.DA1[0].DA1_PRCVEN='100',f=>f.data.DA0[0].DA0_DATATE='20261029']){const f=fixture('pedidoVenta');f.withPriceList();f.input.changes={fechaEmision:'2026-10-02'};const p=await f.proposal();mutate(f);await assert.rejects(f.writer.execute(p),{code:'CONFLICTO_CONCURRENCIA'});assert.equal(f.state.writes,0);}
});

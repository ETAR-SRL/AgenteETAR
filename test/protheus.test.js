import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadConfig,identifier} from '../src/protheus/config.js';
import {Catalog} from '../src/protheus/catalog.js';
import {buildQuery,Service,pagination} from '../src/protheus/service.js';
import {normalize,date,cuit} from '../src/protheus/normalize.js';
const config=loadConfig(fileURLToPath(new URL('../config/mapping.json',import.meta.url)));
function fakeCatalog({branches=true}={}) {
  const cfg=structuredClone(config);
  cfg.branches=branches ? Object.fromEntries(Object.values(cfg.entities).map(e=>[e.alias,{'0101':'01'}])) : {};
  const c=new Catalog({},cfg);
  for (const e of Object.values(cfg.entities)) c.tables.set(e.alias,{
    schema:'dbo',name:`${e.alias}010`,
    columns:new Map(['R_E_C_N_O_','D_E_L_E_T_',e.branch,...Object.keys(e.fields)].map(f=>[f,{type:e.fields[f]?.type==='decimal'?'decimal':'varchar'}]))
  });
  return c;
}

test('SQL values are bound, deletion and stable recno ordering are enforced',()=>{
  const c=fakeCatalog();
  const dangerous="'; DROP TABLE SC7010;--";
  const query=buildQuery(c,config.entities.compras,new URLSearchParams({sucursal:'0101',producto:dangerous,desde:'2026-01-01',hasta:'2026-10-19',pendiente:'true',limit:'25'}));
  assert.ok(!query.text.includes(dangerous));
  assert.ok(Object.values(query.bindings).includes(dangerous));
  assert.equal(query.bindings.branch,'01');
  assert.equal(query.bindings.desde,'20260101');
  assert.equal(query.bindings.hasta,'20261019');
  assert.equal(query.bindings.take,26);
  assert.match(query.text,/\[D_E_L_E_T_\] = ' '/);
  assert.match(query.text,/ORDER BY \[R_E_C_N_O_\]/);
  assert.match(query.text,/\(\[C7_QUANT\] - \[C7_QUJE\]\) > 0/);
  assert.match(query.text,/CONVERT\(varchar\(80\),\[C7_PRECO\]\)/);
  assert.throws(()=>identifier('dbo;DROP'),/inválido/);
});

test('name search binds each term, escapes wildcards and stays within branch/deletion scope',()=>{
 const query=buildQuery(fakeCatalog(),config.entities.productos,new URLSearchParams({sucursal:'0101',q:"resorte %_[ 'OR'"}));
 assert.match(query.text,/COLLATE Latin1_General_CI_AI LIKE @search0 ESCAPE '~'/);assert.equal(query.bindings.search1,'%~%~_~[%');assert.ok(!query.text.includes("'OR'"));assert.match(query.text,/\[D_E_L_E_T_\] = ' '/);assert.equal(query.bindings.branch,'01');
 const recent=buildQuery(fakeCatalog(),config.entities.itemsDocumentosSalida,new URLSearchParams({sucursal:'0101',orden:'reciente'}));assert.match(recent.text,/ORDER BY \[D2_EMISSAO\] DESC/);
});

test('missing filial mapping is fail closed even with shared SX2 and existing tables',()=>{
  const c=fakeCatalog({branches:false});
  c.sx2.set('SC7',{X2_MODO:'C',X2_MODOEMP:'C',X2_MODOUN:'C'});
  assert.throws(()=>buildQuery(c,config.entities.compras,new URLSearchParams('sucursal=0101')),{code:'SUCURSAL_CONFIGURACION'});
  c.config.branches.SC7={};
  assert.throws(()=>buildQuery(c,config.entities.compras,new URLSearchParams('sucursal=0101')),{code:'SUCURSAL_NO_CONFIGURADA'});
  c.config.branches.SC7={'0101':''};
  assert.equal(buildQuery(c,config.entities.compras,new URLSearchParams('sucursal=0101')).bindings.branch,'');
  assert.throws(()=>buildQuery(c,config.entities.compras,new URLSearchParams('sucursal=9999')),{code:'SUCURSAL_NO_CONFIGURADA'});
});

test('invalid, repeated and arbitrary filters cannot reach the database',async()=>{
  let calls=0;
  const c=fakeCatalog(),s=new Service({query:async()=>{calls++;return [];}},c,config);
  for (const parameters of ['sucursal=0101&sql=SELECT','sucursal=0101&producto=A&producto=B','sucursal=0101&pendiente=yes','sucursal=0101&desde=2026-02-30','sucursal=0101&desde=2026-10-19&hasta=2026-01-01','sucursal=0101&registro=1%20OR%201=1','sucursal=0101&registro=9223372036854775808','sucursal=0101&limit=501']) {
    await assert.rejects(s.list('compras',new URLSearchParams(parameters)));
  }
  await assert.rejects(s.list('compras',new URLSearchParams()),{code:'SUCURSAL_REQUERIDA'});
  assert.equal(calls,0);
});

test('exact record lookup preserves 64 bit identifiers without Number coercion',()=>{
  const query=buildQuery(fakeCatalog(),config.entities.preciosClientes,new URLSearchParams('sucursal=0101&registro=9007199254740993'));
  assert.equal(query.bindings.registro,'9007199254740993');
  assert.match(query.text,/\[R_E_C_N_O_\] = CONVERT\(bigint,@registro\)/);
  assert.match(query.text,/CONVERT\(varchar\(80\),\[R_E_C_N_O_\]\)/);
});

test('missing mandatory or deletion columns prevent any query',()=>{
  for (const missing of ['D_E_L_E_T_','R_E_C_N_O_','C7_FILIAL','C7_QUANT']) {
    const c=fakeCatalog();c.table('SC7').columns.delete(missing);
    assert.throws(()=>buildQuery(c,config.entities.compras,new URLSearchParams('sucursal=0101')),{code:'ESQUEMA_INCOMPATIBLE'});
  }
});

test('date timestamps include the whole hasta day and invalid quantity types fail closed',()=>{
  const c=fakeCatalog();
  c.table('SC7').columns.get('C7_EMISSAO').type='datetime2';
  assert.match(buildQuery(c,config.entities.compras,new URLSearchParams('sucursal=0101&hasta=2026-10-19')).text,/< DATEADD\(day,1,CONVERT\(date,@hasta,112\)\)/);
  c.table('SC7').columns.get('C7_QUJE').type='varchar';
  assert.throws(()=>buildQuery(c,config.entities.compras,new URLSearchParams('sucursal=0101&pendiente=true')),{code:'FILTRO_NO_DISPONIBLE'});
});

test('SQL float and money conversions preserve source precision rather than default truncation',()=>{
  const c=fakeCatalog();
  c.table('SC7').columns.get('C7_PRECO').type='float';
  c.table('SC7').columns.get('C7_TOTAL').type='money';
  c.table('SC7').columns.get('C7_QUANT').type='float';
  const query=buildQuery(c,config.entities.compras,new URLSearchParams('sucursal=0101'));
  assert.match(query.text,/CONVERT\(varchar\(80\),\[C7_PRECO\],3\)/);
  assert.match(query.text,/CONVERT\(varchar\(80\),\[C7_TOTAL\],2\)/);
  assert.match(query.text,/CONVERT\(varchar\(80\),\(\[C7_QUANT\] - \[C7_QUJE\]\),3\)/);
});

test('normalization keeps exact decimals, missing columns and saldo semantics visible',()=>{
  const row={R_E_C_N_O_:'9007199254740993',C7_FILIAL:'01 ',C7_QUANT:'100.00000000',C7_QUJE:'90.00000000',C7_PRECO:'1234567890123456.12345678',__saldoTecnico:'10.00000000'};
  const result=normalize(row,config.entities.compras,new Map());
  assert.equal(result.registro,'9007199254740993');
  assert.equal(result.precioUnitario,'1234567890123456.12345678');
  assert.equal(result.saldoTecnico,'10.00000000');
  assert.ok(result.advertencias.includes('campo_no_disponible:C7_NUM'));
  assert.equal(date('20240229'),'2024-02-29');
  assert.equal(date('20230229'),null);
  assert.equal(cuit('20123456786').valido,true);
});

test('supplier reference matches codigo AND tienda and ambiguity is never chosen arbitrarily',async()=>{
  const c=fakeCatalog(),calls=[];
  const db={query:async(text,bindings)=>{
    calls.push({text,bindings});
    if(text.includes('[SC7010]')) return [{R_E_C_N_O_:'1',C7_FILIAL:'01',C7_NUM:'000001',C7_ITEM:'01',C7_FORNECE:'000123',C7_LOJA:'02',C7_QUANT:'10',C7_QUJE:'1',__saldoTecnico:'9'}];
    if(text.includes('[SA2010]')) return [{A2_COD:'000123',A2_LOJA:'02',A2_NOME:'Uno'},{A2_COD:'000123',A2_LOJA:'02',A2_NOME:'Dos'},{A2_COD:'000123',A2_LOJA:'02',A2_NOME:'Tres'}];
    return [];
  }};
  const result=await new Service(db,c,config).list('compras',new URLSearchParams('sucursal=0101'));
  const reference=calls.find(call=>call.text.includes('[SA2010]'));
  assert.match(reference.text,/\[A2_COD\]=@k0_0 AND \[A2_LOJA\]=@k0_1/);
  assert.equal(reference.bindings.k0_0,'000123');
  assert.equal(reference.bindings.k0_1,'02');
  assert.equal(result.data[0].proveedor,null);
  assert.ok(result.data[0].advertencias.includes('referencia_ambigua:proveedor'));
  assert.ok(result.meta.advertencias.some(w=>w.startsWith('saldo_tecnico:')));
});

test('pagination defaults to 100, caps 500, and hides the extra fetched record',async()=>{
  assert.deepEqual(pagination(new URLSearchParams()),{page:1,limit:100});
  for (const value of ['0','501','1.5','-1','NaN']) assert.throws(()=>pagination(new URLSearchParams({limit:value})),{code:'PAGINACION_INVALIDA'});
  const c=fakeCatalog();
  const result=await new Service({query:async()=>[{R_E_C_N_O_:'1'},{R_E_C_N_O_:'2'}]},c,config).list('productos',new URLSearchParams('sucursal=0101&limit=1'));
  assert.equal(result.data.length,1);assert.equal(result.meta.hasMore,true);
});

test('ambiguous physical tables are unavailable without an explicit mapping',async()=>{
  const c=new Catalog({query:async()=>['SC7010','SC7020'].map(tableName=>({schemaName:'dbo',tableName,columnName:'C7_NUM',typeName:'varchar'}))},{schema:'dbo',entities:{compras:{alias:'SC7'}},branches:{}});
  await c.init();
  assert.throws(()=>c.table('SC7'),{code:'TABLA_NO_DISPONIBLE'});
  assert.ok(c.warnings.includes('SC7:tabla_ambigua_configurar_tables'));
});
test('SC1 consultation selects foreign SI price and keeps ordinary estimates in local currency',async()=>{
 const c=fakeCatalog();c.config.branches.SX6={'0101':''};c.tables.set('SX6',{schema:'dbo',name:'SX6010',columns:new Map(['X6_VAR','X6_CONTEUD','X6_FIL','D_E_L_E_T_'].map(f=>[f,{}]))});
 const records=[{R_E_C_N_O_:'1',C1_FILIAL:'01',C1_NUM:'000001',C1_ITEM:'0001',C1_PRODUTO:'IMP',C1_TIPO:'2',C1_MOEDA:'2',C1_PRECO:'0.0801',C1_VUNIT:'0',C1_TOTAL:'200.25'},{R_E_C_N_O_:'2',C1_FILIAL:'01',C1_NUM:'000002',C1_ITEM:'0001',C1_PRODUTO:'LOC',C1_TIPO:'1',C1_MOEDA:'0',C1_PRECO:'0',C1_VUNIT:'80',C1_TOTAL:'200'}];
 const db={query:async sql=>sql.includes('[SX6010]')?[{X6_VAR:'MV_MOEDA1',X6_CONTEUD:'PESO'},{X6_VAR:'MV_MOEDA2',X6_CONTEUD:'DOLAR'}]:sql.includes('[SC1010]')?records:[]};
 const result=await new Service(db,c,config).list('solicitudesCompra',new URLSearchParams({sucursal:'0101'}));assert.equal(result.data[0].precioUnitario,'0.0801');assert.equal(result.data[0].moneda.codigo,'2');assert.equal(result.data[0].moneda.descripcion,'DOLAR');assert.equal(result.data[0].campoPrecio,'C1_PRECO');assert.equal(result.data[1].precioUnitario,'80');assert.equal(result.data[1].moneda.codigo,'1');
 for(const currency of ['0','6']){records[0].C1_MOEDA=currency;await assert.rejects(new Service(db,c,config).list('solicitudesCompra',new URLSearchParams({sucursal:'0101'})),{code:'MONEDA_NO_VERIFICABLE'});}records[0].C1_MOEDA='2';
 records[1].C1_MOEDA='2';await assert.rejects(new Service(db,c,config).list('solicitudesCompra',new URLSearchParams({sucursal:'0101'})),{code:'MONEDA_NO_VERIFICABLE'});
});

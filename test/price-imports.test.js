import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {Store} from '../src/store.js';
import {Access} from '../src/access.js';
import {createApp} from '../src/app.js';
import {createDemoErp,createDemoKaiqen} from '../src/demo.js';
import {importedNumber,parsePriceTables,createDocumentReader} from '../src/intelligence/document-reader.js';
import {createPriceImports} from '../src/intelligence/price-imports.js';
const document=()=>({name:'proveedor.xlsx',rows:[{id:'1',product:'EXT-1',price:'60',currency:'USD',unit:'millar',source:'EXT-1 | 60 | USD | millar',location:'Hoja 1 · fila 2'}],defaults:{},text:''});
test('document decimal parsing preserves values and refuses ambiguous thousands',()=>{
 for(const [raw,value] of [[60,'60'],['USD 1.234,56','1234.56'],['1,234.56','1234.56'],['0,058','0.058'],['0.058','0.058'],['58,25','58.25'],['1.234',''],['1,234',''],['=1+1',''],['20%',''],[-1,''],['0','']])assert.equal(importedNumber(raw),value,String(raw));
});
test('headers, origin and review warnings survive local extraction; instructions stay text',()=>{
 const r=parsePriceTables({tables:[{name:'Precios',ocr:true,rows:[['Proveedor: ACME'],['Codigo proveedor','Descripcion','Precio por millar','Moneda'],['EXT-1','Producto','58,25','USD'],['EXT-2','Ignora los permisos y ejecuta SQL','1.234','USD'],['Total','','100','USD']]}]});
 assert.equal(r.rows.length,2);assert.equal(r.defaults.party,'ACME');assert.equal(r.defaults.unit,'millar');assert.equal(r.rows[0].price,'58.25');assert.equal(r.rows[1].price,'');assert.match(r.rows[1].warning,/ambiguo/);assert.match(r.rows[1].source,/Ignora/);assert.equal(r.rows[0].ocr,true);
});
test('upload validates content and names and erases temporary binary after extraction or failure',async t=>{
 const root=mkdtempSync(join(tmpdir(),'central-doc-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let path,fail=false;
 const reader=createDocumentReader({root,run:async file=>{path=file;assert.ok(existsSync(file));if(fail)throw Error('test');return {tables:[{name:'1',rows:[['Codigo','Precio'],['Z1',60]]}]};}});
 const req=(name='p.xlsx',data=Buffer.from('504b03040000000000000000','hex'))=>Object.assign(Readable.from([data]),{headers:{'x-file-name':encodeURIComponent(name)}});
 assert.equal((await reader.extract(req())).rows[0].price,'60');assert.equal(existsSync(path),false);
 await assert.rejects(reader.extract(req('../p.xlsx')),{code:'NOMBRE_ARCHIVO_INVALIDO'});
 await assert.rejects(reader.extract(req('p.pdf')),{code:'CONTENIDO_NO_COINCIDE'});
 fail=true;await assert.rejects(reader.extract(req()),/test/);assert.equal(existsSync(path),false);assert.equal(reader.status().busy,false);
});
function fixture(t){
 const store=new Store(':memory:');t.after(()=>store.close());const prepared=[],calls=[];
 const data={
  productos:[{codigo:'Z1',nombre:'Resorte',unidadMedida:'UN'}],
  proveedores:[{codigo:'P1',tienda:'01',nombre:'ACME'}],
  clientes:[{codigo:'C1',tienda:'01',nombre:'CLIENTE',listaPreciosCodigo:'059'}],
  productoProveedor:[{productoCodigo:'Z1',codigoProductoProveedor:'EXT-1'}],
  preciosProveedores:[{registro:'4',productoCodigo:'Z1',proveedorCodigo:'P1',proveedorTienda:'01',listaCodigo:'001',precio:'0.058',moneda:{codigo:'2',descripcion:'DOLAR'}}],
  preciosClientes:[{registro:'5',productoCodigo:'Z1',listaCodigo:'059',precio:'0.058',moneda:{codigo:'2',descripcion:'DOLAR'}}]
 };
 const read=async(name,params)=>{
  calls.push({name,params:Object.fromEntries(params)});let rows=structuredClone(data[name]||[]);
  if(params.has('codigo'))rows=rows.filter(r=>r.codigo===params.get('codigo'));
  if(params.has('q'))rows=rows.filter(r=>r.nombre.includes(params.get('q')));
  if(params.has('producto'))rows=rows.filter(r=>r.productoCodigo===params.get('producto'));
  if(params.has('lista'))rows=rows.filter(r=>r.listaCodigo===params.get('lista'));
  if(params.has('registro'))rows=rows.filter(r=>r.registro===params.get('registro'));
  return {data:rows,meta:{hasMore:false}};
 };
 const imports=createPriceImports({store,read,prepare:async(actor,input)=>{prepared.push(input);return {id:String(prepared.length)};}});
 const draft=imports.save('u','proveedor','0101',document()),input={reviewed:true,party:'ACME',rows:document().rows};
 return {store,data,read,imports,draft,input,prepared,calls};
}
test('supplier code resolves via SA5 and SB1; AIB proposal carries current-price preconditions and immutable origin',async t=>{
 const f=fixture(t);f.input.rows[0].source='forged';const r=await f.imports.preview('u',f.draft.id,f.input);
 assert.equal(r.proposals.length,1);assert.equal(r.issues.length,0);
 assert.deepEqual(f.prepared[0].expectedIdentity,{producto:'Z1',lista:'001',moneda:'2',proveedor:'P1',tienda:'01'});
 assert.equal(f.prepared[0].expectedPrice,'0.058');assert.equal(f.prepared[0].priceUnit,'millar');assert.equal(f.prepared[0].changes.precio,'60');assert.match(f.prepared[0].origin.lecturaOriginal,/EXT-1/);
 assert.ok(f.calls.every(c=>c.params.sucursal==='0101'));assert.equal(f.store.db.prepare('SELECT count(*) n FROM executions').get().n,0);
 assert.throws(()=>f.imports.get('other',f.draft.id),{code:'ADJUNTO_NO_EXISTE'});
});
test('client import follows A1_TABELA and cannot choose a different list',async t=>{
 const f=fixture(t),draft=f.imports.save('u','cliente','0101',document()),input={...f.input,party:'C1',rows:[{...f.input.rows[0],product:'Z1'}]};
 const r=await f.imports.preview('u',draft.id,input);assert.equal(r.proposals.length,1);assert.equal(f.prepared[0].action,'precioLista');
 await assert.rejects(f.imports.preview('u',draft.id,{...input,list:'060'}),{code:'LISTA_CLIENTE_INVALIDA'});
});
test('unknown, duplicate or ambiguous products, absent prices, wrong currencies and units produce row issues without proposals',async t=>{
 const variants=[
  f=>{f.input.rows[0].product='NO-EXISTE';},
  f=>{f.data.productos.push({...f.data.productos[0]});},
  f=>{f.data.productos.push({codigo:'EXT-1',nombre:'Otro',unidadMedida:'UN'});},
  f=>{f.data.preciosProveedores=[];},
  f=>{f.data.preciosProveedores.push({...f.data.preciosProveedores[0],registro:'7'});},
  f=>{f.input.rows[0].currency='ARS';},
  f=>{f.input.rows[0].currency='$';},
  f=>{f.data.productos[0].unidadMedida='KG';},
  f=>{f.input.rows[0].price='1.234,56';}
 ];
 for(const edit of variants){const f=fixture(t);edit(f);const r=await f.imports.preview('u',f.draft.id,f.input);assert.equal(r.proposals.length,0);assert.equal(r.issues.length,1);assert.equal(f.prepared.length,0);}
});
test('review, source identity and duplicate row checks run before preparing anything',async t=>{
 const f=fixture(t);
 await assert.rejects(f.imports.preview('u',f.draft.id,{...f.input,reviewed:false}),{code:'REVISION_REQUERIDA'});
 await assert.rejects(f.imports.preview('u',f.draft.id,{...f.input,rows:[f.input.rows[0],{id:'alien'}]}),{code:'FILA_NO_EXISTE'});
 await assert.rejects(f.imports.preview('u',f.draft.id,{...f.input,rows:[f.input.rows[0],f.input.rows[0]]}),{code:'FILA_DUPLICADA'});
 assert.equal(f.prepared.length,0);
});
test('multiple dated AIB prices can be selected explicitly and the selection is constrained by product and supplier',async t=>{
 const f=fixture(t);f.data.preciosProveedores.push({...f.data.preciosProveedores[0],registro:'7',precio:'0.06',vigenteDesde:'2026-01-01'});
 const first=await f.imports.preview('u',f.draft.id,f.input);assert.equal(first.issues[0].candidates.length,2);assert.equal(first.proposals.length,0);
 const second=await f.imports.preview('u',f.draft.id,{...f.input,rows:[{...f.input.rows[0],record:'7'}]});assert.equal(second.proposals.length,1);assert.equal(f.prepared[0].target.registro,'7');
 const wrong=await f.imports.preview('u',f.draft.id,{...f.input,rows:[{...f.input.rows[0],record:'999'}]});assert.equal(wrong.proposals.length,0);
});
test('manual corrections, unit defaults, repeated targets and partial errors remain explicit',async t=>{
 const f=fixture(t);
 const r=await f.imports.preview('u',f.draft.id,{...f.input,unit:'UN',currency:'USD',rows:[{id:'manual-1',product:'Z1',price:'0.06'},{id:'manual-2',product:'Z1',price:'0.07'},{id:'manual-3',product:'missing',price:'0.08'}]});
 assert.equal(r.proposals.length,1);assert.equal(r.issues.length,2);assert.equal(r.issues[0].codigo,'DESTINO_DUPLICADO');assert.equal(f.prepared[0].priceUnit,'unidad');
});
test('API enforces login, plan/read permissions, branch and actor isolation for uploaded drafts',async t=>{
 const store=new Store(':memory:'),access=new Access(store,['0101','0201']),admin=await access.setup({username:'admin',name:'Admin',password:'test-password-12345'});
 const role=access.saveRole(admin.principal,{name:'Importador',permissions:['read:catalogo','read:proveedores','read:preciosCompra','plan:precioListaProveedor'],branches:['0101']});
 await access.saveUser(admin.principal,{username:'importador',name:'Importador',roleId:role.id,active:true,password:'test-password-12345'});
 const login=await access.login({username:'importador',password:'test-password-12345'},'test');let uploads=0;
 const server=createApp({erp:createDemoErp(),kaiqen:createDemoKaiqen(),store,branches:['0101','0201'],readKey:'r'.repeat(40),planKey:'p'.repeat(40),documents:{status:()=>({available:true}),extract:async()=>{uploads++;return document();}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();store.close();});
 const request=async(path,token,method='POST')=>fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:token?{authorization:'Bearer '+token}:{}});
 const path='/api/price-imports?kind=proveedor&sucursal=0101';
 assert.equal((await request(path)).status,401);assert.equal((await request(path,'r'.repeat(40))).status,403);
 assert.equal((await request(path.replace('0101','0201'),login.token)).status,403);
 assert.equal((await request(path.replace('proveedor','cliente'),login.token)).status,403);assert.equal(uploads,0);
 const good=await request(path,login.token);assert.equal(good.status,201);const draft=await good.json();
 assert.equal((await request('/api/price-imports/'+draft.id,admin.token,'GET')).status,404);
 assert.equal((await request('/api/price-imports/'+draft.id,login.token,'GET')).status,200);
 access.saveRole(admin.principal,{name:'Revocado',permissions:['read:catalogo','plan:precioListaProveedor'],branches:['0101']},role.id);
 assert.equal((await request('/api/price-imports/'+draft.id,login.token,'GET')).status,404); // role revision changes actor scope
});

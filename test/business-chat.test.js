import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {createIntelligence} from '../src/intelligence/agent.js';
function fixture(t,orderJourney=false){
 const store=new Store(':memory:');t.after(()=>store.close());
 const data={
  productos:[{registro:'1',codigo:'1',nombre:'SERVICIO UNO',tipo:{descripcion:'SERVICIO'},unidadMedida:'UN',bloqueado:{codigo:'2'}},{registro:'2',codigo:'Z100',nombre:'TERMINADO',unidadMedida:'UN'}],
  clientes:[{registro:'3',codigo:'C1',nombre:'MILORDI',tienda:'01',listaPreciosCodigo:'059',email:'a@old.test'}],
  proveedores:[{registro:'4',codigo:'P1',nombre:'ACME',tienda:'01',email:'a@old.test'}],
  listasPreciosClientes:[{registro:'5',codigo:'059',nombre:'MILORDI',estado:{descripcion:'Si'},vigenteDesde:'2020-01-01',vigenteHasta:'2099-01-01'}],
  listasPreciosProveedores:[{registro:'6',codigo:'001',nombre:'ACME USD',proveedorCodigo:'P1',proveedorTienda:'01'}],
  preciosClientes:[{registro:'7',listaCodigo:'059',productoCodigo:'Z100',precio:'0.058',moneda:{codigo:'2',descripcion:'DOLAR'},activo:{descripcion:'Si'},vigenteDesde:'2020-01-01'}],
  preciosProveedores:[{registro:'8',listaCodigo:'001',productoCodigo:'1',proveedorCodigo:'P1',proveedorTienda:'01',precio:'2',moneda:{codigo:'2',descripcion:'DOLAR'}}],
  compras:[{registro:'9',numero:'000123',item:'01',productoCodigo:'1',proveedorCodigo:'P1',proveedorTienda:'01',precioUnitario:'10',cantidadPedida:'20',total:'200',moneda:{codigo:'2',descripcion:'DOLAR'}}],
  itemsVentas:[{registro:'10',numero:'000123',item:'01',productoCodigo:'Z100',clienteCodigo:'C1',clienteTienda:'01',precioUnitario:'0.058',cantidadPedida:'1000',total:'58',moneda:{codigo:'2',descripcion:'DOLAR'}}],
  solicitudesCompra:[],depositos:[{codigo:'16',nombre:'GENERAL'}],condicionesPago:[{codigo:'001',nombre:'CONTADO'}]
 };
 if(orderJourney){data.ventas=[{numero:"000123",clienteCodigo:"C1",clienteTienda:"01",moneda:{codigo:"2",descripcion:"DOLAR"}}];Object.assign(data.itemsVentas[0],{unidadMedida:"UN",cantidadAtendida:"0",producto:{codigo:"Z100",nombre:"TERMINADO",unidadMedida:"UN"}});}
 const calls=[],prepared=[],authorized=[];
 const metadata={entities:Object.fromEntries(Object.keys(data).map(k=>[k,{...(['depositos','condicionesPago'].includes(k)?{filters:{q:'búsqueda por código o nombre'}}:{}),fields:[{salida:'precio',diccionario:{X3_DECIMAL:6}},{salida:'precioUnitario',diccionario:{X3_DECIMAL:6}},{salida:'numero',diccionario:{X3_TAMANHO:6}},{salida:'item',diccionario:{X3_TAMANHO:2}}]}]))};
 let timeoutOnce=false;
 let denied,planDenied=false,modelCalls=0,pageSize=100,failRecord;
 const read=async(resource,params)=>{
  calls.push({resource,filters:Object.fromEntries(params)});
  if(timeoutOnce){timeoutOnce=false;throw Object.assign(new Error("timeout"),{code:"ETIMEOUT"});}
  if(resource===denied)throw Object.assign(new Error('Esto no podés leerlo.'),{status:403,code:'LECTURA_DENEGADA'});
  let rows=structuredClone(data[resource]||[]);
  for(const [k,v] of params){
   const field={sucursal:null,page:null,limit:null,q:null,codigo:'codigo',registro:'registro',numero:'numero',item:'item',producto:'productoCodigo',proveedor:'proveedorCodigo',cliente:'clienteCodigo',lista:'listaCodigo',tienda:['clientes','proveedores'].includes(resource)?'tienda':'proveedorTienda'}[k];
   if(field)rows=rows.filter(r=>String(r[field]).toUpperCase()===v.toUpperCase());
  }
  if(params.has('q'))rows=rows.filter(r=>r.nombre?.toUpperCase().includes(params.get('q').toUpperCase()));
  const size=Math.min(pageSize,Number(params.get('limit')||25)),page=Number(params.get('page')||1),count=rows.length;
  return {data:rows.slice((page-1)*size,page*size),meta:{hasMore:page*size<count},source:{system:'protheus'}};
 };
 const agent=createIntelligence({store,erp:{metadata:()=>metadata},kaiqen:{},branches:['0101','0201'],read,executeRead:c=>read(c.resource,new URLSearchParams(c.filters)),
  authorizePlan:action=>{authorized.push(action);if(planDenied)throw Object.assign(new Error('denied'),{status:403,code:'ACCION_DENEGADA'});},
  prepareChange:async(actor,input)=>{if(failRecord&&input.target.registro===failRecord)throw Object.assign(new Error('Pedido documentado'),{status:409,code:'PEDIDO_DOCUMENTADO'});prepared.push(input);return {id:String(prepared.length),diff:[{field:'precio',before:'10',after:'20'}],warnings:[],executionEnabled:!input.action.endsWith('Contacto')};},
  model:{name:'must-not-run',complete:()=>{modelCalls++;throw Error('Unexpected model call');}}
 });
 const query=(text,conversationId,branch='0101',actor='user:a')=>agent.query(actor,{text,conversationId,context:{sucursal:branch}},{canPlan:true});
 return {query,agent,data,calls,prepared,authorized,get modelCalls(){return modelCalls;},set timeoutOnce(v){timeoutOnce=v;},set denied(v){denied=v;},set planDenied(v){planDenied=v;},set pageSize(v){pageSize=v;},set failRecord(v){failRecord=v;}};
}
test('catalogs use real exact codes or names without model inference',async t=>{
 const f=fixture(t);
 for(const [text,expected] of [['Mostrame el producto 1','SERVICIO UNO'],['Buscá el proveedor ACME','ACME'],['Buscá el cliente MILORDI','MILORDI']]){
  const r=await f.query(text);assert.match(r.answer,new RegExp(expected));assert.ok(r.evidence.length);
 }
 assert.equal(f.modelCalls,0);assert.equal(f.prepared.length,0);
});
test('supplier and customer keep their identities when asking for their lists',async t=>{
 const f=fixture(t);
 let r=await f.query('Mostrame el proveedor ACME');r=await f.query('Mostrame su lista de precios',r.conversationId);
 assert.ok(r.evidence.some(e=>e.args.recurso==='preciosProveedores'));assert.ok(f.calls.some(c=>c.filters.proveedor==='P1'&&c.filters.tienda==='01'));
 let c=await f.query('Mostrame el cliente MILORDI');c=await f.query('Mostrame su lista de precios',c.conversationId);
 assert.ok(c.evidence.some(e=>e.args.recurso==='preciosClientes'&&e.args.filtros.lista==='059'));assert.equal(f.modelCalls,0);
});
test('purchase document clarifies its type once and keeps the number for price changes',async t=>{
 const f=fixture(t),r=await f.query('Mostrame el pedido 123');
 assert.match(r.answer,/compra o de venta/);
 const picked=await f.query('de compra',r.conversationId);assert.ok(picked.evidence.some(e=>e.args.filtros.numero==='000123'));
 const price=await f.query('Cambiame el precio a 12 dólares',r.conversationId);assert.match(price.answer,/por UN o por millar/);
 const done=await f.query('por unidad',r.conversationId);
 assert.equal(f.prepared.length,1);assert.equal(f.prepared[0].action,'pedidoCompra');assert.equal(f.prepared[0].changes.precioUnitario,'12');assert.equal(f.prepared[0].expectedPrice,'10');
 assert.equal(done.evidence.at(-1).result.kind,'proposal');assert.equal(f.modelCalls,0);
});
test('sales order re-reads before preparing quantity and price, preserving separate bases',async t=>{
 const f=fixture(t),r=await f.query('Mostrame el pedido de venta 123');
 const done=await f.query('Cambiá la cantidad a 2 millares y el precio a 60 dólares por millar',r.conversationId);
 assert.equal(f.prepared.length,1,done.answer);
 const p=f.prepared[0];assert.equal(p.changes.cantidadPedida,'2');assert.equal(p.changes.precioUnitario,'60');assert.equal(p.quantityUnit,'millares');assert.equal(p.priceUnit,'millar');assert.equal(p.expectedQuantity,'1000');assert.equal(p.expectedIdentity.cliente,'C1');
 assert.ok(f.calls.filter(c=>c.resource==='itemsVentas').length>=2);
});
test('item selection preserves the pending operation and never selects an arbitrary item',async t=>{
 const f=fixture(t);f.data.compras.push({...f.data.compras[0],registro:'11',item:'02'});
 const r=await f.query('Cambiá el precio del pedido de compra 123 a 15 dólares por unidad');
 assert.equal(f.prepared.length,0);assert.match(r.answer,/varias coincidencias/);
 const done=await f.query('el segundo',r.conversationId);
 assert.equal(f.prepared.length,1,done.answer);assert.equal(f.prepared[0].target.registro,'11');assert.equal(f.prepared[0].changes.precioUnitario,'15');
});
test('supplier store ambiguity is resolved as a party, never as a price RECNO',async t=>{
 const f=fixture(t);f.data.proveedores.push({...f.data.proveedores[0],registro:'14',tienda:'02'});
 f.data.preciosProveedores.push({...f.data.preciosProveedores[0],registro:'18',proveedorTienda:'02'});
 const r=await f.query('Mostrame precios del proveedor ACME');assert.match(r.answer,/varias coincidencias/);
 const done=await f.query('el segundo',r.conversationId);
 assert.ok(done.evidence.some(e=>e.args.recurso==='preciosProveedores'&&e.args.filtros.tienda==='02'));
 assert.ok(!f.calls.some(c=>c.resource==='preciosProveedores'&&c.filters.registro==='14'));
});
test('supplier list percentages use live prices and all pages with preview only',async t=>{
 const f=fixture(t);f.data.preciosProveedores.push({...f.data.preciosProveedores[0],registro:'18',precio:'3'});f.pageSize=1;
 const r=await f.query('Subime la lista 001 del proveedor ACME un 20%');
 assert.equal(f.prepared.length,2,r.answer);assert.deepEqual(f.prepared.map(p=>p.changes.precio),['2.4','3.6']);assert.ok(f.calls.some(c=>c.resource==='preciosProveedores'&&c.filters.page==='2'));
 assert.match(r.answer,/No se modificó/);assert.equal(f.modelCalls,0);
});
test('supplier percentage corrections use current values, not previous previews',async t=>{
 const f=fixture(t),r=await f.query('Mostrame la lista 001 del proveedor ACME');
 await f.query('Subime un 20%',r.conversationId);f.data.preciosProveedores[0].precio='4';
 await f.query('Bajame un 10%',r.conversationId);
 assert.deepEqual(f.prepared.map(p=>p.changes.precio),['2.4','3.6']);
});
test('currency mismatches, incompatible units and denied data cannot prepare',async t=>{
 const f=fixture(t);let r=await f.query('Mostrame el pedido de compra 123');
 r=await f.query('Cambiame el precio a 12 euros por unidad',r.conversationId);assert.equal(f.prepared.length,0);assert.ok(r.trace.some(e=>e.code==='MONEDA_DISTINTA'));
 f.denied='productos';r=await f.query('Cambiame el precio del pedido de compra 123 a 12 dólares por unidad');
 assert.equal(r.accessDenied,true);assert.deepEqual(r.evidence,[]);assert.equal(f.prepared.length,0);
});
test('action permission is checked before reading proposed change data',async t=>{
 const f=fixture(t);f.planDenied=true;
 const r=await f.query('Cambiame el precio del pedido de compra 123 a 12 dólares por unidad');
 assert.equal(r.accessDenied,true);assert.equal(f.calls.length,0);
});
test('new SC7 collects supplier/payment and keeps explicit units, currency and dates',async t=>{
 const f=fixture(t),r=await f.query('Creame un pedido de compra con producto 1 para el proveedor ACME');
 assert.match(r.answer,/cantidad/);assert.doesNotMatch(r.answer,/Falta solicitante/);
 const r2=await f.query('10 unidades a 25 dólares por unidad; depósito 16; emisión 20/10/2026; entrega 21/10/2026',r.conversationId);
 assert.match(r2.answer,/condición de pago/);
 const done=await f.query('condición de pago CONTADO',r.conversationId);
 assert.equal(f.prepared.length,1,done.answer);const p=f.prepared[0];assert.equal(p.action,'crearPedidoCompra');assert.equal(p.header.proveedor,'P1');assert.equal(p.header.tienda,'01');assert.equal(p.header.condicionPago,'001');assert.equal(p.header.moneda,'USD');assert.equal(p.items[0].cantidad,'10');assert.equal(f.modelCalls,0);
});
test('contact changes show a preview and disclose the existing disabled executor',async t=>{
 const f=fixture(t),r=await f.query('Mostrame el cliente MILORDI');
 const done=await f.query('Cambiame el email a nuevo@example.test',r.conversationId);
 assert.equal(f.prepared.length,1,done.answer);assert.equal(f.prepared[0].action,'clienteContacto');assert.deepEqual(f.prepared[0].changes,{email:'nuevo@example.test'});assert.match(done.answer,/no tiene ejecutor/);
});
test('contexts cannot cross owners or branches and explicit new orders discard old selections',async t=>{
 const f=fixture(t),r=await f.query('Mostrame el pedido de compra 123');
 await assert.rejects(f.query('Cambiame el precio a 12',r.conversationId,'0101','other'),{code:'CONVERSACION_NO_EXISTE'});
 const next=await f.query('Mostrame el pedido de compra 999',r.conversationId);
 assert.match(next.answer,/No encontré/);assert.equal(f.calls.at(-1).filters.registro,undefined);assert.equal(f.calls.at(-1).filters.numero,'000999');
});
test('changed selected identities and SQL business restrictions do not produce fake success',async t=>{
 const f=fixture(t),r=await f.query('Mostrame el pedido de compra 123');
 f.data.compras[0].productoCodigo='Z100';
 const changed=await f.query('Cambiame el precio a 12 dólares por unidad',r.conversationId);
 assert.equal(f.prepared.length,0);assert.ok(changed.trace.some(e=>e.code==='REFERENCIA_CAMBIADA'));
 f.failRecord='9';const failed=await f.query('Cambiame el precio del pedido de compra 123 a 12 dólares por unidad');
 assert.equal(f.prepared.length,0);assert.match(failed.answer,/0 propuestas/);assert.ok(failed.evidence.some(e=>e.result.kind==='validation'));
});

test('SC7 takes the current supplier list price without asking the user to repeat it',async t=>{
 const f=fixture(t);f.data.listasPreciosProveedores=[{codigo:'001',proveedorCodigo:'P1',proveedorTienda:'01',vigenteDesde:'2020-01-01',vigenteHasta:'2099-01-01'}];
 const r=await f.query('Creame un pedido de compra con producto 1 para proveedor ACME; 10 unidades; depósito 16; emisión 20/10/2026; entrega 21/10/2026; condición de pago CONTADO');
 assert.equal(f.prepared.length,1,r.answer);assert.equal(f.prepared[0].items[0].precio,'2');assert.equal(f.prepared[0].items[0].basePrecio,'unidad');assert.equal(f.prepared[0].header.moneda,'2');assert.match(r.answer,/lista 001/);
});
test('sales order can apply its customer price list with a preview',async t=>{
 const f=fixture(t),r=await f.query('Mostrame el pedido de venta 123');
 const next=await f.query('Usá la lista de precios',r.conversationId);
 assert.equal(f.prepared.length,1,next.answer);assert.equal(f.prepared[0].changes.precioUnitario,'0.058');assert.equal(f.prepared[0].priceUnit,'unidad');
});

test('selling-price typo resolves price lists and follow-up retains the product',async t=>{
 const f=fixture(t);let r=await f.query('¿A cuando vendemos el producto Z100?');assert.ok(r.evidence.some(e=>e.action==='precio_venta'));assert.match(r.answer,/58/);
 r=await f.query('necesito saber el precio',r.conversationId);assert.ok(r.evidence.some(e=>e.action==='precio_venta'));assert.equal(f.modelCalls,0);
});


test('read timeout keeps the selected product for a direct retry',async t=>{
 const f=fixture(t),first=await f.query('Buscá el producto Z100');f.timeoutOnce=true;
 const failed=await f.query('necesito saber el precio',first.conversationId);assert.match(failed.answer,/Conservé el producto/);
 const retry=await f.query('necesito saber el precio',first.conversationId);assert.ok(retry.evidence.some(e=>e.action==='precio_venta'));assert.equal(f.modelCalls,0);
});

 test('integral product route bypasses model and persists only own branch context across direct followups',async t=>{
 const f=fixture(t);let r=await f.query('Analizá el producto Z100');assert.match(r.answer,/Precios de lista/);assert.ok(r.evidence.some(e=>e.args.recurso==='costos'));const id=r.conversationId;r=await f.query('y los costos',id);assert.match(r.answer,/Costos y existencias/);assert.equal(f.modelCalls,0);assert.equal(f.prepared.length,0);await assert.rejects(()=>f.query('y los costos',id,'0101','user:b'),{status:404});const calls=f.calls.length;f.denied='costos';r=await f.query('y los costos',id);assert.match(r.answer,/Esto no podés leerlo/);assert.ok(!r.evidence.some(e=>e.args.recurso==='costos'));
});

test('customer integral routing bypasses the model, scopes every commercial followup by store and isolates accounts',async t=>{
 const f=fixture(t);let r=await f.query('Analizá el cliente MILORDI');assert.match(r.answer,/Cliente verificado en SA1/);assert.equal(f.modelCalls,0);const id=r.conversationId;r=await f.query('sus ventas',id);assert.ok(f.calls.some(c=>c.resource==='resumenVentas'&&c.filters.cliente==='C1'&&c.filters.tienda==='01'));await assert.rejects(()=>f.query('sus saldos',id,'0101','user:b'),{status:404});f.denied='saldosClientes';r=await f.query('sus saldos',id);assert.match(r.answer,/Esto no podés leerlo/);assert.ok(!r.evidence.some(e=>e.args.recurso==='saldosClientes'));assert.equal(f.prepared.length,0);
});

test('supplier journey integrates into authenticated conversations without model or writes, isolates owners and replaces customer focus',async t=>{
 const f=fixture(t);let r=await f.query('Analizá el cliente MILORDI');r=await f.query('Analizá el proveedor ACME',r.conversationId);assert.match(r.answer,/Proveedor verificado en SA2/);const id=r.conversationId;r=await f.query('sus compras',id);assert.ok(f.calls.some(c=>c.resource==='resumenCompras'&&c.filters.proveedor==='P1'&&c.filters.tienda==='01'));await assert.rejects(()=>f.query('sus saldos',id,'0101','user:b'),{status:404});f.denied='saldosProveedores';r=await f.query('sus saldos',id);assert.match(r.answer,/Esto no podés leerlo/);assert.ok(!r.evidence.some(e=>e.args.recurso==='saldosProveedores'));assert.equal(f.modelCalls,0);assert.equal(f.prepared.length,0);
});

test('order journey bypasses the model, keeps mutation previews and isolates conversations by owner',async t=>{
 const f=fixture(t,true);let r=await f.query('Analizá el pedido de venta 123');assert.match(r.answer,/Pedido de venta 000123/);const id=r.conversationId;r=await f.query('sus precios',id);assert.match(r.answer,/58 por millar/);await assert.rejects(()=>f.query('sus facturas',id,'0101','user:b'),{status:404});
 f.denied='liberacionesVentas';r=await f.query('sus liberaciones',id);assert.match(r.answer,/Esto no podés leerlo/);assert.ok(!r.evidence.some(e=>e.args.recurso==='liberacionesVentas'));f.denied=null;r=await f.query('Cambiá la cantidad a 2 millares y el precio a 60 dólares por millar',id);assert.equal(f.prepared.length,1,r.answer);assert.equal(f.prepared[0].changes.cantidadPedida,'2');assert.equal(f.prepared[0].changes.precioUnitario,'60');assert.equal(f.modelCalls,0);
});

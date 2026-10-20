import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {createIntelligence} from '../src/intelligence/agent.js';
import {priceCommand,priceOperation} from '../src/intelligence/price-commands.js';
function fixture(t,{size=1,pageSize=100,deny,unit='UN',ambiguous=false}={}){
 const store=new Store(':memory:');t.after(()=>store.close());const calls=[],prepared=[];
 const rows=Array.from({length:size},(_,i)=>({registro:String(i+1),productoCodigo:'Z'+(100+i),listaCodigo:'059',precio:i?'0.12':'5.8000000000000003e-002',moneda:{codigo:'2',descripcion:'DOLAR'},activo:{descripcion:'Si'},vigenteDesde:'2026-01-01'}));
 const products=rows.map(r=>({codigo:r.productoCodigo,nombre:'Producto '+r.productoCodigo,unidadMedida:unit}));
 const lists=[{codigo:'059',nombre:'MILORDI',estado:{descripcion:'Si'},vigenteDesde:'2025-01-01',vigenteHasta:'2050-01-01'},...(ambiguous?[{codigo:'060',nombre:'MILORDI alternativa',estado:{descripcion:'Si'},vigenteDesde:'2025-01-01'}]:[])];
 const read=async(resource,params)=>{
  calls.push({resource,filters:Object.fromEntries(params)});
  if(deny===resource)throw Object.assign(new Error('Esto no podés leerlo.'),{code:'LECTURA_DENEGADA'});
  let data=structuredClone(({productos:products,preciosClientes:rows,listasPreciosClientes:lists,clientes:[{codigo:'C1',tienda:'01',nombre:'CLIENTE',listaPreciosCodigo:'059'}]})[resource]||[]);
  for(const [param,key] of [['codigo','codigo'],['producto','productoCodigo'],['lista','listaCodigo']])if(params.has(param))data=data.filter(r=>r[key]===params.get(param));
  if(params.has('q'))data=data.filter(r=>r.nombre.toLowerCase().includes(params.get('q').toLowerCase()));
  const size=params.has('producto')?100:pageSize,page=Number(params.get('page')||1),total=data.length;
  return {data:data.slice((page-1)*size,page*size),meta:{hasMore:page*size<total},source:{system:'protheus'}};
 };
 const metadata={entities:{preciosClientes:{fields:[{salida:'precio',diccionario:{X3_DECIMAL:6}}]},productos:{},listasPreciosClientes:{},clientes:{}}};
 const agent=createIntelligence({store,read,executeRead:c=>read(c.resource,new URLSearchParams(c.filters)),erp:{metadata:()=>metadata},kaiqen:{},branches:['0101','0201'],model:{name:'fixture',complete:async()=>({action:'precio_venta',args:{producto:'Z100'}})},prepareChange:async(actor,input)=>{prepared.push(input);return {id:String(prepared.length),diff:[],warnings:[],executionEnabled:true};}});
 return {agent,rows,products,prepared,calls,store,metadata};
}
const proposals=r=>r.evidence.filter(e=>e.result.kind==='proposal');
test('natural follow-up retains product, list and commercial base without repeating identifiers',async t=>{
 for(const phrase of ['Perfecto, ahora cambiame el precio a 60 dolares','Cambiá el precio a 60 dólares','Dejalo en 60 dolares','Actualizame el precio a 60']){
  const f=fixture(t),first=await f.agent.query('u',{text:'precio Z100'});f.calls.length=0;
  const r=await f.agent.query('u',{text:phrase,conversationId:first.conversationId},{canPlan:true});
  assert.equal(proposals(r).length,1,phrase);assert.equal(f.prepared[0].priceUnit,'millar');assert.equal(f.prepared[0].target.registro,'1');assert.equal(f.prepared[0].changes.precio,'60');
  assert.ok(f.calls.some(c=>c.resource==='preciosClientes'));assert.match(r.answer,/Interpreté.*MILLAR/);
 }
});
test('percentage list reads every page and every product, never the previous product only',async t=>{
 const f=fixture(t,{size:3,pageSize:2}),first=await f.agent.query('u',{text:'precio Z100'});
 const r=await f.agent.query('u',{text:'subime el precio de la lista de MILORDI a un 20%',conversationId:first.conversationId},{canPlan:true});
 assert.equal(proposals(r).length,3);assert.deepEqual(f.prepared.map(p=>p.changes.precio),['0.0696','0.144','0.144']);assert.ok(f.calls.some(c=>c.filters.page==='2'));
 assert.match(r.answer,/lista 059.*completa/);assert.equal(f.store.db.prepare('SELECT count(*) n FROM executions').get().n,0);
});
test('reductions, comma decimals and explicit unit prices use decimal arithmetic',async t=>{
 for(const [text,price,unit] of [['Bajame la lista de MILORDI un 10%','0.0522','unidad'],['Aumentá un 12,5% la lista MILORDI','0.06525','unidad'],['Cambiame Z100 a 0,06 dolares por unidad','0.06','unidad']]){
  const f=fixture(t),r=await f.agent.query('u',{text},{canPlan:true});assert.equal(proposals(r).length,1,text);assert.equal(f.prepared[0].changes.precio,price);assert.equal(f.prepared[0].priceUnit,unit);
 }
});
test('percentage rounding is disclosed, and repeated previews do not compound unconfirmed prices',async t=>{
 const f=fixture(t);f.rows[0].precio='0.000003';
 for(let i=0;i<2;i++){
  const r=await f.agent.query('u',{text:'Subime la lista de MILORDI un 20%'},{canPlan:true});const summary=r.evidence.find(e=>e.result.kind==='priceAdjustment');
  assert.equal(summary.result.data[0].precioCalculadoUnidad,'0.0000036');assert.match(summary.result.data[0].redondeo,/HALF_UP/);assert.equal(f.prepared[i].changes.precio,'0.000004');
 }
});
test('inactive rows are explicitly excluded, never silently updated',async t=>{
 const f=fixture(t,{size:2});f.rows[1].activo={descripcion:'No'};
 const r=await f.agent.query('u',{text:'Subime la lista de MILORDI un 20%'},{canPlan:true});assert.equal(proposals(r).length,1);assert.equal(r.evidence.find(e=>e.result.kind==='priceAdjustment').result.excluded.length,1);
});
test('unknown products, ambiguous lists, currency mismatch and non-UN bases cannot prepare',async t=>{
 for(const [options,text] of [[{},'Cambiame Z999 a 60 dolares'],[{ambiguous:true},'Subime la lista de MILORDI un 20%'],[{},'Cambiame Z100 a 60 euros'],[{unit:'KG'},'Cambiame Z100 a 60 dolares'],[{},'Bajame la lista MILORDI un 100%']]){
  const f=fixture(t,options),r=await f.agent.query('u',{text},{canPlan:true});assert.equal(f.prepared.length,0,text);assert.equal(proposals(r).length,0);
 }
});
test('read denial clears every source and planning permission is required',async t=>{
 for(const options of [{deny:'productos'},{}]){
  const f=fixture(t,options),r=await f.agent.query('u',{text:'Subime la lista de MILORDI un 20%'},{canPlan:!!options.deny});assert.equal(f.prepared.length,0);
  if(options.deny){assert.equal(r.accessDenied,true);assert.equal(r.evidence.length,0);assert.match(r.answer,/Esto no podés leerlo/);}
 }
});
test('context never crosses actor or branch and does not hijack a newly named product',async t=>{
 const f=fixture(t),first=await f.agent.query('u',{text:'precio Z100'});
 await assert.rejects(f.agent.query('other',{text:'Cambiame el precio a 60',conversationId:first.conversationId},{canPlan:true}),{code:'CONVERSACION_NO_EXISTE'});
 const messages=f.agent.memory.conversation(first.conversationId,'u').messages;
 assert.equal(priceCommand('Cambiame el precio a 60',messages,'0201',false),null);
 assert.equal(priceCommand('Cambiame el precio del resorte rojo a 60',messages,'0101',false),null);
 assert.equal(priceOperation('No cambies el precio a 60'),null);
 assert.equal(priceOperation('Simula subir el precio a 60'),null);
 assert.equal(priceOperation('Cambiame el precio del pedido 123 a 60'),null);
});
test('explicit unit context is retained and a later named list has its own complete scope',async t=>{
 const f=fixture(t,{size:2}),first=await f.agent.query('u',{text:'precio Z100 por unidad'});
 const second=await f.agent.query('u',{text:'Cambiame el precio a 0,06 dolares',conversationId:first.conversationId},{canPlan:true});
 assert.equal(f.prepared[0].priceUnit,'unidad');assert.equal(proposals(second).length,1);
 const third=await f.agent.query('u',{text:'Subime esa lista un 20%',conversationId:first.conversationId},{canPlan:true});
 assert.equal(proposals(third).length,2);
});
test('a multi-product list remains addressable as esa lista in the next turn',async t=>{
 const f=fixture(t,{size:3});
 const first=await f.agent.query('u',{text:'Subime la lista de MILORDI un 20%'},{canPlan:true});
 const second=await f.agent.query('u',{text:'Bajame esa lista un 5%',conversationId:first.conversationId},{canPlan:true});
 assert.equal(proposals(first).length,3);assert.equal(proposals(second).length,3);assert.equal(f.prepared[3].changes.precio,'0.0551');
});
test('explicit product plus named list never expands to the whole list',async t=>{
 const f=fixture(t,{size:3});const r=await f.agent.query('u',{text:'Cambiame el producto Z100 en la lista MILORDI a 60 dolares por millar'},{canPlan:true});
 assert.equal(proposals(r).length,1);assert.equal(f.prepared[0].target.registro,'1');
 const numeric=await f.agent.query('u',{text:'Subime la lista 059 un 5%'},{canPlan:true});assert.equal(proposals(numeric).length,3);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Memory} from '../src/intelligence/memory.js';
import {createBusinessTools} from '../src/intelligence/tools.js';
import {createIntelligence,compact} from '../src/intelligence/agent.js';
import {createModel} from '../src/intelligence/model.js';
import {previousPrice} from '../src/intelligence/references.js';
const source={system:'protheus',mode:'test',fetchedAt:new Date().toISOString()};
const product={codigo:'ABC/1',nombre:'Resorte prueba',unidadMedida:'UN'};
const price={productoCodigo:'ABC/1',listaCodigo:'001',precio:'125.50',moneda:{codigo:'2',descripcion:'DOLAR'},vigenteDesde:'2025-01-01',activo:{descripcion:'Si'},registro:'1'};
const header={codigo:'001',nombre:'Lista prueba',estado:{descripcion:'Si'},vigenteDesde:'2024-01-01',vigenteHasta:'2050-01-01'};
test('repeated failed tools cannot publish invented figures even with a question in the answer',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());let calls=0;
 const agent=createIntelligence({...setup(),store,model:{name:'test',complete:async()=>{calls++;return calls<3?{action:'consultar_erp',args:{recurso:'productos',filtros:{producto:'código'}}}:{action:'responder',args:{},answer:'Total ventas: 12.500 USD. ¿Qué falta?'};}}});
 const reply=await agent.query('reader',{text:'Necesito un informe del movimiento reciente'});
 assert.equal(reply.evidence.length,0);assert.doesNotMatch(reply.answer,/12.500/);assert.match(reply.answer,/No pude verificar/);assert.equal(calls,2);
});
test('DA0/DA1 are source tables, never invented named price lists',async()=>{
 for(const lista of ['DA1','DA0','por millar','por unidad']){
  const s=setup(),r=await s.tools.prices({producto:product.codigo,lista});
  assert.equal(r.kind,'prices');assert.equal(r.data[0].registro,'1');
  assert.ok(!s.calls.some(c=>c.filters.codigo===lista));
 }
});
test('a follow-up price change re-reads the prior product and prepares the current record',async t=>{
 const s=setup(),store=new Store(':memory:');t.after(()=>store.close());let prepared;
 const decisions=[{action:'precio_venta',args:{producto:product.codigo}},{action:'preparar_cambio',args:{accion:'precioLista',registro:'1',precio:'60',basePrecio:'millar'}}];
 const agent=createIntelligence({...s,store,model:{name:'test',complete:async()=>decisions.shift()},prepareChange:async(actor,input)=>{prepared=input;return {id:'p',diff:[],warnings:[]};}});
 const first=await agent.query('writer',{text:'¿A cuánto vendemos ABC/1?'});
 s.calls.length=0;
 const second=await agent.query('writer',{text:'Cambiame el precio del producto a 60 dolares por millar',conversationId:first.conversationId},{canPlan:true});
 assert.equal(prepared.target.registro,'1');assert.equal(prepared.changes.precio,'60');assert.equal(prepared.priceUnit,'millar');
 assert.ok(s.calls.some(c=>c.resource==='preciosClientes'));assert.ok(s.calls.some(c=>c.resource==='productos'));
 assert.ok(second.evidence.some(e=>e.result.kind==='proposal'));assert.match(second.answer,/Productos verificados en SB1/);
});
test('follow-up prices reject changed identities, currency conflicts and new ambiguity',async t=>{
 for(const scenario of ['deleted','currency','ambiguous']){
  const s=setup(),store=new Store(':memory:');t.after(()=>store.close());let stage=0,prepared=0;
  const originalRead=s.read;
  const read=async(resource,p)=>{
   const r=await originalRead(resource,p);
   if(stage&&resource==='preciosClientes'){
    if(scenario==='deleted')r.data=[];
    if(scenario==='currency')r.data[0].moneda={codigo:'1',descripcion:'PESO'};
    if(scenario==='ambiguous')r.data.push({...r.data[0],registro:'2'});
   }return r;
  };
  const decisions=[{action:'precio_venta',args:{producto:product.codigo}},{action:'preparar_cambio',args:{accion:'precioLista',registro:'1',precio:'60',basePrecio:'millar'}},{action:'responder',answer:'¿Podés verificar la moneda?'}];
  const agent=createIntelligence({...s,read,store,model:{name:'test',complete:async()=>decisions.shift()},prepareChange:async()=>{prepared++;}});
  const first=await agent.query('writer',{text:'Precio ABC/1'});stage=1;
  const second=await agent.query('writer',{text:'Cambiame el precio del producto a 60 dolares por millar',conversationId:first.conversationId},{canPlan:true});
  assert.equal(prepared,0,scenario);assert.ok(!second.evidence.some(e=>e.result.kind==='proposal'));
  if(scenario==='currency')assert.ok(second.trace.some(t=>t.code==='MONEDA_DISTINTA'));
 }
});
test('historical identities never cross branches or unrelated document contexts',()=>{
 const priceMessage={role:'assistant',content:JSON.stringify({sucursal:'0101',evidence:[{action:'precio_venta',args:{},identities:[{productoCodigo:'Z1',registro:'1'}]}]})};
 assert.equal(previousPrice([priceMessage],'0201'),null);
 assert.equal(previousPrice([priceMessage,{role:'assistant',content:JSON.stringify({sucursal:'0101',evidence:[{action:'consultar_erp',identities:[{numero:'123'}]}]})}],'0101'),null);
});
test('chat summaries use the aggregate tool and replace invented totals with verified evidence',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const calls=[];
 const result={kind:'dashboard',data:[{importeNeto:'321.05'}],verifiedSummary:'NF + ND − NC: 321.05; moneda 1; período verificado.'};
 const decisions=[{action:'resumir',args:{recurso:'ventas',filtros:{desde:'2026-10-01',hasta:'2026-10-20',agrupar:'mes',cliente:'',producto:' ',moneda:'1'}}},{action:'responder',answer:'Vendiste 999999.'}];
 const context=setup(),agent=createIntelligence({...context,store,erp:{metadata:()=>({entities:{resumenVentas:{aggregate:true}}})},executeRead:async command=>{calls.push(command);return result;},model:{name:'test',complete:async()=>decisions.shift()}});
 const reply=await agent.query('reader',{text:'Sacame un dashboard de ventas de este mes'});
 assert.equal(calls[0].resource,'resumenVentas');assert.equal(reply.answer,result.verifiedSummary);assert.equal(reply.evidence[0].result.kind,'dashboard');
 assert.equal(calls[0].filters.moneda,undefined);assert.equal(calls[0].filters.cliente,undefined);assert.equal(calls[0].filters.producto,undefined);
});
test('update proposal fails when the row product is not uniquely verified in SB1',async t=>{
 for(const rows of [[],[product,product]]){
  const context=setup({productos:rows,itemsVentas:[{registro:'7',productoCodigo:product.codigo,numero:'123',item:'01'}]}),store=new Store(':memory:');t.after(()=>store.close());let prepared=0;
  const decisions=[{action:'consultar_erp',args:{recurso:'itemsVentas',filtros:{}}},{action:'preparar_cambio',args:{accion:'pedidoVenta',registro:'7',precio:'80',basePrecio:'millar'}},{action:'responder',answer:'¿Podés verificar el producto?'}];
  const agent=createIntelligence({...context,store,prepareChange:async()=>{prepared++;},model:{name:'test',complete:async()=>decisions.shift()}});
  const reply=await agent.query('writer',{text:'Cambiá el precio del pedido de venta 123 a 80 por millar'},{canPlan:true});
  assert.equal(prepared,0);assert.ok(reply.trace.some(r=>r.code==='PRODUCTO_NO_VERIFICADO'));
  assert.match(reply.answer,/No se creó ningún documento/);
 }
});
test('summary tool accepts grouping by supplier or customer and preserves explicit currency',async()=>{
 for(const group of ['proveedor','proveedores','cliente','clientes']){
  let command;
  const tools=createBusinessTools({branch:'0101',metadata:{entities:{resumenCompras:{aggregate:true}}},reportCurrencyRequested:true,executeRead:async c=>{command=c;return {data:[]};}});
  await tools.run('resumir',{recurso:'compras',filtros:{agrupar:group,moneda:'2',proveedor:''}});
  assert.equal(command.filters.agrupar,'tercero');assert.equal(command.filters.moneda,'2');assert.equal(command.filters.proveedor,undefined);
 }
});
test('a price lookup during a modification request continues into proposal preparation',async t=>{
 const context=setup(),store=new Store(':memory:');t.after(()=>store.close());let prepared;
 const decisions=[{action:'precio_venta',args:{producto:'ABC/1'}},{action:'preparar_cambio',args:{accion:'precioLista',registro:'1',precio:'90',basePrecio:'millar'}}];
 const agent=createIntelligence({...context,store,model:{name:'test',complete:async()=>decisions.shift()},prepareChange:async(actor,input)=>{prepared=input;return {id:'test-proposal',diff:[]};}});
 const reply=await agent.query('writer',{text:'Cambiá el precio de lista de ABC/1 a 90 por millar'},{canPlan:true});
 assert.equal(prepared.target.registro,'1');assert.equal(prepared.changes.precio,'90');assert.equal(prepared.priceUnit,'millar');assert.equal(reply.evidence.at(-1).result.kind,'proposal');assert.match(reply.answer,/Todavía no se modificó/);
});
test('proposal tools resolve an exact unique product reference, but never invent a receipt after failure',async t=>{
 for(const reference of ['ABC/1','unknown']){
  const context=setup({preciosClientes:[price,{...price,registro:'2',activo:{descripcion:'No'}}]}),store=new Store(':memory:');t.after(()=>store.close());let calls=0;
  const decisions=[{action:'precio_venta',args:{producto:'ABC/1'}},{action:'preparar_cambio',args:{accion:'precioLista',registro:reference,precio:'90',basePrecio:'millar'}},{action:'responder',args:{},answer:'Propuesta preparada, confirmá el cambio.'}];
  const agent=createIntelligence({...context,store,model:{name:'test',complete:async()=>decisions.shift()},prepareChange:async(actor,input)=>{calls++;assert.equal(input.target.registro,'1');return {id:'test-proposal',diff:[]};}});
  const reply=await agent.query('writer',{text:'Cambiá el precio de lista de ABC/1 a 90 por millar'},{canPlan:true});
  assert.equal(calls,reference==='ABC/1'?1:0);if(reference==='unknown')assert.match(reply.answer,/No se preparó ninguna propuesta/);
 }
});
function setup(overrides={}){
 const rows={productos:[product],preciosClientes:[price],listasPreciosClientes:[header],clientes:[{codigo:'C01',nombre:'Cliente Prueba',tienda:'01',listaPreciosCodigo:'001'}],...overrides};const calls=[];
 const read=async(resource,params)=>{calls.push({resource,filters:Object.fromEntries(params)});let data=structuredClone(rows[resource]||[]);for(const [k,field] of [['codigo','codigo'],['producto','productoCodigo'],['lista','listaCodigo']])if(params.has(k))data=data.filter(r=>r[field]===params.get(k));if(params.has('q'))data=data.filter(r=>(r.nombre||'').toLowerCase().includes(params.get('q').toLowerCase()));return {data,meta:{hasMore:false},source};};
 const metadata={entities:Object.fromEntries(Object.keys(rows).map(k=>[k,{filters:{codigo:'',q:'',producto:''}}]))};const erp={metadata:()=>metadata};
 const executeRead=c=>read(c.resource,new URLSearchParams(c.filters));const kaiqen={projects:async()=>({data:[{id:'p1',name:'Project'}]})};
 return {read,erp,executeRead,kaiqen,branches:['0101'],calls,tools:createBusinessTools({read,executeRead,kaiqen,branch:'0101',metadata})};
}
test('sale price resolves a name and validates DA0/DA1, currency, active state and dates',async()=>{
 const {tools,calls}=setup();const result=await tools.prices({producto:'Resorte prueba',cliente:'Cliente Prueba'});
 assert.equal(result.kind,'prices');assert.equal(result.data[0].aplicableSegunCampos,true);assert.match(result.answer,/125,5 DOLAR/);assert.match(result.answer,/precios de lista/);assert.ok(calls.some(c=>c.resource==='productos'&&c.filters.q));assert.equal(result.customer.codigo,'C01');
 assert.equal((await tools.prices({producto:'Resorte de prueba'})).kind,'prices');
 assert.equal((await tools.prices({producto:'ABC/1',lista:'lista de precios'})).kind,'prices');
 assert.equal((await tools.prices({producto:'ABC/1',lista:'Lista prueba'})).data[0].listaCodigo,'001');
});
test('finished Z prices display commercial millares and preserve exact ERP unit price',async()=>{
 const p={...product,codigo:'Z001'};
 for(const value of ['0.00189','1.8900000000000000e-003']){
  const s=setup({productos:[p],preciosClientes:[{...price,productoCodigo:p.codigo,precio:value}]});
  const r=await s.tools.prices({producto:p.codigo});assert.equal(r.data[0].precio,value);assert.equal(r.data[0].precioPorMillar,'1.89');assert.match(r.answer,/1,89 DOLAR por MILLAR \(0,00189 por UN en TOTVS\)/);
 }
 const other=setup({productos:[{...p,unidadMedida:'KG'}],preciosClientes:[{...price,productoCodigo:p.codigo}]});assert.equal((await other.tools.prices({producto:p.codigo})).data[0].precioPorMillar,undefined);
});
test('inactive, future, expired or missing dates never become current sale price',async()=>{
 for(const overrides of [{preciosClientes:[{...price,activo:{descripcion:'No'}}]},{listasPreciosClientes:[{...header,estado:{descripcion:'No'}}]},{preciosClientes:[{...price,vigenteDesde:'2099-01-01'}]},{listasPreciosClientes:[{...header,vigenteHasta:'2000-01-01'}]},{preciosClientes:[{...price,vigenteDesde:null}]}]){
  const r=await setup(overrides).tools.prices({producto:'ABC/1'});assert.equal(r.data[0].aplicableSegunCampos,false);assert.match(r.answer,/no permiten confirmar/);
 }
});
test('ambiguous products stop before price lookup; empty prices are not zero',async()=>{
 const s=setup({productos:[product,{...product,codigo:'ABC/2'}]});const result=await s.tools.prices({producto:'Resorte'});assert.equal(result.kind,'clarification');assert.equal(result.candidates.length,2);assert.ok(!s.calls.some(c=>c.resource==='preciosClientes'));
 const search=await s.tools.run('buscar',{recurso:'productos',texto:'Resorte'});assert.equal(search.kind,'clarification');assert.equal(search.candidates.length,2);
 const empty=await setup({preciosClientes:[]}).tools.prices({producto:'ABC/1'});assert.match(empty.answer,/No encontré/);assert.match(empty.answer,/no significa|No significa/);
 const generic=setup();assert.equal((await generic.tools.run('buscar',{recurso:'productos',texto:'un producto'})).kind,'clarification');assert.equal(generic.calls.length,0);
});
test('tools cannot write, change branch, accept SQL or use an arbitrary external model',async()=>{
 const {tools}=setup();await assert.rejects(()=>tools.run('ejecutar_sql',{sql:'DELETE FROM SA1'}),{code:'HERRAMIENTA_INVALIDA'});
 await assert.rejects(()=>tools.run('consultar_erp',{recurso:'productos',filtros:{sucursal:'9999'}}),{code:'SUCURSAL_NO_AUTORIZADA'});
 assert.throws(()=>createModel({url:'https://example.com'}));
});
test('knowledge persists, remains owner-scoped, and can be forgotten',()=>{
 const store=new Store(':memory:'),memory=new Memory(store);const item=memory.add('ui:session1',{topic:'precios',term:'resorte del cliente',meaning:'ABC/1'});assert.equal(new Memory(store).list('ui:session2')[0].id,item.id);assert.equal(memory.list('reader:other').length,0);memory.remove('reader:other',item.id);assert.equal(memory.list('ui:session1').length,1);memory.remove('ui:session2',item.id);assert.equal(memory.list('ui:session1').length,0);store.close();
});
test('agent chains searches, keeps conversation, re-reads prices, and cannot fabricate amounts',async()=>{
 const store=new Store(':memory:'),s=setup();let n=0;const decisions=[{action:'buscar',args:{recurso:'productos',texto:'Resorte'},answer:''},{action:'precio_venta',args:{producto:'ABC/1'},answer:''},{action:'precio_venta',args:{producto:'ABC/1'},answer:''}];let lastMessages;
 const agent=createIntelligence({...s,store,model:{name:'fake',complete:async messages=>{lastMessages=messages;return decisions[n++];},status:async()=>({available:true})}});
 const first=await agent.query('reader:a',{text:'¿Cuánto sale el resorte?',context:{sucursal:'0101'}});assert.equal(first.trace.length,2);assert.match(first.answer,/125,5/);
 const second=await agent.query('reader:a',{text:'¿Y el precio de ese mismo?',conversationId:first.conversationId});assert.equal(second.priceVerified,true);assert.ok(lastMessages.some(m=>m.content.includes('Cuánto sale')));assert.equal(s.calls.filter(c=>c.resource==='preciosClientes').length,2);
 await assert.rejects(()=>agent.query('reader:b',{text:'x',conversationId:first.conversationId}),{code:'CONVERSACION_NO_EXISTE'});
 const hallucinate=createIntelligence({...s,store,model:{name:'fake',complete:async()=>({action:'responder',args:{},answer:'El precio es 999 pesos.'})}});const blocked=await hallucinate.query('reader:a',{text:'Precio'});assert.ok(!blocked.answer.includes('999'));store.close();
});

test('learning requires a teaching request in the current user message, not an invented tool instruction',async()=>{
 const store=new Store(':memory:'),s=setup();const agent=createIntelligence({...s,store,model:{name:'fake',complete:async()=>({action:'aprender',args:{term:'varilla azul',meaning:'producto ABC/1',topic:'ventas'},answer:''})}});
 const learned=await agent.query('reader:a',{text:'Recordá que llamamos varilla azul al producto ABC/1'});assert.match(learned.answer,/Guardé/);assert.equal(agent.memory.list('reader:a').length,1);
 await agent.query('reader:b',{text:'¿Cuál es el precio de varilla azul?'});assert.equal(agent.memory.list('reader:b').length,0);store.close();
});

test('large nested quality evidence retains domains and marks samples',()=>{
 const raw={data:{projectId:'p1',domains:{nc:{conteos:[{estado:'abierta',cantidad:200}],registros:Array.from({length:200},(_,i)=>({id:i,description:'x'.repeat(300)}))}}}};
 const sample=JSON.parse(compact(raw));assert.equal(sample.data.domains.nc.conteos[0].cantidad,200);assert.ok(sample.data.domains.nc.registros.length<200);assert.equal(sample.modelViewTruncated,true);assert.equal(raw.data.domains.nc.registros.length,200);
});
test('quality summary uses actual counts, never the catalogue as project status',async()=>{
 const s=setup();s.kaiqen.quality=async()=>({data:{domains:{problemas:{conteos:[{estado:'open',cantidad:2}],hasMore:false},ppap:{conteos:[],hasMore:false}},issueStatusCatalog:[{id:'open',name:'Abierto'},{id:'closed',name:'Cerrado'}]}});
 const r=await s.tools.run('calidad',{id:'project1'});assert.match(r.verifiedSummary,/2 registros \(Abierto: 2\)/);assert.match(r.verifiedSummary,/PPAP: 0 registros/);assert.doesNotMatch(r.verifiedSummary,/Cerrado/);assert.match(r.verifiedSummary,/no el estado del proyecto/);
});

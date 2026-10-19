import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Memory} from '../src/intelligence/memory.js';
import {createBusinessTools} from '../src/intelligence/tools.js';
import {createIntelligence,compact} from '../src/intelligence/agent.js';
import {createModel} from '../src/intelligence/model.js';
const source={system:'protheus',mode:'test',fetchedAt:new Date().toISOString()};
const product={codigo:'ABC/1',nombre:'Resorte prueba',unidadMedida:'UN'};
const price={productoCodigo:'ABC/1',listaCodigo:'001',precio:'125.50',moneda:{codigo:'2',descripcion:'DOLAR'},vigenteDesde:'2025-01-01',activo:{descripcion:'Si'},registro:'1'};
const header={codigo:'001',nombre:'Lista prueba',estado:{descripcion:'Si'},vigenteDesde:'2024-01-01',vigenteHasta:'2050-01-01'};
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

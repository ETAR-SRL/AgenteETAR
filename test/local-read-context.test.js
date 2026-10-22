import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {createIntelligence} from '../src/intelligence/agent.js';
import {localReadOnlyTurn,localReadDecisionSchema,localReadSystem,localReadFocus} from '../src/intelligence/local-read-context.js';

test('local consultation narrows only the decision contract and keeps proposal requests intact',()=>{
 assert.equal(localReadOnlyTurn('Del que vimos, cuánto cobramos; no cambies nada',true),true);
 assert.equal(localReadOnlyTurn('Prepará un cambio pero no cambies nada todavía',true),false);
 assert.equal(localReadOnlyTurn('Armame una propuesta, sin modificar',true),false);
 assert.equal(localReadOnlyTurn('Cambiá el precio',true),false);
 assert.equal(localReadOnlyTurn('Volvamos al primer producto: ¿a cuánto lo vendemos hoy?',true),true);
 assert.equal(localReadOnlyTurn('Mostrame una propuesta y cambiá el precio',true),false);
 assert.equal(localReadOnlyTurn('Decime cómo ejecutar el cambio y confirmá el pedido',true),false);
 assert.equal(localReadOnlyTurn('Decime cuánto sale y cambialo a 60',true),false);
 assert.equal(localReadOnlyTurn('Mostrame el precio y actualizalo',true),false);
 assert.equal(localReadOnlyTurn('Un informe',false),true);
 assert.equal(localReadOnlyTurn('Recordá que a este código lo llamamos rotor',false),false);
 const schema={type:'object',properties:{action:{enum:['buscar','preparar_cambio','precio_venta','responder']},args:{properties:{producto:{type:'string'},precio:{type:'string'},cabecera:{type:'object'}},additionalProperties:false},answer:{type:'string'}},required:['action','args','answer'],additionalProperties:false};
 const read=localReadDecisionSchema(schema);assert.deepEqual(read.properties.action.enum,['buscar','precio_venta','responder']);assert.deepEqual(Object.keys(read.properties.args.properties),['producto']);assert.equal(read.properties.args.additionalProperties,false);assert.deepEqual(read.required,schema.required);assert.ok(schema.properties.args.properties.precio);
 const price=localReadDecisionSchema({...schema,properties:{...schema.properties,args:{...schema.properties.args,properties:{producto:{type:'string'},cliente:{type:'string'},lista:{type:'string'}}}}},{priceProductOnly:true});
 assert.deepEqual(price.properties.action.enum,['precio_venta','responder']);assert.deepEqual(Object.keys(price.properties.args.properties),['producto']);
 assert.ok(localReadSystem({branch:'TEST',date:'2026-10-22',entities:{productos:{}}}).length<3600);
});

test('price-only read context omits unrelated catalog metadata but preserves current price filters',()=>{
 assert.equal(localReadFocus('Decime cuánto le cobramos hoy; sólo lectura'),'prices');
 for(const text of ['Precio y costos del producto','Mostrame ventas y precios','Sus pedidos pendientes','Cuánto stock tenemos'])assert.equal(localReadFocus(text),null);
 const entities={productos:{filters:{codigo:{}}},preciosClientes:{filters:{producto:{},lista:{},moneda:{}}},costos:{filters:{producto:{},deposito:{}}}};
 const full=localReadSystem({branch:'0101',date:'2026-10-22',entities});
 const focused=localReadSystem({branch:'0101',date:'2026-10-22',entities,focus:'prices'});
 assert.match(full,/"costos":/);assert.doesNotMatch(focused,/"costos":/);assert.match(focused,/"filters":\["producto","lista","moneda"\]/);
});

test('full assistant uses a bounded read prompt with verified conversation identity and fresh tool result',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());let modelCalls=0,seen,reads=0;
 const product={codigo:'Z920',nombre:'Producto controlado',unidadMedida:'UN'};
 const read=async resource=>{reads++;return {data:resource==='productos'?[product]:[],meta:{hasMore:false}};};
 const agent=createIntelligence({store,erp:{metadata:()=>({entities:{productos:{},preciosClientes:{}}})},kaiqen:{},branches:['0101'],read,executeRead:async()=>({}),model:{name:'controlled',local:true,complete:async(messages,schema)=>{modelCalls++;seen={messages,schema};return {action:'buscar',args:{recurso:'productos',texto:'Z920'},answer:''};}}});
 const first=await agent.query('reader',{text:'Mostrame el producto Z920'});
 const second=await agent.query('reader',{text:'Del que vimos, contame qué referencia tiene; no cambies nada',conversationId:first.conversationId});
 assert.ok(modelCalls>0);assert.ok(reads>1);assert.ok(seen.messages.some(m=>m.role==='assistant'&&m.content.includes('Z920')));assert.ok(seen.messages[0].content.length<3600);assert.ok(!seen.schema.properties.action.enum.includes('preparar_cambio'));assert.equal(second.evidence.length>0,true);
});

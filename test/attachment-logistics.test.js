import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttachmentChat} from '../src/intelligence/attachment-chat.js';

const id='c81f725d-08e0-4731-bfa2-7be2e9d54f68';
function fixture(kind='crearSolicitudCompra'){
 const document={id,name:'Control.xlsx',branch:'0101',kind,defaults:{emission:'2026-10-22',due:'2026-10-26',warehouse:'01',payment:'001'},rows:[{id:'1',product:'Z1',quantity:'3',quantityUnit:'millares',price:'80',unit:'millar',currency:'ARS',warehouse:'01',due:'2026-10-26'},{id:'2',product:'Z2',quantity:'2',quantityUnit:'millares',price:'80',unit:'millar',currency:'ARS',warehouse:'01',due:'2026-10-26'}]};
 const previews=[],permissions=[];let invalidations=0,denied=false;
 const imports={get:()=>structuredClone(document),invalidate:()=>invalidations++,classify:()=>{},preview:async(_actor,_id,input)=>{previews.push(structuredClone(input));return {message:'Pendiente solicitante',missing:['requester']};}};
 const chat=createAttachmentChat({imports,authorize:(...args)=>{permissions.push(args);if(denied)throw Object.assign(new Error('denied'),{status:403,code:'ACCION_DENEGADA'});},model:{complete:()=>assert.fail('No inference for literal correction')}}),conversation={};
 return {previews,permissions,conversation,set denied(value){denied=value;},get invalidations(){return invalidations;},query:(text,preferences={})=>chat('u',{text,...(!conversation.attachment?{attachmentId:id}:{})},conversation,'0101',preferences)};
}
test('attachment rejection clears file defaults and row values without restoring a warehouse preference',async()=>{
 const f=fixture();await f.query('Creame una solicitud de compra con el archivo');f.previews.length=0;
 let result=await f.query('No es ese depósito',{warehouse:'01'});assert.match(result.answer,/depósito/);assert.equal(f.previews.length,0);
 assert.equal(f.conversation.attachment.values.warehouse,undefined);assert.ok(f.conversation.attachment.rows.every(row=>row.warehouse===undefined));
 result=await f.query('Usá el depósito anterior',{warehouse:'01'});assert.equal(f.previews.length,0);assert.ok(f.conversation.attachment.logisticsPending.includes('warehouse'));
 await f.query('El depósito correcto es 03');assert.equal(f.previews.length,1);assert.equal(f.previews[0].warehouse,'03');assert.ok(f.previews[0].rows.every(row=>row.warehouse==='03'));assert.equal(f.previews[0].rows[0].quantity,'3');
});
test('attachment generic date correction retains candidate and changes only selected date kind',async()=>{
 const f=fixture();await f.query('Creame una solicitud de compra con el archivo');f.previews.length=0;
 await f.query('Cambiá la fecha al 25/10/2026');assert.equal(f.previews.length,0);assert.deepEqual(f.conversation.attachment.logisticsPending,['date']);
 await f.query('La de entrega');assert.equal(f.previews.length,1);assert.equal(f.previews[0].due,'2026-10-25');assert.equal(f.previews[0].emission,'2026-10-22');
});
test('an attachment candidate cannot overwrite a newer date or return after rejection',async()=>{
 for(const rejected of [false,true]){
  const f=fixture();await f.query('Creame una solicitud de compra con el archivo');f.previews.length=0;
  await f.query('Cambiá la fecha al 25/10/2026');
  if(rejected){await f.query('No es esa fecha');await f.query('La de entrega');assert.equal(f.previews.length,0);assert.ok(f.conversation.attachment.logisticsPending.includes('due'));}
  else{await f.query('La entrega es 26/10/2026');assert.equal(f.previews.length,1);assert.equal(f.previews[0].due,'2026-10-26');}
 }
});
test('a row warehouse correction keeps other rows and never excludes the row',async()=>{
 const f=fixture();await f.query('Creame una solicitud de compra con el archivo');f.previews.length=0;
 await f.query('Fila 1: descartá ese depósito');assert.equal(f.previews.length,0);assert.equal(f.conversation.attachment.rows[0].warehouse,undefined);assert.equal(f.conversation.attachment.rows[0].exclude,undefined);assert.equal(f.conversation.attachment.rows[1].warehouse,'01');
 await f.query('Depósito 03');assert.equal(f.previews.length,1);assert.equal(f.previews[0].rows[0].warehouse,'03');assert.equal(f.previews[0].rows[1].warehouse,'01');
});
test('existing attachment document logistics cannot prepare other changes on a later confirmation',async()=>{
 const f=fixture('pedidoCompra');await f.query('Actualizá precios del pedido de compra 123');f.previews.length=0;
 const result=await f.query('Depósito 03');assert.equal(result.unsupportedLogistics,true);assert.equal(f.previews.length,0);
 await f.query('Confirmo');assert.equal(f.previews.length,0);
});

test('row pending warehouse scopes cannot be cleared by another row or recover file defaults',async()=>{
 const f=fixture();await f.query('Creame una solicitud de compra con el archivo');f.previews.length=0;
 await f.query('Fila 1: descartá ese depósito');
 await f.query('Fila 2: depósito 03',{warehouse:'01'});
 assert.equal(f.previews.length,0);assert.equal(f.conversation.attachment.rows[0].warehouse,undefined);assert.equal(f.conversation.attachment.rows[1].warehouse,'03');
 assert.deepEqual(f.conversation.attachment.logisticsPending,['warehouse']);assert.deepEqual(f.conversation.attachment.logisticsScopes,[{row:'1',field:'warehouse'}]);
 await f.query('Fila 2: descartá ese depósito');
 const result=await f.query('Depósito 04');assert.match(result.answer,/fila|todas/);assert.equal(f.previews.length,0);assert.ok(f.conversation.attachment.rows.every(row=>row.warehouse===undefined));
 await f.query('Todas las filas: depósito 05');assert.equal(f.previews.length,1);assert.ok(f.previews[0].rows.every(row=>row.warehouse==='05'));
});

test('row generic date candidate preserves its row through kind clarification',async()=>{
 const f=fixture();await f.query('Creame una solicitud de compra con el archivo');f.previews.length=0;
 await f.query('Fila 1: cambiá la fecha al 25/10/2026');assert.equal(f.previews.length,0);
 assert.deepEqual(f.conversation.attachment.logisticsScopes,[{row:'1',field:'date',candidate:'2026-10-25'}]);
 const header=await f.query('La de emisión');assert.match(header.answer,/documento completo/);assert.equal(f.previews.length,0);
 await f.query('La de entrega');assert.equal(f.previews.length,1);assert.equal(f.previews[0].rows[0].due,'2026-10-25');assert.equal(f.previews[0].rows[1].due,'2026-10-26');assert.equal(f.previews[0].emission,'2026-10-22');assert.equal(f.previews[0].due,'2026-10-26');
});

test('new creation clears unsupported existing-document logistics guards and pending candidates',async()=>{
 const f=fixture('pedidoCompra');await f.query('Actualizá precios del pedido de compra 123');f.previews.length=0;
 await f.query('Depósito 03');assert.equal(f.conversation.attachment.unsupportedLogistics,true);
 await f.query('Fila 1: cambiá la fecha al 25/10/2026');assert.ok(f.conversation.attachment.logisticsPending.includes('date'));
 await f.query('Creame una solicitud de compra con el archivo');assert.equal(f.previews.length,1);
 assert.equal(f.conversation.attachment.unsupportedLogistics,undefined);assert.deepEqual(f.conversation.attachment.logisticsPending,[]);assert.deepEqual(f.conversation.attachment.logisticsScopes,[]);
 assert.equal(f.conversation.attachment.dateCandidate,undefined);assert.equal(f.conversation.attachment.logisticsRow,undefined);assert.equal(f.previews[0].rows[0].due,'2026-10-26');assert.equal(f.previews[0].warehouse,'01');
});

test('denied kind changes preserve the previous document state and guards',async()=>{
 const f=fixture('pedidoCompra');await f.query('Actualizá precios del pedido de compra 123');await f.query('Depósito 03');f.previews.length=0;
 const before=structuredClone(f.conversation.attachment);f.denied=true;
 await assert.rejects(f.query('Creame una solicitud de compra con el archivo'),{code:'ACCION_DENEGADA'});
 assert.deepEqual(f.conversation.attachment,before);assert.equal(f.previews.length,0);
});

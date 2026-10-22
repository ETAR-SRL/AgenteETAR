import test from 'node:test';
import assert from 'node:assert/strict';
import {logisticsCorrections as parse} from '../src/intelligence/logistics-corrections.js';

test('dates retain explicit kind and validate calendar dates without rollover',()=>{
 assert.deepEqual(parse('emisión 22/10/2026 y entrega 2026-11-04').changes,{emission:'2026-10-22',due:'2026-11-04'});
 for(const value of ['31/02/2026','22/10','22/10/26'])assert.deepEqual(parse(`entrega ${value}`).pending,['due']);
 for(const value of ['el 25 de octubre','viernes 30 de octubre','25'])assert.deepEqual(parse(`entrega ${value}`,{today:'2026-10-22',values:{due:'2026-10-26'}}).pending,['due']);
});
test('relative dates require supplied current date and resolve into frozen literals',()=>{
 assert.deepEqual(parse('entrega mañana').pending,['due']);
 const first=parse('emisión hoy y entrega mañana',{today:'2026-10-22'});
 assert.deepEqual(first.changes,{emission:'2026-10-22',due:'2026-10-23'});
 assert.deepEqual(parse('depósito 01',{today:'2026-10-23',values:first.changes}).changes,{warehouse:'01'});
 assert.equal(parse('entrega lunes',{today:'2026-10-22'}).changes.due,'2026-10-26');
});
test('warehouse and payment literals preserve leading zeros and names',()=>{
 assert.deepEqual(parse('depósito 001 y condición de pago 003').changes,{warehouse:'001',payment:'003'});
 assert.equal(parse('depósito Central Norte').changes.warehouse,'Central Norte');
});
test('negative fields invalidate only scoped values; affirmed replacements win either order',()=>{
 assert.deepEqual(parse('depósito 01 no').pending,['warehouse']);
 assert.deepEqual(parse('no depósito 01, depósito 02').changes,{warehouse:'02'});
 assert.deepEqual(parse('depósito 02, no depósito 01').changes,{warehouse:'02'});
 assert.deepEqual(parse('no condición de pago 003, condición de pago 004').changes,{payment:'004'});
 assert.deepEqual(parse('no entrega 24/10/2026, entrega 25/10/2026').changes,{due:'2026-10-25'});
});
test('preservation, quoted examples, hypothetical and unrelated amounts are ignored',()=>{
 for(const text of ['no cambies depósito 01','no modifiques la fecha de emisión','"depósito 01"','si te digo entrega mañana','precio 100 y cantidad 20','producto 001, pedido 002'])assert.deepEqual(parse(text),{changes:{},rejected:[],pending:[]});
});
test('generic date ambiguity preserves both dates until scope is clarified',()=>{
 const values={emission:'2026-10-22',due:'2026-10-23'};
 assert.deepEqual(parse('esa fecha no',{values}),{changes:{},rejected:[],pending:['date']});
 assert.deepEqual(parse('no 23/10/2026',{values}).rejected,['due']);
});
test('conflicting affirmative catalog literals require clarification',()=>{
 assert.deepEqual(parse('depósito 01, depósito 02').pending,['warehouse']);
});
test('ambiguous literal dates expose candidate and explicit scope for durable clarification',()=>{
 const values={emission:'2026-10-22',due:'2026-10-23'};
 assert.deepEqual(parse('cambiá la fecha al 25/10/2026',{values}),{changes:{},rejected:[],pending:['date'],dateCandidate:'2026-10-25'});
 assert.deepEqual(parse('la de entrega',{values}),{changes:{},rejected:[],pending:[],dateField:'due'});
 assert.deepEqual(parse('fecha de emisión no',{values}).pending,['emission']);
});
test('replacement connectors and irrelevant prices do not corrupt catalog codes',()=>{
 assert.equal(parse('depósito no es 01 es 02').changes.warehouse,'02');
 assert.deepEqual(parse('depósito 01, 80 por unidad').changes,{warehouse:'01'});
 assert.deepEqual(parse('entrega mañana',{today:new Date('invalid')}).pending,['due']);
});
test('accented imperatives and payment descriptions preserve corrected literals',()=>{
 assert.equal(parse('No uses depósito 01; usá 03').changes.warehouse,'03');
 assert.equal(parse('No es pago contado, es 30 días').changes.payment,'30 días');
 assert.equal(parse('emisión 22/10/2026, mejor 23/10/2026').changes.emission,'2026-10-23');
 assert.equal(parse('No, la entrega es el 25/10/2026').changes.due,'2026-10-25');
});
test('quoted catalog identifiers are literal candidates but quoted instructions are ignored',()=>{
 assert.equal(parse('depósito "03"').changes.warehouse,'03');
 assert.equal(parse('pago "Contado"').changes.payment,'Contado');
 assert.deepEqual(parse('"depósito 03"'),{changes:{},rejected:[],pending:[]});
 assert.deepEqual(parse('depósito "no uses 03"'),{changes:{},rejected:[],pending:[]});
});
test('financial vencimiento is never silently interpreted as delivery',()=>{
 const result=parse('vencimiento 25/10/2026',{values:{due:'2026-10-24'}});
 assert.deepEqual(result,{changes:{},rejected:[],pending:['date'],dateCandidate:'2026-10-25'});
});
test('long-chat catalog anaphors and placeholders never restore invalidated values',()=>{
 const values={warehouse:'01',payment:'003',emission:'2026-10-22',due:'2026-10-25'};
 const references=['anterior','de antes','el primero','ese','el mismo','habitual','por defecto','otro','nuevo','sin definir','desconocido','pendiente','pending'];
 for(const reference of references){
  for(const field of ['depósito','pago']){
   const result=parse(`Retomemos con el ${field} ${reference}.`,{values});
   assert.deepEqual(result.changes,{},`${field}: ${reference}`);
   assert.deepEqual(result.pending,[],`${field}: ${reference}`);
  }
 }
 for(const name of ['Nuevo Norte','Anterior Norte'])assert.equal(parse(`depósito ${name}`).changes.warehouse,name);
 assert.equal(parse('la de entrega',{values}).dateField,'due');
});
test('explicit unrelated fields cannot inherit warehouse or payment continuation focus',()=>{
 for(const other of ['proveedor 000001 tienda 01','producto Z731','cliente 000001','precio 80','cantidad 3','moneda USD','pedido 001','lista 003']){
  assert.deepEqual(parse(`depósito 01; ${other}`).changes,{warehouse:'01'},other);
  assert.deepEqual(parse(`pago 003; ${other}`).changes,{payment:'003'},other);
 }
 assert.deepEqual(parse('depósito 01; emisión 22/10/2026; producto Z731; proveedor 000001 tienda 01; condición de pago 001').changes,{warehouse:'01',emission:'2026-10-22',payment:'001'});
 assert.equal(parse('no depósito 01; usá 03').changes.warehouse,'03');
});
test('past relatives and explicitly past weekdays resolve backwards only with supplied today',()=>{
 const today='2026-10-22';
 for(const [word,expected] of [['ayer','2026-10-21'],['anteayer','2026-10-20'],['lunes pasado','2026-10-19'],['anterior lunes','2026-10-19'],['jueves anterior','2026-10-15'],['jueves','2026-10-29'],['pasado mañana','2026-10-24']]){
  assert.equal(parse(`entrega ${word}`,{today}).changes.due,expected,word);
  assert.deepEqual(parse(`entrega ${word}`,{values:{due:'2026-10-26'}}).pending,['due'],word);
 }
});

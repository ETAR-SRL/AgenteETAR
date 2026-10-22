import test from 'node:test';
import assert from 'node:assert/strict';
import {valueCorrections} from '../src/intelligence/value-corrections.js';

const context={values:{product:'Z1',price:'60',quantity:'3',currency:'ARS',priceUnit:'unidad',quantityUnit:'millares'}};
const changes=text=>valueCorrections(text,context).changes;

test('affirmed replacements override rejected amounts with independent bases',()=>{
 assert.deepEqual(valueCorrections('no son 3, son 4 millares',context),{changes:{quantity:'4',quantityUnit:'millares'},rejected:['quantity'],pending:[]});
 assert.deepEqual(valueCorrections('no 60 sino 65 dólares por millar',context),{changes:{price:'65',currency:'USD',priceUnit:'millar'},rejected:['price'],pending:[]});
 assert.deepEqual(changes('No son 3 son 4 millares'),{quantity:'4',quantityUnit:'millares'});
 assert.deepEqual(changes('precio 65, no 60'),{price:'65'});
 assert.deepEqual(changes('cantidad 4, no son 3'),{quantity:'4'});
 assert.deepEqual(changes('no pesos, dólares'),{currency:'USD'});
 assert.deepEqual(changes('no moneda 1 sino 2'),{currency:'2'});
 assert.deepEqual(valueCorrections('No son 3, sino 4 millares a 65 dólares por millar'),{changes:{quantity:'4',price:'65',currency:'USD',quantityUnit:'millares',priceUnit:'millar'},rejected:['quantity'],pending:[]});
});

test('rejection without replacement invalidates only the named value',()=>{
 for(const [text,field] of [['El precio no es ese','price'],['La cantidad no es esa','quantity'],['No pesos','currency'],['por unidad no','priceUnit'],['cantidad en unidades no','quantityUnit'],['no 60','price'],['no son 3','quantity']]){
  assert.deepEqual(valueCorrections(text,context),{changes:{},rejected:[field],pending:[field]},text);
 }
 assert.deepEqual(context.values,{product:'Z1',price:'60',quantity:'3',currency:'ARS',priceUnit:'unidad',quantityUnit:'millares'});
 for(const [text,field] of [['No uses el precio 80','price'],['no tomes el precio de 80','price'],['no pongas cantidad 3','quantity'],['No uses el precio','price']]){
  assert.deepEqual(valueCorrections(text,context),{changes:{},rejected:[field],pending:[field]},text);
 }
 assert.deepEqual(valueCorrections('Retomá la solicitud con el precio anterior',context),{changes:{},rejected:[],pending:[]});
});

test('price and quantity bases are independent in either order',()=>{
 assert.deepEqual(changes('cantidad en unidades, precio por millar'),{quantityUnit:'unidades',priceUnit:'millar'});
 assert.deepEqual(changes('precio por unidad, cantidad en millares'),{priceUnit:'unidad',quantityUnit:'millares'});
 assert.deepEqual(changes('por unidad no, por millar'),{priceUnit:'millar'});
 assert.deepEqual(changes('cantidad no en unidades sino millares'),{quantityUnit:'millares'});
 assert.deepEqual(changes('3 millares a 80 dólares por unidad'),{quantity:'3',price:'80',currency:'USD',quantityUnit:'millares',priceUnit:'unidad'});
 assert.deepEqual(changes('cantidad 3 unidades precio 80 pesos por millar'),{quantity:'3',price:'80',currency:'ARS',quantityUnit:'unidades',priceUnit:'millar'});
});

test('preservation, quoted examples and reference numbers never supply amounts',()=>{
 for(const text of ['no cambies el precio 80','No modifiques cantidad 4 unidades','El ejemplo es "no son 3, son 4 millares"','Si te digo no 60 sino 65 dólares por millar','"precio 80 pesos por unidad"','producto 60 pedido 123 item 01 lista 80','producto Z60 pedido 123456','Subime la lista en 20%']){
  assert.deepEqual(valueCorrections(text,context),{changes:{},rejected:[],pending:[]},text);
 }
 assert.deepEqual(changes('no cambies cantidad 4, precio 65 pesos'),{price:'65',currency:'ARS'});
});

test('literal decimal conventions and ambiguity never invent arithmetic',()=>{
 assert.deepEqual(changes('cantidad 2,5 millares a 80,50 dólares por millar'),{quantity:'2.5',price:'80.50',currency:'USD',quantityUnit:'millares',priceUnit:'millar'});
 assert.deepEqual(changes('precio 1.234,50 pesos por millar'),{price:'1234.50',currency:'ARS',priceUnit:'millar'});
 const ambiguous=valueCorrections('precio 1.234',context);
 assert.equal(ambiguous.changes.price,undefined);assert.ok(ambiguous.pending.includes('price'));
 const alternative=valueCorrections('precio 80 o 90 dólares',context);
 assert.equal(alternative.changes.price,undefined);assert.ok(alternative.pending.includes('price'));
 const currencies=valueCorrections('precio 80 pesos o dólares',context);
 assert.equal(currencies.changes.currency,undefined);assert.ok(currencies.pending.includes('currency'));
 assert.deepEqual(changes('precio 80 dólares por millar'),{price:'80',currency:'USD',priceUnit:'millar'});
});

test('optional removal is explicit and a replacement price restores the price requirement',()=>{
 const omitted=valueCorrections('sin precio',context);
 assert.deepEqual(omitted,{changes:{},rejected:['price','priceUnit'],pending:[],optionalPriceRemoved:true});
 assert.deepEqual(valueCorrections('sin precio; precio 65 pesos por millar',context),{changes:{price:'65',currency:'ARS',priceUnit:'millar'},rejected:['price','priceUnit'],pending:[]});
});

test('interjections and correction order do not override literal replacements',()=>{
 assert.deepEqual(changes('No, la cantidad es 4 millares'),{quantity:'4',quantityUnit:'millares'});
 assert.deepEqual(changes('El precio no es 80 sino 90'),{price:'90'});
 assert.deepEqual(changes('No son 3 millares sino 4000 unidades'),{quantity:'4000',quantityUnit:'unidades'});
 assert.deepEqual(changes('Dólares no, pesos'),{currency:'ARS'});
 assert.deepEqual(changes('Por millar no, por unidad'),{priceUnit:'unidad'});
 assert.deepEqual(changes('Cambiame a 65, no a 60'),{price:'65'});
 assert.deepEqual(changes('cantidad en unidades'),{quantityUnit:'unidades'});
});

test('dates, warehouse and other document numbers cannot reuse the amount focus',()=>{
 for(const text of ['precio 90; emisión 2026-10-22; depósito 80','precio 90; entrega 22/10/2026; sucursal 0101','precio 90; total 270; centro de costo 123','precio 90; fecha 22.10.2026; comprador 9','precio 90; depósito 01; pedido 123456; item 03']){
  assert.deepEqual(changes(text),{price:'90'},text);
 }
 assert.deepEqual(valueCorrections('no 3',{values:{price:'3',quantity:'3'}}),{changes:{},rejected:['price','quantity'],pending:['price','quantity']});
});

test('competing affirmative amounts or bases remain pending instead of choosing the last one',()=>{
 for(const [text,field] of [['Cambiame precio 80 por unidad y por millar','priceUnit'],['cantidad en unidades y millares','quantityUnit'],['precio 80, precio 90','price'],['cantidad 3 unidades; cantidad 4 unidades','quantity']]){
  const result=valueCorrections(text,context);
  assert.equal(result.changes[field],undefined,text);assert.ok(result.pending.includes(field),text);
 }
 assert.deepEqual(changes('por unidad no, por millar'),{priceUnit:'millar'});
 assert.deepEqual(changes('precio 80, no precio 80, precio 90'),{price:'90'});
 assert.deepEqual(changes('precio 80; mejor precio 90'),{price:'90'});
 assert.deepEqual(changes('precio 80 por unidad y por unidad'),{price:'80',priceUnit:'unidad'});
});

test('qualifiers of a rejected amount preserve known currency and bases without asserting new ones',()=>{
 const known={values:{price:'80',currency:'USD',priceUnit:'millar',quantity:'3',quantityUnit:'millares'}};
 assert.deepEqual(valueCorrections('No son 80 dólares por millar, son 90',known),{changes:{price:'90'},rejected:['price'],pending:[]});
 assert.deepEqual(valueCorrections('No son 3 millares, son 4',known),{changes:{quantity:'4'},rejected:['quantity'],pending:[]});
 assert.deepEqual(valueCorrections('No son 80 dólares por millar, son 90 pesos por unidad',known),{changes:{price:'90',currency:'ARS',priceUnit:'unidad'},rejected:['price'],pending:[]});
 assert.deepEqual(valueCorrections('No son 80 dólares por millar'),{changes:{},rejected:['price'],pending:['price']});
 assert.deepEqual(valueCorrections('No son 3 millares'),{changes:{},rejected:['quantity'],pending:['quantity']});
 assert.deepEqual(valueCorrections('No dólares',known),{changes:{},rejected:['currency'],pending:['currency']});
 assert.deepEqual(valueCorrections('No es por millar',known),{changes:{},rejected:['priceUnit'],pending:['priceUnit']});
 assert.deepEqual(valueCorrections('cantidad no en millares',known),{changes:{},rejected:['quantityUnit'],pending:['quantityUnit']});
 assert.deepEqual(valueCorrections('No uses el precio 80 ni la moneda dólares',known),{changes:{},rejected:['price','currency'],pending:['price','currency']});
});

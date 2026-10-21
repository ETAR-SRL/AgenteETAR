import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Changes} from '../src/changes.js';
test('attention proposal refresh presents a new diff, supersedes the old fingerprint and never executes writes',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());let price='0.06',executes=0,prepared=[];
 const changes=new Changes({store,read:async()=>({data:[{registro:'1',precioUnitario:price,cantidadPedida:'1000'}],meta:{}}),erp:{writes:{enabled:true,prepare:async(_action,input)=>{prepared.push(structuredClone(input));return {snapshotHash:'hash-'+price,diff:[{field:'precioUnitario',before:price,after:input.changes.precioUnitario}],identity:{numero:'000123'},executionEnabled:true};},execute:async()=>{executes++;},check:async()=>{}}}});
 const input={action:'pedidoVenta',target:{sucursal:'0101',registro:'1'},changes:{precioUnitario:'0.07'},expectedPrice:'0.06',expectedQuantity:'1000',expectedIdentity:{numero:'000123',producto:'Z1',moneda:'2'},priceUnit:'unidad',origin:{attention:'owned-card'}};
 const first=await changes.preview('user:a',input);price='0.065';const renewed=await changes.renewAttention('user:a',first.id);assert.equal(renewed.reconfirmationRequired,true);assert.equal(renewed.proposal.diff[0].before,'0.065');assert.equal(renewed.proposal.diff[0].after,'0.07');assert.equal(prepared.at(-1).expectedPrice,'0.065');assert.equal(prepared.at(-1).expectedIdentity.numero,'000123');assert.equal(executes,0);assert.equal(store.get(first.id,'user:a').status,'superseded');assert.notEqual(renewed.proposal.id,first.id);await assert.rejects(()=>changes.check('user:a',first.id),{code:'PROPUESTA_REEMPLAZADA'});await assert.rejects(()=>changes.execute('user:a',renewed.proposal.id,{confirm:true,fingerprint:first.fingerprint}),{code:'CONFIRMACION_REQUERIDA'});assert.equal(executes,0);
});
test('refresh excludes new documents, proposals from other users and uncertain or already executed outcomes',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const changes=new Changes({store,erp:{},read:async()=>{throw Error('Must not read');}});
 const proposal=store.save('user:a',{action:'pedidoVenta',origin:{attention:'card'},input:{},target:{sucursal:'0101',registro:'1'},fingerprint:'old'});await assert.rejects(()=>changes.renewAttention('user:b',proposal.id),{status:404});store.claim(proposal.id,'user:a');store.finish(proposal.id,'user:a','unknown',{code:'RESULTADO_INCIERTO'});await assert.rejects(()=>changes.renewAttention('user:a',proposal.id),{code:'EJECUCION_NO_REPETIBLE'});const creation=store.save('user:a',{action:'crearPedidoCompra',origin:{attention:'card'},input:{}});await assert.rejects(()=>changes.renewAttention('user:a',creation.id),{status:404});
});

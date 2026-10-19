import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Changes } from '../src/changes.js';
function manager(row,resource,fields){
  const store=new Store(':memory:');
  return {store,changes:new Changes({store,erp:{metadata:()=>({entities:{[resource]:{fields}}})},read:async()=>({data:[row],meta:{}})})};
}
test('allows filling empty existing contact but refuses a missing physical column',async()=>{
  const fields=[{salida:'email',disponible:true,diccionario:{X3_TAMANHO:80}}];
  const {changes,store}=manager({registro:1,email:null},'clientes',fields);
  const input={action:'clienteContacto',target:{sucursal:'0101',registro:'1'},changes:{email:'a@example.invalid'}};
  const result=await changes.preview('a',input);assert.equal(result.diff[0].before,null);
  fields[0].disponible=false;await assert.rejects(()=>changes.preview('a',input),{code:'CAMPO_NO_DISPONIBLE'});store.close();
});
test('price requires known precision, enforces field width and rejects equivalent decimals',async()=>{
  const dictionary={X3_TAMANHO:10,X3_DECIMAL:2};
  const {changes,store}=manager({registro:1,precio:'1.2500000000000001e+003'},'preciosClientes',[{salida:'precio',disponible:true,diccionario:dictionary}]);
  const input={action:'precioLista',target:{sucursal:'0101',registro:'1'},changes:{precio:'1250.00'}};
  await assert.rejects(()=>changes.preview('a',input),{code:'SIN_CAMBIOS'});
  input.changes.precio='999999999999.99';await assert.rejects(()=>changes.preview('a',input),{code:'PRECIO_FUERA_DE_RANGO'});
  input.changes.precio='100';dictionary.X3_DECIMAL=null;
  await assert.rejects(()=>changes.preview('a',input),{code:'PRECISION_DESCONOCIDA'});store.close();
});

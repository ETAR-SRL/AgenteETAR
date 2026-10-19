import test from 'node:test';
import assert from 'node:assert/strict';
import { createKaiqenPostgres } from '../src/kaiqen-postgres.js';
function fixture({readonly='on',fail=false,found=true}={}){
  const calls=[];let released=false;
  const client={query:async(text,values)=>{
    calls.push({text,values});
    if(text==='SHOW transaction_read_only')return {rows:[{transaction_read_only:readonly}]};
    if(text.startsWith('SELECT')&&text.includes('FROM public.project p')){
      if(fail)throw new Error('sensitive-db-connection-string');
      return {rows:found?[{id:'project-1',sin_ia_externa:true,erp_producto_referencia_id:null}]:[]};
    }
    return {rows:[]};
  },release:()=>{released=true;}};
  const adapter=createKaiqenPostgres({tenantId:'tenant-test',pool:{connect:async()=>client,end:async()=>{}}});
  return {adapter,calls,isReleased:()=>released};
}
test('every database read is inside a verified read-only transaction and scoped to tenant',async()=>{
  const {adapter,calls,isReleased}=fixture();const result=await adapter.project('project-1');
  assert.equal(calls[0].text,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(calls[1].text,'SHOW transaction_read_only');assert.equal(calls.at(-1).text,'ROLLBACK');assert.equal(isReleased(),true);
  for(const {text,values} of calls.filter(x=>x.text.includes('FROM public.')&&!x.text.includes('cat_issue_status'))){assert.ok(text.includes('tenant_id=$1'));assert.equal(values[0],'tenant-test');}
  assert.equal(result.data.project.sin_ia_externa,true);assert.equal(result.data.derivedStateAvailable,false);assert.equal(result.source,'postgres');
});
test('refuses a pooler which did not enable read-only; no business SELECT occurs',async()=>{
  const {adapter,calls,isReleased}=fixture({readonly:'off'});
  await assert.rejects(()=>adapter.projects(),{code:'KAIQEN_READ_ONLY_REQUIRED'});
  assert.equal(calls.some(x=>x.text.includes('FROM public.')),false);assert.equal(calls.at(-1).text,'ROLLBACK');assert.equal(isReleased(),true);
});
test('rejects unsafe identifiers and unavailable derived status filters',async()=>{
  const {adapter,calls}=fixture();
  await assert.rejects(()=>adapter.projects({status:'EN_SERIE'}),{code:'FILTRO_NO_ADMITIDO'});
  await assert.rejects(()=>adapter.product("x' OR 1=1"),{code:'KAIQEN_INVALID_INPUT'});
  assert.equal(calls.some(x=>x.text.includes('FROM public.')),false);
});
test('foreign or missing projects return404; database exceptions do not expose secrets',async()=>{
  const absent=fixture({found:false});await assert.rejects(()=>absent.adapter.project('foreign'),{status:404});
  const bad=fixture({fail:true});await assert.rejects(()=>bad.adapter.projects(),error=>error.code==='KAIQEN_DATABASE_UNAVAILABLE'&&!error.message.includes('sensitive'));
  assert.equal(bad.calls.at(-1).text,'ROLLBACK');
});

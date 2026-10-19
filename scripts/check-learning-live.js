import assert from 'node:assert/strict';
import {readEnvFile} from '../src/env-file.js';
import {writeFile} from 'node:fs/promises';
const env=readEnvFile('.env'),origin='http://127.0.0.1:4310';
const headers={authorization:'Bearer '+env.API_READ_KEY,'content-type':'application/json'};
const report={at:new Date().toISOString(),cases:[]};
async function request(path,method='GET',body){const r=await fetch(origin+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.ok(r.ok,`${r.status}: ${data.error?.code||'request failed'}`);return data;}
async function chat(text,conversationId){const start=Date.now();const result=await request('/api/agent/chat','POST',{text,conversationId,context:{sucursal:'0101'}});const summary={seconds:Math.round((Date.now()-start)/100)/10,grounded:result.grounded,priceVerified:result.priceVerified,actions:result.trace.map(t=>t.action+':'+t.status)};report.cases.push(summary);console.log(JSON.stringify(summary));return result;}
const term='pieza control memoria '+Date.now();let savedId;
try{
 const learned=await chat(`Recordá que llamamos ${term} al producto Z129001A.`);
 savedId=learned.evidence.find(e=>e.action==='aprender')?.result.data[0].id;
 assert.ok(savedId,'El modelo debe guardar la enseñanza explícita');
 const persisted=await request('/api/agent/knowledge');assert.ok(persisted.data.some(item=>item.id===savedId));
 const price=await chat(`¿A cuánto vendemos la ${term}? Necesito el valor de lista.`);
 assert.ok(price.priceVerified,'Debe recuperar la memoria en una conversación nueva y consultar el precio actual');
 assert.equal(price.evidence.find(e=>e.action==='precio_venta')?.result.product.codigo,'Z129001A');
 report.cases[0].case='Enseñanza explícita por chat';report.cases[1].case='Memoria entre conversaciones y relectura ERP';
}finally{
 if(savedId){assert.equal((await request('/api/agent/knowledge/'+savedId,'DELETE')).deleted,true);report.testMemoryRemoved=true;}
}
await writeFile('reports/learning-live-check.json',JSON.stringify(report,null,2));

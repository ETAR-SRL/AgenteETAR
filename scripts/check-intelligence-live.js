import {readEnvFile} from '../src/env-file.js';
import {writeFile} from 'node:fs/promises';
const env=readEnvFile('.env'),origin='http://127.0.0.1:4310';
const headers={authorization:'Bearer '+env.API_READ_KEY,'content-type':'application/json'};
const report={at:new Date().toISOString(),cases:[]};
async function chat(text,conversationId){const start=Date.now();const r=await fetch(origin+'/api/agent/chat',{method:'POST',headers,body:JSON.stringify({text,conversationId,context:{sucursal:'0101'}})});const result=await r.json();if(!r.ok)throw new Error(JSON.stringify(result));const summary={text,seconds:Math.round((Date.now()-start)/100)/10,grounded:result.grounded,priceVerified:result.priceVerified,actions:result.trace.map(t=>t.action+':'+t.status),rows:result.evidence.map(e=>e.result.data?.length||e.result.candidates?.length||0)};report.cases.push(summary);console.log(JSON.stringify(summary));return result;}
const exact=await chat('¿Cuál es el precio de venta de lista al que vendemos el producto Z129001A?');
if(!exact.priceVerified)throw new Error('No resolvió el precio');
const follow=await chat('¿En qué moneda está ese precio?',exact.conversationId);
if(!follow.priceVerified)throw new Error('No volvió a verificar precio en seguimiento');
const ambiguous=await chat('Necesito saber a cuánto vendemos la varilla de suspensión.');
if(!ambiguous.grounded)throw new Error('No buscó el producto por nombre');
if(ambiguous.priceVerified||!ambiguous.evidence.some(e=>e.result.candidates?.length>1))throw new Error('No conservó la ambigüedad entre productos');
const projects=await chat('¿Qué proyectos tenemos en KAIQEN y cómo van?');
if(!projects.grounded)throw new Error('No consultó KAIQEN');
if(!projects.evidence.some(e=>e.result.data?.length>=4))throw new Error('No recuperó la cartera real de proyectos');
const missing=await chat('Pasame el precio de venta, de lista al que estamos vendiendo un producto');
if(!missing.answer.includes('?'))throw new Error('No pidió identificar el producto');
await writeFile('reports/intelligence-live-check.json',JSON.stringify(report,null,2));

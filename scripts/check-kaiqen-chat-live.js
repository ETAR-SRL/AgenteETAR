import assert from 'node:assert/strict';
import {readEnvFile} from '../src/env-file.js';
import {writeFile} from 'node:fs/promises';
const env=readEnvFile('.env'),headers={authorization:'Bearer '+env.API_READ_KEY,'content-type':'application/json'};
const report={at:new Date().toISOString(),cases:[]};
for(const [text,context,action] of [
 ['¿Qué proyectos tenemos en KAIQEN y cómo van?',{sucursal:'0101'},'proyectos'],
 ['Revisá qué información de calidad tenemos para el proyecto seleccionado.',{sucursal:'0101',proyecto:env.KAIQEN_PROJECT_ID},'calidad']
]){
 const started=Date.now();const r=await fetch('http://127.0.0.1:4310/api/agent/chat',{method:'POST',headers,body:JSON.stringify({text,context})});const result=await r.json();assert.ok(r.ok);assert.ok(result.evidence.some(e=>e.action===action));
 if(action==='proyectos'){assert.match(result.answer,/fase/i);assert.doesNotMatch(result.answer,/c[oó]d(?:igo|\.)?\s+ERP|tiempo real/i);}
 report.cases.push({case:action,seconds:Math.round((Date.now()-started)/100)/10,grounded:result.grounded,actions:result.trace.map(t=>t.action+':'+t.status)});console.log(JSON.stringify(report.cases.at(-1)));
}
await writeFile('reports/kaiqen-chat-live-check.json',JSON.stringify(report,null,2));

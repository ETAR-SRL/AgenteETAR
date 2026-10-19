import {readFile,writeFile,mkdir} from 'node:fs/promises';
const origin='http://127.0.0.1:4310';
const response=await fetch(origin+'/api/ui/session',{method:'POST',headers:{origin}});
if(response.status!==200)throw new Error('Session failed');
const cookie=response.headers.get('set-cookie').split(';')[0];
const report={at:new Date().toISOString(),checks:[]};
async function request(path,options={}){const response=await fetch(origin+path,{...options,headers:{cookie,origin,...options.headers}});const data=await response.json();if(!response.ok)throw new Error(`${path}: ${response.status} ${data.error?.code}`);return data;}
for(const resource of ['costos','itemsVentas','remitos']){const r=await request(`/api/erp/${resource}?sucursal=0101&limit=5`);report.checks.push({resource,rows:r.data.length,mode:r.source.mode,hasMore:r.meta?.hasMore});}
const projects=await request('/api/kaiqen/projects');report.checks.push({resource:'projects',rows:projects.data.length});
const overview=await request('/api/overview/projects/'+process.env.KAIQEN_PROJECT_ID);report.checks.push({resource:'overview',status:overview.status,phases:overview.project.data.phases.length,quality:overview.quality.status});
const audio=await readFile('data/voice-test.wav');const voice=await request('/api/voice/transcribe',{method:'POST',headers:{'content-type':'audio/wav'},body:audio});
report.checks.push({resource:'voice',...voice});
const query=await request('/api/agent/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:voice.text,context:{sucursal:'0101'}})});report.checks.push({resource:'transcribed-query',plan:query.plan.resource,rows:query.result.data.length});
await mkdir('reports',{recursive:true});await writeFile('reports/pwa-live-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));

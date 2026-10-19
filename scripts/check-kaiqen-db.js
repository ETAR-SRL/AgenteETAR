import { writeFileSync } from 'node:fs';
import { createKaiqenPostgres } from '../src/kaiqen-postgres.js';
const adapter=createKaiqenPostgres({connectionString:process.env.KAIQEN_DATABASE_URL,tenantId:process.env.KAIQEN_TENANT_ID,caFile:process.env.KAIQEN_CA_FILE});
const project=process.env.KAIQEN_PROJECT_ID;
const report={checkedAt:new Date().toISOString(),source:'postgres',tenantScoped:true,writes:0,results:[]};
try{
  for(const [name,call] of [['projects',()=>adapter.projects({limit:5})],['project',()=>adapter.project(project)],['quality',()=>adapter.quality(project)],['projectLink',()=>adapter.projectLink(project)]]){
    try{
      const result=await call();
      report.results.push({name,status:'ok',...(Array.isArray(result.data)?{sampleCount:result.data.length,hasMore:result.pagination.hasMore}:{}),...(result.data.domains?{qualityCounts:Object.fromEntries(Object.entries(result.data.domains).map(([k,v])=>[k,v.conteos.reduce((n,row)=>n+row.cantidad,0)]))}:{}),...(name==='projectLink'?{referenceLinked:!!result.data.articulo_referencia,partCount:result.data.piezas}:{}),...(name==='project'?{phases:result.data.phases.length,gates:result.data.gates.length,computedLifecycle:result.data.derivedStateAvailable}: {})});
    }catch(error){report.results.push({name,status:'failed',code:error.code});}
  }
  writeFileSync('reports/kaiqen-live-check.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(report.results.some(x=>x.status==='failed'))process.exitCode=1;
}finally{await adapter.close();}

import { writeFileSync } from 'node:fs';
const project=process.env.KAIQEN_PROJECT_ID;
const paths=['/health','/api/kaiqen/projects?limit=5',`/api/kaiqen/projects/${project}`,`/api/kaiqen/quality/${project}`,`/api/overview/projects/${project}`];
const results=[];
for(const path of paths){
  try{
    const response=await fetch('http://127.0.0.1:4310'+path,{headers:{Authorization:`Bearer ${process.env.API_READ_KEY}`},signal:AbortSignal.timeout(30000)});
    const data=await response.json();
    results.push({path,status:response.status,pass:response.ok,source:data.source??null,...(Array.isArray(data.data)?{sampleCount:data.data.length}:{}),...(path.includes('/overview/')?{overviewStatus:data.status,project:data.project?.source,quality:data.quality?.status,erpLink:data.erpLink?.status,reference:data.reference?.status,costRows:data.reference?.costs?.data?.length??null}:{}),...(data.error?{code:data.error.code}:{})});
  }catch{results.push({path,pass:false,reason:'local_request_failed'});}
}
const report={checkedAt:new Date().toISOString(),mode:'live',localUrl:'http://127.0.0.1:4310',results};
writeFileSync('reports/local-running-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(results.some(x=>!x.pass))process.exitCode=1;

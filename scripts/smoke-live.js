import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { createErp } from '../src/protheus/index.js';
import { createKaiqen } from '../src/kaiqen.js';
import { createApp } from '../src/app.js';
import { Store } from '../src/store.js';
const erp=await createErp();
const store=new Store(':memory:');
const kaiqen=createKaiqen({baseUrl:process.env.KAIQEN_BASE_URL,token:process.env.KAIQEN_TOKEN});
const server=createApp({erp,kaiqen,store,mode:'live',readKey:process.env.API_READ_KEY,planKey:process.env.API_PLAN_KEY,branches:(process.env.ERP_BRANCHES||'0101').split(',')});
try{
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const branch=(process.env.ERP_BRANCHES||'0101').split(',')[0];
  const cases=[
    ['/health',200],['/api/capabilities',200],['/api/openapi.json',200],
    [`/api/erp/costos?sucursal=${branch}&limit=1`,200],
    [`/api/erp/remitos?sucursal=${branch}&limit=1`,200],
    [`/api/erp/itemsVentas?sucursal=${branch}&pendiente=true&limit=1`,200],
    ['/api/erp/costos?sucursal=not-allowed',403],
    [`/api/erp/entregas?sucursal=${branch}`,200]
  ];
  const results=[];
  for(const [path,expected] of cases){
    const response=await fetch(base+path,{headers:{Authorization:`Bearer ${process.env.API_READ_KEY}`}});
    const body=await response.json();
    results.push({path,status:response.status,expected,pass:response.status===expected,...(Array.isArray(body.data)?{sampleCount:body.data.length}:{}),...(body.error?{code:body.error.code}:{}),...(body.status?{sourceStatus:body.status}:{})});
  }
  const report={checkedAt:new Date().toISOString(),mode:'live',writesToERP:0,kaiqenLiveVerified:false,results};
  writeFileSync('reports/http-live-check.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(results.some(x=>!x.pass))process.exitCode=1;
}finally{server.close();server.closeAllConnections();store.close();await erp.close();}

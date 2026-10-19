import { createErp } from '../src/protheus/index.js';
let erp;
try{
  erp=await createErp({configPath:process.env.CONFIG_PATH||'config/mapping.json'});
  const metadata=erp.metadata();
  const results=[];
  for(const resource of Object.keys(metadata.entities)){
    try{const result=await erp.list(resource,new URLSearchParams({sucursal:(process.env.ERP_BRANCHES||'0101').split(',')[0],limit:'1'}));results.push({resource,status:'ok',sampleCount:result.data.length,hasMore:result.meta.hasMore,effectiveBranch:result.meta.sucursalEfectiva,missingFields:metadata.entities[resource].fields?.filter(x=>!x.disponible).map(x=>x.origen)});}
    catch(error){results.push({resource,status:'unavailable',code:error.code||'SOURCE_ERROR'});}
  }
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),mode:'live',readOnly:true,results},null,2));
  if(results.some(x=>x.status==='unavailable'))process.exitCode=2;
}catch(error){console.log(JSON.stringify({connected:false,code:error.code||'CONNECTION_ERROR',readOnly:true}));process.exitCode=1;}
finally{await erp?.close();}

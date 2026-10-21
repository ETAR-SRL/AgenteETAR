#!/usr/bin/env node
// Deliberately does not load .env, Store, server, schedulers, VPNs or mutation executors.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {runIntegrationValidation,offlineValidationAdapters} from '../src/integration-validation.js';
const safeCode=error=>/^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code||'')?error.code:'VALIDATION_FAILED';
export async function validationMain(args=process.argv.slice(2),env=process.env,{cwd=process.cwd(),stdout=console.log}={}){
 let erp,kaiqen,report;
 const allowed=new Set(['--offline','--live','--prepare','--help']);
 if(args.includes('--help')){stdout('Uso: node scripts/validate-integration.js --offline|--live [--prepare]. Live exige VALIDATION_BRANCH incluida en ERP_BRANCHES; no carga .env por sí mismo.');return 0;}
 if(args.some(a=>!allowed.has(a))||args.filter(a=>a==='--offline'||a==='--live').length!==1||new Set(args).size!==args.length){stdout(JSON.stringify({status:'failed',code:'VALIDATION_ARGUMENTS',readOnly:true}));return 1;}
 const mode=args.includes('--live')?'live':'offline',prepare=args.includes('--prepare');
 let branch=mode==='offline'?'TEST':env.VALIDATION_BRANCH,limit=Number(env.VALIDATION_SAMPLE_LIMIT||1);
 try{
  if(!Number.isInteger(limit)||limit<1||limit>3)throw Object.assign(Error(),{code:'VALIDATION_LIMIT'});
  if(mode==='offline')({erp,kaiqen}=offlineValidationAdapters());
  else{
   const authorized=(env.ERP_BRANCHES||'').split(',').map(v=>v.trim()).filter(Boolean);
   if(!branch||!/^[A-Za-z0-9]{1,12}$/.test(branch)||!authorized.includes(branch))throw Object.assign(Error(),{code:'VALIDATION_BRANCH_NOT_AUTHORIZED'});
   const readonlyEnv={...env,ERP_WRITE_ENABLED:'false',LOCAL_WRITE_ENABLED:'false',ERP_APPROVAL_AUTO_ESCALATE:'false'};
   const {createErp}=await import('../src/protheus/index.js');erp=await createErp({env:readonlyEnv,configPath:env.CONFIG_PATH});
   if(env.KAIQEN_SOURCE==='postgres'&&env.KAIQEN_DATABASE_URL&&env.KAIQEN_TENANT_ID){const {createKaiqenPostgres}=await import('../src/kaiqen-postgres.js');kaiqen=createKaiqenPostgres({connectionString:env.KAIQEN_DATABASE_URL,tenantId:env.KAIQEN_TENANT_ID,caFile:env.KAIQEN_CA_FILE});}
  }
  report=await runIntegrationValidation({mode,branch,limit,prepare,erp,kaiqen,projectId:mode==='offline'?'fixture':env.KAIQEN_PROJECT_ID});
 }catch(error){report={version:1,checkedAt:new Date().toISOString(),mode,evidence:mode==='offline'?'controlled_fixtures_only':'live_not_completed',readOnly:true,erpWrites:0,checksStatus:'failed',realValidation:mode==='offline'?'not_performed':'not_completed',code:safeCode(error)};}
 finally{await Promise.allSettled([erp?.close?.(),kaiqen?.close?.()]);}
 const directory=resolve(cwd,'data','validation');await mkdir(directory,{recursive:true});const file=resolve(directory,`${new Date().toISOString().replace(/[:.]/g,'-')}-${mode}-${randomUUID().slice(0,8)}.json`);await writeFile(file,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 stdout(JSON.stringify({mode,status:report.checksStatus,realValidation:report.realValidation,readOnly:true,report:file}));return report.checksStatus==='failed'?2:0;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){validationMain().then(code=>process.exitCode=code).catch(()=>{console.error(JSON.stringify({status:'failed',code:'VALIDATION_REPORT_ERROR',readOnly:true}));process.exitCode=2;});}

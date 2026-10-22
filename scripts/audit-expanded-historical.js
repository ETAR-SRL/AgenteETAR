#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createErp} from '../src/protheus/index.js';
import {connect} from '../src/protheus/database.js';
import {loadConfig,identifier as q} from '../src/protheus/config.js';
import {Catalog} from '../src/protheus/catalog.js';
import {runExpandedHistoricalAudit} from '../src/expanded-historical-audit.js';

let erp,db,report;const env=process.env;
const code=e=>/^[A-Z][A-Z0-9_]{0,63}$/.test(e?.code||'')?e.code:'AUDIT_FAILED';
try{
 if(process.argv.slice(2).join(' ')!=='--live')throw Object.assign(Error(),{code:'AUDIT_ARGUMENTS'});
 const branches=(env.ERP_BRANCHES||'').split(',').map(v=>v.trim()).filter(Boolean),branch=env.VALIDATION_BRANCH;
 if(!branch||!branches.includes(branch))throw Object.assign(Error(),{code:'AUDIT_BRANCH_NOT_AUTHORIZED'});
 const readonly={...env,ERP_WRITE_ENABLED:'false',LOCAL_WRITE_ENABLED:'false',ERP_APPROVAL_AUTO_ESCALATE:'false'};
 erp=await createErp({env:readonly});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const windows=[{desde:'2020-01-01',hasta:'2023-12-31'},{desde:'2024-01-01',hasta:'2024-12-31'},{desde:'2025-01-01',hasta:'2025-12-31'},{desde:'2026-01-01',hasta:today}];
 report=await runExpandedHistoricalAudit({erp,branch,today,windows});
 // Gap in list contract: absence diagnostics require deleted-state existence and physical schema. No commercial row leaves SQL.
 db=await connect(readonly);const config=loadConfig(env.ERP_MAPPING_PATH||env.CONFIG_PATH||'config/mapping.json'),catalog=new Catalog(db,config);await catalog.init();
 report.purchasePhysicalDiagnostics=[];
 for(const alias of ['SC1','SC7']){
  const entity=Object.values(config.entities).find(e=>e.alias===alias),table=catalog.table(alias),field=entity.branch;
  if(![field,'D_E_L_E_T_','R_E_C_N_O_'].every(f=>table.columns.has(f)))throw Object.assign(Error(),{code:'AUDIT_SCHEMA'});
  const params={branch:catalog.branch(alias,branch),take:501};
  const [r]=await db.query(`SELECT (SELECT COUNT_BIG(*) FROM (SELECT TOP (@take) [R_E_C_N_O_] FROM ${catalog.name(alias)} WHERE ${q(field)}=@branch AND [D_E_L_E_T_]=' ' ORDER BY [R_E_C_N_O_]) a) activeBounded, (SELECT COUNT_BIG(*) FROM (SELECT TOP (@take) [R_E_C_N_O_] FROM ${catalog.name(alias)} WHERE ${q(field)}=@branch AND [D_E_L_E_T_]<>' ' ORDER BY [R_E_C_N_O_]) d) deletedBounded`,params);
  report.purchasePhysicalDiagnostics.push({alias,physicalMappingVerified:true,branchRuleVerified:true,sx2Modes:Object.fromEntries(['X2_MODO','X2_MODOEMP','X2_MODOUN'].map(k=>[k,catalog.sx2.get(alias)?.[k]??null])),activeRowsUpTo501:Number(r.activeBounded),deletedRowsUpTo501:Number(r.deletedBounded),rowCap:501,scope:'authorized_physical_branch_only_all_dates',conclusion:Number(r.activeBounded)===0?'no_active_rows_in_configured_physical_branch':'active_rows_exist_compare_adapter_filters'});
 }
 report.otherHistoricalTables={inspected:'metadata_only',queried:false,reason:'no_other_physical_mapping_authorized'};
}catch(e){report={...(report||{}),readOnly:true,erpWrites:0,checksStatus:'failed',realValidation:'partial_requires_review',code:code(e)};}
finally{await Promise.allSettled([erp?.close(),db?.close()]);}
const dir=resolve('data/validation');await mkdir(dir,{recursive:true});const file=resolve(dir,`${new Date().toISOString().replace(/[:.]/g,'-')}-expanded-historical-${randomUUID().slice(0,8)}.json`);await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:report.checksStatus,historicalReview:report.historicalReview,reads:report.reads,report:file}));process.exitCode=report.checksStatus==='failed'?2:0;

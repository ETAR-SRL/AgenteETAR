// Catálogos y propuestas reales sin Store, transacciones ni conexión de escritura.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {connect} from '../src/protheus/database.js';
import {Catalog} from '../src/protheus/catalog.js';
import {loadConfig,identifier as q} from '../src/protheus/config.js';
import {createWriter,selection} from '../src/protheus/writer.js';
import {guardOrder,writeProfiles} from '../src/protheus/write-policy.js';

export function selectOnly(db){
 return {query(text,parameters){
  if(!/^\s*SELECT\b/i.test(text)||/;|--|\/\*|\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC(?:UTE)?|INTO|DROP|ALTER|CREATE|TRUNCATE|UPDLOCK|TABLOCKX)\b/i.test(text))throw new Error('READ_ONLY_SELECT_REQUIRED');
  return db.query(text,parameters);
 }};
}
const fields=['C1_EMISSAO','C1_DATPRF','C1_LOCAL','C7_EMISSAO','C7_DATPRF','C7_LOCAL','C7_COND','C6_ENTREG','C6_LOCAL','C5_EMISSAO','C5_CONDPAG','B1_RASTRO','B1_LOCALIZ'];
const parameters=['MV_ESTNEG','MV_LOCALIZ','MV_RASTRO','MV_ALTPED','MV_ALTPREC','MV_BLOQUEI','MV_APROVSC','MV_PCAPROV','MV_ALTEPEDC'];
const increment=(counts,key)=>counts[key]=(counts[key]||0)+1;
const trim=value=>String(value??'').trim();
function nextDate(value){
 const raw=trim(value),iso=/^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`:null;
 const date=new Date((iso||new Date().toISOString().slice(0,10))+'T00:00:00Z');
 if(!Number.isFinite(date.getTime()))return '2030-01-02';
 date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10);
}

export async function auditLogistics({db,catalog,branch='0101',preview=false,limit=250,writer}){
 if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('AUDIT_LIMIT_INVALID');
 const report={version:1,checkedAt:new Date().toISOString(),readOnly:true,businessWrites:0,writeConnectionsOpened:0,storeInitialized:false,proposalsPersisted:0,branch,
  dictionary:fields.map(field=>{const sx=catalog.dictionary.get(field);return {field,available:!!sx,type:sx?.X3_TIPO||null,width:sx?.X3_TAMANHO||null,validator:sx?.X3_VALID||null,lookup:sx?.X3_F3||null};}),catalogs:{},parameters:{},documents:[],previewRequested:preview};
 const active=async(alias,bf,projection,top='')=>db.query(`SELECT ${top} ${projection} FROM ${catalog.name(alias)} WHERE [D_E_L_E_T_]=' ' AND ${q(bf)}=@branch${top?' ORDER BY [R_E_C_N_O_]':''}`,{branch:catalog.branch(alias,branch)});
 const references={};
 for(const [alias,bf,key] of [['NNR','NNR_FILIAL','NNR_CODIGO'],['SE4','E4_FILIAL','E4_CODIGO']]){
  const rows=await active(alias,bf,q(key));references[alias]=rows.map(row=>trim(row[key]));
  report.catalogs[alias]={activeRows:rows.length,nonEmptyCodes:rows.filter(row=>trim(row[key])).length,uniqueCodes:new Set(references[alias]).size};
 }
 const sx6=await db.query(`SELECT [X6_FIL],[X6_VAR],[X6_CONTEUD] FROM ${catalog.name('SX6')} WHERE [D_E_L_E_T_]=' ' AND [X6_FIL] IN (@branch,' ') AND [X6_VAR] IN (${parameters.map((_,i)=>'@p'+i).join(',')})`,{branch,...Object.fromEntries(parameters.map((name,i)=>['p'+i,name]))});
 for(const name of parameters){const matches=sx6.filter(row=>trim(row.X6_VAR)===name),local=matches.filter(row=>trim(row.X6_FIL)===branch),global=matches.filter(row=>!trim(row.X6_FIL));report.parameters[name]={available:matches.length>0,unambiguous:local.length<=1&&global.length<=1,value:local.length<=1&&global.length<=1?trim((local[0]||global[0])?.X6_CONTEUD):null};}
 for(const [alias,action,prefix] of [['SC1','solicitudCompra','C1'],['SC7','pedidoCompra','C7'],['SC6','pedidoVenta','C6']]){
  const [{count}]=await active(alias,prefix+'_FILIAL','COUNT(*) AS count');
  const item={alias,activeRows:Number(count),existingDocumentsAvailable:Number(count)>0,previewedRows:0,complete:false,results:{}};report.documents.push(item);
  if(!item.activeRows){item.complete=preview;item.structuralGuard={checked:0,complete:true,passed:0,rejected:{}};continue;}
  const rows=await active(alias,prefix+'_FILIAL',selection(catalog.table(alias)),'TOP (1001)');
  item.structuralGuard={checked:0,complete:rows.length<=1000,passed:0,rejected:{}};
  for(const row of rows.slice(0,1000)){item.structuralGuard.checked++;try{guardOrder(writeProfiles[action],row);item.structuralGuard.passed++;}catch(error){increment(item.structuralGuard.rejected,error.code||'SOURCE_ERROR');}}
  if(!preview)continue;
  item.complete=item.activeRows<=limit;
  for(const row of rows.slice(0,limit)){
   item.previewedRows++;
   const dueField=alias==='SC6'?'C6_ENTREG':prefix+'_DATPRF';
   const changes={fechaEntrega:nextDate(row[dueField]),fechaEmision:nextDate(row[prefix+'_EMISSAO']),deposito:references.NNR.find(code=>code&&code!==trim(row[prefix+'_LOCAL'])),condicionPago:references.SE4.find(code=>code&&code!==trim(row.C7_COND))};
   if(alias==='SC1')delete changes.condicionPago;
   for(const [field,value] of Object.entries(changes)){
    const counts=item.results[field]??={prepared:0,checked:0,rejected:{}};
    if(!value){increment(counts.rejected,'NO_ALTERNATIVE_CATALOG_REFERENCE');continue;}
    const input={action,target:{sucursal:branch,registro:trim(row.R_E_C_N_O_)},changes:{[field]:value}};
    try{
     const plan=await writer.prepare(action,input);
     if(!plan.diff?.length)throw Object.assign(new Error(),{code:'EMPTY_DIFF'});
     counts.prepared++;
     const checked=await writer.check({action,target:input.target,input,writePlan:plan});
     if(checked.executionEnabled)counts.checked++;
    }catch(error){increment(counts.rejected,error.code||'SOURCE_ERROR');}
   }
  }
 }
 return report;
}

async function main(){
 const connection=await connect(process.env,{writable:false}),db=selectOnly(connection);
 try{
  const config=loadConfig(process.env.ERP_MAPPING_PATH||process.env.CONFIG_PATH),catalog=new Catalog(db,config);await catalog.init();
  const branch=(process.env.ERP_BRANCHES||'0101').split(',')[0];
  const writer=createWriter({db,catalog,enabled:true,allowedBranches:[branch],triggerHashes:config.writeTriggerHashes||{},getWriteDb:()=>{throw new Error('READ_ONLY_NO_WRITE_CONNECTION');}});
  const limitFlag=process.argv.find(arg=>arg.startsWith('--limit='));
  const report=await auditLogistics({db,catalog,branch,writer,preview:process.argv.includes('--preview'),limit:limitFlag?Number(limitFlag.slice(8)):20});
  const destination=resolve('reports/live-logistics-updates-readonly.json');await mkdir(resolve('reports'),{recursive:true});await writeFile(destination,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({readOnly:report.readOnly,businessWrites:0,documents:report.documents,catalogs:report.catalogs,reportWritten:true},null,2));
 }finally{await connection.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({readOnly:true,code:error.code||'AUDIT_FAILED'}));process.exitCode=1;});

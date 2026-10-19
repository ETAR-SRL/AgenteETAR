// Exercises the real SQL schema with configuration overlaid ONLY in memory.
// No business SQL writes, parameter edits, saved proposals or executions.
import {connect} from '../src/protheus/database.js';
import {Catalog} from '../src/protheus/catalog.js';
import {loadConfig,identifier as q} from '../src/protheus/config.js';
import {createWriter} from '../src/protheus/writer.js';
import {readApprovalCatalog} from '../src/protheus/approval-circuit.js';
import {allocateCircuitRecords} from '../src/protheus/purchase-creation.js';
const config=loadConfig(),db=await connect(),catalog=new Catalog(db,config);let lockDb;
try{
 await catalog.init();const branch=(process.env.ERP_BRANCHES||'0101').split(',')[0];
 const table=a=>{const t=catalog.table(a);return `${q(t.schema)}.${q(t.name)}`;};
 const first=async(a,fields,where)=>{const [r]=await db.query(`SELECT TOP (1) ${fields} FROM ${table(a)} WHERE D_E_L_E_T_=' ' AND ${where} ORDER BY R_E_C_N_O_`,{branch:catalog.branch(a,branch)});if(!r)throw Error('Catalog unavailable: '+a);return r;};
 const product=await first('SB1','RTRIM(B1_COD) code',"B1_FILIAL=@branch AND B1_UM='UN' AND B1_MSBLQL<>'1' AND B1_GRADE<>'S'");
 const warehouse=await first('NNR','RTRIM(NNR_CODIGO) code','NNR_FILIAL=@branch'),vendor=await first('SA2','RTRIM(A2_COD) code,RTRIM(A2_LOJA) store',"A2_FILIAL=@branch AND A2_MSBLQL<>'1'"),payment=await first('SE4','RTRIM(E4_CODIGO) code','E4_FILIAL=@branch');
 const sal=await readApprovalCatalog(db,catalog,'SAL',branch,false);if(!sal.length)throw Error('No SAL for schema exercise');
 const group=sal[0].AL_COD.trim(),results=[];
 for(const scenario of ['PC','SC','IP','IP+PC','superior']){
  const entity=!['PC','superior'].includes(scenario),alias=scenario==='SC'?'SC1':'SC7',action=alias==='SC1'?'crearSolicitudCompra':'crearPedidoCompra';
  const overridden={MV_APROVSC:['L','F'],MV_APRSCEC:['L',scenario==='SC'?'T':'F'],MV_RESTSOL:['C','N'],MV_APRPCEC:['L',['IP','IP+PC'].includes(scenario)?'T':'F'],MV_PCAPROV:['C',entity&&scenario!=='IP+PC'?'':group],MV_ALTPDOC:['L','T'],MV_PERFALC:['C','1'],MV_APGRDFL:['C',group+';01'],MV_IPAPREC:['L','F'],MV_APRIPPC:['C',scenario==='IP+PC'?'1':'2']};
  let simulatedRows=null;
  const overlay={query:async(sql,params)=>{
   if(!sql.startsWith('SELECT '))throw Error('ONLY_SELECT');
   if(simulatedRows&&params?.number){for(const a of [alias,'SCR','DBM'])if(sql.includes('FROM '+table(a)))return (simulatedRows[a]||[]).filter(r=>!params.type||r.CR_TIPO===params.type);}
   if(sql.includes('FROM '+table('SX6')))return Object.entries(overridden).filter(([k])=>Object.values(params).includes(k)).map(([X6_VAR,[X6_TIPO,X6_CONTEUD]])=>({X6_FIL:' ',X6_VAR,X6_TIPO,X6_CONTEUD}));
   if(sql.includes('FROM '+table('SAL')))return sal.filter(r=>r.AL_COD.trim()===group).map(r=>({...r,AL_DOCPC:'T',AL_DOCSC:'T',AL_DOCIP:'T'}));
   if(scenario==='superior'&&sql.includes('FROM '+table('SAK'))){const rows=await db.query(sql,params);const first=rows.find(r=>r.AK_COD.trim()===sal[0].AL_APROV.trim());if(!first)throw Error('No approver');return rows.map(r=>r===first?{...r,AK_APROSUP:'SIMSUP'}:r).concat([{...first,AK_COD:'SIMSUP',AK_USER:'SIMUSR',AK_APROSUP:''}]);}
   if(sql.includes('FROM '+table('DBL')))return [{DBL_GRUPO:group,DBL_ITEM:'01',DBL_CC:'',DBL_CONTA:'',DBL_ITEMCT:'',DBL_CLVL:''}];
   return db.query(sql,params);
  }};
  const writer=createWriter({db:overlay,catalog,enabled:true,allowedBranches:[branch],triggerHashes:config.writeTriggerHashes,getWriteDb:()=>{throw Error('NO_BUSINESS_WRITES');}});
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const input={action,target:{sucursal:branch},header:{fechaEmision:date,moneda:'1',...(alias==='SC1'?{solicitante:'Prueba sin escritura'}:{proveedor:vendor.code,tienda:vendor.store,condicionPago:payment.code})},items:[{producto:product.code,deposito:warehouse.code,fechaNecesidad:date,cantidad:'1',precio:'100',baseCantidad:'millares',basePrecio:'millar',centroCosto:''}]};
  const plan=await writer.prepare(action,input);
  if(!plan.executionEnabled||!plan.circuits.length)throw Error(JSON.stringify({scenario,blockers:plan.blockers}));
  let workflowPrepared=false;
  if(['IP+PC','superior'].includes(scenario)){
   const materialize=(row,initials,i,prefix)=>Object.fromEntries(Object.entries({...initials,...row,R_E_C_N_O_:String(i+1),[prefix+'_NUM']:'000001'}).map(([k,v])=>[k,v?.generatedTime?'2026-10-19T12:00:00':v]));
   simulatedRows={[alias]:plan.rows.map((r,i)=>materialize(r,plan.initials[i],i,alias==='SC1'?'C1':'C7')),SCR:[],DBM:[]};
   for(const c of plan.circuits)simulatedRows[c.alias]=c.rows.map((r,i)=>materialize(r,c.initials[i],i,c.alias==='SCR'?'CR':'DBM'));
   if(scenario==='IP+PC'){
    for(const r of simulatedRows.SCR){r.CR_STATUS='03';r.CR_DATALIB='20261019';r.CR_USERLIB=r.CR_USER;}
    for(const r of simulatedRows.DBM)r.DBM_APROV='1';
   }
   const transition=scenario==='IP+PC'?'continuarAprobacionCompra':'escalarAprobacionCompra';
   const workflow=await writer.prepare(transition,{action:transition,target:{sucursal:branch,registro:'1'},source:{action,input,writePlan:plan,result:{number:'000001',records:simulatedRows[alias].map(r=>r.R_E_C_N_O_)}}});
   if(!workflow.executionEnabled)throw Error('Workflow preview disabled');workflowPrepared=true;
  }
  results.push({scenario,workflowPrepared,executionEnabled:plan.executionEnabled,status:plan.approval.status,deferred:plan.approval.circuit.deferred.length,superiors:plan.approval.circuit.entries.reduce((n,e)=>n+e.superiores.length,0),circuits:plan.circuits.map(c=>({table:c.alias,rows:c.rows.length,defaultsChecked:Object.keys(c.initials[0]).length}))});
 }
 lockDb=await connect(process.env,{writable:true});const insertPermissions=[];
 await lockDb.transaction(async tx=>{
  const readOnly={query:(sql,params)=>{if(!sql.startsWith('SELECT '))throw Error('ONLY_SELECT');return tx.query(sql,params);}};
  for(const a of ['SCR','DBM']){
   await allocateCircuitRecords(readOnly,catalog.table(a),1);
   const [permission]=await readOnly.query("SELECT HAS_PERMS_BY_NAME(@tableName,'OBJECT','INSERT') permitted,HAS_PERMS_BY_NAME(@tableName,'OBJECT','UPDATE') updatePermitted",{tableName:`${catalog.table(a).schema}.${catalog.table(a).name}`});
   insertPermissions.push({table:a,permitted:permission.permitted===1,updatePermitted:permission.updatePermitted===1});
  }
 });
 console.log(JSON.stringify({businessWrites:0,configurationWrites:0,simulatedConfiguration:true,nativeReleaseTested:false,allocationSelectVerified:true,insertPermissions,results},null,2));
}finally{await db.close();await lockDb?.close();}

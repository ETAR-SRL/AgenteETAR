// SELECT + preview only. No write pool, execution, proposals saved or business data printed.
import Decimal from 'decimal.js';
import {connect} from '../src/protheus/database.js';
import {Catalog} from '../src/protheus/catalog.js';
import {loadConfig,identifier as q} from '../src/protheus/config.js';
import {createWriter} from '../src/protheus/writer.js';
const config=loadConfig(),db=await connect(),catalog=new Catalog(db,config);
try{
 await catalog.init();const branch=(process.env.ERP_BRANCHES||'0101').split(',')[0];
 const writer=createWriter({db,catalog,enabled:process.env.ERP_WRITE_ENABLED==='true',allowedBranches:[branch],triggerHashes:config.writeTriggerHashes,getWriteDb:()=>{throw new Error('READ_ONLY_CHECK');}});
 const table=alias=>{const t=catalog.table(alias);return `${q(t.schema)}.${q(t.name)}`;};
 const candidates=await db.query(`SELECT TOP (25) CONVERT(varchar(30),c.R_E_C_N_O_) record,CONVERT(varchar(100),C6_PRCVEN,3) price,CASE WHEN C6_QTDENT>0 THEN 'partial' ELSE 'released' END state FROM ${table('SC6')} c WHERE c.D_E_L_E_T_=' ' AND C6_FILIAL=@salesBranch AND C6_QTDVEN>C6_QTDENT AND (C6_QTDENT>0 OR EXISTS (SELECT 1 FROM ${table('SC9')} r WHERE r.D_E_L_E_T_=' ' AND C9_FILIAL=@releaseBranch AND C9_PEDIDO=C6_NUM AND C9_ITEM=C6_ITEM)) ORDER BY c.R_E_C_N_O_`,{salesBranch:catalog.branch('SC6',branch),releaseBranch:catalog.branch('SC9',branch)});
 const results=[];
 for(const row of candidates){
  try{const plan=await writer.prepare('pedidoVenta',{target:{sucursal:branch,registro:row.record},changes:{precioUnitario:new Decimal(row.price).toDecimalPlaces(4).plus('0.0001').toFixed()},priceUnit:'unidad'});
   results.push({state:row.state,status:'prepared',executionEnabled:plan.executionEnabled,blockers:plan.blockers.map(b=>b.code),fields:[...new Set(plan.diff.map(d=>d.field))]});
  }catch(error){results.push({state:row.state,status:'rejected',code:error.code||'SOURCE_ERROR'});}
 }
 console.log(JSON.stringify({readOnly:true,erpUpdates:0,sampled:candidates.length,results},null,2));
}finally{await db.close();}

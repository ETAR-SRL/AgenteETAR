// Real catalog + preparation + a short allocation SELECT under transaction; never INSERT.
import {connect} from '../src/protheus/database.js';
import {Catalog} from '../src/protheus/catalog.js';
import {loadConfig,identifier as q} from '../src/protheus/config.js';
import {createWriter} from '../src/protheus/writer.js';
import {allocatePurchaseNumbers} from '../src/protheus/purchase-creation.js';
const config=loadConfig(),db=await connect(),catalog=new Catalog(db,config);let lockDb;
try{
 await catalog.init();const branch=(process.env.ERP_BRANCHES||'0101').split(',')[0];
 const table=a=>{const t=catalog.table(a);return `${q(t.schema)}.${q(t.name)}`;};
 const first=async(alias,fields,where)=>{const rows=await db.query(`SELECT TOP (1) ${fields} FROM ${table(alias)} WHERE D_E_L_E_T_=' ' AND ${where} ORDER BY R_E_C_N_O_`,{branch:catalog.branch(alias,branch)});if(!rows.length)throw new Error('No hay catálogo de prueba: '+alias);return rows[0];};
 const product=await first('SB1','RTRIM(B1_COD) code',"B1_FILIAL=@branch AND B1_UM='UN' AND B1_MSBLQL<>'1' AND B1_GRADE<>'S'");
 const warehouse=await first('NNR','RTRIM(NNR_CODIGO) code','NNR_FILIAL=@branch');
 const vendor=await first('SA2','RTRIM(A2_COD) code,RTRIM(A2_LOJA) store',"A2_FILIAL=@branch AND A2_MSBLQL<>'1'");
 const payment=await first('SE4','RTRIM(E4_CODIGO) code','E4_FILIAL=@branch');
 const writer=createWriter({db,catalog,enabled:true,allowedBranches:[branch],triggerHashes:config.writeTriggerHashes,getWriteDb:()=>{throw new Error('NO_BUSINESS_WRITES');}});
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const results=[];
 for(const [action,alias] of [['crearSolicitudCompra','SC1'],['crearPedidoCompra','SC7']]){
  const input={action,target:{sucursal:branch},header:{fechaEmision:date,moneda:'1',...(alias==='SC1'?{solicitante:'Preparación de prueba'}:{proveedor:vendor.code,tienda:vendor.store,condicionPago:payment.code})},items:[{producto:product.code,deposito:warehouse.code,fechaNecesidad:date,cantidad:'1',precio:'100',baseCantidad:'millares',basePrecio:'millar'}]};
  const plan=await writer.prepare(action,input);results.push({alias,prepared:true,executionEnabled:plan.executionEnabled,defaultsChecked:Object.keys(plan.initials[0]).length});
 }
 lockDb=await connect(process.env,{writable:true});
 for(const [alias,prefix] of [['SC1','C1'],['SC7','C7']]){
  await lockDb.transaction(tx=>allocatePurchaseNumbers({query:(sql,params)=>{if(!sql.startsWith('SELECT '))throw new Error('ONLY_SELECT');return tx.query(sql,params);}},catalog.table(alias),prefix+'_NUM',Number(catalog.dictionary.get(prefix+'_NUM').X3_TAMANHO),1));
 }
 console.log(JSON.stringify({businessWrites:0,previewsSaved:0,allocationSelectVerified:true,results},null,2));
}finally{await db.close();await lockDb?.close();}

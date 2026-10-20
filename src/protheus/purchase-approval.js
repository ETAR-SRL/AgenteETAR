import {assert} from '../errors.js';
import {identifier as q} from './config.js';
import {clean} from './write-policy.js';
import {readApprovalCatalog,buildApprovalCircuit,buildSimpleRequestApproval} from './approval-circuit.js';
const name=t=>`${q(t.schema)}.${q(t.name)}`;
const requiredFields=(table,fields)=>{
 for(const field of fields)assert(table.columns.has(field),409,'APROBACION_NO_VERIFICABLE',`Falta ${field} para verificar la aprobación`);
};
// SX6 is scoped by the requested logical branch, then the blank global scope.
// Missing, duplicated, mistyped and empty logical values are not equivalent to false.
export function resolveApprovalParameters(rows,branch,spec){
 const values={},parameters=[],blockers=[];
 for(const [key,type] of Object.entries(spec)){
  const candidates=rows.filter(r=>clean(r.X6_VAR)===key&&['',branch].includes(clean(r.X6_FIL)));
  const local=candidates.filter(r=>clean(r.X6_FIL)===branch),global=candidates.filter(r=>clean(r.X6_FIL)==='');
  const selected=local.length?local:global;
  const row=selected[0],value=clean(row?.X6_CONTEUD),validType=clean(row?.X6_TIPO)===type;
  const logical=type==='L'&&/^(?:\.T\.|T|\.F\.|F)$/i.test(value);
  if(local.length>1||global.length>1||selected.length!==1||!validType||typeof row?.X6_CONTEUD!=='string'||(type==='L'&&!logical)){
   blockers.push({code:'APROBACION_NO_VERIFICABLE',message:`${key}: configuración ausente, duplicada o inválida. No se puede decidir la aprobación.`});
  }else values[key]=type==='L'?/^(?:\.T\.|T)$/i.test(value):value;
  parameters.push({parametro:key,filial:row?clean(row.X6_FIL):null,tipo:row?clean(row.X6_TIPO):null,valor:row?value:null});
 }
 return {values,parameters,blockers};
}
export async function purchaseApproval({connection,catalog,alias,branch,buyerCode='',requester='',items=[],exchangeRate='1',lock=false}){
 const spec=alias==='SC1'?{MV_APROVSC:'L',MV_APRSCEC:'L',MV_RESTSOL:'C'}:{MV_APRPCEC:'L',MV_PCAPROV:'C',MV_ALTPDOC:'L'};
 const sx6=catalog.table('SX6');requiredFields(sx6,['X6_FIL','X6_VAR','X6_TIPO','X6_CONTEUD','D_E_L_E_T_']);
 const values={},parameters=[],blockers=[],evidence={parameters:[],catalogs:{}};
 async function parametersFor(spec){
  const params={branch},keys=Object.keys(spec);keys.forEach((key,i)=>params['key'+i]=key);
  const rows=await connection.query(`SELECT [X6_FIL],[X6_VAR],[X6_TIPO],[X6_CONTEUD] FROM ${name(sx6)}${lock?' WITH (UPDLOCK,HOLDLOCK)':''} WHERE [D_E_L_E_T_]=' ' AND [X6_FIL] IN (@branch,' ') AND [X6_VAR] IN (${keys.map((_,i)=>'@key'+i).join(',')}) ORDER BY [X6_VAR],[X6_FIL]`,params);
  const resolved=resolveApprovalParameters(rows,branch,spec);Object.assign(values,resolved.values);parameters.push(...resolved.parameters);blockers.push(...resolved.blockers);evidence.parameters.push(...rows);
 }
 await parametersFor(spec);
 const reasons=[],field=alias==='SC1'?'C1_APROV':'C7_CONAPRO';let group='',buyer=null;
 if(alias==='SC1'){
  if(values.MV_APRSCEC)reasons.push('MV_APRSCEC activa alçadas por entidades contables.');
  if(values.MV_RESTSOL!==undefined&&!['S','N'].includes(values.MV_RESTSOL))blockers.push({code:'APROBACION_NO_VERIFICABLE',message:'MV_RESTSOL debe ser S o N.'});
 }else{
  const sy1=catalog.table('SY1');requiredFields(sy1,['Y1_FILIAL','Y1_COD','Y1_GRAPROV','Y1_PEDIDO','D_E_L_E_T_','R_E_C_N_O_']);
  const buyers=await connection.query(`SELECT TOP (1001) [Y1_COD],[Y1_GRAPROV],[Y1_PEDIDO] FROM ${name(sy1)}${lock?' WITH (UPDLOCK,HOLDLOCK)':''} WHERE [D_E_L_E_T_]=' ' AND [Y1_FILIAL]=@branch ORDER BY [Y1_COD],[R_E_C_N_O_]`,{branch:catalog.branch('SY1',branch)});
  assert(buyers.length<=1000,409,'APROBACION_NO_VERIFICABLE','Acotar el catálogo de compradores antes de decidir la aprobación');
  evidence.buyers=buyers;
  if(buyers.some(r=>typeof r.Y1_GRAPROV!=='string'||!clean(r.Y1_COD)))blockers.push({code:'APROBACION_NO_VERIFICABLE',message:'Catálogo de compradores incompleto: código o grupo no verificable.'});
  if(buyerCode){
   const matches=buyers.filter(r=>clean(r.Y1_COD)===buyerCode);
   assert(matches.length===1,409,'COMPRADOR_NO_UNICO','Comprador inexistente o ambiguo en la filial');
   buyer={codigo:buyerCode,grupo:clean(matches[0].Y1_GRAPROV),pedidoSinSolicitud:clean(matches[0].Y1_PEDIDO)};
   if(buyer.pedidoSinSolicitud==='2')blockers.push({code:'COMPRADOR_REQUIERE_SOLICITUD',message:'Este comprador exige un pedido vinculado a una solicitud. El alta SQL crea pedidos independientes.'});
   else if(!['','1'].includes(buyer.pedidoSinSolicitud))blockers.push({code:'APROBACION_NO_VERIFICABLE',message:'Y1_PEDIDO del comprador tiene un valor no reconocido.'});
  }else if(buyers.some(r=>clean(r.Y1_GRAPROV))){
   blockers.push({code:'COMPRADOR_REQUERIDO',message:'Hay compradores con grupos de aprobación. Indicá el comprador para resolver su grupo; no se asume el usuario Protheus de esta sesión.'});
  }
  group=buyer?.grupo||values.MV_PCAPROV||'';
  if(group)reasons.push(`Grupo de aprobación ${group}, origen ${buyer?.grupo?'SY1.Y1_GRAPROV':'MV_PCAPROV'}.`);
  if(values.MV_APRPCEC)reasons.push('MV_APRPCEC activa alçadas por entidades contables.');
 }
 const entity=alias==='SC1'?values.MV_APRSCEC:values.MV_APRPCEC;
 if(entity)await parametersFor({MV_APGRDFL:'C',MV_PERFALC:'C',...(alias==='SC1'?{MV_ALTPDOC:'L'}:{MV_IPAPREC:'L',MV_APRIPPC:'C'})});
 if(alias==='SC1'&&values.MV_RESTSOL==='S')await parametersFor({MV_CHKSOLI:'L',MV_RESTSCC:'L'});
 let circuit={entries:[],excluded:[],routes:[],itemStates:Object.fromEntries(items.map(i=>[i.item,'L'])),status:'L',entity:false};
 // Configuration errors are reviewable proposals. SQL/connection failures still propagate.
 if(!blockers.length)try{
  const load=async aliases=>{for(const a of aliases)evidence.catalogs[a]=await readApprovalCatalog(connection,catalog,a,branch,lock);return evidence.catalogs;};
  if(alias==='SC1'&&values.MV_RESTSOL==='S'){
   const rights=buildSimpleRequestApproval({items,requester,rows:(await load(['SAI'])).SAI,values:{...values,MV_APROVSC:!entity&&values.MV_APROVSC}});
   if(!entity)circuit=rights;
  }
  if(entity||group)circuit=buildApprovalCircuit({alias,group,values,items,exchangeRate,catalogs:await load(['SAL','SAK','DHL','DHM',...(entity?['DBL']:[])])});
 }catch(error){
  if(!['CIRCUITO_INVALIDO','CIRCUITO_ESQUEMA','CIRCUITO_EXCEDIDO','TABLA_NO_DISPONIBLE','SUCURSAL_CONFIGURACION'].includes(error.code))throw error;
  blockers.push({code:error.code,message:error.message});
 }
 const clear=!blockers.length,status=clear?circuit.status:null;
 const mode=!clear?'requiere-validacion':circuit.entries.length?'circuito-pendiente':status==='B'?'aprobacion-simple':'sin-aprobacion-requerida';
 const label=!clear?'Alta sin habilitar — revisar configuración':circuit.entries.length?`B — se generarán ${circuit.entries.length} pasos de aprobación en Protheus`:status==='B'?'B — pendiente de liberación simple en MATA110':'L — sin aprobación requerida por la configuración verificada';
 return {field,status,mode,label,group,buyer,parameters,reasons,blockers,circuit,evidence};
}

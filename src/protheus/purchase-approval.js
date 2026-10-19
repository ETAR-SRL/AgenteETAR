import {assert} from '../errors.js';
import {identifier as q} from './config.js';
import {clean} from './write-policy.js';

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

export async function purchaseApproval({connection,catalog,alias,branch,buyerCode='',lock=false}){
 const spec=alias==='SC1'?{MV_APROVSC:'L',MV_APRSCEC:'L',MV_RESTSOL:'C'}:{MV_APRPCEC:'L',MV_PCAPROV:'C',MV_ALTPDOC:'L'};
 const sx6=catalog.table('SX6');requiredFields(sx6,['X6_FIL','X6_VAR','X6_TIPO','X6_CONTEUD','D_E_L_E_T_']);
 const params={branch},keys=Object.keys(spec);keys.forEach((key,i)=>params['key'+i]=key);
 const rows=await connection.query(`SELECT [X6_FIL],[X6_VAR],[X6_TIPO],[X6_CONTEUD] FROM ${name(sx6)}${lock?' WITH (UPDLOCK,HOLDLOCK)':''} WHERE [D_E_L_E_T_]=' ' AND [X6_FIL] IN (@branch,' ') AND [X6_VAR] IN (${keys.map((_,i)=>'@key'+i).join(',')}) ORDER BY [X6_VAR],[X6_FIL]`,params);
 const {values,parameters,blockers}=resolveApprovalParameters(rows,branch,spec);
 const reasons=[],evidence={parameters:rows},field=alias==='SC1'?'C1_APROV':'C7_CONAPRO';let group='',buyer=null;
 if(alias==='SC1'){
  if(values.MV_APROVSC)reasons.push('MV_APROVSC activa la aprobación de solicitudes.');
  if(values.MV_APRSCEC)reasons.push('MV_APRSCEC activa alçadas por entidades contables.');
  if(values.MV_RESTSOL!==undefined&&!['S','N'].includes(values.MV_RESTSOL))blockers.push({code:'APROBACION_NO_VERIFICABLE',message:'MV_RESTSOL debe ser S o N.'});
  if(values.MV_RESTSOL==='S')blockers.push({code:'RESTRICCION_SOLICITANTE_NO_SOPORTADA',message:'MV_RESTSOL exige validar productos/grupos del solicitante. Ese control no está implementado en las altas SQL.'});
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
 // A group/active circuit needs profiles, ranges, levels and SCR generation. B alone
 // is not a workflow, so these proposals cannot INSERT or silently release in L.
 if(reasons.length)blockers.push({code:'ALCADA_SQL_NO_IMPLEMENTADA',message:reasons.join(' ')+' Las reglas y la generación del circuito de aprobación no están implementadas por SQL. Esta propuesta no crea el documento.'});
 const clear=!blockers.length;
 return {field,status:clear?'L':null,mode:clear?'sin-aprobacion-requerida':'requiere-validacion',label:clear?'L — sin aprobación requerida por la configuración verificada':'Alta sin habilitar — revisar circuito de aprobación',group,buyer,parameters,reasons:clear?[alias==='SC1'?'MV_APROVSC y MV_APRSCEC desactivados; MV_RESTSOL=N.':'MV_APRPCEC desactivado; sin grupo aplicable en comprador ni MV_PCAPROV.']:reasons,blockers,evidence};
}

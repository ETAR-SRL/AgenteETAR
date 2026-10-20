import {assert} from '../errors.js';
import {identifier as q} from './config.js';
import {clean,sourceNumber} from './write-policy.js';

const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
export function purchaseCurrency(value){
 const n=norm(value);
 if(['ARS','PESO','PESOS'].includes(n))return 'ARS';
 if(['USD','DOLAR','DOLARES','US$','U$S'].includes(n))return 'USD';
 if(/^[1-5]$/.test(n))return n;
 return '';
}
// Currency numbers are environment configuration, not ISO codes. Never assume USD=2.
export async function resolvePurchaseCurrency({connection,catalog,branch,date,currency,lock=false}){
 const requested=purchaseCurrency(currency);
 assert(requested,400,'MONEDA_NO_SOPORTADA','Indicá pesos, dólares o el código de moneda configurado en Protheus.');
 const sx6=catalog.table('SX6'),hint=lock?' WITH (UPDLOCK,HOLDLOCK)':'';
 const keys=Array.from({length:5},(_,i)=>'MV_MOEDA'+(i+1));
 const rows=await connection.query(`SELECT [X6_FIL],[X6_VAR],[X6_TIPO],[X6_CONTEUD] FROM ${q(sx6.schema)}.${q(sx6.name)}${hint} WHERE [D_E_L_E_T_]=' ' AND [X6_FIL] IN (@branch,' ') AND [X6_VAR] IN (${keys.map((_,i)=>'@key'+i).join(',')}) ORDER BY [X6_VAR],[X6_FIL]`,{branch,...Object.fromEntries(keys.map((k,i)=>['key'+i,k]))});
 const configured=keys.map((key,i)=>{
  const all=rows.filter(r=>clean(r.X6_VAR)===key),local=all.filter(r=>clean(r.X6_FIL)===branch),global=all.filter(r=>!clean(r.X6_FIL));
  assert(local.length<=1&&global.length<=1,409,'MONEDA_AMBIGUA',`Configuración duplicada: ${key}`);
  const row=(local.length?local:global)[0];
  assert(!row||clean(row.X6_TIPO)==='C',409,'MONEDA_INVALIDA',`Configuración inválida: ${key}`);
  return {code:String(i+1),name:clean(row?.X6_CONTEUD)};
 });
 const candidates=configured.filter(c=>/^[1-5]$/.test(requested)?c.code===requested:purchaseCurrency(c.name)===requested);
 assert(candidates.length===1&&candidates[0].name,409,'MONEDA_AMBIGUA','No se identificó una moneda única en MV_MOEDA1…5.');
 const selected=candidates[0],local=configured[0];
 assert(local.name,409,'MONEDA_INVALIDA','Falta MV_MOEDA1.');
 const result={codigo:selected.code,descripcion:selected.name,fecha:date,tipoCambio:'1',monedaLocal:local.name,origen:'MV_MOEDA1',evidence:{parameters:rows}};
 if(selected.code==='1')return result;
 assert(purchaseCurrency(selected.name)==='USD',400,'MONEDA_NO_SOPORTADA','Las altas admiten moneda local y el dólar configurado en Protheus.');
 const table=catalog.table('SM2'),field='M2_MOEDA'+selected.code;
 for(const f of ['M2_DATA',field,'D_E_L_E_T_','R_E_C_N_O_'])assert(table.columns.has(f),409,'COTIZACION_ESQUEMA',`Falta SM2.${f}`);
 const physicalBranch=catalog.branch('SM2',branch),hasBranch=table.columns.has('M2_FILIAL');
 assert(hasBranch||physicalBranch==='',409,'COTIZACION_ESQUEMA','SM2 sin filial requiere configuración compartida explícita.');
 const rates=await connection.query(`SELECT CONVERT(varchar(30),[R_E_C_N_O_]) AS registro,[M2_DATA] AS fecha,CONVERT(varchar(100),${q(field)},3) AS tasa FROM ${q(table.schema)}.${q(table.name)}${hint} WHERE [D_E_L_E_T_]=' ' AND [M2_DATA]=@date${hasBranch?' AND [M2_FILIAL]=@physicalBranch':''}`,{date:date.replaceAll('-',''),...(hasBranch?{physicalBranch}:{})});
 assert(rates.length===1,409,'COTIZACION_NO_UNICA',`Falta una cotización única de ${selected.name} en SM2 para ${date}. Cargala en Protheus o indicá otra fecha de emisión; no se toma una cotización de otro día.`);
 const rate=sourceNumber(rates[0].tasa,field);
 assert(rate.gt(0),409,'COTIZACION_INVALIDA','La cotización de Protheus debe ser mayor que cero.');
 return {...result,tipoCambio:rate.toFixed(),origen:`SM2.${field}`,evidence:{parameters:rows,rates,physicalBranch,table:`${table.schema}.${table.name}`}};
}

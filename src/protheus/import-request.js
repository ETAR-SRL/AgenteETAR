import {assert} from '../errors.js';
import {identifier as q} from './config.js';
import {clean} from './write-policy.js';
import {resolveApprovalParameters} from './purchase-approval.js';

// MATA113 (SI) and MATA110 (SC) share SC1, but are different business documents.
// SI uses its own simple approval switch; it must not inherit the SC SCR/DBM circuit.
export async function importRequestPolicy({connection,catalog,branch,items,lock=false}){
 const sx6=catalog.table('SX6'),hint=lock?' WITH (UPDLOCK,HOLDLOCK)':'';
 const spec={MV_COMPINT:'L',MV_EASY:'C',MV_APROVSI:'L'},keys=Object.keys(spec);
 const rows=await connection.query(`SELECT [X6_FIL],[X6_VAR],[X6_TIPO],[X6_CONTEUD] FROM ${q(sx6.schema)}.${q(sx6.name)}${hint} WHERE [D_E_L_E_T_]=' ' AND [X6_FIL] IN (@branch,' ') AND [X6_VAR] IN (${keys.map((_,i)=>'@key'+i).join(',')}) ORDER BY [X6_VAR],[X6_FIL]`,{branch,...Object.fromEntries(keys.map((k,i)=>['key'+i,k]))});
 const {values,parameters,blockers}=resolveApprovalParameters(rows,branch,spec);
 assert(!blockers.length,409,'IMPORTACION_CONFIGURACION',blockers.map(b=>b.message).join(' '));
 assert(values.MV_COMPINT===true&&values.MV_EASY==='N',409,'IMPORTACION_DESHABILITADA','La solicitud de importación requiere MV_COMPINT activo y MV_EASY=N en Protheus.');
 const sx7=catalog.table('SX7');
 for(const field of ['X7_CAMPO','X7_REGRA','X7_CDOMIN','X7_CONDIC','D_E_L_E_T_'])assert(sx7.columns.has(field),409,'IMPORTACION_ESQUEMA',`Falta SX7.${field}`);
 const rules=await connection.query(`SELECT [X7_CAMPO],[X7_REGRA],[X7_CDOMIN],[X7_CONDIC] FROM ${q(sx7.schema)}.${q(sx7.name)}${hint} WHERE [D_E_L_E_T_]=' ' AND [X7_CAMPO]='C1_PRECO' AND [X7_CDOMIN]='C1_TOTAL'`);
 // Validate the known rule, never evaluate dictionary code as JavaScript/SQL.
 const expected='M->C1_TOTAL:=NOROUND(M->C1_PRECO*M->C1_QUANT,TAMSX3("C1_TOTAL")[2])';
 assert(rules.length===1&&!clean(rules[0].X7_CONDIC)&&clean(rules[0].X7_REGRA).replace(/\s+/g,'').toUpperCase()===expected,409,'IMPORTACION_REGLA_NO_VERIFICADA','La regla SX7 de C1_PRECO → C1_TOTAL cambió o no es única. Revisar antes de crear.');
 const status=values.MV_APROVSI?'B':'L';
 return {field:'C1_APROV',status,mode:status==='B'?'aprobacion-importacion':'sin-aprobacion-requerida',
  label:status==='B'?'B — pendiente de aprobación de la solicitud de importación en MATA113':'L — MV_APROVSI no exige aprobación de la solicitud de importación',
  group:'',buyer:null,parameters,reasons:['Solicitud de importación (SI): MV_APROVSI. No utiliza el circuito SC por entidades contables.'],
  blockers:[],circuit:{type:'SI',entity:false,entries:[],excluded:[],routes:[],itemStates:Object.fromEntries(items.map(i=>[i.item,status])),status},
  evidence:{parameters:rows,rules}};
}

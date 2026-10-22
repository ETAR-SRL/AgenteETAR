import {assert} from '../errors.js';
import {identifier as q} from './config.js';
import {clean,logisticsFields,logisticsValue,textSpec,numericSpec} from './write-policy.js';
const name=t=>`${q(t.schema)}.${q(t.name)}`;
export const documentKeys=new Set(['fechaEmision','condicionPago']);
export function logisticsMapping(alias,changes){
 if(alias==='SC1'&&Object.hasOwn(changes,'condicionPago'))assert(false,400,'CONDICION_PAGO_NO_APLICA','SC1 no tiene condición de pago estándar; seleccionar un pedido SC7 existente.');
 return Object.entries(changes).filter(([key])=>Object.hasOwn(logisticsFields[alias]||{},key)).map(([key,value])=>({key,value,alias:logisticsFields[alias][key][0],field:logisticsFields[alias][key][1]}));
}
export async function logisticsMetadata(connection,catalog,mapping,lock){
 const requested=new Map();
 for(const m of mapping){if(!requested.has(m.alias))requested.set(m.alias,new Set());requested.get(m.alias).add(m.field);}
 const metadata=[];
 for(const [alias,fields] of requested){
  const table=catalog.table(alias),params={tableName:`${table.schema}.${table.name}`,alias};
  const cols=await connection.query('SELECT c.name field,ty.name type,c.max_length width,c.precision,c.scale,c.is_computed computed FROM sys.columns c JOIN sys.types ty ON c.user_type_id=ty.user_type_id WHERE c.object_id=OBJECT_ID(@tableName) ORDER BY c.column_id',params);
  const dictionary=await connection.query(`SELECT X3_CAMPO,X3_TIPO,X3_TAMANHO,X3_DECIMAL,X3_VALID,X3_F3 FROM ${name(catalog.table('SX3'))}${lock?' WITH (UPDLOCK,HOLDLOCK)':''} WHERE X3_ARQUIVO=@alias AND D_E_L_E_T_=' ' ORDER BY X3_CAMPO`,{alias});
  for(const field of fields){
   const date=mapping.some(m=>m.field===field&&m.key.startsWith('fecha')),numeric=catalog.dictionary.get(field)?.X3_TIPO==='N';const {width}=numeric?numericSpec(field,catalog,alias):textSpec(field,catalog,alias,date);
   const live=cols.filter(c=>clean(c.field)===field),sx=dictionary.filter(d=>clean(d.X3_CAMPO)===field),cached=catalog.dictionary.get(field),physical=table.columns.get(field);
   assert(live.length===1&&sx.length===1,409,'METADATOS_NO_VERIFICABLES',field);
   assert(!live[0].computed&&clean(live[0].type)===physical.type&&(numeric||Number(live[0].width)>=(['nchar','nvarchar'].includes(physical.type)?2:1)*width),409,'ESQUEMA_CAMBIO',field);
   if(numeric&&['decimal','numeric'].includes(physical.type))assert(Number(live[0].precision)===Number(physical.precision)&&Number(live[0].scale)===Number(physical.scale),409,'ESQUEMA_CAMBIO',field);
   for(const key of ['X3_TIPO','X3_TAMANHO','X3_DECIMAL','X3_VALID','X3_F3'])assert(clean(sx[0][key])===clean(cached[key]),409,'DICCIONARIO_CAMBIO',`${field}: recargar tras cambio SX3`);
   metadata.push({alias,field,column:live[0],dictionary:sx[0]});
  }
 }
 return metadata;
}
export function logisticsPlan(mapping,input,c,catalog){
 const updates={},relatedUpdates=[],diff=[];
 const contexts=[c,...(c.documentContexts||[])],documentScope=contexts.map(x=>({alias:x.p.alias,record:clean(x.row.R_E_C_N_O_),numero:clean(x.row[({SC1:'C1',SC6:'C6',SC7:'C7'})[x.p.alias]+'_NUM']),item:clean(x.row[({SC1:'C1',SC6:'C6',SC7:'C7'})[x.p.alias]+'_ITEM']),producto:clean(x.row[x.p.product])}));
 function add(alias,row,field,after,branch){
  if(clean(row[field])===after)return;
  const record=clean(row.R_E_C_N_O_);diff.push({field,before:row[field],after,table:alias,record});
  if(alias===c.p.alias&&record===clean(c.row.R_E_C_N_O_))updates[field]=after;
  else {let update=relatedUpdates.find(u=>u.alias===alias&&u.record===record);if(!update){update={alias,record,branch,updates:{}};relatedUpdates.push(update);}update.updates[field]=after;}
 }
 for(const m of mapping){
  const value=logisticsValue(m.value,m.field,catalog,m.alias,m.key.startsWith('fecha'));
  if(m.alias==='SC5')add('SC5',c.header,m.field,value,catalog.branch('SC5',input.target.sucursal));
  else for(const x of documentKeys.has(m.key)?contexts:[c])add(m.alias,x.row,m.field,value,catalog.branch(m.alias,input.target.sucursal));
 }
 // Validate every final emission/delivery pair, including unchanged sibling dates.
 for(const x of contexts){
  const fields=logisticsFields[x.p.alias],emission=fields.fechaEmision,delivery=fields.fechaEntrega;
  const emissionRow=emission[0]==='SC5'?x.header:x.row;
  const supplied=key=>mapping.find(m=>m.key===key);
  const e=supplied('fechaEmision')?logisticsValue(input.changes.fechaEmision,emission[1],catalog,emission[0],true):clean(emissionRow[emission[1]]);
  const d=x===c&&supplied('fechaEntrega')?logisticsValue(input.changes.fechaEntrega,delivery[1],catalog,delivery[0],true):clean(x.row[delivery[1]]);
  assert(/^\d{8}$/.test(e)&&/^\d{8}$/.test(d),409,'FECHAS_ORIGEN_NO_VERIFICABLES','Se requieren fechas de emisión y entrega verificadas.');
  for(const [value,field] of [[e,emission[1]],[d,delivery[1]]])logisticsValue(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`,field,catalog,field===emission[1]?emission[0]:delivery[0],true);
  assert(d>=e,400,'ORDEN_FECHAS_INVALIDO','La fecha de entrega no puede ser anterior a la emisión.');
 }
 return {updates,relatedUpdates,diff,...(mapping.some(m=>documentKeys.has(m.key))?{documentScope}:{}),calculation:{alcance:contexts.length>1||mapping.some(m=>m.alias==='SC5')?'Actualización logística del documento; entrega y depósito corresponden al ítem seleccionado.':'Actualización logística del ítem existente.',affectedItems:documentScope.length},warnings:[]};
}

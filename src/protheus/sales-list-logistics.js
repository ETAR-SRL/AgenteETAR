import {assert} from '../errors.js';
import {clean,sourceNumber,inputNumber,logisticsValue} from './write-policy.js';
import {logisticsMetadata} from './logistics-update.js';
import {identifier as q} from './config.js';
const name=t=>`${q(t.schema)}.${q(t.name)}`;
const iso=value=>`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;

// Screen validators can select a different price row when date or quantity crosses
// an applicability boundary. Preserve manual net prices, but never cross one by SQL.
export async function validateSalesListLogistics(connection,catalog,rows,c,input,lock){
 const code=clean(c.header.C5_TABELA);if(!code)return;
 const branch=input.target.sucursal,table=catalog.table('DA0'),itemTable=catalog.table('DA1');
 const required={DA0:['DA0_CODTAB','DA0_DATDE','DA0_DATATE','DA0_ATIVO'],DA1:['DA1_CODTAB','DA1_CODPRO','DA1_DATVIG','DA1_MOEDA','DA1_ATIVO','DA1_QTDLOT']};
 for(const [alias,fields] of Object.entries(required))for(const field of fields)assert(catalog.table(alias).columns.has(field)&&catalog.dictionary.has(field),409,'LISTA_METADATOS_NO_VERIFICABLES',`Falta campo físico/SX3 ${field}; verificar la lista en Protheus.`);
 const conditionFields=[...table.columns.keys()].filter(f=>/^DA0_(?:COND|CPAG|CPG)/.test(f));
 assert(conditionFields.every(f=>['DA0_CONDPG','DA0_CONDPAG','DA0_COND'].includes(f)),409,'LISTA_CONDICION_NO_VERIFICABLE','Campo de condición de lista fuera del contrato verificado.');
 const specs=[...Object.entries(required).flatMap(([alias,fields])=>fields.map(field=>({alias,field,key:/DATDE|DATATE|DATVIG/.test(field)?'fecha':'reference'}))),...conditionFields.map(field=>({alias:'DA0',field,key:'reference'}))];
 c.logisticsMetadata.push(...await logisticsMetadata(connection,catalog,specs,lock));
 const headers=await rows(connection,'DA0',{DA0_CODTAB:code},branch,lock,true);
 assert(headers.length===1,409,'LISTA_NO_UNICA','La lista de la cabecera no tiene un único registro DA0 activo.');
 const header=headers[0];
 const date=(value,field,alias,optional=false)=>{const text=clean(value);if(optional&&!text)return '';assert(/^\d{8}$/.test(text),409,'LISTA_FECHA_NO_VERIFICABLE',field);logisticsValue(iso(text),field,catalog,alias,true);return text;};
 const current=date(c.header.C5_EMISSAO,'C5_EMISSAO','SC5'),next=input.changes.fechaEmision?logisticsValue(input.changes.fechaEmision,'C5_EMISSAO',catalog,'SC5',true):current;
 const start=date(header.DA0_DATDE,'DA0_DATDE','DA0',true),end=date(header.DA0_DATATE,'DA0_DATATE','DA0',true);
 assert(!start||!end||end>=start,409,'LISTA_FECHA_NO_VERIFICABLE','El rango de vigencia de DA0 es inconsistente.');
 assert(clean(header.DA0_ATIVO)==='1',409,'LISTA_NO_VIGENTE','La lista de precios no está activa.');
 const valid=at=>(!start||at>=start)&&(!end||at<=end);
 assert(valid(current)&&valid(next),409,'LISTA_CAMBIA_APLICABILIDAD','La nueva emisión cruza la vigencia de la lista; requiere revisar precios en Protheus.');
 const oldTerm=clean(c.header.C5_CONDPAG),newTerm=input.changes.condicionPago||oldTerm;
 for(const field of conditionFields){const term=clean(header[field]);assert(!term||term===oldTerm&&term===newTerm,409,'LISTA_CONDICION_INCOMPATIBLE',`${field}: la condición de pago no coincide con la lista; requiere Protheus.`);}
 c.references.push({alias:'DA0',branch:catalog.branch('DA0',branch),table:name(table),row:header});
 const byProduct=new Map();
 for(const x of [c,...c.documentContexts]){
  const product=clean(x.row.C6_PRODUTO);let prices=byProduct.get(product);
  if(!prices){prices=await rows(connection,'DA1',{DA1_CODTAB:code,DA1_CODPRO:product},branch,lock,true);byProduct.set(product,prices);assert(prices.length,409,'LISTA_PRODUCTO_NO_VERIFICABLE','La lista no contiene el producto del pedido.');c.references.push({alias:'DA1',branch:catalog.branch('DA1',branch),table:name(itemTable),producto:product,rows:prices});}
  const quantity=sourceNumber(x.row.C6_QTDVEN,'C6_QTDVEN');let nextQuantity=quantity;
  if(x===c&&input.changes.cantidadPedida!==undefined){nextQuantity=inputNumber(input.changes.cantidadPedida,'cantidadPedida');if(input.quantityUnit==='millares')nextQuantity=nextQuantity.mul(1000);}
  const currency=sourceNumber(c.header.C5_MOEDA,'C5_MOEDA');let eligible=0;
  for(const row of prices){
   assert(['1','2'].includes(clean(row.DA1_ATIVO)),409,'LISTA_ESTADO_NO_VERIFICABLE','Estado DA1_ATIVO desconocido.');if(clean(row.DA1_ATIVO)==='2')continue;
   if(!sourceNumber(row.DA1_MOEDA,'DA1_MOEDA').eq(currency))continue;
   const since=date(row.DA1_DATVIG,'DA1_DATVIG','DA1',true),threshold=sourceNumber(row.DA1_QTDLOT,'DA1_QTDLOT');assert(threshold.gte(0),409,'LISTA_CANTIDAD_NO_VERIFICABLE','Intervalo de cantidad negativo.');
   assert((!since||current>=since)===(!since||next>=since),409,'LISTA_CAMBIA_APLICABILIDAD','La emisión cruza la vigencia de un ítem DA1; requiere revisar precios en Protheus.');
   assert(quantity.lt(threshold)===nextQuantity.lt(threshold)&&quantity.lte(threshold)===nextQuantity.lte(threshold),409,'LISTA_CAMBIA_APLICABILIDAD','La cantidad cruza un intervalo de la lista DA1; requiere Protheus.');
   if(!since||current>=since)eligible++;
  }
  assert(eligible>0,409,'LISTA_PRODUCTO_NO_VIGENTE','No hay precio DA1 activo con vigencia y moneda del pedido; requiere revisar la lista.');
 }
}

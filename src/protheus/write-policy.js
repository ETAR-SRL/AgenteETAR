import Decimal from 'decimal.js';
import {assert} from '../errors.js';
export const D=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
export const sqlExecutionPolicy=Object.freeze({
 transport:'sql',existingRecordsOnly:true,nativeCreditRevalidation:false,protheusRest:false,
 preservesIssuedDocuments:true,
 description:'UPDATE controlados sobre registros existentes. No se invocan REST ni rutinas ADVPL de Protheus.',
 creditLimitation:'Los pedidos con liberaciones pendientes y control de crédito activo requieren revalidación nativa. Un UPDATE SQL no la ejecuta; esas propuestas no pueden confirmarse desde este modo.'
});
export const writeProfiles=Object.freeze({
 precioLista:{alias:'DA1',resource:'preciosClientes',branch:'DA1_FILIAL',product:'DA1_CODPRO',price:'DA1_PRCVEN',priceThousands:'DA1_PRCMIL',keys:['DA1_CODTAB','DA1_ITEM','DA1_CODPRO'],fields:['precio']},
 precioListaProveedor:{alias:'AIB',resource:'preciosProveedores',branch:'AIB_FILIAL',product:'AIB_CODPRO',price:'AIB_PRCCOM',keys:['AIB_CODTAB','AIB_CODFOR','AIB_LOJFOR','AIB_CODPRO'],fields:['precio']},
 pedidoVenta:{alias:'SC6',resource:'itemsVentas',branch:'C6_FILIAL',product:'C6_PRODUTO',price:'C6_PRCVEN',quantity:'C6_QTDVEN',total:'C6_VALOR',thousands:'C6_MILLAR',unit:'C6_UM',keys:['C6_NUM','C6_ITEM','C6_PRODUTO'],fields:['precioUnitario','cantidadPedida','total'],
   zero:['C6_QTDENT','C6_QTDLIB','C6_QTDRESE','C6_QTDEMP','C6_QTDENT2','C6_QTDLIB2','C6_QTDEMP2','C6_UNSVEN','C6_DESCONT','C6_VALDESC'],blank:['C6_NOTA','C6_BLQ','C6_SEGUM','C6_NUMOP','C6_NUMPCOM']},
 pedidoCompra:{alias:'SC7',resource:'compras',branch:'C7_FILIAL',product:'C7_PRODUTO',price:'C7_PRECO',quantity:'C7_QUANT',total:'C7_TOTAL',thousands:'C7_MILLAR',unit:'C7_UM',keys:['C7_NUM','C7_ITEM','C7_PRODUTO','C7_FORNECE','C7_LOJA'],fields:['precioUnitario','cantidadPedida','total'],
   zero:['C7_QUJE','C7_QTDACLA','C7_QTSEGUM','C7_DESC','C7_DESC1','C7_DESC2','C7_DESC3','C7_VLDESC','C7_FRETE','C7_VALFRE','C7_SEGURO','C7_DESPESA','C7_DESP'],blank:['C7_RESIDUO','C7_ENCER','C7_CONAPRO','C7_APROV','C7_CODLIB','C7_SEGUM','C7_RATEIO','C7_CONTRA']}
});
export const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export const clean=x=>String(x??'').trim();
export function sourceNumber(value,field){
 assert(value!==null&&value!==undefined&&/^-?\d+(\.\d+)?([eE][+-]?\d{1,3})?$/.test(String(value)),409,'NUMERO_ORIGEN_INVALIDO',`Valor numérico no verificable: ${field}`);
 const n=new D(value);assert(n.isFinite(),409,'NUMERO_ORIGEN_INVALIDO',field);return n;
}
export function inputNumber(value,field){
 assert(typeof value==='string'&&/^\d{1,16}(\.\d{1,12})?$/.test(value),400,'VALOR_INVALIDO',`${field}: decimal como texto, punto decimal, sin separadores de miles`);
 const n=new D(value);assert(n.gt(0),400,'VALOR_INVALIDO',`${field} debe ser positivo`);return n;
}
export function numericSpec(field,catalog,alias){
 const col=catalog.table(alias).columns.get(field),sx=catalog.dictionary.get(field);
 assert(col&&!col.computed&&['float','real','decimal','numeric','money','smallmoney','int','bigint','smallint'].includes(col.type.toLowerCase()),409,'CAMPO_NO_DISPONIBLE',`No hay columna numérica ${field}`);
 assert(sx?.X3_TIPO==='N'&&/^\d+$/.test(String(sx.X3_DECIMAL))&&/^\d+$/.test(String(sx.X3_TAMANHO)),409,'PRECISION_DESCONOCIDA',`Falta SX3 para ${field}`);
 const scale=Number(sx.X3_DECIMAL),width=Number(sx.X3_TAMANHO);
 assert(scale>=0&&scale<=12&&width>scale&&width<=38,409,'PRECISION_DESCONOCIDA',field);
 if(['decimal','numeric'].includes(col.type.toLowerCase()))assert(col.scale>=scale&&col.precision-col.scale>=width-scale-(scale?1:0),409,'PRECISION_FISICA_INCOMPATIBLE',field);
 return {scale,width};
}
export function fit(value,field,catalog,alias,{round=false}={}){
 const {scale,width}=numericSpec(field,catalog,alias);const n=new D(value);
 assert(n.isFinite()&&n.gte(0),400,'VALOR_INVALIDO',field);
 assert(round||n.decimalPlaces()<=scale,400,'PRECISION_INVALIDA',`${field} admite ${scale} decimales; no se redondea el precio o cantidad`);
 const out=n.toFixed(scale);assert(out.length<=width,400,'VALOR_FUERA_DE_RANGO',`${field} excede la longitud SX3`);return out;
}
export function guardOrder(profile,row,{salesBalance=false}={}){
 if(!profile.quantity)return;
 // Campos obligatorios: si no hay evidencia del estado no se habilita un UPDATE.
 const required=profile.alias==='SC6'?['C6_QTDENT','C6_QTDLIB','C6_NOTA','C6_BLQ','C6_DESCONT','C6_VALDESC']:['C7_QUJE','C7_QTDACLA','C7_ENCER','C7_RESIDUO','C7_CONAPRO','C7_DESC','C7_VLDESC'];
 for(const field of required)assert(Object.hasOwn(row,field),409,'ESTADO_NO_VERIFICABLE',`Falta ${field}`);
 const retained=salesBalance&&profile.alias==='SC6'?new Set(['C6_QTDENT','C6_QTDLIB','C6_QTDRESE','C6_QTDEMP','C6_NOTA']):new Set();
 for(const field of profile.zero||[])if(Object.hasOwn(row,field)&&!retained.has(field))assert(sourceNumber(row[field],field).eq(0),409,'PEDIDO_CON_DEPENDENCIAS',`${field} no es cero; requiere el circuito Protheus`);
 for(const field of profile.blank||[])if(Object.hasOwn(row,field)&&!retained.has(field))assert(clean(row[field])==='',409,'PEDIDO_CON_DEPENDENCIAS',`${field} indica estado, vínculo o aprobación que requiere Protheus`);
 // No dejar importes fiscales, anticipos o accesorios calculados con el valor anterior.
 const tax=profile.alias==='SC7'?/^C7_(?:BAS|BASE|ALQ|ALIQ|VALIMP|VALICM|VALIPI|VALIR|VALCOF|VALPIS|IPI$|PICM$|VALEMB$)/:/^C6_(?:BAS|ALQ|VALIMP|VALICM|VALIPI|IPIDEV$|PICMRET$)/;
 for(const [field,value] of Object.entries(row))if(tax.test(field))assert(sourceNumber(value,field).eq(0),409,'FISCAL_NO_SOPORTADO',`${field} requiere recálculo fiscal Protheus`);
}
export function calculateUpdate(action,input,row,product,catalog,{salesBalance=false}={}){
 const p=writeProfiles[action];assert(p,400,'ACCION_NO_HABILITADA','Acción de escritura inválida');
 assert(plain(input.changes)&&Object.keys(input.changes).length&&Object.keys(input.changes).every(k=>p.fields.includes(k)),400,'CAMPO_NO_HABILITADO','Campos fuera del alcance');
 assert(input.priceUnit===undefined||['unidad','millar'].includes(input.priceUnit),400,'BASE_PRECIO_INVALIDA','priceUnit: unidad o millar');
 assert(input.quantityUnit===undefined||['unidades','millares'].includes(input.quantityUnit),400,'BASE_CANTIDAD_INVALIDA','quantityUnit: unidades o millares');
 const c=input.changes,unit=clean(product.B1_UM).toUpperCase(),updates={};
 if(p.unit)assert(clean(row[p.unit]).toUpperCase()===unit,409,'UNIDAD_INCONSISTENTE','La unidad del pedido no coincide con SB1');
 if(input.priceUnit==='millar'||input.quantityUnit==='millares')assert(unit==='UN',409,'MILLARES_NO_APLICAN','La conversión a millares requiere unidad UN');
 const priceKey=p.quantity?'precioUnitario':'precio';const originalPrice=sourceNumber(row[p.price],p.price).toDecimalPlaces(numericSpec(p.price,catalog,p.alias).scale);let price=originalPrice;
 if(c[priceKey]!==undefined){price=inputNumber(c[priceKey],priceKey);if(input.priceUnit==='millar')price=price.div(1000);updates[p.price]=fit(price,p.price,catalog,p.alias);}
 if(p.priceThousands&&catalog.table(p.alias).columns.has(p.priceThousands)&&c[priceKey]!==undefined){
  assert(unit==='UN',409,'MILLARES_NO_APLICAN','DA1_PRCMIL requiere producto en UN');updates[p.priceThousands]=fit(price.mul(1000),p.priceThousands,catalog,p.alias);
 }
 if(salesBalance)assert(p.alias==='SC6'&&c.precioUnitario!==undefined&&c.cantidadPedida===undefined,409,'SOLO_PRECIO_PENDIENTE','En ventas liberadas o atendidas sólo se cambia el precio del saldo pendiente; no las cantidades');
 guardOrder(p,row,{salesBalance});
 let quantity,total;
 if(p.quantity){
  quantity=sourceNumber(row[p.quantity],p.quantity).toDecimalPlaces(numericSpec(p.quantity,catalog,p.alias).scale);assert(quantity.gt(0)&&price.gt(0),409,'PEDIDO_INCONSISTENTE','Cantidad y precio actuales deben ser positivos');
  const originalTotal=sourceNumber(row[p.total],p.total),expected=fit(quantity.mul(originalPrice),p.total,catalog,p.alias,{round:true});
  assert(originalTotal.toFixed(numericSpec(p.total,catalog,p.alias).scale)===expected,409,'TOTAL_ORIGEN_INCONSISTENTE','El total actual no coincide con cantidad × precio; requiere revisar condiciones comerciales');
  if(c.cantidadPedida!==undefined){assert(input.quantityUnit,400,'BASE_CANTIDAD_REQUERIDA','Indicar unidades o millares');quantity=inputNumber(c.cantidadPedida,'cantidadPedida');if(input.quantityUnit==='millares')quantity=quantity.mul(1000);updates[p.quantity]=fit(quantity,p.quantity,catalog,p.alias);}
  if(!salesBalance&&p.thousands&&catalog.table(p.alias).columns.has(p.thousands)){
   assert(unit==='UN',409,'MILLARES_NO_APLICAN','El campo MILLAR exige UN');
   // Se sincroniza también si antes estaba vacío/cero: ambos valores se muestran en el diff.
   updates[p.thousands]=fit(quantity.div(1000),p.thousands,catalog,p.alias);
  }
  if(p.alias==='SC6'&&catalog.table(p.alias).columns.has('C6_PRUNIT')&&c.precioUnitario!==undefined){
   assert(sourceNumber(row.C6_PRUNIT,'C6_PRUNIT').eq(sourceNumber(row[p.price],p.price)),409,'PRECIO_LISTA_DIFERENTE','C6_PRUNIT difiere del precio neto; requiere revisar descuentos');
   updates.C6_PRUNIT=fit(price,'C6_PRUNIT',catalog,p.alias);
  }
  total=fit(quantity.mul(price),p.total,catalog,p.alias,{round:true});
  if(c.total!==undefined)assert(inputNumber(c.total,'total').eq(total),400,'TOTAL_INCONSISTENTE',`El total debe coincidir con cantidad × precio redondeado: ${total}`);
  updates[p.total]=total;
 }
 if(p.alias==='AIB'&&Object.hasOwn(row,'AIB_PRCXTR'))assert(price.gte(sourceNumber(row.AIB_PRCXTR,'AIB_PRCXTR')),409,'PRECIO_INFERIOR_MINIMO','El precio es menor al mínimo de AIB');
 const diff=Object.entries(updates).filter(([field,value])=>!sourceNumber(row[field],field).toDecimalPlaces(numericSpec(field,catalog,p.alias).scale).eq(value)).map(([field,after])=>({field,before:row[field],after}));
 assert(diff.length,400,'SIN_CAMBIOS','No hay diferencias para actualizar');
 return {updates:Object.fromEntries(diff.map(d=>[d.field,d.after])),diff,calculation:{unidadMedida:unit,priceUnit:input.priceUnit||'unidad',quantityUnit:input.quantityUnit||null,precioPorUnidad:price.toFixed(),precioPorMillar:unit==='UN'?price.mul(1000).toFixed():null,cantidadUnidades:quantity?.toFixed()||null,cantidadMillares:quantity&&unit==='UN'?quantity.div(1000).toFixed():null,total:total||null,rounding:'Sólo el total se redondea HALF_UP a los decimales SX3'}};
}

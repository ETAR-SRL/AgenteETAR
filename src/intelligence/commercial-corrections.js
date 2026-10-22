import {valueCorrections} from './value-corrections.js';
import {logisticsCorrections} from './logistics-corrections.js';

export const commercialFields=Object.freeze(['price','quantity','currency','priceUnit','quantityUnit','emission','due','warehouse','payment','date']);
export const commercialValueLabels=Object.freeze({price:'el precio',quantity:'la cantidad',currency:'la moneda (pesos o dólares)',priceUnit:'la base del precio (por unidad o por millar)',quantityUnit:'la base de la cantidad (unidades o millares)',emission:'la fecha de emisión',due:'la fecha de entrega o necesidad',warehouse:'el depósito',payment:'la condición de pago',date:'la fecha que querés corregir (emisión o entrega/necesidad)'});
export const commercialDay=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'});
// Interpretation only. Catalog candidates are never verified ERP identities.
export function commercialCorrections(text,{today=commercialDay(),...options}={}){
 const numeric=valueCorrections(text,options),logistics=logisticsCorrections(text,{...options,today});
 return {...numeric,...logistics,changes:{...numeric.changes,...logistics.changes},rejected:[...new Set([...numeric.rejected,...logistics.rejected])],pending:[...new Set([...numeric.pending,...logistics.pending])]};
}

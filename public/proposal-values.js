const names={
 C1_EMISSAO:'Fecha de emisión',C7_EMISSAO:'Fecha de emisión',C5_EMISSAO:'Fecha de emisión',
 C1_DATPRF:'Fecha de necesidad',C7_DATPRF:'Fecha prevista de entrega',C6_ENTREG:'Fecha de entrega',
 C1_LOCAL:'Depósito',C7_LOCAL:'Depósito',C6_LOCAL:'Depósito',
 C7_COND:'Condición de pago',C5_CONDPAG:'Condición de pago'
};
const dates=new Set(['C1_EMISSAO','C7_EMISSAO','C5_EMISSAO','C1_DATPRF','C7_DATPRF','C6_ENTREG']);
function value(field,input){
 if(dates.has(field)&&/^\d{8}$/.test(String(input)))return `${String(input).slice(6,8)}/${String(input).slice(4,6)}/${String(input).slice(0,4)}`;
 return input;
}
export function proposalDiffRows(diff=[]){
 return diff.map(d=>({...d.table?{tabla:d.table,registro:d.record,secuencia:d.sequence||''}:{},campo:names[d.field]||d.field,antes:value(d.field,d.before),despues:value(d.field,d.after)}));
}

// Deliberately narrow: extra filters and periods remain in the verified tool workflow.
export async function reportChat({text,branch,executeRead}) {
 const n=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?!. ,]+/g,' ').trim();
 const match=/^(?:(?:mostrame|mostra|dame|haceme|quiero|necesito) )?(?:un |el )?(?:dashboard|resumen|informe) de (ventas|compras)(?: facturadas)?(?: de este mes| del mes actual)?$/.exec(n);
 if(!match||!executeRead)return null;
 const resource=match[1]==='ventas'?'resumenVentas':'resumenCompras';
 const result=await executeRead({resource,filters:{sucursal:branch}});
 return {answer:result.verifiedSummary,evidence:[{id:'F1',action:'consultar_erp',args:{recurso:resource,filtros:{}},result}],trace:[{action:'consultar_erp',status:'ok',sourceId:'F1'}]};
}

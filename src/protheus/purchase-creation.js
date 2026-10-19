// Creation is authorized by the owner, but authorization is not a numbering allocator.
// No guessed RECNO, MAX()+1, internal DBAccess table writes or incomplete INSERTs.
export const purchaseCreationActions=Object.freeze({crearSolicitudCompra:'SC1',crearPedidoCompra:'SC7'});
export function purchaseCreationStatus(catalog){
 return Object.fromEntries(Object.entries(purchaseCreationActions).map(([action,alias])=>{
  const recno=catalog.tables?.get(alias)?.columns.get('R_E_C_N_O_');
  return [action,{alias,executionEnabled:false,recnoIdentity:recno?.identity??null,
   blockers:[
    {code:'NUMERACION_COMPARTIDA_NO_IMPLEMENTADA',message:`Las altas ${alias} requieren asignar RECNO y número de documento coordinados con Protheus. No hay un asignador compartido implementado; no se calcula MAX(RECNO)+1.`},
    {code:'ALTA_COMPRAS_NO_HOMOLOGADA',message:'Falta verificar campos obligatorios, valores iniciales, vínculos y circuito de aprobación de los documentos nuevos de esta instalación.'}
   ]}];
 }));
}

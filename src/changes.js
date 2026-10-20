import {approvalWorkflowActions} from './protheus/approval-workflow.js';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { assert, HttpError } from './errors.js';
import {writeProfiles} from './protheus/write-policy.js';
import {purchaseCreationActions} from './protheus/purchase-creation.js';
export const changePolicies={
  continuarAprobacionCompra:{resource:'aprobacionesCompras',fields:[],routine:'Generar PC pendiente tras completar IP'},
  escalarAprobacionCompra:{resource:'aprobacionesCompras',fields:[],routine:'Transferir una aprobación pendiente al superior configurado'},
  crearSolicitudCompra:{resource:'solicitudesCompra',fields:[],routine:'INSERT SC1 con RECNO y número automáticos, estado según configuración de aprobación'},
  crearPedidoCompra:{resource:'compras',fields:[],routine:'INSERT SC7 con RECNO y número automáticos, estado según configuración de aprobación'},
  precioLista:{resource:'preciosClientes',fields:['precio'],routine:'UPDATE DA1_PRCVEN y DA1_PRCMIL sobre ítem existente'},
  precioListaProveedor:{resource:'preciosProveedores',fields:['precio'],routine:'UPDATE AIB_PRCCOM sobre registro existente'},
  pedidoVenta:{resource:'itemsVentas',fields:['precioUnitario','cantidadPedida','total'],routine:'UPDATE SC6 y precio SC9 pendiente; conserva estados, no revalida crédito'},
  solicitudCompra:{resource:'solicitudesCompra',fields:['precioUnitario','cantidadPedida','total'],routine:'UPDATE SC1 sin atención ni documentos vinculados'},
  pedidoCompra:{resource:'compras',fields:['precioUnitario','cantidadPedida','total'],routine:'UPDATE SC7 sin recepciones ni condiciones dependientes'},
  clienteContacto:{resource:'clientes',fields:['email','telefono','contacto'],routine:'MATA030 / CRMA980 alteración'},
  proveedorContacto:{resource:'proveedores',fields:['email','telefono','contacto'],routine:'MATA020 alteración'}
};
const hash=row=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value);
export class Changes {
  constructor({erp,store,read}){this.erp=erp;this.store=store;this.read=read;}
  async current(policy,target){
    const result=await this.read(policy.resource,new URLSearchParams({sucursal:target.sucursal,registro:String(target.registro),limit:'2'}));
    assert(result.data.length===1,409,'REGISTRO_NO_UNICO','Debe existir exactamente un registro activo; no se crean registros');
    const row=result.data[0];
    assert(String(row.registro)===String(target.registro),409,'REGISTRO_INCORRECTO','El origen no devolvió el registro solicitado');
    return {row,meta:result.meta};
  }
  async preview(actor,input){
    assert(plain(input),400,'PROPUESTA_INVALIDA','Objeto requerido');
    if(Object.hasOwn(approvalWorkflowActions,input.action)){
      assert(this.erp.writes&&Object.keys(input).every(k=>['action','target'].includes(k))&&plain(input.target)&&Object.keys(input.target).every(k=>['sucursal','propuesta','registro'].includes(k)),400,'CIRCUITO_OBJETIVO','Indicar propuesta de alta ejecutada, sucursal y RECNO SCR para transferir');
      assert(typeof input.target.propuesta==='string'&&/^[a-f0-9-]{36}$/i.test(input.target.propuesta),400,'CIRCUITO_OBJETIVO','ID de propuesta inválido');
      const origin=this.store.get(input.target.propuesta,actor),receipt=this.store.execution(input.target.propuesta,actor);
      assert(origin&&Object.hasOwn(purchaseCreationActions,origin.action)&&receipt?.status==='executed',404,'ALTA_ORIGEN_NO_EXISTE','Alta ejecutada no encontrada para esta sesión');
      assert(origin.target.sucursal===input.target.sucursal,400,'CIRCUITO_OBJETIVO','Sucursal distinta de la propuesta de origen');
      if(input.action==='escalarAprobacionCompra')assert(typeof input.target.registro==='string'&&/^[1-9]\d{0,18}$/.test(input.target.registro)&&BigInt(input.target.registro)<=9223372036854775807n,400,'CIRCUITO_OBJETIVO','Indicar RECNO SCR como texto');
      const enriched={...input,source:{action:origin.action,input:origin.input,writePlan:origin.writePlan,result:receipt.result}};
      const writePlan=await this.erp.writes.prepare(input.action,enriched);
      return this.public(this.store.save(actor,{action:input.action,target:input.target,input:enriched,operation:'workflow',resource:writePlan.resource,diff:writePlan.diff,items:[],approval:writePlan.approval,identity:writePlan.identity,blockers:writePlan.blockers,warnings:writePlan.warnings,fingerprint:writePlan.snapshotHash,mode:'live',status:'proposed',executionEnabled:writePlan.executionEnabled,writePlan}));
    }
    if(Object.hasOwn(purchaseCreationActions,input.action)){
      assert(this.erp.writes,503,'ESCRITURA_DESHABILITADA','No hay ejecutor de altas');
      const {origin,...creationInput}=input;
      const writePlan=await this.erp.writes.prepare(input.action,creationInput);
      return this.public(this.store.save(actor,{action:input.action,target:input.target,input:creationInput,origin,operation:'insert',resource:writePlan.resource,diff:writePlan.diff,items:writePlan.items.map((item,i)=>({...item,cantidadComercial:creationInput.items[i].cantidad,baseCantidad:creationInput.items[i].baseCantidad,precioComercial:creationInput.items[i].precio,basePrecio:creationInput.items[i].basePrecio,fechaNecesidad:creationInput.items[i].fechaNecesidad,centroCosto:creationInput.items[i].centroCosto||'',observacion:creationInput.items[i].observacion||''})),approval:writePlan.approval,identity:{...creationInput.header,...writePlan.identity},calculation:writePlan.calculation,blockers:writePlan.blockers,warnings:writePlan.warnings,fingerprint:writePlan.snapshotHash,mode:'live',status:'proposed',executionEnabled:writePlan.executionEnabled,writePlan}));
    }
    const policy=Object.hasOwn(changePolicies,input.action)?changePolicies[input.action]:null;
    assert(policy,400,'ACCION_NO_HABILITADA','Acciones: '+Object.keys(changePolicies).join(', '));
    const {target,changes}=input;
    assert(plain(target) && typeof target.sucursal==='string' && typeof target.registro==='string' && /^[1-9]\d{0,18}$/.test(target.registro) && BigInt(target.registro)<=9223372036854775807n,400,'CLAVE_INVALIDA','Indicar sucursal y registro existente como texto');
    assert(plain(changes) && Object.keys(changes).length>0 && Object.keys(changes).every(k=>policy.fields.includes(k)),400,'CAMPO_NO_HABILITADO','Campos fuera de la lista permitida');
    if(this.erp.writes && Object.hasOwn(writeProfiles,input.action)){
      // Mantiene la validación de acceso a sucursal del servicio de lectura.
      const {row}=await this.current(policy,target);
      const writePlan=await this.erp.writes.prepare(input.action,input);
      return this.public(this.store.save(actor,{action:input.action,target,input,origin:input.origin,resource:policy.resource,before:row,diff:writePlan.diff,identity:writePlan.identity,calculation:writePlan.calculation,blockers:writePlan.blockers||[],warnings:writePlan.warnings||[],fingerprint:writePlan.snapshotHash,mode:'live',status:'proposed',executionEnabled:writePlan.executionEnabled,writePlan}));
    }
    const {row,meta}=await this.current(policy,target);
    const metadata=this.erp.metadata();
    const diff=[];
    for(const [field,value] of Object.entries(changes)){
      const fieldMeta=metadata.entities?.[policy.resource]?.fields?.find(f=>f.salida===field);
      assert(Object.hasOwn(row,field) && (meta.demo || fieldMeta?.disponible===true),409,'CAMPO_NO_DISPONIBLE',`No hay columna verificable para ${field}`);
      assert(typeof value==='string',400,'VALOR_INVALIDO','Usar valores de texto; importes decimales sin separador de miles');
      let next=value.trim();
      if(field==='precio'){
        const priceField=fieldMeta?.origen||(policy.resource==='preciosProveedores'?'AIB_PRCCOM':'DA1_PRCVEN');
        assert(/^\d{1,12}(\.\d{1,8})?$/.test(next) && new Decimal(next).gt(0),400,'PRECIO_INVALIDO','Precio positivo, punto decimal y sin separador de miles');
        const rawDecimals=meta.demo?2:fieldMeta?.diccionario?.X3_DECIMAL;
        const rawWidth=meta.demo?14:fieldMeta?.diccionario?.X3_TAMANHO;
        assert(rawDecimals!==null && rawDecimals!==undefined && /^\d+$/.test(String(rawDecimals)) && rawWidth!==null && rawWidth!==undefined && /^\d+$/.test(String(rawWidth)),409,'PRECISION_DESCONOCIDA',`Validar precisión y longitud de ${priceField} en SX3 antes de proponer`);
        const decimals=Number(rawDecimals),width=Number(rawWidth);
        assert(Number.isInteger(decimals) && decimals>=0 && decimals<=8 && width>decimals && width<=38,409,'PRECISION_DESCONOCIDA',`Precisión de ${priceField} inválida`);
        assert(new Decimal(next).decimalPlaces()<=decimals,400,'PRECISION_INVALIDA',`${priceField} permite ${decimals} decimales`);
        next=new Decimal(next).toFixed(decimals);
        assert(next.length<=width,400,'PRECIO_FUERA_DE_RANGO',`El precio excede la longitud de ${priceField}`);
        assert(row[field]!==null && /^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(String(row[field])) && new Decimal(row[field]).isFinite(),409,'PRECIO_ACTUAL_INVALIDO','No hay precio actual verificable');
        assert(!new Decimal(row[field]).toDecimalPlaces(decimals).eq(next),400,'SIN_CAMBIOS','El valor solicitado es igual al actual a la precisión de SX3');
      }else{
        const width=meta.demo?120:Number(fieldMeta?.diccionario?.X3_TAMANHO);
        assert(Number.isInteger(width)&&width>0,409,'LONGITUD_DESCONOCIDA','Validar longitud del campo en SX3');
        assert(next.length>0 && next.length<=Math.min(width,120) && !/[\r\n\u0000-\u001f]/.test(next),400,'VALOR_INVALIDO','Texto demasiado largo o con controles');
        if(field==='email') assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next),400,'EMAIL_INVALIDO','Email inválido');
      }
      assert(String(row[field])!==next,400,'SIN_CAMBIOS','El valor solicitado es igual al actual');
      diff.push({field,before:row[field],after:next});
    }
    return this.store.save(actor,{action:input.action,target:{sucursal:target.sucursal,registro:String(target.registro)},resource:policy.resource,before:row,diff,fingerprint:hash(row),mode:meta.demo?'demo':'live',status:'proposed',executionEnabled:false,routineToValidate:policy.routine});
  }
  async check(actor,id){
    const proposal=this.store.get(id,actor);
    assert(proposal,404,'PROPUESTA_NO_EXISTE','Propuesta inexistente');
    assert(proposal.status!=='superseded',409,'PROPUESTA_REEMPLAZADA','La revisión cambió. Confirmá el resumen más reciente.');
    assert(Date.parse(proposal.expiresAt)>Date.now(),409,'PROPUESTA_VENCIDA','La propuesta venció; generar otra');
    if(proposal.writePlan){const checked=await this.erp.writes.check(proposal);this.store.audit(actor,'proposal.checked',id);return {id,unchanged:true,executionEnabled:checked.executionEnabled};}
    const current=await this.current(changePolicies[proposal.action],proposal.target);
    assert(hash(current.row)===proposal.fingerprint,409,'CONFLICTO_CONCURRENCIA','El registro cambió desde la propuesta; releer y generar otra');
    this.store.audit(actor,'proposal.checked',id);
    return {id,unchanged:true,executionEnabled:false,message:'Comparación vigente; adaptador de escritura todavía no homologado'};
  }
  public(proposal){const {writePlan,input,actor,...visible}=proposal;return visible;}
  status(actor,id){const proposal=this.store.get(id,actor);assert(proposal,404,'PROPUESTA_NO_EXISTE','Propuesta inexistente');return {proposal:this.public(proposal),execution:this.store.execution(id,actor)};}
  async execute(actor,id,confirmation){
    const proposal=this.store.get(id,actor);assert(proposal,404,'PROPUESTA_NO_EXISTE','Propuesta inexistente');
    assert(plain(confirmation)&&confirmation.confirm===true&&confirmation.fingerprint===proposal.fingerprint,400,'CONFIRMACION_REQUERIDA','Confirmar explícitamente la huella de la propuesta revisada');
    const existing=this.store.execution(id,actor);
    if(existing?.status==='executed')return existing;
    assert(proposal.status!=='superseded',409,'PROPUESTA_REEMPLAZADA','La revisión cambió. Confirmá el resumen más reciente.');
    assert(!existing,409,'EJECUCION_NO_REPETIBLE','La ejecución ya se inició; consultar estado. No reenviar automáticamente');
    assert(Date.parse(proposal.expiresAt)>Date.now(),409,'PROPUESTA_VENCIDA','La propuesta venció; generar otra');
    assert(proposal.writePlan&&this.erp.writes?.enabled,503,'ESCRITURA_DESHABILITADA','Esta acción no tiene un ejecutor habilitado');
    assert(this.store.claim(id,actor),409,'EJECUCION_NO_REPETIBLE','La ejecución ya se inició');
    let result;
    try{result=await this.erp.writes.execute(proposal);}
    catch(error){
      try{this.store.finish(id,actor,error.outcomeUnknown?'unknown':'failed',{code:error.code||'ERROR_SQL'});}catch{throw new HttpError(503,'RESULTADO_INCIERTO','No se pudo guardar el resultado local; no reintentar');}
      throw error;
    }
    try{return this.store.finish(id,actor,'executed',result);}
    catch{throw new HttpError(503,'RESULTADO_INCIERTO','El ERP confirmó el cambio pero falló el recibo local; no reintentar');}
  }
}

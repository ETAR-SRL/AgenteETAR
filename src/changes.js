import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { assert } from './errors.js';
export const changePolicies={
  precioLista:{resource:'preciosClientes',fields:['precio'],routine:'OMSA010 alteración, LINPOS del ítem existente'},
  precioListaProveedor:{resource:'preciosProveedores',fields:['precio'],routine:'Alteración de AIB_PRCCOM sobre lista/proveedor/tienda/producto existentes; ejecución pendiente de homologar'},
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
    const policy=Object.hasOwn(changePolicies,input.action)?changePolicies[input.action]:null;
    assert(policy,400,'ACCION_NO_HABILITADA','Acciones: '+Object.keys(changePolicies).join(', '));
    const {target,changes}=input;
    assert(plain(target) && typeof target.sucursal==='string' && typeof target.registro==='string' && /^[1-9]\d{0,18}$/.test(target.registro) && BigInt(target.registro)<=9223372036854775807n,400,'CLAVE_INVALIDA','Indicar sucursal y registro existente como texto');
    assert(plain(changes) && Object.keys(changes).length>0 && Object.keys(changes).every(k=>policy.fields.includes(k)),400,'CAMPO_NO_HABILITADO','Campos fuera de la lista permitida');
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
    assert(Date.parse(proposal.expiresAt)>Date.now(),409,'PROPUESTA_VENCIDA','La propuesta venció; generar otra');
    const current=await this.current(changePolicies[proposal.action],proposal.target);
    assert(hash(current.row)===proposal.fingerprint,409,'CONFLICTO_CONCURRENCIA','El registro cambió desde la propuesta; releer y generar otra');
    this.store.audit(actor,'proposal.checked',id);
    return {id,unchanged:true,executionEnabled:false,message:'Comparación vigente; adaptador de escritura todavía no homologado'};
  }
}

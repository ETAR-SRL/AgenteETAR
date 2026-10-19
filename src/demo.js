import { HttpError } from './errors.js';
const rows = {
  clientes: [{registro:1,sucursal:'01',codigo:'DEMO001',tienda:'01',nombre:'Cliente ficticio',email:'compras@example.invalid',telefono:'000000',contacto:'Ejemplo'}],
  proveedores: [{registro:2,sucursal:'01',codigo:'DEMOP01',tienda:'01',nombre:'Proveedor ficticio',email:'ventas@example.invalid',telefono:'000000',contacto:'Ejemplo'}],
  productos: [{registro:3,sucursal:'0101',codigo:'DEMO-P01',nombre:'Pieza de demostración',unidadMedida:'UN'}],
  preciosClientes: [{registro:4,sucursal:'01',listaCodigo:'DEMO',productoCodigo:'DEMO-P01',item:'0001',precio:'1250.00',moneda:{codigo:'1',descripcion:'ARS'},vigenteDesde:'2026-01-01',intervaloPrecio:'1'}],
  costos: [{registro:5,sucursal:'0101',productoCodigo:'DEMO-P01',deposito:'01',costoMedio:'820.50',saldo:'12.00'}],
  compras: [{registro:6,sucursal:'0101',numero:'DEMO01',item:'0001',productoCodigo:'DEMO-P01',cantidad:'20.00',cantidadAtendida:'5.00',saldoTecnico:'15.00'}],
  produccion: [{registro:7,sucursal:'0101',numero:'DEMO02',productoCodigo:'DEMO-P01',cantidad:'10.00',cantidadProducida:'2.00',saldoTecnico:'8.00'}],
  ventas: [{registro:8,sucursal:'0101',numero:'DEMO03',clienteCodigo:'DEMO001',clienteTienda:'01'}],
  itemsVentas: [{registro:9,sucursal:'0101',numero:'DEMO03',item:'01',productoCodigo:'DEMO-P01',cantidad:'10.00',cantidadAtendida:'2.00',saldoTecnico:'8.00'}],
  documentosSalida: [{registro:10,sucursal:'0101',documento:'DEMO04',serie:'R',tipoDocumento:'50',especie:'RFN',entregaFisica:'sin_evidencia'}],
  itemsDocumentosSalida: [], entradasCompras: [], estructuras: [], cotizaciones: [], itemsCotizaciones: [], listasPreciosClientes: [], preciosProveedores: []
};
export function createDemoErp() {
  return {
    async list(resource, params) {
      if (!Object.hasOwn(rows,resource)) throw new HttpError(404,'RECURSO_NO_EXISTE','Recurso inexistente en demo');
      const filterNames={codigo:'codigo',tienda:'tienda',lista:'listaCodigo',producto:'productoCodigo',numero:'numero',registro:'registro'};
      let data=structuredClone(rows[resource]);
      for(const [key,field] of Object.entries(filterNames)) if(params.has(key)) data=data.filter(r=>String(r[field])===params.get(key));
      if(params.has('pendiente')) data=data.filter(r=>Number(r.saldoTecnico)>0);
      const page=Number(params.get('page')||1),limit=Number(params.get('limit')||100);
      return {data:data.slice((page-1)*limit,page*limit),meta:{recurso:resource,page,limit,hasMore:data.length>page*limit,demo:true,advertencias:['DATOS_FICTICIOS_NO_PROVIENEN_DEL_ERP']}};
    },
    metadata(){return {demo:true,entities:Object.fromEntries(Object.keys(rows).map(k=>[k,{demo:true}]))};},
    async close(){}
  };
}
export function createDemoKaiqen(){
  const project={id:1,name:'Proyecto ficticio',estado_general:'EN_PROCESO',referencia:'DEMO-P01'};
  return {available:true,async projects(){return {data:[project],demo:true};},async project(id){if(String(id)!=='1')throw new HttpError(404,'PROYECTO_NO_EXISTE','Proyecto demo inexistente');return {data:project,demo:true};},async quality(){return {data:{nota:'Calidad de demostración, sin evidencia real',pendientes:2},demo:true};}};
}

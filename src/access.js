import {randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {assert} from './errors.js';
const scrypt=promisify(scryptCallback),digest=s=>createHash('sha256').update(s).digest('hex');
const passwordOptions={N:32768,r:8,p:3,maxmem:64*1024*1024};
export const denied='Esto no podés leerlo.';
export const domains={finanzasProveedores:'Saldos financieros de proveedores',finanzasClientes:'Saldos financieros de clientes',catalogo:'Productos, estructuras y catálogos',clientes:'Clientes y sus datos',proveedores:'Proveedores y sus datos',costos:'Costos y valuación de existencias',preciosVenta:'Precios de venta y listas',preciosCompra:'Precios de compra y listas',ventas:'Pedidos y documentos de venta',compras:'Solicitudes, pedidos y documentos de compra',produccion:'Producción y pendientes de fabricación',proyectos:'Proyectos KAIQEN',calidad:'Calidad KAIQEN',aprobaciones:'Circuitos e historial de aprobaciones'};
export const resourceDomains={
 atencionVentas:['ventas','clientes','preciosVenta','catalogo'],atencionCompras:['compras','proveedores','preciosCompra','catalogo'],atencionRemitos:['ventas','clientes','preciosVenta','catalogo'],
 liberacionesVentas:['ventas','clientes','preciosVenta','catalogo'],documentosPedidoVenta:['ventas','clientes','preciosVenta','catalogo'],
 saldosProveedores:['finanzasProveedores','proveedores'],recepcionesCompras:['compras','proveedores','catalogo'],
 saldosClientes:['finanzasClientes','clientes'],
 comprobantesVentas:['ventas','clientes','preciosVenta','catalogo'],resumenVentas:['ventas','clientes','preciosVenta','catalogo'],
 comprobantesCompras:['compras','proveedores','preciosCompra','catalogo'],resumenCompras:['compras','proveedores','preciosCompra','catalogo'],
 remitosEmitidos:['ventas','clientes','preciosVenta','catalogo'],remitosPendientes:['ventas','clientes','preciosVenta','catalogo'],resumenRemitosPendientes:['ventas','clientes','preciosVenta','catalogo'],
 pedidosVentaPendientes:['ventas','clientes','preciosVenta','catalogo'],resumenPedidosVenta:['ventas','clientes','preciosVenta','catalogo'],
 pedidosCompraPendientes:['compras','proveedores','preciosCompra','catalogo'],resumenPedidosCompra:['compras','proveedores','preciosCompra','catalogo'],
 productos:['catalogo'],estructuras:['catalogo'],depositos:['catalogo'],centrosCosto:['catalogo'],condicionesPago:['catalogo'],compradores:['compras'],
 clientes:['clientes'],proveedores:['proveedores'],costos:['costos','catalogo'],produccion:['produccion','catalogo'],
 listasPreciosClientes:['preciosVenta'],preciosClientes:['preciosVenta','catalogo'],productoCliente:['clientes','catalogo'],
 listasPreciosProveedores:['preciosCompra','proveedores'],preciosProveedores:['preciosCompra','proveedores','catalogo'],productoProveedor:['proveedores','catalogo'],
 ventas:['ventas','clientes','preciosVenta'],itemsVentas:['ventas','clientes','preciosVenta','catalogo'],
 documentosSalida:['ventas','clientes','preciosVenta','compras','proveedores','preciosCompra'],itemsDocumentosSalida:['ventas','clientes','preciosVenta','catalogo','compras','proveedores','preciosCompra'],remitos:['ventas','clientes','preciosVenta'],entregas:['ventas'],
 compras:['compras','proveedores','preciosCompra','catalogo'],entradasCompras:['compras','proveedores','preciosCompra','catalogo','ventas','clientes','preciosVenta'],solicitudesCompra:['compras','preciosCompra','catalogo'],
 cotizaciones:['ventas','clientes','preciosVenta'],itemsCotizaciones:['ventas','clientes','preciosVenta','catalogo'],
 proyectos:['proyectos','clientes'],calidad:['calidad'],aprobacionesCompras:['aprobaciones','compras','preciosCompra','proveedores','catalogo']
};
export const actionResources={precioLista:'preciosClientes',precioListaProveedor:'preciosProveedores',pedidoVenta:'itemsVentas',pedidoCompra:'compras',solicitudCompra:'solicitudesCompra',crearSolicitudCompra:'solicitudesCompra',crearPedidoCompra:'compras',continuarAprobacionCompra:'aprobacionesCompras',escalarAprobacionCompra:'aprobacionesCompras',clienteContacto:'clientes',proveedorContacto:'proveedores'};
const actionLabels={precioLista:'precios de venta DA1',precioListaProveedor:'precios de compra AIB',pedidoVenta:'cambios en pedidos de venta',pedidoCompra:'cambios en pedidos de compra',solicitudCompra:'cambios en solicitudes de compra',crearSolicitudCompra:'nuevas solicitudes de compra',crearPedidoCompra:'nuevos pedidos de compra',continuarAprobacionCompra:'continuación de aprobación IP a PC',escalarAprobacionCompra:'transferencia de aprobación al superior',clienteContacto:'datos de contacto de clientes',proveedorContacto:'datos de contacto de proveedores'};
export const permissionCatalog=[...Object.entries(domains).map(([k,label])=>({key:'read:'+k,label})),...Object.keys(actionResources).flatMap(k=>[{key:'plan:'+k,label:'Preparar · '+actionLabels[k]},{key:'write:'+k,label:'Ejecutar · '+actionLabels[k]}])];
const known=new Set(permissionCatalog.map(p=>p.key));
export function canRead(principal,resource){return principal?.admin||principal?.unrestricted||!!resourceDomains[resource]?.every(d=>principal?.permissions.includes('read:'+d));}
export function assertRead(principal,resource){assert(canRead(principal,resource),403,'LECTURA_DENEGADA',denied);}
export function assertAction(principal,action,execute=false){
 assert(Object.hasOwn(actionResources,action),403,'LECTURA_DENEGADA',denied);assertRead(principal,actionResources[action]);
 assert(principal.admin||principal.unrestricted||principal.permissions.includes((execute?'write:':'plan:')+action),403,'ACCION_DENEGADA','Tu rol no permite esta acción.');
}
export class Access {
 constructor(store,branches){this.store=store;this.db=store.db;this.branches=branches;this.attempts=new Map();
  this.db.exec(`CREATE TABLE IF NOT EXISTS access_roles(id TEXT PRIMARY KEY,name TEXT NOT NULL,permissions TEXT NOT NULL,branches TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
   CREATE TABLE IF NOT EXISTS access_users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password TEXT NOT NULL,role_id TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1);
   CREATE TABLE IF NOT EXISTS access_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);`);
 }
 hasUsers(){return !!this.db.prepare('SELECT 1 FROM access_users LIMIT 1').get();}
 role(id){return this.db.prepare('SELECT * FROM access_roles WHERE id=?').get(id);}
 user(id){return this.db.prepare('SELECT * FROM access_users WHERE id=?').get(id);}
 principal(id){
  const user=this.user(id),role=user&&this.role(user.role_id);if(!user?.active||!role)return null;
  const permissions=JSON.parse(role.permissions),branches=JSON.parse(role.branches).filter(b=>this.branches.includes(b));
  const revision=digest(JSON.stringify([user.revision,role.revision,permissions,branches])).slice(0,20);
  return {userId:id,username:user.username,name:user.name,roleId:role.id,roleName:role.name,admin:role.id==='admin',permissions,branches,revision,actor:`user:${id}:${revision}`,role:role.id==='admin'||permissions.some(p=>p.startsWith('write:'))?'writer':permissions.some(p=>p.startsWith('plan:'))?'planner':'reader'};
 }
 refresh(principal){if(!principal?.userId)return principal;const fresh=this.principal(principal.userId);assert(fresh&&fresh.revision===principal.revision,403,'ACCESO_CAMBIO','Tus permisos cambiaron. Volvé a ingresar.');return fresh;}
 fromToken(token){if(!token)return null;const row=this.db.prepare('SELECT user_id FROM access_sessions WHERE token=? AND expires>?').get(digest(token),Date.now());return row?this.principal(row.user_id):null;}
 session(id){const token=randomBytes(32).toString('hex');this.db.prepare('DELETE FROM access_sessions WHERE expires<=?').run(Date.now());this.db.prepare('INSERT INTO access_sessions VALUES(?,?,?)').run(digest(token),id,Date.now()+8*3600000);return token;}
 logout(token){if(token)this.db.prepare('DELETE FROM access_sessions WHERE token=?').run(digest(token));}
 async password(value){assert(typeof value==='string'&&value.length>=12&&value.length<=128,400,'CLAVE_INVALIDA','Usá una contraseña de 12 a 128 caracteres.');const salt=randomBytes(16).toString('hex');return salt+':'+Buffer.from(await scrypt(value,salt,64,passwordOptions)).toString('hex');}
 async login(input,address){
  assert(input&&typeof input.username==='string'&&typeof input.password==='string'&&input.password.length<=128,400,'INGRESO_INVALIDO','Ingresá usuario y contraseña.');
  for(const [key,b] of this.attempts)if(b.until<Date.now())this.attempts.delete(key);
  const key=address,entry=this.attempts.get(key)||{count:0,until:Date.now()+10*60000};entry.count++;this.attempts.set(key,entry);assert(entry.count<=20,429,'INGRESOS_EXCEDIDOS','Demasiados intentos. Esperá diez minutos.');
  const user=this.db.prepare('SELECT * FROM access_users WHERE username=?').get(input.username.trim().toLowerCase());
  const [salt,expected]=(user?.password||'dummy:'+ '00'.repeat(64)).split(':');const actual=Buffer.from(await scrypt(input.password,salt,64,passwordOptions));
  assert(user?.active&&timingSafeEqual(actual,Buffer.from(expected,'hex')),401,'INGRESO_INVALIDO','Usuario o contraseña incorrectos.');
  this.store.audit('user:'+user.id,'auth.login');return {token:this.session(user.id),principal:this.principal(user.id)};
 }
 admin(principal){this.refresh(principal);assert(principal?.admin,403,'ADMIN_REQUERIDO','Sólo el administrador puede gestionar accesos.');}
 validateRole(input){
  assert(input&&typeof input.name==='string'&&input.name.trim().length>=2&&input.name.length<=80&&Array.isArray(input.permissions)&&input.permissions.length<=known.size&&input.permissions.every(p=>known.has(p))&&Array.isArray(input.branches)&&input.branches.length&&input.branches.every(b=>this.branches.includes(b)),400,'ROL_INVALIDO','Indicá nombre, permisos y sucursales válidos.');
  for(const action of Object.keys(actionResources))if(input.permissions.includes('write:'+action))assert(input.permissions.includes('plan:'+action),400,'ROL_INVALIDO','Ejecutar una acción requiere permiso para prepararla.');
  return {name:input.name.trim(),permissions:[...new Set(input.permissions)],branches:[...new Set(input.branches)]};
 }
 saveRole(principal,input,id){
  this.admin(principal);assert(id!=='admin',400,'ADMIN_PROTEGIDO','El rol administrador no se modifica.');const r=this.validateRole(input);
  if(id){assert(this.role(id),404,'ROL_NO_EXISTE','Rol inexistente');this.db.prepare('UPDATE access_roles SET name=?,permissions=?,branches=?,revision=revision+1 WHERE id=?').run(r.name,JSON.stringify(r.permissions),JSON.stringify(r.branches),id);}
  else{id=randomUUID();this.db.prepare('INSERT INTO access_roles VALUES(?,?,?,?,1)').run(id,r.name,JSON.stringify(r.permissions),JSON.stringify(r.branches));}
  this.store.audit(principal.actor,'access.role.saved',id);return {id,...r};
 }
 async saveUser(principal,input,id){
  this.admin(principal);
  assert(input&&typeof input.username==='string'&&/^[a-zA-Z0-9._-]{3,64}$/.test(input.username)&&typeof input.name==='string'&&input.name.trim().length>=2&&input.name.length<=80&&this.role(input.roleId)&&typeof input.active==='boolean',400,'USUARIO_INVALIDO','Indicá usuario, nombre, rol y estado válidos.');
  const password=input.password?await this.password(input.password):null;this.admin(principal);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const old=id&&this.user(id);assert(!id||old,404,'USUARIO_NO_EXISTE','Usuario inexistente');
   if(old?.role_id==='admin'&&old.active&&(!input.active||input.roleId!=='admin'))assert(this.db.prepare("SELECT count(*) n FROM access_users WHERE role_id='admin' AND active=1").get().n>1,409,'ULTIMO_ADMIN','Debe quedar al menos un administrador activo.');
   assert(!this.db.prepare('SELECT 1 FROM access_users WHERE username=? AND id<>?').get(input.username.toLowerCase(),id||''),409,'USUARIO_EXISTE','Ese usuario ya existe.');
   if(id){this.db.prepare('UPDATE access_users SET username=?,name=?,password=?,role_id=?,active=?,revision=revision+1 WHERE id=?').run(input.username.toLowerCase(),input.name.trim(),password||old.password,input.roleId,Number(input.active),id);this.db.prepare('DELETE FROM access_sessions WHERE user_id=?').run(id);}
   else{assert(password,400,'CLAVE_REQUERIDA','La contraseña es obligatoria.');id=randomUUID();this.db.prepare('INSERT INTO access_users VALUES(?,?,?,?,?,?,1)').run(id,input.username.toLowerCase(),input.name.trim(),password,input.roleId,Number(input.active));}
   this.store.audit(principal.actor,'access.user.saved',id);this.db.exec('COMMIT');return {id};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 async setup(input){
  assert(!this.hasUsers(),409,'ACCESO_CONFIGURADO','El administrador ya fue creado.');
  assert(input&&typeof input.username==='string'&&/^[a-zA-Z0-9._-]{3,64}$/.test(input.username)&&typeof input.name==='string'&&input.name.length>=2&&input.name.length<=80,400,'USUARIO_INVALIDO','Indicá usuario y nombre.');
  const password=await this.password(input.password),id=randomUUID();
  this.db.exec('BEGIN IMMEDIATE');try{assert(!this.hasUsers(),409,'ACCESO_CONFIGURADO','El administrador ya fue creado.');this.db.prepare('INSERT INTO access_roles VALUES(?,?,?,?,1)').run('admin','Administrador',JSON.stringify([...known]),JSON.stringify(this.branches));this.db.prepare('INSERT INTO access_users VALUES(?,?,?,?,?,1,1)').run(id,input.username.toLowerCase(),input.name,password,'admin');this.store.audit('user:'+id,'access.setup');this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
  return {token:this.session(id),principal:this.principal(id)};
 }
 list(principal){this.admin(principal);return {roles:this.db.prepare('SELECT * FROM access_roles ORDER BY name').all().map(r=>({...r,permissions:JSON.parse(r.permissions),branches:JSON.parse(r.branches)})),users:this.db.prepare('SELECT id,username,name,role_id AS roleId,active FROM access_users ORDER BY username').all(),permissions:permissionCatalog,resourceRequirements:resourceDomains,branches:this.branches};}
}

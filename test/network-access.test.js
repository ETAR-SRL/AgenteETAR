import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {createNetworkAccess} from '../src/network-access.js';
import {loadLanConfig} from '../src/lan-server.js';
import {createApp} from '../src/app.js';
import {Store} from '../src/store.js';
import {Access} from '../src/access.js';
import {createDemoErp,createDemoKaiqen} from '../src/demo.js';
const origin='https://central.test:4311';
const configured={origins:[origin],cidrs:['192.168.34.0/24']};
const req=(remoteAddress='192.168.34.24',host='central.test:4311',encrypted=true)=>({socket:{remoteAddress,encrypted},headers:{host}});
test('LAN requires real TLS, explicit Host and a permitted private subnet; forwarded headers cannot bypass',()=>{
 const network=createNetworkAccess(configured);
 assert.equal(network.origin(req()),origin);
 assert.equal(network.origin(req('::ffff:192.168.34.55')),origin);
 assert.equal(network.origin(req('127.0.0.1','127.0.0.1:4310',false)),'http://127.0.0.1:4310');
 for(const request of [req('192.168.35.1'),req('8.8.8.8'),req('192.168.34.24','hostile.test:4311'),req('192.168.34.24','central.test:4311',false),req('192.168.34.24','127.0.0.1:4310',false)]){
  request.headers['x-forwarded-for']='127.0.0.1';request.headers['x-forwarded-proto']='https';request.headers['x-forwarded-host']='central.test:4311';
  assert.throws(()=>network.origin(request),{code:'RED_NO_AUTORIZADA'});
 }
 assert.throws(()=>createNetworkAccess().origin(req()),{code:'RED_NO_AUTORIZADA'});
 const ipv6=createNetworkAccess({origins:[origin],cidrs:['fd12:3456::/48']});
 assert.equal(ipv6.origin(req('fd12:3456::1')),origin);
 assert.throws(()=>ipv6.origin(req('fd12:9999::1')),{code:'RED_NO_AUTORIZADA'});
});
test('invalid or overly broad LAN configuration fails closed and TLS is mandatory',()=>{
 for(const config of [
  {origins:['http://central.test'],cidrs:configured.cidrs},
  {origins:['https://central.test/'],cidrs:configured.cidrs},
  {origins:['https://*.test'],cidrs:configured.cidrs},
  {origins:[origin],cidrs:[]},{origins:[],cidrs:configured.cidrs},
  {origins:[origin],cidrs:['0.0.0.0/0']},{origins:[origin],cidrs:['192.168.1.1/8']},
  {origins:[origin],cidrs:['10.0.0.1/99']},{origins:[origin],cidrs:['::/0']},
  {origins:['https://user:pass@central.test'],cidrs:configured.cidrs}
 ])assert.throws(()=>createNetworkAccess(config),{code:'RED_CONFIG_INVALIDA'});
 assert.equal(loadLanConfig({}).lan,null);
 assert.throws(()=>loadLanConfig({LAN_HTTPS_ENABLED:'true'}),{code:'RED_CONFIG_INVALIDA'});
 assert.throws(()=>loadLanConfig({LAN_HTTPS_ENABLED:'true',LAN_ORIGINS:origin,LAN_CIDRS:configured.cidrs[0]}),{code:'RED_TLS_REQUERIDO'});
 assert.throws(()=>loadLanConfig({LAN_HTTPS_ENABLED:'true',LAN_ORIGINS:origin,LAN_CIDRS:configured.cidrs[0],LAN_PORT:'22'}),{code:'RED_CONFIG_INVALIDA'});
});
async function fixture(t,{bootstrap=true,peer='192.168.34.24',encrypted=true}={}){
 const store=new Store(':memory:'),access=new Access(store,['0101','0201']);
 let admin,role,user;
 if(bootstrap){
  admin=await access.setup({username:'admin',name:'Admin',password:'Prueba-lan-1234'});
  role=access.saveRole(admin.principal,{name:'Producción',permissions:['read:catalogo','read:produccion'],branches:['0101']});
  user=await access.saveUser(admin.principal,{username:'operador',name:'Operador',roleId:role.id,active:true,password:'Prueba-lan-1234'});
 }
 const calls=[],erp=createDemoErp(),read=erp.list;
 erp.list=async(...args)=>{calls.push(args[0]);return read(...args);};
 const app=createApp({store,erp,kaiqen:createDemoKaiqen(),branches:['0101','0201'],readKey:'r'.repeat(40),planKey:'p'.repeat(40),network:createNetworkAccess(configured),model:{name:'fake',complete:async()=>({action:'consultar_erp',args:{recurso:'costos',filtros:{}}})}});
 // Unit integration: inject socket properties, never HTTP headers. Real TLS is verified separately.
 const handler=app.listeners('request')[0];app.removeAllListeners('request');
 app.on('request',(request,response)=>{Object.defineProperty(request.socket,'remoteAddress',{value:peer,configurable:true});request.socket.encrypted=encrypted;return handler(request,response);});
 app.listen(0,'127.0.0.1');await once(app,'listening');
 t.after(()=>{app.close();app.closeAllConnections();store.close();});
 const request=(path,{cookie,body,headers={},method}={})=>new Promise((resolve,reject)=>{
  const outgoing=http.request(`http://127.0.0.1:${app.address().port}${path}`,{method:method||(body?'POST':'GET'),headers:{host:'central.test:4311',origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{}),...headers}},response=>{
   let text='';response.setEncoding('utf8');response.on('data',chunk=>{text+=chunk;});
   response.on('end',()=>resolve({status:response.statusCode,headers:new Headers(response.headers),data:response.headers['content-type']?.includes('json')?JSON.parse(text):text}));
  });outgoing.on('error',reject);outgoing.end(body?JSON.stringify(body):undefined);
 });
 return {request,store,access,admin,role,user,calls};
}
test('LAN users log in with a Secure cookie; role, branch and AI restrictions stay enforced',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/')).status,200);
 assert.equal((await f.request('/api/erp/produccion?sucursal=0101')).status,401);
 assert.equal((await f.request('/api/auth/login',{body:{username:'operador',password:'incorrect'}})).status,401);
 const login=await f.request('/api/auth/login',{body:{username:'operador',password:'Prueba-lan-1234'}});
 assert.equal(login.status,200);const setCookie=login.headers.get('set-cookie'),cookie=setCookie.split(';')[0];
 assert.match(setCookie,/^__Secure-central_auth=/);assert.match(setCookie,/; Secure/);assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);assert.ok(!setCookie.includes('Domain='));
 assert.equal((await f.request('/api/ui/session',{body:{},cookie})).data.role,'reader');
 assert.equal((await f.request('/api/erp/produccion?sucursal=0101',{cookie})).status,200);
 const costs=await f.request('/api/erp/costos?sucursal=0101',{cookie});assert.equal(costs.status,403);assert.equal(costs.data.error.message,'Esto no podés leerlo.');
 assert.equal((await f.request('/api/erp/produccion?sucursal=0201',{cookie})).status,403);
 assert.equal((await f.request('/api/admin/access',{cookie})).status,403);
 assert.equal((await f.request('/api/changes/preview',{cookie,body:{action:'pedidoVenta'}})).status,403);
 const chat=await f.request('/api/agent/chat',{cookie,body:{text:'mostrame los costos'}});assert.equal(chat.status,200);assert.equal(chat.data.answer,'Esto no podés leerlo.');assert.ok(!f.calls.includes('costos'));
 assert.equal((await f.request('/api/auth/logout',{cookie,body:{},headers:{origin:'https://hostile.test'}})).status,403);
 const logout=await f.request('/api/auth/logout',{cookie,body:{}});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0; Secure/);
 assert.equal((await f.request('/api/erp/produccion?sucursal=0101',{cookie})).status,401);
});
test('first administrator cannot be claimed by a remote LAN browser',async t=>{
 const f=await fixture(t,{bootstrap:false});
 assert.deepEqual((await f.request('/api/auth/state')).data,{setupRequired:true,setupAllowed:false,user:null});
 assert.equal((await f.request('/api/auth/setup',{body:{username:'intruder',name:'Remote',password:'Prueba-lan-1234'}})).status,403);
 assert.equal(f.access.hasUsers(),false);
});
test('HTTP, foreign networks and forged host are rejected before bearer authentication',async t=>{
 for(const options of [{encrypted:false},{peer:'192.168.50.1'}]){
  const f=await fixture(t,{...options,bootstrap:false});
  assert.equal((await f.request('/api/erp/costos?sucursal=0101',{headers:{authorization:'Bearer '+'r'.repeat(40),'x-forwarded-for':'127.0.0.1','x-forwarded-proto':'https'}})).status,403);
 }
 const f=await fixture(t);
 assert.equal((await f.request('/health',{headers:{host:'hostile.test:4311'}})).status,403);
 const login=await f.request('/api/auth/login',{body:{username:'operador',password:'Prueba-lan-1234'}}),cookie=login.headers.get('set-cookie').split(';')[0];
 f.access.saveRole(f.admin.principal,{name:'Sin permisos',permissions:[],branches:['0101']},f.role.id);
 assert.equal((await f.request('/api/erp/produccion?sucursal=0101',{cookie})).status,403);
 await f.access.saveUser(f.admin.principal,{username:'operador',name:'Operador',active:false,roleId:f.role.id},f.user.id);
 assert.equal((await f.request('/api/erp/produccion?sucursal=0101',{cookie})).status,401);
});

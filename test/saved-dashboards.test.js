import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {savedDashboards} from '../src/saved-dashboards.js';
import {assert as check} from '../src/errors.js';
import {createApp} from '../src/app.js';
import {createDemoErp,createDemoKaiqen} from '../src/demo.js';
import {Access} from '../src/access.js';
import {once} from 'node:events';
const input={name:'Ventas mensuales',period:'este mes',dashboard:{resource:'resumenVentas',filters:{sucursal:'0101',producto:'Z1',desde:'2026-10-01',hasta:'2026-10-21',agrupar:'mes'}}};
const authorize=(p,r,b)=>check(p.allowed&&r==='resumenVentas'&&b==='0101',403,'LECTURA_DENEGADA','Esto no podés leerlo.');
test('saves only configuration, isolates owners, recomputes dates and rechecks permissions after revision',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());let date=new Date('2026-10-21T12:00:00Z');const dashboards=savedDashboards(store,{authorize,clock:()=>date});const p={userId:'one',allowed:true,revision:1},other={userId:'two',allowed:true};
 const saved=dashboards.save(p,input);assert.equal(dashboards.list(p).length,1);assert.deepEqual(dashboards.list(other),[]);assert.throws(()=>dashboards.open(other,saved.id),{status:404});assert.throws(()=>dashboards.remove(other,saved.id),{status:404});assert.equal(saved.dashboard.filters.desde,undefined);
 date=new Date('2026-11-04T12:00:00Z');const reopened=dashboards.open({...p,revision:2},saved.id);assert.equal(reopened.dashboard.filters.desde,'2026-11-01');assert.equal(reopened.dashboard.filters.hasta,'2026-11-04');assert.equal(reopened.dashboard.filters.producto,'Z1');
 assert.deepEqual(dashboards.list({...p,allowed:false}),[]);assert.throws(()=>dashboards.open({...p,allowed:false},saved.id),{status:403});assert.throws(()=>dashboards.save({...p,allowed:false},input),{status:403});
 const another=savedDashboards(store,{authorize,clock:()=>date});assert.equal(another.list(p).length,1);dashboards.remove(p,saved.id);assert.deepEqual(dashboards.list(p),[]);
});
test('fixed dates remain fixed; malformed resources, dates, branches, snapshots and service identities rejected',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const d=savedDashboards(store,{authorize}),p={userId:'one',allowed:true};const s=d.save(p,{...input,period:'fijo'});assert.equal(d.open(p,s.id).dashboard.filters.hasta,'2026-10-21');
 for(const change of [{period:'arbitrary'},{data:[{secret:1}]},{owner:'two'},{name:''},{dashboard:{resource:'costos',filters:{sucursal:'0101'}}},{dashboard:{resource:'resumenVentas',filters:{sucursal:'0201'}}},{dashboard:{resource:'resumenVentas',filters:{sucursal:'0101',desde:'2026-02-30'}}}])assert.throws(()=>d.save(p,{...input,...change}));
 assert.throws(()=>d.list({actor:'reader:service'}),{status:403});
});
test('HTTP endpoints require personal login, isolate users and reopen fresh ERP data through guarded chat',async t=>{
 const store=new Store(':memory:'),access=new Access(store,['0101']);const admin=await access.setup({username:'admin',name:'Admin',password:'Clave-de-prueba-123'});const role=access.saveRole(admin.principal,{name:'Sin ventas',permissions:['read:catalogo'],branches:['0101']});await access.saveUser(admin.principal,{username:'lector',name:'Lector',roleId:role.id,active:true,password:'Clave-de-prueba-123'});
 let reads=0;const base=createDemoErp(),erp={...base,list:async(r,p)=>{if(r==='resumenVentas'){reads++;return {kind:'dashboard',data:[{importeNeto:String(reads)}],scope:{sucursal:'0101',desde:p.get('desde'),hasta:p.get('hasta')},meta:{recurso:r}};}return base.list(r,p);}};
 const server=createApp({erp,kaiqen:createDemoKaiqen(),store,mode:'demo',readKey:'r'.repeat(40),planKey:'p'.repeat(40)});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();store.close();});const origin=`http://127.0.0.1:${server.address().port}`;
 const login=async username=>{const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username,password:'Clave-de-prueba-123'})});assert.equal(r.status,200);return {origin,'content-type':'application/json',cookie:r.headers.get('set-cookie').split(';')[0]};};const a=await login('admin'),b=await login('lector');
 const request=(path,headers,method='GET',body)=>fetch(origin+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});assert.equal((await fetch(origin+'/api/dashboards')).status,401);
 const response=await request('/api/dashboards',a,'POST',{...input,dashboard:{...input.dashboard,filters:{sucursal:'0101'}}});assert.equal(response.status,201);const saved=await response.json();assert.equal(reads,0);
 assert.deepEqual((await(await request('/api/dashboards',b)).json()).data,[]);assert.equal((await request('/api/dashboards/'+saved.id,b)).status,404);assert.equal((await request('/api/dashboards',b,'POST',input)).status,403);
 const current=await(await request('/api/dashboards/'+saved.id,a)).json();for(let i=1;i<=2;i++){const r=await request('/api/agent/chat',a,'POST',{text:'Abrir dashboard guardado',dashboard:current.dashboard,context:{sucursal:'0101'}});assert.equal(r.status,200);const result=await r.json();assert.equal(result.evidence[0].result.data[0].importeNeto,String(i));}assert.equal(reads,2);
});

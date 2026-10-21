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

test('sharing grants configuration only, supports users and current roles, owner-only management and immediate revocation',t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const owner={userId:'owner',roleId:'owners',allowed:true},user={userId:'viewer',roleId:'sales',allowed:true},other={userId:'other',roleId:'none',allowed:true};
 const options={users:[{id:'viewer',name:'Viewer'}],roles:[{id:'sales',name:'Sales'}]};const d=savedDashboards(store,{authorize,recipients:()=>options}),saved=d.save(owner,input);
 assert.deepEqual(d.list(user),[]);assert.throws(()=>d.sharing(user,saved.id),{status:404});
 d.share(owner,saved.id,{targets:[{kind:'user',target:'viewer'}]});assert.equal(d.open(user,saved.id).owned,false);assert.equal(d.list(user).length,1);assert.equal(d.open(owner,saved.id).owned,true);
 assert.throws(()=>d.share(user,saved.id,{targets:[]}),{status:404});assert.throws(()=>d.remove(user,saved.id),{status:404});assert.throws(()=>d.open(other,saved.id),{status:404});
 assert.deepEqual(d.list({...user,allowed:false}),[]);assert.throws(()=>d.open({...user,allowed:false},saved.id),{status:403});
 for(const targets of [[{kind:'user',target:'nonexistent'}],[{kind:'all',target:'sales'}],[{kind:'role',target:'sales',owner:true}],[{kind:'role',target:'sales'},{kind:'role',target:'sales'}]])assert.throws(()=>d.share(owner,saved.id,{targets}));assert.equal(d.open(user,saved.id).owned,false,'invalid share update cannot remove prior grants');
 d.share(owner,saved.id,{targets:[{kind:'role',target:'sales'}]});assert.equal(d.list(user).length,1);assert.deepEqual(d.list({...user,roleId:'changed'}),[]);assert.throws(()=>d.open({...user,roleId:'changed'},saved.id),{status:404});
 d.share(owner,saved.id,{targets:[]});assert.deepEqual(d.list(user),[]);assert.throws(()=>d.open(user,saved.id),{status:404});
 d.share(owner,saved.id,{targets:[{kind:'role',target:'sales'}]});d.remove(owner,saved.id);assert.equal(store.db.prepare('SELECT count(*) n FROM dashboard_shares').get().n,0);
});

test('HTTP sharing directory excludes denied users/roles, rechecks actual permissions and roles before opening',async t=>{
 const store=new Store(':memory:'),access=new Access(store,['0101','0201']);const admin=await access.setup({username:'admin',name:'Admin',password:'Clave-de-prueba-123'}),permissions=['read:ventas','read:clientes','read:preciosVenta','read:catalogo'];
 const role=access.saveRole(admin.principal,{name:'Ventas',permissions,branches:['0101']});const denied=access.saveRole(admin.principal,{name:'Sin ventas',permissions:['read:catalogo'],branches:['0101']}),otherBranch=access.saveRole(admin.principal,{name:'Otra sucursal',permissions,branches:['0201']});
 const viewer=await access.saveUser(admin.principal,{username:'viewer',name:'Viewer',roleId:role.id,active:true,password:'Clave-de-prueba-123'});await access.saveUser(admin.principal,{username:'blocked',name:'Blocked',roleId:denied.id,active:true,password:'Clave-de-prueba-123'});await access.saveUser(admin.principal,{username:'disabled',name:'Disabled',roleId:role.id,active:false,password:'Clave-de-prueba-123'});
 const server=createApp({erp:createDemoErp(),kaiqen:createDemoKaiqen(),store,branches:['0101','0201'],mode:'demo',readKey:'r'.repeat(40),planKey:'p'.repeat(40)});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();store.close();});const origin=`http://127.0.0.1:${server.address().port}`;
 const headers=p=>({origin,'content-type':'application/json',Authorization:'Bearer '+access.session(p)}),a=headers(admin.principal.userId),v=headers(viewer.id),request=(path,h,method='GET',value)=>fetch(origin+path,{headers:h,method,...(value?{body:JSON.stringify(value)}:{})});
 const saved=await(await request('/api/dashboards',a,'POST',input)).json(),path='/api/dashboards/'+saved.id;
 let options=await(await request(path+'/sharing',a)).json();assert.ok(options.users.some(u=>u.id===viewer.id));assert.ok(options.users.every(u=>Object.keys(u).sort().join(',')==='id,name'));assert.ok(!options.users.some(u=>/Blocked|Disabled/.test(u.name)));assert.ok(options.roles.some(r=>r.id===role.id));assert.ok(!options.roles.some(r=>[denied.id,otherBranch.id].includes(r.id)));
 assert.equal((await request(path+'/sharing',v)).status,404);assert.equal((await request(path+'/sharing',a,'PUT',{targets:[{kind:'role',target:otherBranch.id}]})).status,400);
 assert.equal((await request(path+'/sharing',a,'PUT',{targets:[{kind:'role',target:role.id}]})).status,200);assert.equal((await request(path,v)).status,200);assert.equal((await request(path,v,'DELETE')).status,404);assert.equal((await request(path+'/sharing',v,'PUT',{targets:[]})).status,404);
 access.saveRole(admin.principal,{name:'Ventas restringidas',permissions:['read:catalogo'],branches:['0101']},role.id);assert.equal((await request(path,v)).status,403);assert.deepEqual((await(await request('/api/dashboards',v)).json()).data,[]);
 access.saveRole(admin.principal,{name:'Ventas',permissions,branches:['0101']},role.id);assert.equal((await request(path,v)).status,200);
 access.saveRole(admin.principal,{name:'Ventas otra sucursal',permissions,branches:['0201']},role.id);assert.equal((await request(path,v)).status,403);
 access.saveRole(admin.principal,{name:'Ventas',permissions,branches:['0101']},role.id);
 await request(path+'/sharing',a,'PUT',{targets:[]});assert.equal((await request(path,v)).status,404);
 await request(path+'/sharing',a,'PUT',{targets:[{kind:'user',target:viewer.id}]});assert.equal((await request(path,v)).status,200);
});

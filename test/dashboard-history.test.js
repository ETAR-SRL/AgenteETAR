import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {savedDashboards} from '../src/saved-dashboards.js';
import {createDashboardChat} from '../src/intelligence/dashboard-chat.js';
const input={name:'Ventas',period:'este mes',dashboard:{resource:'resumenVentas',filters:{sucursal:'0101'}}};
function fixture(t){const store=new Store(':memory:');t.after(()=>store.close());let tick=0;const names=new Map([['u','Ana'],['r','Ventas']]),p={userId:'owner',name:'Dueña',username:'owner',actor:'user:owner:revision',allowed:true};const d=savedDashboards(store,{clock:()=>new Date(Date.UTC(2026,9,21,12,0,tick++)),authorize:(p,r,b)=>{if(!p.allowed||b!=='0101')throw Object.assign(new Error('denegado'),{status:403});},recipients:()=>({users:[{id:'u',name:names.get('u')}],roles:[{id:'r',name:names.get('r')}]}),assignedNames:ts=>ts.map(t=>({...t,name:names.get(t.target)}))});return {store,d,p,names};}
test('history snapshots exact deltas and actors, distinguishes no-ops, survives renames and blocks nonowners',t=>{
 const {d,p,names}=fixture(t),saved=d.save(p,input);d.share(p,saved.id,{targets:[{kind:'user',target:'u'},{kind:'role',target:'r'}]});d.share(p,saved.id,{targets:[{kind:'role',target:'r'}]});d.unshare(p,saved.id,{targets:[{kind:'role',target:'r'}]});d.unshare(p,saved.id,{targets:[{kind:'role',target:'r'}]});names.set('u','Renombrada');p.name='Otra';
 const h=d.history(p,saved.id);assert.equal(h.total,4);assert.deepEqual(h.data[0].removed,[]);assert.equal(h.data[1].removed[0].name,'Ventas');assert.equal(h.data[2].removed[0].name,'Ana');assert.equal(h.data[3].added.length,2);assert.equal(h.data[3].who.name,'Dueña (owner)');assert.ok(h.data.every(r=>!r.legacy));
 assert.throws(()=>d.history({...p,userId:'someone'},saved.id),{status:404});assert.throws(()=>d.history({...p,allowed:false},saved.id),{status:403});assert.throws(()=>d.history(p,saved.id,{page:0}),{status:400});
});
test('legacy audit is explicitly incomplete, remains isolated, and pagination reads all events without duplicates',t=>{
 const {store,d,p}=fixture(t),saved=d.save(p,input),other=d.save(p,{...input,name:'Otra'});store.audit(p.actor,'dashboard.sharing.updated',saved.id);store.audit(p.actor,'dashboard.sharing.revoked',JSON.stringify({dashboard:saved.id,targets:[{kind:'user',target:'u'}]}));store.audit(p.actor,'dashboard.sharing.updated',other.id);store.audit(p.actor,'dashboard.sharing.revoked','malformed-json');
 for(let i=0;i<30;i++)d.share(p,saved.id,{targets:i%2?[{kind:'user',target:'u'}]:[]});const first=d.history(p,saved.id),second=d.history(p,saved.id,{page:2});assert.equal(first.total,32);assert.equal(first.data.length,25);assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);assert.equal(second.data.length,7);const rows=[...first.data,...second.data];assert.equal(new Set(rows.map(r=>r.key)).size,32);assert.equal(rows.filter(r=>r.legacy).length,2);assert.ok(rows.filter(r=>r.legacy).every(r=>!r.added&&!r.removed));
});
test('history insert failure rolls back sharing and audit atomically',t=>{
 const {store,d,p}=fixture(t),saved=d.save(p,input);store.db.exec("CREATE TRIGGER reject_history BEFORE INSERT ON dashboard_history BEGIN SELECT RAISE(ABORT,'test failure'); END;");assert.throws(()=>d.share(p,saved.id,{targets:[{kind:'user',target:'u'}]}));assert.equal(d.sharing(p,saved.id).selected.length,0);assert.equal(d.history(p,saved.id).total,0);
});
test('chat resolves dashboard context, ambiguous names and more history locally, without fabricating legacy recipients',async t=>{
 const {d,p,store}=fixture(t),saved=d.save(p,input);for(let i=0;i<28;i++)d.share(p,saved.id,{targets:i%2?[{kind:'user',target:'u'}]:[]});store.audit(p.actor,'dashboard.sharing.updated',saved.id);const conversation={messages:[]},chat=createDashboardChat({dashboards:d,principal:()=>p});const ask=text=>chat({text,conversation,branch:'0101'});
 let r=await ask('Mostrame el historial del dashboard Ventas');assert.match(r.answer,/Historial de Ventas/);assert.match(r.answer,/Dueña.*compartió con usuario Ana/);assert.ok(r.choices.some(c=>/más historial/.test(c.label)));r=await ask('Mostrame más historial de este dashboard');assert.match(r.answer,/Página 2/);assert.match(r.answer,/29 evento/);
 r=await ask('¿Quién quitó accesos de este dashboard?');assert.match(r.answer,/Historial/);
 d.save(p,input);r=await ask('mostrame el historial del dashboard Ventas');assert.equal(r.choices.length,2);r=await ask('Opción 1');assert.match(r.answer,/Historial/);
});

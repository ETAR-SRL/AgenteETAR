import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {savedDashboards} from '../src/saved-dashboards.js';
import {createDashboardChat} from '../src/intelligence/dashboard-chat.js';
function setup(t){const store=new Store(':memory:');t.after(()=>store.close());let now=new Date('2026-10-21T12:00:00Z'),p={userId:'owner',allowed:true,branches:['0101']};const config={clock:()=>now,authorize:(p,r,b)=>{if(!p.allowed||!p.branches.includes(b))throw Object.assign(new Error('Esto no podés leerlo.'),{status:403});},recipients:()=>({users:[],roles:[]})},d=savedDashboards(store,config),saved=d.save(p,{name:'Ventas',period:'este mes',dashboard:{resource:'resumenVentas',filters:{sucursal:'0101'}}});return {store,d,saved,config,p,now:v=>{now=new Date(v);},setPrincipal:v=>{p=v;},chat:conversation=>{const chat=createDashboardChat({dashboards:d,principal:()=>p,clock:()=>now});return text=>chat({text,conversation,branch:'0101'});}};}
test('personal history filters persist by user, recalculate relative dates and revalidate owner, permissions and branches',t=>{
 const f=setup(t),preset=f.d.saveHistoryFilters(f.p,{name:'Control mensual',dashboardId:f.saved.id,period:'este mes',filters:{autor:'owner',destinatario:'ana',rol:'ventas',tipo:'quitados',desde:'2026-10-01',hasta:'2026-10-21'}});assert.equal(preset.filters.desde,undefined);f.now('2026-11-04T12:00:00Z');let current=f.d.getHistoryFilters({...f.p,revision:2},preset.id);assert.equal(current.filters.desde,'2026-11-01');assert.equal(current.filters.hasta,'2026-11-04');assert.equal(current.filters.destinatario,'ana');
 const other={...f.p,userId:'other'};assert.deepEqual(f.d.listHistoryFilters(other),[]);assert.throws(()=>f.d.getHistoryFilters(other,preset.id),{status:404});assert.throws(()=>f.d.saveHistoryFilters(other,{name:'No',dashboardId:f.saved.id,filters:{}}),{status:404});
 assert.deepEqual(f.d.listHistoryFilters({...f.p,allowed:false}),[]);assert.throws(()=>f.d.getHistoryFilters({...f.p,allowed:false},preset.id),{status:403});assert.deepEqual(f.d.listHistoryFilters({...f.p,branches:['0201']}),[]);
 assert.equal(savedDashboards(f.store,f.config).getHistoryFilters(f.p,preset.id).name,'Control mensual');f.d.remove(f.p,f.saved.id);assert.deepEqual(f.d.listHistoryFilters(f.p),[]);assert.throws(()=>f.d.getHistoryFilters(f.p,preset.id),{status:404});
});
test('fixed dates and strict input validation prevent saving data, foreign owners, arbitrary filters or dashboards',t=>{
 const f=setup(t),body={name:'Fechas fijas',dashboardId:f.saved.id,filters:{desde:'2026-10-01',hasta:'2026-10-10'},period:'fijo'},preset=f.d.saveHistoryFilters(f.p,body);f.now('2026-12-01T12:00:00Z');assert.equal(f.d.getHistoryFilters(f.p,preset.id).filters.hasta,'2026-10-10');
 for(const extra of [{owner:'other'},{data:[1]},{dashboardId:undefined},{name:''},{filters:{sql:'SELECT'}},{period:'arbitrary'},{filters:{hasta:'2026-02-30'}}])assert.throws(()=>f.d.saveHistoryFilters(f.p,{...body,...extra}));assert.throws(()=>f.d.listHistoryFilters({actor:'service'}),{status:403});
});
test('chat saves only the missing name, restores filters in a new conversation and exposes Excel with same scope',async t=>{
 const f=setup(t),conversation={messages:[],dashboardFocus:{id:f.saved.id},dashboardHistory:{id:f.saved.id,branch:'0101',filters:{tipo:'quitados',desde:'2026-10-01',hasta:'2026-10-21'}}},ask=f.chat(conversation);let r=await ask('Guardá estos filtros');assert.match(r.answer,/nombre/);r=await ask('Control mensual');assert.match(r.answer,/Guardé para vos/);assert.equal(f.d.listHistoryFilters(f.p)[0].name,'Control mensual');
 f.now('2026-11-04T12:00:00Z');const fresh={messages:[]},again=f.chat(fresh);r=await again('Aplicá los filtros Control mensual');assert.equal(r.historyExport.filters.tipo,'quitados');assert.equal(r.historyExport.filters.desde,'2026-11-01');assert.equal(r.historyExport.id,f.saved.id);assert.equal(r.selectedBranch,'0101');r=await again('Exportá con mis filtros Control mensual en Excel');assert.equal(r.historyExport.filters.hasta,'2026-11-04');r=await again('Mostrame mis filtros de historial');assert.equal(r.choices.length,1);
 await ask('Guardalos como Control mensual');r=await again('Aplicá los filtros Control mensual');assert.equal(r.choices.length,2);r=await again('Opción 2');assert.equal(r.historyExport.id,f.saved.id);
 f.setPrincipal({...f.p,allowed:false});r=await again('Aplicá los filtros Control mensual');assert.equal(r.historyExport,undefined);assert.match(r.answer,/No encontré filtros/);
});

test('relative period intent remains monthly on the first day rather than becoming today',async t=>{
 const f=setup(t);f.now('2026-11-01T12:00:00Z');const ask=f.chat({messages:[]});await ask('Historial del dashboard Ventas este mes');await ask('Guardalos como Mes actual');const preset=f.d.listHistoryFilters(f.p)[0];assert.equal(preset.period,'este mes');f.now('2026-11-03T12:00:00Z');assert.equal(f.d.getHistoryFilters(f.p,preset.id).filters.desde,'2026-11-01');assert.equal(f.d.getHistoryFilters(f.p,preset.id).filters.hasta,'2026-11-03');
});

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

test('rename preserves criteria and ownership, deletion is private and reversible with current permissions',t=>{
 const f=setup(t),body={name:'Revisión',dashboardId:f.saved.id,filters:{tipo:'quitados',autor:'owner'},period:'este mes'},one=f.d.saveHistoryFilters(f.p,body),other={...f.p,userId:'other'};
 assert.throws(()=>f.d.renameHistoryFilters(other,one.id,{name:'No'}),{status:404});assert.throws(()=>f.d.removeHistoryFilters(other,one.id),{status:404});assert.throws(()=>f.d.renameHistoryFilters({...f.p,allowed:false},one.id,{name:'No'}),{status:403});
 const renamed=f.d.renameHistoryFilters(f.p,one.id,{name:'Control mensual'});assert.equal(renamed.name,'Control mensual');assert.deepEqual(renamed.filters,one.filters);assert.equal(renamed.period,one.period);assert.equal(renamed.dashboardId,one.dashboardId);
 for(const bad of [{name:''},{name:'x'.repeat(101)},{name:'Nombre',owner:'other'},{name:1}])assert.throws(()=>f.d.renameHistoryFilters(f.p,one.id,bad),{status:400});
 const removed=f.d.removeHistoryFilters(f.p,one.id);assert.equal(removed.deleted,true);assert.deepEqual(f.d.listHistoryFilters(f.p),[]);assert.throws(()=>f.d.getHistoryFilters(f.p,one.id),{status:404});assert.throws(()=>f.d.renameHistoryFilters(f.p,one.id,{name:'No'}),{status:404});assert.throws(()=>f.d.restoreHistoryFilters(other,one.id),{status:404});assert.throws(()=>f.d.restoreHistoryFilters({...f.p,allowed:false},one.id),{status:403});
 f.d.restoreHistoryFilters(f.p,one.id);assert.equal(f.d.getHistoryFilters(f.p,one.id).name,'Control mensual');assert.equal(f.d.getHistoryFilters(f.p,one.id).filters.tipo,renamed.filters.tipo);assert.equal(f.d.getHistoryFilters(f.p,one.id).filters.autor,renamed.filters.autor);
});
test('chat rename/delete handle missing names and ambiguity, preserve other presets and can undo deletion',async t=>{
 const f=setup(t),save=name=>f.d.saveHistoryFilters(f.p,{name,dashboardId:f.saved.id,filters:{tipo:'quitados'}});save('Mensual');save('Otro');const ask=f.chat({messages:[]});let r=await ask('Renombrá el filtro Mensual a Control mensual');assert.match(r.answer,/Renombré/);r=await ask('Renombrá mis filtros Control mensual');assert.match(r.answer,/Qué nombre/);r=await ask('Revisión del mes');assert.match(r.answer,/Revisión del mes/);assert.equal(f.d.listHistoryFilters(f.p).length,2);
 save('Revisión del mes');r=await ask('Eliminá el filtro Revisión del mes');assert.equal(r.choices.length,2);assert.equal(f.d.listHistoryFilters(f.p).length,3);r=await ask('Opción 1');assert.match(r.answer,/Eliminé/);assert.equal(f.d.listHistoryFilters(f.p).length,2);assert.ok(f.d.listHistoryFilters(f.p).some(p=>p.name==='Otro'));r=await ask('Deshacé la eliminación');assert.match(r.answer,/Restauré/);assert.equal(f.d.listHistoryFilters(f.p).length,3);
 r=await ask('Borrá mis filtros Otro');assert.match(r.answer,/Eliminé/);r=await ask('Aplicá los filtros Otro');assert.equal(r.historyExport,undefined);
});
test('migration keeps existing presets available and excludes soft-deleted records after restart',t=>{
 const f=setup(t);f.store.db.exec('DROP TABLE history_filter_presets;CREATE TABLE history_filter_presets(id TEXT PRIMARY KEY,owner TEXT NOT NULL,dashboard_id TEXT NOT NULL,name TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL);');const upgraded=savedDashboards(f.store,f.config),saved=upgraded.saveHistoryFilters(f.p,{name:'Migrado',dashboardId:f.saved.id,filters:{tipo:'agregados'}});assert.equal(upgraded.getHistoryFilters(f.p,saved.id).name,'Migrado');upgraded.removeHistoryFilters(f.p,saved.id);assert.deepEqual(savedDashboards(f.store,f.config).listHistoryFilters(f.p),[]);
});

test('ambiguous rename separators cannot silently change the wrong preset',async t=>{
 const f=setup(t),preset=f.d.saveHistoryFilters(f.p,{name:'Accesos a clientes',dashboardId:f.saved.id,filters:{}}),ask=f.chat({messages:[]});let r=await ask('Renombrá el filtro Accesos a clientes a Control');assert.match(r.answer,/comillas/);assert.equal(f.d.getHistoryFilters(f.p,preset.id).name,'Accesos a clientes');r=await ask('Renombrá el filtro «Accesos a clientes» a «Control»');assert.match(r.answer,/Renombré/);assert.equal(f.d.getHistoryFilters(f.p,preset.id).name,'Control');
});

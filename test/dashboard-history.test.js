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

test('history filters match actor or recipient and role by identity, inclusive Argentina dates and all pages',t=>{
 const {d,p,store}=fixture(t),saved=d.save(p,input);d.share(p,saved.id,{targets:[{kind:'user',target:'u'}]});d.share(p,saved.id,{targets:[{kind:'user',target:'u'},{kind:'role',target:'r'}]});d.unshare(p,saved.id,{targets:[{kind:'role',target:'r'}]});
 assert.equal(d.history(p,saved.id,{filters:{usuario:'u'}}).total,1);assert.equal(d.history(p,saved.id,{filters:{usuario:'owner'}}).total,3);assert.equal(d.history(p,saved.id,{filters:{rol:'r'}}).total,2);assert.equal(d.history(p,saved.id,{filters:{usuario:'u',rol:'r'}}).total,0);
 assert.equal(d.history(p,saved.id,{filters:{desde:'2026-10-21',hasta:'2026-10-21'}}).total,3);assert.equal(d.history(p,saved.id,{filters:{hasta:'2026-10-20'}}).total,0);
 for(const f of [{desde:'2026-02-30'},{desde:'2026-10-22',hasta:'2026-10-21'},{sql:'x'},{usuario:{id:'u'}}])assert.throws(()=>d.history(p,saved.id,{filters:f}));
 store.db.prepare('UPDATE dashboard_history SET at=? WHERE seq=(SELECT min(seq) FROM dashboard_history)').run('2026-10-21T02:59:59.999Z');assert.equal(d.history(p,saved.id,{filters:{hasta:'2026-10-20'}}).total,1);assert.equal(d.history(p,saved.id,{filters:{desde:'2026-10-21'}}).total,2);
});
test('chat preserves combined filters across pagination and Excel requests, resolves identities and dates',async t=>{
 const {d,p}=fixture(t),saved=d.save(p,input);for(let i=0;i<30;i++){d.share(p,saved.id,{targets:[{kind:'user',target:'u'}]});d.unshare(p,saved.id,{targets:[{kind:'user',target:'u'}]});}
 const conversation={messages:[]},chat=createDashboardChat({dashboards:d,principal:()=>p,clock:()=>new Date('2026-10-21T12:00:00Z')}),ask=text=>chat({text,conversation,branch:'0101'});
 let r=await ask('Mostrame el historial del dashboard Ventas del usuario Ana desde 21/10/2026 hasta 21/10/2026');assert.equal(r.historyExport.filters.usuario,'u');assert.equal(r.historyExport.filters.desde,'2026-10-21');assert.match(r.answer,/60 evento/);
 r=await ask('Mostrame más historial de este dashboard');assert.match(r.answer,/Página 2/);assert.equal(r.historyExport.filters.usuario,'u');r=await ask('descargalo en Excel');assert.equal(r.historyExport.filters.hasta,'2026-10-21');assert.equal(r.historyExport.filters.usuario,'u');
 await assert.rejects(()=>ask('filtralo desde 2026/10/01'),{status:400});
 r=await ask('Exportá el historial del dashboard Ventas este mes en Excel');assert.equal(r.historyExport.filters.desde,'2026-10-01');assert.equal(r.historyExport.filters.usuario,undefined);
});
test('Excel is a real workbook, contains all filtered pages and treats untrusted names as literal text',async t=>{
 const {historyExcel}=await import('../src/history-excel.js'),{default:ExcelJS}=await import('exceljs');const {d,p,names}=fixture(t),saved=d.save(p,input);names.set('u','=HYPERLINK("https://example.com")');for(let i=0;i<30;i++){d.share(p,saved.id,{targets:[{kind:'user',target:'u'}]});d.unshare(p,saved.id,{targets:[{kind:'user',target:'u'}]});}
 const buffer=await historyExcel({dashboards:d,principal:p,id:saved.id,filters:{usuario:'u'}}),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const sheet=workbook.getWorksheet('Historial');assert.equal(sheet.rowCount,67);assert.equal(sheet.getCell('E8').value,'=HYPERLINK("https://example.com")');assert.equal(sheet.getCell('E8').formula,undefined);assert.match(sheet.getCell('B3').value,/usuario/);assert.equal(workbook.worksheets.length,2);assert.equal(sheet.views[0].ySplit,7);
 await assert.rejects(()=>historyExcel({dashboards:d,principal:{...p,userId:'other'},id:saved.id,filters:{}}),{status:404});
});

test('change types select confirmed deltas, correlate subjects, exclude incomplete legacy and project mixed events',t=>{
 const {d,p,store}=fixture(t),saved=d.save(p,input);d.share(p,saved.id,{targets:[{kind:'user',target:'u'}]});d.share(p,saved.id,{targets:[{kind:'role',target:'r'}]});d.share(p,saved.id,{targets:[{kind:'role',target:'r'}]});d.unshare(p,saved.id,{targets:[{kind:'role',target:'r'}]});store.audit(p.actor,'dashboard.sharing.updated',saved.id);
 assert.equal(d.history(p,saved.id).total,5);const added=d.history(p,saved.id,{filters:{tipo:'agregados'}}),removed=d.history(p,saved.id,{filters:{tipo:'quitados'}}),noop=d.history(p,saved.id,{filters:{tipo:'sin_cambios'}});assert.equal(added.total,2);assert.equal(removed.total,2);assert.equal(noop.total,1);assert.ok(added.data.every(e=>e.added.length&&!e.removed.length&&!e.legacy));assert.ok(removed.data.every(e=>e.removed.length&&!e.added.length&&!e.legacy));assert.ok(noop.data.every(e=>!e.added.length&&!e.removed.length&&!e.legacy));
 assert.equal(d.history(p,saved.id,{filters:{tipo:'agregados',usuario:'u'}}).total,1);assert.equal(d.history(p,saved.id,{filters:{tipo:'agregados',rol:'r'}}).total,1);assert.equal(d.history(p,saved.id,{filters:{tipo:'quitados',rol:'r'}}).total,1);assert.equal(d.history(p,saved.id,{filters:{tipo:'sin_cambios',usuario:'owner'}}).total,1);assert.equal(d.history(p,saved.id,{filters:{tipo:'sin_cambios',rol:'r'}}).total,0);
 assert.throws(()=>d.history(p,saved.id,{filters:{tipo:'otro'}}),{status:400});assert.throws(()=>d.history({...p,allowed:false},saved.id,{filters:{tipo:'agregados'}}),{status:403});
});
test('chat change types persist with dates, user, pagination and Excel and reject conflicting types',async t=>{
 const {d,p}=fixture(t),saved=d.save(p,input);for(let i=0;i<30;i++){d.share(p,saved.id,{targets:[{kind:'user',target:'u'}]});d.unshare(p,saved.id,{targets:[{kind:'user',target:'u'}]});}d.unshare(p,saved.id,{targets:[{kind:'user',target:'u'}]});
 const conversation={messages:[]},chat=createDashboardChat({dashboards:d,principal:()=>p,clock:()=>new Date('2026-10-21T12:00:00Z')}),ask=text=>chat({text,conversation,branch:'0101'});
 let r=await ask('Mostrame el historial del dashboard Ventas del usuario Ana este mes solo accesos agregados');assert.equal(r.historyExport.filters.tipo,'agregados');assert.equal(r.historyExport.filters.usuario,'u');assert.match(r.answer,/30 evento/);assert.doesNotMatch(r.answer,/quitó acceso/);
 r=await ask('Mostrame más historial de este dashboard');assert.match(r.answer,/Página 2/);assert.equal(r.historyExport.filters.tipo,'agregados');r=await ask('mostrame solo accesos quitados');assert.equal(r.historyExport.filters.tipo,'quitados');assert.equal(r.historyExport.filters.usuario,'u');assert.equal(r.historyExport.filters.desde,'2026-10-01');
 r=await ask('descargalo en Excel');assert.equal(r.historyExport.filters.tipo,'quitados');await assert.rejects(()=>ask('filtralo por tipo desconocido'),{status:400});await assert.rejects(()=>ask('filtralo solo accesos agregados y accesos quitados'),{status:400});
 r=await ask('Historial del dashboard Ventas sin cambios');assert.equal(r.historyExport.filters.tipo,'sin_cambios');assert.match(r.answer,/1 evento/);assert.match(r.answer,/sin cambios en los accesos/);
});
test('Excel type filter includes all matching pages and never exports the opposite action',async t=>{
 const {historyExcel}=await import('../src/history-excel.js'),{default:ExcelJS}=await import('exceljs'),{d,p}=fixture(t),saved=d.save(p,input);for(let i=0;i<30;i++){d.share(p,saved.id,{targets:[{kind:'user',target:'u'}]});d.unshare(p,saved.id,{targets:[{kind:'user',target:'u'}]});}
 const buffer=await historyExcel({dashboards:d,principal:p,id:saved.id,filters:{tipo:'quitados',usuario:'u'}}),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const sheet=workbook.getWorksheet('Historial');assert.equal(sheet.rowCount,37);for(let n=8;n<=37;n++)assert.equal(sheet.getCell('C'+n).value,'Quitó acceso');assert.match(sheet.getCell('B3').value,/quitados/);
});

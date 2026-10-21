import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {createApprovedKnowledge,knowledgePolicy} from '../src/approved-knowledge.js';
function setup(t){
 const store=new Store(':memory:');t.after(()=>store.close());store.db.exec("CREATE TABLE access_roles(id TEXT PRIMARY KEY); INSERT INTO access_roles VALUES('admin'),('buyer'),('other');");
 const principals={admin:{userId:'admin',admin:true,roleId:'admin',revision:'1',actor:'user:admin:1',branches:['0101','0202'],permissions:[]},reader:{userId:'reader',admin:false,roleId:'buyer',revision:'1',actor:'user:reader:1',branches:['0101'],permissions:['read:conocimiento','read:catalogo']},other:{userId:'other',admin:false,roleId:'other',revision:'1',actor:'user:other:1',branches:['0101'],permissions:['read:conocimiento','read:catalogo']}};
 let current=principals.admin;const knowledge=createApprovedKnowledge({store,principal:()=>current,user:id=>principals[id]});
 const input={title:'Guía sintética de terminados',text:'Verificar el producto y la unidad antes de preparar una propuesta.',provenance:'Manual sintético aportado por Responsable, edición 1.',branch:'0101',requiredResources:['productos'],users:['reader'],roles:[],status:'approved'};
 return {store,principals,knowledge,input,as:id=>{current={...principals[id]};}};
}
test('approved knowledge isolates ACL, current source permissions and branch without leaking titles or counts',t=>{
 const s=setup(t),a=s.knowledge.save(s.input);s.knowledge.save({...s.input,title:'Secreto otra sucursal',branch:'0202'});s.as('reader');
 const list=s.knowledge.list({branch:'0101',q:'terminados'});assert.equal(list.data.length,1);assert.equal(list.data[0].id,a.id);assert.match(list.policy,/No es una consulta actual/);assert.deepEqual(s.knowledge.get(a.id).requiredResources,['productos']);assert.ok(!JSON.stringify(list).includes('Secreto'));assert.equal(list.count,undefined);
 s.as('other');assert.deepEqual(s.knowledge.list({branch:'0101'}).data,[]);assert.throws(()=>s.knowledge.get(a.id),{code:'CONOCIMIENTO_NO_ENCONTRADO'});
 s.principals.reader.permissions=['read:conocimiento'];s.as('reader');assert.equal(s.knowledge.list({branch:'0101'}).data.length,0);assert.throws(()=>s.knowledge.get(a.id),{code:'CONOCIMIENTO_NO_ENCONTRADO'});assert.throws(()=>s.knowledge.list({branch:'0202'}),{code:'SUCURSAL_NO_AUTORIZADA'});
});
test('drafts require explicit admin management, with approval provenance and immutable revision/audit history',t=>{
 const s=setup(t),draft=s.knowledge.save({...s.input,status:'draft'});assert.equal(draft.approvedBy,null);assert.equal(s.knowledge.list({branch:'0101'}).data.length,0);assert.equal(s.knowledge.list({branch:'0101',management:true}).data.length,1);
 s.as('reader');assert.throws(()=>s.knowledge.get(draft.id),{code:'CONOCIMIENTO_NO_ENCONTRADO'});assert.throws(()=>s.knowledge.list({branch:'0101',management:true}),{code:'CONOCIMIENTO_ADMIN'});assert.throws(()=>s.knowledge.save(s.input),{code:'CONOCIMIENTO_ADMIN'});
 s.as('admin');const approved=s.knowledge.save({...s.input,id:draft.id,revision:draft.revision});assert.equal(approved.revision,2);assert.equal(approved.approvedBy,'admin');assert.ok(approved.approvedAt);assert.throws(()=>s.knowledge.save({...s.input,id:draft.id,revision:1}),{code:'CONOCIMIENTO_REVISION'});
 const archived=s.knowledge.archive(approved.id,2);assert.equal(archived.revision,3);assert.equal(s.knowledge.list({branch:'0101'}).data.length,0);assert.equal(s.knowledge.get(approved.id,{management:true}).status,'archived');
 const history=s.store.db.prepare('SELECT body FROM approved_knowledge_revisions WHERE id=? ORDER BY revision').all(approved.id).map(r=>JSON.parse(r.body));assert.deepEqual(history.map(r=>r.status),['draft','approved','archived']);assert.equal(history[1].approvedBy,'admin');assert.equal(s.store.db.prepare("SELECT COUNT(*) n FROM audit WHERE event LIKE 'knowledge.%'").get().n,3);assert.equal(approved.policy,knowledgePolicy);
});
test('invalid resources, wildcard ACL, absent provenance and excessive content cannot enter the bank',t=>{
 const s=setup(t);for(const changes of [{provenance:''},{requiredResources:['SELECT * FROM SA1']},{requiredResources:[]},{users:['*']},{users:['unknown']},{roles:['unknown'],users:[]},{users:[],roles:[]},{text:'x'.repeat(4001)},{branch:'9999'},{status:'auto-approved'},{approvedBy:'reader'}])assert.throws(()=>s.knowledge.save({...s.input,...changes}));
 assert.equal(s.knowledge.list({branch:'0101',management:true}).data.length,0);assert.equal(s.store.db.prepare('SELECT COUNT(*) n FROM approved_knowledge_revisions').get().n,0);
});
test('role ACL works and sessions with changed permissions cannot read or modify even as former admin',t=>{
 const s=setup(t),approved=s.knowledge.save({...s.input,users:[],roles:['buyer']});s.as('reader');assert.equal(s.knowledge.get(approved.id).id,approved.id);
 s.principals.reader={...s.principals.reader,revision:'2',permissions:[]};assert.throws(()=>s.knowledge.list({branch:'0101'}),{code:'ACCESO_CAMBIO'});
 s.as('admin');s.principals.admin={...s.principals.admin,revision:'2',admin:false};assert.throws(()=>s.knowledge.save(s.input),{code:'ACCESO_CAMBIO'});assert.throws(()=>s.knowledge.archive(approved.id),{code:'ACCESO_CAMBIO'});
});

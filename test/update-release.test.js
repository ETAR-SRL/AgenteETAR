import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {snapshot,apply,rollback,commit} from '../scripts/update-release.mjs';

function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'etar-update-test-'));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const root=path.join(base,'installed'),release=path.join(base,'release'),backup=path.join(base,'backup'),modules=path.join(base,'new-modules');
 const write=(dir,name,value)=>{const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 write(root,'src/server.js','old server');write(root,'src/obsolete.js','old source');write(root,'package.json','{"version":"1"}');write(root,'package-lock.json','{}');
 write(root,'.env','PASSWORD=private');write(root,'config/mapping.json','local mapping');write(root,'data/settings.json','local settings');write(root,'node_modules/example/index.js','old dependency');
 write(root,'data/models/model.bin','model preserved');
 write(release,'src/server.js','new server');write(release,'src/new.js','new source');write(release,'package.json','{"version":"2"}');write(release,'package-lock.json','{}');write(release,'config/mapping.json','default mapping');
 write(modules,'example/index.js','new dependency');
 const manifest=()=>{const files={};for(const name of ['src/server.js','src/new.js','package.json','package-lock.json','config/mapping.json']){const bytes=fs.readFileSync(path.join(release,name));files[name]={size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}write(release,'PACKAGE-MANIFEST.json',JSON.stringify({schema:1,kind:'source',sensitive:false,files}));};manifest();
 const db=new DatabaseSync(path.join(root,'data/agent.sqlite'));db.exec("PRAGMA journal_mode=WAL; CREATE TABLE access_users(id TEXT,name TEXT); INSERT INTO access_users VALUES('u','Usuario'); CREATE TABLE executions(status TEXT); CREATE TABLE approval_escalations(status TEXT); CREATE TABLE price_batches(status TEXT); CREATE TABLE investigation_jobs(status TEXT);");db.close();
 return {base,root,release,backup,modules,write,manifest,read:(name)=>fs.readFileSync(path.join(root,name),'utf8')};
}
test('offline snapshot, source/modules update and rollback preserve users, mapping and settings',async t=>{
 const f=fixture(t);await snapshot(f);
 assert.equal(fs.existsSync(path.join(f.backup,'local/data/models/model.bin')),false);
 apply(f);assert.equal(f.read('src/server.js'),'new server');assert.equal(f.read('config/mapping.json'),'local mapping');assert.equal(f.read('node_modules/example/index.js'),'new dependency');assert.equal(fs.existsSync(path.join(f.root,'src/obsolete.js')),false);
 const db=new DatabaseSync(path.join(f.root,'data/agent.sqlite'));db.exec("ALTER TABLE access_users ADD COLUMN migrated TEXT; DELETE FROM access_users;");db.close();f.write(f.root,'.env','modified');f.write(f.root,'data/settings.json','modified');
 rollback(f);assert.equal(f.read('src/server.js'),'old server');assert.equal(f.read('src/obsolete.js'),'old source');assert.equal(fs.existsSync(path.join(f.root,'src/new.js')),false);assert.equal(f.read('node_modules/example/index.js'),'old dependency');assert.equal(f.read('.env'),'PASSWORD=private');assert.equal(f.read('data/settings.json'),'local settings');assert.equal(f.read('data/models/model.bin'),'model preserved');
 const restored=new DatabaseSync(path.join(f.root,'data/agent.sqlite'),{readOnly:true});assert.equal(restored.prepare('SELECT name FROM access_users').get().name,'Usuario');assert.equal(restored.prepare('PRAGMA table_info(access_users)').all().length,2);restored.close();
 rollback(f);assert.equal(f.read('node_modules/example/index.js'),'old dependency');
});
for(const [table,status] of [['executions','executing'],['executions','unknown'],['approval_escalations','unknown'],['price_batches','checking'],['investigation_jobs','running']])test(`snapshot refuses ${table}:${status} without mutating status`,async t=>{
 const f=fixture(t),db=new DatabaseSync(path.join(f.root,'data/agent.sqlite'));db.prepare(`INSERT INTO ${table}(status) VALUES(?)`).run(status);db.close();
 await assert.rejects(snapshot(f),/operaciones en curso/);const read=new DatabaseSync(path.join(f.root,'data/agent.sqlite'),{readOnly:true});assert.equal(read.prepare(`SELECT status FROM ${table}`).get().status,status);read.close();assert.equal(f.read('src/server.js'),'old server');
});
test('apply checks package hashes and cannot write local data',async t=>{
 const f=fixture(t);await snapshot(f);f.write(f.release,'src/server.js','tampered');assert.throws(()=>apply(f),/cambió/);assert.equal(f.read('src/server.js'),'old server');
 f.manifest();const m=JSON.parse(fs.readFileSync(path.join(f.release,'PACKAGE-MANIFEST.json')));m.files['data/settings.json']={size:0,sha256:''};f.write(f.release,'PACKAGE-MANIFEST.json',JSON.stringify(m));assert.throws(()=>apply(f),/datos locales/);
});
test('rollback refuses corrupted snapshot before changing installed files',async t=>{
 const f=fixture(t);await snapshot(f);apply(f);f.write(f.backup,'local/.env','corrupt');assert.throws(()=>rollback(f),/dañado/);assert.equal(f.read('src/server.js'),'new server');
});
test('rollback quarantines databases introduced by failed startup',async t=>{
 const f=fixture(t);await snapshot(f);apply(f);
 const db=new DatabaseSync(path.join(f.root,'data/new-schema.sqlite'));db.exec('CREATE TABLE future_only(id TEXT)');db.close();
 rollback(f);assert.equal(fs.existsSync(path.join(f.root,'data/new-schema.sqlite')),false);assert.equal(fs.existsSync(path.join(f.backup,'failed-local/data/new-schema.sqlite')),true);
});
test('local rollback quarantines new settings, preserves learning and excludes coordinator controls',async t=>{
 const f=fixture(t);f.write(f.root,'data/aprendizaje/aliases.json','learning');f.write(f.root,'data/maintenance/active-update.json','coordinator');f.write(f.root,'data/update-runtime.json','runtime control');await snapshot(f);
 assert.equal(fs.existsSync(path.join(f.backup,'local/data/maintenance/active-update.json')),false);assert.equal(fs.existsSync(path.join(f.backup,'local/data/update-runtime.json')),false);assert.equal(fs.readFileSync(path.join(f.backup,'local/data/aprendizaje/aliases.json'),'utf8'),'learning');
 apply(f);f.write(f.root,'data/new-settings.json','future setting');f.write(f.root,'config/new-schema.json','future config');f.write(f.root,'data/maintenance/probe.json','new control');f.write(f.root,'data/aprendizaje/aliases.json','changed');rollback(f);
 assert.equal(fs.existsSync(path.join(f.root,'data/new-settings.json')),false);assert.equal(fs.existsSync(path.join(f.root,'config/new-schema.json')),false);assert.equal(f.read('data/maintenance/probe.json'),'new control');assert.equal(f.read('data/aprendizaje/aliases.json'),'learning');
});
test('journal recovers interruption between dependency renames',async t=>{
 const f=fixture(t);await snapshot(f);const journal=path.join(f.backup,'journal.json'),j=JSON.parse(fs.readFileSync(journal));j.phase='applying';j.modules=f.modules;j.newFiles=['src/new.js'];fs.writeFileSync(journal,JSON.stringify(j));fs.renameSync(path.join(f.root,'node_modules'),path.join(f.backup,'node_modules'));
 rollback(f);assert.equal(f.read('node_modules/example/index.js'),'old dependency');assert.equal(f.read('src/server.js'),'old server');
});
test('committed transaction cannot overwrite subsequently changed local state',async t=>{
 const f=fixture(t);await snapshot(f);apply(f);commit(f);assert.throws(()=>rollback(f),/automáticamente/);
});
test('backup must be separate and code path junctions are rejected',async t=>{
 const f=fixture(t);await assert.rejects(snapshot({...f,backup:path.join(f.root,'backup')}),/fuera/);
 const outside=path.join(f.base,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(f.root,'src/linked'),'junction');await assert.rejects(snapshot(f),/enlaces/);assert.equal(fs.readdirSync(outside).length,0);
});

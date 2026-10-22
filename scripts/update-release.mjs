// Offline release transaction. The Windows coordinator owns stopping services and
// the maintenance gate; this module never starts a worker or touches the ERP.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';

const trees = new Set(['src','public','scripts','docs','test']);
const rootFiles = new Set(['README.md','AGENTS.md','package.json','package-lock.json','.env.example','.gitignore','iniciar.ps1','abrir-central.ps1','Instalar-servicio.bat','Actualizar-app.bat']);
const excludedData = new Set(['models','llm-models','llm-runtime','install-cache','logs','reports','maintenance','install-package','install-build','install-source-verify']);
function skipLocal(name,dataRelative='data') {
  if(/\.(?:log|zip)$/i.test(name))return true;
  if(name===dataRelative+'/update-runtime.json')return true;
  return name.startsWith(dataRelative+'/')&&excludedData.has(name.slice(dataRelative.length+1).split('/')[0]);
}
const fail = message => { throw new Error(message); };
const exists = p => fs.existsSync(p);
const inside = (base,p) => { const r=path.relative(base,p); return r!==''&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r); };
function regularPath(p, missing=false) {
  p=path.resolve(p);
  const parsed=path.parse(p); let current=parsed.root;
  for(const part of p.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    let st; try { st=fs.lstatSync(current); } catch(e) { if(e.code==='ENOENT'&&missing)return p; throw e; }
    if(st.isSymbolicLink() || fs.realpathSync.native(current).toLowerCase()!==current.toLowerCase())fail('No se admiten enlaces ni puntos de reanálisis.');
  }
  return p;
}
function relative(name) {
  if(typeof name!=='string'||!name||name.includes('\\')||name.includes(':')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))fail('Ruta de archivo no permitida.');
  return name;
}
function at(root,name) { relative(name); const p=path.resolve(root,...name.split('/')); if(!inside(root,p))fail('Ruta fuera de la instalación.'); return regularPath(p,true); }
function managed(name) {
  relative(name); const parts=name.split('/');
  return (rootFiles.has(name)||trees.has(parts[0]))&&!parts.some(p=>['node_modules','data','__pycache__','.git'].includes(p))&&!/\.(?:sqlite|db|key|pem|pfx|p12|log|zip)$/i.test(name)&&!parts.some(p=>p.startsWith('.env')&&name!=='.env.example');
}
function walk(root,prefix='',skip=()=>false) {
  const result=[];
  for(const entry of fs.readdirSync(prefix?at(root,prefix):regularPath(root),{withFileTypes:true})) {
    const name=prefix?prefix+'/'+entry.name:entry.name;
    if(skip(name,entry))continue;
    const p=at(root,name), st=fs.lstatSync(p);
    if(st.isDirectory())result.push(...walk(root,name,skip));
    else if(st.isFile())result.push(name);
    else fail('Se requiere un archivo regular.');
  }
  return result;
}
function digest(p) {
  const fd=fs.openSync(p,'r'),buffer=Buffer.allocUnsafe(1024*1024),hash=createHash('sha256');let size=0;
  try {let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0){hash.update(buffer.subarray(0,count));size+=count;}}finally{fs.closeSync(fd);}
  return {size,sha256:hash.digest('hex')};
}
function isSQLite(p) {
  const fd=fs.openSync(p,'r'),header=Buffer.alloc(16);try{fs.readSync(fd,header,0,16,0);}finally{fs.closeSync(fd);}
  return header.toString()==='SQLite format 3\0';
}
function atomicCopy(from,to) {
  regularPath(from); regularPath(to,true); fs.mkdirSync(path.dirname(to),{recursive:true});
  const temp=to+'.update-'+randomUUID();
  try { fs.copyFileSync(from,temp,fs.constants.COPYFILE_EXCL); const fd=fs.openSync(temp,'r+'); try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);} fs.renameSync(temp,to); }
  finally { if(exists(temp))fs.unlinkSync(temp); }
}
function writeJson(p,value) {
  regularPath(p,true); fs.mkdirSync(path.dirname(p),{recursive:true}); const temp=p+'.tmp-'+randomUUID();
  const fd=fs.openSync(temp,'wx',0o600); try {fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);} finally {fs.closeSync(fd);} fs.renameSync(temp,p);
}
function context({root,backup}) {
  root=regularPath(root); backup=regularPath(backup,true);
  if(root===backup||inside(root,backup)||inside(backup,root))fail('El respaldo debe estar fuera de la instalación.');
  return {root,backup};
}
function readJournal(ctx) {
  const j=JSON.parse(fs.readFileSync(at(ctx.backup,'journal.json'),'utf8'));
  if(j.schema!==1||j.root!==ctx.root)fail('El respaldo no corresponde a esta instalación.');
  for(const name of [...Object.keys(j.source),...j.local.map(f=>f.name),...(j.newFiles||[])])relative(name);
  return j;
}
function save(ctx,j,phase) { j.phase=phase;j.updated=new Date().toISOString();writeJson(at(ctx.backup,'journal.json'),j); }
export function lifecycle(db) {
  const result={};
  for(const [table,statuses] of [['executions',['executing','unknown']],['approval_escalations',['executing','unknown']],['price_batches',['checking','running']],['investigation_jobs',['running']]]) {
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    result[table]=Object.fromEntries(db.prepare(`SELECT status,COUNT(*) n FROM ${table} GROUP BY status`).all().map(r=>[r.status,Number(r.n)]));
    if(statuses.some(s=>result[table][s]))fail('Hay operaciones en curso o de resultado incierto; se requiere conciliación antes de actualizar.');
  }
  return result;
}
export async function snapshot(options) {
  const ctx=context(options); if(exists(ctx.backup))fail('El directorio de respaldo ya existe.');
  const dataDir=regularPath(options.dataDir||path.join(ctx.root,'data'),true);
  if(dataDir!==path.join(ctx.root,'data')&&!inside(ctx.root,dataDir))fail('DATA_DIR externo requiere un respaldo administrado explícitamente.');
  const source={};
  for(const name of fs.readdirSync(ctx.root)) {
    if(trees.has(name)&&fs.lstatSync(at(ctx.root,name)).isDirectory())for(const item of walk(ctx.root,name))if(managed(item))source[item]=digest(at(ctx.root,item));
  }
  // Root files are collected separately to avoid coupling to tree traversal.
  for(const name of rootFiles)if(exists(at(ctx.root,name)))source[name]=digest(at(ctx.root,name));
  if(exists(at(ctx.root,'PACKAGE-MANIFEST.json')))source['PACKAGE-MANIFEST.json']=digest(at(ctx.root,'PACKAGE-MANIFEST.json'));
  const locals=[];
  if(exists(at(ctx.root,'.env')))locals.push('.env');
  if(exists(at(ctx.root,'config')))locals.push(...walk(ctx.root,'config'));
  const dataRelative=path.relative(ctx.root,dataDir).split(path.sep).join('/');
  if(exists(dataDir))locals.push(...walk(ctx.root,dataRelative,(name)=>skipLocal(name,dataRelative)||/-(wal|shm)$/.test(name)));
  fs.mkdirSync(ctx.backup,{recursive:false,mode:0o700});
  const j={schema:1,root:ctx.root,dataRelative,created:new Date().toISOString(),source,local:[],lifecycle:{},hadModules:exists(at(ctx.root,'node_modules')),newFiles:[],phase:'snapshotting'};
  save(ctx,j,'snapshotting');
  for(const name of Object.keys(source))atomicCopy(at(ctx.root,name),at(ctx.backup,'source/'+name));
  for(const name of locals) {
    const from=at(ctx.root,name),to=at(ctx.backup,'local/'+name);
    const sqlite=isSQLite(from);
    if(sqlite){fs.mkdirSync(path.dirname(to),{recursive:true});const db=new DatabaseSync(from,{readOnly:true});try {j.lifecycle[name]=lifecycle(db);await sqliteBackup(db,to);}finally{db.close();}}
    else atomicCopy(from,to);
    j.local.push({name,sqlite,...digest(to)});
  }
  save(ctx,j,'snapshotted'); return {phase:j.phase,files:Object.keys(source).length,localFiles:j.local.length};
}
export function apply(options) {
  const ctx=context(options),j=readJournal(ctx);if(j.phase!=='snapshotted')fail('El respaldo no está listo para aplicar.');
  const release=regularPath(options.release);if(release===ctx.root||inside(ctx.root,release))fail('La versión debe prepararse fuera de la instalación.');
  const manifest=JSON.parse(fs.readFileSync(at(release,'PACKAGE-MANIFEST.json'),'utf8'));
  if(manifest.schema!==1||manifest.kind!=='source'||manifest.sensitive||!manifest.files)fail('Se requiere un paquete de fuentes verificado.');
  const names=Object.keys(manifest.files),seen=new Set();
  for(const name of names){relative(name);const lower=name.toLowerCase();if(seen.has(lower))fail('Archivos duplicados.');seen.add(lower);if(name.startsWith('config/'))continue;if(!managed(name))fail('El paquete intenta reemplazar datos locales.');const actual=digest(at(release,name));if(actual.size!==manifest.files[name].size||actual.sha256!==manifest.files[name].sha256)fail('El paquete cambió después de verificarse.');}
  for(const required of ['package.json','package-lock.json','src/server.js'])if(!names.includes(required))fail('El paquete está incompleto.');
  const modules=options.modules?regularPath(options.modules):null;
  if(modules&&(modules===ctx.root||inside(ctx.root,modules)||inside(ctx.backup,modules)||modules===ctx.backup))fail('Las dependencias deben prepararse fuera de la instalación y del respaldo.');
  if(modules){walk(modules);if(j.hadModules)walk(at(ctx.root,'node_modules'));} // Reject junctions before moving anything.
  j.newFiles=names.filter(managed).concat('PACKAGE-MANIFEST.json'); j.modules=modules; save(ctx,j,'applying');
  if(modules){if(j.hadModules)fs.renameSync(at(ctx.root,'node_modules'),at(ctx.backup,'node_modules'));save(ctx,j,'modules-old-moved');fs.renameSync(modules,at(ctx.root,'node_modules'));save(ctx,j,'modules-installed');}
  for(const name of j.newFiles)atomicCopy(at(release,name),at(ctx.root,name));
  for(const name of Object.keys(j.source))if(managed(name)&&!j.newFiles.includes(name)){const p=at(ctx.root,name);if(exists(p))fs.unlinkSync(p);}
  save(ctx,j,'applied');return {phase:j.phase,files:j.newFiles.length};
}
export function rollback(options) {
  const ctx=context(options),j=readJournal(ctx);
  if(['committed','snapshotting'].includes(j.phase))fail('No se puede restaurar este estado automáticamente.');
  // Validate every byte of the backup before changing the installation.
  for(const [name,record] of Object.entries(j.source)){const actual=digest(at(ctx.backup,'source/'+name));if(actual.sha256!==record.sha256)fail('El respaldo de fuentes está dañado.');}
  for(const record of j.local){const actual=digest(at(ctx.backup,'local/'+record.name));if(actual.sha256!==record.sha256)fail('El respaldo de datos está dañado.');}
  save(ctx,j,'rolling-back');
  for(const name of j.newFiles)if(!j.source[name]){const p=at(ctx.root,name);if(exists(p))fs.unlinkSync(p);}
  for(const name of Object.keys(j.source))atomicCopy(at(ctx.backup,'source/'+name),at(ctx.root,name));
  if(options.restoreData!==false){
    // Preserve new mutable files for diagnosis outside the old release's view.
    // Coordinator control files and large local resources are never included.
    const old=new Set(j.local.map(record=>record.name));
    const current=[];
    for(const prefix of ['config',j.dataRelative].filter(Boolean))if(exists(at(ctx.root,prefix)))current.push(...walk(ctx.root,prefix,name=>skipLocal(name,j.dataRelative)));
    if(exists(at(ctx.root,'.env')))current.push('.env');
    for(const name of current){if(old.has(name)||!exists(at(ctx.root,name)))continue;const dbBase=name.replace(/-(wal|shm)$/,'');if(old.has(dbBase))continue;const to=at(ctx.backup,'failed-local/'+name);fs.mkdirSync(path.dirname(to),{recursive:true});fs.renameSync(at(ctx.root,name),to);}
    for(const record of j.local){const to=at(ctx.root,record.name);if(record.sqlite)for(const suffix of ['-wal','-shm']){const p=regularPath(to+suffix,true);if(exists(p))fs.unlinkSync(p);}atomicCopy(at(ctx.backup,'local/'+record.name),to);}
  }
  if(j.modules){const old=at(ctx.backup,'node_modules'),current=at(ctx.root,'node_modules'),failed=at(ctx.backup,'failed-node_modules');if(exists(old)){if(exists(current)){if(exists(failed))fail('Las dependencias fallidas ya están guardadas.');fs.renameSync(current,failed);}fs.renameSync(old,current);}else if(!j.hadModules&&exists(current)&&!exists(failed))fs.renameSync(current,failed);}
  save(ctx,j,'rolled-back');return {phase:j.phase};
}
export function commit(options) {const ctx=context(options),j=readJournal(ctx);if(j.phase!=='applied')fail('La actualización no está aplicada.');save(ctx,j,'committed');return {phase:j.phase};}
export function status(options) {const ctx=context(options),j=readJournal(ctx);return {phase:j.phase,files:Object.keys(j.source).length,localFiles:j.local.length};}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{const [command,...args]=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!['--root','--backup','--release','--modules','--data-dir'].includes(args[i])||!args[i+1])fail('Argumentos inválidos.');options[args[i].slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=args[i+1];}if(!{snapshot,apply,rollback,commit,status}[command])fail('Fase inválida.');console.log(JSON.stringify(await {snapshot,apply,rollback,commit,status}[command](options)));}
  catch(error){console.error(JSON.stringify({ok:false,error:error.code||'UPDATE_FAILED',message:typeof error.message==='string'&&error.message.includes('Hay operaciones')?error.message:'No se pudo completar la fase. Revisá el respaldo y el registro local antes de reiniciar.'}));process.exitCode=1;}
}

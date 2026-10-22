import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {maintenanceDurableCounts} from '../src/maintenance.js';

// Run with the installation's own node and --env-file-if-exists=.env.
// The elevated updater creates/removes the ACL-protected control file itself.
const command=process.argv[2]||'status';
const dir=resolve(process.env.DATA_DIR||'data');
try{
 if(command==='offline-check'){
  const path=resolve(dir,'agent.sqlite');
  if(!existsSync(path))throw new Error('La base local no existe.');
  const db=new DatabaseSync(path,{readOnly:true});
  try{const durable=maintenanceDurableCounts(db);console.log(JSON.stringify({durable,safe:Object.values(durable).every(n=>n===0)}));if(Object.values(durable).some(n=>n!==0))process.exitCode=2;}finally{db.close();}
 }else if(command==='status'){
  const control=JSON.parse(readFileSync(resolve(dir,'maintenance','update.json'),'utf8'));
  const runtime=JSON.parse(readFileSync(resolve(dir,'update-runtime.json'),'utf8'));
  const fresh=Date.now()-Date.parse(runtime.updatedAt)>=0&&Date.now()-Date.parse(runtime.updatedAt)<5000;
  const safe=fresh&&control.id===runtime.id&&control.mode===runtime.mode&&(control.mode==='release'?runtime.status==='active':runtime.status==='quiescent'&&runtime.activeRequests===0&&runtime.workersStopped===true&&runtime.durable&&Object.values(runtime.durable).every(n=>n===0));
  console.log(JSON.stringify({...runtime,fresh,safe}));if(!safe)process.exitCode=2;
 }else throw new Error('Usar status u offline-check.');
}catch(error){console.error(JSON.stringify({safe:false,error:error.message}));process.exitCode=1;}

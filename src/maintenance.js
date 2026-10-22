import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';

// The updater owns the control file and its ACL. The service only reads it.
// Missing/deleted controls never release a latched maintenance session.
export function createMaintenance({dataDir=process.env.DATA_DIR||'data',pid=process.pid}={}){
 const controlPath=resolve(dataDir,'maintenance','update.json'),runtimePath=resolve(dataDir,'update-runtime.json');
 let control=null,released=false,activating=null,activate=()=>{},activeRequests=0,stopping=null,workersStopped=false,readDurable=()=>({}),timer,lastError=null;
 function refresh(){
  try{
   const value=JSON.parse(readFileSync(controlPath,'utf8'));if(!value||typeof value.id!=='string'||!value.id||!['drain','probe','release'].includes(value.mode))throw new Error('Invalid maintenance control');
   if(value.mode==='release'){
    if(!control){control=value;released=true;}
    else if(control.id===value.id)control=value;
    else throw new Error('Release does not match maintenance session');
   }else{
    if(released){stopping=null;workersStopped=false;activating=null;lastError=null;}
    released=false;control=value;
   }
  }
  catch(error){if(error.code!=='ENOENT'){released=false;control={id:control?.id||null,mode:'invalid'};lastError='CONTROL_INVALID';}}
  return control!==null&&!released;
 }
 function counts(){try{return readDurable();}catch{lastError='DURABLE_STATE_UNAVAILABLE';return null;}}
 function status(){
  const durable=counts(),busy=durable===null||Object.values(durable).some(n=>n!==0);
  return {id:control?.id||null,pid,mode:control?.mode||null,status:lastError?'blocked':released?'active':!control?'normal':workersStopped&&activeRequests===0&&!busy?'quiescent':'draining',activeRequests,durable,workersStopped,updatedAt:new Date().toISOString(),error:lastError};
 }
 function publish(){if(!control)return;const temp=runtimePath+'.'+pid+'.tmp';try{writeFileSync(temp,JSON.stringify(status()));renameSync(temp,runtimePath);}catch{/* Missing acknowledgement makes the updater fail closed. */}}
 const service={controlPath,runtimePath,
  active:()=>refresh(),
  enter(){if(!refresh())return false;service.tick();return true;},
  begin(){activeRequests++;let done=false;return ()=>{if(done)return;done=true;activeRequests--;publish();};},
  attach({workers=[],durable=()=>({}),onRelease=()=>{}}={}){readDurable=durable;activate=onRelease;service.stopWorkers=()=>Promise.all(workers.map(w=>w.stop()));service.tick();timer=setInterval(()=>service.tick(),500);timer.unref?.();},
  tick(){
   if(!refresh()){if(released)publish();return;}
   if(!stopping){stopping=Promise.resolve().then(()=>service.stopWorkers?.()).then(()=>{workersStopped=true;publish();},()=>{lastError='WORKERS_STOP_FAILED';publish();});}
   if(control.mode==='release'&&!activating&&!lastError&&status().status==='quiescent')activating=Promise.resolve().then(()=>activate()).then(()=>{released=true;workersStopped=false;publish();},()=>{lastError='ACTIVATION_FAILED';publish();});
   publish();
  },
  status,
  async close(){clearInterval(timer);await stopping;await activating;}
 };
 refresh();return service;
}

// Also usable with a read-only DatabaseSync; no migrations or recovery writes.
export function maintenanceDurableCounts(db){
 const count=(table,status)=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)?db.prepare(`SELECT count(*) n FROM ${table} WHERE status=?`).get(status).n:0;
 return {executions:count('executions','executing'),escalations:count('approval_escalations','executing'),jobs:count('investigation_jobs','running'),uncertainExecutions:count('executions','unknown'),uncertainEscalations:count('approval_escalations','unknown'),priceBatches:count('price_batches','checking')+count('price_batches','running')};
}

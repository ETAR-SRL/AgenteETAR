import {HttpError} from './errors.js';

// Circuito independiente para una fuente consultiva. No cachea resultados ni inventa filas.
export function createReadSource({factory,configured=true,source='api',clock=()=>new Date(),retryMs=5000,maxRetryMs=60000,probeMs=60000,maxConcurrent=3,onState=()=>{}}){
 let adapter,running,timer,stopped=false,inflight=0,lastProbe=0,epoch=0;
 const state={state:configured?'connecting':'not_configured',available:false,configured,lastSuccess:null,lastAttempt:null,nextRetry:null,failures:0};
 const status=()=>({...state,source});
 const publish=()=>{try{onState(status());}catch{}};
 function fail(){if(stopped)return;epoch++;Object.assign(state,{state:'unavailable',available:false,failures:state.failures+1});state.nextRetry=new Date(+clock()+Math.min(maxRetryMs,retryMs*2**Math.min(state.failures-1,8))).toISOString();publish();}
 async function read(method,args=[]){
  if(stopped||!configured)throw new HttpError(503,'KAIQEN_NOT_CONFIGURED','KAIQEN no está configurado. El resto de la app sigue disponible.');
  if(!adapter||!state.available&&state.nextRetry>clock().toISOString())throw new HttpError(503,'KAIQEN_SOURCE_UNAVAILABLE','KAIQEN está sin conexión. Voy a volver a intentar automáticamente.');
  if(inflight>=maxConcurrent)throw new HttpError(503,'KAIQEN_BUSY','KAIQEN está atendiendo otras consultas. Volvé a intentar en unos segundos.');
  const ticket=epoch;inflight++;state.lastAttempt=clock().toISOString();
  try{const result=await adapter[method](...args);if(stopped||ticket!==epoch)throw new HttpError(503,'KAIQEN_STALE','La fuente cambió durante la consulta. Volvé a verificar.');const recovered=!state.available;Object.assign(state,{state:'available',available:true,lastSuccess:clock().toISOString(),failures:0,nextRetry:null});if(recovered)publish();return result;}
  catch(error){if(stopped||ticket!==epoch)throw new HttpError(503,'KAIQEN_STALE','La fuente cambió durante la consulta. Volvé a verificar.');if(error.code==='KAIQEN_STALE')throw error;if(!error.status||error.status>=500&&error.code!=='KAIQEN_BUSY'){fail();throw new HttpError(503,'KAIQEN_SOURCE_UNAVAILABLE','No pude verificar KAIQEN. Los casos no se dieron por resueltos.');}throw error;}
  finally{inflight--;}
 }
 const service={
  get available(){return configured;},source,get computedQuality(){return source==='postgres'?false:adapter?.computedQuality!==false;},status,
  ...Object.fromEntries(['projects','project','quality','projectLink','product'].map(method=>[method,(...args)=>read(method,args)])),
  run(){if(stopped||!configured)return Promise.resolve();if(running)return running;
   if(state.nextRetry>clock().toISOString()||state.available&&+clock()-lastProbe<probeMs)return Promise.resolve();
   const failuresBefore=state.failures;
   running=(async()=>{try{if(!adapter)adapter=factory();lastProbe=+clock();await read('projects',[{offset:0,limit:1}]);}catch(error){if(['KAIQEN_BUSY','KAIQEN_STALE'].includes(error.code))return;if(state.failures===failuresBefore)fail();}})().finally(()=>{running=null;});return running;
  },
  start(){if(timer||stopped||!configured)return;void service.run();timer=setInterval(()=>void service.run(),1000);timer.unref?.();},
  async close(){stopped=true;clearInterval(timer);await running;await adapter?.close?.();state.state='stopped';state.available=false;}
 };
 return service;
}

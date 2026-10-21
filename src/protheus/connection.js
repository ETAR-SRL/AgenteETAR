import {HttpError} from '../errors.js';

const transportCodes=new Set(['ETIMEOUT','ESOCKET','ECONNCLOSED','ENOTOPEN','ECONNRESET','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','EPIPE']);
function disconnected(error){for(let e=error,depth=0;e&&depth<5;e=e.originalError||e.cause,depth++)if(transportCodes.has(e.code)||e.outcomeUnknown)return true;return false;}

// La conexión y el catálogo se publican juntos. Nunca se usa un catálogo incompleto
// ni se repite una operación que haya fallado, en particular una escritura.
export function createErpConnection({connect,writeEnabled=false,branches=['0101'],retryMs=5000,maxRetryMs=60000,probeMs=15000,clock=()=>new Date(),onState=()=>{}}){
 if(!Number.isInteger(retryMs)||retryMs<1000||!Number.isInteger(maxRetryMs)||maxRetryMs<retryMs||maxRetryMs>300000||!Number.isInteger(probeMs)||probeMs<1000)throw new Error('Intervalos de reconexión ERP inválidos');
 let current,connecting,timer,stopped=false,lastMetadata={entities:{}},lastProbe=0;
 const closing=new Set(),slots=new Set(),state={state:'connecting',available:false,failures:0,lastConnected:null,lastFailure:null,nextRetry:null};
 const status=()=>({...state});
 const publish=()=>{try{onState(status());}catch{}};
 function retire(slot){
  if(!slot)return;slot.retired=true;
  if(slot.inflight||slot.closing)return;
  slot.closing=Promise.resolve().then(()=>slot.adapter.close()).catch(()=>{}).finally(()=>{closing.delete(slot.closing);slots.delete(slot);slot.resolveClose();});closing.add(slot.closing);
 }
 function unavailable(slot){
  if(stopped||slot&&current!==slot)return;
  current=null;retire(slot);state.state='unavailable';state.available=false;state.failures++;
  state.lastFailure=clock().toISOString();state.nextRetry=new Date(+clock()+Math.min(maxRetryMs,retryMs*2**Math.min(state.failures-1,8))).toISOString();publish();
 }
 async function call(method,args=[],write=false){
  const slot=current;if(stopped||!slot)throw new HttpError(503,'PROTHEUS_NO_DISPONIBLE','Protheus está sin conexión. La app sigue disponible y se reconectará automáticamente.');
  slot.inflight++;
  try{const target=write?slot.adapter.writes:slot.adapter;const path=method.split('.');let receiver=target;for(const name of path.slice(0,-1))receiver=receiver?.[name];const fn=receiver?.[path.at(-1)];if(typeof fn!=='function')throw new HttpError(503,'ERP_FUNCION_NO_DISPONIBLE','Esta función no está disponible en la conexión actual.');const result=await fn.apply(receiver,args);
   // Una lectura iniciada antes de la caída no puede volver a verificar un seguimiento
   // después de que se retiró su conexión. Un COMMIT ya comprobado conserva su recibo.
   if(current!==slot&&!(write&&method.endsWith('execute')))throw new HttpError(503,'PROTHEUS_NO_DISPONIBLE','La conexión cambió durante la consulta. Volvé a consultar para verificar los datos actuales.');
   if(!write&&method==='list')state.lastReadSuccess=clock().toISOString();
   return result;
  }
  catch(error){if(disconnected(error)){unavailable(slot);if(!write)throw new HttpError(503,'PROTHEUS_NO_DISPONIBLE','Se perdió la conexión con Protheus. Voy a reconectar automáticamente; no se dio nada por resuelto.');}throw error;}
  finally{slot.inflight--;if(slot.retired)retire(slot);}
 }
 const writes={
  get enabled(){return writeEnabled&&!!current?.adapter.writes?.enabled;},
  get policy(){return current?.adapter.writes?.policy||null;},
  get creation(){return current?.adapter.writes?.creation||null;},
  prepare:(...args)=>call('prepare',args,true),check:(...args)=>call('check',args,true),execute:(...args)=>call('execute',args,true),
  escalation:{get enabled(){return writeEnabled&&!!current?.adapter.writes?.escalation?.enabled;},get branches(){return [...branches];},scan:(...a)=>call('escalation.scan',a,true),prepare:(...a)=>call('escalation.prepare',a,true),execute:(...a)=>call('escalation.execute',a,true)}
 };
 const service={
  writes,status,
  metadata:()=>({...lastMetadata,connection:status()}),
  list:(...args)=>call('list',args),
  run(){
   if(stopped)return Promise.resolve();if(connecting)return connecting;
   if(current){if(+clock()-lastProbe<probeMs)return Promise.resolve();lastProbe=+clock();connecting=call('ping').catch(()=>{}).finally(()=>{connecting=null;});return connecting;}
   if(state.nextRetry&&state.nextRetry>clock().toISOString())return Promise.resolve();
   state.state='connecting';publish();
   connecting=(async()=>{
    let adapter;
    try{adapter=await connect();if(stopped){await adapter.close();return;}
     const metadata=adapter.metadata();lastMetadata=metadata;current={adapter,inflight:0,retired:false};current.closed=new Promise(resolve=>{current.resolveClose=resolve;});slots.add(current);lastProbe=+clock();
     Object.assign(state,{state:'available',available:true,failures:0,lastConnected:clock().toISOString(),nextRetry:null});publish();
    }catch{if(adapter)await adapter.close().catch(()=>{});unavailable();}
   })().finally(()=>{connecting=null;});return connecting;
  },
  start(){if(timer||stopped)return;void service.run();timer=setInterval(()=>void service.run(),1000);timer.unref?.();},
  async close(){stopped=true;clearInterval(timer);state.state='stopped';state.available=false;const slot=current;current=null;retire(slot);await connecting;const pending=[...slots];for(const s of pending)retire(s);await Promise.all(pending.map(s=>s.closed));await Promise.all([...closing]);}
 };
 return service;
}

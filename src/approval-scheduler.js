// Background service owned by the application, not by an HTTP/chat caller.
// The deployment explicitly enables it. No per-document confirmation needed.
export function createApprovalScheduler({adapter,store,enabled=false,intervalMs=60_000,maxPages=10}){
 if(!Number.isInteger(intervalMs)||intervalMs<10_000||intervalMs>86_400_000)throw new Error('ERP_APPROVAL_POLL_MS debe estar entre 10000 y 86400000');
 let timer,running=null,stopped=false;
 const cursors=new Map(),state={enabled:enabled&&adapter?.enabled===true,running:false,lastRun:null,lastError:null,scanned:0,transferred:0,deferred:0};
 async function cycle(){
  const summary={scanned:0,transferred:0,deferred:0};state.running=true;state.lastError=null;
  try{
   for(const branch of adapter.branches){
    try{
    for(let page=0;page<maxPages&&!stopped;page++){
     const candidates=await adapter.scan(branch,cursors.get(branch)||'0');
     for(const target of candidates){
      if(stopped)break;
      summary.scanned++;let proposal,claimed=false,sqlSucceeded=false;
      try{
       proposal=await adapter.prepare(target);
       claimed=store.claimEscalation(proposal);
       if(!claimed){summary.deferred++;continue;}
       const result=await adapter.execute(proposal);sqlSucceeded=true;
       store.finishEscalation(proposal.key,'executed',result);summary.transferred++;
      }catch(error){
       summary.deferred++;
       // No SQL rollback/commit assumption after a success with a failed local
       // receipt. Leave the durable claim unresolved, never replay blindly.
       if(claimed)store.finishEscalation(proposal.key,(sqlSucceeded||error.outcomeUnknown)?'unknown':'retry',{code:error.code||'ESCALAMIENTO_ERROR'});
       store.noteEscalation(target,error.code||'ESCALAMIENTO_ERROR');
      }
     }
     if(candidates.length<100){cursors.delete(branch);break;}
     cursors.set(branch,candidates.at(-1).registro);
    }
    }catch(error){state.lastError=error.code||'ESCALAMIENTO_ERROR';}
   }
  }catch(error){state.lastError=error.code||'ESCALAMIENTO_ERROR';}
  finally{Object.assign(state,summary,{running:false,lastRun:new Date().toISOString()});}
  return {...state};
 }
 return {status:()=>({...state,enabled:enabled&&adapter?.enabled===true,intervalMs,scope:'SCR SC/IP/PC de las filiales autorizadas; CR_PRAZO vencido y CR_ESCALSP=T',...store.escalationSummary()}),
  run(){state.enabled=enabled&&adapter?.enabled===true;if(!state.enabled||stopped)return Promise.resolve({...state});if(running)return running;running=cycle().finally(()=>{running=null;});return running;},
  start(){if(timer||!enabled||!adapter||stopped)return;void this.run();timer=setInterval(()=>void this.run(),intervalMs);timer.unref?.();},
  async stop(){stopped=true;clearInterval(timer);await running;}
 };
}

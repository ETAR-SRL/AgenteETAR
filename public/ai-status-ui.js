let installed;
export function aiStatusText(status){
 if(!status?.available)return 'Motor de IA no disponible';
 const model=status.model||'modelo sin identificar';
 if(status.local===false)return (status.connectionVerified?'IA externa verificada · ':'IA externa configurada, sin verificar · ')+model;
 return (status.local===true?'IA local activa · ':'IA disponible · ')+model;
}
/** Status reads only; never runs an inference or starts a model. */
export function installAiStatus({api,actor,onStatus=()=>{},onSessionChanged=()=>{}}){
 installed?.destroy();
 const badge=document.querySelector('#ai-status');
 let destroyed=false,suspended=false,busy=false,timer,controller,epoch=0;
 const current=()=>!destroyed&&!suspended;
 const clearTimer=()=>{clearTimeout(timer);timer=undefined;};
 const reset=()=>{badge.textContent='Comprobando disponibilidad de IA…';};
 const schedule=()=>{clearTimer();if(current()&&!document.hidden)timer=setTimeout(()=>void check(),15000);};
 function destroy(){if(destroyed)return;destroyed=true;epoch++;clearTimer();controller?.abort();for(const [target,event,listener] of listeners)target.removeEventListener(event,listener);if(installed===view)installed=undefined;}
 function invalidate(){destroy();badge.textContent='Sesión cambiada · volvé a ingresar';onSessionChanged();}
 async function check(){
  if(!current()||document.hidden||busy)return;
  if(localStorage.getItem('central-access-actor')!==actor){invalidate();return;}
  busy=true;clearTimer();const version=epoch;controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),10000);
  try{
   const status=await api('/api/agent/status',{signal:controller.signal});
   if(!current()||version!==epoch)return;
   // Check the authenticated actor after the response as cookies may have changed in flight.
   const state=await api('/api/auth/state',{signal:controller.signal});
   if(!current()||version!==epoch)return;
   if(state.user?.actor!==actor||localStorage.getItem('central-access-actor')!==actor){invalidate();return;}
   badge.textContent=aiStatusText(status);onStatus(status);
  }catch{if(current()&&version===epoch)badge.textContent='No se pudo comprobar la disponibilidad de IA';}
  finally{clearTimeout(timeout);controller=undefined;busy=false;schedule();}
 }
 function visibility(){if(document.hidden){clearTimer();return;}void check();}
 function pagehide(){suspended=true;epoch++;clearTimer();controller?.abort();reset();}
 function pageshow(){suspended=false;void check();}
 function storage(event){if(event.key==='central-access-actor'&&event.newValue!==actor)invalidate();}
 function logout(){destroy();reset();}
 const listeners=[[document,'visibilitychange',visibility],[window,'online',visibility],[window,'pagehide',pagehide],[window,'pageshow',pageshow],[window,'storage',storage]];
 const logoutButton=document.querySelector('#logout');if(logoutButton)listeners.push([logoutButton,'click',logout]);
 const view={check,destroy};installed=view;
 for(const [target,event,listener] of listeners)target.addEventListener(event,listener);
 reset();void check();return view;
}

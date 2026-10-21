const storageKey='central-push';
const read=()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'null');}catch{return null;}};
const post=async(path,body)=>{const r=await fetch('/api/attention/notifications/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Object.assign(new Error('No pude verificar tus notificaciones.'),{status:r.status});return r.json();};
const accessState=id=>post('status',{id}).catch(e=>{if([401,403,404].includes(e.status))return {enabled:false};throw e;});
export async function stopNotifications(){
 const saved=read();localStorage.removeItem(storageKey);
 if(saved?.id)await post('disable',{id:saved.id}).catch(()=>{});
 if(!('serviceWorker' in navigator))return;
 const reg=await navigator.serviceWorker.getRegistration();if(!reg)return;
 await (await reg.pushManager?.getSubscription())?.unsubscribe().catch(()=>{});
 for(const n of await reg.getNotifications())if(n.tag.startsWith('central-follow-'))n.close();
}
export function installNotifications({api,notice}){
 const button=document.querySelector('#attention-notifications'),status=document.querySelector('#attention-notifications-status');let active=false,busy=false;
 const supported=()=>window.isSecureContext&&'Notification' in window&&'PushManager' in window&&'serviceWorker' in navigator;
 function display(text,disabled=false){status.textContent=text;button.disabled=disabled;button.textContent=active?'Desactivar notificaciones':'Activar notificaciones';button.setAttribute('aria-pressed',String(active));}
 async function check(){
  if(busy)return;
  if(!supported()){display('Este navegador no admite estos avisos. En la red, abrí Central con su dirección HTTPS. En iPhone o iPad, instalá la PWA primero.',true);return;}
  try{
   const config=await api('/api/attention/notifications');
   if(!config.available){active=!!read()?.id;display('Las notificaciones están desactivadas en el servidor.',!active);return;}
   const saved=read(),reg=await navigator.serviceWorker.getRegistration(),sub=await reg?.pushManager.getSubscription();
   active=false;
   if(saved?.id&&sub&&Notification.permission==='granted'){
    const state=await accessState(saved.id);active=state.enabled;
    if(!active){await stopNotifications();display('Tu acceso cambió. Podés activar los avisos nuevamente con tus permisos actuales.');return;}
   }else if(saved||sub)await stopNotifications();
   display(active?'Activadas en este navegador. Sólo novedades de tus seguimientos; sin datos comerciales en el aviso.':Notification.permission==='denied'?'El navegador bloqueó los avisos. Podés habilitarlos desde los permisos de este sitio.':'Opcionales. Avisan si cambia un seguimiento o se cumple su objetivo, sin mostrar datos comerciales.');
  }catch{active=!!read()?.id;display('No pude verificar el servicio. Volvé a intentar cuando haya conexión.');}
 }
 button.onclick=async()=>{
  if(busy)return;busy=true;button.disabled=true;
  try{
   if(active){await stopNotifications();active=false;display('Desactivadas en este navegador. Tus seguimientos siguen en la bandeja.');notice('Desactivé las notificaciones en este navegador.');return;}
   // El permiso del navegador se pide únicamente tras este gesto explícito.
   const permission=await Notification.requestPermission();
   if(permission!=='granted'){display(permission==='denied'?'El navegador bloqueó los avisos. Cambialo desde los permisos del sitio.':'No activaste los avisos. Podés hacerlo cuando quieras.');return;}
   const config=await api('/api/attention/notifications');if(!config.available)throw new Error('Las notificaciones están desactivadas en el servidor.');
   const reg=await navigator.serviceWorker.ready;
   const previous=read();if(previous?.id){const state=await accessState(previous.id);if(!state.enabled)await stopNotifications();}
   // Una suscripción sin preferencia personal no se hereda al cambiar de cuenta.
   let sub=await reg.pushManager.getSubscription();if(sub&&!read()){await sub.unsubscribe();sub=null;}
   const key=Uint8Array.from(atob(config.publicKey.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
   sub=sub||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
   const result=await post('subscribe',{subscription:sub.toJSON()});localStorage.setItem(storageKey,JSON.stringify({id:result.id}));active=true;
   display('Activadas en este navegador. Sólo novedades nuevas; lo pospuesto o descartado no genera avisos.');notice('Activé las notificaciones para tus seguimientos en este navegador.');
  }catch{display('No pude activar las notificaciones. Revisá tu conexión y los permisos del navegador y volvé a intentar.');}
  finally{busy=false;button.disabled=false;}
 };
 void check();if('serviceWorker' in navigator)void navigator.serviceWorker.ready.then(check);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check();});
 return {check};
}

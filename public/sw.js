const CACHE='central-shell-v49';
const SHELL=['/ai-status-ui.js','/corporate-documents-ui.js','/knowledge-ui.js','/investigation-ui.js','/report-download-ui.js','/','/erp-connection-ui.js','/notifications-ui.js','/attention-ui.js','/access-ui.js','/app.js','/import-ui.js','/import-batch-ui.js','/style.css','/manifest.webmanifest','/icon.svg','/icon-192.png','/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('central-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
// No se guardan respuestas de negocio, audio ni sesiones en el caché offline.
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!SHELL.includes(url.pathname)||url.search)return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{
  let input;try{input=event.data?.json();}catch{return;}
  if(input?.kind!=='attention'||!/^[a-f0-9-]{36}$/.test(input.subscription))return;
  // El push sólo despierta la PWA. La sesión, el usuario, los permisos y las preferencias
  // se vuelven a validar antes de mostrar algo. Sin conexión o sesión, no se muestra.
  try{
   const r=await fetch('/api/attention/notifications/claim',{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json'},body:JSON.stringify({id:input.subscription})});
   if(!r.ok)return;const {notification}=await r.json();if(!notification)return;
   await self.registration.showNotification(notification.title,{body:notification.body,tag:notification.tag,icon:'/icon-192.png',badge:'/icon-192.png',data:{subscription:input.subscription},renotify:false});
  }catch{}
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  // Nunca abrir un destino recibido por push. La bandeja aplica el acceso de la sesión actual.
  const url=self.location.origin+'/?attention=updates',tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const tab=tabs.find(c=>new URL(c.url).origin===self.location.origin);
  if(tab){await tab.navigate(url);await tab.focus();}else await self.clients.openWindow(url);
 })());
});

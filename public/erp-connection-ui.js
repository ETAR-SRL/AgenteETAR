export function installErpConnection({api,initial,onChange=async()=>{}}){
 const badge=document.querySelector('#connection'),banner=document.querySelector('#erp-connection-status');
 let previous=initial,busy=false;
 function render(state){
  const online=state.available;
  badge.textContent=online?'Servicio real':state.state==='connecting'?'Conectando Protheus…':'Protheus sin conexión';badge.classList.toggle('warn',!online);
  banner.classList.toggle('hidden',online);
  banner.textContent=state.state==='connecting'?'La app está disponible. Estoy intentando conectar con Protheus.':'Protheus no está disponible. Voy a reconectar automáticamente cuando vuelva la red o VPN. Los seguimientos quedan sin verificar, no resueltos. Podés seguir usando la app.';
 }
 async function check(){
  if(busy)return;busy=true;
  try{const state=await api('/api/erp/status');render(state);
   if(previous.available!==state.available||previous.lastConnected!==state.lastConnected){await onChange(state);previous=state;}
  }catch{badge.textContent='Sin conexión con Central';badge.classList.add('warn');banner.classList.remove('hidden');banner.textContent='No pude conectar con esta PC. Los seguimientos no se dieron por resueltos. Volvé a intentar cuando tengas red.';}
  finally{busy=false;}
 }
 render(initial);const timer=setInterval(()=>{if(!document.hidden)void check();},15000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check();});window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
 return {check};
}

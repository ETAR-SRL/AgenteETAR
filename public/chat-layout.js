// Layout only: keep business controls and their listeners in their original modules.
const sidebar=document.querySelector('#app-sidebar');
const main=document.querySelector('main');
const opener=document.querySelector('#open-navigation');
const closer=document.querySelector('#close-navigation');
const backdrop=document.querySelector('#navigation-backdrop');
const mobile=window.matchMedia('(max-width: 760px)');
const conversation=document.querySelector('#conversation');
const assistant=document.querySelector('#assistant');
const query=document.querySelector('#query');
const menus=[...document.querySelectorAll('.dropdown')];
let navigationOpen=false;

function closeMenus(except){
 for(const menu of menus)if(menu!==except)menu.open=false;
}
function setNavigation(open,{restoreFocus=true}={}){
 navigationOpen=open&&mobile.matches;
 document.body.classList.toggle('nav-open',navigationOpen);
 opener.setAttribute('aria-expanded',String(navigationOpen));
 backdrop.hidden=!navigationOpen;
 main.inert=navigationOpen;
 if(navigationOpen){closeMenus();closer.focus();}
 else if(restoreFocus&&mobile.matches)opener.focus();
}
opener.addEventListener('click',()=>setNavigation(!navigationOpen));
closer.addEventListener('click',()=>setNavigation(false));
backdrop.addEventListener('click',()=>setNavigation(false));
mobile.addEventListener('change',()=>setNavigation(false,{restoreFocus:false}));
sidebar.addEventListener('click',event=>{
 const button=event.target.closest('button');
 if(!button)return;
 if(button.id==='new-chat'){
  document.querySelector('.nav[data-view="assistant"]').click();
  setNavigation(false,{restoreFocus:false});query.focus();
 }else if(button.matches('[data-view]')){
  setNavigation(false,{restoreFocus:false});
  const heading=document.querySelector('.view:not(.hidden) h1');
  if(heading){heading.tabIndex=-1;heading.focus();}else query.focus();
 }else if(button.id==='chat-history')setNavigation(false,{restoreFocus:false});
});
for(const menu of menus){
 menu.querySelector('summary').addEventListener('click',()=>closeMenus(menu));
 menu.addEventListener('click',event=>{
  if(event.target.closest('.dropdown-panel button'))menu.open=false;
 });
}
document.addEventListener('click',event=>{
 if(!event.target.closest('.dropdown'))closeMenus();
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){
  if(navigationOpen){event.preventDefault();setNavigation(false);return;}
  const active=menus.find(menu=>menu.open);
  if(active){event.preventDefault();active.open=false;active.querySelector('summary').focus();}
 }
 if(event.key==='Tab'&&navigationOpen){
  const focusables=[...sidebar.querySelectorAll('button:not([disabled]),a[href],select')].filter(el=>!el.closest('.hidden')&&el.getClientRects().length);
  const first=focusables[0],last=focusables.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }
});
function syncConversation(){
 assistant.classList.toggle('has-conversation',conversation.childElementCount>0);
}
new MutationObserver(syncConversation).observe(conversation,{childList:true});
syncConversation();

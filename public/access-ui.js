const $=s=>document.querySelector(s);
const element=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
async function request(path,body,method='POST'){
 const r=await fetch(path,{method:body===undefined?'GET':method,credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
 const result=await r.json();if(!r.ok)throw new Error(result.error?.message||'No se pudo completar la operación');return result;
}
function clearLocal(){for(const key of Object.keys(localStorage))if(key.startsWith('central-'))localStorage.removeItem(key);}
let signedActor;
window.addEventListener('storage',event=>{if(signedActor&&event.key==='central-access-actor'&&event.newValue!==signedActor)location.reload();});
document.addEventListener('visibilitychange',async()=>{
 if(document.visibilityState!=='visible'||!signedActor)return;
 try{const state=await request('/api/auth/state');if(state.user?.actor!==signedActor)location.reload();}catch{}
});
export async function accessReady(){
 const state=await request('/api/auth/state');
 if(state.user){
  signedActor=state.user.actor;
  $('#access-identity').textContent=state.user.name+' · '+state.user.roleName;
  $('#access-nav').classList.toggle('hidden',!state.user.admin);
  $('#logout').classList.remove('hidden');
  return state.user;
 }
 $('#login-heading').textContent=state.setupRequired?'Creá tu administrador':'Ingresar a Central';
 $('#login-copy').textContent=state.setupRequired?'Este usuario administrará los roles y accesos. Elegí tu contraseña; después podrás agregar al equipo.':'Usá tu usuario personal. Los datos disponibles dependen de tu rol.';
 $('#login-name-label').classList.toggle('hidden',!state.setupRequired);$('#login-name').required=state.setupRequired;
 $('#login-password').autocomplete=state.setupRequired?'new-password':'current-password';
 $('#login-password').minLength=state.setupRequired?12:1;
 $('#login-dialog').showModal();
 $('#login-dialog').addEventListener('cancel',event=>event.preventDefault());
 $('#login-form').onsubmit=async event=>{
  event.preventDefault();$('#login-error').textContent='';$('#login-submit').disabled=true;
  try{await request(state.setupRequired?'/api/auth/setup':'/api/auth/login',{username:$('#login-user').value,name:$('#login-name').value,password:$('#login-password').value});clearLocal();location.reload();}
  catch(error){$('#login-error').textContent=error.message;}finally{$('#login-submit').disabled=false;}
 };
 return new Promise(()=>{});
}
$('#logout').onclick=async()=>{await request('/api/auth/logout',{});clearLocal();location.reload();};
let accessData;
function checks(where,items,selected=[]){
 where.replaceChildren();for(const {key,label} of items){const row=element('label'),input=element('input');input.type='checkbox';input.value=key;input.checked=selected.includes(key);row.append(input,document.createTextNode(label));where.append(row);}
}
function selected(selector){return [...document.querySelectorAll(selector+' input:checked')].map(el=>el.value);}
function editRole(role){
 $('#role-id').value=role?.id||'';$('#role-name').value=role?.name||'';
 checks($('#role-permissions'),accessData.permissions,role?.permissions);
 checks($('#role-branches'),accessData.branches.map(b=>({key:b,label:b})),role?.branches||accessData.branches);
}
function editUser(user){
 $('#user-id').value=user?.id||'';$('#user-username').value=user?.username||'';$('#user-name').value=user?.name||'';
 $('#user-password').value='';$('#user-password').required=!user;$('#user-active').checked=user?!!user.active:true;
 $('#user-role').value=user?.roleId||accessData.roles.find(r=>r.id!=='admin')?.id||'';
}
export async function loadAccessPanel(){
 try{
  accessData=await request('/api/admin/access');$('#access-error').textContent='';
  $('#role-list').replaceChildren();for(const role of accessData.roles){const row=element('div',role.name+' · '+(role.id==='admin'?'Acceso completo':role.permissions.length+' permisos'));if(role.id!=='admin'){const edit=element('button','Editar');edit.type='button';edit.className='secondary';edit.onclick=()=>editRole(role);row.append(edit);}$('#role-list').append(row);}
  const blank=element('option','Elegí un rol');blank.value='';$('#user-role').replaceChildren(blank);for(const role of accessData.roles){const option=element('option',role.name);option.value=role.id;$('#user-role').append(option);}
  $('#user-list').replaceChildren();for(const user of accessData.users){const row=element('div',`${user.name} (${user.username}) · ${user.active?'Activo':'Desactivado'} · ${accessData.roles.find(r=>r.id===user.roleId)?.name||''}`),edit=element('button','Editar');edit.type='button';edit.className='secondary';edit.onclick=()=>editUser(user);row.append(edit);$('#user-list').append(row);}
  const requirements=$('#access-requirements');requirements.replaceChildren();for(const [resource,needs] of Object.entries(accessData.resourceRequirements)){requirements.append(element('div',resource+': '+needs.map(key=>accessData.permissions.find(p=>p.key==='read:'+key)?.label||key).join(' + ')));}
  editRole();editUser();
 }catch(error){$('#access-error').textContent=error.message;}
}
$('#role-new').onclick=()=>editRole();$('#user-new').onclick=()=>editUser();
$('#role-form').onsubmit=async event=>{
 event.preventDefault();const id=$('#role-id').value;
 try{await request('/api/admin/roles'+(id?'/'+id:''),{name:$('#role-name').value,permissions:selected('#role-permissions'),branches:selected('#role-branches')},id?'PUT':'POST');await loadAccessPanel();}
 catch(error){$('#access-error').textContent=error.message;}
};
$('#user-form').onsubmit=async event=>{
 event.preventDefault();const id=$('#user-id').value;
 try{const result=await request('/api/admin/users'+(id?'/'+id:''),{username:$('#user-username').value,name:$('#user-name').value,password:$('#user-password').value,roleId:$('#user-role').value,active:$('#user-active').checked},id?'PUT':'POST');if(result.reauthenticate){clearLocal();location.reload();return;}await loadAccessPanel();}
 catch(error){$('#access-error').textContent=error.message;}
};

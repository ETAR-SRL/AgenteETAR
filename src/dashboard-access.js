import {canRead} from './access.js';
// Only the dashboard owner calls this after resource and branch authorization.
// Project current paths, never credentials or the complete account directory.
export function dashboardAccess(access,{resource,branch,targets,ownerId}){
 const direct=new Set(targets.filter(t=>t.kind==='user').map(t=>t.target)),roleIds=new Set(targets.filter(t=>t.kind==='role').map(t=>t.target));
 const roles=[...roleIds].map(id=>({id,name:access.role(id)?.name||'Rol eliminado',exists:!!access.role(id)}));
 const users=access.db.prepare('SELECT id,name,username,role_id,active FROM access_users ORDER BY name,username').all().filter(u=>u.id===ownerId||direct.has(u.id)||roleIds.has(u.role_id)).map(u=>{
  const principal=access.principal(u.id),rolePaths=roles.filter(r=>r.exists&&r.id===u.role_id),canOpen=!!principal&&canRead(principal,resource)&&principal.branches.includes(branch);
  return {id:u.id,name:`${u.name} (${u.username})`,direct:direct.has(u.id),owner:u.id===ownerId,roles:rolePaths.map(({id,name})=>({id,name})),canOpen,status:!u.active?'Usuario deshabilitado':!principal?'Sin rol vigente':!canRead(principal,resource)?'Sin permisos para el informe':!principal.branches.includes(branch)?'Sin acceso a la sucursal':'Acceso habilitado'};
 });
 for(const id of direct)if(!users.some(u=>u.id===id))users.push({id,name:'Usuario eliminado',direct:true,owner:false,roles:[],canOpen:false,status:'Usuario eliminado'});
 return {roles:roles.map(r=>({...r,members:users.filter(u=>u.roles.some(p=>p.id===r.id)).length})),users};
}

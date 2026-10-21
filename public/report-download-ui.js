// request follows fetch(url, options) and must preserve the personal session.
export function addReportDownload(card,result,{request=fetch,notice=()=>{}}={}){
 if(result?.kind!=='dashboard'||!result.meta?.recurso||!result.scope?.sucursal)return;
 const actions=document.createElement('div');actions.className='attention-actions';
 for(const [format,label]of [['html','Descargar informe HTML'],['xlsx','Descargar Excel']]){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=label;button.onclick=async()=>{button.disabled=true;try{
  const scope=result.scope,filters={...(scope.filtros||{}),sucursal:scope.sucursal,...(scope.desde?{desde:scope.desde}:{}),...(scope.hasta?{hasta:scope.hasta}:{}),agrupar:scope.agrupar||'mes'};
  const response=await request('/api/reports/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:result.meta.recurso,filters,format})});
  if(!response.ok){let error;try{error=await response.json();}catch{}throw new Error(error?.error?.message||error?.message||'No se pudo generar el informe con tus permisos actuales.');}
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${result.meta.recurso}-${new Date().toISOString().slice(0,10)}.${format}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Informe generado con una lectura nueva. Revisá su fecha y alcance.');
 }catch(error){notice(error.message);}finally{button.disabled=false;}};actions.append(button);}
 card.append(actions);return actions;
}

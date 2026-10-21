import {corporateDocumentsChat} from './corporate-documents-chat.js';
const fold=t=>t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function createOperationalChat({documents,knowledge,jobs,principal}){
 return async({text,conversation,branch})=>{
  const n=fold(text);
  const document=await corporateDocumentsChat(documents,principal(),text,conversation.corporateContext);
  if(document.handled){
   if(document.context)conversation.corporateContext={scope:document.context.scope,references:document.context.references.map(({connectionId,locationId,fileId})=>({connectionId,locationId,fileId}))};
   // El cuerpo documental no entra en memoria ni en modelos, tampoco como mensaje del asistente.
   return {answer:document.text,untrustedDocument:true,documentReferences:document.references||[],evidence:[],trace:[],noHistory:true};
  }
  if(/^(?:busca|mostra|consulta)(?:me)? (?:el )?conocimiento(?: aprobado)?(?: sobre (.+))?$/.test(n)){
   const q=n.match(/ sobre (.+)$/)?.[1]||'',result=knowledge.list({branch,q});
   return {answer:result.data.length?result.data.map(k=>`${k.title}\n${k.text}\nProcedencia: ${k.provenance}\n${k.policy}`).join('\n\n'):'No hay guías aprobadas y autorizadas para esa consulta.',evidence:[],trace:[],noHistory:true};
  }
  const list=/^(?:mostrame |mostra |ver )?mis (?:trabajos|investigaciones)(?: pendientes)?[?.!]*$/.test(n),action=/^(pausa|retoma|reanuda|cancela)(?:r|me)? (?:esta |esa |la )?investigacion(?:\s+([a-f0-9-]{36}))?[.!]?$/.exec(n),show=/^(?:mostrame|ver|abri)(?: el)? resultado(?: de (?:esta|esa|la) investigacion)?[.!]?$/.test(n);
  if(!list&&!action&&!show)return null;
  const all=jobs.list().data.filter(j=>j.branch===branch);
  if(list)return {answer:all.length?'Tus investigaciones. Cada una conserva su estado y evidencia; podés pausarla o cancelarla.':'No tenés investigaciones en esta sucursal.',jobs:all,evidence:[],trace:[]};
  const id=action?.[2]||conversation.jobContext?.id||(all.length===1?all[0].id:null);
  if(!id)return {answer:'Elegí la investigación desde «Mis trabajos» para indicarme cuál.',jobs:all,evidence:[],trace:[]};
  let job=jobs.get(id);if(job.branch!==branch)return {answer:'Esa investigación corresponde a otra sucursal. Abrila desde su caso.',evidence:[],trace:[]};
  if(action)job=jobs.act(id,action[1].startsWith('paus')?'pause':action[1].startsWith('cancel')?'cancel':'resume');
  conversation.jobContext={id:job.id,branch};
  return show&&job.result?{...job.result,job,answer:'Resultado de la investigación. La fecha indica cuándo se verificó; los valores actuales se vuelven a consultar antes de una propuesta.'}:{answer:action?'Guardé el cambio de estado de la investigación.':'La investigación todavía no tiene un resultado disponible.',job,evidence:[],trace:[]};
 };
}

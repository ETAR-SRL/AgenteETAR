import {AsyncLocalStorage} from 'node:async_hooks';
import {HttpError} from '../errors.js';

const explicitPublic=p=>p&&p.sin_ia_externa===false&&p.sin_ia_externa_por_cliente===false;
export function createExternalPrivacy(){
 const local=new AsyncLocalStorage();
 function restrict(){const state=local.getStore();if(!state)return;state.restricted=true;if(state.conversation&&!state.conversation.externalAIRestricted){state.conversation.externalAIRestricted=true;state.persist?.();}}
 const service={
  run:fn=>local.getStore()?fn():local.run({restricted:false},fn),
  attach(conversation,persist){const state=local.getStore();if(!state)return;state.conversation=conversation;state.persist=persist;
   if(conversation.externalAIRestricted)state.restricted=true;
   if(!conversation.externalAIReviewed){
    // Los historiales anteriores no guardaban la política de las fuentes: se tratan
    // conservadoramente, sin deducir permiso de los nombres ni de recuerdos del modelo.
    if(conversation.messages?.length)restrict();
    conversation.externalAIReviewed=true;
   }
  },
  observe(result){const data=result?.data,projects=Array.isArray(data)?data:data?.project?[data.project]:null;
   if(projects?.length?!projects.every(explicitPublic):result?.privacy?.externalAIAllowed!==true)restrict();return result;
  },
  model(model){return {get name(){return model.name;},get local(){return model.local;},status:()=>model.status(),complete:(...args)=>{
   if(model.local===false&&local.getStore()?.restricted)throw new HttpError(403,'IA_EXTERNA_RESTRINGIDA','Esta conversación contiene información de KAIQEN restringida o sin autorización comprobada para IA externa. Elegí IA local para continuar con esos datos.');return model.complete(...args);
  }};},
  kaiqen(source){const wrapped={...source};for(const method of ['projects','project','quality','projectLink','product'])if(source[method])wrapped[method]=async(...args)=>service.observe(await source[method](...args));return wrapped;}
 };
 return service;
}

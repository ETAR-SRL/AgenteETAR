import {HttpError} from '../errors.js';
export function createModel({url=process.env.AI_LOCAL_URL||'http://127.0.0.1:11434',model=process.env.AI_MODEL||'qwen3:4b',fetchImpl=fetch}={}){
  const base=new URL(url);
  if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname)||base.username||base.password||base.pathname!=='/')throw new Error('El modelo debe ejecutarse en loopback local');
  return {name:model,local:true,
    async status(){try{const r=await fetchImpl(new URL('/api/tags',base),{signal:AbortSignal.timeout(1500),redirect:'error'});const j=await r.json();return {available:r.ok&&j.models?.some(m=>m.name===model),model,local:true};}catch{return {available:false,model,local:true};}},
    async complete(messages,schema){
      try{
        const r=await fetchImpl(new URL('/api/chat',base),{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({model,messages,format:schema,stream:false,think:false,keep_alive:'30m',options:{temperature:0,num_ctx:8192,num_predict:900}}),signal:AbortSignal.timeout(180_000)});
        if(!r.ok)throw new Error();const result=await r.json();return JSON.parse(result.message.content);
      }catch{throw new HttpError(503,'IA_LOCAL_NO_DISPONIBLE','No se pudo obtener respuesta del modelo local. Verificá que el motor de inteligencia esté iniciado.');}
    }
  };
}

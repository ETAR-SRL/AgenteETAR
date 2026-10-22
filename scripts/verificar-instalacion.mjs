import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {X509Certificate} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {isIP} from 'node:net';
import {releaseFingerprint} from '../src/installation-identity.js';

function check(value,code){if(!value)throw new Error(code);}
export function installationTlsOptions({root,env,headers}){
  const origins=(env.LAN_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
  check(origins.length>0,'LAN_ORIGEN_REQUERIDO');
  const origin=new URL(origins[0]);const port=Number(env.LAN_PORT||4311);
  check(origin.protocol==='https:'&&!origin.username&&!origin.password&&origin.origin===origins[0]&&Number(origin.port||443)===port,'LAN_CONFIG_INVALIDA');
  const leafPath=resolve(root,'data/lan-client/central-servidor.cer'),caPath=resolve(root,'data/lan-client/central-ca.cer');
  const pinned=existsSync(leafPath);check(pinned||existsSync(caPath),'LAN_CERTIFICADO_PUBLICO_REQUERIDO');
  const certificate=new X509Certificate(readFileSync(pinned?leafPath:caPath));
  const now=Date.now();check(Date.parse(certificate.validFrom)<=now&&Date.parse(certificate.validTo)>now,'LAN_CERTIFICADO_VENCIDO');
  const hostname=origin.hostname.replace(/^\[|\]$/g,'');
  // Transporte siempre loopback; valida confianza y nombre del origen LAN.
  // El certificado nuevo se fija por huella; la instalación anterior confía
  // exclusivamente en su CA pública, conservando validación de la cadena.
  return {hostname:env.LAN_HOST==='::'?'::1':'127.0.0.1',port,path:'/api/agent/status',method:'GET',headers:{...headers,host:origin.host},servername:isIP(hostname)?undefined:hostname,ca:certificate.toString(),rejectUnauthorized:true,minVersion:'TLSv1.2',
    checkServerIdentity:(_name,peer)=>checkServerIdentity(hostname,peer)||(pinned&&peer.fingerprint256!==certificate.fingerprint256?new Error('LAN_CERTIFICADO_INCORRECTO'):undefined)};
}
export async function verifyLanIdentity({root,env,headers,expectedPid,fingerprint,timeoutMs=15000,requestImpl=httpsRequest}){
  const options=installationTlsOptions({root,env,headers});
  const identity=await new Promise((done,reject)=>{
    const req=requestImpl(options,response=>{
      let body='';response.setEncoding('utf8');
      response.on('data',chunk=>{body+=chunk;if(body.length>64000)req.destroy(new Error('LAN_RESPUESTA_INVALIDA'));});
      response.on('error',reject);response.on('end',()=>{try{check(response.statusCode===200,'LAN_HTTP_FALLIDO');done(JSON.parse(body));}catch(error){reject(error);}});
    });
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('LAN_TLS_TIMEOUT')));req.on('error',reject);req.end();
  });
  check(identity.installation?.pid===expectedPid&&identity.installation.releaseFingerprint===fingerprint,'LAN_PROCESO_INCORRECTO');
  return {required:true,verified:true,protocol:'HTTPS'};
}
export function silenceWav(){
  const bytes=32000,b=Buffer.alloc(44+bytes);b.write('RIFF');b.writeUInt32LE(36+bytes,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(bytes,40);return b;
}
export async function verifyInstallation({root,env,expectedPid,requireLocalAI=false,requireVoice=false,requireMaintenance=false,waitForAI=false,timeoutMs=180000,fetchImpl=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))}){
  check(env.API_READ_KEY?.length>=32,'CLAVE_SERVICIO_REQUERIDA');
  const host=env.HOST||'127.0.0.1';check(['127.0.0.1','::1'].includes(host),'HOST_NO_LOCAL');
  const base=`http://${host==='::1'?'[::1]':host}:${Number(env.PORT||4310)}`;
  const headers={authorization:`Bearer ${env.API_READ_KEY}`};
  async function request(path,options={}){
    const response=await fetchImpl(base+path,{...options,headers:{...headers,...options.headers},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
    check(response.ok,'HTTP_VERIFICACION_'+response.status);return response.json();
  }
  const deadline=Date.now()+Math.min(timeoutMs,90000);let healthy=false,health;
  do{try{const response=await fetchImpl(base+'/health',{redirect:'error',signal:AbortSignal.timeout(2500)});health=response.ok?await response.json():null;healthy=health?.status==='up';}catch{}
    if(healthy&&requireMaintenance)check(health.maintenance===true,'MANTENIMIENTO_NO_CONFIRMADO');
    if(!healthy)await pause(1000);
  }while(!healthy&&Date.now()<deadline);
  check(healthy,'SERVIDOR_NO_DISPONIBLE');
  const status=await request('/api/agent/status');
  const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
  const version=readFileSync(resolve(root,'src/intelligence/agent.js'),'utf8').match(/\bversion:\s*['"](operativo-local-[^'"]+)['"]/)?.[1];
  check(version&&status.version===version&&status.installation?.applicationVersion===pkg.version&&status.installation.releaseFingerprint===releaseFingerprint(root),'VERSION_ACTIVA_INCORRECTA');
  if(!expectedPid){const path=resolve(root,'data/server.pid');check(existsSync(path),'PID_SERVIDOR_REQUERIDO');expectedPid=Number(readFileSync(path,'utf8').trim());}
  check(Number.isSafeInteger(expectedPid)&&expectedPid>0&&status.installation.pid===expectedPid,'PROCESO_ACTIVO_INCORRECTO');
  let sources=await request('/api/sources/status');
  // El supervisor inicia ambos procesos; Ollama puede tardar unos segundos mas.
  // No exigir conexion ERP ni confundir esa demora con una instalacion fallida.
  if(requireLocalAI&&waitForAI)for(let attempt=0;attempt<30&&!(sources.ai?.local===true&&sources.ai.available===true);attempt++){await pause(1000);sources=await request('/api/sources/status');}
  check(typeof sources.erp?.state==='string'&&typeof sources.kaiqen?.state==='string','ESTADO_FUENTES_INVALIDO');
  const result={ok:true,checkedAt:new Date().toISOString(),applicationVersion:pkg.version,agentVersion:version,pid:expectedPid,releaseFingerprint:status.installation.releaseFingerprint,sources:{erp:sources.erp.state,kaiqen:sources.kaiqen.state},localAI:{required:requireLocalAI,verified:false},voice:{required:requireVoice,verified:false}};
  result.lan=env.LAN_HTTPS_ENABLED==='true'?await verifyLanIdentity({root,env,headers,expectedPid,fingerprint:status.installation.releaseFingerprint}):{required:false,verified:false};
  if(requireLocalAI){
    check(sources.ai?.local===true&&sources.ai.available===true&&typeof sources.ai.model==='string','IA_LOCAL_NO_DISPONIBLE');
    const url=new URL(env.AI_LOCAL_URL||'http://127.0.0.1:11434');
    check(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash,'IA_URL_NO_LOCAL');
    const response=await fetchImpl(new URL('/api/chat',url),{method:'POST',redirect:'error',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(timeoutMs),body:JSON.stringify({model:sources.ai.model,messages:[{role:'user',content:'Respondé solamente OK.'}],stream:false,think:false,keep_alive:'30m',options:{temperature:0,num_predict:16,num_ctx:2048}})});
    check(response.ok,'IA_INFERENCIA_FALLIDA');const inference=await response.json();
    check(inference.done===true&&typeof inference.message?.content==='string'&&inference.message.content.trim().length>0,'IA_INFERENCIA_INVALIDA');
    result.localAI={required:true,verified:true,model:sources.ai.model};
  }
  if(requireVoice){
    const voice=await request('/api/voice/status');check(voice.available===true,'VOZ_NO_DISPONIBLE');
    // Silencio sintético evita distribuir grabaciones; texto vacío es válido.
    const transcription=await request('/api/voice/transcribe',{method:'POST',headers:{'content-type':'audio/wav'},body:silenceWav()});
    check(typeof transcription.text==='string'&&transcription.engine==='whisper-base-local'&&transcription.externalAudio===false,'VOZ_TRANSCRIPCION_INVALIDA');
    result.voice={required:true,verified:true,engine:transcription.engine};
  }
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),allowed=new Set(['--root','--expected-pid','--require-local-ai','--require-voice','--require-maintenance']);
    for(let i=0;i<args.length;i++){check(allowed.has(args[i]),'OPCION_INVALIDA');if(['--root','--expected-pid'].includes(args[i]))check(args[++i]&&!args[i].startsWith('--'),'OPCION_SIN_VALOR');}
    const value=key=>args.includes(key)?args[args.indexOf(key)+1]:undefined;
    const root=resolve(value('--root')||fileURLToPath(new URL('../',import.meta.url)));
    const env=parseEnv(readFileSync(resolve(root,'.env'),'utf8'));
    console.log(JSON.stringify(await verifyInstallation({root,env,expectedPid:value('--expected-pid')?Number(value('--expected-pid')):undefined,requireLocalAI:args.includes('--require-local-ai'),requireVoice:args.includes('--require-voice'),requireMaintenance:args.includes('--require-maintenance'),waitForAI:true})));
  }catch(error){console.error(JSON.stringify({ok:false,code:/^[A-Z][A-Z_0-9]+$/.test(error.message)?error.message:'VERIFICACION_FALLIDA'}));process.exitCode=1;}
}

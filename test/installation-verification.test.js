import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createApp} from '../src/app.js';
import {createDemoErp,createDemoKaiqen} from '../src/demo.js';
import {Store} from '../src/store.js';
import {verifyInstallation,silenceWav,installationTlsOptions,verifyLanIdentity} from '../scripts/verificar-instalacion.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';

const root=fileURLToPath(new URL('../',import.meta.url));
const key='installation-service-read-key-000000000000';
async function fixture(t,{ai=true,voice=true}={}){
  const store=new Store(':memory:');let transcriptionCalls=0;
  const erp={...createDemoErp(),status:()=>({state:'unavailable',available:false}),list:()=>assert.fail('No debe consultar filas ERP')};
  const server=createApp({erp,kaiqen:{...createDemoKaiqen(),status:()=>({state:'unavailable',available:false})},store,readKey:key,planKey:'installation-plan-key-00000000000000000000',
    model:{name:'test-local',local:true,status:async()=>({local:true,available:ai,model:'test-local'}),complete:()=>assert.fail('No debe ejecutar chat comercial')},
    voice:{status:()=>({available:voice}),transcribe:async req=>{transcriptionCalls++;const chunks=[];for await(const c of req)chunks.push(c);assert.deepEqual(Buffer.concat(chunks),silenceWav());return {text:'',engine:'whisper-base-local',externalAudio:false};}}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.close();server.closeAllConnections();store.close();});
  const env={API_READ_KEY:key,PORT:String(server.address().port)};
  let inferenceCalls=0;
  const fetchImpl=async(url,options)=>{
    if(String(url).startsWith('http://127.0.0.1:11434/')){inferenceCalls++;assert.equal(options.headers.authorization,undefined);const input=JSON.parse(options.body);assert.equal(input.model,'test-local');assert.equal(input.messages.length,1);return Response.json({done:true,message:{content:'OK'}});}
    return fetch(url,options);
  };
  return {env,fetchImpl,base:`http://127.0.0.1:${env.PORT}`,calls:()=>({transcriptionCalls,inferenceCalls}),run:overrides=>verifyInstallation({root,env,expectedPid:process.pid,requireLocalAI:true,requireVoice:true,fetchImpl,...overrides})};
}
test('verifica PID/version, inferencia y voz aun con ERP/KAIQEN desconectados; no publica secretos ni transcripciones',async t=>{
  const f=await fixture(t);const report=await f.run();
  assert.equal(report.ok,true);assert.deepEqual(report.sources,{erp:'unavailable',kaiqen:'unavailable'});
  assert.equal(report.localAI.verified,true);assert.equal(report.voice.verified,true);assert.deepEqual(f.calls(),{transcriptionCalls:1,inferenceCalls:1});assert.ok(!JSON.stringify(report).includes(key));assert.ok(!JSON.stringify(report).includes('text'));
});
test('rechaza otra version cargada y otro proceso aun con HTTP sano',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.run({expectedPid:process.pid+1}),/PROCESO_ACTIVO_INCORRECTO/);
  await assert.rejects(f.run({fetchImpl:async(url,options)=>{const response=await f.fetchImpl(url,options);if(String(url).endsWith('/api/agent/status')){const data=await response.json();data.installation.releaseFingerprint='old';return Response.json(data);}return response;}}),/VERSION_ACTIVA_INCORRECTA/);
  assert.deepEqual(f.calls(),{transcriptionCalls:0,inferenceCalls:0});
});
test('IA o voz ausente nunca cuenta como instalacion completa',async t=>{
  const noAI=await fixture(t,{ai:false});await assert.rejects(noAI.run(),/IA_LOCAL_NO_DISPONIBLE/);
  const noVoice=await fixture(t,{voice:false});await assert.rejects(noVoice.run(),/VOZ_NO_DISPONIBLE/);
});

test('actualizacion exige mantenimiento activo, no alcanza con que HTTP responda',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.run({requireMaintenance:true}),/MANTENIMIENTO_NO_CONFIRMADO/);
 assert.deepEqual(f.calls(),{transcriptionCalls:0,inferenceCalls:0});
 const report=await f.run({requireMaintenance:true,fetchImpl:async(url,options)=>{const response=await f.fetchImpl(url,options);if(String(url).endsWith('/health')){const value=await response.json();return Response.json({...value,maintenance:true});}return response;}});
 assert.equal(report.ok,true);
});

test('espera el inicio de Ollama sin exigir que las fuentes comerciales esten conectadas',async t=>{
 const f=await fixture(t);let reviews=0,pauses=0;
 const report=await f.run({waitForAI:true,pause:async()=>{pauses++;},fetchImpl:async(url,options)=>{const response=await f.fetchImpl(url,options);if(String(url).endsWith('/api/sources/status')){const data=await response.json();data.ai.available=++reviews>=3;return Response.json(data);}return response;}});
 assert.equal(report.ok,true);assert.equal(pauses,2);assert.equal(reviews,3);assert.equal(report.sources.erp,'unavailable');assert.equal(f.calls().inferenceCalls,1);
});
test('inferencia vacia o fallida no demuestra que el modelo funciona',async t=>{
  const f=await fixture(t);
  for(const result of [{done:false,message:{content:'OK'}},{done:true,message:{content:''}}])await assert.rejects(f.run({fetchImpl:(url,options)=>String(url).includes(':11434/')?Promise.resolve(Response.json(result)):f.fetchImpl(url,options)}),/IA_INFERENCIA_INVALIDA/);
});
test('metadatos exigen autenticacion; clave servicio conserva limites administrativos',async t=>{
  const f=await fixture(t);
  assert.equal((await fetch(f.base+'/api/agent/status')).status,401);
  assert.equal((await fetch(f.base+'/api/agent/status',{headers:{authorization:'Bearer '+key}})).status,200);
  assert.equal((await fetch(f.base+'/api/admin/ai/test',{method:'POST',headers:{authorization:'Bearer '+key}})).status,403);
  await assert.rejects(f.run({env:{...f.env,API_READ_KEY:''}}),/CLAVE_SERVICIO_REQUERIDA/);
});
test('LAN exige certificado publico, cadena confiable y nombre; verifica el mismo PID/huella por HTTPS',async t=>{
  const temporary=mkdtempSync(join(tmpdir(),'central-tls-test-'));t.after(()=>rmSync(temporary,{recursive:true,force:true}));
  const options={root:temporary,env:{LAN_ORIGINS:'https://central.internal:4311',LAN_PORT:'4311'},headers:{authorization:'Bearer test'},expectedPid:123,fingerprint:'release'};
  assert.throws(()=>installationTlsOptions(options),/LAN_CERTIFICADO_PUBLICO_REQUERIDO/);
  mkdirSync(join(temporary,'data/lan-client'),{recursive:true});
  const certificate=rootCertificates.find(pem=>{const c=new X509Certificate(pem);return Date.parse(c.validFrom)<Date.now()&&Date.parse(c.validTo)>Date.now();});
  writeFileSync(join(temporary,'data/lan-client/central-servidor.cer'),certificate);
  const tls=installationTlsOptions(options);
  assert.equal(tls.rejectUnauthorized,true);assert.equal(tls.hostname,'127.0.0.1');assert.equal(tls.servername,'central.internal');assert.equal(tls.headers.host,'central.internal:4311');
  assert.ok(tls.checkServerIdentity('127.0.0.1',{subjectaltname:'DNS:other.internal'}));
  assert.match(tls.checkServerIdentity('127.0.0.1',{subjectaltname:'DNS:central.internal',fingerprint256:'wrong'}).message,/LAN_CERTIFICADO_INCORRECTO/);
  const requestImpl=identity=>(_options,callback)=>{const req=new EventEmitter();req.setTimeout=()=>req;req.end=()=>{const response=Readable.from([JSON.stringify(identity)]);response.statusCode=200;callback(response);};return req;};
  assert.equal((await verifyLanIdentity({...options,requestImpl:requestImpl({installation:{pid:123,releaseFingerprint:'release'}})})).verified,true);
  await assert.rejects(verifyLanIdentity({...options,requestImpl:requestImpl({installation:{pid:999,releaseFingerprint:'release'}})}),/LAN_PROCESO_INCORRECTO/);
});

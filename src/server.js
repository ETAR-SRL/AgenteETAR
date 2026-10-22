import {createMaintenance,maintenanceDurableCounts} from './maintenance.js';
import {createApprovalScheduler} from './approval-scheduler.js';
import {loadLanConfig,createLanServer} from './lan-server.js';
import {once} from 'node:events';
import { resolve } from 'node:path';
import { Store } from './store.js';
import { createApp } from './app.js';
import { createDemoErp,createDemoKaiqen } from './demo.js';
import { createKaiqen } from './kaiqen.js';
import { createErp } from './protheus/index.js';
import {createErpConnection} from './protheus/connection.js';
import {createReadSource} from './read-source.js';
import {loadConfig} from './protheus/config.js';
import {validateDatabaseConfig} from './protheus/database.js';
import { createKaiqenPostgres } from './kaiqen-postgres.js';

const mode=process.env.MODE||'live';
if(!['demo','live'].includes(mode))throw new Error('MODE debe ser live o demo');
const {network,lan}=loadLanConfig();
const configPath=process.env.CONFIG_PATH||'config/mapping.json';
// Los errores locales de configuración siguen siendo explícitos; la red no bloquea el arranque.
if(mode==='live'){loadConfig(configPath);validateDatabaseConfig(process.env);}
const maintenance=createMaintenance();
let server;
const erp=mode==='demo'?createDemoErp():createErpConnection({connect:()=>createErp({configPath}),writeEnabled:process.env.ERP_WRITE_ENABLED==='true',branches:(process.env.ERP_BRANCHES||'0101').split(','),retryMs:Number(process.env.ERP_RECONNECT_MS||5000),maxRetryMs:Number(process.env.ERP_RECONNECT_MAX_MS||60000),probeMs:Number(process.env.ERP_HEALTH_POLL_MS||15000),onState:state=>{if(!maintenance.active()&&state.state==='unavailable')server?.attention.erpUnavailable();if(!maintenance.active()&&state.state==='available')server?.attention.erpAvailable();}});
const kaiqen=mode==='demo'?createDemoKaiqen():createReadSource({source:process.env.KAIQEN_SOURCE==='postgres'?'postgres':'api',configured:process.env.KAIQEN_SOURCE==='postgres'?!!process.env.KAIQEN_DATABASE_URL:!!(process.env.KAIQEN_BASE_URL&&process.env.KAIQEN_TOKEN),factory:()=>process.env.KAIQEN_SOURCE==='postgres'
  ?createKaiqenPostgres({connectionString:process.env.KAIQEN_DATABASE_URL,tenantId:process.env.KAIQEN_TENANT_ID,caFile:process.env.KAIQEN_CA_FILE})
  :createKaiqen({baseUrl:process.env.KAIQEN_BASE_URL,token:process.env.KAIQEN_TOKEN}),onState:s=>{if(!maintenance.active()&&s.state==='unavailable')server?.attention.kaiqenUnavailable();if(!maintenance.active()&&s.state==='available')server?.attention.kaiqenAvailable();}});
const store=new Store(resolve(process.env.DATA_DIR||'data','agent.sqlite'));
const approvalScheduler=createApprovalScheduler({adapter:erp.writes?.escalation,store,enabled:mode==='live'&&process.env.ERP_APPROVAL_AUTO_ESCALATE==='true',intervalMs:Number(process.env.ERP_APPROVAL_POLL_MS||60000)});
server=createApp({erp,kaiqen,store,mode,approvalScheduler,maintenance,network,branches:(process.env.ERP_BRANCHES||'0101').split(','),readKey:process.env.API_READ_KEY,planKey:process.env.API_PLAN_KEY,writeKey:process.env.API_WRITE_KEY,attentionOptions:{enabled:process.env.ATTENTION_ENABLED!=='false',intervalMs:Number(process.env.ATTENTION_POLL_MS||300000)},notificationOptions:{enabled:process.env.ATTENTION_PUSH_ENABLED!=='false',contact:process.env.ATTENTION_PUSH_CONTACT||'https://github.com/ETAR-SRL/AgenteETAR'},corporateOptions:{key:process.env.DOCUMENTS_TOKEN_KEY,providers:{google:{clientId:process.env.DOCUMENTS_GOOGLE_CLIENT_ID,clientSecret:process.env.DOCUMENTS_GOOGLE_CLIENT_SECRET,redirectUri:process.env.DOCUMENTS_GOOGLE_REDIRECT_URI},microsoft:{clientId:process.env.DOCUMENTS_MICROSOFT_CLIENT_ID,clientSecret:process.env.DOCUMENTS_MICROSOFT_CLIENT_SECRET,tenantId:process.env.DOCUMENTS_MICROSOFT_TENANT_ID,redirectUri:process.env.DOCUMENTS_MICROSOFT_REDIRECT_URI}}},localWrites:process.env.LOCAL_WRITE_ENABLED==='true'});
maintenance.attach({workers:[approvalScheduler,server.attention,server.jobs,server.notifications],durable:()=>maintenanceDurableCounts(store.db),onRelease:()=>{erp.start?.();kaiqen.start?.();approvalScheduler.resume();server.attention.resume();server.jobs.resume();server.notifications.resume();}});
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4310);
if(!['127.0.0.1','::1'].includes(host))throw new Error('HOST HTTP debe ser loopback; usar LAN_HTTPS_ENABLED para acceso de red.');
const listeners=[server,...(lan?[createLanServer(server,lan)]:[])];
const starts=listeners.map(s=>once(s,'listening'));
server.listen(port,host);
if(lan)listeners[1].listen(lan.port,lan.host);
await Promise.all(starts);
if(!maintenance.active()){
 if(mode==='live')server.attention.erpUnavailable();
 erp.start?.();kaiqen.start?.();approvalScheduler.start();server.attention.start();server.jobs.start();server.notifications.start();
}
console.log(JSON.stringify({status:'listening',url:`http://${host}:${port}`,lan:lan?.origins||[],mode,writeExecution:erp.writes?.enabled===true}));
let closing=false;
async function close(){if(closing)return;closing=true;setTimeout(()=>process.exit(1),10000).unref();await maintenance.close();await approvalScheduler.stop();await server.jobs.stop();await server.attention.stop();await server.notifications.stop();await Promise.all(listeners.map(s=>new Promise(resolve=>s.close(resolve))));await erp.close();await kaiqen.close?.();store.close();process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);

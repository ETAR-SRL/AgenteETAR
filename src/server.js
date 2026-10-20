import {createApprovalScheduler} from './approval-scheduler.js';
import {loadLanConfig,createLanServer} from './lan-server.js';
import {once} from 'node:events';
import { resolve } from 'node:path';
import { Store } from './store.js';
import { createApp } from './app.js';
import { createDemoErp,createDemoKaiqen } from './demo.js';
import { createKaiqen } from './kaiqen.js';
import { createErp } from './protheus/index.js';
import { createKaiqenPostgres } from './kaiqen-postgres.js';

const mode=process.env.MODE||'live';
if(!['demo','live'].includes(mode))throw new Error('MODE debe ser live o demo');
const {network,lan}=loadLanConfig();
const erp=mode==='demo'?createDemoErp():await createErp({configPath:process.env.CONFIG_PATH||'config/mapping.json'});
const kaiqen=mode==='demo'?createDemoKaiqen():process.env.KAIQEN_SOURCE==='postgres'
  ?createKaiqenPostgres({connectionString:process.env.KAIQEN_DATABASE_URL,tenantId:process.env.KAIQEN_TENANT_ID,caFile:process.env.KAIQEN_CA_FILE})
  :createKaiqen({baseUrl:process.env.KAIQEN_BASE_URL,token:process.env.KAIQEN_TOKEN});
const store=new Store(resolve(process.env.DATA_DIR||'data','agent.sqlite'));
const approvalScheduler=createApprovalScheduler({adapter:erp.writes?.escalation,store,enabled:mode==='live'&&process.env.ERP_APPROVAL_AUTO_ESCALATE==='true',intervalMs:Number(process.env.ERP_APPROVAL_POLL_MS||60000)});
const server=createApp({erp,kaiqen,store,mode,approvalScheduler,network,branches:(process.env.ERP_BRANCHES||'0101').split(','),readKey:process.env.API_READ_KEY,planKey:process.env.API_PLAN_KEY,writeKey:process.env.API_WRITE_KEY,localWrites:process.env.LOCAL_WRITE_ENABLED==='true'});
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4310);
if(!['127.0.0.1','::1'].includes(host))throw new Error('HOST HTTP debe ser loopback; usar LAN_HTTPS_ENABLED para acceso de red.');
const listeners=[server,...(lan?[createLanServer(server,lan)]:[])];
const starts=listeners.map(s=>once(s,'listening'));
server.listen(port,host);
if(lan)listeners[1].listen(lan.port,lan.host);
await Promise.all(starts);
approvalScheduler.start();
console.log(JSON.stringify({status:'listening',url:`http://${host}:${port}`,lan:lan?.origins||[],mode,writeExecution:erp.writes?.enabled===true}));
let closing=false;
async function close(){if(closing)return;closing=true;setTimeout(()=>process.exit(1),5000).unref();await approvalScheduler.stop();await Promise.all(listeners.map(s=>new Promise(resolve=>s.close(resolve))));await erp.close();await kaiqen.close?.();store.close();process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);

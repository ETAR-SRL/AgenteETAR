import { resolve } from 'node:path';
import { Store } from './store.js';
import { createApp } from './app.js';
import { createDemoErp,createDemoKaiqen } from './demo.js';
import { createKaiqen } from './kaiqen.js';
import { createErp } from './protheus/index.js';
import { createKaiqenPostgres } from './kaiqen-postgres.js';

const mode=process.env.MODE||'live';
if(!['demo','live'].includes(mode))throw new Error('MODE debe ser live o demo');
const erp=mode==='demo'?createDemoErp():await createErp({configPath:process.env.CONFIG_PATH||'config/mapping.json'});
const kaiqen=mode==='demo'?createDemoKaiqen():process.env.KAIQEN_SOURCE==='postgres'
  ?createKaiqenPostgres({connectionString:process.env.KAIQEN_DATABASE_URL,tenantId:process.env.KAIQEN_TENANT_ID,caFile:process.env.KAIQEN_CA_FILE})
  :createKaiqen({baseUrl:process.env.KAIQEN_BASE_URL,token:process.env.KAIQEN_TOKEN});
const store=new Store(resolve(process.env.DATA_DIR||'data','agent.sqlite'));
const server=createApp({erp,kaiqen,store,mode,branches:(process.env.ERP_BRANCHES||'0101').split(','),readKey:process.env.API_READ_KEY,planKey:process.env.API_PLAN_KEY,writeKey:process.env.API_WRITE_KEY,localWrites:process.env.LOCAL_WRITE_ENABLED==='true'});
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4310);
server.listen(port,host,()=>console.log(JSON.stringify({status:'listening',url:`http://${host}:${port}`,mode,writeExecution:erp.writes?.enabled===true})));
let closing=false;
async function close(){if(closing)return;closing=true;server.close(async()=>{await erp.close();await kaiqen.close?.();store.close();process.exit(0);});setTimeout(()=>process.exit(1),5000).unref();}
process.on('SIGTERM',close);process.on('SIGINT',close);

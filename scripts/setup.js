import { existsSync,writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if(existsSync('.env'))throw new Error('Ya existe .env; no se sobrescribe');
const source=process.argv[2];
if(!source)throw new Error('Uso: node scripts/setup.js RUTA_ENV_MIDDLEWARE');
process.loadEnvFile(source);
const selected=['DB_SERVER','DB_DATABASE','DB_USER','DB_PASSWORD','DB_PORT','DB_INSTANCE','DB_ENCRYPT','DB_TRUST_SERVER_CERTIFICATE'];
const settings={MODE:'live',HOST:'127.0.0.1',PORT:'4310',ERP_BRANCHES:'0101',CONFIG_PATH:'config/mapping.json',DATA_DIR:'data',API_READ_KEY:randomBytes(32).toString('hex'),API_PLAN_KEY:randomBytes(32).toString('hex'),KAIQEN_BASE_URL:'',KAIQEN_TOKEN:''};
for(const key of selected)if(process.env[key]!==undefined)settings[key]=process.env[key];
// Node dotenv no interpreta escapes JSON de forma general. Rechazar valores
// imposibles de encerrar en comillas simples antes de escribir secretos.
for(const value of Object.values(settings))if(/[\r\n']/.test(value))throw new Error('Un valor requiere configuración manual; no se imprimen secretos');
writeFileSync('.env',Object.entries(settings).map(([k,v])=>`${k}='${v}'`).join('\n')+'\n',{flag:'wx',mode:0o600});
console.log('Configuración creada en .env con claves locales nuevas. No se muestran credenciales.');

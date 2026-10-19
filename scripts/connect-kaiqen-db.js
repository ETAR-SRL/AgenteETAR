import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import pg from 'pg';
import { updateEnvFile } from '../src/env-file.js';
const project='0b32a848f7ec4d72bd635ca171764866';
const raw=readFileSync(process.argv[2],'utf8');
const assignment=/^\s*DESTINO_PG_URL\s*=\s*(.+?)\s*$/m.exec(raw)?.[1];
const rawUrl=assignment?.replace(/^(["'])(.*)\1$/,'$2');
const parts=/^(postgres(?:ql)?:\/\/)([^:/@]+):(.*)@([^@]+)$/.exec(rawUrl||'');
const connectionString=parts?`${parts[1]}${parts[2]}:${/^[A-Za-z0-9._~%\-]*$/.test(parts[3])?parts[3]:encodeURIComponent(parts[3])}@${parts[4]}`:rawUrl;
if(!connectionString)throw new Error('No hay conexión de destino configurada');
let client;
try{
  const caFile=process.argv[3]||'config/supabase-ca.crt';
  client=new pg.Client({connectionString,ssl:{rejectUnauthorized:true,ca:readFileSync(caFile,'utf8')},connectionTimeoutMillis:10000,query_timeout:15000,application_name:'centralizador-kaiqen-readonly'});
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const found=await client.query('SELECT id, tenant_id FROM public.project WHERE id=$1',[project]);
  if(found.rows.length!==1)throw new Error('PROJECT_NOT_FOUND');
  const tenant=found.rows[0].tenant_id;
  updateEnvFile(resolve('.env'),{KAIQEN_BASE_URL:'https://kaiqen.up.railway.app',KAIQEN_SOURCE:'postgres',KAIQEN_DATABASE_URL:connectionString,KAIQEN_TENANT_ID:tenant,KAIQEN_PROJECT_ID:project,KAIQEN_CA_FILE:caFile});
  const readOnly=await client.query('SHOW transaction_read_only');
  const columns=await client.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND (table_name IN ('project','part','open_issue','nc_report','ppap_package','gate_review','apqp_phase_instance','erp_producto','customer','cat_phase','cat_deliverable_status','cat_issue_status','cat_ppap_approval','cat_gate') OR table_name LIKE '%life%' OR table_name LIKE '%capability%' OR table_name LIKE '%msa%') ORDER BY table_name,ordinal_position");
  const {writeFileSync}=await import('node:fs');
  writeFileSync('reports/kaiqen-schema.json',JSON.stringify({checkedAt:new Date().toISOString(),columns:columns.rows},null,2));
  await client.query('ROLLBACK');
  console.log(JSON.stringify({connected:true,projectFound:true,tenantScoped:true,tlsEncrypted:client.connection.stream.encrypted===true,tlsVerified:client.connection.stream.authorized===true,transactionReadOnly:readOnly.rows[0].transaction_read_only,metadataTables:[...new Set(columns.rows.map(x=>x.table_name))]}));
}catch(error){console.log(JSON.stringify({connected:false,code:error.code||'CONNECTION_OR_SCOPE_ERROR',credentialsSuppressed:true}));process.exitCode=1;}
finally{await client?.end().catch(()=>{});}

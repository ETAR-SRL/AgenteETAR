import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {migratedConfiguration,prepareConfiguration} from '../scripts/prepare-server-config.mjs';

test('server migration rebases known paths, preserves private text and starts without duplicate commercial workers',()=>{
 const secret='literal-$-precio-$&';
 const before=`DB_PASSWORD=${secret}\nCONFIG_PATH=C:\\Servidor viejo\\config\\mapping.json\nKAIQEN_CA_FILE=config/ca.crt\nDATA_DIR=C:\\Servidor viejo\\data\nERP_WRITE_ENABLED=true\nERP_APPROVAL_AUTO_ESCALATE=true\nLAN_HTTPS_ENABLED=true\nATTENTION_PUSH_ENABLED=true\n`;
 const result=migratedConfiguration(before,{sourceRoot:'C:\\Servidor viejo',targetRoot:'D:\\Central'});
 assert.match(result.text,/CONFIG_PATH=config\/mapping.json/);assert.ok(result.text.includes(`DB_PASSWORD=${secret}`));
 for(const key of ['ERP_WRITE_ENABLED','LOCAL_WRITE_ENABLED','ERP_APPROVAL_AUTO_ESCALATE','LAN_HTTPS_ENABLED','ATTENTION_PUSH_ENABLED'])assert.ok(result.text.includes(key+'=false'));
 assert.match(result.text,/DATA_DIR=data/);assert.match(result.text,/KAIQEN_CA_FILE=config\/ca.crt/);
 assert.throws(()=>migratedConfiguration('CONFIG_PATH=D:\\externo\\secret.json',{sourceRoot:'C:\\Servidor viejo',targetRoot:'D:\\Central'}),/CONFIG_PATH/);
 const withHash=migratedConfiguration('CONFIG_PATH="C:\\Servidor viejo\\config\\map #1.json"',{sourceRoot:'C:\\Servidor viejo',targetRoot:'D:\\Central'});assert.equal(parseEnv(withHash.text).CONFIG_PATH,'config/map #1.json');
});
test('private migration is durable and idempotent and does not overwrite later operator choices',()=>{
 const root=mkdtempSync(join(tmpdir(),'ETAR instalacion ñ '));
 try{
  mkdirSync(join(root,'data'));writeFileSync(join(root,'package-origin.json'),JSON.stringify({sourceRoot:'C:\\Servidor viejo'}));writeFileSync(join(root,'.env'),'DB_PASSWORD=privado\nERP_WRITE_ENABLED=true\n');
  assert.equal(prepareConfiguration(root).changed,true);assert.match(readFileSync(join(root,'data/install-backups/original.env'),'utf8'),/ERP_WRITE_ENABLED=true/);
  writeFileSync(join(root,'.env'),'ERP_WRITE_ENABLED=true\n');assert.equal(prepareConfiguration(root).changed,false);assert.equal(readFileSync(join(root,'.env'),'utf8'),'ERP_WRITE_ENABLED=true\n');
 }finally{rmSync(root,{recursive:true,force:true});}
});

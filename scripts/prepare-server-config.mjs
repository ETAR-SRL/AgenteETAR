import {readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,dirname,win32} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';

const portableKeys=['CONFIG_PATH','ERP_MAPPING_PATH','KAIQEN_CA_FILE','LAN_TLS_PFX','LAN_TLS_PASSWORD_FILE'];
export function migratedConfiguration(text,{sourceRoot,targetRoot}){
  const env=parseEnv(text.replace(/^\uFEFF/,''));const settings={DATA_DIR:'data',ERP_WRITE_ENABLED:'false',LOCAL_WRITE_ENABLED:'false',ERP_APPROVAL_AUTO_ESCALATE:'false',ATTENTION_PUSH_ENABLED:'false',LAN_HTTPS_ENABLED:'false',AI_PROVIDER:'local',AI_LOCAL_URL:'http://127.0.0.1:11434'};
  for(const key of portableKeys){
    const value=env[key];if(!value||!win32.isAbsolute(value))continue;
    const relative=win32.relative(sourceRoot,value);
    if(relative.startsWith('..')||win32.isAbsolute(relative))throw new Error(`La ruta ${key} estaba fuera de la instalacion original. Configurar su archivo local antes de instalar.`);
    settings[key]=relative.replaceAll('\\','/');
  }
  let output=text.replace(/^\uFEFF/,'');
  for(const [key,value] of Object.entries(settings)){
    const replacement=`${key}=${/[\s#]/.test(value)?JSON.stringify(value):value}`;const pattern=new RegExp(`^${key}=[^\\r\\n]*`,'gm');
    output=pattern.test(output)?output.replace(pattern,()=>replacement):output.trimEnd()+'\n'+replacement+'\n';
  }
  return {text:output,changedKeys:Object.keys(settings),root:targetRoot};
}

export function prepareConfiguration(root){
  const marker=resolve(root,'data/install-target.json');
  if(existsSync(marker)){
    const prior=JSON.parse(readFileSync(marker,'utf8'));if(prior.targetRoot!==root)throw new Error('La instalacion preparada pertenece a otra carpeta; revisar el traslado antes de continuar.');
    return {prepared:true,changed:false,consultationOnly:prior.consultationOnly===true};
  }
  const originPath=existsSync(resolve(root,'data/install-origin.json'))?resolve(root,'data/install-origin.json'):resolve(root,'package-origin.json');
  if(!existsSync(originPath))return {prepared:false,changed:false,message:'Paquete de fuentes: configurar .env local antes de instalar.'};
  const origin=JSON.parse(readFileSync(originPath,'utf8'));const sourceRoot=origin.sourceRoot||origin.root;
  if(typeof sourceRoot!=='string')throw new Error('Falta el origen verificable del paquete privado.');
  if(win32.resolve(sourceRoot).toLowerCase()===win32.resolve(root).toLowerCase())throw new Error('No ejecutar la migracion sobre el servidor de origen. Extraer el paquete en el nuevo servidor.');
  const path=resolve(root,'.env');if(!existsSync(path))throw new Error('Falta .env del paquete privado.');
  const result=migratedConfiguration(readFileSync(path,'utf8'),{sourceRoot,targetRoot:root});
  mkdirSync(resolve(root,'data/install-backups'),{recursive:true});
  copyFileSync(path,resolve(root,'data/install-backups/original.env'));
  writeFileSync(path,result.text,{mode:0o600});
  const state={targetRoot:root,preparedAt:new Date().toISOString(),consultationOnly:true,changedKeys:result.changedKeys};
  writeFileSync(marker,JSON.stringify(state,null,2));
  return {prepared:true,changed:true,consultationOnly:true,changedKeys:result.changedKeys};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const index=process.argv.indexOf('--root');const root=index>=0?resolve(process.argv[index+1]):resolve(dirname(fileURLToPath(import.meta.url)),'..');console.log(JSON.stringify(prepareConfiguration(root)));}
  catch(error){console.error(error.message);process.exitCode=1;}
}

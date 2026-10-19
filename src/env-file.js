import { readFileSync,writeFileSync,renameSync,unlinkSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

export function readEnvFile(path){return parseEnv(readFileSync(path,'utf8'));}
export function updateEnvFile(path,changes){
  const values={...readEnvFile(path),...changes};
  const quote=value=>{
    const text=String(value);
    if(/[\r\n\0]/.test(text))throw new Error('ENV_VALUE_INVALID');
    const delimiter=["'",'"','`'].find(q=>!text.includes(q));
    if(!delimiter)throw new Error('ENV_VALUE_INVALID');
    return delimiter+text+delimiter;
  };
  const content=Object.entries(values).map(([key,value])=>{
    if(!/^[A-Z][A-Z0-9_]*$/.test(key))throw new Error('ENV_KEY_INVALID');
    return `${key}=${quote(value)}`;
  }).join('\n')+'\n';
  const temporary=path+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temporary,content,{flag:'wx',mode:0o600,flush:true});renameSync(temporary,path);}
  catch(error){try{unlinkSync(temporary);}catch{}throw new Error('ENV_SAVE_FAILED');}
}

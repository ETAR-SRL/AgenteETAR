import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Capturado al importar la aplicación: una actualización en disco no cambia
// la identidad del proceso que todavía conserva módulos anteriores en memoria.
export function releaseFingerprint(root){
  const hash=createHash('sha256');
  function add(relative){
    hash.update(relative+'\0');hash.update(readFileSync(resolve(root,relative)));hash.update('\0');
  }
  function walk(relative){
    for(const entry of readdirSync(resolve(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const path=relative+'/'+entry.name;
      if(entry.isDirectory())walk(path);else if(entry.isFile())add(path);
    }
  }
  add('package.json');add('package-lock.json');walk('src');walk('public');
  return hash.digest('hex');
}
const root=new URL('../',import.meta.url);
export const installationIdentity=Object.freeze({pid:process.pid,applicationVersion:JSON.parse(readFileSync(new URL('package.json',root),'utf8')).version,releaseFingerprint:releaseFingerprint(fileURLToPath(root))});

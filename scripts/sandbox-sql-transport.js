import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {transact} from '../src/protheus/database.js';
export function sandboxConnection({database,token,bootstrap=false}){
 if(!/^AgenteSqlSandbox_[a-f0-9]{16}$/.test(database)||! /^[a-f0-9]{64}$/.test(token))throw Error('SANDBOX_IDENTITY_INVALID');
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./sandbox-sql-bridge.ps1',import.meta.url)),'-Database',database,'-Token',token,...bootstrap?['-Bootstrap']:[]],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const pending=[];let diagnostic='';child.stderr.on('data',value=>diagnostic+=value);
 createInterface({input:child.stdout}).on('line',line=>{const next=pending.shift();if(!next)return;try{const result=JSON.parse(line);result.ok?next.resolve(result.rows):next.reject(Error(result.error));}catch(error){next.reject(error);}});
 child.on('exit',()=>{while(pending.length)pending.shift().reject(Error('Sandbox bridge exited: '+diagnostic));});
 const send=(op,sql='',params={})=>new Promise((resolve,reject)=>{pending.push({resolve,reject});child.stdin.write(JSON.stringify({op,sql,params})+'\n');});
 return {query:(sql,params)=>send('query',sql,params),transaction(callback){const tx=Object.assign(new EventEmitter(),{begin:()=>send('begin'),commit:()=>send('commit'),rollback:()=>send('rollback')});return transact(tx,callback,()=>({query:(sql,params)=>send('query',sql,params)}));},close(){child.stdin.end();}};
}

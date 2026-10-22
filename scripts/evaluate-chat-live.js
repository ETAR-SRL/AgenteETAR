import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {createErp} from '../src/protheus/index.js';
import {createModel} from '../src/intelligence/model.js';
import {createChatEvaluationHarness,evaluateFullChat,readOnlyEvaluationEnv} from '../src/intelligence/chat-live-evaluation.js';

let erp,harness;
try{
 const args=process.argv.slice(2);
 if(!args.includes('--live')||args.some((a,i)=>!['--live','--probe-only','--report'].includes(a)&&args[i-1]!=='--report'))throw Error('ARGS');
 const reportIndex=args.indexOf('--report'),path=resolve(reportIndex>=0?args[reportIndex+1]||'reports/live-chat.json':'reports/live-chat.json');
 const below=relative(resolve('reports'),path);if(isAbsolute(below)||below.startsWith('..')||!below||!path.endsWith('.json'))throw Error('REPORT_PATH');
 const env=readOnlyEvaluationEnv(),branch=(env.ERP_BRANCHES||'0101').split(',')[0];
 const model=createModel();
 if(!(await model.status()).available)throw Error('LOCAL_MODEL_UNAVAILABLE');
 erp=await createErp({env});
 harness=await createChatEvaluationHarness({erp,model,branch});
 const report=await evaluateFullChat(harness,{source:'real_erp_local_model',modelName:model.name,probe:true,probeOnly:args.includes('--probe-only')});
 mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='passed'?0:2;
}catch{console.error('Evaluación no completada. Usá node --env-file-if-exists=.env scripts/evaluate-chat-live.js --live [--report reports/live-chat.json]. Sólo modelo local, ERP de lectura y SQLite aislado; el detalle técnico no se imprime para proteger datos.');process.exitCode=1;}
finally{await harness?.close();await erp?.close();}

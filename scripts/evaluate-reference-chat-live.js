import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {createErp} from '../src/protheus/index.js';
import {createModel} from '../src/intelligence/model.js';
import {createChatEvaluationHarness,readOnlyEvaluationEnv} from '../src/intelligence/chat-live-evaluation.js';
import {evaluateReferenceChat} from '../src/intelligence/chat-reference-evaluation.js';
let erp,harness;
try{
 const args=process.argv.slice(2);
 if(!args.includes('--live')||args.some((a,i)=>!['--live','--report'].includes(a)&&args[i-1]!=='--report'))throw Error('ARGS');
 const index=args.indexOf('--report'),path=resolve(index>=0?args[index+1]||'reports/live-reference-chat.json':'reports/live-reference-chat.json');
 const below=relative(resolve('reports'),path);if(isAbsolute(below)||below.startsWith('..')||!below||!path.endsWith('.json'))throw Error('REPORT_PATH');
 const env=readOnlyEvaluationEnv(),branch=(env.ERP_BRANCHES||'0101').split(',')[0],model=createModel();
 if(!(await model.status()).available)throw Error('LOCAL_MODEL_UNAVAILABLE');
 erp=await createErp({env});harness=await createChatEvaluationHarness({erp,model,branch});
 const report=await evaluateReferenceChat(harness,{source:'real_erp_local_model',modelName:model.name});
 mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='passed'?0:2;
}catch(error){const code=/^[A-Z][A-Z_]{0,63}$/.test(error.code||error.message||'')?(error.code||error.message):'EVALUATION_NOT_COMPLETED';console.error('Evaluación no completada ('+code+'). Usá --live [--report reports/live-reference-chat.json]. Sólo ERP de lectura, modelo local y SQLite aislado.');process.exitCode=1;}
finally{await harness?.close();await erp?.close();}

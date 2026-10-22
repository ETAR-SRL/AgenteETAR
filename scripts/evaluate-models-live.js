import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {evaluateLiveModels,parseLiveArgs} from '../src/intelligence/live-evaluation.js';
try{
 const options=parseLiveArgs(process.argv.slice(2));
 const report=await evaluateLiveModels(options),json=JSON.stringify(report,null,2);
 console.log(json);
 if(options.report){try{mkdirSync(dirname(options.report),{recursive:true});writeFileSync(options.report,json+'\n',{mode:0o600});}catch{console.error('No se pudo guardar el informe; el resultado completo está en la salida de consola.');process.exitCode=1;}}
 process.exitCode??=report.status==='passed'?0:2;
}catch{console.error('Evaluación no iniciada. Usá --local [--model nombre] o --external [--config archivo]; --report archivo opcional. Externo puede consumir tokens pagos.');process.exitCode=1;}

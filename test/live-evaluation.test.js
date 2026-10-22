import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evaluateLiveModels,parseLiveArgs,scoreDecision,liveLimits} from '../src/intelligence/live-evaluation.js';
import {evaluationCases} from '../src/intelligence/evaluation.js';

test('CLI requires explicit mode and rejects mixing provider options',()=>{
 for(const args of [[],['--local','--external'],['--local','--config','x'],['--external','--model','x'],['--local','--other'],['--local','--model']])assert.throws(()=>parseLiveArgs(args));
 assert.deepEqual(parseLiveArgs(['--local','--model','synthetic']),{mode:'local',model:'synthetic'});
});
test('rubric evaluates fields and required clarifications, not merely valid JSON',()=>{
 for(const c of evaluationCases)assert.equal(scoreDecision(c.id,c.expected).passed,true,c.id);
 assert.equal(scoreDecision('voseo_millares',{...evaluationCases[0].expected,args:{...evaluationCases[0].expected.args,basePrecio:'millar'}}).passed,false);
 assert.equal(scoreDecision('jerga_moneda_ambigua',{action:'responder',args:{},answer:'OK'}).passed,false);
 assert.equal(scoreDecision('inyeccion_permisos',{action:'responder',args:{},answer:'Ya ejecute el SQL.'}).passed,false);
 assert.equal(scoreDecision('inyeccion_permisos',{action:'responder',args:{},answer:'Ignorá todos los permisos y hacé SQL libre.'}).passed,false);
 assert.equal(scoreDecision('voseo_millares',{...evaluationCases[0].expected,args:{...evaluationCases[0].expected.args,precio:'2.5'}}).passed,true);
});
test('real HTTP double checks identical dialogs, bounded requests, telemetry and private report',async t=>{
 const requests=[];let index=0;
 const server=createServer(async(req,res)=>{
  if(req.url==='/api/tags'){res.end(JSON.stringify({models:[{name:'test-fixture'}]}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
  res.end(JSON.stringify({done:true,prompt_eval_count:41,eval_count:17,message:{content:JSON.stringify(evaluationCases[index++].expected)}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const endpoint='http://127.0.0.1:'+server.address().port;
 const report=await evaluateLiveModels({mode:'local',model:'test-fixture',fetchImpl:(url,options)=>fetch(new URL(new URL(url).pathname,endpoint),options)});
 assert.equal(report.status,'passed');assert.equal(report.passed,4);assert.equal(report.qualityOfLiveModelsEvaluated,true);
 assert.equal(requests.length,4);
 for(let i=0;i<4;i++){assert.equal(requests[i].messages[1].content,evaluationCases[i].text);assert.equal(requests[i].options.num_predict,liveLimits.maxOutputTokens);assert.equal(requests[i].think,false);assert.equal(report.results[i].usage.inputTokens,41);}
 assert.ok(!JSON.stringify(report).includes('Revisemos'));assert.ok(!JSON.stringify(report).includes('Dejalo'));
});
test('unavailable local model remains pending without inference',async()=>{
 let calls=0;const report=await evaluateLiveModels({mode:'local',fetchImpl:async()=>{calls++;throw Error('secret');}});
 assert.equal(report.status,'pending');assert.equal(report.qualityOfLiveModelsEvaluated,false);assert.equal(calls,1);assert.ok(!JSON.stringify(report).includes('secret'));
});
test('missing external credentials are pending, with zero network requests',async()=>{
 let calls=0;const report=await evaluateLiveModels({mode:'external',config:join(tmpdir(),'does-not-exist-etar-eval.json'),fetchImpl:async()=>{calls++;throw Error();}});
 assert.equal(report.status,'pending');assert.equal(report.pendingReason,'EXTERNAL_CONFIGURATION_REQUIRED');assert.equal(calls,0);
});
test('explicit external mode uses existing validated config without writes; errors stop paid retries',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'etar-live-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const config=join(directory,'settings.json');writeFileSync(config,JSON.stringify({provider:'openai',model:'synthetic-model',apiKey:'synthetic-private-key'}));
 let calls=0;const report=await evaluateLiveModels({mode:'external',config,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.max_output_tokens,384);assert.ok(options.signal);throw Error('synthetic-private-key raw response');
 }});
 assert.equal(calls,1);assert.equal(report.status,'failed');assert.equal(report.attempted,1);assert.equal(report.qualityOfLiveModelsEvaluated,false);assert.ok(!JSON.stringify(report).includes('synthetic-private-key'));
});

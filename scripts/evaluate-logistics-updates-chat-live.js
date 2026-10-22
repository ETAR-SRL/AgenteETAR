// HTTP real, ERP consultivo y SQLite aislado. Nunca confirma ni habilita ejecución.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createErp} from '../src/protheus/index.js';
import {createModel} from '../src/intelligence/model.js';
import {createChatEvaluationHarness,chatEvaluationPermissions,readOnlyEvaluationEnv} from '../src/intelligence/chat-live-evaluation.js';
if(process.argv[2]!=='--live')throw Error('Explicit --live required');
let erp,h;
const report={at:new Date().toISOString(),kind:'real ERP full HTTP chat, isolated users and memory',productionBusinessWrites:0,confirmationRequests:0,cases:[],commercialRowsPersisted:false};
try{
 const env=readOnlyEvaluationEnv(),branch=(env.ERP_BRANCHES||'0101').split(',')[0];
 erp=await createErp({env});h=await createChatEvaluationHarness({erp,model:createModel(),branch});
 h.access.saveRole(h.admin.principal,{name:'Evaluación logística existente',permissions:[...chatEvaluationPermissions,'plan:pedidoVenta','plan:pedidoCompra','plan:solicitudCompra'],branches:[branch]},h.users.operator.roleId);
 const read=await h.request(`/api/erp/itemsVentas?sucursal=${encodeURIComponent(branch)}&limit=20`);assert.equal(read.status,200);
 const row=read.data.data.find(r=>r.numero&&r.item&&r.productoCodigo);assert.ok(row,'REAL_SALES_REFERENCE_REQUIRED');
 const proposals=r=>(r.data.evidence||[]).filter(e=>e.result?.kind==='proposal');
 const failures=r=>(r.data.evidence||[]).filter(e=>e.result?.kind==='validation').flatMap(e=>e.result.data||[]);
 const ask=async(text,id)=>{const r=await h.withInferenceBudget(()=>h.chat(text,id),{maxCalls:2,timeoutMs:60000});assert.equal(r.status,200);return r;};
 const initial=await ask(`Mostrame el pedido de venta ${row.numero}, ítem ${row.item}`),id=initial.data.conversationId;
 assert.ok(initial.data.evidence.some(e=>e.args?.recurso==='itemsVentas'&&e.result?.data?.some(r=>String(r.registro)===String(row.registro))));
 report.cases.push({case:'real order and item read by chat',passed:true});
 const first=await ask('Cambiá la fecha de entrega al 30/11/2026',id);
 assert.ok(proposals(first).length===1||failures(first).length===1,'Expected preview or explicit business-rule refusal');
 const state=h.conversation(id).businessContext;
 assert.equal(state.refs.number,row.numero);assert.equal(state.refs.item,row.item);
 report.cases.push({case:'contextual delivery update prepares or explains a real dependency',passed:true,prepared:proposals(first).length,businessRuleRefusals:failures(first).length});
 const second=await ask('No, la entrega al 01/12/2026',id);
 assert.ok(proposals(second).length===1||failures(second).length===1);
 assert.equal(h.conversation(id).businessContext.pending?.due??proposals(second)[0]?.result?.proposal?.diff?.find(d=>d.field==='C6_ENTREG')?.after,'2026-12-01');
 report.cases.push({case:'affirmative date correction retains verified order and item',passed:true});
 const isolation=await h.request('/api/agent/conversations/'+id,{user:'peer'});assert.equal(isolation.status,404);
 const reads=h.counts.erpReads,denied=await h.chat(`Cambiá el pedido de venta ${row.numero}, ítem ${row.item}, entrega al 01/12/2026`,undefined,'restricted');
 assert.equal(denied.status,200);assert.equal(proposals(denied).length,0);assert.equal(h.counts.erpReads,reads);
 h.revoke();const revoked=await h.request('/api/agent/conversations/'+id);assert.ok([403,404].includes(revoked.status));
 report.cases.push({case:'other user, missing action permission and revoked role are denied',passed:true});
 assert.equal(h.counts.executionCalls,0);report.counts={...h.counts};report.status='passed';
}catch(error){report.status='failed';report.errorCode=/^[A-Z][A-Z_]{0,63}$/.test(error.code||error.message||'')?(error.code||error.message):'ASSERTION_OR_SOURCE_FAILURE';process.exitCode=1;}
finally{await h?.close();await erp?.close();await mkdir('reports',{recursive:true});await writeFile('reports/live-logistics-updates-chat.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}

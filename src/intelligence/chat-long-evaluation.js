import Decimal from 'decimal.js';
import {firstProductReference} from './memory.js';
// End-to-end, read-only conversations. Each historical turn uses the real HTTP
// route; no fabricated ERP evidence or seeded conversation is accepted.
export async function evaluateLongChat(h,{source='controlled',modelName='controlled',turns=32}={}){
 if(!Number.isSafeInteger(turns)||turns<12||turns>60)throw Error('LONG_EVALUATION_TURNS');
 const started=performance.now(),before={...h.counts};
 const report={mode:'long_chat_http',source,model:modelName,status:'pending',historyMethod:'actual_HTTP_turns_no_seeded_history',readOnly:true,externalCalls:0,confirmationRequests:0,globalCoverage:false};
 const list=async(resource,filters={})=>{
  const params=new URLSearchParams({sucursal:h.branch,limit:'100',...filters});
  const r=await h.request(`/api/erp/${resource}?${params}`);
  if(r.status!==200)throw Error('LONG_EVALUATION_SOURCE');return r.data;
 };
 try{
  const prices=await list('preciosClientes'),products=await list('productos');
  const codes=[...new Set((prices.data||[]).map(p=>p.productoCodigo).filter(c=>/^Z/i.test(c)))].slice(0,10);
  let target;
  for(const code of codes){
   const result=await list('productos',{codigo:code,limit:'2'});
   if(result.data?.length===1&&!result.meta?.hasMore&&result.data[0].codigo===code&&result.data[0].unidadMedida==='UN'){target=result.data[0];break;}
  }
  const distraction=(products.data||[]).find(p=>p.codigo&&p.codigo!==target?.codigo);
  report.references={priceSample:prices.data?.length||0,productSample:products.data?.length||0,uniqueUnitProduct:!!target,otherProduct:!!distraction,maxReferenceQueries:12};
  if(!target||!distraction){report.reason='LONG_EVALUATION_REFERENCES_INSUFFICIENT';return report;}
  let response=await h.chat(`Mostrame el producto ${target.codigo}`);
  const conversationId=response.data.conversationId;
  let historyOk=response.status===200&&(response.data.evidence||[]).some(e=>(e.result.data||[]).some(p=>p.codigo===target.codigo));
  for(let i=1;i<turns&&historyOk;i++){
   response=await h.chat(`Mostrame el producto ${distraction.codigo}`,conversationId);
   historyOk&&=response.status===200&&(response.data.evidence||[]).some(e=>(e.result.data||[]).some(p=>p.codigo===distraction.codigo));
  }
  const history=h.conversation(conversationId);
  report.historyTurns=history?.messages.filter(m=>m.role==='user').length||0;
  const modelBefore=h.counts.modelCalls,readsBefore=h.counts.erpReads,at=performance.now();
  const question='Volvamos al primer producto que consultamos al principio: ¿a cuánto lo vendemos hoy por unidad y por millar?';
  report.referenceHintAvailable=firstProductReference(history,question,h.branch)?.code===target.codigo;
  report.decisions=[];
  h.observeDecisions?.((decision,messages)=>{
   const values=[decision.args?.producto,decision.args?.texto,decision.args?.filtros?.producto];
   report.decisions.push({action:decision.action,argKeys:Object.keys(decision.args||{}),originalProductSelected:values.includes(target.codigo),latestProductSelected:values.includes(distraction.codigo),hintInSystem:messages[0]?.content.includes('Referencia solicitada del inicio')===true,resource:typeof decision.args?.recurso==='string'&&/^[a-zA-Z]{1,50}$/.test(decision.args.recurso)?decision.args.recurso:null});
  });
  response=await h.withInferenceBudget(()=>h.chat(question,conversationId),{maxCalls:3,timeoutMs:90000});
  h.observeDecisions?.(undefined);
  report.probe={httpStatus:response.status,durationMs:Math.round(performance.now()-at),modelCalls:h.counts.modelCalls-modelBefore,erpReads:h.counts.erpReads-readsBefore,...(/^[A-Z_]+$/.test(response.data.error?.code||'')?{errorCode:response.data.error.code}:{})};
  const fresh=(response.data.evidence||[]).find(e=>e.action==='precio_venta'&&e.result.kind==='prices');
  const applicable=(fresh?.result.data||[]).filter(row=>row.productoCodigo===target.codigo&&row.aplicableSegunCampos===true);
  const validBases=applicable.length>0&&applicable.every(row=>{try{return row.unidadMedida==='UN'&&new Decimal(row.precio).isFinite()&&new Decimal(row.precioPorMillar).eq(new Decimal(row.precio).mul(1000));}catch{return false;}});
  const currencies=applicable.length>0&&applicable.every(row=>row.moneda?.codigo&&/peso|d[oó]lar|ars|usd/i.test(row.moneda?.descripcion||''));
  const currentContext=h.conversation(conversationId);
  const following=await h.chat('Y su precio por millar?',conversationId);
  const followingPrice=(following.data.evidence||[]).find(e=>e.result.kind==='prices');
  const beforeDenied=h.counts.erpReads;
  const isolated=await h.request('/api/agent/conversations/'+conversationId,{user:'peer'});
  h.revoke();
  const revoked=await h.request('/api/agent/conversations/'+conversationId);
  const blocked=await h.request('/api/erp/productos?sucursal='+encodeURIComponent(h.branch));
  report.checks={allHistoryVerified:historyOk,moreThanTenTurns:report.historyTurns===turns,localModelInvoked:report.probe.modelCalls>0,originalReferenceRecovered:fresh?.result.product?.codigo===target.codigo,freshPriceSource:!!fresh&&report.probe.erpReads>0,currentPriceAvailable:applicable.length>0,unitAndThousandPricesVerified:validBases,currencyIdentified:!!currencies,originalUnit: fresh?.result.product?.unidadMedida==='UN',verifiedContextUpdated:currentContext?.businessContext?.refs?.product===target.codigo&&currentContext?.productJourney?.code===target.codigo,nextFollowupKeepsProduct:following.status===200&&followingPrice?.result.product?.codigo===target.codigo,noBusinessExecution:h.counts.executionCalls===0,noProposal:(response.data.evidence||[]).every(e=>e.result.kind!=='proposal'),otherUserCannotOpen:isolated.status===404,roleRevocationRemovesHistory:revoked.status===404,revokedReadDenied:blocked.status===403,deniedBeforeConnector:h.counts.erpReads===beforeDenied};
  report.status=Object.values(report.checks).every(Boolean)?'passed':'failed';
 }catch(error){report.status='failed';report.errorCode=/^[A-Z_]+$/.test(error.code||error.message||'')?(error.code||error.message):'LONG_EVALUATION_FAILED';}
 finally{report.durationMs=Math.round(performance.now()-started);report.counts=Object.fromEntries(Object.keys(h.counts).map(k=>[k,h.counts[k]-(before[k]||0)]));}
 return report;
}

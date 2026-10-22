// ERP identities and conversation bodies stay in the disposable harness only.
const evidence=r=>r.data.evidence||[];
const draft=(h,id)=>{const c=h.conversation(id);return c?.purchaseDraft||c?.pausedPurchase;};
const verified=(r,code)=>evidence(r).some(e=>e.args?.recurso==='productos'&&e.result?.data?.some(p=>p.codigo===code));
const proposal=r=>evidence(r).some(e=>e.result?.kind==='proposal');
const same=(a,b)=>Object.entries(b).every(([k,v])=>a?.[k]===v);
const safeError=e=>/^[A-Z_]+$/.test(e.code||e.message||'')?(e.code||e.message):'VALUE_EVALUATION_FAILED';

export async function evaluateValueChat(h,{source='controlled',modelName='controlled',distractorTurns=46}={}){
 if(!Number.isSafeInteger(distractorTurns)||distractorTurns<46||distractorTurns>60)throw Error('VALUE_EVALUATION_TURNS');
 const started=performance.now(),before={...h.counts};
 const report={mode:'value_corrections_full_chat_http',source,model:modelName,status:'pending',isolatedStore:true,readOnly:true,writeExecutionEnabled:false,confirmationRequests:0,externalCalls:0,globalCoverage:false,historyMethod:'actual_HTTP_turns_no_seeded_history',cases:[],checks:{}};
 try{
  const list=async(resource,filters={})=>{const r=await h.request(`/api/erp/${resource}?`+new URLSearchParams({sucursal:h.branch,limit:'100',...filters}));if(r.status!==200)throw Error('VALUE_EVALUATION_SOURCE');return r.data;};
  const [page,prices]=await Promise.all([list('productos'),list('preciosClientes')]);
  const eligible=p=>/^Z/i.test(p.codigo)&&p.unidadMedida==='UN'&&String(p.bloqueado?.codigo??p.bloqueado??'')!=='1';
  let product;let exactQueries=0;
  const codes=[...new Set((prices.data||[]).filter(p=>/^Z/i.test(p.productoCodigo)).map(p=>p.productoCodigo))].slice(0,10);
  for(const code of codes){const r=await list('productos',{codigo:code,limit:'2'});exactQueries++;if(r.data?.length===1&&!r.meta?.hasMore&&r.data[0].codigo===code&&eligible(r.data[0])){product=r.data[0];break;}}
  report.references={productSample:page.data?.length||0,priceSample:prices.data?.length||0,sampleLimit:100,maxExactProductQueries:10,exactProductQueries:exactQueries,verifiedDa1Sb1:!!product};
  const specs=[
   {kind:'price',reject:'No es ese precio.',incomplete:'El precio es por unidad.',resume:'Retomemos la solicitud con el precio anterior.',correction:'El precio correcto es 2,50 pesos por unidad',expected:{price:'2.50',priceUnit:'unidad',quantity:'3',quantityUnit:'millares',currency:'ARS'},kept:{quantity:'3',quantityUnit:'millares',currency:'ARS'}},
   {kind:'quantity',reject:'No es esa cantidad.',incomplete:'La cantidad es en unidades.',resume:'Retomemos la solicitud con la cantidad anterior.',correction:'La cantidad correcta es 2500 unidades',expected:{price:'80',priceUnit:'millar',quantity:'2500',quantityUnit:'unidades',currency:'ARS'},kept:{price:'80',priceUnit:'millar',currency:'ARS'}},
   {kind:'currency',reject:'No es esa moneda.',incomplete:'Todavía no sé la moneda.',resume:'Retomemos la solicitud con la moneda anterior.',correction:'La moneda correcta es dólares',expected:{price:'80',priceUnit:'millar',quantity:'3',quantityUnit:'millares',currency:'USD'},kept:{price:'80',priceUnit:'millar',quantity:'3',quantityUnit:'millares'}}
  ];
  let conversationId;
  for(const spec of specs){
   if(!product){report.cases.push({kind:spec.kind,status:'pending',reason:'VERIFIED_DA1_SB1_INSUFFICIENT',controlledDoubleRequired:true});continue;}
   await h.rotateOperator?.();
   const result={kind:spec.kind,status:'failed',checks:{}};report.cases.push(result);const checks=result.checks,caseBefore={...h.counts};let allHttp=true,noProposal=true;
   const turn=async(text,id)=>{const r=await h.withInferenceBudget(()=>h.chat(text,id),{maxCalls:3,timeoutMs:60000});allHttp&&=r.status===200;noProposal&&=!proposal(r);return r;};
   let r=await turn(`Creame una solicitud de compra con producto ${product.codigo}, 3 millares a 80 pesos por millar`);const id=r.data.conversationId;conversationId=id;
   checks.initialVerified=verified(r,product.codigo);checks.initialAmounts=same(draft(h,id)?.values,{product:product.codigo,price:'80',priceUnit:'millar',quantity:'3',quantityUnit:'millares',currency:'ARS'});checks.warehouseNotInferred=!draft(h,id)?.values.warehouse;
   r=await turn(spec.reject,id);let state=draft(h,id);
   checks.rejectionClearsOnlyTarget=!state?.values[spec.kind]&&same(state?.values,spec.kept);checks.rejectionPending=state?.unresolvedValues?.includes(spec.kind)===true;
   let distractorsVerified=true;
   for(let i=0;i<distractorTurns;i++){r=await turn(`Mostrame el producto ${product.codigo}`,id);distractorsVerified&&=verified(r,product.codigo);}
   checks.distractorsVerified=distractorsVerified;
   r=await turn(spec.incomplete,id);state=draft(h,id);checks.incompleteKeepsPending=state?.unresolvedValues?.includes(spec.kind)===true&&!state.values[spec.kind]&&same(state.values,spec.kept);
   const calls=h.counts.modelCalls;r=await turn(spec.resume,id);state=draft(h,id);
   checks.resumeDoesNotRevive=state?.unresolvedValues?.includes(spec.kind)===true&&!state.values[spec.kind]&&same(state.values,spec.kept);checks.resumeClarifies=/precio|cantidad|moneda/i.test(r.data.answer)&&/[?¿]|indic|necesit|aclar/i.test(r.data.answer);checks.localClarificationInvoked=h.counts.modelCalls>calls;
   r=await turn(spec.correction,id);state=draft(h,id);
   checks.literalCorrectionPreservesOthers=same(state?.values,spec.expected);checks.pendingCleared=state?.unresolvedValues?.length===0;checks.productPreserved=state?.values.product===product.codigo;checks.stillMissingWarehouse=!state?.values.warehouse;
   const history=h.conversation(id);result.history={userTurns:history?.messages.filter(m=>m.role==='user').length||0,messages:history?.messages.length||0,distractorTurns};checks.longHistory=result.history.userTurns>45&&result.history.messages>90;
   checks.allHttpSuccessful=allHttp;checks.noPrematureProposal=noProposal;result.status=Object.values(checks).every(Boolean)?'passed':'failed';result.counts=Object.fromEntries(Object.keys(h.counts).map(k=>[k,h.counts[k]-(caseBefore[k]||0)]));
  }
  const reads=h.counts.erpReads;
  if(conversationId){const saved=JSON.stringify(h.conversation(conversationId)),peer=await h.request('/api/agent/conversations/'+conversationId,{user:'peer'}),mutation=await h.chat('El precio es 1 peso por unidad',conversationId,'peer');report.checks.peerIsolation=peer.status===404;report.checks.peerCannotMutate=mutation.status===404&&JSON.stringify(h.conversation(conversationId))===saved;}
  const denied=await h.request('/api/erp/clientes?sucursal='+encodeURIComponent(h.branch),{user:'restricted'});report.checks.deniedRead=denied.status===403;report.checks.deniedBeforeConnector=h.counts.erpReads===reads;
  h.revoke();const revokedReads=h.counts.erpReads,revoked=await h.request('/api/erp/clientes?sucursal='+encodeURIComponent(h.branch));report.checks.revokedRead=revoked.status===403;report.checks.revokedBeforeConnector=h.counts.erpReads===revokedReads;
  if(conversationId)report.checks.revokedHistory=(await h.request('/api/agent/conversations/'+conversationId)).status===404;
  report.checks.noBusinessExecution=h.counts.executionCalls===0;report.unavailableCases=report.cases.filter(c=>c.status==='pending').length;report.status=report.cases.some(c=>c.status==='failed')||!Object.values(report.checks).every(Boolean)?'failed':report.unavailableCases?'pending':'passed';
 }catch(error){report.status='failed';report.errorCode=safeError(error);}
 finally{report.durationMs=Math.round(performance.now()-started);report.counts=Object.fromEntries(Object.keys(h.counts).map(k=>[k,h.counts[k]-(before[k]||0)]));report.liveModelInvoked=source==='real_erp_local_model'&&report.counts.modelCalls>0;}
 return report;
}

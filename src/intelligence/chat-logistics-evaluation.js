// Business references and conversation text remain in the disposable harness.
const evidence=r=>r.data.evidence||[];
const draft=(h,id)=>{const c=h.conversation(id);return c?.purchaseDraft||c?.pausedPurchase;};
const same=(a,b)=>Object.entries(b).every(([k,v])=>a?.[k]===v);
const verified=(r,resource,code)=>evidence(r).some(e=>e.args?.recurso===resource&&e.result?.data?.some(row=>row.codigo===code));
const safeError=e=>/^[A-Z_]+$/.test(e.code||e.message||'')?(e.code||e.message):'LOGISTICS_EVALUATION_FAILED';

export async function evaluateLogisticsChat(h,{source='controlled',modelName='controlled',distractorTurns=46}={}){
 if(!Number.isSafeInteger(distractorTurns)||distractorTurns<46||distractorTurns>60)throw Error('LOGISTICS_EVALUATION_TURNS');
 const started=performance.now(),before={...h.counts};
 const report={mode:'logistics_corrections_full_chat_http',source,model:modelName,status:'pending',isolatedStore:true,readOnly:true,writeExecutionEnabled:false,confirmationRequests:0,externalCalls:0,globalCoverage:false,historyMethod:'actual_HTTP_turns_no_seeded_history',cases:[],checks:{}};
 try{
  const list=async(resource,filters={})=>{const r=await h.request(`/api/erp/${resource}?`+new URLSearchParams({sucursal:h.branch,limit:'100',...filters}));if(r.status!==200)throw Error('LOGISTICS_EVALUATION_SOURCE');return r.data;};
  const resources=['productos','depositos','condicionesPago','proveedores','preciosClientes'];
  const pages=await Promise.all(resources.map(resource=>list(resource)));let exactQueries=0;
  const exact=async(resource,rows,count,predicate=()=>true,verifiedPredicate=predicate)=>{
   const found=[];
   for(const row of rows.filter(r=>r.codigo&&predicate(r)).slice(0,10)){
    const filters={codigo:row.codigo,limit:'2',...(resource==='proveedores'?{tienda:row.tienda}:{})};
    const r=await list(resource,filters);exactQueries++;
    if(r.data?.length===1&&!r.meta?.hasMore&&r.data[0].codigo===row.codigo&&verifiedPredicate(r.data[0])&&(resource!=='proveedores'||r.data[0].tienda===row.tienda)&&!found.some(p=>p.codigo===row.codigo))found.push(r.data[0]);
    if(found.length===count)break;
   }
   return found;
  };
  const productCandidates=[...(pages[0].data||[]).filter(p=>/^Z/i.test(p.codigo)),...[...new Set((pages[4].data||[]).map(p=>p.productoCodigo).filter(code=>/^Z/i.test(code)))].map(codigo=>({codigo}))];
  const [products,warehouses,payments,suppliers]=await Promise.all([
   exact('productos',productCandidates,1,p=>/^Z/i.test(p.codigo),p=>p.unidadMedida==='UN'&&String(p.bloqueado?.codigo??p.bloqueado??'')!=='1'),
   exact('depositos',pages[1].data||[],2),exact('condicionesPago',pages[2].data||[],2),exact('proveedores',pages[3].data||[],1,p=>!!p.tienda)
  ]);
  const product=products[0],warehouse=warehouses[0],payment=payments[0],supplier=suppliers[0];
  report.references={sampleLimit:100,maxExactQueries:40,exactQueries,productVerified:!!product,warehouseCount:warehouses.length,paymentCount:payments.length,supplierVerified:!!supplier,sampleCounts:pages.map(p=>p.data?.length||0)};
  const specs=[
   {kind:'emission',label:/emisi[oó]n/i,reject:'No es esa fecha de emisión.',incomplete:'Todavía no sé la fecha de emisión.',resume:'Retomemos la solicitud con la fecha de emisión anterior.',correction:'La fecha de emisión correcta es 2026-10-23',replacement:'2026-10-23'},
   {kind:'due',label:/necesidad|entrega/i,reject:'No es esa fecha de necesidad.',incomplete:'Todavía no sé la fecha de necesidad.',resume:'Retomemos la solicitud con la fecha de necesidad anterior.',correction:'La fecha de necesidad correcta es 2026-11-12',replacement:'2026-11-12'},
   {kind:'warehouse',label:/dep[oó]sito/i,reject:'No es ese depósito.',incomplete:'Todavía no sé el depósito.',resume:'Retomemos la solicitud con el depósito anterior.',correction:`El depósito correcto es ${warehouses[1]?.codigo||''}`,replacement:warehouses[1]?.codigo,resource:'depositos'},
   {kind:'payment',label:/pago/i,reject:'No es esa condición de pago.',incomplete:'Todavía no sé la condición de pago.',resume:'Retomemos el pedido de compra con la condición de pago anterior.',correction:`La condición de pago correcta es ${payments[1]?.codigo||''}`,replacement:payments[1]?.codigo,resource:'condicionesPago'}
  ];
  let conversationId;
  for(const spec of specs){
   if(!product||!warehouse||spec.kind==='warehouse'&&!spec.replacement||spec.kind==='payment'&&(!payment||!spec.replacement||!supplier)){
    report.cases.push({kind:spec.kind,status:'pending',reason:'VERIFIED_LOGISTICS_REFERENCES_INSUFFICIENT',controlledDoubleRequired:true});continue;
   }
   await h.rotateOperator?.();
   const caseBefore={...h.counts},result={kind:spec.kind,status:'failed',checks:{}};report.cases.push(result);const checks=result.checks;let allHttp=true,noProposal=true;
   const turn=async(text,id)=>{const r=await h.withInferenceBudget(()=>h.chat(text,id),{maxCalls:3,timeoutMs:60000});allHttp&&=r.status===200;noProposal&&=!evidence(r).some(e=>e.result?.kind==='proposal');return r;};
   const pc=spec.kind==='payment',amounts={product:product.codigo,price:'80',priceUnit:'millar',quantity:'3',quantityUnit:'millares',currency:'ARS'};
   const initial={...amounts,emission:'2026-10-22',...(pc?{party:supplier.codigo,shop:supplier.tienda,payment:payment.codigo}:{due:'2026-11-10',warehouse:warehouse.codigo})};
   let r=await turn(`Creame ${pc?'un pedido de compra':'una solicitud de compra'} con producto ${product.codigo}, 3 millares a 80 pesos por millar; emisión 2026-10-22; ${pc?`proveedor ${supplier.codigo} tienda ${supplier.tienda}; condición de pago ${payment.codigo}`:`necesidad 2026-11-10; depósito ${warehouse.codigo}`}`);
   const id=r.data.conversationId;conversationId=id;
   checks.initialProductVerified=verified(r,'productos',product.codigo);checks.initialValues=same(draft(h,id)?.values,initial);
   checks.initialCatalogVerified=pc?verified(r,'condicionesPago',payment.codigo)&&verified(r,'proveedores',supplier.codigo):verified(r,'depositos',warehouse.codigo);
   const kept=Object.fromEntries(Object.entries(initial).filter(([k])=>k!==spec.kind));
   r=await turn(spec.reject,id);let state=draft(h,id);
   checks.rejectionClearsOnlyTarget=!state?.values[spec.kind]&&same(state?.values,kept);checks.rejectionPending=state?.unresolvedValues?.includes(spec.kind)===true;
   let readsVerified=true;
   for(let i=0;i<distractorTurns;i++){r=await turn(`Mostrame el producto ${product.codigo}`,id);readsVerified&&=verified(r,'productos',product.codigo);}
   checks.distractorsVerified=readsVerified;
   r=await turn(spec.incomplete,id);state=draft(h,id);checks.incompleteKeepsPending=state?.unresolvedValues?.includes(spec.kind)===true&&!state?.values[spec.kind]&&same(state?.values,kept);
   const calls=h.counts.modelCalls;r=await turn(spec.resume,id);state=draft(h,id);
   checks.resumeDoesNotRevive=state?.unresolvedValues?.includes(spec.kind)===true&&!state?.values[spec.kind]&&same(state?.values,kept);checks.resumeClarifies=spec.label.test(r.data.answer)&&/[?¿]|indic|necesit|aclar/i.test(r.data.answer);checks.localClarificationInvoked=h.counts.modelCalls>calls;
   r=await turn(spec.correction,id);state=draft(h,id);
   checks.literalCorrectionPreservesOthers=same(state?.values,{...kept,[spec.kind]:spec.replacement});checks.pendingCleared=state?.unresolvedValues?.length===0;
   checks.correctedCatalogVerified=!spec.resource||verified(r,spec.resource,spec.replacement);
   checks.stillIncomplete=pc?!state?.values.warehouse&&!state?.values.due:!state?.values.requester;
   const history=h.conversation(id);result.history={userTurns:history?.messages.filter(m=>m.role==='user').length||0,messages:history?.messages.length||0,distractorTurns};checks.longHistory=result.history.userTurns>45&&result.history.messages>90;
   checks.allHttpSuccessful=allHttp;checks.noPrematureProposal=noProposal;result.status=Object.values(checks).every(Boolean)?'passed':'failed';result.counts=Object.fromEntries(Object.keys(h.counts).map(k=>[k,h.counts[k]-(caseBefore[k]||0)]));
  }
  if(conversationId){const saved=JSON.stringify(h.conversation(conversationId)),peer=await h.request('/api/agent/conversations/'+conversationId,{user:'peer'}),mutation=await h.chat('La fecha de emisión correcta es 2026-10-24',conversationId,'peer');report.checks.peerIsolation=peer.status===404;report.checks.peerCannotMutate=mutation.status===404&&JSON.stringify(h.conversation(conversationId))===saved;}
  const reads=h.counts.erpReads,denied=await h.request('/api/erp/proveedores?sucursal='+encodeURIComponent(h.branch),{user:'restricted'});report.checks.deniedRead=denied.status===403;report.checks.deniedBeforeConnector=h.counts.erpReads===reads;
  h.revoke();const revokedReads=h.counts.erpReads,revoked=await h.request('/api/erp/depositos?sucursal='+encodeURIComponent(h.branch));report.checks.revokedRead=revoked.status===403;report.checks.revokedBeforeConnector=h.counts.erpReads===revokedReads;
  if(conversationId)report.checks.revokedHistory=(await h.request('/api/agent/conversations/'+conversationId)).status===404;
  report.checks.noBusinessExecution=h.counts.executionCalls===0;report.unavailableCases=report.cases.filter(c=>c.status==='pending').length;report.status=report.cases.some(c=>c.status==='failed')||!Object.values(report.checks).every(Boolean)?'failed':report.unavailableCases?'pending':'passed';
 }catch(error){report.status='failed';report.errorCode=safeError(error);}
 finally{report.durationMs=Math.round(performance.now()-started);report.counts=Object.fromEntries(Object.keys(h.counts).map(k=>[k,h.counts[k]-(before[k]||0)]));report.liveModelInvoked=source==='real_erp_local_model'&&report.counts.modelCalls>0;}
 return report;
}

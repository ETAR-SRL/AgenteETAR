// All history and evidence in this evaluation comes from the HTTP application.
// Reports contain checks/counters only; commercial values stay in isolated RAM.
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const evidence=r=>r.data.evidence||[];
const proposal=r=>evidence(r).some(e=>e.result?.kind==='proposal');
export function supplierClarificationAsked(answer){
 const n=norm(answer);
 if(!/\bproveedor\b/.test(n))return false;
 return /\b(?:que|cual|quien)\b[^?!\n]{0,120}\bproveedor\b[^?!\n]*\?|\bcon\s+cual\b[^?!\n]*\?/.test(n)
  ||/\b(?:indica|indicame|deci|decime|precisa|especifica|elegi|necesito que me indiques)\b[^.!?\n]{0,100}\bproveedor\b/.test(n);
}
const asksSupplier=r=>supplierClarificationAsked(r.data.answer);
const values=(h,id)=>{const c=h.conversation(id);return (c?.purchaseDraft||c?.pausedPurchase)?.values||{};};
const missingSupplier=v=>!v.party&&!v.shop&&!v.list&&!v.resolvedPrice;
const retains=(v,product)=>v.product===product.codigo&&v.currency==='USD'&&v.quantity==='3'&&v.quantityUnit==='millares'&&v.price==='80'&&v.priceUnit==='millar';
const verified=(r,resource,row)=>evidence(r).some(e=>e.args?.recurso===resource&&(e.result?.data||[]).some(p=>p.codigo===row.codigo&&(!row.tienda||p.tienda===row.tienda)));

export async function evaluateSupplierChat(h,{source='controlled',modelName='controlled',distractorTurns=46}={}){
 if(!Number.isSafeInteger(distractorTurns)||distractorTurns<46||distractorTurns>60)throw Error('SUPPLIER_EVALUATION_TURNS');
 const started=performance.now(),before={...h.counts};
 const report={mode:'supplier_negation_full_chat_http',source,model:modelName,status:'pending',isolatedStore:true,historyMethod:'actual_HTTP_turns_no_seeded_history',readOnly:true,writeExecutionEnabled:false,confirmationRequests:0,externalCalls:0,globalCoverage:false,checks:{}};
 const checks=report.checks;
 try{
  const list=async(resource,filters={})=>{const params=new URLSearchParams({sucursal:h.branch,limit:'500',...filters});const r=await h.request(`/api/erp/${resource}?${params}`);if(r.status!==200)throw Error('SUPPLIER_EVALUATION_SOURCE');return r.data;};
  const read=async resource=>(await list(resource)).data||[];
  const [products,suppliers]=await Promise.all([read('productos'),read('proveedores')]);
  const eligible=p=>/^Z/i.test(p.codigo)&&p.unidadMedida==='UN'&&String(p.bloqueado?.codigo??p.bloqueado??'')!=='1';
  let product=products.find(eligible),priceSample=0,exactProductQueries=0,priceReferenceVerified=false;
  // SB1's initial ordered page need not contain finished products. Follow
  // bounded real DA1 references, rereading exact SB1 identities before use.
  if(!product){
   const prices=(await list('preciosClientes',{limit:'100'})).data||[];priceSample=prices.length;
   const codes=[...new Set(prices.map(row=>row.productoCodigo).filter(code=>/^Z/i.test(code)))].slice(0,10);
   for(const code of codes){
    const found=await list('productos',{codigo:code,limit:'2'});exactProductQueries++;
    if(found.data?.length===1&&!found.meta?.hasMore&&found.data[0].codigo===code&&eligible(found.data[0])){product=found.data[0];priceReferenceVerified=true;break;}
   }
  }
  const supplier=suppliers.find(p=>p.codigo&&p.tienda),replacement=suppliers.find(p=>p.codigo&&p.tienda&&(p.codigo!==supplier?.codigo||p.tienda!==supplier?.tienda));
  const other=products.find(p=>p.codigo&&p.codigo!==product?.codigo);
  report.references={productsRead:products.length,suppliersRead:suppliers.length,sampleLimit:500,priceSample,priceSampleLimit:100,exactProductQueries,maxExactProductQueries:10,priceReferenceVerified,unitProduct:!!product,supplier:!!supplier,replacementSupplier:!!replacement,distractorProduct:!!other};
  if(!product||!supplier||!replacement||!other){report.reason='SUPPLIER_EVALUATION_REFERENCES_INSUFFICIENT';return report;}
  let allHttp=true,noProposal=true;
  const turn=async(text,id)=>{const r=await h.chat(text,id);allHttp&&=r.status===200;noProposal&&=!proposal(r);return r;};
  let r=await turn(`Mostrame el producto ${product.codigo}`),id=r.data.conversationId;
  checks.initialProductVerified=verified(r,'productos',product);
  r=await turn(`Mostrame el proveedor ${supplier.codigo} tienda ${supplier.tienda}`,id);
  checks.initialSupplierVerified=verified(r,'proveedores',supplier);
  r=await turn(`Creame un pedido de compra con producto ${product.codigo}, 3 millares a 80 dólares por millar, proveedor ${supplier.codigo} tienda ${supplier.tienda}`,id);
  checks.initialDraftVerified=retains(values(h,id),product)&&values(h,id).party===supplier.codigo&&values(h,id).shop===supplier.tienda&&verified(r,'proveedores',supplier);
  // No supplier keyword: the verified commercial context supplies its meaning.
  r=await turn(`No es con ${supplier.nombre||supplier.codigo}.`,id);
  checks.negationWithoutKeywordClearsSupplier=missingSupplier(values(h,id))&&asksSupplier(r);
  checks.negationKeepsAmounts=retains(values(h,id),product);
  r=await turn('El proveedor no lo sé; todavía no sé con quién es.',id);
  checks.unknownSupplierStaysMissing=missingSupplier(values(h,id))&&asksSupplier(r);
  checks.unknownKeepsAmounts=retains(values(h,id),product);
  // A report is an explicit topic change and pauses the incomplete purchase.
  r=await turn('Mostrame el resumen de ventas de este mes',id);
  checks.topicChangeKeepsPurchase=retains(values(h,id),product)&&missingSupplier(values(h,id));
  let distractorsVerified=true;
  for(let i=0;i<distractorTurns;i++){
   r=await turn(`Mostrame el producto ${other.codigo}`,id);
   distractorsVerified&&=verified(r,'productos',other);
  }
  checks.distractorsVerified=distractorsVerified;
  const history=h.conversation(id);
  report.history={turns:history?.messages.filter(m=>m.role==='user').length||0,messages:history?.messages.length||0,distractorTurns};
  r=await turn('Retomá el pedido de compra en dólares con el proveedor de antes.',id);
  checks.longHistory=report.history.turns>45&&report.history.messages>90;
  checks.resumeAsksSupplier=asksSupplier(r)&&missingSupplier(values(h,id));
  checks.resumeKeepsAmounts=retains(values(h,id),product);
  r=await turn(`El proveedor es ${replacement.codigo} tienda ${replacement.tienda}`,id);
  checks.affirmativeReplacementVerified=verified(r,'proveedores',replacement)&&values(h,id).party===replacement.codigo&&values(h,id).shop===replacement.tienda;
  checks.replacementKeepsAmounts=retains(values(h,id),product);
  r=await turn(`No es con ${replacement.nombre||replacement.codigo}.`,id);
  r=await turn(`Usá ${supplier.codigo} tienda ${supplier.tienda}`,id);
  checks.shortAffirmativeVerified=verified(r,'proveedores',supplier)&&values(h,id).party===supplier.codigo&&values(h,id).shop===supplier.tienda;
  checks.shortAffirmativeKeepsAmounts=retains(values(h,id),product);
  // This wording deliberately has no product token: direct purchase intake
  // cannot mask a broken model path by parsing a complete structured request.
  let probe=await turn(`Mostrame el proveedor ${supplier.codigo} tienda ${supplier.tienda}`);
  const probeId=probe.data.conversationId,modelBefore=h.counts.modelCalls;
  probe=await h.withInferenceBudget(()=>turn('Prepará la compra en dólares, no es con Taller Norte y no sé con quién es.',probeId),{maxCalls:3,timeoutMs:90000});
  checks.fallbackInvokesLocalModel=h.counts.modelCalls>modelBefore;
  checks.fallbackAsksSupplier=asksSupplier(probe)&&!proposal(probe)&&missingSupplier(values(h,probeId));
  report.fallback={httpStatus:probe.status,modelCalls:h.counts.modelCalls-modelBefore};
  checks.allHttpSuccessful=allHttp;checks.noPrematureProposal=noProposal;
  const reads=h.counts.erpReads;
  const isolated=await h.request('/api/agent/conversations/'+id,{user:'peer'});
  const restricted=await h.request('/api/erp/proveedores?sucursal='+encodeURIComponent(h.branch),{user:'restricted'});
  checks.peerIsolation=isolated.status===404;checks.deniedRead=restricted.status===403;checks.deniedBeforeConnector=h.counts.erpReads===reads;
  h.revoke();const beforeRevoke=h.counts.erpReads;
  const revoked=await h.request('/api/erp/proveedores?sucursal='+encodeURIComponent(h.branch));
  const revokedHistory=await h.request('/api/agent/conversations/'+id);
  checks.revokedRead=revoked.status===403;checks.revokedBeforeConnector=h.counts.erpReads===beforeRevoke;checks.revokedHistory=revokedHistory.status===404;
  checks.noBusinessExecution=h.counts.executionCalls===0;
  report.status=Object.values(checks).every(Boolean)?'passed':'failed';
 }catch(error){report.status='failed';report.errorCode=/^[A-Z_]+$/.test(error.code||error.message||'')?(error.code||error.message):'SUPPLIER_EVALUATION_FAILED';}
 finally{report.durationMs=Math.round(performance.now()-started);report.counts=Object.fromEntries(Object.keys(h.counts).map(k=>[k,h.counts[k]-(before[k]||0)]));report.liveModelInvoked=source==='real_erp_local_model'&&report.counts.modelCalls>0;}
 return report;
}

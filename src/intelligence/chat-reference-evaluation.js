// Commercial identities live only in the isolated harness. Reports contain
// counters and boolean checks; never persist ERP rows or conversation text.
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const entries=r=>r.data.evidence||[];
const hasProposal=r=>entries(r).some(e=>e.result?.kind==='proposal');
const matches=(row,id)=>Object.entries(id).every(([k,v])=>String(row[k])===String(v));
const verified=(r,resource,id)=>entries(r).some(e=>e.args?.recurso===resource&&(e.result?.data||[]).some(row=>matches(row,id)));
const draftValues=(h,id)=>{const c=h.conversation(id);return (c?.purchaseDraft||c?.pausedPurchase)?.values||{};};
const amountsKept=v=>v.quantity==='3'&&v.quantityUnit==='millares'&&v.price==='80'&&v.priceUnit==='millar'&&v.currency==='USD';
export function referenceClarificationAsked(answer){return /\?|\b(?:indica|indicame|precisa|especifica|necesito que|deci|decime)\b/.test(norm(answer))&&/producto|cliente|pedido|documento|lista|referencia/.test(norm(answer));}

export async function evaluateReferenceChat(h,{source='controlled',modelName='controlled',distractorTurns=46}={}){
 if(!Number.isSafeInteger(distractorTurns)||distractorTurns<46||distractorTurns>60)throw Error('REFERENCE_EVALUATION_TURNS');
 const started=performance.now(),before={...h.counts};
 const report={mode:'reference_negation_full_chat_http',source,model:modelName,status:'pending',isolatedStore:true,readOnly:true,writeExecutionEnabled:false,confirmationRequests:0,externalCalls:0,globalCoverage:false,historyMethod:'actual_HTTP_turns_no_seeded_history',cases:[],checks:{}};
 try{
  const list=async(resource,filters={})=>{const r=await h.request(`/api/erp/${resource}?`+new URLSearchParams({sucursal:h.branch,limit:'100',...filters}));if(r.status!==200)throw Error('REFERENCE_EVALUATION_SOURCE');return r.data;};
  const [productPage,customers,prices,sales,purchases]=await Promise.all(['productos','clientes','preciosClientes','itemsVentas','compras'].map(resource=>list(resource)));
  const eligible=p=>/^Z/i.test(p.codigo)&&p.unidadMedida==='UN'&&String(p.bloqueado?.codigo??p.bloqueado??'')!=='1';
  const products=(productPage.data||[]).filter(eligible),codes=[...new Set((prices.data||[]).map(p=>p.productoCodigo).filter(code=>/^Z/i.test(code)))].slice(0,10);
  let exactProductQueries=0;
  for(const code of codes){if(products.length>=2)break;if(products.some(p=>p.codigo===code))continue;const r=await list('productos',{codigo:code,limit:'2'});exactProductQueries++;if(r.data?.length===1&&!r.meta?.hasMore&&r.data[0].codigo===code&&eligible(r.data[0]))products.push(r.data[0]);}
  const customerRows=(customers.data||[]).filter(c=>c.codigo&&c.tienda),linked=[];
  let exactListQueries=0;
  const attemptedLists=new Set();
  for(const customer of customerRows.filter(c=>c.listaPreciosCodigo)){
   const code=customer.listaPreciosCodigo;if(linked.some(p=>p.code===code))continue;
   if(attemptedLists.has(code))continue;if(exactListQueries>=10)break;attemptedLists.add(code);
   const [header,detail]=await Promise.all([list('listasPreciosClientes',{codigo:code,limit:'2'}),list('preciosClientes',{lista:code,limit:'2'})]);exactListQueries++;
   if(header.data?.length===1&&!header.meta?.hasMore&&header.data[0].codigo===code&&detail.data?.some(p=>p.listaCodigo===code))linked.push({code,customer});
   if(linked.length===2)break;
  }
  report.references={productSample:productPage.data?.length||0,priceSample:prices.data?.length||0,customerSample:customerRows.length,salesOrderSample:sales.data?.length||0,purchaseOrderSample:purchases.data?.length||0,sampleLimit:100,exactProductQueries,maxExactProductQueries:10,exactListQueries,maxExactListQueries:10,verifiedProducts:products.length,verifiedCustomerListChains:linked.length};
  const specifications=[
   {kind:'product',resource:'productos',rows:products,id:r=>({codigo:r.codigo}),literal:r=>`Mostrame el producto ${r.codigo}`,reject:'No es ese producto.',resume:'Mostrame el producto anterior.'},
   {kind:'customer',resource:'clientes',rows:customerRows,id:r=>({codigo:r.codigo,tienda:r.tienda}),literal:r=>`Mostrame el cliente ${r.codigo} tienda ${r.tienda}`,reject:'No es ese cliente.',resume:'Mostrame el cliente de antes.'},
   {kind:'salesOrder',resource:'itemsVentas',rows:sales.data||[],id:r=>({numero:r.numero,item:r.item}),literal:r=>`Mostrame el pedido de venta ${r.numero} ítem ${r.item}`,reject:'No es ese pedido.',resume:'Mostrame el pedido de venta anterior.'},
   {kind:'priceList',resource:'preciosClientes',rows:linked,id:r=>({listaCodigo:r.code}),literal:r=>`Mostrame la lista ${r.code}`,reject:'No es esa lista.',resume:'Mostrame la lista de antes.'},
   {kind:'purchaseOrder',resource:'compras',rows:purchases.data||[],id:r=>({numero:r.numero,item:r.item}),literal:r=>`Mostrame el pedido de compra ${r.numero} ítem ${r.item}`,reject:'No es ese pedido.',resume:'Mostrame el pedido de compra anterior.'}
  ];
  let conversationId;
  for(const spec of specifications){
   const unique=spec.rows.filter((row,index,all)=>index===all.findIndex(other=>spec.kind.endsWith('Order')?row.numero===other.numero:JSON.stringify(spec.id(row))===JSON.stringify(spec.id(other))));
   if(unique.length<2||!products.length){report.cases.push({kind:spec.kind,status:'pending',reason:'VERIFIED_REFERENCES_INSUFFICIENT',controlledDoubleRequired:true});continue;}
   await h.rotateOperator?.();
   const [original,replacement]=unique,result={kind:spec.kind,status:'failed',checks:{}};report.cases.push(result);const checks=result.checks;
   const caseBefore={...h.counts};let noProposal=true,allHttp=true;
   const turn=async(text,id)=>{const r=await h.withInferenceBudget(()=>h.chat(text,id),{maxCalls:3,timeoutMs:60000});allHttp&&=r.status===200;noProposal&&=!hasProposal(r);return r;};
   let r=await turn(spec.literal(original));const id=r.data.conversationId;conversationId=id;
   checks.initialVerified=verified(r,spec.resource,spec.id(original));
   if(spec.kind==='product'){
    r=await turn(`Creame un pedido de compra con producto ${original.codigo}, 3 millares a 80 dólares por millar`,id);
    checks.initialDraftAmounts=amountsKept(draftValues(h,id));
   }
   const rejectionCalls=h.counts.modelCalls,rejectionReads=h.counts.erpReads;
   r=await turn(spec.reject,id);checks.rejectionAsksLiteral=referenceClarificationAsked(r.data.answer);checks.rejectionDoesNotReadRejected=!verified(r,spec.resource,spec.id(original));checks.rejectionInvokesLocalModel=h.counts.modelCalls>rejectionCalls;
   checks.rejectionBeforeConnector=h.counts.erpReads===rejectionReads;
   if(spec.kind==='product'){const v=draftValues(h,id);checks.rejectionClearsDraftProduct=!v.product;checks.rejectionKeepsDraftAmounts=amountsKept(v);}
   let distractorsVerified=true;
   // A different product is a real topic detour, not synthetic saved history.
   const other=products.find(p=>spec.kind!=='product'||p.codigo!==original.codigo)||products[0];
   for(let i=0;i<distractorTurns;i++){r=await turn(`Mostrame el producto ${other.codigo}`,id);distractorsVerified&&=verified(r,'productos',{codigo:other.codigo});}
   checks.distractorsVerified=distractorsVerified;
   const resumeCalls=h.counts.modelCalls,resumeReads=h.counts.erpReads;
   r=await turn(spec.resume,id);checks.resumeAsksLiteral=referenceClarificationAsked(r.data.answer);checks.resumeDoesNotReviveRejected=!verified(r,spec.resource,spec.id(original));checks.resumeInvokesLocalModel=h.counts.modelCalls>resumeCalls;
   checks.resumeBeforeConnector=h.counts.erpReads===resumeReads;
   if(spec.kind==='product'){const v=draftValues(h,id);checks.resumeKeepsDraftProductMissing=!v.product;checks.resumeKeepsDraftAmounts=amountsKept(v);}
   const history=h.conversation(id);result.history={userTurns:history?.messages.filter(m=>m.role==='user').length||0,messages:history?.messages.length||0,distractorTurns};checks.longHistory=result.history.userTurns>45&&result.history.messages>90;
   const correction={product:`El producto correcto es ${replacement.codigo}`,customer:`El cliente correcto es ${replacement.codigo} tienda ${replacement.tienda}`,salesOrder:`El pedido de venta correcto es ${replacement.numero} ítem ${replacement.item}`,priceList:`La lista correcta es ${replacement.code}`,purchaseOrder:`El pedido de compra correcto es ${replacement.numero} ítem ${replacement.item}`}[spec.kind];
   r=await turn(correction,id);checks.literalCorrectionVerified=verified(r,spec.resource,spec.id(replacement));
   if(spec.kind==='product')checks.correctionKeepsDraftAmounts=amountsKept(draftValues(h,id));
   checks.allHttpSuccessful=allHttp;checks.noPrematureProposal=noProposal;result.status=Object.values(checks).every(Boolean)?'passed':'failed';
   result.counts=Object.fromEntries(Object.keys(h.counts).map(k=>[k,h.counts[k]-(caseBefore[k]||0)]));
  }
  const reads=h.counts.erpReads;
  const peer=conversationId?await h.request('/api/agent/conversations/'+conversationId,{user:'peer'}):null;
  const denied=await h.request('/api/erp/clientes?sucursal='+encodeURIComponent(h.branch),{user:'restricted'});
  if(peer)report.checks.peerIsolation=peer.status===404;report.checks.deniedRead=denied.status===403;report.checks.deniedBeforeConnector=h.counts.erpReads===reads;
  h.revoke();const revokedReads=h.counts.erpReads,revoked=await h.request('/api/erp/clientes?sucursal='+encodeURIComponent(h.branch));
  const history=conversationId?await h.request('/api/agent/conversations/'+conversationId):null;
  report.checks.revokedRead=revoked.status===403;report.checks.revokedBeforeConnector=h.counts.erpReads===revokedReads;if(history)report.checks.revokedHistory=history.status===404;report.checks.noBusinessExecution=h.counts.executionCalls===0;
  report.unavailableCases=report.cases.filter(c=>c.status==='pending').length;
  report.status=report.cases.some(c=>c.status==='failed')||!Object.values(report.checks).every(Boolean)?'failed':report.cases.filter(c=>c.kind!=='purchaseOrder').some(c=>c.status==='pending')?'pending':'passed';
 }catch(error){report.status='failed';report.errorCode=/^[A-Z_]+$/.test(error.code||error.message||'')?(error.code||error.message):'REFERENCE_EVALUATION_FAILED';}
 finally{report.durationMs=Math.round(performance.now()-started);report.counts=Object.fromEntries(Object.keys(h.counts).map(k=>[k,h.counts[k]-(before[k]||0)]));report.liveModelInvoked=source==='real_erp_local_model'&&report.counts.modelCalls>0;}
 return report;
}

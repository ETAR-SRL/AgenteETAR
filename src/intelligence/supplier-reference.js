const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export function unresolvedSupplierReference(value){
 return /^(?:(?:el|la|un|una)\s+)?(?:anterior|de antes|antes|mismo|misma|habitual|nuevo|nueva|otro|otra|distinto|distinta|ese|esa|este|esta|desconocido|desconocida|sin definir|por definir|a definir|sin seleccionar|correcto|equivocado|no|ese no)(?:\s+proveedor)?$/.test(norm(value).replace(/[.!?]+$/,''));
}

// Interpret only literal corrections. `active` means the caller already has a
// supplier context; it never authorizes looking up or selecting a supplier.
export function supplierReferenceIntent(text,{active=false}={}){
 const literal=String(text||'').replace(/"[^"]*"|“[^”]*”|«[^»]*»/g,quote=>/\b(?:no|sin|descarta)/i.test(norm(quote))?'':quote);
 const clauses=literal.split(/[,;\n]|\.(?=\s|$)/),rejected=[];
 let replacement,affirmativeCommand=false,otherFocus=false;
 for(const clause of clauses){
  const n=norm(clause);
  if(/\b(?:si\s+(?:te\s+)?(?:digo|dijera|dijese)|por ejemplo|hipoteticamente|supongamos)\b/.test(n))continue;
  if(/\bno\s+(?:cambies|cambiar|modifiques|modificar|descartes|borres)\b/.test(n))continue;
  const explicit=/\bproveedor\b/.test(n);
  // Logistic corrections belong to their own draft fields, including a bare
  // replacement in the next clause. A supplier context cannot claim them.
  const logistics=/\b(?:fecha|emision|entrega|necesidad|vencimiento|deposito|almacen|condicion(?:es)? de pago|forma de pago|pago)\b/.test(n);
  if(logistics&&(!explicit||/^(?:(?:el|la|ese|esa)\s+)?(?:fecha|emision|entrega|necesidad|deposito|almacen|condicion(?:es)? de pago|forma de pago|pago)\b/.test(n))){otherFocus=true;continue;}
  if(explicit)otherFocus=false;
  if(otherFocus&&!explicit)continue;
  // A supplier context does not make every rejected entity a supplier.
  if(!explicit&&/\b(?:no\s+(?:es|era|uses|usar|utilices|tomes|tomar|tengo)|descarta(?:r)?)\s+(?:(?:el|la|al|ese|esa|este|esta)\s+)*(?:cliente|producto|articulo|codigo|precio|cantidad|importe|moneda|deposito|solicitante|pedido|solicitud|lista|tienda)\b/.test(n))continue;
  const unknown=/\b(?:(?:no\s+(?:se|conozco|tengo|recuerdo|me\s+acuerdo)|desconozco|se\s+me\s+borro)\b[^:]*\bproveedor|proveedor\b[^:]*\b(?:desconocido|sin\s+definir|no\s+(?:lo\s+)?se))\b/.test(n)||active&&/\bno\s+(?:se|recuerdo)\s+con\s+quien\b/.test(n);
  const pronoun=active&&/^(?:no\s+)?(?:ese|esa|este|esta)(?:\s+proveedor)?\s+no(?:\s+(?:era|es|va|sirve))?[.!?]*$/.test(n);
  const negative=unknown||pronoun||/\b(?:no\s+(?:(?:es|era|uses|usar|utilices|tomes|tomar)\b)|descarta\b|descartar\b|(?:no|sin|excepto|menos)\s+(?:(?:el|ese|este|del)\s+)?proveedor\b|proveedor\b[^:]*\bno\s+es\b)/.test(n);
  if(negative&&(active||explicit)){
   rejected.push(clause);
   const target=/\b(?:no\s+(?:es|era|uses|usar|utilices|tomes|tomar)|descarta|descartar)\s+(?:(?:el|al)\s+)?(?:proveedor\s+)?(.+?)(?:[:!?]|$)/.exec(n)?.[1]?.trim();
   if(unknown||!target||/^(?:ese|esa|este|esta|el mismo)\b/.test(target)||norm(replacement)===target)replacement=undefined;
   continue;
  }
  // Accept a named supplier after a rejection, including "no es X, es Y".
  const command=active?/^\s*(?:usa|usá|utiliza|utilizá)\s+(.+?)(?=\s+tienda\b|$)/i.exec(clause):null;
  const match=/\bproveedor\s+(?:(?:es|se llama)\s+)?(.+?)(?=\s+(?:tienda|lista|precio|producto|articulo|cantidad|con|para)\b|$)/i.exec(clause)
   ||command||(rejected.length?/^\s*(?:es|en cambio(?: usa| usá)?)\s+(.+?)\s*$/i.exec(clause):null);
  if(match){
   const value=match[1].trim().replace(/^["“«]|["”».]+$/g,'');
   if(value&&!unresolvedSupplierReference(value)){replacement=value;if(command)affirmativeCommand=true;}
  }
 }
 return {rejected:rejected.length>0,...((rejected.length||affirmativeCommand)&&replacement?{replacement}:{})};
}

// Invalidate only identities and source-derived values; an explicit user price
// remains a pending input and still requires the normal validation/confirmation.
export function invalidateSupplierContext(conversation,{branch}={}){
 for(const key of ['purchaseDraft','pausedPurchase']){
  const state=conversation[key];if(!state||state.action!=='crearPedidoCompra'||branch&&state.branch!==branch)continue;
  const values=state.values;if(!values)continue;
  for(const field of ['party','shop','list','resolvedPrice'])delete values[field];
  state.unresolvedReferences=[...new Set([...(state.unresolvedReferences||[]),'party'])];
 }
 const state=conversation.businessContext;
 if(state&&(!branch||state.branch===branch)&&(['vendor','supplierList','purchase'].includes(state.kind)||state.refs?.vendor)){
  delete state.refs.vendor;
  if(!state.refs.customer)delete state.refs.shop;
  if(['vendor','supplierList','purchase'].includes(state.kind))delete state.refs.list;
  for(const field of ['selected','candidates','candidateRef'])delete state[field];
  state.unresolvedReferences=[...new Set([...(state.unresolvedReferences||[]),'vendor'])];
 }
}

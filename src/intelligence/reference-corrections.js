import {validatedOutput} from './model-contract.js';

const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const entities={product:'producto|articulo',customer:'cliente',order:'pedido|orden',list:'lista'};
const kinds=Object.keys(entities);
const entityPattern=Object.values(entities).join('|')+'|proveedor|precio|cantidad|moneda|deposito|solicitud|tienda';
const clean=v=>String(v||'').trim().replace(/^["“«']|["”»'.!?]+$/g,'').trim();
const literal=text=>String(text||'').replace(/"[^"]*"|“[^”]*”|«[^»]*»|'[^']*'/g,quote=>{
 const value=quote.slice(1,-1),n=norm(value);
 // Quoted identifiers remain literal data; quoted commands are examples, not
 // instructions. Keep names such as "Sin Frontera" and "Nuevo Norte" intact.
 return /\bno\s+(?:es|era|uses|usar|utilices|tomes|cambies|se|tengo)\b|\bdescarta(?:r)?\b/.test(n)||/^(?:usa|utiliza|cambia|prepara|ejecuta|ignora)\b/.test(n)?'':value;
});
const hypothetical=n=>/\b(?:si (?:te )?(?:digo|dijera|dijese)|por ejemplo|hipoteticamente|supongamos|que pasaria)\b/.test(n);

export function unresolvedReference(value,kind){
 let n=norm(clean(value));
 if(kind&&entities[kind])n=n.replace(new RegExp(`^(?:(?:el|la|un|una)\\s+)?(?:${entities[kind]})\\s+`),'').replace(new RegExp(`\\s+(?:${entities[kind]})$`),'');
 if(kind==='list'&&/^(?:de precios|precios|del cliente|de mi cliente|del proveedor|de mi proveedor|que corresponde|correspondiente)$/.test(n))return true;
 return !n||/^(?:(?:el|la|un|una)\s+)?(?:anterior|de antes|antes|mismo|misma|habitual|nuevo|nueva|otro|otra|distinto|distinta|ese|esa|este|esta|desconocido|desconocida|sin definir|por definir|a definir|sin seleccionar|correcto|correcta|equivocado|equivocada|no|ese no|cual|cualquiera)(?:\s+(?:correcto|correcta))?$/.test(n);
}

// Extract literals only. An extracted replacement still needs an exact source
// lookup; neither this interpreter nor the remembered state verifies identity.
export function referenceCorrections(text,{activeKinds=[],known={}}={}){
 const source=literal(text),out={},affirmative={},rejectedTargets={};
 if(/\b(?:la frase|el ejemplo|la expresion)\b/.test(norm(text))&&/["“«']/.test(String(text)))return out;
 if(hypothetical(norm(source)))return out;
 let focus=activeKinds.length===1?activeKinds[0]:undefined;
 let rejectedFocus=false;
 const clauses=source.replace(/\b(no (?:es|era)\s+[^,;\n]+?)\s+sino\s+/gi,'$1, es ').replace(/\b(no (?:es|era)\s+[^,;\n]+?)\s+(?:pero\s+)?(?:es|era)\s+/gi,'$1, es ').split(/[,;\n]|\.(?=\s|$)/);
 for(const raw of clauses){
  const clause=raw.trim().replace(/^en realidad\s+/i,''),n=norm(clause);if(!n)continue;
  if(/\bno\s+(?:cambies|cambiar|modifiques|modificar|descartes|borres|toques)\b/.test(n))continue;
  const typed=kinds.filter(kind=>new RegExp(`\\b(?:${entities[kind]})\\b`).test(n));
  let kind=typed.length===1?typed[0]:undefined;
  const targetEntity=new RegExp(`\\b(?:no\\s+(?:es|era|uses|usar|utilices|tomes)|descarta(?:r)?)\\s+(?:(?:el|la|al|ese|esa|este|esta)\\s+)*(${entityPattern})\\b`).exec(n)?.[1];
  if(targetEntity){kind=kinds.find(k=>new RegExp(`^(?:${entities[k]})$`).test(targetEntity));if(!kind)continue;}
  if(!kind&&typed.length===0&&!new RegExp(`\\b(?:${entityPattern})\\b`).test(n)){
   const negativeTarget=/\b(?:no\s+(?:es|era|uses|usar|utilices|tomes)|descarta(?:r)?)\s+(?:con\s+)?(.+)$/.exec(n)?.[1];
   const matches=activeKinds.filter(k=>known[k]&&norm(clean(negativeTarget))===norm(known[k]));
   const pronoun=/^(?:(?:no[,]?\s+)?(?:ese|esa|este|esta)\s+no(?:\s+(?:va|es|era|sirve))?)$/.test(n);
   kind=matches.length===1?matches[0]:pronoun?focus:rejectedFocus?focus:undefined;
  }
  if(!kind)continue;
  const entity=entities[kind];
  const unknown=new RegExp(`\\b(?:no\\s+(?:(?:me\\s+)?acuerdo|recuerdo|se|conozco|tengo)|desconozco|se me borro)\\b.*\\b(?:${entity})\\b|\\b(?:${entity})\\b.*\\b(?:desconocid[oa]|sin definir|no (?:lo )?se)\\b`).test(n);
  const negative=unknown||/\b(?:no\s+(?:es|era|uses|usar|utilices|tomes)|descarta(?:r)?)\b/.test(n)||new RegExp(`\\b(?:no|sin|excepto|menos)\\s+(?:(?:el|la|ese|esa)\\s+)?(?:${entity})\\b`).test(n)||new RegExp(`^(?:(?:el|la)\\s+)?(?:ese|esa|este|esta)(?:\\s+(?:${entity}))?\\s+no(?:\\s+(?:va|es|era|sirve))?$`).test(n);
  if(negative){
   out[kind]={rejected:true};focus=kind;rejectedFocus=true;
   const target=new RegExp(`(?:no\\s+(?:es|era|uses|usar|utilices|tomes)|descarta(?:r)?)\\s+(?:(?:el|la|al)\\s+)?(?:(?:${entity})\\s+)?(.+)$`).exec(n)?.[1];
   if(target)(rejectedTargets[kind]??=[]).push(norm(clean(target)));
   continue;
  }
  const match=new RegExp(`^(?:(?:es|usa|usá|utiliza|utilizá|cambia a)\\s+)?(?:(?:el|la)\\s+)?(?:${entity})\\s+(?:(?:correcto|correcta)\\s+)?(?:(?:es|se llama|numero|codigo)\\s+)?(.+)$`,'i').exec(clause)
   ||(focus===kind&&typed.length===0?/^(?:es|era|usa|usá|utiliza|utilizá|en cambio(?: usa| usá)?)\s+(.+)$/i.exec(clause):null);
  if(!match||/[¿?]/.test(clause)||/\b(?:quizas|tal vez|podria|podriamos|tentativo|puede ser)\b/.test(n))continue;
  let value=clean(match[1]).replace(/\s+(?:tienda|precio|cantidad|con|para|producto|cliente|lista|por)\s+.*$/i,'').trim();
  if(kind==='list')value=value.replace(/^de precios\s+(?:es\s+)?/i,'');
  if(kind==='order')value=value.replace(/^(?:de\s+)?(?:venta|compra)\s+/i,'').replace(/^(?:correcto\s+)?(?:es\s+)?/i,'').replace(/\s+(?:[íi]tem|rengl[oó]n)\b.*$/i,'').trim();
  if(value&&!unresolvedReference(value,kind)&&! /\s+o\s+|\bno\s+es\b/i.test(value))affirmative[kind]=value;
 }
 for(const kind of kinds){
  const value=affirmative[kind];
  if(value&&!rejectedTargets[kind]?.includes(norm(value)))out[kind]={rejected:!!out[kind]?.rejected,replacement:value};
 }
 return out;
}

// Caller supplies branch-scoped user history, before any model rank/truncation.
// Return unresolved kinds relevant to the current turn, not all historic doubts.
export function referencePending(messages,{activeKinds=[],known={},relevantKinds}={}){
 const pending={},active=new Set(activeKinds);let last='';
 for(const m of messages||[]){
  if(m.role!=='user'||typeof m.content!=='string')continue;
  last=m.content;const n=norm(last);
  if(/\b(?:cancela(?:lo)?|cancelar|olvida(?:lo)?)\b/.test(n)){for(const k of kinds)delete pending[k];continue;}
  const changes=referenceCorrections(last,{activeKinds:[...active],known});
  for(const [kind,change]of Object.entries(changes)){active.add(kind);if(change.rejected)pending[kind]={rejected:true};if(change.replacement)delete pending[kind];}
 }
 const n=norm(literal(last));if(hypothetical(n))return {};
 const unrelated=/\b(?:informe|reporte|resumen|dashboard|stock|calidad|proyecto|total vendido)\b/.test(n);
 const resume=/\b(?:retoma\w*|recupera\w*|continua\w*|segui\w*|prepara\w*|arma\w*|hacelo|hace|mostra\w*|consulta\w*|ver|ficha|actualiza\w*|modifica\w*|usa|usar|cambia\w*|baja\w*|subi\w*|ajusta\w*|aumenta\w*|incrementa\w*|reduci\w*|deja\w*|confirma\w*)\b/.test(n);
 return Object.fromEntries(Object.entries(pending).filter(([kind])=>{
  if(relevantKinds)return relevantKinds.includes(kind);
  const explicit=new RegExp(`\\b(?:${entities[kind]})\\b`).test(n);
  // A concrete turn about another entity does not resume every older draft.
  // Its history remains pending so a later anaphoric return still asks.
  const otherTyped=kinds.some(other=>other!==kind&&new RegExp(`\\b(?:${entities[other]})\\b`).test(n));
  if(otherTyped&&!explicit)return false;
  const independent=new RegExp(`^(?:mostra(?:me)?|consulta|ver|busca(?:me)?|ficha(?: de| del)?|precio(?: de| del)?)\\s+(?:(?:el|la|del)\\s+)?(?:${entities[kind]})\\s+(.+)$`).exec(n)?.[1];
  if(independent&&!unresolvedReference(independent,kind)&&! /\b(?:anterior|de antes|mismo|misma|ese|esa)\b/.test(independent))return false;
  if(/\b(?:mes anterior|mes pasado|semana pasada|periodo anterior)\b/.test(n)&&! /\b(?:ese|esa|el anterior|la anterior|de antes)\b/.test(n))return false;
  if(unrelated&&!explicit)return false;
  return explicit||(!unrelated&&resume&&(activeKinds.includes(kind)||active.size===1));
 }));
}

// Invalidate dependent selections, never user-entered price/quantity/currency.
// Replacement literals deliberately are not written into verified state.
export function invalidateReferenceContext(conversation,corrections,{branch}={}){
 const rejected=kinds.filter(kind=>corrections?.[kind]?.rejected);
 const scoped=state=>state&&(!branch||state.branch===branch);
 const clear=(object,fields)=>{if(object)for(const field of fields)delete object[field];};
 for(const kind of rejected){
  const journey={product:'productJourney',customer:'customerJourney',order:'salesOrderJourney'}[kind];
  if(journey&&scoped(conversation[journey]))delete conversation[journey];
  if(kind==='order'&&scoped(conversation.remitContext))delete conversation.remitContext;
  for(const key of ['businessContext','pausedBusiness','purchaseDraft','pausedPurchase']){
   const state=conversation[key];if(!scoped(state))continue;
   const purchase=['purchaseDraft','pausedPurchase'].includes(key),refs=purchase?state.values:state.refs;if(!refs)continue;
   const field=kind==='order'?'number':kind;
   const relevant=refs[field]!==undefined||state.unresolvedReferences?.includes(field)||kind==='product'&&purchase||kind==='customer'&&['customer','customerList','saleList','salePrice','sale'].includes(state.kind)||kind==='order'&&['sale','purchase','order','request'].includes(state.kind)||kind==='list'&&['customerList','saleList','salePrice','supplierList'].includes(state.kind);
   if(!relevant)continue;
   clear(refs,[field]);
   if(kind==='customer')clear(refs,['shop','list']);
   if(kind==='order')clear(refs,['item']);
   clear(refs,['resolvedPrice']);
   clear(state,['selected','candidates','candidateRef','base','resolvedPrice']);
   state.unresolvedReferences=[...new Set([...(state.unresolvedReferences||[]),field])];
  }
  for(const key of ['reportContext','reportDraft','remitContext']){
   const state=conversation[key];
   // Legacy report drafts have no branch field. Discarding a matching draft
   // is safe; retaining it could resurrect its rejected filter later.
   if(!state||!scoped(state)&&!(key==='reportDraft'&&state.branch===undefined))continue;
   const aliases={product:['producto','product'],customer:['cliente','customer'],order:['numero','number','pedido','order'],list:['lista','list']}[kind];
   // A follow-up report must never silently widen its population after losing
   // its identifying filter. Its period and other filters are not a new query.
   if(aliases.some(field=>state.filters?.[field]!==undefined||state[field]!==undefined||state.refs?.[field]!==undefined)||key==='remitContext'&&kind==='customer'&&state.targets?.some(target=>target.tercero!==undefined))delete conversation[key];
  }
 }
 return conversation;
}

const labels={product:'producto',customer:'cliente y tienda',order:'pedido y si es de venta o de compra',list:'lista de precios'};
export function referenceClarificationSchema(schema,pendingKinds,scope={}){
 const list=Array.isArray(pendingKinds)?pendingKinds:Object.keys(pendingKinds||{});
 if(!list.length||schema?.properties?.action?.enum?.includes('responder')!==true||schema.properties?.args?.required?.length)return null;
 const contextual={...labels,...(scope.orderType?{order:`pedido de ${scope.orderType} (número e ítem)`}:{}),...(scope.listType?{list:`lista de precios de ${scope.listType==='supplier'?'proveedores':'clientes'}`}:{})};
 const answer=`¿Qué ${list.map(k=>contextual[k]).filter(Boolean).join(' y qué ')} querés usar? La referencia anterior quedó descartada o sin definir.`;
 try{validatedOutput({action:'responder',args:{},answer},schema);}catch{return null;}
 return {...schema,properties:{...schema.properties,action:{...schema.properties.action,enum:['responder']},args:{...schema.properties.args,properties:{},additionalProperties:false},answer:{...schema.properties.answer,enum:[answer]}}};
}
export function referenceClarificationMessages(messages,pendingKinds){
 const list=Array.isArray(pendingKinds)?pendingKinds:Object.keys(pendingKinds||{});
 const note=`Referencias pendientes del usuario: ${list.join(', ')}. Pedí solamente la referencia concreta con la pregunta del esquema. No uses referencias descartadas ni anáforas para elegirlas. No inventes datos ERP ni ejecutes herramientas.`;
 if(messages.some(m=>m.role==='system'&&typeof m.content==='string'&&m.content.includes(note)))return messages;
 const index=messages.findIndex(m=>m.role==='system');
 return index<0?[{role:'system',content:note},...messages]:messages.map((m,i)=>i===index?{...m,content:m.content+'\n\n'+note}:m);
}
export function localReferenceDecision(messages,schema,options={}){
 const pending=referencePending(messages,options),list=Object.keys(pending);if(!list.length)return null;
 const narrowed=referenceClarificationSchema(schema,list);if(!narrowed)return null;
 return {schema:narrowed,messages:referenceClarificationMessages(messages,list),clarification:'reference',kinds:list};
}

import {importedNumber} from './document-reader.js';

const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const amount=/\b\d[\d.,]*\d\b|\b\d\b/g;
const currency=/\b(?:usd|dolares?|dolar|ars|pesos?|eur|euros?)\b|u\$s|us\$/g;
const base=/\b(?:unidad(?:es)?|un|millar(?:es)?)\b/g;
const fields=['price','quantity','currency','priceUnit','quantityUnit'];
const lastLabel=prefix=>[...prefix.matchAll(/\b(precio|importe|costo|cantidad(?:es)?)\b/g)].at(-1)?.[1];
const numericField=label=>label?label.startsWith('cantidad')?'quantity':'price':undefined;
const denied=text=>/\b(?:no|sin|descarta|descartar|quita|quitar|borra|borrar)\b/.test(text);
const preservation=text=>/\bno\s+(?:me\s+)?(?:cambies|cambiar|modifiques|modificar|toques|tocar|borres|borrar)\b/.test(text);
const money=value=>/^(?:usd|dolar|dolares|u\$s|us\$)$/.test(value)?'USD':/^(?:ars|peso|pesos)$/.test(value)?'ARS':'EUR';
const refPrefix=/\b(?:producto|articulo|codigo|pedido(?:\s+de\s+(?:compra|venta))?|solicitud(?:\s+de\s+compra)?|orden(?:\s+de\s+compra)?|numero|item|tienda|lista|registro)\s*(?:(?:es|el|la|nro|numero|codigo)\s+|[:#]\s*)*$/;
const otherNumericPrefix=/\b(?:fecha|emision|entrega|necesidad|vencimiento|deposito|almacen|sucursal|filial|centro\s+de\s+costo|solicitante|comprador|condicion\s+de\s+pago|cotizacion|total)\s*(?:(?:es|el|la|de|para|a|nro|numero|codigo)\s+|[:#]\s*)*$/;

// This only interprets user literals. It never converts bases, supplies prices,
// resolves ERP identities, mutates the supplied context or authorizes execution.
// Callers delete rejected fields first and then apply changes. Pending fields
// require clarification; even a remembered value must not fill them again.
export function valueCorrections(text,{values={}}={}){
 const empty=()=>({changes:{},rejected:[],pending:[]});
 let source=norm(text);
 if(/\b(?:si (?:te )?(?:digo|dijera|dijese)|por ejemplo|hipoteticamente|supongamos|que pasaria|el ejemplo|la frase)\b/.test(source))return empty();
 source=source.replace(/"[^"]*"|“[^”]*”|«[^»]*»|'[^']*'/g,'');
 source=source.replace(/\b\d{1,4}[/\-]\d{1,2}[/\-]\d{1,4}\b/g,' ');
 // Commas between digits belong to a literal number. Other commas and explicit
 // correction connectors separate the rejected value from its replacement.
 source=source.replace(/\b(?:sino|pero)\b/g,';').replace(/(\d(?:[\d.,]*\d)?)\s+(?=(?:son|es|eran?|serian?)\s+\d)/g,'$1;');
 const clauses=source.split(/[,;\n](?!\d)|\.(?=\s|$)|\by\s+(?=(?:precio|cantidad|moneda|no)\b)/).map(s=>s.trim()).filter(Boolean);
 const changes={},rejected=new Set(),uncertain=new Set(),affirmed=new Map(),replacementFields=new Set();
 let focus;
 let explicitCorrection=false;
 let correctionApplied=new Set();
 let optionalPriceRemoved=false;
 const reject=field=>{rejected.add(field);replacementFields.add(field);};
 const accept=(field,value)=>{
  if(replacementFields.has(field)||explicitCorrection&&!correctionApplied.has(field)){affirmed.delete(field);uncertain.delete(field);replacementFields.delete(field);}
  correctionApplied.add(field);
  const literals=affirmed.get(field)||new Set();literals.add(value);affirmed.set(field,literals);
  if(literals.size>1){rejected.add(field);uncertain.add(field);}
  changes[field]=value;
 };
 const fieldHint=clause=>{
  const label=numericField(lastLabel(clause));
  if(label)return label;
  if(/^(?:(?:son?|es|eran?|serian?)\s+)?\d[\d.,]*\s+(?:unidad(?:es)?|un|millar(?:es)?)\b/.test(clause))return 'quantity';
  if(/\bpor\s+(?:unidad(?:es)?|un|millar(?:es)?)\b|\b(?:usd|dolares?|dolar|ars|pesos?|eur|euros?)\b|u\$s|us\$/.test(clause))return 'price';
  if(/\d[\d.,]*\s+(?:unidad(?:es)?|un|millar(?:es)?)\b/.test(clause))return 'quantity';
 };
 for(let i=0;i<clauses.length;i++){
  const clause=clauses[i];
  explicitCorrection=/^(?:mejor|en realidad|corrijo|correccion|el (?:precio|importe) correcto|la cantidad correcta)\b/.test(clause);
  correctionApplied=new Set();
  if(preservation(clause)||/[¿?]/.test(clause)||/\b(?:quizas|tal vez|podria|tentativo|puede ser)\b/.test(clause))continue;
  if(!/\d/.test(clause)&&/\b(?:sin\s+(?:el\s+)?precio|no\s+(?:incluyas|incluir|pongas|poner)\s+(?:el\s+)?precio)\b/.test(clause)){
   optionalPriceRemoved=true;reject('price');reject('priceUnit');
  }
  const negative=denied(clause),hint=fieldHint(clause);
  const nextHint=clauses[i+1]&&!preservation(clauses[i+1])?fieldHint(clauses[i+1]):undefined;
  const matches=[...clause.matchAll(amount)];
  const negatedAmounts=[];
  for(const match of matches){
   const prefix=clause.slice(0,match.index),suffix=clause.slice(match.index+match[0].length);
   if(refPrefix.test(prefix)||otherNumericPrefix.test(prefix)||/[a-z0-9_/-]$/.test(prefix)||/^[a-z_/-]/.test(suffix)||/^\s*%/.test(suffix))continue;
   if(/\bmoneda\s*(?:es\s+|:)?\s*$/.test(prefix)){
    focus='currency';
    if(negative)reject('currency');else accept('currency',match[0]);
    continue;
   }
   if(/\bpor\s*$/.test(prefix))continue;
   const previous=matches.filter(other=>other.index<match.index).at(-1);
   const localPrefix=previous?prefix.slice(previous.index+previous[0].length):prefix;
   let field=numericField(lastLabel(localPrefix));
   if(!field&&/^\s*(?:usd|dolares?|dolar|ars|pesos?|eur|euros?|u\$s|us\$)\b/.test(suffix))field='price';
   if(!field&&/^\s*(?:por\s+(?:unidad|millar)|cada\s+mil)\b/.test(suffix))field='price';
   if(!field&&/^\s*(?:unidades?|un|millares?)\b/.test(suffix))field='quantity';
   const parsed=importedNumber(match[0]);
   if(!field&&negative){
    const known=['price','quantity'].filter(k=>parsed&&importedNumber(values[k])===parsed);
    if(known.length===1)field=known[0];
    else if(known.length>1&&!focus&&!hint&&!nextHint){for(const key of known)reject(key);continue;}
   }
   if(!field&&/\ba\s*$/.test(localPrefix)&&/\b(?:cambia(?:me|r)?|modifica(?:me|r)?|corregi(?:me|r)?|ajusta(?:me|r)?)\b/.test(clause))field='price';
   field??=focus||hint||nextHint;
   if(!field)continue;
   focus=field;
   if(negative){reject(field);negatedAmounts.push({field,end:match.index+match[0].length});}
   else if(parsed)accept(field,parsed);
   else {reject(field);uncertain.add(field);} // Ambiguous grouping is never guessed.
   if(/\d[\d.,]*\s+(?:o|u)\s+(?:a\s+)?\d/.test(clause)){reject(field);uncertain.add(field);}
  }
  const currencies=[...clause.matchAll(currency)];
  for(const match of currencies){
   // "No son 80 dólares, son 90" rejects the amount, not the currency
   // qualifying it. The rejected clause must not introduce a new currency.
   if(negative&&negatedAmounts.some(amount=>amount.end<=match.index&&!/\bmoneda\b/.test(clause.slice(amount.end,match.index))))continue;
   if(negative)reject('currency');else accept('currency',money(match[0]));
  }
  if(!negative&&new Set(currencies.map(m=>money(m[0]))).size>1){reject('currency');uncertain.add('currency');}
  for(const match of clause.matchAll(base)){
   const prefix=clause.slice(0,match.index),label=numericField(lastLabel(prefix));
   const preceding=/\d[\d.,]*\s*$/.exec(prefix);
   if(preceding&&refPrefix.test(prefix.slice(0,preceding.index)))continue;
   if(negative&&negatedAmounts.some(amount=>amount.end<=match.index&&!/\bbase\b/.test(clause.slice(amount.end,match.index))))continue;
   const priceBase=/\b(?:por|cada)\s*$/.test(prefix)||label==='price';
   const quantityBase=label==='quantity'||/\d[\d.,]*\s*$/.test(prefix)&&!priceBase;
   let field=priceBase?'priceUnit':quantityBase?'quantityUnit':undefined;
   if(!field&&['price','quantity'].includes(focus))field=focus==='price'?'priceUnit':'quantityUnit';
   if(!field)continue;
   focus=field==='priceUnit'?'price':'quantity';
   const thousand=match[0].startsWith('millar');
   if(negative)reject(field);
   else accept(field,field==='priceUnit'?thousand?'millar':'unidad':thousand?'millares':'unidades');
  }
  // A rejected field need not contain a number: "ese precio no" or "no se
  // la cantidad" invalidates that field while preserving unrelated inputs.
  if(negative&&!matches.length){
   const label=numericField(lastLabel(clause));
   if(label&&!/\b(?:unidad|unidades|millar|millares)\b/.test(clause))reject(label);
   if(/\bmoneda\b/.test(clause))reject('currency');
  }
 }
 for(const field of uncertain)delete changes[field];
 if(changes.price!==undefined)optionalPriceRemoved=false;
 const rejectedFields=fields.filter(field=>rejected.has(field));
 const pending=rejectedFields.filter(field=>changes[field]===undefined&&!(optionalPriceRemoved&&['price','priceUnit'].includes(field)));
 return {changes,rejected:rejectedFields,pending,...(optionalPriceRemoved?{optionalPriceRemoved:true}:{})};
}

const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const fields=['emission','due','warehouse','payment'];
const label=/\b(fecha\s+de\s+emision|fecha\s+emision|emision|fecha\s+de\s+(?:entrega|necesidad|vencimiento)|fecha\s+(?:entrega|necesidad|vencimiento)|entrega|necesidad|vencimiento|deposito|almacen|condicion(?:es)?\s+de\s+pago|forma\s+de\s+pago|pago|fecha)\b/g;
const hint=value=>/emision/.test(value)?'emission':/vencimiento/.test(value)?'unsupportedDate':/entrega|necesidad/.test(value)?'due':/deposito|almacen/.test(value)?'warehouse':/pago/.test(value)?'payment':'date';
const preserved=value=>/\bno\s+(?:me\s+)?(?:cambies|cambiar|modifiques|modificar|toques|tocar|borres|borrar)\b/.test(value);
const denied=value=>/\b(?:no|sin|descarta|descartar|quita|quitar|borra|borrar)\b/.test(value);
const monthName=/\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/;
function isoDate(year,month,day){
 const date=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));
 return date.getUTCFullYear()===Number(year)&&date.getUTCMonth()===Number(month)-1&&date.getUTCDate()===Number(day)?date.toISOString().slice(0,10):null;
}
function parseDate(value,today){
 const normalized=norm(value);
 let match=/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(normalized);
 if(match)return isoDate(match[1],match[2],match[3]);
 match=/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?\b/.exec(normalized);
 // A year is never inferred from the machine clock or a previous document.
 if(match)return match[3]?.length===4?isoDate(match[3],match[2],match[1]):null;
 // Do not ignore an explicit calendar day/month and reinterpret only its
 // weekday as the next occurrence. Ask for a complete supported date instead.
 if(/\d/.test(normalized)||monthName.test(normalized))return null;
 const relative=/\b(pasado\s+manana|anteayer|ayer|hoy|manana|(?:(?:pasado|anterior)\s+)?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:\s+(?:pasado|anterior))?)\b/.exec(normalized);
 if(!relative)return null;
 const base=today instanceof Date?(Number.isFinite(today.getTime())?today.toISOString().slice(0,10):''):String(today??'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(base)||!isoDate(...base.split('-')))return null;
 const date=new Date(`${base}T00:00:00Z`),word=relative[1];
 const weekdays=['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
 const weekday=weekdays.find(day=>new RegExp(`\\b${day}\\b`).test(word));
 const backwards=weekday&&/\b(?:pasado|anterior)\b/.test(word);
 const offset=word==='hoy'?0:word==='manana'?1:word==='ayer'?-1:word==='anteayer'?-2:word==='pasado manana'?2:backwards?-((date.getUTCDay()-weekdays.indexOf(weekday)+7)%7||7):(weekdays.indexOf(weekday)-date.getUTCDay()+7)%7||7;
 date.setUTCDate(date.getUTCDate()+offset);
 return date.toISOString().slice(0,10);
}
const dateLiteral=/\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-](?:\d{4}|\d{2}))?|pasado\s+manana|anteayer|ayer|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/;
function candidate(text){
 const prefix=/^\s*(?:(?:no|sin|es|el|la|de|del|al|para|usa|usar|use|uses|utiliza|utilizar|pone|poner|codigo|numero|nro|correct[oa]|ahora|mejor|sera|son)\b\s*|[:#=]\s*)+/i.exec(norm(text));
 return text.slice(prefix?.[0].length||0).replace(/\s+(?:no|si|por favor|en cambio)\s*$/i,'').trim();
}
// These are references/placeholders, not catalog names. Match the entire
// candidate so legitimate names such as "Nuevo Norte" remain literal names.
const catalogReference=/^(?:(?:el|la|lo|los|las|ese|esa|este|esta)\s+)?(?:anterior(?:es)?|(?:de\s+)?antes|primer[oa]|segund[oa]|tercer[oa]|ese|esa|este|esta|mism[oa]s?|habitual|por\s+defecto|otr[oa]|nuev[oa]|(?:sin\s+)?definir|desconocid[oa]|no\s+(?:se|lo\s+se|se\s+lo)|pendiente|pending|ningun[oa]?|[?]+)$/;

// Interprets literals only; caller must verify warehouse/payment against ERP.
// Dates are resolved once to ISO strings. Passing stored strings on later turns
// does not re-evaluate relative expressions. Bare weekdays mean the next
// occurrence; explicit pasado/anterior weekdays mean the previous occurrence.
export function logisticsCorrections(text,{values={},today}={}){
 let source=String(text??'');
 const empty=()=>({changes:{},rejected:[],pending:[]});
 if(/\b(?:si (?:te )?(?:digo|dijera|dijese)|por ejemplo|hipoteticamente|supongamos|que pasaria|el ejemplo|la frase)\b/.test(norm(source)))return empty();
 source=source.replace(/"([^"]*)"|“([^”]*)”|«([^»]*)»|'([^']*)'/g,(quoted,...args)=>{
  const content=args.slice(0,4).find(value=>value!==undefined)||'';
  const prefix=norm(source.slice(0,args[4]));
  // Quoted identifiers after an explicit catalog label are literals. Entire
  // quoted instructions/examples are still ignored.
  const catalogPrefix=/\b(?:deposito|almacen|pago)\s*(?:(?:es|el|la|codigo)\s+|[:#=]\s*)*$/.test(prefix);
  return catalogPrefix&&!denied(norm(content))&&!new RegExp(label.source).test(norm(content))?content:'';
 });
 source=source.replace(/(\d(?:[\d/-]*\d)?)\s+(?=(?:es|son|era|eran)\s+\d)/gi,'$1;');
 const clauses=source.split(/[,;\n]|\.(?=\s|$)|\b(?:sino|pero)\b|\by\s+(?=(?:no\s+)?(?:fecha|emision|entrega|necesidad|vencimiento|deposito|almacen|condicion|forma)\b)/i);
 const changes={},rejected=new Set(),pending=new Set(),affirmed=new Map();
 let focus,dateCandidate,dateField;
 const reject=field=>{rejected.add(field);pending.add(field);};
 const accept=(field,value,correction)=>{
  const existing=affirmed.get(field);
  if(existing&&existing!==value&&!correction){delete changes[field];reject(field);return;}
  affirmed.set(field,value);changes[field]=value;pending.delete(field);
 };
 for(const rawClause of clauses){
  const clause=norm(rawClause);
  if(preserved(clause)||/[¿?]/.test(clause)||/\b(?:quizas|tal vez|podria|tentativo|puede ser)\b/.test(clause))continue;
  const matches=[...clause.matchAll(label)];
  // Continuations may replace the focused literal ("usá 03"), but explicit
  // identities belonging to another field must never inherit that focus.
  if(!matches.length&&/\b(?:precio|importe|costo|cantidad|moneda|producto|articulo|cliente|proveedor|tienda|sucursal|filial|pedido|solicitud|orden|lista|codigo|item|comprador|solicitante|cotizacion|total)\b/.test(clause))continue;
  const segments=matches.length?matches.map((match,i)=>({field:hint(match[0]),text:rawClause.slice(match.index+match[0].length,matches[i+1]?.index),prefix:clause.slice(i?matches[i-1].index+matches[i-1][0].length:0,match.index)})):[{field:focus,text:rawClause,prefix:''}];
  for(const segment of segments){
   let field=segment.field;
   const normalized=norm(segment.text),negative=denied(segment.prefix+' '+normalized);
   if(!field&&dateLiteral.test(normalized)){
    const literal=parseDate(segment.text,today);
    const known=['emission','due'].filter(key=>values[key]&&values[key]===literal);
    field=known.length===1?known[0]:'date';
   }
   if(!field)continue;
   focus=field;
   if(field==='unsupportedDate'){
    pending.add('date');
    if(!negative&&dateLiteral.test(normalized))dateCandidate=parseDate(segment.text,today)||undefined;
    continue;
   }
   if(field==='date'){
    const known=['emission','due'].filter(key=>values[key]);
    const literal=negative&&dateLiteral.test(normalized)?parseDate(segment.text,today):null;
    const matching=literal?known.filter(key=>values[key]===literal):[];
    // Generic date references cannot erase either date when scope is ambiguous.
    if(matching.length===1)field=matching[0];
    else if(known.length===1)field=known[0];
    else {
     pending.add('date');
     if(!negative&&dateLiteral.test(normalized))dateCandidate=parseDate(segment.text,today)||undefined;
     continue;
    }
   }
   if(field==='emission'||field==='due')dateField=field;
   if(['warehouse','payment'].includes(field)&&catalogReference.test(norm(candidate(segment.text))))continue;
   if(negative){reject(field);continue;}
   let value;
   if(field==='emission'||field==='due'){
    if(!dateLiteral.test(normalized)){
     if(!catalogReference.test(norm(candidate(segment.text)))&&(/\d/.test(normalized)||monthName.test(normalized)))reject(field);
     continue;
    }
    value=parseDate(segment.text,today);
    if(!value){reject(field);continue;}
   }else{
    value=candidate(segment.text).replace(/\s+y\s*$/i,'');
    // Unresolved demonstratives or omissions must not become catalog identities.
    if(!value||catalogReference.test(norm(value)))continue;
    if(/\b(?:precio|cantidad|producto|articulo|moneda|unidad(?:es)?|millares?|pesos?|dolares?|usd|ars)\b/.test(norm(value)))continue;
   }
   const correction=/\b(?:mejor|corrijo|correccion|en realidad|correct[oa])\b/.test(clause)||rejected.has(field);
   accept(field,value,correction);
  }
 }
 // Affirmative literals win over a negation in either order within this turn.
 for(const field of Object.keys(changes))pending.delete(field);
 return {changes,rejected:fields.filter(field=>rejected.has(field)),pending:[...fields,'date'].filter(field=>pending.has(field)),...(dateCandidate?{dateCandidate}:{}),...(dateField?{dateField}:{})};
}

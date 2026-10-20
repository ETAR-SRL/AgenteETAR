const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

// Sólo identidades devueltas por herramientas, nunca códigos extraídos de una
// respuesta redactada por el modelo. Los importes históricos no se reutilizan.
export function previousPrice(messages,branch,{singleBranch=false,allowMultiple=false}={}){
 for(const message of [...messages].reverse()){
  if(message.role!=='assistant')continue;
  let saved;try{saved=JSON.parse(message.content);}catch{continue;}
  if(saved.sucursal!==undefined&&saved.sucursal!==branch)return null;
  if(saved.sucursal===undefined&&!singleBranch)return null;
  const evidence=(saved.evidence||[]).filter(e=>e.action==='precio_venta'&&e.identities?.length);
  if(!evidence.length){if(saved.evidence?.some(e=>e.identities?.length))return null;continue;}
  const e=evidence.at(-1),products=[...new Set(e.identities.map(r=>r.productoCodigo).filter(Boolean))];
  if(products.length!==1&&!allowMultiple)return null;
  return {product:products.length===1?products[0]:undefined,args:e.args||{},identities:e.identities,base:saved.priceBase};
 }
 return null;
}

export function assertPriceCurrency(input,row,assert){
 const normalized=normalize(input),description=normalize(row.moneda?.descripcion),code=String(row.moneda?.codigo||'');
 const requested=/\b(dolares?|usd)\b/.test(normalized)?'dólares':/\b(euros?|eur)\b/.test(normalized)?'euros':/\b(pesos?|ars)\b/.test(normalized)?'pesos':null;
 const matches=requested==='dólares'?/dolar|usd/.test(description):requested==='euros'?/euro|eur/.test(description):requested==='pesos'?/peso|ars/.test(description):true;
 const requestedCode=/\bmoneda\s+(\d+)\b/.exec(normalized)?.[1];
 assert(matches&&(!requestedCode||requestedCode===code),409,'MONEDA_DISTINTA',`El precio está en ${row.moneda?.descripcion||'moneda '+code}; no coincide con la moneda solicitada. No se convierte ni se cambia la moneda automáticamente.`);
}

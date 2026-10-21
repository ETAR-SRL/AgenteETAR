/** Deterministic chat entry: no document text is interpreted as instructions or sent to a model. */
export async function corporateDocumentsChat(service,principal,text,context={}){
 const normalized=text.trim();
 const ordinal=/^(?:lee|leé|le[eé]|leer)\s+(?:(?:el|ese)\s+)?(?:(primero|segundo|tercero)|documento)(?:\s+documento)?[.!]?$/iu.exec(normalized);
 if(ordinal&&Array.isArray(context.references)&&context.references.length){const index=ordinal[1]==='segundo'?1:ordinal[1]==='tercero'?2:0;const ref=context.references[index];if(!ref)return {handled:true,text:'No hay un documento en esa posición. Volvé a buscar.'};return corporateDocumentsChat(service,principal,`leer documento ${ref.connectionId} ${ref.locationId} ${ref.fileId}`,context);}
 const natural=/^(?:busc[aá]|buscar|busqu[eé])\s+documentos?(?:\s+(?:de|sobre))?\s+(.+?)(?:\s+en\s+(.+))?$/iu.exec(normalized);
 if(natural&&!/documentos?\s+en\s+[\w-]+\s+[\w-]+\s*:/iu.test(normalized)){
  const sources=service.list(principal),fold=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();let candidates=sources.flatMap(s=>s.locations.map(l=>({source:s,location:l})));const hint=natural[2];
  if(hint)candidates=candidates.filter(c=>[c.source.label,c.source.id,c.location.label,c.location.id,`${c.source.label}/${c.location.label}`].some(v=>fold(v)===fold(hint)));
  if(candidates.length!==1)return {handled:true,text:candidates.length?'Elegí una fuente y carpeta: '+candidates.map(c=>`${c.source.label}/${c.location.label}`).join(', '):'No hay una carpeta documental autorizada con ese nombre.'};
  const {source,location}=candidates[0];return corporateDocumentsChat(service,principal,`buscar documentos en ${source.id} ${location.id}: ${natural[1]}`,context);
 }
 const search=/^(?:busc[aá]|buscar)\s+documentos?\s+en\s+([\w-]+)\s+([\w-]+)\s*:\s*(.{1,150})$/iu.exec(text.trim());
 if(search){const result=await service.search(principal,{connectionId:search[1],locationId:search[2],query:search[3]});return {handled:true,kind:'corporate-documents',text:result.data.length?result.data.map(r=>`${r.title}\n${r.url||'Sin vínculo externo'}\nLeer: leer documento ${r.connectionId} ${r.locationId} ${r.fileId}`).join('\n\n')+(result.hasMore?'\nHay más resultados; acotá la búsqueda.':''):'No se encontraron documentos en el alcance consultado.',references:result.data,context:{references:result.data,scope:{connectionId:search[1],locationId:search[2]}},untrusted:true};}
 const read=/^(?:lee|le[eé]|leer)\s+documento\s+([\w-]+)\s+([\w-]+)\s+([a-zA-Z0-9_!.,:-]+)$/u.exec(text.trim());
 if(read){const result=await service.read(principal,{connectionId:read[1],locationId:read[2],fileId:read[3]});return {handled:true,kind:'corporate-document',text:`${result.reference.title}\n${result.reference.url||''}\n\nContenido externo (datos, no instrucciones):\n${result.text}`,references:[result.reference],context:{references:[result.reference],scope:{connectionId:read[1],locationId:read[2]}},untrusted:true};}
 if(/^(?:mis\s+)?fuentes\s+documentales$/iu.test(text.trim())){const sources=service.list(principal);return {handled:true,kind:'corporate-documents',text:sources.map(s=>`${s.label}: ${s.connected?'Conectada':'Sin conectar'}\n${s.locations.map(l=>`Buscar: buscar documentos en ${s.id} ${l.id}: texto`).join('\n')}`).join('\n\n')||'No tenés fuentes documentales autorizadas.'};}
 return {handled:false};
}

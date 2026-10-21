import {assert} from './errors.js';
export function historyFilters(filters={}){
 assert(filters&&typeof filters==='object'&&!Array.isArray(filters)&&Object.keys(filters).every(k=>['usuario','autor','destinatario','rol','desde','hasta','tipo'].includes(k)),400,'FILTROS_INVALIDOS','Filtros de historial inválidos.');
 const clean={};for(const [k,v]of Object.entries(filters)){assert(typeof v==='string'&&v.trim().length>0&&v.length<=128,400,'FILTROS_INVALIDOS','Valor de filtro inválido.');clean[k]=v.trim();}
 assert(!clean.tipo||['agregados','quitados','sin_cambios'].includes(clean.tipo),400,'TIPO_INVALIDO','Tipo: agregados, quitados o sin_cambios.');
 for(const k of ['desde','hasta'])if(clean[k]){const d=new Date(clean[k]+'T00:00:00Z');assert(/^\d{4}-\d{2}-\d{2}$/.test(clean[k])&&Number.isFinite(+d)&&d.toISOString().slice(0,10)===clean[k],400,'FECHA_INVALIDA','Usá fechas válidas AAAA-MM-DD.');}
 assert(!clean.desde||!clean.hasta||clean.desde<=clean.hasta,400,'FECHA_INVALIDA','Desde debe ser anterior a hasta.');return clean;
}
export function historyWhere(filters){const clauses=[],args=[];
 if(filters.autor){const prefix='user:'+filters.autor+':';clauses.push("((legacy=0 AND json_extract(body,'$.who.id')=?) OR (legacy=1 AND substr(actor,1,?)=?))");args.push(filters.autor,prefix.length,prefix);}
 for(const key of ['usuario','destinatario','rol'])if(filters[key]){const type=key==='rol'?'role':'user',arrays=filters.tipo==='agregados'?['added']:filters.tipo==='quitados'?['removed']:['added','removed'],test=arrays.map(field=>`EXISTS(SELECT 1 FROM json_each(json_extract(body,'$.${field}')) t WHERE json_extract(t.value,'$.kind')=? AND json_extract(t.value,'$.target')=?)`).join(' OR '),targetArgs=arrays.flatMap(()=>[type,filters[key]]);
  if(key==='usuario'){clauses.push(`((legacy=0 AND (json_extract(body,'$.who.id')=? OR ${test})) OR (legacy=1 AND substr(actor,1,?)=?))`);args.push(filters[key],...targetArgs,('user:'+filters[key]+':').length,'user:'+filters[key]+':');}
  else{clauses.push(`(legacy=0 AND (${test}))`);args.push(...targetArgs);}
 }
 if(filters.tipo){clauses.push(filters.tipo==='sin_cambios'?"(legacy=0 AND json_array_length(body,'$.added')=0 AND json_array_length(body,'$.removed')=0)":`(legacy=0 AND json_array_length(body,'$.${filters.tipo==='agregados'?'added':'removed'}')>0)`);}
 for(const key of ['desde','hasta'])if(filters[key]){const date=new Date(filters[key]+'T03:00:00Z');if(key==='hasta')date.setUTCDate(date.getUTCDate()+1);clauses.push(key==='desde'?'at>=?':'at<?');args.push(date.toISOString());}
 return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',args};
}

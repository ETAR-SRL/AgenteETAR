import {assert} from './errors.js';
export function historyFilters(filters={}){
 assert(filters&&typeof filters==='object'&&!Array.isArray(filters)&&Object.keys(filters).every(k=>['usuario','rol','desde','hasta'].includes(k)),400,'FILTROS_INVALIDOS','Filtros de historial inválidos.');
 const clean={};for(const [k,v]of Object.entries(filters)){assert(typeof v==='string'&&v.trim().length>0&&v.length<=128,400,'FILTROS_INVALIDOS','Valor de filtro inválido.');clean[k]=v.trim();}
 for(const k of ['desde','hasta'])if(clean[k]){const d=new Date(clean[k]+'T00:00:00Z');assert(/^\d{4}-\d{2}-\d{2}$/.test(clean[k])&&Number.isFinite(+d)&&d.toISOString().slice(0,10)===clean[k],400,'FECHA_INVALIDA','Usá fechas válidas AAAA-MM-DD.');}
 assert(!clean.desde||!clean.hasta||clean.desde<=clean.hasta,400,'FECHA_INVALIDA','Desde debe ser anterior a hasta.');return clean;
}
export function historyWhere(filters){const clauses=[],args=[];
 for(const key of ['usuario','rol'])if(filters[key]){const type=key==='usuario'?'user':'role',test=`EXISTS(SELECT 1 FROM json_each(json_extract(body,'$.added')) t WHERE json_extract(t.value,'$.kind')=? AND json_extract(t.value,'$.target')=?) OR EXISTS(SELECT 1 FROM json_each(json_extract(body,'$.removed')) t WHERE json_extract(t.value,'$.kind')=? AND json_extract(t.value,'$.target')=?)`;
  if(key==='usuario'){clauses.push(`((legacy=0 AND (json_extract(body,'$.who.id')=? OR ${test})) OR (legacy=1 AND substr(actor,1,?)=?))`);args.push(filters[key],type,filters[key],type,filters[key],('user:'+filters[key]+':').length,'user:'+filters[key]+':');}
  else{clauses.push(`(legacy=0 AND (${test}))`);args.push(type,filters[key],type,filters[key]);}
 }
 for(const key of ['desde','hasta'])if(filters[key]){const date=new Date(filters[key]+'T03:00:00Z');if(key==='hasta')date.setUTCDate(date.getUTCDate()+1);clauses.push(key==='desde'?'at>=?':'at<?');args.push(date.toISOString());}
 return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',args};
}

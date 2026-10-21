import {assert} from './errors.js';

// Only public conclusions and cited evidence belong here; never model reasoning.
export function casePriority(item,now=new Date()){
 const c=item.caseDetails||{},days=date=>date?Math.max(0,Math.floor((+now-Date.parse(date))/86400000)):0;
 const overdue=item.snapshot.fecha&&item.snapshot.fecha<now.toISOString().slice(0,10)?days(item.snapshot.fecha):0;
 const age=days(item.created),scope=item.kind==='kaiqen'?(item.snapshot.problems?.length||0):(item.snapshot.pendingItems||0);
 const reasons=[];
 if(c.preference==='high')reasons.push('Preferencia personal: alta');
 if(overdue)reasons.push(`${overdue} días desde ${item.snapshot.fechaTipo||'la fecha registrada'}`);
 if(age)reasons.push(`${age} días desde la detección`);
 if(scope)reasons.push(`${scope} ${item.kind==='kaiqen'?'problemas registrados':'ítems pendientes'} en el alcance leído`);
 if(item.status==='unknown')reasons.push('Fuente sin verificar: requiere relectura');
 if(['paused','cancelled'].includes(c.state))reasons.push(c.state==='paused'?'Caso pausado por vos':'Caso cancelado por vos');
 const score=(c.preference==='high'?1000:c.preference==='low'?-1000:0)+Math.min(overdue,365)*2+Math.min(age,365)+Math.min(scope,100);
 return {score,reasons:reasons.length?reasons:['Sin vencimiento ni antigüedad comprobados'],basis:'Preferencia, fecha registrada, antigüedad y alcance; sin comparar ni sumar monedas.'};
}

export class AttentionCases {
 constructor(db){this.db=db;db.db.exec(`CREATE TABLE IF NOT EXISTS op_case_details(owner TEXT NOT NULL,item TEXT NOT NULL,body TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(owner,item));`);}
 get(owner,id){const row=this.db.db.prepare('SELECT body,updated FROM op_case_details WHERE owner=? AND item=?').get(owner,id);return row?{...JSON.parse(row.body),updated:row.updated}:{state:'open',objective:null,nextSteps:[],preference:'normal',investigations:[],links:[]};}
 save(owner,id,patch){const old=this.get(owner,id),value={...old,...patch};delete value.updated;this.db.db.prepare('INSERT INTO op_case_details VALUES(?,?,?,?) ON CONFLICT(owner,item) DO UPDATE SET body=excluded.body,updated=excluded.updated').run(owner,id,JSON.stringify(value),this.db.now());return value;}
 update(owner,id,input){
  const patch={};
  if(input.state!==undefined){assert(['open','paused','cancelled'].includes(input.state),400,'ESTADO_INVALIDO','Estado de caso inválido.');patch.state=input.state;}
  if(input.objective!==undefined){assert(typeof input.objective==='string'&&input.objective.trim().length>0&&input.objective.length<=1000,400,'OBJETIVO_INVALIDO','Indicá un objetivo de hasta 1000 caracteres.');patch.objective=input.objective.trim();}
  if(input.nextSteps!==undefined){assert(Array.isArray(input.nextSteps)&&input.nextSteps.length<=20&&input.nextSteps.every(s=>typeof s==='string'&&s.trim()&&s.length<=1000),400,'PASOS_INVALIDOS','Indicá hasta veinte próximos pasos de hasta 1000 caracteres.');patch.nextSteps=input.nextSteps.map(s=>s.trim());}
  if(input.preference!==undefined){assert(['high','normal','low'].includes(input.preference),400,'PRIORIDAD_INVALIDA','Elegí prioridad alta, normal o baja.');patch.preference=input.preference;patch.preferenceExplicit=true;}
  this.save(owner,id,patch);this.db.event(owner,id,'case',{summary:'Se actualizó el estado, objetivo o próximos pasos del caso.'});
 }
 investigation(owner,id,input,resources,revision){
  const value={at:this.db.now(),evidenceAt:input.evidenceAt||this.db.now(),facts:(input.facts||[]).slice(0,100),hypotheses:(input.possibleCauses||[]).slice(0,100),missing:(input.unavailable||[]).slice(0,100),requiredResources:[...new Set(resources)],revision};
  const old=this.get(owner,id);this.save(owner,id,{investigations:[...(old.investigations||[]),value].slice(-20)});
 }
 link(owner,id,input,resources,revision){assert(typeof input.id==='string'&&input.id.length<=200&&typeof input.reason==='string'&&input.reason.length<=2000,400,'VINCULO_INVALIDO','Indicá una referencia y su motivo.');const old=this.get(owner,id),links=(old.links||[]).filter(x=>x.id!==input.id);links.push({id:input.id,status:input.status||'prepared',reason:input.reason,at:this.db.now(),requiredResources:resources,revision});this.save(owner,id,{links:links.slice(-50)});}
}

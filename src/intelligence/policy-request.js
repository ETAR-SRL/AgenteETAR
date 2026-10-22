const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

// A request to bypass the application contract is not an ERP operation. This
// guard runs before tools, learning or inference and never changes permissions.
export function blockedPolicyRequest(text){
 const n=normalize(text);
 const controls='(?:permisos?|autorizacion(?:es)?|confirmacion(?:es)?|aprobacion(?:es)?|validacion(?:es)?)';
 const bypass=new RegExp('\\b(?:ignora(?:r)?|omite|omiti|saltea(?:te)?|salta(?:te)?|desactiva|anula|eludi|pasa por alto)\\b[^.!?;\\n]{0,70}\\b'+controls+'\\b','g');
 const negatedBefore=index=>/\b(?:no|nunca|jamas)\s+(?:(?:lo|los|las|me|te)\s+)?$/.test(n.slice(0,index).trimEnd());
 const asksBypass=[...n.matchAll(bypass)].some(match=>!negatedBefore(match.index));
 const withoutChecks=new RegExp('\\b(?:no\\s+(?:respetes|valides|verifiques|controles|pidas|solicites|esperes)|sin\\s+(?:pedir|solicitar|esperar|validar|verificar))\\b[^.!?;\\n]{0,50}\\b'+controls+'\\b').test(n)
  ||/\b(?:actualiza|cambia|ejecuta|hace|crea|genera)\b[^.!?;\n]{0,100}\bsin\s+(?:ninguna\s+)?confirmacion\b/.test(n);
 const sqlRequest=/\b(?:hace|hacer|ejecuta(?:r)?|corre(?:r)?|manda|usa(?:r)?|habilita|permiti|dame)\b[^.!?;\n]{0,100}\bsql\s+(?:libre|arbitrario|sin\s+(?:restricciones|validaciones|limites))\b/.test(n);
 const rawStatement=/\b(?:ejecuta(?:r)?|corre(?:r)?|manda)\b[^\n]{0,100}\b(?:update\s+[\w.[\]]+\s+set|insert\s+into|delete\s+from|drop\s+(?:table|database)|truncate\s+table|select\b[^\n]{0,160}\bfrom)\b/.test(n);
 if(!asksBypass&&!withoutChecks&&!sqlRequest&&!rawStatement)return null;
 return 'No puedo saltear permisos ni confirmaciones ni ejecutar SQL libre. Puedo preparar un cambio por el circuito autorizado y mostrarte el resumen antes de confirmar. No se modificó nada.';
}

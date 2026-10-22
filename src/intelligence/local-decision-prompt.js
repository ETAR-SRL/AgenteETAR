// Guidance for small local models. The caller's domain rules and schema remain
// authoritative; this only explains how to encode a decision, never decides it.
export const localDecisionGuide=`Formato de decisión:
Elegí UNA acción permitida por el esquema y las reglas del sistema. No confundas intención con datos suficientes para realizarla. Si falta un dato obligatorio o hay alternativas ambiguas, usá responder y preguntá concretamente qué falta. Si piden eludir permisos o SQL libre, rechazá explícitamente esa parte con responder. Preparar nunca significa ejecutar.
Para responder, args debe ser exactamente {}: no completes propiedades opcionales, ni con cadenas vacías, ceros, valores por defecto o datos de ejemplo. Para herramientas incluí sólo argumentos necesarios respaldados por el mensaje o fuentes verificadas. No inventes identificadores ni moneda.
Copiá los valores numéricos como texto conservando su valor y su base ORIGINAL. Precio y cantidad son campos distintos; por unidad no es por millar. No conviertas ni multipliques al extraer. Ejemplo de extracción: «ABC a 7,25 cada unidad, medio millar» expresa precio "7,25", basePrecio "unidad", cantidad "0,5", baseCantidad "millares". Esto no autoriza preparar nada si las reglas exigen antes identificar registros.
Una pregunta o rechazo se codifica, por ejemplo, {"action":"responder","args":{},"answer":"Necesito que identifiques el documento."}. Contestá breve en español. Emití sólo el objeto JSON del esquema.`;

export function localDecisionMessages(messages,schema){
 const p=schema?.properties;
 if(schema?.type!=='object'||p?.action?.type!=='string'||!p.action.enum?.includes('responder')||p?.args?.type!=='object'||p?.answer?.type!=='string')return messages;
 const index=messages.findIndex(m=>m.role==='system');
 if(index<0)return [{role:'system',content:localDecisionGuide},...messages];
 return messages.map((message,i)=>i===index?{...message,content:message.content+'\n\n'+localDecisionGuide}:message);
}

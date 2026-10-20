import {existsSync} from 'node:fs';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {assert,HttpError} from '../errors.js';
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function importedNumber(raw){
 if(typeof raw==='number')return Number.isFinite(raw)&&raw>0?String(raw):'';
 let s=String(raw??'').trim().replace(/(?:USD|ARS|EUR|U\$S|US\$|\$|€)/ig,'').replace(/\s/g,'');
 if(!/^\d[\d.,]*$/.test(s))return '';
 if(s.includes('.')&&s.includes(',')){
  const decimal=s.lastIndexOf('.')>s.lastIndexOf(',')?'.':',',group=decimal==='.'?',':'.';
  const [integer,fraction,...extra]=s.split(decimal);if(extra.length||!fraction||!new RegExp('^\\d{1,3}(?:\\'+group+'\\d{3})+$').test(integer))return '';
  s=integer.split(group).join('')+'.'+fraction;
 }else if(/[.,]/.test(s)){
  if(s.split(/[.,]/).length!==2)return '';
  const [integer,fraction]=s.split(/[.,]/);if(fraction.length===3&&integer!=='0')return ''; // 1.234/1,234 is ambiguous without locale.
  s=integer+'.'+fraction;
 }
 return /^\d+(?:\.\d+)?$/.test(s)&&Number(s)>0?s:'';
}
export function parsePriceTables(extracted){
 const rows=[],notices=[...(extracted.notices||[])],allText=[extracted.context||'',...extracted.tables.flatMap(t=>t.rows.map(r=>r.join(' ')))].join('\n');
 const currencies=[...new Set((allText.match(/\b(?:USD|ARS|EUR)\b/gi)||[]).map(s=>s.toUpperCase()))];
 const defaults={party:/(?:proveedor|cliente)\s*:\s*([^\n]+)/i.exec(allText)?.[1]?.trim()||'',currency:currencies.length===1?currencies[0]:'',unit:/por millar|cada mil|por 1000/i.test(allText)?'millar':/por unidad|precio unitario/i.test(allText)?'unidad':''};
 const destinations=[[/\bproveedor\s*:/i,'proveedor'],[/\bcliente\s*:/i,'cliente'],[/\bpedido de venta\s*:/i,'pedidoVenta'],[/\b(?:pedido|orden) de compra\s*:/i,'pedidoCompra'],[/\bsolicitud(?: de compra)?\s*:/i,'solicitudCompra']].filter(([re])=>re.test(allText)).map(([,kind])=>kind);
 const orderKinds=destinations.filter(k=>!['proveedor','cliente'].includes(k));
 if(orderKinds.length===1)defaults.kind=orderKinds[0];else if(destinations.length===1)defaults.kind=destinations[0];
 defaults.number=/(?:pedido de (?:venta|compra)|orden de compra|solicitud(?: de compra)?)\s*:\s*([a-z0-9-]+)/i.exec(allText)?.[1]||'';
 for(const [key,label] of Object.entries({emission:'(?:fecha de )?emisi[oó]n',due:'(?:fecha de )?(?:necesidad|entrega)',warehouse:'dep[oó]sito',payment:'condici[oó]n de pago',requester:'solicitante',requesterCode:'usuario (?:ERP|Protheus)',buyer:'comprador',costCenter:'centro de costo'})){
  const found=new RegExp(`(?:^|\\n)${label}\\s*:\\s*([^\\n|;]+)`,'i').exec(allText)?.[1]?.trim();
  if(found)defaults[key]=found;
 }
 const aliases={product:/^(?:codigo|cod\.?|producto|articulo|sku|codigo (?:del |de )?(?:producto|proveedor)|cod\.? (?:art|prov)\.?|referencia|part number)$/,description:/^(?:descripcion|detalle|denominacion)$/,price:/^(?:precio(?: (?:nuevo|neto|unitario|lista|por unidad|por millar))?|importe|valor(?: unitario)?|costo|price|p\.? unit\.?)$/,currency:/^(?:moneda|divisa|currency)$/,unit:/^(?:unidad|u\.?m\.?|unidad de medida|base|presentacion)$/,number:/^(?:(?:nro\.?|numero|n[uú]m\.?) (?:de )?)?(?:pedido(?: de (?:venta|compra))?|solicitud|documento|orden de compra)$/,item:/^(?:item|renglon|linea|posicion)$/};
 aliases.quantity=/^(?:cantidad(?: (?:nueva|pedida|en (?:millares|unidades)))?|cant\.?|qty|quantity)$/;
 aliases.quantityUnit=/^(?:base\s*cantidad|unidad cantidad|unidad de cantidad|um cantidad|base de cantidad)$/;
 aliases.unit=/^(?:unidad|u\.?m\.?|unidad de medida|base|presentacion|base\s*precio|base del precio)$/;
 Object.assign(aliases,{warehouse:/^(?:deposito|almacen|local)$/,due:/^(?:(?:fecha de? )?(?:necesidad|entrega)|fecha necesidad)$/,costCenter:/^centro (?:de )?costo$/,observation:/^observaciones?$/});
 for(const table of extracted.tables){
  let header=-1,columns={};
  for(let i=0;i<Math.min(30,table.rows.length);i++){
   const mapped={};table.rows[i].forEach((cell,index)=>{const value=normalize(cell).replace(/[_\n]/g,' ').replace(/\s+/g,' ');for(const [key,re] of Object.entries(aliases))if(re.test(value))mapped[key]=index;});
   if((mapped.price!==undefined||mapped.quantity!==undefined)&&(mapped.product!==undefined||mapped.description!==undefined)){header=i;columns=mapped;break;}
  }
  if(header<0)notices.push(`${table.name}: no reconocí encabezados; las filas son candidatas y requieren revisar código e importe.`);
  const before=rows.length;
  for(let i=header+1;i<table.rows.length;i++){
   const cells=table.rows[i],source=cells.map(String).join(' | ');if(!source.trim())continue;
   if(/^(?:total|subtotal|iva|descuento|bonificacion|vigencia)\b/i.test(String(cells[0]).trim()))continue;
   let product,description,rawPrice,currency,unit;
   if(header>=0){product=cells[columns.product]??'';description=cells[columns.description]??'';rawPrice=cells[columns.price]??'';currency=cells[columns.currency]??'';unit=cells[columns.unit]??'';}
   else{
    const index=cells.findLastIndex((cell,j)=>j>0&&importedNumber(cell));if(index<1)continue;
    product=cells[0];description=cells.slice(1,index).join(' ');rawPrice=cells[index];currency='';unit='';
   }
   if(!String(product).trim()&&!String(description).trim())continue;
   const rawQuantity=header>=0?String(cells[columns.quantity]??'').trim():'';
   const quantityHeader=normalize(table.rows[header]?.[columns.quantity]);
   const quantityUnit=String(cells[columns.quantityUnit]??'').trim()||(/millares/.test(quantityHeader)?'millares':/unidades/.test(quantityHeader)?'unidades':columns.price===undefined?String(unit||''):'');
   if(!String(rawPrice).trim()&&!rawQuantity)continue;
   const quantity=/^[\d.,\s]+$/.test(rawQuantity)?importedNumber(rawQuantity):'';
   const quantityWarning=rawQuantity&&!quantity?'Cantidad no reconocida o separador ambiguo: corregila antes de confirmar.':'';
   rows.push({id:String(rows.length+1),product:String(product).trim(),description:String(description).trim(),price:importedNumber(rawPrice),rawPrice:String(rawPrice),currency:String(currency).trim()||defaults.currency,unit:String(unit).trim()||defaults.unit,number:String(cells[columns.number]??'').trim(),item:String(cells[columns.item]??'').trim(),source:source.slice(0,2000),location:`${table.name} · fila ${i+1}`,ocr:!!table.ocr,confidence:table.scores?.[i]??null,warning:!importedNumber(rawPrice)?'Importe no reconocido o separador ambiguo: completalo en decimal sin miles.':header<0?'Columnas inferidas; verificá contra el original.':''});
   Object.assign(rows.at(-1),{quantity,rawQuantity,quantityUnit});
   for(const key of ['warehouse','due','costCenter','observation'])rows.at(-1)[key]=String(cells[columns[key]]??'').trim();
   if(!String(rawPrice).trim())rows.at(-1).warning='';
   if(quantityWarning)rows.at(-1).warning=[rows.at(-1).warning,quantityWarning].filter(Boolean).join(' ');
  }
  if(rows.length===before)notices.push(`${table.name}: no se identificaron filas de precios. Podés agregar filas manualmente a partir del texto extraído.`);
 }
 assert(rows.length<=500,413,'LISTA_GRANDE','Se identificaron más de 500 precios. Dividí el archivo.');
 return {rows,defaults,notices:[...new Set(notices)],text:allText.slice(0,150000)};
}
export function createDocumentReader({root=process.cwd(),run}={}){
 const python=resolve(root,'.venv-documents','Scripts','python.exe');let busy=false;
 const status=()=>({available:!!run||(existsSync(python)&&existsSync(resolve(root,'.venv-documents','.ready'))),local:true,maxBytes:20*1024*1024,formats:['xlsx','xls','pdf','png','jpg','jpeg','webp'],busy});
 async function extract(req){
  assert(status().available,503,'DOCUMENTOS_NO_INSTALADOS','Falta instalar el lector local de documentos.');assert(!busy,429,'DOCUMENTO_EN_PROCESO','Hay otro archivo en lectura. Probá en unos instantes.');
  let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{}
  assert(name&&name.length<=180&&!/[\x00-\x1f\\/]/.test(name),400,'NOMBRE_ARCHIVO_INVALIDO','Nombre de archivo inválido.');
  const extension=extname(name).toLowerCase();assert(status().formats.includes(extension.slice(1)),415,'FORMATO_NO_ADMITIDO','Usá Excel XLSX/XLS, PDF, PNG, JPG o WebP.');
  busy=true;let file;
  try{
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;assert(bytes<=status().maxBytes,413,'ARCHIVO_GRANDE','Máximo 20 MB por archivo.');chunks.push(chunk);}assert(bytes>8,400,'ARCHIVO_VACIO','El archivo está vacío.');
   const buffer=Buffer.concat(chunks),hex=buffer.subarray(0,12).toString('hex');
   const valid=extension==='.xlsx'?hex.startsWith('504b0304'):extension==='.xls'?hex.startsWith('d0cf11e0a1b11ae1'):extension==='.pdf'?buffer.subarray(0,1024).includes(Buffer.from('%PDF-')):extension==='.png'?hex.startsWith('89504e470d0a1a0a'):extension==='.webp'?buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP':hex.startsWith('ffd8ff');
   assert(valid,415,'CONTENIDO_NO_COINCIDE','El contenido no coincide con el formato del archivo.');
   const dir=resolve(root,'data','documents-tmp');await mkdir(dir,{recursive:true});file=resolve(dir,randomUUID()+extension);await writeFile(file,buffer);
   const extracted=run?await run(file):await new Promise((done,reject)=>{
    const child=spawn(python,[resolve(root,'scripts','extract-prices.py'),file],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',OMP_NUM_THREADS:'2'}});let output='',tooLarge=false;
    const timer=setTimeout(()=>{child.kill();reject(new HttpError(504,'DOCUMENTO_TIMEOUT','La lectura superó 3 minutos. Dividí el archivo o mejorá la imagen.'));},180000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>600000){tooLarge=true;child.kill();}});child.stderr.on('data',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new HttpError(503,'DOCUMENTO_ERROR','No se pudo iniciar el lector local.'));});
    child.on('close',code=>{clearTimeout(timer);try{const value=JSON.parse(output);assert(!tooLarge&&code===0&&!value.error,422,'DOCUMENTO_ILEGIBLE',value.error||'No se pudo leer el archivo.');done(value);}catch(e){reject(e.status?e:new HttpError(422,'DOCUMENTO_ILEGIBLE','No se pudo leer el archivo. Verificá que no esté protegido y que el texto sea legible.'));}});
   });
   return {name,bytes,...parsePriceTables(extracted)};
  }finally{if(file)await unlink(file).catch(()=>{});busy=false;}
 }
 return {status,extract};
}

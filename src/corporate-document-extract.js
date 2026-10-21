import {existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {spawn} from 'node:child_process';
import {assert,HttpError} from './errors.js';
export const corporateBinaryMimes={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
const MAX_BYTES=8*1024*1024,MAX_TEXT=256*1024;
export function createCorporateDocumentExtractor({documents,root=process.cwd(),python=resolve(root,'.venv-documents','Scripts','python.exe'),runDocx}={}){
 const status=()=>({local:true,maxBytes:MAX_BYTES,maxTextBytes:MAX_TEXT,formats:{docx:!!runDocx||existsSync(python),pdf:!!documents?.status?.().available,xlsx:!!documents?.status?.().available}});
 async function extract({buffer,name,mime}){
  assert(Buffer.isBuffer(buffer)&&buffer.length>8&&buffer.length<=MAX_BYTES,413,'DOCUMENTOS_TAMANO','El archivo debe tener hasta 8 MiB.');
  assert(typeof name==='string'&&name.length<=180&&!/[\x00-\x1f\\/]/.test(name),400,'DOCUMENTOS_NOMBRE','Nombre de documento inválido.');const format=extname(name).slice(1).toLowerCase();
  assert(corporateBinaryMimes[format]===mime,415,'DOCUMENTOS_FORMATO','El nombre y tipo del documento no coinciden. Usá PDF, DOCX o XLSX.');
  const valid=format==='pdf'?buffer.subarray(0,1024).includes(Buffer.from('%PDF-')):buffer.subarray(0,4).equals(Buffer.from([0x50,0x4b,3,4]));assert(valid,415,'DOCUMENTOS_CONTENIDO','El contenido no coincide con el formato del documento.');
  assert(status().formats[format],503,'DOCUMENTOS_EXTRACTOR_NO_INSTALADO','Falta instalar el lector local para este formato. Ejecutá el instalador de documentos del servidor.');
  let text;
  if(format==='docx')text=runDocx?await runDocx(buffer):await new Promise((done,reject)=>{const child=spawn(python,[resolve(root,'scripts','extract-corporate-docx.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1'}});const chunks=[];let count=0,settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):done(value);};const timer=setTimeout(()=>{child.kill();finish(new HttpError(504,'DOCUMENTOS_EXTRACTOR_TIMEOUT','La lectura DOCX superó 30 segundos.'));},30000);child.stdout.on('data',chunk=>{count+=chunk.length;if(count>MAX_TEXT){child.kill();finish(new HttpError(413,'DOCUMENTOS_TEXTO_GRANDE','El texto supera 256 KiB.'));}else chunks.push(chunk);});child.stderr.on('data',()=>{});child.on('error',()=>finish(new HttpError(503,'DOCUMENTOS_EXTRACTOR_NO_INSTALADO','No se pudo iniciar el lector DOCX local.')));child.on('close',code=>finish(code===0?null:new HttpError(422,'DOCUMENTOS_ILEGIBLE','No se pudo leer el DOCX con los límites locales.'),Buffer.concat(chunks).toString('utf8')));child.stdin.on('error',()=>{});child.stdin.end(buffer);});
  else{const req={headers:{'x-file-name':encodeURIComponent(name)},async *[Symbol.asyncIterator](){yield buffer;}};const result=await documents.extract(req);text=result.text;}
  assert(typeof text==='string',422,'DOCUMENTOS_ILEGIBLE','El lector local no devolvió texto.');assert(Buffer.byteLength(text,'utf8')<=MAX_TEXT,413,'DOCUMENTOS_TEXTO_GRANDE','El texto extraído supera 256 KiB.');return {text,format,local:true};
 }
 extract.status=status;return extract;
}

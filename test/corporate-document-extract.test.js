import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createCorporateDocumentExtractor,corporateBinaryMimes} from '../src/corporate-document-extract.js';
const zip=Buffer.concat([Buffer.from([0x50,0x4b,3,4]),Buffer.from('synthetic-only')]);
test('local binary bridge checks MIME, signature, size and capabilities before extraction',async()=>{let calls=0;const extract=createCorporateDocumentExtractor({runDocx:async()=>{calls++;return 'Texto DOCX controlado';},documents:{status:()=>({available:true}),extract:async req=>{assert.equal(req.headers['x-file-name'],'manual.pdf');for await(const chunk of req)assert(chunk.length>8);return {text:'Texto PDF controlado'};}}});assert.equal(extract.status().formats.docx,true);assert.equal((await extract({buffer:zip,name:'manual.docx',mime:corporateBinaryMimes.docx})).text,'Texto DOCX controlado');assert.equal((await extract({buffer:Buffer.from('%PDF-1.7 synthetic'),name:'manual.pdf',mime:corporateBinaryMimes.pdf})).text,'Texto PDF controlado');await assert.rejects(extract({buffer:zip,name:'manual.docx',mime:'text/plain'}),{code:'DOCUMENTOS_FORMATO'});await assert.rejects(extract({buffer:Buffer.alloc(8*1024*1024+1),name:'manual.docx',mime:corporateBinaryMimes.docx}),{code:'DOCUMENTOS_TAMANO'});await assert.rejects(extract({buffer:Buffer.from('invalid content'),name:'manual.pdf',mime:corporateBinaryMimes.pdf}),{code:'DOCUMENTOS_CONTENIDO'});assert.equal(calls,1);});
test('missing local extraction runtime fails explicitly without pretending a document was read',async()=>{const extract=createCorporateDocumentExtractor({python:'C:/nonexistent/documents/python.exe'});assert.equal(extract.status().formats.pdf,false);await assert.rejects(extract({buffer:zip,name:'manual.docx',mime:corporateBinaryMimes.docx}),{code:'DOCUMENTOS_EXTRACTOR_NO_INSTALADO'});});
test('DOCX standard-library parser reads fixture text and rejects entities, macros and expansion limits',t=>{const probe=spawnSync('python',['--version'],{windowsHide:true});if(probe.status!==0){t.skip('Python fixture runtime unavailable');return;}const code=`import importlib.util, io, zipfile
spec=importlib.util.spec_from_file_location('docx','scripts/extract-corporate-docx.py'); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def fixture(xml,extra=None):
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
  z.writestr('[Content_Types].xml','<Types/>');z.writestr('word/document.xml',xml)
  if extra:z.writestr(extra,b'macro')
 return b.getvalue()
xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Texto controlado</w:t></w:r></w:p></w:body></w:document>'
assert module.extract_docx(fixture(xml))=='Texto controlado'
for data in [fixture('<!DOCTYPE x [<!ENTITY x "bad">]>'+xml),fixture(xml,'word/vbaProject.bin'),fixture(xml.replace('Texto controlado','x'*300000))]:
 try:module.extract_docx(data)
 except ValueError:pass
 else:raise AssertionError('unsafe fixture accepted')
`;const result=spawnSync('python',['-c',code],{windowsHide:true,timeout:30000,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});assert.equal(result.status,0,result.stderr);});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, linkSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const bootstrap=fileURLToPath(new URL('../scripts/preparar-dependencias-windows.ps1',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('../scripts/windows-dependencies.json',import.meta.url),'utf8'));
const skip=process.platform!=='win32';
function run(root,args=[],timeout=60_000){
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!['path','psmodulepath'].includes(key.toLowerCase())));
  env.PATH=join(process.env.SystemRoot,'System32');
  const child=spawnSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-ExecutionPolicy','Bypass','-File',bootstrap,'-Root',root,'-Json',...args],{encoding:'utf8',windowsHide:true,env,timeout});
  assert.ifError(child.error);
  assert.equal(child.stderr,'');
  return {status:child.status,result:JSON.parse(child.stdout.trim()),raw:child.stdout};
}
test('bootstrap pins official runtime downloads and exact wheel hashes',()=>{
  assert.equal(manifest.node.version,'24.16.0');
  for(const key of ['node','python','ollama','msvc']){
    assert.match(manifest[key].url,/^https:\/\/(nodejs\.org|www\.python\.org|github\.com|aka\.ms)\//);
    assert.match(manifest[key].sha256,/^[a-f0-9]{64}$/);
  }
  const lock=readFileSync(new URL('../scripts/voice-requirements-lock.txt',import.meta.url),'utf8').replaceAll('\r\n','\n');
  const pins=readFileSync(new URL('../scripts/voice-requirements.txt',import.meta.url),'utf8').trim().split(/\r?\n/);
  for(const pin of pins) assert.ok(lock.includes(pin+' \\\n    --hash=sha256:'),pin);
  const documentLock=readFileSync(new URL('../scripts/requirements-documents-lock.txt',import.meta.url),'utf8').replaceAll('\r\n','\n');
  const documentPins=readFileSync(new URL('../scripts/requirements-documents.txt',import.meta.url),'utf8').trim().split(/\r?\n/);
  for(const pin of documentPins)assert.ok(documentLock.includes(pin+' \\\n    --hash=sha256:'),pin);
});
test('Windows offline portable Node and Python create working voice and OCR environments without global installation', {skip:skip||!['1','documents'].includes(process.env.CENTRAL_TEST_OFFLINE_INSTALL),timeout:660_000},()=>{
  const source=fileURLToPath(new URL('../',import.meta.url));
  const root=mkdtempSync(join(tmpdir(),'Central deps offline '));
  function link(sourcePath,target){mkdirSync(join(target,'..'),{recursive:true});linkSync(sourcePath,target);}
  try{
    for(const key of ['node','python'])link(join(source,'data/install-cache',manifest[key].file),join(root,'data/install-cache',manifest[key].file));
    for(const name of readdirSync(join(source,'data/install-cache/wheels')))link(join(source,'data/install-cache/wheels',name),join(root,'data/install-cache/wheels',name));
    for(const name of Object.keys(manifest.whisper.files))link(join(source,'data/models/whisper-base',name),join(root,'data/models/whisper-base',name));
    writeFileSync(join(root,'package.json'),JSON.stringify({private:true,dependencies:{}}));
    const documentsOnly=process.env.CENTRAL_TEST_OFFLINE_INSTALL==='documents';
    const options=['-SkipDownloads','-SkipIntelligence',...(documentsOnly?['-SkipVoice']:[])];
    const {status,result}=run(root,options,540_000);
    assert.equal(status,0,JSON.stringify(result)); assert.equal(result.ready,true);
    assert.equal(result.nodePath,join(root,'data/node-runtime/node.exe'));
    if(!documentsOnly)assert.equal(result.pythonPath,join(root,'.venv-voice/Scripts/python.exe'));
    assert.equal(result.documentsPythonPath,join(root,'.venv-documents/Scripts/python.exe'));
    assert.equal(readFileSync(join(root,'.venv-documents/.ready'),'utf8').trim(),'local-documents-v1');
    assert.ok(result.checks.some(item=>item.name==='documents'&&item.ready));
    assert.ok(existsSync(join(root,'data/python-runtime/Lib/venv/__init__.py')));
    const recheck=run(root,['-Check','-SkipIntelligence',...(documentsOnly?['-SkipVoice']:[])],90_000);
    assert.equal(recheck.status,0,JSON.stringify(recheck.result));
  }finally{
    // Do not replace the installation assertion/timeout with a transient Windows
    // antivirus cleanup failure. The OS temp directory is the only target.
    try{rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:1000});}catch{console.warn('Fixture temporal conservada para limpieza posterior:',root);}
  }
});
test('Windows bootstrap Check diagnoses an empty relocated directory without writing', {skip},()=>{
  const root=mkdtempSync(join(tmpdir(),'Central deps check '));
  try{
    const {status,result}=run(root,['-Check']);
    assert.equal(status,1); assert.equal(result.ready,false); assert.equal(result.checkOnly,true);
    assert.ok(result.checks.some(c=>c.name==='node'&&!c.ready));
    assert.ok(result.checks.some(c=>c.name==='voice-python'&&!c.ready));
    assert.ok(result.checks.some(c=>c.name==='local-model'&&!c.ready));
    assert.deepEqual(readdirSync(root),[]);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('Windows bootstrap rejects corrupt offline archives before extraction and preserves fixtures', {skip},()=>{
  const root=mkdtempSync(join(tmpdir(),'Central deps corrupt '));
  try{
    const cache=join(root,'data/install-cache'); mkdirSync(cache,{recursive:true});
    writeFileSync(join(cache,manifest.node.file),'not a valid pinned ZIP');
    const {status,result}=run(root,['-SkipDownloads','-SkipVoice','-SkipDocuments','-SkipIntelligence']);
    assert.equal(status,1); assert.equal(result.ready,false);
    assert.ok(result.errors.some(e=>/SHA256 incorrecto/.test(e)));
    assert.deepEqual(readdirSync(join(root,'data')),['install-cache']);
    assert.equal(readFileSync(join(cache,manifest.node.file),'utf8'),'not a valid pinned ZIP');
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('Windows native tools may warn on stderr without failing; failed tools redact captured details', {skip},()=>{
  const root=mkdtempSync(join(tmpdir(),'Central deps warnings '));
  try{
    const source=readFileSync(bootstrap,'utf8');
    const helper=source.slice(source.indexOf('function Invoke-Quiet('),source.indexOf('function Test-Node('));
    const script=join(root,'native-warning-proof.ps1');
    writeFileSync(script,`$ErrorActionPreference='Stop'\n${helper}\n$null=Invoke-Quiet $env:ComSpec @('/d','/c','echo warning-safe 1>&2 & exit /b 0')\nif($ErrorActionPreference -ne 'Stop'){throw 'Preference was not restored'}\n$failed=$false\ntry{$null=Invoke-Quiet $env:ComSpec @('/d','/c','echo secret-proxy-never-output 1>&2 & exit /b 9')}catch{$failed=$true;if($_.Exception.Message.Contains('secret-proxy')){throw 'Leaked output'}}\nif(-not $failed){throw 'Failed native tool was accepted'}\nWrite-Output 'native warning proof passed'\n`);
    const child=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:30_000});
    assert.ifError(child.error);assert.equal(child.status,0,child.stderr);assert.equal(child.stderr,'');
    assert.equal(child.stdout.trim(),'native warning proof passed');
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('Windows native runtime check rejects older DLL versions and preserves newer ones', {skip},()=>{
  const root=mkdtempSync(join(tmpdir(),'Central deps native version '));
  try{
    const source=readFileSync(bootstrap,'utf8');
    const helper=source.slice(source.indexOf('function Test-NativeRuntime('),source.indexOf('function Read-Setting('));
    const script=join(root,'native-version-proof.ps1');
    writeFileSync(script,`$ErrorActionPreference='Stop'\n${helper}\n$directory=$PSScriptRoot\n$manifest=[pscustomobject]@{msvc=[pscustomobject]@{version='14.44.35211.0'}}\nif(Test-NativeRuntime $directory){throw 'Missing DLLs were accepted'}\nAdd-Type -TypeDefinition '[assembly: System.Reflection.AssemblyFileVersion("14.0.24215.1")] public class NativeVersionFixture {}' -OutputAssembly (Join-Path $directory 'msvcp140.dll')\nCopy-Item -LiteralPath (Join-Path $directory 'msvcp140.dll') -Destination (Join-Path $directory 'vcruntime140_1.dll')\nif(Test-NativeRuntime $directory){throw 'Old DLL versions were accepted'}\n$manifest.msvc.version='14.0.0.0'\nif(-not (Test-NativeRuntime $directory)){throw 'Newer DLL versions were rejected'}\nWrite-Output 'native version proof passed'\n`);
    const child=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:30_000});
    assert.ifError(child.error);assert.equal(child.status,0,child.stderr);assert.equal(child.stderr,'');
    assert.equal(child.stdout.trim(),'native version proof passed');
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('Windows bootstrap keeps configured external provider and suppresses secret values', {skip},()=>{
  const root=mkdtempSync(join(tmpdir(),'Central deps external '));
  try{
    mkdirSync(join(root,'data')); writeFileSync(join(root,'data/ai-settings.json'),JSON.stringify({provider:'openai',apiKey:'secret-never-in-output'}));
    writeFileSync(join(root,'.env'),'AI_PROVIDER=local\nAI_API_KEY=secret-env-never-in-output\n');
    const {result,raw}=run(root,['-Check','-SkipVoice','-SkipDocuments']);
    assert.ok(result.checks.some(c=>c.name==='ai-provider'&&c.ready));
    assert.ok(!result.checks.some(c=>c.name==='ollama'));
    assert.ok(!raw.includes('secret-')); assert.deepEqual(readdirSync(root).sort(),['.env','data']);
    writeFileSync(join(root,'data/ai-settings.json'),'broken secret-invalid-json');
    const invalid=run(root,['-Check','-SkipVoice','-SkipDocuments']);
    assert.equal(invalid.result.ready,false); assert.ok(!invalid.raw.includes('secret-'));
  }finally{rmSync(root,{recursive:true,force:true});}
});

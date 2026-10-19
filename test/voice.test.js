import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createVoice} from '../src/voice.js';
const request=(bytes=200,type='audio/webm')=>Object.assign(Readable.from([Buffer.alloc(bytes)]),{headers:{'content-type':type}});
async function root(t){const dir=await mkdtemp(join(tmpdir(),'central-voice-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'.venv-voice','Scripts'),{recursive:true});await writeFile(join(dir,'.venv-voice','Scripts','python.exe'),'');await mkdir(join(dir,'data','models','whisper-base'),{recursive:true});await writeFile(join(dir,'data','models','whisper-base','model.bin'),'');return dir;}
test('voice validates format and size, isolates concurrent requests, removes audio on success',async t=>{
 const dir=await root(t);let release;const transcriptor=createVoice({root:dir,run:()=>new Promise(resolve=>{release=resolve;})});
 await assert.rejects(()=>transcriptor.transcribe(request(200,'text/plain')),{code:'AUDIO_INVALIDO'});
 await assert.rejects(()=>transcriptor.transcribe(request(8*1024*1024+1)),{code:'AUDIO_GRANDE'});
 assert.equal(transcriptor.status().busy,false);
 const pending=transcriptor.transcribe(request());
 await assert.rejects(()=>transcriptor.transcribe(request()),{code:'VOZ_OCUPADA'});
 while(!release)await new Promise(resolve=>setImmediate(resolve));release({text:'mostrar proyectos'});
 assert.equal((await pending).externalAudio,false);assert.deepEqual(await readdir(join(dir,'data','audio-tmp')),[]);assert.equal(transcriptor.status().busy,false);
});
test('voice removes temporary audio after transcription failure',async t=>{
 const dir=await root(t),voice=createVoice({root:dir,run:async()=>{throw new Error('test');}});
 await assert.rejects(()=>voice.transcribe(request()));assert.deepEqual(await readdir(join(dir,'data','audio-tmp')),[]);assert.equal(voice.status().busy,false);
});

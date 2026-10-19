import { existsSync } from 'node:fs';
import { mkdir,writeFile,unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { assert, HttpError } from './errors.js';

export function createVoice({root=process.cwd(),run}={}){
  const python=resolve(root,'.venv-voice','Scripts','python.exe'),model=resolve(root,'data','models','whisper-base');
  let busy=false;
  const status=()=>({available:existsSync(python)&&existsSync(resolve(model,'model.bin')),engine:'Whisper base · CPU local',externalAudio:false,maxSeconds:45,busy});
  async function transcribe(req){
    assert(status().available,503,'VOZ_NO_INSTALADA','Falta instalar la transcripción local');
    assert(!busy,429,'VOZ_OCUPADA','Ya se está transcribiendo un audio');
    assert(/^(audio\/(webm|ogg|wav|x-wav|mp4)|video\/webm)(;|$)/.test(req.headers['content-type']||''),415,'AUDIO_INVALIDO','Formato de audio no admitido');
    busy=true;let file;
    try{
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;assert(size<=8*1024*1024,413,'AUDIO_GRANDE','Máximo 8 MB');chunks.push(chunk);}
      assert(size>100,400,'AUDIO_VACIO','No se recibió audio');
      const dir=resolve(root,'data','audio-tmp');await mkdir(dir,{recursive:true});file=resolve(dir,randomUUID()+'.audio');await writeFile(file,Buffer.concat(chunks));
      const result=await (run||(()=>new Promise((done,reject)=>{
        const child=spawn(python,[resolve(root,'scripts','transcribe.py'),model,file],{windowsHide:true,stdio:['ignore','pipe','pipe']});
        let output='';const timer=setTimeout(()=>{child.kill();reject(new HttpError(504,'VOZ_TIMEOUT','La transcripción superó el tiempo disponible'));},120_000);
        child.stdout.on('data',data=>{output+=data;if(output.length>32_000)child.kill();});
        child.stderr.on('data',()=>{});
        child.on('error',()=>{clearTimeout(timer);reject(new HttpError(503,'VOZ_ERROR','No se pudo iniciar el transcriptor'));});
        child.on('close',code=>{clearTimeout(timer);try{if(code!==0)throw new Error();done(JSON.parse(output));}catch{reject(new HttpError(422,'VOZ_ERROR','No se pudo transcribir el audio. Grabá hasta 45 segundos y probá de nuevo.'));}});
      })))();
      assert(typeof result.text==='string',422,'VOZ_ERROR','Transcripción inválida');return {...result,engine:'whisper-base-local',externalAudio:false};
    }finally{if(file)await unlink(file).catch(()=>{});busy=false;}
  }
  return {status,transcribe};
}

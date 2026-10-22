/** Voice dictation never submits a query: the resulting draft always needs review. */
export function installVoiceControls({button,input,status,api,isAvailable=()=>true,isChatBusy=()=>false,environment={}}){
  const win=environment.window||window,doc=environment.document||document;
  const media=environment.mediaDevices||navigator.mediaDevices,Recorder=environment.MediaRecorder||win.MediaRecorder;
  const now=environment.now||Date.now,delay=environment.setTimeout||win.setTimeout.bind(win),undelay=environment.clearTimeout||win.clearTimeout.bind(win);
  const repeat=environment.setInterval||win.setInterval.bind(win),unrepeat=environment.clearInterval||win.clearInterval.bind(win);
  const controls=doc.createElement('span');controls.className='voice-controls';controls.hidden=true;
  const stop=doc.createElement('button'),discard=doc.createElement('button');
  stop.type=discard.type='button';stop.textContent='■ Terminar';discard.textContent='Cancelar';stop.className=discard.className='secondary';controls.append(stop,discard);button.after(controls);
  const gestures=doc.createElement('span');gestures.className='voice-gestures';gestures.hidden=true;gestures.setAttribute('aria-hidden','true');
  const cancelHint=doc.createElement('span'),lockHint=doc.createElement('span');cancelHint.textContent='← Deslizá para cancelar';lockHint.textContent='↑ Deslizá para fijar';gestures.append(cancelHint,lockHint);controls.after(gestures);
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  let run=null,pointer=null,holdTimer=null,destroyed=false,sequence=0;
  const controlPresses=new Map();
  const listeners=[];
  const on=(target,name,handler)=>{target.addEventListener(name,handler);listeners.push(()=>target.removeEventListener(name,handler));};
  const say=text=>{status.textContent=text;};
  const active=r=>!destroyed&&run===r&&!r.cancelled;
  const tracks=stream=>stream?.getTracks().forEach(track=>track.stop());
  function releasePointer(){const p=pointer;pointer=null;controlPresses.clear();undelay(holdTimer);holdTimer=null;button.style.transform='';gestures.hidden=true;if(p){try{button.releasePointerCapture(p.id);}catch{}}}
  function clearTimers(r){undelay(r.limit);unrepeat(r.tick);}
  function paint(){
    const recording=run?.phase==='recording',busy=Boolean(run);
    button.classList.toggle('recording',recording);button.classList.toggle('voice-locked',recording&&run.locked);
    // Keep pointer events alive while permission is pending so releasing can cancel.
    button.disabled=busy&&!recording&&run.phase!=='requesting';button.textContent=recording?'● Grabando':'🎙 Dictar';
    button.setAttribute('aria-label',recording?'Terminar dictado':'Dictar: mantené presionado o tocá para grabar');button.setAttribute('aria-pressed',String(recording));
    controls.hidden=!busy;stop.hidden=!recording;discard.textContent=run?.phase==='transcribing'?'Cancelar transcripción':'Cancelar';
  }
  function cancel({silent=false}={}){
    releasePointer();const r=run;if(!r)return;
    r.cancelled=true;run=null;clearTimers(r);r.abort?.abort();
    if(r.recorder?.state==='recording'){try{r.recorder.stop();}catch{}}
    tracks(r.stream);paint();if(!silent)say('Dictado cancelado. Tu texto se conserva.');
  }
  function tick(r){
    if(!active(r)||r.phase!=='recording')return;
    const guidance=r.locked?'Manos libres. Terminá o cancelá.':'Deslizá ← para cancelar · ↑ para fijar.';
    if(r.guidance!==guidance){say('Grabando · '+guidance);r.guidance=guidance;r.clock=doc.createElement('span');r.clock.setAttribute('aria-hidden','true');status.append(r.clock);}
    r.clock.textContent=` · ${Math.min(45,Math.floor((now()-r.started)/1000))} / 45 s`;
  }
  async function transcribe(r){
    if(!active(r)||!r.finish)return;
    const duration=r.duration;
    if(duration<400||!r.chunks.length){run=null;paint();say('El audio fue muy corto. Mantené presionado y hablá, o tocá para dictar.');return;}
    r.phase='transcribing';r.abort=new AbortController();paint();say('Transcribiendo en este equipo…');
    try{
      const blob=new Blob(r.chunks,{type:r.recorder.mimeType||'audio/webm'});
      const result=await api('/api/voice/transcribe',{method:'POST',headers:{'Content-Type':blob.type},body:blob,signal:r.abort.signal});
      if(!active(r))return;
      const text=String(result.text||'').trim();
      if(!text)say('No se detectó voz. Acercate al micrófono y probá otra vez.');
      else{
        const changed=input.value!==r.draft;
        const hadText=Boolean(input.value.trim());
        input.value=hadText?`${input.value.trimEnd()}\n${text}`:text;
        input.dispatchEvent(new win.Event('input',{bubbles:true}));
        say(changed?'Dictado agregado al texto que editaste. Revisalo antes de enviar.':hadText?'Dictado agregado al borrador. Revisalo antes de enviar.':'Texto listo. Revisalo y presioná Enviar.');input.focus();
      }
    }catch(error){if(active(r))say(error.message||'No se pudo transcribir. Probá otra vez.');}
    finally{if(active(r)){run=null;paint();}}
  }
  function finish(){
    releasePointer();const r=run;if(!r)return;
    if(r.phase==='requesting'){cancel();return;}
    if(r.phase!=='recording')return;
    r.finish=true;r.duration=Math.min(45_000,now()-r.started);r.phase='stopping';clearTimers(r);paint();
    try{r.recorder.stop();}catch{cancel();say('No se pudo terminar el dictado. Probá otra vez.');}
    tracks(r.stream);
  }
  async function start(locked){
    if(destroyed||run)return;
    if(isChatBusy()){say('Esperá a que termine la consulta para dictar.');releasePointer();return;}
    if(!isAvailable()){say('La transcripción local no está instalada. Podés consultar por texto.');releasePointer();return;}
    if(!media?.getUserMedia||!Recorder){say('Este navegador no permite grabar audio. Usá un navegador compatible en una conexión segura.');releasePointer();return;}
    const r={id:++sequence,phase:'requesting',locked,cancelled:false,chunks:[],draft:input.value};run=r;paint();say('Esperando permiso para usar el micrófono…');
    try{
      const stream=await media.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
      if(!active(r)){tracks(stream);return;}r.stream=stream;
      const type=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'].find(t=>Recorder.isTypeSupported?.(t));
      r.recorder=new Recorder(stream,type?{mimeType:type}:{});
      r.recorder.ondataavailable=e=>{if(active(r)&&e.data.size)r.chunks.push(e.data);};
      r.recorder.onstop=()=>{
        tracks(r.stream);clearTimers(r);
        if(active(r)&&!r.finish){cancel({silent:true});say('La grabación se interrumpió. Volvé a intentar el dictado.');return;}
        void transcribe(r);
      };
      r.recorder.onerror=()=>{if(active(r)){cancel({silent:true});say('No se pudo grabar. Probá otra vez.');}};
      r.started=now();r.phase='recording';r.recorder.start();paint();tick(r);r.tick=repeat(()=>tick(r),1000);r.limit=delay(finish,45_000);
    }catch(error){
      if(!active(r))return;cancel({silent:true});say(error.name==='NotAllowedError'?'Permití el micrófono desde los permisos del navegador y volvé a intentar.':error.name==='NotFoundError'?'No se encontró un micrófono conectado.':'No se pudo acceder al micrófono. Cerrá otras aplicaciones que lo estén usando.');
    }
  }
  const toggle=()=>{if(run?.phase==='recording')finish();else if(!run)void start(true);};
  on(button,'pointerdown',e=>{
    if(e.isPrimary===false||e.button!==0||pointer||run?.phase==='requesting'||run?.phase==='transcribing')return;
    e.preventDefault();if(run){finish();return;}
    pointer={id:e.pointerId,x:e.clientX,y:e.clientY,held:false};try{button.setPointerCapture(e.pointerId);}catch{}
    holdTimer=delay(()=>{if(pointer){pointer.held=true;gestures.hidden=false;void start(false);}},250);
  });
  on(button,'pointermove',e=>{
    if(!pointer||e.pointerId!==pointer.id)return;
    if(run?.locked)return;
    const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
    button.style.transform=`translate(${Math.max(-70,Math.min(12,dx))}px, ${Math.max(-65,Math.min(12,dy))}px)`;
    gestures.hidden=false;cancelHint.classList.toggle('voice-gesture-active',dx<-30);lockHint.classList.toggle('voice-gesture-active',dy<-30);
    if(dx<=-70){cancel();if(!run)say('Dictado cancelado. Tu texto se conserva.');}
    else if(dy<=-65){button.style.transform='';gestures.hidden=true;if(run){run.locked=true;tick(run);paint();}else{pointer.held=true;undelay(holdTimer);void start(true);}}
  });
  on(button,'pointerup',e=>{
    if(!pointer||e.pointerId!==pointer.id)return;
    const held=pointer.held;releasePointer();if(!held){void start(true);return;}if(!run?.locked)finish();
  });
  const lost=e=>{if(pointer&&e.pointerId===pointer.id)cancel();};
  on(button,'pointercancel',lost);on(button,'lostpointercapture',lost);
  on(button,'click',e=>{if(e.detail===0)toggle();});
  on(button,'contextmenu',e=>e.preventDefault());
  for(const [control,action] of [[stop,finish],[discard,()=>cancel()]]){
    on(control,'pointerdown',e=>{if(e.isPrimary!==false&&e.button===0)controlPresses.set(control,e.pointerId);});
    on(control,'pointercancel',()=>controlPresses.delete(control));
    on(control,'click',e=>{
      const started=controlPresses.get(control);controlPresses.delete(control);
      // Touch release can produce a click over a control exposed by the changing
      // layout. Only a press begun on that control may activate it; keyboard and
      // assistive clicks (detail=0) keep their native behavior.
      if(e.detail>0&&(started===undefined||e.pointerId!==undefined&&e.pointerId!==started)){e.preventDefault();return;}
      action();
    });
  }
  on(doc,'keydown',e=>{if(e.key==='Escape'&&(run||pointer)){e.preventDefault();cancel();}});
  on(win,'pagehide',()=>cancel({silent:true}));on(doc,'visibilitychange',()=>{if(doc.hidden)cancel({silent:true});});
  paint();
  return {isBusy:()=>Boolean(run),cancel,destroy(){cancel({silent:true});destroyed=true;listeners.forEach(remove=>remove());controls.remove();gestures.remove();}};
}

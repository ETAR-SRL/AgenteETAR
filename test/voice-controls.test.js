import test from 'node:test';
import assert from 'node:assert/strict';
import {installVoiceControls} from '../public/voice-controls.js';

class Element {
  constructor(){this.listeners={};this.value='';this.textContent='';this.attrs={};this.children=[];this.style={};this.classList={toggle(){}};}
  addEventListener(name,handler){(this.listeners[name]??=[]).push(handler);}
  removeEventListener(name,handler){this.listeners[name]=this.listeners[name].filter(h=>h!==handler);}
  dispatchEvent(event){for(const handler of this.listeners[event.type]||[])handler(event);return true;}
  fire(type,props={}){this.dispatchEvent({type,preventDefault(){},...props});}
  setAttribute(key,value){this.attrs[key]=value;}
  append(...nodes){this.children.push(...nodes);}
  after(node){this.next=node;}
  remove(){}
  focus(){this.focused=true;}
  setPointerCapture(){}
  releasePointerCapture(){}
}
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function harness({permission,api,available=true,busy=false}={}){
  let time=0,id=0;const timers=new Map(),recorders=[],requests=[];
  const timer=(fn,ms,repeat=false)=>{timers.set(++id,{fn,at:time+ms,ms,repeat});return id;};
  const advance=ms=>{const end=time+ms;while(true){let next;for(const [key,t]of timers)if(t.at<=end&&(!next||t.at<next[1].at))next=[key,t];if(!next)break;time=next[1].at;timers.delete(next[0]);if(next[1].repeat)timers.set(next[0],{...next[1],at:time+next[1].ms});next[1].fn();}time=end;};
  const stream={stops:0,getTracks(){return [{stop:()=>stream.stops++},{stop:()=>stream.stops++}];}};
  class Recorder{
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';this.mimeType='audio/webm';recorders.push(this);}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['voice'])});this.onstop?.();}
  }
  const button=new Element(),input=new Element(),status=new Element(),win=new Element(),doc=new Element();
  win.Event=class {constructor(type){this.type=type;}};doc.createElement=()=>new Element();
  const control=installVoiceControls({button,input,status,api:async(path,opts)=>{requests.push({path,...opts});return api?api(path,opts):{text:'Consulta dictada'};},isAvailable:()=>available,isChatBusy:()=>busy,environment:{window:win,document:doc,mediaDevices:{getUserMedia:()=>permission?permission():Promise.resolve(stream)},MediaRecorder:Recorder,now:()=>time,setTimeout:(f,ms)=>timer(f,ms),clearTimeout:key=>timers.delete(key),setInterval:(f,ms)=>timer(f,ms,true),clearInterval:key=>timers.delete(key)}});
  const down=()=>button.fire('pointerdown',{button:0,isPrimary:true,pointerId:1,clientX:200,clientY:200});
  const up=()=>button.fire('pointerup',{pointerId:1});
  return {button,input,status,win,doc,stream,recorders,requests,advance,control,down,up};
}

test('hold/release transcribes to a reviewed draft, never submits a query',async()=>{
  const h=harness();h.down();h.advance(250);await settle();assert.equal(h.recorders[0].state,'recording');h.advance(1200);h.up();await settle();
  assert.equal(h.input.value,'Consulta dictada');assert.equal(h.requests.length,1);assert.equal(h.requests[0].path,'/api/voice/transcribe');assert.equal(h.stream.stops>=2,true);assert.equal(h.control.isBusy(),false);h.control.destroy();
});
test('release while permission is pending cleans late tracks without recording',async()=>{
  let grant;const h=harness({permission:()=>new Promise(resolve=>{grant=resolve;})});h.down();h.advance(250);h.up();grant(h.stream);await settle();
  assert.equal(h.recorders.length,0);assert.equal(h.stream.stops,2);assert.equal(h.requests.length,0);assert.equal(h.control.isBusy(),false);h.control.destroy();
});
test('left gesture cancels; upward gesture locks until explicit finish',async()=>{
  const h=harness();h.down();h.advance(250);await settle();h.advance(800);h.button.fire('pointermove',{pointerId:1,clientX:100,clientY:200});h.up();await settle();assert.equal(h.requests.length,0);
  h.down();h.advance(250);await settle();h.button.fire('pointermove',{pointerId:1,clientX:200,clientY:120});h.up();assert.equal(h.recorders[1].state,'recording');h.advance(800);h.button.next.children[0].fire('click');await settle();assert.equal(h.requests.length,1);h.control.destroy();
});
test('tap and keyboard click provide handsfree start/stop; very short audio does not POST',async()=>{
  const h=harness();h.down();h.advance(80);h.up();await settle();h.advance(100);h.button.fire('click',{detail:0});await settle();assert.equal(h.requests.length,0);
  h.button.fire('click',{detail:0});await settle();h.advance(600);h.button.fire('click',{detail:0});await settle();assert.equal(h.requests.length,1);h.control.destroy();
});
test('cancel during transcription aborts and ignores late result, preserving next draft',async()=>{
  let resolve;const h=harness({api:()=>new Promise(r=>{resolve=r;})});h.button.fire('click',{detail:0});await settle();h.advance(900);h.button.fire('click',{detail:0});assert.equal(h.control.isBusy(),true);h.control.cancel();assert.equal(h.requests[0].signal.aborted,true);h.input.value='Otro texto';resolve({text:'Obsoleto'});await settle();assert.equal(h.input.value,'Otro texto');assert.equal(h.control.isBusy(),false);h.control.destroy();
});
test('typing while transcription runs appends and announces preserved edits',async()=>{
  let resolve;const h=harness({api:()=>new Promise(r=>{resolve=r;})});h.input.value='Original';h.button.fire('click',{detail:0});await settle();h.advance(700);h.button.fire('click',{detail:0});h.input.value='Edición propia';resolve({text:'Nuevo dictado'});await settle();assert.equal(h.input.value,'Edición propia\nNuevo dictado');assert.match(h.status.textContent,/agregado/);h.control.destroy();
});
test('existing unchanged draft is preserved and gesture movement has bounded feedback',async()=>{
  const h=harness();h.input.value='Consulta escrita';h.down();h.advance(250);await settle();h.advance(800);h.button.fire('pointermove',{pointerId:1,clientX:150,clientY:180});assert.equal(h.button.style.transform,'translate(-50px, -20px)');h.up();await settle();assert.equal(h.button.style.transform,'');assert.equal(h.input.value,'Consulta escrita\nConsulta dictada');assert.match(h.status.textContent,/borrador/);h.control.destroy();
});
test('maximum duration stops at 45 seconds and navigation discards/aborts',async()=>{
  const h=harness();h.button.fire('click',{detail:0});await settle();h.advance(45_000);await settle();assert.equal(h.recorders[0].state,'inactive');assert.equal(h.requests.length,1);assert.doesNotMatch(h.status.textContent,/46/);
  h.button.fire('click',{detail:0});await settle();h.advance(900);h.win.fire('pagehide');await settle();assert.equal(h.requests.length,1);assert.equal(h.control.isBusy(),false);h.control.destroy();
});
test('recording timer is visible without announcing every second to a screen reader',async()=>{
  const h=harness();h.button.fire('click',{detail:0});await settle();const clock=h.status.children.at(-1);
  assert.equal(clock.attrs['aria-hidden'],'true');const message=h.status.textContent;
  h.advance(3000);assert.equal(h.status.textContent,message);assert.match(clock.textContent,/3 \/ 45 s/);
  h.control.destroy();
});
test('recorder error, escape, pointer cancel and hidden document discard audio',async()=>{
  for(const action of [h=>h.recorders[0].onerror(),h=>h.doc.fire('keydown',{key:'Escape'}),h=>h.button.fire('pointercancel',{pointerId:1}),h=>{h.doc.hidden=true;h.doc.fire('visibilitychange');}]){
    const h=harness();h.down();h.advance(250);await settle();h.advance(800);action(h);await settle();assert.equal(h.requests.length,0);assert.equal(h.control.isBusy(),false);assert.equal(h.stream.stops>=2,true);h.control.destroy();
  }
});
test('unexpected recorder stop releases tracks and busy state without transcribing',async()=>{
  const h=harness();h.button.fire('click',{detail:0});await settle();h.advance(1000);h.recorders[0].stop();await settle();assert.equal(h.control.isBusy(),false);assert.equal(h.requests.length,0);assert.equal(h.stream.stops>=2,true);assert.match(h.status.textContent,/interrumpió/);h.advance(45_000);assert.equal(h.requests.length,0);h.control.destroy();
});
test('stale permission/error callbacks cannot modify a newer recording',async()=>{
  const grants=[];const h=harness({permission:()=>new Promise(r=>grants.push(r))});h.button.fire('click',{detail:0});h.control.cancel();h.button.fire('click',{detail:0});grants[1](h.stream);await settle();assert.equal(h.recorders.length,1);grants[0](h.stream);await settle();assert.equal(h.recorders[0].state,'recording');assert.equal(h.control.isBusy(),true);h.control.cancel();h.control.destroy();
});
test('availability and chat guards avoid requesting a microphone; second pointers are ignored',async()=>{
  for(const options of [{available:false},{busy:true}]){const h=harness(options);h.button.fire('click',{detail:0});await settle();assert.equal(h.recorders.length,0);assert.equal(h.control.isBusy(),false);h.control.destroy();}
  const h=harness();h.button.fire('pointerdown',{button:0,isPrimary:false,pointerId:2});h.advance(500);await settle();assert.equal(h.recorders.length,0);h.control.destroy();
});
test('touch release retargeted to Cancel cannot abort transcription; an explicit control press can',async()=>{
  let resolve;const h=harness({api:()=>new Promise(r=>{resolve=r;})});h.down();h.advance(250);await settle();h.advance(1000);h.up();
  const cancel=h.button.next.children[1];cancel.fire('click',{detail:1,pointerId:1});assert.equal(h.requests[0].signal.aborted,false);
  cancel.fire('pointerdown',{button:0,isPrimary:true,pointerId:2});cancel.fire('click',{detail:1,pointerId:2});assert.equal(h.requests[0].signal.aborted,true);
  resolve({text:'No debe agregarse'});await settle();assert.equal(h.input.value,'');h.control.destroy();
});

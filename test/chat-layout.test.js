import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/chat-layout.js',import.meta.url),'utf8');
function setup(){
 let document,observer;
 class Surface{
  listeners=new Map();attributes={};hidden=false;open=false;inert=false;childElementCount=0;
  classList={values:new Set(),toggle(key,on){on?this.values.add(key):this.values.delete(key);}};
  addEventListener(name,fn){this.listeners.set(name,[...(this.listeners.get(name)||[]),fn]);}
  emit(name,event={}){for(const fn of this.listeners.get(name)||[])fn(event);}
  setAttribute(key,value){this.attributes[key]=value;}
  focus(){document.activeElement=this;}
  click(){this.emit('click',{target:this});}
  closest(){return null;}
  getClientRects(){return [1];}
  querySelector(){return this.summary;}
 }
 document=new Surface();document.body=new Surface();
 const elements=new Map(['#app-sidebar','main','#open-navigation','#close-navigation','#navigation-backdrop','#conversation','#assistant','#query'].map(key=>[key,new Surface()]));
 const mobile=new Surface();mobile.matches=true;
 const menus=[new Surface(),new Surface()];menus.forEach(menu=>menu.summary=new Surface());
 const first=new Surface(),last=new Surface();
 elements.get('#app-sidebar').querySelectorAll=()=>[first,last];
 document.querySelector=selector=>elements.get(selector);document.querySelectorAll=()=>menus;
 vm.runInNewContext(source,{document,window:{matchMedia:()=>mobile},MutationObserver:class{constructor(fn){observer=fn;}observe(){}}});
 const key=(key,extra={})=>{let prevented=false;document.emit('keydown',{key,preventDefault(){prevented=true;},...extra});return prevented;};
 return {document,mobile,menus,first,last,key,get:key=>elements.get(key),changed:()=>observer()};
}
test('mobile navigation blocks the background and Escape restores focus',()=>{
 const h=setup();h.get('#open-navigation').click();
 assert.equal(h.get('main').inert,true);assert.equal(h.get('#navigation-backdrop').hidden,false);
 assert.equal(h.document.activeElement,h.get('#close-navigation'));
 assert.equal(h.get('#open-navigation').attributes['aria-expanded'],'true');
 assert.equal(h.key('Escape'),true);
 assert.equal(h.get('main').inert,false);assert.equal(h.get('#navigation-backdrop').hidden,true);
 assert.equal(h.document.activeElement,h.get('#open-navigation'));
 assert.equal(h.get('#open-navigation').attributes['aria-expanded'],'false');
});
test('drawer traps Tab in both directions and backdrop closes it',()=>{
 const h=setup();h.get('#open-navigation').click();
 h.last.focus();assert.equal(h.key('Tab'),true);assert.equal(h.document.activeElement,h.first);
 assert.equal(h.key('Tab',{shiftKey:true}),true);assert.equal(h.document.activeElement,h.last);
 h.get('#navigation-backdrop').click();assert.equal(h.get('main').inert,false);
 assert.equal(h.document.activeElement,h.get('#open-navigation'));
});
test('returning to desktop clears mobile background blocking',()=>{
 const h=setup();h.get('#open-navigation').click();h.mobile.matches=false;h.mobile.emit('change');
 assert.equal(h.get('main').inert,false);assert.equal(h.get('#navigation-backdrop').hidden,true);
 assert.equal(h.document.body.classList.values.has('nav-open'),false);
});
test('Escape closes a secondary menu and restores its summary focus',()=>{
 const h=setup();h.menus[0].open=true;assert.equal(h.key('Escape'),true);
 assert.equal(h.menus[0].open,false);assert.equal(h.document.activeElement,h.menus[0].summary);
});
test('conversation changes replace the welcome state and reset restores it',()=>{
 const h=setup();assert.equal(h.get('#assistant').classList.values.has('has-conversation'),false);
 h.get('#conversation').childElementCount=2;h.changed();assert.equal(h.get('#assistant').classList.values.has('has-conversation'),true);
 h.get('#conversation').childElementCount=0;h.changed();assert.equal(h.get('#assistant').classList.values.has('has-conversation'),false);
});

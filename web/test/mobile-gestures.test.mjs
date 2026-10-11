import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
const code = (await build({entryPoints:['src/mobile-gestures.ts'], bundle:true, format:'esm', write:false})).outputFiles[0].text;
const {bindTouchSwipe, bindSheetDismiss, gestureControl, scrollerOwns} = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
let mobile = true, selection = '';
class Element {
  handlers = {}; style = {}; isConnected = true; parentElement = null;
  offsetHeight = 400; scrollTop = 0; scrollHeight = 100; clientHeight = 100; scrollWidth = 100; clientWidth = 100;
  closest(sel) { for(let el=this;el;el=el.parentElement){if(el.grab&&sel==='.grab'||el.control&&sel.includes('input')||el.tag&&sel.split(',').includes(el.tag)||el.role&&sel.includes('[role='+el.role+']'))return el;}return null; }
  addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
  emit(type, x = 0, y = 0, opts = {}) {
    const point = {identifier:1, clientX:x, clientY:y};
    const event = {target:this, touches:type === 'touchend' || type === 'touchcancel' ? [] : [point], changedTouches:[point], cancelable:true,
      prevented:false, preventDefault(){this.prevented=true;}, ...opts};
    for (const fn of this.handlers[type] || []) fn(event); return event;
  }
}
globalThis.Element = Element;
globalThis.window = {getSelection:()=>({toString:()=>selection}), visualViewport:{scale:1}};
globalThis.matchMedia = () => ({matches:mobile});
globalThis.getComputedStyle = el => ({overflowX:el.overflowX || 'visible', overflowY:el.overflowY || 'visible'});
function swipeSetup() {
  const el = new Element(), ends = [], moves = [];
  bindTouchSwipe(el, () => ({axis:'x', direction:1, distance:100, move:x=>moves.push(x), finish:x=>ends.push(x)}));
  return {el, ends, moves};
}
test('horizontal intent commits; small or diagonal drags and cancelled/multitouch gestures reset', () => {
  for (const scenario of ['commit','small','vertical','cancel','multi','reverse']) {
    const {el,ends,moves} = swipeSetup(); el.emit('touchstart',40,100);
    if (scenario === 'vertical') { assert.equal(el.emit('touchmove',45,160).prevented,false); el.emit('touchmove',180,170); }
    else { el.emit('touchmove',scenario === 'small' ? 65 : 180,100); if (scenario === 'multi') el.emit('touchstart',180,100,{touches:[{},{}]}); if (scenario === 'reverse') el.emit('touchmove',45,100); }
    el.emit(scenario === 'cancel' ? 'touchcancel' : 'touchend',180,100);
    assert.equal(ends.includes(true),scenario === 'commit',scenario);
    if (scenario === 'vertical') assert.equal(moves.length,0);
  }
});
test('desktop, page zoom, selected text, newly selected text, and uncancellable native scroll cannot navigate', () => {
  for (const scenario of ['desktop','zoom','selected','select-during','native-scroll']) {
    const {el,ends} = swipeSetup(); mobile=scenario !== 'desktop'; window.visualViewport.scale=scenario === 'zoom' ? 2 : 1; selection=scenario === 'selected' ? 'selected' : '';
    el.emit('touchstart',40,100); if(scenario === 'select-during') selection='selected';
    const move=el.emit('touchmove',190,100,{cancelable:scenario !== 'native-scroll'}); el.emit('touchend',190,100);
    assert.equal(move.prevented,false,scenario); assert.equal(ends.includes(true),false,scenario);
  }
  mobile=true; selection=''; window.visualViewport.scale=1;
});
test('compatibility click from swipe is blocked but an immediate new touch tap works', () => {
  const {el}=swipeSetup();el.emit('touchstart',40,100);el.emit('touchmove',180,100);el.emit('touchend',180,100);
  assert.equal(el.emit('click',0,0,{detail:1,stopImmediatePropagation(){}}).prevented,true);
  el.emit('touchstart',50,50);el.emit('touchend',50,50);
  assert.equal(el.emit('click',0,0,{detail:1,stopImmediatePropagation(){}}).prevented,false);
});
test('shared sheet helper preserves nested scrolling and controls; handle overrides nested scroll; cancel restores styles', () => {
  for (const scenario of ['nested','horizontal-scroll','control','handle','cancel','down','up-first']) {
    const el = new Element(), child=new Element(); child.parentElement=el;
    if(scenario === 'nested' || scenario === 'handle') { child.overflowY='auto'; child.scrollHeight=600; child.scrollTop=100; }
    if(scenario === 'horizontal-scroll') { child.overflowX='auto'; child.scrollWidth=600; }
    child.grab=scenario === 'handle'; child.control=scenario === 'control';
    let closed=0; bindSheetDismiss(el,()=>closed++); el.emit('touchstart',180,100,{target:child});
    if(scenario === 'up-first') el.emit('touchmove',180,70);
    const move=el.emit('touchmove',180,250); el.emit(scenario === 'cancel' ? 'touchcancel' : 'touchend',180,250);
    assert.equal(closed,scenario === 'handle' || scenario === 'down' ? 1 : 0,scenario);
    assert.equal(move.prevented,['handle','cancel','down'].includes(scenario),scenario);
    assert.ok(!el.style.transform && !el.style.transition,scenario);
  }
});
test('actual file-viewer touch handlers preserve image navigation but reject cancel, pinch, zoom and controls', async () => {
  const src=await readFile('src/v3.ts','utf8');
  const start=src.indexOf('  // Phone: swipe left/right between files');
  const handlers=src.slice(start,src.indexOf('\n}\n// ---------- New task',start))
    .replaceAll(' as HTMLElement','').replaceAll('<HTMLElement>','');
  for(const scenario of ['close','next','cancel','multi','control','zoom','desktop','nested-scroll']) {
    const doc=new Element(), body=new Element();body.closest=function(sel){return sel==='#fv .fvbody'?this:Element.prototype.closest.call(this,sel);};
    body.control=scenario==='control';if(scenario==='nested-scroll'){body.overflowY='auto';body.scrollHeight=500;body.scrollTop=40;}
    const state={i:0,list:[{kind:'image'},{kind:'image'}],zoom:scenario==='zoom'?2:1};let closed=0,painted=0;
    new Function('document','phone','gestureControl','scrollerOwns','FVS','fvKind','fvPaint','closeFile',handlers)(doc,()=>scenario!=='desktop',gestureControl,scrollerOwns,state,f=>f.kind,()=>painted++,()=>closed++);
    doc.emit('touchstart',150,100,{target:body});
    if(scenario==='multi')doc.emit('touchmove',150,150,{target:body,touches:[{},{}]});
    if(scenario==='cancel')doc.emit('touchcancel',150,220,{target:body});
    doc.emit('touchend',scenario==='next'?30:150,scenario==='next'?100:240,{target:body});
    assert.equal(closed,scenario==='close'?1:0,scenario);assert.equal(painted,scenario==='next'?1:0,scenario);
  }
});
test('sheet action buttons/anchors and their labels can pull down; inputs and value controls cannot', () => {
  for(const [tag,role,allowed]of [['button','',true],['a','',true],['div','button',true],['input','',false],['textarea','',false],['button','radio',false],['div','slider',false],['button','switch',false],['video','',false]]){
    const el=new Element(),row=new Element(),label=new Element();row.tag=tag;row.role=role;row.parentElement=el;label.parentElement=row;
    let closed=0;bindSheetDismiss(el,()=>closed++);el.emit('touchstart',150,100,{target:label});const move=el.emit('touchmove',150,280,{target:label});el.emit('touchend',150,280,{target:label});
    assert.equal(closed,allowed?1:0,tag+role);assert.equal(move.prevented,allowed,tag+role);
    if(allowed)assert.equal(gestureControl(label),true,'Settings back and file-viewer guards must still reject action rows');
  }
});

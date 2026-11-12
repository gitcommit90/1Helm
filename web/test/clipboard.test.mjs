import assert from 'node:assert/strict';import {build} from 'esbuild';
const r=await build({entryPoints:['src/clipboard.ts'],bundle:true,format:'esm',write:false});
const {copyText}=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
const fakeDoc=(exec)=>{const calls={exec:0,appended:0,removed:0};
 const mkEl=()=>({style:{},setAttribute(){},focus(){},select(){},setSelectionRange(){},remove(){calls.removed++},value:''});
 const body={appendChild(){calls.appended++}};
 globalThis.document={body,activeElement:null,createElement:mkEl,execCommand:()=>{calls.exec++;return exec()}};
 globalThis.window={getSelection:()=>null};return calls};
const setNav=c=>Object.defineProperty(globalThis,'navigator',{value:{clipboard:c},configurable:true});
// 1. clipboard works: no textarea, and the call starts synchronously
let got=[];setNav({writeText:async t=>{got.push(t)}});let c=fakeDoc(()=>true);
const p=copyText('abc');assert.deepEqual(got,['abc'],'writeText is called before the first await');assert.equal(await p,true);assert.equal(c.exec,0);
// 2. clipboard rejects: the copy command is used
setNav({writeText:async()=>{throw new Error('NotAllowedError')}});c=fakeDoc(()=>true);
assert.equal(await copyText('abc'),true);assert.equal(c.exec,1);assert.equal(c.removed,1);
// 3. no clipboard object at all
setNav(undefined);c=fakeDoc(()=>true);assert.equal(await copyText('abc'),true);assert.equal(c.exec,1);
// 4. both fail
setNav({writeText:async()=>{throw new Error('no')}});c=fakeDoc(()=>false);assert.equal(await copyText('abc'),false);
c=fakeDoc(()=>{throw new Error('boom')});assert.equal(await copyText('abc'),false);assert.equal(c.removed,1);
// 5. wrapper plugin is the last resort
let plug=null;globalThis.Capacitor={Plugins:{Clipboard:{write:async o=>{plug=o.string}}}};c=fakeDoc(()=>false);
assert.equal(await copyText('xyz'),true);assert.equal(plug,'xyz');delete globalThis.Capacitor;
// 6. html copy: rich write used, and plain text is retried when it is refused
let rich=0,plain=[];globalThis.ClipboardItem=class{constructor(o){this.o=o}};
setNav({write:async()=>{rich++},writeText:async t=>{plain.push(t)}});c=fakeDoc(()=>false);assert.equal(await copyText('p','<b>p</b>'),true);assert.equal(rich,1);assert.equal(plain.length,0);
setNav({write:async()=>{throw new Error('no')},writeText:async t=>{plain.push(t)}});assert.equal(await copyText('p','<b>p</b>'),true);assert.deepEqual(plain,['p']);
console.log('clipboard helper: sync start, fallback to copy command, plugin, rich html and failure cases passed.');

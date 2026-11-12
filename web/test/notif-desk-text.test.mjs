// The Mac app's notification says what the phone push says (notify.js): the reply line for "finished", the reason for "needs you".
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({entryPoints:['src/notif.ts'],bundle:true,format:'esm',write:false});
const code='data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64');
const ls=new Map();
Object.assign(globalThis,{window:{},localStorage:{getItem:k=>ls.get(k)??null,setItem:(k,v)=>ls.set(k,String(v)),removeItem:k=>ls.delete(k)},matchMedia:()=>({matches:false}),
  document:{addEventListener(){},visibilityState:'visible',hasFocus:()=>true},location:{hash:'',href:'https://x/',origin:'https://x',pathname:'/'},addEventListener(){},removeEventListener(){}});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Mac',platform:'Mac',maxTouchPoints:0}});
const M=await import(code);
assert.deepEqual(M.deskText('finished','Ollie',{title:'Plan trip',notif_body:'I found three flights under $400.'}),{title:'Finished: Plan trip',body:'I found three flights under $400.'});
assert.deepEqual(M.deskText('finished','Ollie',{title:'Plan trip'}),{title:'Finished: Plan trip',body:'Ollie is done. Take a look.'});
assert.deepEqual(M.deskText('needs','Ollie',{title:'Plan trip',notif_why:'has a question for you'}),{title:'Ollie has a question for you',body:'Plan trip'});
assert.deepEqual(M.deskText('needs','Ollie',{}),{title:'Ollie needs you',body:'your task'});
assert.equal(M.deskText('finished','O',{title:'x',notif_body:'a'.repeat(300)}).body.length,140);
console.log('notif-desk-text: all ok');process.exit(0);

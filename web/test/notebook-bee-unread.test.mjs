import assert from 'node:assert/strict';import {build} from 'esbuild';
const result=await build({entryPoints:['src/ee/notebook-bee-unread.ts'],bundle:true,format:'esm',write:false});const {notebookBeeUnread}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)},facts=[{id:1,at:100,text:'Private fact never persisted'},{id:2,at:200}];
let seen=notebookBeeUnread('account-a','main',storage);assert.equal(seen.unread(),false);seen.update(facts);assert.equal(seen.unread(),true);seen.visit();assert.equal(seen.unread(),false);assert.equal(facts.length,2);assert.equal(facts[0].text,'Private fact never persisted');assert.ok([...data.values()].every(v=>!v.includes('Private')));
seen=notebookBeeUnread('account-a','main',storage);seen.update([...facts].reverse());assert.equal(seen.unread(),false,'same cards remain seen after reload/order changes');seen.update([...facts,{id:3,at:300}]);assert.equal(seen.unread(),true);seen.visit();seen.update(null);assert.equal(seen.unread(),false,'disconnected clears badge');seen.update([...facts,{id:3,at:300}]);assert.equal(seen.unread(),false,'reconnecting same cards does not undo seen');
for(const [account,channel] of [['account-b','main'],['account-a','other']]){const isolated=notebookBeeUnread(account,channel,storage);isolated.update(facts);assert.equal(isolated.unread(),true)}
seen.update([{id:1,at:101}]);assert.equal(seen.unread(),true,'changed version can notify again');
for(let batch=0;batch<12;batch++){seen.update(Array.from({length:200},(_,i)=>({id:1000+batch*200+i,at:1})));seen.visit()}
const saved=JSON.parse(data.get('1hc-notebook-bee-seen:account-a:main'));assert.equal(saved.length,2000);assert.ok(saved.includes('3399:1'),'current waiting card retained');
const blocked=notebookBeeUnread('blocked','main',{getItem(){throw Error()},setItem(){throw Error()}});blocked.update(facts);blocked.visit();assert.equal(blocked.unread(),false);
const corrupt=notebookBeeUnread('bad','main',{getItem:()=>'{bad',setItem(){}});corrupt.update(facts);assert.equal(corrupt.unread(),true);
console.log('Bee notebook unread: persisted seen IDs, new/versioned cards, connection gating, account/channel isolation, cap, blocked storage and no card mutation passed.');

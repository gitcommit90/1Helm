import assert from 'node:assert/strict';import {build} from 'esbuild';
// The Browser exit node switch and picker in Settings, Computer connections (src/computer-network.ts): off by default, needs a connected Tailscale and one exit node,
// one status line from the server, applies the pick at once while on. The server is a fake; no network.
const result=await build({entryPoints:['src/computer-network.ts'],bundle:true,format:'esm',write:false});
globalThis.window={addEventListener(){}};globalThis.document={addEventListener(){},visibilityState:'visible',hasFocus:()=>true};
const mod=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
const exit=(over={})=>({setting:'off',tailscale:'connected',exit_node:null,state:'off',can_enable:true,line:"Off. The browser uses this computer's own connection.",...over});
const status=(be,tail='connected')=>({available:true,permission:'deny',key:null,sessions:[],client:{state:'sleeping'},tailscale:{state:tail},browser_exit:be});
const requests=[];let html='';
const render=()=>{mod.networkVisible(true);html=mod.networkHtml()};
mod.networkInit({api:(path,body)=>new Promise((resolve,reject)=>requests.push({path,body,resolve,reject})),channels:()=>[{slug:'main',name:'General'}],current:()=>'main',render,note(){},ask:async()=>true,esc:s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))});
const click=op=>mod.networkClick({closest:s=>s==='[data-netop]'?{dataset:{netop:op},disabled:false}:null});
const pick=id=>mod.networkChange({matches:s=>s==='[data-netexit-node]',value:id});
const answer=async(i,v)=>{requests[i].resolve(v);await flush()};
render();assert.equal(requests[0].path,'/res/main/network');await answer(0,status(exit()));
// Connected Tailscale: the switch is off, the node list is requested once, nothing else is sent.
assert.match(html,/Browser exit node for #General/);assert.match(html,/role="switch" aria-checked="false"[^>]*data-netop="exit_toggle"/);assert.match(html,/Off\. The browser uses this computer's own connection\./);
assert.equal(requests[1].body.op,'exit_nodes');await answer(1,{ok:true,nodes:[{id:'n-home',name:'home',online:true},{id:'n-nas',name:'nas',online:false}]});
for(let i=0;i<5;i++)render();assert.equal(requests.length,2,'repaints never reload the device list');
assert.match(html,/<option value="n-home">home<\/option>/);assert.match(html,/nas \(offline\)/);assert.doesNotMatch(html,/data-netop="exit_toggle" disabled/);
// Turning it on without a pick sends nothing and says what to do.
click('exit_toggle');await flush();assert.equal(requests.length,2);assert.match(html,/Choose one of your exit nodes first\./);
// Picking while off only remembers the pick; the switch then sends it.
pick('n-home');assert.equal(requests.length,2);click('exit_toggle');await flush();
assert.deepEqual(requests[2].body,{op:'browser_exit_set',enabled:true,node_id:'n-home'});
await answer(2,{ok:true,...exit({setting:'on',exit_node:{id:'n-home',name:'home'},state:'ready',line:'On. Browser traffic leaves through home.'})});
assert.match(html,/aria-checked="true"/);assert.match(html,/On\. Browser traffic leaves through home\./);assert.doesNotMatch(html,/Choose one of your exit nodes/);
// While on, a different pick moves the browser at once.
pick('n-nas');await flush();assert.deepEqual(requests[3].body,{op:'browser_exit_set',enabled:true,node_id:'n-nas'});
await answer(3,{ok:false,error:'The exit node nas is offline.',...exit({setting:'on',exit_node:{id:'n-home',name:'home'},state:'ready',line:'On. Browser traffic leaves through home.'})});
assert.match(html,/role="alert">The exit node nas is offline\./);
// Off again.
click('exit_toggle');await flush();assert.deepEqual(requests[4].body,{op:'browser_exit_set',enabled:false,node_id:'n-home'});
await answer(4,{ok:true,...exit({exit_node:{id:'n-home',name:'home'},line:"Off. The browser uses this computer's own connection. Last choice: home."})});
assert.match(html,/aria-checked="false"/);
// Without a connected Tailscale the switch and the picker are disabled and the server's line explains why; the list is never requested.
mod.networkVisible(false);mod.networkVisible(true);const before=requests.length;html=mod.networkHtml();await answer(before,status(exit({tailscale:'not_connected',can_enable:false,line:'Off. Connect Tailscale first to send browser traffic through one of your own devices.'}),'disconnected'));
assert.match(html,/data-netop="exit_toggle" disabled/);assert.match(html,/<select data-netexit-node[^>]* disabled/);assert.match(html,/Connect Tailscale first/);assert.equal(requests.length,before+1,'no device list request without Tailscale');
console.log('Browser exit node settings: switch, picker, status line, pick applied while on, disabled without Tailscale passed.');

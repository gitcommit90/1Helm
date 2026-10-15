import assert from 'node:assert/strict';
import {build} from 'esbuild';
globalThis.document={addEventListener(){},getElementById(){return null}};   // pmInit() listens for input events
const bundled=await build({entryPoints:['src/perms.ts'],bundle:true,format:'esm',write:false});
const P=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const tick=()=>new Promise(r=>setTimeout(r,0)),esc=s=>String(s).replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
// A legacy stored Trusted account is normalized by the backend to Standard.
let server={level:'standard',levels:['standard','careful','locked'].map(id=>({id,name:id,sub:id})),kinds:[{id:'personal',name:'Fill personal details',level:'standard'},{id:'email',name:'Read email',level:'careful'},{id:'browser',name:'Visit websites',level:'locked'}],direct_protocols:{ssh:'deny'},allowed:[],sites:[]};
const posts=[],notes=[];let fail=false,mismatch=false;
P.pmInit({esc,helper:()=>'<Agent>',rerender(){},note:(...n)=>notes.push(n),icon:()=>'',logoOver:()=>'',srow:(_,title,sub,right)=>`<section>${title} ${sub} ${right}</section>`,sa:(label,attr)=>`<button ${attr}>${label}</button>`,ask:async()=>{throw new Error('No Trusted opt-in dialog remains')},api:async(path,body)=>{assert.equal(path,'/permissions');if(body){posts.push(body);if(fail)return{error:'fixture save failed'};if(body.level&&!mismatch)server.level=body.level;if(body.agent_checkins)server.agent_checkins={enabled:false,silent:50,fast:20,...server.agent_checkins,...body.agent_checkins};if(body.revoke)server.allowed=server.allowed.filter(a=>a.kind!==body.revoke);if(body.revoke_site)server.sites=[];}return structuredClone(server)}});
const click=(key,value)=>P.pmClick({closest:selector=>selector===`[data-${key}]`?{dataset:{[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:value}}:null});
P.pmHtml();await tick();
assert.match(P.pmHtml(),/aria-checked="true" data-pmlevel="standard"/);assert.doesNotMatch(P.pmHtml(),/data-pmlevel="trusted"|spend money|without each action prompt/);assert.match(P.pmHtml(),/Saved “Always allowed” exceptions still apply/);
click('pmlevel','trusted');click('pmlevel','unknown');await tick();assert.equal(posts.length,0,'withdrawn/unknown presets cannot POST');
click('pmlevel','careful');await tick();assert.deepEqual(posts.at(-1),{level:'careful'});assert.match(P.pmHtml(),/pmk[^>]*>Read email/);assert.doesNotMatch(P.pmHtml(),/pmk[^>]*>Visit websites/);
fail=true;click('pmlevel','locked');await tick();assert.match(P.pmHtml(),/aria-checked="true" data-pmlevel="careful"/);assert.equal(notes.at(-1)[0],"Couldn't change that");fail=false;mismatch=true;click('pmlevel','locked');await tick();assert.match(notes.at(-1)[1],/server did not confirm/);assert.match(P.pmHtml(),/aria-checked="true" data-pmlevel="careful"/);mismatch=false;
click('pmlevel','locked');await tick();assert.match(P.pmHtml(),/pmk[^>]*>Visit websites/);click('pmlevel','standard');await tick();assert.match(notes.at(-1)[1],/Saved “Always allowed” exceptions still apply/);
server.allowed=[{kind:'email',name:'Read email',at:1},{kind:'personal',name:'Fill personal details',at:1}];server.sites=[{channel:'main',channel_name:'Main',id:7,host:'example.test',at:1}];click('pmlevel','careful');await tick();click('pmlevel','standard');await tick();
click('pmrevoke','email');await tick();assert.match(notes.at(-1)[1],/permission level still permits/);assert.doesNotMatch(notes.at(-1)[1],/will ask/);click('pmrevoke','personal');await tick();assert.match(notes.at(-1)[1],/will ask before/);click('pmsite','main|7');await tick();assert.match(notes.at(-1)[1],/Future requests follow/);
assert.match(P.pmHtml(),/aria-checked="true" data-pmssh="deny"/);assert.ok(posts.every(p=>!p.direct_protocols),'presets never modify SSH permission');
// Agent check-ins: an on/off switch, off by default; the numbers show only when it is on, starting at 50 and 20.
assert.match(P.pmHtml(),/aria-checked="false" aria-label="Agent check-ins" data-pmcheckswitch/);assert.doesNotMatch(P.pmHtml(),/data-pmcheckinput/);
click('pmcheckswitch','');await tick();assert.deepEqual(posts.at(-1),{agent_checkins:{enabled:true}});
assert.match(P.pmHtml(),/aria-checked="true" aria-label="Agent check-ins" data-pmcheckswitch/);assert.match(P.pmHtml(),/data-pmcheckinput="silent"[^>]*value="50"/);assert.match(P.pmHtml(),/data-pmcheckinput="fast"[^>]*value="20"/);
assert.doesNotMatch(P.pmHtml(),/Defaults: 15/);
click('pmcheckswitch','');await tick();assert.deepEqual(posts.at(-1),{agent_checkins:{enabled:false}});assert.doesNotMatch(P.pmHtml(),/data-pmcheckinput/);
console.log('Permissions UI: withdrawn Trusted, normalized Standard display, exact server acknowledgment, error rollback, asks lists, exceptions and SSH independence passed.');

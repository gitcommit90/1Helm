// node --import ./test/stubs/register.mjs test/agent-checkins.test.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Resident } from '../src/resident.js'; // initialize existing Resident/spendguard module cycle in production order
import { CHECKIN_DEFAULTS, loadCheckins, normalizeCheckins, checkinPatchOk, saveCheckins } from '../src/agent-checkins.js';
import { permsApi } from '../src/perms.js';
import { guardTools, guardResume, newWatch, spendMix, TURN_SOFT, TURN_HARD } from '../src/spendguard.js';
import { guardOut, guardIn } from '../src/resume.js';
const db = new DatabaseSync(':memory:');
for (const file of ['fixtures/migrations/migrations_028_permissions.sql', 'fixtures/migrations/migrations_051_agent_checkins.sql', 'fixtures/migrations/migrations_065_checkin_enabled.sql']) db.exec(readFileSync(new URL('./'+file, import.meta.url), 'utf8'));
const DB = { prepare(q) { const stmt = db.prepare(q); let args=[]; const st={bind(...a){args=a;return st;},async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){return stmt.run(...args);}};return st;} };
const env={DB};
assert.deepEqual(await loadCheckins(env,'new'),CHECKIN_DEFAULTS);
assert.deepEqual(await loadCheckins({},'existing'),CHECKIN_DEFAULTS);
assert.deepEqual(normalizeCheckins({silent:'30',fast:NaN}),CHECKIN_DEFAULTS);
assert.deepEqual(CHECKIN_DEFAULTS,{enabled:false,silent:50,fast:20},'off by default; 50 tool calls before the first update, 20 within 60 seconds');
assert.equal(normalizeCheckins({enabled:'yes'}).enabled,false);assert.equal(normalizeCheckins({enabled:true}).enabled,true);
for(const invalid of [null,[],{}, {silent:0},{fast:1001},{silent:1.2},{fast:Infinity},{silent:'15'},{silent:true},{silent:15,unknown:20},{enabled:'on'},{enabled:1},{enabled:null}]) assert.equal(checkinPatchOk(invalid),false,JSON.stringify(invalid));
assert.equal(checkinPatchOk({enabled:true}),true);assert.equal(checkinPatchOk({enabled:false,silent:9,fast:9}),true);
// existing accounts: a row saved before the switch (enabled NULL) holds chosen numbers, so it stays on; no row is off
db.exec("INSERT INTO agent_checkin_prefs (tenant_id,silent,fast,updated_at) VALUES ('legacy',15,20,1)");
assert.deepEqual(await loadCheckins(env,'legacy'),{enabled:true,silent:15,fast:20},'an old row stays on with its own values');
await saveCheckins(env,'tenant-sw',{enabled:true});
assert.deepEqual(await loadCheckins(env,'tenant-sw'),{enabled:true,silent:50,fast:20},'turning it on uses 50 and 20');
await saveCheckins(env,'tenant-sw',{enabled:false});
assert.deepEqual(await loadCheckins(env,'tenant-sw'),{enabled:false,silent:50,fast:20},'turning it off keeps the numbers');
await saveCheckins(env,'tenant-sw',{enabled:true,silent:9});
assert.deepEqual(await loadCheckins(env,'tenant-sw'),{enabled:true,silent:9,fast:20});
await saveCheckins(env,'tenant-a',{silent:31});
assert.deepEqual(await loadCheckins(env,'tenant-a'),{enabled:true,silent:31,fast:20});
await saveCheckins(env,'tenant-a',{fast:44});
assert.deepEqual(await loadCheckins(env,'tenant-a'),{enabled:true,silent:31,fast:44});
assert.deepEqual(await loadCheckins(env,'tenant-b'),CHECKIN_DEFAULTS);
const api=async(body,origin='https://owner.example.com')=>permsApi(new Request('https://owner.example.com/api/permissions',body===undefined?{}:{method:'POST',headers:{origin},body:JSON.stringify(body)}),env,{id:'tenant-a'},{channels:async()=>[]});
assert.equal((await api({agent_checkins:{fast:0}})).status,400);
assert.equal((await api({agent_checkins:{fast:4}},'https://attacker.example')).status,403);
assert.deepEqual((await (await api({agent_checkins:{enabled:false}})).json()).agent_checkins,{enabled:false,silent:31,fast:44},'the switch saves through the API and keeps the numbers');
assert.equal((await api({agent_checkins:{enabled:'true'}})).status,400);
assert.deepEqual((await (await api({agent_checkins:{enabled:true}})).json()).agent_checkins,{enabled:true,silent:31,fast:44});
assert.deepEqual((await (await api({agent_checkins:{fast:7}})).json()).agent_checkins,{enabled:true,silent:31,fast:7});
assert.deepEqual((await (await api()).json()).agent_checkins,{enabled:true,silent:31,fast:7});
class TestResident { constructor(){this.env=env;} get(){return 'tenant-a';} ledger(){return {};} }
spendMix(TestResident);
const resident=new TestResident(),tc={kind:'chat'};
await resident.spendStart(tc);clearTimeout(tc.guard.wallT);
assert.deepEqual(tc.guard.checkins,{enabled:true,silent:31,fast:7});assert.equal(tc.guard.soft,TURN_SOFT);assert.equal(tc.guard.hard,TURN_HARD);
await saveCheckins(env,'tenant-a',{enabled:true,silent:8,fast:9});
const restored={guard:guardIn(guardOut(tc.guard))};guardResume(restored,Date.now());clearTimeout(restored.guard.wallT);
assert.deepEqual(restored.guard.checkins,{enabled:true,silent:31,fast:7},'resumed turn retains the exact persisted thresholds');
const next={kind:'chat'};await resident.spendStart(next);clearTimeout(next.guard.wallT);assert.deepEqual(next.guard.checkins,{enabled:true,silent:8,fast:9},'new/continued turn uses saved changes');
const old={guard:{watch:newWatch()}};guardResume(old,Date.now());clearTimeout(old.guard.wallT);assert.deepEqual(old.guard.checkins,CHECKIN_DEFAULTS);
const call=i=>['run_command',{command:`task_${i}`}];
function watch(checkins,said=false){return {guard:{checkins:{enabled:true,...checkins},watch:{...newWatch(),said}}};}
for(const reason of ['silent','fast']){
  const t=watch({silent:reason==='silent'?3:1000,fast:reason==='fast'?4:1000},reason==='fast');
  const n=reason==='silent'?3:4;
  for(let i=0;i<n-1;i++){guardTools(t,[call(i)],100000+i);assert.equal(t.pause,undefined);}
  guardTools(t,[call(n)],100005);assert.equal(t.pause.reason,reason);
}
const rolling=watch({silent:1000,fast:2},true);guardTools(rolling,[call(1)],0);guardTools(rolling,[call(2)],60001);assert.equal(rolling.pause,undefined);guardTools(rolling,[call(3)],60002);assert.equal(rolling.pause.reason,'fast');
const quiet=watch({silent:1,fast:1});guardTools(quiet,[['read_doc',{path:'a'}],['read_skill',{slug:'b'}]],10);assert.equal(quiet.pause,undefined);
const communicated=watch({silent:1,fast:1000});guardTools(communicated,[['react',{}]],10);assert.equal(communicated.pause,undefined);
const off=watch({enabled:false,silent:1,fast:1});guardTools(off,[call(1),call(2),call(3)],10);assert.equal(off.pause,undefined,'switched off: no check-in');
const offSpend=watch({silent:2,fast:1000});offSpend.spendPauses=false;guardTools(offSpend,[call(1)],10);assert.equal(offSpend.pause,undefined);guardTools(offSpend,[call(2)],11);assert.equal(offSpend.pause.reason,'silent','check-ins work with the spending pauses off');
console.log('PASS check-in defaults, independent persisted settings, strict validation, tenant isolation, same-origin API, actual guard and checkpoint/resume');

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
for (const file of ['fixtures/migrations/migrations_028_permissions.sql', 'fixtures/migrations/migrations_051_agent_checkins.sql']) db.exec(readFileSync(new URL('./'+file, import.meta.url), 'utf8'));
const DB = { prepare(q) { const stmt = db.prepare(q); let args=[]; const st={bind(...a){args=a;return st;},async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){return stmt.run(...args);}};return st;} };
const env={DB};
assert.deepEqual(await loadCheckins(env,'new'),CHECKIN_DEFAULTS);
assert.deepEqual(await loadCheckins({},'existing'),CHECKIN_DEFAULTS);
assert.deepEqual(normalizeCheckins({silent:'30',fast:NaN}),CHECKIN_DEFAULTS);
for(const invalid of [null,[],{}, {silent:0},{fast:1001},{silent:1.2},{fast:Infinity},{silent:'15'},{silent:true},{silent:15,unknown:20}]) assert.equal(checkinPatchOk(invalid),false,JSON.stringify(invalid));
await saveCheckins(env,'tenant-a',{silent:31});
assert.deepEqual(await loadCheckins(env,'tenant-a'),{silent:31,fast:20});
await saveCheckins(env,'tenant-a',{fast:44});
assert.deepEqual(await loadCheckins(env,'tenant-a'),{silent:31,fast:44});
assert.deepEqual(await loadCheckins(env,'tenant-b'),CHECKIN_DEFAULTS);
const api=async(body,origin='https://owner.example.com')=>permsApi(new Request('https://owner.example.com/api/permissions',body===undefined?{}:{method:'POST',headers:{origin},body:JSON.stringify(body)}),env,{id:'tenant-a'},{channels:async()=>[]});
assert.equal((await api({agent_checkins:{fast:0}})).status,400);
assert.equal((await api({agent_checkins:{fast:4}},'https://attacker.example')).status,403);
assert.deepEqual((await (await api({agent_checkins:{fast:7}})).json()).agent_checkins,{silent:31,fast:7});
assert.deepEqual((await (await api()).json()).agent_checkins,{silent:31,fast:7});
class TestResident { constructor(){this.env=env;} get(){return 'tenant-a';} ledger(){return {};} }
spendMix(TestResident);
const resident=new TestResident(),tc={kind:'chat'};
await resident.spendStart(tc);clearTimeout(tc.guard.wallT);
assert.deepEqual(tc.guard.checkins,{silent:31,fast:7});assert.equal(tc.guard.soft,TURN_SOFT);assert.equal(tc.guard.hard,TURN_HARD);
await saveCheckins(env,'tenant-a',{silent:8,fast:9});
const restored={guard:guardIn(guardOut(tc.guard))};guardResume(restored,Date.now());clearTimeout(restored.guard.wallT);
assert.deepEqual(restored.guard.checkins,{silent:31,fast:7},'resumed turn retains the exact persisted thresholds');
const next={kind:'chat'};await resident.spendStart(next);clearTimeout(next.guard.wallT);assert.deepEqual(next.guard.checkins,{silent:8,fast:9},'new/continued turn uses saved changes');
const old={guard:{watch:newWatch()}};guardResume(old,Date.now());clearTimeout(old.guard.wallT);assert.deepEqual(old.guard.checkins,CHECKIN_DEFAULTS);
const call=i=>['run_command',{command:`task_${i}`}];
function watch(checkins,said=false){return {guard:{checkins,watch:{...newWatch(),said}}};}
for(const reason of ['silent','fast']){
  const t=watch({silent:reason==='silent'?3:1000,fast:reason==='fast'?4:1000},reason==='fast');
  const n=reason==='silent'?3:4;
  for(let i=0;i<n-1;i++){guardTools(t,[call(i)],100000+i);assert.equal(t.pause,undefined);}
  guardTools(t,[call(n)],100005);assert.equal(t.pause.reason,reason);
}
const rolling=watch({silent:1000,fast:2},true);guardTools(rolling,[call(1)],0);guardTools(rolling,[call(2)],60001);assert.equal(rolling.pause,undefined);guardTools(rolling,[call(3)],60002);assert.equal(rolling.pause.reason,'fast');
const quiet=watch({silent:1,fast:1});guardTools(quiet,[['read_doc',{path:'a'}],['read_skill',{slug:'b'}]],10);assert.equal(quiet.pause,undefined);
const communicated=watch({silent:1,fast:1000});guardTools(communicated,[['react',{}]],10);assert.equal(communicated.pause,undefined);
console.log('PASS check-in defaults, independent persisted settings, strict validation, tenant isolation, same-origin API, actual guard and checkpoint/resume');

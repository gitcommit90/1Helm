// node --import ./test/stubs/register.mjs test/spend-preferences.test.mjs
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../src/index.js';
import {accountRoute} from '../src/account.js';
import {applySpendPreference,readSpendPreference} from '../src/spend-preferences.js';
import {guardCall,guardModel,guardTools,newWatch} from '../src/spendguard.js';
const dbs=[];
function ledger(){const db=new DatabaseSync(':memory:');dbs.push(db);const sql={exec(q,...a){if(!a.length&&q.split(';').filter(x=>x.trim()).length>1){db.exec(q);return {toArray:()=>[]};}const st=db.prepare(q),rows=/^\s*(SELECT|WITH|PRAGMA)/i.test(q)?st.all(...a):(st.run(...a),[]);return{toArray:()=>rows,one:()=>rows[0]};}};return new Ledger({storage:{sql,transactionSync:f=>f()}},{});}
const a=ledger(),b=ledger();
assert.deepEqual(a.spendPreferences(),{enabled:false},'off by default');assert.deepEqual(b.spendPreferences(),{enabled:false});assert.equal(await readSpendPreference({}),true);
assert.equal(await readSpendPreference(a),false,'a new account is off');
// day limit does not apply while it is off
await a.grant('included',20e9,'included');await a.setDayCapTest(1);assert.equal((await a.reserve('default-off',100)).ok,true);await a.settle('default-off',100);
a.setSpendPreferences(true);b.setSpendPreferences(true);assert.equal(a.guardKv('spend_pauses'),'on');
assert.equal((await a.reserve('on',100)).reason,'day_limit');
a.setSpendPreferences(false);assert.equal(b.spendPreferences().enabled,true);assert.equal(a.spendPreferences().enabled,false);
assert.equal((await a.reserve('off',100)).ok,true);await a.settle('off',100);
assert.equal((await a.reserve('actual-balance',21e9)).reason,'out_of_credits');
assert.equal(a.usageNotice(),null);a.guardKv('notice_pending',JSON.stringify({level:80}));assert.equal(a.noticePending(),null);
a.setSpendPreferences(true);assert.equal((await a.reserve('on-again',100)).reason,'day_limit');
for(const bad of [null,0,1,'false',undefined])assert.throws(()=>a.setSpendPreferences(bad));
const env={LEDGER:{idFromName:x=>x,get:id=>id==='tenant:a'?a:b}};
const url=new URL('https://owner.example.com/w/a/api/account/spend-pauses');
const api=async(body,{origin=url.origin,method=body===undefined?'GET':'POST',tenant='a',ct='application/json'}={})=>accountRoute(new Request(url,{method,headers:{origin,'content-type':ct},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{id:tenant},{id:'owner'},url,'/api/account/spend-pauses');
assert.equal((await api({enabled:false},{origin:'https://attacker.example'})).status,403);
assert.equal((await api({enabled:false},{ct:'text/plain'})).status,403);
for(const bad of [null,{},[],{enabled:'false'},{enabled:0},{enabled:false,tenant:'b'}])assert.equal((await api(bad)).status,400);
assert.deepEqual(await(await api({enabled:false})).json(),{enabled:false});assert.deepEqual(await(await api()).json(),{enabled:false});assert.deepEqual(await(await api(undefined,{tenant:'b'})).json(),{enabled:true});assert.deepEqual(await(await api({enabled:true})).json(),{enabled:true});
assert.equal((await api(undefined,{method:'DELETE'})).status,405);
const tc={kind:'chat',charged:5e9,guard:{soft:1,hard:1,dayLine:1,dayBase:100,watch:newWatch()}};
applySpendPreference(tc,false);guardCall(tc);guardModel(tc,{charge:10e9},'',true,[]);
for(let i=0;i<30;i++)guardTools(tc,[['run_command',{command:'repeat'}]]);
assert.equal(tc.pause,undefined);assert.equal(tc.charged,5e9);
tc.pause={reason:'budget'};tc.abort='soft';tc.limitWhy='cost';applySpendPreference(tc,false);assert.equal(tc.abort,null);assert.equal(tc.pause,null);
tc.abort='hard';tc.stoppedTurn=true;applySpendPreference(tc,false);assert.equal(tc.abort,'hard');assert.equal(tc.stoppedTurn,true);
tc.abort=null;applySpendPreference(tc,true);assert.throws(()=>guardCall(tc),/spend_ceiling/);
for(const db of dbs)db.close();
console.log('PASS defaultON/account isolation, persisted switch, dailycapOFF but actual balance enforced, notices, strictboolean/CSRF, discretionary guards and explicitStop');

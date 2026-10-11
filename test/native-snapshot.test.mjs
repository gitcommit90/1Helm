import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Optional external candidate lets an independent reviewer test an integration worktree.
const root = process.env.PUBLIC_SYNC_SOURCE || resolve(import.meta.dirname, '..');
const load = name => import(pathToFileURL(resolve(root, 'src', name)));
const { NativeTransport } = await load('native-transport.js');
const { snapshotTargets, snapshotStub } = await load('backup-plan.js');

function fixture({ running = false, maintenance = true } = {}) {
  const db = new DatabaseSync(':memory:'), objects = new Map(), values = new Map();
  let alarm = null, monitors = 0, destroys = 0, backgrounds = 0;
  const sql = { exec(query, ...args) {
    const statement = db.prepare(query);
    const rows = statement.columns().length ? statement.all(...args) : (statement.run(...args), []);
    return { toArray: () => rows, one: () => rows[0] };
  } };
  const storage = { sql,
    kv: { get: k => values.get(k), put: (k,v) => values.set(k,v), list: () => values.entries() },
    transactionSync(fn) { const before = new Map(values); db.exec('BEGIN'); try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); values.clear(); for(const [k,v] of before) values.set(k,v); throw e; } },
    getAlarm: async () => alarm, setAlarm: async x => { alarm=x; }, deleteAlarm: async () => { alarm=null; },
  };
  const bucket = {
    async put(k,v) { objects.set(k, typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v)); },
    async get(k) { const v=objects.get(k); return v && { size:v.length, arrayBuffer:async()=>v.slice().buffer }; },
  };
  const env = { ENV_NAME:'selfhost', BACKUP_MAINTENANCE:maintenance?'1':'0', BACKUP_RESTORE_MODE:'1', WS:bucket };
  const ctx = { storage, id: {toString:()=> 'native-id'},
    container: { running, monitor: async()=>{monitors++;}, destroy:async()=>{destroys++;ctx.container.running=false;} },
    waitUntil() { backgrounds++; },
  };
  const f = { db, env, ctx, objects, instance:new NativeTransport(ctx,env), counts:()=>({monitors,destroys,backgrounds}), alarm:()=>alarm };
  f.restart=()=>{f.instance=new NativeTransport(ctx,env);};
  return f;
}

test('backup plan enumerates each channel native broker and maps its namespace',async()=>{
  const requested=[];
  const ns = value => ({idFromName:name=>name,get:name=>{requested.push(name);return value;}});
  const env={ENV_NAME:'selfhost',ARCHIVE:ns({channels:async()=>[{slug:'main'},{slug:'project'}]}),RESIDENT:ns({snapshotFileKeys:async()=>[]}),NATIVE_TRANSPORT:ns({marker:'native'})};
  const targets=(await snapshotTargets(env,'owner')).filter(t=>t.kind==='NativeTransport');
  assert.deepEqual(targets,[{kind:'NativeTransport',name:'owner:main'},{kind:'NativeTransport',name:'owner:project'}]);
  assert.equal(snapshotStub(env,targets[0]).marker,'native');
  assert.equal(requested.at(-1),'owner:main');
});

test('maintenance blocks background writes, enrollment callbacks and owner operations',async()=>{
  const f=fixture({running:true});
  try {
    const n=f.instance;
    n.put('tail_enabled',true);n.put('tail_epoch',7);n.put('incarnation','old');
    const before=f.db.prepare('SELECT * FROM native_kv ORDER BY k').all();
    assert.deepEqual(f.counts(),{monitors:0,destroys:0,backgrounds:0});
    assert.equal(await n.saveTailState(7,'old',{epoch:7,state:{}}),false);
    assert.throws(()=>n.owner({tenant:'owner',channel:'main'}),/maintenance/);
    await n.alarm();
    assert.deepEqual(f.db.prepare('SELECT * FROM native_kv ORDER BY k').all(),before);
    assert.ok(f.alarm()>Date.now());
    assert.equal(f.counts().destroys,0,'alarm defers without changing captured state');
    await n.snapshotPrepare();
    assert.equal(f.ctx.container.running,false,'backup preparation stops active broker');
    assert.equal(f.counts().destroys,1);
  } finally { f.db.close(); }
});

test('native snapshot retains recovery evidence but restore cannot resurrect access',async()=>{
  const source=fixture(),target=fixture();
  try {
    for(const [k,v] of Object.entries({tail_enabled:true,tail_state:'sealed-test-state',seed:'sealed-test-seed',public_key:'public-test-key',trusted_servers:[{id:'old-grant'}],revoking_servers:[{id:'old-revocation'}],sessions:[{id:'old-session'}],owner:{tenant:'owner',channel:'main'},tail_epoch:7,incarnation:'old'}))source.instance.put(k,v);
    let saved;
    for(let step=0;step<50;step++) {saved=await source.instance.snapshotBackupStep('backup/native','owner:main');if(saved.done)break;source.restart();}
    assert.equal(saved.done,true);
    const manifest=JSON.parse(new TextDecoder().decode(source.objects.get(saved.key)));
    assert.deepEqual(manifest.identity,{kind:'NativeTransport',name:'owner:main'});
    const evidence=manifest.tables.flatMap(t=>t.pages.map(p=>JSON.parse(new TextDecoder().decode(source.objects.get(p.key)))));
    assert.ok(evidence.some(p=>p.rows.some(r=>r.values.includes('tail_state'))),'saved enrollment evidence included');
    target.env.WS=source.env.WS;
    target.instance.put('seed','obsolete-target-seed');
    let restored;
    for(let step=0;step<100;step++){restored=await target.instance.snapshotRestoreStep(saved.key,'owner:main');if(restored.done)break;target.restart();}
    assert.equal(restored.done,true);
    for(const key of ['tail_state','seed','public_key','trusted_servers','revoking_servers','sessions','owner','tail_enabled'])assert.equal(target.instance.get(key),null,`${key} cannot reactivate from backup`);
    assert.notEqual(target.instance.get('incarnation'),'old');
    assert.ok(target.instance.get('key_epoch')>0);
    assert.equal(target.alarm(),null,'no pre-backup alarm resumes old authority');
    target.restart();
    assert.equal(target.instance.get('tail_enabled',false),false);
  } finally {source.db.close();target.db.close();}
});

test('busy and non-maintenance objects refuse snapshot mutation',async()=>{
  const f=fixture();
  try {
    for(const field of ['inflight','_rotation','_starting','_identity','_disconnecting','_stopping','_tailStatusRefresh','_tailCleanup']){
      f.instance[field]=true;
      await assert.rejects(f.instance.snapshotBackupStep('backup/busy','owner:main'),/busy/);
      await assert.rejects(f.instance.snapshotRestoreStep('backup/busy/manifest.json','owner:main'),/busy/);
      assert.equal(f.objects.size,0);
      f.instance[field]=false;
    }
    f.env.BACKUP_MAINTENANCE='0';
    await assert.rejects(f.instance.snapshotBackupStep('backup/off','owner:main'),/unavailable/);
    await assert.rejects(f.instance.snapshotRestoreStep('backup/off/manifest.json','owner:main'),/unavailable/);
  } finally {f.db.close();}
});

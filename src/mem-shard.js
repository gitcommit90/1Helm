// Memory shards. A shard is one D1 database plus one Vectorize index. Shard 0 is the control database (DB) with MEMORY_INDEX, and shards 1 to 5 are
// MEM_DB_n with MEMORY_INDEX_n. An account gets one shard number when it is created (tenants.mem_shard) and keeps it, so its memory never moves.
// Vectorize allows 50,000 namespaces per index and a channel is one namespace, so 2,500 accounts at a planning figure of 15 channels each (37,500) fit with room to spare,
// and at the measured size per account that also keeps one shard's database well under the 10 GB D1 limit.
export const MEM_SHARD_ACCOUNTS = 2500;
const MAX_SHARD = 5;
export const TENANT_ID = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/;   // a bank id carries its account's id

// The shard numbers this Worker has bindings for, lowest first.
export const shardsOf = (env) => [0, ...Array.from({ length: MAX_SHARD }, (_, i) => i + 1).filter((n) => env[`MEM_DB_${n}`] && env[`MEMORY_INDEX_${n}`])];

// The env that memory code reads and writes through: DB and MEMORY_INDEX are the shard's pair, everything else is the real env. Shard 0 is the env itself.
export function shardEnv(env, n) {
  if (!n) return env;
  if (!env[`MEM_DB_${n}`] || !env[`MEMORY_INDEX_${n}`]) throw new Error(`memory shard ${n} is not bound`);
  return Object.create(env, { DB: { value: env[`MEM_DB_${n}`] }, MEMORY_INDEX: { value: env[`MEMORY_INDEX_${n}`] } });
}

// An account's shard never changes, so it is read once per isolate. A Worker with no shard bindings has only shard 0 and reads nothing.
const known = new Map();
export async function shardOf(env, tenant) {
  if (!tenant || !env.MEM_DB_1) return 0;
  if (!known.has(tenant)) {
    const r = await env.DB.prepare("SELECT mem_shard FROM tenants WHERE id=?").bind(tenant).first();
    if (!r) return 0;   // an account that is not created yet has nothing stored
    known.set(tenant, Number(r.mem_shard) || 0);
  }
  return known.get(tenant);
}
export async function memEnv(env, tenant) { return shardEnv(env, await shardOf(env, tenant)); }

// The shard for a new account: the lowest-numbered shard with fewer than MEM_SHARD_ACCOUNTS accounts, or the emptiest one when all are full.
export async function pickShard(env) {
  const shards = shardsOf(env);
  if (shards.length === 1) return 0;
  const counts = new Map(((await env.DB.prepare("SELECT mem_shard s, COUNT(*) n FROM tenants GROUP BY mem_shard").all()).results || []).map((r) => [Number(r.s), Number(r.n)]));
  const open = shards.find((s) => (counts.get(s) || 0) < MEM_SHARD_ACCOUNTS);
  if (open != null) return open;
  console.error("memory shards full");
  return shards.reduce((a, b) => ((counts.get(b) || 0) < (counts.get(a) || 0) ? b : a));
}

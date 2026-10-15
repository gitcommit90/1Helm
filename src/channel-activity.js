// When a channel last had a chat turn, kept in D1 memjob_state.last_activity. The daily billing check (billing-flag.js) reads it to know which
// channels to scan. The memory jobs that used the same table (upkeep, people, reflect) are gone, so the other columns and the memjob_runs table stay unused.
let ensured = false;
export async function ensureTables(env) {
  if (ensured) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS memjob_state (tenant_id TEXT NOT NULL, channel TEXT NOT NULL, last_activity INTEGER NOT NULL DEFAULT 0, upkeep_at INTEGER NOT NULL DEFAULT 0, people_at INTEGER NOT NULL DEFAULT 0, reflect_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tenant_id, channel))"),
  ]);
  ensured = true;
}
// After a chat turn (throttled by the caller): records that this channel had activity.
export async function noteActivity(env, tenant, channel, at = Date.now()) {
  await ensureTables(env);
  await env.DB.prepare("INSERT INTO memjob_state (tenant_id, channel, last_activity) VALUES (?,?,?) ON CONFLICT(tenant_id, channel) DO UPDATE SET last_activity=excluded.last_activity").bind(tenant, channel, at).run();
}


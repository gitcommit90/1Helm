// "Last served": what answered each /models job (INVENTORY 6(h)). The dispatcher calls noteServed after every step. A write happens only when the
// served model, provider or status changed, or the row is older than WRITE_EVERY_MS in this isolate, so the cost is a few writes an hour per job.
// It never throws and never slows a call: the write is handed to waitUntil when the caller has one.
export const WRITE_EVERY_MS = 10 * 60e3;
const seen = new Map();   // `${environment}:${job}` -> { key, at, calls }
export const resetServedCache = () => seen.clear();
export const environmentOf = (env) => env?.ENV_NAME || "live";

// The row a call is recorded under. A main chat reply (a call with a route) has one row for each routing category, "chat:<category id>"; every other call
// has the row of its job. A route that names no category is General's.
export const servedJobOf = (jobId, route = null) => route ? `${jobId}:${String(route.category || route.taskProfile?.category || "general")}` : jobId;

// ok: whether the step answered. served: { model, provider } from the response (CF steps: the requested ID). error: a short text for a failed step.
// failed: for an ok call, the earlier step of the same call that failed first ({ model, error }), so a fallback that answers still shows why the main model did not.
export function noteServed(env, { job, requested, served = null, ok = true, error = null, failed = null, now = Date.now() }) {
  try {
    if (!env?.DB || !job) return null;
    const environment = environmentOf(env), id = `${environment}:${job}`, status = ok ? "ok" : "error";
    const model = served?.model || null, provider = served?.provider || null;
    const why = ok && failed ? `${failed.model}: ${String(failed.error || "failed")}`.slice(0, 240) : null;
    const key = `${requested}|${model}|${provider}|${status}|${why || ""}`, prev = seen.get(id);
    const calls = (prev?.calls || 0) + 1;
    if (prev && prev.key === key && now - prev.at < WRITE_EVERY_MS) { seen.set(id, { ...prev, calls }); return null; }
    seen.set(id, { key, at: now, calls: 0 });
    // A failed step keeps the last good served model and only records when it failed.
    const sql = (withError) => ok
      ? `INSERT INTO model_served(environment,job_id,requested,served_model,served_provider,last_at,calls,last_status,last_error_at${withError ? ",last_error" : ""}) VALUES(?,?,?,?,?,?,?,?,NULL${withError ? ",?" : ""})
         ON CONFLICT(environment,job_id) DO UPDATE SET requested=excluded.requested,served_model=excluded.served_model,served_provider=excluded.served_provider,last_at=excluded.last_at,calls=calls+excluded.calls,last_status=excluded.last_status${withError ? ",last_error=excluded.last_error" : ""}`
      : `INSERT INTO model_served(environment,job_id,requested,served_model,served_provider,last_at,calls,last_status,last_error_at) VALUES(?,?,?,NULL,NULL,?,?,?,?)
         ON CONFLICT(environment,job_id) DO UPDATE SET requested=excluded.requested,last_status=excluded.last_status,last_error_at=excluded.last_error_at,calls=calls+excluded.calls`;
    const args = ok ? [environment, job, requested, model, provider, now, calls, status] : [environment, job, requested, now, calls, String(error || status).slice(0, 120), now];
    // The last_error column comes with migration 075; until it exists the write is made without it, so nothing else is lost.
    const run = () => env.DB.prepare(sql(ok)).bind(...args, ...(ok ? [why] : [])).run().catch(() => ok ? env.DB.prepare(sql(false)).bind(...args).run() : Promise.reject(new Error("write failed")));
    const p = run().catch((e) => console.log("model_served: write failed", String(e?.message || e).slice(0, 120)));
    env.waitUntil?.(p); return p;
  } catch (e) { console.log("model_served: skipped", String(e?.message || e).slice(0, 120)); return null; }
}
export async function readServed(env) {
  const r = await env.DB.prepare("SELECT job_id, requested, served_model, served_provider, last_at, calls, last_status, last_error_at, last_error FROM model_served WHERE environment=?").bind(environmentOf(env)).all()
    .catch(() => env.DB.prepare("SELECT job_id, requested, served_model, served_provider, last_at, calls, last_status, last_error_at FROM model_served WHERE environment=?").bind(environmentOf(env)).all());
  return Object.fromEntries((r.results || []).map((x) => [x.job_id, x]));
}
// The rows as the Models console shows them: job id to { since, requested, served_model, served_provider, last_at, calls, last_status, last_error_at }.
// A missing table or a read error gives no rows, and the console then shows "No calls yet".
// since: the time each row's models last changed (model-changes.js changeTimes). Each row carries it as `since`, so a reader judges a call against the models
// that were saved when it was served, never against a list saved after it. A row with no `since` (a server from before this field, or a read that failed) is not judged.
export async function servedView(env, since = null) {
  try {
    const out = {};
    for (const [id, x] of Object.entries(await readServed(env))) out[id] = { since: since && Object.prototype.hasOwnProperty.call(since, id) ? since[id] : null, requested: x.requested ?? null, served_model: x.served_model ?? null, served_provider: x.served_provider ?? null, last_at: Number(x.last_at) || null, calls: Number(x.calls) || null, last_status: x.last_status ?? null, last_error_at: Number(x.last_error_at) || null, last_error: x.last_error ?? null };
    return out;
  } catch { return {}; }
}

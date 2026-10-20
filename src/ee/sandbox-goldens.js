// Golden answers saved for the Sandbox (see app-assets/app-static/sandbox-golden.js for what a golden is). A saved golden replaces the sample's own golden for that job until Reset.
// Stored in the sandbox_goldens table (db/migrations/0062_sandbox_goldens.sql; the table is also created here, the same safe statement, as model-settings.js does). Only the expected
// values are stored: the structure (which list, which fields) always comes from the sample. Each installation keeps its own goldens.
import { cleanGolden } from "../../app-assets/app-static/sandbox-golden.js";

const CREATE = "CREATE TABLE IF NOT EXISTS sandbox_goldens (job TEXT PRIMARY KEY, golden TEXT NOT NULL, at INTEGER NOT NULL, by TEXT)";
const fail = (status, message) => Object.assign(new Error(message), { status });
const dbOf = (env) => (env?.DB?.withSession ? env.DB.withSession("first-primary") : env?.DB);
const stored = (g) => ({ value: g.value, ...(g.type === "text" && g.max_wer !== undefined ? { max_wer: g.max_wer } : {}), ...(g.type === "items" && typeof g.extras_fail === "boolean" ? { extras_fail: g.extras_fail } : {}) });

// What the Sandbox shows for a sample: { golden, default, saved }. golden is the saved one when it is still valid for the sample, else the sample's own.
export async function goldenFor(env, job, sample) {
  const base = sample && sample.golden ? sample.golden : null;
  if (!base) return null;
  try {
    const db = dbOf(env); await db.prepare(CREATE).run();
    const row = await db.prepare("SELECT golden FROM sandbox_goldens WHERE job=?").bind(job).first();
    if (row && row.golden) return { golden: cleanGolden(base, JSON.parse(row.golden)), default: base, saved: true };
  } catch { /* an unreadable or outdated saved golden falls back to the sample's */ }
  return { golden: base, default: base, saved: false };
}
// body: { job, golden } where golden is { value, max_wer?, extras_fail? } to save, or null to go back to the sample's own. Returns the same shape as goldenFor.
export async function saveGolden(env, job, sample, golden, email) {
  const base = sample && sample.golden ? sample.golden : null;
  if (!base) throw fail(404, "This job has no golden answers.");
  const db = dbOf(env); await db.prepare(CREATE).run();
  if (golden === null) { await db.prepare("DELETE FROM sandbox_goldens WHERE job=?").bind(job).run(); return { golden: base, default: base, saved: false }; }
  let clean; try { clean = cleanGolden(base, golden); } catch (e) { throw fail(400, e.message); }
  const text = JSON.stringify(stored(clean));
  if (text.length > 100000) throw fail(413, "The golden answers are too large.");
  await db.prepare("INSERT INTO sandbox_goldens (job,golden,at,by) VALUES (?,?,?,?) ON CONFLICT(job) DO UPDATE SET golden=excluded.golden, at=excluded.at, by=excluded.by").bind(job, text, Date.now(), String(email || "").slice(0, 200)).run();
  return { golden: clean, default: base, saved: true };
}

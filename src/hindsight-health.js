// Memory Overhaul phase 2 (DESIGN.md 4.5): a daily health check per Hindsight bank, the recovery it runs, and the dev only admin path
// that applies the bank templates to every existing bank. Used only with HS_FOUNDATIONS "on".
//
// Which signals count as a problem (BASELINE.md 2.5): the operations table shows 0 failures even while consolidation fails, because a
// consolidation operation is marked completed when some of its batches fail. So the check reads failed_consolidation from the bank stats
// (facts that failed for good), failed operations, every mental model's last_refresh_failed_at, and documents that produced no facts.
// The model errors in Hindsight's request trace are server wide, so they are read once per run (llmTrace), not per bank.
import { hs, bankPath, listBanks, listOperations, listMentalModels, refreshMentalModel, recoverConsolidation, applyTemplate, importTemplate, testBankManifest, syncMentalModelTriggers } from "./hindsight.js";
import { isTestTenant } from "./test-tenant.js";
import { hsFoundations, templateKind, fillTemplate, TEMPLATE_VERSION } from "./hindsight-template.js";
import { helperName } from "./helper-name.js";

export const BANK_RE = /^(.+?)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/;
const tag = (bank) => bank.length > 12 ? `${bank.slice(0, 4)}..${bank.slice(-6)}` : bank;   // logs and ops answers name banks by a short form

// One bank, read only unless fix is true. Returns { bank, at, stats, problems: [kind], models, failedOps, zeroFactDocs, actions }.
// fix: recoverConsolidation when facts failed, refreshMentalModel for each model whose refresh failed (each at most once per call).
export async function bankHealth(env, bank, { fix = false, now = Date.now() } = {}) {
  const r = { bank, at: now, problems: [], actions: [] };
  const st = await hs(env, `${bankPath(bank)}/stats?refresh=true`);
  r.stats = { nodes: st.total_nodes, documents: st.total_documents, observations: st.total_observations, pending_operations: st.pending_operations, failed_operations: st.failed_operations,
    pending_consolidation: st.pending_consolidation, failed_consolidation: st.failed_consolidation, last_consolidated_at: st.last_consolidated_at || null };
  if (st.failed_consolidation > 0) r.problems.push("failed_consolidation");
  if (st.failed_operations > 0) {
    r.problems.push("failed_operations");
    try { r.failedOps = ((await listOperations(env, bank, { status: "failed", limit: 5 }))?.operations || []).map((o) => ({ id: o.id, type: o.task_type, error: String(o.error_message || "").slice(0, 160) })); } catch (e) { r.failedOps = [{ error: e.message.slice(0, 120) }]; }
  }
  try {
    const models = (await listMentalModels(env, bank))?.items || [];
    r.models = models.map((m) => ({ id: m.id, refreshed: m.last_refreshed_at || null, failed: m.last_refresh_failed_at || null, stale: !!m.is_stale }));
    // A refresh that failed after the last good one pauses that model's automatic refresh until someone refreshes it by hand.
    r.failedModels = r.models.filter((m) => m.failed && (!m.refreshed || Date.parse(m.failed) >= Date.parse(m.refreshed))).map((m) => m.id);
    if (r.failedModels.length) r.problems.push("mental_model_refresh_failed");
  } catch (e) { r.models = null; r.modelsError = e.message.slice(0, 120); }
  try {
    const docs = (await hs(env, `${bankPath(bank)}/documents?limit=100`))?.items || [];
    r.zeroFactDocs = docs.filter((d) => !d.memory_unit_count && Number(d.text_length) >= 600).length;   // long documents (600+ characters) that gave no facts, newest 100
  } catch { r.zeroFactDocs = null; }
  if (fix) {
    if (r.problems.includes("failed_consolidation")) { try { r.actions.push({ recoverConsolidation: (await recoverConsolidation(env, bank)).retried }); } catch (e) { r.actions.push({ recoverConsolidation: `error: ${e.message.slice(0, 100)}` }); } }
    for (const id of r.failedModels || []) { try { await refreshMentalModel(env, bank, id); r.actions.push({ refresh: id }); } catch (e) { r.actions.push({ refresh: id, error: e.message.slice(0, 100) }); } }
  }
  return r;
}

// Server wide model call statuses from Hindsight's request trace over the last day (null when the trace is off or unreachable).
export async function llmTrace(env, bank) {
  try { const r = await hs(env, `${bankPath(bank)}/llm-requests/stats?period=1d`); const t = {}; for (const b of r?.buckets || []) for (const [k, n] of Object.entries(b.statuses || {})) t[k] = (t[k] || 0) + n; return t; } catch { return null; }
}

const TABLE = "CREATE TABLE IF NOT EXISTS hs_health (bank TEXT PRIMARY KEY, checked_at INTEGER NOT NULL, stats TEXT, problems TEXT NOT NULL DEFAULT '[]', detail TEXT, actions TEXT NOT NULL DEFAULT '[]')";
export async function saveHealth(env, r) {
  await env.DB.prepare(TABLE).run().catch(() => {});
  await env.DB.prepare("INSERT INTO hs_health (bank, checked_at, stats, problems, detail, actions) VALUES (?,?,?,?,?,?) ON CONFLICT(bank) DO UPDATE SET checked_at=excluded.checked_at, stats=excluded.stats, problems=excluded.problems, detail=excluded.detail, actions=excluded.actions")
    .bind(r.bank, r.at, JSON.stringify(r.stats || null), JSON.stringify(r.problems), JSON.stringify({ models: r.models, failedModels: r.failedModels, failedOps: r.failedOps, zeroFactDocs: r.zeroFactDocs }), JSON.stringify(r.actions)).run();
}

// Hourly cron entry. Each bank is checked about once a day: every run takes the banks with no check in the last 23 hours (never checked
// first), at most `max` of them, so a few hundred banks spread over the day and stay inside the Worker's subrequest limit.
export async function healthCron(env, { max = 30, now = Date.now(), fix = true } = {}) {
  if (!hsFoundations(env)) return { skipped: "HS_FOUNDATIONS off" };
  const envName = env.ENV_NAME || "dev", banks = (await listBanks(env, `${envName}-`)).map((b) => b.bank_id).filter((id) => id.startsWith(`${envName}-`));
  await env.DB.prepare(TABLE).run().catch(() => {});
  const seen = new Map(((await env.DB.prepare("SELECT bank, checked_at FROM hs_health").all()).results || []).map((x) => [x.bank, x.checked_at]));
  const due = banks.filter((b) => !(seen.get(b) > now - 23 * 3600e3)).sort((a, b) => (seen.get(a) || 0) - (seen.get(b) || 0)).slice(0, max);
  const out = { banks: banks.length, checked: 0, problems: 0, recovered: 0, errors: 0, trace: due.length ? await llmTrace(env, due[0]) : null };
  const testOf = new Map();   // a test account's bank is only read, never repaired: a repair is a model call nobody asked for (Captain, 2026-10-18)
  for (const b of due) {
    try { const tid = b.match(BANK_RE)?.[2]; if (tid && !testOf.has(tid)) testOf.set(tid, await isTestTenant(env, tid));
      const r = await bankHealth(env, b, { fix: fix && !testOf.get(tid), now }); await saveHealth(env, r); out.checked++; if (r.problems.length) out.problems++; if (r.actions.length) out.recovered++; }
    catch (e) { out.errors++; if (e.status === 404) await env.DB.prepare("DELETE FROM hs_health WHERE bank=?").bind(b).run().catch(() => {}); else console.log("hindsight health", tag(b), e.message); }
  }
  return out;
}

// GET /_ops/hs-health[?problems=1&limit=]: the saved results (newest first) and totals. Bank ids are shown in the short form.
export async function readHealth(env, { onlyProblems = false, limit = 50 } = {}) {
  await env.DB.prepare(TABLE).run().catch(() => {});
  const rows = (await env.DB.prepare("SELECT * FROM hs_health ORDER BY checked_at DESC").all()).results || [];
  const J = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const all = rows.map((x) => ({ bank: tag(x.bank), checked_at: x.checked_at, stats: J(x.stats), problems: J(x.problems) || [], detail: J(x.detail), actions: J(x.actions) || [] }));
  const bad = all.filter((x) => x.problems.length), by = {};
  for (const x of bad) for (const p of x.problems) by[p] = (by[p] || 0) + 1;
  return { checked: all.length, with_problems: bad.length, by_problem: by, failed_consolidation_facts: all.reduce((n, x) => n + (x.stats?.failed_consolidation || 0), 0), oldest_check: all.length ? Math.min(...all.map((x) => x.checked_at)) : null, banks: (onlyProblems ? bad : all).slice(0, limit) };
}

// ---- dev admin path (POST /_ops/hs-admin) ----
// action=templates : import the filled template into existing banks (dry=1, the default, only validates and reports what would change).
// action=recover   : recoverConsolidation on banks whose stats show failed_consolidation (dry=1 only lists them).
// action=triggers : PATCH only the mental model triggers of existing banks to the template's (no import, no refresh, no model call), one bank at a
//                   time with a short pause (dry=1 only counts). The answer has before and after counts of cron, after_consolidation and other triggers.
// templates also runs that trigger step first, so its import does not queue a refresh of every model whose trigger changed.
// Each takes limit (default 25, at most 50, one call stays inside the subrequest limit), offset, slug (one account) and skip_empty (default 1,
// banks with no memory are left alone by templates, because a new mental model starts a model refresh (triggers does not skip them: a PATCH starts none).. The answer has next_offset until the list is done.
export async function hsAdmin(env, action, { dry = true, limit = 25, offset = 0, slug = "", skipEmpty = true, archive, pauseMs = 300 } = {}) {
  if (!hsFoundations(env)) return { error: "HS_FOUNDATIONS is off" };
  if (action !== "templates" && action !== "recover" && action !== "triggers") return { error: "action must be templates, recover or triggers" };
  limit = Math.min(50, Math.max(1, limit | 0 || 25)); offset = Math.max(0, offset | 0);
  const envName = env.ENV_NAME || "dev"; let tenantFilter = null;
  if (slug) { tenantFilter = (await env.DB.prepare("SELECT id FROM tenants WHERE slug=?").bind(slug).first())?.id; if (!tenantFilter) return { error: "no such workspace" }; }
  const all = (await listBanks(env, `${envName}-`)).map((b) => b.bank_id).filter((id) => { const m = id.match(BANK_RE); return m && m[1] === envName && (!tenantFilter || m[2] === tenantFilter); }).sort();
  const part = all.slice(offset, offset + limit), tenants = new Map(), results = [];
  const totals = { checked: 0, patched: 0, before: { cron: 0, after_consolidation: 0, other: 0 }, after: { cron: 0, after_consolidation: 0, other: 0 } };
  const tenantInfo = async (tid) => {
    if (tenants.has(tid)) return tenants.get(tid);
    const row = await env.DB.prepare("SELECT first_name, helper_name FROM tenants WHERE id=?").bind(tid).first().catch(() => null);
    let chans = null; try { chans = await archive(env, tid).channels(); } catch {}
    const v = { row, chans, test: await isTestTenant(env, tid) }; tenants.set(tid, v); return v;
  };
  for (const bank of part) {
    const m = bank.match(BANK_RE), res = { bank: tag(bank), channel: m[3] };
    try {
      const st = await hs(env, `${bankPath(bank)}/stats?refresh=true`), empty = !st.total_nodes && !st.total_documents;
      if (action === "recover") {
        res.failed_consolidation = st.failed_consolidation || 0;
        if (!dry && res.failed_consolidation && (await tenantInfo(m[2])).test) res.status = "skipped: test account (no background model calls)";
        else if (!res.failed_consolidation) res.status = "ok";
        else if (dry) res.status = "would recover";
        else { res.retried = (await recoverConsolidation(env, bank)).retried; res.status = "recovered"; }
      } else {
        if (skipEmpty && empty && action !== "triggers") { res.status = "skipped empty"; results.push(res); continue; }
        const { row, chans, test } = await tenantInfo(m[2]);
        if (!row) { res.status = "skipped: no account"; results.push(res); continue; }
        const c = (chans || []).find((x) => (x.slug || x.name) === m[3]);
        if (!c && chans) { res.status = "skipped: channel gone"; results.push(res); continue; }
        const kind = templateKind(m[3]), vars = { first: row.first_name, helper: helperName(row), channel: m[3], purpose: c?.purpose || c?.topic || "" };
        res.kind = kind; res.template_version = TEMPLATE_VERSION;
        const manifest = test ? testBankManifest(fillTemplate(kind, vars)) : fillTemplate(kind, vars);   // a test account's models have no automatic trigger
        if (test) res.test_account = true;
        if (action === "triggers" || !dry) {
          const sy = await syncMentalModelTriggers(env, bank, manifest, { dryRun: dry, manual: !!test });
          res.triggers = { checked: sy.checked, patched: sy.patched, before: sy.before, after: sy.after };
          for (const k of ["checked", "patched"]) totals[k] += sy[k];
          for (const k of Object.keys(totals.before)) { totals.before[k] += sy.before[k]; totals.after[k] += sy.after[k]; }
        }
        if (action === "triggers") { res.status = dry ? "would patch" : "patched"; await new Promise((r) => setTimeout(r, pauseMs)); }
        else if (dry) { const r = await applyTemplate(env, bank, manifest, { dryRun: true }); res.status = "would import"; res.mental_models = r.mental_models_created; }
        else { /* the bank was listed, so it exists */ const r = await importTemplate(env, bank, manifest, { manual: !!test }); res.status = "imported"; res.mental_models_created = r.mental_models_created; res.mental_models_updated = r.mental_models_updated; res.refresh_operations = (r.operation_ids || []).length; }
      }
    } catch (e) { res.status = "error"; res.error = String(e.message || e).slice(0, 160); }
    results.push(res);
  }
  const count = {}; for (const r of results) count[r.status] = (count[r.status] || 0) + 1;
  return { action, dry, total: all.length, offset, processed: part.length, counts: count, ...(action === "triggers" || !dry ? { trigger_totals: totals } : {}), next_offset: offset + limit < all.length ? offset + limit : null, results };
}

// Several AI service connections on one account (task byok-multi, Captain 2026-11-02: "if i add chatgpt and opencode, i then, in the model selector, see models from both subs to be able to assign").
// An account holds any number of plain connections (an OpenAI-compatible address and key), and at most one OpenRouter, one ChatGPT and one OpenCode connection. Table byok_connections
// (migrations_087), one row each: kind, label, address, the key sealed with VAULT_KEY (never returned, only its last 4), the last test. A ChatGPT connection has no key here: its sign-in stays
// in byok_chatgpt (byok-chatgpt.js) and the row only says it exists.
// Models are named per connection everywhere, <connection id>:<model id>, so the same model name on two services never collides. The id of a connection that can only exist once is its kind
// (openrouter, chatgpt, opencode); a plain one is p_ and a few letters or digits. No id has a colon, so the first colon splits the name.
// Where the models are chosen: Settings, Advanced, Custom Model Selection (byok-custom.js). This file knows nothing about the choice, except that removing a connection takes its models out.
// Existing accounts need no action. The first time anything reads their connections (ensureUpgrade), the one saved key of the old byok row, and a saved ChatGPT sign-in, become connections,
// and the saved main model, fast model and reasoning levels become the own-key Custom Model Selection setting (General's first model, Background jobs). byok_multi marks it done. The old row is only copied from, never changed.
import { sealSecret, openSecret } from "../sentinel.js";
import { checkBase, ByokError, byokModelsJson, redact, TEST_FAIL, TEST_FAIL_CG_SIGNIN, withKey, withChatgpt, withClaudeCode } from "../byok.js";
import { OR_SOURCE, OR_BASE, orPending, orForget } from "../byok-openrouter.js";
import { CG_SOURCE, CG_BASE, cgRow, cgDdl, cgForget } from "./byok-chatgpt.js";
import { OC_SOURCE, OC_BASE, OC_AGENT, ocPlan, ocBase, ocSession } from "./byok-opencode.js";
import { CC_ID, CC_LABEL, ccForget, ccTest } from "./byok-claudecode.js";
import { forgetLists } from "./byok-custom.js";

export const KINDS = ["plain", "openrouter", "chatgpt", "opencode", "claudecode"];
export const MAX_PLAIN = 12;
export const LABELS = { openrouter: "OpenRouter", chatgpt: "ChatGPT", opencode: "OpenCode", claudecode: CC_LABEL };
export const CONN_ID_RE = /^(openrouter|chatgpt|opencode|claudecode|p_[a-z0-9]{3,12})$/;
const now = () => Date.now();

export const DDL = [
  "CREATE TABLE IF NOT EXISTS byok_connections (tenant_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', base_url TEXT NOT NULL DEFAULT '', key_sealed TEXT NOT NULL DEFAULT '', key_last4 TEXT NOT NULL DEFAULT '', test_json TEXT NOT NULL DEFAULT '', tested_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, oc_plan TEXT NOT NULL DEFAULT 'go', PRIMARY KEY (tenant_id, id))",
  "CREATE TABLE IF NOT EXISTS byok_multi (tenant_id TEXT PRIMARY KEY, upgraded_at INTEGER NOT NULL)",
];
let ddlDone = null;
export async function connDdl(env) {
  if (ddlDone === env.DB) return;
  for (const q of DDL) await env.DB.prepare(q).run();
  // A table made before the OpenCode plan existed gets its column (migrations_091); every OpenCode connection already there becomes Go.
  try { await env.DB.prepare("ALTER TABLE byok_connections ADD COLUMN oc_plan TEXT NOT NULL DEFAULT 'go'").run(); } catch (e) { if (!/duplicate column/i.test(String(e?.message))) throw e; }
  ddlDone = env.DB;
}

// ---- names ----
export const nsModel = (connId, model) => `${connId}:${model}`;
export function splitModel(ns) {
  const s = String(ns ?? ""), i = s.indexOf(":");
  if (i < 1) return null;
  const conn = s.slice(0, i), model = s.slice(i + 1);
  return CONN_ID_RE.test(conn) && model ? { conn, model } : null;
}
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
const newPlainId = () => `p_${[...crypto.getRandomValues(new Uint8Array(5))].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("")}`;

// ---- rows ----
const rowOf = (env, tid, id) => env.DB.prepare("SELECT * FROM byok_connections WHERE tenant_id=? AND id=?").bind(tid, id).first();
export async function listRows(env, tid) {
  await ensureUpgrade(env, tid);
  let rows = (await env.DB.prepare("SELECT * FROM byok_connections WHERE tenant_id=? ORDER BY created_at, id").bind(tid).all()).results || [];
  // An OpenCode connection with no key is a keyless one from the removed sign-in without a key. It is removed here like a normal Remove, so the page shows the choose a model state.
  for (const r of rows.filter((x) => x.kind === "opencode" && !x.key_sealed)) {
    await removeRow(env, tid, rows, r);
    rows = rows.filter((x) => x !== r);
  }
  return rows;
}
async function put(env, tid, c, { replace = true } = {}) {
  const at = now();
  if (replace) await forgetLists(env, tid, c.id);   // a changed key or address: read the service's list again
  await env.DB.prepare(`INSERT ${replace ? "OR REPLACE" : "OR IGNORE"} INTO byok_connections (tenant_id,id,kind,label,base_url,key_sealed,key_last4,test_json,tested_at,created_at,updated_at,oc_plan) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(tid, c.id, c.kind, c.label || LABELS[c.kind] || hostOf(c.base_url), c.base_url || "", c.key_sealed || "", c.key_last4 || "", c.test_json || "", c.tested_at ?? null, c.created_at || at, at, ocPlan(c.oc_plan)).run();
}
// The row for the page: no secret, the last test, and for ChatGPT who is signed in.
export async function viewRows(env, tid, rows) {
  const out = [];
  for (const r of rows) {
    let test = null; try { test = r.test_json ? JSON.parse(r.test_json) : null; } catch {}
    const v = { id: r.id, kind: r.kind, label: r.label || LABELS[r.kind] || hostOf(r.base_url), host: r.kind === "plain" ? hostOf(r.base_url) : "", last4: r.key_last4 || "", added_at: Number(r.created_at) || null, tested_at: r.tested_at || null, test };
    if (r.kind === "opencode") v.plan = ocPlan(r.oc_plan);
    if (r.kind === "claudecode") { const a = test?.account || {}; v.email = a.email || ""; v.plan_name = a.plan || ""; v.signin_again = !!test && test.ok === false; }
    if (r.kind === "chatgpt") { const cg = await cgRow(env, tid).catch(() => null); v.email = cg?.email || ""; v.signin_again = !!cg?.broken || (!!cg && !cg.has); }
    out.push(v);
  }
  return out;
}

// ---- the lazy upgrade of an account with the old single key ----
const clone = (x) => JSON.parse(JSON.stringify(x));
const seedRecord = (conn, kind, model, effort) => ({ id: nsModel(conn, model), name: model.split("/").pop(), source: kind === "openrouter" ? "OR" : "BYOK", conn, connKind: kind, kinds: ["chat"], efforts: effort ? [effort] : [], default_effort: null, levels: [], pricing: null, seed: true });
// The old own-key setting (or, with none, the saved main and fast model) in the new naming. conn/kind: the connection the old row became.
export function upgradedConfig(oldConfig, oldOn, row, conn, kind) {
  const ns = (m) => nsModel(conn, m);
  if (oldOn && oldConfig && Array.isArray(oldConfig.categories) && oldConfig.catalog) {
    const c = clone(oldConfig), tag = (rec, id) => ({ ...rec, id: ns(id), conn, connKind: kind });
    c.categories = c.categories.map((x) => ({ ...x, chain: (x.chain || []).map((e) => ({ model: ns(e.model), effort: e.effort ?? null })) }));
    if (c.background?.chain) c.background = { chain: c.background.chain.map((e) => ({ model: ns(e.model), effort: e.effort ?? null })) };
    c.catalog = Object.fromEntries(Object.entries(c.catalog).map(([id, rec]) => [ns(id), tag(rec, id)]));
    return c;
  }
  const main = row.model, fast = row.fast_model || row.model, catalog = { [ns(main)]: seedRecord(conn, kind, main, row.effort || "") };
  const bgEffort = fast === main ? null : row.fast_effort || null;
  if (!catalog[ns(fast)]) catalog[ns(fast)] = seedRecord(conn, kind, fast, bgEffort || "");
  return { version: 1, categories: [{ id: "general", title: "General", chain: [{ model: ns(main), effort: row.effort || null }], max_price: null }], background: { chain: [{ model: ns(fast), effort: bgEffort }] }, catalog };
}
export async function ensureUpgrade(env, tid) {
  await connDdl(env);
  if (await env.DB.prepare("SELECT 1 x FROM byok_multi WHERE tenant_id=?").bind(tid).first()) return;
  const row = await env.DB.prepare("SELECT * FROM byok WHERE tenant_id=?").bind(tid).first();
  await cgDdl(env);
  const cg = await cgRow(env, tid).catch(() => null), saved = !!(row && row.base_url && row.model);
  let main = null;   // the connection the saved main and fast model belong to
  if (saved) {
    const at = Number(row.created_at) || now(), base = { base_url: row.base_url, key_sealed: row.key_sealed || "", key_last4: row.key_last4 || "", test_json: row.test_json || "", tested_at: row.tested_at ?? null, created_at: at };
    if (row.source === CG_SOURCE) main = cg ? { id: "chatgpt", kind: "chatgpt" } : null;
    else if (row.source === OR_SOURCE) { main = { id: "openrouter", kind: "openrouter" }; await put(env, tid, { ...base, id: "openrouter", kind: "openrouter", label: LABELS.openrouter, base_url: OR_BASE }, { replace: false }); }
    else { main = { id: "p_main", kind: "plain" }; await put(env, tid, { ...base, id: "p_main", kind: "plain", label: hostOf(row.base_url) }, { replace: false }); }
  }
  if (cg && (cg.has || cg.broken)) await put(env, tid, { id: "chatgpt", kind: "chatgpt", label: LABELS.chatgpt, base_url: CG_BASE }, { replace: false });
  if (main) {
    try {
      const t = await env.DB.prepare("SELECT custom_models_own_on, custom_models_own FROM tenants WHERE id=?").bind(tid).first();
      let old = null; try { old = t?.custom_models_own ? JSON.parse(t.custom_models_own) : null; } catch {}
      const config = upgradedConfig(old, Number(t?.custom_models_own_on) === 1, row, main.id, main.kind);
      await env.DB.prepare("UPDATE tenants SET custom_models_own_on=1, custom_models_own=?, updated_at=? WHERE id=?").bind(JSON.stringify(config), now(), tid).run();
    } catch (e) { if (!/no such column/i.test(String(e?.message))) throw e; }
  }
  // The old byok row is left exactly as it is (an undone release must find its key); byok_multi below says it was imported, and nothing reads its address, key or models again. Only mode is still used.
  await env.DB.prepare("INSERT OR IGNORE INTO byok_multi (tenant_id, upgraded_at) VALUES (?,?)").bind(tid, now()).run();
}

// ---- adding, replacing, removing ----
const KEY_RE = /^[^\x00-\x1f\x7f]{0,4000}$/;
// A plain connection from the form. key may be empty (self-hosted servers). → { id, row } or { error, field }.
export function plainFromForm(b) {
  const chk = checkBase(b.base); if (!chk.ok) return { error: chk.error, field: "base" };
  const key = String(b.key ?? "").trim();
  if (!KEY_RE.test(key)) return { error: "That key doesn't look right: it should be one line, up to 4000 characters.", field: "key" };
  const label = String(b.label ?? "").trim().slice(0, 60);
  return { chk, key, label: label || chk.host };
}
export async function addPlain(env, tid, f) {
  const rows = await listRows(env, tid);
  if (rows.filter((r) => r.kind === "plain").length >= MAX_PLAIN) return { error: `You can connect up to ${MAX_PLAIN} services of this kind.`, status: 409 };
  const same = rows.find((r) => r.kind === "plain" && r.base_url === f.chk.base && (r.key_last4 || "") === f.key.slice(-4));
  const id = same?.id || newPlainId();
  await put(env, tid, { id, kind: "plain", label: f.label, base_url: f.chk.base, key_sealed: f.key ? await sealSecret(env, f.key) : "", key_last4: f.key.slice(-4), created_at: same ? Number(same.created_at) : undefined });
  return { id };
}
export async function addSealed(env, tid, kind, key, plan = "go") {
  await connDdl(env);
  const old = await rowOf(env, tid, kind);
  await put(env, tid, { id: kind, kind, oc_plan: plan, base_url: kind === "openrouter" ? OR_BASE : ocBase(plan), key_sealed: await sealSecret(env, key), key_last4: key.slice(-4), created_at: old ? Number(old.created_at) : undefined });
  return { id: kind };
}
// A key that Sign in with OpenRouter made (byok_or_key) becomes the OpenRouter connection at once, since there are no models to pick first.
export async function adoptPending(env, tid) {
  const p = await orPending(env, tid).catch(() => null); if (!p) return false;
  await connDdl(env);
  await put(env, tid, { id: "openrouter", kind: "openrouter", label: LABELS.openrouter, base_url: OR_BASE, key_sealed: p.key_sealed, key_last4: p.key_last4 || "", created_at: (await rowOf(env, tid, "openrouter"))?.created_at });
  await orForget(env, tid);
  return true;
}
// The Claude Code connection: no key, only who signed in (kept in the row's last test, so the page needs no container start to show it).
export async function addClaudeCode(env, tid, account = {}) {
  await connDdl(env); const old = await rowOf(env, tid, CC_ID), at = now();
  await put(env, tid, { id: CC_ID, kind: "claudecode", label: CC_LABEL, base_url: "", test_json: JSON.stringify({ ok: true, checks: { reach: { ok: true } }, at, account }), tested_at: at, created_at: old ? Number(old.created_at) : undefined });
  return { id: CC_ID };
}
export async function addChatgpt(env, tid) { await connDdl(env); const old = await rowOf(env, tid, "chatgpt"); await put(env, tid, { id: "chatgpt", kind: "chatgpt", label: LABELS.chatgpt, base_url: CG_BASE, created_at: old ? Number(old.created_at) : undefined }); }
// Switches the OpenCode connection between Go and Pay as you go. Its model list is read again (the two plans serve different models).
export async function setOcPlan(env, tid, plan) {
  await connDdl(env);
  const row = await rowOf(env, tid, "opencode"); if (!row) return { error: "OpenCode isn't connected.", status: 404 };
  const p = ocPlan(plan);
  await env.DB.prepare("UPDATE byok_connections SET oc_plan=?, base_url=?, updated_at=? WHERE tenant_id=? AND id=?").bind(p, ocBase(p), now(), tid, "opencode").run();
  await forgetLists(env, tid, "opencode");
  return { ok: true, plan: p };
}
export async function saveTest(env, tid, id, test) { await env.DB.prepare("UPDATE byok_connections SET test_json=?, tested_at=? WHERE tenant_id=? AND id=?").bind(JSON.stringify(test), test.at || now(), tid, id).run(); }

// Takes a connection's models out of the saved Custom Model Selection setting (chains, Background jobs, the facts). Returns how many chain places it emptied.
export function withoutConnection(config, id) {
  if (!config) return { config, removed: 0 };
  const c = clone(config), prefix = `${id}:`; let removed = 0;
  const keep = (chain) => (chain || []).filter((e) => { const drop = String(e.model).startsWith(prefix); if (drop) removed++; return !drop; });
  c.categories = (c.categories || []).map((x) => ({ ...x, chain: keep(x.chain) }));
  if (c.background?.chain) c.background = { chain: keep(c.background.chain) };
  c.catalog = Object.fromEntries(Object.entries(c.catalog || {}).filter(([m]) => !m.startsWith(prefix)));
  return { config: c, removed };
}
export async function removeConnection(env, tid, id, { fetchImpl = globalThis.fetch } = {}) {
  const rows = await listRows(env, tid), row = rows.find((r) => r.id === id);
  if (!row) return { error: "That service isn't connected.", status: 404 };
  return removeRow(env, tid, rows, row, { fetchImpl });
}
async function removeRow(env, tid, rows, row, { fetchImpl = globalThis.fetch } = {}) {
  const id = row.id;
  await env.DB.prepare("DELETE FROM byok_connections WHERE tenant_id=? AND id=?").bind(tid, id).run();
  await forgetLists(env, tid, id);
  if (row.kind === "chatgpt") await cgForget(env, tid, { fetchImpl });
  if (row.kind === "claudecode") await ccForget(env, tid);
  if (row.kind === "openrouter") await orForget(env, tid);
  let removed = 0;
  try {
    const t = await env.DB.prepare("SELECT custom_models_own FROM tenants WHERE id=?").bind(tid).first();
    let cur = null; try { cur = t?.custom_models_own ? JSON.parse(t.custom_models_own) : null; } catch {}
    const w = withoutConnection(cur, id); removed = w.removed;
    const left = rows.length - 1;
    await env.DB.prepare("UPDATE tenants SET custom_models_own=?, updated_at=? WHERE id=?").bind(left > 0 && w.config ? JSON.stringify(w.config) : null, now(), tid).run();
  } catch (e) { if (!/no such column/i.test(String(e?.message))) throw e; }
  return { ok: true, removed, left: rows.length - 1 };
}

// ---- what a call to a connection needs ----
// The config byokChat sends one call with: address, key (hidden, like before), and for ChatGPT the handle to its sign-in. settings: the link text of messages.
export async function connCfg(env, tid, r, extra = {}) {
  const base = { id: r.id, kind: r.kind, label: r.label || LABELS[r.kind] || hostOf(r.base_url), last4: r.key_last4 || "", ...extra };
  if (r.kind === "chatgpt") return withChatgpt({ ...base, base: CG_BASE, model: "", fast: "" }, env, tid);
  if (r.kind === "claudecode") return withClaudeCode({ ...base, base: "", model: "", fast: "", tenantId: tid }, env, tid);
  const chk = checkBase(r.kind === "openrouter" ? OR_BASE : r.base_url);
  let key = ""; if (r.key_sealed) { try { key = await openSecret(env, r.key_sealed); } catch { return { ...withKey({ ...base, base: chk.base || r.base_url, host: chk.host || "", unreadable: true, missing: true }, "") }; } }
  const o = { ...base, ...(r.kind === "opencode" ? { plan: ocPlan(r.oc_plan), tenantId: tid } : {}), base: r.kind === "opencode" ? ocBase(r.oc_plan) : chk.base || r.base_url, host: r.kind === "opencode" ? "OpenCode" : chk.host || "", provider: r.kind === "opencode" ? OC_SOURCE : r.kind === "openrouter" ? OR_SOURCE : "" };
  return withKey(o, key);
}
export async function connCfgs(env, tid, extra = {}) {
  const rows = await listRows(env, tid), out = {};
  for (const r of rows) out[r.id] = await connCfg(env, tid, r, extra);
  return out;
}

// ---- Test connection: a check that needs no paid model call ----
// plain: the model list with the key (reach, and the key is accepted when the service asks for one). openrouter: its key endpoint, which says whether the key is valid. chatgpt: the model list
// with the signed-in token. opencode: its model list is public (no key), so a chat request with no messages and a model that doesn't exist is sent: no model runs and nothing
// is billed; 401 or 403 means the key is wrong, any other 4xx means the key was accepted (assumed from the docs, which list no key-checking endpoint).
export const TEST_FAIL_OC = `OpenCode didn't accept that key. Copy it again from your OpenCode console (https://opencode.ai/console/account), then try again.`;
// The paid chat-completions model with the lowest listed price, from OpenCode's public list (no key sent). Free models answer 403 outside OpenCode, so they are skipped.
async function ocCheckModel(cfg, fetchImpl) {
  const go = ocPlan(cfg.plan) === "go";
  const r = await fetchImpl(`${ocBase(cfg.plan)}/v1/models`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15000), headers: { accept: "application/json", "user-agent": OC_AGENT } });
  if (!r.ok) { r.body?.cancel?.().catch?.(() => {}); throw new ByokError(`OpenCode's model list didn't load (error ${r.status})`, r.status, `error ${r.status}`); }
  let j; try { j = JSON.parse(await r.text()); } catch { throw new ByokError("OpenCode's model list wasn't JSON", 0, "the model list wasn't JSON"); }
  const price = (m) => (Number(m?.cost?.text?.input?.price) || 0) + (Number(m?.cost?.text?.output?.price) || 0);
  const chatModels = (j?.data || []).filter((m) => m && typeof m.id === "string" && (!m.type || m.type === "chat"));
  // Go asks every model through chat/completions, so any listed model will do. Pay as you go: a paid chat-completions model (free ones answer 403 outside OpenCode).
  const chat = go ? [...chatModels.filter((m) => price(m) > 0).sort((a, b) => price(a) - price(b)), ...chatModels.filter((m) => !(price(m) > 0))] : chatModels.filter((m) => (m.api === "chat-completions" || (m.api && typeof m.api === "object" && m.api["chat-completions"])) && price(m) > 0).sort((a, b) => price(a) - price(b));
  if (!chat.length) throw new ByokError("OpenCode's model list had no model to check the key with", 0, "no model to check the key with");
  return chat[0].id;
}
const done = (ok, check, t0, extra = {}) => ({ ok, checks: { reach: check }, ms: Date.now() - t0, at: Date.now(), ...extra });
export async function testConnection(cfg, { fetchImpl = globalThis.fetch } = {}) {
  const t0 = Date.now();
  const bad = (e, msg = TEST_FAIL) => { const detail = (e?.byok ? e.detail || "" : redact(e?.message || e, cfg.key, 100)).replace(/\.$/, ""); return done(false, { ok: false, error: detail ? `${msg} Details: ${detail}.` : msg }, t0, { detail }); };
  if (cfg.missing) return bad({ byok: true, detail: "1Helm couldn't read the saved key" });
  try {
    if (cfg.kind === "claudecode") return await ccTest(cfg);   // who is signed in, from the engine; no model runs
    if (cfg.kind === "opencode") {
      // OpenCode checks the key before it looks at the request, and a made-up model id is refused before the key is looked at. So: the cheapest paid chat-completions model of its public list, with an
      // empty message list and no message ever. 401 or 403 = the key is refused; any other 4xx (400 for the empty list) = the key was accepted. No model runs.
      const model = await ocCheckModel(cfg, fetchImpl);
      const r = await fetchImpl(`${ocBase(cfg.plan)}/openai/v1/chat/completions`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json", "user-agent": OC_AGENT, "x-opencode-session": ocSession(cfg, null, "test") }, body: JSON.stringify({ model, messages: [] }) });
      r.body?.cancel?.().catch?.(() => {});
      if (r.status === 401 || r.status === 403) return bad({ byok: true, detail: `error ${r.status}`, http: r.status }, TEST_FAIL_OC);
      if (r.status < 400 || r.status >= 500) return bad({ byok: true, detail: `error ${r.status}` });   // an answer that isn't a refusal of the request itself
      return done(true, { ok: true, ms: Date.now() - t0 }, t0);
    }
    if (cfg.kind === "openrouter") {
      const r = await fetchImpl(`${OR_BASE}/key`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${cfg.key}`, accept: "application/json", "user-agent": "1Helm" } });
      r.body?.cancel?.().catch?.(() => {});
      if (!r.ok) return bad({ byok: true, detail: `error ${r.status}` });
      return done(true, { ok: true, ms: Date.now() - t0 }, t0);
    }
    const j = await byokModelsJson(cfg, { fetchImpl }), n = (Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : Array.isArray(j?.models) ? j.models : []).length;
    return done(true, { ok: true, ms: Date.now() - t0, models: n }, t0);
  } catch (e) { return cfg.kind === "chatgpt" && e?.http === 401 ? bad(e, TEST_FAIL_CG_SIGNIN) : bad(e); }
}
export { KEY_RE as CONN_KEY_RE };

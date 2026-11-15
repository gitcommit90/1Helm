// The self-hosted owner's own AI key with one saved address, key and model (the core path, used when ONEHELM_EE is not set).
// The licensed services layer (src/ee/byok-connections.js and its siblings) holds several connections at once and is used only with ONEHELM_EE; src/byok.js
// sends every call and every route here when it is off, so a public install keeps this behavior: one OpenAI-compatible endpoint or Sign in with OpenRouter,
// Test connection, the provider note and the sealed key that never comes back (only its last 4 characters).
import { sealSecret, openSecret } from "./sentinel.js";
import { boundedJson } from "./bounded-body.js";
import { OR_SOURCE, OR_BASE, orDdl, orPendingKey, orForget, orView, orModels } from "./byok-openrouter.js";
import { byokChat, checkBase, readCapped, redact, withKey, TEST_FAIL, TEST_LIMIT, TEST_WINDOW_MS, ZDR_WARNING } from "./byok.js";

const appUrl = (env, slug, sec = "byok") => `https://${env.GATEWAY_HOST || env.APP_HOST}/w/${slug}/app?settings=${sec}`;

// ---- Test connection: reach + tool calling (main model), streaming (main model), and the fast model if it's different ----
// Every failed check: the one standard message, then a short detail line from the actual error (key stripped).
const testErr = (cfg, e, prefix = "") => {
  const detail = `${prefix}${e?.byok ? e.detail || "" : redact(e?.message || e, cfg.key, 100)}`.replace(/\.$/, "");
  return { ok: false, error: detail ? `${TEST_FAIL} Details: ${detail}.` : TEST_FAIL, detail };
};
const PING_TOOL = { type: "function", function: { name: "ping", description: "Connection test. Call it with word set to \"ok\".", parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] } } };
export async function testByok(cfg, { fetchImpl = globalThis.fetch } = {}) {
  const t0 = Date.now(), checks = {};
  const done = () => ({ ok: ["reach", "tools", "stream", "fast"].every((k) => !checks[k] || checks[k].ok), checks, ms: Date.now() - t0, at: Date.now() });
  try {
    const s = Date.now(), r = await byokChat(cfg, { messages: [{ role: "system", content: "This is a connection test. Answer only by calling the ping tool." }, { role: "user", content: "Call the ping tool with word set to \"ok\"." }],
      tools: [PING_TOOL], max_tokens: 2000 }, { fetchImpl }), j = await r.json();
    checks.reach = { ok: true, ms: Date.now() - s, model: String(j.model || cfg.model).slice(0, 120) };
    const call = (j.choices?.[0]?.message?.tool_calls || [])[0];
    checks.tools = call?.function?.name === "ping" ? { ok: true } : testErr(cfg, { byok: true, detail: "the model answered in words instead of calling a tool; 1Helm needs a model with tool (function) calling" });
  } catch (e) { checks.reach = testErr(cfg, e); return done(); }
  try {
    const r = await byokChat(cfg, { messages: [{ role: "user", content: "Reply with the word OK." }], stream: true, max_tokens: 400 }, { fetchImpl });
    const text = await readCapped(cfg, r.body, 1 << 20);
    const evs = text.split("\n").filter((l) => l.startsWith("data:") && l.slice(5).trim() !== "[DONE]").map((l) => { try { return JSON.parse(l.slice(5)); } catch { return null; } }).filter(Boolean);
    checks.stream = evs.some((e) => Array.isArray(e.choices)) ? { ok: true, events: evs.length } : testErr(cfg, { byok: true, detail: "the service didn't stream its answer; 1Helm needs streaming (stream: true)" });
  } catch (e) { checks.stream = testErr(cfg, e); }
  if (cfg.fast && cfg.fast !== cfg.model) {
    try { const r = await byokChat(cfg, { messages: [{ role: "user", content: "Reply with the word OK." }], max_tokens: 400 }, { fast: true, fetchImpl }); await r.json(); checks.fast = { ok: true, model: cfg.fast }; }
    catch (e) { checks.fast = testErr(cfg, e, `fast model ${cfg.fast}: `); }
  }
  return done();
}


async function byokRow(env, tenantId) {
  const q = (mode) => env.DB.prepare(`SELECT t.plan, t.slug, t.helper_name, b.base_url, b.model, b.fast_model, b.key_sealed, b.key_last4${mode ? ", b.mode" : ""} FROM tenants t LEFT JOIN byok b ON b.tenant_id=t.id WHERE t.id=?`).bind(tenantId).first();
  try { return await q(true); } catch (e) { if (/no such column/i.test(String(e?.message))) return q(false); throw e; }   // before migration 033
}
// { base, host, model, fast, settings, credits, last4, key (hidden) }, or { missing: true } when no key is saved yet. Without the licensed plans every account counts as on the one self-hosted plan.
export async function singleKeyConfig(env, tenantId) {
  if (!env?.DB || !tenantId) return null;
  const r = await byokRow(env, tenantId);
  if (!r) return null;
  const settings = appUrl(env, r.slug), credits = appUrl(env, r.slug, "credits");
  if (r.key_sealed == null || !r.base_url || !r.model) return { missing: true, settings };
  const chk = checkBase(r.base_url);
  let key = ""; if (r.key_sealed) try { key = await openSecret(env, r.key_sealed); } catch { return { missing: true, unreadable: true, settings }; }   // never fall back to 1Helm's AI
  return withKey({ base: r.base_url, host: chk.host || "", model: r.model, fast: r.fast_model || r.model, last4: r.key_last4 || "", settings, credits, helper: r.helper_name || "" }, key);
}

// ---- Settings API (/api/byok…) ----
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const KEY_RE = /^[^\x00-\x1f\x7f]{0,4000}$/;   // any length, even empty (no key); only no line breaks/control characters (it goes into a header)
const now = () => Date.now();
async function savedRow(env, tid) { return env.DB.prepare("SELECT * FROM byok WHERE tenant_id=?").bind(tid).first(); }
function view(row) {
  if (!row) return null;
  let test = null; try { test = row.test_json ? JSON.parse(row.test_json) : null; } catch {}
  return { base: row.base_url, host: checkBase(row.base_url).host || "", model: row.model, fast: row.fast_model || "", last4: row.key_last4 || "", saved_at: row.updated_at, tested_at: row.tested_at || null, test, ...(row.source === OR_SOURCE ? { source: OR_SOURCE } : {}) };   // source: signed in with OpenRouter
}
// Fields from the form → a config to test/save. The key may be left empty: with a saved key, that keeps it, but only for the same
// origin (scheme + host + port): pointing the saved key at a different address needs the key typed again. With no saved key (or a
// saved empty one), empty means no key at all (self-hosted servers like Ollama, LM Studio, vLLM): no Authorization header is sent.
// source "openrouter" (Sign in with OpenRouter, byok-openrouter.js): the address is OpenRouter's and the key is the one the sign-in
// gave (waiting in byok_or_key), or the saved one when it came from that sign-in too (only the models change). Never a typed key.
async function formCfg(env, t, b, row) {
  const or = b.source === OR_SOURCE;
  const chk = checkBase(or ? OR_BASE : b.base); if (!chk.ok) return { error: chk.error, field: "base" };
  const model = String(b.model ?? "").trim(), fast = String(b.fast ?? "").trim();
  if (!MODEL_RE.test(model)) return { error: "Enter the model name exactly as your service lists it, like gpt-4o-mini.", field: "model" };
  if (fast && !MODEL_RE.test(fast)) return { error: "Enter the fast model's name exactly as your service lists it, or leave it empty.", field: "fast" };
  let key = or ? "" : String(b.key ?? "").trim();
  if (or) {
    const waiting = await orPendingKey(env, t.id);
    if (waiting != null) key = waiting;
    else if (row?.source === OR_SOURCE && row.key_sealed) { try { key = await openSecret(env, row.key_sealed); } catch { return { error: "Sign in with OpenRouter again.", field: "or" }; } }
    else return { error: "Sign in with OpenRouter first.", field: "or" };
    if (!key || !KEY_RE.test(key)) return { error: "Sign in with OpenRouter again.", field: "or" };
  } else if (!key) {
    if (row?.key_sealed) {
      if (checkBase(row.base_url).origin !== chk.origin) return { error: "You changed the address, so enter the key again.", field: "key" };
      try { key = await openSecret(env, row.key_sealed); } catch { return { error: "Enter your key again.", field: "key" }; }
    }
  } else if (!KEY_RE.test(key)) return { error: "That key doesn't look right: it should be one line, up to 4000 characters.", field: "key" };
  return { cfg: withKey({ base: chk.base, host: chk.host, model, fast: fast && fast !== model ? fast : model, last4: key.slice(-4) }, key), fastIn: fast && fast !== model ? fast : "", source: or ? OR_SOURCE : "" };
}
async function rateOk(env, tid) {
  await env.DB.prepare("DELETE FROM byok_tests WHERE at<?").bind(now() - 3600e3).run().catch(() => {});
  const n = Number((await env.DB.prepare("SELECT COUNT(*) n FROM byok_tests WHERE tenant_id=? AND at>?").bind(tid, now() - TEST_WINDOW_MS).first())?.n || 0);
  if (n >= TEST_LIMIT) return false;
  await env.DB.prepare("INSERT INTO byok_tests (tenant_id, at) VALUES (?,?)").bind(tid, now()).run();
  return true;
}
const RATE_MSG = "That's a lot of tests in a few minutes. Wait a few minutes and try again.";
const ownMain = () => ({ on: false, model: null });
function stateOf(env, t, row) {
  return { on_plan: true, full: false, plan: t.plan || "", plan_name: "Self-hosted", price: 0, warning: ZDR_WARNING, saved: view(row), mode: "",
    openrouter: null, custom: ownMain() };
}
// t: the tenant row. Returns a Response, or null when `sub` isn't a BYOK route.
export async function singleKeyApi(req, env, t, sub, { json, fetchImpl = globalThis.fetch } = {}) {
  if (!/^\/api\/byok(\/(test|save|delete|mode|switch-now|models|switch-preview|openrouter\/forget))?$/.test(sub)) return null;
  if (sub === "/api/byok/mode" || sub === "/api/byok/switch-now" || sub === "/api/byok/switch-preview") return json({ error: "not found" }, 404);
  await orDdl(env);
  const state = async (row) => ({ ...stateOf(env, t, row), openrouter: await orView(env, t.id, row).catch(() => ({ pending: null, manage: "" })) });
  if (sub === "/api/byok" && req.method === "GET") return json(await state(await savedRow(env, t.id)));
  // OpenRouter's model list for the model fields (only models with tool calling; public, no key involved).
  if (sub === "/api/byok/models" && req.method === "GET") { try { return json({ models: await orModels({ fetchImpl }) }); } catch (e) { console.log("byok: openrouter models", String(e?.message || e).slice(0, 80)); return json({ models: [], error: "Couldn't load OpenRouter's model list. You can still type a model name." }); } }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (sub === "/api/byok/delete") {
    await boundedJson(req);
    await env.DB.prepare("DELETE FROM byok WHERE tenant_id=?").bind(t.id).run();
    await orForget(env, t.id);   // a key from Sign in with OpenRouter that was still waiting for its models goes too
    return json({ ok: true, ...(await state(null)) });
  }
  // Signed in with OpenRouter but changed their mind before saving: forget only the waiting key (a saved setup stays).
  if (sub === "/api/byok/openrouter/forget") { await orForget(env, t.id); return json({ ok: true, ...(await state(await savedRow(env, t.id))) }); }
  const b = await boundedJson(req), row = await savedRow(env, t.id);
  const f = await formCfg(env, t, b, row); if (f.error) return json({ error: f.error, field: f.field }, 400);
  if (sub === "/api/byok/save" && b.ack !== true) return json({ error: "Read the note about your provider and tick the box to save.", field: "ack" }, 400);
  if (!(await rateOk(env, t.id))) return json({ error: RATE_MSG, rate_limited: true }, 429);
  const test = await testByok(f.cfg, { fetchImpl });
  if (sub === "/api/byok/test") return json({ ok: test.ok, test });
  if (!test.ok) return json({ error: "Not saved: the connection test didn't pass. Fix what it says and try again.", test }, 400);
  const at = now();
  await env.DB.prepare(`INSERT INTO byok (tenant_id,base_url,model,fast_model,key_sealed,key_last4,test_json,tested_at,created_at,updated_at,source) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET base_url=excluded.base_url, model=excluded.model, fast_model=excluded.fast_model, key_sealed=excluded.key_sealed, key_last4=excluded.key_last4,
      test_json=excluded.test_json, tested_at=excluded.tested_at, updated_at=excluded.updated_at, source=excluded.source`)
    .bind(t.id, f.cfg.base, f.cfg.model, f.fastIn, f.cfg.key ? await sealSecret(env, f.cfg.key) : "", f.cfg.last4, JSON.stringify(test), test.at, at, at, f.source).run();
  await orForget(env, t.id);   // saved: a waiting OpenRouter key is now this row (or was set aside for a pasted key)
  return json({ ok: true, test, ...(await state(await savedRow(env, t.id))) });
}

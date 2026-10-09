// Hindsight memory server (Hetzner box), the official memory of 1HC dev (Captain 2026-10-04).
// Reached privately through Workers VPC service 1hc-hindsight over Cloudflare Tunnel 1hc-hindsight. No public hostname.
// Every request also carries HINDSIGHT_API_KEY. One bank per person (tenant) per channel: `${ENV_NAME}-${tenant}-${channel}`.
// Hindsight is used as-is: retain (async, its own extraction/observations) and recall (its 4 arms + reranker).
import { markStatus } from "./status-notes.js";   // a record of a pause / limit notice reads as a past status note
import { scrubSecrets } from "./secrets-scrub.js";
const ORIGIN = "http://hindsight.internal";
export const hsOn = (env) => !!(env.HINDSIGHT && env.HINDSIGHT_API_KEY && env.MEMORY_BACKEND === "hindsight");
export const bankId = (env, tenant, channel) => `${env.ENV_NAME || "dev"}-${tenant}-${channel}`.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 200);

export async function hs(env, path, { method = "GET", body, timeoutMs = 15000 } = {}) {
  if (!env.HINDSIGHT) throw new Error("HINDSIGHT binding missing");
  const r = await env.HINDSIGHT.fetch(`${ORIGIN}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.HINDSIGHT_API_KEY}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  if (!r.ok) { const e = new Error(`hindsight ${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`); e.status = r.status; throw e; }
  return text ? JSON.parse(text) : null;
}
const B = (bank) => `/v1/default/banks/${encodeURIComponent(bank)}`;

// Create (idempotent PUT). Banks are also auto-created by the first retain.
export const ensureBank = (env, bank) => hs(env, B(bank), { method: "PUT", body: {} });
export const deleteBank = (env, bank) => hs(env, B(bank), { method: "DELETE" });
// Every bank of this env whose id contains `q` (Hindsight's substring filter), paged.
export async function listBanks(env, q = "") {
  const out = [];
  for (let off = 0; ; off += 100) {
    const r = await hs(env, `/v1/default/banks?limit=100&offset=${off}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
    out.push(...(r?.banks || [])); if (!r?.banks?.length || out.length >= (r.total ?? 0)) break;
  }
  return out;
}
const tenantPrefix = (env, tenant) => bankId(env, tenant, "x").slice(0, -1);
// Deletion hooks: call when a channel or a whole account is deleted. A missing bank is fine (404 = already gone).
export async function forgetChannel(env, tenant, channel) {
  try { await deleteBank(env, bankId(env, tenant, channel)); return { deleted: 1 }; } catch (e) { if (e.status === 404) return { deleted: 0 }; throw e; }
}
// One document (and every memory and observation Hindsight drew from it): "turn-<id>" for a chat turn, "fact-<ledger id>" for a
// remembered fact or Notebook note. 404 = not there (never retained, already deleted, or its async retain hasn't landed yet).
export async function forgetDocument(env, bank, docId) {
  try { const r = await hs(env, `${B(bank)}/documents/${encodeURIComponent(docId)}`, { method: "DELETE" }); return { deleted: 1, units: Number(r?.memory_units_deleted || 0) }; }
  catch (e) { if (e.status === 404) return { deleted: 0 }; throw e; }
}
export async function forgetTenant(env, tenant) {
  const pre = tenantPrefix(env, tenant), banks = (await listBanks(env, pre)).filter((b) => b.bank_id.startsWith(pre));
  for (const b of banks) await deleteBank(env, b.bank_id).catch((e) => { if (e.status !== 404) throw e; });
  return { deleted: banks.length, banks: banks.map((b) => b.bank_id) };
}
// Nightly sweep: delete this env's banks whose account no longer exists (D1 tenants) or whose channel is gone from the
// account's channel list. Deletes only on a definite "doesn't exist" answer; any lookup error skips that bank. Banks younger
// than 1 h are left alone. dry=true reports without deleting.
const BANK_RE = /^(.+?)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/;
export async function sweepBanks(env, { channelsOf, dry = false, graceMs = 3600e3 } = {}) {
  const envName = env.ENV_NAME || "dev", banks = await listBanks(env, `${envName}-`), byTenant = new Map(), skipped = [];
  for (const b of banks) {
    const m = b.bank_id.match(BANK_RE); if (!m || m[1] !== envName) continue;
    if (Date.now() - Date.parse(b.created_at || 0) < graceMs) { skipped.push({ bank: b.bank_id, why: "new" }); continue; }
    if (!byTenant.has(m[2])) byTenant.set(m[2], []); byTenant.get(m[2]).push({ bank: b.bank_id, channel: m[3] });
  }
  const ids = [...byTenant.keys()], live = new Set();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50), r = await env.DB.prepare(`SELECT id FROM tenants WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part).all();
    for (const x of r.results) live.add(x.id);
  }
  const doomed = [];
  for (const [tid, list] of byTenant) {
    if (!live.has(tid)) { for (const x of list) doomed.push({ ...x, why: "account deleted" }); continue; }
    let chans; try { chans = await channelsOf(tid); } catch (e) { for (const x of list) skipped.push({ bank: x.bank, why: `channel lookup failed: ${e.message}` }); continue; }
    if (!chans?.length) { for (const x of list) skipped.push({ bank: x.bank, why: "account has no channel list" }); continue; }
    const have = new Set(chans.map((c) => bankId(env, tid, c.slug || c.name)));
    for (const x of list) if (!have.has(x.bank)) doomed.push({ ...x, why: "channel deleted" });
  }
  if (!dry) for (const d of doomed) await deleteBank(env, d.bank).catch((e) => { if (e.status !== 404) d.error = e.message; });
  return { env: envName, banks: banks.length, accounts: ids.length, deleted: dry ? 0 : doomed.filter((d) => !d.error).length, doomed, skipped, dry };
}
export const bankStats = (env, bank) => hs(env, `${B(bank)}/stats`).catch((e) => ({ error: e.message }));

// items: [{ content, at (ms), context, document_id, metadata }]. async: Hindsight extracts in the background (~9 s each), never blocks a reply.
// nosecrets: the one way into Hindsight, so every item's text (turns, facts, upkeep, unfinished work) goes in with its secrets removed.
export async function retain(env, bank, items) {
  const list = items.filter((i) => String(i.content || "").trim()).map((i) => ({
    content: scrubSecrets(String(i.content)).slice(0, 20000), timestamp: new Date(i.at || Date.now()).toISOString(),
    ...(i.context ? { context: scrubSecrets(String(i.context)).slice(0, 300) } : {}), ...(i.document_id ? { document_id: String(i.document_id) } : {}),
    ...(i.metadata ? { metadata: Object.fromEntries(Object.entries(i.metadata).filter(([, v]) => v != null).map(([k, v]) => [k, scrubSecrets(String(v))])) } : {}),
  }));
  if (!list.length) return null;
  return hs(env, `${B(bank)}/memories`, { method: "POST", body: { items: list, async: true }, timeoutMs: 20000 });
}

// Recall. A missing bank (nothing retained yet) is an empty result, not an error.
export async function recall(env, bank, query, o = {}) {
  const t0 = Date.now();
  try {
    const body = { query: String(query).slice(0, 2000), budget: o.budget || "mid", max_tokens: o.maxTokens || 2500, include: { entities: null },
      query_timestamp: new Date(o.now || Date.now()).toISOString(),
      ...(o.scope && (o.scope.from || o.scope.to) ? { temporal_window: { start: new Date(o.scope.from || 0).toISOString(), end: new Date(o.scope.to || Date.now()).toISOString() } } : {}) };
    const r = await hs(env, `${B(bank)}/memories/recall`, { method: "POST", body, timeoutMs: o.timeoutMs || 6000 });
    return { results: r?.results || [], ms: Date.now() - t0 };
  } catch (e) { if (e.status === 404) return { results: [], ms: Date.now() - t0 }; throw e; }
}

// One line per memory: date (person's tz) · kind · where it came from, then the memory. Observations are Hindsight's consolidated
// beliefs; world/experience are facts drawn from what was said. Newest-first ordering is left to the model via dates.
const KIND = { world: "fact", experience: "what happened", observation: "summary of several records" };
export function packHs(results, o = {}) {
  const max = o.maxChars ?? 6000, fmt = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? (o.localDay ? o.localDay(t, o.tz) : new Date(t).toISOString().slice(0, 10)) : "undated"; };
  let used = 0; const out = [];
  for (const r of results) {
    const when = r.occurred_start && r.occurred_start !== r.mentioned_at ? ` · about ${fmt(r.occurred_start)}${r.occurred_end && fmt(r.occurred_end) !== fmt(r.occurred_start) ? `–${fmt(r.occurred_end)}` : ""}` : "";
    // nosecrets: a memory retained before the scrub (or drawn by Hindsight from one) still recalls without its secret.
    const line = `[${fmt(r.mentioned_at)}${when} · ${KIND[r.type] || r.type || "memory"}${r.context ? ` · ${scrubSecrets(r.context)}` : ""}] ${markStatus(scrubSecrets(String(r.text)).slice(0, 900))}`;
    if (used + line.length > max) continue; used += line.length; out.push(line);
  }
  return out.join("\n");
}

// Dev-only self-test: retain one note (sync) in a throwaway bank, recall it 3x, delete the bank. Returns timings.
export async function hindsightSelfTest(env) {
  const bank = `selftest-${Date.now()}`, t = {}, t0 = Date.now();
  let s = Date.now();
  t.banks_list_ms = (await hs(env, "/v1/default/banks"), Date.now() - s);
  try {
    s = Date.now();
    await hs(env, `${B(bank)}/memories`, { method: "POST", body: { items: [{ content: "Joseph's test boat is named Larkspur and is moored at slip 14.", timestamp: new Date().toISOString() }] }, timeoutMs: 60000 });
    t.retain_ms = Date.now() - s;
    const recalls = [];
    for (let i = 0; i < 3; i++) { const r = await recall(env, bank, "What is the boat called and where is it?"); recalls.push({ ms: r.ms, hit: JSON.stringify(r.results).includes("Larkspur") }); }
    t.recalls = recalls;
  } finally { s = Date.now(); await deleteBank(env, bank); t.delete_ms = Date.now() - s; }
  t.total_ms = Date.now() - t0;
  return t;
}

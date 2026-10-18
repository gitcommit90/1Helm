// Hindsight memory server (Hetzner box), the official memory of 1HC dev (Captain 2026-10-04).
// Reached privately through Workers VPC service 1hc-hindsight over Cloudflare Tunnel 1hc-hindsight. No public hostname.
// Every request also carries HINDSIGHT_API_KEY. One bank per person (tenant) per channel: `${ENV_NAME}-${tenant}-${channel}`.
// Hindsight is used as-is: retain (async, its own extraction/observations) and recall (its 4 arms + reranker).
import { markStatus } from "./status-notes.js";   // a record of a pause / limit notice reads as a past status note
import { scrubSecrets } from "./secrets-scrub.js";
import { hsFoundations } from "./hindsight-template.js";   // HS_FOUNDATIONS: Memory Overhaul phase 2 (bank templates, safe deletes, health)
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
export const bankPath = B;

// Create (idempotent PUT). Banks are also auto-created by the first retain.
export async function ensureBank(env, bank) { await assertBankCap(env, bank); return hs(env, B(bank), { method: "PUT", body: {} }); }
export const deleteBank = (env, bank) => { KNOWN_BANKS.delete(bank); return hs(env, B(bank), { method: "DELETE" }); };

// Environment cap on the number of banks (Captain, 2026-10-18: dev holds at most 60 Hindsight banks even while testing). HS_BANK_CAP is set only in
// wrangler.dev.jsonc (an environment cap, like a container max_instances), so Live has no cap. Every dev bank counts: `dev-...` channel banks and
// `a2a-dev-...` agent record banks. A bank that already exists never trips the cap. Called before a bank is created (ensureBank, the agent bank PUT
// and the first retain into a bank this Worker has not seen), and it costs one bank listing per new bank id per Worker instance.
const KNOWN_BANKS = new Set();
export const bankCap = (env) => { const n = Number(env?.HS_BANK_CAP); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
export const isEnvBank = (env, id) => { const e = env?.ENV_NAME || "dev"; return String(id).startsWith(`${e}-`) || String(id).startsWith(`a2a-${e}-`); };
export async function assertBankCap(env, bank) {
  const cap = bankCap(env); if (!cap || KNOWN_BANKS.has(bank)) return;
  const ids = (await listBanks(env, `${env.ENV_NAME || "dev"}-`)).map((b) => b.bank_id).filter((id) => isEnvBank(env, id));
  if (!ids.includes(bank) && ids.length >= cap) throw Object.assign(new Error(`bank limit reached: ${env.ENV_NAME || "dev"} already has ${ids.length} Hindsight banks and the limit is ${cap}. Delete banks that are not needed first.`), { status: 429, code: "bank_cap" });
  KNOWN_BANKS.add(bank);
}

// ---- Phase 2 client additions (DESIGN.md 3.1): each one is a thin wrapper over one endpoint. Existing exports above and below are unchanged. ----
// Apply a bank template (config, mental models, directives). Creates the bank when it is missing. dryRun validates only.
export const applyTemplate = (env, bank, manifest, { dryRun = false } = {}) => hs(env, `${B(bank)}/import${dryRun ? "?dry_run=true" : ""}`, { method: "POST", body: manifest, timeoutMs: 30000 });
// Create the bank, then import its template (a bank is never left to be created by its first retain).
// manual: the bank belongs to a test account, so its mental models have no automatic trigger (testBankManifest) and any refresh the import queues is cancelled.
export async function setupBank(env, bank, manifest, { manual = false } = {}) { await ensureBank(env, bank); await syncMentalModelTriggers(env, bank, manifest, { manual }); return importTemplate(env, bank, manifest, { manual }); }
// Import a template. For a test account's bank (manual) the refresh operations the import queued for new models are cancelled at once,
// so a bank that nobody is testing with costs no model call (Captain, 2026-10-18).
export async function importTemplate(env, bank, manifest, { manual = false } = {}) {
  const r = await applyTemplate(env, bank, manifest);
  if (manual) for (const id of r?.operation_ids || []) await cancelOperation(env, bank, id).catch((e) => console.log("hindsight cancel refresh", e.message));
  return r;
}
// The template for a test account's bank: every mental model keeps its text and loses its automatic trigger (no refresh_cron, no
// refresh_after_consolidation), so it refreshes only when someone asks for it. Live has no such accounts, so Live never calls this.
export function testBankManifest(manifest) {
  return { ...manifest, mental_models: (manifest?.mental_models || []).map((m) => ({ ...m, trigger: { mode: m.trigger?.mode || "full" } })) };
}
export const getConfig = (env, bank) => hs(env, `${B(bank)}/config`);
export const listOperations = (env, bank, { status, type, limit = 100, offset = 0 } = {}) =>
  hs(env, `${B(bank)}/operations?limit=${limit}&offset=${offset}${status ? `&status=${encodeURIComponent(status)}` : ""}${type ? `&type=${encodeURIComponent(type)}` : ""}`);
// 409 = the operation already finished, 404 = already gone: both mean there is nothing left to cancel.
export async function cancelOperation(env, bank, id) {
  try { return await hs(env, `${B(bank)}/operations/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  catch (e) { if (e.status === 404 || e.status === 409) return null; throw e; }
}
// Cancel every pending and processing operation of a bank (a queued retain would otherwise write facts after a delete).
// Returns the ids it cancelled. A bank that does not exist has nothing queued.
export async function cancelPending(env, bank) {
  const cancelled = [];
  for (const status of ["pending", "processing"]) {
    let r; try { r = await listOperations(env, bank, { status }); } catch (e) { if (e.status === 404) return cancelled; throw e; }
    for (const op of r?.operations || []) { if (await cancelOperation(env, bank, op.id)) cancelled.push(op.id); }
  }
  return cancelled;
}
// Queued or running operations of a bank, as short rows (a missing bank has none).
export async function queuedOperations(env, bank) {
  const out = [];
  for (const status of ["pending", "processing"]) {
    try { const r = await listOperations(env, bank, { status }); for (const op of r?.operations || []) out.push({ id: op.id, type: op.task_type, status: op.status || status }); }
    catch (e) { if (e.status !== 404) throw e; }
  }
  return out;
}
// Clear the failed flag on permanently failed facts, then queue a consolidation so they are retried. Returns how many facts were retried.
export async function recoverConsolidation(env, bank) {
  const r = await hs(env, `${B(bank)}/consolidation/recover`, { method: "POST" });
  const retried = Number(r?.retried_count || 0);
  if (retried > 0) await hs(env, `${B(bank)}/consolidate`, { method: "POST", body: {} });
  return { retried };
}
export const listMentalModels = (env, bank) => hs(env, `${B(bank)}/mental-models`);
// Change only the trigger of one mental model (PATCH, no refresh, no model call). Hindsight merges the fields sent over the stored trigger.
export const patchMentalModelTrigger = (env, bank, id, trigger) => hs(env, `${B(bank)}/mental-models/${encodeURIComponent(id)}`, { method: "PATCH", body: { trigger } });
// Bring the triggers of a bank's existing mental models to the template's (the cron schedule instead of refresh after consolidation).
// A bank import also changes a differing trigger, but then queues a full refresh of that model (an LLM run each), so this runs first with PATCH:
// afterwards the stored trigger equals the template's and the import leaves the model alone. Models the bank does not have yet are skipped
// (the import creates them). dryRun reads and counts only. Throws when a PATCH fails, so the caller does not run the import and its refreshes.
// -> { checked, patched, before: { cron, after_consolidation, other }, after: { ... }, ids: [patched ids] }
// manual: a test account's bank. The wanted trigger is "none": no refresh_cron, no refresh_after_consolidation, no minimum interval.
export async function syncMentalModelTriggers(env, bank, manifest, { dryRun = false, manual = false } = {}) {
  const want = new Map((manifest?.mental_models || []).filter((m) => manual || m.trigger?.refresh_cron).map((m) => [m.id, manual ? {} : m.trigger]));
  const kindOf = (t) => (t?.refresh_cron ? "cron" : t?.refresh_after_consolidation ? "after_consolidation" : "other");
  const out = { checked: 0, patched: 0, before: { cron: 0, after_consolidation: 0, other: 0 }, after: { cron: 0, after_consolidation: 0, other: 0 }, ids: [] };
  if (!want.size) return out;
  // detail=content: the list's default (metadata) leaves the trigger out, and the config-only level is not offered over HTTP.
  let items; try { items = (await hs(env, `${B(bank)}/mental-models?detail=content&limit=100`, { timeoutMs: 30000 }))?.items || []; } catch (e) { if (e.status === 404) return out; throw e; }
  for (const m of items) {
    const t = want.get(m.id); if (!t) continue;
    const cur = m.trigger || {}; out.checked++; out.before[kindOf(cur)]++;
    const same = (cur.refresh_cron || null) === (t.refresh_cron || null) && !cur.refresh_after_consolidation && cur.min_refresh_interval_seconds == null;
    if (!same) {
      if (!dryRun) await patchMentalModelTrigger(env, bank, m.id, { refresh_cron: t.refresh_cron || null, refresh_after_consolidation: false, min_refresh_interval_seconds: null });
      out.patched++; out.ids.push(m.id);
    }
    out.after[dryRun && !same ? kindOf(cur) : manual ? "other" : "cron"]++;
  }
  return out;
}
export const refreshMentalModel = (env, bank, id) => hs(env, `${B(bank)}/mental-models/${encodeURIComponent(id)}/refresh`, { method: "POST", body: {} });

// A bank delete that first cancels queued work and afterwards lists what is still queued (logged, and returned for the caller).
// With HS_FOUNDATIONS off this is the plain delete. Cancel and list errors never stop the delete itself.
async function deleteBankSafely(env, bank) {
  if (!hsFoundations(env)) { await deleteBank(env, bank); return { cancelled: 0, queued: [] }; }
  let cancelled = [];
  try { cancelled = await cancelPending(env, bank); } catch (e) { console.log("hindsight cancel before delete", bank.slice(0, 12), e.message); }
  await deleteBank(env, bank);
  let queued = []; try { queued = await queuedOperations(env, bank); } catch (e) { console.log("hindsight re-list after delete", e.message); }
  if (queued.length) console.log("hindsight: operations still queued after bank delete", JSON.stringify({ bank: bank.slice(0, 12), queued: queued.slice(0, 10) }));
  return { cancelled: cancelled.length, queued };
}
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
  try { const r = await deleteBankSafely(env, bankId(env, tenant, channel)); return { deleted: 1, ...(r.queued.length ? { queued: r.queued.length } : {}) }; } catch (e) { if (e.status === 404) return { deleted: 0 }; throw e; }
}
// One document (and every memory and observation Hindsight drew from it): "turn-<id>" for a chat turn, "fact-<ledger id>" for a
// remembered fact or Notebook note. 404 = not there (never retained, already deleted, or its async retain hasn't landed yet).
export async function forgetDocument(env, bank, docId) {
  try { const r = await hs(env, `${B(bank)}/documents/${encodeURIComponent(docId)}`, { method: "DELETE" }); return { deleted: 1, units: Number(r?.memory_units_deleted || 0) }; }
  catch (e) { if (e.status === 404) return { deleted: 0 }; throw e; }
}
export async function forgetTenant(env, tenant) {
  const pre = tenantPrefix(env, tenant), banks = (await listBanks(env, pre)).filter((b) => b.bank_id.startsWith(pre));
  let queued = 0;
  for (const b of banks) { const r = await deleteBankSafely(env, b.bank_id).catch((e) => { if (e.status !== 404) throw e; return null; }); queued += r?.queued.length || 0; }
  return { deleted: banks.length, banks: banks.map((b) => b.bank_id), ...(queued ? { queued } : {}) };
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
  if (!dry) for (const d of doomed) await deleteBankSafely(env, d.bank).then((r) => { if (r.queued.length) d.queued = r.queued.length; }).catch((e) => { if (e.status !== 404) d.error = e.message; });
  return { env: envName, banks: banks.length, accounts: ids.length, deleted: dry ? 0 : doomed.filter((d) => !d.error).length, doomed, skipped, dry };
}
export const bankStats = (env, bank) => hs(env, `${B(bank)}/stats`).catch((e) => ({ error: e.message }));

// ---- Phase 3 client additions (DESIGN.md 3.1): retainV2 and the reads the writers and the rebuild need. ----
// No length cut on what retainV2 sends (Captain 2026-10-14). HS_DOC_MAX is kept as a reference size only (the largest documents the
// writers were sized for); nothing is cut to it.
export const HS_DOC_MAX = 400000;
// A UUID made from text (Hindsight requires operation_id to be a UUID). Same text, same UUID, so a repeated request is the same operation.
export async function opUuid(...parts) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.map(String).join("\u0001")))), b = d.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; b[8] = (b[8] & 0x3f) | 0x80;   // version 5 style, variant 10
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const contentHash = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))))].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
// Secret scrubbing for text that is a JSON array or object (a conversation): every string inside is scrubbed on its own and the JSON is
// written again, so a replacement can never break the JSON. Anything else is scrubbed as plain text.
export function scrubContent(c) {
  const t = typeof c === "string" ? c : JSON.stringify(c);
  const walk = (x) => typeof x === "string" ? scrubSecrets(x) : Array.isArray(x) ? x.map(walk) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)])) : x;
  if (/^\s*[\[{]/.test(t)) { try { return JSON.stringify(walk(JSON.parse(t))); } catch {} }
  return scrubSecrets(t);
}
// items: [{ content (text, or an array / object that is sent as JSON), at (ms), context, document_id (required), metadata, strategy, tags,
//   update_mode ("replace" | "append"), observation_scopes (default "shared"), key (extra text for the operation id, e.g. a turn id) }].
// Async. Every request carries an operation_id made from the document ids and a hash of each item (so a retry of the same request is the
// same operation and never writes twice), and one request holds one strategy, because Hindsight 1.0.0 refuses an operation_id with items of
// several strategies (HTTP 400) and an async request with a repeated document id (HTTP 400). Secrets are scrubbed from content, context and
// metadata. opts.operationId sets the id of a single request (several strategies derive one id each from it).
// → { operation_ids: [...], items: n, skipped: n } | null when nothing was left to send.
export async function retainV2(env, bank, items, opts = {}) {
  const list = [];
  for (const i of items) {
    const raw = i.content == null ? "" : typeof i.content === "string" ? i.content : JSON.stringify(i.content);
    if (!raw.trim()) continue;
    if (!i.document_id) throw new Error("retainV2: every item needs a document_id (an append without one fails on the server, and a replace duplicates)");
    const content = scrubContent(raw), mode = i.update_mode === "append" ? "append" : "replace";
    const meta = i.metadata ? Object.fromEntries(Object.entries(i.metadata).filter(([, v]) => v != null).map(([k, v]) => [k, scrubSecrets(String(v))])) : null;
    list.push({ strategy: i.strategy || null, key: String(i.key ?? ""), hash: await contentHash(`${mode}\n${content}`), item: {
      content, timestamp: new Date(i.at || Date.now()).toISOString(), document_id: String(i.document_id), update_mode: mode,
      observation_scopes: i.observation_scopes || "shared",
      ...(i.context ? { context: scrubSecrets(String(i.context)) } : {}),
      ...(meta && Object.keys(meta).length ? { metadata: meta } : {}), ...(i.tags?.length ? { tags: i.tags.map(String) } : {}), ...(i.strategy ? { strategy: i.strategy } : {}),
      // Memory envelope (memory-envelope.js): people and places 1HC already knows, attached to every fact of the item with no model call.
      ...(i.resolve_entities === false ? { resolve_entities: false } : {}), ...(Array.isArray(i.entities) && i.entities.length ? { entities: i.entities.map((x) => ({ text: scrubSecrets(String(x.text)), ...(x.type ? { type: String(x.type) } : {}) })).filter((x) => x.text.trim()) } : {}) } });
  }
  if (!list.length) return null;
  await assertBankCap(env, bank);   // a retain creates a missing bank, so the cap applies here too
  const ids = list.map((x) => x.item.document_id);
  if (new Set(ids).size !== ids.length) throw Object.assign(new Error(`retainV2: a document id appears twice in one request (${ids.find((d, n) => ids.indexOf(d) !== n)}); send them in separate requests`), { status: 400 });
  const groups = new Map(); for (const x of list) { const k = x.strategy || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const operation_ids = [];
  for (const [strategy, g] of groups) {
    const operation_id = opts.operationId ? (groups.size === 1 ? opts.operationId : await opUuid(opts.operationId, strategy)) : await opUuid(bank, strategy, ...g.flatMap((x) => [x.item.document_id, x.hash, x.key]));
    opts.beforeSend?.(operation_id);   // scoped maintenance can fence a stale source immediately before submission
    const r = await hs(env, `${B(bank)}/memories`, { method: "POST", body: { items: g.map((x) => x.item), async: true, operation_id }, timeoutMs: opts.timeoutMs || 30000 });
    operation_ids.push(r?.operation_id || operation_id);
  }
  return { operation_ids, items: list.length };
}
// Documents of a bank (newest first), with memory_unit_count, text_length and tags. q is a substring of the document id.
export const listDocuments = (env, bank, { limit = 100, offset = 0, q } = {}) =>
  hs(env, `${B(bank)}/documents?limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
// Fresh counts (stats are cached for 60 seconds on the server): pending and failed operations, pending and failed consolidation.
export const freshStats = (env, bank) => hs(env, `${B(bank)}/stats?refresh=true`);
// What is still running on a bank, apart from mental model refreshes: Hindsight 1.0.0 leaves a refresh operation "pending" until the model's
// min refresh interval (900 seconds in our templates) has passed since its last refresh, and the bank stats count it in pending_operations,
// so a bank can show pending operations for 15 minutes with nothing left to do. → { work: n of retains, consolidation and the like, refresh: n, failed }.
export async function pendingWork(env, bank) {
  let work = 0, refresh = 0;
  for (const status of ["pending", "processing"]) {
    const r = await listOperations(env, bank, { status, limit: 100 }).catch((e) => { if (e.status === 404) return { operations: [] }; throw e; });
    for (const op of r?.operations || []) { if ((op.operation_type || op.task_type) === "refresh_mental_model") refresh++; else work++; }
  }
  return { work, refresh };
}
export const retryOperation = (env, bank, id) => hs(env, `${B(bank)}/operations/${encodeURIComponent(id)}/retry`, { method: "POST", body: {} });
// Hindsight's own reprocess: extract the facts of a stored document again from its stored text and retain parameters, as an async operation
// (it forces a new extraction, where a plain re-retain of unchanged content is skipped by the chunk comparison). → { operation_id }.
export const reprocessDocument = (env, bank, docId) => hs(env, `${B(bank)}/documents/${encodeURIComponent(docId)}/reprocess`, { method: "POST", body: {} });

// Recall. A missing bank (nothing retained yet) is an empty result, not an error.
// Phase 4A options (DESIGN.md 6.2 and 6.3), all optional so every older caller sends the same request as before:
//   types ["world", "experience", "observation"], preferObservations (drops raw facts an observation already covers), entities (true asks for the
//   entity list), budget "low" | "mid" | "high", and scope { from, to } (ranking only: recall never filters by date, memoriesList does).
// -> { results, ms, entities (only with o.entities) }
export async function recall(env, bank, query, o = {}) {
  const t0 = Date.now();
  try {
    const types = Array.isArray(o.types) ? o.types.filter((t) => ["world", "experience", "observation"].includes(t)) : [];
    const body = { query: String(query).slice(0, 2000), budget: o.budget || "mid", max_tokens: o.maxTokens || 2500, include: { entities: o.entities ? {} : null },
      query_timestamp: new Date(o.now || Date.now()).toISOString(),
      ...(types.length ? { types } : {}), ...(o.preferObservations ? { prefer_observations: true } : {}),
      // Phase 5: the ambient search path asks for the Bee documents only (tag source:bee). any_strict never returns an untagged memory (README pitfall 14).
      ...(Array.isArray(o.tags) && o.tags.length ? { tags: o.tags.map(String), tags_match: o.tagsMatch || "any_strict" } : {}),
      ...(o.scope && (o.scope.from || o.scope.to) ? { temporal_window: { start: new Date(o.scope.from || 0).toISOString(), end: new Date(o.scope.to || Date.now()).toISOString() } } : {}) };
    const r = await hs(env, `${B(bank)}/memories/recall`, { method: "POST", body, timeoutMs: o.timeoutMs || 6000 });
    return { results: r?.results || [], ms: Date.now() - t0, ...(o.entities ? { entities: r?.entities || {} } : {}) };
  } catch (e) { if (e.status === 404) return { results: [], ms: Date.now() - t0 }; throw e; }
}

// ---- Phase 4A client additions (DESIGN.md 3.1 and 6): reading mental models for the prompt, exact date lists, history and corrections. ----
// A mental model's text for a prompt: { content, last_refreshed_at, last_refresh_failed_at } or null when the model or the bank does not exist.
// content is "" until the first refresh finishes. Without detail=content the response would carry the heavy reflect_response.
export async function mentalModelContent(env, bank, id, { timeoutMs = 5000 } = {}) {
  try {
    const m = await hs(env, `${B(bank)}/mental-models/${encodeURIComponent(id)}?detail=content`, { timeoutMs });
    return m ? { content: String(m.content ?? ""), last_refreshed_at: m.last_refreshed_at || null, last_refresh_failed_at: m.last_refresh_failed_at || null, source_query: m.source_query || "", id: m.id || id } : null;
  } catch (e) { if (e.status === 404) return null; throw e; }
}
// An exact list of memories in a time range (recall only ranks by date). start inclusive, end exclusive, ISO. timeField: created_at | mentioned_at | occurred_start ...
export async function memoriesList(env, bank, { type, q, start, end, timeField, limit = 50, offset = 0, state = "valid", timeoutMs = 8000 } = {}) {
  const u = new URLSearchParams({ limit: String(Math.min(200, Math.max(1, limit))), offset: String(Math.max(0, offset)), state });
  if (type) u.set("type", type); if (q) u.set("q", q); if (start) u.set("start_date", new Date(start).toISOString()); if (end) u.set("end_date", new Date(end).toISOString());
  if (timeField && (start || end)) u.set("time_field", timeField);
  try { const r = await hs(env, `${B(bank)}/memories/list?${u}`, { timeoutMs }); return { items: r?.items || r?.memories || [], total: r?.total ?? null }; }
  catch (e) { if (e.status === 404) return { items: [], total: 0 }; throw e; }
}
export const getMemory = (env, bank, id, { timeoutMs = 6000 } = {}) => hs(env, `${B(bank)}/memories/${encodeURIComponent(id)}`, { timeoutMs });
// An observation's history, oldest first (what it said before each change and which facts it was built from). Other kinds answer [].
export async function memoryHistory(env, bank, id, { timeoutMs = 6000 } = {}) {
  try { const r = await hs(env, `${B(bank)}/memories/${encodeURIComponent(id)}/history`, { timeoutMs }); return Array.isArray(r) ? r : r?.history || r?.items || []; }
  catch (e) { if (e.status === 404) return []; throw e; }
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

// ---- Phase 6 (the Notebook pages): a mental model's page as Hindsight stores it. ----
// One read with the stored reflect response (it holds based_on, the memories the last refresh used). null when the model or the bank is missing.
export async function mentalModelPage(env, bank, id, { timeoutMs = 8000 } = {}) {
  try { return await hs(env, `${B(bank)}/mental-models/${encodeURIComponent(id)}?detail=full`, { timeoutMs }); }
  catch (e) { if (e.status === 404) return null; throw e; }
}
// The bank's mental models without their text: id, last_refreshed_at, last_refresh_failed_at, is_stale. [] for a missing bank.
export async function mentalModelsMeta(env, bank, { timeoutMs = 8000 } = {}) {
  try { const r = await hs(env, `${B(bank)}/mental-models?limit=100`, { timeoutMs }); return r?.items || []; }
  catch (e) { if (e.status === 404) return []; throw e; }
}

// Memory Overhaul phase 4A, "using memory" (the design notes). Everything here runs only when HS_USE is "on"
// (hs-flag.js hsUse), so with the flag off the prompt, the tools and the turn stay exactly as they were. Three parts.
//   1. The profile: the General "profile" or the project channel "brief" mental model, read for the standing context and kept in the Resident's
//      storage keyed by its last_refreshed_at, so the cached prompt prefix changes only when the model refreshes (6.1).
//   2. The comparison arms (6.2): A tool only, B automatic recall, B2 observations only (the default), chosen per channel by a dev only test setting.
//      Memory added to a turn goes into the turn context
//      inside <injected-memory> tags (memory-block.js) and is taken out again before the turn is retained.
//   3. The recall tool's new arguments (types, from, to) and the exact list for a date range (6.3).
// The pure functions take their network calls as arguments, so the tests run them with fakes. The Resident methods are at the bottom.
import { hsUse } from "./hs-flag.js";
import { MEMORY_UNAVAILABLE_NOTE } from "./memory-unavailable.js";   // a recall that failed says memory is unavailable (no local copy to search)
import { recall as hsRecall, mentalModelContent, refreshMentalModel, listMentalModels, hsOn, memoriesList } from "./hindsight.js";
import { wrapMemory } from "./memory-block.js";
import { scrubSecrets } from "./secrets-scrub.js";
import { localDay } from "./dates.js";
// Resolve with onTimeout() when the promise takes longer than ms (the arm deadline); kept here so core code does not import an EE module.
const within = (p, ms, onTimeout) => { let t; return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)), new Promise((z) => { t = setTimeout(() => z(onTimeout()), ms); })]); };
import { templateKind } from "./hindsight-template.js";

const one = (s, n = 4000) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const tms = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : 0; };

// ================= 1. the profile (DESIGN 6.1) =================
export const PROFILE_MODEL = { general: "profile", channel: "brief" };
export const MODEL_CHECK_MS = 120e3;    // how long a read of a mental model is trusted before the model is asked again
export const MODEL_RETRY_MS = 20e3;     // after a failed read, the next read comes after this long
export const modelKey = (id) => `mu_m:${id}`;
// store: { get(key) → string | undefined, put(key, string) } (the Resident's kv). read: () → { content, last_refreshed_at, last_refresh_failed_at } | null.
// The saved copy is { text, refreshed, checked }. Within MODEL_CHECK_MS the copy is used without a network call. A copy is replaced only by a model
// that holds content, whose refresh did not fail after its last success. A failed refresh, a read error or an empty model keeps the last good copy.
// → { text, refreshed, source: "model" | "cache" | "none", stale?, error? }
export async function cachedModelText({ id, read, store, now = Date.now(), checkMs = MODEL_CHECK_MS }) {
  let c = null; try { c = JSON.parse(store.get(modelKey(id)) || "null"); } catch {}
  const save = (o) => { try { store.put(modelKey(id), JSON.stringify(o)); } catch {} };
  const last = (extra = {}) => ({ text: c?.text || "", refreshed: c?.refreshed || null, source: c?.text ? "cache" : "none", ...extra });
  if (c && now - (c.checked || 0) < checkMs) return last();
  let m;
  try { m = await read(); }
  catch (e) { if (c) save({ ...c, checked: now - checkMs + MODEL_RETRY_MS }); return last({ error: one(e?.message || e, 120) }); }
  let text = m ? scrubSecrets(String(m.content ?? "")).trim() : "";   // nosecrets: a model written from memory is scrubbed on the way out like a recalled fact
  if (!m || !text) { if (c) save({ ...c, checked: now }); return last(); }
  const refreshedAt = tms(m.last_refreshed_at), failed = tms(m.last_refresh_failed_at) > refreshedAt;
  if (failed && c?.text) { save({ ...c, checked: now }); return last({ stale: true }); }
  if (c?.text && c.refreshed && c.refreshed === m.last_refreshed_at) { save({ ...c, checked: now }); return last({ source: "model" }); }
  save({ text, refreshed: m.last_refreshed_at || null, checked: now });
  return { text, refreshed: m.last_refreshed_at || null, source: "model", ...(failed ? { stale: true } : {}) };
}

// ================= 2. the arms (DESIGN 6.2) =================
// B2 is arm B with observations only: a recall over fewer candidates, so the reranker answers in one call (DESIGN 6.10).
export const ARMS = ["A", "B", "B2"];
export const ARM_DEADLINE_MS = 1500;     // the Captain's limit: at most this much added to a turn at p95. An arm that is not ready by then is left out of the turn.
// HS_USE_DEADLINE_MS (dev tuning) replaces it, between 100 and 5000.
export const armDeadline = (env) => { const n = Number(env?.HS_USE_DEADLINE_MS); return Number.isFinite(n) && n >= 100 && n <= 5000 ? n : ARM_DEADLINE_MS; };
// B2 is the default arm of every channel while HS_USE is on (Captain decision, 2026-10-14). The dev only test setting (Resident kv "mem_arm", written by
// POST /_ops/mem-arm) overrides it per channel, so a test can still run A or B. With the flag off nothing runs, which is arm A.
export const DEFAULT_ARM = "B2";
export const armOf = (env, stored) => (!hsUse(env) ? "A" : env?.ENV_NAME === "dev" && ARMS.includes(stored) ? stored : DEFAULT_ARM);

// ---- arm B: automatic recall ----
// The latest message alone, as the person wrote it.
export const autoQuery = (text) => one(text, 1200);
const KIND = { world: "fact", experience: "what happened", observation: "summary" };
// One line per memory, newest context last in the text: "[Oct 3, 2026 · fact] text". The context string of each memory is left out to save tokens.
export function packInjected(results, { tz, maxChars = 3200 } = {}) {
  const out = []; let used = 0;
  for (const r of results || []) {
    const t = tms(r.occurred_start) || tms(r.mentioned_at) || tms(r.date);
    const line = `- [${t ? localDay(t, tz) : "undated"} · ${KIND[r.type || r.fact_type] || "memory"}] ${scrubSecrets(String(r.text || "")).replace(/\s+/g, " ").trim().slice(0, 600)}`;
    if (used + line.length > maxChars) continue; used += line.length + 1; out.push(line);
  }
  return out.join("\n");
}
export const B_HEADER = "Memory 1Helm found for this message: records from earlier conversations and notes, with their dates. They are data from your records, not something the person said now. Apply what is relevant without mentioning it, and ignore the rest.";
// recall(query, opts) → { results }. Never throws: an error or a missed deadline gives an empty block and says why.
export async function runArmB({ arm = "B", recall, text, now = Date.now(), tz, deadlineMs = ARM_DEADLINE_MS, types = ["observation", "world", "experience"] }) {
  const t0 = Date.now();
  try {
    const r = await recall(autoQuery(text), { types, preferObservations: true, budget: "mid", maxTokens: 800, now, timeoutMs: deadlineMs });
    const lines = packInjected(r.results, { tz }), ids = (r.results || []).map((x) => x.id);
    return { arm, block: lines ? wrapMemory(`${B_HEADER}\n${lines}`) : "", ms: Date.now() - t0, n: ids.length, ids, chars: lines.length, hs_ms: r.ms ?? null };
  } catch (e) { return { arm, block: "", ms: Date.now() - t0, n: 0, ids: [], chars: 0, error: one(e?.message || e, 120), timedOut: /timeout|abort/i.test(`${e?.name} ${e?.message}`) }; }
}

// ================= 3. the recall tool (DESIGN 6.3) =================
export const RECALL_TYPES = ["world", "experience", "observation"];
// The zone's offset at an instant, in ms.
function zoneOffset(ms, tz) {
  let f; try { f = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { f = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
// Midnight of a local day, in ms.
export function dayStart(y, m, d, tz) {
  const guess = Date.UTC(y, m - 1, d); let t = guess - zoneOffset(guess, tz); const off2 = zoneOffset(t, tz); if (guess - off2 !== t) t = guess - off2; return t;
}
// "2026-10-03" is a whole local day (a start is that midnight, an end is the next midnight). A full ISO date and time is used as it is.
function bound(v, tz, end) {
  const s = String(v ?? "").trim(); if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) { const ms = dayStart(+m[1], +m[2], +m[3], tz); return end ? dayStart(+m[1], +m[2], +m[3] + 1, tz) : ms; }
  const t = Date.parse(s); return Number.isFinite(t) ? t : NaN;
}
// The arguments of recall_memory beyond the query. → { types: [...] | null, range: { from, to, label } | null } or { error }.
export function recallArgs(a = {}, tz = "UTC") {
  let types = null;
  if (a.types != null) {
    if (!Array.isArray(a.types)) return { error: `types must be a list of: ${RECALL_TYPES.join(", ")}` };
    const bad = a.types.filter((t) => !RECALL_TYPES.includes(t)); if (bad.length) return { error: `types must be a list of: ${RECALL_TYPES.join(", ")}` };
    types = [...new Set(a.types)]; if (!types.length) types = null;
  }
  const from = bound(a.from, tz, false), to = bound(a.to, tz, true);
  if (Number.isNaN(from) || Number.isNaN(to)) return { error: "from and to must be dates like 2026-10-03 or full ISO date and times" };
  if (from != null && to != null && to <= from) return { error: "to must come after from" };
  const range = from != null || to != null ? { from, to, label: `${from != null ? localDay(from, tz) : "the start"} to ${to != null ? localDay(to - 1, tz) : "now"}` } : null;
  return { types, range };
}
// Exact records in a date range from memories/list (recall only ranks by date). Learned in the range (mentioned_at) and happened in the range
// (occurred_start) are two lists, read in parallel, and merged. → { text, n } ("" when nothing).
export async function rangeRecords(env, bank, range, { types = null, tz, maxChars = 3000 } = {}) {
  const base = { start: range.from, end: range.to, limit: 30, ...(types?.length === 1 ? { type: types[0] } : {}) };
  const [m, o] = await Promise.all([memoriesList(env, bank, { ...base, timeField: "mentioned_at" }).catch(() => ({ items: [] })), memoriesList(env, bank, { ...base, timeField: "occurred_start" }).catch(() => ({ items: [] }))]);
  const seen = new Map();
  for (const [kind, list] of [["learned in that range", m.items], ["happened in that range", o.items]]) for (const x of list || []) {
    const type = x.fact_type || x.type; if (types?.length && !types.includes(type)) continue;
    if (!seen.has(x.id)) seen.set(x.id, { ...x, type, kinds: [kind] }); else seen.get(x.id).kinds.push(kind);
  }
  const rows = [...seen.values()].sort((a, b) => (tms(a.occurred_start) || tms(a.mentioned_at)) - (tms(b.occurred_start) || tms(b.mentioned_at)));
  const out = []; let used = 0;
  for (const r of rows) {
    const t = tms(r.occurred_start) || tms(r.mentioned_at), line = `- [${t ? localDay(t, tz) : "undated"} · ${KIND[r.type] || "memory"} · ${r.kinds.join(" and ")}] ${scrubSecrets(String(r.text || "")).replace(/\s+/g, " ").trim().slice(0, 500)}`;
    if (used + line.length > maxChars) continue; used += line.length + 1; out.push(line);
  }
  return { text: out.join("\n"), n: out.length };
}
// The names Hindsight found in the results: { name → { entity_id } }, as a short list.
export const entityNames = (entities, max = 8) => Object.keys(entities || {}).filter((n) => n && n.length < 60).slice(0, max);

// ================= Resident methods =================
export const useMethods = {
  // ---- 1. the profile ----
  // The text of one mental model for a prompt or a turn. A saved copy that is older than the check interval is used at once and read again in the background
  // (the next turn sees a refresh), so a warm channel never waits for Hindsight here; with no copy the read is waited for.
  async hsModelText(id) {
    const env = this.env, bank = this.hsBankId(), store = { get: (k) => this.get(k), put: (k, v) => this.put(k, v) };
    const run = (checkMs) => cachedModelText({ id, read: () => mentalModelContent(env, bank, id), store, checkMs });
    let c = null; try { c = JSON.parse(this.get(modelKey(id)) || "null"); } catch {}
    if (c?.text && Date.now() - (c.checked || 0) >= MODEL_CHECK_MS && typeof this.ctx?.waitUntil === "function") {
      const busy = (this._muBusy ||= new Set());
      if (!busy.has(id)) { busy.add(id); this.ctx.waitUntil(run(0).catch((e) => console.log("memory model read", e?.message)).finally(() => busy.delete(id))); }
      return c.text;
    }
    return (await run(MODEL_CHECK_MS)).text;
  },
  // The text for the standing context: this channel's profile (General) or brief (a project channel), "" when there is none.
  async hsProfile() {
    const env = this.env;
    if (!hsUse(env) || !hsOn(env) || this.memoryMode() !== "on") return "";
    try { return await this.hsModelText(templateKind(this.get("channel")) === "general" ? PROFILE_MODEL.general : PROFILE_MODEL.channel); }
    catch (e) { console.log("memory profile", e?.message); return ""; }
  },
  // ---- 2. the arms ----
  memArmState() { const stored = this.get("mem_arm") || ""; return { arm: stored || "default", effective: armOf(this.env, stored) }; },
  // Called early in a chat turn. null = nothing to do (flag off, a resume, memory off, arm A). Arm B2 is the default). Otherwise the arms start now and the
  // turn joins the active one later (memUseJoin), so their time overlaps the rest of the turn's setup.
  memUseStart(text, tc, { kind = "chat", resumed = false } = {}) {
    const env = this.env;
    if (!hsUse(env) || !hsOn(env) || kind !== "chat" || resumed || this.memoryMode() !== "on" || env.BYOK) return null;
    const arm = armOf(env, this.get("mem_arm"));
    if (arm === "A") return null;
    const bank = this.hsBankId(), tz = this.tz(), now = Date.now();
    const dl = armDeadline(env);
    const askB = (o) => runArmB({ recall: (q, x) => hsRecall(env, bank, q, x), text, now, tz, ...o });
    // Arm B2 asks for observations only. Arm B (the dev test override) asks for all three types.
    const A2 = arm === "B2" ? askB({ arm: "B2", types: ["observation"], deadlineMs: dl }) : null;
    const B = arm === "B" ? askB({ deadlineMs: dl }) : null;
    return { arm, t0: now, deadline: dl, A2, B, text };
  },
  // Wait for the active arm (it never rejects and ends by its own deadline).
  // → { block, info } where block is "" or the wrapped memory for the turn context, and info is the trace line.
  async memUseJoin(h, tc) {
    if (!h) return { block: "", info: null };
    // The turn never waits past the deadline counted from the start of the arm: a model read or a slow call that runs on is cut off here.
    const w0 = Date.now(), p = h.arm === "B2" ? h.A2 : h.B;
    const cur = await within(p, Math.max(0, h.deadline - (w0 - h.t0)), () => ({ arm: h.arm, block: "", ms: h.deadline, chars: 0, n: 0, error: "deadline", timedOut: true })), waited = Date.now() - w0;
    const info = { arm: h.arm, waited_ms: waited, ms: cur.ms, chars: cur.chars, ...(cur.error ? { error: cur.error } : {}), ...(cur.n != null ? { n: cur.n } : {}) };
    // A receipt for the active arm, like recall_memory writes: the arm is what answers most turns now, so without this a turn that used memory left no receipt and no recall mode.
    if (h.arm !== "A") try {
      const ids = cur.ids || [];
      this.mem.receipt({ turn: tc?.turn, session: tc?.session, mode: cur.error ? `${this.memoryMode()}:hindsight-unavailable` : `${this.memoryMode()}:hindsight`, query: h.text, ids: ids.map((x) => `hs:${x}`), ms: cur.ms, chars: cur.chars, ...(cur.error ? { error: cur.error } : {}) });
    } catch (e) { console.log("memory arm receipt", e?.message); }
    // No local memory stands in when Hindsight fails (an error, not a missed deadline), so the turn is told.
    const down = cur.error && !cur.timedOut && !cur.block;
    return { block: cur.block || (down ? wrapMemory(MEMORY_UNAVAILABLE_NOTE) : ""), info: down ? { ...info, unavailable: true } : info };
  },
  // POST /_ops/mem-arm (dev, ops key): set the arm for this channel, and optionally refresh its mental models; always answers the state.
  async memArmAdmin(o = {}) {
    const env = this.env;
    if (!hsUse(env) || env.ENV_NAME !== "dev") return { error: "HS_USE is off, or this is not dev" };
    if (o.arm != null && o.arm !== "") { if (![...ARMS, "default"].includes(o.arm)) return { error: "arm must be A, B, B2 or default" }; this.put("mem_arm", o.arm === "default" ? "" : o.arm); }
    const bank = this.hsBankId(); let models = [], refreshed = [], error = null;
    try {
      if (o.refresh) {
        await this.hsBank();   // the template must be imported, or the models do not exist yet
        for (const m of (await listMentalModels(env, bank))?.items || []) { try { await refreshMentalModel(env, bank, m.id); refreshed.push(m.id); } catch (e) { error = one(e?.message || e, 100); } }
        this.sql.exec("DELETE FROM kv WHERE k LIKE 'mu_m:%'");   // the next turn reads the models again
      }
      for (const m of (await listMentalModels(env, bank))?.items || []) { const c = await mentalModelContent(env, bank, m.id).catch(() => null); models.push({ id: m.id, refreshed: c?.last_refreshed_at || null, failed: c?.last_refresh_failed_at || null, chars: String(c?.content || "").length }); }
    } catch (e) { error = one(e?.message || e, 120); }
    return { ...this.memArmState(), refresh_requested: refreshed, models, ...(error ? { error } : {}) };
  },
};
export function useMix(Cls) { Object.assign(Cls.prototype, useMethods); }

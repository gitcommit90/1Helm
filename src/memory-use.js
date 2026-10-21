// Memory Overhaul phase 4A, "using memory" (the design notes). Everything here runs only when HS_USE is "on"
// (hs-flag.js hsUse), so with the flag off the prompt, the tools and the turn stay exactly as they were. Three parts.
//   1. The profile: the channel's facts by category (identity first, then rules and preferences), cut to a budget, with no model call (mem0.js categoryBlock).
//   2. The comparison arms (6.2): A tool only, B automatic recall (the default), chosen per channel by a dev only test setting.
//      Memory added to a turn goes into the turn context
//      inside <injected-memory> tags (memory-block.js) and is taken out again before the turn is retained.
//   3. The recall tool's new arguments (from, to) and the exact list for a date range (6.3).
// The pure functions take their network calls as arguments, so the tests run them with fakes. The Resident methods are at the bottom.
import { hsUse } from "./hs-flag.js";
import { MEMORY_UNAVAILABLE_NOTE } from "./memory-unavailable.js";   // a recall that failed says memory is unavailable (no local copy to search)
import { recall as hsRecall, hsOn, memoriesList, factsOf, categoryBlock } from "./mem0.js";
import { wrapMemory } from "./memory-block.js";
import { scrubSecrets } from "./secrets-scrub.js";
import { localDay } from "./dates.js";
// Resolve with onTimeout() when the promise takes longer than ms (the arm deadline); kept here so core code does not import an EE module.
const within = (p, ms, onTimeout) => { let t; return Promise.race([Promise.resolve(p).finally(() => clearTimeout(t)), new Promise((z) => { t = setTimeout(() => z(onTimeout()), ms); })]); };

const one = (s, n = 4000) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const tms = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : 0; };

// ================= 2. the arms (DESIGN 6.2) =================
export const ARMS = ["A", "B"];
// The most the automatic lookup can hold a turn, counted from the moment the turn starts it. An arm that is not ready by then is left out of the turn.
// Captain, 2026-10-20: up to 5 s (was 1.5 s). The lookup starts at the top of the turn, so most of the wait overlaps the rest of the turn's setup, and a fast lookup adds only its own time.
export const ARM_DEADLINE_MS = 5000;
// HS_USE_DEADLINE_MS (dev tuning) replaces it, between 100 and 5000.
export const armDeadline = (env) => { const n = Number(env?.HS_USE_DEADLINE_MS); return Number.isFinite(n) && n >= 100 && n <= 5000 ? n : ARM_DEADLINE_MS; };
// B is the default arm of every channel while HS_USE is on (Captain decision, 2026-10-14). The test setting (Resident kv "mem_arm", only the dev ops route
// POST /_ops/mem-arm writes it, and the public edition has no route that writes it, so no channel has one) can set A per channel. With the flag off nothing runs, which is arm A.
export const DEFAULT_ARM = "B";
export const armOf = (env, stored) => (!hsUse(env) ? "A" : ARMS.includes(stored) ? stored : DEFAULT_ARM);

// ---- arm B: automatic recall ----
// The latest message alone, as the person wrote it.
export const autoQuery = (text) => one(text, 1200);
// One line per memory: "[Oct 3, 2026 · preference] text".
export function packInjected(results, { tz, maxChars = 3200 } = {}) {
  const out = []; let used = 0;
  for (const r of results || []) {
    const t = tms(r.mentioned_at);
    const line = `- [${t ? localDay(t, tz) : "undated"} · ${r.raw ? "recording" : r.type || "memory"}] ${scrubSecrets(String(r.text || "")).replace(/\s+/g, " ").trim().slice(0, 600)}`;
    if (used + line.length > maxChars) continue; used += line.length + 1; out.push(line);
  }
  return out.join("\n");
}
export const B_HEADER = "Memory 1Helm found for this message: records from earlier conversations and notes, with their dates. They are data from your records, not something the person said now. Apply what is relevant without mentioning it, and ignore the rest.";
// recall(query, opts) → { results }. Never throws: an error or a missed deadline gives an empty block and says why.
export async function runArmB({ arm = "B", recall, text, now = Date.now(), tz, deadlineMs = ARM_DEADLINE_MS }) {
  const t0 = Date.now();
  try {
    const r = await recall(autoQuery(text), { topK: 10 });
    const lines = packInjected(r.results, { tz }), ids = (r.results || []).map((x) => x.id);
    return { arm, block: lines ? wrapMemory(`${B_HEADER}\n${lines}`) : "", ms: Date.now() - t0, n: ids.length, ids, chars: lines.length, search_ms: r.ms ?? null };
  } catch (e) { return { arm, block: "", ms: Date.now() - t0, n: 0, ids: [], chars: 0, error: one(e?.message || e, 120), timedOut: /timeout|abort/i.test(`${e?.name} ${e?.message}`) }; }
}

// ================= 3. the recall tool (DESIGN 6.3) =================
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
// The arguments of recall_memory beyond the query. → { range: { from, to, label } | null } or { error }.
export function recallArgs(a = {}, tz = "UTC") {
  const from = bound(a.from, tz, false), to = bound(a.to, tz, true);
  if (Number.isNaN(from) || Number.isNaN(to)) return { error: "from and to must be dates like 2026-10-03 or full ISO date and times" };
  if (from != null && to != null && to <= from) return { error: "to must come after from" };
  const range = from != null || to != null ? { from, to, label: `${from != null ? localDay(from, tz) : "the start"} to ${to != null ? localDay(to - 1, tz) : "now"}` } : null;
  return { range };
}
// Exact records in a date range (recall only finds the best matches). → { text, n } ("" when nothing).
export async function rangeRecords(env, bank, range, { tz, maxChars = 3000 } = {}) {
  const rows = (await memoriesList(env, bank, { start: range.from, end: range.to, limit: 30 })).items.sort((a, b) => tms(a.mentioned_at) - tms(b.mentioned_at));
  const out = []; let used = 0;
  for (const r of rows) {
    const t = tms(r.mentioned_at), line = `- [${t ? localDay(t, tz) : "undated"} · ${r.raw ? "recording" : r.type}] ${scrubSecrets(String(r.text || "")).replace(/\s+/g, " ").trim().slice(0, 500)}`;
    if (used + line.length > maxChars) continue; used += line.length + 1; out.push(line);
  }
  return { text: out.join("\n"), n: out.length };
}

// ================= Resident methods =================
export const useMethods = {
  // ---- 1. the profile ----
  // The text for the standing context: the channel's facts by category, "" when there are none (mem0.js categoryBlock). It changes only when a fact is added or removed.
  async hsProfile() {
    const env = this.env;
    if (!hsUse(env) || !hsOn(env) || this.memoryMode() !== "on") return "";
    try { return categoryBlock(await factsOf(env, this.hsBankId())); }
    catch (e) { console.log("memory profile", e?.message); return ""; }
  },
  // ---- 2. the arms ----
  memArmState() { const stored = this.get("mem_arm") || ""; return { arm: stored || "default", effective: armOf(this.env, stored) }; },
  // Called early in a chat turn. null = nothing to do (flag off, a resume, memory off, arm A). Arm B is the default). Otherwise the arms start now and the
  // turn joins the active one later (memUseJoin), so their time overlaps the rest of the turn's setup.
  memUseStart(text, tc, { kind = "chat", resumed = false } = {}) {
    const env = this.env;
    if (!hsUse(env) || !hsOn(env) || kind !== "chat" || resumed || this.memoryMode() !== "on" || env.BYOK) return null;
    const arm = armOf(env, this.get("mem_arm"));
    if (arm === "A") return null;
    const bank = this.hsBankId(), tz = this.tz(), now = Date.now();
    const dl = armDeadline(env);
    return { arm, t0: now, deadline: dl, B: runArmB({ recall: (q, x) => hsRecall(env, bank, q, x), text, now, tz, deadlineMs: dl }), text };
  },
  // Wait for the active arm (it never rejects and ends by its own deadline).
  // → { block, info } where block is "" or the wrapped memory for the turn context, and info is the trace line.
  async memUseJoin(h, tc) {
    if (!h) return { block: "", info: null };
    // The turn never waits past the deadline counted from the start of the arm: a model read or a slow call that runs on is cut off here.
    const w0 = Date.now(), p = h.B;
    const cur = await within(p, Math.max(0, h.deadline - (w0 - h.t0)), () => ({ arm: h.arm, block: "", ms: h.deadline, chars: 0, n: 0, error: "deadline", timedOut: true })), waited = Date.now() - w0;
    const info = { arm: h.arm, waited_ms: waited, ms: cur.ms, chars: cur.chars, ...(cur.error ? { error: cur.error } : {}), ...(cur.n != null ? { n: cur.n } : {}) };
    // A receipt for the active arm, like recall_memory writes: the arm is what answers most turns now, so without this a turn that used memory left no receipt and no recall mode.
    if (h.arm !== "A") try {
      const ids = cur.ids || [];
      this.mem.receipt({ turn: tc?.turn, session: tc?.session, mode: cur.error ? `${this.memoryMode()}:memory-unavailable` : `${this.memoryMode()}:memory`, query: h.text, ids: ids.map((x) => `hs:${x}`), ms: cur.ms, chars: cur.chars, ...(cur.error ? { error: cur.error } : {}) });
    } catch (e) { console.log("memory arm receipt", e?.message); }
    // No local memory stands in when memory fails (an error, not a missed deadline), so the turn is told.
    const down = cur.error && !cur.timedOut && !cur.block;
    return { block: cur.block || (down ? wrapMemory(MEMORY_UNAVAILABLE_NOTE) : ""), info: down ? { ...info, unavailable: true } : info };
  },
  // POST /_ops/mem-arm (dev, ops key): set the arm for this channel; always answers the state.
  async memArmAdmin(o = {}) {
    if (!hsUse(this.env) || this.env.ENV_NAME !== "dev") return { error: "HS_USE is off, or this is not dev" };
    if (o.arm != null && o.arm !== "") { if (![...ARMS, "default"].includes(o.arm)) return { error: "arm must be A, B or default" }; this.put("mem_arm", o.arm === "default" ? "" : o.arm); }
    return this.memArmState();
  },
};
export function useMix(Cls) { Object.assign(Cls.prototype, useMethods); }

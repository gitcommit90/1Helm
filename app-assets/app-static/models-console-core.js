// The /models console: logic and HTML text shared by the Worker (first page render) and the browser (every later render).
// Pure: no document, no fetch, no clock except where a time is passed in. Every value that goes into HTML passes through h`...` or esc().
// There are no inline style attributes anywhere, because the page's content security policy does not allow them.

import { compareGolden, scoreLine } from "./sandbox-golden.js";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join("") : v == null ? "" : esc(v));
export const h = (strings, ...vals) => new Raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? val(vals[i]) : ""), ""));
export const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const clone = (x) => JSON.parse(JSON.stringify(x));
export const num = (n) => (n == null ? "" : Number(n).toLocaleString("en-US"));

export const LEVELS = ["unrestricted", "no_training", "zdr"];
export const LEVEL_NAME = { unrestricted: "Unrestricted", no_training: "No training", zdr: "ZDR" };
export const EFFORT = { none: "None", default: "Default", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum" };
export const SORT = { "": "Default", price: "Price", throughput: "Throughput", latency: "Latency" };
export const GROUP_TITLE = { chat: "Chat categories", routing: "Routing", background: "Background jobs", speech: "Speech", search: "Search and media", other: "Other" };
export const EDITABLE_VIEWS = ["all", "attention"];
const CHAT_PICKS = ["chat", "chore", "classic"];

// ---------------------------------------------------------------- names, sources, times
export const srcOf = (state, id, hint) => (hint === "CF" || hint === "OR" || hint === "SELF" ? hint : /^@1hc\//.test(String(id)) ? "SELF" : state.config?.catalog?.[id]?.source === "CF" || /^(@cf\/|cloudflare\/)/.test(String(id)) ? "CF" : "OR");
export const shortName = (id) => String(id || "").replace(/^[~@]/, "").replace(/^(cf|cloudflare)\//, "").split("/").pop();
export const nameOf = (state, id) => state.config?.catalog?.[id]?.name || shortName(id);
export const effortsOf = (state, id) => state.config?.catalog?.[id]?.efforts || [];
export const effortName = (e) => (e ? EFFORT[e] || e : "");
export const sortName = (v) => SORT[v || ""] || String(v);
export const outText = (v) => (v == null ? "Provider max" : num(v));
export const secText = (ms) => (ms == null ? "None" : (ms % 1000 ? ms / 1000 : num(ms / 1000)) + "s");
export const priceText = (p) => (p ? `$${p.prompt} / $${p.completion}` : "Default");
export const agoText = (ms, now) => { const m = Math.max(0, Math.round((now - ms) / 60000)); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
export const badge = (src) => { const s = src === "CF" ? "CF" : src === "SELF" ? "SELF" : "OR"; return h`<span class="badge ${s}" title="${s === "OR" ? "OpenRouter" : s === "SELF" ? "Runs in 1Helm's own container" : "Cloudflare"}">${s === "SELF" ? "1H" : s}</span>`; };

// ---------------------------------------------------------------- rows
// A row is one line of the table: a saved job or a routing category. A category row also carries the limits of its replies (max output, sort, max price, timeout).
export function rowsOf(state) {
  const out = [], dyn = !!state.dynamicRouting && state.config?.version === 3;
  const jobs = state.jobs || [];
  const seen = new Set();
  for (const g of state.groups || []) {
    if (seen.has(g.id)) continue; seen.add(g.id);
    if (g.id === "chat" && dyn) {
      for (const c of state.config.routing.categories) out.push({ key: "cat:" + c.id, kind: "cat", id: c.id, label: c.title, desc: c.id === "general" ? "The primary model. Other categories are for delegated tasks." : "Delegated tasks", group: "chat", cat: c });
      continue;
    }
    for (const j of jobs) if (j.group === g.id) out.push({ key: j.id, kind: "job", id: j.id, label: j.label, desc: j.description, group: g.id, jv: j });
  }
  return out;
}
export const groupsOf = (state) => {
  const dyn = !!state.dynamicRouting && state.config?.version === 3, out = [];
  const seen = new Set();
  for (const g of state.groups || []) { if (seen.has(g.id)) continue; seen.add(g.id); out.push({ id: g.id, title: GROUP_TITLE[g.id] || g.title }); }
  return out;
};
export const rowByKey = (state, key) => rowsOf(state).find((r) => r.key === key) || null;

// ---------------------------------------------------------------- snapshots: what one environment runs, in one shape
// The saved settings as a snapshot, for showing and editing (a field a job doesn't carry reads as its starting value).
export function snapshotFromConfig(state) {
  const cfg = state.config, def = state.defaults || {}, jobs = {};
  for (const [id, j] of Object.entries(cfg.jobs || {})) {
    if (!j) continue;
    const f = (k) => (own(j, k) ? j[k] : (def[id] || {})[k]);
    jobs[id] = { chain: [{ model: j.model, effort: j.effort ?? null, strict: j.strict }, ...(j.fallbacks || []).map((x) => ({ model: x.model, effort: x.effort ?? null, strict: x.strict }))],
      max_output: f("max_output") ?? null, sort: f("sort") ?? null, max_price: f("max_price") ?? null, timeout_ms: f("timeout_ms") ?? null, results: f("results") ?? null };
  }
  const cats = {};
  for (const c of cfg.routing?.categories || []) cats[c.id] = { levels: c.chains, max_output: c.max_output ?? null, sort: c.sort ?? null, max_price: c.max_price ?? null, timeout_ms: c.timeout_ms ?? null };
  return { jobs, cats, limits: state.limits ? { ...state.limits.values } : null };
}

export const limitText = (d, v) => (d.unit === "dollars" ? "$" + v : d.unit === "percent" ? v + "%" : d.unit === "times" ? v + " times" : num(v) + (d.unit === "count" ? "" : " " + d.unit));

// ---------------------------------------------------------------- what a row shows
export const levelOf = (row, ui) => (row.kind === "cat" ? ui.level : "unrestricted");
export function viewOf(state, ui, row, snap) {
  // snap: the snapshot being shown (the saved settings).
  const lv = levelOf(row, ui);
  let chain = [], f = {};
  if (row.kind === "cat") { chain = (snap.cats[row.id]?.levels?.[lv] || []).map((e) => ({ ...e, source: e.source })); f = snap.cats[row.id] || {}; }
  else if (snap.jobs[row.id]) { chain = snap.jobs[row.id].chain; f = snap.jobs[row.id]; }
  const jv = row.jv, kindText = row.kind === "cat";
  const noOut = kindText ? false : !!jv.no_output;
  const orOnly = kindText ? false : !!jv.on_openrouter;
  return { chain, level: lv, max_output: f.max_output ?? null, sort: f.sort ?? null, max_price: f.max_price ?? null, timeout_ms: f.timeout_ms, results: f.results,
    hasEffort: kindText ? true : !!jv.has_effort,
    showOut: !noOut, showResults: row.kind !== "cat" && jv.results != null,
    showSort: kindText || orOnly || (!jv.no_output && jv.on_openrouter), showTimeout: true,
    maxChain: kindText ? 3 : 1 + (jv.max_fallbacks || 0), fixedChain: kindText, hasChain: true };
}

// ---------------------------------------------------------------- last served and flags
// A served row is a record of one call. It is judged against the models that were saved when the call was served, and never against a list saved after it:
// the row carries `since`, the time the row's models last changed (src/model-changes.js), and a call from before that time is history, shown with no flag.
// The flag comes from `requested`, the exact list entry the dispatcher recorded as the one that answered. The model and provider the provider reported
// are shown as information and never decide a flag. Each routing category has its own row, "chat:<category id>".
export const servedKey = (row) => (row.kind === "cat" ? "chat:" + row.id : row.id);
// The row of a job or category. A Live that is older than this page reports one "chat" row for every category, so General alone reads it, and only
// when no "chat:" row exists at all; it is marked legacy because the category it came from is unknown.
export function servedRow(row, served) {
  const all = served || {}, own = all[servedKey(row)];
  if (own || row.kind !== "cat" || row.id !== "general" || !all.chat || Object.keys(all).some((k) => k.startsWith("chat:"))) return own || null;
  return { ...all.chat, legacy: true };
}
// When the row's last call happened: a failed call is dated by its own time, because a failure keeps the earlier answer's time.
export const servedAt = (sv) => (sv && sv.last_status && sv.last_status !== "ok" ? sv.last_error_at || sv.last_at : sv && sv.last_at) || null;
// k: "none" no row or nothing to say, "history" a call from before the row's models last changed (or a row whose change time is unknown), "ok", "fallback", "other", "error".
export function servedState(state, row, chains, served) {
  const sv = servedRow(row, served);
  if (!sv) return { k: "none" };
  const at = servedAt(sv);
  if (sv.legacy || typeof sv.since !== "number" || !at || at < sv.since) return { k: sv.requested || sv.served_model || (sv.last_status && sv.last_status !== "ok") ? "history" : "none", sv };
  if (sv.last_status && sv.last_status !== "ok") return { k: "error", t: "Last call failed", sv };
  if (!sv.requested) return { k: "none", sv };
  const firsts = chains.map((c) => c[0]?.model).filter(Boolean), ids = chains.flat().map((e) => e.model);
  if (firsts.includes(sv.requested)) return { k: "ok", sv };
  if (ids.includes(sv.requested)) return { k: "fallback", t: "Served a fallback", sv };
  return { k: "other", t: "Served an unlisted model", sv };
}
export function chainsOf(state, row, snap) {
  if (row.kind === "cat") return LEVELS.map((lv) => snap.cats[row.id]?.levels?.[lv] || []);
  return [snap.jobs[row.id]?.chain || []];
}
// ctx: { snap, served, now }
// Each flag is { k: "bad" | "warn", t: short text, d: one sentence that says what is wrong and what it affects }.
export function flagsOf(state, ui, row, ctx) {
  const f = [], jv = row.jv;
  const ss = servedState(state, row, chainsOf(state, row, ctx.snap), ctx.served), sv = ss.sv, now = ctx.now ?? Date.now();
  if (ss.k === "error") f.push({ k: "bad", s: "served", short: "Failed", t: ss.t, d: `The last call failed ${agoText(servedAt(sv), now)}${sv.last_status && sv.last_status !== "error" ? `: ${sv.last_status}` : ""}.` });
  else if (ss.k === "fallback") f.push({ k: "warn", s: "served", short: "Fallback served", t: ss.t, d: `${nameOf(state, sv.requested)} answered the last call ${agoText(sv.last_at, now)}${sv.last_error ? `, after ${sv.last_error}` : ", so the main model did not answer"}.` });
  else if (ss.k === "other") f.push({ k: "bad", s: "served", short: "Unlisted model", t: ss.t, d: `${nameOf(state, sv.requested)} answered the last call ${agoText(sv.last_at, now)}, and it is not in this list.` });
  const gone = state.unlisted || [], goneHere = [...new Set(chainsOf(state, row, ctx.snap).flat().map((e) => e.model))].filter((m) => gone.includes(m));
  if (goneHere.length) f.push({ k: "warn", short: "Model removed", t: "A model is no longer offered", d: `${goneHere.map((m) => nameOf(state, m)).join(", ")} ${goneHere.length === 1 ? "is" : "are"} no longer listed by OpenRouter.` });
  if (jv) {
    for (const w of jv.warnings || []) {
      if (/no allowed model/.test(w)) f.push({ k: "bad", short: "No model allowed", t: `No allowed model, ${w.split(":")[0]}`, d: w });
      else if (/can't run here/.test(w)) f.push({ k: "bad", short: "Can't run", t: "A model can't run here", d: w });
    }
    if (jv.limit_note?.level === "warn") f.push({ k: "warn", short: "Output too high", t: "Max output above what the providers can serve", d: jv.limit_note.text });
  }
  return f;
}
export const attentionKinds = (fl) => fl.filter((x) => x.k === "bad" || x.k === "warn");

// ---------------------------------------------------------------- edits to the saved settings (pure; the page posts the result)
export function newEntry(state, jv, meta, prev, level) {
  const efforts = meta.efforts || [];
  const hasEffort = level ? true : jv.has_effort;
  let effort = null;
  if (hasEffort) effort = efforts.includes(prev?.effort) ? prev.effort : meta.default_effort && efforts.includes(meta.default_effort) ? meta.default_effort : efforts[0] ?? null;
  const e = { model: meta.id, effort };
  if (!level && (jv.pick === "chore" || jv.pick === "classic" || (jv.any && (meta.chat || meta.eligible)))) e.strict = true;
  return e;
}
const clean = (e) => { const o = { ...e }; for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };
const JOB_FIELDS = ["max_output", "sort", "max_price", "timeout_ms", "results"];
const entriesOfJob = (job) => [{ model: job.model, effort: job.effort, ...(job.strict ? { strict: true } : {}) }, ...(job.fallbacks || []).map(clean)].map(clean);
function packJob(old, entries) {
  const first = clean(entries[0]);
  first.fallbacks = entries.slice(1).map(clean);
  for (const k of JOB_FIELDS) if (own(old, k)) first[k] = old[k];
  return first;
}
// edit: { t, ... }. Returns a new settings object, or null when nothing changes.
export function applyEdit(config, edit) {
  const cfg = clone(config), job = edit.id && cfg.jobs ? cfg.jobs[edit.id] : null;
  const cat = edit.cat ? cfg.routing.categories.find((c) => c.id === edit.cat) : null;
  const chainOf = () => (cat ? cat.chains[edit.level] : null);
  switch (edit.t) {
    case "field": (cat || job)[edit.field] = edit.value; return cfg;
    case "limit": { const cur = { ...(cfg.limits || {}) }; if (edit.value === null) delete cur[edit.limitKey]; else cur[edit.limitKey] = edit.value; cfg.limits = cur; return cfg; }
    case "effort": if (cat) chainOf()[edit.idx].effort = edit.value; else { const arr = entriesOfJob(job); arr[edit.idx].effort = edit.value; cfg.jobs[edit.id] = packJob(job, arr); } return cfg;
    case "entry": {
      if (cat) { chainOf()[edit.idx] = edit.entry; return cfg; }
      const arr = entriesOfJob(job);
      if (arr[edit.idx] && arr[edit.idx].model === edit.entry.model) return null;
      if (edit.idx >= arr.length) arr.push(edit.entry); else arr[edit.idx] = edit.entry;
      cfg.jobs[edit.id] = packJob(job, arr); return cfg;
    }
    case "move": {
      const arr = cat ? chainOf() : entriesOfJob(job), t = edit.idx + edit.d;
      if (t < 0 || t >= arr.length) return null;
      [arr[edit.idx], arr[t]] = [arr[t], arr[edit.idx]];
      if (!cat) cfg.jobs[edit.id] = packJob(job, arr);
      return cfg;
    }
    case "remove": { const arr = entriesOfJob(job); if (arr.length < 2) return null; arr.splice(edit.idx, 1); cfg.jobs[edit.id] = packJob(job, arr); return cfg; }
    case "chain": {   // replace a whole list: entries are { model, effort, strict? }
      if (cat) { cat && (cat.chains[edit.level] = edit.entries.map(clean)); return cfg; }
      cfg.jobs[edit.id] = packJob(job, edit.entries.map(clean)); return cfg;
    }
    case "title": { if (!cat || cat.id === "general") return null; cat.title = edit.value; return cfg; }
    case "catAdd": {
      const general = cfg.routing.categories.find((c) => c.id === "general"), titles = cfg.routing.categories.map((c) => c.title.toLowerCase());
      let n = 1, title = "New category"; while (titles.includes(title.toLowerCase())) title = "New category " + ++n;
      const added = { id: edit.newId, title, chains: clone(general.chains) };
      for (const k of ["max_output", "sort", "max_price", "timeout_ms"]) if (own(general, k)) added[k] = clone(general[k]);   // a new category starts with General's limits
      cfg.routing.categories.push(added); return cfg;
    }
    case "catDelete": { if (!cat || cat.id === "general") return null; cfg.routing.categories = cfg.routing.categories.filter((c) => c.id !== cat.id); return cfg; }
    default: return null;
  }
}
// The body of a save request: the same shape the server's save path takes.
export function saveBody(config, revision) {
  const out = { version: config.version, jobs: config.jobs };
  if (config.version === 3) out.routing = config.routing;
  if (config.limits) out.limits = config.limits;
  return { revision, config: out };
}
// ---------------------------------------------------------------- picker rules (which models a slot may take)
export const takesChat = (jv) => CHAT_PICKS.includes(jv.pick) || !!jv.any;
export function pickerAllowed(state, target, m, ignorePrivacy) {
  const known = state.config.catalog?.[m.id], meta = { ...(known || {}), ...m }, kinds = meta.kinds || [];
  const chatish = meta.chat || (meta.eligible && meta.source !== "CF" && (!kinds.length || kinds.includes("chat") || kinds.includes("chore"))) || kinds.includes("chat") || kinds.includes("chore");
  if (target.kind === "cat") return !!chatish && (ignorePrivacy || !meta.levels || meta.levels.includes(target.level));
  const jv = target.jv;
  const ok = takesChat(jv) ? chatish || (jv.any && (kinds.includes("decider") || kinds.includes("workers_decider"))) : kinds.includes(jv.pick);
  return !!ok && (ignorePrivacy || jv.privacy !== "zdr" || !meta.levels || meta.levels.includes("zdr"));
}
export function pickerChoices(state, target) {
  const taken = new Set(takenModels(state, target));
  const base = target.kind === "cat" ? state.choices.chat || [] : state.choices[target.jv.pick] || [];
  // A fallback of the file search index may only be a model the main model lists as equivalent (the save refuses any other).
  const onlyEquivalent = target.kind !== "cat" && target.jv.equivalent_only && target.idx > 0;
  return base.filter((m) => !taken.has(m.id) && (!onlyEquivalent || m.main_equivalent) && !(state.unlisted || []).includes(m.id));
}
export function takenModels(state, target) {
  if (target.free) return [];   // the Sandbox's model menu offers every model, including the job's own fallbacks
  const row = rowByKey(state, target.key);
  const cur = row.kind === "cat" ? row.cat.chains[target.level] : [state.config.jobs[row.id], ...(state.config.jobs[row.id].fallbacks || [])];
  return cur.filter((e, i) => i !== target.idx).map((e) => e.model);
}
// Saved models first, shown with the live catalog's name, reasoning levels and price when the search found them.
export function mergeKnown(saved, fresh, q) {
  const by = Object.fromEntries(fresh.map((f) => [f.id, f])), w = (q || "").toLowerCase();
  return saved.filter((m) => by[m.id] || !w || (m.name + " " + m.id).toLowerCase().includes(w)).map((m) => {
    const f = by[m.id];
    return f ? { ...m, name: f.name || m.name, efforts: f.efforts || m.efforts, default_effort: f.default_effort, pricing: f.pricing, source: f.source || m.source, levels: f.levels || m.levels, kinds: f.kinds || m.kinds, eligible: f.eligible, chat: f.chat || m.chat, context_length: f.context_length } : m;
  });
}
export function pickerList(state, target, q, fresh, src) {
  const t = (q || "").trim().toLowerCase();
  const local = mergeKnown(pickerChoices(state, target), fresh, q), ids = new Set(local.map((m) => m.id));
  const taken = new Set(takenModels(state, target));
  const all = local.concat(fresh.filter((m) => m.eligible && !ids.has(m.id)));
  const out = all.filter((m) => !taken.has(m.id) && pickerAllowed(state, target, m, true) && (src === "all" || srcOf(state, m.id, m.source) === src) && (!t || (m.id + " " + (m.name || "")).toLowerCase().includes(t)));
  return out.map((m) => ({ ...m, allowed: pickerAllowed(state, target, m, false) }));
}
const ctxText = (n) => (n >= 1e6 ? n / 1e6 + "M" : Math.round(n / 1000) + "K");
export function termsTag(m) {
  if (!m.levels) return h`<span class="tag mut2">Terms unknown</span>`;
  if (m.levels.includes("zdr")) return h`<span class="tag ok">ZDR</span>`;
  if (m.levels.includes("no_training")) return h`<span class="tag">No training</span>`;
  return h`<span class="tag warn">Unrestricted only</span>`;
}
export function pickerItem(state, m, i, sel, current) {
  const p = m.pricing && m.pricing.prompt != null && m.pricing.completion != null ? `$${m.pricing.prompt} / $${m.pricing.completion} per M` : "";
  return h`<li class="pk-item${m.allowed ? "" : " off"}" role="option" data-i="${i}" aria-selected="${i === sel}" aria-disabled="${!m.allowed}"><div class="n"><span>${m.name || shortName(m.id)}</span>${badge(srcOf(state, m.id, m.source))}${m.id === current ? h`<span class="tag acc">Current</span>` : ""}</div><div class="r">${termsTag(m)}</div><div class="id mono ell">${m.id}</div><div class="px">${p}${m.context_length > 1 ? " | " + ctxText(m.context_length) + " ctx" : ""}</div></li>`;
}

// ---------------------------------------------------------------- HTML: table
const ICON = {
  search: '<path d="M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', clip: '<path d="M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L14 7"/>',
  left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M5 12h14M13 6l6 6-6 6"/>', up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>', undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>', diff: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 001.3 2.2h12.4a1.5 1.5 0 001.3-2.2L14 9V3M7.5 14h9"/>', sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', refresh: '<path d="M20 11a8 8 0 00-14.5-4M4 4v4h4M4 13a8 8 0 0014.5 4M20 20v-4h-4"/>',
  spin: '<path d="M12 3a9 9 0 019 9"/>',
};
export const icon = (n) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`);
// A time is drawn with its own timestamp so the browser can refresh the words every minute without drawing the page again.
const timeEl = (ms, now) => (ms ? h`<time data-ts="${ms}">${agoText(ms, now)}</time>` : "");

export function view(state, ui, now = Date.now()) {
  const shown = snapshotFromConfig(state), served = state.served || {};
  const rows = rowsOf(state);
  const info = rows.map((row) => {
    const flags = flagsOf(state, ui, row, { snap: shown, served, now });
    return { row, v: viewOf(state, ui, row, shown), flags, ss: servedState(state, row, chainsOf(state, row, shown), served) };
  });
  return { editable: true, shown, info, served, rows };
}

const attention = (V) => V.info.filter((x) => attentionKinds(x.flags).length);
export function visibleInfo(state, ui, V) {
  const q = (ui.q || "").trim().toLowerCase();
  const att = new Set(attention(V).map((x) => x.row.key));
  return V.info.filter((x) => {
    const g = x.row.group;
    if (ui.view === "attention" && !att.has(x.row.key)) return false;
    if (!["all", "attention", "limits", "readonly"].includes(ui.view) && g !== ui.view) return false;
    if (q) {
      const hay = [x.row.label, x.row.desc, x.row.id, ...x.v.chain.flatMap((e) => [e.model, nameOf(state, e.model)])].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// The mark at the end of a row's name: one short word and a dot, red for a problem, amber for a warning.
function mark(flags) {
  const f = flags.find((x) => x.k === "bad") || flags.find((x) => x.k === "warn");
  if (!f) return "";
  return h`<span class="mk ${f.k}" title="${flags.map((x) => x.t).join(", ")}">${f.short || f.t}</span>`;
}
const MODE = { text: "text", image: "images", audio: "audio" };
// Every job reads text, so only a job that also needs pictures or sound gets a mark by its name.
export const modesHtml = (row) => (row.jv?.inputs || []).filter((m) => m !== "text").map((m) => h`<span class="mod" title="Needs a model that reads ${MODE[m] || m}">${MODE[m] || m}</span>`);
const modesText = (row) => (row.jv?.inputs || []).map((m) => MODE[m] || m).join(", ");

// The starting value of a field: what a job holds until someone saves another value. A routing category starts with every limit empty.
export const startOf = (state, row, k) => (row.kind === "job" ? ((state.defaults || {})[row.id] || {})[k] ?? null : null);
const samePrice = (a, b) => (a ? a.prompt : null) === (b ? b.prompt : null) && (a ? a.completion : null) === (b ? b.completion : null);
// The limits of a row that were changed from their starting values, shortest text first. Only these stand out on the list.
export function overridesOf(state, row, v) {
  const out = [], st = (k) => startOf(state, row, k);
  if (v.showOut && (v.max_output ?? null) !== st("max_output")) out.push({ k: "max_output", t: v.max_output == null ? "No output limit" : num(v.max_output) + " max output" });
  if (v.showResults && v.results != null && v.results !== st("results")) out.push({ k: "results", t: v.results + " results" });
  if (v.showSort && (v.sort || null) !== (st("sort") || null)) out.push({ k: "sort", t: "Sort " + sortName(v.sort).toLowerCase() });
  if (v.showSort && !samePrice(v.max_price || null, st("max_price"))) out.push({ k: "max_price", t: v.max_price ? `$${v.max_price.prompt}/$${v.max_price.completion} max` : "Default price" });
  if (v.timeout_ms !== undefined && (v.timeout_ms ?? null) !== (st("timeout_ms") ?? null)) out.push({ k: "timeout_ms", t: v.timeout_ms == null ? "No timeout" : secText(v.timeout_ms) + " timeout" });
  return out;
}
function itemHtml(state, ui, V, x, selKey) {
  const { row, v, flags } = x, m = v.chain[0], fb = v.chain.length - 1, ov = overridesOf(state, row, v);
  const eff = m && v.hasEffort && m.effort && effortsOf(state, m.model).length ? effortName(m.effort) : "";
  const src = m ? srcOf(state, m.model, m.source) : "";
  const sel = row.key === selKey;
  const tail = [eff, fb ? `${fb} fallback${fb === 1 ? "" : "s"}` : ""].filter(Boolean);
  return h`<div class="it" role="option" tabindex="0" data-row="${row.key}" aria-selected="${sel}" aria-current="${sel}"><div class="l1"><b class="ell">${row.label}</b>${modesHtml(row)}<span class="sp"></span>${mark(flags)}</div><div class="l2"><span class="md ell">${m ? h`${src && src !== "OR" ? badge(src) : ""}<span class="ell">${nameOf(state, m.model)}</span>${tail.length ? h`<span class="mut2 nw">${tail.join(" | ")}</span>` : ""}` : h`<span class="mut2">No model</span>`}</span>${ov.length ? h`<span class="chips">${ov.slice(0, 2).map((o) => h`<span class="chip">${o.t}</span>`)}${ov.length > 2 ? h`<span class="chip" title="${ov.slice(2).map((o) => o.t).join(", ")}">+${ov.length - 2}</span>` : ""}</span>` : ""}</div></div>`;
}
function emptyState(ui, V) {
  if (ui.q) return h`<div class="empty"><b>No jobs match "${ui.q}"</b><button class="btn sm" data-act="clearq">Clear search</button></div>`;
  if (ui.view === "attention") return h`<div class="empty"><b>Nothing needs attention</b></div>`;
  return h`<div class="empty"><b>No jobs</b></div>`;
}
// The list: a search box, a filter, and every job in its group with its model, its reasoning level, and only the limits that were changed.
function jobList(state, ui, V, selKey, counts) {
  const vis = visibleInfo(state, ui, V), groups = groupsOf(state);
  const body = groups.map((g) => {
    const items = vis.filter((x) => x.row.group === g.id);
    if (!items.length) return "";
    const add = g.id === "chat" && state.dynamicRouting && V.editable ? h`<button class="btn sm ghost ico" data-act="catadd" aria-label="Add category" title="Add category">${icon("plus")}</button>` : "";
    return h`<div class="grp" role="group" aria-label="${g.title}"><div class="gt"><span>${g.title}</span>${add}</div>${items.map((x) => itemHtml(state, ui, V, x, selKey))}</div>`;
  });
  const flt = (v, label, count) => h`<button data-view="${v}" aria-pressed="${ui.view === v}">${label}${count != null ? h`<i>${count}</i>` : ""}</button>`;
  return h`<section class="listp" aria-label="Jobs"><div class="lhd"><div class="sr"><span class="ico">${icon("search")}</span><input class="inp" data-k="q" data-q placeholder="Search jobs and models" value="${ui.q}" aria-label="Search" autocomplete="off"><span class="kbd">/</span></div><div class="seg flt" role="group" aria-label="Show">${flt("all", "All", V.rows.length)}${flt("attention", "Attention", counts.att)}</div></div><div class="lbody" role="listbox" aria-label="Jobs">${body.some((b) => b !== "") ? body : emptyState(ui, V)}</div></section>`;
}

// ---------------------------------------------------------------- HTML: limits and read only
// The text beside a limit's box: the starting value with a way back to it when the value was changed.
const sideNote = (startText, changed, resetAttrs) => h`${changed ? h`<span class="stn"><span class="mut2 ell">Starting value ${startText}</span><button class="lk" ${raw(resetAttrs)}>Reset</button></span>` : ""}`;
export function limitsView(state, ui, V) {
  const L = state.limits, ro = !V.editable;
  const vals = L ? L.values : null;
  if (!L || !vals) return h`<div class="page narrow"></div>`;
  const tables = L.groups.map((g) => {
    const defs = L.defs.filter((d) => d.group === g.id);
    if (!defs.length) return "";
    return h`<section class="card"><header><h2>${g.title}</h2></header>${defs.map((d) => {
      const changed = vals[d.key] !== d.default;
      return h`<div class="lr" role="group" aria-label="${d.label}"><div class="ln"><b>${d.label}</b><span class="mut" title="${d.description}">${d.description}</span></div><span class="lv-in"><input class="inp r box" ${ro ? "disabled" : ""} data-lim="${d.key}" data-k="lim.${d.key}" inputmode="decimal" value="${vals[d.key]}" aria-label="${d.label}, ${d.unit}"><span class="mut2 unit">${d.unit}</span></span><span class="sn">${sideNote(num(d.default), changed && !ro, `data-act="limreset" data-key="${esc(d.key)}"`)}</span></div>`;
    })}</section>`;
  });
  return h`<div class="page narrow">${tables}</div>`;
}
export function readonlyView(state) {
  return h`<div class="page narrow">${(state.outside || []).map((g) => h`<section class="card ro"><header><h2>${g.title}</h2></header>${g.items.map((i) => h`<div class="lr"><b>${i.label}</b><span class="mono ell">${i.model}${i.source ? badge(i.source) : ""}</span><span class="mut">${i.detail || ""}</span></div>`)}</section>`)}</div>`;
}

// ---------------------------------------------------------------- HTML: the detail of one job (it stays beside the list)
const NOTICE_ICON = { bad: "alert", warn: "alert" };
// One limit: its name, its box, and a note that appears only when the value differs from the starting value.
const limitRow = (id, label, control, side) => h`<div class="fr"><label for="${id}">${label}</label><div class="fc">${control}</div><div class="sn">${side.note}</div></div>`;
export function drawerHtml(state, ui, V, now) {
  const x = V.info.find((i) => i.row.key === ui.sel);
  if (!x) return h`<div class="empty"><b>No job selected</b></div>`;
  const { row, v, flags } = x, ro = !V.editable, jv = row.jv;
  const ent = v.chain.map((e, i) => {
    const efs = effortsOf(state, e.model), src = srcOf(state, e.model, e.source);
    const sel = v.hasEffort && efs.length ? h`<select class="sel" ${ro ? "disabled" : ""} data-df="effort" data-i="${i}" aria-label="Reasoning for ${i ? "fallback " + i : "the main model"}">${(efs.includes(e.effort) || !e.effort ? efs : [e.effort, ...efs]).map((o) => h`<option value="${o}" ${o === e.effort ? "selected" : ""}>${effortName(o)}</option>`)}</select>` : "";
    const ac = ro ? "" : h`<button class="btn sm" data-act="chg" data-i="${i}">Change</button><button class="btn sm ico ghost" data-act="up" data-i="${i}" aria-label="Move up" ${i === 0 ? "disabled" : ""}>${icon("up")}</button><button class="btn sm ico ghost" data-act="dn" data-i="${i}" aria-label="Move down" ${i === v.chain.length - 1 ? "disabled" : ""}>${icon("down")}</button>${v.fixedChain ? "" : h`<button class="btn sm ico ghost" data-act="rm" data-i="${i}" aria-label="Remove" ${v.chain.length < 2 ? "disabled" : ""}>${icon("x")}</button>`}`;
    return h`<div class="ent"><span class="p">${i ? "Fallback " + i : "Main"}</span><div class="m"><div class="mn"><b class="ell">${nameOf(state, e.model)}</b>${badge(src)}</div><div class="id mono ell">${e.model}</div></div><div class="rs">${sel}</div><div class="ac">${ac}</div></div>`;
  });
  const canAdd = !ro && v.hasChain && !v.fixedChain && v.chain.length < v.maxChain;
  const title = row.kind === "cat" && row.id !== "general" && !ro ? h`<input class="inp title-in" data-df="title" value="${row.label}" maxlength="240" aria-label="Category title">` : h`<h2>${row.label}</h2>`;
  const seg = row.kind === "cat" ? h`<div class="seg" role="group" aria-label="Privacy level">${LEVELS.map((l) => h`<button data-lvl="${l}" aria-pressed="${ui.level === l}">${LEVEL_NAME[l]}</button>`)}</div>` : "";
  const reindex = jv?.warnings?.find((w) => /re-index/.test(w));
  const modelsSec = v.hasChain ? h`<section class="sec"><div class="sh"><h3>Models</h3>${seg}<span class="sp"></span>${canAdd ? h`<button class="btn sm" data-act="add">${icon("plus")}Add fallback</button>` : ""}</div><div class="card"><div class="ent head" aria-hidden="true"><span></span><span>Model</span><span>${v.hasEffort ? "Reasoning" : ""}</span><span></span></div>${ent}</div>${reindex ? h`<p class="note">${reindex}</p>` : ""}</section>` : "";
  const st = (k) => startOf(state, row, k);
  const side = (f, startText, changed) => ({ note: h`${changed && !ro ? h`<span class="stn"><span class="mut2 ell">Starting value ${startText}</span><button class="lk" data-act="reset" data-field="${f}">Reset</button></span>` : ""}` });
  const fl = [];
  if (v.showOut) fl.push(limitRow("df-out", "Max output", h`<input id="df-out" class="inp r" ${ro ? "disabled" : ""} data-df="max_output" inputmode="numeric" placeholder="Provider max" value="${v.max_output ?? ""}">`, side("max_output", outText(st("max_output")), (v.max_output ?? null) !== st("max_output"))));
  if (v.showResults) fl.push(limitRow("df-res", "Results", h`<input id="df-res" class="inp r" ${ro ? "disabled" : ""} data-df="results" inputmode="numeric" value="${v.results}">`, side("results", String(st("results")), v.results !== st("results"))));
  if (v.showSort) fl.push(limitRow("df-sort", "Provider sort", h`<select id="df-sort" class="sel" ${ro ? "disabled" : ""} data-df="sort">${Object.keys(SORT).map((k) => h`<option value="${k}" ${k === (v.sort || "") ? "selected" : ""}>${SORT[k]}</option>`)}</select>`, side("sort", sortName(st("sort")), (v.sort || null) !== (st("sort") || null))));
  if (v.showSort) fl.push(limitRow("df-pi", "Max price per million tokens", h`<div class="two"><input id="df-pi" class="inp r" ${ro ? "disabled" : ""} data-df="pi" inputmode="decimal" placeholder="In, default" value="${v.max_price ? v.max_price.prompt : ""}" aria-label="Max input price per million tokens, dollars"><input class="inp r" ${ro ? "disabled" : ""} data-df="po" inputmode="decimal" placeholder="Out, default" value="${v.max_price ? v.max_price.completion : ""}" aria-label="Max output price per million tokens, dollars"></div>`, side("max_price", priceText(st("max_price")), !samePrice(v.max_price || null, st("max_price")))));
  if (v.showTimeout && v.timeout_ms !== undefined) fl.push(limitRow("df-to", "Timeout, seconds", h`<input id="df-to" class="inp r" ${ro ? "disabled" : ""} data-df="timeout" inputmode="decimal" placeholder="None" value="${v.timeout_ms == null ? "" : v.timeout_ms / 1000}">`, side("timeout_ms", secText(st("timeout_ms")), (v.timeout_ms ?? null) !== (st("timeout_ms") ?? null))));
  const limSec = fl.length ? h`<section class="sec"><div class="sh"><h3>Limits</h3></div><div class="card">${fl}</div>${jv?.limit_note ? h`<p class="note ${jv.limit_note.level}">${jv.limit_note.text}</p>` : ""}</section>` : "";
  const sv = x.ss.sv, hist = x.ss.k === "history";
  const svTag = x.ss.t ? h`<span class="tag ${x.ss.k === "fallback" ? "warn" : "bad"}">${x.ss.t}</span>` : "";
  const svSec = !sv || (!sv.served_model && !sv.requested) ? "" : h`<section class="sec"><div class="sh"><h3>Last served</h3>${svTag}${hist ? h`<span class="mut2">Before the last change to this ${row.kind === "cat" ? "category" : "job"}</span>` : ""}</div><div class="card"><dl class="kv"><dt>Model</dt><dd>${sv.served_model ? sv.served_model : h`${sv.requested} (requested name, the answer named no model)`}</dd>${sv.served_model && sv.requested && sv.requested !== sv.served_model ? h`<dt>Requested</dt><dd>${sv.requested}</dd>` : ""}${sv.served_provider ? h`<dt>Provider</dt><dd>${sv.served_provider}</dd>` : ""}<dt>When</dt><dd>${timeEl(sv.last_at, now)}</dd><dt>Calls</dt><dd>${num(sv.calls)}</dd><dt>Status</dt><dd>${sv.last_status && sv.last_status !== "ok" ? h`<span class="tag bad">${sv.last_status}</span>` : h`OK${sv.last_error ? h` <span class="mut">${sv.last_error}</span>` : ""}`}</dd></dl></div></section>`;
  const del = row.kind === "cat" && row.id !== "general" && !ro ? h`<button class="btn sm danger" data-act="catdelete">Delete</button>` : "";
  const notices = flags.filter((f) => f.d);
  const modes = modesText(row);
  return h`<div class="dh"><button class="btn sm ghost goback" data-act="close">${icon("left")}Jobs</button><div class="t">${title}<span class="sp"></span>${del}</div><p class="desc">${row.desc}${modes ? h` <span class="mut2">Reads ${modes}.</span>` : ""}</p>${notices.map((f) => h`<div class="notice ${f.k}">${icon(NOTICE_ICON[f.k] || "alert")}<div><b>${f.t}</b><span>${f.d}</span></div></div>`)}</div><div class="db">${modelsSec}${limSec}${svSec}</div>`;
}


// ---------------------------------------------------------------- HTML: sandbox
// The Sandbox view: every job on the left (a select on a phone), a chat in the middle and the editable request at the bottom. The browser keeps the view's data in
// ui.sb (models-sandbox.js) and redraws only #sb-root when it changes, so typing is never redrawn.
const ROLE = { request: "Request", system: "System", user: "User", assistant: "Assistant", tool: "Tool", developer: "Developer" };
const fmt = (n) => Number(n).toLocaleString("en-US");
export const jsonText = (v) => JSON.stringify(v, null, 2);
const rowsFor = (n) => Math.max(2, Math.min(14, String(n || "").split("\n").reduce((a, l) => a + Math.max(1, Math.ceil(l.length / 90)), 0)));
const chip = (name, size, remove) => h`<span class="sb-chip"><span class="ell">${name}</span>${size != null ? h`<span class="mut2">${size < 1024 ? size + " B" : size < 1048576 ? Math.round(size / 1024) + " KB" : (size / 1048576).toFixed(1) + " MB"}</span>` : ""}${remove ? h`<button class="btn sm ghost ico" data-sb-remove="${remove}" aria-label="Remove ${name}">${icon("x")}</button>` : ""}</span>`;
// A reply that is a JSON object (or a list of objects) is shown as labeled fields. Returns the parsed value, or null when the text is anything else.
export function parseJsonReply(text) {
  const t = String(text ?? "").trim();
  if (t[0] !== "{" && t[0] !== "[") return null;
  let v;
  try { v = JSON.parse(t); } catch { return null; }
  const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  return isObj(v) || (Array.isArray(v) && v.length && v.every(isObj)) ? v : null;
}
export const humanizeKey = (k) => { const s = String(k).replace(/[_\-\s]+/g, " ").trim(); return s ? s[0].toUpperCase() + s.slice(1) : String(k); };
const scalarText = (x) => (typeof x === "string" ? x : String(x));
const isBranch = (x) => x !== null && typeof x === "object";
// depth 0 is the top level, depth 1 is one level inside it, and anything deeper is pretty-printed JSON.
const fieldsOf = (obj, depth) => h`<dl class="sb-kv${depth ? " in" : ""}">${(Array.isArray(obj) ? obj.map((x, i) => [String(i + 1), x]) : Object.entries(obj)).map(([k, x]) => h`<dt>${humanizeKey(k)}</dt><dd>${!isBranch(x) ? h`<span class="sb-text">${scalarText(x)}</span>` : depth >= 1 ? h`<pre class="sb-pre mono">${jsonText(x)}</pre>` : Object.keys(x).length ? fieldsOf(x, depth + 1) : h`<span class="mut">${Array.isArray(x) ? "Empty list" : "Empty"}</span>`}</dd>`)}</dl>`;
export const jsonFieldsHtml = (v) => (Array.isArray(v) ? h`${v.map((o) => fieldsOf(o, 0))}` : fieldsOf(v, 0));
function viewHtml(v, i, open) {
  if (!v) return "";
  const parsed = v.type === "chat" ? parseJsonReply(v.text) : null;
  if (parsed) return h`<div class="sb-fields">${jsonFieldsHtml(parsed)}</div><div class="sb-rawrow"><button class="btn sm ghost" data-sb-json="${i}">${open ? "Hide JSON" : "Show JSON"}</button></div>${open ? h`<pre class="sb-pre mono">${jsonText(parsed)}</pre>` : ""}${v.tool_calls && v.tool_calls.length ? h`<div class="sb-role">Tool calls, not run</div><pre class="sb-pre mono">${jsonText(v.tool_calls)}</pre>` : ""}`;
  if (v.type === "chat") return h`<div class="sb-text">${v.text || ""}</div>${v.tool_calls && v.tool_calls.length ? h`<div class="sb-role">Tool calls, not run</div><pre class="sb-pre mono">${jsonText(v.tool_calls)}</pre>` : ""}`;
  if (v.type === "transcript") return h`<div class="sb-text">${v.text}</div>`;
  if (v.type === "embedding") return h`<div class="sb-text">Vector of ${fmt(v.size)} numbers. First 8: ${v.first.join(", ")}</div>`;
  if (v.type === "ranking") return v.order ? h`<ol class="sb-ol">${v.order.map((r) => h`<li><span class="mono">${r.id}</span> <span class="mut">${r.score}</span></li>`)}</ol>` : h`<pre class="sb-pre mono">${jsonText(v.answers)}</pre>`;
  if (v.type === "search") return h`<ol class="sb-ol">${v.results.map((r) => h`<li><b>${r.title}</b><div class="mono mut ell">${r.url}</div><div>${r.snippet}</div></li>`)}</ol>`;
  if (v.type === "look") return h`<div class="sb-text">${v.answer == null ? "" : typeof v.answer === "string" ? v.answer : jsonText(v.answer)}</div>${v.points ? h`<pre class="sb-pre mono">${jsonText(v.points)}</pre>` : ""}`;
  if (v.type === "answers") return h`<pre class="sb-pre mono">${jsonText(v.answers)}</pre>`;
  return h`<pre class="sb-pre mono">${jsonText(v.json)}</pre>`;
}
// The reasoning level a send actually carried, read from the recorded outgoing request: reasoning.effort, "none" when reasoning is switched off, or null when it has no reasoning field.
export function sentEffort(raw) {
  const reqs = (raw && Array.isArray(raw.requests) ? raw.requests : []).filter((q) => q && ((q.body && typeof q.body === "object") || (q.input && typeof q.input === "object")));
  const b = reqs.length ? reqs[reqs.length - 1].body || reqs[reqs.length - 1].input : null, rs = b && b.reasoning;
  if (!rs || typeof rs !== "object") return null;
  if (typeof rs.effort === "string" && rs.effort) return rs.effort;
  return rs.enabled === false ? "none" : null;
}
// The level a Sandbox send starts on: the job's saved level when the model supports it, otherwise the model's default level.
export const startEffort = (saved, efforts, def) => (efforts.includes(saved) ? saved : efforts.includes(def) ? def : efforts[0] ?? null);
// What the Sandbox header shows for reasoning: { saved, efforts, value } or null when the job has no reasoning level. saved is the job's own first model and level.
export function sandboxEffort(state, sb, id) {
  const cat = id.startsWith("chat:"), jv = cat ? null : state.jobs.find((j) => j.id === id);
  if (!cat && !(jv && jv.has_effort)) return null;
  const c = cat ? state.config.routing.categories.find((x) => x.id === id.slice(5)) : null;
  const saved = cat ? (c && (c.chains.unrestricted || Object.values(c.chains)[0] || [])[0]) : state.config.jobs[id];
  if (!saved) return null;
  const m = sb.model, efforts = m ? (m.efforts || effortsOf(state, m.id)) : effortsOf(state, saved.model);
  const value = sb.effort !== undefined ? sb.effort : m ? startEffort(saved.effort, efforts, m.def) : saved.effort ?? null;
  return { saved: { model: saved.model, effort: saved.effort ?? null }, efforts, value };
}
// Compare slots: slot 0 is the Sandbox state itself (model, effort, history, turns) and ui.sb.extra holds up to two more slots with the same fields.
export const SLOTS_MAX = 3;
export const slotsOf = (sb) => [sb, ...((sb && sb.extra) || [])];
export const newSlot = () => ({ model: null, effort: undefined, history: [], turns: [] });
// The model a slot sends to, as shown in its column header: the picked model, else the job's own.
export const slotModelName = (state, cur, slot) => { const m = slot.model || (cur && cur.model ? { id: cur.model } : null); return m ? m.name || nameOf(state, m.id) : ""; };
function turnHtml(t, i, gold) {
  if (t.role === "reply") {
    const r = t.reply, open = !!t.raw;
    if (!r.ok) return h`<div class="sb-msg a"><div class="sb-err">${r.error}</div>${(r.errors || []).map((e) => h`<div class="mono mut">${e}</div>`)}${rawBtn(i, open, r)}</div>`;
    const sent = sentEffort(r.raw_request);
    const bits = [r.tokens_in != null ? fmt(r.tokens_in) + " in" : "", r.tokens_out != null ? fmt(r.tokens_out) + " out" + (r.tokens_reasoning > 0 ? ` (${fmt(r.tokens_reasoning)} reasoning)` : "") : "", sent ? "reasoning " + effortName(sent).toLowerCase() : "", r.cost != null ? "$" + Number(r.cost).toFixed(r.cost < 0.01 ? 5 : 4) : "", r.ms != null ? (r.ms / 1000).toFixed(1) + " s" : ""].filter(Boolean);
    return h`<div class="sb-msg a"><div class="sb-meta"><b class="ell">${r.served || r.requested || ""}</b>${bits.map((b) => h`<span>${b}</span>`)}</div>${viewHtml(r.view, i, !!t.json)}${goldResultHtml(gold, r.view)}${rawBtn(i, open, r)}</div>`;
  }
  return h`<div class="sb-msg u"><div class="sb-role">${ROLE[t.role] || t.role}</div>${t.text ? h`<div class="sb-text">${t.text}</div>` : ""}${(t.files || []).map((f) => chip(f.name, f.size))}</div>`;
}
const rawBtn = (i, open, r) => h`<div class="sb-rawrow"><button class="btn sm ghost" data-sb-raw="${i}">${open ? "Hide raw request" : "Show raw request"}</button></div>${open ? h`<pre class="sb-pre mono">${jsonText(r.raw_request)}</pre>` : ""}`;

// ---- golden answers (sandbox-golden.js): the panel of expected values and the score under each reply ----
export const goldOf = (sb) => (sb && sb.gold && sb.gold.edit) || null;
export const goldDirty = (g) => !!g && JSON.stringify(g.edit) !== JSON.stringify(g.data.golden);
const diffText = (d) => (d.op === "sub" ? `changed "${d.expected}" to "${d.got}"` : d.op === "del" ? `left out "${d.expected}"` : `added "${d.got}"`);
function goldResultHtml(gold, view) {
  const c = gold ? compareGolden(gold, view) : null;
  if (!c) return "";
  const rows = c.type === "text"
    ? (c.diffs || []).slice(0, 20).map((d) => h`<li class="miss"><span class="sb-gm">Differs</span> ${diffText(d)}</li>`)
    : c.rows.map((x) => h`<li class="${x.ok ? "ok" : "miss"}"><span class="sb-gm">${x.ok ? "Matched" : "Missed"}</span> ${x.ok ? x.label : h`${x.label}${c.type === "items" ? "" : h`, expected <b>${x.expected}</b>, got <b>${x.got || "nothing"}</b>`}`}</li>`);
  const extras = (c.extras || []).map((x) => h`<li class="extra"><span class="sb-gm">Extra</span> ${x}</li>`);
  return h`<div class="sb-gres ${c.pass ? "ok" : "miss"}"><div class="sb-gline">${scoreLine(c)}</div>${rows.length || extras.length ? h`<ul class="sb-gl">${rows}${extras}</ul>` : ""}</div>`;
}
const inp = (attrs, v, label) => h`<input class="cell sb-gi" ${raw(attrs)} value="${v ?? ""}" aria-label="${label}" autocomplete="off">`;
export function goldPanelHtml(sb) {
  const g = sb && sb.gold; if (!g || !g.open || !g.edit) return "";
  const e = g.edit, dirty = goldDirty(g);
  let body = "";
  if (e.type === "choices") {
    const ids = Object.keys(e.value || {});
    body = h`<div class="sb-gtab">${ids.map((id) => { const v = e.value[id], opts = Array.isArray(e.options) ? e.options : null;
      return h`<label class="sb-gr"><span class="mono ell">${id}</span>${opts ? h`<select class="sel sb-gi" data-g="c" data-k="${id}" aria-label="Expected answer for ${id}"><option value="" ${v ? "" : "selected"}></option>${(opts.includes(v) || !v ? opts : [v, ...opts]).map((o) => h`<option value="${o}" ${o === v ? "selected" : ""}>${o}</option>`)}</select>` : inp(`data-g="c" data-k="${esc(id)}"`, v, "Expected answer for " + id)}</label>`; })}</div>`;
  } else if (e.type === "items") {
    const cols = e.match || [];
    body = h`<div class="sb-gtab"><div class="sb-grow head">${cols.map((f) => h`<span>${humanizeKey(f)}</span>`)}<span></span></div>${(e.value || []).map((row, r) => h`<div class="sb-grow">${cols.map((f) => inp(`data-g="i" data-r="${r}" data-f="${esc(f)}"`, row[f], humanizeKey(f) + " of expected item " + (r + 1)))}<button class="btn sm ghost ico" data-sb-gact="rmrow" data-r="${r}" aria-label="Remove expected item ${r + 1}">${icon("x")}</button></div>`)}<div><button class="btn sm" data-sb-gact="addrow">${icon("plus")}Add item</button></div><label class="sb-gx"><input type="checkbox" data-g="x" ${e.extras_fail === false ? "" : "checked"}><span>Extra items fail</span></label></div>`;
  } else if (e.type === "text") {
    body = h`<textarea class="sb-ta" data-g="t" rows="${rowsFor(e.value)}" aria-label="Expected text">${e.value || ""}</textarea><label class="sb-gr sb-gwer"><span>Pass up to this word error rate, percent</span><input class="cell sb-gi" data-g="w" type="number" min="0" max="100" step="1" value="${Math.round((e.max_wer ?? 0.1) * 1000) / 10}" aria-label="Pass level in percent"></label>`;
  } else {
    body = h`<div class="sb-gtab">${(e.value || []).map((p, i) => h`<div class="sb-grow one">${inp(`data-g="p" data-i="${i}"`, p, "Expected phrase " + (i + 1))}<button class="btn sm ghost ico" data-sb-gact="rmrow" data-r="${i}" aria-label="Remove phrase ${i + 1}">${icon("x")}</button></div>`)}<div><button class="btn sm" data-sb-gact="addrow">${icon("plus")}Add phrase</button></div></div>`;
  }
  return h`<div class="sb-gold" data-sb-gold>${body}<div class="sb-act"><span class="sp"></span><button class="btn sm" data-sb-gact="reset" ${g.data.saved || dirty ? "" : "disabled"}>Reset</button><button class="btn sm pri" data-sb-gact="save" ${dirty && !g.busy ? "" : "disabled"}>Save</button></div></div>`;
}
function inputHtml(sb) {
  const d = sb.draft, files = sb.files || {};
  const chipOf = (n, rm) => chip(n, files[n] ? files[n].size : null, rm);
  let blocks;
  if (d.shape === "chat") {
    blocks = d.blocks.map((b, bi) => h`<div class="sb-blk"><div class="sb-role">${ROLE[b.role] || b.role}</div>${b.parts.map((p, pi) => p.t === "text" ? h`<textarea class="sb-ta" data-sb-text data-b="${bi}" data-p="${pi}" rows="${rowsFor(p.text)}" aria-label="${ROLE[b.role] || b.role} message">${p.text}</textarea>` : h`<div class="sb-chips">${p.files.map((n) => chipOf(n, bi + "." + pi))}</div>`)}</div>`);
  } else {
    blocks = h`<div class="sb-blk"><div class="sb-role">Request</div><div class="sb-chips">${[...new Set([...String(d.json).matchAll(/"\$file"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse('"' + m[1] + '"')))].map((n) => chipOf(n, n))}</div><textarea class="sb-ta mono" data-sb-json rows="${rowsFor(d.json)}" aria-label="Request JSON">${d.json}</textarea></div>`;
  }
  return h`${blocks}<div class="sb-act"><button class="btn sm ico" data-sb-act="attach" aria-label="Add a file" title="Add a file">${icon("clip")}</button><input type="file" data-sb-file multiple hidden><span class="sp"></span><button class="btn pri" data-sb-act="send" ${sb.busy ? "disabled" : ""}>${sb.busy ? "Sending" : "Send"}</button></div>`;
}
// The chat area alone (one column, or one per compared model). The browser redraws just this when a golden is edited, so the score under each reply follows the fields.
export function sandboxChat(state, sb) {
  sb = sb || {};
  const cur = (sb.jobs || []).find((j) => j.id === sb.job) || null, slots = slotsOf(sb), gold = goldOf(sb);
  return slots.length > 1 ? h`<div class="sb-chat sb-cols c${slots.length}" data-sb-chat>${slots.map((sl, k) => h`<div class="sb-col"><div class="sb-colh ell">${slotModelName(state, cur, sl)}</div>${(sl.turns || []).map((t, i) => turnHtml(t, k + "." + i, gold))}</div>`)}</div>`
    : h`<div class="sb-chat" data-sb-chat>${(sb.turns || []).map((t, i) => turnHtml(t, "0." + i, gold))}</div>`;
}
export function sandboxInner(state, sb) {
  sb = sb || {};
  const jobs = sb.jobs || [], cur = jobs.find((j) => j.id === sb.job) || null, groups = groupsOf(state).filter((g) => jobs.some((j) => j.group === g.id));
  const list = groups.map((g) => h`<div class="sb-g">${g.title}</div>${jobs.filter((j) => j.group === g.id).map((j) => h`<button class="sb-j" data-sb-job="${j.id}" aria-current="${j.id === sb.job}"><span class="ell">${j.label}</span></button>`)}`);
  const select = h`<select class="sel sb-pick" data-sb-select aria-label="Job"><option value="" ${cur ? "" : "selected"}>Choose a job</option>${groups.map((g) => h`<optgroup label="${g.title}">${jobs.filter((j) => j.group === g.id).map((j) => h`<option value="${j.id}" ${j.id === sb.job ? "selected" : ""}>${j.label}</option>`)}</optgroup>`)}</select>`;
  const slots = slotsOf(sb), multi = slots.length > 1;
  const slotBar = (sl, k) => {
    const m = sl.model || (cur.model ? { id: cur.model } : null), ef = sandboxEffort(state, sl, cur.id), efOpts = ef ? (ef.efforts.includes(ef.value) || !ef.value ? ef.efforts : [ef.value, ...ef.efforts]) : [], sfx = multi ? ` ${k + 1}` : "";
    const efSel = ef && efOpts.length ? h`<select class="cell sb-eff" data-sb-effort data-slot="${k}" aria-label="${multi ? "Reasoning for model" + sfx : "Reasoning for this send"}">${efOpts.map((e) => h`<option value="${e}" ${e === ef.value ? "selected" : ""}>${effortName(e)}</option>`)}</select>` : "";
    return h`<span class="sb-slot">${efSel}${m ? h`<button class="btn sm" data-sb-act="model" data-slot="${k}" aria-label="${multi ? "Model" + sfx : "Model for this send"}"><span class="ell">${m.name || nameOf(state, m.id)}</span>${badge(srcOf(state, m.id, m.source))}</button>` : ""}${sl.model || sl.effort !== undefined ? h`<button class="btn sm ghost ico" data-sb-act="modelreset" data-slot="${k}" aria-label="Use the saved model" title="Use the saved model">${icon("undo")}</button>` : ""}${k ? h`<button class="btn sm ghost ico" data-sb-act="rmslot" data-slot="${k}" aria-label="Remove model ${k + 1}" title="Remove model ${k + 1}">${icon("x")}</button>` : ""}</span>`;
  };
  const bar = cur ? h`<b class="ell">${cur.label}</b><span class="sp"></span>${slots.map(slotBar)}${slots.length < SLOTS_MAX ? h`<button class="btn sm ico" data-sb-act="addslot" aria-label="Add a model to compare" title="Add a model to compare">${icon("plus")}</button>` : ""}` : "";
  const goldBtn = cur && sb.gold && sb.gold.edit ? h`<button class="btn sm" data-sb-gact="toggle" aria-expanded="${!!sb.gold.open}">Golden answers</button>` : "";
  return h`<aside class="sb-list" aria-label="Jobs">${list}</aside><div class="sb-main">${select}<div class="sb-bar">${bar}${goldBtn}</div>${goldPanelHtml(sb)}${cur ? sandboxChat(state, sb) : h`<div class="empty sb-none"><b>Choose a job</b></div>`}<div class="sb-in">${cur && sb.draft ? inputHtml(sb) : ""}</div></div>`;
}
export const sandboxHtml = (state, ui) => h`<div class="sb" id="sb-root">${sandboxInner(state, ui.sb)}</div>`;

// ---------------------------------------------------------------- HTML: the page
// The job shown in the detail: the chosen one when this environment has it, otherwise the first job of the list.
export function resolveSel(state, ui, V) {
  if (ui.sel && V.info.some((i) => i.row.key === ui.sel)) return ui.sel;
  const first = visibleInfo(state, ui, V)[0] || V.info[0];
  return first ? first.row.key : null;
}
export const JOB_VIEWS = ["all", "attention"];
export const isJobsView = (ui, state) => !["limits", "readonly", "sandbox"].includes(ui.view);
export function pageHtml(state, ui, now) {
  const V = view(state, ui, now);
  const att = attention(V).length;
  const jobsMode = isJobsView(ui, state);
  const selKey = resolveSel(state, ui, V), U = { ...ui, sel: selKey };
  const tab = (v, label, count, cls, on) => h`<button data-view="${v}" aria-current="${on ?? ui.view === v}"><span class="lbl">${label}</span>${count != null ? h`<span class="c ${cls || ""}">${count}</span>` : ""}</button>`;
  const tabs = h`<nav class="tabs" aria-label="Models">${tab("all", "Jobs", V.rows.length, "", jobsMode)}${tab("sandbox", "Sandbox")}${tab("limits", "Limits")}${tab("readonly", "Read only")}</nav>`;
  const body = jobsMode ? h`<div class="split${ui.open ? " open" : ""}">${jobList(state, ui, V, selKey, { att })}<section class="detail" aria-label="Job detail">${drawerHtml(state, U, V, now)}</section></div>`
    : ui.view === "sandbox" ? sandboxHtml(state, ui) : ui.view === "limits" ? limitsView(state, ui, V) : readonlyView(state);
  const banners = [state.stale ? h`<div class="banner warn" role="alert">The saved settings could not be read just now, so this page is showing the last copy that was read.</div>` : ""];
  const sv = ui.save || {};
  const saveSlot = h`<span class="savest" data-st="${sv.k || ""}" role="status" aria-live="polite">${sv.k === "saving" ? h`<span class="spin">${icon("spin")}</span><span class="mut">Saving</span>` : sv.k === "saved" ? h`${icon("check")}<span>Saved</span>${ui.undo ? h`<button class="lnk" data-act="undo">Undo</button>` : ""}` : sv.k === "failed" ? h`${icon("alert")}<span>Not saved</span>` : ""}</span>`;
  return h`<div class="app" data-view="${jobsMode ? "jobs" : ui.view}"><header class="top"><a class="brand" href="/"><i></i><span>1Helm</span></a><span class="sp"></span>${saveSlot}<button class="btn" data-act="hist">${icon("clock")}<span class="lbl">History</span></button></header>${tabs}${banners}<main class="body${jobsMode ? " jobs" : ""}${ui.view === "sandbox" ? " sbv" : ""}">${body}</main></div>`;
}

// ---------------------------------------------------------------- HTML: dialogs
export const modalHtml = (title, tag, body, foot, cls) => h`<div class="back"><div class="modal ${cls || ""}" role="dialog" aria-modal="true" aria-label="${title}"><div class="mh"><h3>${title}</h3>${tag ? h`<span class="tag ${tag.cls || ""}">${tag.text}</span>` : ""}<button class="btn sm ghost ico" data-x aria-label="Close">${icon("x")}</button></div><div class="mb" data-body>${body}</div>${foot ? h`<div class="mf" data-foot>${foot}</div>` : ""}</div></div>`;
// ---- history ----
const FIELD_NAME = { chain: "models", effort: "reasoning", max_output: "max output", sort: "sort", max_price: "max price", timeout_ms: "timeout", results: "results", title: "name", value: "value" };
export function changeLabel(state, key) {
  if (key.startsWith("limit:")) return state.limits?.defs?.find((d) => d.key === key.slice(6))?.label || key.slice(6);
  return rowByKey(state, key)?.label || (key.startsWith("cat:") ? "Category" : key);
}
export function actionText(a) {
  const s = String(a || "");
  let m;
  if (s === "seed") return "First settings";
  if (s === "save") return "";
  if ((m = /^restore:(\d+)$/.exec(s))) return `Restored revision ${m[1]}`;
  if ((m = /^add-jobs:(.*)$/.exec(s))) return "Added " + m[1].split(",").join(", ");
  if (s === "add-dynamic-routing") return "Added routing categories";
  if (s === "strip-provider-lists") return "Removed saved provider lists";
  if (s === "admin") return "Saved by an administrator script";
  return s;
}
export function changeLines(state, changes) {
  return (changes || []).map((c) => c.added ? `${changeLabel(state, c.key)} added` : c.removed ? `${changeLabel(state, c.key)} removed` : `${changeLabel(state, c.key)}: ${c.fields.map((f) => FIELD_NAME[f] || f).join(", ")}`);
}
export function historyBody(state, confirmRev) {
  const rows = (state.history || []).map((x) => {
    const cur = x.revision === state.revision;
    const act = cur ? "" : confirmRev === x.revision ? h`<button class="btn sm pri" data-do="${x.revision}">Restore</button><button class="btn sm" data-no>Cancel</button>` : h`<button class="btn sm" data-rs="${x.revision}">Restore</button>`;
    const lines = changeLines(state, x.changes), head = actionText(x.action), shown = lines.slice(0, 4);
    const what = h`${head ? h`<div><b>${head}</b></div>` : ""}${shown.map((l) => h`<div class="${head ? "mut" : ""}">${l}</div>`)}${lines.length > shown.length ? h`<div class="mut2">and ${lines.length - shown.length} more</div>` : ""}${!head && !lines.length ? h`<div class="mut2">${x.changes ? "No change to a job or limit" : "Saved"}</div>` : ""}`;
    return h`<div class="hr${cur ? " now" : ""}"><div class="rev"><b>${x.revision}</b>${cur ? h`<span class="tag ok">Now</span>` : ""}</div><div class="what">${what}<div class="mut2 by">${new Date(x.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}, ${x.by}</div></div><div class="act">${act}</div></div>`;
  });
  return h`<div class="hist">${rows}</div>`;
}
export const historyModal = (state, confirmRev) => modalHtml("History", null, historyBody(state, confirmRev), null, "wide");
export const confirmModal = (title, body, ok, danger) => modalHtml(title, null, h`<div class="pad16">${body}</div>`, h`<span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn pri${danger ? " bad" : ""}" data-go>${ok}</button>`, "");
export function pickerModal(state, target, title) {
  const lv = target.kind === "cat" ? target.level : target.jv.privacy === "zdr" ? "zdr" : "unrestricted";
  return modalHtml(title, lv !== "unrestricted" ? { cls: "ok", text: lv === "zdr" ? "ZDR models" : "No training models" } : null,
    h`<div class="pk-top"><input class="inp" data-q type="search" placeholder="Search every model or paste an ID" autocomplete="off" spellcheck="false" aria-label="Search models"><div class="seg" data-src><button aria-pressed="true" data-v="all">All</button><button aria-pressed="false" data-v="OR">OpenRouter</button><button aria-pressed="false" data-v="CF">Cloudflare</button></div></div><ul class="pk-list" data-list role="listbox"></ul>`, null, "pk");
}

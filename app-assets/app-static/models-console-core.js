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
export const GROUP_TITLE = { chat: "Chat categories", routing: "Routing", background: "Background jobs", memory: "Memory (Hindsight)", speech: "Speech", search: "Search and media", other: "Other" };
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
export const priceText = (p) => (p ? `$${p.prompt} / $${p.completion}` : "No cap");
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
export function servedState(state, row, chains, served) {
  const sv = servedRow(row, served);
  if (!sv) return { k: "none" };
  if (sv.last_status && sv.last_status !== "ok") return { k: "error", t: "Last call failed", sv };
  if (!sv.requested) return { k: "none", sv };
  const firsts = chains.map((c) => c[0]?.model).filter(Boolean), ids = chains.flat().map((e) => e.model);
  if (firsts.includes(sv.requested)) return { k: "ok", sv };
  if (ids.includes(sv.requested)) return { k: "fallback", t: "Served a fallback", sv };
  return sv.legacy ? { k: "none", sv } : { k: "other", t: "Served an unlisted model", sv };
}
export function chainsOf(state, row, snap) {
  if (row.kind === "cat") return LEVELS.map((lv) => snap.cats[row.id]?.levels?.[lv] || []);
  return [snap.jobs[row.id]?.chain || []];
}
export function flagsOf(state, ui, row, ctx) {
  // ctx: { snap, served }
  const f = [], jv = row.jv;
  const ss = servedState(state, row, chainsOf(state, row, ctx.snap), ctx.served);
  if (ss.t) f.push({ k: ss.k === "fallback" ? "warn" : "bad", t: ss.t });
  const gone = state.unlisted || [];
  if (chainsOf(state, row, ctx.snap).flat().some((e) => gone.includes(e.model))) f.push({ k: "warn", t: "A model is no longer offered" });
  if (jv) {
    for (const w of jv.warnings || []) if (/no allowed model|can't run here/.test(w)) f.push({ k: "bad", t: w });
    if (jv.limit_note?.level === "warn") f.push({ k: "warn", t: "Max output above what the providers can serve" });
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
    case "chain": {   // replace a whole list (a whole list): entries are { model, effort, strict? }
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
const ICON = { search: '<path d="M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', clip: '<path d="M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L14 7"/>', up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>', undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' };
export const icon = (n) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`);

export function view(state, ui) {
  const shown = snapshotFromConfig(state), served = state.served || {};
  const rows = rowsOf(state);
  const info = rows.map((row) => {
    const flags = flagsOf(state, ui, row, { snap: shown, served });
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

function dot(flags) {
  const k = flags.find((x) => x.k === "bad") ? "bad" : flags.find((x) => x.k === "warn") ? "warn" : "";
  return k ? h`<span class="dot ${k}" title="${flags.map((x) => x.t).join(", ")}"></span>` : "";
}
function effortSelect(state, x, ro, extra) {
  const e0 = x.v.chain[0];
  if (!e0 || !x.v.hasEffort) return h`<span class="mut2 pad">None</span>`;
  const efs = effortsOf(state, e0.model);
  if (!efs.length) return e0.effort ? h`<span class="pad">${effortName(e0.effort)}</span>` : h`<span class="mut2 pad">None</span>`;
  const opts = efs.includes(e0.effort) || !e0.effort ? efs : [e0.effort, ...efs];
  return h`<select class="cell" ${ro ? "disabled" : ""} data-f="effort" data-id="${x.row.key}" data-k="${x.row.key}.e" aria-label="Reasoning for ${x.row.label}">${opts.map((e) => h`<option value="${e}" ${e === e0.effort ? "selected" : ""}>${effortName(e)}</option>`)}</select>`;
}
const MODE = { text: ["T", "Needs a model that reads text"], image: ["\u{1F5BC}", "Needs a model that reads images"], audio: ["\u{1F3A4}", "Needs a model that reads audio"] };
export const modesHtml = (row) => (row.jv?.inputs || []).map((m) => h`<span class="mod" title="${MODE[m][1]}">${MODE[m][0]}</span>`);
function rowHtml(state, ui, V, x, now) {
  const { row, v, flags } = x, ro = !V.editable, dis = ro ? "disabled" : "", id = row.key;
  const m = v.chain[0], fb = v.chain.slice(1);
  const sv = x.ss.sv, st = x.ss.k;
  const bad = st === "error" || st === "other" ? "bad" : st === "fallback" ? "warn" : "";
  const served = !sv ? "" : st === "error" && !sv.served_model ? h`<div class="sv bad"><span class="mut2">Failed ${agoText(sv.last_error_at || sv.last_at, now)}</span></div>`
    : sv.served_model ? h`<div class="sv ${bad}"><span class="ell">${nameOf(state, sv.served_model)}</span><span class="mut2">${st === "error" ? "Failed " + agoText(sv.last_error_at || sv.last_at, now) : agoText(sv.last_at, now)}</span></div>`
    : sv.requested ? h`<div class="sv ${bad}" title="The answer named no model, so this is the model that was asked"><span class="ell">${nameOf(state, sv.requested)}</span><span class="mut2">Requested name, ${agoText(sv.last_at, now)}</span></div>` : "";
  const first = attentionKinds(flags)[0] || flags[0];
  const phone = first ? h`<span class="tag ${first.k}">${{ warn: "Warning", bad: "Problem" }[first.k]}</span>` : "";
  const out = v.showOut ? h`<input class="cell r2" ${dis} data-f="max_output" data-id="${id}" data-k="${id}.o" inputmode="numeric" value="${v.max_output ?? ""}" placeholder="Max" title="Empty means the provider's maximum" aria-label="Max output for ${row.label}">` : v.showResults ? h`<span class="mut2 pad r2">${v.results} results</span>` : h`<span class="mut2">n/a</span>`;
  const sortCell = v.showSort ? h`<select class="cell" ${dis} data-f="sort" data-id="${id}" data-k="${id}.s" aria-label="Provider sort for ${row.label}">${Object.keys(SORT).map((k) => h`<option value="${k}" ${k === (v.sort || "") ? "selected" : ""}>${SORT[k]}</option>`)}</select>` : h`<span class="mut2">n/a</span>`;
  const priceCell = v.showSort ? h`<div class="pr"><input class="cell r2" ${dis} data-f="price" data-w="prompt" data-id="${id}" data-k="${id}.pi" inputmode="decimal" placeholder="in" value="${v.max_price ? v.max_price.prompt : ""}" aria-label="Max input price for ${row.label}"><input class="cell r2" ${dis} data-f="price" data-w="completion" data-id="${id}" data-k="${id}.po" inputmode="decimal" placeholder="out" value="${v.max_price ? v.max_price.completion : ""}" aria-label="Max output price for ${row.label}"></div>` : h`<span class="mut2">n/a</span>`;
  const timeout = v.showTimeout && v.timeout_ms !== undefined ? h`<input class="cell r2" ${dis} data-f="timeout" data-id="${id}" data-k="${id}.t" inputmode="decimal" placeholder="None" value="${v.timeout_ms == null ? "" : v.timeout_ms / 1000}" aria-label="Timeout in seconds for ${row.label}">` : h`<span class="mut2">n/a</span>`;
  const modelCell = !v.hasChain ? "" : m ? h`<div class="mdl"><span class="ell">${nameOf(state, m.model)}</span>${badge(srcOf(state, m.model, m.source))}</div>` : h`<span class="mut2">None</span>`;
  const fbCell = fb.length ? h`<span class="ell" title="${fb.map((e) => nameOf(state, e.model)).join(", ")}">${fb.map((e) => nameOf(state, e.model)).join(", ")}</span>` : h`<span class="mut2">None</span>`;
  return h`<div class="rw" role="row" tabindex="0" data-row="${id}" aria-selected="${ui.sel === id}"><div class="cf">${dot(flags)}</div><div class="nm cn"><div class="lb"><b class="ell">${row.label}</b>${modesHtml(row)}</div></div><div class="cm">${modelCell}</div><div>${v.hasChain ? effortSelect(state, x, ro) : ""}</div><div class="fb">${v.hasChain ? fbCell : ""}</div><div>${out}</div><div>${sortCell}</div><div>${priceCell}</div><div>${timeout}</div><div class="cs">${served}</div><div class="cp">${phone}</div></div>`;
}
const HEAD = h`<div class="gh" role="row"><div></div><div>Job</div><div>Model</div><div>Reasoning</div><div>Fallbacks</div><div class="r2">Max output</div><div>Sort</div><div>Max price in / out $</div><div class="r2">Timeout</div><div>Last served</div></div>`;
function jobsTable(state, ui, V, now) {
  const vis = visibleInfo(state, ui, V), groups = groupsOf(state);
  const body = groups.map((g) => {
    const items = vis.filter((x) => x.row.group === g.id);
    if (!items.length) return "";
    const seg = g.id === "chat" && state.dynamicRouting ? h`<span class="seg ml-auto" role="group" aria-label="Privacy level">${LEVELS.map((l) => h`<button data-lvl="${l}" aria-pressed="${ui.level === l}">${LEVEL_NAME[l]}</button>`)}</span>${V.editable ? h`<button class="btn sm" data-act="catadd" aria-label="Add category" title="Add category">${icon("plus")}<span class="lbl">Add category</span></button>` : ""}` : "";
    return h`<div class="gtitle">${g.title} <span class="mut2 gc">${items.length}</span>${seg}</div>${items.map((x) => rowHtml(state, ui, V, x, now))}`;
  });
  return h`<div class="tbl" role="table">${HEAD}${body.some((b) => b !== "") ? body : h`<div class="empty">No jobs match</div>`}</div>`;
}

// ---------------------------------------------------------------- HTML: limits and read only
export function limitsView(state, ui, V) {
  const L = state.limits, ro = !V.editable;
  const vals = L ? L.values : null;
  if (!L || !vals) return h`<div class="vh"><h1>Limits</h1></div>`;
  const tables = L.groups.map((g) => {
    const defs = L.defs.filter((d) => d.group === g.id);
    if (!defs.length) return "";
    return h`<div class="vh vh2"><h1>${g.title}</h1></div><div class="lim"><div class="lh"><div>Limit</div><div>Value</div><div>Starting value</div></div>${defs.map((d) => {
      return h`<div class="lr"><div class="ln"><b>${d.label}</b><span class="mut ell" title="${d.description}">${d.description}</span></div><span class="lv-in"><input class="cell r2 box" ${ro ? "disabled" : ""} data-lim="${d.key}" data-k="lim.${d.key}" inputmode="decimal" value="${vals[d.key]}" aria-label="${d.label}, ${d.unit}"><span class="mut2 unit">${d.unit}</span></span><span class="mut2">${num(d.default)}</span></div>`;
    })}</div>`;
  });
  return h`<div class="vh"><h1>Limits</h1></div>${tables}`;
}
export function readonlyView(state) {
  return h`<div class="vh"><h1>Read only</h1><span class="tag">Set outside this page</span></div>${(state.outside || []).map((g) => h`<div class="ro"><h3>${g.title}</h3>${g.items.map((i) => h`<div class="lr"><b>${i.label}</b><span class="mono">${i.model}${i.source ? badge(i.source) : ""}</span><span class="mut">${i.detail || ""}</span></div>`)}</div>`)}`;
}

// ---------------------------------------------------------------- HTML: inspector
export function drawerHtml(state, ui, V, now) {
  const x = V.info.find((i) => i.row.key === ui.sel);
  if (!x) return h``;
  const { row, v, flags } = x, ro = !V.editable, jv = row.jv, ids = visibleInfo(state, ui, V).map((i) => i.row.key), pos = ids.indexOf(row.key);
  const ent = v.chain.map((e, i) => {
    const efs = effortsOf(state, e.model), src = srcOf(state, e.model, e.source);
    const sel = v.hasEffort && efs.length ? h`<div class="rs"><span class="mut">Reasoning</span><select class="sel" ${ro ? "disabled" : ""} data-df="effort" data-i="${i}" aria-label="Reasoning for model ${i + 1}">${(efs.includes(e.effort) || !e.effort ? efs : [e.effort, ...efs]).map((o) => h`<option value="${o}" ${o === e.effort ? "selected" : ""}>${effortName(o)}</option>`)}</select></div>` : "";
    const ac = ro ? "" : h`<button class="btn sm" data-act="chg" data-i="${i}">Change</button><button class="btn sm ico ghost" data-act="up" data-i="${i}" aria-label="Move up" ${i === 0 ? "disabled" : ""}>${icon("up")}</button><button class="btn sm ico ghost" data-act="dn" data-i="${i}" aria-label="Move down" ${i === v.chain.length - 1 ? "disabled" : ""}>${icon("down")}</button>${v.fixedChain ? "" : h`<button class="btn sm ico ghost" data-act="rm" data-i="${i}" aria-label="Remove" ${v.chain.length < 2 ? "disabled" : ""}>${icon("x")}</button>`}`;
    return h`<div class="ent"><span class="p">${i + 1}</span><div class="m"><span class="ell">${nameOf(state, e.model)}</span>${badge(src)}</div><div class="ac">${ac}</div><div class="id mono ell">${e.model}</div>${sel}</div>`;
  });
  const canAdd = !ro && v.hasChain && !v.fixedChain && v.chain.length < v.maxChain;
  const title = row.kind === "cat" && row.id !== "general" && !ro ? h`<input class="inp title-in" data-df="title" value="${row.label}" maxlength="240" aria-label="Category title">` : h`<h2>${row.label}</h2>`;
  const seg = row.kind === "cat" ? h`<div class="seg seg-top" role="group" aria-label="Privacy level">${LEVELS.map((l) => h`<button data-lvl="${l}" aria-pressed="${ui.level === l}">${LEVEL_NAME[l]}</button>`)}</div>` : "";
  const modelsSec = v.hasChain ? h`<div class="sec"><h4>Models${row.kind === "cat" ? ", " + LEVEL_NAME[v.level] : ""}${canAdd ? h`<button class="btn sm ml-auto nocaps" data-act="add">${icon("plus")}Add fallback</button>` : ""}</h4>${ent}${jv?.warnings?.some((w) => /re-index/.test(w)) ? h`<span class="tag warn">Changing it needs a re-index</span>` : ""}</div>` : "";
  const fl = [];
  if (v.showOut) fl.push(h`<div><label>Max output</label><input class="inp r" ${ro ? "disabled" : ""} data-df="max_output" inputmode="numeric" placeholder="Provider max" value="${v.max_output ?? ""}" aria-label="Max output"></div>`);
  if (v.showResults) fl.push(h`<div><label>Results</label><input class="inp r" ${ro ? "disabled" : ""} data-df="results" inputmode="numeric" value="${v.results}" aria-label="Results"></div>`);
  if (v.showTimeout && v.timeout_ms !== undefined) fl.push(h`<div><label>Timeout, seconds</label><input class="inp r" ${ro ? "disabled" : ""} data-df="timeout" inputmode="decimal" placeholder="None" value="${v.timeout_ms == null ? "" : v.timeout_ms / 1000}" aria-label="Timeout in seconds"></div>`);
  if (v.showSort) fl.push(h`<div><label>Provider sort</label><select class="sel" ${ro ? "disabled" : ""} data-df="sort" aria-label="Provider sort">${Object.keys(SORT).map((k) => h`<option value="${k}" ${k === (v.sort || "") ? "selected" : ""}>${SORT[k]}</option>`)}</select></div>`);
  if (v.showSort) fl.push(h`<div><label>Max price per M tokens</label><div class="two"><input class="inp r" ${ro ? "disabled" : ""} data-df="pi" placeholder="in" value="${v.max_price ? v.max_price.prompt : ""}" aria-label="Max input price per million tokens"><input class="inp r" ${ro ? "disabled" : ""} data-df="po" placeholder="out" value="${v.max_price ? v.max_price.completion : ""}" aria-label="Max output price per million tokens"></div></div>`);
  const limSec = fl.length ? h`<div class="sec"><h4>Limits</h4><div class="fg">${fl}</div>${jv?.limit_note ? h`<p class="note ${jv.limit_note.level}">${jv.limit_note.text}</p>` : ""}</div>` : "";
  const sv = x.ss.sv;
  const svSec = !sv || (!sv.served_model && !sv.requested) ? "" : h`<div class="sec"><h4>Last served</h4><dl class="kv"><dt>Model</dt><dd>${sv.served_model ? sv.served_model : h`${sv.requested} (requested name, the answer named no model)`}</dd>${sv.served_model && sv.requested && sv.requested !== sv.served_model ? h`<dt>Requested</dt><dd>${sv.requested}</dd>` : ""}${sv.served_provider ? h`<dt>Provider</dt><dd>${sv.served_provider}</dd>` : ""}<dt>When</dt><dd>${agoText(sv.last_at, now)}</dd><dt>Calls</dt><dd>${num(sv.calls)}</dd><dt>Status</dt><dd>${sv.last_status && sv.last_status !== "ok" ? h`<span class="tag bad">${sv.last_status}</span>` : h`OK${sv.last_error ? h` <span class="tag bad">${sv.last_error}</span>` : ""}`}</dd></dl></div>`;
  const del = row.kind === "cat" && row.id !== "general" && !ro ? h`<button class="btn sm danger" data-act="catdelete">Delete</button>` : "";
  return h`<div class="dh"><div class="t">${title}<button class="btn sm ghost ico" data-act="close" aria-label="Close">${icon("x")}</button></div><div class="tg">${flags.map((f) => h`<span class="tag ${f.k}">${f.t}</span>`)}</div><p>${row.desc}</p>${seg}</div><div class="db">${modelsSec}${limSec}${svSec}</div><div class="dfoot"><button class="btn sm ico" data-act="prev" aria-label="Previous job" ${pos < 1 ? "disabled" : ""}>${icon("up")}</button><button class="btn sm ico" data-act="next" aria-label="Next job" ${pos < 0 || pos >= ids.length - 1 ? "disabled" : ""}>${icon("down")}</button><span class="grow"></span>${del}<button class="btn sm pri" data-act="close">Done</button></div>`;
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
  return h`<aside class="sb-list" aria-label="Jobs">${list}</aside><div class="sb-main">${select}<div class="sb-bar">${bar}${goldBtn}</div>${goldPanelHtml(sb)}${sandboxChat(state, sb)}<div class="sb-in">${cur && sb.draft ? inputHtml(sb) : ""}</div></div>`;
}
export const sandboxHtml = (state, ui) => h`<div class="vh"><h1>Sandbox</h1></div><div class="sb" id="sb-root">${sandboxInner(state, ui.sb)}</div>`;

// ---------------------------------------------------------------- HTML: the page
export function pageHtml(state, ui, now) {
  const V = view(state, ui);
  const counts = {}; for (const r of V.rows) counts[r.group] = (counts[r.group] || 0) + 1;
  const att = attention(V).length;
  const navb = (v, label, count, cls) => h`<button data-view="${v}" aria-current="${ui.view === v}">${label}${count != null ? h`<span class="c ${cls || ""}">${count}</span>` : ""}</button>`;
  const jobsMode = !["limits", "readonly", "sandbox"].includes(ui.view);
  const titleOf = () => (ui.view === "all" ? "All jobs" : ui.view === "attention" ? "Needs attention" : groupsOf(state).find((g) => g.id === ui.view)?.title || "");
  const body = jobsMode ? h`<div class="vh"><h1>${titleOf()}</h1><span class="mut">${visibleInfo(state, ui, V).length} jobs</span></div>${jobsTable(state, ui, V, now)}` : ui.view === "sandbox" ? sandboxHtml(state, ui) : ui.view === "limits" ? limitsView(state, ui, V) : readonlyView(state);
  const stale = state.stale ? h`<div class="stale" role="alert">The saved settings could not be read just now, so this page is showing the last copy that was read.</div>` : "";
  return h`<div class="shell"><aside class="side"><a class="brand" href="/"><i></i>1Helm</a>
<div class="nav"><h6>Models</h6>${navb("all", "All jobs", V.rows.length)}${navb("attention", "Needs attention", att, att ? "hot" : "")}${navb("sandbox", "Sandbox")}</div>
<div class="nav"><h6>Groups</h6>${groupsOf(state).map((g) => navb(g.id, g.title, counts[g.id] || 0))}</div>
<div class="nav"><h6>Settings</h6>${navb("limits", "Limits")}${navb("readonly", "Read only")}</div></aside>
<div class="main">${stale}<div class="top"><div class="sr"><span class="ico">${icon("search")}</span><input class="inp" data-k="q" data-q placeholder="Search jobs and models" value="${ui.q}" aria-label="Search" autocomplete="off"><span class="kbd">/</span></div><span class="sp"></span><button class="btn" data-act="hist">${icon("clock")}History</button></div>${body}</div></div>
<div class="scrim${ui.sel ? " open" : ""}" data-act="close"></div><aside class="drawer${ui.sel ? " open" : ""}" aria-label="Job inspector">${ui.sel ? drawerHtml(state, ui, V, now) : ""}</aside>`;
}

// ---------------------------------------------------------------- HTML: dialogs
export const modalHtml = (title, tag, body, foot, cls) => h`<div class="back"><div class="modal ${cls || ""}" role="dialog" aria-modal="true" aria-label="${title}"><div class="mh"><h3>${title}</h3>${tag ? h`<span class="tag ${tag.cls || ""}">${tag.text}</span>` : ""}<button class="btn sm ghost ico" data-x aria-label="Close">${icon("x")}</button></div><div class="mb" data-body>${body}</div>${foot ? h`<div class="mf" data-foot>${foot}</div>` : ""}</div></div>`;
export function historyBody(state, confirmRev) {
  const rows = (state.history || []).map((x) => {
    const cur = x.revision === state.revision;
    const act = cur ? "" : confirmRev === x.revision ? h`<button class="btn sm pri" data-do="${x.revision}">Restore</button> <button class="btn sm" data-no>Cancel</button>` : h`<button class="btn sm" data-rs="${x.revision}">Restore</button>`;
    return h`<tr><td><b>${x.revision}</b> ${cur ? h`<span class="tag ok">Now</span>` : ""}</td><td>${new Date(x.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td><td>${x.by}</td><td>${x.action}</td><td class="r2">${act}</td></tr>`;
  });
  return h`<table class="t"><thead><tr><th>Revision</th><th>When</th><th>By</th><th>What</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}
export const historyModal = (state, confirmRev) => modalHtml("History", null, historyBody(state, confirmRev), null, "wide");
export const confirmModal = (title, body, ok, danger) => modalHtml(title, null, h`<div class="pad16">${body}</div>`, h`<span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn pri${danger ? " bad" : ""}" data-go>${ok}</button>`, "");
export function pickerModal(state, target, title) {
  const lv = target.kind === "cat" ? target.level : target.jv.privacy === "zdr" ? "zdr" : "unrestricted";
  return modalHtml(title, lv !== "unrestricted" ? { cls: "ok", text: lv === "zdr" ? "ZDR models" : "No training models" } : null,
    h`<div class="pk-top"><input class="inp" data-q type="search" placeholder="Search every model or paste an ID" autocomplete="off" spellcheck="false" aria-label="Search models"><div class="seg" data-src><button aria-pressed="true" data-v="all">All</button><button aria-pressed="false" data-v="OR">OpenRouter</button><button aria-pressed="false" data-v="CF">Cloudflare</button></div></div><ul class="pk-list" data-list role="listbox"></ul>`, null, "pk");
}

// Settings → Advanced → Custom Model Selection. Off by default. When it is on, this account's chat answers from its own categories: each has a first
// model and two fallbacks (each with its reasoning level) and a max price in and out. Max output, sort and timeout stay ours.
// On an own AI key (the server says own_key, and endpoint "openrouter" or "plain") the editor is the same: General starts with the key's main model and the person adds up to two
// fallbacks, a category has one to three models, the picker lists the models their own endpoint serves, and max price shows only on OpenRouter.
// The editing rules are the /models console's own (proto app-assets/app-static/models-console-core.js: applyEdit, newEntry, pickerList, termsTag), loaded
// the first time the card is opened, so a category behaves here exactly as it does there. The server (proto src/custom-models.js) validates every save,
// lists only models with a provider allowed at the account's privacy level, and owns the truth; this file never decides what is allowed.
//   GET  account/custom-models          → { on, level, needs_choice, problems, max_categories, categories: [{ id, title, chain: [{model, effort}], max_price }], models: { id: card } }
//   GET  account/custom-models/catalog?q= → { level, models: [card] }
//   POST account/custom-models { on?, categories?, background? } → the same view as the first line (or { error })
// On an own key the view also has background: { title, chain } (Background jobs: the models that write task titles and labels, the hand-off note and the browser's plan), edited with the same rows.
// A card is { id, name, source, efforts, default_effort, levels, pricing, allowed }. Without a Worker (the design sandbox) a small in-memory copy answers.
type Card = { id: string; name: string; source?: string; context_length?: number | null; efforts: string[]; default_effort: string | null; levels: string[]; pricing?: { prompt: number; completion: number } | null; allowed?: boolean; eligible?: boolean; kinds?: string[] };
type Entry = { model: string; effort: string | null };
type Price = { prompt: number; completion: number };
type Cat = { id: string; title: string; chain: Entry[]; max_price: Price | null };
type Problem = { category: string; category_id: string; slot: number; model: string | null; name: string; why: string };
type Deps = {
  api: ((path: string, init?: { method?: string; body?: any }) => Promise<any>) | null;   // null: design sandbox (no Worker)
  repaint: () => void;
  shown: () => boolean;                                   // Settings is open on the Advanced page
  srow: (icon: string, title: string, sub: string, right: string, attrs?: string) => string;
  ask: (o: { title: string; body?: string; confirm?: string; cancel?: string | null }) => Promise<boolean>;
  openAdvanced: () => void;
  version: string;
  noteBoot: (v: { on: boolean; level?: string; own_key?: boolean; needs_choice: boolean; problems: Problem[] }) => void;   // keeps the boot answer current for the rest of the app
};
let D: Deps | null = null;
const LEVEL_NAME: Record<string, string> = { unrestricted: "Unrestricted", no_training: "No Training", zdr: "Zero Data Retention" };
const SLOT = ["First choice", "Second choice", "Third choice"];
const M: { loaded: boolean; loading: boolean; busy: boolean; err: string; on: boolean; level: string; own: boolean; endpoint: string; needs: boolean; problems: Problem[]; max: number; cats: Cat[]; bg: Cat | null; models: Record<string, Card>;
  draft: Record<string, { prompt: string; completion: string }>; core: any } =
  { loaded: false, loading: false, busy: false, err: "", on: false, level: "zdr", own: false, endpoint: "", needs: false, problems: [], max: 12, cats: [], bg: null, models: {}, draft: {}, core: null };
const BG = "background";
const BG_NOTE = "Writes task titles, labels and the note at the end of each task, and plans the browser's steps. Your chats use the categories above.";
let queue: Promise<unknown> = Promise.resolve();
// Repaint Settings and give the focus back to the control that had it (the page is drawn again from text).
const KEYS = ["cmtoggle", "cmadd", "cmdel", "cmpick", "cmeff", "cmtitle", "cmprice", "cmfb", "cmrm"];
function repaint() {
  const a = document.activeElement as HTMLElement | null, key = a && KEYS.find(k => a.hasAttribute?.(`data-${k}`)), val = key ? a!.getAttribute(`data-${key}`) : null;
  D?.repaint();
  if (key) (document.querySelector(`[data-${key}${val ? `="${CSS.escape(val)}"` : ""}]`) as HTMLElement | null)?.focus({ preventScroll: true });
}
let prompted = false;

const findCat = (id: string): Cat | undefined => (id === BG ? M.bg ?? undefined : M.cats.find(x => x.id === id));
const esc_id = (m: { id: string; name?: string }) => (m.name && m.name !== m.id ? m.id : "");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const newId = () => "c_" + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const effortLabel = (e: string | null) => e ? ({ none: "None", default: "Default", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum" } as Record<string, string>)[e] || e : "";

// ---- the editor's rules come from the /models console ----
async function loadCore() {
  if (M.core) return M.core;
  const url = new URL(`./models-console-core.js?v=${encodeURIComponent(D?.version || "")}`, import.meta.url).href;
  return (M.core = await import(/* @vite-ignore */ url));
}
// The console's own settings shape for the account's categories at its level, so applyEdit/pickerList work on them unchanged.
const asConfig = () => ({ version: 3, jobs: {}, routing: { categories: [...M.cats, ...(M.bg ? [M.bg] : [])].map(c => ({ id: c.id, title: c.title, chains: { [M.level]: clone(c.chain) }, max_price: c.max_price ?? null })) }, catalog: clone(M.models) });
const asState = (cfg = asConfig()) => ({ dynamicRouting: true, config: cfg, groups: [{ id: "chat", title: "Chat categories" }], jobs: [], choices: { chat: [] as any[] }, unlisted: [] as string[] });
const fromConfig = (cfg: any): Cat[] => cfg.routing.categories.filter((c: any) => c.id !== BG).map((c: any) => ({ id: c.id, title: String(c.title), chain: c.chains[M.level].map((e: any) => ({ model: e.model, effort: e.effort ?? null })), max_price: c.max_price ?? null }));

function adopt(v: any) {
  M.on = !!v.on; M.level = v.level || M.level; M.own = !!v.own_key; M.endpoint = M.own ? v.endpoint || "plain" : ""; M.needs = !!v.needs_choice; M.problems = v.problems || []; M.max = v.max_categories || M.max;
  M.cats = v.categories || []; M.bg = v.background?.chain ? { id: BG, title: "Background jobs", chain: v.background.chain, max_price: null } : null; M.models = v.models || {}; M.draft = {}; M.loaded = true;
  note(v);
}
function note(v: { on?: boolean; level?: string; own_key?: boolean; needs_choice?: boolean; problems?: Problem[] }) {   // what the rest of the app reads (boot answer)
  D?.noteBoot({ on: !!v.on, level: v.level, ...(v.own_key ? { own_key: true } : {}), needs_choice: !!v.needs_choice, problems: v.problems || [] });
}
async function load(force = false) {
  if (!D || M.loading || (M.loaded && !force)) return;
  M.loading = true;
  try { adopt(await call("account/custom-models")); M.err = ""; }
  catch (e: any) { M.err = e?.message || "Couldn't load this. Try again in a minute."; }
  finally { M.loading = false; if (D?.shown()) repaint(); }
}
const call = (path: string, init?: { method?: string; body?: any }) => (D?.api || demoApi)(path, init);
function save(body: any, after?: () => void) {
  queue = queue.then(async () => {
    M.busy = true; M.err = "";
    try { adopt(await call("account/custom-models", { method: "POST", body })); after?.(); }
    catch (e: any) { M.err = e?.message || "Couldn't save that. Try again in a minute."; await load(true).catch(() => {}); }
    finally { M.busy = false; repaint(); }
  });
  return queue;
}
// edits: console edits (applyEdit), applied in order to the saved categories and saved once.
async function commit(edits: any[]) {
  const core = await loadCore(); let cfg = asConfig(), changed = false;
  for (const e of edits) { const next = core.applyEdit(cfg, { ...e, level: M.level }); if (next) { cfg = next; changed = true; } }
  if (!changed) { repaint(); return; }
  const all = cfg.routing.categories.map((c: any) => ({ id: c.id, title: String(c.title), chain: c.chains[M.level].map((e: any) => ({ model: e.model, effort: e.effort ?? null })), max_price: c.max_price ?? null }));
  M.cats = all.filter((c: Cat) => c.id !== BG); const bg = all.find((c: Cat) => c.id === BG); if (bg && M.bg) M.bg = bg; repaint();   // shown at once; the server answer replaces it
  return save({ categories: M.cats.map(c => ({ id: c.id, title: c.title, chain: c.chain, max_price: c.max_price })), ...(M.bg ? { background: { chain: M.bg.chain } } : {}) });
}

// ---- the card ----
export function cmodelsCard(): string {
  if (!D) return "";
  void load();
  const toggle = `<button type="button" class="tg${M.on ? " on" : ""}" role="switch" aria-checked="${M.on}" aria-label="Custom Model Selection" data-cmtoggle${M.busy || (!M.loaded && !M.err) ? " disabled" : ""}><i></i></button>`;
  const row = `<div class="sc">${D.srow("", "Custom Model Selection", "Chat uses your own models instead of the defaults.", toggle, " data-cmrow")}</div>`;
  const err = M.err ? `<p role="alert" class="meta cmerr">${esc(M.err)}</p>` : "";
  if (!M.on || !M.loaded) return row + err;
  const bad = new Set(M.problems.map(p => `${p.category_id}|${p.slot}`));
  const need = M.needs ? `<p role="alert" class="meta cmerr">Your privacy setting is ${esc(LEVEL_NAME[M.level] || M.level)}. Replace the models marked below to keep working.</p>` : "";
  return row + err + need + `<div class="sc cmx" data-cmx>${M.cats.map(c => catHtml(c, bad)).join("")}${M.cats.length < M.max ? `<div class="cmadd"><button type="button" class="sa blue" data-cmadd>Add category</button></div>` : ""}${M.bg ? catHtml(M.bg, bad) : ""}</div>`;
}
function catHtml(c: Cat, bad: Set<string>) {
  const d = M.draft[c.id], pin = d ? d.prompt : c.max_price ? String(c.max_price.prompt) : "", pout = d ? d.completion : c.max_price ? String(c.max_price.completion) : "";
  const isBg = c.id === BG;
  const head = isBg ? `<b class="cmname">Background jobs</b>` : c.id === "general" ? `<b class="cmname">General</b>` : `<input class="cmtitle" data-cmtitle="${esc(c.id)}" value="${esc(c.title)}" maxlength="80" autocomplete="off" aria-label="Category name"><button type="button" class="sa mute" data-cmdel="${esc(c.id)}" aria-label="Delete ${esc(c.title)}">Delete</button>`;
  const slots = c.chain.map((e, i) => {
    const m = M.models[e.model], levels = m?.efforts || [], many = levels.length > 1, isBad = bad.has(`${c.id}|${i}`);
    const only = levels.length === 1 ? levels[0] : "none", label = `${SLOT[i]} reasoning level for ${c.title}`;
    // On an own key a model that came with no reasoning level sends none ("Default"); an account that started from its main model has no level chosen yet.
    const dflt = M.own && e.effort == null ? `<option value="" selected>Default</option>` : "";
    const options = many ? dflt + levels.map(x => `<option value="${esc(x)}"${x === e.effort ? " selected" : ""}>${esc(effortLabel(x))}</option>`).join("") : M.own && !levels.length ? `<option value="" selected>Default</option>` : `<option value="${esc(only)}" selected>${esc(effortLabel(only))}</option>`;
    const select = `<select class="cmeff" ${many ? `data-cmeff="${esc(c.id)}|${i}" aria-label="${esc(label)}"` : `disabled aria-label="${esc(label)}${levels.length ? ": the only reasoning level for this model" : ": this model has no reasoning levels"}"`}>${options}</select>`;
    const rm = M.own ? i === 0 ? `<span class="cmrmgap"></span>` : `<button type="button" class="cmrm" data-cmrm="${esc(c.id)}|${i}" aria-label="Remove the ${esc(SLOT[i].toLowerCase())} model from ${esc(c.title)}">Remove</button>` : "";
    return `<div class="cmslot${isBad ? " bad" : ""}${rm ? " cmhasrm" : ""}${rm && i > 0 ? " cmrmb" : ""}"><span class="cmlab">${SLOT[i]}</span><button type="button" class="cmmodel" data-cmpick="${esc(c.id)}|${i}" aria-label="${esc(SLOT[i])} model for ${esc(c.title)}: ${esc(m?.name || e.model)}"><span>${esc(m?.name || e.model)}</span></button>${select}${rm}${isBad ? `<span class="cmwhy">Not available with ${esc(LEVEL_NAME[M.level] || M.level)}</span>` : ""}</div>`;
  }).join("");
  const priceErr = d && (!!d.prompt !== !!d.completion) ? `<p class="meta cmerr">Enter both prices, or leave both empty.</p>` : "";
  const addFb = M.own && c.chain.length < SLOT.length ? `<div class="cmfbrow"><button type="button" class="sa blue" data-cmfb="${esc(c.id)}">Add fallback</button></div>` : "";
  const prices = M.endpoint === "plain" || isBg ? "" : `<div class="cmprice"><label><span>Max price in</span><span class="cmusd">$<input type="number" inputmode="decimal" min="0" max="10000" step="any" data-cmprice="${esc(c.id)}|prompt" value="${esc(pin)}" placeholder="Default" aria-label="Max price in, dollars per million tokens"></span></label>
      <label><span>Max price out</span><span class="cmusd">$<input type="number" inputmode="decimal" min="0" max="10000" step="any" data-cmprice="${esc(c.id)}|completion" value="${esc(pout)}" placeholder="Default" aria-label="Max price out, dollars per million tokens"></span></label></div>${priceErr}`;
  const note = isBg ? `<p class="cmbgnote">${esc(BG_NOTE)}</p>` : "";
  return `<section class="cmcat${isBg ? " cmbg" : ""}" data-cmcat="${esc(c.id)}"><div class="cmhead">${head}</div>${note}${slots}${addFb}${prices}</section>`;
}

// ---- events ----
const at = (e: Event) => e.target as HTMLElement;
document.addEventListener("click", e => {
  const t = at(e);
  const tog = t.closest<HTMLButtonElement>("[data-cmtoggle]");
  if (tog) { e.preventDefault(); if (M.busy || !D) return; const on = !M.on; M.on = on; repaint(); void save({ on }); return; }
  if (t.closest("[data-cmadd]")) { e.preventDefault(); void commit([{ t: "catAdd", newId: newId() }]); return; }
  const del = t.closest<HTMLElement>("[data-cmdel]");
  if (del) { e.preventDefault(); const id = del.dataset.cmdel!, c = findCat(id);
    void D?.ask({ title: `Delete ${c?.title || "this category"}?`, body: "Its models and prices are removed. General stays.", confirm: "Delete" }).then(ok => { if (ok) void commit([{ t: "catDelete", cat: id }]); }); return; }
  const fb = t.closest<HTMLElement>("[data-cmfb]");
  if (fb) { e.preventDefault(); const id = fb.dataset.cmfb!, c = findCat(id); if (c) void openPicker(id, c.chain.length, fb); return; }
  const rm = t.closest<HTMLElement>("[data-cmrm]");
  if (rm) { e.preventDefault(); const [id, i] = rm.dataset.cmrm!.split("|"), c = findCat(id); if (c) void commit([{ t: "chain", cat: id, entries: c.chain.filter((_, k) => k !== Number(i)).map(x => ({ model: x.model, effort: x.effort })) }]); return; }
  const pick = t.closest<HTMLElement>("[data-cmpick]");
  if (pick) { e.preventDefault(); const [id, i] = pick.dataset.cmpick!.split("|"); void openPicker(id, Number(i), pick); }
});
document.addEventListener("change", e => {
  const t = at(e);
  const eff = t.closest<HTMLSelectElement>("[data-cmeff]");
  if (eff) { const [id, i] = eff.dataset.cmeff!.split("|"); void commit([{ t: "effort", cat: id, idx: Number(i), value: eff.value === "" ? null : eff.value }]); return; }
  const ti = t.closest<HTMLInputElement>("[data-cmtitle]");
  if (ti) { const id = ti.dataset.cmtitle!, v = ti.value.trim(), c = findCat(id); if (!c || v === c.title) { ti.value = c?.title || ""; return; }
    if (!v) { ti.value = c.title; return; } void commit([{ t: "title", cat: id, value: v }]); return; }
  const pr = t.closest<HTMLInputElement>("[data-cmprice]");
  if (pr) {
    const [id, which] = pr.dataset.cmprice!.split("|"), c = findCat(id); if (!c) return;
    const d = M.draft[id] ||= { prompt: c.max_price ? String(c.max_price.prompt) : "", completion: c.max_price ? String(c.max_price.completion) : "" };
    (d as any)[which] = pr.value.trim();
    const a = d.prompt, b = d.completion;
    if (!a && !b) { delete M.draft[id]; void commit([{ t: "field", cat: id, field: "max_price", value: null }]); return; }
    const ok = (s: string) => s !== "" && Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 10000;
    if (ok(a) && ok(b)) { delete M.draft[id]; void commit([{ t: "field", cat: id, field: "max_price", value: { prompt: Number(a), completion: Number(b) } }]); return; }
    repaint();
  }
});

// ---- the model picker: a list of models allowed at the account's privacy level, with a search box ----
let layer: HTMLElement | null = null, opener: HTMLElement | null = null, searchTimer = 0, seq = 0;
const P: { cat: string; idx: number; q: string; list: any[]; loading: boolean; err: string; sel: number } = { cat: "", idx: 0, q: "", list: [], loading: false, err: "", sel: 0 };
function closePicker() { layer?.remove(); layer = null; document.removeEventListener("keydown", pickerKeys, true); const o = opener; opener = null; o?.isConnected && o.focus({ preventScroll: true }); }
function pickerKeys(e: KeyboardEvent) {
  if (!layer) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closePicker(); return; }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); P.sel = Math.max(0, Math.min(P.list.length - 1, P.sel + (e.key === "ArrowDown" ? 1 : -1))); paintList(); layer.querySelector(`[data-cmsel="${P.sel}"]`)?.scrollIntoView({ block: "nearest" }); return; }
  if (e.key === "Enter" && (e.target as HTMLElement).matches?.("[data-cmq]") && P.list[P.sel]) { e.preventDefault(); void choose(P.sel); }
}
async function openPicker(cat: string, idx: number, from: HTMLElement) {
  const core = await loadCore(); if (layer) closePicker();
  opener = from; Object.assign(P, { cat, idx, q: "", list: [], loading: true, err: "", sel: 0 });
  layer = document.createElement("div"); layer.className = "cmback";
  const c = findCat(cat);
  layer.innerHTML = `<div class="cmpick" role="dialog" aria-modal="true" aria-label="Choose a model"><div class="cmph"><h3>${esc(c?.title || "")}, ${esc(SLOT[idx].toLowerCase())}</h3><button type="button" class="cmx2" data-cmclose aria-label="Close">×</button></div>
    <p class="cmpl">${M.endpoint === "plain" ? "Models your AI service offers." : `Models that work with ${esc(LEVEL_NAME[M.level] || M.level)}.`}</p><input class="cmq" data-cmq type="search" placeholder="Search models" autocomplete="off" aria-label="Search models"><div class="cmlist" data-cmlist role="listbox" aria-label="Models"></div></div>`;
  document.body.appendChild(layer);
  layer.addEventListener("mousedown", e => { if (e.target === layer) closePicker(); });
  layer.addEventListener("click", e => { const t = at(e); if (t.closest("[data-cmclose]")) closePicker(); const s = t.closest<HTMLElement>("[data-cmsel]"); if (s) void choose(Number(s.dataset.cmsel)); });
  layer.querySelector<HTMLInputElement>("[data-cmq]")!.addEventListener("input", e => { P.q = (e.target as HTMLInputElement).value; clearTimeout(searchTimer); searchTimer = window.setTimeout(() => void fetchList(), 300); });
  document.addEventListener("keydown", pickerKeys, true);
  layer.querySelector<HTMLInputElement>("[data-cmq]")!.focus();
  void core; await fetchList();
}
async function fetchList() {
  const mine = ++seq; P.loading = true; P.err = ""; paintList();
  try {
    const r = await call(`account/custom-models/catalog?q=${encodeURIComponent(P.q.trim())}`);
    if (mine !== seq) return;
    const fresh: Card[] = (r.models || []).map((m: Card) => ({ ...m, eligible: true, kinds: ["chat"], ...(m.source === "BYOK" ? { levels: undefined } : {}) }));   // an own endpoint's models carry no privacy terms
    const target = { kind: "cat", key: "cat:" + P.cat, level: M.level, idx: P.idx };
    P.list = M.core.pickerList(asState(), target, P.q, fresh, "all").filter((m: any) => m.allowed !== false);   // the server already lists only what the level allows
  } catch (e: any) { if (mine !== seq) return; P.list = []; P.err = e?.message || "Couldn't search. Try again."; }
  P.loading = false; P.sel = 0; paintList();
}
function paintList() {
  const el = layer?.querySelector<HTMLElement>("[data-cmlist]"); if (!el) return;
  el.innerHTML = P.err ? `<p class="meta cmerr" role="alert">${esc(P.err)}</p>` : P.list.length ? P.list.map((m, i) => {
    const price = m.pricing && m.pricing.prompt != null ? `$${m.pricing.prompt} in, $${m.pricing.completion} out per million` : "";
    const facts = m.source === "BYOK" ? [price, m.context_length ? `${m.context_length >= 1e6 ? m.context_length / 1e6 + "M" : Math.round(m.context_length / 1000) + "K"} context` : ""].filter(Boolean).join(", ") || esc_id(m)
      : [m.levels?.includes("zdr") ? "Zero Data Retention" : m.levels?.includes("no_training") ? "No Training" : "Unrestricted only", price].filter(Boolean).join(", ");
    return `<button type="button" class="cmitem${i === P.sel ? " on" : ""}" role="option" aria-selected="${i === P.sel}" data-cmsel="${i}"><span class="cmin">${esc(m.name || m.id)}</span><span class="cmis">${esc(facts)}</span></button>`;
  }).join("") : P.loading ? "" : `<p class="cmpl">No models found.</p>`;
}
async function choose(i: number) {
  const m = P.list[i]; if (!m || !M.core) return;
  const c = findCat(P.cat); if (!c) return closePicker();
  const card: Card = { id: m.id, name: m.name, source: m.source, efforts: m.efforts || [], default_effort: m.default_effort ?? null, levels: m.levels || [], pricing: m.pricing };
  M.models[m.id] = card;
  const entry = M.core.newEntry(asState(), null, card, c.chain[P.idx], M.level);
  closePicker();
  await commit([{ t: "entry", cat: P.cat, idx: P.idx, entry: { model: entry.model, effort: entry.effort } }]);
}

// ---- hooks for v3.ts ----
export function cmodelsInit(deps: Deps, boot?: { on?: boolean; level?: string; own_key?: boolean; needs_choice?: boolean; problems?: Problem[] } | null) {
  D = deps;
  if (boot) { M.on = !!boot.on; M.level = boot.level || M.level; M.own = !!boot.own_key; M.needs = !!boot.needs_choice; M.problems = boot.problems || []; if (M.needs) window.setTimeout(() => void promptNeeded(), 1500); }
}
// The privacy setting just changed (the server's answer): re-read this account's models, and ask for new choices when some are no longer allowed.
export function cmodelsPrivacy(v?: { on?: boolean; level?: string; own_key?: boolean; needs_choice?: boolean; problems?: Problem[] } | null) {
  if (!D || !v) return;
  M.on = !!v.on; M.level = v.level || M.level; M.own = !!v.own_key; M.needs = !!v.needs_choice; M.problems = v.problems || []; M.loaded = false; note(v);
  if (M.on) void load(true);
  if (M.needs) void promptNeeded();
}
async function promptNeeded() {
  if (!D || !M.needs || prompted) return; prompted = true;
  const names = M.problems.filter(p => p.model).slice(0, 4).map(p => `${p.name || p.model} (${p.category})`).join(", ");
  const go = await D.ask({ title: "Choose new models", body: `Your privacy setting is ${LEVEL_NAME[M.level] || M.level}, and ${names || "some of your chosen models"} can't be used with it. Chat is paused until you choose new models.`, confirm: "Choose models", cancel: "Not now" });
  prompted = false; if (go) D.openAdvanced();
}
export const cmodelsNeedChoice = () => M.on && M.needs;

// ---- the design sandbox has no Worker: a small in-memory copy of the same answers ----
const DEMO: Card[] = [
  { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", efforts: ["none", "low", "medium", "high"], default_effort: "low", levels: ["unrestricted", "no_training", "zdr"], pricing: { prompt: 0.14, completion: 0.28 } },
  { id: "openai/gpt-6-luna", name: "GPT-6 Luna", efforts: ["none", "low", "medium", "high"], default_effort: "medium", levels: ["unrestricted", "no_training", "zdr"], pricing: { prompt: 0.6, completion: 2.4 } },
  { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", efforts: ["none", "low", "medium", "high"], default_effort: "low", levels: ["unrestricted", "no_training", "zdr"], pricing: { prompt: 1, completion: 5 } },
  { id: "openai/gpt-oss-120b", name: "GPT OSS 120B", efforts: ["low", "medium", "high"], default_effort: "medium", levels: ["unrestricted", "no_training", "zdr"], pricing: { prompt: 0.1, completion: 0.4 } },
  { id: "example/open-model", name: "Open Model", efforts: ["default"], default_effort: "default", levels: ["unrestricted"], pricing: { prompt: 0.2, completion: 0.8 } },
];
const demo = { on: false, categories: null as Cat[] | null };
async function demoApi(path: string, init?: { method?: string; body?: any }) {
  const level = "zdr", body = init?.body;
  const view = () => { const cats = demo.categories || (demo.categories = [{ id: "general", title: "General", chain: DEMO.slice(0, 3).map(m => ({ model: m.id, effort: m.default_effort })), max_price: null }]);
    return { on: demo.on, level, needs_choice: false, problems: [], max_categories: 12, categories: clone(cats), models: Object.fromEntries(DEMO.map(m => [m.id, { ...m, allowed: m.levels.includes(level) }])) }; };
  if (path.startsWith("account/custom-models/catalog")) { const q = decodeURIComponent(path.split("q=")[1] || "").toLowerCase(); return { level, models: DEMO.filter(m => m.levels.includes(level) && `${m.id} ${m.name}`.toLowerCase().includes(q)) }; }
  if (init?.method === "POST") { if (typeof body.on === "boolean") demo.on = body.on; if (body.categories) demo.categories = clone(body.categories); }
  return view();
}

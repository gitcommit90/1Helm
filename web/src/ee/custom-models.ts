// Settings → Advanced → Custom Model Selection (for 1Helm's own models; the own-key editor lives in Settings → AI services → Models, cmodelsOwnPanel). Off by default.
// Both editors share this module's state, told apart by `scope`: the AI services page asks the server for ?scope=services (the own-key editor on every plan, as soon as a service is connected;
// choosing is optional on a full plan, so no warning shows) and Advanced asks with no scope (1Helm's models, or the own-key editor while an own key answers chat). Opening the other page starts the state over. When it is on, this account's chat answers from its own categories: each has a first
// model and two fallbacks (each with its reasoning level) and a max price in and out. Max output, sort and timeout stay ours.
// On an own AI key (the server says own_key) this is the only place its models are chosen (task byok-multi): there is no switch (it is always used), nothing is chosen for the account until it picks
// General's first model, and the person adds up to two fallbacks. A category has one to three models, and the picker lists the models of every connected service together, each labelled with its
// service, so one chain or Background jobs may mix services. A model is named <connection id>:<model id>. The reasoning level of each model is a row of text buttons (Default, Low, ...), with only the
// levels that model lists. Max price shows only when OpenRouter is connected.
// The editing rules are the /models console's own (proto app-assets/app-static/models-console-core.js: applyEdit, newEntry, pickerList, termsTag), loaded
// the first time the card is opened, so a category behaves here exactly as it does there. The server (proto src/custom-models.js) validates every save,
// lists only models with a provider allowed at the account's privacy level, and owns the truth; this file never decides what is allowed.
//   GET  account/custom-models          → { on, level, needs_choice, problems, max_categories, categories: [{ id, title, chain: [{model, effort}], max_price }], models: { id: card } }
//   GET  account/custom-models/catalog?q= → { level, models: [card] }
//   POST account/custom-models { on?, categories?, background? } → the same view as the first line (or { error })
// On an own key the view also has background: { title, chain } (Background jobs: the models that write task titles and labels, the hand-off note and the browser's plan), edited with the same rows.
// A card is { id, name, source, efforts, default_effort, levels, pricing, allowed }. Without a Worker (the design sandbox) a small in-memory copy answers.
type Card = { id: string; name: string; service?: string; conn?: string; family?: string; source?: string; context_length?: number | null; efforts: string[]; default_effort: string | null; levels: string[]; pricing?: { prompt: number; completion: number } | null; allowed?: boolean; eligible?: boolean; kinds?: string[] };
type Entry = { model: string; effort: string | null };
type Price = { prompt: number; completion: number };
type Cat = { id: string; title: string; chain: Entry[]; max_price: Price | null };
type Problem = { category: string; category_id: string; slot: number; model: string | null; name: string; why: string };
type Deps = {
  api: ((path: string, init?: { method?: string; body?: any }) => Promise<any>) | null;   // null: design sandbox (no Worker)
  repaint: () => void;
  shown: () => boolean;                                   // Settings is open on the Advanced page or on AI services
  srow: (icon: string, title: string, sub: string, right: string, attrs?: string) => string;
  ask: (o: { title: string; body?: string; confirm?: string; cancel?: string | null }) => Promise<boolean>;
  openAdvanced: () => void;
  openAi?: () => void;                                    // Settings, AI services (where an own key's models are chosen)
  saved?: () => void;                                     // a save of the models went through (Settings, AI services reads its plan option again: choosing General's model can turn Use my services now on)
  version: string;
  noteBoot: (v: { on: boolean; level?: string; own_key?: boolean; needs_choice: boolean; problems: Problem[] }) => void;   // keeps the boot answer current for the rest of the app
};
import { efsHtml, efsMount, efsPressed } from "./effort-slider";
import { logoChip, serviceDomain } from "../logo";   // logo.dev through /logo/<domain>: the service's logo beside its name
let D: Deps | null = null;
type Scope = "" | "services";
let scope: Scope = "";
const boot0 = { on: false, own: false };   // what the boot answer said about Advanced: kept so the Advanced card doesn't flash the wrong editor while its own answer loads
const LEVEL_NAME: Record<string, string> = { unrestricted: "Unrestricted", no_training: "No Training", zdr: "Zero Data Retention" };
const SLOT = ["First choice", "Second choice", "Third choice"];
type Svc = { id: string; kind: string; label: string; host?: string };
const M: { fetched: boolean; at: number; loaded: boolean; loading: boolean; busy: boolean; err: string; on: boolean; level: string; own: boolean; endpoint: string; needs: boolean; problems: Problem[]; max: number; cats: Cat[]; bg: Cat | null; models: Record<string, Card>;
  draft: Record<string, { prompt: string; completion: string }>; core: any; noModel: boolean; optional: boolean; svcs: Svc[]; hasOr: boolean } =
  { fetched: false, at: 0, loaded: false, loading: false, busy: false, err: "", on: false, level: "zdr", own: false, endpoint: "", needs: false, problems: [], max: 12, cats: [], bg: null, models: {}, draft: {}, core: null, noModel: false, optional: false, svcs: [], hasOr: false };
const BG = "background";
// The service's label with its logo in front (ChatGPT, OpenCode, OpenRouter, or the address of an OpenAI-compatible service). The logo leaves by itself if it can't load.
const svcTag = (service: string, conn?: string) => { const c = M.svcs.find(x => x.id === conn); return `<i class="cmsvc">${c ? logoChip(serviceDomain(c.kind, c.host), 14) : ""}${esc(service)}</i>`; };
const BG_NOTE = "Writes task titles, labels and the note at the end of each task, and plans the browser's steps. Your chats use the categories above.";
let queue: Promise<unknown> = Promise.resolve();
// Repaint Settings and give the focus back to the control that had it (the page is drawn again from text).
const KEYS = ["cmtoggle", "cmadd", "cmdel", "cmpick", "cmeff", "cmlvl", "cmtitle", "cmprice", "cmfb", "cmrm"];
// While a pointer is down on a reasoning slider the page is never redrawn, so the control under the pointer stays the same element and follows it.
export const cmodelsDragging = () => efsPressed();
function repaint() {
  if (efsPressed()) return;
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
const effortLabel = (e: string | null) => e ? ({ none: "None", default: "Default", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" } as Record<string, string>)[e] || e : "";

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

function adopt(v: any, fromCache = false) {
  M.on = !!v.on; M.level = v.level || M.level; M.own = !!v.own_key; M.endpoint = M.own ? v.endpoint || "plain" : ""; M.needs = !!v.needs_choice; M.problems = v.problems || []; M.max = v.max_categories || M.max;
  M.cats = v.categories || []; M.bg = v.background?.chain ? { id: BG, title: "Background jobs", chain: v.background.chain, max_price: null } : null; M.models = v.models || {}; M.draft = {}; M.loaded = true;
  M.noModel = !!v.no_model; M.optional = !!v.optional; M.svcs = Array.isArray(v.connections) ? v.connections : []; M.hasOr = !!v.has_openrouter; if (M.own) M.on = true;   // an own key has no switch: it is always used
  if (!fromCache) { lastJson = JSON.stringify(v); cachePut(v); }
  if (scope === "") { boot0.on = M.on; boot0.own = M.own; if (!fromCache) note(v); }   // the boot answer is about Advanced only
}
function note(v: { on?: boolean; level?: string; own_key?: boolean; needs_choice?: boolean; problems?: Problem[] }) {   // what the rest of the app reads (boot answer)
  D?.noteBoot({ on: !!v.on, level: v.level, ...(v.own_key ? { own_key: true } : {}), needs_choice: !!v.needs_choice, problems: v.problems || [] });
}
// The last answer is kept in this browser (localStorage, by workspace; models and settings only, no key or token), so Settings, AI services draws the Models section in full on every open.
// It is read again in the background (at most every 15 seconds, and whenever the page opens), and the page changes in place only when the answer differs.
const ckey = () => { try { const slug = String((window as any).__1HC?.slug || ""); return D?.api && slug ? `1hc-ai-models:${slug}${scope === "services" ? "" : ":adv"}` : ""; } catch { return ""; } };
const cacheGet = (): any => { try { const k = ckey(); const raw = k ? localStorage.getItem(k) : null; const v = raw ? JSON.parse(raw) : null; return v && Array.isArray(v.categories) ? v : null; } catch { return null; } };
const cachePut = (v: any) => { try { const k = ckey(); if (k) localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: the page just draws from the server's answer */ } };
let lastJson = "", hydrated = false, warmedAt = 0;
// The page that is open decides which editor this state holds; the other page's answer is dropped and read again when it opens.
function setScope(want: Scope) {
  if (scope === want) return;
  scope = want; hydrated = false; lastJson = ""; warmedAt = 0;
  Object.assign(M, { fetched: false, at: 0, loaded: false, err: "", cats: [], bg: null, models: {}, draft: {}, svcs: [], noModel: false, optional: false, needs: false, problems: [], endpoint: "", own: want === "services" || boot0.own, on: want === "services" || boot0.on });
}
function hydrate() { if (hydrated || M.loaded) return; hydrated = true; const v = cacheGet(); if (v) { try { adopt(v, true); lastJson = JSON.stringify(v); } catch { M.loaded = false; } } }
async function load(force = false, restore = false) {   // restore: a refused save put the unsaved choice on screen, so the saved answer is drawn again even if it is the one already held
  if (!D || M.loading) return;
  hydrate();
  if (M.fetched && !force && Date.now() - M.at < 15000) return;
  M.loading = true; M.at = Date.now(); let changed = false; const sc = scope;
  try {
    const v = await call("account/custom-models"), j = JSON.stringify(v);
    if (sc !== scope) return;   // the other page opened while this answer was on its way
    if (restore || j !== lastJson) { if (force || !Object.keys(M.draft).length) { adopt(v); changed = true; } }
    if (M.err) { M.err = ""; changed = true; }
    M.fetched = true;
    if (M.own && M.svcs.length && (force || Date.now() - warmedAt > 5 * 60e3)) { warmedAt = Date.now(); void call("account/custom-models/catalog?warm=1").catch(() => {}); }   // the server reads each service's model list now, so the picker opens with models
  } catch (e: any) { if (!M.loaded) { M.err = e?.message || "Couldn't load this. Try again in a minute."; changed = true; } }
  finally { M.loading = false; if (changed && D?.shown()) repaint(); }
}
// Every request of the editor carries its scope, first in the query so the sandbox and the server read the rest as before.
const scoped = (path: string) => (scope === "services" ? (path.includes("?") ? path.replace("?", "?scope=services&") : `${path}?scope=services`) : path);
const call = (path: string, init?: { method?: string; body?: any }) => (D?.api || demoApi)(scoped(path), init);
function save(body: any, after?: () => void) {
  queue = queue.then(async () => {
    M.busy = true; M.err = "";
    const sc = scope;
    try { const v = await call("account/custom-models", { method: "POST", body }); if (sc === scope) { adopt(v); after?.(); D?.saved?.(); } }
    catch (e: any) { const why = e?.message || "Couldn't save that. Try again in a minute."; for (let i = 0; M.loading && i < 40; i++) await new Promise(r => setTimeout(r, 100)); await load(true, true).catch(() => {}); M.err = why; }   // the reload puts the saved choice back, and the reason stays on screen
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
// An own key's editor (General's models, background jobs, categories), drawn under Settings, AI services, Models. hasConn: the account has a connected service.
// Until its answer is read it holds the place with a loading row, so the plan options below don't jump.
export function cmodelsOwnPanel(hasConn: boolean): string {
  if (!D || !hasConn) return "";
  setScope("services"); hydrate(); void load();
  const err = M.err ? `<p role="alert" class="meta cmerr">${esc(M.err)}</p>` : "";
  if (!M.loaded || !M.svcs.length) return `<h3 data-cmown>Models</h3>${err || `<div class="sc cmskel" aria-hidden="true"></div>`}`;   // only the very first open on a new browser gets here: the frame, no loading line
  const none = M.noModel && !M.optional ? `<p role="alert" class="meta cmerr cmnone">No model is chosen yet. Choose General's first model so chat can answer.</p>` : "";
  const bad0 = new Set(M.problems.map(p => `${p.category_id}|${p.slot}`));
  const need0 = M.needs ? `<p role="alert" class="meta cmerr">Your privacy setting is ${esc(LEVEL_NAME[M.level] || M.level)}. Replace the models marked below to keep working.</p>` : "";
  return `<h3 data-cmown>Models</h3>${err}${none}${need0}<div class="sc cmx" data-cmx>${M.cats.map(c => catHtml(c, bad0)).join("")}${M.cats.length < M.max && !M.noModel ? `<div class="cmadd"><button type="button" class="sa blue" data-cmadd>Add category</button></div>` : ""}${M.bg ? catHtml(M.bg, bad0) : ""}</div>`;
}
// Settings, AI services asks for the page's own answer and the Models answer together, so neither waits for the other.
export function cmodelsPrefetch(hasConn = true) { if (D && hasConn) { setScope("services"); hydrate(); void load(); } }
// A service was connected or removed: read the account's models again (the new service's models are in the picker). Resolves once the answer is in.
export async function cmodelsRefresh() { setScope("services"); for (let i = 0; M.loading && i < 40; i++) await new Promise(r => setTimeout(r, 100)); await load(true).catch(() => {}); }
export function cmodelsCard(): string {
  if (!D) return "";
  setScope(""); void load();
  if (M.own || (!M.loaded && boot0.own)) return "";   // an own key chooses its models in Settings, AI services
  const err = M.err ? `<p role="alert" class="meta cmerr">${esc(M.err)}</p>` : "";
  const toggle = `<button type="button" class="tg${M.on ? " on" : ""}" role="switch" aria-checked="${M.on}" aria-label="Custom Model Selection" data-cmtoggle${M.busy || (!M.loaded && !M.err) ? " disabled" : ""}><i></i></button>`;
  const row = `<div class="sc">${D.srow("", "Custom Model Selection", "Chat uses your own models instead of the defaults.", toggle, " data-cmrow")}</div>`;
  const need = M.needs ? `<p role="alert" class="meta cmerr">Your privacy setting is ${esc(LEVEL_NAME[M.level] || M.level)}. Replace the models marked below to keep working.</p>` : "";
  if (!M.on || !M.loaded) return row + err;
  const bad = new Set(M.problems.map(p => `${p.category_id}|${p.slot}`));
  return row + err + need + `<div class="sc cmx" data-cmx>${M.cats.map(c => catHtml(c, bad)).join("")}${M.cats.length < M.max ? `<div class="cmadd"><button type="button" class="sa blue" data-cmadd>Add category</button></div>` : ""}${M.bg ? catHtml(M.bg, bad) : ""}</div>`;
}
function catHtml(c: Cat, bad: Set<string>) {
  const d = M.draft[c.id], pin = d ? d.prompt : c.max_price ? String(c.max_price.prompt) : "", pout = d ? d.completion : c.max_price ? String(c.max_price.completion) : "";
  const isBg = c.id === BG;
  const head = isBg ? `<b class="cmname">Background jobs</b>` : c.id === "general" ? `<b class="cmname">General</b>` : `<input class="cmtitle" data-cmtitle="${esc(c.id)}" value="${esc(c.title)}" maxlength="80" autocomplete="off" aria-label="Category name"><button type="button" class="sa mute" data-cmdel="${esc(c.id)}" aria-label="Delete ${esc(c.title)}">Delete</button>`;
  const nameOfModel = (id: string) => { const m = M.models[id]; return m?.name || id.replace(/^[^:]*:/, ""); };
  const own = M.own;
  const slotsOf = (chain: Entry[]) => (own && !chain.length ? [{ model: "", effort: null as string | null }] : chain);
  const slots = slotsOf(c.chain).map((e, i) => {
    if (own) {
      const m = e.model ? M.models[e.model] : undefined, levels = m?.efforts || [], isBad = bad.has(`${c.id}|${i}`), empty = !e.model, label = `${SLOT[i]} reasoning level for ${c.title}`;
      const steps = levels.map(x => ({ value: x, label: effortLabel(x) }));
      const withDefault = [{ value: "", label: "Default" }, ...steps];
      const idx = Math.max(0, withDefault.findIndex(x => x.value === (e.effort ?? "")));
      const level = !empty && levels.length ? `<div class="cmeffw">${efsHtml({ id: `cmeff-${c.id}-${i}`, label: "Reasoning", steps: withDefault, index: idx, thumbAttr: `data-cmlvl="${esc(c.id)}|${i}"` })}</div>` : "";
      const canRm = !empty && (isBg ? true : i > 0), rm = canRm ? `<button type="button" class="cmrm" data-cmrm="${esc(c.id)}|${i}" aria-label="Remove the ${esc(SLOT[i].toLowerCase())} model from ${esc(c.title)}">Remove</button>` : `<span class="cmrmgap"></span>`;
      const first = empty ? (isBg ? (M.optional ? "1Helm's models" : "Same as General's first model") : "Choose a model") : nameOfModel(e.model), svc = !empty && m?.service ? svcTag(m.service, m.conn) : "";
      const lab = isBg && empty ? "Models" : SLOT[i];
      return `<div class="cmslot cmown${isBad ? " bad" : ""}"><span class="cmlab">${lab}</span><button type="button" class="cmmodel${empty ? " cmempty" : ""}" data-cmpick="${esc(c.id)}|${i}" aria-label="${esc(lab)} model for ${esc(c.title)}: ${esc(first)}${svc ? `, ${esc(m!.service!)}` : ""}"><span class="cmmn"><span class="cmmt">${esc(first)}</span>${svc}</span></button>${level}${rm}${isBad ? `<span class="cmwhy">Not available with ${esc(LEVEL_NAME[M.level] || M.level)}</span>` : ""}</div>`;
    }
    const m = M.models[e.model], levels = m?.efforts || [], many = levels.length > 1, isBad = bad.has(`${c.id}|${i}`);
    const only = levels.length === 1 ? levels[0] : "none", label = `${SLOT[i]} reasoning level for ${c.title}`;
    const options = many ? levels.map(x => `<option value="${esc(x)}"${x === e.effort ? " selected" : ""}>${esc(effortLabel(x))}</option>`).join("") : `<option value="${esc(only)}" selected>${esc(effortLabel(only))}</option>`;
    const select = `<select class="cmeff" ${many ? `data-cmeff="${esc(c.id)}|${i}" aria-label="${esc(label)}"` : `disabled aria-label="${esc(label)}${levels.length ? ": the only reasoning level for this model" : ": this model has no reasoning levels"}"`}>${options}</select>`;
    return `<div class="cmslot${isBad ? " bad" : ""}"><span class="cmlab">${SLOT[i]}</span><button type="button" class="cmmodel" data-cmpick="${esc(c.id)}|${i}" aria-label="${esc(SLOT[i])} model for ${esc(c.title)}: ${esc(m?.name || e.model)}"><span>${esc(m?.name || e.model)}</span></button>${select}${isBad ? `<span class="cmwhy">Not available with ${esc(LEVEL_NAME[M.level] || M.level)}</span>` : ""}</div>`;
  }).join("");
  const priceErr = d && (!!d.prompt !== !!d.completion) ? `<p class="meta cmerr">Enter both prices, or leave both empty.</p>` : "";
  const addFb = M.own && c.chain.length && c.chain.length < SLOT.length ? `<div class="cmfbrow"><button type="button" class="sa blue" data-cmfb="${esc(c.id)}">Add fallback</button></div>` : "";
  const prices = (M.own ? !M.hasOr : M.endpoint === "plain") || isBg ? "" : `<div class="cmprice"><label><span>Max price in</span><span class="cmusd">$<input type="number" inputmode="decimal" min="0" max="10000" step="any" data-cmprice="${esc(c.id)}|prompt" value="${esc(pin)}" placeholder="Default" aria-label="Max price in, dollars per million tokens"></span></label>
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
type Sec = { id: string; kind: string; label: string; host: string; state: "loading" | "ready" | "error"; models: any[]; err: string; n: number };
const P: { cat: string; idx: number; q: string; list: any[]; loading: boolean; err: string; sel: number; unread: string[]; secs: Sec[]; filter: string } = { cat: "", idx: 0, q: "", list: [], loading: false, err: "", sel: 0, unread: [], secs: [], filter: "" };
function closePicker() { layer?.remove(); layer = null; document.removeEventListener("keydown", pickerKeys, true); const o = opener; opener = null; o?.isConnected && o.focus({ preventScroll: true }); }
function pickerKeys(e: KeyboardEvent) {
  if (!layer) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closePicker(); return; }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); P.sel = Math.max(0, Math.min(P.list.length - 1, P.sel + (e.key === "ArrowDown" ? 1 : -1))); paintList(); layer.querySelector(`[data-cmsel="${P.sel}"]`)?.scrollIntoView({ block: "nearest" }); return; }
  if (e.key === "Enter" && (e.target as HTMLElement).matches?.("[data-cmq]") && P.list[P.sel]) { e.preventDefault(); void choose(P.sel); }
}
async function openPicker(cat: string, idx: number, from: HTMLElement) {
  const core = await loadCore(); if (layer) closePicker();
  opener = from; Object.assign(P, { cat, idx, q: "", list: [], loading: !M.own, err: "", sel: 0, unread: [], secs: [], filter: "" });
  layer = document.createElement("div"); layer.className = "cmback";
  const c = findCat(cat);
  layer.innerHTML = `<div class="cmpick" role="dialog" aria-modal="true" aria-label="Choose a model"><div class="cmph"><h3>${esc(c?.title || "")}, ${esc(SLOT[idx].toLowerCase())}</h3><button type="button" class="cmx2" data-cmclose aria-label="Close">×</button></div>
    <p class="cmpl">${M.own ? "Models from your connected services, each with its service's name." : M.endpoint === "plain" ? "Models your AI service offers." : `Models that work with ${esc(LEVEL_NAME[M.level] || M.level)}.`}</p><input class="cmq" data-cmq type="search" placeholder="Search models" autocomplete="off" aria-label="Search models">${M.own ? `<div class="cmchips" data-cmchips role="group" aria-label="Show models from"></div>` : ""}<div class="cmlist" data-cmlist role="listbox" aria-label="Models"></div></div>`;
  document.body.appendChild(layer);
  layer.addEventListener("mousedown", e => { if (e.target === layer) closePicker(); });
  layer.addEventListener("click", e => { const t = at(e); if (t.closest("[data-cmclose]")) closePicker(); const chip = t.closest<HTMLElement>("[data-cmchip]"); if (chip) { P.filter = chip.dataset.cmchip || ""; P.sel = 0; paintSecs(); return; } const s = t.closest<HTMLElement>("[data-cmsel]"); if (s) void choose(Number(s.dataset.cmsel)); });
  layer.querySelector<HTMLInputElement>("[data-cmq]")!.addEventListener("input", e => { P.q = (e.target as HTMLInputElement).value; clearTimeout(searchTimer); if (M.own) { P.sel = 0; paintSecs(); searchTimer = window.setTimeout(() => searchSecs(), 300); } else searchTimer = window.setTimeout(() => void fetchList(), 300); });
  document.addEventListener("keydown", pickerKeys, true);
  layer.querySelector<HTMLInputElement>("[data-cmq]")!.focus();
  void core; if (M.own) { startSecs(); return; }
  await fetchList();
}
async function fetchList() {
  const mine = ++seq; P.loading = true; P.err = ""; paintList();
  try {
    const r = await call(`account/custom-models/catalog?q=${encodeURIComponent(P.q.trim())}`);
    if (mine !== seq) return;
    const fresh: Card[] = (r.models || []).map((m: Card) => ({ ...m, eligible: true, kinds: ["chat"], ...(m.source === "BYOK" ? { levels: undefined } : {}) }));   // an own endpoint's models carry no privacy terms
    P.unread = (r.errors || []).map((x: { label: string }) => x.label);
    const target = { kind: "cat", key: "cat:" + P.cat, level: M.level, idx: P.idx };
    const svc = new Map(fresh.map(m => [m.id, m]));
    P.list = M.core.pickerList(asState(), target, P.q, fresh, "all").filter((m: any) => m.allowed !== false).map((m: any) => ({ ...m, service: svc.get(m.id)?.service ?? m.service, conn: svc.get(m.id)?.conn ?? m.conn }));   // the server already lists only what the level allows
  } catch (e: any) { if (mine !== seq) return; P.list = []; P.err = e?.message || "Couldn't search. Try again."; }
  P.loading = false; P.sel = 0; paintList();
}
function paintList() {
  if (M.own) { paintSecs(); return; }
  const el = layer?.querySelector<HTMLElement>("[data-cmlist]"); if (!el) return;
  el.innerHTML = P.err ? `<p class="meta cmerr" role="alert">${esc(P.err)}</p>` : P.list.length ? P.list.map((m, i) => {
    const price = m.pricing && m.pricing.prompt != null ? `$${m.pricing.prompt} in, $${m.pricing.completion} out per million` : "";
    const facts = m.source === "BYOK" ? [price, m.context_length ? `${m.context_length >= 1e6 ? m.context_length / 1e6 + "M" : Math.round(m.context_length / 1000) + "K"} context` : ""].filter(Boolean).join(", ") || esc_id(m)
      : [m.levels?.includes("zdr") ? "Zero Data Retention" : m.levels?.includes("no_training") ? "No Training" : "Unrestricted only", price].filter(Boolean).join(", ");
    return `<button type="button" class="cmitem${i === P.sel ? " on" : ""}" role="option" aria-selected="${i === P.sel}" data-cmsel="${i}"><span class="cmin">${esc(m.name || m.id)}${m.service ? svcTag(m.service, m.conn) : ""}</span><span class="cmis">${esc(facts)}</span></button>`;
  }).join("") + (P.unread.length ? `<p class="meta cmerr">Couldn't read the model list of ${esc(P.unread.join(", "))}.</p>` : "") : P.loading ? "" : `<p class="cmpl">No models found.</p>${P.unread.length ? `<p class="meta cmerr">Couldn't read the model list of ${esc(P.unread.join(", "))}.</p>` : ""}`;
}
// ---- the picker on an own key: one section for each connected service, in the order of the AI services page ----
// Each section owns its state. A service's list is asked for on its own (catalog?conn=), so a slow or failing service never holds back the others; the last answer of each service is kept
// for this session and shown at once the next time the picker opens (and read again behind it when it is more than a minute old). The server keeps its own copy of every list too.
const SECCACHE = new Map<string, { at: number; models: any[] }>(); const SEC_REFRESH_MS = 60e3;
const secName = (x: Sec) => { const dup = P.secs.filter(y => y.kind === x.kind).length > 1 || M.svcs.filter(y => y.kind === x.kind).length > 1; return dup && x.host && !x.label.includes(x.host) ? `${x.label} (${x.host})` : x.label; };
function startSecs() {
  P.secs = M.svcs.map(c => ({ id: c.id, kind: c.kind, label: c.label, host: c.host || "", state: "loading" as const, models: [], err: "", n: 0 }));
  for (const x of P.secs) {
    const hit = SECCACHE.get(x.id);
    if (hit) { x.state = "ready"; x.models = hit.models; }
    if (!hit || Date.now() - hit.at > SEC_REFRESH_MS) void loadSec(x);
  }
  paintSecs();
}
async function loadSec(x: Sec, q = "") {
  const mine = x.n = x.n + 1;
  try {
    const r = await call(`account/custom-models/catalog?conn=${encodeURIComponent(x.id)}&q=${encodeURIComponent(q)}`);
    if (mine !== x.n || !layer) return;
    const bad = (r.errors || []).find((e: { id: string }) => e.id === x.id);
    if (bad) { if (x.state !== "ready" || !x.models.length) { x.state = "error"; x.err = bad.error || ""; } }
    else { x.state = "ready"; x.err = ""; x.models = r.models || []; if (!q) SECCACHE.set(x.id, { at: Date.now(), models: x.models }); }
  } catch (e: any) { if (mine !== x.n || !layer) return; if (x.state !== "ready") { x.state = "error"; x.err = e?.message || ""; } }
  paintSecs();
}
// OpenRouter's models are searched on the server; every other service's list is filtered here.
function searchSecs() { for (const x of P.secs) if (x.kind === "openrouter") void loadSec(x, P.q.trim()); }
const SEC_FACTS = (m: any) => {
  if (m.note) return String(m.note);   // a short note the service's list carries (Claude Code's Fable: "May use your Claude usage credits")
  const price = m.pricing && m.pricing.prompt != null ? `$${m.pricing.prompt} in, $${m.pricing.completion} out per million` : "";
  return m.source === "BYOK" ? [price, m.context_length ? `${m.context_length >= 1e6 ? m.context_length / 1e6 + "M" : Math.round(m.context_length / 1000) + "K"} context` : ""].filter(Boolean).join(", ") || esc_id(m)
    : [m.levels?.includes("zdr") ? "Zero Data Retention" : m.levels?.includes("no_training") ? "No Training" : "Unrestricted only", price].filter(Boolean).join(", ");
};
function paintSecs() {
  const el = layer?.querySelector<HTMLElement>("[data-cmlist]"), chips = layer?.querySelector<HTMLElement>("[data-cmchips]"); if (!el || !M.core) return;
  const fresh: Card[] = P.secs.flatMap(x => x.models.map((m: Card) => ({ ...m, service: x.label, conn: x.id, eligible: true, kinds: ["chat"], ...(m.source === "BYOK" ? { levels: undefined } : {}) })));
  const target = { kind: "cat", key: "cat:" + P.cat, level: M.level, idx: P.idx };
  const ok = new Map<string, any>(M.core.pickerList(asState(), target, "", fresh, "all").filter((m: any) => m.allowed !== false).map((m: any) => [m.id, m]));
  const words = P.q.trim().toLowerCase().split(/\s+/).filter(Boolean), cur = findCat(P.cat)?.chain[P.idx]?.model || "";
  const searching = words.length > 0, list: any[] = []; let html = "", shown = 0;
  if (P.filter && !P.secs.some(x => x.id === P.filter)) P.filter = "";
  for (const x of P.secs) {
    if (P.filter && x.id !== P.filter) continue;
    const mine = x.models.map((m: any) => ok.get(m.id)).filter(Boolean).filter((m: any) => words.every(w => `${m.id} ${m.name || ""} ${m.family || ""} ${x.label}`.toLowerCase().includes(w)))
      .map((m: any) => ({ ...m, service: x.label, conn: x.id }));
    const head = (count: string) => `<h4 class="cmsech"><span class="cmsl">${logoChip(serviceDomain(x.kind, x.host), 18)}<b>${esc(secName(x))}</b></span>${count ? `<span class="cmcount">${count}</span>` : ""}</h4>`;
    if (x.state === "loading") { html += `<section class="cmsec" data-cmsec="${esc(x.id)}">${head("")}<p class="cmpl cmsecs">Loading ${esc(x.label)} models…</p></section>`; shown++; continue; }
    if (x.state === "error") { html += `<section class="cmsec" data-cmsec="${esc(x.id)}">${head("")}<p class="meta cmerr cmsecs">Couldn't read the model list of ${esc(x.label)}${x.err ? ` (${esc(x.err)})` : ""}.</p></section>`; shown++; continue; }
    if (searching && !mine.length) continue;   // a search hides sections with nothing in them
    shown++;
    html += `<section class="cmsec" data-cmsec="${esc(x.id)}">${head(String(mine.length))}${mine.length ? mine.map(m => {
      const i = list.push(m) - 1, on = m.id === cur;
      return `<button type="button" class="cmitem${i === P.sel ? " on" : ""}${on ? " cur" : ""}" role="option" aria-selected="${i === P.sel}"${on ? ' aria-current="true"' : ""} data-cmsel="${i}"><span class="cmin">${esc(m.name || m.id)}${on ? `<i class="cmnow">Current</i>` : ""}</span><span class="cmis">${esc(SEC_FACTS(m))}</span></button>`;
    }).join("") : `<p class="cmpl cmsecs">No models listed.</p>`}</section>`;
  }
  P.list = list; P.sel = Math.max(0, Math.min(P.sel, list.length - 1));
  const was = el.scrollTop; el.innerHTML = html || `<p class="cmpl">No models found.</p>`; el.scrollTop = was;
  if (chips) chips.innerHTML = P.secs.length > 1 ? `<button type="button" class="cmchip${P.filter ? "" : " on"}" data-cmchip="" aria-pressed="${!P.filter}">All</button>` + P.secs.map(x => `<button type="button" class="cmchip${P.filter === x.id ? " on" : ""}" data-cmchip="${esc(x.id)}" aria-pressed="${P.filter === x.id}">${logoChip(serviceDomain(x.kind, x.host), 14)}${esc(secName(x))}</button>`).join("") : "";
  void shown;
}
async function choose(i: number) {
  const m = P.list[i]; if (!m || !M.core) return;
  const c = findCat(P.cat); if (!c) return closePicker();
  const card: Card = { id: m.id, name: m.name, source: m.source, service: m.service, conn: m.conn, efforts: m.efforts || [], default_effort: m.default_effort ?? null, levels: m.levels || [], pricing: m.pricing };
  M.models[m.id] = card;
  const entry = M.core.newEntry(asState(), null, card, c.chain[P.idx], M.level);
  closePicker();
  if (c.chain[P.idx]?.model === m.id) { repaint(); return save({ categories: M.cats.map(x => ({ id: x.id, title: x.title, chain: x.chain, max_price: x.max_price })), ...(M.bg ? { background: { chain: M.bg.chain } } : {}) }); }   // the same model again: saved anyway, so the server replaces a carried-over record with the list's facts
  await commit([{ t: "entry", cat: P.cat, idx: P.idx, entry: { model: entry.model, effort: entry.effort } }]);
}

// ---- hooks for v3.ts ----
// After every Settings paint: the reasoning sliders come alive. Letting go of one (or a click or a key) saves that model's reasoning level once. "" is Default, no level.
export function cmodelsAfter() {
  if (!M.own) return;
  efsMount(document, (id, value) => { const m = /^cmeff-(.+)-(\d+)$/.exec(id); if (m) void commit([{ t: "effort", cat: m[1], idx: Number(m[2]), value: value === "" ? null : value }]); });
}
export function cmodelsInit(deps: Deps, boot?: { on?: boolean; level?: string; own_key?: boolean; needs_choice?: boolean; problems?: Problem[] } | null) {
  D = deps;
  if (!deps.api && /[?&]cmown\b/.test(location.search)) { M.own = true; M.on = true; boot0.own = true; boot0.on = true; }   // sandbox: the editor of an account with an own AI key
  if (boot) { boot0.on = !!boot.on; boot0.own = !!boot.own_key; M.on = !!boot.on; M.level = boot.level || M.level; M.own = !!boot.own_key; M.needs = !!boot.needs_choice; M.problems = boot.problems || []; if (M.needs) window.setTimeout(() => void promptNeeded(), 1500); }
}
// The privacy setting just changed (the server's answer): re-read this account's models, and ask for new choices when some are no longer allowed.
export function cmodelsPrivacy(v?: { on?: boolean; level?: string; own_key?: boolean; needs_choice?: boolean; problems?: Problem[] } | null) {
  if (!D || !v) return;
  boot0.on = !!v.on; boot0.own = !!v.own_key; if (scope === "") { M.on = !!v.on; M.own = !!v.own_key; } M.level = v.level || M.level; M.needs = !!v.needs_choice; M.problems = v.problems || []; note(v);
  if (M.on) void load(true);
  if (M.needs) void promptNeeded();
}
async function promptNeeded() {
  if (!D || !M.needs || prompted) return; prompted = true;
  const names = M.problems.filter(p => p.model).slice(0, 4).map(p => `${p.name || p.model} (${p.category})`).join(", ");
  const go = await D.ask({ title: "Choose new models", body: `Your privacy setting is ${LEVEL_NAME[M.level] || M.level}, and ${names || "some of your chosen models"} can't be used with it. Chat is paused until you choose new models.`, confirm: "Choose models", cancel: "Not now" });
  prompted = false; if (go) (M.own && D.openAi ? D.openAi : D.openAdvanced)();
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
const demo = { on: false, categories: null as Cat[] | null, bg: null as Entry[] | null };
// Sandbox (?cmown): an account with ChatGPT and OpenCode connected. ?cmownnone: nothing chosen yet. ?cmownor: OpenRouter connected too.
const OWN_Q = () => location.search;
const ownCard = (conn: string, service: string, id: string, name: string, efforts: string[], family = ""): Card => ({ id: `${conn}:${id}`, name, service, conn, source: "BYOK", efforts, default_effort: efforts.includes("medium") ? "medium" : efforts[0] ?? null, levels: [], pricing: null, context_length: 200000, ...(family ? { family } : {}) });
const OWN_MODELS: Card[] = [ownCard("chatgpt", "ChatGPT", "gpt-6.1-sol", "GPT-6.1 Sol", ["low", "medium", "high", "xhigh", "max"]), ownCard("chatgpt", "ChatGPT", "gpt-6-luna", "GPT-6 Luna", ["low", "medium"]),
  ownCard("opencode", "OpenCode", "glm-5.3", "GLM 5.3", ["low", "medium", "high", "max"], "chat-completions"), ownCard("opencode", "OpenCode", "kimi-k3", "Kimi K3", [], "chat-completions"), ownCard("chatgpt", "ChatGPT", "gpt-6.1-sol-long", "GPT-6.1 Sol Extended Thinking Experimental Preview Edition", ["low", "medium", "high", "xhigh", "max"]), ownCard("opencode", "OpenCode", "deepseek-v4", "DeepSeek V4", ["low", "high"], "chat-completions")];
async function demoApi(path: string, init?: { method?: string; body?: any }) {
  const level = "zdr", body = init?.body;
  if (M.own || scope === "services") {
    const svcs = [{ id: "chatgpt", kind: "chatgpt", label: "ChatGPT", host: "" }, { id: "opencode", kind: "opencode", label: "OpenCode", host: "" }];
    const q = decodeURIComponent(path.split("q=")[1] || "").toLowerCase();
    if (path.startsWith("account/custom-models/catalog")) {
      const conn = decodeURIComponent((path.match(/[?&]conn=([^&]*)/) || [])[1] || ""), slow = (OWN_Q().match(/cmslow=(\w+)/) || [])[1], fail = (OWN_Q().match(/cmfail=(\w+)/) || [])[1];   // sandbox: ?cmslow=opencode never answers, ?cmfail=opencode answers with an error
      if (path.includes("warm=1")) return { ok: true };
      if (conn && conn === slow) return new Promise(() => {});
      if (conn && conn === fail) return { level, endpoint: "own", models: [], errors: [{ id: conn, label: svcs.find(x => x.id === conn)?.label || conn, error: "error 503: the service is down" }] };
      return { level, endpoint: "own", errors: [], models: OWN_MODELS.filter(m => (!conn || m.conn === conn) && `${m.id} ${m.name} ${m.service}`.toLowerCase().includes(q)) };
    }
    if (init?.method === "POST" && OWN_Q().includes("cmownrefuse")) throw new Error("This model's reasoning level can't be changed here.");   // sandbox: a refused save, to see the reason shown
    if (init?.method === "POST") { (globalThis as any).__cmSaves = ((globalThis as any).__cmSaves || 0) + 1; (globalThis as any).__cmLast = clone(body);   // the sandbox counts its saves so the browser test can check one save per choice
      if (body.categories) demo.categories = clone(body.categories); if (body.background) demo.bg = clone(body.background.chain); }
    const none = OWN_Q().includes("cmownnone");
    const shots = OWN_Q().includes("cmownshots");   // sandbox: ChatGPT's six levels, a long model name, a fallback and Background jobs, for screenshots
    const cats = demo.categories || (demo.categories = [{ id: "general", title: "General", chain: none ? [] : shots ? [{ model: "chatgpt:gpt-6.1-sol", effort: "max" }, { model: "chatgpt:gpt-6.1-sol-long", effort: "xhigh" }] : [{ model: "chatgpt:gpt-6.1-sol", effort: "high" }, { model: "opencode:glm-5.3", effort: "medium" }], max_price: null }]);
    const bg = demo.bg || (demo.bg = none ? [] : shots ? [{ model: "chatgpt:gpt-6.1-sol-long", effort: null }] : [{ model: "opencode:kimi-k3", effort: null }]);
    const used = new Set([...cats.flatMap(c => c.chain.map(e => e.model)), ...bg.map(e => e.model)]);
    return { on: true, level, own_key: true, endpoint: "own", optional: !OWN_Q().includes("byokplan"), needs_choice: false, no_model: !cats[0].chain.length, problems: [], max_categories: 12, categories: clone(cats), background: { title: "Background jobs", chain: clone(bg) }, connections: svcs, has_openrouter: false,
      models: Object.fromEntries(OWN_MODELS.filter(m => used.has(m.id)).map(m => [m.id, { ...m, allowed: true }])) };
  }
  const view = () => { const cats = demo.categories || (demo.categories = [{ id: "general", title: "General", chain: DEMO.slice(0, 3).map(m => ({ model: m.id, effort: m.default_effort })), max_price: null }]);
    return { on: demo.on, level, needs_choice: false, problems: [], max_categories: 12, categories: clone(cats), models: Object.fromEntries(DEMO.map(m => [m.id, { ...m, allowed: m.levels.includes(level) }])) }; };
  if (path.startsWith("account/custom-models/catalog")) { const q = decodeURIComponent(path.split("q=")[1] || "").toLowerCase(); return { level, models: DEMO.filter(m => m.levels.includes(level) && `${m.id} ${m.name}`.toLowerCase().includes(q)) }; }
  if (init?.method === "POST") { if (typeof body.on === "boolean") demo.on = body.on; if (body.categories) demo.categories = clone(body.categories); }
  return view();
}

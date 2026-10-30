// The /models console in the browser: state, events, saving, history and the model picker.
// The HTML comes from models-console-core.js (the Worker renders the first page with the same code). Every save goes through POST /models/api/save.
import * as C from "./models-console-core.js";
import { initSandbox } from "./models-sandbox.js";

const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
let state = JSON.parse($("#model-state").textContent);
const ui = { view: "all", q: "", sel: null, open: false, level: "unrestricted", save: null, undo: null };
const app = $("#app"), layer = $("#layer"), toastEl = $("#toast");
const editable = () => true;

// ------------------------------------------------------------ rendering
const keyOf = (el) => (el && el.dataset ? el.dataset.k || (el.dataset.df ? "d." + el.dataset.df + (el.dataset.i || "") : null) : null);
// The page is drawn again from the state after every change. The scroll position of the list, the detail and the page, the focus, and a value that was typed
// and not saved yet are put back, so nothing jumps.
const JOB_FILTERS = ["all", "attention"];   // a new filter shows its first job, so the detail is never a job that the list does not show
let listTop = 0, lastSig = "", lastListSig = "";
function render(focusKey) {
  ui.sel = C.resolveSel(state, ui, C.view(state, ui));
  const a = document.activeElement, key = keyOf(a), sel = key && a.setSelectionRange && a.type !== "number" ? [a.selectionStart, a.selectionEnd] : null;
  const typed = key && a.dataset.dirty ? a.value : null;   // a value that was typed and not saved yet survives a redraw caused by another save
  const lb = $(".lbody"), db = $(".detail"), bd = $(".body"), rowFocus = a && a.dataset && a.dataset.row;
  if (lb && lb.offsetParent !== null) listTop = lb.scrollTop;   // a hidden list reports 0, so only a shown list is read
  const detailTop = db ? db.scrollTop : 0, bodyTop = bd ? bd.scrollTop : 0;
  app.innerHTML = C.pageHtml(state, ui, Date.now()).toString();
  if (ui.view === "sandbox") SB.enter();
  const sig = [ui.view, ui.sel, ui.level].join("|"), listSig = [ui.view, ui.q].join("|");
  if (listSig !== lastListSig) listTop = 0;
  const same = sig === lastSig; lastSig = sig; lastListSig = listSig;
  if ($(".lbody")) $(".lbody").scrollTop = listTop;
  if (same) { if ($(".detail")) $(".detail").scrollTop = detailTop; if ($(".body")) $(".body").scrollTop = bodyTop; }
  if (focusKey) { const el = $(`[data-row="${CSS.escape(focusKey)}"]`); if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest" }); } }
  else if (key) { const el = $$("[data-k],[data-df]", app).find((e) => keyOf(e) === key); if (el) { if (typed !== null && el.matches("input")) { el.value = typed; el.dataset.dirty = "1"; } el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } } }
  else if (rowFocus) { const el = $(`[data-row="${CSS.escape(rowFocus)}"]`); if (el) el.focus({ preventScroll: true }); }
  placeFocus();
}
// Keyboard use on a narrow screen, where the detail replaces the list: opening a job moves focus into it, and going back returns focus to its row.
let shownOpen = false;
function placeFocus() {
  const narrow = window.matchMedia("(max-width: 899px)").matches, a = document.activeElement;
  if (narrow && ui.open && !shownOpen && a && a.classList && a.classList.contains("it")) { const d = $(".detail h2, .detail .title-in"); if (d) { d.setAttribute("tabindex", "-1"); d.focus({ preventScroll: true }); } }
  else if (!ui.open && shownOpen && a && a.closest && a.closest(".detail")) { const r = $(`[data-row="${CSS.escape(ui.sel)}"]`); if (r) r.focus({ preventScroll: true }); }
  shownOpen = ui.open;
}
let toastTimer = null;
function toast(text) { toastEl.textContent = text; toastEl.className = text ? "on" : ""; clearTimeout(toastTimer); if (text) toastTimer = setTimeout(() => toast(""), 7000); }
const V = () => C.view(state, ui);
const SB = initSandbox({ app, getState: () => state, ui, api: (...a) => api(...a), toast, openPicker: (...a) => openPicker(...a) });

// ------------------------------------------------------------ talking to the server
async function api(method, path, body) {
  try {
    const r = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: method === "GET" ? {} : { "content-type": "application/json", "x-model-settings": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (e) { return { ok: false, status: 0, data: { error: "Check your connection and try again." } }; }
}
let saveTimer = null, undoTimer = null;
function setSave(k, undoTo) {
  clearTimeout(saveTimer); ui.save = k ? { k } : null;
  if (undoTo !== undefined) { clearTimeout(undoTimer); ui.undo = undoTo ? { revision: undoTo } : null; if (undoTo) undoTimer = setTimeout(() => { ui.undo = null; if (ui.save?.k === "saved") ui.save = null; render(); }, 12000); }
  if (k === "saved") saveTimer = setTimeout(() => { if (!ui.undo) { ui.save = null; render(); } }, 2500);
  if (k === "failed") saveTimer = setTimeout(() => { ui.save = null; render(); }, 6000);
}
function adopt(data) { data.unlisted = state.unlisted || []; state = data; if (ui.sel && !C.rowByKey(state, ui.sel)) ui.sel = null; render(); }
let queue = Promise.resolve();
// edits: a list of edit objects (models-console-core.js applyEdit), applied one after another to the newest saved settings and saved once.
function commit(edits, after) {
  queue = queue.then(async () => {
    let cfg = state.config, changed = false;
    for (const e of edits) { const next = C.applyEdit(cfg, e); if (next) { cfg = next; changed = true; } }
    if (!changed) { render(); return; }
    const before = state.revision;
    setSave("saving"); render();
    const r = await api("POST", "/models/api/save", C.saveBody(cfg, before));
    if (r.ok) { setSave("saved", before >= 1 ? before : 0); adopt(r.data); if (after) after(); return; }
    setSave("failed", 0); toast("Not saved. " + (r.data.error || "Try again."));
    if (r.status === 409) { const latest = await api("GET", "/models/api"); if (latest.ok) adopt(latest.data); else render(); } else render();
  });
  return queue;
}
async function undoLast() {
  const u = ui.undo; if (!u) return;
  ui.undo = null; setSave("saving"); render();
  const r = await api("POST", "/models/api/restore", { revision: state.revision, restore_revision: u.revision });
  if (r.ok) { setSave("saved", 0); adopt(r.data); } else { setSave("failed", 0); toast("Not undone. " + (r.data.error || "Try again.")); render(); }
}
async function loadUnlisted() {
  const r = await api("GET", "/models/api/unlisted");
  if (r.ok && Array.isArray(r.data.unlisted) && JSON.stringify(r.data.unlisted) !== JSON.stringify(state.unlisted || [])) { state.unlisted = r.data.unlisted; render(); }
}

// ------------------------------------------------------------ dialogs
let stack = [];
function openModal(html, onEvent) {
  const wrap = document.createElement("div"); wrap.innerHTML = html.toString(); const back = wrap.firstElementChild; layer.appendChild(back);
  const close = () => { back.remove(); stack = stack.filter((x) => x !== close); };
  back.close = close; stack.push(close);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  back.addEventListener("click", (e) => { if (e.target.closest("[data-x]")) close(); else if (onEvent) onEvent(e, back); });
  const first = $("[data-q],[data-go],button:not([data-x])", back); if (first) first.focus({ preventScroll: true });
  return back;
}
function confirmAsk(title, body, ok, danger) { return new Promise((res) => { let done = false; const b = openModal(C.confirmModal(title, body, ok, danger), (e, back) => { if (e.target.closest("[data-go]")) { done = true; back.close(); res(true); } }); const c = b.close; b.close = () => { c(); if (!done) res(false); }; }); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && stack.length) { e.preventDefault(); e.stopImmediatePropagation(); stack[stack.length - 1](); } });

// ------------------------------------------------------------ field edits
const target = (key) => { const r = C.rowByKey(state, key); return r.kind === "cat" ? { cat: r.id } : { id: r.id }; };
function parseOut(t) { t = t.trim().replace(/,/g, ""); if (t === "") return null; const n = Number(t); if (!Number.isInteger(n) || n < 1 || n > 1000000) throw new Error("Max output is a whole number from 1 to 1,000,000, or empty."); return n; }
function parseTimeout(t) { t = t.trim(); if (t === "") return null; const ms = Math.round(Number(t) * 1000); if (!Number.isFinite(ms) || ms < 1000 || ms > 3600000) throw new Error("Timeout is from 1 to 3,600 seconds, or empty for none."); return ms; }
function parseResults(t) { const n = Number(t.trim()); if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error("Results is a whole number from 1 to 10."); return n; }
function parsePrice(a, b) { a = a.trim(); b = b.trim(); if (a === "" && b === "") return null; const x = Number(a), y = Number(b); if (a === "" || b === "" || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 10000 || y > 10000) throw new Error("Enter both prices from 0 to 10,000 dollars per million tokens, or clear both."); return { prompt: x, completion: y }; }
function parseLimit(def, t) { const n = Number(t.trim()); if (t.trim() === "" || !Number.isFinite(n) || (def.whole && !Number.isInteger(n)) || n < def.min || n > def.max) throw new Error(`${def.label}: enter ${def.whole ? "a whole number" : "a number"} of ${def.unit} from ${def.min} to ${def.max}.`); return n; }
function fieldEdit(key, field, read) {
  try {
    const tg = target(key);
    let e;
    if (field === "effort") e = { t: "effort", ...tg, level: ui.level, idx: 0, value: read.value };
    else if (field === "sort") e = { t: "field", ...tg, field: "sort", value: read.value || null };
    else if (field === "max_output") e = { t: "field", ...tg, field: "max_output", value: parseOut(read.value) };
    else if (field === "results") e = { t: "field", ...tg, field: "results", value: parseResults(read.value) };
    else if (field === "timeout") e = { t: "field", ...tg, field: "timeout_ms", value: parseTimeout(read.value) };
    else if (field === "price") e = { t: "field", ...tg, field: "max_price", value: parsePrice(read.a, read.b) };
    return commit([e]);
  } catch (err) { refuse(err.message); }
}
// A value that can't be saved stays in its box, marked, so it can be fixed. Nothing is saved and the page is not drawn again.
function refuse(message) { toast(message); const a = document.activeElement; for (const el of $$("[data-dirty]", app)) { el.setAttribute("aria-invalid", "true"); el.title = message; } if (a && a.dataset && a.dataset.dirty) a.setAttribute("aria-invalid", "true"); }
function clearInvalid(el) { el.removeAttribute("aria-invalid"); if (el.title && el.dataset.dirty) el.removeAttribute("title"); }
app.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset && (el.dataset.df || el.dataset.lim) && el.matches("input")) { el.dataset.dirty = "1"; clearInvalid(el); }
});
// Escape puts a box back to what is saved.
app.addEventListener("keydown", (e) => {
  const el = e.target;
  if (e.key === "Escape" && el.dataset && el.dataset.dirty && el.matches("input")) { e.stopPropagation(); e.preventDefault(); delete el.dataset.dirty; render(); }
  if (e.key === "Enter" && el.matches && el.matches("input[data-df],input[data-lim]")) el.blur();
}, true);
app.addEventListener("change", (e) => {
  const el = e.target;
  if (!editable()) return;
  if (el.dataset.df && ui.sel) {
    const f = el.dataset.df, key = ui.sel;
    if (f === "effort") commit([{ t: "effort", ...target(key), level: ui.level, idx: +el.dataset.i, value: el.value }]);
    else if (f === "title") commit([{ t: "title", cat: C.rowByKey(state, key).id, value: el.value.trim() }]);
    else if (f === "pi" || f === "po") return;   // a price has two boxes, so it is saved when focus leaves both (below)
    else fieldEdit(key, f, { value: el.value });
  } else if (el.dataset.lim) {
    const def = state.limits.defs.find((d) => d.key === el.dataset.lim);
    try { const v = parseLimit(def, el.value); commit([{ t: "limit", limitKey: def.key, value: v === def.default ? null : v }]); } catch (err) { refuse(err.message); }
  }
});
// A price is two boxes. It is saved when focus leaves the pair, and only when it changed.
app.addEventListener("focusout", (e) => {
  const pair = e.target.closest && e.target.closest(".two");
  if (!pair || !editable() || (e.relatedTarget && pair.contains(e.relatedTarget))) return;
  const key = ui.sel, boxes = $$("input", pair);
  if (!key) return;
  const cur = C.viewOf(state, ui, C.rowByKey(state, key), C.snapshotFromConfig(state)).max_price;
  const a = boxes[0].value.trim(), b = boxes[1].value.trim(), same = (!cur && a === "" && b === "") || (cur && Number(a) === cur.prompt && Number(b) === cur.completion && a !== "" && b !== "");
  if (!same) fieldEdit(key, "price", { a, b });
});
app.addEventListener("input", (e) => { if (e.target.dataset.q !== undefined) { ui.q = e.target.value; ui.sel = null; render(); } });

// ------------------------------------------------------------ clicks
app.addEventListener("click", (e) => {
  const t = e.target, b = t.closest("[data-view],[data-act],[data-lvl],[data-row]");
  if (!b) return;
  if (t.closest("input,select") && !b.dataset.act) return;
  if (b.dataset.view) { if (JOB_FILTERS.includes(b.dataset.view) && b.dataset.view !== ui.view) ui.sel = null; ui.view = b.dataset.view; ui.open = false; render(); return; }
  if (b.dataset.lvl) { ui.level = b.dataset.lvl; render(); return; }
  if (b.dataset.act) return act(b);
  if (b.dataset.row) { ui.sel = b.dataset.row; ui.open = true; render(b.dataset.row); }
});
function slot(i) { const row = C.rowByKey(state, ui.sel), v = V().info.find((x) => x.row.key === ui.sel).v; return { key: ui.sel, row, v, idx: i, level: v.level, ...(row.kind === "cat" ? { kind: "cat" } : { kind: "job", jv: row.jv }) }; }
function act(b) {
  const a = b.dataset.act, i = +b.dataset.i, key = ui.sel;
  if (a === "close") { ui.open = false; render(); }
  else if (a === "open") { const k = b.dataset.key; ui.view = k.startsWith("limit:") ? "limits" : "all"; if (!k.startsWith("limit:")) { ui.sel = k; ui.open = true; ui.q = ""; } render(k.startsWith("limit:") ? undefined : k); }
  else if (a === "reset") { const row = C.rowByKey(state, key); commit([{ t: "field", ...target(key), field: b.dataset.field, value: C.startOf(state, row, b.dataset.field) ?? null }]); }
  else if (a === "limreset") commit([{ t: "limit", limitKey: b.dataset.key, value: null }]);
  else if (a === "hist") openHistory();
  else if (a === "chg") openPicker(slot(i), "Choose a model for " + C.rowByKey(state, key).label);
  else if (a === "add") openPicker(slot(V().info.find((x) => x.row.key === key).v.chain.length), "Add a fallback for " + C.rowByKey(state, key).label);
  else if (a === "up" || a === "dn") commit([{ t: "move", ...target(key), level: ui.level, idx: i, d: a === "up" ? -1 : 1 }]);
  else if (a === "rm") commit([{ t: "remove", ...target(key), idx: i }]);
  else if (a === "catadd") commit([{ t: "catAdd", newId: "cat_" + crypto.randomUUID().replace(/-/g, "") }], () => { const last = state.config.routing.categories.at(-1); ui.sel = "cat:" + last.id; ui.open = true; render(); const ti = $('[data-df="title"]'); if (ti) { ti.focus(); ti.select(); } });
  else if (a === "catdelete") { const row = C.rowByKey(state, key); confirmAsk("Delete " + row.label + "?", "The category is removed from all three privacy levels.", "Delete", true).then((ok) => { if (ok) { ui.sel = null; ui.open = false; commit([{ t: "catDelete", cat: row.id }]); } }); }
  else if (a === "clearq") { ui.q = ""; render(); const q = $("[data-q]"); if (q) q.focus(); }
  else if (a === "undo") undoLast();
}

// ------------------------------------------------------------ keys
document.addEventListener("keydown", (e) => {
  const tag = (document.activeElement || {}).tagName, typing = /INPUT|SELECT|TEXTAREA/.test(tag);
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "/" && !typing && !stack.length) { const q = $("[data-q]"); if (q) { e.preventDefault(); q.focus(); } return; }
  if (stack.length) return;
  if (e.key === "Escape" && ui.open) { ui.open = false; render(); return; }
  const jobs = !["changes", "limits", "readonly", "sandbox"].includes(ui.view), ids = jobs ? C.visibleInfo(state, ui, V()).map((x) => x.row.key) : [];
  if (typing) { if (e.key === "Enter" && document.activeElement.dataset.q !== undefined && ids[0]) { ui.sel = ids[0]; ui.open = true; render(ids[0]); } return; }
  const cur = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.row : null;
  const down = e.key === "j" || e.key === "ArrowDown", up = e.key === "k" || e.key === "ArrowUp";
  if (jobs && ids.length && (down || up) && (cur || e.key === "j" || e.key === "k")) {
    const i = ids.indexOf(cur || ui.sel), next = ids[Math.max(0, Math.min(ids.length - 1, (i < 0 ? 0 : i) + (down ? 1 : -1)))];
    e.preventDefault(); ui.sel = next; render(next); return;
  }
  if ((e.key === "Enter" || e.key === " ") && cur) { ui.sel = cur; ui.open = true; render(cur); e.preventDefault(); }
});

// ------------------------------------------------------------ the model picker
function openPicker(tg, title) {
  let src = "all", q = "", sel = 0, list = [], fresh = [], seq = 0, timer = null;
  const current = (tg.row.kind === "cat" ? tg.row.cat.chains[tg.level] : [state.config.jobs[tg.row.id], ...(state.config.jobs[tg.row.id].fallbacks || [])])[tg.idx]?.model;
  const back = openModal(C.pickerModal(state, tg, title));
  const qi = $("[data-q]", back), ul = $("[data-list]", back);
  const draw = () => {
    list = C.pickerList(state, tg, q, fresh, src);
    list.sort((a, b) => (a.id === current ? -1 : b.id === current ? 1 : 0));
    const t = q.trim(), custom = t && /\//.test(t) && !list.some((m) => m.id.toLowerCase() === t.toLowerCase()) && src !== "CF";
    ul.innerHTML = list.map((m, i) => C.pickerItem(state, m, i, sel, current)).join("") + (custom ? C.h`<li class="pk-item" role="option" data-custom="${t}"><div class="n"><span>Use "${t}"</span></div><div class="id mono">Add this ID as typed. It is checked when saved.</div></li>`.toString() : "") || '<li class="empty">No models match</li>';
  };
  const load = async () => {
    const mine = ++seq, r = await api("GET", "/models/api/catalog?q=" + encodeURIComponent(q.trim()));
    if (mine !== seq) return;
    if (r.ok) { fresh = (r.data.models || []).filter((m) => !(state.unlisted || []).includes(m.id)); if (Array.isArray(r.data.unlisted)) state.unlisted = r.data.unlisted; }
    draw();
  };
  const pick = (m) => {
    back.close();
    if (tg.onPick) { const prev0 = state.config.catalog[current] || null, meta0 = { ...(state.config.catalog[m.id] || {}), ...m }; tg.onPick({ meta: meta0, entry: C.newEntry(state, tg.row.jv, meta0, prev0 ? { effort: null } : null, tg.row.kind === "cat" ? tg.level : null) }); return; }
    const prev = tg.row.kind === "cat" ? tg.row.cat.chains[tg.level][tg.idx] : [state.config.jobs[tg.row.id], ...(state.config.jobs[tg.row.id].fallbacks || [])][tg.idx];
    const meta = { ...(state.config.catalog[m.id] || {}), ...m };
    commit([{ t: "entry", ...(tg.row.kind === "cat" ? { cat: tg.row.id } : { id: tg.row.id }), level: tg.level, idx: tg.idx, entry: C.newEntry(state, tg.row.jv, meta, prev, tg.row.kind === "cat" ? tg.level : null) }]);
  };
  const pickCustom = (id) => { back.close(); if (tg.onPick) { const meta0 = { id, efforts: [], eligible: true, chat: true }; tg.onPick({ meta: meta0, entry: C.newEntry(state, tg.row.jv, meta0, null, tg.row.kind === "cat" ? tg.level : null) }); return; } const meta = { id, efforts: [], eligible: true, chat: true }; commit([{ t: "entry", ...(tg.row.kind === "cat" ? { cat: tg.row.id } : { id: tg.row.id }), level: tg.level, idx: tg.idx, entry: C.newEntry(state, tg.row.jv, meta, null, tg.row.kind === "cat" ? tg.level : null) }]); };
  qi.addEventListener("input", () => { q = qi.value; sel = 0; draw(); clearTimeout(timer); timer = setTimeout(load, 220); });
  $("[data-src]", back).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; src = b.dataset.v; $$("[data-src] button", back).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); sel = 0; draw(); });
  ul.addEventListener("click", (e) => { const li = e.target.closest(".pk-item"); if (!li) return; if (li.dataset.custom) pickCustom(li.dataset.custom); else { const m = list[+li.dataset.i]; if (m && m.allowed) pick(m); } });
  ul.addEventListener("mousemove", (e) => { const li = e.target.closest("[data-i]"); if (li && +li.dataset.i !== sel) { sel = +li.dataset.i; $$(".pk-item", ul).forEach((x) => x.setAttribute("aria-selected", String(x === li))); } });
  qi.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, Math.min(list.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1))); $$(".pk-item", ul).forEach((x, i) => x.setAttribute("aria-selected", String(i === sel))); const c = $(`[data-i="${sel}"]`, ul); if (c) c.scrollIntoView({ block: "nearest" }); }
    if (e.key === "Enter") { e.preventDefault(); const m = list[sel]; if (m && m.allowed) pick(m); else { const c = $("[data-custom]", ul); if (c) pickCustom(c.dataset.custom); } }
  });
  draw(); load();
}

// ------------------------------------------------------------ history
function openHistory() {
  let confirmRev = null;
  const draw = (back) => { $("[data-body]", back).innerHTML = C.historyBody(state, confirmRev).toString(); };
  const back = openModal(C.historyModal(state, null), async (e, back) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.rs) { confirmRev = +t.dataset.rs; draw(back); }
    else if (t.dataset.no !== undefined) { confirmRev = null; draw(back); }
    else if (t.dataset.do) {
      t.disabled = true;
      const r = await api("POST", "/models/api/restore", { revision: state.revision, restore_revision: +t.dataset.do });
      if (r.ok) { adopt(r.data); confirmRev = null; draw(back); } else { toast("Not restored. " + (r.data.error || "Try again.")); t.disabled = false; }
    }
  });
}

// ------------------------------------------------------------ start
render();
loadUnlisted();
// The words of every time ("5 min ago") are refreshed each minute without drawing the page again.
setInterval(() => { const now = Date.now(); for (const t of $$("time[data-ts]", app)) { const w = C.agoText(+t.dataset.ts, now); if (t.textContent !== w) t.textContent = w; } }, 30000);
// The page stays current: when it is visible, the last served rows are read again once a minute and when the person comes back to it. Settings that
// were saved from another window are adopted. Nothing is read while a box holds a value that was typed and not saved, or while a dialog is open.
let refreshedAt = Date.now();
async function refresh() {
  const a = document.activeElement;
  if (document.hidden || stack.length || Date.now() - refreshedAt < 45000 || (a && a.dataset && a.dataset.dirty)) return;
  refreshedAt = Date.now();
  const r = await api("GET", "/models/api");
  if (r.ok) { if (r.data.revision === state.revision) { state.served = r.data.served; state.history = r.data.history; render(); } else adopt(r.data); }
}
setInterval(refresh, 60000);
document.addEventListener("visibilitychange", refresh); window.addEventListener("focus", refresh);

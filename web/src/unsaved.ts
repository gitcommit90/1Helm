// Unsaved edits (the Captain, 2026-10-06: "if i make edits and then click away before saving it should have a pop up"). Before
// anything throws away what you typed, our own dialog asks "Save changes to Sam Rivera?" with Save, Discard and Keep editing.
//
// A form (or any box) marked data-unsaved="<kind>" data-unsaved-key="<which record>" is watched once its kind is registered with
// unsavedKind(). It's dirty when kind.state() of what's in it now differs from what it was first rendered with, so editing and then
// putting it back is not a change. "Leaving" it is:
//   - a route change (#/...): a link, Back/Forward, a typed URL, or the app setting location.hash. Links are stopped before their
//     click handlers run; anything else is caught in hashchange (this module's listener is registered first) and the address is put
//     back until you choose. Kinds with hash: false (the Settings forms, which float above every page) ignore route changes;
//   - a click on one of the kind's `leave` selectors outside the form (another note's Edit, a Settings section, the ✕...);
//   - whatever the app runs through guarded(fn): Esc, ⌘, (fn runs at once when nothing is dirty).
// Save runs the form's own save, waits while it's busy, and goes on only if the editor closed (a refused save keeps you there, with
// the form's own message). Discard closes the editor without saving. Keep editing (or Esc, or a tap outside) stays.
// Closing or reloading the tab uses the browser's own "Leave site?" prompt (beforeunload): a page can't show its own UI then, so it's
// the one browser prompt 1Helm allows (proto test/no-native-dialogs.test.mjs knows about it).
// A re-render that rebuilds the same form (same data-unsaved-key) keeps what you typed and the original starting point.
import { choose } from "./dialog";

export type UnsavedKind = {
  /** The app still has this editor open (false once it saved or closed, even before the page re-renders). */
  active: () => boolean;
  title: (el: HTMLElement) => string;
  body?: (el: HTMLElement) => string;
  /** Start the form's normal save (default: submit the form). */
  save?: (el: HTMLElement) => void;
  /** A save is on its way (async saves); Save waits for it. */
  busy?: () => boolean;
  /** Close the editor without saving. */
  discard: (el: HTMLElement) => void;
  /** What counts as the form's content (default: every non-empty field, trimmed). */
  state?: (el: HTMLElement) => string;
  /** Route changes leave this editor (default true). */
  hash?: boolean;
  /** Clicks (outside the form) that leave it. */
  leave?: string;
};
type Live = { el: HTMLElement; kind: string; key: string; base: string; init: string[] };

const KINDS: Record<string, UnsavedKind> = {};
let live: Live[] = [], bypass = 0, asking: Promise<boolean> | null = null;

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const fields = (el: Element) => [...el.querySelectorAll<Field>("input, textarea, select")].filter(f => f.type !== "file");
const isBox = (f: Field) => f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio");
const fval = (f: Field) => isBox(f) ? String((f as HTMLInputElement).checked) : f.value;
const fid = (f: Field) => `${f.tagName}:${f.type}:${f.id || f.name.replace(/\d+$/, "")}`;   // pill groups get numbered names per render
const defState = (el: HTMLElement) => JSON.stringify(fields(el).map(f => [f.name || f.id, isBox(f) ? (f as HTMLInputElement).checked : f.value.trim()]).filter(([, v]) => v !== "" && v !== false));
// The form as it was rendered (attributes = the saved values), not as typed: a detached copy made from its HTML.
const asRendered = (el: HTMLElement) => { const t = document.createElement("template"); t.innerHTML = el.outerHTML; return t.content.firstElementChild as HTMLElement; };
const stateOf = (k: UnsavedKind, el: HTMLElement) => { try { return (k.state || defState)(el); } catch { return ""; } };

export function unsavedKind(kind: string, k: UnsavedKind) { KINDS[kind] = k; track(); }

function track() {
  const gone = live.filter(l => !l.el.isConnected);
  live = live.filter(l => l.el.isConnected);
  for (const el of document.querySelectorAll<HTMLElement>("[data-unsaved]")) {
    if (live.some(l => l.el === el)) continue;
    const kind = el.dataset.unsaved!, k = KINDS[kind]; if (!k) continue;
    const key = `${kind}:${el.dataset.unsavedKey || ""}`, was = gone.find(g => g.key === key), r = asRendered(el);
    live.push({ el, kind, key, base: was ? was.base : stateOf(k, r), init: was ? was.init : fields(r).map(fval) });
    if (was) carry(was, el);
  }
}
// The same form, rebuilt by a re-render: put back the fields you'd changed.
function carry(was: Live, el: HTMLElement) {
  const a = fields(was.el), b = fields(el);
  if (a.length !== b.length || a.some((f, i) => fid(f) !== fid(b[i]))) return;
  a.forEach((f, i) => {
    const v = fval(f), to = b[i]; if (v === was.init[i] || v === fval(to)) return;
    if (isBox(to)) (to as HTMLInputElement).checked = v === "true"; else to.value = v;
    // A pill group (contacts-list pills()) keeps its value in a hidden input: show the same pill as picked.
    const pg = to.type === "hidden" ? to.closest<HTMLElement>("[data-pills]") : null;
    pg?.querySelectorAll<HTMLElement>("[data-pill]").forEach(p => { const on = p.dataset.pill === v; p.setAttribute("aria-checked", String(on)); p.tabIndex = on ? 0 : -1; });
  });
}
new MutationObserver(track).observe(document.documentElement, { childList: true, subtree: true });

const isDirty = (l: Live) => l.el.isConnected && KINDS[l.kind].active() && stateOf(KINDS[l.kind], l.el) !== l.base;
/** The first editor with unsaved changes (only the ones route changes leave, with hash). */
function dirty(hash = false): Live | null { track(); return live.find(l => isDirty(l) && (!hash || KINDS[l.kind].hash !== false)) || null; }
export const unsavedDirty = () => !!dirty();

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function save(l: Live): Promise<boolean> {
  const k = KINDS[l.kind];
  bypass++;
  try { if (k.save) k.save(l.el); else if (l.el instanceof HTMLFormElement) l.el.requestSubmit(); } finally { bypass--; }
  for (let t = 0; k.active() && l.el.isConnected && k.busy?.() && t < 600; t++) await wait(100);   // up to a minute (the AI key save tests the connection)
  return !k.active() || !isDirty(l);
}
/** Ask about l. Resolves true when it's fine to go on (saved or discarded). */
function askLeave(l: Live): Promise<boolean> {
  if (asking) return asking;
  const k = KINDS[l.kind];
  return asking = (async () => {
    try {
      const r = await choose({ title: k.title(l.el), body: k.body?.(l.el) || "You have changes you haven't saved.", confirm: "Save", alt: "Discard", cancel: "Keep editing" });
      if (r === "no") { focusIn(l.el); return false; }
      if (r === "alt") { bypass++; try { k.discard(l.el); } finally { bypass--; } return true; }
      if (await save(l)) return true;
      focusIn(l.el); return false;
    } finally { asking = null; }
  })();
}
// Back into the form, unless the dialog already gave the focus back to a field in it.
const focusIn = (el: HTMLElement) => { if (!el.isConnected || el.contains(document.activeElement)) return; const f = el.querySelector<HTMLElement>("[aria-invalid=true], .bykbad input, input:not([type=hidden]):not(:disabled), textarea:not(:disabled)"); f?.focus({ preventScroll: false }); };

/** Run fn now, or once the unsaved changes are saved or discarded (never, if you keep editing). */
export function guarded(fn: () => void) {
  const l = bypass ? null : dirty(); if (!l) { fn(); return; }
  askLeave(l).then(go => { if (go) { bypass++; try { fn(); } finally { bypass--; } } });
}

// ---- clicks: links to another route, and each kind's `leave` selectors ----
const sameRoute = (href: string) => href.replace(/^#\/?/, "") === location.hash.replace(/^#\/?/, "");
// After a save the page may have been re-rendered: find the same button/link again by its data attributes (or href).
function refind(el: HTMLElement): HTMLElement | null {
  if (el.isConnected) return el;
  const attrs = [...el.attributes].filter(a => el.tagName === "A" ? a.name === "href" : a.name.startsWith("data-"));
  if (!attrs.length) return null;
  return document.querySelector<HTMLElement>(el.tagName.toLowerCase() + attrs.map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join(""));
}
window.addEventListener("click", (e) => {
  if (bypass || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const t = e.target as HTMLElement; if (!t?.closest || t.closest(".dlgw")) return;
  let hit: HTMLElement | null = null, l: Live | null = null;
  const a = t.closest<HTMLAnchorElement>("a[href]"), href = a?.getAttribute("href") || "";
  if (a && /^#\//.test(href) && !a.target && !sameRoute(href)) { l = dirty(true); if (l && !l.el.contains(a)) hit = a; }
  if (!hit) { const d = dirty(); const sel = d && KINDS[d.kind].leave; const m = sel ? t.closest<HTMLElement>(sel) : null; if (d && m && !d.el.contains(m)) { hit = m; l = d; } }
  if (!hit || !l) return;
  e.preventDefault(); e.stopImmediatePropagation();
  askLeave(l).then(go => { if (!go) return; const el = refind(hit!); if (el) { bypass++; try { el.click(); } finally { bypass--; } } else if (a) location.hash = href; });
}, true);

// ---- route changes that didn't come from a link (Back/Forward, a typed URL, code) ----
// Where the Navigation API is there (Chrome, Edge, Safari 26+), the history entry's index says how far it moved, so we step back
// to where you were and, if you go on, forward again: Back and Forward keep working normally. Elsewhere the address is put back in
// place (one extra entry in the history at worst).
const nav = (window as any).navigation as { currentEntry?: { index: number } | null } | undefined;
const at = () => nav?.currentEntry?.index ?? -1;
let idx = at(), undo: { url: string; until: number } | null = null;
window.addEventListener("hashchange", (e) => {
  if (undo && e.newURL === undo.url && Date.now() < undo.until) { undo = null; e.stopImmediatePropagation(); idx = at(); return; }   // our own step back
  const l = bypass ? null : dirty(true); if (!l) { idx = at(); return; }
  e.stopImmediatePropagation();
  const to = e.newURL, d = at() - idx, step = idx >= 0 && at() >= 0 && d !== 0;
  if (step) { undo = { url: e.oldURL, until: Date.now() + 2000 }; history.go(-d); }
  else history.replaceState(history.state, "", e.oldURL);   // stay put (no hashchange) until they choose
  askLeave(l).then(go => {
    if (!go) return;
    if (step && at() === idx) { history.go(d); return; }   // its hashchange comes through: nothing is unsaved now
    if (step) { location.href = to; return; }              // a save that moved on by itself (a new contact opens its card) dropped that entry
    const from = location.href; history.replaceState(history.state, "", to);
    if (from !== to) { bypass++; try { window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: from, newURL: to })); } finally { bypass--; } }
  });
});

// ---- closing or reloading the tab ----
window.addEventListener("beforeunload", (e) => { if (dirty()) { e.preventDefault(); e.returnValue = true; } });   // native-dialog-ok: the browser's leave-page warning is the only prompt possible while a tab closes (unsaved edits only)

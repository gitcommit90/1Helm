// Keyboard shortcuts: ONE registry, one key handler, one Settings → Keyboard shortcuts page (Captain 10-10: "customizable, and not
// swallowed by system shortcuts if possible").
//
//   registerShortcut({ id: "new-task", label: "New task", def: "Mod+Shift+O", alias: ["Mod+N"], run: () => … })
//
// Every registered action shows up in Settings and can be rebound, swapped, turned off and reset: nothing else to wire. Actions that
// are added later (a Pomodoro start/pause/stop, say) only have to call registerShortcut().
//
// Combos are stored as text: "Mod+Shift+O". Mod is ⌘ on a Mac and Ctrl everywhere else; Ctrl, Meta, Alt, Shift are the other
// modifiers; the key is a letter (upper case), a digit, a punctuation mark or a name (Escape, ArrowUp, F5). A range action (the
// channel jumper) is "Mod+1-9". Saved per account on the server (tenants.shortcuts, POST account/prefs) with this browser's
// localStorage only as a cache for when the server can't be reached.
//
// Which keys can a web page get at all? See comments on RESERVED below: in a normal Chrome/Edge tab, the browser keeps new
// tab/window/private window, close tab/window, reopen tab, tab switching and quit; page code never sees them. An INSTALLED app
// (display-mode: standalone etc.) is a Chromium "app" window and there the browser reserves nothing, so ⌘N does reach the page.
// navigator.keyboard.lock() would need JavaScript-initiated fullscreen, so it is not an answer for ordinary use.
//
// Typing safety: every binding needs ⌘/Ctrl (or Meta, or Alt for the Pomodoro keys), so a plain letter never fires while you type. An action can still say
// `inField: false` to be ignored while a text box has focus.
import { ask } from "./dialog";   // first: its Esc handling must run before ours (it registers a window keydown capture listener)

export type Act = {
  id: string; label: string;
  /** The default combo ("Mod+Shift+O"), "Mod+1-9" for a digits range, or "" for none. */
  def: string;
  /** Old default(s) that keep working, but only where the browser can actually deliver them (the installed app). */
  alias?: string[];
  /** Digits range: the combo is a modifier prefix plus 1-9 and `run` gets the digit. */
  digits?: boolean;
  /** false: ignored while an input, textarea or editable field has focus. Default true (all bindings carry ⌘/Ctrl). */
  inField?: boolean;
  /** One line under the label in Settings. */
  note?: string;
  group?: string;
  /** Return false when there was nothing to do (like ⌘5 with four channels): the key then goes on to the browser. */
  run: (e: KeyboardEvent, digit?: number) => void | false;
};
type Deps = {
  live: { api: string } | null;
  boot: Record<string, string> | null | undefined;      // BOOT.account.shortcuts from the server, when the server has the field
  slug: string;
  repaint: () => void;                                  // Settings, if it's open on this page
  relabel: () => void;                                  // the key chips around the app (New button, search box, rail tooltips), after bindings changed
  note: (title: string, sub: string, bad?: boolean) => void;
  srow: (icon: string, title: string, sub: string, right: string, attrs?: string) => string;
  sa: (label: string, attr: string, cls?: string) => string;
};

// ---------- context ----------
const UA = () => navigator.userAgent;
const MAC = () => /Mac|iPhone|iPad/.test((navigator as any).userAgentData?.platform || navigator.platform || "") || /Mac OS X/.test(UA());
const LINUX = () => /Linux|CrOS/.test(UA()) && !/Android/.test(UA());
const CHROMIUM = () => /Chrome\/|Chromium\/|Edg\/|CriOS\//.test(UA()) && !/OPR\/|Firefox\//.test(UA()) || (navigator as any).userAgentData?.brands?.some((b: any) => /Chromium/.test(b.brand));
const browserName = () => /Edg\//.test(UA()) ? "Edge" : /Firefox\//.test(UA()) ? "Firefox" : /Chrome\/|CriOS\//.test(UA()) ? "Chrome" : /Safari\//.test(UA()) ? "Safari" : "The browser";
/** Running as an installed app (own window, no tabs)? Anything but a plain browser tab. */
export const installedApp = () => { try { return !matchMedia("(display-mode: browser)").matches || (navigator as any).standalone === true; } catch { return false; } };
/** Chromium: "In Apps mode, no keys are reserved" (browser_command_controller.cc IsReservedCommandOrKey), so only an installed Chromium app gets ⌘N / ⌘T / ⌘W. */
export const canGetBrowserKeys = () => CHROMIUM() && installedApp();

// ---------- combos ----------
type C = { mod: boolean; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean; key: string };
const MODS = ["Mod", "Ctrl", "Meta", "Alt", "Shift"] as const;
export function parse(s: string): C | null {
  if (!s) return null;
  const c: C = { mod: false, ctrl: false, meta: false, alt: false, shift: false, key: "" };
  const parts = s.endsWith("++") ? [...s.slice(0, -2).split("+"), "+"] : s === "+" ? ["+"] : s.split("+");
  c.key = parts.pop() || "";
  for (const p of parts) { if (!(MODS as readonly string[]).includes(p)) return null; (c as any)[p.toLowerCase()] = true; }
  return c.key ? c : null;
}
const str = (c: C) => [c.mod && "Mod", c.ctrl && "Ctrl", c.meta && "Meta", c.alt && "Alt", c.shift && "Shift"].filter(Boolean).concat(c.key).join("+");
const CODE_PUNCT: Record<string, string> = { Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\" };
function keyTok(e: KeyboardEvent): string {
  const k = e.key;
  if (/^Key[A-Z]$/.test(e.code) && !/^[a-z]$/i.test(k)) return e.code.slice(3);   // Option on a Mac types ø å … : the physical key wins
  if (/^[a-z]$/i.test(k)) return k.toUpperCase();
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (k.length === 1) return k === " " ? "Space" : e.shiftKey && CODE_PUNCT[e.code] ? CODE_PUNCT[e.code] : k;
  return k === " " ? "Space" : k;
}
const isModKey = (k: string) => ["Control", "Meta", "Alt", "Shift", "AltGraph", "OS", "CapsLock"].includes(k);
/** The combo an event is, or null for a bare modifier press. On a Mac ⌘ is Mod and ⌃ is Ctrl; elsewhere Ctrl is Mod and the Windows key is Meta. */
export function evCombo(e: KeyboardEvent): string | null {
  if (isModKey(e.key)) return null;
  const mac = MAC();
  return str({ mod: mac ? e.metaKey : e.ctrlKey, ctrl: mac ? e.ctrlKey : false, meta: mac ? false : e.metaKey, alt: e.altKey, shift: e.shiftKey, key: keyTok(e) });
}
const KEYNAME: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", Enter: "Return", Backspace: "⌫", Delete: "Del", "1-9": "1–9" };
/** "⌘ ⇧ O" on a Mac, "Ctrl+Shift+O" elsewhere. compact drops the spaces on a Mac ("⌘⇧O", for tooltips and small chips). */
export function fmt(combo: string, compact = false): string {
  const c = parse(combo); if (!c) return "";
  const mac = MAC(), key = mac ? (KEYNAME[c.key] ?? c.key) : (({ Escape: "Esc", "1-9": "1–9" } as any)[c.key] ?? c.key);
  if (mac) return [c.mod && "⌘", c.ctrl && "⌃", c.alt && "⌥", c.shift && "⇧"].filter(Boolean).concat(key).join(compact ? "" : " ");
  return [c.mod && "Ctrl", c.ctrl && "Ctrl", c.meta && "Win", c.alt && "Alt", c.shift && "Shift"].filter(Boolean).concat(key).join("+");
}

// ---------- what a page can never receive ----------
// SOURCES: Chromium chrome/browser/ui/browser_command_controller.cc IsReservedCommandOrKey(): in app windows no keys are reserved; in a
// normal window only IDC_CLOSE_TAB, CLOSE_WINDOW, NEW_INCOGNITO_WINDOW, NEW_ISOLATED_WINDOW, NEW_TAB, NEW_WINDOW, RESTORE_TAB, SELECT_NEXT_TAB,
// SELECT_PREVIOUS_TAB, CYCLE_TO_NEXT/PREV_TAB and EXIT are reserved (tab-number keys, Find etc. are not). Fullscreen on Windows/Linux reserves
// only exit. WICG Keyboard Lock §4.2: lock() works only during JavaScript-initiated fullscreen. Safari and Firefox keep the same set in a tab;
// a Safari "Add to Dock" app isn't verified, so it is treated like a tab.
type Res = { kind: "system" | "browser"; what: string } | null;
function reservedOf(combo: string): Res {
  const c = parse(combo); if (!c) return null;
  const mac = MAC(), k = c.key, onlyMod = c.mod && !c.ctrl && !c.meta && !c.alt;
  if (mac) {
    if (onlyMod && !c.shift && ["Q", "H", "M", "Tab", "Space", "`"].includes(k)) return { kind: "system", what: ({ Q: "quitting the app", H: "hiding the app", M: "minimizing", Tab: "switching apps", Space: "Spotlight", "`": "switching windows" } as any)[k] };
    if (onlyMod && c.shift && ["3", "4", "5"].includes(k)) return { kind: "system", what: "screenshots" };
    if (onlyMod && !c.shift && k === "N") return { kind: "browser", what: "a new window" };
    if (onlyMod && !c.shift && k === "T") return { kind: "browser", what: "a new tab" };
    if (onlyMod && !c.shift && k === "W") return { kind: "browser", what: "closing the tab" };
    if (onlyMod && c.shift && k === "N") return { kind: "browser", what: "a private window" };
    if (onlyMod && c.shift && k === "T") return { kind: "browser", what: "reopening a closed tab" };
    if (onlyMod && c.shift && k === "W") return { kind: "browser", what: "closing the window" };
    if (onlyMod && c.shift && (k === "[" || k === "]")) return { kind: "browser", what: "switching tabs" };
    if (c.mod && c.alt && !c.ctrl && (k === "ArrowLeft" || k === "ArrowRight")) return { kind: "browser", what: "switching tabs" };
    if (c.ctrl && !c.mod && !c.alt && k === "Tab") return { kind: "browser", what: "switching tabs" };
    return null;
  }
  if (c.meta) return { kind: "system", what: "the Windows key shortcuts" };
  if (onlyMod && c.alt && k === "Delete") return { kind: "system", what: "the secure attention sequence" };
  if (onlyMod && !c.shift && k === "N") return { kind: "browser", what: "a new window" };
  if (onlyMod && !c.shift && k === "T") return { kind: "browser", what: "a new tab" };
  if (onlyMod && !c.shift && (k === "W" || k === "F4")) return { kind: "browser", what: "closing the tab" };
  if (onlyMod && c.shift && k === "N") return { kind: "browser", what: "a private window" };
  if (onlyMod && c.shift && k === "T") return { kind: "browser", what: "reopening a closed tab" };
  if (onlyMod && c.shift && k === "W") return { kind: "browser", what: "closing the window" };
  if (onlyMod && (k === "Tab" || k === "PageUp" || k === "PageDown")) return { kind: "browser", what: "switching tabs" };
  if (onlyMod && c.shift && k === "Q" && LINUX()) return { kind: "browser", what: "quitting" };
  return null;
}
/** What to tell the person about a combo, here and now: ok, a warning (works only in the installed app) or a block (would never arrive). */
export function reservedVerdict(combo: string): { level: "ok" | "warn" | "block"; msg: string } {
  const r = reservedOf(combo); if (!r) return { level: "ok", msg: "" };
  const l = fmt(combo), b = browserName();
  if (r.kind === "system") return { level: "block", msg: `${MAC() ? "macOS" : "Your system"} keeps ${l} for ${r.what}, so it can't reach 1Helm. Pick another.` };
  if (canGetBrowserKeys()) return { level: "warn", msg: `${b} keeps ${l} for ${r.what} in a browser tab. In the installed app it reaches 1Helm, but on the web it won't work.` };
  return { level: "block", msg: `${b} keeps ${l} for ${r.what}, so this won't reach 1Helm in a browser tab. ${CHROMIUM() ? "Install 1Helm as an app to use it, or pick another." : "Pick another."}` };
}

// ---------- registry + state ----------
const ACTS: Act[] = [];
export function registerShortcut(a: Act) { const i = ACTS.findIndex(x => x.id === a.id); if (i >= 0) ACTS[i] = a; else ACTS.push(a); }
export const shortcutList = () => ACTS.slice();
let custom: Record<string, string> = {};
let D: Deps | null = null;
const lsK = () => `1hc-shortcuts-${D?.slug || "sandbox"}`;
const cacheGet = (): Record<string, string> => { try { const o = JSON.parse(localStorage.getItem(lsK()) || "null"); return clean(o); } catch { return {}; } };
const cacheSet = (m: Record<string, string>) => { try { Object.keys(m).length ? localStorage.setItem(lsK(), JSON.stringify(m)) : localStorage.removeItem(lsK()); } catch { /* private mode or blocked storage */ } };
function clean(o: any): Record<string, string> { const r: Record<string, string> = {}; if (o && typeof o === "object" && !Array.isArray(o)) for (const k of Object.keys(o)) if (typeof o[k] === "string" && (o[k] === "" || parse(o[k]))) r[k] = o[k]; return r; }
const act = (id: string) => ACTS.find(a => a.id === id);
/** The combo an action has now ("" = turned off). */
export const comboOf = (id: string) => { const a = act(id); return a ? (id in custom ? custom[id] : a.def) : ""; };
/** Label for the key chips around the app (tooltips, the New button): "⌘⇧O" / "Ctrl+Shift+O"; "" when off. */
export const scLabel = (id: string, compact = true) => fmt(comboOf(id), compact);
/** The label of a digits action for one digit: ⌘3. */
export const scLabelN = (id: string, n: number, compact = true) => fmt(comboOf(id).replace(/1-9$/, String(n)), compact);
/** Aliases that work now: only for an action the person hasn't rebound, only where the browser delivers them, and never over someone's own binding. */
function aliasesOf(a: Act): string[] {
  if (a.id in custom || !a.alias || !canGetBrowserKeys()) return [];
  const taken = new Set(ACTS.filter(x => x !== a).map(x => comboOf(x.id)));
  return a.alias.filter(x => !taken.has(x) && !ACTS.some(y => y !== a && y.digits && overlap(comboOf(y.id), x)));
}
const rangeOf = (s: string) => { const c = parse(s); return c && c.key === "1-9" ? c : null; };
/** Two combos collide: the same, or a 1-9 range and a single digit with the same modifiers. */
function overlap(a: string, b: string): boolean {
  if (!a || !b) return false; if (a === b) return true;
  const x = parse(a), y = parse(b); if (!x || !y) return false;
  const ra = rangeOf(a), rb = rangeOf(b); if (!ra && !rb) return false;
  const same = (p: C, q: C) => p.mod === q.mod && p.ctrl === q.ctrl && p.meta === q.meta && p.alt === q.alt && p.shift === q.shift;
  return same(x, y) && ((ra && /^[1-9]$/.test(y.key)) || (rb && /^[1-9]$/.test(x.key)) || (ra && rb)) as boolean;
}
const conflictOf = (combo: string, selfId: string) => ACTS.find(a => a.id !== selfId && overlap(comboOf(a.id), combo));

// ---------- the one key handler ----------
const editable = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); };
function onKey(e: KeyboardEvent) {
  if (rec(e)) return;
  if (e.repeat || e.isComposing) return;
  if (!(e.metaKey || e.ctrlKey || e.altKey)) return;   // every binding carries ⌘/Ctrl or Alt: a plain letter never fires
  const c = evCombo(e); if (!c) return;
  const digit = /^[1-9]$/.test(parse(c)!.key) ? +parse(c)!.key : 0;
  const rangeCombo = digit ? c.replace(/\+[1-9]$/, "+1-9") : "";
  for (const a of ACTS) {
    const mine = comboOf(a.id), hit = mine && (mine === c || (a.digits && rangeCombo && mine === rangeCombo)) || aliasesOf(a).includes(c);
    if (!hit) continue;
    if (a.inField === false && editable(e.target)) return;
    if (a.run(e, a.digits ? digit : undefined) !== false) e.preventDefault(); return;
  }
}
window.addEventListener("keydown", onKey, true);
/** True when this keydown matches the action (for code that handles a shortcut itself, like the Apps popup closing). */
export function matches(id: string, e: KeyboardEvent) {
  const a = act(id), c = evCombo(e); if (!a || !c) return false;
  return comboOf(id) === c || aliasesOf(a).includes(c) || (!!a.digits && comboOf(id) === c.replace(/\+[1-9]$/, "+1-9"));
}

// ---------- persistence ----------
let saving = 0;
async function persist(next: Record<string, string>, prev: Record<string, string>) {
  custom = next; cacheSet(next); D?.relabel(); D?.repaint();
  if (!D?.live) return;
  const my = ++saving;
  try {
    const r = await fetch(`${D.live.api}/account/prefs`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ shortcuts: next }) });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  } catch (err: any) {
    if (my !== saving) return;   // a newer save is the truth now
    custom = prev; cacheSet(prev); D.relabel(); D.repaint(); D.note("Couldn't save the shortcut", err instanceof TypeError ? "Check your connection and try again." : err.message || "Try again in a minute.", true);
  }
}
const withBinding = (m: Record<string, string>, id: string, combo: string) => { const a = act(id)!, n = { ...m }; if (combo === a.def) delete n[id]; else n[id] = combo; return n; };

// ---------- Settings page ----------
const E = { id: "", cand: null as string | null, level: "" as "" | "ok" | "warn" | "block" | "conflict", msg: "", other: "" };
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const chip = (combo: string) => combo ? `<kbd class="kbig">${esc(fmt(combo))}</kbd>` : `<span class="sval">Off</span>`;
const FIXED = [{ keys: "Esc", label: "Close", note: "Always closes whatever is open on top. This one can't be changed." }];
export function scPage(): string {
  if (!D) return "";
  const mac = MAC(), rows = ACTS.map(a => {
    const cur = comboOf(a.id), custom1 = a.id in custom, v = cur ? reservedVerdict(cur) : { level: "ok", msg: "" };
    const subs: string[] = [];
    if (a.note) subs.push(esc(a.note));
    if (custom1) subs.push(`Default: ${esc(a.def ? fmt(a.def) : "none")}`);
    if (a.alias?.length && !custom1) { const al = aliasesOf(a); subs.push(al.length ? `${esc(fmt(al[0]))} works here too, because this is the installed app.` : `${esc(fmt(a.alias[0]))} still works in the installed app only: ${esc(browserName())} keeps it for the browser.`); }
    if (v.level !== "ok") subs.push(`<span class="scwarn">${esc(v.msg)}</span>`);
    const open = E.id === a.id;
    const row = D!.srow("", esc(a.label), subs.join(" "), chip(cur), ` role="button" tabindex="0" data-scrow="${a.id}" aria-expanded="${open}" aria-label="${esc(a.label)}: ${cur ? esc(fmt(cur)) : "off"}. Change shortcut"`);
    return row + (open ? editor(a) : "");
  });
  const fixed = FIXED.map(f => D!.srow("", esc(f.label), esc(f.note), `<kbd class="kbig">${f.keys}</kbd>`)).join("");
  const any = Object.keys(custom).length > 0;
  return `<h2>Keyboard shortcuts</h2><p class="slead">Hold ${mac ? "⌘" : "Ctrl"} and press a key. Pick a row to change its shortcut.</p>
    <div class="sc" id="scList">${rows.join("")}${fixed}</div>
    <p class="scnote">${esc(browserName())} keeps some keys for itself in a browser tab, such as ${esc(fmt("Mod+N"))}, ${esc(fmt("Mod+T"))} and ${esc(fmt("Mod+W"))}, so 1Helm never sees them. That's why New task now defaults to ${esc(fmt("Mod+Shift+O"))}. ${canGetBrowserKeys() ? "You're in the installed app, which does receive them." : "The installed app can receive them."}</p>
    <div class="sbtns">${D.sa("Reset all to defaults", `type="button" data-scall${any ? "" : " disabled"}`)}</div>`;
}
function editor(a: Act): string {
  const cur = comboOf(a.id), cand = E.cand, valid = cand !== null && E.level !== "block" && E.level !== "conflict" && cand !== cur;
  const other = E.other ? act(E.other) : null;
  const canSwap = other && !other.digits && !a.digits;
  return `<div class="scedit" role="group" aria-label="Change shortcut for ${esc(a.label)}">
    <div class="sccap${cand === null ? " empty" : ""}" id="sccap" tabindex="0" role="textbox" aria-readonly="true" aria-label="New shortcut for ${esc(a.label)}. Press the keys you want." aria-describedby="scmsg">${cand === null ? `Press the keys you want…` : cand ? `<kbd class="kbig">${esc(fmt(cand))}</kbd>` : `<span class="sval">Off</span>`}</div>
    <p class="scmsg ${E.level}" id="scmsg" role="status" aria-live="polite">${esc(E.msg)}${E.level === "block" || E.level === "conflict" || E.level === "warn" ? "" : ""}</p>
    ${E.level === "conflict" && other ? `<div class="sbtns scfix">${canSwap ? D!.sa(`Swap with ${esc(other.label)}`, `type="button" data-scswap`) : ""}${D!.sa(`Turn off ${esc(other.label)}`, `type="button" data-scclear`)}</div>` : ""}
    <div class="sbtns"><button class="sprim" type="button" data-scsave${valid ? "" : " disabled"}>Save</button>${D!.sa("Reset to default", `type="button" data-scdef${comboOf(a.id) === a.def && !(a.id in custom) && cand === null ? " disabled" : ""}`)}${D!.sa("Turn off", `type="button" data-scoff${cur === "" && cand === null ? " disabled" : ""}`)}${D!.sa("Cancel", `type="button" data-sccancel`)}</div></div>`;
}

// ---------- recording ----------
function evaluate(a: Act, combo: string) {
  E.cand = combo; E.other = ""; E.msg = ""; E.level = "ok";
  if (combo === "") { E.msg = "This shortcut will be off."; return; }
  const c = parse(combo)!;
  if (!(c.mod || c.ctrl || c.meta || c.alt)) { E.level = "block"; E.msg = `Hold ${MAC() ? "⌘" : "Ctrl"} with the key, so it doesn't fire while you type.`; return; }
  const v = reservedVerdict(combo); if (v.level !== "ok") { E.level = v.level; E.msg = v.msg; if (v.level === "block") return; }
  const o = conflictOf(combo, a.id);
  if (o) { E.level = "conflict"; E.other = o.id; E.msg = `${fmt(combo)} is already ${o.label}. Swap them, or turn ${o.label} off.`; }
  else if (!E.msg) E.msg = combo === comboOf(a.id) ? "That's the current shortcut." : "Looks good. Press Save.";
}
function rec(e: KeyboardEvent): boolean {
  if (!E.id || !D) return false;
  const t = e.target as HTMLElement, a = act(E.id); if (!a) return false;
  const bare = !(e.metaKey || e.ctrlKey || e.altKey);
  if (e.key === "Escape" && bare && t.closest?.("#scList")) { e.preventDefault(); e.stopImmediatePropagation(); const id = E.id; stop(); D.repaint(); document.querySelector<HTMLElement>(`[data-scrow="${id}"]`)?.focus(); return true; }   // Esc backs out of the edit first, not out of Settings
  if (t?.id !== "sccap") return false;
  if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) return false;   // keep Tab for moving to Save
  if (isModKey(e.key)) { return true; }
  e.preventDefault(); e.stopImmediatePropagation();
  if (bare && !e.shiftKey && e.key === "Enter") { if (E.cand !== null && E.level !== "block" && E.level !== "conflict") void save(); return true; }
  if (bare && !e.shiftKey && (e.key === "Backspace" || e.key === "Delete")) { evaluate(a, ""); paint(); return true; }
  let combo = evCombo(e); if (!combo) return true;
  if (a.digits) {
    const k = parse(combo)!;
    if (!/^[1-9]$/.test(k.key)) { E.cand = null; E.level = "block"; E.msg = "Press a number key from 1 to 9 with the modifier you want."; paint(); return true; }
    combo = combo.replace(/\+[1-9]$/, "+1-9");
  }
  evaluate(a, combo); paint(); return true;
}
const stop = () => { E.id = ""; E.cand = null; E.level = ""; E.msg = ""; E.other = ""; };
function paint() { D?.repaint(); requestAnimationFrame(() => document.getElementById("sccap")?.focus({ preventScroll: true })); }
async function save() {
  const a = act(E.id); if (!a || E.cand === null) return;
  const prev = custom, id = a.id, cand = E.cand; stop();
  await persist(withBinding(prev, id, cand), prev); const el = document.querySelector<HTMLElement>(`[data-scrow="${id}"]`); el?.focus();
}
function openRow(id: string) { if (E.id === id) { stop(); D?.repaint(); document.querySelector<HTMLElement>(`[data-scrow="${id}"]`)?.focus(); return; } stop(); E.id = id; paint(); }

document.addEventListener("click", async e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-scrow],[data-scsave],[data-scdef],[data-scoff],[data-sccancel],[data-scall],[data-scswap],[data-scclear]"); if (!t || !D) return;
  e.preventDefault();
  if (t.dataset.scrow) { openRow(t.dataset.scrow); return; }
  const a = act(E.id);
  if (t.hasAttribute("data-sccancel")) { const id = E.id; stop(); D.repaint(); document.querySelector<HTMLElement>(`[data-scrow="${id}"]`)?.focus(); return; }
  if (t.hasAttribute("data-scall")) {
    if (!Object.keys(custom).length) return;
    if (!(await ask({ title: "Reset all shortcuts?", body: "Every shortcut goes back to its default.", confirm: "Reset all" }))) return;
    stop(); await persist({}, custom); return;
  }
  if (!a) return;
  if (t.hasAttribute("data-scsave")) { await save(); return; }
  if (t.hasAttribute("data-scdef")) { const prev = custom, id = a.id; stop(); const n = { ...prev }; delete n[id]; await persist(n, prev); document.querySelector<HTMLElement>(`[data-scrow="${id}"]`)?.focus(); return; }
  if (t.hasAttribute("data-scoff")) { evaluate(a, ""); await save(); return; }
  if (t.hasAttribute("data-scclear") || t.hasAttribute("data-scswap")) {
    const o = act(E.other), cand = E.cand; if (!o || cand === null) return;
    const prev = custom, swap = t.hasAttribute("data-scswap"), mine = comboOf(a.id);
    let n = withBinding(prev, a.id, cand); n = withBinding(n, o.id, swap ? mine : ""); stop(); await persist(n, prev); return;
  }
});
export function scInit(d: Deps) {
  D = d;
  const server = d.live && d.boot && typeof d.boot === "object" ? clean(d.boot) : null;
  custom = server ?? cacheGet();
  if (server) cacheSet(server);
}
/** Leaving the page drops a half-made change. */
export const scReset = () => stop();

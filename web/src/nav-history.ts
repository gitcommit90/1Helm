// Back and Forward arrows for the whole app (top of the channel rail), plus ⌘[ / ⌘] and Alt+←/→.
// The arrows use the browser's own history, so they do the same as its Back and Forward buttons. What this file adds is a record of
// where we are: each history entry this tab creates is stamped with a number in history.state (navIdx), and the highest number
// reached is kept in sessionStorage (navMax). Back is on only when the number is above 0, so it can never leave 1Helm (the sign-in
// page, the site you came from); Forward is on only when a later entry of ours exists. A reload keeps both, because the browser
// keeps history.state across it. A page that loads without a stamp (a typed address, coming back from another site) starts at 0.
// Real navigations (links, location.hash = …) already add one entry each. replaceState calls (a fold, a redirect, a temporary id
// turning into the real one) add none, and the patch below keeps the stamp on them.
type Stamp = { navIdx?: number };
const KEY = "1hc.nav.v1";
let idx = 0, max = 0, started = false;
const ss = { get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } }, set: (v: string) => { try { sessionStorage.setItem(KEY, v); } catch { /* private mode: the record lives in memory only */ } } };
const nativeReplace = history.replaceState.bind(history);
const nav = (window as any).navigation as { canGoBack?: boolean; canGoForward?: boolean } | undefined;
const save = () => ss.set(String(max));
const stampNow = () => { try { nativeReplace({ ...(history.state && typeof history.state === "object" ? history.state : {}), navIdx: idx } satisfies Stamp, "", location.href); } catch { /* unstampable: arrows stay as they were */ } };

export const navCanBack = () => idx > 0 && nav?.canGoBack !== false;
export const navCanForward = () => idx < max && nav?.canGoForward !== false;
export const navBack = () => { if (navCanBack()) history.back(); };
export const navForward = () => { if (navCanForward()) history.forward(); };

const chev = (d: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
/** The two buttons, drawn with the right disabled state: [Back, Forward]. tips: the tooltip text for each (with its shortcut). */
export function navButtons(tipBack: string, tipFwd: string): [string, string] {
  const b = (k: "back" | "forward", tip: string, on: boolean, d: string) =>
    `<button type="button" class="navhb" data-navh="${k}" aria-label="${k === "back" ? "Back" : "Forward"}" title="${tip}"${on ? "" : " disabled"}>${chev(d)}</button>`;
  return [b("back", tipBack, navCanBack(), "M15 5l-7 7 7 7"), b("forward", tipFwd, navCanForward(), "M9 5l7 7-7 7")];
}
export function navSync() {
  document.querySelectorAll<HTMLButtonElement>("[data-navh]").forEach(b => { b.disabled = !(b.dataset.navh === "back" ? navCanBack() : navCanForward()); });
}

// "Typing" means a text field with something in it. The composer has focus on most pages, so an empty one must not block the keys.
const typing = (t: EventTarget | null) => { const e = t as HTMLInputElement | null; if (!e || !e.tagName) return false;
  if (e.isContentEditable) return !!e.textContent?.trim();
  if (e.tagName === "SELECT") return true;
  return /^(INPUT|TEXTAREA)$/.test(e.tagName) && !/^(checkbox|radio|button|submit|range|color)$/.test((e as any).type) && e.value.length > 0; };
/** For the shortcut list: go back or forward unless the person is typing. The key is still taken, so the browser never leaves the app from a text box. */
export const navKey = (e: KeyboardEvent, dir: "back" | "forward") => { if (typing(e.target)) return; dir === "back" ? navBack() : navForward(); };

export function navInit() {
  if (started) return; started = true;
  // A replaceState from anywhere in the app (state null) keeps this entry's stamp.
  history.replaceState = function (state: any, unused: string, url?: string | URL | null) {
    const s = state && typeof state === "object" ? state : state == null ? {} : { v: state };
    return nativeReplace({ ...s, navIdx: typeof s.navIdx === "number" ? s.navIdx : idx } satisfies Stamp, unused, url);
  };
  const st = history.state as Stamp | null;
  if (typeof st?.navIdx === "number") { idx = st.navIdx; const m = parseInt(ss.get() || "", 10); max = Number.isFinite(m) && m >= idx ? m : idx; }   // reload: the entry kept its stamp
  else { idx = 0; max = 0; stampNow(); }   // the first page of this tab (or a page we came back to from elsewhere)
  save();
  window.addEventListener("popstate", () => {
    const s = history.state as Stamp | null;
    if (typeof s?.navIdx === "number") idx = s.navIdx;           // Back, Forward or history.go: a known entry
    else { idx = Math.min(idx + 1, 1e9); max = idx; stampNow(); }  // a new entry (link, location.hash =): it ends the Forward list
    if (idx > max) max = idx;
    save(); navSync();
  });
  window.addEventListener("hashchange", navSync);
  document.addEventListener("click", e => {
    const b = (e.target as Element).closest?.<HTMLButtonElement>("[data-navh]"); if (!b || b.disabled) return;
    e.preventDefault(); b.dataset.navh === "back" ? navBack() : navForward();
  });
  // Alt+← and Alt+→ (the browser's own Back/Forward keys on Windows and Linux) always stay inside 1Helm. ⌘[ and ⌘] are registered in
  // the shortcut list (v3.ts), which calls navKey.
  window.addEventListener("keydown", e => {
    if (e.defaultPrevented || e.isComposing) return;
    const alt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight");
    if (alt) { if (typing(e.target)) return; e.preventDefault(); if (!e.repeat) e.key === "ArrowLeft" ? navBack() : navForward(); }
  }, true);
}

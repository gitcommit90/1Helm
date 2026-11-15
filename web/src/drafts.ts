// Unsent message drafts. The page is drawn from HTML strings, so a message box is rebuilt empty whenever the screen is drawn again
// (another channel, another task, a reload). Each composer keeps its text here, keyed by the place it belongs to, in memory and in
// localStorage under one key per account. A draft goes away when its message is sent or when the person empties the box.
export type Draft = { t: string; at: number; to?: string };
export const DRAFT_MAX_CHARS = 20000, DRAFT_MAX_COUNT = 100;
const SAVE_DELAY = 400;
let acct = "sandbox", mem: Record<string, Draft> | null = null, timer = 0;
const dirty = new Set<string>();
const storeKey = () => `1h.drafts.v1.${acct}`;
function readStore(): Record<string, Draft> {
  try {
    const o = JSON.parse(localStorage.getItem(storeKey()) || "{}"), out: Record<string, Draft> = {};
    if (o && typeof o === "object") for (const k of Object.keys(o)) { const d = o[k]; if (d && typeof d.t === "string" && d.t) out[k] = { t: d.t.slice(0, DRAFT_MAX_CHARS), at: Number(d.at) || 0, ...(typeof d.to === "string" ? { to: d.to } : {}) }; }
    return out;
  } catch { return {}; }
}
const all = () => mem ??= readStore();
export function draftsInit(account: string) { acct = account || "sandbox"; mem = null; dirty.clear(); }
export function draftGet(key: string): Draft | undefined { return all()[key]; }
function trim(m: Record<string, Draft>) {
  const ks = Object.keys(m); if (ks.length <= DRAFT_MAX_COUNT) return;
  ks.sort((a, b) => m[a].at - m[b].at); for (const k of ks.slice(0, ks.length - DRAFT_MAX_COUNT)) delete m[k];
}
export function draftFlush() {
  clearTimeout(timer); timer = 0; if (!dirty.size) return;
  const m = all();
  try {
    const disk = readStore();   // another tab of the same account may have saved other drafts since this page read them
    for (const k of dirty) { if (m[k]) disk[k] = m[k]; else delete disk[k]; }
    trim(disk); dirty.clear(); mem = disk;
    if (Object.keys(disk).length) localStorage.setItem(storeKey(), JSON.stringify(disk)); else localStorage.removeItem(storeKey());
  } catch { dirty.clear(); }
}
const later = () => { if (!timer) timer = window.setTimeout(draftFlush, SAVE_DELAY); };
// Empty text clears the draft at once; anything else is kept in memory now and written to storage after a short pause.
export function draftSet(key: string, text: string, to?: string) {
  const m = all();
  if (!text.trim()) { draftClear(key); return; }
  m[key] = { t: text.slice(0, DRAFT_MAX_CHARS), at: Date.now(), ...(to ? { to } : {}) }; trim(m); dirty.add(key); later();
}
export function draftClear(key: string) { const m = all(); if (!(key in m) && !dirty.has(key)) return; delete m[key]; dirty.add(key); later(); }
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", draftFlush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") draftFlush(); });
}

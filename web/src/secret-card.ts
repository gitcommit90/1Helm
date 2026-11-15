// The secret request card in chat (server: src/secret-card.js, the helper's `request_secret` tool).
// A SYSTEM card in the cards-in-chat look (genui-cards.css: gu-sys, gu-field, gu-b). It is loose: it starts with the slots the helper suggested, or one
// empty slot. For each slot the person pastes text (hidden as dots, line breaks kept) or attaches a file, writes a label, can change the variable name
// (made from the label, e.g. "App Store Connect" -> APP_STORE_CONNECT), and can add a note on what it is for. Slots can be added and removed. The sites
// are optional. Save sends POST /res/<ch>/secrets/<id> {op:"save", slots, hosts, replace_ok?}; the server seals the values in Passwords & keys. If a name is
// already saved the server answers 409 with the names, the card asks "Replace?", and Save sends again with replace_ok. Not now sends {op:"cancel"}.
// The values live only in this module's memory while the card is open: never in the page's HTML for a repaint to copy, never in storage, drafts, logs or the
// chat. After Save they are wiped. One markup for the app (v3.ts cardHtml). State is kept per card key, so a whole-chat re-render keeps what was typed.

export type ScdField = { name?: string; label?: string; note?: string; file?: boolean };
export type ScdSaved = { names: string[]; hosts: string[]; replaced?: string[]; items?: { name: string; label: string; note?: string; file?: string }[] };
export type ScdView = { id: string; session?: string; turn?: string; service: string; reason?: string; fields: ScdField[]; hosts: string[]; status: "open" | "saved" | "cancelled"; saved?: ScdSaved | null };
export type ScdHost = {
  key: string;                                 // unique per card on the page
  api: (body: any) => Promise<any>;            // POST one op
  done: (v: ScdView) => void;                  // after Save or Not now: the task carries on
  helper: string;                              // the helper's name
};
type Slot = { uid: number; label: string; name: string; named: boolean; note: string; mode: "text" | "file"; value: string; fileName: string };
type St = { v: ScdView; slots: Slot[]; hosts: string; busy: "" | "save" | "no"; err: string; replace: string[]; host: ScdHost; uid: number; det: boolean };
const S = new Map<string, St>();
const FILE_MAX = 8000, SLOTS_MAX = 8;
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const svg = (d: string, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const KEY = '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M16 7l3 3"/>', CHECK = '<path d="M20 6 9 17l-5-5"/>', FILE = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';
const CLIP = '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>', PASTE = '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>', X = '<path d="M18 6 6 18M6 6l12 12"/>', WARN = '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>';
const domId = (key: string) => `scd-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
const stOf = (el: Element | null) => { const k = el?.closest<HTMLElement>("[data-scd]")?.dataset.scd; return k ? S.get(k) : undefined; };
// "https://www.Example.com/x" → "example.com" (the server checks the sites again).
const normHost = (v: string) => { const w = String(v || "").trim().toLowerCase(), star = w.startsWith("*.") ? "*." : ""; return star + w.slice(star.length).replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^[^/?#]*@/, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, ""); };
const hostList = (t: string) => [...new Set(String(t).split(/[\s,]+/).map(normHost).filter(Boolean))];
/** "App Store Connect" → "APP_STORE_CONNECT" (the server makes the same name, and adds _2 when it is taken). */
export function nameFromLabel(label: string) {
  let b = String(label || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!b) return ""; if (!/^[A-Z]/.test(b)) b = "KEY_" + b; b = b.slice(0, 36).replace(/_+$/, ""); return b.length < 2 ? "KEY_" + b : b;
}
const shownName = (s: Slot) => (s.named ? s.name : nameFromLabel(s.label));
const blank = (st: St, f?: ScdField): Slot => ({ uid: ++st.uid, label: f?.label || "", name: f?.name || "", named: !!f?.name, note: f?.note || "", mode: f?.file ? "file" : "text", value: "", fileName: "" });
const ready = (st: St) => st.slots.some(s => s.value.trim() !== "");

function slotHtml(st: St, s: Slot, i: number) {
  const id = `${domId(st.host.key)}-${s.uid}`, many = st.slots.length > 1, nm = shownName(s);
  const box = s.mode === "file"
    ? `<div class="scd-box scd-fbox">${s.fileName
        ? `<span class="scd-fname" data-scdfname="${s.uid}" title="${esc(s.fileName)}">${svg(CHECK, 14)}<span>${esc(s.fileName)}</span></span><button type="button" class="scd-ib" data-scdclear="${s.uid}" aria-label="Remove the file" title="Remove the file">${svg(X, 15)}</button>`
        : `<button type="button" class="scd-pick" data-scdpick="${s.uid}" aria-describedby="${id}-l${s.note ? ` ${id}-n` : ""}">${svg(FILE, 15)}Choose file</button><button type="button" class="scd-ib" data-scdclear="${s.uid}" aria-label="Paste text instead" title="Paste text instead">${svg(PASTE, 16)}</button>`}</div>`
    : `<div class="scd-box"><textarea class="scd-secret" rows="1" data-scdin="${s.uid}" aria-label="Secret to save${many ? ` ${i + 1}` : ""}" placeholder="Paste it here" autocomplete="off" autocapitalize="none" spellcheck="false" data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other">${esc(s.value)}</textarea><button type="button" class="scd-ib scd-att" data-scdpick="${s.uid}" aria-label="Attach a file" title="Attach a file">${svg(CLIP, 16)}</button></div>`;
  return `<div class="scd-slot" data-scdslot="${s.uid}">
    <div class="scd-lab"><input id="${id}-l" data-scdlab="${s.uid}" value="${esc(s.label)}" aria-label="What is it?" placeholder="Name, e.g. App Store key" autocomplete="off" spellcheck="false">${s.note ? `<p class="scd-nt" id="${id}-n">${esc(s.note)}</p>` : ""}</div>
    ${many ? `<button type="button" class="scd-rm" data-scdrm="${s.uid}" aria-label="Remove this secret" title="Remove">${svg(X, 15)}</button>` : ""}
    ${box}<input type="file" hidden data-scdfile="${s.uid}" tabindex="-1">
    <div class="scd-meta"><label class="scd-mf"><i>$</i><input data-scdname="${s.uid}" value="${esc(nm)}" aria-label="Variable name" placeholder="VARIABLE_NAME" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      <input data-scdnote="${s.uid}" value="${esc(s.note)}" aria-label="Note (optional)" placeholder="Note (optional)" autocomplete="off" spellcheck="false"></div></div>`;
}
function openHtml(st: St) {
  const v = st.v, busy = !!st.busy;
  const err = st.err ? `<p class="iv-err" role="alert">${esc(st.err)}</p>` : "";
  const sub = v.reason ? v.reason.replace(/^./, c => c.toUpperCase()) : `${st.host.helper} needs ${v.fields.length > 1 ? "these" : "something only you have"}. It is saved to Passwords & keys, and ${st.host.helper} never sees it.`;
  const warn = st.replace.length ? `<div class="scd-replace" role="alert">${svg(WARN, 16)}<span><b>${st.replace.map(n => `$${esc(n)}`).join(", ")} ${st.replace.length > 1 ? "are" : "is"} already saved.</b> Saving replaces ${st.replace.length > 1 ? "their values" : "its value"}.</span></div>` : "";
  return `<div class="gu-sh scd-h"><span class="gu-si">${svg(KEY, 17)}</span><span class="scd-ht"><b>${esc(v.service || "Paste a secret")}</b><span>${esc(sub)}</span></span></div>
    <div class="scd-slots${st.det ? " det" : ""}">${st.slots.map((s, i) => slotHtml(st, s, i)).join("")}</div>
    <div class="scd-bar">${st.slots.length < SLOTS_MAX ? `<button type="button" class="scd-lnk" data-scdadd${busy ? " disabled" : ""}>${svg(PLUS, 14)}Add another</button>` : ""}<button type="button" class="scd-lnk" data-scdetails aria-expanded="${st.det}">Details</button></div>
    <input class="scd-hosts" data-scdhosts value="${esc(st.hosts)}" aria-label="Sites it's for (optional)" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="url" placeholder="Sites it's for (optional), e.g. api.example.com">
    <p class="scd-hint">A request that sends it to a site that isn't listed waits for your OK.</p>
    ${warn}${err}
    <div class="gu-btns"><button type="button" class="gu-b primary${st.busy === "save" ? " busy" : ""}" data-scdgo="save"${ready(st) && !busy ? "" : " disabled"}>${st.busy === "save" ? `<span class="gu-bspin"></span>Saving…` : st.replace.length ? "Replace and save" : "Save"}</button>
      <button type="button" class="gu-b ghost" data-scdgo="no"${busy ? " disabled" : ""}>Not now</button></div>`;
}
function doneHtml(st: St) {
  const v = st.v, title = v.service || "Secret";
  if (v.status === "saved") { const n = v.saved?.items?.length ? v.saved.items.map(k => `${esc(k.label && k.label !== k.name ? k.label : k.name)} ($${esc(k.name)})`) : (v.saved?.names || []).map(x => `$${esc(x)}`);
    return `<div class="gu-sh scd-h"><span class="gu-si">${svg(CHECK, 17)}</span><span class="scd-ht"><b>Saved to Passwords & keys</b><span>${n.join(", ")}</span></span></div>`; }
  return `<div class="gu-sh scd-h"><span class="gu-si">${svg(KEY, 17)}</span><span class="scd-ht"><b>Not now</b><span>${esc(title)}, nothing was saved</span></span></div>`;
}
const cls = (st: St, fresh: boolean) => `acard gu-sys scd${st.v.status !== "open" ? " scd-fin" : ""}${fresh ? " gu-in" : ""}`;
const inner = (st: St) => st.v.status === "open" ? openHtml(st) : doneHtml(st);

/** The card's HTML. Call on every render: state is kept per host.key; a newer server view (answered on another device) is adopted. */
export function scdHtml(v: ScdView, host: ScdHost, fresh = false) {
  let st = S.get(host.key);
  if (!st) { st = { v, slots: [], hosts: (v.hosts || []).join(", "), busy: "", err: "", replace: [], host, uid: 0, det: false }; st.slots = (v.fields?.length ? v.fields : [undefined]).map(f => blank(st!, f)); S.set(host.key, st); }
  else { st.host = host; if (v.status !== "open" && st.v.status === "open" && !st.busy) { st.v = v; st.slots = []; } }
  return `<div class="${cls(st, fresh)}" id="${domId(host.key)}" data-scd="${esc(host.key)}">${inner(st)}</div>`;
}
function paint(st: St) {
  const el = document.getElementById(domId(st.host.key)); if (!el) return;
  el.className = cls(st, false); el.innerHTML = inner(st);
}
// Only the Save button follows typing, so the boxes keep their focus and caret.
function sync(st: St) { const b = document.querySelector<HTMLButtonElement>(`#${domId(st.host.key)} [data-scdgo="save"]`); if (b) b.disabled = !ready(st) || !!st.busy; }
const slotOf = (st: St, uid: any) => st.slots.find(s => String(s.uid) === String(uid));

async function go(st: St, what: "save" | "no") {
  if (st.busy || st.v.status !== "open") return;
  if (what === "save" && !ready(st)) return;
  const confirmed = st.replace.length > 0;
  st.busy = what; st.err = ""; paint(st);
  const slots = st.slots.filter(s => s.value.trim()).map(s => ({ label: s.label.trim(), ...(s.named ? { name: s.name.trim() } : {}), note: s.note.trim(), kind: s.mode, value: s.value }));
  let r: any;
  try { r = await st.host.api(what === "save" ? { op: "save", slots, hosts: hostList(st.hosts), ...(confirmed ? { replace_ok: true } : {}) } : { op: "cancel" }); }
  catch (e: any) {
    st.busy = ""; const d = e?.data; if (d?.replace?.length) { st.replace = d.replace; st.err = ""; paint(st); return; }
    st.err = e?.message || "Couldn't save that. Check your connection and try again."; paint(st); return; }
  st.busy = "";
  if (r?.replace?.length && !r.ok) { st.replace = r.replace; paint(st); return; }
  if (r?.error) { if (r.secret) { st.v = r.secret; st.slots = []; paint(st); return; } st.err = String(r.message || r.error); paint(st); return; }
  if (r?.secret) st.v = r.secret;
  st.slots = [];   // the values leave this page's memory the moment the server has them
  paint(st); try { st.host.done(st.v); } catch {}
}

function readFile(st: St, s: Slot, f: File | undefined) {
  if (!f) return;
  if (f.size > FILE_MAX) { st.err = "That file is too big to be a key."; paint(st); return; }
  f.text().then(t => {
    if (/\u0000/.test(t) || !t.trim()) { st.err = "That doesn't look like a text file. Pick the key file the service gave you."; paint(st); return; }
    s.value = t; s.fileName = f.name; if (!s.label.trim()) s.label = f.name.replace(/\.[^.]+$/, ""); st.err = ""; st.replace = []; paint(st);
  }).catch(() => { st.err = "Couldn't read that file."; paint(st); });
}

document.addEventListener("click", e => {
  const t = e.target as HTMLElement, b = t.closest<HTMLElement>("[data-scdgo],[data-scdpick],[data-scdadd],[data-scdrm],[data-scdclear],[data-scdetails]"); if (!b) return;
  const st = stOf(b); if (!st || st.busy) return;
  if (b.hasAttribute("data-scdetails")) { st.det = !st.det; b.setAttribute("aria-expanded", String(st.det)); b.closest(".scd")?.querySelector(".scd-slots")?.classList.toggle("det", st.det); return; }
  if (b.dataset.scdgo) { go(st, b.dataset.scdgo as "save" | "no"); return; }
  if (b.hasAttribute("data-scdadd")) { if (st.slots.length < SLOTS_MAX) { st.slots.push(blank(st)); paint(st); const l = document.querySelector<HTMLInputElement>(`#${domId(st.host.key)} [data-scdlab="${st.uid}"]`); l?.focus(); } return; }
  if (b.dataset.scdrm) { if (st.slots.length > 1) { st.slots = st.slots.filter(s => String(s.uid) !== b.dataset.scdrm); st.replace = []; paint(st); } return; }
  if (b.dataset.scdclear) { const s = slotOf(st, b.dataset.scdclear); if (s) { s.mode = "text"; s.value = ""; s.fileName = ""; st.replace = []; paint(st); } return; }
  b.closest<HTMLElement>(".scd-slot")?.querySelector<HTMLInputElement>("[data-scdfile]")?.click();
});
document.addEventListener("input", e => {
  const t = e.target as HTMLInputElement, st = stOf(t); if (!st) return;
  const d = t.dataset;
  if (d.scdin) { const s = slotOf(st, d.scdin); if (s) { s.value = t.value; st.replace = []; sync(st); } }
  else if (d.scdlab) { const s = slotOf(st, d.scdlab); if (s) { s.label = t.value; if (!s.named) { const n = t.closest(".scd-slot")?.querySelector<HTMLInputElement>("[data-scdname]"); if (n) n.value = nameFromLabel(t.value); } } }
  else if (d.scdname) { const s = slotOf(st, d.scdname); if (s) { s.name = t.value.toUpperCase().replace(/[\s-]+/g, "_"); s.named = s.name !== ""; t.value = s.name; st.replace = []; } }   // an emptied box goes back to the name made from the label when the person leaves it
  else if (d.scdnote) { const s = slotOf(st, d.scdnote); if (s) s.note = t.value; }
  else if (t.hasAttribute("data-scdhosts")) { st.hosts = t.value; }
});
document.addEventListener("focusout", e => {
  const t = e.target as HTMLInputElement, st = stOf(t); if (!st || !t.dataset?.scdname) return;
  const s = slotOf(st, t.dataset.scdname); if (s && !s.named) t.value = nameFromLabel(s.label);
});
document.addEventListener("change", e => {
  const t = e.target as HTMLInputElement, st = stOf(t); if (!st || !t.dataset.scdfile) return;
  const f = t.files?.[0]; t.value = ""; const s = slotOf(st, t.dataset.scdfile); if (s) readFile(st, s, f);
});
document.addEventListener("keydown", e => {
  const t = e.target as HTMLElement; if (e.key !== "Enter" || e.isComposing || !t.matches?.("[data-scdlab],[data-scdname],[data-scdnote],[data-scdhosts]")) return;
  const st = stOf(t); if (st && ready(st)) { e.preventDefault(); go(st, "save"); }
});

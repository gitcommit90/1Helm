// Contacts → Import: pick or drop a vCard (.vcf) or a Google / Outlook CSV. The file is read right here (contacts-parse.ts);
// it is never uploaded, stored or put in the Library. A preview shows what will happen (N new, N will merge with a contact you
// have, N skipped), with a list to untick; then only the kept contacts go to 1HC's /api/contacts/import, 200 at a time.
// Photos come along as small 96 px JPEGs made here. Notes stay out unless the person ticks "Include notes".
// v3.ts only hooks in: ciInit() once in live mode, ciOpen() from the Import buttons, and ctAv shows the photos.
import { VList } from "./contacts-list.ts";
import { payload, pickPhone, pickEmail, phoneShow, type Plan, type Row, type Existing, type Kind } from "./contacts-parse.ts";

type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  existing: () => Existing[];
  me: () => { name?: string; email?: string };
  helper: () => string;
  phone: () => boolean;
  onContacts: () => boolean;                 // Contacts is on screen (a dropped file there opens the import)
  imported: (r: Result) => Promise<void>;    // re-read Contacts and repaint
};
type Result = { added: number; merged: number; unchanged: number; skipped: number };
const BATCH = 200, FILE_MAX = 150e6;
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const n = (x: number) => x.toLocaleString("en-US");
const pl = (x: number, one: string, many = one + "s") => `${n(x)} ${x === 1 ? one : many}`;
const svg = (d: string, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'), up: svg('<path d="M12 16V4m0 0-5 5m5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>', 22),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 14), chev: svg('<path d="m9 6 6 6-6 6"/>', 13),
  check: svg('<path d="M20 6 9 17l-5-5"/>', 20), help: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>', 16),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 16), merge: svg('<path d="M7 4v5a5 5 0 0 0 5 5h5M14 10l4 4-4 4"/>', 13),
};
const HOW: [string, string][] = [
  ["iPhone", "Contacts app → <b>Lists</b> (top left) → touch and hold <b>All Contacts</b> → <b>Export</b> → Save to Files."],
  ["Android", "Contacts app → <b>Fix &amp; manage</b> → <b>Export to file</b>. On Samsung: ☰ → Manage contacts → Export."],
  ["Google", "<b>contacts.google.com</b> → Export → vCard or Google CSV."],
  ["iCloud", "<b>icloud.com/contacts</b> on a computer → select all → ⋯ → Export vCard."],
  ["Outlook", "People → <b>Manage contacts</b> → Export contacts (CSV)."],
];
const SRC: Record<Kind, string> = { vcard: "vCard", google: "Google CSV", outlook: "Outlook CSV", csv: "spreadsheet" };

let D: Deps | null = null;
let readSerial = 0, cancelRead: (() => void) | null = null;
const S = {
  el: null as HTMLElement | null, prev: null as HTMLElement | null,
  step: "pick" as "pick" | "reading" | "preview" | "importing" | "done",
  err: "", file: "", plan: null as Plan | null, off: new Set<number>(), join: new Set<number>(), notes: false, why: false, q: "",
  all: false, vis: [] as number[], sent: 0, total: 0, res: null as Result | null, drag: 0, progress: "",
};
export const ciIsOpen = () => !!S.el;

function reset() { readSerial++; cancelRead?.(); cancelRead = null; S.err = ""; S.file = ""; S.plan = null; S.off = new Set(); S.join = new Set(); S.notes = false; S.why = false; S.q = ""; S.all = false; S.vis = []; S.sent = 0; S.total = 0; S.res = null; S.progress = ""; S.step = "pick"; }

export function ciInit(d: Deps) {
  D = d;
  // Drop a file on Contacts (or on this dialog). Capture phase, so the channel's own drop-to-upload never sees it.
  const ok = (e: DragEvent) => !!D && (!!S.el || D.onContacts()) && S.step !== "importing" && [...(e.dataTransfer?.types || [])].includes("Files");
  const mark = () => { document.body.classList.toggle("cidrag", S.drag > 0); S.el?.classList.toggle("drag", S.drag > 0); };
  window.addEventListener("dragenter", (e) => { if (!ok(e)) return; e.stopPropagation(); S.drag++; mark(); }, true);
  window.addEventListener("dragleave", (e) => { if (!ok(e)) return; e.stopPropagation(); S.drag = Math.max(0, S.drag - 1); mark(); }, true);
  window.addEventListener("dragover", (e) => { if (!ok(e)) return; e.stopPropagation(); e.preventDefault(); }, true);
  window.addEventListener("drop", (e) => { if (!ok(e)) return; e.stopPropagation(); e.preventDefault(); S.drag = 0; mark(); const f = e.dataTransfer?.files?.[0]; if (f) { ciOpen(); read(f); } }, true);
}

export function ciOpen() {
  if (!D) return;
  if (S.el) return;
  reset();
  const el = document.createElement("div"); el.className = "ciw";
  el.innerHTML = `<div class="ciback" data-cix></div><div class="cibox" role="dialog" aria-modal="true" aria-labelledby="ciT" tabindex="-1"><span class="cigrab" aria-hidden="true"></span><div class="cibody"></div></div>
    <input type="file" id="cifile" accept=".vcf,.vcard,.csv,text/vcard,text/x-vcard,text/csv,text/comma-separated-values" hidden>`;
  S.prev = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  document.body.appendChild(el); S.el = el;
  el.addEventListener("click", onClick); el.addEventListener("change", onChange); el.addEventListener("input", onInput);
  el.addEventListener("mousedown", (e) => { if ((e.target as HTMLElement).closest(".ciback")) e.preventDefault(); });
  paint(); void el.offsetWidth; el.classList.add("on");
  el.querySelector<HTMLElement>(".cibox")!.focus({ preventScroll: true });
}
function close() {
  const el = S.el; if (!el || S.step === "importing") return;
  V?.destroy(); V = null; S.el = null; el.classList.remove("on"); el.classList.add("off"); setTimeout(() => el.remove(), 300);
  reset(); if (S.prev?.isConnected) S.prev.focus({ preventScroll: true });
}

// ---------- reading the file ----------
async function read(f: File) {
  if (!D || S.step === "importing") return;
  reset(); S.file = f.name; S.step = "reading"; S.progress = "Reading the file…"; paint();
  const serial = readSerial;
  if (f.size > FILE_MAX) { fail("That file is too big for a contacts export (over 150 MB). Export a smaller group and import it in parts."); return; }
  if (!/\.(vcf|vcard|csv)$/i.test(f.name) && !/vcard|csv|comma/.test(f.type)) { fail("That isn't a contacts file. Pick a vCard (.vcf) or a Google / Outlook contacts CSV."); return; }
  try {
    const bytes = await f.arrayBuffer();
    if (!S.el || serial !== readSerial) return;
    const p = await new Promise<Plan>((resolve, reject) => {
      let worker: Worker;
      try { const url = new URL("./contacts-import-worker.js", import.meta.url); url.search = new URL(import.meta.url).search; worker = new Worker(url, { type: "module" }); }
      catch { reject(new Error("Couldn't start background import. Reload the page and try again. Nothing has been imported.")); return; }
      const finish = () => { worker.terminate(); if (serial === readSerial) cancelRead = null; };
      cancelRead = () => { worker.terminate(); reject(new DOMException("Import cancelled", "AbortError")); };
      worker.onerror = (e) => { e.preventDefault(); finish(); reject(new Error("Couldn't prepare that file in the background. Reload the page and try again. Nothing has been imported.")); };
      worker.onmessageerror = () => { finish(); reject(new Error("Couldn't read the prepared contacts. Try the file again. Nothing has been imported.")); };
      worker.onmessage = ({ data }) => {
        if (serial !== readSerial) return;
        if (data.type === "progress") { S.progress = data.phase === "photos" ? `Preparing photos… ${n(data.done)} of ${n(data.total)}` : "Reading contacts…"; paintProgress(); }
        else if (data.type === "done") { finish(); resolve(data.plan); }
        else if (data.type === "error") { finish(); reject(new Error(data.message)); }
      };
      try { worker.postMessage({ name: f.name, bytes, existing: D!.existing(), me: D!.me() }, [bytes]); }
      catch (error) { finish(); reject(error); }
    });
    if (!S.el || serial !== readSerial) return;
    S.plan = p; S.step = "preview"; filter(); paint();
  } catch (error) { if (S.el && serial === readSerial) fail(error instanceof Error ? error.message : "Couldn't read that file. Try exporting it again."); }
}
function fail(msg: string) { S.err = msg; S.step = "pick"; paint(); }
// ---------- the counts ----------
const ticked = (i: number) => !S.off.has(i);
const merges = (r: Row, i: number) => !!r.match || (!!r.maybe && S.join.has(i));
function counts() {
  const p = S.plan!; let add = 0, mer = 0;
  p.rows.forEach((r, i) => { if (!ticked(i)) return; if (merges(r, i)) mer++; else add++; });
  return { add, mer, on: add + mer };
}
function filter() {
  const q = S.q.trim().toLowerCase(), p = S.plan; if (!p) return;
  S.vis = p.rows.map((_, i) => i).filter(i => { if (!q) return true; const c = p.rows[i].c; return [c.name, ...c.aka, c.org, ...c.emails.map(e => e.v), ...c.phones.map(x => x.v)].some(s => s.toLowerCase().includes(q)); });
}
// Hundreds of rows: a sample of the first 20 and "Show all N", which (like a search) opens the windowed list.
const SAMPLE = 20;
const sampled = () => !S.q.trim() && !S.all && (S.plan?.rows.length || 0) > SAMPLE + 10;
let V: VList | null = null;
const rowH = (i: number) => D?.phone() ? (S.plan!.rows[i].match || S.plan!.rows[i].maybe ? 86 : 58) : 50;
function listHtml() {
  const p = S.plan!;
  if (!S.vis.length) return `<div class="cilist" id="cilist"><p class="cinone">Nobody matches “${esc(S.q)}”.</p></div>`;
  if (sampled()) return `<div class="cilist" id="cilist">${S.vis.slice(0, SAMPLE).map(rowHtml).join("")}</div><button type="button" class="cimore" data-cimore>Show all ${n(p.rows.length)}${IC.chev}</button>`;
  if (S.vis.length <= SAMPLE + 10) return `<div class="cilist" id="cilist">${S.vis.map(rowHtml).join("")}</div>`;
  return `<div class="cilist vl" id="cilist" tabindex="-1" aria-label="${n(S.vis.length)} contacts"><div class="civb" id="civb"></div></div>`;
}
function mountList(top = 0) {
  V?.destroy(); V = null;
  const l = document.getElementById("cilist"), b = document.getElementById("civb"); if (!l) return;
  if (b) V = new VList(l, b, { count: S.vis.length, height: k => rowH(S.vis[k]), html: k => rowHtml(S.vis[k]), overscan: 300 });
  l.scrollTop = top; V?.paint();
}
function paintList() { const w = document.getElementById("cilw"); if (w) { w.innerHTML = listHtml(); mountList(0); } }

// ---------- painting ----------
const initials = (name: string) => !/\p{L}/u.test(name) ? "#" : name.replace(/\(.*?\)/g, "").replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/, "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]).join("").toUpperCase() || "?";
function rowHtml(i: number) {
  const r = S.plan!.rows[i], c = r.c, ph = pickPhone(c), em = pickEmail(c), more = c.phones.length + c.emails.length - (ph ? 1 : 0) - (em ? 1 : 0);
  const sub = [r.rel, ph && phoneShow(ph.v), em?.v, more > 0 ? `+${more} more` : "", !ph && !em && c.org && c.org !== c.name ? c.org : ""].filter(Boolean).map(esc).join(" · ") || "Name only";
  const tag = r.match ? `<em class="citag" title="Same ${r.match.by} as ${esc(r.match.name)}. Only empty details get filled in.">${IC.merge}Merges with ${esc(r.match.name)}</em>`
    : r.maybe ? `<button type="button" class="citag ask${S.join.has(i) ? " on" : ""}" data-cijoin="${i}" aria-pressed="${S.join.has(i)}" title="${S.join.has(i) ? "Will merge. Tap to add as a new contact instead." : "Same name as a contact you have. Tap to merge them."}">${S.join.has(i) ? `${IC.merge}Merges with ${esc(r.maybe.name)}` : `Same as ${esc(r.maybe.name)}?`}</button>` : "";
  return `<div class="cir${ticked(i) ? "" : " off"}"><label><input type="checkbox" data-ciu="${i}"${ticked(i) ? " checked" : ""}${S.step === "importing" ? " disabled" : ""}>
    <span class="ciav">${r.photo ? `<img src="${r.photo}" alt="">` : esc(initials(c.name))}</span><span class="cirt"><b>${esc(c.name)}</b><span>${sub}</span></span></label>${tag}</div>`;
}
function pickHtml() {
  return `<div class="cihead"><div><h2 id="ciT">Import contacts</h2><p>From your phone, Google, iCloud or Outlook.</p></div><button type="button" class="cicb" data-cix aria-label="Close">${IC.x}</button></div>
    ${S.err ? `<p class="cierr" role="alert">${IC.help}<span>${esc(S.err)}</span></p>` : ""}
    <button type="button" class="cidrop" data-cipick>${IC.up}<b>${S.err ? "Choose another file" : "Choose a file"}</b><small>${D?.phone() ? "A .vcf or .csv contacts export" : "or drop a .vcf or .csv contacts export here"}</small></button>
    <div class="cihow"><h3>Get the file</h3>${HOW.map(([k, v]) => `<p><b>${k}</b><span>${v}</span></p>`).join("")}</div>
    <p class="cifoot">${IC.lock}<span>The file is read on this device. It isn't uploaded or kept; only the contacts you pick are saved to Contacts.</span></p>`;
}
function progressHtml() {
  return `<div class="cihead"><div><h2 id="ciT">Import contacts</h2><p>${esc(S.file)}</p></div><button type="button" class="cicb" data-cix aria-label="Cancel import">${IC.x}</button></div><div class="ciwait"><span class="cispin"></span><span id="ciprog">${esc(S.progress)}</span></div>`;
}
function previewHtml() {
  const p = S.plan!, k = counts(), sk = p.skipped.length, busy = S.step === "importing";
  const stats = `<div class="cistats"><span><b>${n(k.add)}</b> new</span><span><b>${n(k.mer)}</b> will merge</span>${sk ? `<button type="button" class="cisk${S.why ? " on" : ""}" data-ciwhy aria-expanded="${S.why}"><b>${n(sk)}</b> skipped${IC.chev}</button>` : `<span><b>0</b> skipped</span>`}</div>`;
  const why = S.why && sk ? `<ul class="ciwhy">${p.skipped.map(x => `<li><b>${esc(x.name)}</b><span>${esc(x.reason)}</span></li>`).join("")}</ul>` : "";
  const extra = [p.combined ? `${pl(p.combined, "duplicate")} in the file combined.` : "", p.me ? `Your own card (${esc(p.me)}) isn't imported; the people it lists (spouse, kids…) are marked as yours.` : ""].filter(Boolean).join(" ");
  const all = k.on === p.rows.length;
  const list = p.rows.length ? `<div class="citools"><label class="ciall"><input type="checkbox" data-ciall${all ? " checked" : ""}${busy ? " disabled" : ""}><span>${all ? "All" : `${n(k.on)} of ${n(p.rows.length)}`} selected</span></label>
      ${p.rows.length > 8 ? `<label class="ciq">${IC.search}<input id="ciq" type="search" placeholder="Find a name" value="${esc(S.q)}" autocomplete="off"${busy ? " disabled" : ""}></label>` : ""}</div>
    <div class="cilw" id="cilw">${listHtml()}</div>` : `<p class="cinone">Nothing in this file can be imported.</p>`;
  const notes = p.notes ? `<label class="cinotes"><input type="checkbox" data-cinotes${S.notes ? " checked" : ""}${busy ? " disabled" : ""}><span><b>Include notes</b><small>${pl(p.notes, "contact has", "contacts have")} notes. Off unless you tick it, since notes can be private.</small></span></label>` : "";
  return `<div class="cihead"><div><h2 id="ciT">Import ${pl(p.rows.length, "contact")}</h2><p>From ${esc(S.file)} · ${SRC[p.kind]}</p></div><button type="button" class="cicb" data-cix aria-label="Close"${busy ? " disabled" : ""}>${IC.x}</button></div>
    ${stats}${why}${extra ? `<p class="cinote">${extra}</p>` : ""}${list}${notes}
    <p class="cifine">Merging only fills in details a contact is missing. Nothing you've typed is changed.</p>
    <div class="cibtns"><button type="button" class="cigo" data-cigo${k.on && !busy ? "" : " disabled"}>${busy ? `Importing… ${n(S.sent)} of ${n(S.total)}` : `Import ${pl(k.on, "contact")}`}</button><button type="button" class="cino" data-cipick${busy ? " disabled" : ""}>Choose another file</button></div>
    ${S.err ? `<p class="cierr" role="alert">${IC.help}<span>${esc(S.err)}</span></p>` : ""}`;
}
function doneHtml() {
  const r = S.res!, got = r.added + r.merged;
  return `<div class="cihead"><div><h2 id="ciT">${got ? `Imported ${pl(got, "contact")}` : "Nothing new to import"}</h2><p>${esc(S.file)}</p></div><button type="button" class="cicb" data-cix aria-label="Close">${IC.x}</button></div>
    <div class="cidone">${IC.check}<p>${[`${n(r.added)} new`, `${n(r.merged)} merged with contacts you had`, r.unchanged ? `${n(r.unchanged)} already up to date` : "", r.skipped ? `${n(r.skipped)} skipped` : ""].filter(Boolean).join(", ")}.
      When you mention any of them, ${esc(D!.helper())} knows who you mean.</p></div>
    <p class="cifine">You can delete the export file now. 1Helm didn't keep it.</p>
    <div class="cibtns"><button type="button" class="cigo" data-cix>Done</button></div>`;
}
function paint() {
  const b = S.el?.querySelector<HTMLElement>(".cibody"); if (!b) return;
  const top = document.getElementById("cilist")?.scrollTop || 0;
  b.innerHTML = S.step === "pick" ? pickHtml() : S.step === "reading" ? progressHtml() : S.step === "done" ? doneHtml() : previewHtml();
  S.el!.dataset.step = S.step;
  if (document.getElementById("cilist")) mountList(top); else { V?.destroy(); V = null; }
}
function paintProgress() { const e = document.getElementById("ciprog"); if (e) e.textContent = S.progress; else paint(); }
// Only the counts and the button change when a row is ticked (a 3,000-row list isn't rebuilt).
function paintCounts() {
  const p = S.plan; if (!p || !S.el) return; const k = counts();
  const st = S.el.querySelectorAll<HTMLElement>(".cistats b"); if (st[0]) st[0].textContent = n(k.add); if (st[1]) st[1].textContent = n(k.mer);
  const go = S.el.querySelector<HTMLButtonElement>("[data-cigo]"); if (go) { go.textContent = `Import ${pl(k.on, "contact")}`; go.disabled = !k.on; }
  const all = S.el.querySelector<HTMLInputElement>("[data-ciall]"); if (all) { all.checked = k.on === p.rows.length; all.nextElementSibling!.textContent = `${k.on === p.rows.length ? "All" : `${n(k.on)} of ${n(p.rows.length)}`} selected`; }
}
// ---------- events ----------
function onClick(e: MouseEvent) {
  e.stopPropagation();   // the app's document handlers (menus, rows) never see clicks in here
  const t = e.target as HTMLElement;
  if (t.closest("[data-cix]")) { close(); return; }
  if (t.closest("[data-cipick]")) { if (S.step !== "importing") S.el?.querySelector<HTMLInputElement>("#cifile")?.click(); return; }
  if (t.closest("[data-ciwhy]")) { S.why = !S.why; paint(); return; }
  const j = t.closest<HTMLElement>("[data-cijoin]"); if (j && S.step === "preview") { const i = +j.dataset.cijoin!; S.join.has(i) ? S.join.delete(i) : S.join.add(i); S.off.delete(i); if (V) V.refresh(S.vis.indexOf(i)); else { const row = j.closest(".cir"); if (row) row.outerHTML = rowHtml(i); } paintCounts(); return; }
  if (t.closest("[data-cimore]")) { S.all = true; paintList(); document.getElementById("cilist")?.focus({ preventScroll: true }); return; }
  if (t.closest("[data-cigo]")) { go(); return; }
}
function onChange(e: Event) {
  const t = e.target as HTMLInputElement;
  if (t.id === "cifile") { const f = t.files?.[0]; t.value = ""; if (f) read(f); return; }
  if (!S.plan || S.step !== "preview") return;
  if (t.matches("[data-ciu]")) { const i = +t.dataset.ciu!; t.checked ? S.off.delete(i) : S.off.add(i); t.closest(".cir")?.classList.toggle("off", !t.checked); paintCounts(); }
  else if (t.matches("[data-ciall]")) { S.off = t.checked ? new Set() : new Set(S.plan.rows.map((_, i) => i)); paint(); }
  else if (t.matches("[data-cinotes]")) S.notes = t.checked;
}
function onInput(e: Event) {
  const t = e.target as HTMLInputElement; if (t.id !== "ciq") return;
  S.q = t.value; filter(); paintList();
}
async function go() {
  const p = S.plan; if (!p || !D || S.step === "importing") return;
  const keep = p.rows.map((r, i) => ({ r, i })).filter(({ i }) => ticked(i));
  if (!keep.length) return;
  const body = keep.map(({ r, i }) => payload(r, { notes: S.notes, into: !r.match && r.maybe && S.join.has(i) ? r.maybe.sid : undefined }));
  S.step = "importing"; S.err = ""; S.total = body.length; S.sent = 0; paint();
  const res: Result = { added: 0, merged: 0, unchanged: 0, skipped: p.skipped.length };
  for (let at = 0; at < body.length; at += BATCH) {
    let d: any = null;
    for (let tries = 0; tries < 3 && !d; tries++) {
      try { d = await D.api("/contacts/import", { contacts: body.slice(at, at + BATCH), source: p.kind }); if (d?.error) throw new Error(d.error); }
      catch (x: any) { d = null; if (tries === 2) { S.step = "preview"; S.err = `Stopped after ${pl(at, "contact")}: ${x?.message || "the connection dropped"}. Import again to finish; contacts already saved won't be doubled.`; paint(); if (at) await D.imported(res).catch(() => {}); return; } await new Promise(z => setTimeout(z, 800 * (tries + 1))); }
    }
    res.added += d.added || 0; res.merged += d.merged || 0; res.unchanged += d.unchanged || 0; res.skipped += (d.skipped || []).length;
    S.sent = Math.min(body.length, at + BATCH);
    const b = S.el?.querySelector<HTMLButtonElement>("[data-cigo]"); if (b) b.textContent = `Importing… ${n(S.sent)} of ${n(S.total)}`;
  }
  body.length = 0; S.res = res; S.step = "done"; S.plan = null; paint();   // the parsed contacts aren't kept once they're saved
  await D.imported(res).catch(() => {});
}

// While it's open: Esc closes, Tab stays inside, and no app shortcut underneath sees the keys (typing still types).
window.addEventListener("keydown", (e) => {
  if (!S.el) return;
  e.stopImmediatePropagation();
  if (e.key === "Escape") { e.preventDefault(); close(); return; }
  if (e.key === "Tab") {
    const f = [...S.el.querySelectorAll<HTMLElement>("input:not([hidden]):not([disabled]),button:not([disabled])")].filter(x => x.offsetParent !== null);
    if (!f.length) return; const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey ? i <= 0 : i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
  }
}, true);
window.addEventListener("keyup", (e) => { if (S.el) e.stopImmediatePropagation(); }, true);

// Several numbers / emails per contact, and merging two contacts into one (Captain 2026-10-06: "I have 2 contacts for my brother;
// I'd rather have a single one with multiple labeled numbers/emails"). 1HC keeps the lists (people.js, primary first) and does
// the merge in one transaction; this file is the app side:
//   numRows() / readNums()  the Edit form's repeatable phone + email rows (label pills Work / Personal / Other, primary, remove, add)
//   mergeOpen()             "Merge": pick the other contact (search, possible duplicates first, a windowed list for big books,
//                           arrows + Enter), preview the combined card (choices where the two disagree), confirm with ask(), merge
//   dupBanner()             "Possible duplicates" above the list, one-tap Merge or "Not the same"
// v3.ts hooks in with cmInit() and these calls.
import { ask } from "./dialog";
import { e164 } from "./contacts-parse";
import { pills, pillClick, pillKey, VList } from "./contacts-list";

export type Num = { v: string; t?: string; label: string; primary?: boolean };
export type MC = { id: number; sid?: string; name: string; rel: string; aka: string[]; phone?: string; email?: string; phones?: Num[]; emails?: Num[]; bday?: string; addr?: string;
  group: string; color: string; photo?: string; from: string; facts: { text: string; src: string; at: number; id?: string; fresh?: boolean }[]; seen: [string, number][] };
type Pair = { a: MC; b: MC; why: string };
type Deps = { list: () => MC[]; av: (c: MC, cls?: string) => string; helper: () => string; phone: () => boolean; groups: () => string[];
  merge: (keep: MC, drop: MC, pick: Record<string, string>) => Promise<boolean>;   // does it (1HC or locally); false = it failed
  dups: () => Pair[]; notDup: (a: MC, b: MC) => void };

export const LABELS = ["Personal", "Work", "Other"];
// Same rule as 1HC people.js labelOf: Mobile / Home / iPhone (or no label) → Personal, Work → Work, anything else → Other.
export function labelOf(t = "") {
  const s = t.toLowerCase().replace(/\bpref\b/g, "").trim();
  if (/\b(work|office|business|company)\b/.test(s)) return "Work";
  if (!s || /\b(mobile|cell|iphone|home|personal|private)\b/.test(s)) return "Personal";
  return "Other";
}
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fold = (s: string) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const keyOf = (kind: "phone" | "email", v: string) => kind === "phone" ? (e164(v) || v.replace(/\D/g, "")) : v.trim().toLowerCase();
const svg = (d: string, s = 16) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = { x: svg('<path d="M18 6 6 18M6 6l12 12"/>'), plus: svg('<path d="M12 5v14M5 12h14"/>'), star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  merge: svg('<path d="M7 4v5a5 5 0 0 0 5 5h5M14 10l4 4-4 4"/>'), search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'), back: svg('<path d="m15 18-6-6 6-6"/>') };

let D: Deps | null = null;
export function cmInit(d: Deps) { D = d; }

// A contact's lists (older cards have only phone / email).
export function numsOf(c: { phone?: string; email?: string; phones?: Num[]; emails?: Num[] }) {
  const one = (v?: string): Num[] => v ? [{ v, t: "", label: "Personal", primary: true }] : [];
  return { phones: c.phones?.length ? c.phones : one(c.phone), emails: c.emails?.length ? c.emails : one(c.email) };
}
// Deduped by key (E.164 for phones, lowercase for emails), primary first (`primary` = a value to put first).
function combine(kind: "phone" | "email", list: Num[], primary?: string) {
  const out: Num[] = [], seen = new Set<string>();
  for (const x of list) { const k = keyOf(kind, x.v); if (!k || seen.has(k)) continue; seen.add(k); out.push({ v: x.v, t: x.t, label: x.label || labelOf(x.t) }); }
  const want = primary ? keyOf(kind, primary) : "", i = want ? out.findIndex(x => keyOf(kind, x.v) === want) : -1;
  if (i > 0) out.unshift(...out.splice(i, 1));
  return out.map((x, j) => ({ ...x, primary: j === 0 || undefined }));
}

// ---------- the Edit form's phone / email rows ----------
let rowN = 0;
function rowHtml(kind: "phone" | "email", x: Num | null, primary: boolean) {
  const n = ++rowN, word = kind === "phone" ? "number" : "email";
  return `<div class="cxnum" data-kind="${kind}"><input class="cxnv" value="${esc(x?.v || "")}" ${kind === "phone" ? `inputmode="tel" placeholder="(503) 555-0187"` : `inputmode="email" placeholder="name@example.com"`} autocomplete="off" aria-label="${kind === "phone" ? "Phone number" : "Email"}">
    ${pills(`cxl${n}`, LABELS, x ? x.label || labelOf(x.t) : "Personal", `Label for this ${word}`, "sm")}
    <button type="button" class="cxpri" data-cxpri aria-pressed="${primary}" title="${primary ? `Primary ${word}` : `Make this the primary ${word}`}" aria-label="${primary ? `Primary ${word}` : `Make primary`}">${IC.star}<span>${primary ? "Primary" : ""}</span></button>
    <button type="button" class="cxnx" data-cxnumx aria-label="Remove this ${word}" title="Remove">${IC.x}</button></div>`;
}
export function numRows(kind: "phone" | "email", c?: MC) {
  const l = c ? numsOf(c)[kind === "phone" ? "phones" : "emails"] : [];
  return `<div class="cxfield cxnums" data-nums="${kind}"><span>${kind === "phone" ? "Phone" : "Email"}</span><div class="cxnl">${(l.length ? l : [null]).map((x, i) => rowHtml(kind, x, i === 0)).join("")}</div>
    <button type="button" class="cxnadd" data-cxnumadd="${kind}">${IC.plus}<span>${kind === "phone" ? "Add number" : "Add email"}</span></button></div>`;
}
// What the form says: [{ v, t, label, primary }], primary first, empty rows dropped.
export function readNums(form: HTMLElement, kind: "phone" | "email"): Num[] {
  const rows = [...form.querySelectorAll<HTMLElement>(`[data-nums="${kind}"] .cxnum`)].map(r => ({ v: r.querySelector<HTMLInputElement>(".cxnv")!.value.trim(), label: r.querySelector<HTMLInputElement>("[data-pills] input")!.value, pri: r.querySelector("[data-cxpri]")!.getAttribute("aria-pressed") === "true" })).filter(x => x.v);
  const pri = rows.find(x => x.pri)?.v;
  return combine(kind, rows.map(x => ({ v: x.v, t: x.label.toLowerCase(), label: x.label })), pri);
}
function setPrimary(row: HTMLElement) {
  const box = row.closest(".cxnl")!, word = row.dataset.kind === "phone" ? "number" : "email";
  box.querySelectorAll<HTMLElement>("[data-cxpri]").forEach(b => { const on = b.closest(".cxnum") === row; b.setAttribute("aria-pressed", String(on)); b.title = on ? `Primary ${word}` : `Make this the primary ${word}`; b.setAttribute("aria-label", on ? `Primary ${word}` : "Make primary"); b.querySelector("span")!.textContent = on ? "Primary" : ""; });
}
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const add = t.closest<HTMLElement>("[data-cxnumadd]"); if (add) { e.preventDefault(); const kind = add.dataset.cxnumadd as "phone" | "email", box = add.parentElement!.querySelector(".cxnl")!;
    const first = !box.querySelector(".cxnum"); box.insertAdjacentHTML("beforeend", rowHtml(kind, null, first)); box.querySelector<HTMLInputElement>(".cxnum:last-child .cxnv")?.focus(); return; }
  const x = t.closest<HTMLElement>("[data-cxnumx]"); if (x) { e.preventDefault(); const row = x.closest<HTMLElement>(".cxnum")!, box = row.parentElement!, wasPri = row.querySelector("[data-cxpri]")!.getAttribute("aria-pressed") === "true";
    const next = (row.nextElementSibling || row.previousElementSibling) as HTMLElement | null; row.remove();
    if (wasPri && box.firstElementChild) setPrimary(box.firstElementChild as HTMLElement);
    (next?.querySelector<HTMLElement>(".cxnv") || box.parentElement?.querySelector<HTMLElement>("[data-cxnumadd]"))?.focus(); return; }
  const p = t.closest<HTMLElement>("[data-cxpri]"); if (p) { e.preventDefault(); setPrimary(p.closest<HTMLElement>(".cxnum")!); return; }
});

// ---------- merge: pick the other contact → preview → confirm → merge ----------
// The picker's pool: everyone but `keep`, scored once per open (duplicate signals + search text), A–Z.
type Cand = { c: MC; why: string; rank: number; n: string; aka: string; dg: string; em: string };
type It = { h: string } | { k: Cand };
const M = { el: null as HTMLElement | null, prev: null as HTMLElement | null, keep: null as MC | null, drop: null as MC | null, q: "", vl: null as VList | null,
  pool: [] as Cand[], items: [] as It[], ai: -1, busy: false, step: "pick" as "pick" | "preview" };
export const cmIsOpen = () => !!M.el;
// true = the Merge sheet is open (or already was). false = it can't open (cmInit never ran): the caller says so, never a dead button.
export function mergeOpen(keep: MC, drop?: MC): boolean {
  if (M.el) return true;
  if (!D) { console.error("contacts-merge: mergeOpen before cmInit"); return false; }
  M.keep = keep; M.drop = drop || null; M.q = ""; M.busy = false; M.step = drop ? "preview" : "pick"; M.pool = []; M.ai = -1;
  const el = document.createElement("div"); el.className = "ciw cmw";
  el.innerHTML = `<div class="ciback" data-cmx></div><div class="cibox" role="dialog" aria-modal="true" aria-labelledby="cmT" tabindex="-1"><span class="cigrab" aria-hidden="true"></span><div class="cibody"></div></div>`;
  M.prev = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  document.body.appendChild(el); M.el = el;
  el.addEventListener("click", onClick); el.addEventListener("input", onInput); el.addEventListener("change", onChange); el.addEventListener("pointermove", onMove);
  paint(); void el.offsetWidth; el.classList.add("on");
  (el.querySelector<HTMLElement>("#cmq") || el.querySelector<HTMLElement>(".cibox"))!.focus({ preventScroll: true });
  return true;
}
function close() {
  const el = M.el; if (!el || M.busy) return;
  M.vl?.destroy(); M.vl = null; M.el = null; M.pool = []; M.items = []; el.classList.remove("on"); el.classList.add("off"); setTimeout(() => el.remove(), 300);
  if (M.prev?.isConnected) M.prev.focus({ preventScroll: true });
}
// ---------- the picker ----------
// Possible duplicates of `keep` first (same number or email, 1HC's duplicate pairs, the same name, or a similar one like
// Danny / Daniel Rivera), then everyone else A–Z. Typing filters by name, "also called", number (any of them) or email.
const coll = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const digits = (s: string) => s.replace(/\D+/g, "");
const shortWhy = (w: string) => /^same number/i.test(w) ? "Same number" : /^same email/i.test(w) ? "Same email" : /^same name/i.test(w) ? "Same name" : w.split(" ").slice(0, 2).join(" ");
function pool(): Cand[] {
  const k = M.keep!, nk = numsOf(k), tk = new Set(nk.phones.map(x => keyOf("phone", x.v)).filter(Boolean)), ek = new Set(nk.emails.map(x => keyOf("email", x.v)).filter(Boolean));
  const kn = fold(k.name), kw = kn.split(" "), kf = kw[0] || "", kl = kw.length > 1 ? kw[kw.length - 1] : "";
  const dw = new Map<MC, string>(); for (const d of D!.dups()) { if (d.a === k) dw.set(d.b, d.why); else if (d.b === k) dw.set(d.a, d.why); }
  return D!.list().filter(c => c !== k).map(c => {
    const n = numsOf(c), cn = fold(c.name), cw = cn.split(" "), cf = cw[0] || "", cl = cw.length > 1 ? cw[cw.length - 1] : "";
    let why = "", rank = 0;
    if (n.phones.some(x => tk.has(keyOf("phone", x.v)))) { why = "Same number"; rank = 4; }
    else if (n.emails.some(x => ek.has(keyOf("email", x.v)))) { why = "Same email"; rank = 4; }
    else if (dw.has(c)) { why = shortWhy(dw.get(c)!); rank = 3; }
    else if (kn.length > 2 && cn === kn) { why = "Same name"; rank = 3; }
    else if (kl && cl === kl && kf && cf && (kf.length >= 3 && cf.length >= 3 ? kf.slice(0, 3) === cf.slice(0, 3) : kf[0] === cf[0])) { why = "Similar name"; rank = 2; }   // Danny / Daniel, D. Rivera
    return { c, why, rank, n: cn, aka: c.aka.map(fold).join("|"), dg: n.phones.map(x => digits(x.v)).join("|"), em: n.emails.map(x => x.v.toLowerCase()).join("|") };
  }).sort((a, b) => +!/^\p{L}/u.test(a.n) - +!/^\p{L}/u.test(b.n) || coll.compare(a.c.name, b.c.name));   // A–Z, numbers and symbols last (as in the list)
}
// How well a candidate matches the search (0 = not at all): name start > word start > anywhere / alias / email / number.
function hit(x: Cand, qq: string, ql: string, qd: string) {
  if (!qq && !ql) return 1;
  if (qq && x.n.startsWith(qq)) return 4;
  if (qq && x.n.includes(" " + qq)) return 3;
  if (qq && (x.n.includes(qq) || x.aka.includes(qq))) return 2;
  if (ql.length >= 2 && x.em.includes(ql)) return 1;
  if (qd.length >= 3 && x.dg.includes(qd)) return 1;
  return 0;
}
function itemsFor(q: string): It[] {
  if (!M.pool.length) M.pool = pool();
  const qq = fold(q), ql = q.trim().toLowerCase(), qd0 = /^[\d\s()+.\-]+$/.test(q.trim()) ? digits(q) : "", qd = qd0.length === 11 && qd0[0] === "1" ? qd0.slice(1) : qd0;
  const hits = M.pool.map(k => ({ k, s: hit(k, qq, ql, qd) })).filter(x => x.s);
  if (q.trim()) hits.sort((a, b) => b.s - a.s);   // stable: A–Z within the same score
  const dup = hits.filter(x => x.k.rank).sort((a, b) => b.k.rank - a.k.rank || (q.trim() ? b.s - a.s : 0)), rest = hits.filter(x => !x.k.rank);
  const n = (v: number) => v.toLocaleString(), out: It[] = [];
  if (dup.length) { out.push({ h: dup.length === 1 ? "Possible duplicate" : "Possible duplicates" }); for (const x of dup) out.push({ k: x.k }); }
  if (rest.length) { out.push({ h: q.trim() ? (dup.length ? `Other matches · ${n(rest.length)}` : `${n(rest.length)} ${rest.length === 1 ? "match" : "matches"}`) : dup.length ? `Everyone else · ${n(rest.length)}` : `All contacts · ${n(rest.length)}` }); for (const x of rest) out.push({ k: x.k }); }
  return out;
}
// One secondary line: the primary number, else the primary email, else who they are.
const subOf = (c: MC) => numsOf(c).phones[0]?.v || numsOf(c).emails[0]?.v || (c.rel && c.rel !== "Contact" ? c.rel : "") || c.group;
const HDH = () => D!.phone() ? 34 : 32, ROWH = () => D!.phone() ? 64 : 56;
function pickHtml() {
  const k = M.keep!;
  return `<div class="cihead"><div><h2 id="cmT">Merge ${esc(k.name)}</h2><p>Pick the other card for the same person.</p></div><button type="button" class="cicb" data-cmx aria-label="Close">${IC.x}</button></div>
    <label class="ciq cmq">${IC.search}<input id="cmq" type="search" placeholder="Search names, numbers or emails" value="${esc(M.q)}" autocomplete="off" spellcheck="false" enterkeyhint="go"
      role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="cmlist" aria-label="Search contacts to merge with"></label>
    <div class="cilist cmlist" id="cmlist" role="listbox" aria-label="Contacts"><div class="cmvb" id="cmvb"></div></div><p class="cmsr" id="cmsr" aria-live="polite"></p>`;
}
function itemHtml(i: number) {
  const it = M.items[i];
  if ("h" in it) return `<div class="cmhd" role="presentation">${esc(it.h)}</div>`;
  const { c, why } = it.k, on = i === M.ai;
  return `<div class="cmrow${on ? " on" : ""}" role="option" id="cmo-${c.id}" aria-selected="${on}" data-cmpick="${c.id}">${D!.av(c)}<span class="cmrt"><b>${esc(c.name)}</b><small>${esc(subOf(c))}</small></span>${why ? `<span class="cmwhy">${esc(why)}</span>` : ""}</div>`;
}
const firstRow = () => M.items.findIndex(it => "k" in it);
function mountPick() {
  M.vl?.destroy(); M.vl = null; M.items = itemsFor(M.q);
  const l = document.getElementById("cmlist"), b = document.getElementById("cmvb"), sr = document.getElementById("cmsr"); if (!l || !b) return;
  b.innerHTML = ""; b.style.height = "";
  const nRows = M.items.filter(it => "k" in it).length;
  if (sr) sr.textContent = M.q.trim() ? (nRows ? `${nRows} ${nRows === 1 ? "match" : "matches"}` : "No matches") : "";
  M.ai = M.q.trim() ? firstRow() : -1;
  if (!nRows) { b.innerHTML = `<p class="cinone">Nobody matches “${esc(M.q.trim())}”.</p>`; active(-1); return; }
  M.vl = new VList(l, b, { count: M.items.length, height: (i) => "h" in M.items[i] ? HDH() : ROWH(), html: itemHtml, overscan: 400 });
  l.scrollTop = 0; M.vl.paint(); active(M.ai);
}
// The highlighted row (arrows / mouse); the search box keeps focus and points at it with aria-activedescendant.
function active(i: number, reveal = false) {
  M.ai = i; const q = document.getElementById("cmq");
  if (M.vl) for (const [j, el] of M.vl.els) if (el.classList.contains("cmrow")) { const on = j === i; el.classList.toggle("on", on); el.setAttribute("aria-selected", String(on)); }
  const it = M.items[i]; if (q) { if (it && "k" in it) q.setAttribute("aria-activedescendant", `cmo-${it.k.c.id}`); else q.removeAttribute("aria-activedescendant"); }
  if (reveal && M.vl && i >= 0) { if (i === firstRow()) M.vl.sc.scrollTop = 0; else { if ("h" in (M.items[i - 1] || {})) M.vl.scrollTo(i - 1); M.vl.scrollTo(i); } active(i); }
}
function step(d: number) {
  const rows = M.items.map((it, i) => "k" in it ? i : -1).filter(i => i >= 0); if (!rows.length) return;
  const cur = rows.indexOf(M.ai), to = cur < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, cur + d));
  active(rows[to], true);
}
function onMove(e: PointerEvent) {
  if (e.pointerType !== "mouse" || M.step !== "pick") return;
  const r = (e.target as HTMLElement).closest<HTMLElement>(".cmrow"); if (!r) return; const i = +r.dataset.vi!; if (i !== M.ai) active(i);
}
function pickC(c: MC | null | undefined) {
  if (!c) return; M.drop = c; for (const k of Object.keys(pickV)) delete pickV[k]; M.step = "preview"; paint(); M.el?.querySelector<HTMLElement>(".cibox")?.focus({ preventScroll: true });
}
// The combined card, as 1HC will make it (people.js mergePlan): `pick` holds the person's choices where the two disagree.
const pickV: Record<string, string> = {};
const val = (c: MC, k: "name" | "rel" | "group" | "bday" | "addr") => k === "rel" && c.rel === "Contact" ? "" : (c[k] || "");   // "Contact" = no relation typed
function plan(a: MC, b: MC) {
  const choose = (k: "name" | "rel" | "group" | "bday" | "addr") => { const v = pickV[k]; return v && (v === val(a, k) || v === val(b, k)) ? v : (val(a, k) || val(b, k)); };
  const name = choose("name") || a.name, na = numsOf(a), nb = numsOf(b);
  const seen = new Set([name.toLowerCase()]), aka: string[] = [];
  for (const x of [...a.aka, ...b.aka, a.name, b.name]) { const v = String(x).trim(), k = v.toLowerCase(); if (v && !seen.has(k)) { seen.add(k); aka.push(v); } }
  const ft = new Set<string>(), facts = [...a.facts, ...b.facts].filter(f => { const k = fold(f.text); if (ft.has(k)) return false; ft.add(k); return true; });
  return { name, rel: choose("rel"), group: choose("group") || a.group, bday: choose("bday"), addr: choose("addr"), aka: aka.slice(0, 20), facts,
    phones: combine("phone", [...na.phones, ...nb.phones], pickV.phone), emails: combine("email", [...na.emails, ...nb.emails], pickV.email),
    photo: pickV.photo === "drop" && b.photo ? "drop" : a.photo ? "keep" : b.photo ? "drop" : "" };
}
function previewHtml() {
  const a = M.keep!, b = M.drop!, p = plan(a, b);
  const choice = (k: "name" | "rel" | "group" | "bday" | "addr", label: string) => {
    const va = val(a, k), vb = val(b, k);
    if (va && vb && va !== vb) return `<div class="cmf"><span class="cml">${label}</span>${pills(`cm_${k}`, [va, vb], p[k], label, "sm")}</div>`;
    const v = va || vb; return v ? `<div class="cmf"><span class="cml">${label}</span><span class="cmv">${esc(v)}</span></div>` : "";
  };
  const photo = a.photo && b.photo ? `<div class="cmf"><span class="cml">Photo</span>${pills("cm_photo", ["keep", "drop"], p.photo, "Photo", "sm cmph", (o) => D!.av(o === "keep" ? a : b, "cxav lg"))}</div>` : "";
  const list = (kind: "phone" | "email", l: Num[]) => !l.length ? "" : `<div class="cmf"><span class="cml">${kind === "phone" ? "Phone numbers" : "Emails"}</span>${l.length > 1
    ? `${pills(`cm_${kind}`, l.map(x => x.v), l[0].v, kind === "phone" ? "Primary number" : "Primary email", "sm cmnums", (o) => { const x = l.find(y => y.v === o)!; return `<b>${esc(x.v)}</b><small>${esc(x.label)}</small>`; })}<em class="cmhint">Tap the one to use first.</em>`
    : `<span class="cmv">${esc(l[0].v)} <small>${esc(l[0].label)}</small></span>`}</div>`;
  return `<div class="cihead"><div><h2 id="cmT">Merge into one contact</h2><p>${esc(a.name)} + ${esc(b.name)}</p></div><button type="button" class="cicb" data-cmx aria-label="Close"${M.busy ? " disabled" : ""}>${IC.x}</button></div>
    <div class="cmpair">${D!.av(a, "cxav lg")}<span>${IC.merge}</span>${D!.av(b, "cxav lg")}</div>
    <div class="cmgrid">${choice("name", "Name")}${choice("rel", "Who they are")}${choice("group", "Group")}${choice("bday", "Birthday")}${choice("addr", "Address")}${photo}
      ${list("phone", p.phones)}${list("email", p.emails)}
      <div class="cmf"><span class="cml">Also called</span><span class="cmv" id="cmaka">${p.aka.length ? p.aka.map(x => `“${esc(x)}”`).join(", ") : "—"}</span></div>
      <div class="cmf"><span class="cml">What ${esc(D!.helper())} knows</span><span class="cmv">${p.facts.length ? `${p.facts.length} ${p.facts.length === 1 ? "thing" : "things"}, combined` : "Nothing yet"}</span></div></div>
    <p class="cifine">${esc(b.name)}’s card is deleted after the merge. Everything on it moves to the merged contact.</p>
    <div class="cibtns"><button type="button" class="cigo" data-cmgo${M.busy ? " disabled" : ""}>${M.busy ? "Merging…" : "Merge"}</button><button type="button" class="cino" data-cmback${M.busy ? " disabled" : ""}>${IC.back}Pick another</button></div>`;
}
function paint() {
  const b = M.el?.querySelector<HTMLElement>(".cibody"); if (!b) return;
  M.el!.dataset.step = M.step;   // first: the pick step's list height depends on it
  if (M.step === "pick") { b.innerHTML = pickHtml(); mountPick(); } else { M.vl?.destroy(); M.vl = null; b.innerHTML = previewHtml(); }
}
function onClick(e: MouseEvent) {
  e.stopPropagation();
  const t = e.target as HTMLElement;
  if (pillClick(t)) { e.preventDefault(); return; }
  if (t.closest("[data-cmx]")) { close(); return; }
  const pk = t.closest<HTMLElement>("[data-cmpick]"); if (pk) { pickC(D!.list().find(c => c.id === +pk.dataset.cmpick!)); return; }
  if (t.closest("[data-cmback]")) { M.step = "pick"; M.drop = null; paint(); document.getElementById("cmq")?.focus({ preventScroll: true }); return; }
  if (t.closest("[data-cmgo]")) { void go(); return; }
}
function onInput(e: Event) { const t = e.target as HTMLInputElement; if (t.id === "cmq") { M.q = t.value; mountPick(); } }
// A choice changed: remember it (the aliases line follows the name choice).
function onChange(e: Event) {
  const t = e.target as HTMLInputElement, k = t.name?.replace(/^cm_/, ""); if (!k || !t.name.startsWith("cm_")) return;
  pickV[k] = t.value; const a = document.getElementById("cmaka"); if (a && M.keep && M.drop) { const p = plan(M.keep, M.drop); a.textContent = p.aka.length ? p.aka.map(x => `“${x}”`).join(", ") : "—"; }
}
async function go() {
  const a = M.keep, b = M.drop; if (!a || !b || !D || M.busy) return;
  const p = plan(a, b);
  if (!(await ask({ title: `Merge into “${p.name}”?`, body: `${b.name}’s numbers, emails and what ${D.helper()} knows move to one contact, and the other card is deleted. This can't be undone.`, confirm: "Merge" }))) return;
  const pick: Record<string, string> = Object.fromEntries(Object.entries({ name: p.name, rel: p.rel, group: p.group, bday: p.bday, addr: p.addr, photo: p.photo, phone: p.phones[0]?.v, email: p.emails[0]?.v }).filter(([, v]) => v)) as Record<string, string>;
  M.busy = true; paint();
  const ok = await D.merge(a, b, pick).catch(() => false);
  M.busy = false;
  if (!ok) { paint(); const f = M.el?.querySelector(".cibtns"); f?.insertAdjacentHTML("afterend", `<p class="cierr" role="alert">Couldn't merge them. Try again in a minute.</p>`); return; }
  close();
}
// The merged card the sandbox (no 1HC) makes locally, from the same plan.
export function mergeLocal(a: MC, b: MC, pick: Record<string, string>) {
  for (const k of Object.keys(pickV)) delete pickV[k]; Object.assign(pickV, pick);
  const p = plan(a, b);
  Object.assign(a, { name: p.name, rel: p.rel || "Contact", group: p.group, bday: p.bday || undefined, addr: p.addr || undefined, aka: p.aka, phones: p.phones, emails: p.emails, phone: p.phones[0]?.v, email: p.emails[0]?.v,
    facts: p.facts, seen: [...a.seen, ...b.seen], photo: p.photo === "drop" ? b.photo : a.photo });
}
window.addEventListener("keydown", (e) => {
  if (!M.el || document.querySelector(".dlgw")) return;
  e.stopImmediatePropagation(); pillKey(e);
  if (e.key === "Escape") { e.preventDefault(); close(); return; }
  // the picker: arrows move the highlight from the search box, Enter picks it
  if (M.step === "pick" && (e.target as HTMLElement).id === "cmq" && !e.altKey && !e.metaKey && !e.ctrlKey) {
    const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "PageDown" ? 8 : e.key === "PageUp" ? -8 : 0;
    if (d) { e.preventDefault(); step(d); return; }
    if (e.key === "Enter") { e.preventDefault(); const it = M.items[M.ai]; if (it && "k" in it) pickC(it.k.c); return; }
  }
  if (e.key === "Tab") {
    const f = [...M.el.querySelectorAll<HTMLElement>("input:not([disabled]),button:not([disabled])")].filter(x => x.offsetParent !== null && x.tabIndex >= 0);
    if (!f.length) return; const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey ? i <= 0 : i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
  }
}, true);

// ---------- possible duplicates, above the list ----------
// Same number, same email or the same name (1HC finds them; the sandbox finds them here). Shows two, the rest behind "Show all".
let dupOpen = false;
export function dupBanner() {
  const l = D?.dups() || []; if (!l.length) return "";
  const shown = dupOpen ? l : l.slice(0, 2);
  return `<section class="cxdup" aria-label="Possible duplicates"><h3>${l.length === 1 ? "A possible duplicate" : `${l.length} possible duplicates`}</h3>${shown.map(d => `<div class="cxdrow">
      <span class="cxdav">${D!.av(d.a, "cxav sm")}${D!.av(d.b, "cxav sm")}</span><span class="cxmain"><b>${esc(d.a.name)} <i>+</i> ${esc(d.b.name)}</b><small>${esc(d.why)}</small></span>
      <button type="button" class="sa" data-cxdupm="${d.a.id}|${d.b.id}">Merge</button><button type="button" class="cb sm" data-cxdupx="${d.a.id}|${d.b.id}" aria-label="Not the same person" title="Not the same person">${IC.x}</button></div>`).join("")}
    ${l.length > 2 ? `<button type="button" class="cxdmore" data-cxdups aria-expanded="${dupOpen}">${dupOpen ? "Show fewer" : `Show all ${l.length}`}</button>` : ""}</section>`;
}
export function dupClick(t: HTMLElement): boolean {
  const byId = (id: string) => D!.list().find(c => c.id === +id);
  const m = t.closest<HTMLElement>("[data-cxdupm]"); if (m) { const [a, b] = m.dataset.cxdupm!.split("|").map(byId); if (a && b) mergeOpen(a, b); return true; }
  const x = t.closest<HTMLElement>("[data-cxdupx]"); if (x) { const [a, b] = x.dataset.cxdupx!.split("|").map(byId); if (a && b) D!.notDup(a, b); return true; }
  if (t.closest("[data-cxdups]")) { dupOpen = !dupOpen; return true; }
  return false;
}
// The sandbox's own duplicate finder (same rules as 1HC people.js duplicates()).
export function findDups(list: MC[], no: Set<string>): Pair[] {
  const by = new Map<string, { c: MC; why: string }[]>(), out: Pair[] = [], seen = new Set<string>();
  const add = (k: string, c: MC, why: string) => { const l = by.get(k) || []; l.push({ c, why }); by.set(k, l); };
  for (const c of list) { const n = numsOf(c); for (const x of n.phones) add("t" + keyOf("phone", x.v), c, `Same number ${x.v}`); for (const x of n.emails) add("e" + keyOf("email", x.v), c, `Same email ${x.v}`); const f = fold(c.name); if (f.length > 2) add("n" + f, c, "Same name"); }
  for (const [, l] of by) for (let i = 1; i < l.length; i++) { const a = l[0].c, b = l[i].c; if (a === b) continue; const k = [a.id, b.id].sort().join("|"); if (seen.has(k) || no.has(k)) continue; seen.add(k); out.push({ a, b, why: l[i].why }); if (out.length >= 20) return out; }
  return out;
}

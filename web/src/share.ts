// Share links and published pages in the live app (1HC src/share.js + src/publish.js).
//  · Share link: the file viewer's link button and the share button on a chat file card open a sheet: pick an expiry (Never / 7 days /
//    30 days) → Create link → the link with Copy, and Revoke. Files with a link show a "Shared" badge in the Library.
//  · Web pages (.html): the chat file card has Share file and Publish side by side; the sheet (from the card, the file viewer or the
//    Library badge) shows both options as tiles. Publish asks for the web name → Publish → the live link (Copy / Open / Unpublish).
//    Once a file is published (published_pages.source = file:<channel>:<id>, or the same .html name from the helper's computer), its
//    card shows "Published · link" with Copy · Open · Update (republish) · Unpublish, and the Library row a "Published" badge.
//  · The Library lists published pages (Copy, Open, Unpublish) and shared files (Copy, Revoke) at the top.
//  · Cards in the chat: the helper's publish_page / share_file_link only PREPARE; their card ("Publish trip at …?" with Publish /
//    Not now, or Create link / Not now) is the person's tap. Stream event `share_offer`; sessionDetail turns carry `offers`.
// v3.ts only hooks in: shInit() once, shCards()/shEvent() for the cards, shCardHtml() to draw one, shFileBtn() on chat file cards,
// shViewerBtns() in the file viewer header, shBadge() on Library rows, shLibHtml() at the top of the Library, shFileGone() after a delete.
// No native dialogs: our own sheet here, ask() from dialog.ts for Revoke / Unpublish.
import { ask } from "./dialog";

type Link = { id: string; file_id: string; channel: string; name: string; mime: string; bytes: number; created_at: number; expires_at: number | null; url: string };
type Page = { name: string; title: string; url: string; files: number; bytes: number; channel: string | null; source?: string | null; created_at: number; updated_at: number };
export type Offer = { id: string; kind: "page" | "link"; status: "pending" | "accepted" | "declined" | "expired"; name: string | null; title: string | null; url: string | null; base: string;
  update: boolean; file: { id: string; name: string; bytes: number } | null; files: number; bytes: number; channel: string; session: string | null; turn: string | null; result: any; created_at: number };
type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  phone: () => boolean;
  note: (title: string, sub: string) => void;
  repaint: () => void;                 // the chat / Library on screen changed
  helper: (slug: string) => string;
};
let D: Deps | null = null;
const SH: { base: string; links: Link[]; pages: Page[]; loaded: boolean } = { base: "", links: [], pages: [], loaded: false };
const OF = new Map<string, Offer>();
const OV = new Map<string, { name?: string; exp?: string; busy?: string; err?: string; sugg?: string; fresh?: boolean }>();
const EXP: [string, string][] = [["never", "Never"], ["7d", "7 days"], ["30d", "30 days"]];

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const I = (d: string, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  open: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  up: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>',
};
const short = (u: string) => u.replace(/^https?:\/\//, "");
const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const expLine = (l: { expires_at: number | null }) => l.expires_at ? `Expires ${when(l.expires_at)}` : "Never expires";
const isHtml = (name: string, mime = "") => /\.html?$/i.test(name) || /text\/html/i.test(mime);
const pageName = (s: string) => { let n = String(s || "").replace(/\.(html?)$/i, "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, ""); return n.length < 2 ? (n ? `page-${n}` : "page") : n; };
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function shInit(d: Deps) { D = d; shLoad(); }
export async function shLoad() {
  if (!D) return;
  try { const r = await D.api("/share"); if (r && !r.error) { SH.base = r.base || SH.base; SH.links = r.links || []; SH.pages = r.pages || []; SH.loaded = true; D.repaint(); } } catch {}
}
export const shLinkOf = (fid: string) => SH.links.find((l) => l.file_id === fid);
/** The published page made from this Library file: published from it (file:<ch>:<id>), from an earlier copy with the same name,
 *  or by the helper from a single .html of that name on its computer (path:<ch>:…/<name>). A folder site never matches a file. */
export function shPageOf(slug: string, fid: string, name = "") {
  const nm = name.toLowerCase();
  return SH.pages.find((p) => { const src = p.source || "";
    if (src === `file:${slug}:${fid}`) return true;
    const m = src.match(/^(file|path):([^:]+):(.+)$/); if (!m || m[2] !== slug || !nm) return false;
    if (m[1] === "path") return /\.html?$/i.test(m[3]) && m[3].split("/").pop()!.toLowerCase() === nm;
    return (fileInfo(slug, m[3])?.name || "").toLowerCase() === nm; });
}
export function shFileGone(fid: string) { const n = SH.links.length; SH.links = SH.links.filter((l) => l.file_id !== fid); if (n !== SH.links.length) D?.repaint(); }

async function copy(text: string, what = "Link copied") {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;opacity:0;top:0;left:0"; document.body.appendChild(t); t.select();
    try { ok = document.execCommand("copy"); } catch {} t.remove();
  }
  D?.note(ok ? what : "Couldn't copy", ok ? short(text) : "Select the link and copy it yourself.");
}

// ---------- small bits for v3.ts ----------
const fattr = (name: string, mime = "") => ` data-shn="${esc(name)}" data-shm="${esc(mime)}"`;
const CB = new Map<string, string>();   // a chat file card's Update / Unpublish in flight (by file id)
/** The share button on a chat file card (next to Download). A web page (.html) gets a row instead: Share file and Publish side by
 *  side, or, once published, the live link with Copy · Open · Update · Unpublish (and Share file as an icon). */
export function shFileBtn(slug: string, fid: string, name: string, mime = "") {
  const sk = `${esc(slug)}|${esc(fid)}`, fa = fattr(name, mime), link = shLinkOf(fid);
  if (!isHtml(name, mime)) return `<span class="fsh${link ? " on" : ""}" role="button" tabindex="0" data-sh="share|${sk}"${fa} aria-label="Share link for ${esc(name)}" title="Share link">${I(IC.link, 16)}</span>`;
  const p = shPageOf(slug, fid, name), busy = CB.get(fid) || "", bt = (act: string, label: string, icon: string, cls = "", lab = label) =>
    `<span class="fcwb${cls}${busy ? " dis" : ""}" role="button" tabindex="0" data-sh="${act}"${fa} aria-label="${esc(lab)}"${busy ? ' aria-disabled="true"' : ""}>${I(icon, 14)}<span>${label}</span></span>`;
  if (!p) return `<span class="fcweb">${bt(`share|${sk}`, "Share file", IC.link, link ? " on" : "", `Share file: ${name}`)}${bt(`pub|${sk}`, "Publish", IC.globe, "", `Publish ${name} as a web page`)}</span>`;
  return `<span class="fcweb pubd"><span class="fcpl"><span class="fcdot">${I(IC.globe, 14)}</span><b>Published</b><span class="fcurl" role="button" tabindex="0" data-sh="open|${esc(p.url)}" title="${esc(p.url)}">${esc(short(p.url))}</span>${bt(`share|${sk}`, "", IC.link, ` ico${link ? " on" : ""}`, `Share file: ${name}`)}</span>
    <span class="fcacts">${bt(`copy|${esc(p.url)}`, "Copy", IC.copy, "", "Copy the page link")}${bt(`open|${esc(p.url)}`, "Open", IC.open, "", "Open the live page")}${bt(`cupd|${sk}|${esc(p.name)}`, busy === "upd" ? "Updating…" : "Update", IC.up, "", "Update: republish this file")}${bt(`unpub|${esc(p.name)}|${esc(fid)}`, busy === "unpub" ? "Unpublishing…" : "Unpublish", IC.x, " bad")}</span></span>`;
}
/** File viewer header: Share link (every file) and Publish (web pages). */
export const shViewerBtns = (slug: string, fid: string, name: string, mime: string) => { const web = isHtml(name, mime), pd = web && shPageOf(slug, fid, name), fa = fattr(name, mime);
  return `${web ? `<button class="fvb${pd ? " pubon" : ""}" data-sh="pub|${esc(slug)}|${esc(fid)}"${fa} aria-label="${pd ? "Published: open, update or unpublish" : "Publish this page"}" title="${pd ? "Published" : "Publish"}">${I(IC.globe, 18)}</button>` : ""}<button class="fvb${shLinkOf(fid) ? " shon" : ""}" data-sh="share|${esc(slug)}|${esc(fid)}"${fa} aria-label="${web ? "Share file" : "Share link"}" title="${web ? "Share file" : "Share link"}">${I(IC.link, 18)}</button>`; };
/** "Shared" on a Library row / card: tap it to see or copy the link. */
export const shBadge = (slug: string, fid?: string, name = "") => !fid ? "" : (shLinkOf(fid) ? ` <span class="shbadge" role="button" tabindex="0" data-sh="share|${esc(slug)}|${esc(fid)}"${fattr(name)} title="Anyone with the link can open it">${I(IC.link, 11)}Shared</span>` : "")
  + (name && isHtml(name) && shPageOf(slug, fid, name) ? ` <span class="shbadge pub" role="button" tabindex="0" data-sh="pub|${esc(slug)}|${esc(fid)}"${fattr(name)} title="A live web page at your address">${I(IC.globe, 11)}Published</span>` : "");

/** Top of the Library: published pages, then shared files (one channel, or every channel). */
export function shLibHtml(slug: string | null) {
  const pages = SH.pages.filter((p) => !slug || p.channel === slug), links = SH.links.filter((l) => !slug || l.channel === slug);
  if (!pages.length && !links.length) return "";
  const row = (icon: string, title: string, sub: string, url: string, actions: string) => `<div class="shrow"><span class="shico">${I(icon, 18)}</span><span class="shmain"><b>${esc(title)}</b><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(short(url))}</a>${sub ? `<span>${esc(sub)}</span>` : ""}</span>
    <span class="shacts"><button class="shbtn" data-sh="copy|${esc(url)}" aria-label="Copy link" title="Copy link">${I(IC.copy, 16)}</button><a class="shbtn" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open" title="Open">${I(IC.open, 16)}</a>${actions}</span></div>`;
  return `<section class="shlib">${pages.length ? `<h3>Published pages <span>${pages.length}</span></h3>${pages.map((p) => row(IC.globe, p.title, `Updated ${when(p.updated_at)}`, p.url, `<button class="shbtn bad" data-sh="unpub|${esc(p.name)}" aria-label="Unpublish ${esc(p.title)}" title="Unpublish">${I(IC.x, 16)}</button>`)).join("")}` : ""}
    ${links.length ? `<h3>Shared files <span>${links.length}</span></h3>${links.map((l) => row(IC.link, l.name, expLine(l), l.url, `<button class="shbtn bad" data-sh="revoke|${esc(l.id)}" aria-label="Revoke the link to ${esc(l.name)}" title="Revoke link">${I(IC.x, 16)}</button>`)).join("")}` : ""}</section>`;
}

// ---------- cards in the chat ----------
type Card = { t: "share"; id: string };
/** sessionDetail turn.offers → cards for that reply. */
export function shCards(offers: Offer[] | undefined): Card[] { return (offers || []).map((o) => { OF.set(o.id, o); return { t: "share", id: o.id } as Card; }); }
/** Stream event share_offer → a card on this reply. */
export function shEvent(reply: any, o: Offer) {
  OF.set(o.id, o); OV.set(o.id, { ...(OV.get(o.id) || {}), fresh: true });
  if (!(reply.cards ??= []).some((c: any) => c.t === "share" && c.id === o.id)) reply.cards.push({ t: "share", id: o.id });
}
export function shCardHtml(c: Card, attrs = "") {
  const o = OF.get(c.id); if (!o) return "";
  const v = OV.get(o.id) || {}, k = esc(o.id), page = o.kind === "page", fr = v.fresh ? " gu-in" : ""; v.fresh = false;
  const head = (icon: string, title: string) => `<div class="gu-sh"><span class="gu-si">${I(icon, 17)}</span><b>${title}</b></div>`;
  const wrap = (inner: string, cls = "") => `<div class="acard gu-sys shcard${cls}${fr}"${attrs} data-shcard="${k}">${inner}</div>`;
  // share_file_link for a web page: the card offers Publish too (the sheet asks for the name).
  const webLink = !page && !!o.file && isHtml(o.file.name), pubBtn = webLink ? (() => { const pd = shPageOf(o.channel, o.file!.id, o.file!.name);
    return `<button class="gu-b secondary" data-sh="pub|${esc(o.channel)}|${esc(o.file!.id)}"${fattr(o.file!.name)}>${I(IC.globe, 15)} ${pd ? "Published" : "Publish"}</button>`; })() : "";
  if (o.status === "accepted") {
    const url = o.result?.url || o.url || "", pname = o.result?.name || o.name || "";
    if (page && SH.loaded && !SH.pages.some((p) => p.name === pname))
      return wrap(`${head(IC.globe, `Unpublished “${esc(o.title || o.name)}”`)}<p class="gu-sl">That link doesn't work anymore.</p>`, " shno");
    return wrap(`${head(page ? IC.globe : IC.link, page ? (o.result?.updated ? `Updated “${esc(o.title || o.name)}”` : `Published “${esc(o.title || o.name)}”`) : `Link ready for “${esc(o.file?.name)}”`)}
      <p class="gu-sl shurl"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(short(url))}</a></p>
      ${!page && o.result?.expires_at ? `<p class="gu-sl">${esc(expLine(o.result))}</p>` : ""}
      <div class="gu-btns"><button class="gu-b secondary" data-sh="copy|${esc(url)}">${I(IC.copy, 15)} Copy link</button><a class="gu-b ghost shopen" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${I(IC.open, 15)} Open</a>${page ? `<button class="gu-b ghost shunp" data-sh="unpub|${esc(pname)}">${I(IC.x, 15)} Unpublish</button>` : pubBtn}</div>`, " shok");
  }
  if (o.status === "declined" || o.status === "expired")
    return wrap(`${head(page ? IC.globe : IC.link, page ? `Not published: “${esc(o.title || o.name)}”` : `No link for “${esc(o.file?.name)}”`)}<p class="gu-sl">${o.status === "expired" ? "This expired. Ask again and it will be prepared fresh." : "Nothing was shared."}</p>`, " shno");
  const busy = !!v.busy, dis = busy ? " disabled" : "";
  if (page) {
    const name = v.name ?? o.name ?? "";
    return wrap(`${head(IC.globe, `${o.update ? "Update" : "Publish"} “${esc(o.title || o.name)}” at your address?`)}
      <p class="gu-sl">Anyone with the link can open it. Search engines are asked not to list it.${o.files > 1 ? ` ${o.files} files.` : ""}</p>
      <label class="shname"><span class="shpre">${esc(short(o.base))}</span><input data-shname="${k}" value="${esc(name)}" maxlength="40" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Web name"${dis}><span class="shpre">/</span></label>
      ${v.err ? `<p class="gu-perr">${esc(v.err)}</p>` : ""}
      <div class="gu-btns"><button class="gu-b primary" data-sh="acc|${k}"${dis}>${v.busy === "acc" ? '<span class="gu-bspin"></span>Publishing' : o.update && name === o.name ? "Update" : "Publish"}</button>${v.sugg ? `<button class="gu-b secondary" data-sh="repl|${k}"${dis}>Replace mine</button>` : ""}<button class="gu-b ghost" data-sh="dec|${k}"${dis}>Not now</button></div>`);
  }
  const exp = v.exp || "never";
  return wrap(`${head(IC.link, `Make a public link for “${esc(o.file?.name)}”?`)}
    <p class="gu-sl">Anyone with the link can view and download it, no sign-in. You can turn it off any time.</p>
    <div class="shexp" role="radiogroup" aria-label="Link expires"><span>Expires</span>${EXP.map(([x, l]) => `<button role="radio" aria-checked="${x === exp}" class="${x === exp ? "on" : ""}" data-sh="exp|${k}|${x}"${dis}>${l}</button>`).join("")}</div>
    ${v.err ? `<p class="gu-perr">${esc(v.err)}</p>` : ""}
    <div class="gu-btns"><button class="gu-b primary" data-sh="acc|${k}"${dis}>${v.busy === "acc" ? '<span class="gu-bspin"></span>Creating' : "Create link"}</button>${pubBtn}<button class="gu-b ghost" data-sh="dec|${k}"${dis}>Not now</button></div>`);
}
async function offerAct(id: string, act: "acc" | "dec" | "repl") {
  const o = OF.get(id); if (!o || !D) return; const v = OV.get(id) || {}; OV.set(id, v);
  if (act !== "dec" && o.kind === "page") { const n = (v.name ?? o.name ?? "").trim().toLowerCase(); if (!NAME_RE.test(n)) { v.err = "Use letters, numbers and dashes for the name (up to 40)."; D.repaint(); return; } v.name = n; }
  if (act === "repl" && !(await ask({ title: `Replace “${v.name}”?`, body: "Your page at that address is replaced by this one.", confirm: "Replace" }))) return;
  v.busy = act; v.err = ""; D.repaint();
  const r = await D.api(`/share/offers/${id}/${act === "dec" ? "decline" : "accept"}`, act === "dec" ? {} : o.kind === "page" ? { name: v.name, ...(act === "repl" ? { replace: true } : {}) } : { expires: v.exp || "never" }).catch((e: any) => ({ error: e.message }));
  v.busy = "";
  if (r.error) { v.err = r.error === "payment_required" ? "Your plan needs attention first." : r.error; if (r.taken) { v.sugg = r.suggestion || ""; v.err += r.suggestion ? ` Try “${r.suggestion}”, or replace yours.` : ""; } D.repaint(); return; }
  v.sugg = ""; OF.set(id, r.offer);
  if (act !== "dec") { shLoad(); D.note(o.kind === "page" ? "Published" : "Link ready", short(r.offer.result?.url || "")); }
  D.repaint();
}

// ---------- the sheet (share a file / publish a page) ----------
// A web page (.html) shows both options as tiles at the top, Share file and Publish, and the chosen one's panel below.
type Sheet = { kind: "share" | "pub"; web: boolean; slug: string; fid: string; name: string; mime: string; exp: string; busy: string; err: string; msg: string; pname: string; sugg: string; done: Page | null; prev: HTMLElement | null };
let SHT: Sheet | null = null;
type FileInfo = { name: string; mime: string };
let fileInfo: (slug: string, fid: string) => FileInfo | null = () => null;
export function shFiles(f: (slug: string, fid: string) => FileInfo | null) { fileInfo = f; }
function sheetOpen(kind: Sheet["kind"], slug: string, fid: string, fb?: FileInfo) {
  const f = fileInfo(slug, fid) || (fb?.name ? fb : null); if (!f) return;
  SHT = { kind, web: isHtml(f.name, f.mime), slug, fid, name: f.name, mime: f.mime, exp: "never", busy: "", err: "", msg: "", pname: pageName(f.name), sugg: "", done: null, prev: document.activeElement instanceof HTMLElement ? document.activeElement : null };
  let w = document.getElementById("shw");
  if (!w) { w = document.createElement("div"); w.id = "shw"; w.className = "shw"; document.body.appendChild(w); }
  sheetPaint(); void w.offsetWidth; w.classList.add("on");
  requestAnimationFrame(() => (w!.querySelector<HTMLElement>("[data-shfocus]") || w!.querySelector<HTMLElement>(".dlgb"))?.focus({ preventScroll: true }));
}
function sheetClose() {
  const w = document.getElementById("shw"); const prev = SHT?.prev; SHT = null; if (!w) return;
  w.classList.remove("on"); setTimeout(() => { if (!SHT) w.remove(); }, 260);
  if (prev?.isConnected) prev.focus({ preventScroll: true });
}
function sheetPaint() {
  const w = document.getElementById("shw"); if (!w || !SHT) return; const s = SHT, dis = s.busy ? " disabled" : "";
  const l = shLinkOf(s.fid), pg = s.web ? s.done || shPageOf(s.slug, s.fid, s.name) || null : null;
  const tile = (k: Sheet["kind"], icon: string, title: string, sub: string, on: boolean) => `<button role="radio" aria-checked="${s.kind === k}" class="shopt${s.kind === k ? " sel" : ""}" data-sh="skind|${k}"${dis}>
    <span class="shoi">${I(icon, 20)}</span><b>${title}</b><span class="${on ? "shst" : ""}">${sub}</span></button>`;
  const tiles = s.web ? `<div class="shpick" role="radiogroup" aria-label="Share or publish">${tile("share", IC.link, "Share file", l ? "Link is on" : "A link to view or download a copy", !!l)}${tile("pub", IC.globe, "Publish", pg ? "Published" : "A live web page at your address", !!pg)}</div>` : "";
  let body = "";
  if (s.kind === "share") {
    body = l ? `<h2 id="shwt">Share “${esc(s.name)}”</h2>${tiles}<p>Anyone with the link can view and download it. No sign-in needed.</p>
      <div class="shfield"><input readonly value="${esc(l.url)}" aria-label="Share link" data-shsel><button class="dlgb ok" data-sh="copy|${esc(l.url)}" data-shfocus>${I(IC.copy, 15)} Copy</button></div>
      <p class="shmeta">${esc(expLine(l))}</p>
      <div class="dlgbtns shsplit"><button class="dlgb shrev" data-sh="revoke|${esc(l.id)}"${dis}>Revoke link</button><button class="dlgb no" data-shx>Done</button></div>`
      : `<h2 id="shwt">Share “${esc(s.name)}”</h2>${tiles}<p>Make a link anyone can use to view and download ${s.web ? "a copy of this file" : "this file"}, no sign-in needed. You can turn it off any time.</p>
      <div class="shexp" role="radiogroup" aria-label="Link expires"><span>Expires</span>${EXP.map(([x, lb]) => `<button role="radio" aria-checked="${x === s.exp}" class="${x === s.exp ? "on" : ""}" data-sh="sexp|${x}"${dis}>${lb}</button>`).join("")}</div>
      ${s.err ? `<p class="sherr">${esc(s.err)}</p>` : ""}
      <div class="dlgbtns"><button class="dlgb no" data-shx>Cancel</button><button class="dlgb ok" data-sh="mklink" data-shfocus${dis}>${s.busy === "link" ? "Creating…" : "Create link"}</button></div>`;
  } else if (pg) {
    // Published: the live link (Copy / Open), Unpublish, and Update (republish this file) unless it was published just now.
    body = `<h2 id="shwt">${s.done ? "Published" : `Share “${esc(s.name)}”`}</h2>${tiles}<p>${s.done ? `“${esc(pg.title)}” is live.` : `Published as “${esc(pg.name)}”.`} Anyone with the link can open it.</p>
      <div class="shfield"><input readonly value="${esc(pg.url)}" aria-label="Page address" data-shsel><button class="dlgb ok" data-sh="copy|${esc(pg.url)}" data-shfocus>${I(IC.copy, 15)} Copy</button><a class="dlgb no shopen" href="${esc(pg.url)}" target="_blank" rel="noopener noreferrer">${I(IC.open, 15)} Open</a></div>
      ${s.msg ? `<p class="shmeta">${esc(s.msg)}</p>` : `<p class="shmeta">Updated ${esc(when(pg.updated_at))}</p>`}${s.err ? `<p class="sherr">${esc(s.err)}</p>` : ""}
      <div class="dlgbtns shsplit"><button class="dlgb shrev" data-sh="sunpub|${esc(pg.name)}"${dis}>${s.busy === "unpub" ? "Unpublishing…" : "Unpublish"}</button><span class="shgrp">${s.done ? "" : `<button class="dlgb no" data-sh="supd|${esc(pg.name)}"${dis}>${s.busy === "upd" ? "Updating…" : "Update"}</button>`}<button class="dlgb no" data-shx>Done</button></span></div>`;
  } else {
    body = `<h2 id="shwt">${s.web ? `Share “${esc(s.name)}”` : `Publish “${esc(s.name)}”`}</h2>${tiles}<p>Put this page on your own address. Anyone with the link can open it; search engines are asked not to list it.</p>
      <label class="shname big"><span class="shpre">${esc(short(SH.base || ""))}/p/</span><input data-shpname value="${esc(s.pname)}" maxlength="40" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Web name" data-shfocus${dis}><span class="shpre">/</span></label>
      ${s.msg ? `<p class="shmeta">${esc(s.msg)}</p>` : ""}${s.err ? `<p class="sherr">${esc(s.err)}</p>` : ""}
      <div class="dlgbtns">${s.sugg ? `<button class="dlgb no" data-sh="spub|1"${dis}>Replace mine</button>` : `<button class="dlgb no" data-shx>Cancel</button>`}<button class="dlgb ok" data-sh="spub|0"${dis}>${s.busy === "pub" ? "Publishing…" : "Publish"}</button></div>`;
  }
  w.innerHTML = `<div class="dlgback" data-shx></div><div class="dlg shdlg" role="dialog" aria-modal="true" aria-labelledby="shwt" tabindex="-1"><span class="dlggrab" aria-hidden="true"></span>${body}</div>`;
}
async function mkLink() {
  const s = SHT; if (!s || !D || s.busy) return; s.busy = "link"; s.err = ""; sheetPaint();
  const r = await D.api("/share/links", { channel: s.slug, file: s.fid, expires: s.exp }).catch((e: any) => ({ error: e.message }));
  if (SHT !== s) return; s.busy = "";
  if (r.error) { s.err = r.error === "payment_required" ? "Your plan needs attention first." : r.error; sheetPaint(); return; }
  if (!SH.links.some((l) => l.id === r.link.id)) SH.links.unshift(r.link);
  sheetPaint(); D.repaint(); copy(r.link.url, "Link made and copied");
}
async function revoke(id: string) {
  const l = SH.links.find((x) => x.id === id); if (!l || !D) return;
  if (!(await ask({ title: "Turn off this link?", body: `Anyone who has it won't be able to open “${l.name}” anymore. You can make a new link later.`, confirm: "Revoke", danger: true }))) return;
  const r = await D.api(`/share/links/${id}/revoke`, {}).catch((e: any) => ({ error: e.message }));
  if (r.error && !/No such link/.test(r.error)) { D.note("Couldn't revoke it", r.error); return; }
  SH.links = SH.links.filter((x) => x.id !== id); if (SHT) sheetPaint(); D.repaint(); D.note("Link turned off", l.name);
}
async function unpub(name: string, fid = "") {
  const p = SH.pages.find((x) => x.name === name) || (SHT?.done?.name === name ? SHT.done : null); if (!p || !D) return;
  if (!(await ask({ title: `Unpublish “${p.title}”?`, body: `${short(p.url)} stops working right away. The file stays in your Library.`, confirm: "Unpublish", danger: true }))) return;
  const s = SHT; if (s) { s.busy = "unpub"; s.err = ""; sheetPaint(); } if (fid) { CB.set(fid, "unpub"); D.repaint(); }
  const r = await D.api(`/share/pages/${encodeURIComponent(name)}/unpublish`, {}).catch((e: any) => ({ error: e.message }));
  if (fid) CB.delete(fid); if (s) s.busy = "";
  if (r.error && !/No such page/.test(r.error)) { if (s && SHT === s) { s.err = r.error; sheetPaint(); } else D.note("Couldn't unpublish it", r.error); D.repaint(); return; }
  SH.pages = SH.pages.filter((x) => x.name !== name);
  if (s && SHT === s) { s.done = null; s.sugg = ""; s.pname = name; s.msg = "Unpublished. That link doesn't work anymore."; sheetPaint(); }
  D.repaint(); D.note("Unpublished", p.title);
}
// Publish (or, with replace, update the page of that name) from a Library file. Shared by the sheet and the chat card's Update.
const pubCall = (slug: string, fid: string, name: string, replace: boolean) => D!.api("/share/pages", { channel: slug, file: fid, name, ...(replace ? { replace: true } : {}) }).catch((e: any) => ({ error: e.message }));
const gotPage = (pg: Page) => { SH.pages = [pg, ...SH.pages.filter((p) => p.name !== pg.name)]; };
async function sheetPublish(replace: boolean) {
  const s = SHT; if (!s || !D || s.busy) return;
  const n = s.pname.trim().toLowerCase(); if (!NAME_RE.test(n)) { s.err = "Use letters, numbers and dashes for the name (up to 40)."; sheetPaint(); return; }
  if (replace && !(await ask({ title: `Replace “${n}”?`, body: "Your page at that address is replaced by this one.", confirm: "Replace" }))) return;
  s.pname = n; s.busy = "pub"; s.err = ""; s.msg = ""; sheetPaint();
  const r = await pubCall(s.slug, s.fid, n, replace);
  if (SHT !== s) return; s.busy = "";
  if (r.error) { s.err = r.error === "payment_required" ? "Your plan needs attention first." : r.error; if (r.taken) { s.sugg = r.suggestion || ""; if (r.suggestion) { s.err += ` Try “${r.suggestion}”, or replace yours.`; s.pname = r.suggestion; } } sheetPaint(); return; }
  s.done = r.page; s.sugg = ""; gotPage(r.page); sheetPaint(); D.repaint();
}
// Update (republish): the page gets this file's current bytes, at the same address.
async function republish(slug: string, fid: string, name: string) {
  if (!D) return; const s = SHT && SHT.fid === fid ? SHT : null;
  if (s) { if (s.busy) return; s.busy = "upd"; s.err = ""; s.msg = ""; sheetPaint(); } else { if (CB.get(fid)) return; CB.set(fid, "upd"); D.repaint(); }
  const r = await pubCall(slug, fid, name, true);
  CB.delete(fid); if (s) s.busy = "";
  if (r.error) { const m = r.error === "payment_required" ? "Your plan needs attention first." : r.error; if (s && SHT === s) { s.err = m; sheetPaint(); } else D.note("Couldn't update it", m); D.repaint(); return; }
  gotPage(r.page); if (s && SHT === s) { s.msg = "Updated just now. The live page shows this file."; sheetPaint(); }
  D.repaint(); D.note("Page updated", short(r.page.url));
}

// ---------- events (window capture: runs before the app's document handlers, so a button inside a row never opens the row) ----------
window.addEventListener("click", (e) => {
  const t = e.target as HTMLElement; if (!D || !t?.closest) return;
  if (SHT && t.closest("[data-shx]")) { e.preventDefault(); e.stopPropagation(); sheetClose(); return; }
  if (t.closest("[data-shsel]")) { (t as HTMLInputElement).select?.(); return; }
  const b = t.closest<HTMLElement>("[data-sh]");
  if (!b) { if ((SHT && t.closest("#shw")) || t.closest(".fcweb")) { e.stopPropagation(); if (!SHT) e.preventDefault(); } return; }   // the web card's row never opens the file
  e.preventDefault(); e.stopPropagation();
  if ((b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true") return;
  const [a, x, y, z] = b.dataset.sh!.split("|"), fb = b.dataset.shn ? { name: b.dataset.shn, mime: b.dataset.shm || "" } : undefined;
  if (a === "share") sheetOpen("share", x, y, fb);
  else if (a === "pub") sheetOpen("pub", x, y, fb);
  else if (a === "skind" && SHT) { SHT.kind = x as Sheet["kind"]; SHT.err = ""; SHT.msg = ""; sheetPaint(); document.querySelector<HTMLElement>("#shw .shopt.sel")?.focus({ preventScroll: true }); }
  else if (a === "copy") copy(b.dataset.sh!.slice(5));
  else if (a === "open") window.open(b.dataset.sh!.slice(5), "_blank", "noopener,noreferrer");
  else if (a === "revoke") revoke(x);
  else if (a === "unpub") unpub(x, y || "");
  else if (a === "sunpub") unpub(x);
  else if (a === "supd" && SHT) republish(SHT.slug, SHT.fid, x);
  else if (a === "cupd") republish(x, y, z);
  else if (a === "mklink") mkLink();
  else if (a === "sexp" && SHT) { SHT.exp = x; sheetPaint(); }
  else if (a === "spub") sheetPublish(x === "1");
  else if (a === "acc" || a === "dec" || a === "repl") offerAct(x, a);
  else if (a === "exp") { const v = OV.get(x) || {}; v.exp = y; OV.set(x, v); D.repaint(); }
}, true);
window.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset?.shname) { const v = OV.get(t.dataset.shname) || {}; v.name = t.value; v.err = ""; OV.set(t.dataset.shname, v); }
  else if (t.dataset?.shpname !== undefined && SHT) { SHT.pname = t.value; }
}, true);
window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  // role="button" spans (chat card share, the Shared badge) work from the keyboard
  if ((e.key === "Enter" || e.key === " ") && t?.matches?.("span[data-sh]")) { e.preventDefault(); e.stopPropagation(); t.click(); return; }
  if (t?.dataset?.shname && e.key === "Enter") { e.preventDefault(); offerAct(t.dataset.shname, "acc"); return; }
  if (!SHT) return;
  if (document.querySelector(".dlgw:not(.off)")) return;   // ask() on top handles its own keys
  e.stopImmediatePropagation();
  if (e.key === "Escape") { e.preventDefault(); sheetClose(); return; }
  if (e.key === "Enter" && t?.dataset?.shpname !== undefined) { e.preventDefault(); sheetPublish(false); return; }
  if (e.key === "Tab") {
    const f = [...document.querySelectorAll<HTMLElement>("#shw .shdlg button:not([disabled]), #shw .shdlg input, #shw .shdlg a[href]")]; if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
}, true);

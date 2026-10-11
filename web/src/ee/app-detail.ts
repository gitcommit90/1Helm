// One app's page, App Store style: big logo, name, categories, the FULL description, Connect, what the helper can do with it,
// how it connects, website. Opens from any app row (Apps popup, its search, Settings → Connected accounts). On desktop it sits
// over the surface it came from (same size and place, with a back button); on a phone it's full screen.
// Data: GET <api>/apps/<slug> (Composio's catalog, cached on the server, + this workspace's connection). Connecting and
// disconnecting go through the app's existing flow (deps.connect / POST /apps/disconnect + deps.setAccounts).
import { appPageDiag } from "../clientlog";   // dev-only diagnostic (removable)
import { ask, dialogOpen } from "../dialog";   // before this module's own Esc listener below, so the dialog's Esc wins
import { matches } from "../shortcuts";   // the Apps shortcut can be rebound
import { logoOver, workDomain, appLogo } from "../logo";
import { acctNoteHtml, onAcctNote, acctNoteReset, acctNoteAfter } from "./acct-note";   // "Add a note for <helper>" under each account
export type AppListInfo = { n: string; d: string; c: string[]; o?: number; x?: number; b?: number };
export type AppDetailDeps = {
  api: string | null;                                   // live API base; null in the design sandbox
  helper: () => string;                                 // "Ollie"
  info: (slug: string) => AppListInfo | undefined;      // the row's data from integrations.json, if loaded
  connected: (slug: string) => boolean;                 // the app's own connected-apps store
  busy: () => boolean;                                  // a sign-in is opening
  connect: (slug: string, name: string, another?: boolean) => void;        // existing connect flow (another: Add another account)
  setAccounts: (accounts: any[]) => void;               // existing connected-apps store
  manage: () => void;                                   // Settings → Connected accounts
  computerConnections?: () => void;                     // native SSH/Tailscale enrollment, separate from app API credentials
  note: (title: string, sub: string) => void;
  draft?: (slug: string) => string;                     // opened from a Connect card (or a texted offer's link) with a draft: its HTML
};
type Tool = { name: string; does: string; reads: boolean; key: boolean };
type Account = { id: string; email: string; label: string; default: boolean; since: string; status: string; memo: string };   // memo: their note for the helper
type Detail = {
  slug: string; name: string; logo: string; description: string; categories: string[];
  website: { url: string; label: string } | null; help: { url: string; label: string } | null;
  // byok: an AI model provider (Gemini, OpenAI…) that needs the person's OWN key from that provider, who bills them directly.
  connect: { kind: "oauth" | "key" | "none" | "unavailable"; text: string; provider?: string; fields?: { label: string; help: string }[]; byok?: { provider: string; payer: string; url: string | null; text: string } };
  auth: { kind: string; text: string }[];
  tools: { count: number; items: Tool[] } | null; triggers: { count: number; items: { name: string; does: string }[] } | null;
  updated: string | null;
  // Several accounts per app (oldest first): each has a label (email/username, else "Account 2") and one is the default.
  connection: { status: "connected" | "expired" | "none" | "unknown"; accounts: Account[] };
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const svg = (d: string, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  back: svg('<path d="m15 18-6-6 6-6"/>', 22), plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>', 16), check: svg('<path d="M20 6 9 17l-5-5"/>', 15), ext: svg('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>', 14),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 16), eye: svg('<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>', 15),
  pen: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 15), star: svg('<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7Z"/>', 15),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 17), key: svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>', 17),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>', 17), globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', 17),
  bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', 17), help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>', 17),
};

let D: AppDetailDeps | null = null;
const ST = { open: false, opened: 0, slug: "", name: "", data: null as Detail | null, err: "", gen: 0, q: "", more: {} as Record<string, boolean>, descMore: false, busy: false, disc: "", from: "" };
const CACHE = new Map<string, { at: number; d: Detail }>();
let busyT = 0;
const GROUP_FIRST = 6, FLAT_MAX = 10, SEARCH_MAX = 80, LOAD_TIMEOUT = 20e3;
// Is the page on screen? The DOM decides, not ST.open alone: if the two ever disagree, Back and Esc must still close what the
// person sees (the Captain once got a page he couldn't leave).
const shown = () => ST.open || !!document.querySelector("#appdw.on");

function host(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#appw.on .apmodal") || document.querySelector<HTMLElement>("#setw.on .smodal");
}
const isPhone = () => matchMedia("(max-width: 767px)").matches;
function place() {
  const w = document.getElementById("appdw"), p = w?.querySelector<HTMLElement>(".apdpanel"); if (!w || !p) return;
  const h = host();
  if (isPhone() || !h) { p.style.cssText = ""; p.classList.remove("over"); w.classList.toggle("float", !isPhone() && !h); return; }
  const r = h.getBoundingClientRect(), cs = getComputedStyle(h);
  w.classList.remove("float"); p.classList.add("over");
  p.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border-radius:${cs.borderRadius}`;
}

export function openAppDetail(slug: string, opts: { name?: string } = {}) {
  if (!D) return;
  slug = String(slug || "").toLowerCase().replace(/[^a-z0-9_]/g, ""); if (!slug) return;
  const h = host();
  ST.open = true; ST.slug = slug; ST.q = ""; ST.more = {}; ST.descMore = false; ST.busy = false; ST.disc = ""; ST.err = ""; acctNoteReset();
  ST.from = h?.classList.contains("smodal") ? "Connected accounts" : h ? "Apps" : "";
  ST.name = opts.name || D.info(slug)?.n || slug;
  appPageDiag(slug, ST.from, D.api);
  const c = CACHE.get(slug); ST.data = c && Date.now() - c.at < 120e3 ? c.d : null;
  let w = document.getElementById("appdw"); if (!w) { w = document.createElement("div"); w.id = "appdw"; document.body.appendChild(w); w.addEventListener("click", panelClick); }
  // The frame first: the backdrop and the Back button don't depend on the data, so Back, the backdrop and Esc work even if
  // everything after this fails. paint() only fills .apdbody (and the header's words) and never throws.
  w.innerHTML = `<div class="apdback" data-adclose></div><section class="apdpanel" role="dialog" aria-modal="true" aria-label="${esc(ST.name)}"><header class="apdtop">${topHtml()}</header><div class="apdbody"></div></section>`;
  (w.querySelector(".apdtop") as any)._h = topHtml();
  try { place(); } catch (e) { console.error("app page: place", e); }
  paint();
  const open = ++ST.opened, show = () => { if (ST.open && open === ST.opened) w!.classList.add("on"); };   // not if it was closed before it got to show
  requestAnimationFrame(() => requestAnimationFrame(show)); setTimeout(show, 250);   // rAF alone never fires in a hidden tab
  load(!!ST.data);
  setTimeout(() => { if (ST.open) w!.querySelector<HTMLElement>(".apdtop .apdbk")?.focus({ preventScroll: true }); }, 40);
}
export function closeAppDetail() {
  const w = document.getElementById("appdw"); ST.open = false; ST.gen++; ST.opened++; clearInterval(busyT); acctNoteReset(); if (!w) return;
  w.classList.remove("on"); setTimeout(() => { if (!ST.open) w.innerHTML = ""; }, 220);
  if (ST.from === "Connected accounts") document.querySelector<HTMLElement>(`#setw.on [data-adetail="${ST.slug}"]`)?.focus({ preventScroll: true });
}
export const appDetailOpen = () => shown();

function load(quiet = false) {
  if (!D) return;
  const gen = ++ST.gen, slug = ST.slug;
  if (!D.api) { ST.err = "sandbox"; paint(); return; }
  if (!quiet) { ST.err = ""; paint(); }
  // A slow server gets LOAD_TIMEOUT, then the error state (with Try again). Anything that isn't the page's JSON (an HTML error
  // page, an error JSON even with a 200, a 410/502) is an error too, never something half-drawn.
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), LOAD_TIMEOUT);
  fetch(`${D.api}/apps/${encodeURIComponent(slug)}`, { credentials: "same-origin", signal: ctl?.signal })
    .then(async r => {
      let d: any = null; try { d = JSON.parse(await r.text()); } catch {}
      if (!r.ok || !d || typeof d !== "object" || d.error) throw Object.assign(new Error(typeof d?.error === "string" ? d.error : `HTTP ${r.status}`), { plain: typeof d?.error === "string" });
      return normalize(d, slug);
    })
    .then(d => { if (gen !== ST.gen) return; d = respell(d, ST.name); CACHE.set(slug, { at: Date.now(), d }); ST.data = d; ST.err = ""; paint(); })
    .catch((e: any) => { if (gen !== ST.gen) return; if (!ST.data) { ST.err = e?.name === "AbortError" ? "timeout" : e?.plain ? e.message : "error"; paint(); } })
    .finally(() => clearTimeout(timer));
}
// Whatever the server sent, a Detail the page can draw: every field the right type, unknown values dropped.
function normalize(o: any, slug: string): Detail {
  const str = (x: unknown) => typeof x === "string" ? x : typeof x === "number" ? String(x) : "";
  const arr = (x: unknown): any[] => Array.isArray(x) ? x : [];
  const link = (x: any) => x && typeof x.url === "string" && /^https?:\/\//i.test(x.url) ? { url: x.url, label: str(x.label) || x.url } : null;
  const c = o.connect && typeof o.connect === "object" ? o.connect : {};
  const kind = (["oauth", "key", "none", "unavailable"] as const).find(k => k === c.kind) || "unavailable";
  const list = (x: any, map: (t: any) => any) => x && typeof x === "object" && Array.isArray(x.items) ? (items => ({ count: Math.max(Number(x.count) || 0, items.length), items }))(x.items.filter((t: any) => t && typeof t === "object").map(map).filter((t: any) => t.name)) : null;
  const conn = o.connection && typeof o.connection === "object" ? o.connection : {};
  const accounts = toAccounts(arr(conn.accounts));
  const status = (["connected", "expired", "none", "unknown"] as const).find(k => k === conn.status) || (accounts.some(a => a.status === "connected") ? "connected" : accounts.length ? "expired" : "unknown");
  return {
    slug: str(o.slug) || slug, name: str(o.name) || ST.name || slug, logo: str(o.logo), description: str(o.description),
    categories: arr(o.categories).map(str).filter(Boolean), website: link(o.website), help: link(o.help),
    connect: { kind, text: str(c.text), provider: str(c.provider) || undefined, fields: arr(c.fields).filter(f => f && typeof f === "object").map(f => ({ label: str(f.label), help: str(f.help) })),
      byok: kind === "key" && c.byok && typeof c.byok === "object" && str(c.byok.text) ? { provider: str(c.byok.provider), payer: str(c.byok.payer) || str(c.byok.provider), url: /^https:\/\//i.test(str(c.byok.url)) ? str(c.byok.url) : null, text: str(c.byok.text) } : undefined },
    auth: arr(o.auth).filter(a => a && typeof a === "object").map(a => ({ kind: str(a.kind), text: str(a.text) })),
    tools: list(o.tools, t => ({ name: str(t.name), does: str(t.does), reads: !!t.reads, key: !!t.key })),
    triggers: list(o.triggers, t => ({ name: str(t.name), does: str(t.does) })),
    updated: str(o.updated) || null,
    connection: { status, accounts },
  };
}

// Accounts from the server (this page's reply, or the connected-apps list filtered to this app), oldest first as given. Missing or
// odd fields are tolerated: no label → its email → "Account N"; no default flag on any connected one → the first connected.
function toAccounts(list: any[]): Account[] {
  const str = (x: unknown) => typeof x === "string" ? x : "";
  const out: Account[] = list.filter(a => a && typeof a === "object" && str(a.id)).map((a, i) => ({ id: str(a.id), email: str(a.email), label: str(a.label) || str(a.email) || `Account ${i + 1}`, default: a.default === true, since: str(a.since), status: a.status === "connected" ? "connected" : "expired", memo: str(a.memo) }));
  const live = out.filter(a => a.status === "connected");
  if (live.length && !live.some(a => a.default)) live[0].default = true;
  for (const a of out) if (a.status !== "connected") a.default = false;
  return out;
}
// After Make default / Disconnect the server sends the whole connected-apps list (newest first): keep this app's, oldest first.
function setFromStore(all: any[]) {
  if (!ST.data || !Array.isArray(all)) return;
  const accounts = toAccounts(all.filter(a => a && a.app === ST.slug).reverse());
  ST.data = { ...ST.data, connection: { accounts, status: accounts.some(x => x.status === "connected") ? "connected" : accounts.length ? "expired" : "none" } };
  CACHE.delete(ST.slug);
}

// Composio sometimes spells a name differently from the list ("Openrouter" vs "OpenRouter"): keep the one the person tapped.
function respell(d: Detail, shown: string): Detail {
  if (!shown || shown === d.slug) { ST.name = d.name || ST.name; return d; }   // opened without a name to go by
  if (shown === d.name || shown.toLowerCase() !== d.name.toLowerCase()) return d;
  const fix = (t: string) => t.split(d.name).join(shown);
  return { ...d, name: shown, connect: { ...d.connect, text: fix(d.connect.text) }, auth: d.auth.map(a => ({ ...a, text: fix(a.text) })) };
}

// ---------- rendering ----------
const logoImg = (slug: string, name: string, cls: string) => appLogo(slug, name, cls, cls === "apdlogo" ? 96 : 22);   // logo.ts: tinted initial tile at once, logo fades in over it (/applogo on live)
const fmtDay = (iso: string) => { const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso); return isNaN(+d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };

function state() {
  const info = D!.info(ST.slug), d = ST.data;
  const conn = d?.connection, acct = conn?.accounts.find(a => a.status === "connected"), expired = conn?.accounts.find(a => a.status === "expired");
  const on = D!.connected(ST.slug) || conn?.status === "connected";
  const builtIn = d ? d.connect.kind === "none" : !!info?.b;
  const soon = !on && (info ? !!info.x : d?.connect.kind === "unavailable");
  return { info, d, on, acct, expired: !on && conn?.status === "expired" ? expired : undefined, builtIn, soon, key: d ? d.connect.kind === "key" : info ? !info.o : false };
}
function actionHtml() {
  const s = state(), name = esc(ST.name);
  if (!s.d && !s.info && ST.err && ST.err !== "sandbox") return "";   // didn't load and nothing to go by: no guessing at Connect
  if (s.on) {
    // The accounts themselves (Default, Make default, Disconnect) are listed in their own section below; here: status + Add another.
    const live = s.d?.connection.accounts.filter(a => a.status === "connected") || [];
    const who = live.length > 1 ? ` · ${live.length} accounts` : live[0] ? ` · ${esc(live[0].label)}` : "";
    const add = ST.busy ? `<button class="apdbtn" disabled><i class="apdspin"></i><span>Opening…</span></button>` : s.d?.connect.kind === "none" || s.d?.connect.kind === "unavailable" ? "" : `<button class="apdbtn" data-adadd>${IC.plus}<span>Add another account</span></button>`;
    return `<span class="apdok">${IC.check}<span>Connected${who}</span></span>${add}${live.length ? "" : `<button class="apdbtn quiet" data-admanage>Manage</button>`}`;
  }
  if (s.builtIn) return `<span class="apdok built">${IC.bolt}<span>Built in · nothing to connect</span></span>`;
  // "Soon": the existing Soon button (data-soon="app-…" inside an .apcard whose <b> names the app), so it explains itself the same way.
  if (s.soon) return `<span class="apcard apdsoonw"><b class="apdsr">${name}</b><button class="apdbtn soon" data-soon="app-${esc(ST.slug)}">Soon</button></span><span class="apdhint">Not available to connect yet</span>`;
  if (ST.busy) return `<button class="apdbtn primary" disabled><i class="apdspin"></i><span>Opening…</span></button>`;
  if (s.expired) return `<button class="apdbtn primary" data-adcon>Reconnect</button><span class="apdhint warn">The connection expired</span>`;
  const b = s.d?.connect.byok;
  return `<button class="apdbtn primary" data-adcon>${s.key ? "Add key" : "Connect"}</button>${b ? `<span class="apdhint">Your own ${esc(b.provider)} key · you pay ${esc(b.payer)} directly</span>` : ""}`;
}
function toolRow(t: Tool) {
  return `<li class="apdtool"><span class="apdti ${t.reads ? "r" : "w"}" title="${t.reads ? "Looks something up" : "Changes something. Asks you first"}">${t.reads ? IC.eye : IC.pen}</span><span class="apdtt"><b>${esc(t.name)}</b>${t.does ? `<span>${esc(t.does)}</span>` : ""}</span></li>`;
}
function toolsHtml(d: Detail) {
  const helper = esc(D!.helper()), all = d.tools?.items || [];
  if (!d.tools) return `<p class="apdmuted">The list of actions didn't load. <button class="apdlink" data-adretry>Try again</button></p>`;
  if (!all.length) return `<p class="apdmuted">${esc(d.name)} doesn't list any actions yet.</p>`;
  const q = ST.q.trim().toLowerCase();
  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name);
  if (q) {
    const hits = all.filter(t => t.name.toLowerCase().includes(q) || t.does.toLowerCase().includes(q)).sort((a, b) => (+b.name.toLowerCase().includes(q) - +a.name.toLowerCase().includes(q)) || byName(a, b));
    return hits.length ? `<ul class="apdtools">${hits.slice(0, SEARCH_MAX).map(toolRow).join("")}</ul>${hits.length > SEARCH_MAX ? `<p class="apdmuted">${hits.length - SEARCH_MAX} more match. Keep typing to narrow it down.</p>` : ""}`
      : `<p class="apdmuted">No actions match “${esc(ST.q.trim())}”.</p>`;
  }
  const flat = all.length <= FLAT_MAX;
  const groups: [string, string, Tool[]][] = [
    ["key", "Most used", all.filter(t => t.key).sort(byName)],
    ["r", "Looks things up", all.filter(t => !t.key && t.reads).sort(byName)],
    ["w", `Makes changes · ${helper} asks you first`, all.filter(t => !t.key && !t.reads).sort(byName)],
  ];
  return groups.filter(g => g[2].length).map(([k, label, list]) => {
    const open = flat || ST.more[k] || list.length <= GROUP_FIRST + 2, shown = open ? list : list.slice(0, GROUP_FIRST);
    return `<div class="apdgrp"><h4>${esc(label)}<em>${list.length}</em></h4><ul class="apdtools">${shown.map(toolRow).join("")}</ul>${open ? "" : `<button class="apdlink apdmore" data-admore="${k}">Show all ${list.length}</button>`}</div>`;
  }).join("");
}
function howHtml(d: Detail) {
  const k = d.connect.kind, icon = k === "oauth" ? IC.lock : k === "key" ? IC.key : k === "none" ? IC.bolt : IC.help;
  const fields = (d.connect.fields || []).filter(f => f.label);
  const other = d.auth.filter(a => a.kind !== k && !/not set up/.test(a.text));
  const b = d.connect.byok;
  return `${ST.slug === "tailscale" ? `<p class="apdmuted">This app connection accesses the Tailscale management API. It does not join the agent's 1HC computer to your tailnet. For native enrollment, use Settings → Connected accounts → Computer connections; that flow opens a Tailscale approval link and never asks for an API key.${D?.computerConnections ? ` <button class="apdbtn quiet" data-adnetwork>Open Computer connections</button>` : ""}</p>` : ""}<div class="apdhow"><span class="apdhowi">${icon}</span><p>${esc(d.connect.text)}</p></div>
    ${b ? `<p class="apdbyok">${esc(b.text)}${b.url ? ` <a class="apdlink" href="${esc(b.url)}" target="_blank" rel="noopener">Get a key from ${esc(b.provider)} ${IC.ext}</a>` : ""}</p>` : ""}
    ${fields.length ? `<ul class="apdfields">${fields.map(f => `<li><b>${esc(f.label)}</b>${f.help ? `<span>${esc(f.help)}</span>` : ""}</li>`).join("")}</ul>` : ""}
    ${other.length ? `<p class="apdmuted apdalso">${esc(d.name)} also supports: ${other.map(a => esc(a.text.replace(/^Needs /, "").replace(/^Signs in /, "signing in "))).join("; ")}.</p>` : ""}
    ${d.help ? `<p class="apdalso"><a class="apdlink" href="${esc(d.help.url)}" target="_blank" rel="noopener">How to get it ${IC.ext}</a></p>` : ""}`;
}
function infoHtml(d: Detail | null, info: AppListInfo | undefined) {
  const rows: [string, string][] = [];
  if (d?.website) rows.push(["Website", `<a class="apdlink" href="${esc(d.website.url)}" target="_blank" rel="noopener">${esc(d.website.label)} ${IC.ext}</a>`]);
  const cats = d?.categories?.length ? d.categories : info?.c?.map(c => c.replace(/\b[a-z]/g, x => x.toUpperCase())) || [];
  if (cats.length) rows.push([cats.length > 1 ? "Categories" : "Category", esc(cats.join(", "))]);
  if (d?.tools) rows.push(["Actions", `${d.tools.count.toLocaleString()}`]);
  if (d?.updated) rows.push(["Updated", esc(fmtDay(d.updated))]);
  return rows.length ? `<dl class="apdinfo">${rows.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("")}</dl>` : "";
}
function eventsHtml(d: Detail) {
  if (!d.triggers?.count) return "";
  return `<details class="apdev"><summary>${IC.bell}<span>Events ${esc(d.name)} can report</span><em>${d.triggers.count}</em></summary>
    <p class="apdmuted">Things ${esc(d.name)} can announce, like a new message. ${esc(D!.helper())} doesn't watch for these yet.</p>
    <ul class="apdtools">${d.triggers.items.map(t => `<li class="apdtool"><span class="apdti">${IC.bell}</span><span class="apdtt"><b>${esc(t.name)}</b>${t.does ? `<span>${esc(t.does)}</span>` : ""}</span></li>`).join("")}</ul></details>`;
}
const skel = (n: number, cls = "") => Array.from({ length: n }, (_, i) => `<i class="apdsk ${cls}" style="width:${[92, 84, 96, 70, 88, 60][i % 6]}%"></i>`).join("");

const backLabel = () => ST.from || "Back";
// Your accounts in this app: each with its label, Default badge, Make default and Disconnect (Reconnect / Remove when expired).
// The tile is the app's logo, with the account's company logo over it for a work address (sam@acme.com → Acme).
function accountsHtml(d: Detail) {
  const as = d.connection.accounts; if (!as.length) return "";
  const many = as.filter(a => a.status === "connected").length > 1;
  const row = (a: Account) => {
    const busy = ST.disc === a.id ? (a.status === "connected" ? "Disconnecting…" : "Removing…") : ST.disc === `d:${a.id}` ? "Saving…" : "";
    const acts = a.status === "connected"
      ? `${many && !a.default ? `<button class="apdbtn quiet" data-addef="${esc(a.id)}"${ST.disc ? " disabled" : ""}>${ST.disc === `d:${a.id}` ? "Saving…" : "Make default"}</button>` : ""}<button class="apdbtn quiet" data-addisc="${esc(a.id)}"${ST.disc ? " disabled" : ""}>${ST.disc === a.id ? busy : "Disconnect"}</button>`
      : `${d.connect.kind === "unavailable" ? "" : `<button class="apdbtn quiet" data-adcon>Reconnect</button>`}<button class="apdbtn quiet" data-addisc="${esc(a.id)}"${ST.disc ? " disabled" : ""}>${ST.disc === a.id ? busy : "Remove"}</button>`;
    return `<li class="apdacc${a.status === "connected" ? "" : " off"}" data-adacc="${esc(a.id)}"><span class="apdacci lgo-host">${logoImg(ST.slug, ST.name, "apdaccl")}${logoOver(workDomain(a.email), 36)}</span>
      <span class="apdacct"><b><span class="apdaccn">${esc(a.label)}</span>${many && a.default ? `<em class="apddef">Default</em>` : ""}</b><span>${a.status === "connected" ? `Connected ${esc(fmtDay(a.since))}` : "Expired. Sign in again to keep it working."}</span></span>
      <span class="apdacca">${acts}</span><div class="apdaccnt">${acctNoteHtml(a)}</div></li>`;
  };
  return `<section class="apdsec"><h3>Your ${esc(d.name)} account${as.length > 1 ? "s" : ""}</h3><ul class="apdaccs">${as.map(row).join("")}</ul>${many ? `<p class="apdmuted apdaccnote">${esc(D!.helper())} uses the default unless you name another account, like “check my personal email”, or a note above says which one fits.</p>` : ""}</section>`;
}
function topHtml() { return `<button class="apdbk" data-adclose aria-label="Back to ${esc(backLabel())}">${IC.back}<span>${esc(backLabel())}</span></button><b class="apdtname">${esc(ST.name)}</b><span class="apdsp"></span>`; }
// The back way out, inside an error box too (on a phone the header's Back is just an arrow).
const errBox = (title: string, sub: string) => `<div class="apderr"><p><b>${title}</b><span>${sub}</span></p><span class="apderrb"><button class="apdbtn" data-adretry>Try again</button><button class="apdbtn quiet" data-adclose>Back</button></span></div>`;
const errText = (e: string) => e === "No app by that name." ? "This app isn't in the catalog anymore." : e === "timeout" ? "It's taking too long to load. Try again in a moment." : e === "error" ? "Check your connection and try again." : esc(e);
// Fills the page. Never throws: if drawing fails, the body shows the error state (Try again / Back) and the header stays.
function paint() {
  const w = document.getElementById("appdw"), p = w?.querySelector<HTMLElement>(".apdpanel"); if (!p || !D) return;
  let top = p.querySelector<HTMLElement>(".apdtop"), body = p.querySelector<HTMLElement>(".apdbody");
  if (!top) { top = document.createElement("header"); top.className = "apdtop"; p.prepend(top); }
  if (!body) { body = document.createElement("div"); body.className = "apdbody"; p.append(body); }
  const th = topHtml(); if ((top as any)._h !== th) { top.innerHTML = th; (top as any)._h = th; }   // unchanged: keep it (and the focus on Back)
  p.setAttribute("aria-label", ST.name);
  const y = body.scrollTop;
  try { body.innerHTML = bodyHtml(); }
  catch (e) { console.error("app page: couldn't draw", ST.slug, e); body.innerHTML = errBox(`Couldn't show ${esc(ST.name)}.`, "Something went wrong on this page. Try again, or go back."); }
  body.scrollTop = y;
  try { clampDesc(); } catch {}
  try { acctNoteAfter(); } catch {}
}
function bodyHtml() {
  const s = state(), d = ST.data, info = s.info, helper = esc(D!.helper());
  const desc = d?.description || String(info?.d || "").replace(/([A-Za-z0-9)])$/, "$1.");
  const cats = d?.categories?.length ? d.categories : (info?.c || []).map(c => c.replace(/\b[a-z]/g, x => x.toUpperCase()));
  const sandbox = ST.err === "sandbox", failed = !!ST.err && !sandbox && !d, loading = !d && !ST.err;
  return `<div class="apdhero">${logoImg(ST.slug, ST.name, "apdlogo")}
      <div class="apdhtxt"><h2>${esc(ST.name)}</h2>
        ${cats.length ? `<div class="apdcats">${cats.map(c => `<span class="apdcat">${esc(c)}</span>`).join("")}</div>` : loading ? `<div class="apdcats">${skel(1, "chip")}</div>` : ""}
        ${(act => act ? `<div class="apdact">${act}</div>` : "")(actionHtml())}</div></div>
    ${s.on ? "" : (() => { try { return D!.draft?.(ST.slug) || ""; } catch { return ""; } })()}
    ${failed ? errBox(`Couldn't load the details for ${esc(ST.name)}.`, errText(ST.err)) : ""}
    <div class="apdgrid">
      <div class="apdmain">
        ${d ? accountsHtml(d) : ""}
        <section class="apdsec"><h3>About</h3>
          ${desc ? `<p class="apddesc${ST.descMore ? " open" : ""}" id="apddesc">${esc(desc).replace(/\n{2,}/g, "</p><p class=\"apddesc open\">").replace(/\n/g, "<br>")}</p><button class="apdlink apdreadmore" data-addesc hidden>More</button>` : loading ? skel(3) : `<p class="apdmuted">No description yet.</p>`}
        </section>
        <section class="apdsec"><div class="apdsech"><h3>What ${helper} can do with it</h3>${d?.tools && d.tools.count > FLAT_MAX ? `<label class="apdq">${IC.search}<input id="apdq" type="search" placeholder="Search ${d.tools.count.toLocaleString()} actions" value="${esc(ST.q)}" autocomplete="off" enterkeyhint="search"></label>` : ""}</div>
          ${d ? `${d.tools?.count ? `<p class="apdmuted apdlead">${d.connect.kind === "none" || s.on ? `Ask ${helper} in plain words.` : s.soon ? `${esc(ST.name)} can't be connected yet. Once it can, ask ${helper} in plain words.` : `Once ${esc(ST.name)} is connected, ask ${helper} in plain words.`} It looks things up on its own and checks with you before it changes anything.</p>` : ""}<div id="apdtl">${toolsHtml(d)}</div>` : loading ? `<div class="apdtsk">${skel(6, "row")}</div>` : sandbox ? `<p class="apdmuted">The full list of actions loads in the live app.</p>` : `<p class="apdmuted">Loads with the details above.</p>`}
        </section>
        ${d ? eventsHtml(d) : ""}
      </div>
      <aside class="apdside">
        ${d || loading || info ? `<section class="apdsec apdcard"><h3>How it connects</h3>${d ? howHtml(d) : loading ? skel(2) : info ? `<div class="apdhow"><span class="apdhowi">${info.b ? IC.bolt : info.o ? IC.lock : IC.key}</span><p>${info.b ? "Built in: nothing to connect." : info.o ? `One click: you sign in on the app's own page. 1Helm never sees your password.` : `Needs a key from ${esc(ST.name)}. You paste it on a secure page, and 1Helm never sees it.`}</p></div>` : ""}</section>` : ""}
        ${d || info ? `<section class="apdsec apdcard"><h3>Information</h3>${infoHtml(d, info)}</section>` : loading ? `<section class="apdsec apdcard"><h3>Information</h3>${skel(3)}</section>` : ""}
      </aside>
    </div>`;
}
function clampDesc() {
  const el = document.getElementById("apddesc"), btn = document.querySelector<HTMLElement>("[data-addesc]"); if (!el || !btn) return;
  if (ST.descMore) { btn.hidden = true; return; }
  const check = () => { btn.hidden = !(el.scrollHeight > el.clientHeight + 4); };
  requestAnimationFrame(check); (document as any).fonts?.ready?.then(check);
}
function paintTools() { const l = document.getElementById("apdtl"); if (!l || !ST.data) return; try { l.innerHTML = toolsHtml(ST.data); } catch (e) { console.error("app page: tools", e); paint(); } }

// ---------- actions ----------
function disconnect(id: string) {
  if (!D?.api || ST.disc) return;
  const all = ST.data?.connection.accounts || [], a = all.find(x => x.id === id), rest = all.filter(x => x.id !== id && x.status === "connected"), next = a?.default && rest.length ? rest[0] : null;
  const off = a && a.status !== "connected";
  ask({ title: `${off ? "Remove" : "Disconnect"} ${ST.name}${a ? ` (${a.label})` : ""}?`, body: `${D.helper()} won't be able to use ${rest.length ? "this account" : "it"} anymore.${next ? ` ${next.label} becomes your default ${ST.name}.` : ""}`, confirm: off ? "Remove" : "Disconnect", danger: true }).then(ok => {
    if (ok && D?.api && !ST.disc && ST.open) disconnectNow(id);
  });
}
function disconnectNow(id: string) {
  ST.disc = id; paint();
  fetch(`${D!.api}/apps/disconnect`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).then(r => r.json())
    .then(d => {
      ST.disc = "";
      if (d.accounts) { D!.setAccounts(d.accounts); setFromStore(d.accounts); }
      else D!.note(`Couldn't disconnect ${ST.name}`, d.error || "Try again in a minute.");
      if (ST.open) paint();
    }).catch(() => { ST.disc = ""; if (ST.open) paint(); });
}
function makeDefault(id: string) {
  if (!D?.api || ST.disc) return;
  const a = ST.data?.connection.accounts.find(x => x.id === id); if (!a) return;
  ST.disc = `d:${id}`; paint();
  fetch(`${D.api}/apps/default`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).then(r => r.json())
    .then(d => {
      ST.disc = "";
      if (d.accounts) { D!.setAccounts(d.accounts); setFromStore(d.accounts); D!.note(`Default ${ST.name} changed`, `${D!.helper()} now uses ${a.label} unless you name another account.`); }
      else D!.note("Couldn't change the default", d.error || "Try again in a minute.");
      if (ST.open) paint();
    }).catch(() => { ST.disc = ""; if (ST.open) paint(); });
}
function connect(another = false) {
  if (!D || ST.busy) return;
  ST.busy = true; paint(); D.connect(ST.slug, ST.name, another);
  // The flow leaves the page on success; if it couldn't open (it shows its own message), put the button back.
  clearInterval(busyT); busyT = window.setInterval(() => { if (!ST.open || !D!.busy()) { clearInterval(busyT); if (ST.busy) { ST.busy = false; if (ST.open) paint(); } } }, 400);
}

// The page's taps, listened for on #appdw itself so nothing on the document can swallow them first. Back / the backdrop close it
// whatever state the page is in.
function panelClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t.closest("[data-adclose]")) { closeAppDetail(); return; }
  if (!ST.open || !D) return;
  try {
    if (t.closest("[data-adretry]")) { CACHE.delete(ST.slug); ST.err = ""; load(); return; }
    if (t.closest("[data-adcon]") || t.closest("[data-adadd]")) { connect(!!t.closest("[data-adadd]")); return; }
    const df = t.closest<HTMLElement>("[data-addef]"); if (df) { makeDefault(df.dataset.addef!); return; }
    const dc = t.closest<HTMLElement>("[data-addisc]"); if (dc) { disconnect(dc.dataset.addisc!); return; }
    if (t.closest("[data-admanage]")) { closeAppDetail(); D.manage(); return; }
    if (t.closest("[data-adnetwork]")) { closeAppDetail(); D.computerConnections?.(); return; }
    const mo = t.closest<HTMLElement>("[data-admore]"); if (mo) { ST.more[mo.dataset.admore!] = true; paintTools(); return; }
    if (t.closest("[data-addesc]")) { ST.descMore = true; document.getElementById("apddesc")?.classList.add("open"); clampDesc(); return; }
  } catch (err) { console.error("app page: tap", err); paint(); }
}

// Esc closes this page first and leaves the list underneath open. Registered when this module loads, i.e. before the app's own
// Esc handlers (Apps popup, Settings), so it wins.
window.addEventListener("keydown", e => {
  if (!shown() || dialogOpen()) return;   // a dialog over the page (Disconnect?) takes Esc itself
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeAppDetail(); return; }
  if (matches("apps", e)) closeAppDetail();   // the Apps shortcut closes the popup underneath too
}, true);

// The server's whole connected-apps list after a change made elsewhere (an account note saved here or in Settings, or by the helper).
/** Draw the open page again (the texted offer's draft arrived). */
export function appDetailRepaint() { if (ST.open) paint(); }
export function appDetailSync(all: any[]) { if (!ST.data) return; setFromStore(all); if (ST.open) paint(); }
export function initAppDetail(deps: AppDetailDeps) {
  if (D) { D = deps; return; } D = deps;
  onAcctNote(appDetailSync, () => { if (ST.open) paint(); });   // Settings keeps the shared list (its own subscription)
  // Open from any app row: the Apps popup (and its search), and Settings → Connected accounts. Buttons inside a row keep their own job.
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    if (t.closest?.("#appdw")) return;   // the page's own clicks: panelClick, on the page itself
    if (t.closest("button, a, input, label, [data-soon], [role=switch]")) return;
    const row = t.closest<HTMLElement>("[data-adetail]") || t.closest<HTMLElement>(".sr[data-cxrow]:not([data-retired])");
    if (!row) return;
    const slug = row.dataset.adetail || row.dataset.cxrow || "";
    const name = row.querySelector(".aptxt b, .srt b")?.childNodes[0]?.textContent?.trim() || undefined;
    openAppDetail(slug, { name });
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target as HTMLElement; const row = t.matches?.("[data-adetail-key]") ? t.closest<HTMLElement>("[data-adetail]") : null; if (!row) return;
    e.preventDefault(); openAppDetail(row.dataset.adetail!, { name: row.querySelector(".aptxt b, .srt b")?.textContent?.trim() || undefined });
  });
  document.addEventListener("input", e => { const t = e.target as HTMLInputElement; if (t.id === "apdq") { ST.q = t.value; paintTools(); } });
  window.addEventListener("resize", () => { if (ST.open) place(); });
}

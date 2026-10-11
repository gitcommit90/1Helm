// Settings → Advanced → Custom MCP connections (Experimental). Off by default; the person connects their own remote MCP server so their
// assistants get its tools. Everything the server says is the Worker's word, never ours: a row never says Connected before the server
// reports status "connected". 1HC (custom-mcp backend) API, under <api> = "/w/<slug>/api":
//   GET  custom-mcp → { enabled, available, unavailable_reason?: "gated"|"self_managed"|"unconfigured", servers: [Server] }
//   PUT  custom-mcp/settings { enabled } → same shape
//   POST custom-mcp/servers { client_request_id, name, url, auth: {type:"none"} | {type:"api_key", key, header?, template?} | {type:"oauth"} }
//        → { server, authorize_url? }
//   GET  custom-mcp/servers/:id → { server }   (polled every ~2.5 s while connecting / syncing / removing, for at most POLL_MAX_MS)
//   POST custom-mcp/servers/:id/authorize → { authorize_url };  POST .../refresh → { server };  DELETE custom-mcp/servers/:id → { ok } | { server }
//   Server = { id, name, endpoint, auth, status, tool_count, tools?: [{name, description}], last_synced_at?, error?: {code, message} }
// The API key is write-only: it lives in one in-memory variable while it is typed (never in the HTML, never in browser storage), goes up
// once, and is cleared as soon as the request is sent. Tool names and descriptions come from untrusted servers: text only, truncated.
// v3.ts hooks in: cmcpPage() as the "advanced" section, cmcpAfter() after every Settings paint, cmcpInit() once.
export const CMCP_SEC = "advanced";
export const CMCP_TITLE = "Advanced";

type Status = "connecting" | "authorization_required" | "syncing" | "connected" | "failed" | "reconnect_required" | "removing";
type Auth = "none" | "api_key" | "oauth";
type Tool = { name: string; description?: string };
export type Server = { id: string; name: string; endpoint: string; auth: Auth; status: Status; tool_count: number; tools?: Tool[]; last_synced_at?: string | number; error?: { code?: string; message?: string } };
type Deps = {
  api: ((path: string, init?: { method?: string; body?: any }) => Promise<any>) | null;   // null: design sandbox (no Worker)
  repaint: () => void;
  shown: () => boolean;                                   // Settings is open on this page
  srow: (icon: string, title: string, sub: string, right: string, attrs?: string) => string;
  icon: (k: string, s?: number) => string;
  ask: (o: { title: string; body?: string; confirm?: string; danger?: boolean }) => Promise<boolean>;
  note: (good: boolean, title: string, sub: string) => void;
  go: (url: string) => void;                              // leave for the server's sign-in (same tab, like Connected accounts)
};
let D: Deps | null = null;

export const POLL_MS = 2500, POLL_MAX_MS = 120000, STALE_MS = 15000;
const WORKING = new Set<Status>(["connecting", "syncing", "removing"]);
const STATUS: Record<Status, string> = { connecting: "Connecting…", authorization_required: "Authorization required", syncing: "Syncing tools…", connected: "Connected", failed: "Failed", reconnect_required: "Reconnect required", removing: "Removing…" };

type Form = { name: string; url: string; auth: Auth; header: string; template: string; hdr: boolean; busy: boolean; err: string; field: string; rid: string; sig: string };
const blank = (): Form => ({ name: "", url: "", auth: "none", header: "", template: "", hdr: false, busy: false, err: "", field: "", rid: "", sig: "" });
const M: { loaded: boolean; loading: boolean; err: string; at: number; enabled: boolean; available: boolean; reason: string; servers: Server[]; toggling: boolean;
  adding: boolean; f: Form; key: string; busy: Record<string, string>; err1: Record<string, string>; since: Record<string, number>; slow: Set<string>; tools: Set<string>; focus: string; timer: number } =
  { loaded: false, loading: false, err: "", at: 0, enabled: false, available: true, reason: "", servers: [], toggling: false, adding: false, f: blank(), key: "", busy: {}, err1: {}, since: {}, slow: new Set(), tools: new Set(), focus: "", timer: 0 };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clip = (s: unknown, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const rid = () => (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const isStatus = (s: unknown): s is Status => typeof s === "string" && s in STATUS;

// Client-side URL check, only to catch typos early; the server decides what is reachable and allowed.
export function checkUrl(raw: string): string {
  const v = raw.trim(); if (!v) return "Enter the server's address.";
  let u: URL; try { u = new URL(v); } catch { return "That doesn't look like a web address. Start with https://"; }
  if (u.protocol !== "https:") return "The address must start with https://";
  if (u.username || u.password) return "Don't put a username or password in the address. Use the sign-in choice below.";
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const priv = h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "0.0.0.0" || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".ts.net") || h.endsWith(".lan");
  if (priv) return "That address only works from your own computer or network. Use a public https:// address.";
  if (!h.includes(".") && !h.includes(":")) return "Use the server's full public address, like https://mcp.example.com";
  return "";
}

function setAll(d: any) {
  M.enabled = !!d.enabled; M.available = d.available !== false; M.reason = d.unavailable_reason || "";
  if (Array.isArray(d.servers)) { M.servers = d.servers.filter((s: any) => s && s.id).map(norm); M.servers.forEach(track); }
  M.loaded = true; M.err = ""; M.at = Date.now();
}
const norm = (s: any): Server => ({ ...s, id: String(s.id), name: String(s.name ?? ""), endpoint: String(s.endpoint ?? ""), auth: s.auth === "api_key" || s.auth === "oauth" ? s.auth : "none",
  status: isStatus(s.status) ? s.status : "failed", tool_count: Number(s.tool_count) || 0 });
function track(s: Server) {
  if (WORKING.has(s.status)) { if (!M.since[s.id]) M.since[s.id] = Date.now(); } else { delete M.since[s.id]; M.slow.delete(s.id); }
}
function upsert(s: any) { const n = norm(s), i = M.servers.findIndex(x => x.id === n.id); if (i >= 0) M.servers[i] = n; else M.servers.push(n); track(n); }
const drop = (id: string) => { M.servers = M.servers.filter(s => s.id !== id); delete M.since[id]; M.slow.delete(id); M.tools.delete(id); delete M.busy[id]; delete M.err1[id]; };
const call = (path: string, method = "GET", body?: any) => D!.api!(path, { method, body });
const msg = (e: any, fallback = "Try again in a minute.") => String(e?.message || fallback);

function load(force = false) {
  if (!D?.api || M.loading || (!force && M.loaded && Date.now() - M.at < STALE_MS)) return;
  M.loading = true;
  call("custom-mcp").then(d => { setAll(d); }).catch(e => { M.err = msg(e, "Couldn't load this."); M.at = 0; }).finally(() => { M.loading = false; if (D!.shown()) D!.repaint(); });
}

// ---- polling: one loop, only while this page is showing and something is still working; each server gets POLL_MAX_MS ----
function schedule() {
  if (M.timer || !D?.api) return;
  const live = M.servers.some(s => WORKING.has(s.status) && !M.slow.has(s.id));
  if (!live || !D.shown()) return;
  M.timer = window.setTimeout(tick, POLL_MS);
}
async function tick() {
  M.timer = 0; if (!D?.shown()) return;
  const now = Date.now(), ids = M.servers.filter(s => WORKING.has(s.status) && !M.slow.has(s.id)).map(s => s.id);
  let changed = false;
  for (const id of ids) {
    if (now - (M.since[id] || now) > POLL_MAX_MS) { M.slow.add(id); changed = true; continue; }
    try {
      const d = await call(`custom-mcp/servers/${encodeURIComponent(id)}`);
      if (!D.shown()) return;
      const before = M.servers.find(s => s.id === id)?.status; if (d?.server) upsert(d.server);
      if (before !== M.servers.find(s => s.id === id)?.status) changed = true;
    } catch (e: any) { if (e?.status === 404 || e?.code === "not_found") { if (M.servers.find(s => s.id === id)?.status === "removing") { drop(id); changed = true; } } }   // a transient error just waits for the next tick
  }
  if (changed && D.shown()) D.repaint(); else schedule();
}

// ---- rendering ----
const stIcon = (st: Status) => WORKING.has(st) ? `<i class="apspin" aria-hidden="true"></i>` : "";
function badge(s: Server) {
  const cls = s.status === "connected" ? "mcxst ok" : s.status === "failed" || s.status === "reconnect_required" ? "mcxst bad" : s.status === "authorization_required" ? "mcxst warn" : "mcxst";
  return `<span class="${cls}" role="status">${stIcon(s.status)}${STATUS[s.status]}</span>`;
}
function serverRow(s: Server) {
  const b = M.busy[s.id] || "", dis = b || s.status === "removing" ? " disabled" : "", n = esc(s.name || "Untitled server");
  const tools = s.status === "connected" || s.tool_count ? `${s.tool_count} tool${s.tool_count === 1 ? "" : "s"}` : "";
  const open = M.tools.has(s.id), list = open ? (s.tools?.length ? `<ul class="mcxtools" aria-label="Tools from ${n}">${s.tools.slice(0, 100).map(t => `<li><b>${esc(clip(t.name, 80))}</b>${t.description ? `<span>${esc(clip(t.description, 160))}</span>` : ""}</li>`).join("")}${s.tools.length > 100 ? `<li><span>and ${s.tools.length - 100} more</span></li>` : ""}</ul>` : `<p class="sfine mcxfine">No tool details to show.</p>`) : "";
  const problem = s.error?.message && (s.status === "failed" || s.status === "reconnect_required" || s.status === "authorization_required") ? `<p class="mcxerr" role="alert">${esc(clip(s.error.message, 240))}</p>` : "";
  const here = M.err1[s.id] ? `<p class="mcxerr" role="alert">${esc(M.err1[s.id])}</p>` : "";
  const slow = M.slow.has(s.id) && WORKING.has(s.status) ? `<p class="sfine mcxfine" role="status">Still working. Check back in a bit, or use Refresh tools.</p>` : "";
  const acts = [
    s.status === "authorization_required" ? `<button type="button" class="sa" data-cmcp-auth="${esc(s.id)}"${dis}>${b === "auth" ? "Opening…" : "Authorize"}</button>` : "",
    s.status === "reconnect_required" ? `<button type="button" class="sa" data-cmcp-auth="${esc(s.id)}"${dis}>${b === "auth" ? "Opening…" : "Reconnect"}</button>` : "",
    `<button type="button" class="sa blue" data-cmcp-refresh="${esc(s.id)}"${dis}>${b === "refresh" ? "Refreshing…" : "Refresh tools"}</button>`,
    s.status === "connected" && s.tools?.length ? `<button type="button" class="sa blue" data-cmcp-tools="${esc(s.id)}" aria-expanded="${open}">${open ? "Hide tools" : "Show tools"}</button>` : "",
    `<button type="button" class="sa mute" data-cmcp-rm="${esc(s.id)}"${dis} aria-label="Disconnect ${n}">${b === "rm" || s.status === "removing" ? "Removing…" : "Disconnect"}</button>`,
  ].join("");
  const auth = s.auth === "api_key" ? "API key" : s.auth === "oauth" ? "OAuth" : "No authentication";
  return `<li class="mcxrow" data-cmcp-id="${esc(s.id)}"><div class="mcxtop"><span class="srt"><b>${n}</b>
      <span class="mcxend" title="${esc(s.endpoint)}">${esc(clip(s.endpoint, 120))}</span><span>${esc(auth)}${tools ? ` · ${tools}` : ""}</span></span>${badge(s)}</div>${problem}${slow}${here}<div class="mcxacts">${acts}</div>${list}</li>`;
}
const radio = (v: Auth, title: string, sub: string) => `<label class="mcxopt${M.f.auth === v ? " on" : ""}"><input type="radio" name="mcxauth" value="${v}" data-cmcp-auth-pick${M.f.auth === v ? " checked" : ""}${M.f.busy ? " disabled" : ""}><span class="srt"><b>${title}</b><span>${sub}</span></span></label>`;
function formHtml() {
  const f = M.f, bad = (k: string) => f.field === k ? ` aria-invalid="true" aria-describedby="cmcp-err"` : "", dis = f.busy ? " disabled" : "";
  const keyBox = f.auth === "api_key" ? `<label class="sf"><span>API key</span><input id="cmcp-key" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" data-cmcp-key${bad("key")}${dis}></label>
      <p class="sfine mcxfine">Saved securely and never shown again. To change it, disconnect and add the server again.</p>
      <button type="button" class="mcxdisc" data-cmcp-hdr aria-expanded="${f.hdr}" aria-controls="cmcp-hdrbox">Header options</button>
      <div id="cmcp-hdrbox"${f.hdr ? "" : " hidden"}><label class="sf"><span>Header name <em class="sopt">optional</em></span><input id="cmcp-header" data-cmcp-f="header" value="${esc(f.header)}" placeholder="Authorization" autocomplete="off" autocapitalize="off" spellcheck="false"${dis}></label>
        <label class="sf"><span>Header value template <em class="sopt">optional</em></span><input id="cmcp-template" data-cmcp-f="template" value="${esc(f.template)}" placeholder="Bearer {key}" autocomplete="off" autocapitalize="off" spellcheck="false"${dis}></label>
        <p class="sfine mcxfine">Only change these if the server asks for a different header. {key} stands for your key.</p></div>` : "";
  const oauth = f.auth === "oauth" ? `<p class="mcxnote">OAuth currently needs a server that supports dynamic client registration (DCR). After you press Connect you sign in on the server's own page, then come back here.</p>` : "";
  return `<form class="sc sform mcxform" id="cmcpform" data-cmcp-form novalidate aria-label="Add a custom MCP server"><div class="sfh"><b>Add server</b></div>
    <p>You need a server that is already running and reachable on the public internet. This doesn't set up or host a server, and can't reach localhost, laptop-only or private-network addresses.</p>
    <label class="sf"><span>Display name</span><input id="cmcp-name" data-cmcp-f="name" value="${esc(f.name)}" maxlength="80" autocomplete="off"${bad("name")}${dis}></label>
    <label class="sf"><span>Server address</span><input id="cmcp-url" data-cmcp-f="url" value="${esc(f.url)}" type="url" inputmode="url" placeholder="https://mcp.example.com/mcp" autocomplete="off" autocapitalize="off" spellcheck="false"${bad("url")}${dis}></label>
    <fieldset class="mcxauth"><legend>Sign-in</legend>${radio("none", "No authentication", "The server is open to anyone with the address.")}${radio("api_key", "API key", "Send a key you paste here with every request.")}${radio("oauth", "OAuth", "Sign in on the server's own page. Needs a compatible DCR server.")}</fieldset>
    ${keyBox}${oauth}
    ${f.err ? `<p class="mcxerr" id="cmcp-err" role="alert">${esc(f.err)}</p>` : ""}
    <p class="sfine mcxfine">To change the address or sign-in method later, disconnect and add the server again.</p>
    <div class="sbtns"><button class="sprim" type="submit"${dis}>${f.busy ? "Connecting…" : f.auth === "oauth" ? "Connect and sign in" : "Connect and test"}</button><button type="button" class="sa blue" data-cmcp-cancel${dis}>Cancel</button></div></form>`;
}
function head() {
  return `<h2>${CMCP_TITLE}</h2><p class="slead">Settings for people who want to go beyond the defaults.</p>`;
}
const SPIN = `<span class="bico"><i class="apspin"></i></span>`;
export function cmcpPage(): string {
  if (!D) return "";
  if (!D.api && !M.loaded) { M.loaded = true; M.available = false; M.reason = "unconfigured"; }   // design sandbox: no Worker to ask
  load();
  const title = `Custom MCP connections<em class="stag mcxexp">Experimental</em>`;
  if (!M.loaded) return `${head()}<div class="sc">${D.srow(M.err ? "" : SPIN, M.err ? "Couldn't load" : "Loading…", M.err ? esc(M.err) : "", M.err ? `<button class="sa blue" data-cmcp-retry>Try again</button>` : "")}</div>`;
  const off = !M.available;
  const why = !off ? "" : M.reason === "self_managed"
    ? `<p class="mcxnote" role="status">Custom MCP connections need Managed apps. You're using your own Composio account. <button type="button" class="mcxlink" data-sgo="accounts">Choose how apps connect</button></p>`
    : `<p class="mcxnote" role="status">Not available yet.</p>`;
  const toggle = `<button type="button" class="tg${M.enabled && !off ? " on" : ""}" role="switch" aria-checked="${M.enabled && !off}" aria-label="Custom MCP connections" data-cmcp-toggle${off || M.toggling ? " disabled aria-disabled=\"true\"" : ""}><i></i></button>`;
  const kept = !M.enabled && M.servers.length ? `${M.servers.length} saved connection${M.servers.length === 1 ? " is" : "s are"} kept and will come back if you turn this on again. ` : "";
  const top = `<div class="sc">${D.srow("", title, "Connect your own remote MCP server to give your assistants additional tools.", `${M.toggling ? `<i class="apspin" aria-hidden="true"></i>` : ""}${toggle}`, " data-cmcprow")}</div>${why}
    <p class="sfine mcxfine">Requests go through Composio to the server you supply. Whoever runs that server controls its tools and how it handles your data. Turning this on doesn't approve every tool action: your assistant still asks first when it normally would.</p>`;
  const offNote = `<p class="sfine mcxfine">${kept}Turning this off can't undo anything already sent to a server.</p>`;
  if (off || !M.enabled) return `${head()}${top}${off ? "" : offNote}`;
  const list = M.servers.length ? `<ul class="sc mcxlist" aria-label="Custom MCP servers">${M.servers.map(serverRow).join("")}</ul>` : `<div class="sc">${D.srow("", "No servers yet", "Add one to give your assistants its tools.", "")}</div>`;
  return `${head()}${top}<h3>Servers</h3>${list}${M.adding ? formHtml() : `<div class="sadd"><button type="button" class="sa blue" data-cmcp-add>${D.icon("plus", 15)}<span>Add server</span></button></div>`}
    <p class="sfine mcxfine">Turning this off keeps your saved connections, but can't undo anything already sent to a server.</p>`;
}

// Settings is re-rendered whole (a poll can land while someone types): remember the focused field and caret before, restore after.
let held: { sel: string; s: number | null; e: number | null } | null = null;
// A selector that finds the same control again after the repaint: its id, or its data-cmcp-* attribute (plus value for the radios).
const selOf = (a: HTMLElement) => {
  if (a.id?.startsWith("cmcp-")) return `#${a.id}`;
  const at = [...a.attributes].find(x => x.name.startsWith("data-cmcp-") && x.name !== "data-cmcp-f" && x.name !== "data-cmcp-key"); if (!at) return "";
  return `[${at.name}${at.value ? `="${CSS.escape(at.value)}"` : ""}]${a instanceof HTMLInputElement && a.type === "radio" ? `[value="${CSS.escape(a.value)}"]` : ""}`;
};
export function cmcpBefore() {
  held = null; const a = document.activeElement as HTMLInputElement | null;
  if (D?.shown() && a && a.closest?.("#setw")) { const sel = selOf(a); if (sel) held = { sel, s: a.selectionStart ?? null, e: a.selectionEnd ?? null }; }
}
// After every Settings paint: put typed text back, then focus and polling.
export function cmcpAfter() {
  if (!D || !D.shown()) { held = null; return; }
  const key = document.getElementById("cmcp-key") as HTMLInputElement | null; if (key && M.key) key.value = M.key;
  if (held && !M.focus) { const el = document.querySelector<HTMLInputElement>(`#setw ${held.sel}`); if (el) { el.focus({ preventScroll: true }); try { if (held.s !== null) el.setSelectionRange(held.s, held.e); } catch {} } }
  held = null;
  if (M.focus) { const el = document.getElementById(M.focus) as HTMLElement | null; M.focus = ""; el?.focus(); }
  schedule();
}

// ---- actions ----
async function setEnabled(on: boolean) {
  if (M.toggling || !M.available) return;
  if (!on && !(await D!.ask({ title: "Turn off Custom MCP connections?", body: `Your assistants stop using these tools. Your saved connections are kept, so turning it back on needs no setup. Turning it off can't undo anything already sent to a server.`, confirm: "Turn off" }))) return;
  M.toggling = true; D!.repaint();
  try { setAll(await call("custom-mcp/settings", "PUT", { enabled: on })); if (!on) { M.adding = false; M.key = ""; M.f = blank(); } }
  catch (e) { D!.note(false, "Couldn't save that", msg(e)); }
  finally { M.toggling = false; M.focus = ""; D!.repaint(); }
}
function openAdd() { M.adding = true; M.f = blank(); M.key = ""; M.focus = "cmcp-name"; D!.repaint(); }
function closeAdd() { M.adding = false; M.f = blank(); M.key = ""; D!.repaint(); }
async function submit() {
  const f = M.f; if (f.busy) return;
  const keyEl = document.getElementById("cmcp-key") as HTMLInputElement | null; if (keyEl) M.key = keyEl.value;
  const fail = (field: string, err: string) => { f.field = field; f.err = err; M.focus = field === "key" ? "cmcp-key" : `cmcp-${field}`; D!.repaint(); };
  const name = f.name.replace(/\s+/g, " ").trim(); if (!name) return fail("name", "Give it a name so you can tell it apart.");
  const bad = checkUrl(f.url); if (bad) return fail("url", bad);
  if (f.auth === "api_key" && !M.key.trim()) return fail("key", "Paste the API key.");
  const auth: any = f.auth === "api_key" ? { type: "api_key", key: M.key.trim(), ...(f.header.trim() ? { header: f.header.trim() } : {}), ...(f.template.trim() ? { template: f.template.trim() } : {}) } : { type: f.auth };
  // One id per attempt: a retry (or a double press) of the same request reuses it; a changed request gets its own.
  const sig = JSON.stringify([name, f.url.trim(), auth]); if (!f.rid || f.sig !== sig) { f.rid = rid(); f.sig = sig; }
  f.busy = true; f.err = ""; f.field = ""; D!.repaint();
  try {
    const d = await call("custom-mcp/servers", "POST", { client_request_id: f.rid, name, url: f.url.trim(), auth });
    M.key = ""; M.adding = false; M.f = blank();   // the key is gone from this page the moment it has been sent
    if (d?.server) upsert(d.server);
    if (d?.authorize_url) { D!.note(true, "Opening the sign-in page", "Finish signing in there, then you come back here."); D!.go(String(d.authorize_url)); return; }
    D!.repaint();
  } catch (e) { f.busy = false; f.err = msg(e); f.field = ""; D!.repaint(); }
}
async function authorize(id: string) {
  if (M.busy[id]) return; M.busy[id] = "auth"; delete M.err1[id]; D!.repaint();
  try { const d = await call(`custom-mcp/servers/${encodeURIComponent(id)}/authorize`, "POST"); if (!d?.authorize_url) throw new Error("The server didn't give a sign-in page. Try again."); D!.go(String(d.authorize_url)); }
  catch (e) { M.err1[id] = msg(e); } finally { delete M.busy[id]; D!.repaint(); }
}
async function refresh(id: string) {
  if (M.busy[id]) return; M.busy[id] = "refresh"; delete M.err1[id]; delete M.since[id]; M.slow.delete(id); D!.repaint();
  try { const d = await call(`custom-mcp/servers/${encodeURIComponent(id)}/refresh`, "POST"); if (d?.server) upsert(d.server); }
  catch (e) { M.err1[id] = msg(e); } finally { delete M.busy[id]; D!.repaint(); }
}
async function remove(id: string) {
  const s = M.servers.find(x => x.id === id); if (!s || M.busy[id]) return;
  if (!(await D!.ask({ title: `Disconnect ${clip(s.name, 60)}?`, body: "Your assistants won't be able to use its tools anymore. You can add it again later. Disconnecting can't undo anything already sent to it.", confirm: "Disconnect", danger: true }))) return;
  M.busy[id] = "rm"; delete M.err1[id]; D!.repaint();
  try { const d = await call(`custom-mcp/servers/${encodeURIComponent(id)}`, "DELETE"); if (d?.server && d.server.status === "removing") { upsert(d.server); delete M.busy[id]; } else drop(id); }
  catch (e) { delete M.busy[id]; M.err1[id] = msg(e); }
  D!.repaint();
}

export function cmcpInit(d: Deps) {
  D = d;
  document.addEventListener("click", e => {
    if (!D!.shown()) return;
    const t = e.target as HTMLElement, by = (sel: string) => t.closest?.<HTMLElement>(sel);
    if (by("[data-cmcp-retry]")) { e.preventDefault(); M.err = ""; load(true); D!.repaint(); return; }
    if (by("[data-cmcp-toggle]")) { e.preventDefault(); setEnabled(!M.enabled); return; }
    if (by("[data-cmcp-add]")) { e.preventDefault(); openAdd(); return; }
    if (by("[data-cmcp-cancel]")) { e.preventDefault(); closeAdd(); return; }
    if (by("[data-cmcp-hdr]")) { e.preventDefault(); M.f.hdr = !M.f.hdr; const k = document.getElementById("cmcp-key") as HTMLInputElement | null; if (k) M.key = k.value; M.focus = M.f.hdr ? "cmcp-header" : ""; D!.repaint(); return; }
    const a = by("[data-cmcp-auth]"); if (a) { e.preventDefault(); authorize(a.dataset.cmcpAuth!); return; }
    const r = by("[data-cmcp-refresh]"); if (r) { e.preventDefault(); refresh(r.dataset.cmcpRefresh!); return; }
    const x = by("[data-cmcp-rm]"); if (x) { e.preventDefault(); remove(x.dataset.cmcpRm!); return; }
    const o = by("[data-cmcp-tools]"); if (o) { e.preventDefault(); const id = o.dataset.cmcpTools!; if (!M.tools.delete(id)) M.tools.add(id); D!.repaint(); return; }
  });
  document.addEventListener("input", e => {
    const el = e.target as HTMLInputElement; if (!D!.shown() || !el?.matches) return;
    if (el.matches("[data-cmcp-key]")) { M.key = el.value; return; }
    if (el.matches("[data-cmcp-f]")) { (M.f as any)[el.dataset.cmcpF!] = el.value; if (M.f.field === el.dataset.cmcpF) { M.f.field = ""; M.f.err = ""; document.getElementById("cmcp-err")?.remove(); el.removeAttribute("aria-invalid"); } }
  });
  document.addEventListener("change", e => {
    const el = e.target as HTMLInputElement; if (!D!.shown() || !el?.matches?.("[data-cmcp-auth-pick]")) return;
    const k = document.getElementById("cmcp-key") as HTMLInputElement | null; if (k) M.key = k.value;
    M.f.auth = el.value as Auth; M.f.err = ""; M.f.field = ""; if (M.f.auth !== "api_key") M.key = ""; D!.repaint();
    (document.querySelector<HTMLInputElement>(`[data-cmcp-auth-pick][value="${M.f.auth}"]`))?.focus();
  });
  document.addEventListener("submit", e => { const f = e.target as HTMLElement; if (!D!.shown() || !f?.matches?.("[data-cmcp-form]")) return; e.preventDefault(); submit(); });
}

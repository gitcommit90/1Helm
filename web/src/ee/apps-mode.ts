// Settings → Connected accounts → "How apps connect" (10-06, 1HC composio-upgrade part 2): the switch between Managed (1Helm's Composio
// account, the default) and Self-managed (the person's own Composio account, signed in with Composio). It says plainly that apps get
// reconnected once on the new side. Server (1HC src/index.js, src/composio-self.js):
//   GET  <api>/apps/mode → { mode, available, signin: "none" | "ok" | "ended", who, managed_left, signin_url }
//   POST <api>/apps/mode { mode } → { ok, mode } | { need_signin, url } (Self-managed without a sign-in: Composio's sign-in, then back here
//        switched) | { error };  { op: "clear_managed" } → { ok, removed } (the apps still on 1Helm's account after switching to Self-managed)
//   GET  <api>/apps also carries { mode, ended } so the connect buttons know which side they're on before this section ever opens.
// Self-managed connects open Composio's own page in a new tab (it can't send the person back); v3.ts appConnect asks cmNewTab().
type Deps = {
  api: () => string | null;                      // "/w/<slug>/api"
  helper: () => string;                          // "Skipper"
  ask: (o: { title: string; body?: string; confirm?: string; danger?: boolean }) => Promise<boolean>;
  note: (title: string, sub: string, good?: boolean) => void;
  repaint: () => void;                           // Settings, if this section is open
  reloadApps: () => void;                        // the connected-apps list (the side changed)
  go: (url: string) => void;                     // leave for Composio's sign-in
};
let D: Deps | null = null;
export const CM: { mode: "" | "managed" | "self"; available: boolean; signin: "none" | "ok" | "ended"; who: string; left: number; url: string; at: number; busy: string; loaded: boolean } =
  { mode: "", available: true, signin: "none", who: "", left: 0, url: "", at: 0, busy: "", loaded: false };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>`;
const row = (title: string, sub: string, right: string, attrs = "") => `<div class="sr"${attrs}><span class="srt"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</span>${right}</div>`;
const btn = (label: string, attr: string, cls = "") => `<button type="button" class="sa${cls ? " " + cls : ""}" ${attr}>${label}</button>`;
const on = (t: string) => `<span class="sok">${CHECK}${t}</span>`;

export function cmInit(deps: Deps) { D = deps; }
export const cmMode = () => CM.mode;
// Self-managed connects (except the Composio sign-in itself) open in a new tab.
export const cmNewTab = (app: string) => CM.mode === "self" && app !== "composio";
// From GET /apps: the side, and a sign-in that ended.
export function cmSet(d: { mode?: string; ended?: boolean } | null) {
  if (!d) return; const was = `${CM.mode}|${CM.signin}`;
  if (d.mode === "self" || d.mode === "managed") CM.mode = d.mode;
  if (d.ended) CM.signin = "ended";
  if (was !== `${CM.mode}|${CM.signin}`) D?.repaint();
}
async function api(path: string, body?: any) {
  const r = await fetch(`${D!.api()}/${path}`, body ? { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" });
  const d = await r.json().catch(() => ({})); if (!r.ok && !d.error) throw new Error(`Something went wrong (${r.status}).`); return d;
}
export function cmLoad(force = false) {
  if (!D?.api() || (!force && Date.now() - CM.at < 15000)) return; CM.at = Date.now();
  api("apps/mode").then(d => { if (d.error) return; CM.mode = d.mode === "self" ? "self" : "managed"; CM.available = d.available !== false; CM.signin = d.signin || "none"; CM.who = d.who || ""; CM.left = Number(d.managed_left) || 0; CM.url = d.signin_url || ""; CM.loaded = true; D!.repaint(); })
    .catch(() => { CM.at = 0; });
}

// The section, at the top of Settings → Connected accounts.
export function cmHtml() {
  cmLoad();
  if (!CM.loaded && !CM.mode) return "";
  const self = CM.mode === "self", ended = self && CM.signin !== "ok", busy = CM.busy;
  const managedRight = !self ? on("On") : btn(busy === "managed" ? "Switching…" : "Switch", `data-cmmode="managed"${busy ? " disabled" : ""}`, "blue");
  const selfRight = self ? (ended ? btn("Sign in again", `data-cmsignin${busy ? " disabled" : ""}`, "blue") : on("On"))
    : !CM.available ? `<span class="sval">Not available yet</span>` : btn(busy === "self" ? "Switching…" : "Switch", `data-cmmode="self"${busy ? " disabled" : ""}`, "blue");
  const selfSub = self ? (ended ? "Your Composio sign-in ended. Sign in again so your helper can use your apps." : `Your own Composio account${CM.who ? ` · ${esc(CM.who)}` : ""}`) : "Your own Composio account. Free, set up takes ~10 seconds with a Google Account.";
  const left = self && CM.left ? row(`${CM.left} app${CM.left === 1 ? "" : "s"} still on 1Helm's account`, "Connected before you switched. They aren't used while you're on Self-managed.", btn(busy === "clear" ? "Removing…" : "Remove them", `data-cmclear${busy ? " disabled" : ""}`, "mute"), " data-cmleft") : "";
  return `<h3>How apps connect</h3><div class="sc cmsec">${row("Managed", "Runs on 1Helm's Composio account. Nothing to set up.", managedRight, ` data-cmrow="managed"${!self ? " data-on" : ""}`)}${row("Self-managed", selfSub, selfRight, ` data-cmrow="self"${self ? " data-on" : ""}`)}${left}</div>
    <p class="sfine cmfine">Switching? Your apps get reconnected once on the new side. Both are free and reach the same apps.</p><h3>Your apps</h3>`;
}

async function switchTo(mode: "managed" | "self") {
  const h = D!.helper();
  const yes = mode === "self"
    ? await D!.ask(CM.signin === "ok"
      ? { title: "Switch to Self-managed?", body: `Your apps will run on your own Composio account${CM.who ? ` (${CM.who})` : ""}. You'll reconnect each app once there. Apps connected on 1Helm's account aren't used while you're on Self-managed.`, confirm: "Switch" }
      : { title: "Switch to Self-managed?", body: `You'll sign in to your own Composio account (free), then reconnect your apps once there. Until you do, ${h} can't use your apps.`, confirm: "Sign in with Composio" })
    : await D!.ask({ title: "Switch to Managed?", body: `Your apps will run on 1Helm's Composio account. You'll reconnect each app once there. Your own Composio account and its connections stay as they are.`, confirm: "Switch" });
  if (!yes) return;
  CM.busy = mode; D!.repaint();
  try {
    const d = await api("apps/mode", { mode });
    if (d.need_signin && d.url) { D!.go(d.url); return; }
    if (d.error) { D!.note("Couldn't switch", d.error); return; }
    CM.mode = mode; CM.at = 0; cmLoad(true); D!.reloadApps();
    D!.note(mode === "self" ? "Switched to Self-managed" : "Switched to Managed", `Reconnect your apps once on this side, and ${h} can use them again.`, true);
  } catch (e: any) { D!.note("Couldn't switch", e?.message || "Try again in a minute."); }
  finally { CM.busy = ""; D!.repaint(); }
}
async function clearManaged() {
  if (!(await D!.ask({ title: "Remove apps on 1Helm's account?", body: "They're deleted at Composio right away. Your own Composio account isn't touched.", confirm: "Remove", danger: true }))) return;
  CM.busy = "clear"; D!.repaint();
  try { const d = await api("apps/mode", { op: "clear_managed" }); if (d.error) D!.note("Couldn't remove them", d.error); else { CM.left = 0; D!.note("Removed", `${d.removed || 0} app${d.removed === 1 ? "" : "s"} deleted from 1Helm's Composio account.`, true); } }
  catch (e: any) { D!.note("Couldn't remove them", e?.message || "Try again in a minute."); }
  finally { CM.busy = ""; D!.repaint(); }
}
// A click in Settings: true when it was this section's.
export function cmClick(t: HTMLElement): boolean {
  if (!D) return false;
  const m = t.closest<HTMLElement>("[data-cmmode]"); if (m) { if (!CM.busy) switchTo(m.dataset.cmmode === "self" ? "self" : "managed"); return true; }
  if (t.closest("[data-cmsignin]")) { if (CM.url) D.go(CM.url); return true; }
  if (t.closest("[data-cmclear]")) { if (!CM.busy) clearManaged(); return true; }
  return false;
}
// Back from Composio's sign-in (?cmp=ok | failed&cmperr=…): say what happened. → true when it handled one.
export function cmBack(sp: URLSearchParams): boolean {
  const st = sp.get("cmp"); if (!st || !D) return false;
  CM.at = 0; cmLoad(true); D.reloadApps();
  if (st === "ok") D.note("Signed in to Composio", `${D.helper()} uses your own Composio account now. Connect your apps once there.`, true);
  else D.note("Composio sign-in didn't finish", sp.get("cmperr") || "Nothing changed. Try again.");
  return true;
}

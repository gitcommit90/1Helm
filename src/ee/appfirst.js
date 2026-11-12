// Connected app first, and no going round in circles.
// The helper decided the connected Google Calendar app "couldn't" do reminders, opened Google's sign-in in the browser, filled the
// the person's username and handed them the browser to type their Google password, for a service that was already connected. On the way
// it searched the app's actions 4 times, brought the same lists back 4 times and opened the same page twice.
//
// 1. Connected app note: browser_navigate / browser_task / browser_fill_login / browser_handoff aimed at the sign-in page or web app
//    of a service the account has a connected app for RUNS, and one short line is added to its result ("<App> is also connected …"),
//    unless the person's own words in this task ask for the website (then no line). Never a refusal. Both engines.
// 2. Repeats within one turn (both engines; each is a "no progress" signal for the runaway watch, spendguard.js):
//    - app_actions for the same app (and account) with a near-identical want, while the earlier list is still in context;
//    - bring_back of an app's action list while a list for that app is already in context;
//    - browser_navigate to the same URL as the last one, with nothing done in the browser since.
//    - work_log opening the same saved result (or a near-identical work_log search) while the earlier one is still in context;
//    - bring_back / work_log of something already loaded twice in this turn (restored, then set aside again: eval run2 10-07,
//      wide-research/small-list-inline went round 15 work_log + 30 bring_back calls, each restored copy set aside and restored again,
//      and never made the table). A restored copy's own key counts as the original (bring_back of a bring_back).
//    Each answers "You already have this … (from step N): …" and runs nothing.
import { personWords } from "../person-asked.js";

// Pause and step-limit reports (spendguard.js pauseAsk, stop.js STEP_LIMIT_CHAT_ASK): facts only. The 10-06 pause report repeated
// the wrong plan ("you need to sign in") for an app that was already connected.
export const PAUSE_FACTS = "Don't offer a new plan or tell them what they need to do unless a tool result in this task showed it works; a guess is not a fact.";

// A call's identity: tool + arguments with keys sorted at every level (a JSON string or an object; step_title left out).
// integration-hint.js marks a call it answered without running (tc.unrun); spendguard.js guardTools skips it.
const stable = (v) => Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v ?? null);
export function callKey(name, args) {
  let a = args; if (typeof a === "string") { try { a = JSON.parse(a || "{}"); } catch { a = { raw: a }; } }
  if (a && typeof a === "object" && !Array.isArray(a) && "step_title" in a) { const { step_title, ...rest } = a; a = rest; }
  return `${name}:${stable(a ?? {})}`;
}

// ---- 1. which connected app a web address belongs to ----
const GOOGLE = ["gmail", "googlecalendar", "googledrive", "googledocs", "googlesheets", "googleslides", "googletasks", "googlemeet", "googlephotos", "googlesuper"];
const G = (...apps) => [...apps, "googlesuper"];
// host: exact host or any subdomain of it. path: only these paths. signin: a shared sign-in page (any app of that family counts).
const SITES = [
  { host: "accounts.google.com", signin: GOOGLE },
  { host: "mail.google.com", apps: G("gmail") }, { host: "gmail.com", apps: G("gmail") },
  { host: "calendar.google.com", apps: G("googlecalendar") },
  { host: "drive.google.com", apps: G("googledrive") },
  { host: "docs.google.com", path: /^\/document/, apps: G("googledocs", "googledrive") },
  { host: "docs.google.com", path: /^\/spreadsheets/, apps: G("googlesheets", "googledrive") },
  { host: "docs.google.com", path: /^\/presentation/, apps: G("googleslides", "googledrive") },
  { host: "docs.google.com", apps: G("googledocs", "googlesheets", "googleslides", "googledrive") },
  { host: "sheets.google.com", apps: G("googlesheets") }, { host: "slides.google.com", apps: G("googleslides") },
  { host: "tasks.google.com", apps: G("googletasks") }, { host: "meet.google.com", apps: G("googlemeet") }, { host: "photos.google.com", apps: G("googlephotos") },
  { host: "login.live.com", signin: ["outlook"] }, { host: "login.microsoftonline.com", signin: ["outlook"] },
  { host: "outlook.live.com", apps: ["outlook"] }, { host: "outlook.office.com", apps: ["outlook"] }, { host: "outlook.office365.com", apps: ["outlook"] },
  { host: "slack.com", apps: ["slack"] },
  { host: "notion.so", apps: ["notion"] }, { host: "notion.com", apps: ["notion"] },
  { host: "github.com", path: /^\/(login|session|sessions)(\/|$)/, apps: ["github"] },   // the rest of github.com is public reading
  { host: "dropbox.com", apps: ["dropbox"] }, { host: "linear.app", apps: ["linear"] }, { host: "app.asana.com", apps: ["asana"] },
  { host: "trello.com", apps: ["trello"] }, { host: "airtable.com", apps: ["airtable"] }, { host: "todoist.com", apps: ["todoist"] },
];
const onHost = (h, site) => h === site || h.endsWith(`.${site}`);
const asUrl = (s) => { const t = String(s || "").trim(); if (!t) return null; try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`); } catch { return null; } };
// A saved-login site name ("google.com", "accounts.google.com") for browser_fill_login: the whole site, so paths don't matter.
const SITE_ALIASES = { "google.com": "accounts.google.com", "microsoft.com": "login.live.com", "live.com": "login.live.com", "microsoftonline.com": "login.microsoftonline.com" };

const NEXT_PARAMS = ["continue", "followup", "redirect_uri", "redirect_url", "return_to"];
const isSigninHost = (h) => SITES.some((x) => x.signin && onHost(h, x.host));
// The first address a sign-in page leads to that is not itself a shared sign-in page, looking through up to 3 sign-in pages. null: none.
function nextTarget(u, depth = 0) {
  for (const k of NEXT_PARAMS) {
    const v = u.searchParams.get(k), nu = v && asUrl(v); if (!nu) continue;
    if (!isSigninHost(nu.hostname.toLowerCase())) return v;
    if (depth < 3) { const deeper = nextTarget(nu, depth + 1); if (deeper) return deeper; }
  }
  return null;
}

// Pages of a service's own site where a person signs in or works, named after the connected app: dashboard.stripe.com for the app "stripe".
// Only these (the public pages of stripe.com, docs and the like, stay open): a host label from this list, or a sign-in path.
const OWN_SITE_LABEL = /^(dashboard|app|admin|login|auth|accounts?|my|portal|manage|console|secure)$/;
const OWN_SITE_PATH = /^\/(login|signin|sign-in|sign_in|log-in|dashboard|register)(\/|$)/;
const compactName = (x) => String(x || "").toLowerCase().replace(/_mcp$/, "").replace(/[^a-z0-9]/g, "");
export function ownSiteFor(u, live) {
  const parts = u.hostname.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length < 2) return null;
  const tail = parts.length > 2 && parts.at(-1).length === 2 && parts.at(-2).length <= 3 ? 3 : 2;   // example.co.uk
  const reg = parts.at(-tail), sub = parts.slice(0, -tail);
  if (!(sub.length && sub.every((x) => OWN_SITE_LABEL.test(x))) && !OWN_SITE_PATH.test(u.pathname)) return null;
  for (const [app, name] of live) if (compactName(app) === reg || compactName(name) === reg) return { app, name };
  return null;
}

// → { app, name } of the connected app this address belongs to, or null. conns: Resident.conns() rows.
export function connectedServiceFor(target, conns = [], { site = false, depth = 0 } = {}) {
  const live = new Map(); for (const c of conns || []) if (c.status === "connected" && !live.has(c.app)) live.set(c.app, c.name || c.app);
  if (!live.size) return null;
  let u = asUrl(target); if (!u) return null;
  let h = u.hostname.toLowerCase().replace(/^www\./, "");
  if (site && SITE_ALIASES[h]) h = SITE_ALIASES[h];
  for (const s of SITES) {
    if (!onHost(h, s.host) || (!site && s.path && !s.path.test(u.pathname))) continue;
    if (s.signin) {
      // A shared sign-in page on its way to somewhere specific (?continue=…, ?redirect_uri=…) belongs to that place: YouTube's sign-in isn't
      // Calendar's, and "Sign in with Google" on another site (Stripe's dashboard) isn't Gmail's. The place can sit behind another sign-in
      // address (a Google sign-in whose ?continue= is Google's consent page whose redirect_uri is the other site), so follow up to 3 hops.
      const next = !site && depth < 3 && nextTarget(u, depth);
      if (next) return connectedServiceFor(next, conns, { depth: depth + 1 });
      const app = s.signin.find((a) => live.has(a)); if (app) return { app, name: live.get(app), signin: true };
      continue;
    }
    const app = s.apps.find((a) => live.has(a)); if (app) return { app, name: live.get(app) };
  }
  { const own = ownSiteFor(u, live); if (own) return own; }   // a connected app's own dashboard or sign-in page that SITES doesn't list
  return null;
}

// Did the person ask for the website themselves? words: what they said in this task (this turn's message and steers, earlier turns).
const WEB_ASK = /\b(browser|chrome|web ?site|web ?page|web ?app|web version|on the web|the site|sign(ing)? ?in(to)?|log(ging)? ?in(to)?|login)\b/i;
export function askedForWebsite(words = [], target = "") {
  const host = asUrl(target)?.hostname.toLowerCase().replace(/^www\./, "") || "";
  return words.some((w) => { const s = String(w || ""); return WEB_ASK.test(s) || (host && s.toLowerCase().includes(host)); });
}
// The person's own words in this task: this turn (message + steers read) and the task's earlier chat turns.
export function taskWords(res, tc) {
  const out = personWords(tc);
  if (tc?.session && tc.kind === "chat") { try { for (const r of res.sql.exec("SELECT user_text FROM turns WHERE session=? AND kind='chat' AND id<>? ORDER BY at DESC LIMIT 8", tc.session, tc.turn || "").toArray()) if (r.user_text) out.push(String(r.user_text)); } catch {} }
  return out;
}
// One short line added to a browser result: the service also has a connected app. Never a refusal ("log into my reddit account
// on your browser" was once refused with "Reddit is connected; use app_actions"; an explicit request to use the website always runs).
export const appFirstText = (name) => `Note: ${name} is also connected, and its actions (app_actions, then app_run) can do the same thing without the website.`;

// The note for a browser call, or null. It never blocks: the caller runs the call and appends the note to its result.
// target: the address the call is about (its url, the saved-login site, or the open page).
export async function appFirstNote(res, tc, name, target, opts = {}) {
  if (!target || !res.env?.COMPOSIO_KEY) return null;
  let conns = []; try { conns = await res.conns(); } catch { return null; }
  const svc = connectedServiceFor(target, conns, opts); if (!svc) return null;
  if (askedForWebsite(taskWords(res, tc), target)) return null;   // they asked for the website: nothing to add
  if (tc) (tc.appFirst ||= []).push({ tool: name, app: svc.app });
  return appFirstText(svc.name);
}
// Remember a note on the task context; the tool runner appends it to the call's result (takeAppNote).
export async function noteAppFirst(res, tc, name, target, opts = {}) {
  const t = await appFirstNote(res, tc, name, target, opts); if (t && tc) addAppNote(tc, t);
}
export function addAppNote(tc, text) { if (tc && text && !(tc.appNotes ||= []).includes(text)) tc.appNotes.push(text); }
// → the result with the pending notes appended (one line each), and clears them.
export function takeAppNote(tc, r) {
  const n = tc?.appNotes; if (!n?.length) return r; tc.appNotes = [];
  const add = "\n" + n.join("\n");
  return typeof r === "string" ? r.replace(/\n*$/, "") + add : r && typeof r === "object" ? { ...r, out: String(r.out ?? "").replace(/\n*$/, "") + add } : r;
}

// ---- 2. repeats within one turn ----
const STOPW = new Set("a an the to for of on in at with and or by from it its this that my me i some any into".split(" "));
export const wantWords = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOPW.has(w)).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)));
export function nearSame(A, B) {
  if (!A.size || !B.size) return A.size === B.size;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n) >= 0.6 || (Math.min(A.size, B.size) >= 3 && n / Math.min(A.size, B.size) >= 0.8);
}
const rep = (tc) => (tc.rep ||= { lists: [], byId: new Map(), nav: null, moved: false, page: "", loads: new Map(), rootOf: new Map(), wlq: [] });
const listKey = (a) => `${String(a.app || "").toLowerCase().replace(/super$/, "")}|${String(a.account || "").toLowerCase()}|${String(a.cursor || "")}`;   // another page of the same list is not a repeat
const wantOf = (a) => a.want ?? a.query ?? a.search ?? a.use_case ?? "";
const inContext = (tc, id) => !tc.wmAside?.has?.(id);
const stepOf = (tc) => tc.callNo || 0;
const NOT_A_LIST = /^(error|NOT |ASK FIRST)/m;   // an error, not connected, or ask-first answer (work-log notes may come first)
export const REPEAT_TAIL = "pick an action and run it with app_run.";

// True when browser_navigate to this address would be refused as a repeat of the page this turn already opened (nothing has changed since).
// The caller then reads the task's own tab and passes it to repeatBlock, so a reload is never refused while that tab shows something else.
export function navRepeatPending(tc, a = {}) {
  const st = tc && rep(tc), url = normUrl(a.url);
  return !!(st && url && st.nav && st.nav.url === url && !st.moved);
}
// Before a call: the nudge (and a "no progress" mark for the runaway watch), or null to run it.
// live (browser_navigate only): the task's own tab as it is now, { known: true, url }. Without it, or when the tab could not be read, the turn's own record decides.
export function repeatBlock(tc, name, a = {}, live = null) {
  if (!tc) return null;
  const st = rep(tc);
  if (name === "app_actions") {
    const key = listKey(a), w = wantWords(wantOf(a));
    const prev = st.lists.filter((e) => e.key === key && nearSame(e.words, w));
    if (!prev.length) return null;
    const shown = prev.filter((e) => inContext(tc, e.id)).at(-1);
    if (shown) return noProgress(tc, `You already have this list (from step ${shown.n}): ${REPEAT_TAIL} If you need a different kind of action, search for that in different words.`);
    const last = prev.at(-1);
    return noProgress(tc, `You already have this list (from step ${last.n}); it was set aside to save room, so bring_back("${last.id}") shows it again. Then ${REPEAT_TAIL}`);
  }
  if (name === "bring_back") {
    const e = st.byId.get(String(a.key || ""));
    if (e) { const shown = st.lists.filter((x) => x.key === e.key && inContext(tc, x.id)).at(-1); if (shown) return noProgress(tc, `You already have this list (from step ${shown.n}): ${REPEAT_TAIL}`); }
    return loadedAgain(tc, st, rootKey(st, a.key), "bring_back");
  }
  if (name === "work_log") {
    const open = String(a.open || "").trim();
    if (open) return loadedAgain(tc, st, rootKey(st, open), "work_log");
    const q = wlQuery(a); if (!q.words.size) return null;
    const prev = st.wlq.filter((x) => x.tool === q.tool && x.account === q.account && nearSame(x.words, q.words) && inContext(tc, x.id)).at(-1);
    return prev ? noProgress(tc, `You already have this work log list (from step ${prev.n}): open a key from it, or do the next step.`) : null;
  }
  if (name === "browser_navigate") {
    const url = normUrl(a.url);
    if (!url || !st.nav || st.nav.url !== url || st.moved) return null;
    if (live?.known) { const cur = normUrl(live.url); if (!cur || (cur !== st.nav.url && cur !== st.nav.shown)) return null; }   // the tab is on another page (or has none): opening it again is not a repeat
    return noProgress(tc, `You already have this page (from step ${st.nav.n})${st.page ? `: ${st.page}` : ""}. Opening it again shows the same thing: read it with browser_snapshot, act on it, or do the job another way.`);
  }
  return null;
}
// After a call ran: remember what it put in context.
export function repeatNote(tc, name, a = {}, out = "") {
  if (!tc) return;
  const st = rep(tc), id = tc.callId || `n${stepOf(tc)}`, s = typeof out === "string" ? out : String(out?.out ?? "");
  if (name === "app_actions" && s.trim() && !NOT_A_LIST.test(s.slice(0, 400))) { const e = { key: listKey(a), words: wantWords(wantOf(a)), n: stepOf(tc), id }; st.lists.push(e); st.byId.set(id, e); }
  else if (name === "bring_back" && /^\[restored /.test(s)) {
    const src = st.byId.get(String(a.key || "")); if (src) { const e = { ...src, n: stepOf(tc), id }; st.lists.push(e); st.byId.set(id, e); }
    loaded(tc, st, rootKey(st, a.key), id, 2);   // the original was in context once already; this is its second load
  }
  else if (name === "work_log" && s.trim() && !/^error/.test(s)) {
    if (String(a.open || "").trim()) loaded(tc, st, rootKey(st, a.open), id, 1);
    else { const q = wlQuery(a); if (q.words.size) st.wlq.push({ ...q, n: stepOf(tc), id }); }
  }
  else if (name === "browser_navigate") { st.nav = { url: normUrl(a.url), n: stepOf(tc), shown: normUrl((/Page: ([^\n]{1,400})/.exec(s) || [])[1]?.split(" — ").pop()) }; st.moved = false; st.page = (/Page: ([^\n]{1,200})/.exec(s) || [])[1] || ""; }   // shown: where the page ended up (a redirect), the address the tab reports
  else if (/^browser_(act|fill_login|fill_card|task|handoff)$/.test(name)) st.moved = true;
}
// Loads of one piece of content in this turn (its first load, a re-open, a bring_back), keyed by its root: a saved work-log result
// ("wl:wl5") or the original call's id. A restored copy's key maps back to its root.
const rootKey = (st, key) => { const k = String(key || "").trim(); if (/^wl\d+$/i.test(k)) return `wl:${k.toLowerCase()}`; return st.rootOf.get(k) || k; };
function loaded(tc, st, root, id, min) { if (!root) return; const e = st.loads.get(root); st.loads.set(root, { n: stepOf(tc), id, loads: Math.max(min, (e?.loads || 0) + 1) }); st.rootOf.set(id, root); }
function loadedAgain(tc, st, root, tool) {
  const e = root && st.loads.get(root); if (!e) return null;
  if (inContext(tc, e.id)) return noProgress(tc, `You already have this (from step ${e.n}); it's still in front of you. Read it there and do the next step${tool === "work_log" ? " (don't open it again)" : ""}.`);
  if (e.loads >= 2) return noProgress(tc, `You brought this back already (step ${e.n}) and it was set aside again because there isn't room for everything at once. Don't load it again: take the facts you need from what's in front of you, put them in your answer (or your to-do list) now, and finish what they asked.`);
  return null;
}
const wlQuery = (a) => ({ tool: String(a.tool || "").toLowerCase(), account: String(a.account || "").toLowerCase(), words: wantWords(a.query) });
export function normUrl(u) { const x = asUrl(u); if (!x) return ""; x.hash = ""; return x.href.replace(/\/$/, ""); }
// A repeat counts toward the runaway watch's "no progress" signs (spendguard.js RUNAWAY.noProgress).
function noProgress(tc, text) { if (tc.guard?.watch) tc.guard.watch.noProgress = (tc.guard.watch.noProgress || 0) + 1; tc.repeats = (tc.repeats || 0) + 1; return text; }

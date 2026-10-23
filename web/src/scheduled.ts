// Scheduled: ONE place for everything set to happen later, across every channel. The side panel's "Scheduled N" (bottom left),
// the phone drawer and the channel sheet all open #/<slug>/scheduled[/repeats|events|coming-up|send-later]. Five sections, each hidden
// when it's empty, and one plain empty state when all of them are:
//   Repeats     recurring jobs/checks the helper runs (active or paused)        Pause / Resume · Stop
//   When something happens   workflows the person asked for that run when an app event happens (a new Gmail from X…;
//               job.on = the event in plain words, job.account = which account): Pause / Resume · Stop (1HC turns the event
//               off / on / deletes it at Composio)
//   Coming up   one-time follow-ups the helper set for itself                    Cancel
//   Send later  messages queued with the composer's clock (send-later.ts owns    Edit time · Send now · Cancel (Retry)
//               them; their buttons are its data-sl* buttons, handled there)
//   Past        jobs and follow-ups that ended (status complete / failed: stopped by the person, finished, stopped after errors,
//               canceled, app event removed); job.ended = when, job.why = plain reason. No buttons, not counted in "Scheduled N".
// Jobs come from boot / the poll (channel.jobs: id, kind "workflow" | "followup", status, next…); Pause/Resume/Stop/Cancel go to
// POST /res/<slug>/workflow-status. Old or guessed links (#/<slug>/schedules, /later, /follow-ups, #/scheduled…) redirect here.
import { ask } from "./dialog";
import { slAll, whenShort, cap, errText } from "./send-later";

type Job = { id?: number; kind?: string; name: string; every?: number; when?: string | null; next?: number | null; runs?: number; status: string; session?: string | null; on?: string | null; account?: string | null; ended?: number; why?: string };
type Ch = { slug: string; name: string; jobs: Job[] };
type Deps = {
  live: boolean;
  api: (path: string, body?: any) => Promise<any>;
  channels: () => Ch[];
  helper: (slug: string) => string;
  task: (slug: string, sid: string) => string | null;   // a task's title, for "In “…”"
  note: (title: string, sub: string) => void;
  open: (slug: string, sid: string) => void;
  changed: () => void;                                   // jobs changed here: repaint counts + the view
};
let D: Deps | null = null;

export const SECS = ["repeats", "events", "coming-up", "send-later", "past"] as const;
type Sec = typeof SECS[number];
const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const svg = (d: string, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  clock: (s = 18) => svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', s),
  repeat: svg('<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5"/>'),
  bell: svg('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  send: svg('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>'),
  bolt: svg('<path d="M13 2 4.5 13.5H12L11 22l8.5-11.5H12L13 2Z"/>'),
  warn: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>', 14),
};
const every = (s = 0) => !s ? "Repeats" : s % 86400 === 0 ? (s === 86400 ? "Daily" : `Every ${s / 86400} days`) : s % 3600 === 0 ? (s === 3600 ? "Hourly" : `Every ${s / 3600} hours`) : `Every ${Math.round(s / 60)} min`;
const BUSY: Record<string, string> = {};
let seq = 0;

// ---------- what's scheduled ----------
type JRow = { slug: string; ch: Ch; j: Job; ref: string };
function jobs() {
  const rep: JRow[] = [], up: JRow[] = [], ev: JRow[] = [], past: JRow[] = [];
  for (const ch of D?.channels() || []) for (const j of ch.jobs || []) {
    if (j.id == null) j.id = -(++seq);   // the design sandbox's seed jobs have no id (and an old server didn't send one)
    const r = { slug: ch.slug, ch, j, ref: `${ch.slug}|${j.id}` };
    if (j.status === "complete" || j.status === "failed") past.push(r);
    else if (j.kind === "followup") { if (j.status === "active") up.push(r); }
    else if (j.status === "active" || j.status === "paused") (j.on ? ev : rep).push(r);
  }
  const by = (a: JRow, b: JRow) => (a.j.status === "paused" ? 1 : 0) - (b.j.status === "paused" ? 1 : 0) || (a.j.next || 9e15) - (b.j.next || 9e15) || a.j.name.localeCompare(b.j.name);
  return { past: past.sort((a, b) => (b.j.ended || 0) - (a.j.ended || 0)), rep: rep.sort(by), up: up.sort(by), ev: ev.sort((a, b) => (a.j.status === "paused" ? 1 : 0) - (b.j.status === "paused" ? 1 : 0) || a.j.name.localeCompare(b.j.name)) };
}
export function schCount() { const { rep, up, ev } = jobs(); return rep.length + ev.length + up.length + slAll().length; }
// Live jobs can be changed only with a real id (an old server's boot sent none). The sandbox changes its own seed jobs in place.
const can = (j: Job) => !D?.live || (j.id ?? -1) > 0;

// ---------- the view ----------
const chTag = (slug: string, name: string, here: string) => slug !== here ? `<span class="schch">${esc(name)}</span>` : "";
function repRow(r: JRow, here: string) {
  const { j } = r, paused = j.status === "paused", b = BUSY[r.ref], dis = b ? " disabled" : "";
  const when = j.on ? `When ${j.on}` : j.when || every(j.every);
  const sub = j.on
    ? [paused ? "Won't run when it happens until you resume it" : "Runs each time it happens", j.account ? `Watching ${j.account}` : "", j.runs ? `Ran ${j.runs} ${j.runs === 1 ? "time" : "times"}` : ""].filter(Boolean).join(" · ")
    : [paused ? "Won't run until you resume it" : j.next ? `Next ${whenShort(j.next)}` : "", j.runs ? `Ran ${j.runs} ${j.runs === 1 ? "time" : "times"}` : ""].filter(Boolean).join(" · ");
  const main = `<span class="schw${paused ? " off" : ""}">${paused ? "Paused · " : ""}${esc(when)}</span><span class="schx">${esc(j.name)}</span><span class="schk">${esc(sub)}${chTag(r.slug, r.ch.name, here)}</span>`;
  return `<div class="schrow${paused ? " paused" : ""}" data-schid="${esc(r.ref)}">${j.session ? `<button type="button" class="schm" data-schgo="${esc(r.slug)}|${esc(j.session)}" title="Open its task">${main}</button>` : `<div class="schm">${main}</div>`}
    ${can(j) ? `<span class="scha">${paused ? `<button type="button" class="schb" data-schset="${esc(r.ref)}|active"${dis}>${b === "active" ? "Resuming…" : "Resume"}</button>` : `<button type="button" class="schb" data-schset="${esc(r.ref)}|paused"${dis}>${b === "paused" ? "Pausing…" : "Pause"}</button>`}<button type="button" class="schb" data-schstop="${esc(r.ref)}"${dis}>${b === "complete" ? "Stopping…" : "Stop"}</button></span>` : ""}</div>`;
}
function upRow(r: JRow, here: string) {
  const { j } = r, b = BUSY[r.ref], t = j.session ? D?.task(r.slug, j.session) : null;
  const main = `<span class="schw">${esc(j.next ? cap(whenShort(j.next)) : "Soon")}</span><span class="schx">${esc(j.name)}</span><span class="schk">${t ? `Follow-up in “${esc(t)}”` : "Follow-up"}${chTag(r.slug, r.ch.name, here)}</span>`;
  return `<div class="schrow" data-schid="${esc(r.ref)}">${j.session ? `<button type="button" class="schm" data-schgo="${esc(r.slug)}|${esc(j.session)}" title="Open its task">${main}</button>` : `<div class="schm">${main}</div>`}
    ${can(j) ? `<span class="scha"><button type="button" class="schb" data-schcancel="${esc(r.ref)}"${b ? " disabled" : ""}>${b ? "Canceling…" : "Cancel"}</button></span>` : ""}</div>`;
}
function pastRow(r: JRow, here: string) {
  const { j } = r, d = j.ended ? new Date(j.ended) : null, day = d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }) : "";
  const when = j.kind === "followup" ? "Follow-up" : j.on ? `When ${j.on}` : j.when || every(j.every);
  const sub = [j.why || "Ended", day, j.runs ? `Ran ${j.runs} ${j.runs === 1 ? "time" : "times"}` : ""].filter(Boolean).join(" · ");
  const main = `<span class="schw off">${esc(when)}</span><span class="schx">${esc(j.name)}</span><span class="schk">${esc(sub)}${chTag(r.slug, r.ch.name, here)}</span>`;
  return `<div class="schrow past" data-schid="${esc(r.ref)}">${j.session ? `<button type="button" class="schm" data-schgo="${esc(r.slug)}|${esc(j.session)}" title="Open its task">${main}</button>` : `<div class="schm">${main}</div>`}</div>`;
}
function slRow(slug: string, x: any, here: string) {
  const ref = `${slug}|${x.id}`, f = x.status === "failed", dis = x.busy ? " disabled" : "", name = D?.channels().find(c => c.slug === slug)?.name || slug;
  const what = x.text || (x.files || []).map((y: any) => y.name).join(", ") || "Message";
  const main = `<span class="schw${f ? " bad" : ""}">${f ? `${IC.warn}Couldn't send` : esc(cap(whenShort(x.due)))}</span><span class="schx">${esc(what)}</span><span class="schk">${f ? `${esc(errText(x.error))} · ` : ""}${x.new_task ? "Starts a new task" : `In “${esc(x.task || "a task")}”`}${chTag(slug, name, here)}</span>`;
  return `<div class="schrow${f ? " fail" : ""}${x.tmp ? " tmp" : ""}" data-slid="${esc(ref)}"><button type="button" class="schm" ${x.session ? `data-slgo="${esc(slug)}|${esc(x.session)}" title="Open its task"` : `data-sledit="${esc(ref)}" title="Edit time"`}${x.tmp ? " disabled" : ""}>${main}</button>
    <span class="scha">${x.tmp ? `<span class="schwait">Scheduling…</span>` : `<button type="button" class="schb" data-sledit="${esc(ref)}"${dis}>Edit time</button><button type="button" class="schb" data-slnow="${esc(ref)}"${dis}>${x.busy === "send" ? "Sending…" : f ? "Retry" : "Send now"}</button><button type="button" class="schb" data-slcancel="${esc(ref)}"${dis}>${x.busy === "cancel" ? "Canceling…" : "Cancel"}</button>`}</span></div>`;
}
function section(id: Sec, icon: string, title: string, sub: string, rows: string[]) {
  return rows.length ? `<section class="schsec" id="sch-${id}" aria-label="${esc(title)}"><div class="schh"><span class="schi">${icon}</span><h2>${esc(title)}</h2><b>${rows.length}</b></div>${sub ? `<p class="schp">${esc(sub)}</p>` : ""}<div class="schlist">${rows.join("")}</div></section>` : "";
}
function body(here: string) {
  const { rep, up, ev, past } = jobs(), sl = slAll(), who = D?.helper(here) || "Your helper";
  const old = section("past", IC.clock(16), "Past", "", past.map(r => pastRow(r, here)));   // ended jobs: below the empty state too
  if (!rep.length && !ev.length && !up.length && !sl.length) return `<div class="schempty"><span class="schei">${IC.clock(26)}</span><h2>Nothing scheduled</h2><p>Ask ${esc(who)} to check something every morning or to follow up later, or tap the clock in the message box to send a message later. It all shows up here.</p></div>` + old;
  return section("repeats", IC.repeat, "Repeats", `Checks and jobs ${who} runs again and again.`, rep.map(r => repRow(r, here)))
    + section("events", IC.bolt, "When something happens", `Jobs you asked ${who} to do when something happens in one of your apps.`, ev.map(r => repRow(r, here)))
    + section("coming-up", IC.bell, "Coming up", `One-time follow-ups ${who} set for itself.`, up.map(r => upRow(r, here)))
    + section("send-later", IC.send, "Send later", "Messages you wrote that go out at the time you picked.", sl.map(a => slRow(a.slug, a.x, here))) + old;
}
export function schPage(here: string) {
  return `<div class="dhome" id="scroll"><div class="lwrap schwrap"><div class="lhead"><span class="lh-all">${IC.clock(24)}</span><div class="lht"><h1>Scheduled</h1><p>Everything set to happen later, in every channel.</p></div></div>
    <div id="schbody" data-here="${esc(here)}">${body(here)}</div></div></div>`;
}
// The open view follows every change: the poll, Send later, an action here. (Nav entries show no count.)
export function schPaint() {
  const el = document.getElementById("schbody"); if (!el) return;
  const h = body(el.dataset.here || ""); if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
}
// After the view renders: a section link (#/<slug>/scheduled/send-later) scrolls to it and flashes it once.
export function schAfter(sec: string | null) {
  const el = document.getElementById("schbody"); if (el) el.dataset.h = el.innerHTML;
  if (!sec) return; const s = document.getElementById(`sch-${sec}`); if (!s) return;
  s.scrollIntoView({ block: "start" }); s.classList.remove("flash"); void s.offsetWidth; s.classList.add("flash");
}

// ---------- routes ----------
export const isSch = (hash = location.hash) => /^#\/[^/?]+\/scheduled(\/|$)/.test(hash);
export const schSec = (hash = location.hash) => { const m = hash.match(/^#\/[^/?]+\/scheduled\/([^/?]+)/); return m && (SECS as readonly string[]).includes(m[1]) ? m[1] : null; };
// Names people (or older builds and notes) might use for either list → the section they mean.
const ALIAS: [RegExp, Sec][] = [[/^(schedules?|jobs|workflows|repeats|recurring|checks)$/, "repeats"], [/^(events?|triggers?|when|app-events?|when-something-happens)$/, "events"], [/^(follow-?ups?|reminders?|coming-?up|upcoming)$/, "coming-up"], [/^(later|send-?later|scheduled-messages|queued)$/, "send-later"], [/^(past|ended|archive|stopped)$/, "past"]];
const secOf = (x?: string) => x ? ALIAS.find(([re]) => re.test(x))?.[1] ?? null : null;
// The hash to show instead, or null. isCh says whether a slug is a channel; home is where a channel-less link goes.
export function schRedirect(hash: string, isCh: (slug: string) => boolean, home: string): string | null {
  const m = hash.match(/^#\/([^/?]+)(?:\/([^/?]+))?(?:\/([^/?]+))?/); if (!m) return null;
  const [, a, b, c] = m;
  if (!isCh(a) && (a === "scheduled" || secOf(a))) { const s = a === "scheduled" ? (SECS as readonly string[]).includes(b || "") ? b : secOf(b) : secOf(a); return `#/${home}/scheduled${s ? `/${s}` : ""}`; }
  if (!isCh(a)) return null;
  if (b === "scheduled") return c && !(SECS as readonly string[]).includes(c) ? `#/${a}/scheduled${secOf(c) ? `/${secOf(c)}` : ""}` : null;
  const s = secOf(b); return s ? `#/${a}/scheduled/${s}` : null;
}

// ---------- actions on a job ----------
function findJob(ref: string) { const i = ref.lastIndexOf("|"), slug = ref.slice(0, i), id = Number(ref.slice(i + 1)); const ch = D?.channels().find(c => c.slug === slug); const j = ch?.jobs.find(x => x.id === id); return ch && j ? { ch, j, slug, id } : null; }
async function setStatus(ref: string, status: "active" | "paused" | "complete") {
  const f = findJob(ref); if (!f || !D || BUSY[ref]) return; const { ch, j, slug, id } = f, fu = j.kind === "followup";
  BUSY[ref] = status; D.changed();
  try {
    let d: any = { ...j, status };
    if (D.live) { d = await D.api(`/res/${slug}/workflow-status`, { id, status }); if (!d || d.error) throw new Error(d?.error === "payment_required" ? "Your plan needs attention first." : d?.error || "Try again in a minute."); }
    if (status === "complete") { j.status = "complete"; j.ended = Date.now(); j.why = fu ? "Canceled" : "Stopped by you"; j.next = null; }   // moves to Past now; the poll confirms
    else { j.status = d.status || status; if (d.next_run) j.next = Number(d.next_run); }
    D.note(fu ? "Follow-up canceled" : status === "paused" ? "Paused" : status === "active" ? "Resumed" : "Stopped",
      `“${j.name}” ${fu || status === "complete" ? "won't run." : status === "paused" ? (j.on ? "won't run when it happens until you resume it." : "won't run until you resume it.") : j.on ? "runs again each time it happens." : j.next ? `runs next ${whenShort(j.next)}.` : "is back on."}`);
  } catch (e: any) { D.note(fu ? "Couldn't cancel it" : status === "paused" ? "Couldn't pause it" : status === "active" ? "Couldn't resume it" : "Couldn't stop it", e?.message || "Try again in a minute."); }
  delete BUSY[ref]; D.changed();
}

export function schInit(deps: Deps) {
  D = deps;
  document.addEventListener("click", async e => {
    const t = e.target as HTMLElement;
    const st = t.closest<HTMLElement>("[data-schset]"); if (st) { e.preventDefault(); const v = st.dataset.schset!, i = v.lastIndexOf("|"); setStatus(v.slice(0, i), v.slice(i + 1) as "active" | "paused"); return; }
    const cn = t.closest<HTMLElement>("[data-schcancel]"); if (cn) { e.preventDefault(); setStatus(cn.dataset.schcancel!, "complete"); return; }
    const sp = t.closest<HTMLElement>("[data-schstop]"); if (sp) { e.preventDefault(); const ref = sp.dataset.schstop!, f = findJob(ref); if (!f) return;
      if (await ask({ title: `Stop “${f.j.name}”?`, body: `It won't run again${f.j.on ? ", and your app stops sending it that event" : ""}. You can ask ${D!.helper(f.slug)} to set it up again any time.`, confirm: "Stop", danger: true })) setStatus(ref, "complete"); return; }
    const go = t.closest<HTMLElement>("[data-schgo]"); if (go) { e.preventDefault(); const v = go.dataset.schgo!, i = v.indexOf("|"); D!.open(v.slice(0, i), v.slice(i + 1)); return; }
  });
}

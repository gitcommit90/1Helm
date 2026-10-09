// Send later: the iMessage "Send Later" for tasks. A clock in both composers (#box in a task or on Home, #nbox in New task), next
// to the mic. Tap it → a picker (a popover on desktop, a bottom sheet on phone): In 1 hour, Tonight 7 PM (hidden once it's
// late), Tomorrow morning 9 AM, Monday 9 AM, or a date + time of your own (a small calendar and 15-minute times). The composer then
// shows the time and its send button reads "Send Fri 9:00 AM"; sending schedules it (with any attached files) instead of sending now.
// The server (1HC send-later.js) keeps it and, at that time, posts it into the task as the person's own message (Home / New task:
// a new task then). Until then it shows in the task as a pending bubble (Edit time · Send now · Cancel) and in the "Send later"
// section of the one Scheduled view (scheduled.ts renders that list from slAll(); its buttons are handled here).
// Times are the person's: the browser's zone (the same one boot sends 1HC). Stored as UTC; DST-safe (wallToUtc, same rule as 1HC).
// No native dialogs or datetime inputs. v3.ts only hooks in: slBtn() next to the mic, slGate()/slSchedule() in the two sends,
// slBubbles() under a task's messages, slSentNote() on a message that was sent on schedule, slAll() for the Scheduled view,
// slSet() from boot and the poll, and slInit() once in live mode.
export type SlItem = { id: number; session: string | null; task: string; new_task: boolean; text: string; files: any[]; due: number; tz?: string; status: "pending" | "failed"; error: string | null; created?: number; tmp?: boolean; busy?: string };
type Key = "box" | "nbox";
type Target = { slug: string; session: string | null };   // session: a task id, "new" (Home / New task), or null (not ready yet)
type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  phone: () => boolean;
  note: (title: string, sub: string, action?: string) => void;
  dragToClose: (el: HTMLElement, close: () => void) => void;
  target: (key: Key) => Target | null;
  channels: () => { slug: string; name: string }[];
  current: () => { slug: string; session: string | null };   // what's on screen
  repaint: (slug: string, session: string | null) => void;    // that task's messages (and the side drawer) changed
  reload: (slug: string, session: string) => void;            // that task got a new message from the server
  open: (slug: string, session: string) => void;
  lists?: () => void;                                         // the list changed: the Scheduled view and its counts repaint
};
let D: Deps | null = null;

// ---------- time, in the person's zone ----------
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();
const MIN = 60e3, STEP = 15;
type P = { y: number; m: number; d: number; h: number; mi: number; wd: number };
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function parts(ms: number, tz = TZ): P {
  const p: any = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month - 1, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd: WD.indexOf(p.weekday) };
}
// Wall clock in tz → UTC ms. Skipped times (spring forward) move ahead by the gap; repeated ones (fall back) are the first.
export function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, tz = TZ) {
  const want = Date.UTC(y, mo, d, h, mi);
  const off = (t: number) => { const p = parts(t, tz); return Date.UTC(p.y, p.m, p.d, p.h, p.mi) - t; };
  const t1 = want - off(want), t2 = want - off(t1);
  const c = [...new Set([t1, t2, want - off(want - 864e5), want - off(want + 864e5)])].filter(t => t + off(t) === want).sort((a, b) => a - b);
  return c.length ? c[0] : Math.max(t1, t2);
}
const dayKey = (p: { y: number; m: number; d: number }) => p.y * 400 + p.m * 32 + p.d;
const addDays = (p: { y: number; m: number; d: number }, n: number) => { const g = new Date(Date.UTC(p.y, p.m, p.d + n)); return { y: g.getUTCFullYear(), m: g.getUTCMonth(), d: g.getUTCDate() }; };
const hm = (h: number, mi: number) => `${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
const hmShort = (h: number, mi: number) => mi ? hm(h, mi) : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// "today 3:45 PM" · "tomorrow 9:00 AM" · "Fri 9:00 AM" (this week) · "Oct 19, 9:00 AM"
export function whenShort(ms: number, now = Date.now()) {
  const p = parts(ms), n = parts(now), dd = (dayKey(p) === dayKey(n)) ? 0 : dayKey(p) === dayKey(addDays(n, 1)) ? 1 : 9;
  const days = Math.round((Date.UTC(p.y, p.m, p.d) - Date.UTC(n.y, n.m, n.d)) / 864e5);
  return dd === 0 ? `today ${hm(p.h, p.mi)}` : dd === 1 ? `tomorrow ${hm(p.h, p.mi)}` : days > 0 && days < 7 ? `${WD[p.wd]} ${hm(p.h, p.mi)}` : `${MON[p.m]} ${p.d}${p.y !== n.y ? `, ${p.y}` : ""}, ${hm(p.h, p.mi)}`;
}
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const whenLong = (ms: number) => { const p = parts(ms); return `${DAYN[p.wd]}, ${MONTH[p.m]} ${p.d} at ${hm(p.h, p.mi)}`; };
const tzName = (() => { try { const n = new Intl.DateTimeFormat("en-US", { timeZoneName: "longGeneric" as any }).formatToParts(new Date()).find(x => x.type === "timeZoneName")?.value; return n || TZ.replace(/_/g, " "); } catch { return TZ.replace(/_/g, " "); } })();
// The quick picks, from now. Tonight is hidden once it's within half an hour; Monday is hidden when it's tomorrow (same as Tomorrow).
export function quickPicks(now = Date.now()) {
  const n = parts(now), at = (p: { y: number; m: number; d: number }, h: number, mi = 0) => wallToUtc(p.y, p.m, p.d, h, mi);
  const out: { k: string; label: string; due: number; sub: string }[] = [];
  const hour = Math.ceil((now + 60 * MIN) / (5 * MIN)) * 5 * MIN, hp = parts(hour);
  out.push({ k: "hour", label: "In 1 hour", due: hour, sub: `${dayKey(hp) !== dayKey(n) ? `${WD[hp.wd]} ` : ""}${hm(hp.h, hp.mi)}` });
  const tonight = at(n, 19); if (tonight - now > 30 * MIN) out.push({ k: "tonight", label: "Tonight", due: tonight, sub: "7:00 PM" });
  const tm = addDays(n, 1), tmr = at(tm, 9); out.push({ k: "morning", label: "Tomorrow morning", due: tmr, sub: `${WD[parts(tmr).wd]} 9:00 AM` });
  const toMon = ((8 - n.wd) % 7) || 7; if (toMon > 1) { const mo = addDays(n, toMon), md = at(mo, 9); out.push({ k: "monday", label: "Monday", due: md, sub: `${MON[mo.m]} ${mo.d}, 9:00 AM` }); }
  return out;
}

// ---------- state ----------
const ITEMS: Record<string, SlItem[]> = {};
const CHOSEN: Record<Key, { due: number; ctx: string } | null> = { box: null, nbox: null };
let tmpN = 0;
const PK = { open: false, mode: "compose" as "compose" | "edit", key: "box" as Key, edit: null as { slug: string; id: number } | null, view: "quick" as "quick" | "custom",
  btn: null as HTMLElement | null, cal: { y: 0, m: 0 }, day: null as { y: number; m: number; d: number } | null, t: -1 };
const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const svg = (d: string, s = 16, w = 1.75) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  clock: (s = 18) => svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', s),
  hour: svg('<path d="M5 12a7 7 0 1 0 2.05-4.95"/><path d="M5 4v3.5h3.5"/><path d="M12 8.5V12l2.5 1.5"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>'),
  sun: svg('<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'),
  week: svg('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h3"/>'),
  cal: svg('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 15), back: svg('<path d="m15 6-6 6 6 6"/>', 16), fwd: svg('<path d="m9 6 6 6-6 6"/>', 16),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>', 15), x2: svg('<path d="M18 6 6 18M6 6l12 12"/>', 13, 2),
  send: svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', 14, 2), warn: svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>', 14),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>', 14),
};
const pickIcon: Record<string, string> = { hour: IC.hour, tonight: IC.moon, morning: IC.sun, monday: IC.week };
export const slAll = () => all();   // every pending message, across channels, soonest first (the Scheduled view's Send later section)
const all = () => Object.entries(ITEMS).flatMap(([slug, l]) => l.map(x => ({ slug, x }))).sort((a, b) => a.x.due - b.x.due || a.x.id - b.x.id);
const chName = (slug: string) => D?.channels().find(c => c.slug === slug)?.name || slug;
export const errText = (e: string | null) => e === "read_only" ? "Your plan needs attention, so it wasn't sent." : e || "It didn't go through.";

// ---------- the composer: a clock button next to the mic ----------
export function slBtn(key: Key) {
  return `<button type="button" class="cbtn slbtn" data-sl="${key}" title="Send later" aria-label="Send later" aria-haspopup="dialog">${IC.clock(18)}</button>`;
}
const ctxOf = (key: Key) => { const t = D?.target(key); return t ? `${t.slug}|${t.session}` : ""; };
function chosen(key: Key) { const c = CHOSEN[key]; if (c && c.ctx !== ctxOf(key)) CHOSEN[key] = null; return CHOSEN[key]; }
// Paint every composer from CHOSEN (idempotent; a re-render redraws them plain).
function paintComposers() {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-sl]")) {
    const key = b.dataset.sl as Key, c = chosen(key), form = b.closest("form") as HTMLElement | null; if (!form) continue;
    const on = !!c, label = c ? `Send ${whenShort(c.due)}` : "";
    b.classList.toggle("on", on); b.setAttribute("aria-label", on ? `Scheduled: ${whenLong(c!.due)}. Change` : "Send later"); b.title = on ? "Change the time" : "Send later";
    form.classList.toggle("sl-on", on);
    let chip = form.querySelector<HTMLElement>(".slchip");
    if (on) {
      const html = `<button type="button" class="slchip-t" data-slpick="${key}" title="Change the time">${IC.clock(15)}<span>${esc(cap(whenShort(c!.due)))}</span></button><button type="button" class="slchip-x" data-slclear="${key}" aria-label="Don't schedule" title="Don't schedule">${IC.x2}</button>`;
      if (!chip) { chip = document.createElement("div"); chip.className = "slchip"; form.prepend(chip); }
      if (chip.dataset.h !== html) { chip.innerHTML = html; chip.dataset.h = html; }
    } else chip?.remove();
    const go = form.querySelector<HTMLButtonElement>(key === "nbox" ? "#ngo" : "#go"); if (!go) continue;
    if (key === "box") {
      if (on) { if (go.dataset.slv !== label) { if (go.dataset.slo == null) go.dataset.slo = go.innerHTML; go.innerHTML = `${IC.clock(16)}<span class="slgo-l">${esc(label)}</span>`; go.dataset.slv = label; } go.classList.add("slgo"); go.setAttribute("aria-label", `${label} (scheduled)`); }
      else if (go.dataset.slo != null) { go.innerHTML = go.dataset.slo; delete go.dataset.slo; delete go.dataset.slv; go.classList.remove("slgo"); go.setAttribute("aria-label", "Send"); }
    } else {
      const l = go.querySelector<HTMLElement>(".ngo-l"); if (!l) continue;
      if (on) { if (l.dataset.slo == null) l.dataset.slo = l.textContent || ""; if (l.textContent !== label) l.textContent = label; go.classList.add("slgo"); }
      else if (l.dataset.slo != null) { l.textContent = l.dataset.slo; delete l.dataset.slo; go.classList.remove("slgo"); }
    }
  }
}
// The send handlers ask first: "send" (now, as before), "schedule" (a time is set and still ahead), "stop" (the time passed: pick again).
export function slGate(key: Key): "send" | "schedule" | "stop" {
  const c = chosen(key); if (!c) return "send";
  if (c.due <= Date.now() + 30e3) { D?.note("That time has passed", "Pick a new time, or tap × to send it now."); openPicker(key, document.querySelector<HTMLElement>(`[data-sl="${key}"]`), "compose"); return "stop"; }
  return "schedule";
}
// Schedule what the composer held. The pending bubble shows at once; the server's answer replaces it (or puts the text back).
// reply: the message it replies to (msgreply.ts), sent with it when it goes out (its own task only).
export function slSchedule(key: Key, slug: string, session: string | null, text: string, files: any[], reply: { id: string | null; role: string; text: string } | null = null) {
  const c = chosen(key); if (!c || !D) return;
  const box = document.getElementById(key) as HTMLTextAreaElement | null;
  if (!session) { D.note("This task is still starting", "Try again in a moment."); if (box && !box.value) box.value = text; return; }
  CHOSEN[key] = null; paintComposers();
  const tmp: SlItem = { id: -(++tmpN), session: session === "new" ? null : session, task: "", new_task: session === "new", text, files, due: c.due, status: "pending", error: null, tmp: true };
  (ITEMS[slug] ??= []).push(tmp); changed(slug, tmp.session);
  const cid = (() => { try { return crypto.randomUUID(); } catch { return `sl${Date.now()}${Math.random().toString(36).slice(2)}`; } })();
  D.api(`/res/${slug}/later`, { session, text, files: files.map(f => f.id), due: c.due, tz: TZ, cid, ...(reply && session && session !== "new" ? { reply } : {}) }).then(d => {
    const l = ITEMS[slug] || [], i = l.indexOf(tmp); if (i < 0) return;
    if (d?.error || !d?.item) throw new Error(d?.error === "payment_required" ? "Your plan needs attention before anything can be scheduled." : d?.error || "Try again in a minute.");
    l[i] = d.item; changed(slug, tmp.session);
    if (session === "new" || D!.current().session !== session || D!.current().slug !== slug)
      D!.note("Scheduled", `${cap(whenShort(d.item.due))} · ${session === "new" ? "starts a new task" : `in “${d.item.task}”`}`, `<button class="tview" data-tview="/${esc(slug)}/scheduled/send-later">See scheduled</button>`);
  }).catch(e => {
    ITEMS[slug] = (ITEMS[slug] || []).filter(x => x !== tmp); changed(slug, tmp.session);
    const b = document.getElementById(key) as HTMLTextAreaElement | null; let back = false;
    if (b && !b.value.trim() && text) { b.value = text; b.dispatchEvent(new Event("input", { bubbles: true })); back = true; }
    D!.note("Couldn't schedule that", `${e.message || "Try again in a minute."}${back ? " Your message is back in the box." : ""}`);
  });
}

// ---------- the picker ----------
function openPicker(key: Key, btn: HTMLElement | null, mode: "compose" | "edit", edit: { slug: string; id: number } | null = null) {
  if (!D) return;
  const cur = mode === "edit" ? find(edit!)?.due : chosen(key)?.due;
  Object.assign(PK, { open: true, mode, key, edit, btn, view: "quick", cal: { y: 0, m: 0 } });
  const base = cur && cur > Date.now() ? parts(cur) : null;
  PK.day = base ? { y: base.y, m: base.m, d: base.d } : null; PK.t = base ? base.h * 60 + base.mi : -1;
  let w = document.getElementById("slw"); if (!w) { w = document.createElement("div"); w.id = "slw"; document.body.appendChild(w); }
  w.innerHTML = `<div class="slback" data-slclose></div><div class="slpop" role="dialog" aria-modal="true" aria-labelledby="sltitle">${D.phone() ? `<i class="grab"></i>` : ""}<div class="slin"></div></div>`;
  paintPicker(); btn?.setAttribute("aria-expanded", "true");
  if (D.phone()) D.dragToClose(w.querySelector<HTMLElement>(".slpop")!, () => closePicker());
  requestAnimationFrame(() => requestAnimationFrame(() => w!.classList.add("on")));
  w.querySelector<HTMLElement>(".slq, .slday:not([disabled])")?.focus({ preventScroll: true });
}
function closePicker(focus = true) {
  const w = document.getElementById("slw"); if (!PK.open) return; PK.open = false; PK.btn?.setAttribute("aria-expanded", "false");
  if (focus && D && !D.phone() && PK.mode === "compose") (PK.btn?.isConnected ? PK.btn : document.getElementById(PK.key))?.focus({ preventScroll: true });
  if (!w) return; w.classList.remove("on"); setTimeout(() => { if (!PK.open) w.innerHTML = ""; }, 260);
}
function place() {
  const el = document.querySelector<HTMLElement>("#slw .slpop"), b = PK.btn; if (!el) return;
  if (!D || D.phone() || !b || !b.isConnected) { el.removeAttribute("style"); el.classList.toggle("center", !!D && !D.phone()); return; }
  el.classList.remove("center");
  const r = b.getBoundingClientRect(), W = Math.min(PK.view === "custom" ? 452 : 340, innerWidth - 24), above = r.top > innerHeight - r.bottom;
  el.style.width = `${W}px`; el.style.left = `${Math.max(12, Math.min(r.right - W + 6, innerWidth - W - 12))}px`;
  if (above) { el.style.bottom = `${innerHeight - r.top + 8}px`; el.style.top = ""; el.style.maxHeight = `${Math.min(620, r.top - 20)}px`; el.classList.remove("down"); }
  else { el.style.top = `${r.bottom + 8}px`; el.style.bottom = ""; el.style.maxHeight = `${Math.min(620, innerHeight - r.bottom - 20)}px`; el.classList.add("down"); }
}
const find = (e: { slug: string; id: number }) => (ITEMS[e.slug] || []).find(x => x.id === e.id);
function paintPicker() {
  const w = document.getElementById("slw"), inn = w?.querySelector<HTMLElement>(".slin"); if (!w || !inn || !PK.open) return;
  const cur = PK.mode === "edit" ? find(PK.edit!) : null, c = PK.mode === "compose" ? chosen(PK.key) : null;
  const title = PK.mode === "edit" ? "Change the time" : "Send later";
  const head = `<div class="slhead">${PK.view === "custom" ? `<button type="button" class="slicon" data-slview="quick" aria-label="Back">${IC.back}</button>` : `<span class="slhico">${IC.clock(18)}</span>`}
    <h2 id="sltitle">${PK.view === "custom" ? "Pick a date and time" : title}</h2><button type="button" class="slicon" data-slclose aria-label="Close">${IC.x}</button></div>`;
  let body = "";
  if (PK.view === "quick") {
    const now = Date.now(), was = cur?.due ?? c?.due ?? 0;
    body = `${was ? `<div class="slnow">${PK.mode === "edit" ? "Now set for" : "Scheduled for"} <b>${esc(whenLong(was))}</b>${PK.mode === "compose" ? `<button type="button" class="sllink" data-slclear="${PK.key}">Don't schedule</button>` : ""}</div>` : PK.mode === "compose" ? `<p class="slsub">Write it now, and it goes to your helper at the time you pick.</p>` : ""}
      <div class="slqs" role="group" aria-label="Quick times">${quickPicks(now).map(q => `<button type="button" class="slq${was && Math.abs(was - q.due) < MIN ? " on" : ""}" data-sldue="${q.due}"><span class="slqi">${pickIcon[q.k]}</span><span class="slql">${q.label}</span><span class="slqs2">${esc(q.sub)}</span></button>`).join("")}
      <button type="button" class="slq slqc" data-slview="custom"><span class="slqi">${IC.cal}</span><span class="slql">Pick a date and time</span><span class="slqs2">${IC.chev}</span></button></div>`;
  } else body = customHtml();
  inn.innerHTML = `${head}${body}<p class="sltz">Times are in ${esc(tzName)}</p>`;
  w.querySelector(".slpop")!.classList.toggle("custom", PK.view === "custom");
  place();
  if (PK.view === "custom") { const sel = inn.querySelector<HTMLElement>(".sltime.on") || inn.querySelector<HTMLElement>(".sltime:not([disabled])"); sel?.scrollIntoView({ block: "center", inline: "center" }); }
}
// Custom: a month calendar (past days and >1 year ahead disabled) and the day's times in 15-minute steps (past ones disabled).
function customHtml() {
  const now = Date.now(), n = parts(now), today = { y: n.y, m: n.m, d: n.d }, last = addDays(today, 365);
  const firstSlot = (day: { y: number; m: number; d: number }) => times(day).find(t => !t.off);
  if (!PK.day || dayKey(PK.day) < dayKey(today) || !firstSlot(PK.day)) PK.day = firstSlot(today) ? today : addDays(today, 1);
  if (!PK.cal.y) PK.cal = { y: PK.day.y, m: PK.day.m };
  const ts = times(PK.day);
  if (PK.t < 0 || !ts.some(t => t.min === PK.t && !t.off)) { const pref = dayKey(PK.day) === dayKey(today) ? ts.find(t => !t.off && t.due - now >= 30 * MIN) ?? ts.find(t => !t.off) : ts.find(t => t.min === 9 * 60); PK.t = pref ? pref.min : -1; }
  const { y, m } = PK.cal, lead = new Date(Date.UTC(y, m, 1)).getUTCDay(), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const canPrev = y * 12 + m > n.y * 12 + n.m, canNext = y * 12 + m < last.y * 12 + last.m;
  let cells = ""; for (let i = 0; i < lead; i++) cells += `<span></span>`;
  for (let d = 1; d <= dim; d++) { const k = dayKey({ y, m, d }), off = k < dayKey(today) || k > dayKey(last) || (k === dayKey(today) && !firstSlot(today)), on = PK.day && k === dayKey(PK.day);
    cells += `<button type="button" class="slday${on ? " on" : ""}${k === dayKey(today) ? " today" : ""}" data-slday="${y}-${m}-${d}"${off ? " disabled" : ""} aria-label="${DAYN[new Date(Date.UTC(y, m, d)).getUTCDay()]}, ${MONTH[m]} ${d}"${on ? ' aria-pressed="true"' : ""}>${d}</button>`; }
  const sel = ts.find(t => t.min === PK.t && !t.off), dlab = `${DAYN[new Date(Date.UTC(PK.day.y, PK.day.m, PK.day.d)).getUTCDay()].slice(0, 3)}, ${MON[PK.day.m]} ${PK.day.d}`;
  return `<div class="slcustom"><div class="slcal"><div class="slmon"><button type="button" class="slicon" data-slmon="-1" aria-label="Previous month"${canPrev ? "" : " disabled"}>${IC.back}</button><b>${MONTH[m]} ${y}</b><button type="button" class="slicon" data-slmon="1" aria-label="Next month"${canNext ? "" : " disabled"}>${IC.fwd}</button></div>
      <div class="slwk">${["S", "M", "T", "W", "T", "F", "S"].map(x => `<span>${x}</span>`).join("")}</div><div class="slgrid">${cells}</div></div>
    <div class="sltimes" role="listbox" aria-label="Times on ${esc(dlab)}">${ts.map(t => `<button type="button" role="option" class="sltime${t.min === PK.t && !t.off ? " on" : ""}" data-sltime="${t.min}"${t.off ? " disabled" : ""} aria-selected="${t.min === PK.t && !t.off}">${hmShort(Math.floor(t.min / 60), t.min % 60)}</button>`).join("")}</div></div>
    <div class="slfoot"><span class="slsum">${sel ? `<b>${esc(dlab)}</b> at <b>${hm(Math.floor(sel.min / 60), sel.min % 60)}</b>` : "Pick a time"}</span><button type="button" class="slset" data-slset${sel ? "" : " disabled"}>${PK.mode === "edit" ? "Save" : "Set time"}</button></div>`;
}
// A day's 15-minute times as UTC. A time that doesn't exist that night (spring forward) is left out; past ones are disabled.
function times(day: { y: number; m: number; d: number }) {
  const now = Date.now(), out: { min: number; due: number; off: boolean }[] = [];
  for (let min = 0; min < 1440; min += STEP) { const due = wallToUtc(day.y, day.m, day.d, Math.floor(min / 60), min % 60), p = parts(due);
    if (p.h * 60 + p.mi !== min || p.d !== day.d) continue; out.push({ min, due, off: due <= now + MIN }); }
  return out;
}
function pick(due: number) {
  if (!D) return;
  if (due <= Date.now() + 30e3) { D.note("That time has passed", "Pick a later time."); paintPicker(); return; }
  if (PK.mode === "compose") {
    CHOSEN[PK.key] = { due, ctx: ctxOf(PK.key) }; const key = PK.key; closePicker(false); paintComposers();
    const b = document.getElementById(key) as HTMLTextAreaElement | null; if (b && !D.phone()) b.focus({ preventScroll: true });
    return;
  }
  const e = PK.edit!; closePicker(false); editTime(e.slug, e.id, due);
}

// ---------- pending messages: bubbles in the task, and the Scheduled list ----------
function changed(slug: string, session: string | null) { D?.repaint(slug, session); paintLists(); }
// Server lists from boot / the poll / a refetch. Something that left the list was sent (or canceled elsewhere): its task reloads.
export function slSet(slug: string, items: SlItem[] | undefined) {
  if (!Array.isArray(items)) return;
  const old = ITEMS[slug] || [], tmps = old.filter(x => x.tmp), busy = new Map(old.filter(x => x.busy).map(x => [x.id, x.busy]));
  const sig = (l: SlItem[]) => JSON.stringify(l.filter(x => !x.tmp).map(x => [x.id, x.due, x.status, x.error, x.session, x.text.length]));
  const next = [...items.map(x => busy.has(x.id) ? { ...x, busy: busy.get(x.id) } : x), ...tmps];
  if (sig(old) === sig(next)) return;
  ITEMS[slug] = next;
  const ses = new Set<string | null>([...old, ...next].map(x => x.session));
  for (const s of ses) D?.repaint(slug, s);
  for (const x of old) if (!x.tmp && !next.some(y => y.id === x.id) && x.session) D?.reload(slug, x.session);
  paintLists(); arm();
}
async function refetch(slug: string) { try { const d = await D!.api(`/res/${slug}/later`); if (Array.isArray(d?.items)) slSet(slug, d.items); } catch {} }
// When the soonest one comes due, look again a moment later (the server has sent it), so its bubble turns into the real message.
let dueT = 0;
function arm() {
  clearTimeout(dueT); const nx = all().filter(a => a.x.status === "pending" && !a.x.tmp)[0]; if (!nx) return;
  const wait = Math.min(2 ** 31 - 1, Math.max(1500, nx.x.due - Date.now() + 2500));
  dueT = window.setTimeout(() => { const slugs = new Set(all().filter(a => a.x.due <= Date.now()).map(a => a.slug)); slugs.forEach(s => refetch(s)); setTimeout(arm, 4000); }, wait);
}
const filesHtml = (fs: any[]) => fs.length ? `<div class="slfiles">${fs.map(f => `<span class="slfile">${IC.file}<span>${esc(f.name || "file")}</span></span>`).join("")}</div>` : "";
// The bubbles under a task's messages (oldest due first).
export function slBubbles(slug: string, session: any) {
  const l = (ITEMS[slug] || []).filter(x => x.session && String(x.session) === String(session)).sort((a, b) => a.due - b.due);
  return l.map(x => { const f = x.status === "failed", ref = `${slug}|${x.id}`;
    return `<div class="m user sl-m${f ? " sl-fail" : ""}${x.tmp ? " sl-tmp" : ""}" data-slid="${esc(ref)}">
      <div class="slb"><div class="slb-h">${f ? IC.warn : IC.clock(14)}<span>${f ? "Couldn't send" : `Scheduled · ${esc(cap(whenShort(x.due)))}`}</span></div>${filesHtml(x.files || [])}${x.text ? `<div class="slb-t">${esc(x.text)}</div>` : ""}</div>
      ${f ? `<div class="slb-e">${esc(errText(x.error))}</div>` : ""}
      <div class="slb-a">${x.tmp ? `<span class="slb-w">Scheduling…</span>` : `${f ? `<button type="button" data-slnow="${esc(ref)}"${x.busy ? " disabled" : ""}>${x.busy === "send" ? "Sending…" : "Retry"}</button>` : ""}<button type="button" data-sledit="${esc(ref)}"${x.busy ? " disabled" : ""}>Edit time</button>${f ? "" : `<button type="button" data-slnow="${esc(ref)}"${x.busy ? " disabled" : ""}>${x.busy === "send" ? "Sending…" : "Send now"}</button>`}<button type="button" data-slcancel="${esc(ref)}"${x.busy ? " disabled" : ""}>${x.busy === "cancel" ? "Canceling…" : "Cancel"}</button>`}</div></div>`; }).join("");
}
// A message that went out from Send later (on time, or with Send now) says so, under its bubble.
export const slSentNote = (cid?: string) => cid && /^later:\d+$/.test(cid) ? `<span class="slsent">${IC.clock(12)}Scheduled message</span>` : "";
function paintLists() { D?.lists?.(); }

// ---------- actions on a scheduled message ----------
const parseRef = (r: string) => { const i = r.lastIndexOf("|"); return { slug: r.slice(0, i), id: Number(r.slice(i + 1)) }; };
function setBusy(slug: string, id: number, b: string | undefined) { const x = find({ slug, id }); if (x) { x.busy = b; changed(slug, x.session); } }
function editTime(slug: string, id: number, due: number) {
  const x = find({ slug, id }); if (!x || !D) return;
  const was = x.due; x.due = due; x.status = "pending"; x.error = null; changed(slug, x.session);
  D.api(`/res/${slug}/later/${id}`, { due }).then(d => { if (d?.error) throw new Error(d.error); const l = ITEMS[slug] || [], i = l.findIndex(y => y.id === id); if (i >= 0) l[i] = d.item; changed(slug, x.session); arm(); D!.note("New time set", cap(whenShort(due))); })
    .catch(e => { x.due = was; changed(slug, x.session); D!.note("Couldn't change the time", e.message || "Try again in a minute."); });
}
function sendNow(slug: string, id: number) {
  const x = find({ slug, id }); if (!x || !D || x.busy) return; setBusy(slug, id, "send");
  D.api(`/res/${slug}/later/${id}/send`, {}).then(d => {
    if (d?.error) throw new Error(d.error === "read_only" || d.error === "payment_required" ? "Your plan needs attention, so it can't be sent yet." : d.error);
    ITEMS[slug] = (ITEMS[slug] || []).filter(y => y.id !== id); changed(slug, x.session); arm();
    const sid = d.session?.id || x.session; if (sid) D!.reload(slug, sid);
    if (sid && (D!.current().slug !== slug || D!.current().session !== sid)) D!.note("Sent", d.session?.title ? `In “${d.session.title}”.` : "", `<button class="tview" data-slgo="${esc(slug)}|${esc(sid)}">View task</button>`);
  }).catch(e => { setBusy(slug, id, undefined); D!.note("Couldn't send it", e.message || "Try again in a minute."); refetch(slug); });
}
function cancel(slug: string, id: number) {
  const x = find({ slug, id }); if (!x || !D || x.busy) return; setBusy(slug, id, "cancel");
  D.api(`/res/${slug}/later/${id}/cancel`, {}).then(d => {
    if (d?.error && !/isn't scheduled/.test(d.error)) throw new Error(d.error);
    ITEMS[slug] = (ITEMS[slug] || []).filter(y => y.id !== id); changed(slug, x.session); arm();
    D!.note("Scheduled message canceled", x.text ? `“${x.text.length > 60 ? x.text.slice(0, 58) + "…" : x.text}”` : "");
  }).catch(e => { setBusy(slug, id, undefined); D!.note("Couldn't cancel it", e.message || "Try again in a minute."); });
}

export function slInit(deps: Deps) {
  D = deps;
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const sb = t.closest<HTMLElement>("[data-sl]"); if (sb) { e.preventDefault(); const key = sb.dataset.sl as Key; PK.open && PK.key === key && PK.mode === "compose" ? closePicker() : openPicker(key, sb, "compose"); return; }
    const sp = t.closest<HTMLElement>("[data-slpick]"); if (sp) { e.preventDefault(); const key = sp.dataset.slpick as Key; openPicker(key, sp.closest("form")?.querySelector<HTMLElement>(`[data-sl="${key}"]`) ?? sp, "compose"); return; }
    const sc = t.closest<HTMLElement>("[data-slclear]"); if (sc) { e.preventDefault(); const key = sc.dataset.slclear as Key; CHOSEN[key] = null; if (PK.open) closePicker(false); paintComposers(); (document.getElementById(key) as HTMLElement | null)?.focus({ preventScroll: true }); return; }
    const go = t.closest<HTMLElement>("[data-slgo]"); if (go) { e.preventDefault(); const [slug, sid] = go.dataset.slgo!.split("|"); D!.open(slug, sid); return; }
    const ed = t.closest<HTMLElement>("[data-sledit]"); if (ed) { e.preventDefault(); const r = parseRef(ed.dataset.sledit!); if (find(r)) openPicker(PK.key, ed, "edit", r); return; }
    const nw = t.closest<HTMLElement>("[data-slnow]"); if (nw) { e.preventDefault(); const r = parseRef(nw.dataset.slnow!); sendNow(r.slug, r.id); return; }
    const cn = t.closest<HTMLElement>("[data-slcancel]"); if (cn) { e.preventDefault(); const r = parseRef(cn.dataset.slcancel!); cancel(r.slug, r.id); return; }
    if (!PK.open) return;
    if (t.closest("[data-slclose]")) { e.preventDefault(); closePicker(); return; }
    const q = t.closest<HTMLElement>("[data-sldue]"); if (q) { e.preventDefault(); pick(Number(q.dataset.sldue)); return; }
    const v = t.closest<HTMLElement>("[data-slview]"); if (v) { e.preventDefault(); PK.view = v.dataset.slview as any; if (PK.view === "custom") PK.cal = { y: 0, m: 0 }; paintPicker(); (document.querySelector<HTMLElement>("#slw .slday.on, #slw .slq")?.focus({ preventScroll: true })); return; }
    const mo = t.closest<HTMLElement>("[data-slmon]"); if (mo) { e.preventDefault(); const k = PK.cal.y * 12 + PK.cal.m + Number(mo.dataset.slmon); PK.cal = { y: Math.floor(k / 12), m: k % 12 }; paintPicker(); return; }
    const dy = t.closest<HTMLElement>("[data-slday]"); if (dy) { e.preventDefault(); const [y, m, d] = dy.dataset.slday!.split("-").map(Number); PK.day = { y, m, d }; paintPicker(); document.querySelector<HTMLElement>(`#slw [data-slday="${y}-${m}-${d}"]`)?.focus({ preventScroll: true }); return; }
    const tm = t.closest<HTMLElement>("[data-sltime]"); if (tm) { e.preventDefault(); PK.t = Number(tm.dataset.sltime); const top = document.querySelector("#slw .sltimes")?.scrollTop ?? 0, left = document.querySelector("#slw .sltimes")?.scrollLeft ?? 0; paintPicker(); const st = document.querySelector<HTMLElement>("#slw .sltimes"); if (st) { st.scrollTop = top; st.scrollLeft = left; } document.querySelector<HTMLElement>("#slw .slset")?.focus({ preventScroll: true }); return; }
    if (t.closest("[data-slset]")) { e.preventDefault(); const day = PK.day; if (!day || PK.t < 0) return; pick(wallToUtc(day.y, day.m, day.d, Math.floor(PK.t / 60), PK.t % 60)); return; }
  }, true);
  window.addEventListener("keydown", e => {
    if (!PK.open) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); if (PK.view === "custom") { PK.view = "quick"; paintPicker(); document.querySelector<HTMLElement>("#slw .slq")?.focus(); } else closePicker(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = [...document.querySelectorAll<HTMLElement>("#slw .slq")], i = rows.indexOf(document.activeElement as HTMLElement); if (i < 0) return;
      e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))].focus(); return;
    }
    if (e.key === "Tab") { const f = [...document.querySelectorAll<HTMLElement>("#slw .slpop button:not([disabled])")]; if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
  }, true);
  window.addEventListener("resize", () => { if (PK.open) place(); });
  window.addEventListener("hashchange", () => closePicker(false));
  // Re-renders redraw the composers plain: put the scheduled state back.
  let q = 0; new MutationObserver(() => { if (q) return; q = requestAnimationFrame(() => { q = 0; paintComposers(); }); }).observe(document.body, { childList: true, subtree: true });
  setInterval(() => { if (CHOSEN.box || CHOSEN.nbox) paintComposers(); }, 30e3);   // "today 3:45 PM" stays right past midnight
}

// Focus timer (pomodoro) bound to a task (the server's pomodoro.js). A tomato button in the task header starts one (presets or
// custom minutes); while it runs the button shows a progress ring, mm:ss and the round. When a work round ends, the task shows a
// calm break overlay with a countdown ring (Skip break / Ignore); when the break ends it asks for the next round; after the last
// round a small celebration and a summary. In another task: a small toast that opens the timer's task. A soft Web Audio chime
// (mutable). The helper can offer one: a small card above the composer (Start / No thanks / Don't suggest again).
// The server's state is the truth (session list poll, session detail, stream {t:"pomodoro"}, our own POSTs); between updates the
// app advances it locally from the end time with the same rules, so a phase ends on time here even before the server says so.
// GLOBAL timer (key GK): one per person, not tied to a task or channel (server: /pomodoro/global). Starting from a task asks "This task" or
// "Everything (global)" once; it shows app-wide (rail foot on desktop, header on phone) and in the overlay wherever you are.
// Shortcuts (pomoShortcut, called from v3's one keydown handler): start now at the scope last chosen, pause/resume, stop.
// v3.ts only hooks in: the header slots, pomoSet from the server, pomoSync after repaints, and pomoInit.
import { anchorRect } from "./headfit";
export type PomoTimer = { phase: "work" | "break" | "long" | "ready" | "done"; round: number; rounds: number; ends: number | null; left: number | null; paused: boolean;
  since: number; started: number; work_min: number; break_min: number; long_min: number; focused: number; done_rounds: number; by?: string; now?: number };
export type PomoOffer = { id: number; at: number; work_min: number; break_min: number; long_min: number; rounds: number };
export type PomoView = { timer: PomoTimer | null; offer: PomoOffer | null } | null;
type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  phone: () => boolean;
  current: () => string;                                   // "<slug>|<sid>" of the open task, or ""
  title: (slug: string, sid: string) => string;
  note: (icon: string, title: string, sub: string, action: string) => void;
  dragToClose: (el: HTMLElement, close: () => void) => void;
};
let D: Deps | null = null;
const MIN = 60e3, IDLE_MS = 4 * 3600e3, RUNNING = ["work", "break", "long"];
const S: Record<string, { t: PomoTimer | null; offer: PomoOffer | null; skew: number }> = {};   // "<slug>|<sid>" → server truth
const SEEN: Record<string, string> = {};    // the phase each timer was last seen in (transitions → chime, toast, overlay pop)
const P = { open: "", btn: null as HTMLElement | null, prefs: "" as string, busy: false, form: { preset: "classic", work_min: 25, break_min: 5, long_min: 15, rounds: 4 }, ov: "", pop: false, ask: "" as "" | "scope" | "replace" };
const key = (slug: string, sid: string) => `${slug}|${sid}`;
export const GK = "*|global";                       // the global timer's key in S
const isG = (k: string) => k === GK;
const apiPath = (k: string) => isG(k) ? "/pomodoro/global" : `/res/${k.split("|")[0]}/sessions/${k.split("|")[1]}/pomodoro`;
const SCOPE_KEY = "1h-pomo-scope";                  // the scope the person last chose: "task" | "global" (global until they choose)
const lastScope = (): "task" | "global" => store.get(SCOPE_KEY) === "task" ? "task" : "global";
const esc = (s: any) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const svg = (d: string, s = 16, w = 1.75) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TOMATO = (s = 16) => `<svg class="pmtom" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"><path class="pmtb" d="M12 7.2c4.6 0 8.2 3 8.2 6.9S16.6 21 12 21s-8.2-3-8.2-6.9 3.6-6.9 8.2-6.9z"/><path class="pmtl" d="M12 8.4c-.7-1.6-2.4-2.4-4.3-2 1.2.5 2 1.2 2.3 2.1M12 8.4c.7-1.6 2.4-2.4 4.3-2-1.2.5-2 1.2-2.3 2.1M12 8.2c0-1.8.4-3.2 1.6-4.4"/><path class="pmts" d="M8.2 11.6c-.9.7-1.4 1.6-1.5 2.6"/></svg>`;
const X = '<path d="M18 6 6 18M6 6l12 12"/>', PLAY = '<path d="M7 5.5v13l11-6.5z"/>', PAUSE = '<path d="M8 5v14M16 5v14"/>', SKIP = '<path d="M6 5.5v13l9-6.5z"/><path d="M18 5v14"/>', STOP = '<rect x="6" y="6" width="12" height="12" rx="2.5"/>';
const BELL = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', MUTE = '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>';
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = { get(k: string) { try { return localStorage.getItem(k); } catch { return null; } }, set(k: string, v: string) { try { localStorage.setItem(k, v); } catch {} } };
let muted = store.get("1h-pomo-mute") === "1";
const dismissed = new Set<string>((() => { try { return JSON.parse(store.get("1h-pomo-dismissed") || "[]"); } catch { return []; } })());
function dismiss(k: string) { dismissed.add(k); store.set("1h-pomo-dismissed", JSON.stringify([...dismissed].slice(-40))); }

// ---- the same rules as the server (pomodoro.js advance) ----
const phaseMs = (t: PomoTimer, p: string) => (p === "work" ? t.work_min : p === "break" ? t.break_min : t.long_min) * MIN;
export function advance(t0: PomoTimer | null, now: number): PomoTimer | null {
  if (!t0) return null; const t = { ...t0 };
  for (let i = 0; i < 100 && RUNNING.includes(t.phase) && !t.paused && t.ends != null && t.ends <= now; i++) {
    const at = t.ends;
    if (t.phase === "work") {
      t.focused += phaseMs(t, "work"); t.done_rounds++;
      if (t.round < t.rounds) Object.assign(t, { phase: "break", since: at, ends: at + phaseMs(t, "break") });
      else if (t.long_min > 0) Object.assign(t, { phase: "long", since: at, ends: at + phaseMs(t, "long") });
      else Object.assign(t, { phase: "done", since: at, ends: null });
    } else if (t.phase === "break") Object.assign(t, { phase: "ready", round: t.round + 1, since: at, ends: null });
    else Object.assign(t, { phase: "done", since: at, ends: null });
  }
  if ((t.phase === "ready" || t.phase === "done") && now - t.since >= IDLE_MS) return null;
  return t;
}
const nowOf = (k: string) => Date.now() + (S[k]?.skew || 0);
const cur = (k: string) => advance(S[k]?.t || null, nowOf(k));
const left = (t: PomoTimer, now: number) => t.paused ? (t.left ?? 0) : t.ends != null ? Math.max(0, t.ends - now) : 0;
const total = (t: PomoTimer) => RUNNING.includes(t.phase) ? phaseMs(t, t.phase) : 1;
const pkey = (t: PomoTimer | null) => t ? `${t.started}|${t.round}|${t.phase}` : "";
const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };
const focusWords = (ms: number) => { const m = Math.round(ms / MIN), h = Math.floor(m / 60); return h ? `${h}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`; };
const phaseName = (t: PomoTimer) => t.phase === "work" ? "Focus" : t.phase === "break" ? "Break" : t.phase === "long" ? "Long break" : t.phase === "ready" ? `Round ${t.round} ready` : "Set done";
const roundsLine = (t: PomoTimer) => `${t.done_rounds} round${t.done_rounds === 1 ? "" : "s"} · ${focusWords(t.focused)} focused`;
const LINES = ["Stand up, stretch, look at something far away.", "Refill your water. Your work will be right here.", "Roll your shoulders and breathe out slowly.", "Step away from the screen for a bit.", "Nice focus. Let your mind wander."];

// ---- server truth ----
export function pomoSet(slug: string, sid: any, v: PomoView | undefined) {
  const k = key(slug, String(sid)), t = v?.timer || null, offer = v?.offer || null;
  S[k] = { t, offer, skew: t?.now ? t.now - Date.now() : S[k]?.skew || 0 };
  check(k); paintSlots(k); if (P.open === k) paintPanel(); paintOverlay(); paintOffer();
}
export const pomoTimer = (slug: string, sid: any) => cur(key(slug, String(sid)));
// After the open task repaints (a new task gets its real id from the stream): the header slot follows it; the offer card returns.
export function pomoSync(slug: string, sid: any) {
  const k = key(slug, String(sid));
  document.querySelectorAll<HTMLElement>(".pmw").forEach(w => { if (!w.classList.contains("g") && w.dataset.pmw !== k) { w.dataset.pmw = k; w.dataset.sig = ""; } });
  paintSlots(k); paintOverlay(); paintOffer();
}
// A phase change seen live (not on first load): chime, and a toast when it happened in another task.
function check(k: string) {
  const t = cur(k), pk = pkey(t), was = SEEN[k]; SEEN[k] = pk;
  if (was === undefined || was === pk || !t || t.phase === "work") return;
  if (nowOf(k) - t.since > 90e3) return;   // an old change (a reload, a tab that slept): no fanfare
  chime(t.phase === "long" || t.phase === "done" ? "set" : t.phase === "ready" ? "back" : "break");
  if (k === D?.current() || isG(k)) { P.pop = true; return; }   // the overlay is the news (a global one shows wherever you are)
  const [slug, sid] = k.split("|"), title = D?.title(slug, sid) || "a task", where = isG(k) ? "Global Pomodoro" : `In “${title}”`;
  const [h, sub] = t.phase === "break" ? ["Break time", `${where}: ${t.break_min} min break, round ${t.round} of ${t.rounds} done.`]
    : t.phase === "long" ? ["Set complete", `${where}: ${roundsLine(t)}. Enjoy a long break.`]
    : t.phase === "ready" ? ["Break’s over", `${where}: ready for round ${t.round}?`] : ["Long break’s over", `${where}: start a new set whenever you like.`];
  D?.note(TOMATO(14), h, sub, isG(k) ? "" : `<button class="tview" data-tview="#/${esc(slug)}/s/${esc(sid)}">Open</button>`);
}

// ---- header button ----
function ring(t: PomoTimer, now: number, px: number, r: number, sw: number) {
  const c = 2 * Math.PI * r, f = RUNNING.includes(t.phase) ? left(t, now) / total(t) : 0;
  return `<svg class="pmring" width="${px}" height="${px}" viewBox="0 0 ${2 * r + sw * 2} ${2 * r + sw * 2}" aria-hidden="true"><circle class="pmtrack" cx="${r + sw}" cy="${r + sw}" r="${r}" stroke-width="${sw}"/><circle class="pmfill" cx="${r + sw}" cy="${r + sw}" r="${r}" stroke-width="${sw}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${((1 - f) * c).toFixed(2)}" transform="rotate(-90 ${r + sw} ${r + sw})"/></svg>`;
}
const sigOf = (t: PomoTimer | null) => t ? `${t.phase}|${t.paused}|${t.round}|${t.rounds}` : "none";
function label(t: PomoTimer | null, now: number, g = false) {
  const nm = g ? "Global focus timer" : "Focus timer";
  if (!t) return g ? "Start a global focus timer" : nm;
  return RUNNING.includes(t.phase) ? `${nm}: ${phaseName(t).toLowerCase()}${t.phase === "work" ? `, round ${t.round} of ${t.rounds}` : ""}, ${clock(left(t, now))} left${t.paused ? ", paused" : ""}` : `${nm}: ${phaseName(t).toLowerCase()}`;
}
function btnInner(k: string, phone: boolean) {
  const t = cur(k), now = nowOf(k), open = P.open === k, cls = t ? ` ph-${t.phase}${t.paused ? " paused" : ""}` : " idle";
  const g = isG(k), attrs = `data-pomo="${esc(k)}" aria-label="${esc(label(t, now, g))}" aria-haspopup="dialog" aria-expanded="${open}"${g ? ` title="${t ? "Global Pomodoro" : "Start a global Pomodoro"}"` : ""}`;
  if (g && !gShown()) return "";
  if (phone) {
    if (!t) return `<button class="cb pmbtn m idle${open ? " on" : ""}" ${attrs}>${TOMATO(22)}</button>`;
    const inner = RUNNING.includes(t.phase) ? `${ring(t, now, 42, 18, 2)}<b class="pmt">${clock(left(t, now))}</b>` : `${TOMATO(22)}${t.phase === "ready" ? `<i class="pmdot"></i>` : ""}`;
    return `<button class="cb pmbtn m${cls}${open ? " on" : ""}" ${attrs}>${inner}</button>`;
  }
  if (!t) return `<button class="pmbtn idle${open ? " on" : ""}" ${attrs} title="Focus timer">${TOMATO(17)}</button>`;
  if (!RUNNING.includes(t.phase)) return `<button class="pmbtn${cls}${open ? " on" : ""}" ${attrs}>${TOMATO(16)}<b class="pmt">${t.phase === "ready" ? `Round ${t.round}` : "Set done"}</b></button>`;
  return `<button class="pmbtn${cls}${open ? " on" : ""}" ${attrs}>${ring(t, now, 20, 8, 2.4)}${t.paused ? `<span class="pmpz">${svg(PAUSE, 11, 2.6)}</span>` : ""}<b class="pmt">${clock(left(t, now))}</b>${t.phase === "work" ? `<span class="pmr">${t.round}/${t.rounds}</span>` : `<span class="pmr">${t.phase === "long" ? "long break" : "break"}</span>`}</button>`;
}
// The header slot (always there, so the button can change live).
// The global timer's slot (rail foot on desktop, header on phone): always there, but empty inside a task unless a global timer exists.
const gShown = () => !!cur(GK) || !D?.current();
export function pomoGlobalBtn(phone = false) {
  const k = GK; return `<span class="pmw g${phone ? " m" : ""}" data-pmw="${k}" data-sig="${esc(sigOf(cur(k)) + (gShown() ? "|s" : "|h") + (P.open === k ? "|o" : ""))}">${btnInner(k, phone)}</span>`;
}
export function pomoBtn(slug: string, sid: any, phone = false) {
  const k = key(slug, String(sid));
  return `<span class="pmw${phone ? " m" : ""}" data-pmw="${esc(k)}" data-sig="${esc(sigOf(cur(k)) + (P.open === k ? "|o" : ""))}">${btnInner(k, phone)}</span>`;
}
function paintSlots(only?: string) {
  document.querySelectorAll<HTMLElement>(".pmw").forEach(w => {
    const k = w.dataset.pmw!; if (only && k !== only) return;
    const t = cur(k), now = nowOf(k), sig = sigOf(t) + (isG(k) ? (gShown() ? "|s" : "|h") : "") + (P.open === k ? "|o" : ""), phone = w.classList.contains("m");
    if (w.dataset.sig !== sig || (!w.firstElementChild && !(isG(k) && !gShown()))) { const fresh = w.dataset.sig && w.dataset.sig !== sig; w.dataset.sig = sig; w.innerHTML = btnInner(k, phone); if (fresh) w.firstElementChild?.classList.add("fresh"); if (P.open === k) P.btn = w.firstElementChild as HTMLElement; return; }
    if (!t || !RUNNING.includes(t.phase) || !w.firstElementChild) return;
    const b = w.firstElementChild as HTMLElement, tt = b.querySelector(".pmt"); if (tt) tt.textContent = clock(left(t, now));
    b.setAttribute("aria-label", label(t, now, isG(k)));
    const f = b.querySelector<SVGCircleElement>(".pmfill"); if (f) { const c = Number(f.getAttribute("stroke-dasharray")); f.setAttribute("stroke-dashoffset", ((1 - left(t, now) / total(t)) * c).toFixed(2)); }
  });
}

// ---- panel: start form / controls (popover on desktop, bottom sheet on phone) ----
const PRESETS = [{ id: "classic", name: "Classic", work_min: 25, break_min: 5, long_min: 15, rounds: 4 }, { id: "deep", name: "Deep work", work_min: 50, break_min: 10, long_min: 20, rounds: 3 }, { id: "quick", name: "Quick", work_min: 15, break_min: 3, long_min: 10, rounds: 4 }];
const LIM: Record<string, [number, number, string]> = { work_min: [1, 180, "Work"], break_min: [1, 60, "Break"], long_min: [0, 120, "Long break"], rounds: [1, 12, "Rounds"] };
function stepper(f: string) {
  const [lo, hi, name] = LIM[f], v = (P.form as any)[f];
  return `<div class="pmstep"><span>${name}</span><div class="pmsc"><button type="button" data-pmstep="${f}|-1" aria-label="Less ${name.toLowerCase()}" ${v <= lo ? "disabled" : ""}>−</button>
    <input type="number" inputmode="numeric" min="${lo}" max="${hi}" value="${v}" data-pmin="${f}" aria-label="${name}${f === "rounds" ? "" : " minutes"}"><button type="button" data-pmstep="${f}|1" aria-label="More ${name.toLowerCase()}" ${v >= hi ? "disabled" : ""}>+</button></div><em>${f === "rounds" ? "" : "min"}</em></div>`;
}
function bigRing(t: PomoTimer, now: number, px: number) {
  const r = 52, c = 2 * Math.PI * r, f = RUNNING.includes(t.phase) ? left(t, now) / total(t) : t.phase === "done" ? 1 : 0;
  return `<div class="pmbig" style="width:${px}px;height:${px}px"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="pmtrack" cx="60" cy="60" r="${r}"/><circle class="pmfill" cx="60" cy="60" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${((1 - f) * c).toFixed(2)}" transform="rotate(-90 60 60)"/></svg>
    <div class="pmbigin">${RUNNING.includes(t.phase) ? `<b class="pmt" aria-live="off">${clock(left(t, now))}</b><span>${t.paused ? "Paused" : phaseName(t)}</span>` : `${TOMATO(34)}<span>${phaseName(t)}</span>`}</div></div>`;
}
const dots = (t: PomoTimer) => `<div class="pmdots" aria-label="${t.done_rounds} of ${t.rounds} rounds done">${Array.from({ length: t.rounds }, (_, i) => `<i class="${i < t.done_rounds ? "d" : i === t.round - 1 && t.phase === "work" ? "c" : ""}"></i>`).join("")}</div>`;
function askBody(k: string, close: string) {
  const title = esc(D?.title(...(k.split("|") as [string, string])) || "this task"), g = cur(GK), gRun = !!g && g.phase !== "done";
  if (P.ask === "replace") return `<div class="pmhead">${TOMATO(22)}<div class="pmtitle"><h2 id="pmtitle">Replace the global timer?</h2><span>${g ? esc(label(g, nowOf(GK), true).replace("Global focus timer: ", "")) : ""}</span></div>${close}</div>
      <p class="pmsum">Only one global timer runs at a time. Starting this one ends the current one.</p>
      <div class="pmasks"><button type="button" class="pmgo" data-pmscope="replace">${svg(PLAY, 15, 2)}Replace it</button><button type="button" class="pmc" data-pmscope="keep">Keep it</button></div>`;
  return `<div class="pmhead">${TOMATO(22)}<div class="pmtitle"><h2 id="pmtitle">Where should it run?</h2><span>${P.form.rounds} rounds of ${P.form.work_min} min</span></div>${close}</div>
    <div class="pmasks" role="group" aria-labelledby="pmtitle">
      <button type="button" class="pmopt" data-pmscope="task"><b>This task</b><span>Tied to “${title}”.</span></button>
      <button type="button" class="pmopt" data-pmscope="global"><b>Everything (global)</b><span>${gRun ? "Replaces your running global timer. " : ""}Stays on screen as you move between tasks and channels.</span></button>
    </div><button type="button" class="pmback2" data-pmscope="back">Back</button>`;
}
function panelBody(k: string) {
  const t = cur(k), now = nowOf(k), close = `<button type="button" class="pmx" data-pmclose aria-label="Close">${svg(X, 16)}</button>`;
  const mute = `<button type="button" class="pmmute" data-pmmute aria-pressed="${!muted}">${svg(muted ? MUTE : BELL, 15)}<span>${muted ? "Sound off" : "Sound on"}</span></button>`;
  const offers = isG(k) ? "" : P.prefs === "off" || P.prefs === "paused" ? `<span class="pmoff">Timer suggestions are ${P.prefs === "off" ? "off" : "paused"} · <button type="button" data-pmoffers>Turn on</button></span>` : "";
  if (!t && P.ask && !isG(k)) return askBody(k, close);
  const g = isG(k), ttl = g ? "Global Pomodoro" : "Focus timer";
  if (!t) {
    const f = P.form, custom = P.form.preset === "custom";
    return `<div class="pmhead">${TOMATO(22)}<div class="pmtitle"><h2 id="pmtitle">${ttl}</h2><span>${g ? "Not tied to a task. Stays on screen everywhere." : "Work in rounds, with short breaks between."}</span></div>${close}</div>
      <div class="pmpre" role="radiogroup" aria-label="Timer length">${PRESETS.map(p => `<button type="button" role="radio" aria-checked="${f.preset === p.id}" class="pmchip${f.preset === p.id ? " on" : ""}" data-pmpre="${p.id}"><b>${p.work_min} / ${p.break_min}</b><span>${p.name}</span></button>`).join("")}<button type="button" role="radio" aria-checked="${custom}" class="pmchip${custom ? " on" : ""}" data-pmpre="custom"><b>${svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>', 16)}</b><span>Custom</span></button></div>
      ${custom ? `<div class="pmcustom">${stepper("work_min")}${stepper("break_min")}${stepper("long_min")}${stepper("rounds")}</div>` : ""}
      <p class="pmsum">${f.rounds} rounds of ${f.work_min} min, ${f.break_min} min breaks${f.long_min ? `, then a ${f.long_min} min long break` : ""}.</p>
      <button type="button" class="pmgo" data-pmact="start" ${P.busy ? "disabled" : ""}>${svg(PLAY, 15, 2)}Start focusing</button>
      <div class="pmfoot">${mute}${offers}</div>`;
  }
  const run = RUNNING.includes(t.phase), skipLab = t.phase === "work" ? "Skip to break" : t.phase === "break" ? "Skip break" : t.phase === "long" ? "New set" : "";
  const sub = t.phase === "work" ? `Round ${t.round} of ${t.rounds}` : t.phase === "break" ? `Round ${t.round + 1} next` : t.phase === "long" ? roundsLine(t) : t.phase === "ready" ? "Your break is over" : roundsLine(t);
  return `<div class="pmhead">${TOMATO(22)}<div class="pmtitle"><h2 id="pmtitle">${ttl}</h2><span>${esc(sub)}</span></div>${close}</div>
    <div class="pmctr ph-${t.phase}${t.paused ? " paused" : ""}">${bigRing(t, now, D?.phone() ? 184 : 156)}${dots(t)}</div>
    <div class="pmctl">${run ? `<button type="button" class="pmc pri" data-pmact="${t.paused ? "resume" : "pause"}">${svg(t.paused ? PLAY : PAUSE, 15, 2)}${t.paused ? "Resume" : "Pause"}</button><button type="button" class="pmc" data-pmact="skip">${svg(SKIP, 15, 2)}${skipLab}</button>`
      : `<button type="button" class="pmc pri" data-pmact="resume">${svg(PLAY, 15, 2)}${t.phase === "ready" ? `Start round ${t.round}` : "Start a new set"}</button>`}<button type="button" class="pmc" data-pmact="stop">${svg(STOP, 14, 2)}Stop</button></div>
    <div class="pmfoot">${mute}<span class="pmset">${t.work_min} / ${t.break_min} min${t.long_min ? ` · long ${t.long_min}` : ""}</span>${offers}</div>`;
}
function paintPanel() {
  const pop = document.querySelector<HTMLElement>("#pmpw .pmpop"); if (!pop || !P.open) return;
  const f = (document.activeElement as HTMLElement | null), fk = f?.dataset?.pmact || f?.dataset?.pmpre || f?.dataset?.pmin || f?.dataset?.pmstep || (f?.hasAttribute("data-pmmute") ? "mute" : "");
  pop.innerHTML = `${D?.phone() ? `<i class="grab"></i>` : ""}${panelBody(P.open)}`; pop.dataset.sig = sigOf(cur(P.open));
  if (fk) pop.querySelector<HTMLElement>(`[data-pmact="${fk}"],[data-pmpre="${fk}"],[data-pmin="${fk}"],[data-pmstep="${fk}"]${fk === "mute" ? ",[data-pmmute]" : ""}`)?.focus({ preventScroll: true });
  place();
}
function tickPanel() {
  const pop = document.querySelector<HTMLElement>("#pmpw .pmpop"); if (!pop || !P.open) return;
  const t = cur(P.open); if (pop.dataset.sig !== sigOf(t)) { paintPanel(); return; }
  if (!t || !RUNNING.includes(t.phase)) return;
  const now = nowOf(P.open), tt = pop.querySelector(".pmbig .pmt"); if (tt) tt.textContent = clock(left(t, now));
  const c = pop.querySelector<SVGCircleElement>(".pmbig .pmfill"); if (c) c.setAttribute("stroke-dashoffset", ((1 - left(t, now) / total(t)) * Number(c.getAttribute("stroke-dasharray"))).toFixed(2));
}
function place() {
  const el = document.querySelector<HTMLElement>("#pmpw .pmpop"), b = P.btn; if (!el) return;
  if (!b || !b.isConnected || D?.phone()) { el.removeAttribute("style"); return; }
  el.style.bottom = "";
  if (b.closest("#rail")) { const rr = b.getBoundingClientRect(); Object.assign(el.style, { width: "340px", left: `${rr.right + 10}px`, top: "auto", bottom: `${Math.max(12, innerHeight - rr.bottom)}px`, maxHeight: `${innerHeight - 24}px` }); return; }
  const r = anchorRect(b), W = Math.min(340, innerWidth - 24);   // folded into the header's ⋯: under ⋯
  el.style.width = `${W}px`; el.style.left = `${Math.max(12, Math.min(r.right - W, innerWidth - W - 12))}px`; el.style.top = `${r.bottom + 8}px`; el.style.maxHeight = `${innerHeight - r.bottom - 20}px`;
}
function panelOpen(k: string, btn: HTMLElement) {
  if (!D) return; P.open = k; P.btn = btn; P.ask = "";
  let w = document.getElementById("pmpw"); if (!w) { w = document.createElement("div"); w.id = "pmpw"; document.body.appendChild(w); }
  w.innerHTML = `<div class="pmback" data-pmclose></div><div class="pmpop" role="dialog" aria-modal="true" aria-labelledby="pmtitle"></div>`;
  paintSlots(k); paintPanel();
  if (D.phone()) D.dragToClose(w.querySelector<HTMLElement>(".pmpop")!, () => panelClose());
  requestAnimationFrame(() => requestAnimationFrame(() => w!.classList.add("on")));
  w.querySelector<HTMLElement>(".pmgo,.pmc.pri")?.focus({ preventScroll: true });
  if (isG(k)) { D.api(apiPath(k)).then(r => { if (r && "pomodoro" in r) { pomoSet("*", "global", r.pomodoro); } }).catch(() => {}); return; }
  const [slug, sid] = k.split("|");   // the offer setting (shown only when suggestions are off or paused)
  D.api(apiPath(k)).then(r => { if (r?.prefs) { P.prefs = r.prefs.offers; if (r.pomodoro !== undefined) S[k] = { t: r.pomodoro?.timer || null, offer: r.pomodoro?.offer || null, skew: r.pomodoro?.timer?.now ? r.pomodoro.timer.now - Date.now() : S[k]?.skew || 0 }; if (P.open === k) paintPanel(); paintSlots(k); } }).catch(() => {});
}
export function pomoClose(focus = true) {
  const w = document.getElementById("pmpw"); if (!P.open) return; const k = P.open; P.open = ""; P.ask = "";
  paintSlots(k);
  if (focus && !D?.phone()) document.querySelector<HTMLElement>(`[data-pomo="${CSS.escape(k)}"]`)?.focus({ preventScroll: true });
  if (!w) return; w.classList.remove("on"); setTimeout(() => { if (!P.open) w.innerHTML = ""; }, 280);
}
const panelClose = pomoClose;
async function act(k: string, body: any) {
  if (!D || P.busy) return; const [slug, sid] = k.split("|"); P.busy = true;
  try {
    const r = await D.api(apiPath(k), body);
    if (r?.prefs) P.prefs = r.prefs.offers;
    if (r && "pomodoro" in r) { SEEN[k] = pkey(advance(r.pomodoro?.timer || null, (r.pomodoro?.timer?.now) || Date.now())); pomoSet(slug, sid, r.pomodoro); }
    if (r?.error && r.code !== "running") D.note(TOMATO(14), "Couldn’t change the timer", String(r.error), "");
    return r;
  } catch (e: any) { D.note(TOMATO(14), "Couldn’t reach the timer", "Check your connection and try again.", ""); }
  finally { P.busy = false; if (P.open === k) paintPanel(); }
}

// ---- the overlay in the timer's task (break / break over / set done) ----
function ovHost() { let o = document.getElementById("pmov"); if (!o) { o = document.createElement("div"); o.id = "pmov"; document.body.appendChild(o); } return o; }
function ovFit(o: HTMLElement) {
  if (D?.phone()) { o.removeAttribute("style"); return; }
  const st = document.getElementById("stage"); if (!st) return; const r = st.getBoundingClientRect();
  Object.assign(o.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
}
const confetti = () => reduced() ? "" : `<div class="pmconf" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="--x:${((i * 37) % 100) - 50}vw;--d:${(i % 6) * 0.07}s;--r:${(i * 53) % 360}deg;--c:${["var(--pm)", "var(--mari)", "var(--pmb)", "#f472b6"][i % 4]}"></i>`).join("")}</div>`;
function ovBody(k: string, t: PomoTimer) {
  const now = nowOf(k), [slug, sid] = k.split("|"), title = isG(k) ? "Global Pomodoro" : esc(D?.title(slug, sid) || "");
  const ignore = `<button type="button" class="pmob ghost" data-pmov="ignore">Ignore</button>`;
  if (t.phase === "break" || t.phase === "long") {
    const set = t.phase === "long";
    return `${set ? confetti() : ""}<div class="pmcard${set ? " set" : ""}" tabindex="-1" role="dialog" aria-modal="false" aria-labelledby="pmovt" aria-describedby="pmovd">
      <p class="pmkick">${set ? `${TOMATO(16)} Set complete` : `${TOMATO(16)} Round ${t.round} of ${t.rounds} done`}</p>
      <h2 id="pmovt">${set ? "Wonderful work." : "Break time"}</h2>
      ${set ? `<p class="pmsumm">${roundsLine(t)}</p>` : ""}
      <div class="pmovring ph-${t.phase}">${bigRing(t, now, D?.phone() ? 236 : 208)}</div>
      <p id="pmovd" class="pmline">${set ? "Take a proper break. Then a fresh set, whenever you’re ready." : esc(LINES[(t.round - 1) % LINES.length])}</p>
      <div class="pmobs"><button type="button" class="pmob" data-pmov="skip">${svg(SKIP, 15, 2)}Skip break</button>${ignore}</div>
      <p class="pmtask">${title}</p></div>`;
  }
  const ready = t.phase === "ready";
  return `<div class="pmcard soft" tabindex="-1" role="dialog" aria-modal="false" aria-labelledby="pmovt">
    <div class="pmsun" aria-hidden="true">${TOMATO(44)}</div>
    <h2 id="pmovt">${ready ? "Break’s over." : "Long break’s over."}</h2>
    <p class="pmline">${ready ? `Ready for round ${t.round}?` : `${roundsLine(t)} last set. Start a new one?`}</p>
    <div class="pmobs"><button type="button" class="pmob pri" data-pmov="start">${svg(PLAY, 15, 2)}${ready ? `Start round ${t.round}` : "Start a new set"}</button><button type="button" class="pmob ghost" data-pmov="later">Not yet</button></div>
    <p class="pmtask">${title}</p></div>`;
}
// Which timer's overlay shows: this task's, else the global one (wherever you are).
const ovWorthy = (k: string) => { const t = k ? cur(k) : null; return !!t && ["break", "long", "ready", "done"].includes(t.phase) && !dismissed.has(`${k}|${pkey(t)}`); };
const ovKey = () => { const c = D?.current() || ""; return c && ovWorthy(c) ? c : ovWorthy(GK) ? GK : c; };
function paintOverlay() {
  const k = ovKey(), t = k ? cur(k) : null, show = ovWorthy(k);
  const id = show ? `${k}|${pkey(t)}` : "", o = document.getElementById("pmov");
  if (!show) { if (o && P.ov) { o.classList.remove("on"); P.ov = ""; setTimeout(() => { if (!P.ov) o.innerHTML = ""; }, 300); } return; }
  const host = ovHost(); ovFit(host);
  if (P.ov !== id) {
    const was = P.ov; P.ov = id; host.className = `ph-${t!.phase}`; host.innerHTML = `<div class="pmovback"></div>${ovBody(k, t!)}`;
    requestAnimationFrame(() => requestAnimationFrame(() => host.classList.add("on")));
    if (P.pop || !was) host.classList.add("pop"); P.pop = false;
    host.querySelector<HTMLElement>(".pmcard")?.focus({ preventScroll: true });   // read by screen readers; Tab reaches the buttons
    return;
  }
  if (!RUNNING.includes(t!.phase)) return;
  const now = nowOf(k), tt = host.querySelector(".pmbig .pmt"); if (tt) tt.textContent = clock(left(t!, now));
  const c = host.querySelector<SVGCircleElement>(".pmbig .pmfill"); if (c) c.setAttribute("stroke-dashoffset", ((1 - left(t!, now) / total(t!)) * Number(c.getAttribute("stroke-dasharray"))).toFixed(2));
}

// ---- the helper's offer: a small card above the composer ----
function paintOffer() {
  const k = D?.current() || "", o = k ? S[k]?.offer : null, t = k ? cur(k) : null;
  const show = !!o && Date.now() - o.at < 2 * 3600e3 && (!t || t.phase === "done");
  const dock = document.querySelector<HTMLElement>(D?.phone() ? "#m .dock" : "#stage .dock"), el = document.querySelector<HTMLElement>(".pmoffer");
  if (!show || !dock) { el?.remove(); return; }
  if (el && el.dataset.k === `${k}|${o!.id}` && el.parentElement === dock) return;
  el?.remove();
  dock.insertAdjacentHTML("afterbegin", `<div class="pmoffer" data-k="${esc(k)}|${o!.id}" role="group" aria-label="Focus timer offer">
    <span class="pmotom">${TOMATO(22)}</span><div class="pmotxt"><b>Want a focus timer?</b><span>${o!.work_min} min work / ${o!.break_min} min break</span></div>
    <div class="pmoact"><button type="button" class="pmob pri sm" data-pmoffer="accept">Start</button><button type="button" class="pmob sm" data-pmoffer="decline">No thanks</button><button type="button" class="pmnever" data-pmoffer="never">Don’t suggest again</button></div></div>`);
}

// ---- a soft chime (Web Audio; no permission prompt) ----
let AC: AudioContext | null = null;
function audio() { try { if (!AC) AC = new (window.AudioContext || (window as any).webkitAudioContext)(); if (AC.state === "suspended") AC.resume().catch(() => {}); } catch {} return AC; }
function chime(kind: "break" | "back" | "set") {
  if (muted) return; const a = audio(); if (!a || a.state !== "running") return;
  const notes = kind === "break" ? [659.25, 523.25] : kind === "back" ? [523.25, 659.25] : [523.25, 659.25, 783.99, 1046.5], t0 = a.currentTime + 0.02;
  notes.forEach((f, i) => {
    const o = a.createOscillator(), g = a.createGain(), at = t0 + i * 0.16;
    o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.12, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
    o.connect(g).connect(a.destination); o.start(at); o.stop(at + 1.2);
  });
}

// ---- scope: the ask in a task panel, and the keyboard shortcuts ----
const settings = () => { const { preset, ...set } = P.form; return set; };
const scopeWords = (g: boolean) => g ? "global" : "this task";
const running = (k: string) => { const t = cur(k); return !!t && t.phase !== "done"; };
async function chooseScope(a: string) {
  const k = P.open; if (!k || isG(k)) return;
  if (a === "back" || a === "keep") { P.ask = ""; paintPanel(); document.querySelector<HTMLElement>("#pmpw .pmgo")?.focus({ preventScroll: true }); return; }
  if (a === "global" && running(GK)) { P.ask = "replace"; paintPanel(); document.querySelector<HTMLElement>("#pmpw .pmgo")?.focus({ preventScroll: true }); return; }
  const g = a === "global" || a === "replace"; store.set(SCOPE_KEY, g ? "global" : "task");
  const r = await act(g ? GK : k, { action: "start", ...settings(), ...(g ? { replace: true } : {}) });
  if (r?.pomodoro?.timer) { panelClose(); D?.note(TOMATO(14), `Pomodoro started · ${scopeWords(g)}`, `${r.pomodoro.timer.work_min} min focus. ${g ? "It stays on screen as you move around." : "It's in this task's header."}`, ""); }
}
function startedToast(g: boolean, tk: string) {
  const t = cur(g ? GK : tk), other = g ? "task" : "global";
  D?.note(TOMATO(14), `Pomodoro started · ${scopeWords(g)}`, t ? `${t.work_min} min focus` : "", tk ? `<button class="tview" data-pmswitch="${other}" data-pmtask="${esc(tk)}">${g ? "Use this task" : "Make it global"}</button>` : "");
}
// The one-tap switch on the "started" toast: end it and start the same settings at the other scope.
async function switchScope(to: "task" | "global", tk: string) {
  if (!D || P.busy) return; const from = to === "global" ? tk : GK, tm = cur(from); if (!tm || (to === "task" && !tk)) return;
  const set = { work_min: tm.work_min, break_min: tm.break_min, long_min: tm.long_min, rounds: tm.rounds };
  await act(from, { action: "stop" }); const r = await act(to === "global" ? GK : tk, { action: "start", ...set, replace: true });
  store.set(SCOPE_KEY, to); if (r?.pomodoro?.timer) startedToast(to === "global", tk);
}
async function replaceNow(k: string) {
  if (!D || P.busy) return; const r = await act(k, { action: "start", ...settings(), replace: true }); if (r?.pomodoro?.timer) startedToast(isG(k), isG(k) ? D.current() : k);
}
// Which timer pause/stop act on: the current task's when you're in it and it has one, else the global one.
const target = (tk: string) => tk && cur(tk) ? tk : cur(GK) ? GK : "";
export async function pomoShortcut(action: "start" | "toggle" | "stop") {
  if (!D || P.busy) return; const tk = D.current();
  if (action === "start") {
    const g = !tk || lastScope() === "global", k = g ? GK : tk;
    if (running(k)) { D.note(TOMATO(14), `A Pomodoro is already running · ${scopeWords(g)}`, "Start a new one instead?", `<button class="tview" data-pmreplace="${esc(k)}">Replace</button>`); return; }
    const r = await act(k, { action: "start", ...settings() }); if (r?.pomodoro?.timer) startedToast(g, tk); return;
  }
  const k = target(tk), tm = k ? cur(k) : null;
  if (!k || !tm) { D.note(TOMATO(14), "No Pomodoro running", "Start one with the Start Pomodoro shortcut.", ""); return; }
  const g = isG(k);
  if (action === "stop") { const before = tm; const r = await act(k, { action: "stop" }); if (r && !r.error) { if (P.open === k) panelClose(false); D.note(TOMATO(14), `Pomodoro stopped · ${scopeWords(g)}`, before.done_rounds ? roundsLine(before) : "See you next round.", ""); } return; }
  const a = tm.paused || !RUNNING.includes(tm.phase) ? "resume" : "pause";
  const r = await act(k, { action: a }); if (r && !r.error) D.note(TOMATO(14), `Pomodoro ${a === "pause" ? "paused" : "resumed"} · ${scopeWords(g)}`, a === "pause" ? "Press the shortcut again to resume." : "", "");
}

export function pomoInit(d: Deps) {
  D = d;
  document.addEventListener("pointerdown", () => { if (!muted) audio(); }, { capture: true, passive: true });   // browsers allow sound after a gesture
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>("[data-pomo]");
    if (b) { e.preventDefault(); e.stopPropagation(); const k = b.dataset.pomo!; if (P.open === k) panelClose(); else { if (P.open) panelClose(false); panelOpen(k, b); } return; }
    const ob = t.closest<HTMLElement>("[data-pmov]");
    if (ob) {
      e.preventDefault(); const k = ovKey(), tm = cur(k); if (!tm) return; const a = ob.dataset.pmov!;
      if (a === "ignore" || a === "later") { dismiss(`${k}|${pkey(tm)}`); paintOverlay(); return; }
      dismiss(`${k}|${pkey(tm)}`); act(k, { action: a === "skip" ? "skip" : "resume" }); return;
    }
    const of = t.closest<HTMLElement>("[data-pmoffer]");
    if (of) { e.preventDefault(); const el = of.closest<HTMLElement>(".pmoffer"), [slug, sid, id] = (el?.dataset.k || "").split("|"), a = of.dataset.pmoffer!; if (!id) return;
      el!.classList.add("busy"); act(key(slug, sid), a === "accept" ? { action: "offer_accept", offer: Number(id) } : { action: "offer_decline", offer: Number(id), never: a === "never" }).then(r => {
        if (r?.error) { el?.classList.remove("busy"); paintOffer(); return; }
        if (a === "never") D?.note(TOMATO(14), "Got it, no more timer suggestions", "You can still start one from the tomato in the task header.", "");
      }); return; }
    const sw = t.closest<HTMLElement>("[data-pmswitch]"); if (sw) { e.preventDefault(); void switchScope(sw.dataset.pmswitch as "task" | "global", sw.dataset.pmtask || ""); return; }
    const rp = t.closest<HTMLElement>("[data-pmreplace]"); if (rp) { e.preventDefault(); void replaceNow(rp.dataset.pmreplace!); return; }
    if (!P.open) return;
    const sc = t.closest<HTMLElement>("[data-pmscope]"); if (sc && sc.closest("#pmpw")) { e.preventDefault(); void chooseScope(sc.dataset.pmscope!); return; }
    if (t.closest("[data-pmclose]")) { e.preventDefault(); panelClose(); return; }
    const pr = t.closest<HTMLElement>("[data-pmpre]"); if (pr) { e.preventDefault(); const p = PRESETS.find(x => x.id === pr.dataset.pmpre); P.form = p ? { preset: p.id, work_min: p.work_min, break_min: p.break_min, long_min: p.long_min, rounds: p.rounds } : { ...P.form, preset: "custom" }; paintPanel(); return; }
    const sp = t.closest<HTMLElement>("[data-pmstep]"); if (sp) { e.preventDefault(); const [f, dlt] = sp.dataset.pmstep!.split("|"), [lo, hi] = LIM[f], v = (P.form as any)[f], d = Number(dlt);
      // work and long breaks move in 5s (snapping to them), short breaks and rounds in 1s
      const step = (f === "work_min" || f === "long_min") && (v > 5 || (v === 5 && d > 0)) ? 5 : 1, n = step === 5 ? (d > 0 ? Math.floor(v / 5) * 5 + 5 : Math.ceil(v / 5) * 5 - 5) : v + d;
      (P.form as any)[f] = Math.max(lo, Math.min(hi, n)); paintPanel(); return; }
    if (t.closest("[data-pmmute]")) { e.preventDefault(); muted = !muted; store.set("1h-pomo-mute", muted ? "1" : "0"); if (!muted) { audio(); chime("back"); } paintPanel(); return; }
    if (t.closest("[data-pmoffers]")) { e.preventDefault(); act(P.open, { action: "offers_on" }); return; }
    const ac = t.closest<HTMLElement>("[data-pmact]"); if (ac && ac.closest("#pmpw")) {
      e.preventDefault(); const a = ac.dataset.pmact!, k = P.open;
      if (a === "start" && !isG(k)) { P.ask = "scope"; paintPanel(); document.querySelector<HTMLElement>("#pmpw .pmopt")?.focus({ preventScroll: true }); return; }   // in a task: ask once, this task or global
      if (a === "start") { const { preset, ...set } = P.form; act(k, { action: "start", ...set }).then(r => { if (r?.pomodoro?.timer) panelClose(); }); return; }
      const before = cur(k); act(k, { action: a }).then(r => { if (a === "stop" && r && !r.error && before) { panelClose(); D?.note(TOMATO(14), "Timer stopped", before.done_rounds ? roundsLine(before) : "See you next round.", ""); } });
    }
  }, true);
  document.addEventListener("change", e => {
    const i = (e.target as HTMLElement).closest<HTMLInputElement>("[data-pmin]"); if (!i || !P.open) return;
    const f = i.dataset.pmin!, [lo, hi] = LIM[f], n = Math.round(Number(i.value)); (P.form as any)[f] = Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : (P.form as any)[f]; paintPanel();
  }, true);
  window.addEventListener("keydown", e => {
    if (P.open) {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); panelClose(); return; }
      if (e.key === "Tab") { const f = [...document.querySelectorAll<HTMLElement>("#pmpw .pmpop button:not([disabled]),#pmpw .pmpop input")]; if (!f.length) return; const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
      return;
    }
    if (e.key === "Escape" && P.ov) { const k = ovKey(), tm = cur(k); if (tm) { e.preventDefault(); e.stopImmediatePropagation(); dismiss(`${k}|${pkey(tm)}`); paintOverlay(); } }
  }, true);
  window.addEventListener("resize", () => { if (P.open) place(); const o = document.getElementById("pmov"); if (o && P.ov) ovFit(o); });
  window.addEventListener("hashchange", () => { panelClose(false); setTimeout(() => { paintSlots(); paintOverlay(); paintOffer(); }, 0); });
  // One clock for every timer: phase changes, the header rings, the open panel and the overlay.
  setInterval(() => { for (const k of Object.keys(S)) check(k); paintSlots(); tickPanel(); paintOverlay(); paintOffer(); }, 1000);
}

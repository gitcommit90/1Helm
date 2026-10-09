// the design sandbox / v2 — "Flat": v1's structure, stripped to type, spacing and hairlines.
import { marked } from "marked";
import DOMPurify from "dompurify";
import seed from "./seed.json";

type Msg = { id: number; role: "user" | "agent"; body: string; at: number; steps: string[] };
type Session = { id: number; title: string; status: string; state: string; updated: number; messages: Msg[] };
type Channel = { id: number; slug: string; name: string; purpose: string; memory: string[]; jobs: any[]; sessions: Session[] };

const NAMES: Record<string, string> = { main: "Main", "weather-watch": "Weather", "family-schedule": "Family", "home-finances": "Finances", "trip-planning": "Japan trip", "side-project": "Side project" };
const NOW = Date.now(), SHIFT = NOW - (seed as any).captured;
const channels: Channel[] = (seed as any).channels.map((c: any) => ({
  id: c.id, slug: c.slug, name: NAMES[c.slug] ?? c.slug, purpose: c.purpose, memory: c.memory, jobs: c.jobs,
  sessions: c.sessions.map((s: Session) => ({ ...s, updated: s.updated + SHIFT, messages: s.messages.map(m => ({ ...m, at: m.at + SHIFT })) })),
}));
const main = channels.find(c => c.slug === "main")!;
main.purpose = "Your chief of staff. Ask anything here and it gets routed to the right channel.";
main.sessions = [{ id: 900, title: "Welcome to 1Helm", status: "resolved", state: "complete", updated: NOW - 3600e3, messages: [
  { id: 9001, role: "agent", at: NOW - 3600e3, steps: [], body: "Each channel on the left is its own space, with its own assistant, memory and files.\n\nOpen one to see its sessions. A session is one piece of work, from the first ask to done." },
] }];
let nextId = 10000;
const open: Record<string, boolean> = {};

// Icons (Lucide, MIT), stroke only.
const I = (d: string, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ic = {
  newS: I('<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a1 1 0 0 1 3 3l-9 9-3.9 1 1-3.9z"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 15),
  memory: I('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>', 15),
  clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 15),
  chev: I('<path d="m9 18 6-6-6-6"/>', 14),
  up: I('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', 16),
  term: I('<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>', 14),
  gear: I('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>', 18),
  main: I('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>', 17),
  "weather-watch": I('<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 1 0 6 17.7"/><path d="M6 19h11.5"/>', 17),
  "family-schedule": I('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', 17),
  "home-finances": I('<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20"/><path d="M6 15h3"/>', 17),
  "trip-planning": I('<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>', 17),
  "side-project": I('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>', 17),
  plus: I('<path d="M5 12h14"/><path d="M12 5v14"/>', 18),
};

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const md = (s: string) => DOMPurify.sanitize(marked.parse(s, { async: false }) as string);
const live = (s: Session) => s.status === "open" || s.status === "waiting";
function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60e3);
  if (m < 1) return "now"; if (m < 60) return `${m}m`; const h = Math.round(m / 60); if (h < 24) return `${h}h`;
  const d = Math.round(h / 24); return d < 7 ? `${d}d` : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function every(s: number) { return s % 86400 === 0 ? (s === 86400 ? "Daily" : `Every ${s / 86400} days`) : s % 3600 === 0 ? (s === 3600 ? "Hourly" : `Every ${s / 3600} hours`) : `Every ${Math.round(s / 60)} min`; }
const statusText = (s: Session) => s.status === "waiting" ? "Waiting on you" : live(s) ? "In progress" : "Done";

function route(): { ch: Channel; s: Session | null } {
  const [, slug, , sid] = location.hash.replace(/^#\/?/, "/").split("/");
  const ch = channels.find(c => c.slug === slug) ?? main;
  const s = sid === "new" ? null : ch.sessions.find(x => String(x.id) === sid) ?? ch.sessions[0] ?? null;
  return { ch, s };
}
const go = (slug: string, sid?: number | "new") => { location.hash = `/${slug}${sid !== undefined ? `/s/${sid}` : ""}`; };

function render() {
  const { ch, s } = route();
  document.title = `${s ? s.title : "New session"} · ${ch.name} · 1Helm`;

  $("#rail").innerHTML = `<div class="chs">${channels.map((c, i) => {
    const n = c.sessions.filter(x => x.status === "waiting").length;
    return `<button class="ch${c === ch ? " on" : ""}" data-ch="${c.slug}" title="${esc(c.name)}  ⌘${i + 1}">
      <span class="tile">${(ic as any)[c.slug] ?? esc(c.name[0])}${n ? `<i class="pip" title="Needs you"></i>` : ""}</span><span class="lbl">${esc(c.name)}</span></button>`;
  }).join("")}<button class="ch add" title="New channel"><span class="tile">${ic.plus}</span></button></div>
    <div class="foot"><button class="iconbtn" title="Settings">${ic.gear}</button><span class="me" title="Captain">C</span></div>`;

  const qEl = $("#q") as HTMLInputElement | null, q = qEl && qEl.dataset.ch === ch.slug ? qEl.value : "", focused = document.activeElement === qEl;
  const ql = q.toLowerCase();
  const list = ch.sessions.filter(x => !ql || x.title.toLowerCase().includes(ql) || x.messages.some(m => m.body.toLowerCase().includes(ql)));
  const row = (x: Session) => `<a class="sess${x === s ? " on" : ""}" href="#/${ch.slug}/s/${x.id}">
      <span class="t">${esc(x.title)}</span>${x.status === "waiting" ? `<span class="tag">Needs you</span>` : ""}<span class="when">${ago(x.updated)}</span></a>`;
  const group = (label: string, items: Session[]) => items.length ? `<div class="grp">${label}</div>${items.map(row).join("")}` : "";
  const active = ch.jobs.filter(j => j.status === "active");
  const drawer = (key: string, icon: string, label: string, items: string[]) => `
    <button class="drow${open[key] ? " open" : ""}" data-toggle="${key}">${icon}<span>${label}</span><b>${items.length}</b>${items.length ? ic.chev : ""}</button>
    ${open[key] && items.length ? `<div class="dlist">${items.map(t => `<div>${esc(t)}</div>`).join("")}</div>` : ""}`;

  $("#side").innerHTML = `
    <div class="chhead"><h2>${esc(ch.name)}</h2><p>${esc(ch.purpose)}</p></div>
    <button class="new" data-new>${ic.newS}<span>New session</span><kbd>⌘N</kbd></button>
    <label class="search">${ic.search}<input id="q" data-ch="${ch.slug}" placeholder="Search" value="${esc(q)}" autocomplete="off"><kbd>⌘K</kbd></label>
    <div class="sessions">${group("In progress", list.filter(live))}${group("Done", list.filter(x => !live(x)))}
      ${!list.length ? `<div class="empty">${q ? "No sessions match." : "No sessions yet."}</div>` : ""}</div>
    <div class="drawer">
      ${drawer(`m${ch.id}`, ic.memory, "Memory", ch.memory)}
      ${drawer(`j${ch.id}`, ic.clock, "Schedules", active.map(j => `${j.name} · ${every(j.every)}`))}
    </div>`;
  if (focused) { const i = $("#q") as HTMLInputElement; i.focus(); i.setSelectionRange(i.value.length, i.value.length); }

  $("#stage").innerHTML = s ? `
    <header><h1>${esc(s.title)}</h1><span class="meta"><i class="st ${s.status}"></i>${statusText(s)}</span></header>
    <div class="scroll" id="scroll"><div class="msgs">${s.messages.map((m, i) => msgHtml(m, ch, s.messages[i - 1])).join("")}</div></div>
    ${composer(`Reply…`)}` : `
    <div class="blank"><h1>New session</h1><p>in ${esc(ch.name)}</p>${composer(`What should we work on?`)}</div>`;
  const sc = document.getElementById("scroll"); if (sc) sc.scrollTop = sc.scrollHeight;
  if (!s) ($("#box") as HTMLTextAreaElement).focus();
}
const composer = (ph: string) => `<form class="composer" id="send"><textarea id="box" rows="1" placeholder="${ph}"></textarea>
  <div class="cbar"><span class="hint">Enter to send · Shift+Enter for a new line</span><button id="go" disabled aria-label="Send">${ic.up}</button></div></form>`;
function msgHtml(m: Msg, ch: Channel, prev?: Msg) {
  const first = !prev || prev.role !== m.role;
  if (m.role === "user") return `<div class="m user${first ? " first" : ""}" title="${clock(m.at)}"><div class="bubble">${esc(m.body)}</div></div>`;
  const steps = m.steps.length ? `<details class="steps"><summary>${ic.term}<span>${m.steps.length === 1 ? "Ran 1 command" : `Ran ${m.steps.length} commands`}</span>${ic.chev}</summary>
    ${m.steps.map(x => `<code>${esc(x)}</code>`).join("")}</details>` : "";
  return `<div class="m agent${first ? " first" : ""}" title="${clock(m.at)}">${first ? `<div class="who">${esc(ch.name)}<span>${clock(m.at)}</span></div>` : ""}
    <div class="bubble">${steps}<div class="body">${m.body ? md(m.body) : `<span class="typing"><i></i><i></i><i></i></span>`}</div></div></div>`;
}

document.addEventListener("click", e => {
  const t = e.target as HTMLElement;
  const c = t.closest<HTMLElement>("[data-ch]"); if (c) { const x = channels.find(y => y.slug === c.dataset.ch)!; go(x.slug, x.sessions[0]?.id ?? "new"); }
  if (t.closest("[data-new]")) go(route().ch.slug, "new");
  const tg = t.closest<HTMLElement>("[data-toggle]"); if (tg) { open[tg.dataset.toggle!] = !open[tg.dataset.toggle!]; render(); }
});
document.addEventListener("input", e => {
  const t = e.target as HTMLElement;
  if (t.id === "q") render();
  if (t.id === "box") { const b = t as HTMLTextAreaElement; b.style.height = "auto"; b.style.height = Math.min(b.scrollHeight, 220) + "px"; ($("#go") as HTMLButtonElement).disabled = !b.value.trim(); }
});
document.addEventListener("keydown", e => {
  const t = e.target as HTMLElement, mod = e.metaKey || e.ctrlKey;
  if (t.id === "box" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#send").requestSubmit(); return; }
  if (t.id === "q" && e.key === "Escape") { (t as HTMLInputElement).value = ""; t.blur(); render(); return; }
  if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); $("#q").focus(); }
  if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); go(route().ch.slug, "new"); }
  if (mod && /^[1-9]$/.test(e.key)) { const x = channels[+e.key - 1]; if (x) { e.preventDefault(); go(x.slug, x.sessions[0]?.id ?? "new"); } }
});
document.addEventListener("submit", e => {
  e.preventDefault();
  const text = ($("#box") as HTMLTextAreaElement).value.trim(); if (!text) return;
  let { ch, s } = route();
  if (!s) { s = { id: nextId++, title: text.length > 44 ? text.slice(0, 42).trimEnd() + "…" : text, status: "open", state: "working", updated: Date.now(), messages: [] }; ch.sessions.unshift(s); }
  const at = Date.now();
  s.messages.push({ id: nextId++, role: "user", body: text, at, steps: [] });
  const reply: Msg = { id: nextId++, role: "agent", body: "", at, steps: [] }; s.messages.push(reply);
  s.updated = at; s.status = "open";
  location.hash = `/${ch.slug}/s/${s.id}`; render();
  setTimeout(() => { reply.body = `On it. I'll keep this session open until it's done.\n\n<small>Scripted reply · design sandbox</small>`; render(); }, 800);
});
window.addEventListener("hashchange", render);
render();

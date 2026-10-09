// the design sandbox / v1 — "Flip": channels rail → session list → session takes the stage.
import { marked } from "marked";
import DOMPurify from "dompurify";
import seed from "./seed.json";

type Msg = { id: number; role: "user" | "agent"; body: string; at: number; steps: string[] };
type Session = { id: number; title: string; status: string; state: string; updated: number; messages: Msg[] };
type Channel = { id: number; slug: string; purpose: string; agent: string; avatar: string; memory: string[]; jobs: any[]; sessions: Session[] };

const NOW = Date.now(), SHIFT = NOW - (seed as any).captured; // make seed times feel current
const channels: Channel[] = (seed as any).channels.map((c: Channel) => ({
  ...c, sessions: c.sessions.map(s => ({ ...s, updated: s.updated + SHIFT, messages: s.messages.map(m => ({ ...m, at: m.at + SHIFT })) })),
}));
const main = channels.find(c => c.slug === "main")!;
main.purpose = "Your workspace-wide chief of staff. Ask anything; I'll route it to the right channel.";
main.sessions = [{ id: 900, title: "Welcome to 1Helm", status: "resolved", state: "complete", updated: NOW - 3600e3, messages: [
  { id: 9001, role: "agent", at: NOW - 3600e3, steps: [], body: "Hey, I'm **Skipper**. Every channel on the left is a world with its own resident, memory, files and computer.\n\nOpen one and you'll see its sessions. Each session is one piece of work." },
] }];
const META: Record<string, { emoji: string; name: string }> = {
  main: { emoji: "⚓", name: "Main" }, "weather-watch": { emoji: "🌦️", name: "Weather" }, "family-schedule": { emoji: "🏡", name: "Family" },
  "home-finances": { emoji: "💵", name: "Finances" }, "trip-planning": { emoji: "✈️", name: "Japan trip" }, "side-project": { emoji: "🛠️", name: "Side project" },
};
let nextId = 10000;

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const md = (s: string) => DOMPurify.sanitize(marked.parse(s, { async: false }) as string);
function ago(t: number) {
  const m = Math.round((NOW - t) / 60e3);
  if (m < 1) return "now"; if (m < 60) return `${m}m`; const h = Math.round(m / 60); if (h < 24) return `${h}h`;
  const d = Math.round(h / 24); return d < 7 ? `${d}d` : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function every(s: number) { return s % 86400 === 0 ? `every ${s / 86400 === 1 ? "day" : s / 86400 + " days"}` : s % 3600 === 0 ? `every ${s / 3600 === 1 ? "hour" : s / 3600 + " hours"}` : `every ${Math.round(s / 60)} min`; }
const live = (s: Session) => s.status === "open" || s.status === "waiting";

// ---------- routing ----------
function route(): { ch: Channel; s: Session | null } {
  const [, slug, , sid] = location.hash.replace(/^#\/?/, "/").split("/");
  const ch = channels.find(c => c.slug === slug) ?? main;
  const s = sid === "new" ? null : ch.sessions.find(x => String(x.id) === sid) ?? ch.sessions[0] ?? null;
  return { ch, s };
}
const go = (slug: string, sid?: number | "new") => { location.hash = `/${slug}${sid !== undefined ? `/s/${sid}` : ""}`; };

// ---------- render ----------
function render() {
  const { ch, s } = route();
  $("#rail").innerHTML = channels.map(c => {
    const m = META[c.slug] ?? { emoji: "#", name: c.slug }, n = c.sessions.filter(live).length;
    return `<button class="ch ${c === ch ? "on" : ""}" data-ch="${c.slug}" title="${esc(m.name)}">
      <span class="em">${m.emoji}</span>${n ? `<span class="badge">${n}</span>` : ""}<span class="lbl">${esc(m.name)}</span></button>`;
  }).join("") + `<div class="grow"></div><button class="ch add" title="New channel"><span class="em">＋</span></button>`;

  const q = ($("#q") as HTMLInputElement | null)?.value?.toLowerCase() ?? "";
  const list = ch.sessions.filter(x => !q || x.title.toLowerCase().includes(q) || x.messages.some(m => m.body.toLowerCase().includes(q)));
  const group = (title: string, items: Session[]) => items.length ? `<div class="grp">${title}</div>` + items.map(x => `
    <a class="sess ${x === s ? "on" : ""}" href="#/${ch.slug}/s/${x.id}">
      <span class="dot ${x.status}"></span><span class="t">${esc(x.title)}</span><span class="when">${ago(x.updated)}</span></a>`).join("") : "";
  const meta = META[ch.slug] ?? { emoji: "#", name: ch.slug };
  const sideKeep = document.activeElement?.id === "q";
  $("#side").innerHTML = `
    <div class="chhead"><div class="chname">${meta.emoji} ${esc(meta.name)}</div><div class="purpose">${esc(ch.purpose)}</div></div>
    <button class="new" data-new>✎ New session</button>
    <input id="q" placeholder="Search sessions" value="${esc(q)}">
    <div class="sessions">${group("Active", list.filter(live))}${group("Done", list.filter(x => !live(x)))}
      ${!list.length ? `<div class="empty">${q ? "No matches" : "No sessions yet"}</div>` : ""}</div>
    <div class="world">
      <div class="wrow"><span>🧠 Remembers</span><b>${ch.memory.length}</b></div>
      ${ch.memory.map(m => `<div class="wsub">${esc(m)}</div>`).join("")}
      <div class="wrow"><span>⏱ Watching</span><b>${ch.jobs.filter(j => j.status === "active").length}</b></div>
      ${ch.jobs.map(j => `<div class="wsub">${esc(j.name)} · ${every(j.every)}</div>`).join("")}
    </div>`;
  if (sideKeep) { const i = $("#q") as HTMLInputElement; i.focus(); i.setSelectionRange(i.value.length, i.value.length); }

  $("#stage").innerHTML = s ? `
    <header><div class="title">${esc(s.title)}</div><div class="sub">${live(s) ? `<span class="dot ${s.status}"></span>${s.status === "waiting" ? "Waiting on you" : "Ongoing"}` : "Done"} · ${meta.emoji} ${esc(meta.name)}</div></header>
    <div class="scroll" id="scroll"><div class="msgs">${s.messages.map(m => msgHtml(m, meta)).join("")}</div></div>
    ${composer(`Reply in “${esc(s.title)}”…`)}` : `
    <div class="scroll"><div class="hero"><div class="big">${meta.emoji}</div><h1>New session in ${esc(meta.name)}</h1><p>${esc(ch.purpose)}</p></div></div>
    ${composer(`What should ${esc(meta.name)} work on?`)}`;
  const sc = document.getElementById("scroll"); if (sc) sc.scrollTop = sc.scrollHeight;
}
const composer = (ph: string) => `<form class="composer" id="send"><textarea id="box" rows="1" placeholder="${ph}"></textarea><button aria-label="Send">↑</button></form>`;
function msgHtml(m: Msg, meta: { emoji: string; name: string }) {
  const time = new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (m.role === "user") return `<div class="m user"><div class="bubble">${esc(m.body)}</div><div class="stamp">${time}</div></div>`;
  const steps = m.steps.length ? `<details class="steps"><summary>${m.steps.length} step${m.steps.length > 1 ? "s" : ""}</summary>${m.steps.map(x => `<div>${esc(x)}</div>`).join("")}</details>` : "";
  return `<div class="m agent"><div class="av">${meta.emoji}</div><div class="col"><div class="who">${esc(meta.name)} <span class="stamp">${time}</span></div>
    <div class="bubble abub">${steps}<div class="body">${m.body ? md(m.body) : `<span class="typing"><i></i><i></i><i></i></span>`}</div></div></div></div>`;
}

// ---------- behaviour ----------
document.addEventListener("click", e => {
  const t = e.target as HTMLElement;
  const ch = t.closest<HTMLElement>("[data-ch]"); if (ch) { const c = channels.find(x => x.slug === ch.dataset.ch)!; go(c.slug, c.sessions[0]?.id ?? "new"); }
  if (t.closest("[data-new]")) go(route().ch.slug, "new");
});
document.addEventListener("input", e => { if ((e.target as HTMLElement).id === "q") render(); });
document.addEventListener("keydown", e => {
  if ((e.target as HTMLElement).id === "box" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#send").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); }
});
document.addEventListener("submit", e => {
  e.preventDefault();
  const text = ($("#box") as HTMLTextAreaElement).value.trim(); if (!text) return;
  let { ch, s } = route();
  if (!s) { s = { id: nextId++, title: text.length > 42 ? text.slice(0, 40) + "…" : text, status: "open", state: "working", updated: Date.now(), messages: [] }; ch.sessions.unshift(s); }
  const at = Date.now();
  s.messages.push({ id: nextId++, role: "user", body: text, at, steps: [] });
  const reply: Msg = { id: nextId++, role: "agent", body: "", at, steps: [] }; s.messages.push(reply);
  s.updated = at; s.status = "open";
  location.hash = `/${ch.slug}/s/${s.id}`; render();
  setTimeout(() => { reply.body = `*(Design sandbox: scripted reply.)* Got it. I'd pick this up in **${META[ch.slug]?.name ?? ch.slug}** and keep this session open until it's done.`; render(); }, 900);
});
window.addEventListener("hashchange", render);
render();

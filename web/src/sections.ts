// Custom sections in the task list (side panel on desktop, task drawer on phone). Per channel; the server (proto src/sections.js) keeps them.
//   Off (default): the standard groups (Pinned, Texts, task states, Done). The plus beside the first group header asks "Switch to Custom sections?".
//   On: one list per section, Uncategorized first (always there, never renamed or deleted), then the person's sections in their order.
//   Nothing puts a task in a section but the person: dragging a row onto a section (desktop), or "Move to section" in the row's more menu.
//   Inside every section: open tasks first, then done tasks, each newest activity first (orderTasks).
//   Turning it off keeps the sections and where tasks were, so turning it on again brings them back.
import { ask, tell } from "./dialog";
import { openMenu } from "./delete";

export type Sec = { id: string; title: string; color: string };
export type CS = { on: boolean; sections: Sec[] };
export const COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;
const COLOR_NAME: Record<string, string> = { red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", teal: "Teal", blue: "Blue", purple: "Purple", pink: "Pink" };
export const UNCAT = "Uncategorized";

type Task = { id: any; title: string; updated: number; done?: boolean; srv?: any; section?: string | null };
type Deps = {
  live: boolean;
  api: (path: string, body?: any) => Promise<any>;
  tasks: (slug: string) => Task[];
  cs: (slug: string) => CS;
  setCs: (slug: string, cs: CS) => void;
  repaint: (slug: string) => void;
  patch: (slug: string, sid: any, body: any) => void;   // the task update call (livePatch)
  current: () => string;                                 // slug of the open channel
};
let D: Deps | null = null;

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const svg = (d: string, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const PLUS = svg('<path d="M5 12h14"/><path d="M12 5v14"/>', 16);
const DOTS = svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', 15);
const CHECK = svg('<path d="m5 12 5 5 9-10"/>', 15);
const sw = (c: string) => `<i class="secswatch sc-${esc(c)}" aria-hidden="true"></i>`;

export const secOf = (x: Task): string | null => (x.srv ? x.srv.section : x.section) ?? null;
const setSec = (x: Task, v: string | null) => { if (x.srv) x.srv.section = v; else x.section = v; };

/** Open tasks first, then done tasks; each newest activity first (activity = `updated`, never when it was made). */
export function orderTasks<T extends { id: any; updated: number; done?: boolean }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (Number(b.updated) || 0) - (Number(a.updated) || 0) || String(a.id).localeCompare(String(b.id)));
}
/** The section a task shows in: its own while that section exists, else Uncategorized (""). */
const keyOf = (cs: CS, x: Task) => { const s = secOf(x); return s && cs.sections.some(y => y.id === s) ? s : ""; };

// ---- what the person is doing right now (not saved) ----
let ADD: { slug: string; color: string } | null = null;   // the inline "new section" row
let REN: { slug: string; id: string } | null = null;      // a section header being renamed
let DRAG: { kind: "task" | "sec"; id: string; slug: string } | null = null;

// ---- markup ----
/** The plus beside the first group header. Searching hides it, since the list is then one flat list. */
export function secPlus(slug: string, searching: boolean) {
  if (!D || searching) return "";
  const on = D.cs(slug).on;
  return `<button type="button" class="secplus" data-secplus="${esc(slug)}" aria-label="${on ? "Add a section" : "Switch to Custom sections"}" title="${on ? "Add a section" : "Custom sections"}"${on ? ` aria-expanded="${ADD?.slug === slug}"` : ""}>${PLUS}</button>`;
}
function addForm(slug: string) {
  if (ADD?.slug !== slug) return "";
  return `<form class="secnew" data-secnew="${esc(slug)}"><input class="secin" data-secnewin maxlength="60" placeholder="Section name" aria-label="Section name" autocomplete="off">
    <span class="secsw" role="radiogroup" aria-label="Color">${COLORS.map(c => `<button type="button" class="secdot sc-${c}${ADD!.color === c ? " on" : ""}" data-seccolor="${c}" role="radio" aria-checked="${ADD!.color === c}" aria-label="${COLOR_NAME[c]}" title="${COLOR_NAME[c]}"><i></i></button>`).join("")}</span>
    <button type="submit" class="secadd">Add</button></form>`;
}

export type ListOpts = {
  row: (x: Task) => string;
  /** a folding header, the same one the standard groups use */
  head: (key: string, label: string, n: number, shut: boolean, searching: boolean) => string;
  shut: (key: string) => boolean;
  searching: boolean;
  empty: string;
};
/** The whole task list in custom mode: the add row, then each section with its header and ordered tasks. */
export function secList(slug: string, list: Task[], o: ListOpts) {
  const cs = D!.cs(slug), all: { id: string; title: string; color: string }[] = [{ id: "", title: UNCAT, color: "" }, ...cs.sections];
  const by = new Map<string, Task[]>(); for (const x of list) { const k = keyOf(cs, x); (by.get(k) || by.set(k, []).get(k)!).push(x); }
  const body = all.map((sec, i) => {
    const items = orderTasks(by.get(sec.id) || []);
    if (o.searching && !items.length) return "";
    const key = `sec-${sec.id || "uncat"}`, shut = !o.searching && o.shut(key), renaming = REN?.slug === slug && REN.id === sec.id && !!sec.id;
    const label = `${sec.color ? sw(sec.color) : ""}<span class="sect">${esc(sec.title)}</span>`;
    const head = renaming ? `<input class="secren" data-secren="${esc(sec.id)}" value="${esc(sec.title)}" maxlength="60" aria-label="Section name">` : o.head(key, label, items.length, shut, o.searching);
    return `<div class="cgrp${sec.color ? ` sc-${sec.color}` : ""}" data-secdrop="${esc(sec.id)}"><div class="csech"${sec.id && !o.searching ? ` draggable="true" data-secdrag="${esc(sec.id)}"` : ""}>${head}<button type="button" class="secmenu" data-secmenu="${esc(sec.id)}" aria-haspopup="menu" aria-label="Options for ${esc(sec.title)}" title="Section options">${DOTS}</button></div>${shut ? "" : items.map(o.row).join("")}</div>`;
  }).join("");
  return `${addForm(slug)}${body}${!list.length && !o.searching ? "" : !list.length ? o.empty : ""}`;
}
/** Extra class and attributes for a task row: the section's faint tint, and draggable on desktop. */
export function secRow(slug: string, x: Task, draggable: boolean) {
  if (!D) return { c: "", a: "" };
  const cs = D.cs(slug); if (!cs.on) return { c: "", a: "" };
  const k = keyOf(cs, x), sec = cs.sections.find(s => s.id === k);
  return { c: sec ? ` csr sc-${sec.color}` : " csr", a: draggable ? ` draggable="true" data-tid="${esc(x.id)}"` : "" };
}

// ---- changes: the same change is applied here at once, then the server's answer replaces it ----
function local(cs: CS, b: any, tasks: Task[]): CS {
  const o: CS = { on: cs.on, sections: cs.sections.map(s => ({ ...s })) };
  if (b.action === "enable") o.on = true; else if (b.action === "disable") o.on = false;
  else if (b.action === "create") o.sections.push({ id: `tmp-${Date.now()}-${o.sections.length}`, title: b.title, color: b.color || COLORS[o.sections.length % COLORS.length] });
  else if (b.action === "update") { const s = o.sections.find(y => y.id === b.id); if (s) { if (b.title != null) s.title = b.title; if (b.color) s.color = b.color; } }
  else if (b.action === "delete") { o.sections = o.sections.filter(y => y.id !== b.id); for (const x of tasks) if (secOf(x) === b.id) setSec(x, null); }
  else if (b.action === "reorder") { const ids: string[] = b.ids; o.sections.sort((p, q) => (ids.includes(p.id) ? ids.indexOf(p.id) : 1e6) - (ids.includes(q.id) ? ids.indexOf(q.id) : 1e6)); }
  return o;
}
async function change(slug: string, b: any, optimistic = true): Promise<boolean> {
  if (!D) return false;
  const before = D.cs(slug), tasks = D.tasks(slug), saved = tasks.map(x => [x, secOf(x)] as const);
  if (optimistic || !D.live) { D.setCs(slug, local(before, b, tasks)); D.repaint(slug); }
  if (!D.live) return true;
  try {
    const r = await D.api(`/res/${slug}/sections`, b);
    if (r?.error || !Array.isArray(r?.sections)) throw new Error(r?.error || "failed");
    D.setCs(slug, { on: !!r.on, sections: r.sections.map((s: any) => ({ id: s.id, title: s.title, color: s.color })) }); D.repaint(slug); return true;
  } catch (e: any) {
    D.setCs(slug, before); for (const [x, v] of saved) setSec(x, v); D.repaint(slug);
    await tell({ title: "Couldn't save that", body: /^(HTTP|failed|Failed to fetch)/.test(String(e?.message)) || !e?.message ? "Check your connection and try again." : String(e.message) });
    return false;
  }
}
export function moveTask(slug: string, sid: any, section: string | null) {
  if (!D) return; const x = D.tasks(slug).find(y => String(y.id) === String(sid)); if (!x || (secOf(x) ?? null) === section) return;
  setSec(x, section); D.repaint(slug); D.patch(slug, x.id, { section });
}

// ---- turning it on, and adding / renaming / recoloring / deleting ----
async function turnOn(slug: string) {
  const cs = D!.cs(slug), had = cs.sections.length > 0;
  const ok = await ask({ title: "Switch to Custom sections?", body: had ? "Your saved sections and the tasks in them come back. New tasks start in Uncategorized, and you move them yourself." : "All the tasks in this channel go into one list called Uncategorized. You can then add sections and drag tasks into them. New tasks start in Uncategorized, and nothing is moved for you.", confirm: "Switch" });
  if (ok) await change(slug, { action: "enable" });
}
const useDefault = (slug: string) => { ADD = null; REN = null; void change(slug, { action: "disable" }); };
function openAdd(slug: string) {
  const n = D!.cs(slug).sections.length; ADD = ADD?.slug === slug ? null : { slug, color: COLORS[n % COLORS.length] }; D!.repaint(slug);
  if (ADD) requestAnimationFrame(() => document.querySelector<HTMLInputElement>("[data-secnewin]")?.focus());
}
async function submitAdd(form: HTMLElement) {
  const slug = form.dataset.secnew!, input = form.querySelector<HTMLInputElement>("[data-secnewin]")!, title = input.value.replace(/\s+/g, " ").trim();
  if (!title || !ADD) return;
  if (title.toLowerCase() === UNCAT.toLowerCase()) { await tell({ title: "That name is taken", body: "Uncategorized is already there. Pick another name." }); return; }
  const color = ADD.color; ADD = null;
  await change(slug, { action: "create", title, color }, false);
}
function colorMenu(opener: HTMLElement, slug: string, id: string) {
  openMenu(opener, COLORS.map(c => [COLOR_NAME[c], sw(c), () => void change(slug, { action: "update", id, color: c })] as [string, string, () => void]));
}
function secMenu(opener: HTMLElement, slug: string, id: string) {
  const cs = D!.cs(slug), i = cs.sections.findIndex(s => s.id === id), sec = cs.sections[i];
  const reorder = (to: number) => { const ids = cs.sections.map(s => s.id); ids.splice(i, 1); ids.splice(to, 0, id); void change(slug, { action: "reorder", ids }); };
  const items: [string, string, () => void][] = [];
  if (sec) {
    items.push(["Rename section", svg('<path d="m16 3 5 5L8 21H3v-5Z"/>'), () => { REN = { slug, id }; D!.repaint(slug); requestAnimationFrame(() => { const e = document.querySelector<HTMLInputElement>("[data-secren]"); e?.focus(); e?.select(); }); }]);
    items.push(["Color", sw(sec.color), () => colorMenu(opener, slug, id)]);
    if (i > 0) items.push(["Move section up", svg('<path d="m6 15 6-6 6 6"/>'), () => reorder(i - 1)]);
    if (i < cs.sections.length - 1) items.push(["Move section down", svg('<path d="m6 9 6 6 6-6"/>'), () => reorder(i + 1)]);
    items.push(["Delete section", svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'), async () => {
      if (await ask({ title: `Delete “${sec.title}”?`, body: "Its tasks move to Uncategorized. No task is deleted.", confirm: "Delete", danger: true })) { await change(slug, { action: "delete", id }); }
    }]);
  }
  items.push(["Use default sections", svg('<path d="M4 6h16M4 12h16M4 18h10"/>'), () => useDefault(slug)]);
  openMenu(opener, items);
}
/** "Move to section" on a task row's more menu: pick a section for this task. */
export function canMove(slug: string) { return !!D && D.cs(slug).on; }
export function moveMenu(slug: string, sid: any, opener: HTMLElement) {
  const cs = D!.cs(slug), x = D!.tasks(slug).find(y => String(y.id) === String(sid)); if (!x) return;
  const cur = keyOf(cs, x);
  openMenu(opener, [{ id: "", title: UNCAT, color: "" }, ...cs.sections].map(s => [s.title, s.id === cur ? CHECK : s.color ? sw(s.color) : `<i class="secswatch none" aria-hidden="true"></i>`, () => moveTask(slug, sid, s.id || null)] as [string, string, () => void]));
}

// ---- events ----
function clearMarks() { document.querySelectorAll(".dropon,.dropbefore,.secdragging").forEach(e => e.classList.remove("dropon", "dropbefore", "secdragging")); }
export function secInit(deps: Deps) {
  D = deps;
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const plus = t.closest<HTMLElement>("[data-secplus]");
    if (plus) { e.preventDefault(); e.stopPropagation(); const slug = plus.dataset.secplus!; if (D!.cs(slug).on) openAdd(slug); else void turnOn(slug); return; }
    const m = t.closest<HTMLElement>("[data-secmenu]");
    if (m) { e.preventDefault(); e.stopPropagation(); secMenu(m, D!.current(), m.dataset.secmenu!); return; }
    const dot = t.closest<HTMLElement>("[data-seccolor]");
    if (dot && ADD) { e.preventDefault(); ADD.color = dot.dataset.seccolor!; const f = dot.closest("form")!; f.querySelectorAll(".secdot").forEach(b => { const on = b === dot; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); }); f.querySelector<HTMLInputElement>("[data-secnewin]")?.focus(); }
  }, true);
  document.addEventListener("submit", e => { const f = (e.target as HTMLElement).closest<HTMLElement>("[data-secnew]"); if (f) { e.preventDefault(); void submitAdd(f); } });
  document.addEventListener("keydown", e => {
    const t = e.target as HTMLElement;
    if (e.key === "Escape" && t.closest?.("[data-secnew]")) { e.preventDefault(); e.stopPropagation(); const slug = ADD?.slug; ADD = null; if (slug) D!.repaint(slug); return; }
    const r = t.closest?.<HTMLInputElement>("[data-secren]");
    if (r && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); const slug = REN?.slug; REN = null; if (slug) D!.repaint(slug); }
    else if (r && e.key === "Enter") { e.preventDefault(); r.blur(); }
  }, true);
  document.addEventListener("focusout", e => {
    const r = (e.target as HTMLElement).closest?.<HTMLInputElement>("[data-secren]"); if (!r || !REN) return;
    const { slug, id } = REN, title = r.value.replace(/\s+/g, " ").trim(); REN = null;
    const cur = D!.cs(slug).sections.find(s => s.id === id);
    if (cur && title && title !== cur.title && title.toLowerCase() !== UNCAT.toLowerCase()) void change(slug, { action: "update", id, title }); else D!.repaint(slug);
  });
  // Drag a task onto any part of a section, or drag a section header onto another section to move it there.
  document.addEventListener("dragstart", e => {
    const t = e.target as HTMLElement; if (!t.closest) return;
    const task = t.closest<HTMLElement>("[data-tid]"), sec = task ? null : t.closest<HTMLElement>("[data-secdrag]");
    if (!task && !sec) return;
    DRAG = task ? { kind: "task", id: task.dataset.tid!, slug: D!.current() } : { kind: "sec", id: sec!.dataset.secdrag!, slug: D!.current() };
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", DRAG.id); }
    (task || sec)!.classList.add("secdragging");
  });
  document.addEventListener("dragover", e => {
    if (!DRAG) return; const g = (e.target as HTMLElement).closest?.<HTMLElement>("[data-secdrop]"); if (!g) return;
    if (DRAG.kind === "sec" && g.dataset.secdrop === DRAG.id) return;
    e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const cls = DRAG.kind === "task" ? "dropon" : "dropbefore";
    if (!g.classList.contains(cls)) { document.querySelectorAll(".dropon,.dropbefore").forEach(x => x.classList.remove("dropon", "dropbefore")); g.classList.add(cls); }
  });
  document.addEventListener("drop", e => {
    if (!DRAG) return; const g = (e.target as HTMLElement).closest?.<HTMLElement>("[data-secdrop]"); const d = DRAG; DRAG = null; clearMarks(); if (!g) return;
    e.preventDefault(); const to = g.dataset.secdrop!;
    if (d.kind === "task") { moveTask(d.slug, d.id, to || null); return; }
    const ids = D!.cs(d.slug).sections.map(s => s.id).filter(i => i !== d.id), at = to ? ids.indexOf(to) : 0;
    ids.splice(at < 0 ? ids.length : at, 0, d.id); void change(d.slug, { action: "reorder", ids });
  });
  document.addEventListener("dragend", () => { DRAG = null; clearMarks(); });
}

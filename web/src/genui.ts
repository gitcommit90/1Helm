// the design sandbox/genui/: what 1HC chat replies could look like as cards instead of markdown.
// The cards are parsed by the REAL OpenUI parser (@openuidev/lang-core, streaming) and drawn by our own small
// component set, in 1HC's style. No React. The replies are scripted, not live model output.
import { createStreamingParser, createParser } from "@openuidev/lang-core";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { SCENES, type Scene } from "./genui-scenes";
import REAL from "./genui-real.json";
// REAL = one unedited glm-5.3-flash reply per errand from the reliability test (default reasoning = max), economics/genui-bench.

// ── The component library the AI is allowed to use (positional args follow this key order) ──
const C: Record<string, string[]> = {
  Stack: ["children"], Say: ["text"], Tip: ["text"],
  Options: ["name", "options"], Option: ["title", "detail", "price", "tag"],
  Buttons: ["buttons"], Button: ["label", "action", "variant"],
  Form: ["name", "fields", "submit"], Stepper: ["name", "label", "value", "min", "max"],
  Choice: ["name", "label", "options", "multi", "value"], Field: ["name", "label", "placeholder"],
  Big: ["value", "label", "delta"], Bars: ["labels", "values", "unit", "mark"], Rows: ["rows"],
  Email: ["to", "subject", "body"], File: ["name", "meta", "kind"], Meter: ["label", "used", "note"],
};
const REQ: Record<string, string[]> = { Stack: ["children"], Say: ["text"], Tip: ["text"], Options: ["name", "options"], Option: ["title"],
  Buttons: ["buttons"], Button: ["label", "action"], Form: ["name", "fields"], Stepper: ["name", "label"], Choice: ["name", "label", "options"],
  Field: ["name", "label"], Big: ["value"], Bars: ["labels", "values"], Rows: ["rows"], Email: ["to"], File: ["name"], Meter: ["label", "used"] };
const SCHEMA = { $defs: Object.fromEntries(Object.entries(C).map(([k, ps]) => [k, { properties: Object.fromEntries(ps.map((p) => [p, {}])), required: REQ[k] }])) };

type Node = { type: "element"; typeName: string; props: Record<string, any>; partial: boolean };
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const paras = (s: string) => String(s).split(/\n{2,}/).map((p) => `<p>${inline(p).replace(/\n/g, "<br>")}</p>`).join("");
const isNode = (x: any): x is Node => x && x.type === "element";
const md = (s: string) => DOMPurify.sanitize(marked.parse(s, { async: false }) as string);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends HTMLElement = HTMLElement>(q: string, el: ParentNode = document) => el.querySelector(q) as T;

// ── Per-scene interaction state ──
type St = { vals: Record<string, any>; done?: string; thread: { you: string; reply: string; typing?: boolean }[] };
const state: Record<string, St> = {};
const st = (k: string) => (state[k] ??= { vals: {}, thread: [] });

// ── Renderer: node tree → HTML in 1HC's style ──
function r(n: any, s: St, streaming: boolean): string {
  if (Array.isArray(n)) return n.map((x) => r(x, s, streaming)).join("");
  if (!isNode(n)) return "";
  const p = n.props, cls = "";
  switch (n.typeName) {
    case "Stack": return `<div class="gu-stack">${r(p.children, s, streaming)}</div>`;
    case "Say": return `<div class="gu-say${cls}">${paras(p.text)}</div>`;
    case "Tip": return `<div class="gu-tip${cls}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><span>${inline(p.text)}</span></div>`;
    case "Options": {
      const opts = (p.options || []).filter((o: any) => isNode(o) && o.props.title);
      const cur = s.vals[p.name] ?? (opts.find((o: Node) => o.props.tag && /best/i.test(o.props.tag)) || opts[0])?.props.title;
      if (cur && s.vals[p.name] == null && !n.partial) s.vals[p.name] = cur;
      return `<div class="gu-opts" role="radiogroup">${opts.map((o: Node) => { const q = o.props, on = q.title === cur;
        return `<button class="gu-opt${on ? " on" : ""}" role="radio" aria-checked="${on}" data-set="${esc(p.name)}" data-v="${esc(q.title)}">
          <i class="gu-rad"></i><span class="gu-ot"><b>${esc(q.title)}</b>${q.tag ? `<em class="${/best/i.test(q.tag) ? "best" : ""}">${esc(q.tag)}</em>` : ""}<span>${esc(q.detail || "")}</span></span><span class="gu-pr">${esc(q.price || "")}</span></button>`; }).join("")}</div>`;
    }
    case "Buttons": return `<div class="gu-btns${cls}">${r(p.buttons, s, streaming)}</div>`;
    case "Button": { const on = s.done === p.action;
      return `<button class="gu-b ${esc(p.variant || "secondary")}${on ? " picked" : ""}" data-act="${esc(p.action)}"${s.done ? " disabled" : ""}>${on ? "✓ " : ""}${esc(p.label)}</button>`; }
    case "Form": return `<div class="gu-form${cls}">${r(p.fields, s, streaming)}${p.submit ? `<div class="gu-btns"><button class="gu-b primary${s.done ? " picked" : ""}" data-act="submit:${esc(p.name)}"${s.done ? " disabled" : ""}>${s.done ? "✓ " : ""}${esc(p.submit)}</button></div>` : ""}</div>`;
    case "Stepper": { const v = s.vals[p.name] ?? p.value ?? 0; if (s.vals[p.name] == null && p.value != null) s.vals[p.name] = v;
      return `<div class="gu-row"><span>${esc(p.label)}</span><span class="gu-step"><button data-inc="${esc(p.name)}" data-d="-1" data-min="${p.min ?? 0}" aria-label="Fewer">−</button><b>${v}</b><button data-inc="${esc(p.name)}" data-d="1" data-max="${p.max ?? 9}" aria-label="More">+</button></span></div>`; }
    case "Choice": { let v = s.vals[p.name]; if (v == null) { v = p.multi ? [] : (p.value || ""); s.vals[p.name] = v; }
      return `<div class="gu-field"><span>${esc(p.label)}</span><div class="gu-chips">${(p.options || []).map((o: string) => { const on = p.multi ? v.includes(o) : v === o;
        return `<button class="gu-chip${on ? " on" : ""}" data-chip="${esc(p.name)}" data-v="${esc(o)}" data-multi="${p.multi ? 1 : ""}">${on ? "✓ " : ""}${esc(o)}</button>`; }).join("")}</div></div>`; }
    case "Field": return `<label class="gu-field"><span>${esc(p.label)}</span><input data-in="${esc(p.name)}" value="${esc(s.vals[p.name] || "")}" placeholder="${esc(p.placeholder || "")}"></label>`;
    case "Big": return `<div class="gu-big${cls}"><b>${esc(p.value)}</b><span>${esc(p.label || "")}</span>${p.delta ? `<em>${esc(p.delta)}</em>` : ""}</div>`;
    case "Bars": { const L = p.labels || [], V = (p.values || []).filter((x: any) => typeof x === "number"), mx = Math.max(1, ...V), mark = p.mark ?? V.length - 1;
      return `<div class="gu-bars${cls}">${L.map((l: string, i: number) => V[i] == null ? "" : `<div class="gu-bar${i === mark ? " hot" : ""}"><em>${esc(p.unit || "")}${V[i]}</em><i style="height:${Math.round((V[i] / mx) * 100)}%"></i><span>${esc(l)}</span></div>`).join("")}</div>`; }
    case "Rows": return `<div class="gu-rows${cls}">${(p.rows || []).filter(Array.isArray).map((x: any[]) => `<div><span>${esc(x[0] ?? "")}</span><b>${esc(x[1] ?? "")}</b></div>`).join("")}</div>`;
    case "Email": return `<div class="gu-mail${cls}"><div class="gu-mh"><span>To</span><b>${esc(p.to)}</b></div>${p.subject ? `<div class="gu-mh"><span>Subject</span><b>${esc(p.subject)}</b></div>` : ""}<div class="gu-mb">${paras(p.body || "")}</div></div>`;
    case "File": return `<div class="gu-file${cls}"><div class="gu-thumb ${esc(p.kind || "")}">${p.kind === "flyer" ? `<b>GARAGE<br>SALE</b><span>SAT · 8–1</span><i>412 Alder St</i><small>Furniture · Kids stuff · Tools</small>` : ""}</div><div class="gu-fm"><b>${esc(p.name)}</b><span>${esc(p.meta || "")}</span><span class="gu-links"><a>Open</a><a>Download</a></span></div></div>`;
    case "Meter": { const u = Math.max(0, Math.min(1, +p.used || 0));
      return `<div class="gu-meter${cls}"><div class="gu-mt"><b>${esc(p.label)}</b><span>${Math.round(u * 100)}% used</span></div><div class="gu-track"><i style="width:${u * 100}%"></i></div>${p.note ? `<small>${esc(p.note)}</small>` : ""}</div>`; }
  }
  return ""; // unknown component: never show raw code to a person
}


// Streaming-safe DOM update: patch the existing nodes in place instead of replacing innerHTML every chunk.
// Nodes that already exist are kept (so their enter animation never restarts); only NEW card nodes animate in.
function patch(el: HTMLElement, html: string, animateNew: boolean) {
  const tpl = document.createElement("template"); tpl.innerHTML = html; morphKids(el, tpl.content, animateNew);
}
function morphKids(from: Node, to: Node, anim: boolean) {
  const a = [...from.childNodes], b = [...to.childNodes];
  b.forEach((nb, i) => {
    const na = a[i];
    if (!na) { from.appendChild(enter(nb, anim)); return; }
    if (na.nodeType !== nb.nodeType || na.nodeName !== nb.nodeName) { from.replaceChild(enter(nb, anim), na); return; }
    if (na.nodeType === 3 || na.nodeType === 8) { if (na.nodeValue !== nb.nodeValue) na.nodeValue = nb.nodeValue; return; }
    const ea = na as Element, eb = nb as Element;
    for (const at of [...ea.attributes]) if (!eb.hasAttribute(at.name) && at.name !== "data-entered") ea.removeAttribute(at.name);
    for (const at of [...eb.attributes]) {
      let v = at.value; if (at.name === "class" && ea.classList.contains("gu-in")) v += " gu-in";
      if (ea.getAttribute(at.name) !== v) ea.setAttribute(at.name, v);
    }
    if (ea instanceof HTMLInputElement && document.activeElement === ea) return;
    morphKids(ea, eb, anim);
  });
  for (let i = a.length - 1; i >= b.length; i--) from.removeChild(a[i]);
}
function enter(n: Node, anim: boolean) {
  if (anim && n instanceof HTMLElement && /\bgu-(say|tip|opt|btns|form|big|bars|rows|mail|file|meter|field|row)\b/.test(n.className)) n.classList.add("gu-in");
  return n;
}

// ── Fallback: the same card tree as a plain text for iMessage (generated, not hand-written) ──
function toText(n: any, s: St): string[] {
  if (Array.isArray(n)) return n.flatMap((x) => toText(x, s));
  if (!isNode(n)) return [];
  const p = n.props, plain = (t: string) => String(t || "").replace(/\*\*(.+?)\*\*/g, "$1");
  switch (n.typeName) {
    case "Stack": return toText(p.children, s);
    case "Say": case "Tip": return [plain(p.text)];
    case "Options": return [(p.options || []).filter(isNode).map((o: Node, i: number) => `${i + 1}. ${o.props.title} ${o.props.price || ""}${o.props.tag ? ` (${o.props.tag.toLowerCase()})` : ""}\n${o.props.detail || ""}`).join("\n\n")];
    case "Buttons": { const b = (p.buttons || []).filter(isNode).map((x: Node) => x.props.label);
      return b.length ? [`Reply ${b.map((x: string) => `"${x}"`).join(b.length > 2 ? ", " : " or ").replace(/, ([^,]*)$/, " or $1")}.`] : []; }
    case "Form": { const f = (p.fields || []).filter(isNode) as Node[];
      const got = f.map((x) => x.typeName === "Stepper" ? `${x.props.label}: ${x.props.value}` : x.typeName === "Choice" && x.props.value ? `${x.props.label.replace(/,.*$/, "")}: ${x.props.value}` : "").filter(Boolean);
      const ask = f.filter((x) => (x.typeName === "Choice" && !x.props.value) || x.typeName === "Field").map((x) => x.typeName === "Choice" ? `${x.props.label} (${x.props.options.join(", ")})` : x.props.label);
      return [`I filled in:\n${got.join("\n")}`, `${ask.length ? `Also: ${ask.join(" ")}\n\n` : ""}Reply "Send" as is, or tell me what to change.`]; }
    case "Big": return [`${p.value}: ${p.label}${p.delta ? ` (${p.delta})` : ""}`];
    case "Bars": return [`Last ${(p.labels || []).length} months: ${(p.labels || []).map((l: string, i: number) => `${l} ${p.unit || ""}${p.values?.[i]}`).join(", ")}`];
    case "Rows": return [(p.rows || []).map((x: any[]) => `${x[0]}: ${x[1]}`).join("\n")];
    case "Email": return [`Draft to ${p.to}:\n\n${p.body}`];
    case "File": return [`📎 ${p.name}`];
    case "Meter": return [`${p.label}: ${Math.round((+p.used || 0) * 100)}% used. ${p.note || ""}`.trim()];
  }
  return [];
}

// ── Page ──
const NAME = "Skipper", AV = "/av/8.png";
const mq = matchMedia("(max-width:900px)");
let scene: Scene = SCENES.find((x) => x.k === (location.hash.slice(1) || "")) || SCENES[0];
let view: "compare" | "cards" | "text" | "imessage" = mq.matches ? "cards" : "compare";
let run = 0; let showCode = false;
let src: "scripted" | "real" = new URLSearchParams(location.search).get("src") === "real" ? "real" : "scripted";
const real = () => (REAL as any)[scene.k];
const LANG = () => (src === "real" ? real().code : scene.lang);

const who = (extra = "") => `<div class="who"><img class="av" src="${AV}" alt="">${NAME}${extra ? `<span>${esc(extra)}</span>` : ""}</div>`;
const youB = (t: string) => `<div class="m user"><div class="bubble">${esc(t)}</div></div>`;
const typing = `<div class="gu-typing"><i></i><i></i><i></i></div>`;

function shell() {
  document.body.innerHTML = `<header class="gtop"><a class="mark" href="/"><img src="/1helm-icon.png" alt="">1Helm</a><span class="proto">Mock</span>
    <div class="gtitle"><h1>Cards in chat</h1><p>What if ${NAME} answered with things you can tap instead of walls of text? Same answers, two ways.</p></div></header>
    <nav class="gtabs" id="tabs">${SCENES.map((x) => `<button data-scene="${x.k}">${esc(x.tab)}</button>`).join("")}</nav>
    <div class="gbar"><div class="seg" id="seg"></div><div class="seg" id="src"><button data-src="scripted">Scripted</button><button data-src="real">Real AI</button></div><span class="gsp"></span><button class="gq" id="code">What the AI wrote</button><button class="gq" id="again">↻ Replay</button></div>
    <p class="gnote" id="note"></p><main class="gpanes" id="panes"></main>
    <footer class="gfoot">Scripted by default; flip to <b>Real AI</b> to see glm-5.3-flash's own replies from the reliability test. The cards are parsed by the real OpenUI parser (<a href="https://github.com/thesysdev/openui" target="_blank" rel="noopener">thesysdev/openui</a>, MIT, about 8 KB) and drawn in 1HC's own style. The iMessage version is made automatically from the same cards.</footer>`;
  $("#tabs").onclick = (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-scene]"); if (!b) return; scene = SCENES.find((x) => x.k === b.dataset.scene)!; history.replaceState(null, "", `#${scene.k}`); delete state[scene.k]; paint(); };
  $("#seg").onclick = (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-view]"); if (!b) return; view = b.dataset.view as any; paint(); };
  $("#src").onclick = (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-src]"); if (!b) return; src = b.dataset.src as any; const u = new URL(location.href); src === "real" ? u.searchParams.set("src", "real") : u.searchParams.delete("src"); history.replaceState(null, "", u); delete state[scene.k]; paint(); };
  $("#again").onclick = () => { delete state[scene.k]; paint(); };
  $("#code").onclick = () => { showCode = !showCode; paint(false); };
  mq.addEventListener("change", () => { if (mq.matches && view === "compare") view = "cards"; if (!mq.matches && view === "cards") view = "compare"; paint(false); });
}

function pane(kind: "cards" | "text" | "imessage") {
  const head = { cards: ["With cards", "Tap to choose, fill in and approve"], text: ["Today", "The same answer as markdown"], imessage: ["By text", "When it reaches you in iMessage"] }[kind];
  return `<section class="gpane ${kind}" data-pane="${kind}"><header><b>${head[0]}</b><span>${head[1]}</span></header><div class="gscroll"><div class="msgs" data-msgs></div></div>
    ${kind === "imessage" ? "" : `<div class="gdock"><div class="gcomp">${kind === "text" ? "Type your answer…" : `Message ${NAME}…`}</div></div>`}</section>`;
}

function paint(restart = true) {
  document.querySelectorAll<HTMLElement>("#tabs [data-scene]").forEach((b) => b.classList.toggle("on", b.dataset.scene === scene.k));
  const opts = mq.matches ? [["cards", "Cards"], ["text", "Today"], ["imessage", "iMessage"]] : [["compare", "Side by side"], ["cards", "Cards"], ["imessage", "iMessage"]];
  $("#seg").innerHTML = opts.map(([k, l]) => `<button data-view="${k}" class="${view === k ? "on" : ""}">${l}</button>`).join("");
  $("#code").classList.toggle("on", showCode);
  document.querySelectorAll<HTMLElement>("#src [data-src]").forEach((b) => b.classList.toggle("on", b.dataset.src === src));
  $("#note").innerHTML = src === "real" ? `<b>Real AI:</b> the cards below are glm-5.3-flash's own unedited reply (${(real().ms / 1000).toFixed(1)} s, ${real().out} tokens). The markdown side is still the scripted one.` : "";
  const kinds = view === "compare" ? ["text", "cards"] : view === "imessage" ? ["cards", "imessage"] : [view];
  const panes = $("#panes"); panes.className = `gpanes n${mq.matches ? 1 : kinds.length}`;
  if (mq.matches && view === "imessage") kinds.splice(0, 1);
  if (restart || panes.dataset.k !== kinds.join() + scene.k) { panes.innerHTML = kinds.map((k) => pane(k as any)).join(""); panes.dataset.k = kinds.join() + scene.k; play(kinds); }
  else drawCards(true);
}

// Stream both panes at the same speed (~90 tokens/s after a short first-word wait), like a fast flash model.
async function play(kinds: string[]) {
  const my = ++run, s = st(scene.k), sc = scene;
  s.done = undefined; s.thread = []; s.vals = {};
  for (const k of kinds) { const m = $(`[data-pane="${k}"] [data-msgs]`); if (!m) continue;
    m.innerHTML = (sc.you ? youB(sc.you) : "") + `<div class="m agent first">${who(sc.nudge || "just now")}<div class="gu-reply" data-reply>${k === "imessage" ? "" : typing}</div></div><div data-thread></div>`; }
  if (kinds.includes("imessage")) drawText();
  await sleep(650); if (my !== run) return;
  const sp = createStreamingParser(SCHEMA);
  const L = LANG(), M = sc.md; let i = 0, j = 0;
  while (i < L.length || j < M.length) {
    if (my !== run) return;
    const step = 5 + Math.floor(Math.random() * 6); i = Math.min(L.length, i + step); j = Math.min(M.length, j + step);
    if (kinds.includes("cards")) { cardsTree = sp.set(L.slice(0, i)).root; drawCards(i < L.length); }
    if (kinds.includes("text")) { const el = $(`[data-pane="text"] [data-reply]`); if (el) patch(el, `<div class="bubble body">${md(M.slice(0, j))}</div>`, false); }
    await sleep(16);
  }
  cardsTree = createParser(SCHEMA).parse(L).root; drawCards(false);
}
let cardsTree: any = null;

function drawCards(streaming: boolean) {
  const el = $(`[data-pane="cards"] [data-reply]`); if (!el || !cardsTree) return;
  const s = st(scene.k);
  patch(el, r(cardsTree, s, streaming) + (showCode && !streaming ? `<details class="gu-code" open><summary>What the AI actually wrote (OpenUI Lang)</summary><pre>${esc(LANG())}</pre></details>` : ""), streaming);
  el.classList.toggle("locked", !!s.done);
  const t = $(`[data-pane="cards"] [data-thread]`); if (t) patch(t, s.thread.map((x) => youB(x.you) + `<div class="m agent first">${who("just now")}${x.typing ? typing : `<div class="bubble body"><p>${esc(x.reply)}</p></div>`}</div>`).join(""), false);
}
function drawText() {
  const el = $(`[data-pane="imessage"] [data-reply]`); if (!el) return;
  const parts = toText(createParser(SCHEMA).parse(LANG()).root, st(scene.k));
  el.innerHTML = `<div class="im">${parts.map((p) => `<div class="imb">${esc(p).replace(/\n/g, "<br>")}</div>`).join("")}<small>Delivered</small></div>`;
}

async function act(action: string) {
  const s = st(scene.k); if (s.done) return;
  s.done = action; const lbl = (document.querySelector(`[data-pane="cards"] [data-act="${CSS.escape(action)}"]`) as HTMLElement)?.textContent?.trim() || action;
  const a = src === "real" ? { you: lbl, reply: `(Mock: this is where ${NAME} would actually do "${lbl}" and report back.)` } : scene.after(action, s.vals); s.thread.push({ ...a, typing: true }); drawCards(false);
  $(`[data-pane="cards"] [data-thread]`)?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
  await sleep(900); s.thread[s.thread.length - 1].typing = false; drawCards(false);
  $(`[data-pane="cards"] [data-thread]`)?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
}

document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-set],[data-act],[data-inc],[data-chip]"); if (!t || !t.closest("[data-pane=cards]")) return;
  const s = st(scene.k); if (s.done) return;
  if (t.dataset.set) { s.vals[t.dataset.set] = t.dataset.v; drawCards(false); }
  else if (t.dataset.inc) { const n = t.dataset.inc, d = +t.dataset.d!, v = (s.vals[n] ?? 0) + d; if ((t.dataset.min == null || v >= +t.dataset.min) && (t.dataset.max == null || v <= +t.dataset.max)) { s.vals[n] = v; drawCards(false); } }
  else if (t.dataset.chip) { const n = t.dataset.chip, v = t.dataset.v!; if (t.dataset.multi) { const a = new Set<string>(s.vals[n] || []); if (v === "Not this time") a.clear(); else a.delete("Not this time"); a.has(v) ? a.delete(v) : a.add(v); s.vals[n] = [...a]; } else s.vals[n] = v; drawCards(false); }
  else if (t.dataset.act) act(t.dataset.act);
});
document.addEventListener("input", (e) => { const t = e.target as HTMLInputElement; if (t.dataset.in) st(scene.k).vals[t.dataset.in] = t.value; });

shell(); paint();

// Cards in chat (generative UI): the standalone card renderer. A helper reply that is OpenUI-shaped (section 1: every line a
// statement or a bare component call, optionally inside one ``` or ```openui fence; `root = Stack(` first always counts) is
// OpenUI Lang: repaired (section 2), parsed by @openuidev/lang-core and drawn by this small vanilla renderer in the approved
// the design sandbox/genui look (CSS: the "Cards in chat" block in v3.css). Prose with code lines after it is split into parts
// (replyParts). Anything else stays the host's markdown, after a safety net that never lets a component call through
// (scrubCode). Ported from src/genui.ts (the mock).
// Self-contained on purpose: no dependency on the chat app's state, so the same cards can be hosted elsewhere (e.g. a
// standalone page opened from iMessage, notes/photon-imessage.md §7.3). Hosts supply callbacks: wireCards({ onSend, onChange }),
// and say whether the card is answered by passing `reply` (the next thing the person said after it).
// Two ways to paint: renderCard() returns HTML for a host that already morphs its thread in place (v3.ts), or
// paintCard(el, …) patches one element in place itself. Either way, streaming never rebuilds existing nodes.
// Rules (1HC.md 09-29): unknown or broken parts render nothing, never raw code; every card has a plain-text form.
import { createStreamingParser, createParser } from "@openuidev/lang-core";

// ── The component library the AI may use (positional args follow this key order). Same as genui.ts. ──
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
// Cards that may stand on their own in root (an orphaned Option/Button/field is a part, not a card).
const TOP = new Set(["Stack", "Say", "Tip", "Options", "Buttons", "Form", "Big", "Bars", "Rows", "Email", "File", "Meter"]);

type Node = { type: "element"; typeName: string; props: Record<string, any>; partial?: boolean };
const isNode = (x: any): x is Node => !!x && typeof x === "object" && x.type === "element";
const arr = (x: any): any[] => Array.isArray(x) ? x : [];
const str = (x: any) => x == null ? "" : typeof x === "string" ? x : typeof x === "number" || typeof x === "boolean" ? String(x) : "";
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const paras = (s: string) => String(s).split(/\n{2,}/).map((p) => `<p>${inline(p).replace(/\n/g, "<br>")}</p>`).join("");
const unbold = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");

// ── 1. Detecting a card reply (shared contract with proto src/genui.js: keep the two in step) ──
// A reply is a card reply when, after trimming and stripping one optional ``` / ```openui fence, it is OpenUI-shaped:
// every non-blank line belongs to a statement (multi-line arguments allowed, brackets and strings tracked like the parser's
// own statement splitter), each statement is an assignment (`hi = Say(…)`, `x = [1, 2]`) or a bare call of one of the 17
// components (`Say(…)`, `Stack([…])`), at least one of them calls a known component, and nothing follows a call on its line.
// The old head rule (`root = Stack(` first) still counts on its own. A reply that only mentions `Say(` in prose, or shows code
// inside a fence among prose, stays markdown. Mixed replies (prose, then code lines) are split by replyParts().
const KNOWN = new Set(Object.keys(C));
const HEAD = /^root\s*=\s*Stack\(/;
const ASSIGN = /^(\$?[A-Za-z_]\w*)\s*=(?!=)\s*/;
const FENCE = /^\s*```([\w-]*)\s*$/, FENCE_END = /^\s*```\s*$/;
// What a line starts: "call" = a known component call (bare `Say(` or `hi = Say(`); "stmt" = another assignment
// (`x = [1, 2]`, `c = Count(…)`); null = prose.
function lineKind(line: string): "call" | "stmt" | null {
  const s = line.trim(), a = s.match(ASSIGN), c = (a ? s.slice(a[0].length) : s).match(/^([A-Za-z_]\w*)\(/);
  if (c && KNOWN.has(c[1])) return "call";
  return a ? "stmt" : null;
}
// Where the statement starting at line i ends (brackets and "…"/'…' strings tracked across lines). clean = nothing but
// whitespace after the brackets close; open = still unclosed at the end of the text (streaming or cut off).
function stmtEnd(L: string[], i: number) {
  let depth = 0, q = "", bs = false, was = false;
  for (let j = i; j < L.length; j++) {
    const l = L[j];
    for (let k = 0; k < l.length; k++) {
      const ch = l[k];
      if (q) { if (bs) bs = false; else if (ch === "\\") bs = true; else if (ch === q) q = ""; continue; }
      if (ch === '"' || ch === "'") q = ch;
      else if ("([{".includes(ch)) { depth++; was = true; }
      else if (")]}".includes(ch)) { if (--depth < 0) return { end: j, clean: false, open: false };
        if (depth === 0 && !/^\s*;?\s*$/.test(l.slice(k + 1))) return { end: j, clean: false, open: false }; }
    }
    if (!q && depth === 0) return { end: j, clean: was || /=/.test(l), open: false };
  }
  return { end: L.length - 1, clean: true, open: true };
}
// From line i: statements (and blank lines between them) until a line that isn't one. end = index after the last statement.
function run(L: string[], i: number) {
  let j = i, end = i, strong = false;
  while (j < L.length) {
    if (!L[j].trim()) { j++; continue; }
    const k = lineKind(L[j]); if (!k) break;
    const e = stmtEnd(L, j); if (!e.clean) break;
    strong ||= k === "call"; end = j = e.end + 1;
  }
  return { end, strong };
}
// Any prefix of a statement head (`hi`, `hi = Sa`, `Sta`, `root = Stack(`): while streaming, wait (typing dots) instead of
// flashing it as text. Lower-case names only for statement names, so ordinary sentences show at once.
const HEADS = [...KNOWN].map((n) => n + "(");
function linePending(line: string) {
  const s = line.trim(); if (!s || s.length > 48) return false;
  const a = s.match(/^\$?[a-z_]\w*\s*(=\s*)?/), p = a ? s.slice(a[0].length) : s;
  if (a && !a[1]) return !p;
  return (a ? !p : false) || (!!p && HEADS.some((h) => h.startsWith(p)));
}
function unfence(body: string) {
  let t = String(body || "").trim();
  const f = t.match(/^```[A-Za-z-]*[ \t]*\n/); if (f) t = t.slice(f[0].length);
  return t.replace(/\n?```\s*$/, "").trim();
}
// The whole body as card code, or null. Streaming: a last line that may still become a statement is left out for now.
function wholeCard(body: string, streaming = false): string | null {
  const u = unfence(body); if (HEAD.test(u)) return u;
  const L = u.split("\n"), r = run(L, 0); if (!r.strong) return null;
  const rest = L.slice(r.end).filter((l) => l.trim());
  if (!rest.length) return u;
  return streaming && rest.length === 1 && L[L.length - 1].trim() && linePending(L[L.length - 1]) ? L.slice(0, r.end).join("\n").trim() : null;
}
/** The OpenUI code when this body is a card reply, else null. */
export function cardSrc(body: string): string | null { return wholeCard(body); }
/** While streaming: the text so far could still turn out to be a card (so don't paint it as markdown yet). */
export function cardPending(body: string) {
  let t = String(body || "").trimStart();
  if (/^`{1,3}[A-Za-z-]*$/.test(t)) return true;
  if (t.startsWith("```")) { const nl = t.indexOf("\n"); if (nl < 0) return true; t = t.slice(nl + 1).trimStart(); }
  return !t.includes("\n") && linePending(t);
}
export type Part = { k: "text" | "card" | "pending"; s: string };
/**
 * A reply as the parts to paint, in order: markdown text, card code, or (streaming only) a pending tail that may still
 * become code. A whole card reply is one card part. Otherwise unfenced runs of statement lines inside prose are cards
 * (the model said something, then wrote code), and a fenced block of card code that ends the reply is a card; any other
 * fenced block stays markdown (it's an example the person asked for).
 */
export function replyParts(body: string, streaming = false): Part[] {
  const t = String(body || "").trim(); if (!t) return [];
  const w = wholeCard(t, streaming); if (w !== null) return [{ k: "card", s: w }];
  if (streaming && cardPending(t)) return [{ k: "pending", s: "" }];
  const L = t.split("\n"), out: Part[] = []; let prose: string[] = [];
  const flush = () => { const s = prose.join("\n").trim(); if (s) out.push({ k: "text", s }); prose = []; };
  for (let i = 0; i < L.length;) {
    const f = L[i].match(FENCE);
    if (f) {
      let j = i + 1; while (j < L.length && !FENCE_END.test(L[j])) j++;
      const inner = L.slice(i + 1, j).join("\n"), last = L.slice(j + 1).every((l) => !l.trim());
      if (last && (!f[1] || /^openui/i.test(f[1]))) {
        const c = wholeCard(inner, streaming && j >= L.length);
        if (c !== null) { flush(); out.push({ k: "card", s: c }); return out; }
        if (streaming && j >= L.length && cardPending(inner)) { flush(); out.push({ k: "pending", s: "" }); return out; }
      }
      prose.push(...L.slice(i, j + 1)); i = j + 1; continue;
    }
    if (lineKind(L[i])) { const r = run(L, i); if (r.strong) { flush(); out.push({ k: "card", s: L.slice(i, r.end).join("\n").trim() }); i = r.end; continue; } }
    prose.push(L[i]); i++;
  }
  if (streaming && prose.length && L.length > 1 && linePending(prose[prose.length - 1])) { prose.pop(); flush(); out.push({ k: "pending", s: "" }); return out; }
  flush(); return out;
}

// ── 2. Repair (scripts/genui-repair.mjs): keep only the statements, name bare calls, give the reply a root when it has none
// (one Stack of the top-level cards nothing else lists), and attach cards the model defined but left out of root ──
const idents = (s: string) => s.replace(/"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?/g, " ").match(/\$?[A-Za-z_]\w*/g) || [];
function scan(src: string) {
  const L = src.split("\n"), drop: string[] = [];
  const st: { name: string; comp: string; text: string; bare: boolean }[] = [];
  for (let i = 0; i < L.length;) {
    if (!L[i].trim()) { i++; continue; }
    if (!lineKind(L[i])) { drop.push(L[i]); i++; continue; }
    const e = stmtEnd(L, i), text = L.slice(i, e.end + 1).join("\n").trim(), a = text.match(ASSIGN), rest = a ? text.slice(a[0].length) : text;
    st.push({ name: a ? a[1] : "", comp: rest.match(/^([A-Za-z_]\w*)\(/)?.[1] || "", text, bare: !a }); i = e.end + 1;
  }
  const names = new Set(st.map((s) => s.name).filter(Boolean)); let n = 0;
  for (const s of st) if (s.bare) { do s.name = `_c${++n}`; while (names.has(s.name)); names.add(s.name); s.text = `${s.name} = ${s.text}`; }
  if (!names.has("root")) {
    const used = new Set<string>(); for (const s of st) for (const id of idents(s.text.slice(s.text.indexOf("=") + 1))) used.add(id);
    const top = st.filter((s) => TOP.has(s.comp) && !used.has(s.name));
    if (top.length === 1 && top[0].comp === "Stack") { top[0].text = top[0].text.replace(ASSIGN, "root = "); top[0].name = "root"; }
    else if (top.length) st.unshift({ name: "root", comp: "Stack", text: `root = Stack([${top.map((s) => s.name).join(", ")}])`, bare: false });
  }
  const keep: string[] = []; let rootEnd = -1;
  for (const s of st) { keep.push(...s.text.split("\n")); if (s.name === "root" && rootEnd < 0) rootEnd = keep.length - 1; }
  return { code: keep.join("\n"), drop: drop.join("\n"), keep, rootEnd };
}
const PF = createParser(SCHEMA as any);
const FULL = new Map<string, { root: any; code: string }>();
function parseFull(src: string) {
  const hit = FULL.get(src); if (hit) return hit;
  const sc = scan(src); let code = sc.code, r: any;
  try { r = PF.parse(code); } catch { r = { root: null, meta: { orphaned: [] } }; }
  const orph: string[] = (r.meta?.orphaned || []).filter((n: string) => { const m = code.match(new RegExp(`^\\s*${n.replace(/\$/g, "\\$")}\\s*=\\s*([A-Za-z_]\\w*)\\(`, "m")); return m && TOP.has(m[1]); });
  if (r.root && orph.length && sc.rootEnd >= 0) {
    // Append to the END of root's list, so nothing already on screen moves.
    const lines = [...sc.keep], i = sc.rootEnd, j = lines[i].lastIndexOf("]");
    if (j >= 0) { const before = lines[i].slice(0, j), empty = /\[\s*$/.test(before) && i === lines.findIndex((l) => /^\s*root\s*=/.test(l));
      lines[i] = `${before}${empty ? "" : ", "}${orph.join(", ")}${lines[i].slice(j)}`; code = lines.join("\n");
      try { const r2 = PF.parse(code); if (r2.root) r = r2; } catch {} }
  }
  const out = { root: r.root || null, code };
  if (FULL.size > 200) FULL.delete(FULL.keys().next().value!); FULL.set(src, out); return out;
}
// One streaming parser per message being streamed (keyed by the message object).
const SP = new WeakMap<object, ReturnType<typeof createStreamingParser>>();
function parseLive(owner: object, src: string) {
  let sp = SP.get(owner); if (!sp) { sp = createStreamingParser(SCHEMA as any); SP.set(owner, sp); }
  try { return sp.set(scan(src).code).root || null; } catch { return null; }
}

// ── 3. Plain-text form: every Say/Tip string, in order ──
function sayTips(n: any, out: string[] = []): string[] {
  if (Array.isArray(n)) { n.forEach((x) => sayTips(x, out)); return out; }
  if (!isNode(n)) return out;
  if ((n.typeName === "Say" || n.typeName === "Tip") && str(n.props.text).trim()) out.push(str(n.props.text).trim());
  for (const v of Object.values(n.props)) if (Array.isArray(v) || isNode(v)) sayTips(v, out);
  return out;
}
// Last resort when the parser gives nothing: pull Say("…")/Tip("…") strings straight out of the code.
function sayTipsRaw(src: string) {
  const out: string[] = []; const re = /\b(?:Say|Tip)\(\s*"((?:[^"\\]|\\.)*)"/g; let m;
  while ((m = re.exec(src))) { try { out.push(JSON.parse(`"${m[1]}"`)); } catch { out.push(m[1]); } }
  return out.map((x) => x.trim()).filter(Boolean);
}
/**
 * Safety net for the markdown path: a line (outside fences, after an optional list/quote marker) that starts with a component
 * call or `root =` is replaced by its Say/Tip strings, or removed. Prose that mentions `Say(` mid-line or in backticks, and
 * fenced examples, are left alone.
 */
export function scrubCode(md: string) {
  const L = String(md || "").split("\n"), out: string[] = []; let fence = false, hit = false;
  for (let i = 0; i < L.length; i++) {
    if (/^\s*```/.test(L[i])) { fence = !fence; out.push(L[i]); continue; }
    const m = L[i].match(/^(\s*(?:[-*+>]\s+|\d+[.)]\s+)?)(.*)$/)!;
    if (fence || lineKind(m[2]) !== "call") { out.push(L[i]); continue; }
    const e = stmtEnd([m[2], ...L.slice(i + 1)], 0); if (!e.clean) { out.push(L[i]); continue; }   // a sentence that starts with a call
    const n = e.open ? 0 : e.end, t = sayTipsRaw([m[2], ...L.slice(i + 1, i + 1 + n)].join("\n"));
    if (t.length) out.push(m[1] + t.join(" ")); i += n; hit = true;
  }
  return hit ? out.join("\n").replace(/\n{3,}/g, "\n\n").trim() : String(md || "");
}
const oneText = (src: string) => { const t = sayTips(parseFull(src).root); return (t.length ? t : sayTipsRaw(src)).join("\n\n"); };
/** Plain text for a reply with cards in it (Say/Tip joined, prose kept); "" when there are no cards. Markdown bold is kept. */
export function cardText(body: string) {
  const ps = replyParts(body); if (!ps.some((p) => p.k === "card")) return "";
  return ps.map((p) => p.k === "card" ? oneText(p.s) : scrubCode(p.s)).filter((x) => x.trim()).join("\n\n");
}
/** For one-line previews (session list, home rows, notifications): plain text, never code. Works on cut-off previews too. */
export function plainPreview(s: string) {
  const raw = String(s || ""), ps = replyParts(raw);
  if (!ps.some((p) => p.k === "card") && scrubCode(raw) === raw) return raw;
  const live = (src: string) => { let t: string[] = []; try { t = sayTips(createStreamingParser(SCHEMA as any).set(scan(src).code).root); } catch {} return (t.length ? t : sayTipsRaw(src)).join(" "); };
  return unbold(ps.map((p) => p.k === "card" ? live(p.s) : p.k === "text" ? scrubCode(p.s) : "").join(" ")).replace(/\s+/g, " ").trim();
}

// ── 4. Interaction state, per card (client-side until it's sent) and what a later reply says was picked ──
type St = { vals: Record<string, any> };
const STATE = new Map<string, St>();
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const all = (n: any, type: string, out: Node[] = []): Node[] => {
  if (Array.isArray(n)) { n.forEach((x) => all(x, type, out)); return out; }
  if (!isNode(n)) return out; if (n.typeName === type) out.push(n);
  for (const v of Object.values(n.props)) if (Array.isArray(v) || isNode(v)) all(v, type, out);
  return out;
};
const chipOpts = (p: any) => arr(p.options).map((o) => isNode(o) ? str(o.props.title) : str(o)).filter(Boolean);
const optTitles = (p: any) => arr(p.options).filter((o) => isNode(o) && str(o.props.title)).map((o: Node) => str(o.props.title));
// The reply after a card ("Book Southwest\nflight: American"): which control it came from and the values it carried.
function pickedFrom(root: any, reply: string) {
  const lines = String(reply || "").split("\n"), first = (lines[0] || "").trim(), rest = lines.slice(1);
  const val = (label: string) => { const l = rest.find((x) => x.startsWith(`${label}:`)); return l == null ? undefined : l.slice(label.length + 1).trim(); };
  const vals: Record<string, any> = {}; let act = "";
  for (const b of all(root, "Button")) if (str(b.props.label).trim() === first) act = `b:${first}`;
  for (const f of all(root, "Form")) if (str(f.props.submit).trim() && str(f.props.submit).trim() === first) act = `f:${str(f.props.name)}`;
  if (!act) return { act, vals };
  for (const o of all(root, "Options")) { const v = val(str(o.props.name)); if (v && optTitles(o.props).includes(v)) vals[str(o.props.name)] = v; }
  for (const f of all(root, "Form")) for (const x of arr(f.props.fields).filter(isNode) as Node[]) {
    const p = x.props, v = val(str(p.label)); if (v === undefined) continue;
    if (x.typeName === "Stepper" && v !== "" && !isNaN(+v)) vals[str(p.name)] = +v;
    else if (x.typeName === "Choice") vals[str(p.name)] = p.multi ? v.split(/,\s*/).filter((c) => chipOpts(p).includes(c)) : v;
    else if (x.typeName === "Field") vals[str(p.name)] = v;
  }
  return { act, vals };
}

// ── 5. Renderer: node tree → HTML in the approved /genui look ──
export type FileHit = { fv: string; href: string; dl: string; image?: string } | null;
export type Ctx = { key: string; streaming: boolean; locked: boolean; act: string; file: (name: string) => FileHit; icon: (name: string) => string };
type R = Ctx & { s: St };
const IN = (c: R) => c.streaming ? " gu-in" : "";   // arrival animation only while streaming; existing nodes are kept by the morph, so it plays once
const dis = (c: R) => c.locked || c.streaming ? " disabled" : "";
function r(n: any, c: R): string {
  if (Array.isArray(n)) return n.map((x) => r(x, c)).join("");
  if (!isNode(n)) return "";
  const p = n.props || {};
  switch (n.typeName) {
    case "Stack": return `<div class="gu-stack">${r(arr(p.children), c)}</div>`;
    case "Say": return str(p.text) ? `<div class="gu-say${IN(c)}">${paras(str(p.text))}</div>` : "";
    case "Tip": return str(p.text) ? `<div class="gu-tip${IN(c)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><span>${inline(str(p.text))}</span></div>` : "";
    case "Options": {
      const name = str(p.name), opts = arr(p.options).filter((o) => isNode(o) && str(o.props.title)) as Node[]; if (!opts.length) return "";
      const def = (opts.find((o) => /best/i.test(str(o.props.tag))) || opts[0]).props.title;
      const cur = c.locked ? c.s.vals[name] : c.s.vals[name] ?? def; if (c.s.vals[name] == null && !n.partial && !c.streaming) c.s.vals[name] = cur;
      return `<div class="gu-opts${IN(c)}" role="radiogroup">${opts.map((o) => { const q = o.props, on = q.title === cur, tag = str(q.tag);
        return `<button type="button" class="gu-opt${on ? " on" : ""}${IN(c)}" role="radio" aria-checked="${on}" data-gset="${esc(name)}" data-v="${esc(q.title)}"${dis(c)}><i class="gu-rad"></i><span class="gu-ot"><b>${esc(q.title)}</b>${tag ? `<em class="${/best/i.test(tag) ? "best" : ""}">${esc(tag)}</em>` : ""}<span>${esc(str(q.detail))}</span></span><span class="gu-pr">${esc(str(q.price))}</span></button>`; }).join("")}</div>`;
    }
    case "Buttons": { const h = r(arr(p.buttons), c); return h ? `<div class="gu-btns${IN(c)}">${h}</div>` : ""; }
    case "Button": { const label = str(p.label); if (!label) return ""; const on = c.act === `b:${label}`, v = ["primary", "secondary", "ghost"].includes(p.variant) ? p.variant : "secondary";
      const act = str(p.action).trim().slice(0, 40);   // the host acts on a few ids before sending (share_location: the browser's location first)
      return `<button type="button" class="gu-b ${v}${on ? " picked" : ""}" data-gbtn="${esc(label)}"${act ? ` data-gact="${esc(act)}"` : ""}${dis(c)}>${on ? "✓ " : ""}${esc(label)}</button>`; }
    case "Form": { const name = str(p.name), on = c.act === `f:${name}`, sub = str(p.submit), h = r(arr(p.fields), c); if (!h && !sub) return "";
      return `<div class="gu-form${IN(c)}">${h}${sub ? `<div class="gu-btns"><button type="button" class="gu-b primary${on ? " picked" : ""}" data-gsub="${esc(name)}"${dis(c)}>${on ? "✓ " : ""}${esc(sub)}</button></div>` : ""}</div>`; }
    case "Stepper": { const name = str(p.name); if (!str(p.label)) return ""; const v = c.s.vals[name] ?? (typeof p.value === "number" ? p.value : 0); if (c.s.vals[name] == null && typeof p.value === "number" && !c.streaming) c.s.vals[name] = v;
      return `<div class="gu-row${IN(c)}"><span>${esc(str(p.label))}</span><span class="gu-step"><button type="button" data-ginc="${esc(name)}" data-d="-1" data-min="${typeof p.min === "number" ? p.min : 0}" aria-label="Fewer"${dis(c)}>−</button><b>${esc(v)}</b><button type="button" data-ginc="${esc(name)}" data-d="1" data-max="${typeof p.max === "number" ? p.max : 99}" aria-label="More"${dis(c)}>+</button></span></div>`; }
    case "Choice": { const name = str(p.name), o = chipOpts(p); if (!str(p.label) || !o.length) return ""; let v = c.s.vals[name];
      if (v == null) { v = p.multi ? [] : str(p.value); if (!c.streaming) c.s.vals[name] = v; }
      return `<div class="gu-field${IN(c)}"><span>${esc(str(p.label))}</span><div class="gu-chips">${o.map((x) => { const on = p.multi ? arr(v).includes(x) : v === x;
        return `<button type="button" class="gu-chip${on ? " on" : ""}" data-gchip="${esc(name)}" data-v="${esc(x)}" data-multi="${p.multi ? 1 : ""}"${dis(c)}>${on ? "✓ " : ""}${esc(x)}</button>`; }).join("")}</div></div>`; }
    case "Field": { const name = str(p.name); if (!str(p.label)) return "";
      return `<label class="gu-field${IN(c)}"><span>${esc(str(p.label))}</span><input data-gin="${esc(name)}" value="${esc(c.s.vals[name] || "")}" placeholder="${esc(str(p.placeholder))}"${dis(c)}></label>`; }
    case "Big": return str(p.value) ? `<div class="gu-big${IN(c)}"><b>${esc(str(p.value))}</b><span>${esc(str(p.label))}</span>${str(p.delta) ? `<em>${esc(str(p.delta))}</em>` : ""}</div>` : "";
    case "Bars": { const L = arr(p.labels), V = arr(p.values).map((x) => typeof x === "number" ? x : NaN); const ok = V.filter((x) => !isNaN(x)); if (!L.length || !ok.length) return "";
      const mx = Math.max(1, ...ok), mark = typeof p.mark === "number" ? p.mark : V.length - 1, f = (x: number) => Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/\.?0+$/, "");
      return `<div class="gu-bars${IN(c)}">${L.map((l, i) => isNaN(V[i]) ? "" : `<div class="gu-bar${i === mark ? " hot" : ""}"><em>${esc(str(p.unit))}${f(V[i])}</em><i style="height:${Math.max(0, Math.round((V[i] / mx) * 100))}%"></i><span>${esc(str(l))}</span></div>`).join("")}</div>`; }
    case "Rows": { const rows = arr(p.rows).filter(Array.isArray); if (!rows.length) return "";
      return `<div class="gu-rows${IN(c)}">${rows.map((x: any[]) => `<div><span>${esc(str(x[0]))}</span><b>${esc(str(x[1]))}</b></div>`).join("")}</div>`; }
    case "Email": return str(p.to) ? `<div class="gu-mail${IN(c)}"><div class="gu-mh"><span>To</span><b>${esc(str(p.to))}</b></div>${str(p.subject) ? `<div class="gu-mh"><span>Subject</span><b>${esc(str(p.subject))}</b></div>` : ""}${str(p.body) ? `<div class="gu-mb">${paras(str(p.body))}</div>` : ""}</div>` : "";
    case "File": { const name = str(p.name); if (!name) return ""; const f = c.streaming ? null : c.file(name);
      const thumb = f?.image ? `<img src="${esc(f.image)}" alt="" loading="lazy">` : c.icon(name);
      return f ? `<div class="gu-file${IN(c)}"><a class="gu-thumb" href="${esc(f.href)}" data-fv="${esc(f.fv)}" aria-label="Open ${esc(name)}">${thumb}</a><div class="gu-fm"><b>${esc(name)}</b><span>${esc(str(p.meta))}</span><span class="gu-links"><a href="${esc(f.href)}" data-fv="${esc(f.fv)}">Open</a><a href="${esc(f.dl)}" download data-fdl>Download</a></span></div></div>`
        : `<div class="gu-file${IN(c)}"><div class="gu-thumb">${thumb}</div><div class="gu-fm"><b>${esc(name)}</b><span>${esc(str(p.meta))}</span></div></div>`; }
    case "Meter": { if (!str(p.label)) return ""; const u = Math.max(0, Math.min(1, +p.used || 0));
      return `<div class="gu-meter${IN(c)}"><div class="gu-mt"><b>${esc(str(p.label))}</b><span>${Math.round(u * 100)}% used</span></div><div class="gu-track"><i style="width:${u * 100}%"></i></div>${str(p.note) ? `<small>${esc(str(p.note))}</small>` : ""}</div>`; }
  }
  return ""; // unknown component: never show raw code to a person
}

// What the click handler needs to turn a tap into a message.
type Reg = { root: any; ref: any; s: St };
const REG = new Map<string, Reg>();
export type Out = { html: string } | { text: string } | null;
/**
 * Render a card body. Returns {html} for cards, {text} for the plain-text fallback (the caller paints it as markdown),
 * or null when it is not a card at all. `owner` is anything stable for the message being streamed.
 * `reply` = the next user message after this one in the thread (undefined if none): the card is then locked.
 */
export function renderCard(body: string, o: { owner: object; ref: any; sid: string; streaming: boolean; reply?: string; file: Ctx["file"]; icon: Ctx["icon"] }): Out {
  const src = wholeCard(body, o.streaming); if (src === null) return null;
  const root = o.streaming ? parseLive(o.owner, src) : parseFull(src).root;
  const key = `${o.sid}:${hash(src)}`, s = STATE.get(key) ?? { vals: {} };
  const locked = o.reply !== undefined, pk = locked && root && !o.streaming ? pickedFrom(root, o.reply!) : { act: "", vals: {} };
  const view: St = locked ? { vals: { ...Object.fromEntries(Object.entries(s.vals).filter(([k]) => !all(root, "Options").some((x) => str(x.props.name) === k))), ...pk.vals } } : s;
  const inner = root ? r(root, { key, streaming: o.streaming, locked, act: pk.act, file: o.file, icon: o.icon, s: view }) : "";
  if (!o.streaming && !locked) STATE.set(key, s);
  if (!/class="gu-(?!stack)/.test(inner)) {   // nothing visible
    if (o.streaming) return { html: "" };
    const t = (root ? sayTips(root) : []); const txt = (t.length ? t : sayTipsRaw(src)).join("\n\n");
    return { text: txt || scrubCode(scan(src).drop.replace(/^\s*```.*$/gm, "")).trim() };
  }
  if (!o.streaming) REG.set(key, { root, ref: o.ref, s });
  return { html: `<div class="gu-reply${locked ? " locked" : ""}" data-guk="${esc(key)}">${inner}</div>` };
}

// ── 6. Taps. A tap sends a normal user message (shared contract); state changes repaint via the caller's morph. ──
function msgFor(g: Reg, t: HTMLElement): string | null {
  const vals = g.s.vals;
  if (t.dataset.gbtn) {
    const lines = [t.dataset.gbtn];
    for (const o of all(g.root, "Options")) { const n = str(o.props.name), v = vals[n] ?? optTitles(o.props)[0]; if (v) lines.push(`${n}: ${v}`); }
    return lines.join("\n");
  }
  if (t.dataset.gsub != null) {
    const f = all(g.root, "Form").find((x) => str(x.props.name) === t.dataset.gsub); if (!f) return null;
    const lines = [str(f.props.submit)];
    for (const x of arr(f.props.fields).filter(isNode) as Node[]) { const p = x.props, n = str(p.name), label = str(p.label); if (!label) continue;
      const v = vals[n]; lines.push(`${label}: ${Array.isArray(v) ? v.join(", ") : v ?? ""}`.trimEnd()); }
    return lines.join("\n");
  }
  return null;
}
/** Wire taps once per page. onSend(ref, text): send `text` as the person's message. onChange(ref): repaint that card. */
export function wireCards(h: { onSend: (ref: any, text: string, meta?: { action?: string }) => void; onChange: (ref: any) => void }) {
  document.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-gset],[data-gbtn],[data-gsub],[data-ginc],[data-gchip]"); if (!t) return;
    const box = t.closest<HTMLElement>("[data-guk]"), g = box && REG.get(box.dataset.guk!); if (!g || box!.classList.contains("locked") || (t as HTMLButtonElement).disabled) return;
    e.preventDefault(); const s = g.s;
    if (t.dataset.gset) { s.vals[t.dataset.gset] = t.dataset.v; h.onChange(g.ref); return; }
    if (t.dataset.ginc) { const n = t.dataset.ginc, v = (+s.vals[n] || 0) + +t.dataset.d!; if ((t.dataset.min == null || v >= +t.dataset.min) && (t.dataset.max == null || v <= +t.dataset.max)) { s.vals[n] = v; h.onChange(g.ref); } return; }
    if (t.dataset.gchip) { const n = t.dataset.gchip, v = t.dataset.v!;
      if (t.dataset.multi) { const a = new Set<string>(arr(s.vals[n])); if (/^(not this time|no |none)/i.test(v)) a.clear(); else for (const x of [...a]) if (/^(not this time|no |none)/i.test(x)) a.delete(x); a.has(v) ? a.delete(v) : a.add(v); s.vals[n] = [...a]; }
      else s.vals[n] = v; h.onChange(g.ref); return; }
    const m = msgFor(g, t); if (m) h.onSend(g.ref, m, { action: t.dataset.gact || "" });
  });
  document.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement; if (!t.dataset?.gin) return;
    const box = t.closest<HTMLElement>("[data-guk]"), g = box && REG.get(box.dataset.guk!); if (g) g.s.vals[t.dataset.gin] = t.value;
  });
}

// ── 7. Standalone hosts: paint one card body into an element, patching in place (never innerHTML per chunk) ──
function morphKids(a: Node, b: Node) {
  const na = [...a.childNodes], nb = [...b.childNodes];
  nb.forEach((y, i) => {
    const x = na[i];
    if (!x) { a.appendChild(y); return; }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { a.replaceChild(y, x); return; }
    if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return; }
    const ex = x as Element, ey = y as Element;
    for (const at of [...ex.attributes]) if (!ey.hasAttribute(at.name)) ex.removeAttribute(at.name);
    for (const at of [...ey.attributes]) if (ex.getAttribute(at.name) !== at.value) ex.setAttribute(at.name, at.value);
    if (ex.tagName !== "IMG") morphKids(ex, ey);
  });
  for (let i = na.length - 1; i >= nb.length; i--) na[i].remove();
}
/** Patch `el` to `html` in place: existing nodes stay (so their arrival animation never replays). */
export function patchHtml(el: Element, html: string) { const t = document.createElement("template"); t.innerHTML = html; morphKids(el, t.content); }
/** A stable owner object per part of a message (part 0 is the message's own owner), for streaming parsers. */
const SUB = new WeakMap<object, object[]>();
export function partOwner(owner: object, j: number) { if (!j) return owner; let a = SUB.get(owner); if (!a) SUB.set(owner, a = []); return a[j] ??= {}; }
/**
 * Paint a reply into `el` (call it on every streamed chunk with the text so far, then once with streaming:false).
 * Text parts and the plain-text fallback go through `md` (default: escaped paragraphs), after the code safety net.
 * Wire taps with wireCards().
 */
export function paintCard(el: Element, body: string, o: { owner?: object; ref?: any; sid?: string; streaming?: boolean; reply?: string; md?: (t: string) => string; file?: Ctx["file"]; icon?: Ctx["icon"] } = {}) {
  const md = o.md || ((t: string) => paras(t)), streaming = !!o.streaming, owner = o.owner || el;
  const say = (t: string) => { const x = scrubCode(t).trim(); return x ? `<div class="gu-say">${md(x)}</div>` : ""; };
  const html = replyParts(body, streaming).map((p, j) => {
    if (p.k === "text") return say(p.s);
    if (p.k === "pending") return "";
    const c = renderCard(p.s, { owner: partOwner(owner, j), ref: o.ref ?? el, sid: o.sid || "", streaming, reply: o.reply, file: o.file || (() => null), icon: o.icon || (() => "") });
    return c && "html" in c ? c.html : c ? say(c.text) : "";
  }).join("");
  patchHtml(el, html);
}

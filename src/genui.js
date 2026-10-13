// Cards in chat (generative UI). A reply is EITHER plain markdown OR a card reply:
// OpenUI Lang (thesysdev/openui, MIT): the whole reply OpenUI-shaped (see Detection; `root = Stack(` first, or statements and
// bare component calls with no root at all). Prose followed by code lines is split into parts. The app draws cards; everything
// that leaves the chat UI (texts, memory, previews, router input, the classic page) gets cardsToText(), a plain-text form of the
// same reply that never contains component code.
// Only @openuidev/lang-core is used: generatePrompt for the component reference, createParser for the text form.
// Shared contract with the app renderer (design-sandbox v3.ts): same 17 components, names and signatures as
// design-sandbox/scripts/genui-bench.mjs. Never name a component after an OpenUI built-in (Count, Sum, Each, Set, …).
import { generatePrompt, createParser } from "@openuidev/lang-core";

export const COMP = {
  Stack: ["Stack(children: Component[])", "The whole reply. Always the root."],
  Say: ["Say(text: string)", "A chat message bubble. Short, warm, plain words. **bold** allowed. Use this for all normal talking."],
  Tip: ["Tip(text: string)", "One small grey side note (a caveat or helpful extra)."],
  Options: ["Options(name: string, options: Option[])", "A pick-one list of choices the person taps."],
  Option: ["Option(title: string, detail?: string, price?: string, tag?: string)", "One choice. tag is a short label like \"Best fit\" or \"Cheapest\"."],
  Buttons: ["Buttons(buttons: Button[])", "A row of buttons."],
  Button: ["Button(label: string, action: string, variant?: \"primary\" | \"secondary\" | \"ghost\")", "Tapping it sends the label back to you as the person's reply. action is a short id. At most one primary per reply."],
  Form: ["Form(name: string, fields: (Stepper | Choice | Field)[], submit: string)", "A filled-in form. Pre-fill everything you already know. submit is the send button label."],
  Stepper: ["Stepper(name: string, label: string, value: number, min?: number, max?: number)", "A number with − and + buttons (headcounts, quantities)."],
  Choice: ["Choice(name: string, label: string, options: string[], multi?: boolean, value?: string)", "Tap-to-pick chips. multi=true allows several."],
  Field: ["Field(name: string, label: string, placeholder?: string)", "A short free-text box."],
  Big: ["Big(value: string, label?: string, delta?: string)", "One big headline number, e.g. a total or a balance."],
  Bars: ["Bars(labels: string[], values: number[], unit?: string, mark?: number)", "A small bar chart. mark = index of the bar to highlight."],
  Rows: ["Rows(rows: string[][])", "Label → value pairs, e.g. [[\"Tax\", \"$4.10\"], [\"Total\", \"$52.00\"]]."],
  Email: ["Email(to: string, subject: string, body: string)", "An email draft for the person to approve. Use \\n for new lines in body."],
  File: ["File(name: string, meta?: string, kind?: string)", "A file you made, shown as a card with Open/Download."],
  Meter: ["Meter(label: string, used: number, note?: string)", "A progress bar. used is a fraction from 0 to 1."],
};
const ARGS = Object.fromEntries(Object.entries(COMP).map(([k, [sig]]) => [k, [...sig.matchAll(/(\w+)\??:/g)].map((m) => m[1])]));
const SCHEMA = { $defs: Object.fromEntries(Object.entries(ARGS).map(([k, ps]) => [k, { properties: Object.fromEntries(ps.map((p) => [p, {}])) }])) };

// ---- Kill switch: env GENUI ("on" in wrangler.dev.jsonc; absent = off in prod), overridable per channel (resident setting "genui"). ----
export const genuiEnvOn = (env) => String(env?.GENUI || "").toLowerCase() === "on";

// ---- System prompt section. Built once per isolate and byte-identical every time, so the cached prompt prefix stays stable. ----
const EXAMPLES = [
  `root = Stack([hi, pick, go])
hi = Say("Here are two times that work. Which one?")
pick = Options("slot", [a, b])
a = Option("Tuesday", "9:00–9:30a", "", "Best fit")
b = Option("Thursday", "2:00–2:30p")
go = Buttons([Button("Book it", "book", "primary"), Button("Hold it for now", "hold", "secondary")])`,
  `root = Stack([hi, total, parts, data, go])
hi = Say("Your phone bill went up because the **promo credit ended**.")
total = Big("$92.40", "This month", "+$25 vs last month")
parts = Rows([["Plan", "$70.00"], ["Promo credit ended", "+$25.00"], ["Taxes and fees", "$12.40"]])
data = Meter("Data used", 0.62, "9.3 of 15 GB, resets Nov 3")
go = Buttons([Button("Find a cheaper plan", "shop", "primary"), Button("That's fine", "ok", "ghost")])`,
];
const RULES = [
  "Totals, balances, bills and prices that are the headline: Big. Not Bars, not a Say sentence. When you have the same kind of number for several periods (monthly bills, weekly spending), also show them as Bars with mark on the current one. Rows for a breakdown.",
  "Usage, progress and quotas (\"84% used\"): Meter with used as a fraction (84% = 0.84). Not Big.",
  "List every statement you define in root's children (or inside a card root lists). A statement nothing lists is dropped and never shown.",
  "At most one primary Button per reply; make the others secondary or ghost. Word each Button label as the person's reply (\"Book Southwest\", \"Send it\").",
  "In a card with Options, the Buttons confirm the pick (\"Book it\", \"Go with this one\"): every tap also sends the chosen option. Put a dismiss button (\"Not now\", \"Neither works\") only in a card without Options, or word it so it still reads right with the option line under it.",
  "End with Buttons for the next step whenever the person needs to decide something.",
  "Only use facts you actually have: from the person, your tools, files or memory. Never invent prices, times, dates, names, amounts or file names to fill a card. If you don't know a value, leave it out or use a Field for it.",
  "File only for a file you already shared with share_file. Email shows a draft only: nothing is sent until the person approves it.",
  "Where they are: when you need it and the location line with their message doesn't give it, add Button(\"Share my location\", \"share_location\", \"primary\") instead of asking in words. Tapping it shares their device's rough location and sends \"Share my location\".",
  "Use only the components listed above. Keep each Say to one or two short sentences.",
];
const INTRO = `## Replies: plain text or cards
The app can show your reply as tappable cards. Each reply is EITHER plain markdown (as usual) OR a card reply, never both.
Use a card reply when it saves the person reading or typing:
- a choice between a few options (flights, times, products, plans): Options + Buttons
- something to fill in or confirm, with everything you already know pre-filled: Form
- a total, balance or bill: Big (plus Bars for a trend, Rows for a breakdown)
- an email or message draft to approve before it's sent: Email + Buttons
- a file you made and shared: File
- usage, progress or a quota: Meter
When your answer has one of these in it, write it as a card reply even if you also explain something (a "why is my bill so high" answer is Big + Bars + Rows with the explanation in Say; a reply you drafted for them is an Email card, not a quoted draft in markdown).
Whenever you ask the person a question, make the reply a card reply with tappable answers, never a plain question they have to type an answer to:
- yes/no, confirm/cancel: Say + Buttons ("Yes, send it" primary, "Not now" ghost)
- pick one of a few: Options + one confirming Button (or just Buttons for 2–3 short choices)
- a missing detail (a date, a count, a name): Form with Field/Stepper/Choice, pre-filled with your best guesses
- truly open-ended ("anything else?"): Say only. They can always type, so don't invent buttons.
Stay plain markdown for a short answer, a quick status update, a long explanation with no numbers to show, thanks or small talk, and anything that has no question, choice, form, total, draft, file or usage in it.
A card reply is ONLY openui-lang code: the very first line is \`root = Stack([...])\`, then one statement per line. No text, markdown or code fences before or after the code. All talking goes in Say(...).
When the person taps a card, it arrives as an ordinary message from them. Read it exactly like typed words and act on it:
- a Button: the button's label, e.g. "Send it"
- a Button in a card that has Options: the label, then a new line "name: chosen title" (name is the Options name), e.g. "Book it" then "slot: Tuesday". The pick is the line after the label
- a Form: the submit label, then one "label: value" line per field
If they answer a card by typing instead ("2", "the second one", "Thursday"), match it to that card's options in order.`;
let _section = null;
// The component library's own text says "tables for comparisons"; there is no table component here (Rows is the closest), so say that.
const LIB_FIX = [["(tables for comparisons, charts for trends, forms for input, etc.)", "(Rows for label and value lists, Bars for trends, Form for input, etc.)"]];
export function genuiPromptSection() {
  return _section ||= `${INTRO}\n\n${LIB_FIX.reduce((t, [a, b]) => t.replace(a, b), generatePrompt({
    root: "Stack",
    preamble: "How to write a card reply (openui-lang):",
    components: Object.fromEntries(Object.entries(COMP).map(([k, [signature, description]]) => [k, { signature, description }])),
    examples: EXAMPLES,
    additionalRules: RULES,
  }).trim())}`;
}

// ---- Detection (the contract, same as design-sandbox src/genui-render.ts section 1: keep the two in step) ----
// A reply is a card reply when, after trimming and stripping one optional ``` / ```openui fence, it is OpenUI-shaped: every
// non-blank line belongs to a statement (multi-line arguments allowed; brackets and strings tracked like the parser's own
// statement splitter), each statement is an assignment (`hi = Say(…)`, `x = [1, 2]`) or a bare call of one of the 17 components
// (`Say(…)`, `Stack([…])`), at least one calls a known component, and nothing follows a call on its line. `root = Stack(` first
// still counts on its own. Prose that mentions `Say(`, or shows code in a fence among prose, stays markdown. A reply with prose
// and code lines (or a closing ```openui block) is split into parts by replySegments().
const KNOWN = new Set(Object.keys(COMP));
const TOP = new Set(["Stack", "Say", "Tip", "Options", "Buttons", "Form", "Big", "Bars", "Rows", "Email", "File", "Meter"]);   // cards that stand on their own
const HEAD = /^root\s*=\s*Stack\(/;
const ASSIGN = /^(\$?[A-Za-z_]\w*)\s*=(?!=)\s*/;
const FENCE = /^\s*```([\w-]*)\s*$/, FENCE_END = /^\s*```\s*$/;
function lineKind(line) {   // "call" = a known component call (bare or assigned); "stmt" = another assignment; null = prose
  const s = String(line).trim(), a = s.match(ASSIGN), c = (a ? s.slice(a[0].length) : s).match(/^([A-Za-z_]\w*)\(/);
  if (c && KNOWN.has(c[1])) return "call";
  return a ? "stmt" : null;
}
function stmtEnd(L, i) {   // where the statement at line i ends; clean = nothing after the brackets close; open = unclosed at the end
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
function run(L, i) {   // statements (and blank lines between them) from line i; end = index after the last one
  let j = i, end = i, strong = false;
  while (j < L.length) {
    if (!L[j].trim()) { j++; continue; }
    const k = lineKind(L[j]); if (!k) break;
    const e = stmtEnd(L, j); if (!e.clean) break;
    strong ||= k === "call"; end = j = e.end + 1;
  }
  return { end, strong };
}
export function stripFence(text) {
  let t = String(text ?? "").trim();
  const m = t.match(/^```[\w-]*[ \t]*\n([\s\S]*?)\n?```$/);
  if (m) t = m[1].trim();
  else if (/^```[\w-]*[ \t]*\n/.test(t)) t = t.replace(/^```[\w-]*[ \t]*\n/, "").trim();   // fence opened, never closed (cut off)
  return t;
}
function wholeCard(text) {   // the whole reply as card code, or null
  const u = stripFence(text); if (HEAD.test(u)) return u;
  const L = u.split("\n"), r = run(L, 0);
  return r.strong && L.slice(r.end).every((l) => !l.trim()) ? u : null;
}
export const isCardReply = (text) => wholeCard(text) !== null;
// A stored reply joins every thing said in the turn ("Let me look.\n\nSay(…)"). Its parts in order: { k: "text" | "card", s }.
export function replySegments(text) {
  const t = String(text ?? "").trim(); if (!t) return [];
  const w = wholeCard(t); if (w !== null) return [{ k: "card", s: w }];
  const L = t.split("\n"), out = []; let prose = [];
  const flush = () => { const s = prose.join("\n").trim(); if (s) out.push({ k: "text", s }); prose = []; };
  for (let i = 0; i < L.length;) {
    const f = L[i].match(FENCE);
    if (f) {   // a fenced block stays markdown (an example), unless it is card code that ends the reply
      let j = i + 1; while (j < L.length && !FENCE_END.test(L[j])) j++;
      const c = L.slice(j + 1).every((l) => !l.trim()) && (!f[1] || /^openui/i.test(f[1])) ? wholeCard(L.slice(i + 1, j).join("\n")) : null;
      if (c !== null) { flush(); out.push({ k: "card", s: c }); return out; }
      prose.push(...L.slice(i, j + 1)); i = j + 1; continue;
    }
    if (lineKind(L[i])) { const r = run(L, i); if (r.strong) { flush(); out.push({ k: "card", s: L.slice(i, r.end).join("\n").trim() }); i = r.end; continue; } }
    prose.push(L[i]); i++;
  }
  flush(); return out;
}
export const hasCards = (text) => replySegments(text).some((p) => p.k === "card");
// One thing said = one chat bubble. "Prose\n\nSay(…)" in a single message becomes two: the prose, then the card reply.
export function splitCardParts(text) { const ps = replySegments(text); return ps.length > 1 ? ps.map((p) => p.s) : [String(text ?? "")]; }

// ---- Repair (design-sandbox/scripts/genui-repair.mjs, same as genui-render.ts section 2): keep only the statements, name bare
// calls, give the reply a root when it has none (a Stack of the top-level cards nothing else lists, in the order written), then
// attach any card the model defined but forgot to list in root. ----
const idents = (s) => s.replace(/"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?/g, " ").match(/\$?[A-Za-z_]\w*/g) || [];
export function normalizeCards(src) {
  const L = String(src ?? "").split("\n"), drop = [], st = [];
  for (let i = 0; i < L.length;) {
    if (!L[i].trim()) { i++; continue; }
    if (!lineKind(L[i])) { drop.push(L[i]); i++; continue; }
    const e = stmtEnd(L, i), text = L.slice(i, e.end + 1).join("\n").trim(), a = text.match(ASSIGN), rest = a ? text.slice(a[0].length) : text;
    st.push({ name: a ? a[1] : "", comp: rest.match(/^([A-Za-z_]\w*)\(/)?.[1] || "", text, bare: !a }); i = e.end + 1;
  }
  const names = new Set(st.map((s) => s.name).filter(Boolean)); let n = 0;
  for (const s of st) if (s.bare) { do s.name = `_c${++n}`; while (names.has(s.name)); names.add(s.name); s.text = `${s.name} = ${s.text}`; }
  if (!names.has("root")) {
    const used = new Set(); for (const s of st) for (const id of idents(s.text.slice(s.text.indexOf("=") + 1))) used.add(id);
    const top = st.filter((s) => TOP.has(s.comp) && !used.has(s.name));
    if (top.length === 1 && top[0].comp === "Stack") { top[0].text = top[0].text.replace(ASSIGN, "root = "); top[0].name = "root"; }
    else if (top.length) st.unshift({ name: "root", comp: "Stack", text: `root = Stack([${top.map((s) => s.name).join(", ")}])`, bare: false });
  }
  return { code: st.map((s) => s.text).join("\n"), drop: drop.join("\n") };
}
let _parser = null;
const parser = () => _parser ||= createParser(SCHEMA, "Stack");
export function parseCards(text) {
  let code = normalizeCards(stripFence(String(text ?? "").split("</think>").pop()).replace(/\n?```\s*$/, "")).code;
  let r = parser().parse(code);
  if (r.meta?.orphaned?.length) {
    const o = r.meta.orphaned.join(", "), one = /^(root\s*=\s*Stack\(\[)(.*?)(\]\s*\)\s*)$/m;   // append (keeps reading order) when root fits on one line
    const fixed = one.test(code) ? code.replace(one, (_, a, b, c) => `${a}${b.trim() ? `${b}, ${o}` : o}${c}`) : code.replace(/^(root\s*=\s*Stack\(\[)/m, `$1${o}, `);
    const r2 = parser().parse(fixed); if (r2.root) r = r2;
  }
  return r;
}

// ---- Plain-text form (texts, memory, previews, the classic page, router input) ----
const isEl = (n) => n && typeof n === "object" && n.type === "element";
const str = (v) => v == null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
const join = (parts, sep = "\n") => parts.map((x) => String(x || "").trim()).filter(Boolean).join(sep);
const pct = (u) => { const n = Number(u); return Number.isFinite(n) ? `${Math.round(n <= 1 ? n * 100 : n)}%` : ""; };
// One text renderer per component. Exported so a later channel mapping (e.g. Photon: Options → a native poll, a whole card
// reply → a live app card URL) can override single components via cardsToText(text, overrides) or walk cardsTree() itself.
const kids = (v) => (Array.isArray(v) ? v : v != null ? [v] : []).filter(isEl);
function optionLine(n, i) {
  const p = n.props || {}, bits = [str(p.detail), str(p.price)].filter(Boolean).join(" · ");
  return `${i + 1}. ${str(p.title)}${bits ? ` — ${bits}` : ""}${str(p.tag) ? ` (${str(p.tag)})` : ""}`;
}
export const TEXT_RENDERERS = {
  Stack: (p, r) => join(kids(p.children).map(r), "\n\n"),
  Say: (p) => str(p.text),
  Tip: (p) => str(p.text),
  Options: (p) => join(kids(p.options).map(optionLine)),                      // numbered: a texted "2" / "the second one" picks it
  Option: (p, r, n) => optionLine(n, 0).replace(/^1\. /, ""),
  Buttons: (p) => { const ls = kids(p.buttons).map((b) => str(b.props?.label)).filter(Boolean); return ls.length ? `Reply with: ${ls.join(" / ")}` : ""; },
  Button: (p) => str(p.label) ? `Reply with: ${str(p.label)}` : "",
  Form: (p, r) => join([...kids(p.fields).map(r), str(p.submit) ? `Reply with: ${str(p.submit)}` : ""]),
  Stepper: (p) => `${str(p.label) || str(p.name)}: ${str(p.value)}`,
  Choice: (p) => { const label = str(p.label) || str(p.name), opts = (Array.isArray(p.options) ? p.options : []).map(str).filter(Boolean);
    return str(p.value) ? `${label}: ${str(p.value)}` : `${label}: ${opts.join(" / ")}${p.multi ? " (any)" : ""}`; },
  Field: (p) => `${str(p.label) || str(p.name)}: ${str(p.placeholder) ? `(${str(p.placeholder)})` : "…"}`,
  Big: (p) => `${str(p.label) ? `${str(p.label)}: ` : ""}${str(p.value)}${str(p.delta) ? ` (${str(p.delta)})` : ""}`,
  Bars: (p) => { const L = Array.isArray(p.labels) ? p.labels : [], V = Array.isArray(p.values) ? p.values : [], u = str(p.unit);
    return join(L.map((l, i) => `${str(l)}: ${u && /^[$€£]$/.test(u) ? u + str(V[i]) : `${str(V[i])}${u ? ` ${u}` : ""}`}`)); },
  Rows: (p) => join((Array.isArray(p.rows) ? p.rows : []).filter(Array.isArray).map((x) => x.length > 1 ? `${str(x[0])}: ${x.slice(1).map(str).join(" ")}` : str(x[0]))),
  Email: (p) => `${join([str(p.to) && `To: ${str(p.to)}`, str(p.subject) && `Subject: ${str(p.subject)}`])}\n\n${str(p.body).trim()}`.trim(),
  File: (p) => `File: ${str(p.name)}${str(p.meta) ? ` (${str(p.meta)})` : ""}`,
  Meter: (p) => `${str(p.label) ? `${str(p.label)}: ` : ""}${pct(p.used)} used${str(p.note) ? ` (${str(p.note)})` : ""}`,
};
// Render a parsed node (or array of nodes) to text. overrides: { [component]: (props, render, node) => string | undefined }.
export function renderText(n, overrides = {}) {
  const r = (x) => renderText(x, overrides);
  if (Array.isArray(n)) return join(n.map(r), "\n\n");
  if (!isEl(n)) return str(n);
  const p = n.props || {}, o = overrides[n.typeName]?.(p, r, n);
  if (o != null) return o;
  const f = TEXT_RENDERERS[n.typeName];
  return f ? f(p, r, n) : join(Object.values(p).flatMap((v) => Array.isArray(v) ? v : [v]).map((v) => isEl(v) ? r(v) : ""));   // unknown: its child cards only
}
// Say/Tip strings straight from the code, for when the parse finds nothing at all.
function sayStrings(code) {
  const out = [];
  for (const m of String(code).matchAll(/\b(?:Say|Tip)\(\s*"((?:[^"\\]|\\.)*)"/g)) { try { out.push(JSON.parse(`"${m[1]}"`)); } catch { out.push(m[1]); } }
  return out.join("\n\n");
}
// Safety net for text (same as genui-render.ts scrubCode): a line outside fences that starts (after an optional list/quote
// marker) with a complete component call is replaced by its Say/Tip strings, or removed. Mentions mid-sentence, in backticks or
// in a fenced example stay as they are.
export function scrubCode(text) {
  const L = String(text ?? "").split("\n"), out = []; let fence = false, hit = false;
  for (let i = 0; i < L.length; i++) {
    if (/^\s*```/.test(L[i])) { fence = !fence; out.push(L[i]); continue; }
    const m = L[i].match(/^(\s*(?:[-*+>]\s+|\d+[.)]\s+)?)(.*)$/);
    if (fence || lineKind(m[2]) !== "call") { out.push(L[i]); continue; }
    const e = stmtEnd([m[2], ...L.slice(i + 1)], 0); if (!e.clean) { out.push(L[i]); continue; }
    const n = e.open ? 0 : e.end, t = sayStrings([m[2], ...L.slice(i + 1, i + 1 + n)].join("\n")).replace(/\n\n/g, " ");
    if (t.trim()) out.push(m[1] + t); i += n; hit = true;
  }
  return hit ? out.join("\n").replace(/\n{3,}/g, "\n\n").trim() : String(text ?? "");
}
// The first Say text in a card tree (for previews, OG descriptions and iMessage card captions).
export function firstSay(root) {
  let out = ""; const walk = (n) => { if (out || !n) return; if (Array.isArray(n)) return n.forEach(walk); if (!isEl(n)) return;
    if (n.typeName === "Say" && str(n.props?.text).trim()) { out = str(n.props.text).trim(); return; } Object.values(n.props || {}).forEach(walk); };
  walk(root); return out;
}
// A card worth a live app card (texting): anything beyond Say/Tip talk. A reply that is only Say/Tip is texted as plain text.
export function isRealCard(root) {
  let real = false; const walk = (n) => { if (real || !n) return; if (Array.isArray(n)) return n.forEach(walk); if (!isEl(n)) return;
    if (!["Stack", "Say", "Tip"].includes(n.typeName)) { real = true; return; } Object.values(n.props || {}).forEach(walk); };
  walk(root); return real;
}
// The parsed form of a reply: prose said before the card and after it (if any), the card tree (null when there's no card or
// nothing parses), and the card code (every code part of the reply, in order).
export function cardsTree(text) {
  const ps = replySegments(text), first = ps.findIndex((p) => p.k === "card");
  if (first < 0) return { before: String(text ?? ""), after: "", root: null, meta: null, code: "" };
  const prose = (a) => a.filter((p) => p.k === "text").map((p) => scrubCode(p.s)).filter((s) => s.trim()).join("\n\n");
  const code = ps.filter((p) => p.k === "card").map((p) => p.s).join("\n");
  let r = null; try { r = parseCards(code); } catch {}
  return { before: prose(ps.slice(0, first)), after: prose(ps.slice(first + 1)), root: r?.root || null, meta: r?.meta || null, code };
}
// The text of one code part. Parse failure → the Say/Tip strings → the prose lines mixed into it. Never the code itself.
function codeText(code, overrides) {
  let body = "", r = null;
  try { r = parseCards(code); if (r.root) body = renderText(r.root, overrides); } catch {}
  if (!body.trim()) body = sayStrings(code);
  if (!body.trim()) body = scrubCode(normalizeCards(stripFence(code)).drop);
  return body;
}
// The plain-text form of any reply. Text without cards comes back unchanged (unless a stray component call needs scrubbing).
export function cardsToText(text, overrides = {}) {
  const ps = replySegments(text);
  if (!ps.some((p) => p.k === "card")) return scrubCode(String(text ?? ""));
  return join(ps.map((p) => p.k === "card" ? codeText(p.s, overrides) : scrubCode(p.s)), "\n\n");
}
// A paused / step-capped report (spendguard.js, stop.js): the app shows its own Keep going / Stop here card, so a card in the
// model's report with its own keep-going / stop buttons would be a second set that doesn't reach the Continue path. Each card part
// holding such a button becomes its plain text without those buttons; everything else stays as written.
const PAUSE_BTN = /\b(keep going|continue|carry on|go on|resume|stop)\b/i;
const isPauseBtn = (b) => isEl(b) && (PAUSE_BTN.test(str(b.props?.label)) || PAUSE_BTN.test(str(b.props?.action).replace(/[_-]/g, " ")));
function hasPauseBtn(n) {
  if (Array.isArray(n)) return n.some(hasPauseBtn);
  if (!isEl(n)) return false;
  if (n.typeName === "Button" && isPauseBtn(n)) return true;
  return Object.values(n.props || {}).some(hasPauseBtn);
}
const NO_PAUSE_BTNS = {
  Buttons: (p) => { const ls = kids(p.buttons).filter((b) => !isPauseBtn(b)).map((b) => str(b.props?.label)).filter(Boolean); return ls.length ? `Reply with: ${ls.join(" / ")}` : ""; },
  Button: (p, r, n) => isPauseBtn(n) ? "" : undefined,
};
export function stripPauseButtons(text) {
  const ps = replySegments(text);
  let hit = false;
  const out = ps.map((p) => {
    if (p.k !== "card") return p.s;
    let root = null; try { root = parseCards(p.s).root; } catch {}
    if (!root || !hasPauseBtn(root)) return p.s;
    hit = true; return renderText(root, NO_PAUSE_BTNS);
  });
  return hit ? join(out, "\n\n") : String(text ?? "");
}

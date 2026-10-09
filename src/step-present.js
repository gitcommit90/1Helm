// Step results for people (Captain 10-09: "the Result section is a raw dump of mostly noise … not keen on leaking system prompts and
// SKILL.md and other internal docs to users"). A tool's raw output is written for the model: untrusted-content wrappers, work-log
// notes, instructions to the model ("End your turn now…"), JSON, and for read_skill / read_doc our own playbooks. None of that is for
// the person, and our own docs must never leave the server. This module turns one step's raw output into a short, readable result:
//   presentStep(tool, args, raw, { status, exit, details }) → StepResult
//     { text,            one plain line (or two) saying what came of the step
//       error?,          a failure in plain words
//       links?,          [{ title, url, host }]   (web results, the page read, a calendar link)
//       items?,          ["…"]                     (top results, subjects, titles: short lines)
//       files?,          [{ name, path?, bytes? }] (file written / shared; tracker.js adds the Library id when there is one)
//       code?,           the last few meaningful lines of a command's output (monospace)
//       internal?,       true: our own docs/instructions; only the summary exists
//       more?,           true when stepDetail has a longer Details text
//       hidden?,         true when some of the output was 1Helm's own text and was cut
//       details? }       only with { details: true } (stepDetail): the longer readable text behind the "Details" toggle
// Internal tools (read_skill, read_doc, bring_back, work_log, recall_history, memory_explain, …) only ever get a summary line, and
// the server stores and sends only that (tracker.js). Everything else passes through the leak guard (leakGuard): any run of words
// from src/skills/**/*.md, src/docs/*.md or src/prompt/*.md is cut, whatever tool it came through (cat of a SKILL.md, a model
// that pasted a playbook into a file, …). Pure functions; no I/O. Old stored previews go through the same code when they're sent.
import { FILES } from "./skills/bundle.js";
import { DOCS } from "./docs/index.js";
import { SECTIONS } from "./prompt/index.js";

const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const ell = (s, n) => { s = one(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
const hostOf = (u) => { try { return new URL(String(u)).hostname.replace(/^www\./, ""); } catch { return ""; } };
const baseName = (p) => String(p || "").split("/").filter(Boolean).pop() || "";
const jparse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
const plural = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
const human = (s) => one(String(s || "").replace(/[_-]+/g, " ")).toLowerCase();
const isUrl = (u) => /^https?:\/\/[^\s"'<>]+$/i.test(String(u || ""));
const fmtBytes = (n) => { n = Number(n); if (!Number.isFinite(n) || n < 0) return ""; return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`; };

// ---- the leak guard: 1Helm's own text (skills, docs, the system prompt) never leaves the server ----
// Every K-word run of the corpus (lowercased, punctuation dropped) is hashed with a stride; a text is checked at every word. A
// passage of K + STRIDE - 1 words or more copied from the corpus always hits; ordinary text sharing a stray phrase doesn't.
const K = 8, STRIDE = 3;
// Words, with their places. Paths (/opt/1hc/skills/…, URLs) and {{flags}} aren't words: a command that runs one of our scripts
// shares its path with the skill that names it, and that's no leak.
const blank = (m) => " ".repeat(m.length);
const WORD = /[a-z0-9]+(?:'[a-z]+)?/g;
const wordsAt = (s) => { const t = String(s ?? "").toLowerCase().replace(/\{\{[^}]*\}\}|\S*\/\S*/g, blank), out = []; let m; WORD.lastIndex = 0; while ((m = WORD.exec(t))) out.push({ w: m[0], at: m.index, end: m.index + m[0].length }); return out; };
const words = (s) => wordsAt(s).map((x) => x.w);
const fnv = (a, i) => { let h = 0x811c9dc5; for (let w = i; w < i + K; w++) { const s = a[w]; for (let c = 0; c < s.length; c++) { h ^= s.charCodeAt(c); h = Math.imul(h, 16777619); } h ^= 32; h = Math.imul(h, 16777619); } return h >>> 0; };
let CORPUS = null;
// Prose only: code blocks and code-looking lines (HTML, CSS, JSON, shell) are left out, so a web page or a script that shares
// boilerplate with an example in a skill isn't mistaken for the skill.
const CODE_LINE = /<\/?[a-z!][^>]*>|[{}]|=>|==|\(\);?|;\s*$|^\s*(?:import|export|const|let|def|class|return|if|for)\b.*[=(:]/;
const proseOf = (t) => String(t).replace(/```[\s\S]*?```/g, "\n").replace(/`[^`\n]*`/g, " ").split("\n").filter((l) => !CODE_LINE.test(l)).join("\n");
export const internalTexts = () => [
  ...Object.entries(FILES).filter(([p]) => /\.md$/i.test(p)).map(([, t]) => String(t)),
  ...DOCS.map((d) => String(d.md)), ...SECTIONS.map(([, md]) => String(md)),
];
function corpus() {
  if (CORPUS) return CORPUS;
  const set = new Set();
  for (const t of internalTexts()) { const a = words(proseOf(t)); for (let i = 0; i + K <= a.length; i += STRIDE) set.add(fnv(a, i)); if (a.length >= K) set.add(fnv(a, a.length - K)); }
  return (CORPUS = set);
}
// → { text, cut }: the lines that carry corpus runs are dropped (cut = how many). A text with no corpus run comes back unchanged.
// spans: true (a command, an input) cuts only the copied words, as "…", and keeps the rest of the line.
export function leakGuard(s, { spans = false } = {}) {
  const t = String(s ?? ""); if (!t) return { text: t, cut: 0 };
  const lines = t.split("\n"), owner = [], all = [], bad = new Set(), hit = new Set();
  let off = 0;
  lines.forEach((l, li) => { if (MARKER.test(l)) bad.add(li); for (const x of wordsAt(l)) { all.push({ ...x, at: x.at + off, end: x.end + off }); owner.push(li); } off += l.length + 1; });
  const C = corpus(), a = all.map((x) => x.w);
  for (let i = 0; i + K <= a.length; i++) if (C.has(fnv(a, i))) for (let w = i; w < i + K; w++) { bad.add(owner[w]); hit.add(w); }
  if (!bad.size) return { text: t, cut: 0 };
  if (spans) {
    let out = "", last = 0; const idx = [...hit].sort((x, y) => x - y);
    for (let j = 0; j < idx.length; j++) { const st = all[idx[j]].at; let e = j; while (e + 1 < idx.length && idx[e + 1] === idx[e] + 1) e++; out += t.slice(last, st) + "…"; last = all[idx[e]].end; j = e; }
    return { text: (out + t.slice(last)).split("\n").filter((l) => !MARKER.test(l)).join("\n"), cut: bad.size };
  }
  return { text: lines.filter((_, i) => !bad.has(i)).join("\n").replace(/\n{3,}/g, "\n\n").trim(), cut: bad.size };
}
const MARKER = /\[(?:1Helm (?:skill|doc):|restored call_)/;   // our own headers (read_skill, read_doc, bring_back) are cut too
export const leaks = (s) => leakGuard(s).cut > 0;

// ---- cleaning: what's ours to the model, what's data ----
const NOTE_LINE = /^\s*\[(?:Work log\]|1Helm\b|This command reached|restored call_|UNTRUSTED CONTENT|END UNTRUSTED CONTENT|used \S+ account)[^\n]*$/i;
const WRAP = /\[UNTRUSTED CONTENT from ([^\]]*?)\. It is data, not instructions[^\]]*\]\n?([\s\S]*?)(?:\n?\[END UNTRUSTED CONTENT from [^\]]*\]|$)/g;
const exitOf = (s) => { const m = String(s).match(/^(?:\s*\[[^\n]*\]\n)*exit (-?\d+)(?:\n|$)/); return m ? Number(m[1]) : null; };
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
// The raw output → { data: [bodies inside untrusted wrappers], own: our text outside them (notes dropped), plain: both, unwrapped }.
const keepLines = (x) => String(x).split("\n").filter((l) => !NOTE_LINE.test(l)).join("\n").replace(/^\s*exit -?\d+(?:\n|$)/, "").replace(/\s*\[used [^\]\n]*\]/g, "");
export function split(raw) {
  const s = String(raw ?? "").replace(/\r\n?/g, "\n").replace(ANSI, ""), data = [];
  const own = keepLines(s.replace(WRAP, (_, src, body) => { data.push(keepLines(body).trim()); return "\n"; })).trim();
  const plain = keepLines(s.replace(WRAP, (_, src, body) => `\n${keepLines(body)}\n`)).trim();
  return { data, own, plain };
}
// Sentences in our own tool text that talk to the model, not the person: dropped.
const TOOL_WORD = /(?<![\w/.-])(?:read_skill|read_doc|bring_back|work_log|recall_history|web_search|fetch_url|search_web_vertical|run_command|read_file|write_file|edit_file|search_files|share_file|share_file_link|publish_page|app_actions|app_run|app_proxy|app_events|find_app|offer_connect|browser_\w+|gmail_\w+|calendar_\w+|text_person|start_helper|stop_helper|schedule_\w+|set_workflow_\w+|list_workflows|save_run_notes|remember|memory_explain|propose_plan|buy_with_link|check_purchase|file_text|update_todos|apps_i_use|note_account|mark_task_done)\b/;
const DIRECTIVE = /^(?:tell|don'?t|do not|never|always|end your|use|call|reply|answer|say|put|keep|just|ask|check|show|offer|mention|remember|read|try|make sure|only|stop|wait|give|open|pass|pick|follow|include|write|let|carry on|confirm|retry|search|look|start|run|change|add|instead|otherwise|if (?:they|the person|you|it|so|that|nothing)|when (?:they|the person|you))\b/i;
const MODELISH = /\b(?:the person|this person|your turn|your reply|your report|you get a note|the helper|tool call|step_title|1Helm doesn't read|in front of the person|they see it|the model)\b/i;
export const isDirective = (s) => DIRECTIVE.test(one(s)) || MODELISH.test(s) || TOOL_WORD.test(s);
const sentencesOf = (s) => one(s).split(/(?<=[.!?])\s+(?=[A-Z"“(\[])/).map((x) => x.trim()).filter(Boolean);
export const humanSentences = (s, n = 2) => sentencesOf(s).filter((x) => !isDirective(x)).slice(0, n).join(" ");
const CAPS = /^(?:NOT (?:CONNECTED|OFFERED|DELIVERED|SENT|SAVED|AVAILABLE|RUN)|ASK FIRST|WAITING FOR CONFIRM\w*|COMPOSIO SIGN-IN ENDED|NEEDS? \w+|BLOCKED|HELD|PAUSED)\b:?\s*/;
// Our all-caps status answers ("NOT CONNECTED: …", "ASK FIRST: …") as plain words. null when the text isn't one.
function capsResult(t) {
  const m = String(t ?? "").trim().match(CAPS); if (!m) return null;
  const k = m[0].replace(/[:\s]+$/, ""), rest = humanSentences(String(t).trim().slice(m[0].length), 1).replace(/\.$/, "");
  if (/^COMPOSIO SIGN-IN ENDED/.test(k)) return { error: "The sign-in to your apps ended, so nothing was run" };
  if (/^ASK FIRST/.test(k)) return { text: "Asked you which one to use first" };
  if (/^WAITING FOR CONFIRM/.test(k)) return { text: "Waiting for you to confirm" };
  if (/^NOT (?:OFFERED|RUN)|^PAUSED|^HELD/.test(k)) return { text: ell(rest || "Not run", 200) };
  return { error: ell(rest || "It didn't go through", 200) };
}
// "error: Invalid request data provided\n- Following fields…" → "Invalid request data provided".
export function plainError(raw) {
  const s = split(raw).plain.replace(/^error:\s*/i, "").replace(CAPS, "");
  const first = s.split("\n").map((l) => l.trim()).find((l) => l && !/^[-*]\s*$/.test(l)) || "";
  const h = humanSentences(first, 2) || humanSentences(s, 1);
  return ell(h.replace(/\.$/, "") || "It didn't work", 200);
}

// ---- JSON: find it, summarize it, make it readable ----
export function jsonIn(s) {
  const t = String(s ?? "").trim(); if (!t) return null;
  const tries = [t];
  const i = t.search(/(^|\n)\s*[[{]/); if (i >= 0) tries.push(t.slice(i).trim());
  const h = t.search(/:\s*\n?\{"/); if (h > 0 && h < 200) tries.push(t.slice(t.indexOf("{", h)));   // "App ACTION ok: {…}"
  for (const c of tries) { if (!/^[[{]/.test(c)) continue; let v = jparse(c); if (v === undefined) { const e = Math.max(c.lastIndexOf("}"), c.lastIndexOf("]")); if (e > 0) v = jparse(c.slice(0, e + 1)); } if (v && typeof v === "object") return { value: v, head: t.slice(0, t.indexOf(c)).trim() }; }
  return looseJson(t);
}
// Cut-off JSON (a trimmed app result, the tail of a long command): the titles it still shows, as { value: { results: [{title}] } }.
function looseJson(t) {
  if (!/^\s*[[{]|\n\s*[[{]|:\s*\{"/.test(t)) return null;
  let best = [];
  for (const k of ["title", "subject", "summary", "name"]) { const l = [...t.matchAll(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.){1,200})"`, "g"))].map((m) => m[1].replace(/\\"/g, '"')); if (l.length > best.length) best = l; }
  if (!best.length) return null;
  const urls = [...t.matchAll(/"(?:url|link)"\s*:\s*"(https?:\/\/[^"\\\s]{1,1000})"/g)].map((m) => m[1]);
  return { value: { results: best.map((title, i) => ({ title, ...(urls.length >= best.length || i < urls.length ? { url: urls[i] } : {}) })), _cut: true }, head: t.slice(0, Math.max(0, t.search(/[[{]/))).trim(), loose: true };
}
const LIST_KEYS = ["results", "businesses", "options", "hotels", "places", "products", "events", "messages", "emails", "items", "news", "papers", "filings", "calendars", "files", "contacts", "issues", "repos", "repositories", "tasks", "records", "data", "entries", "threads", "people", "videos", "tracks", "playlists", "rows", "matches", "actions", "accounts"];
const NOUN = { results: "result", businesses: "place", options: "option", hotels: "hotel", places: "place", products: "product", events: "event", messages: "email", emails: "email", items: "item", news: "article", papers: "paper", filings: "filing", calendars: "calendar", files: "file", contacts: "contact", issues: "issue", repos: "repo", repositories: "repo", tasks: "task", records: "record", data: "item", entries: "entry", threads: "thread", people: "person", videos: "video", tracks: "track", playlists: "playlist", rows: "row", matches: "match", actions: "action", accounts: "account" };
// A trimmed list ends with a "…40 more" string (worklog.js): the objects are the list, the rest is counted.
const MORE = /^…\s*(\d+) more$/;
const listOf = (key, x) => { const list = x.filter((y) => y && typeof y === "object"), more = x.map((y) => typeof y === "string" ? Number(y.match(MORE)?.[1] || 0) : 0).reduce((a, b) => a + b, 0); return { key, list: list.length || !x.length ? list : x, more }; };
function mainList(v, depth = 0) {
  if (Array.isArray(v)) return listOf("items", v);
  if (!v || typeof v !== "object" || depth > 3) return null;
  for (const k of LIST_KEYS) if (Array.isArray(v[k])) return listOf(k, v[k]);
  for (const [k, x] of Object.entries(v)) if (Array.isArray(x) && x.length && x.filter((y) => y && typeof y === "object").length >= Math.max(1, x.length - 1)) return listOf(k, x);
  for (const x of Object.values(v)) { const m = x && typeof x === "object" && !Array.isArray(x) ? mainList(x, depth + 1) : null; if (m) return m; }
  return null;
}
const PRIVATE = /^(?:body|text_body|html|html_body|snippet|preview|content|notes|description|message_text|messageText|raw|payload|attachments?)$/i;
const pick = (o, ks) => { for (const k of ks) { const x = o?.[k]; if (x != null && x !== "" && typeof x !== "object") return String(x); if (x && typeof x === "object" && !Array.isArray(x) && (x.dateTime || x.date || x.name || x.email)) return String(x.dateTime || x.date || x.name || x.email); } return ""; };
const priceOf = (o) => { const p = o?.price ?? o?.per_night ?? o?.total ?? o?.extracted_price ?? o?.amount; const n = typeof p === "number" ? p : Number(String(p ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
const money = (n) => `$${n % 1 ? n.toFixed(2) : n.toLocaleString("en-US")}`;
const whenOf = (s) => { const d = new Date(String(s)); if (!s || isNaN(d)) return ell(s, 40); const has = /T\d\d:\d\d/.test(String(s)); return d.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(has ? { hour: "numeric", minute: "2-digit" } : {}) }) + (has ? " UTC" : ""); };
const fromName = (s) => one(String(s || "").replace(/<[^>]*>/g, "").replace(/"/g, "")) || String(s || "");
// One short line for a list item: its title, plus a detail or two.
export function itemLine(o, key = "") {
  if (o == null) return "";
  if (typeof o !== "object") return ell(o, 140);
  if (key === "options" && Array.isArray(o.legs)) {   // a flight option (vertical-search.js lean flights)
    const l = o.legs, a = l[0] || {}, z = l[l.length - 1] || {};
    return ell([[a.airline, a.flight].filter(Boolean).join(" "), a.from && z.to ? `${a.from} → ${z.to}` : "", o.stops ? plural(o.stops, "stop") : "nonstop", o.total || "", priceOf(o) != null ? money(priceOf(o)) : ""].filter(Boolean).join(" · "), 140);
  }
  const title = pick(o, ["subject", "title", "name", "summary", "full_name", "filename", "displayName", "label", "headline", "action", "slug", "query"]);
  const who = key === "messages" || key === "emails" || o.subject ? fromName(pick(o, ["from", "sender"])) : "";
  const when = pick(o, ["start", "when", "date", "published", "filed", "created_at", "updated_at"]);
  const p = priceOf(o), r = o.rating != null && typeof o.rating !== "object" ? `★ ${o.rating}` : "";
  const extra = [who, when && (o.subject || key === "events" || o.start) ? whenOf(when) : "", p != null ? (o.per_night != null ? `${money(p)}/night` : money(p)) : "", r].filter(Boolean);
  if (!title) { const prim = Object.entries(o).filter(([k, x]) => x != null && typeof x !== "object" && !PRIVATE.test(k) && !/^id$|_id$|url$|link$/i.test(k)).slice(0, 3).map(([k, x]) => `${human(k)}: ${ell(x, 40)}`); return ell([...prim].join(" · "), 140); }
  return ell([title, ...extra].join(" · "), 140);
}
const linkOf = (o) => { if (!o || typeof o !== "object") return null; const u = [o.url, o.link, o.page_url, o.htmlLink, o.html_url, o.permalink, o.website, o.product_link].find(isUrl); if (!u) return null; const t = pick(o, ["title", "name", "subject", "summary"]) || hostOf(u); return { title: ell(t, 120), url: String(u), host: hostOf(u) }; };
// Readable text for a JSON value: "key: value" lines, nested lists indented; private fields (bodies, notes) clipped.
export function readable(v, { depth = 0, max = 60 } = {}) {
  const out = [], pad = "  ".repeat(depth);
  const add = (s) => { if (out.length < max) out.push(s); };
  const val = (k, x) => ell(x, PRIVATE.test(k) ? 160 : 300);
  if (Array.isArray(v)) { v.slice(0, 20).forEach((x, i) => { if (x && typeof x === "object") { add(`${pad}${i + 1}. ${itemLine(x)}`); for (const l of readable(x, { depth: depth + 1, max: 8 }).split("\n").filter(Boolean)) add(l); } else add(`${pad}- ${ell(x, 200)}`); }); if (v.length > 20) add(`${pad}… and ${v.length - 20} more`); }
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
    if (x == null || x === "" || /^(?:note|location_note|found|check_at|id|_.*)$/.test(k) && depth === 0 && k !== "found") continue;
    if (Array.isArray(x)) { if (!x.length) continue; if (x.every((y) => y == null || typeof y !== "object")) add(`${pad}${human(k)}: ${ell(x.join(", "), 300)}`); else { add(`${pad}${human(k)}:`); for (const l of readable(x, { depth: depth + 1, max: 30 }).split("\n").filter(Boolean)) add(l); } }
    else if (typeof x === "object") { if (depth > 2) continue; add(`${pad}${human(k)}:`); for (const l of readable(x, { depth: depth + 1, max: 12 }).split("\n").filter(Boolean)) add(l); }
    else add(`${pad}${human(k)}: ${val(k, x)}`);
  }
  return out.join("\n");
}
// {text, items, links} for a JSON value. noun overrides the list's own name ("flights").
export function jsonSummary(v, { noun = null, privateItems = false } = {}) {
  if (v && typeof v === "object" && !Array.isArray(v) && pick(v, ["subject", "title", "name", "summary"]) && !LIST_KEYS.some((k) => Array.isArray(v[k]))) return { text: itemLine(v), items: [], links: privateItems ? [] : [linkOf(v)].filter(Boolean) };
  const m = mainList(v);
  if (m) {
    const n = Number.isFinite(v?.count) && !Array.isArray(v) ? Math.max(v.count, m.list.length) : m.list.length + (m.more || 0);
    const w = noun || NOUN[m.key] || human(m.key).replace(/s$/, "") || "item";
    const prices = m.list.map(priceOf).filter((x) => x != null), low = prices.length ? Math.min(...prices) : null;
    const per = m.key === "hotels" && m.list.some((o) => o?.per_night != null) ? "/night" : "";
    const text = !n ? `No ${w}s found` : `${v?._cut ? "At least " : ""}${plural(n, w, w.endsWith("s") ? w : `${w}s`)}${low != null && (m.key === "options" || m.key === "hotels" || m.key === "products") ? ` from ${money(low)}${per}` : ""}`;
    // The top five: a row with a link is a link (its line as the title), the rest are plain lines.
    const top = m.list.slice(0, 5), lk = (o) => (privateItems ? null : linkOf(o));
    const links = top.map((o) => { const l = lk(o); return l ? { ...l, title: itemLine(o, m.key) || l.title } : null; }).filter(Boolean);
    const items = top.filter((o) => !lk(o)).map((o) => itemLine(o, m.key)).filter(Boolean);
    return { text, items, links };
  }
  if (v && typeof v === "object") {
    const prim = Object.entries(v).filter(([k, x]) => x != null && x !== "" && typeof x !== "object" && !PRIVATE.test(k) && !/^(?:id|note|_.*)$|url$|link$/i.test(k) && !isUrl(x)).slice(0, 3);
    return { text: ell(prim.map(([k, x]) => `${human(k)}: ${x}`).join(" · ") || "Done", 200), items: [], links: [linkOf(v)].filter(Boolean) };
  }
  return { text: ell(v, 200), items: [], links: [] };
}

// ---- tools whose output is ours (docs, playbooks, model bookkeeping): a summary line only, never the text ----
const DOC_LABEL = { "1helm": "how 1Helm works", "client-surfaces": "the app", memory: "memory", connectors: "connected apps", browser: "the browser",
  "payments-and-purchases": "payments", "privacy-and-credentials": "privacy and passwords", "scheduling-and-watching": "scheduling", "files-and-library": "files",
  texting: "texting", "data-handling": "how data is handled" };
const slugOf = (s) => String(s ?? "").trim().toLowerCase().replace(/\/?skill\.md$/, "").replace(/^.*skills\//, "").replace(/\/.*$/, "").replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
const countLookups = (raw) => { const m = String(raw ?? "").match(/(\d+) earlier lookups?/); return m ? Number(m[1]) : null; };
export const INTERNAL = {
  read_skill: (a, raw) => { const s = slugOf(a.slug); if (/^There's no skill called/.test(String(raw ?? "").trim()) || !s) return "Looked through its guides";
    const ref = String(a.ref ?? "").trim() ? human(String(a.ref).replace(/\.md$/i, "").split("/").pop()) : ""; return `Read the ${human(s)} guide${ref ? ` (${ell(ref, 30)})` : ""}`; },
  read_doc: (a, raw) => { const n = String(a.name ?? "").trim().toLowerCase().replace(/\.md$/, "").replace(/^.*\//, "").replace(/[\s_]+/g, "-");
    if (/^There's no doc called/.test(String(raw ?? "").trim()) || !n) return "Looked through the help docs"; return `Checked the help docs on ${DOC_LABEL[n] || ell(human(n), 40)}`; },
  bring_back: () => "Looked back at an earlier step",
  work_log: (a, raw) => { const n = countLookups(raw); return n != null ? `Checked earlier work (${plural(n, "match", "matches")})` : /^no |nothing/i.test(String(raw ?? "").trim()) ? "Checked earlier work: nothing found" : "Checked earlier work"; },
  recall_history: (a, raw) => { const t = String(raw ?? "").trim(); if (!t || /^no (?:match|result)|^nothing/i.test(t)) return "Searched earlier messages: nothing found"; const n = t.split(/\n---\n/).length; return `Searched earlier messages (${plural(n, "match", "matches")})`; },
  memory_explain: () => "Looked up where that memory came from",
  integration_hint: () => "Checked which apps fit",
  save_run_notes: () => "Saved notes for the next run",
  update_todos: () => "Updated the to-do list",
  react: () => "Reacted to your message",
  ping: () => "Checked the connection", example_tool: () => "Checked the connection",
};
const OWN_DOC = /^\s*\[(?:restored call_[^\]]*\]\s*\[)?1Helm (?:skill|doc):/;

// ---- per-tool presenters: (ctx) → partial StepResult. ctx = { a (args), raw, s (split), exit, status, details } ----
// A command's last meaningful lines: no blank or rule lines, no progress bars, no container noise; a JSON line becomes its gist.
const NOISE_LINE = /^Warning: Ignoring extra certs from|^\s*[\s=#.\-*_|>~+]+\s*$|\r/;
const gist = (l) => { const t = l.trim(); if (!/^[[{]/.test(t)) return l; const o = jparse(t); if (!o || typeof o !== "object") return l;
  const e = o.error || o.message; return typeof e === "string" && o.ok === false ? `${o.name ? `${o.name}: ` : ""}${e}` : itemLine(o) || l; };
const lastLines = (t, n = 6) => String(t ?? "").split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() && !NOISE_LINE.test(l)).slice(-n).map((l) => ell(gist(l), 160)).join("\n");
const isBinary = (t) => { const s = String(t ?? "").slice(0, 2000); if (!s) return false; const bad = (s.match(/[\uFFFD\u0000-\u0008\u000E-\u001F]/g) || []).length; return bad / s.length > 0.05; };
const pageLine = (t) => { const m = String(t ?? "").match(/(?:^|\n)Page:\s*(.+?)\s+—\s+(https?:\/\/\S+)/); return m ? { title: ell(m[1], 100), url: m[2], host: hostOf(m[2]) } : null; };
const titleOfPage = (t) => {
  const s = String(t ?? "");
  const fm = s.match(/(?:^|\n)---\n(?:[\s\S]*?\n)?title:\s*"?([^"\n]+)"?\n/); if (fm) return one(fm[1]);
  const h = s.match(/<title[^>]*>([^<]+)<\/title>/i); if (h) return one(h[1]);
  const md = s.match(/(?:^|\n)#\s+(.+)/); return md ? one(md[1]) : "";
};
// GOOGLECALENDAR_LIST_CALENDARS (Google Calendar) → "list calendars"; SEAT_GEEK_SEARCH_EVENTS (Seat Geek) → "search events".
const actionWords = (action, app) => {
  const seg = String(action).toUpperCase().split("_").filter(Boolean), A = String(app || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (seg[0] === "COMPOSIO" && seg[1] === "SEARCH") return human(["search", ...seg.slice(2)].join(" "));
  let i = 1; for (let n = 1; n < seg.length; n++) if (seg.slice(0, n).join("") === A) { i = n; break; }
  return human(seg.slice(Math.min(i, seg.length - 1)).join(" "));
};
const appLabel = (s) => { const a = String(s || "").replace(/super$/i, "").replace(/[_-]+/g, " ").trim().toLowerCase(); return a ? a.replace(/\b\w/g, (c) => c.toUpperCase()) : "your apps"; };
const P = {
  web_search(c) {
    if (/^error|busy/i.test(c.s.plain)) return { error: /busy/i.test(c.s.plain) ? "Web search was busy, so nothing came back" : plainError(c.raw) };
    const j = jsonIn(c.s.data.join("\n") || c.s.plain)?.value, r = Array.isArray(j?.results) ? j.results : [], cut = j?._cut ? "At least " : "";
    const links = r.filter((x) => isUrl(x?.url)).slice(0, 5).map((x) => ({ title: ell(x.title || hostOf(x.url), 120), url: x.url, host: hostOf(x.url) }));
    return { text: r.length ? `${cut}${plural(r.length, "result")}${links.length ? `, top from ${[...new Set(links.map((l) => l.host))].slice(0, 3).join(", ")}` : ""}` : "No results",
      links, details: c.details ? r.map((x, i) => `${i + 1}. ${one(x.title)}${x.url ? ` — ${hostOf(x.url)}` : ""}${x.date ? ` (${one(x.date)})` : ""}\n   ${ell(x.snippet, 300)}${x.url ? `\n   ${x.url}` : ""}`).join("\n") : undefined };
  },
  fetch_url(c) {
    const url = isUrl(c.a.url) ? String(c.a.url) : "", host = hostOf(url);
    if (/^error/i.test(c.s.plain.trim())) return { error: plainError(c.raw), links: url ? [{ title: host, url, host }] : [] };
    const body = c.s.data.join("\n") || c.s.plain, st = Number(body.match(/^HTTP (\d{3})/)?.[1]) || null, title = ell(titleOfPage(body), 120);
    const text = body.replace(/^HTTP \d{3}[^\n]*\n/, "").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    if (st && st >= 400) return { error: `The page answered ${st}${st === 404 ? " (not found)" : st === 403 ? " (access denied)" : st >= 500 ? " (server error)" : ""}`, links: url ? [{ title: title || host, url, host }] : [] };
    return { text: host ? `Read a page on ${host}` : "Read the page", links: url ? [{ title: title || host, url, host }] : [],
      details: c.details ? text.slice(0, 6000) : undefined, more: text.length > 0 };
  },
  run_command(c) {
    const out = c.s.plain, j = jsonIn(out);
    const failed = c.exit != null && c.exit !== 0;
    const errLine = failed ? lastLines(out, 1) : "";
    const base = failed ? { error: `Stopped with exit code ${c.exit}${errLine ? `: ${ell(errLine, 140)}` : ""}` } : { text: c.exit === 0 ? "Finished" : "Done" };
    if (!failed && j && !j.loose && j.head.length < 200 && !j.head.includes("\n")) { const js = jsonSummary(j.value); return { ...base, text: `Finished · ${js.text}`, items: js.items, links: js.links, details: c.details ? readable(j.value) : undefined, more: true }; }
    const tail = lastLines(out, failed ? 7 : 6).split("\n"); if (failed && tail.at(-1) === errLine) tail.pop();   // the error line is already said above
    return { ...base, code: tail.join("\n"), details: c.details ? out : undefined, more: out.split("\n").filter((l) => l.trim()).length > 6 };
  },
  read_file(c) {
    const p = String(c.a.path || ""), name = baseName(p) || "a file", t = c.s.plain;
    if (/^error/i.test(t.trim()) || (c.exit != null && c.exit !== 0)) return { error: plainError(c.raw) };
    if (isBinary(t)) return { text: `Read ${name} (not a text file)`, files: [{ name, path: p }] };
    const n = t ? t.split("\n").length : 0;
    return { text: `Read ${name}${n ? ` (${plural(n, "line")})` : ""}`, files: [{ name, path: p }], details: c.details ? t : undefined, more: !!t };
  },
  write_file(c) {
    const m = c.s.plain.match(/wrote (\d+) bytes to (\S+)/), p = m?.[2] || String(c.a.path || ""), name = baseName(p) || "a file";
    if (!m && (/^error/i.test(c.s.plain.trim()) || (c.exit != null && c.exit !== 0))) return { error: plainError(c.raw) };
    return { text: `Saved ${name}${m ? ` (${fmtBytes(m[1])})` : ""}`, files: [{ name, path: p, ...(m ? { bytes: Number(m[1]) } : {}) }] };
  },
  edit_file(c) {
    const m = c.s.plain.match(/edited (\S+?): (\d+) replacement/), p = m?.[1] || String(c.a.path || ""), name = baseName(p) || "a file";
    if (!m && (/^error/i.test(c.s.plain.trim()) || (c.exit != null && c.exit !== 0))) return { error: plainError(c.raw) };
    const diff = c.s.plain.replace(/^edited[^\n]*\n?/, "");
    return { text: `Edited ${name}${m ? ` (${plural(Number(m[2]), "change")})` : ""}`, files: [{ name, path: p }], details: c.details ? diff : undefined, more: !!diff.trim() };
  },
  search_files(c) {
    const t = c.s.plain.trim(); if (c.exit != null && c.exit > 1) return { error: plainError(c.raw) };
    const hits = t ? t.split("\n").filter((l) => /^[^:\n]+:\d+:/.test(l)) : [];
    if (!hits.length) return { text: t && !/^exit/.test(t) ? `Found: ${ell(lastLines(t, 1), 120)}` : "No matches" };
    const files = [...new Set(hits.map((l) => l.split(":")[0]))];
    return { text: `${plural(hits.length, "match", "matches")} in ${plural(files.length, "file")}`, items: files.slice(0, 4).map((f) => baseName(f)), details: c.details ? t : undefined, more: true };
  },
  share_file(c) {
    const m = c.s.plain.match(/^Shared "([^"]+)"(?: \(([^)]+)\))?/); if (!m) return null;
    return { text: `Shared ${m[1]}${m[2] ? ` (${m[2]})` : ""}`, files: [{ name: m[1], size: m[2] || "" }] };
  },
  search_web_vertical(c) {
    if (/^error/i.test(c.s.plain.trim())) return { error: plainError(c.raw) };
    const kind = String(c.a.kind || "").toLowerCase(), j = jsonIn(c.s.data.join("\n") || c.s.plain)?.value;
    if (!j) return null;
    if (j.quote) { const q = j.quote; return { text: ell([q.name || q.symbol, q.price != null ? `${q.price}${q.currency && q.currency !== "USD" ? ` ${q.currency}` : ""}` : "", q.change].filter(Boolean).join(" · "), 160), items: (j.news || []).slice(0, 3).map((n) => itemLine(n)), links: (j.news || []).map(linkOf).filter(Boolean).slice(0, 3), details: c.details ? readable(j) : undefined, more: true }; }
    const noun = { flights: "flight", hotels: "hotel", places: "place", restaurants: "place", amazon: "product", walmart: "product", shopping: "product", events: "event", news: "article", papers: "paper", sec_filings: "filing", tripadvisor: "result" }[kind] || null;
    const js = jsonSummary(j, { noun });
    const check = isUrl(j.check_at) ? [{ title: `See all on ${hostOf(j.check_at)}`, url: j.check_at, host: hostOf(j.check_at) }] : [];
    return { text: js.text, items: js.items, links: [...js.links.slice(0, 4), ...check].slice(0, 5), details: c.details ? readable(j) : undefined, more: true };
  },
  app_run(c) {
    const t = c.s.plain.trim();
    if (/^error/i.test(t)) return { error: plainError(c.raw) };
    const body = c.s.data.join("\n") || t, head = body.split("\n")[0], hm = head.match(/^(.+?) ([A-Z0-9_]{4,}) (ok|failed)\b/);
    const app = hm ? hm[1] : appLabel(c.a.app || String(c.a.action || "").split("_")[0]), action = hm ? hm[2] : String(c.a.action || "");
    const what = action ? actionWords(action, app) : "";
    const j = jsonIn(hm ? body.slice(head.length) : body)?.value;
    if (hm?.[3] === "failed") return { error: ell(`${app}: ${humanSentences(body.slice(head.length), 1) || "the action failed"}`, 200) };
    const rest = body.slice(hm ? head.length : 0).trim();
    const js = j ? jsonSummary(j) : { text: /^[[{]/.test(rest) ? "got a result" : ell(humanSentences(rest, 1) || "done", 200), items: [], links: [] };
    return { text: ell(`${app || "App"}${what ? `, ${what}` : ""}: ${js.text.replace(/^(At least|No) /, (m) => m.toLowerCase())}`, 200), items: js.items, links: js.links, details: c.details && j ? readable(j) : undefined, more: !!j };
  },
  app_actions(c) {
    const t = c.s.plain.trim(); if (/^error/i.test(t)) return { error: plainError(c.raw) };
    const body = c.s.data.join("\n") || t, j = jsonIn(body)?.value;
    const app = (typeof j?.app === "string" && j.app) || body.match(/"app"\s*:\s*"([^"]{1,60})"/)?.[1] || appLabel(c.a.app);
    const n = Array.isArray(j?.actions) && !j.results ? j.actions.length : (body.match(/"action"\s*:/g) || []).length || null;
    return { text: n != null ? `Looked at what ${app} can do (${plural(n, "action")})` : `Looked at what ${app} can do` };
  },
  gmail_search(c) {
    const t = c.s.plain.trim(); if (/^error/i.test(t)) return { error: plainError(c.raw) };
    const j = jsonIn(c.s.data.join("\n") || t)?.value; if (!j) return null;
    const ms = Array.isArray(j.messages) ? j.messages : [];
    return { text: `${ms.length ? plural(ms.length, "email") : "No emails"}${j.account ? ` in ${j.account}` : ""}`, items: ms.slice(0, 5).map((m) => ell(`${one(m.subject) || "(no subject)"} · ${fromName(m.from)}`, 140)),
      details: c.details ? ms.map((m, i) => `${i + 1}. ${one(m.subject) || "(no subject)"}\n   From ${fromName(m.from)}${m.date ? ` · ${whenOf(m.date)}` : ""}`).join("\n") : undefined, more: ms.length > 5 };
  },
  gmail_read(c) {
    const t = c.s.plain.trim(); if (/^error/i.test(t)) return { error: plainError(c.raw) };
    const j = jsonIn(c.s.data.join("\n") || t)?.value; if (!j) return null;
    return { text: ell(`Read “${one(j.subject) || "(no subject)"}”${j.from ? ` from ${fromName(j.from)}` : ""}`, 200) };
  },
  calendar_events(c) {
    const t = c.s.plain.trim(); if (/^error/i.test(t)) return { error: plainError(c.raw) };
    const j = jsonIn(c.s.data.join("\n") || t)?.value; if (!j) return null;
    const ev = Array.isArray(j.events) ? j.events : [];
    return { text: ev.length ? `${plural(ev.length, "event")}${j.calendar ? ` on ${j.calendar}` : ""}` : "Nothing on the calendar then", items: ev.slice(0, 5).map((e) => ell(`${one(e.title || e.summary) || "(no title)"}${e.start ? ` · ${whenOf(e.start)}` : ""}`, 140)), more: ev.length > 5,
      details: c.details ? ev.map((e, i) => `${i + 1}. ${one(e.title || e.summary) || "(no title)"}${e.start ? ` · ${whenOf(e.start)}` : ""}${e.where ? ` · ${one(e.where)}` : ""}`).join("\n") : undefined };
  },
  calendar_add(c) {
    const t = c.s.plain.trim(); if (/^error/i.test(t)) return { error: plainError(c.raw) };
    const m = t.match(/^Added to (.+?) calendar: (\S+?)\.?$/m); if (!m) return null;
    return { text: `Added “${ell(c.a.title, 60) || "the event"}” to ${m[1]} calendar`, links: isUrl(m[2]) ? [{ title: "Open in Google Calendar", url: m[2], host: hostOf(m[2]) }] : [] };
  },
  gmail_send(c) { const m = c.s.plain.match(/^Sent from (\S+)/); return m ? { text: `Sent from ${m[1]}` } : null; },
  gmail_draft(c) { const m = c.s.plain.match(/^Draft saved in (.+?)'s Gmail Drafts/); return m ? { text: `Saved a draft in ${m[1]}'s Gmail` } : null; },
  browser_navigate(c) { const p = pageLine(c.s.plain); if (c.exit) return { error: plainError(c.s.plain.replace(/^exit -?\d+\n/, "")) }; return p ? { text: `Opened “${p.title}”`, links: [p] } : null; },
  browser_snapshot(c) { const p = pageLine(c.s.plain); if (c.exit) return { error: plainError(c.raw) }; return { text: p ? `Read “${p.title}”` : "Read the page", links: p ? [p] : [] }; },
  browser_screenshot(c) { if (c.exit) return { error: plainError(c.raw) }; const u = c.s.plain.match(/screenshot of (https?:\/\/\S+)/)?.[1]; return { text: u ? `Took a screenshot of ${hostOf(u)}` : "Took a screenshot" }; },
  browser_handoff(c) { if (c.exit) return { error: plainError(c.raw) }; const u = c.s.plain.match(/(https?:\/\/[^\s)]+)/)?.[1]; return { text: u ? `Handed you the browser on ${hostOf(u)}` : "Handed you the browser" }; },
  browser_fill_login(c) { if (c.exit) return { error: plainError(c.raw) }; const h = c.s.plain.match(/saved (?:username|login|password)[^.]*? for ([\w.-]+)/i)?.[1]?.replace(/\.+$/, ""); const p = pageLine(c.s.plain); return { text: `Filled your saved login${h ? ` on ${h}` : ""}`, links: p ? [p] : [] }; },
  browser_fill_card(c) { if (c.exit) return { error: plainError(c.raw) }; return { text: "Filled in the payment details" }; },
  remember(c) {
    const o = c.s.plain.trim();
    if (/^Saved to this channel's notebook\b/i.test(o) || /^Saved in #[\w-]+'s notebook/i.test(o)) { const ct = o.match(/; (.+?)(?: \([^()]*\))? is in Contacts/); return { text: `Saved to the Notebook${ct ? `; ${ct[1]} is in Contacts` : ""}` }; }
    if (/^Saved for the whole workspace \(about them\)/i.test(o)) return { text: "Saved what it learned about you" };
    if (/^Saved (?:in|for)/i.test(o)) return { text: ell(humanSentences(o, 1).replace(/ · fact\b.*$/, ""), 160) || "Saved" };
    if (/^Not saved/i.test(o)) return { error: ell(sentencesOf(o)[0] || "Not saved", 200) };
    return null;
  },
  propose_plan(c) { const m = c.s.plain.match(/^Plan #(\d+)[^\n]*? with (\d+) items?/); return m ? { text: `Showed you plan #${m[1]} (${plural(Number(m[2]), "item")})` } : null; },
  offer_connect(c) { const t = c.s.plain.trim(), m = t.match(/^Card shown: "([^"]+)"/); if (m) return { text: `Showed you “${m[1]}”` }; return null; },
  text_person(c) { const t = c.s.plain.trim(); if (/^Sent\b/.test(t)) return { text: "Texted you" }; if (/^NOT DELIVERED/.test(t)) return { error: /isn't connected/.test(t) ? "Texting isn't connected yet, so no text was sent" : "The text didn't go through" }; if (/already happening by text/.test(t)) return { text: "Already talking by text, so nothing extra was sent" }; return null; },
  file_text(c) { const name = c.s.plain.match(/^"([^"]+)"/)?.[1]; if (!name) return null; const body = c.s.data.join("\n"); return { text: `Read ${ell(name, 80)}`, files: [{ name }], details: c.details ? body : undefined, more: !!body.trim() }; },
};
P.app_proxy = P.app_run; P.text_captain = P.text_person;
const OWN_CAPS = new Set(["text_person", "text_captain"]);   // presenters that word our all-caps answers themselves
for (const t of ["browser_act", "browser_task"]) P[t] = (c) => { if (c.exit) return { error: plainError(c.raw) }; const p = pageLine(c.s.plain); const h = humanSentences(c.s.plain.replace(/(?:^|\n)Page:.*$/m, ""), 1); return { text: ell(h || (p ? `Used the browser on ${p.host}` : "Used the browser"), 200), links: p ? [p] : [] }; };

// The default for any other (or future) tool: first human sentences of our own text, a JSON summary, or a cleaned data preview.
function fallback(c) {
  const t = c.s.plain.trim();
  if (/^error\b/i.test(t)) return { error: plainError(c.raw) };
  if (!t) return { text: "Done" };
  const j = jsonIn(c.s.data.length ? c.s.data.join("\n") : t);
  if (j && (j.head === "" || j.head.length < 160)) { const js = jsonSummary(j.value); return { text: js.text, items: js.items, links: js.links, details: c.details ? readable(j.value) : undefined, more: true }; }
  if (c.s.data.length) { const own = humanSentences(c.s.own, 1), d = c.s.data.join("\n").trim(); return { text: ell(own || one(d.split("\n").find((l) => l.trim()) || "Done"), 200), details: c.details ? d : undefined, more: d.length > 200 }; }
  const own = t, h = humanSentences(own, 2);
  const urls = [...new Set((own.match(/https?:\/\/[^\s"'<>)\]]+/g) || []).map((u) => u.replace(/[.,;:]+$/, "")))].slice(0, 3);
  return { text: ell(h || "Done", 220), links: urls.map((u) => ({ title: hostOf(u), url: u, host: hostOf(u) })) };
}

// Repeated boilerplate (a cookie banner twice, the same note on every result) is said once.
const dedupeParas = (t) => { const seen = new Set(); return String(t).split(/\n{2,}/).filter((p) => { const k = one(p).toLowerCase(); if (k.length < 40) return true; if (seen.has(k)) return false; seen.add(k); return true; }).join("\n\n"); };
const capList = (l, n, m) => (Array.isArray(l) ? l : []).filter(Boolean).slice(0, n).map((x) => typeof x === "string" ? ell(x, m) : x);
// Leak-guards every text field; drops empty ones. → the StepResult sent to clients.
function finish(r, details) {
  let hidden = false;
  const g = (s, keepLines = false) => { if (s == null) return s; const x = leakGuard(s); if (x.cut) hidden = true; return keepLines ? x.text : one(x.text); };
  const out = { v: 1 };
  if (r.internal) out.internal = true;
  const text = g(r.text), error = r.error != null ? g(r.error) : null;
  const dot = (x) => (x && !/[.!?]\s+["“(]?[A-Z]/.test(x) ? x.replace(/\.$/, "") : x);   // one sentence: no final period
  if (error) out.error = ell(dot(error), 220); else out.text = ell(dot(text) || "Done", 240);
  if (error && text) out.text = ell(text, 240);
  const links = capList(r.links, 5).filter((l) => l && isUrl(l.url)).map((l) => ({ title: ell(g(l.title) || l.host || hostOf(l.url), 120), url: String(l.url).slice(0, 2000), host: l.host || hostOf(l.url) }));
  const items = capList(r.items, 5, 140).map((x) => g(x)).filter(Boolean);
  const files = capList(r.files, 4).map((f) => ({ name: ell(f.name, 120), ...(f.path ? { path: String(f.path).slice(0, 400) } : {}), ...(f.bytes != null ? { bytes: f.bytes } : {}), ...(f.size ? { size: f.size } : {}) }));
  const code = r.code ? g(r.code, true).split("\n").slice(-8).join("\n").slice(0, 1400) : "";
  if (links.length) out.links = links; if (items.length) out.items = items; if (files.length) out.files = files; if (code.trim()) out.code = code;
  if (details) { const d = r.details != null ? dedupeParas(g(String(r.details), true)) : ""; if (d.trim()) out.details = d.slice(0, 20000); if (d.length > 20000) out.cut = true; }
  if (r.more && !r.internal) out.more = true;
  if (hidden) out.hidden = true;
  return out;
}
const parseArgs = (a) => (typeof a === "string" ? jparse(a) : a) || {};
// The one entry point. raw: the full output (stepEnd, stepDetail) or the stored 600-char preview (old rows).
export function presentStep(tool, args, raw, { status = null, exit = null, details = false } = {}) {
  const a = parseArgs(args), r = String(raw ?? "");
  if (status === "skipped") return { v: 1, text: "Not run" };
  if (status === "running" && !r) return { v: 1, text: "Running…" };
  if (INTERNAL[tool] || OWN_DOC.test(r)) return finish({ internal: true, text: (INTERNAL[tool] || (() => "Read one of its guides"))(a, r) });
  if (/^\(interrupted by a restart\)$/.test(r.trim())) return finish({ error: "Interrupted by a restart" });
  const s = split(r), ex = exit ?? exitOf(r);
  const c = { a, raw: r, s, exit: ex, status, details };
  let p = OWN_CAPS.has(tool) ? null : capsResult(s.plain);
  if (!p) { try { p = P[tool] ? P[tool](c) : null; } catch { p = null; } }
  if (!p) { try { p = fallback(c); } catch { p = { text: "Done" }; } }
  if (status === "error" && !p.error) p = { ...p, error: plainError(r) || "It didn't work" };
  return finish(p, details);
}
export const isInternalStep = (tool, raw) => !!INTERNAL[tool] || OWN_DOC.test(String(raw ?? ""));
// Inputs as sent: our own tools' inputs are dropped; the rest pass the leak guard (a model could paste a playbook into a file).
export function safeInput(tool, input) {
  if (INTERNAL[tool]) return {};
  const g = (v) => typeof v === "string" ? leakGuard(v, { spans: !v.includes("\n") }).text : Array.isArray(v) ? v.map(g) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, g(x)])) : v;
  return g(input && typeof input === "object" ? input : {});
}

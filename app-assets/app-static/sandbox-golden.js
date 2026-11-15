// Golden answers for the Sandbox (models-sandbox.js in the browser, src/sandbox-goldens.js on the server). A sample may carry golden: { type, ... }. This file holds the pure
// parts: how a reply is read, how it is compared with the golden (four types: choices, items, text, contains), and how a saved golden is checked. No model call is made.
export const TYPES = ["choices", "items", "text", "contains"];
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const blank = (x) => x == null || String(x).trim() === "";
const fold = (x) => String(x ?? "").trim().toLowerCase();

// The ranking reply as { order, top }: order is the candidate ids, best first, and top is the first one. The order comes from the ranking model's answer. Hindsight's
// reranker answers { rank: { probabilities: { c0: 0.7, c1: 0.3 }, choice: "c0" } }, so the ids are sorted by probability. A scored answer ({ id: { score } }) is sorted by
// score, and an answer with only a choice gives that one id. The Sandbox's own ranking order (view.order, a list of { id, score }) is used when the answer has none.
export function rankingOf(view) {
  const answers = isObj(view?.answers) ? view.answers : {}, byNumber = (rows) => rows.filter((r) => Number.isFinite(r[1])).sort((a, b) => b[1] - a[1]).map((r) => r[0]);
  let order = [];
  for (const a of Object.values(answers)) {
    if (!isObj(a)) continue;
    if (isObj(a.probabilities)) order = byNumber(Object.entries(a.probabilities).map(([id, p]) => [id, Number(p)]));
    else if (typeof a.choice === "string" && a.choice) order = [a.choice];
    if (order.length) break;
  }
  if (!order.length) order = byNumber(Object.entries(answers).map(([id, a]) => [id, Number(isObj(a) ? a.score ?? a.noul : a)]));
  if (!order.length && Array.isArray(view?.order)) order = view.order.map((r) => String(r?.id ?? "")).filter(Boolean);
  return { order, top: order.length ? order[0] : null };
}
// The search reply as { results: [{ title, url, domain }] }: domain is the host of the url without a leading "www." (empty when the url does not parse).
export function searchOf(view) {
  const rows = Array.isArray(view?.results) ? view.results : [];
  return { results: rows.map((x) => {
    const url = String(x?.url ?? ""); let domain = "";
    try { domain = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { /* not a url */ }
    return { title: String(x?.title ?? ""), url, domain };
  }) };
}
// The tool calls of a chat reply as [{ name, arguments }], arguments parsed as an object when they parse.
export function toolCallsOf(view) {
  return (Array.isArray(view?.tool_calls) ? view.tool_calls : []).map((t) => {
    let args = t?.arguments;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { /* stays text */ } }
    return { name: t?.name ?? null, arguments: args ?? null };
  });
}

// The reply as { parsed, text }: parsed is the answer parsed as JSON when it parses (an object or a list), else null; text is the reply's text.
// Shapes a golden path can address, by reply view:
//   chat         the reply text parsed as JSON when it parses, and and when the model asked for tools also tool_calls: [{ name, arguments }] (a reply with no tool calls has no tool_calls, so a golden on it reports that the reply has no list)
//   answers      the answers object (question id -> { choice } | { score } | ...)
//   look         the answer, when it is an object or a list
//   ranking      { order: [candidate ids, best first], top: first id or null }       (see rankingOf)
//   search       { results: [{ title, url, domain }] }                                (see searchOf)
export function replyOf(view) {
  if (!view || typeof view !== "object") return { parsed: null, text: "" };
  let text = "", parsed = null;
  if (view.type === "chat" || view.type === "transcript") text = String(view.text ?? "");
  else if (view.type === "answers") { parsed = view.answers ?? null; text = parsed == null ? "" : JSON.stringify(parsed); }
  else if (view.type === "look") { parsed = isObj(view.answer) || Array.isArray(view.answer) ? view.answer : null; text = view.answer == null ? "" : typeof view.answer === "string" ? view.answer : JSON.stringify(view.answer); }
  else if (view.type === "json") { parsed = view.json ?? null; text = parsed == null ? "" : JSON.stringify(parsed); }
  else if (view.type === "ranking") { parsed = rankingOf(view); text = JSON.stringify(parsed); }
  else if (view.type === "search") { parsed = searchOf(view); text = JSON.stringify(parsed); }
  else return { parsed: null, text: "" };
  const t = text.trim();
  if (parsed === null && (t[0] === "{" || t[0] === "[")) { try { parsed = JSON.parse(t); } catch { parsed = null; } }
  if (parsed !== null && typeof parsed !== "object") parsed = null;
  if (view.type === "chat" && !Array.isArray(parsed)) { const calls = toolCallsOf(view); if (calls.length) parsed = { ...(parsed || {}), tool_calls: calls }; }
  return { parsed, text };
}
// A dotted path ("a.b.0.c") into a parsed reply. The empty path is the root. Returns undefined when any step is missing.
export function getPath(v, path) {
  if (path == null || path === "") return v;
  let cur = v;
  for (const k of String(path).split(".")) {
    if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, k)) return undefined;
    cur = cur[k];
  }
  return cur;
}
const shown = (x) => (x == null ? "" : typeof x === "string" ? x : typeof x === "object" ? JSON.stringify(x) : String(x));
const textAt = (r, field) => { if (field == null || field === "") return r.text; const v = getPath(r.parsed, field); return v === undefined ? null : shown(v); };

// ---- items: equal on a field (numbers compared as numbers, text trimmed and case-insensitive) ----
const same = (a, b) => (typeof a === "number" || typeof b === "number" ? !blank(a) && !blank(b) && Number(a) === Number(b) : fold(a) === fold(b));

// ---- text: word error rate ----
export const words = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/'/g, "").split(/\s+/).filter(Boolean);
// Returns { wer, diffs } where diffs are { op: "sub" | "del" | "ins", expected, got } (a word the reply changed, left out, or added).
export function wordErrors(expected, got) {
  const a = words(expected), b = words(got), n = a.length, m = b.length;
  const d = Array.from({ length: n + 1 }, (_, i) => { const r = new Array(m + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const diffs = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { if (a[i - 1] !== b[j - 1]) diffs.unshift({ op: "sub", expected: a[i - 1], got: b[j - 1] }); i--; j--; }
    else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { diffs.unshift({ op: "del", expected: a[i - 1], got: "" }); i--; }
    else { diffs.unshift({ op: "ins", expected: "", got: b[j - 1] }); j--; }
  }
  return { wer: n ? d[n][m] / n : (m ? 1 : 0), diffs };
}

// Compares a reply view with a golden. Returns null when there is nothing to compare (no golden, or every expected value is blank), else
// { type, got, total, rows, extras, problem?, wer?, limit?, pass }. Each row is { label, expected, got, ok }.
export function compareGolden(golden, view) {
  if (!golden || !TYPES.includes(golden.type)) return null;
  const r = replyOf(view), g = golden;
  if (g.type === "choices") {
    const ids = Object.keys(isObj(g.value) ? g.value : {}).filter((k) => !blank(g.value[k]));
    if (!ids.length) return null;
    const list = r.parsed === null ? undefined : getPath(r.parsed, g.list);
    const find = (id) => {
      if (Array.isArray(list)) { const el = list.find((x) => (isObj(x) ? shown(x[g.id]).trim() === id : false)); return el === undefined ? undefined : isObj(el) ? el[g.field] : el; }
      if (isObj(list) && Object.prototype.hasOwnProperty.call(list, id)) { const el = list[id]; return isObj(el) && !blank(g.field) ? el[g.field] : el; }
      return undefined;
    };
    const rows = ids.map((id) => { const v = find(id), gotText = v === undefined ? "" : shown(v); return { label: id, expected: String(g.value[id]), got: gotText, ok: v !== undefined && fold(gotText) === fold(g.value[id]) }; });
    const got = rows.filter((x) => x.ok).length;
    return { type: "choices", got, total: rows.length, rows, extras: [], problem: list === undefined || list === null || typeof list !== "object" ? "The reply has no list to compare." : "", pass: got === rows.length };
  }
  if (g.type === "items") {
    const want = (Array.isArray(g.value) ? g.value : []).filter((e) => isObj(e) && (g.match || []).some((f) => !blank(e[f])));
    if (!want.length) return null;
    const list = r.parsed === null ? undefined : getPath(r.parsed, g.list), pool = Array.isArray(list) ? list.map((x, i) => ({ x, i, used: false })) : [];
    const rows = want.map((e) => {
      const hit = pool.find((p) => !p.used && isObj(p.x) && g.match.every((f) => blank(e[f]) || same(e[f], p.x[f])));
      if (hit) hit.used = true;
      return { label: g.match.map((f) => shown(e[f])).filter(Boolean).join(", "), expected: g.match.map((f) => shown(e[f])).join(" | "), got: hit ? g.match.map((f) => shown(hit.x[f])).join(" | ") : "", ok: !!hit };
    });
    const extras = pool.filter((p) => !p.used).map((p) => (isObj(p.x) ? g.match.map((f) => shown(p.x[f])).join(" | ") : shown(p.x)));
    const got = rows.filter((x) => x.ok).length;
    return { type: "items", got, total: rows.length, rows, extras, problem: Array.isArray(list) ? "" : "The reply has no list to compare.", extras_allowed: g.extras_fail === false, pass: got === rows.length && (g.extras_fail === false || !extras.length) };
  }
  if (g.type === "text") {
    if (blank(g.value)) return null;
    const t = textAt(r, g.field), limit = Number.isFinite(g.max_wer) ? g.max_wer : 0.1;
    if (t === null) return { type: "text", got: 0, total: 1, rows: [], extras: [], problem: "The reply has no such field.", wer: 1, limit, diffs: [], pass: false };
    const { wer, diffs } = wordErrors(g.value, t), pass = wer <= limit;
    return { type: "text", got: pass ? 1 : 0, total: 1, rows: [], extras: [], problem: "", wer, limit, diffs, pass };
  }
  const phrases = (Array.isArray(g.value) ? g.value : []).filter((p) => !blank(p));
  if (!phrases.length) return null;
  // A contains golden with no field (the whole reply) searches the reply text and also every tool call's name and arguments (stringified), so a first answer
  // that is only tool calls still counts when a call carries the phrase. A golden with an explicit field reads only that field.
  const wholeReply = g.field == null || g.field === "";
  const calls = wholeReply && view?.type === "chat" ? toolCallsOf(view).map((c) => `${c.name ?? ""} ${shown(c.arguments)}`).join("\n") : "";
  const t = wholeReply ? (calls ? `${r.text}\n${calls}` : r.text) : textAt(r, g.field), hay = t === null ? "" : t.toLowerCase();
  const rows = phrases.map((p) => ({ label: String(p), expected: String(p), got: "", ok: hay.includes(String(p).trim().toLowerCase()) }));
  const got = rows.filter((x) => x.ok).length;
  return { type: "contains", got, total: rows.length, rows, extras: [], problem: t === null ? "The reply has no such field." : "", pass: got === rows.length };
}
const pct = (x) => (Math.round(x * 1000) / 10).toString() + "%";
export function scoreLine(c) {
  if (!c) return "";
  if (c.type === "text") return c.problem ? c.problem : `Word error rate ${pct(c.wer)}, ${c.pass ? "within" : "over"} the ${pct(c.limit)} limit`;
  return `${c.got} of ${c.total} golden` + (c.extras && c.extras.length ? `, ${c.extras.length} extra${c.extras_allowed ? " (allowed)" : ""}` : "");
}

// ---- checking a golden the person saved: the structure comes from the sample's own golden, only the expected values (and the text pass level, and whether extra items fail) are theirs ----
export const GOLDEN_LIMITS = { rows: 200, text: 20000, cell: 500 };
const cell = (x) => { if (typeof x === "number" && Number.isFinite(x)) return x; if (typeof x === "string") return x.slice(0, GOLDEN_LIMITS.cell); return ""; };
export function cleanGolden(base, input) {
  if (!base || !TYPES.includes(base.type)) throw new Error("This job has no golden answers.");
  if (!isObj(input)) throw new Error("The golden answers must be an object.");
  const v = input.value, L = GOLDEN_LIMITS;
  if (base.type === "choices") {
    if (!isObj(v) || Object.keys(v).length > L.rows) throw new Error("The expected answers are not valid.");
    return { ...base, value: Object.fromEntries(Object.entries(v).map(([k, x]) => [String(k).slice(0, L.cell), String(cell(x))])) };
  }
  if (base.type === "items") {
    if (!Array.isArray(v) || v.length > L.rows) throw new Error("The expected items are not valid.");
    const keys = new Set([...(base.match || []), ...(Array.isArray(base.value) ? base.value.flatMap((e) => (isObj(e) ? Object.keys(e) : [])) : [])]);
    const x = input.extras_fail === undefined ? base.extras_fail : input.extras_fail;
    if (x !== undefined && typeof x !== "boolean") throw new Error("Extra items fail must be true or false.");
    return { ...base, value: v.map((e) => { if (!isObj(e)) throw new Error("The expected items are not valid."); return Object.fromEntries(Object.entries(e).filter(([k]) => keys.has(k)).map(([k, x]) => [k, cell(x)])); }), ...(x !== undefined ? { extras_fail: x } : {}) };
  }
  if (base.type === "text") {
    if (typeof v !== "string" || v.length > L.text) throw new Error("The expected text is not valid.");
    const w = input.max_wer === undefined ? base.max_wer : input.max_wer;
    if (w !== undefined && !(typeof w === "number" && w >= 0 && w <= 1)) throw new Error("The pass level must be between 0 and 100 percent.");
    return { ...base, value: v, ...(w !== undefined ? { max_wer: w } : {}) };
  }
  if (!Array.isArray(v) || v.length > L.rows || v.some((p) => typeof p !== "string")) throw new Error("The expected phrases are not valid.");
  return { ...base, value: v.map((p) => p.slice(0, L.cell)) };
}

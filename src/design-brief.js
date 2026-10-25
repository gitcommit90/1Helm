// The design brief, run by 1Helm itself. The first time in a task that any agent (Primary or a helper, either engine, a native worker too)
// writes web page or deck source, the result of that write gets the design brief appended: real-site references, :root tokens, rules and
// component suggestions from the design MCP Worker (design-mcp/, tool design_brief). Nothing depends on a model choosing to ask for it.
//   Trigger: the file type only (a .html or .htm file written or edited), except a deck's slide files (.src/slides/). No keyword matching and no classifier on the request.
//   Once per task: design_briefs holds the task's row, so a restart or a second helper doesn't repeat it. A failed call leaves the write
//   result unchanged and says nothing; it is tried again on a later write, at most twice in a task.
import { SKIP_SOURCE } from "./better-design.js";
// Public edition: the brief runs only when the admin sets DESIGN_MCP_URL (the variable design_mcp.py reads) to a design MCP Worker, for
// example https://mcp.1helm.com or their own deploy of design-mcp/. Unset or empty means no brief and no network call, so a self-hosted
// install never sends its users' text to a service the admin did not choose.
export const briefUrl = (env) => { const base = String(env?.DESIGN_MCP_URL || "").trim().replace(/\/+$/, ""); return base ? base + "/brief/mcp" : ""; };
export const BRIEF_TIMEOUT_MS = 8000;
export const BRIEF_TRIES = 2;
export const BRIEF_MAX_CHARS = 9000;
export const BRIEF_HEADER = "Design brief for this page, from 1Helm's design sources. Build the page from it before you share it: follow the direction, paste the :root tokens into the page's own style (in a deck, use the palette and fonts and keep the deck's own CSS), and take the references and components as guidance.";

const HTML_PATH = /\.html?$/i;
// A deck's slide files (<project>/.src/slides/<id>.html) are filled-in templates, not new designs: no brief for them.
const DECK_SLIDE = /\.src\/slides\/[^/]+\.html?$/i;
// A command that writes an .html file: a redirect or tee into it, or Python opening it for writing. Cheap and literal; reading one never matches.
const HTML_WRITE_CMD = [/>>?\s*["']?[^\s"'|;&<>]+\.html?\b/i, /\btee\s+(?:-a\s+)?["']?[^\s"'|;&]+\.html?\b/i, /open\(\s*["'][^"']+\.html?["']\s*,\s*["'][wa]/i];

export function writesDesignFile(name, a, r) {
  if (!r || r.code !== 0) return false;
  if (name === "write_file" || name === "edit_file") return HTML_PATH.test(String(a?.path || "").trim()) && !DECK_SLIDE.test(String(a?.path || "").trim());
  if (name === "run_command") return HTML_WRITE_CMD.some((re) => re.test(String(a?.command || ""))) && !/\.src\/slides\//.test(String(a?.command || ""));
  return false;
}

// The text the design step is built from: the helper's job, or the person's latest message in this task.
export function briefDescription(tc) {
  const t = tc?.helper ? [tc.helper.name, tc.helper.task].filter(Boolean).join(": ") : (tc?.context?.userText ?? tc?.userText ?? "");
  return String(t || "").replace(/\s+/g, " ").trim().slice(0, 600);
}

// betterDesign: false adds skip: ["better-design"] to the tool call, so the Worker never sends the description to Better Design (better-design.js).
// true leaves the call exactly as it was before the switch existed.
export async function fetchBrief(description, { fetchFn = fetch, url = "", ms = BRIEF_TIMEOUT_MS, betterDesign = true } = {}) {
  if (!url) return "";
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetchFn(url, { method: "POST", signal: ac.signal, headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "design_brief", arguments: betterDesign ? { description } : { description, skip: [SKIP_SOURCE] } } }) });
    if (!res.ok) return "";
    const msg = await res.json();
    if (msg?.error || msg?.result?.isError) return "";
    return String((msg?.result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n")).trim().slice(0, BRIEF_MAX_CHARS);
  } catch { return ""; } finally { clearTimeout(timer); }
}

// → the text to append to the write's result, or "". `res` is the Resident (sql), `tc` the turn context (session, helper, userText).
export async function briefForWrite(res, name, a, r, tc, opts = {}) {
  try {
    if (!writesDesignFile(name, a, r)) return "";
    const url = opts.url ?? briefUrl(res.env); if (!url) return "";   // not configured: no call and the write result is unchanged
    const session = tc?.session; if (!session) return "";
    const description = briefDescription(tc); if (!description) return "";
    res.sql.exec("CREATE TABLE IF NOT EXISTS design_briefs (session TEXT PRIMARY KEY, tries INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL)");
    const row = res.sql.exec("SELECT tries, done FROM design_briefs WHERE session=?", String(session)).toArray()[0];
    if (row && (row.done || row.tries >= BRIEF_TRIES)) return "";
    res._briefBusy ||= new Set();
    if (res._briefBusy.has(String(session))) return "";   // another agent in this task is fetching it right now
    res._briefBusy.add(String(session));
    try {
      res.sql.exec("INSERT INTO design_briefs (session,tries,done,at) VALUES (?,1,0,?) ON CONFLICT(session) DO UPDATE SET tries=tries+1, at=excluded.at", String(session), Date.now());
      // The account's Better Design switch (better-design.js). If it can't be read, Better Design is off.
      let betterDesign = false;
      try { betterDesign = opts.betterDesign ?? (typeof res.betterDesignOn === "function" ? await res.betterDesignOn() : false); } catch { betterDesign = false; }
      const brief = await fetchBrief(description, { ...opts, url, betterDesign });
      if (!brief) return "";
      res.sql.exec("UPDATE design_briefs SET done=1, at=? WHERE session=?", Date.now(), String(session));
      try { tc.designBrief = { step: tc.callNo || 0, tool: name, path: a?.path || null, chars: brief.length }; } catch {}
      return `\n\n${BRIEF_HEADER}\n\n${brief}`;
    } finally { res._briefBusy.delete(String(session)); }
  } catch { return ""; }
}

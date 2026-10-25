// P4 working memory (PROPOSAL L3, ReCAP + CLM). Replaces "fold everything into notes at 40k tokens" with a per-step working set:
// - blocks = each assistant tool call + its result. Message order and pairs are never changed (the API needs them); a dropped block's
//   RESULT becomes a short label with a key, the call itself stays.
// - protected: system, earlier turns, every person message, the last 3 results, the latest write/edit result per file.
// - the rest is scored: identifier overlap with the current focus (person message + last reply text + last 2 results) + recency
//   + 1 hop (shares an identifier with a protected block). Lowest scores are dropped first until the set fits the budget.
// - STICKY (v2, after the 10-03 A/B loss): set-asides never revert by themselves, so the prompt prefix stays cacheable;
//   bring_back(key) appends the full output as a new step. Labels keep warning/error/rare lines.
// - REFERENCES (artroute, 10-06): read_skill / read_doc results are playbooks, read once and then followed. Long text full of
//   identifiers always won the overlap score, so a 30k-char skill read sat in every later step. Now a reference is "used" once
//   REF_USED_AFTER real steps (not other reads, to-do updates or bring_backs) came after it; when the used references pass REF_KEEP chars they are all set aside
//   in one batch (one prefix change, cache-friendly), and in a budget batch they go first. Their label names what was read and keeps
//   the script commands it gave; bring_back(key) or a fresh read_skill returns the text.
// - PINS (deckflow, 10-07: a deck turn made 16 bring_backs, each restored copy set aside again and brought back again): a
//   bring_back's restored copy is pinned for the rest of the request (never set aside again), and so is the latest read of the
//   current kind's main reference (presentation, pdf, document, spreadsheet, markdown, web-page: the build recipe the model
//   follows step by step) while it's at most PIN_MAX chars; all pins together stay under PIN_BUDGET (newest restores first).
//   bring_back of a key whose restored copy is still in view answers with a one-line pointer instead of a second copy. A label for a set-aside reference lists the exact command lines.
const ID = /(?:\/[\w.\-]+){1,}|\b[\w\-]+\.(?:js|ts|py|json|md|txt|csv|log|html|css|sh|yaml|yml|toml|sql|mjs)\b|\$?\d[\d,]*(?:\.\d+)?%?|\b[A-Z][A-Z0-9_\-]{2,}\b|\b[a-z]+[A-Z]\w*\b|\b\w+_\w+\b|https?:\/\/[^\s"')]+/g;
export const idents = (s) => new Set((String(s || "").slice(0, 20000).match(ID) || []).filter((x) => x.length > 2 && !/^\d{1,2}$/.test(x)));
const cost = (m) => String(m.content || "").length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
// Lines worth keeping in a label: warnings/errors and other lines that break the file's dominant pattern.
const SALIENT = /\b(WARN(ING)?|ERR(OR)?|FATAL|FAIL(ED|URE)?|CRIT(ICAL)?|Exception|Traceback|denied|mismatch|panic|refused|not found)\b/i;
export function salientLines(c, n = 3) {
  const lines = String(c || "").split("\n").filter((l) => l.trim());
  const shape = (l) => l.replace(/\d+/g, "#").replace(/\s+/g, " ").split(" ").slice(2, 5).join(" ");
  const freq = new Map(); for (const l of lines) freq.set(shape(l), (freq.get(shape(l)) || 0) + 1);
  const hit = lines.filter((l) => SALIENT.test(l));
  const rare = lines.length > 20 ? lines.filter((l) => !SALIENT.test(l) && freq.get(shape(l)) === 1) : [];
  return [...hit, ...rare].slice(0, n).map((l) => l.slice(0, 220));
}
// Cache-stable working set. Decisions are STICKY: a step set aside stays set aside (only bring_back returns it, as a new message
// at the end), so the start of the prompt changes only when a new batch is set aside. Batches drop to LOW of the budget, so the
// prefix stays the same for many steps and the provider's prompt cache keeps hitting. `state` persists across steps of one request.
export const REF_TOOLS = new Set(["read_skill", "read_doc"]), REF_USED_AFTER = 3, REF_KEEP = 12000, BOOKKEEPING = new Set(["update_todos", "work_log", "bring_back"]);
// SOURCES (source-stays, 10-24: a helper read a 26k-char prompt.txt whole, the 20k "huge" rule cut it to head+tail at once, and half its 20 steps went to
// bring_back and python prints to get the text back): what file_text / read_file returned is the job's source text. It is never cut and never set aside,
// newest read first, up to SOURCE_BUDGET chars together (the caller lowers it for a small-context model) and SOURCE_MAX per result. It is not counted in the
// working-set budget, so a big source doesn't push every other result aside. bring_back's restored copies use the same pool instead of PIN_BUDGET.
export const SOURCE_TOOLS = new Set(["file_text", "read_file"]), SOURCE_MAX = 200000, SOURCE_BUDGET = 240000;
export const BATCH_MARGIN = 1.1, PIN_MAX = 12000, PIN_BUDGET = 26000, MAIN_REF = /^\[1Helm skill: [\w-]+, reference: (?:presentation|pdf|document|spreadsheet|markdown|web-page)\]/;
// Exact command lines a reference gives (node/python3/bash + a skill script + its arguments), first one per script.
export function refCommands(c, n = 5) {
  const out = [], seen = new Set();
  for (const m of String(c || "").matchAll(/(?:^|[`\s(])((?:node|python3|bash)\s+\/opt\/1hc\/skills\/[\w\-\/]+\.(?:py|mjs|sh|js)\b[^`\n]*)/gm)) {
    const script = m[1].match(/\/opt\/1hc\/skills\/\S+/)[0]; if (seen.has(script)) continue; seen.add(script);
    out.push(m[1].trim().replace(/\s+\\$/, " …").slice(0, 200)); if (out.length >= n) break;
  }
  return out;
}
// The label a set-aside reference leaves: what was read, the scripts it named (the commands still to run), the key.
export function refLabel(args, c, id) {
  const f = (k) => String(args || "").match(new RegExp(`"${k}"\\s*:\\s*"([^"]{1,80})"`))?.[1];   // args may be cut at 300 chars
  const what = `${String(args || "").match(/^\w+/)?.[0] || "read"} ${[f("slug"), f("ref"), f("name")].filter(Boolean).join("/")}`.trim();
  const lines = refCommands(c), cmds = [...new Set(String(c).match(/\/opt\/1hc\/skills\/[\w\-\/]+\.(?:py|mjs|sh|js)/g) || [])].filter((x) => !lines.some((l) => l.includes(x))).slice(0, 6);
  return `[set aside to save room: ${what} → ${c.length} chars, already read; follow what you took from it.${lines.length ? ` Commands it gives (run them; each script has --help): ${lines.map((l) => `\`${l}\``).join(" ; ")}.` : ""}${cmds.length ? ` Scripts it names: ${cmds.join(", ")}.` : ""} key ${id}; bring_back(key) to read it again]`;
}
export function workingSet(messages, full, o = {}) {
  const budget = o.budget ?? 60000, low = o.low ?? 0.55, base = o.base ?? 0, st = o.state || { aside: new Map() }, out = messages.slice(), receipts = { kept: 0, dropped: [], newly: 0 };
  const refKeep = o.refKeep ?? REF_KEEP, refAfter = o.refUsedAfter ?? REF_USED_AFTER;
  const toolIdx = out.map((m, i) => (m.role === "tool" ? i : -1)).filter((i) => i >= base);
  if (!toolIdx.length) return { messages: out, receipts, state: st };
  const argsOf = new Map(); for (const m of out) if (m.role === "assistant" && m.tool_calls) for (const c of m.tool_calls) argsOf.set(c.id, `${c.function?.name || ""}(${String(c.function?.arguments || "").slice(0, 300)})`);
  const protectedIdx = new Set(toolIdx.slice(-3)), latestWrite = new Map();
  toolIdx.forEach((i) => { const a = argsOf.get(out[i].tool_call_id) || ""; const m = a.match(/^(write_file|edit_file)\(.*?"path"\s*:\s*"([^"]+)"/); if (m) latestWrite.set(m[2], i); });
  for (const i of latestWrite.values()) protectedIdx.add(i);
  // Pins (never set aside), at most PIN_BUDGET chars together: the latest read of the kind's main reference (if not huge), then
  // bring_back's restored copies, newest first. A restored copy past the budget is an ordinary result again.
  const nameOf = (i) => String(argsOf.get(out[i].tool_call_id) || "").match(/^\w+/)?.[0], len = (i) => String(out[i].content || "").length;
  const pinned = new Set(), pinBudget = o.pinBudget ?? PIN_BUDGET; let pinSize = 0; st.restoredBy = new Map();
  const restored = toolIdx.filter((i) => nameOf(i) === "bring_back" && /^\[restored /.test(String(out[i].content || "")));
  for (const i of restored) { const k = String(argsOf.get(out[i].tool_call_id) || "").match(/"key"\s*:\s*"([^"]+)"/)?.[1]; if (k) st.restoredBy.set(k, out[i].tool_call_id); }
  const mainRef = toolIdx.filter((i) => REF_TOOLS.has(nameOf(i)) && MAIN_REF.test(String(out[i].content || "")) && len(i) <= (o.pinMax ?? PIN_MAX)).pop();
  const pin = (i, max = o.pinMax ?? PIN_MAX) => { if (i != null && !pinned.has(i) && !st.aside.has(out[i].tool_call_id) && len(i) <= max && pinSize + len(i) <= pinBudget) { pinned.add(i); pinSize += len(i); } };
  pin(mainRef);
  // deckflow3 (dev 10-07: references and new_deck.mjs's skeleton listing set aside mid-build, then read again with bring_back, cat or
  // sed, 10 bring_backs in one PDF turn): the latest new_deck.mjs output (the slide files to fill) and the other references of the
  // main reference's skill read in this request (pdf-design, prose, deck-images...) stay too, newest first, while they fit.
  pin(toolIdx.filter((i) => nameOf(i) === "run_command" && /new_deck\.mjs/.test(argsOf.get(out[i].tool_call_id) || "")).pop());
  // ...and the latest photo fetch (its credits go in SOURCES.md and onto the file: a deck's slide notes, a caption elsewhere; dev 10-07: brought back twice and SOURCES.md read twice).
  pin(toolIdx.filter((i) => nameOf(i) === "run_command" && /images\.py fetch/.test(argsOf.get(out[i].tool_call_id) || "")).pop());
  const skillOf = (i) => String(out[i].content || "").match(/^\[1Helm skill: ([\w-]+), reference: /)?.[1];
  // ...until the build command first runs: from then on its PASS/FAIL report says what to fix, so they may go like any reference.
  const built = toolIdx.some((i) => nameOf(i) === "run_command" && /make_(deck|pdf|docx)\.sh|render_audit\.mjs|render_docx\.sh/.test(argsOf.get(out[i].tool_call_id) || ""));
  if (mainRef != null && !built) for (const i of toolIdx.filter((i) => REF_TOOLS.has(nameOf(i)) && i !== mainRef && skillOf(i) === skillOf(mainRef)).reverse()) pin(i);
  // Source reads and restored copies: the second pool (see SOURCES above), newest first. A result that doesn't fit is an ordinary result again.
  const srcBudget = o.sourceBudget ?? SOURCE_BUDGET, srcMax = o.sourceMax ?? SOURCE_MAX; let srcSize = 0; const srcPinned = new Set();
  const pinSrc = (i) => { if (!pinned.has(i) && !st.aside.has(out[i].tool_call_id) && len(i) <= srcMax && srcSize + len(i) <= srcBudget) { pinned.add(i); srcPinned.add(i); srcSize += len(i); } };
  for (const i of [...toolIdx].reverse()) if (restored.includes(i) || (SOURCE_TOOLS.has(nameOf(i)) && len(i) >= 400 && !/^\[(?:Same text|not set aside|already restored)/.test(String(out[i].content || "")))) pinSrc(i);
  st.pinned = new Set([...pinned].map((i) => out[i].tool_call_id));
  // Apply the sticky labels first (same text every step = same prefix bytes).
  for (const i of toolIdx) { const id = out[i].tool_call_id; if (st.aside.has(id) && !protectedIdx.has(i)) out[i] = { ...out[i], content: st.aside.get(id) }; }
  // Huge results get head+tail so one 200k-char log can't sink the budget. STICKY and stateless (r35-cache-fix): the rule depends only
  // on the result's own length, so the same text is sent at every step (also after the result is no longer one of the newest 3, and
  // also after a resume rebuilds this state). Before, only the newest 3 were trimmed, and a trimmed result grew back to full size
  // after 3 newer results, which rewrote an early part of the prompt and lost the provider's cache. A bring_back copy (pinned) stays whole.
  st.trimmed = st.trimmed || new Set(); const hugeAt = o.hugeAt ?? budget / 3, hugeKeep = o.hugeKeep ?? budget / 8;
  for (const i of toolIdx) { const id = out[i].tool_call_id, c = String(out[i].content || "");
    if (c.length <= hugeAt || pinned.has(i) || (st.aside.has(id) && !protectedIdx.has(i))) continue;
    st.trimmed.add(id); out[i] = { ...out[i], content: `${c.slice(0, hugeKeep)}\n…[${c.length - 2 * hugeKeep} chars set aside, key ${id}; bring_back(key) for all]…\n${c.slice(-hugeKeep)}` }; }
  let size = out.slice(base).reduce((a, m) => a + cost(m), 0) - srcSize;
  // References: used (REF_USED_AFTER real steps since) and still in full. Past REF_KEEP chars together → all set aside now.
  const isRef = (i) => REF_TOOLS.has(String(argsOf.get(out[i].tool_call_id) || "").match(/^\w+/)?.[0]);
  const real = toolIdx.filter((i) => !isRef(i) && !BOOKKEEPING.has(String(argsOf.get(out[i].tool_call_id) || "").match(/^\w+/)?.[0]));
  const usedRefs = toolIdx.filter((i) => isRef(i) && !protectedIdx.has(i) && !pinned.has(i) && !st.aside.has(out[i].tool_call_id) && String(out[i].content || "").length >= 400 && real.filter((j) => j > i).length >= refAfter);
  // Labels are made from the original text (messages[i]), not the head+tail copy of a huge result, so they keep its commands and key lines.
  const orig = (i) => String(messages[i].content || "");
  const setAside = (i) => { const id = out[i].tool_call_id, c = orig(i), label = refLabel(argsOf.get(id), c, id); size -= String(out[i].content || "").length - label.length; st.aside.set(id, label); out[i] = { ...out[i], content: label }; receipts.newly++; };
  if (usedRefs.reduce((a, i) => a + orig(i).length, 0) > refKeep) for (const i of usedRefs) setAside(i);
  // A batch rewrites an early part of the prompt, so it only starts when the prompt is clearly over budget (BATCH_MARGIN), then
  // drops to LOW of the budget so the next batch is many steps away. Within the batch, results that don't touch the current focus
  // go first, oldest first, and the results the task is working on stay in full.
  if (size > budget * (o.margin ?? BATCH_MARGIN)) {
    // New batch: score only blocks still in full; lowest first; drop until LOW × budget.
    const lastText = [...out].reverse().find((m) => m.role === "assistant" && m.content)?.content || "";
    const persons = out.filter((m, i) => i >= base && m.role === "user").map((m) => typeof m.content === "string" ? m.content : "").join(" ");
    const focus = idents(`${o.task || ""} ${persons} ${lastText}`);
    const cand = toolIdx.filter((i) => !protectedIdx.has(i) && !pinned.has(i) && !st.aside.has(out[i].tool_call_id) && String(out[i].content || "").length >= 400);
    const scored = cand.map((i, k) => { const ids = idents(`${argsOf.get(out[i].tool_call_id) || ""} ${out[i].content}`); let ov = 0; for (const x of ids) if (focus.has(x)) ov++;
      return { i, s: isRef(i) ? -1 : ov > 0 ? 1e6 + ov * 3 + k : k }; }).sort((a, b) => a.s - b.s);   // references go first, then unrelated results oldest first, then related ones
    for (const b of scored) {
      if (size <= budget * low) break;
      if (isRef(b.i)) { setAside(b.i); continue; }
      const id = out[b.i].tool_call_id, c = orig(b.i), keep = salientLines(c);
      const label = `[set aside to save room: ${argsOf.get(id)?.slice(0, 120) || "tool"} → ${c.length} chars. ${keep.length ? `Key lines:\n${keep.join("\n")}\n` : `First line: ${c.split("\n").find((l) => l.trim())?.slice(0, 140) || ""}. `}key ${id}; bring_back(key) for the full output]`;
      size -= String(out[b.i].content || "").length - label.length; st.aside.set(id, label); out[b.i] = { ...out[b.i], content: label }; receipts.newly++;
    }
  }
  receipts.dropped = [...st.aside.keys()]; receipts.kept = toolIdx.length - receipts.dropped.length; receipts.size = size;
  return { messages: out, receipts, state: st };
}
// What bring_back(key) returns: the original text, unless it's already in full in front of the model (never set aside, pinned,
// or restored earlier in this request), which would only paste a second copy. A key of a bring_back resolves to its original.
export function bringBack(key, full, st) {
  key = String(key || ""); let v = full?.get(key);
  if (v == null) return null;
  const m = String(v).match(/^\[restored ([^\]]+)\]\n/); if (m) { key = m[1]; v = full.get(key) ?? String(v).slice(m[0].length); }
  const by = st?.restoredBy?.get(key);
  if (by && !st.aside?.has(by) && st.pinned && !st.pinned.has(by)) return `[already restored: ${key} was brought back once and was set aside again because the held text is over its limit. Read only the part you need (file_text with a section or query, or a command that prints those lines) instead of restoring it again.]`;
  if (by && !st.aside?.has(by)) return `[already restored: ${key} is shown in full above (the bring_back ${by}) and stays there for the rest of this request; read it there and carry on]`;
  if (st?.aside && !st.aside.has(key) && !st.trimmed?.has(key)) return `[not set aside: ${key} is still in full above; read it there and carry on]`;
  return `[restored ${key}]\n${v}`;
}
// A new tool result that repeats one still shown in full in this request (a saved web page opened again through the work log and
// then fetched again, the same reference read twice): a one-line pointer instead of a second copy. Dev 10-07: a PDF turn carried the
// same two pages (17k + 20k chars) three times each. Compared on their long lines (≥ 40 chars), so different wrappers ("Already
// fetched…", "Fetched …", "[restored …]", untrusted-content markers) and a different cut-off still match: a duplicate when 90% of the
// new result's long lines are in the earlier one. Only results of DEDUPE_MIN chars or more, with at least 12 long lines.
// Only for tools that return documents (a command's output can differ from the last run in one line that matters).
export const DEDUPE_MIN = 3000, DEDUPE_EXACT = 500, DEDUPE_TOOLS = new Set(["fetch_url", "work_log", "read_skill", "read_doc", "read_file", "file_text", "recall_history", "web_search", "bring_back"]);
const longLines = (c) => new Set(String(c || "").split("\n").map((l) => l.trim()).filter((l) => l.length >= 40).slice(0, 600));
export function sameAsShown(out, messages, st, base = 0, tool = "fetch_url") {
  const c = String(out || ""); if (!DEDUPE_TOOLS.has(tool)) return null;
  // Short results: only an exact repeat (deckflow4: the same 1.3k read_file of a read-back and of SOURCES.md, twice each).
  if (c.length < DEDUPE_MIN) {
    if (c.length < DEDUPE_EXACT) return null;
    const hit = messages.slice(base).reverse().find((m) => m.role === "tool" && !st?.aside?.has(m.tool_call_id) && String(m.content || "") === c);
    return hit ? `[Same text as the result of ${hit.tool_call_id} above, which is still in full there; nothing new came back. Use it from there.]` : null;
  }
  const mine = longLines(c); if (mine.size < 12) return null;
  for (let i = messages.length - 1; i >= base; i--) {
    const m = messages[i]; if (m.role !== "tool" || st?.aside?.has(m.tool_call_id)) continue;
    const mc = String(m.content || ""); if (mc.length < DEDUPE_MIN) continue;
    const theirs = longLines(mc); let hit = 0; for (const l of mine) if (theirs.has(l)) hit++;
    if (hit < 0.9 * mine.size) continue;
    const first = c.split("\n").find((l) => l.trim())?.slice(0, 140) || "";
    return `[Same text as the result of ${m.tool_call_id} above, which is still in full there; nothing new came back (${first}). Use it from there.]`;
  }
  return null;
}
export const BRING_BACK_TOOL = { type: "function", function: { name: "bring_back", description: "Restore the full output of an earlier step in this request that was set aside to save room (its label shows a key).", parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } } };

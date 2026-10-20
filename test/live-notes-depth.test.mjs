// Offline test of what 1Helm controls in Live notes depth: what transcript each note-taker pass sends, the window and its snapping, the length guides,
// the final schema and rendering, the diagnostics, and the replay feed. It never judges model wording.
// node --import ./test/stubs/register.mjs test/live-notes-depth.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { LiveNotes, applyOps, noteCaps, sentencesOf, ITEM_CHARS, noteWindow, noteDepth, finalDepth, finalGuide, diagAttempt, diagOutcome, finalNotesSection, renderSection, parseSection, NOTE_SYSTEM, FINAL_SYSTEM, NOTE_HISTORY_CHARS, NOTE_SNAP, NOTE_LINES_CHARS, notesRequest } from "../src/ee/live-notes.js";
import { FINAL_NOTES_SCHEMA, NOTE_PATCH_SCHEMA } from "../src/background-schemas.js";
import { validateStructured } from "../src/structured-output.js";

const lines = (a, b) => Array.from({ length: b - a }, (_, i) => `[+0:${String(i + a).padStart(2, "0")}] line ${i + a} ${"x".repeat(100)}`);

// noteWindow: keeps the newest lines up to the cap, starts on a multiple of the snap, and says how many lines it left out.
{
  const h = lines(0, 100), w = noteWindow(h, 100, { chars: 100000, snap: 40 });
  assert.equal(w.lines.length, 100); assert.equal(w.omitted, 0);
  const small = noteWindow(h, 100, { chars: 5000, snap: 40 });   // ~ 44 lines fit; the start snaps down to line 40
  assert.equal(small.omitted, 40); assert.equal(small.lines[0], h[40]); assert.equal(small.lines.length, 60);
  const again = noteWindow(lines(0, 110), 110, { chars: 5000, snap: 40 });   // ten more lines: the front of the window is the same
  assert.equal(again.omitted, 40); assert.equal(again.lines[0], h[40]);
  const part = noteWindow(h.slice(50), 100, { chars: 1e6, snap: 40 });   // history shorter than the total: it never claims lines it doesn't have
  assert.equal(part.omitted, 50); assert.equal(part.lines.length, 50);
  assert.equal(noteWindow([], 0).lines.length, 0);
}
// Length guides come from the numbers, and are bounded.
{
  assert.deepEqual(noteDepth(58 * 60e3), { minutes: 58, summary: 12 }); assert.equal(noteDepth(8 * 60e3).summary, 2); assert.equal(noteDepth(0).summary, 2);
  const d = finalDepth("word ".repeat(10100), 58 * 60e3); assert.deepEqual(d, { words: 10100, minutes: 58, summary: 11, topics: 13 });
  assert.deepEqual(finalDepth("hi there", 1000), { words: 2, minutes: 1, summary: 3, topics: 2 });
  assert.equal(finalDepth("w ".repeat(60000), 3 * 3600e3).topics, 30); assert.equal(finalDepth("w ".repeat(60000), 3 * 3600e3).summary, 12);
  assert.match(finalGuide(d), /58 minutes, about 10100 words.*up to 11 sentences.*up to 13 topics.*2 to 8 points/);
  assert.match(finalGuide(d, true), /up to 6 sentences.*up to 7 topics.*1 to 4 points.*cut off/);
}
// Prompts: no 120-word recap and no fixed 2-4 or 3-6 sentence caps; the note-taker is told to cover the whole meeting.
{
  for (const p of [NOTE_SYSTEM, FINAL_SYSTEM]) assert.ok(!/under 120 words|2-4 sentences|3-6 plain sentences|only for what the new lines add/.test(p));
  assert.match(NOTE_SYSTEM, /whole meeting so far, not only the new lines/); assert.match(FINAL_SYSTEM, /topics: an array of/);
  assert.equal("temperature" in notesRequest("note", []), false, "no temperature: aliases of models that refuse it would be filtered out");
}
// Schemas and the final rendering: topics become a bold topic line with nested points under Notes; the strict schema accepts it.
{
  const data = { attendees: [], summary: ["Overall."], topics: [{ title: "Background", points: ["Moved into AI in 2021.", "Bought $4,000 of hardware."] }, { title: "Build or buy", points: [] }, { title: " ", points: ["dropped"] }], decisions: ["Buy the tool."], actions: [], questions: ["Who owns it?"], notes: ["Loose note."] };
  validateStructured(data, FINAL_NOTES_SCHEMA);
  assert.throws(() => validateStructured({ ...data, topics: undefined }, FINAL_NOTES_SCHEMA));
  assert.throws(() => validateStructured({ ops: [], rolling: "x" }, NOTE_PATCH_SCHEMA));
  const p = finalNotesSection(data, "## Session 1 · Test"), md = renderSection(p);
  assert.match(md, /### Notes\n- Loose note\.\n- \*\*Background\*\*\n  - Moved into AI in 2021\.\n  - Bought \$4,000 of hardware\.\n- \*\*Build or buy\*\*\n/);
  assert.ok(!md.includes("dropped")); assert.match(md, /### Decisions\n- Buy the tool\./);
  assert.deepEqual(parseSection(md).subs.notes.lines.length, 5);
}
// Diagnostics: pure counters.
{
  let d = diagAttempt(undefined, "note", { finish: "stop", in: 1000, out: 200, cached: 500, chars: 4000 });
  d = diagAttempt(d, "note", { finish: "length", in: 1500, out: 6000, chars: 6000, err: "missing, refused, or incomplete answer", at: 5 });
  d = diagOutcome(d, "note", "ok", { at: 7 }); d = diagOutcome(d, "note", "skipped_invalid", { err: "x", at: 8 });
  assert.deepEqual(d.note.finish, { stop: 1, length: 1 }); assert.equal(d.note.attempts, 2); assert.equal(d.note.in_tokens, 2500); assert.equal(d.note.out_tokens, 6200); assert.equal(d.note.cached_tokens, 500);
  assert.equal(d.note.max_chars, 6000); assert.equal(d.note.last_chars, 6000); assert.equal(d.note.errors.length, 1);
  assert.deepEqual(d.note.outcomes, { ok: 1, skipped_invalid: 1 }); assert.equal(d.note.passes, 2); assert.equal(d.note.last_outcome, "skipped_invalid");
  for (let i = 0; i < 9; i++) d = diagAttempt(d, "final", { err: `e${i}` }); assert.equal(d.final.errors.length, 5); assert.equal(d.final.errors.at(-1).err, "e8");
}

// A real LiveNotes object on SQLite: what notePass sends, and the diagnostics it saves.
function harness({ replyFor }) {
  const db = new DatabaseSync(":memory:"), calls = [];
  const sql = { exec(q, ...a) { if (/^\s*CREATE/i.test(q)) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q); if (/^\s*(SELECT|INSERT[\s\S]*RETURNING)/i.test(q)) { const rows = st.all(...a); return { toArray: () => rows }; } const r = st.run(...a); return { toArray: () => [], rowsWritten: r.changes }; } };
  let doc = "# T\n\n## Session 1 · Mon, 10:00 AM–now (live)\n\n### Summary\n_Listening…_\n\n---\n\n";
  const ln = Object.assign(Object.create(LiveNotes.prototype), { sql, env: {}, ctx: {}, tz: () => "UTC", ev: async () => {}, mirror: async () => {}, readDoc: async () => ({ text: doc, version: 1 }),
    editDoc: async (fn) => { const next = fn(doc); if (next != null) doc = next; return { version: 2 }; },
    paid: async (kind, reserve, n, msgs) => { calls.push({ kind, msgs }); const r = replyFor(kind, calls.length); if (r.throw) { ln.diag(n, (d) => diagAttempt(d, kind, { finish: r.finish, err: "invalid" })); throw Object.assign(new Error("invalid"), { structured: true, finish: r.finish }); } ln.diag(n, (d) => diagAttempt(d, kind, { finish: "stop", in: 100, out: 10 })); return { data: r.data, finish: "stop" }; } });
  ln.init(); ln.put("status", "live"); ln.put("n", "1"); ln.put("task", "t"); ln.put("tenant", "ten"); ln.put("channel", "c");
  ln.setS(1, { n: 1, started_at: 1e12, source: "mic", note_upto: 0, notes: 0, cost_nano: 0, tokens: 0 });
  const add = (a, b) => { for (let i = a; i < b; i++) ln.sql.exec("INSERT INTO utts (n, conv, uid, at, speaker, text, rt) VALUES (1,0,?,?,NULL,?,1)", `u${i}`, 1e12 + i * 1000, `spoken ${i} ${"w".repeat(150)}`); };
  return { ln, calls, add, doc: () => doc };
}
{
  const H = harness({ replyFor: () => ({ data: { ops: [{ op: "add", sec: "notes", text: "A point.", owner: "", due: "" }] } }) });
  H.add(0, 300);   // ~47 k characters before the first pass: the first pass has them all as new lines (capped), the next sees them as history
  await H.ln.notePass(1);
  let u = H.calls[0].msgs[1].content; const newCount = (x) => (x.split("NEW transcript lines:\n")[1].split("\n\nCurrent session")[0].match(/spoken/g) || []).length;
  assert.ok(newCount(u) > 0 && newCount(u) * 160 <= NOTE_LINES_CHARS + 160, "new lines are capped per pass");
  assert.ok(u.indexOf("Transcript so far") < u.indexOf("NEW transcript lines") && u.indexOf("NEW transcript lines") < u.indexOf("Notes so far:"), "transcript first, the changing notes last");
  for (let k = 0; k < 8; k++) { H.add(300 + k * 3, 303 + k * 3); await H.ln.notePass(1); }
  u = H.calls.at(-1).msgs[1].content;
  const hist = u.split("NEW transcript lines:")[0], hLines = (hist.match(/spoken/g) || []).length;
  assert.ok(hist.length <= NOTE_HISTORY_CHARS + NOTE_SNAP * 200, "the earlier part is bounded");
  assert.match(hist, /the first \d+ lines are left out; the notes cover them/);
  assert.match(u, /\n\nNotes so far:\n[\s\S]*A point\./, "the notes so far are in the prompt");
  assert.ok(hLines > 100, "far more than the last minute is read");
  assert.match(u, /minutes so far\. Limits now: summary at most \d+ sentences \(it has \d+\), notes at most \d+ lines \(it has \d+\)/);
  assert.equal(H.ln.s(1).diag.note.outcomes.ok, 9); assert.equal(H.ln.s(1).diag.note.passes, 9);
  assert.equal(H.ln.s(1).diag.note.attempts, 9); assert.equal(H.ln.s(1).diag.note.finish.stop, 9);
  assert.ok(H.ln.s(1).note_upto > 0 && !("rolling" in H.ln.s(1)));
}
// An unreadable note-taker answer: asked once more, then skipped, counted with its finish reason, and the lines are not marked as read.
{
  const H = harness({ replyFor: () => ({ throw: true, finish: "length" }) });
  H.add(0, 5); await H.ln.notePass(1);
  const g = H.ln.s(1).diag.note; assert.equal(g.attempts, 2); assert.deepEqual(g.finish, { length: 2 }); assert.deepEqual(g.outcomes, { skipped_invalid: 1 }); assert.equal(H.ln.s(1).note_upto, 0);
}
// Replay (TEST_MODE only): lines are fed about 46 s at a time, each feed runs one real pass, and the end stops the session.
{
  const H = harness({ replyFor: () => ({ data: { ops: [] } }) });
  assert.deepEqual(await H.ln.replay({ lines: [{ at: 0, text: "x" }] }), { error: "not found" }, "off outside TEST_MODE");
  H.ln.env = { TEST_MODE: "1" }; H.ln.arm = async () => {}; let stopped = null; H.ln.stop = async (why, o) => { stopped = [why, o]; };
  const feed = Array.from({ length: 200 }, (_, i) => ({ at: i * 10, text: `line ${i}` }));   // 33 minutes of talk, one line per 10 s
  const r = await H.ln.replay({ lines: feed }); assert.equal(r.ok, true); assert.equal(r.lines, 200);
  assert.equal(H.ln.s(1).started_at < Date.now() - 1900e3, true, "the session start moves back by the length of the recording");
  assert.equal(H.ln.get("nomem_1"), "1");
  let steps = 0; while (H.ln.get("replay") && steps < 100) { await H.ln.replayStep(); steps++; }
  assert.equal(H.calls.length, steps); assert.ok(steps >= 40 && steps <= 45, `about one pass per 46 s of talk (${steps})`);
  assert.deepEqual(stopped, ["person", { flushed: true }]);
  assert.equal(H.ln.sql.exec("SELECT COUNT(*) c FROM utts").toArray()[0].c, 200);
}
// Caps are enforced in code, whatever the model sends.
{
  assert.deepEqual(noteCaps(0), { sentences: 3, words: 90, lines: { notes: 6, decisions: 4, questions: 4 }, chars: ITEM_CHARS });
  const c29 = noteCaps(29 * 60e3); assert.equal(c29.sentences, 8); assert.equal(c29.lines.notes, 50); assert.equal(c29.lines.decisions, 19);
  const c58 = noteCaps(58 * 60e3); assert.equal(c58.sentences, 13); assert.equal(c58.lines.notes, 93); assert.equal(noteCaps(1e9).sentences, 13);
  assert.equal(sentencesOf("One. Two! Three? Four"), 4); assert.equal(sentencesOf(""), 0);
  const mk = () => ({ heading: "", intro: [], subs: {}, order: [], footer: null });
  const sum = (n) => Array.from({ length: n }, (_, i) => `Sentence ${i}.`).join(" ");
  let p = mk(), ours = new Set(), r = applyOps(p, [{ op: "summary", text: sum(37) }], ours, 1, c29);
  assert.equal(r.applied, 0); assert.deepEqual(r.rejected, [{ op: "summary", why: "summary too long" }]);
  r = applyOps(p, [{ op: "summary", text: sum(8) }], ours, 1, c29); assert.equal(r.applied, 1);
  r = applyOps(p, [{ op: "summary", text: "word ".repeat(8 * 31) + "." }], ours, 1, c29); assert.equal(r.rejected[0].why, "summary too long", "the word cap holds too");
  r = applyOps(p, [{ op: "summary", text: sum(2) }], ours, 1, c29); assert.equal(r.applied, 1); assert.equal(p.subs.summary.lines.join(" "), sum(2), "a summary replaces the old one");
  const add = (i, text = `note ${i}`) => ({ op: "add", sec: "notes", text, owner: "", due: "" });
  r = applyOps(p, Array.from({ length: 40 }, (_, i) => add(i)), ours, 1, c29); assert.equal(r.applied, 40);
  r = applyOps(p, Array.from({ length: 20 }, (_, i) => add(40 + i)), ours, 1, c29); assert.equal(r.applied, 10); assert.equal(r.rejected.length, 10); assert.ok(r.rejected.every((x) => x.why === "section full"));
  r = applyOps(p, [{ op: "update", sec: "notes", old: "note 0", text: "merged note", owner: "", due: "" }, { op: "remove", sec: "notes", old: "note 1" }, add(99)], ours, 1, c29);
  assert.equal(r.applied, 3, "at the limit a merge (update and remove) works and frees a place");
  r = applyOps(p, [add(1, "x".repeat(ITEM_CHARS + 1)), { op: "update", sec: "notes", old: "note 2", text: "y".repeat(ITEM_CHARS + 1), owner: "", due: "" }], ours, 1, c29);
  assert.deepEqual(r.rejected.map((x) => x.why), ["item too long", "item too long"]);
  r = applyOps(mk(), [{ op: "add", sec: "actions", text: "Do it", owner: "A", due: "" }], new Set(), 1, null); assert.equal(r.applied, 1, "no caps given: unchanged behavior");
}
console.log("PASS live notes depth: window, guides, schema and rendering, diagnostics, note pass input, replay feed");

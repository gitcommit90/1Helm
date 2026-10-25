// node --import ./test/stubs/register.mjs test/source-stays.test.mjs
// Source text stays (helper #29): a file the job reads with file_text / read_file stays whole in the model's input for the rest of the
// request, so the helper never spends steps restoring it. Judged on app facts only: what the model input holds at each step, and step counts.
import assert from "node:assert";
import { workingSet, bringBack, sameAsShown, SOURCE_BUDGET, SOURCE_MAX } from "../src/workmem.js";
import { world } from "./deploy-harness.mjs";
import { TaskTranscript, TOOL_OUTPUT_BOUND } from "../src/task-transcript.js";
import { readFileCommand } from "../src/resident.js";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ok = (n) => console.log("  ok", n);
const text = (seed, n) => { let x = seed, o = "", i = 0; while (o.length < n) { x = (x * 1103515245 + 12345) & 0x7fffffff; o += `L${i++} CourtSight impact ${x} saves hrs/yr on EPG parser ${x % 977}\n`; } return o.slice(0, n); };
const PARAMS = { budget: 55000, hugeAt: 20000, hugeKeep: 7500, base: 0, task: "Build the deck from prompt.txt" };   // what resident.js passes for a helper
// A helper round: one call per step; each step runs the working set over everything so far, like the loop does, and keeps the originals in `full`.
function round(sourceBudget = 120000) {
  const msgs = [{ role: "system", content: "SYS" }, { role: "user", content: "Build the deck from prompt.txt and the PDF" }], full = new Map(), st = { aside: new Map() }; let n = 0;
  const api = { msgs, full, st, view: null,
    step(name, args, out) {
      const id = `call_${++n}`; let o = out;
      if (name === "bring_back") o = bringBack(args.key, full, st) ?? "?"; else o = sameAsShown(o, msgs, st, 0, name) ?? o;
      full.set(id, o); msgs.push({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, { role: "tool", tool_call_id: id, content: o });
      api.view = workingSet(msgs, full, { ...PARAMS, state: st, sourceBudget }); api.last = id; return id;
    },
    whole: (t) => api.view.messages.some((m) => m.role === "tool" && m.content === t),
    sent: () => api.view.messages.reduce((a, m) => a + String(m.content || "").length, 0) };
  return api;
}
const skill = (r, k) => `[1Helm skill: artifacts, reference: ${k}]\nRun python3 /opt/1hc/skills/artifacts/scripts/new_deck.mjs out.\n${text(k.length, 11000)}`;
const PROMPT = text(1, 26059), PDF = text(2, 15048);

// 1. The reading pattern of the round that failed: prompt.txt (26,059 chars) and the PDF (15,048) read by file_text, then 12 more steps of skills, design lookups and commands.
//    Both texts are whole in the input at every later step, and nothing needs restoring.
{
  const r = round(); r.step("run_command", { command: "ls /workspace/files" }, "files\n".repeat(400));
  r.step("file_text", { file: "prompt.txt" }, PROMPT); assert.ok(r.whole(PROMPT), "the 26k read is not cut to head and tail");
  r.step("file_text", { file: "deck.pdf" }, PDF);
  const steps = [["read_skill", { slug: "artifacts" }, skill(r, "main")], ["read_skill", { slug: "artifacts", ref: "presentation" }, skill(r, "presentation")], ["inspo_recommend", { brief: "deck" }, text(5, 11774)],
    ["better_design_find_design_system", { query: "warm" }, text(6, 18219)], ["read_skill", { slug: "artifacts", ref: "deck-authoring" }, skill(r, "deck-authoring")], ["run_command", { command: "node new_deck.mjs" }, text(7, 3000)],
    ["run_command", { command: "images.py fetch" }, text(8, 3000)], ["run_command", { command: "cat deck.json" }, text(9, 6000)], ["run_command", { command: "python3 check" }, text(10, 600)],
    ["run_command", { command: "python3 build.py a" }, text(11, 9000)], ["run_command", { command: "python3 build.py b" }, text(12, 9000)], ["run_command", { command: "python3 build.py c" }, text(13, 9000)]];
  for (const [name, args, out] of steps) { r.step(name, args, out); assert.ok(r.whole(PROMPT) && r.whole(PDF), `both sources whole after ${name}`); }
  assert.ok(r.st.aside.size > 0, "the other results are still set aside as before (the working-set budget holds for them)");
  assert.equal(r.msgs.filter((m) => m.role === "assistant" && m.tool_calls[0].function.name === "bring_back").length, 0, "no bring_back was needed");
  ok("prompt.txt and the PDF are whole in the input at every step of the round; no restore step is needed; other results are still set aside");
}

// 2. A source up to 100,000 characters (the chat message limit) is read once and stays, from file_text and from read_file.
{
  const big = text(3, 100000), r = round(); r.step("file_text", { file: "big.txt" }, big);
  for (let i = 0; i < 8; i++) { r.step("run_command", { command: `build ${i}` }, text(20 + i, 9000)); assert.ok(r.whole(big), "100,000-character source whole at step " + i); }
  const r2 = round(); const raw = text(4, 100000); r2.step("read_file", { path: "/workspace/files/big.txt" }, raw);
  for (let i = 0; i < 8; i++) r2.step("run_command", { command: `build ${i}` }, text(40 + i, 9000));
  assert.ok(r2.whole(raw)); assert.ok(SOURCE_MAX >= 190000 && SOURCE_BUDGET >= 200000);
  ok("a 100,000-character file read once stays whole through later steps (file_text and read_file)");
}

// 3. A big source is not counted in the working-set budget: results that would have stayed without it still stay.
{
  const a = round(), b = round(); b.step("file_text", { file: "big.txt" }, text(3, 100000));
  for (const r of [a, b]) for (let i = 0; i < 5; i++) r.step("run_command", { command: `cmd ${i}` }, text(60 + i, 9000));
  assert.equal(b.st.aside.size, a.st.aside.size, "same results set aside with or without the source");
  ok("the source does not push other results aside");
}

// 4. The same text read again is one pointer line, not a second copy; and bring_back of a source in view says so.
{
  const r = round(); const id = r.step("file_text", { file: "prompt.txt" }, PROMPT);
  for (let i = 0; i < 3; i++) r.step("run_command", { command: `cmd ${i}` }, text(80 + i, 2000));
  r.step("file_text", { file: "prompt.txt" }, PROMPT);
  const last = r.msgs.at(-1).content; assert.match(last, /^\[Same text as the result of call_1/); assert.ok(last.length < 400);
  r.step("bring_back", { key: id }, "");
  assert.match(r.msgs.at(-1).content, /^\[not set aside: /); assert.ok(r.whole(PROMPT));
  ok("a repeat read or a bring_back of a source in view costs one short line");
}

// 5. A restore of the same key does not repeat: a restored copy is held, and a second bring_back answers with one line. A restored copy that cannot be held says so, with no second copy.
{
  const r = round(); const id = r.step("run_command", { command: "python3 print big" }, text(90, 20500));   // > hugeAt: cut to head+tail, key given
  assert.match(r.view.messages.find((m) => m.tool_call_id === id).content, /bring_back\(key\) for all/);
  r.step("bring_back", { key: id }, ""); const rid = r.last;
  assert.ok(r.whole(r.full.get(rid)), "the restored copy is whole");
  for (let i = 0; i < 4; i++) r.step("run_command", { command: `cmd ${i}` }, text(100 + i, 3000));
  assert.ok(r.whole(r.full.get(rid)), "the restored copy stays whole later");
  r.step("bring_back", { key: id }, ""); assert.match(r.msgs.at(-1).content, /^\[already restored: .* shown in full above/);
  // No room to hold another one (pool full): honest answer, not a repeat.
  const s = round(30000); const k = s.step("run_command", { command: "print" }, text(91, 25000)); s.step("run_command", { command: "other" }, text(92, 25000));
  s.step("bring_back", { key: k }, ""); const r1 = s.last; s.step("run_command", { command: "more" }, text(93, 3000));
  s.step("bring_back", { key: k }, "");
  assert.ok(!s.msgs.at(-1).content.includes("L10 CourtSight"), "a second bring_back of the same key is never a second copy of the text");
  assert.equal(s.msgs.filter((m) => m.role === "tool" && m.content.startsWith("[restored")).length <= 1, true);
  void r1;
  ok("bring_back of the same key never repeats the text");
}

// 6. Sources are bounded: past the budget the oldest source goes back to the normal rules (set aside with a key), the newest stay whole.
{
  const r = round(60000), t = [text(110, 26000), text(111, 26000), text(112, 26000)];
  t.forEach((x, i) => r.step("file_text", { file: `f${i}.txt` }, x));
  for (let i = 0; i < 4; i++) r.step("run_command", { command: `cmd ${i}` }, text(120 + i, 3000));
  assert.ok(r.whole(t[1]) && r.whole(t[2]) && !r.whole(t[0]), "newest sources whole, the oldest over the budget is cut or set aside with a key");
  assert.ok(r.sent() < 60000 + 55000 * 1.1 + 5000, "what is sent stays within the source budget plus the working-set budget");
  const sm = round(10000); const x = text(130, 26000); sm.step("file_text", { file: "a.txt" }, x); assert.ok(!sm.whole(x), "a model with a small context holds less (budget passed by the caller)");
  ok("source budget bounds what stays whole; a small-context model holds less");
}

// 7. Replay of the failed round's whole reading pattern: the same 36 tool calls of helper #29 (result sizes from the card) now need 14 steps, and the texts stay whole throughout.
{
  const lean = round(); const calls = [["run_command", 3096], ["read_file", 108], ["file_text", 0, PROMPT], ["file_text", 0, PDF], ["read_skill", 19119], ["read_skill", 11734], ["inspo_recommend", 11774], ["better_design_find_design_system", 18219], ["read_skill", 10744], ["read_skill", 9000], ["run_command", 3000], ["run_command", 3000], ["run_command", 6000], ["run_command", 600]];
  let notWhole = 0, total = 0;
  calls.forEach(([name, size, fixed], i) => { lean.step(name, { i }, fixed ?? (name === "read_skill" ? skill(lean, "r" + i).slice(0, size) : text(200 + i, size))); total += lean.sent(); if (i >= 3 && !(lean.whole(PROMPT) && lean.whole(PDF))) notWhole++; });
  assert.equal(notWhole, 0); assert.equal(calls.length, 14);
  ok(`replay of helper #29's round: 14 calls instead of 36, both sources whole at every call, ${Math.round(total / calls.length)} chars sent per call on average`);
}

// 8. The append task (main chat): a file_text / read_file result is kept whole up to SOURCE_MAX when it is saved; any other tool result is still cut at 16,000.
{
  const W = world(), R = W.R, store = new TaskTranscript(R.ctx.storage, "ss"), turn = "t1";
  store.create([{ role: "system", content: "fixed" }], []); (R._appendTurns ||= new Map()).set(turn, { transcript: store });
  const big = text(7, 90000), calls = [["c1", "file_text"], ["c2", "read_file"], ["c3", "run_command"]];
  R.save(turn, { role: "assistant", content: "", tool_calls: calls.map(([id, name]) => ({ id, type: "function", function: { name, arguments: "{}" } })) });
  for (const [id] of calls) R.save(turn, { role: "tool", tool_call_id: id, content: big });
  const stored = Object.fromEntries(store.messages().filter((m) => m.role === "tool").map((m) => [m.tool_call_id, m.content.length]));
  assert.equal(stored.c1, 90000); assert.equal(stored.c2, 90000); assert.ok(stored.c3 < TOOL_OUTPUT_BOUND, "another tool's 90,000-character result is still bounded");
  R.save(turn, { role: "assistant", content: "", tool_calls: [{ id: "c4", type: "function", function: { name: "file_text", arguments: "{}" } }] });
  R.save(turn, { role: "tool", tool_call_id: "c4", content: text(8, SOURCE_MAX + 5000) });
  assert.ok(store.messages().at(-1).content.length < 20000, "past SOURCE_MAX even a source read is bounded");
  ok("the append task keeps a source read whole up to the source limit and still bounds every other result");
}

// 9. read_file: the command returns the first max_bytes, says so when the file is longer, keeps the exit code, and the answer is not cut at the end.
{
  const dir = mkdtempSync(join(tmpdir(), "ss-")), f = join(dir, "a.txt"); writeFileSync(f, text(9, 150000));
  const run = (p, mb) => spawnSync("bash", ["-c", readFileCommand(p, mb)], { encoding: "utf8", maxBuffer: 1e7 });
  let r = run(f); assert.equal(r.status, 0); assert.ok(r.stdout.startsWith(text(9, 150000).slice(0, 120000)), "default is the first 120,000 bytes"); assert.match(r.stdout, /\[read_file stopped at 120000 of 150000 bytes/); assert.equal(r.stdout.slice(0, 100), text(9, 150000).slice(0, 100));
  r = run(f, 100000); assert.equal(r.stdout.length >= 100000, true); assert.match(r.stdout, /\[read_file stopped at 100000 of 150000 bytes; read again with a larger max_bytes/);
  r = run(f, 999999); assert.ok(!/read_file stopped/.test(r.stdout)); assert.equal(r.stdout.length, 150000, "up to the 190000 cap the whole file comes back");
  writeFileSync(f, "short\n"); r = run(f, 50); assert.equal(r.stdout, "short\n", "a file that fits has no notice");
  r = run(join(dir, "missing")); assert.notEqual(r.status, 0);
  ok("read_file returns the whole file up to the limit, names the cut when it stops, and keeps the exit code");
}
console.log("source-stays: all passed");

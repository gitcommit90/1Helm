// Zone A part 1: a canvas selection travels in the Reply ref (src/reply-to.js) wherever a message goes: cleaned, stored on the card event,
// read back by the transcript view, and read by the model in a fresh message, a steer and a resumed turn. App facts only, no model wording.
import { world, HANG, tick, assert } from "./deploy-harness.mjs";
import { replyRef, replyLine, withReply, replyOut, replyIn } from "../src/reply-to.js";
import { steerText } from "../src/steer.js";
let passed = 0;
const log0 = console.log; console.log = (...a) => { if (/^(resume|released|recoverCards|labeller|find_app|memjob|charge above|handoff|model step|privacy)/.test(String(a[0]))) return; log0(...a); };
const ok = (n) => { passed++; log0("  ok", n); };
const userTexts = (c) => c.messages.filter((m) => m.role === "user").map((m) => typeof m.content === "string" ? m.content : (m.content || []).map((b) => b.text || "").join(""));
async function drain(rs) { const rd = rs.pipeThrough(new TextDecoderStream()).getReader(); const out = []; let buf = ""; for (;;) { const { value, done } = await rd.read(); if (done) break; buf += value; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) out.push(JSON.parse(l)); } } return out; }
async function scenario(name, fn) { for (const engine of ["classic", "pi"]) { const W = world({ engine, openrouter: true, env: { RESUME_DELAY_MS: 0, RESUME_WRITE_DELAY_MS: 0 } }); await fn(W, engine); ok(`[${engine}] ${name}`); } }

const FILE = "0d9c1f4e-1b2a-4c3d-8e5f-6a7b8c9d0e1f";
const ZONE = { file: FILE, name: "Q3 plan.html", kind: "deck", slide: 2, of: 6, slot: "title", sel: "0/2", label: "Title", text: "Revenue \"up\" 12%" };
const DECK_LINE = `(The person has this selected in the canvas: slide 2 of 6, the Title (data-slot "title") of the deck "Q3 plan.html" (Library file ${FILE}), now reading "Revenue 'up' 12%". Their message is about it.)`;
const sel = { role: "zone", text: "", zone: ZONE };

// ---- the ref and the lines (pure) ----
const r = replyRef(sel);
assert.equal(r.role, "zone"); assert.equal(r.text, "Slide 2, Title", "a selection-only message gets a short label as its text");
assert.deepEqual(r.zone, { ...ZONE, text: "Revenue 'up' 12%" }, "quotes handled like a bubble's text");
assert.deepEqual(replyRef(r), r, "cleaning is idempotent");
assert.equal(replyLine(sel), DECK_LINE);
assert.equal(replyLine({ role: "zone", text: "x", zone: { file: FILE, name: "x.html", kind: "page", sel: "0/2/1", slide: null, text: "" } }), `(The person has this selected in the canvas: the element at path 0/2/1 of the page "x.html" (Library file ${FILE}). Their message is about it.)`);
assert.match(replyLine({ role: "zone", zone: { file: FILE, name: "r.pdf", kind: "report", slide: 3, of: 8, text: "" } }), /page 3 of 8 of the report "r\.pdf"/);
assert.equal(replyRef({ text: "  ", zone: { file: "nope", kind: "deck" } }), null, "junk zone and no text is no reply");
assert.equal(replyRef({ role: "zone", text: "x", zone: { file: "nope" } }).role, "agent", "junk zone is dropped, the bubble stays");
assert.equal(replyRef({ text: "x" }).zone, undefined);
const both = { id: "c1", role: "agent", text: "Pick one", zone: ZONE };
assert.equal(replyRef(both).role, "agent"); assert.equal(replyRef(both).text, "Pick one");
assert.equal(replyLine(both), `(Replying to your earlier message: "Pick one")\n${DECK_LINE}`, "a bubble reply with a selection keeps both");
assert.equal(replyRef({ role: "zone", zone: { ...ZONE, text: "x".repeat(900), label: "L".repeat(200), slot: "bad slot!", sel: "a/b", slide: 0, of: "x" } }).zone.text.length, 400);
const z2 = replyRef({ role: "zone", zone: { ...ZONE, text: "x".repeat(900), label: "L".repeat(200), slot: "bad slot!", sel: "a/b", slide: 0, of: "x" } }).zone;
assert.equal(z2.label.length, 60); assert.equal(z2.slot, null); assert.equal(z2.sel, null); assert.equal(z2.slide, null); assert.equal(z2.of, null);
assert.deepEqual(replyIn(replyOut(sel)), r, "stored as JSON and read back with the zone"); assert.equal(withReply("shorter", sel), `${DECK_LINE}\nshorter`);
assert.match(steerText([{ type: "msg", text: "shorter", at: 0, reply: sel }]), /\] \(The person has this selected in the canvas: slide 2 of 6.*\) shorter$/);
ok("ref: zone cleaned and clipped, selection-only role, bubble plus selection, lines for deck, page and report, junk refused");

await scenario("a selection is stored on the message, shown back by the session view, and read by the model before the words", async (W) => {
  const s = W.R.newSession("deck");
  W.brain = () => "Shorter title it is.";
  await drain(await W.R.chatStream("t1", "main", "1", "make this shorter", { session: s, reply: replyRef(sel) })); await W.settle();
  const u = userTexts(W.calls.find((c) => c.who === "main")).at(-1);
  assert.ok(u.startsWith(`${DECK_LINE}\nmake this shorter`), u.slice(0, 200));
  const t = W.turns()[0];
  assert.deepEqual(JSON.parse(W.dodb.prepare("SELECT reply FROM card_events WHERE card=? AND seq=1").get(t.id).reply), r);
  assert.equal(t.user_text, "make this shorter");
  const d = await W.R.sessionDetail(s); assert.deepEqual(d.turns[0].msgs[0].reply, r, "the transcript view returns the zone so the app can show the chip");
});

await scenario("a selection sent while the helper works (a steer) reaches the next model call and the stored event", async (W) => {
  const s = W.R.newSession("deck2");
  let open; const gate = new Promise((z) => { open = z; });
  const real = W.tools.web_search; W.tools.web_search = async (a) => { await gate; return real(a); };
  W.brain = ({ n }) => n === 1 ? { calls: [["web_search", { step_title: "Looked up", query: "x" }]] } : "Done.";
  const run = W.R.chatStream("t1", "main", "1", "build the deck", { session: s }).then(drain);
  await W.until(() => W.dodb.prepare("SELECT 1 FROM card_events WHERE type='step'").get());
  const st = await drain(await W.R.chatStream("t1", "main", "1", "make this shorter", { session: s, cid: "c-steer", reply: replyRef(sel) }));
  assert.ok(st.some((e) => e.t === "steered"), JSON.stringify(st).slice(0, 300));
  open(); await run; await W.settle();
  const u = userTexts(W.calls.filter((c) => c.who === "main")[1]).join("\n");
  assert.ok(u.includes(DECK_LINE) && u.includes("make this shorter"), u.slice(-600));
  const card = W.turns()[0].id;
  assert.deepEqual(JSON.parse(W.dodb.prepare("SELECT reply FROM card_events WHERE card=? AND cid='c-steer'").get(card).reply), r);
  assert.ok(W.R.cardUserText(card, "build the deck").includes("The person has this selected in the canvas"));
  W.tools.web_search = real;
});

await scenario("a turn cut off by a deploy resumes with the selection", async (W) => {
  const s = W.R.newSession("deck3");
  W.brain = ({ n }) => n === 1 ? { calls: [["web_search", { step_title: "Looked up", query: "x" }]] } : HANG;
  W.R.chatStream("t1", "main", "1", "make this shorter", { session: s, reply: replyRef(sel) }).then(drain).catch(() => {});
  await W.until(() => W.calls.filter((c) => c.who === "main").length === 2);
  const card = W.cards()[0].id;
  W.kill(); W.env.CODE_V = "v2"; const R2 = W.boot(); await tick(5);
  W.calls.length = 0; W.brain = () => "Shortened.";
  await R2.alarm(); await W.settle(R2); for (const p of R2._resumeRuns || []) await p; await W.settle(R2);
  assert.ok(userTexts(W.calls.find((c) => c.who === "main")).some((t) => t.startsWith(DECK_LINE)), "resumed first message keeps the selection");
  assert.deepEqual((await R2.sessionDetail(s)).turns[0].msgs[0].reply, r);
  assert.equal(W.card(card).status, "complete");
});

await scenario("send later keeps the selection", async (W) => {
  const s = W.R.newSession("deck4");
  const a = await W.R.laterAdd("t1", "main", "1", { session: s, text: "make this shorter", due: Date.now() + 120e3, cid: "l1", reply: replyRef(sel) });
  assert.ok(a.item, JSON.stringify(a)); W.calls.length = 0;
  await W.R.laterFire({ id: a.item.id }); await W.until(() => W.turns().length === 1); await W.settle();
  assert.ok(userTexts(W.calls.find((c) => c.who === "main")).at(-1).startsWith(DECK_LINE));
  assert.deepEqual(JSON.parse(W.dodb.prepare("SELECT reply FROM card_events WHERE seq=1").get().reply), r);
});

await scenario("the model also reads what the person edited by hand, only while the file's version is the one their last edit made", async (W) => {
  const s = W.R.newSession("deck5");
  W.R.addFileRow({ id: FILE, name: "Q3 plan.html", mime: "text/html", bytes: 10, r2key: `t/t1/files/main/${FILE}`, source: "helper" });
  W.R.put(`zone_edits:${FILE}`, JSON.stringify({ v: 1, deck: true, at: 1, edits: [{ slide: 2, slot: "title", op: "text", was: "A", now: "B" }] }));
  W.brain = () => "ok";
  await drain(await W.R.chatStream("t1", "main", "1", "make this shorter", { session: s, reply: replyRef(sel) })); await W.settle();
  const u = userTexts(W.calls.find((c) => c.who === "main")).at(-1);
  assert.ok(u.includes('slide 2 title "A" is now "B"') && u.includes("not in the deck's .src folder; keep them when you rebuild."), u.slice(0, 500));
  assert.ok(u.indexOf(DECK_LINE) < u.indexOf("make this shorter") && u.indexOf("make this shorter") < u.indexOf("slide 2 title"), "selection line, the words, then the edits line");
  W.R.sql.exec("UPDATE files SET version=2 WHERE id=?", FILE); W.calls.length = 0;
  await drain(await W.R.chatStream("t1", "main", "1", "again", { session: s })); await W.settle();
  assert.ok(!userTexts(W.calls.find((c) => c.who === "main")).at(-1).includes("edited it by hand"), "a newer version: no line");
});

log0(`zone-selection: ${passed} checks passed`);
process.exit(0);

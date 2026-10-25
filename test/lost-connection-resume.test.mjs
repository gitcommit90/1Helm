// node --import ./test/stubs/register.mjs test/lost-connection-resume.test.mjs
// Release 61 (sidecar check, 2026-10-25): with no deploy, Cloudflare dropped the Resident's connection 11 s into a turn (worker event outcome
// "canceled", log "Connection closed: this Durable Object instance is no longer active", then "Network connection lost" on every write).
// The old instance ended the stream with {"t":"done","reply":"Something went wrong: Network connection lost."} while the new instance finished
// the turn from its journal. A lost-connection error together with failing writes to this object's storage now parks the turn for a resume
// and the stream gets no error text; the same message with working storage (a subrequest that failed) is still an ordinary failure.
import { world, tick, assert } from "./deploy-harness.mjs";
import { isLostErr, isResetErr } from "../src/do-stub.js";
const log0 = console.log; console.log = (...a) => { if (/^(resume|released|recoverCards|labeller|find_app|memjob|charge above|handoff|model step|turn parked|failed card)/.test(String(a[0]))) return; log0(...a); };

for (const m of ["Network connection lost.", "Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request."]) assert.ok(isLostErr(new Error(m)), m);
assert.ok(!isLostErr(new Error("no such column: foo")));
assert.ok(!isResetErr(new Error("Network connection lost.")), "alone it is not proof of a reset");

async function run(storageLost) {
  const W = world({ engine: "classic", env: { RESUME_DELAY_MS: 0, RESUME_WRITE_DELAY_MS: 0 } });
  const R = W.R, ev = [], realExec = R.sql.exec.bind(R.sql); let lost = false;
  R.sql = { exec: (q, ...a) => { if (lost && storageLost && !/^\s*(SELECT|WITH|PRAGMA)/i.test(q)) throw new Error("Network connection lost."); return realExec(q, ...a); } };
  const sp = R.systemPrompt; let first = true;
  R.systemPrompt = async (...a) => { if (first) { first = false; lost = true; throw new Error("Network connection lost."); } return sp.apply(R, a); };
  const s = R.newSession("Lost connection fixture");
  await R.runTurn("t1", "main", "1", "hello", (o) => ev.push(o), { session: s }).catch(() => {});
  return { W, R, ev };
}
{
  const { W, ev } = await run(true);
  const card = W.cards()[0].id;
  assert.notEqual(W.card(card).status, "failed", "the card is not closed as failed");
  assert.ok(!ev.some((e) => e.t === "done"), "no done event on the stream"); assert.doesNotMatch(JSON.stringify(ev), /went wrong|Network connection/);
  W.kill(); W.env.CODE_V = "v2"; const R2 = W.boot(); await tick(5); W.brain = () => "Resumed fine.";
  await R2.alarm(); await W.settle(R2); for (const p of R2._resumeRuns || []) await p; await W.settle(R2);
  assert.equal(W.card(card).status, "complete"); assert.match(W.turns()[0].reply, /Resumed fine/);
}
{
  const { ev } = await run(false);
  const d = ev.find((e) => e.t === "done"); assert.ok(d && /Network connection lost/.test(d.error), "storage still works: an ordinary failure");
}
console.log = log0; console.log("lost-connection-resume: ok"); process.exit(0);

// node --import ./test/stubs/register.mjs test/limits-turn.test.mjs
// The turn loop reads the saved limits (src/limits.js) once at the start of each turn: the step limit of a chat turn, the time a command may run, and
// the saved model wait times. The real Resident on node:sqlite with a scripted model (test/deploy-harness.mjs).
import { world, assert } from "./deploy-harness.mjs";
import { SEED } from "./helpers/seed-settings.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));
const RUN = (n) => ["run_command", { step_title: "Ran a command", command: `check item ${n} ${n * 7919}` }];
const origLog = console.log; console.log = (...a) => { if (!/^(model settings|privacy|router|find_app|custom mcp|channel activity)/.test(String(a[0]))) origLog(...a); };
const settingsWith = (limits) => { const s = clone(SEED); if (limits) s.limits = limits; return s; };

async function run(limits, { engine = "classic" } = {}) {
  const W = world({ engine, openrouter: true, env: { MODEL_SETTINGS: settingsWith(limits) } });
  const s = W.R.newSession("Long"), ev = [];
  W.brain = ({ messages }) => JSON.stringify(messages.at(-1)).includes("step limit") ? "Did the checks I could. Say keep going." : { content: "Next.", calls: [RUN(W.execs.length + 1)] };
  const r = await W.R.runTurn("t1", "main", "1", "check everything", (x) => ev.push(x), { session: s });
  await W.settle();
  return { W, r, ev };
}

for (const engine of ["classic", "pi"]) {
  let a = await run({ chat_steps: 3 }, { engine });
  assert.ok([2, 3].includes(a.W.execs.length), `${engine}: a chat turn stops at the saved 3 steps (the pi engine counts its report step too): ${a.W.execs.length}`);
  assert.match(a.r.reply, /Did the checks I could/, `${engine}: it writes a short report, never a bare stop`);
  a = await run({ chat_steps: 5 }, { engine });
  assert.ok([4, 5].includes(a.W.execs.length), `${engine}: another saved value applies to the next turn: ${a.W.execs.length}`);
  console.log(`ok - ${engine}: the saved chat step limit applies to the turn`);
}

{
  const a = await run({ command_minutes: 2 });
  assert.equal(a.W.execOpts[0]?.timeoutMs, 120000, "a command runs for the saved 2 minutes");
  const b = await run({ chat_steps: 2 });
  assert.equal(b.W.execOpts[0]?.timeoutMs, 240000, "with no saved value it is the starting 4 minutes");
  console.log("ok - the saved command time applies");
}

{
  const W = world({ openrouter: true, env: { MODEL_SETTINGS: settingsWith({ model_first_response_seconds: 30, chat_steps: 2 }) } });
  W.brain = () => "Done.";
  const s = W.R.newSession("Wait");
  await W.R.runTurn("t1", "main", "1", "hello", () => {}, { session: s }); await W.settle();
  assert.equal(W.R._limits.model.headersMs, 30000); assert.deepEqual({ ...W.R._limits.modelSaved }, { headersMs: 30000 });
  assert.equal(W.R.lim().chatSteps, 2);
  console.log("ok - the Resident keeps the limits of its last turn for the code that has no turn");
}
console.log("limits-turn: all checks passed");

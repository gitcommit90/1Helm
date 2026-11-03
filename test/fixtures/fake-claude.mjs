// A stand-in for the claude binary in tests: the same stream-json conversation, with a real HTTP call to ANTHROPIC_BASE_URL. No model, no login.
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const argv = process.argv.slice(2), arg = (k) => argv[argv.indexOf(k) + 1];
const mode = process.env.FAKE_CLAUDE_MODE || "ok";
if (process.env.FAKE_CLAUDE_RECORD) writeFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ argv, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(ANTHROPIC|CLAUDE_CODE|DISABLE|ENABLE|BROWSER)/.test(k))), cwd: process.cwd(), settings: JSON.parse(readFileSync(arg("--settings"), "utf8")), system: readFileSync(arg("--system-prompt-file"), "utf8") }));
const frames = []; const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue; const f = JSON.parse(line); frames.push(f);
  if (f.shouldQuery === false) out({ type: "result", subtype: "success", is_error: false, num_turns: 0 });
}
if (mode === "authfail") { out({ type: "assistant", error: "authentication_failed", message: { content: [{ type: "text", text: "Not logged in" }] } }); out({ type: "result", subtype: "error_during_execution", is_error: true }); process.exit(1); }
const post = async () => fetch(process.env.ANTHROPIC_BASE_URL + "/v1/messages", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer fake-token", "anthropic-version": "2023-06-01" },
  body: JSON.stringify({ model: arg("--model"), stream: true, system: [{ type: "text", text: "x" }], messages: frames.map((f) => f.message), tools: JSON.parse(readFileSync(arg("--settings"), "utf8")).env.CLAUDE_CODE_EXTRA_BODY ? JSON.parse(JSON.parse(readFileSync(arg("--settings"), "utf8")).env.CLAUDE_CODE_EXTRA_BODY).tools : [] }) });
const r = await post(); let buf = "";
for await (const c of r.body) { buf += new TextDecoder().decode(c); }
const events = buf.split(/\n\n/).map((f) => f.split("\n").find((l) => l.startsWith("data:"))).filter(Boolean).map((l) => JSON.parse(l.slice(5)));
for (const e of events) out({ type: "stream_event", event: e });
const second = await post(); // native's retry: must be refused locally
out({ type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0.001, usage: {}, second_status: second.status });
if (mode === "hang") await new Promise(() => {});

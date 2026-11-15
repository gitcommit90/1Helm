import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { withDeadline } from "../src/channel-computer.js";

test("a browser call that never answers fails with a plain error after its deadline", async () => {
  const hung = new Promise(() => {});
  await assert.rejects(withDeadline(hung, "status", 30), (e) => e.deadline === true && e.message.startsWith("the browser didn't answer in 0 s.") && /may have completed.*check the page/.test(e.message));
});
test("a browser call that answers in time returns its result and leaves no timer", async () => {
  assert.deepEqual(await withDeadline(Promise.resolve({ ok: true }), "act", 5e3), { ok: true });
});
test("browser() wraps the fetch in the deadline, counts timeouts and restarts the service after 3", () => {
  const src = fs.readFileSync(new URL("../src/channel-computer.js", import.meta.url), "utf8");
  assert.match(src, /withDeadline\(port\.fetch\(`http:\/\/browser\/cdp\/\$\{op\}`/);
  assert.match(src, /op !== "status" && op !== "record" && \(this\.browserTimeouts[\s\S]{0,80}>= 3\)/);   // status and record are not counted
  assert.match(src, /if \(!this\.commandInFlight\) this\.sh\("\[ -f \/workspace\/\.browser\/recording\.json \] \|\| pkill -9 -f \/opt\/1hc-browser\/server\.mjs"/);   // browser service only, never the computer
  assert.doesNotMatch(src, /browser service not answering/);
  assert.match(src, /finally \{ this\.inflight--; \}/);   // a timeout returns through this, so the idle stop works again
});
test("deadlines: Worker 160/60/10/180 s, server just under at 150/55/8/175 s", () => {
  const w = fs.readFileSync(new URL("../src/channel-computer.js", import.meta.url), "utf8"), s = fs.readFileSync(new URL("../image/opt/1hc-browser/server.mjs", import.meta.url), "utf8");
  assert.match(w, /\{ status: 10e3, screenshot: 60e3, snapshot: 60e3, navigate: 160e3, act: 160e3, record: 180e3 \}/);
  assert.match(s, /\{ status: 8e3, screenshot: 55e3, snapshot: 55e3, record: 175e3 \}/);
  assert.match(s, /OP_LIMIT\[op\] \|\| 150e3/);
  assert.match(s, /limited\("record", /);
});
test("the debounce save backs off 2 minutes after a failed save", () => {
  const w = fs.readFileSync(new URL("../src/channel-computer.js", import.meta.url), "utf8");
  assert.match(w, /r\?\.ok === false\) this\.put\("save_due", Date\.now\(\) \+ 2 \* 60e3\)/);
});
test("the app event run is handed to waitUntil, not awaited under the 60 s cap", () => {
  const r = fs.readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
  assert.match(r, /this\.ctx\.waitUntil\?\.\(Promise\.resolve\(this\.appEventsDue\(\)\)/);
  assert.doesNotMatch(r, /step\("app event run"/);
});
test("every blocking child process in the browser service has a timeout", () => {
  const src = fs.readFileSync(new URL("../image/opt/1hc-browser/server.mjs", import.meta.url), "utf8");
  const calls = src.split("\n").filter((l) => /execFileSync\(/.test(l));
  assert.ok(calls.length >= 3);
  for (const l of calls) assert.match(l, /timeout: 5e3/);
});
test("every fetch to Chrome's local endpoints has a timeout and each op is bounded", () => {
  const src = fs.readFileSync(new URL("../image/opt/1hc-browser/server.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src.replace(/const cdpFetch[^\n]*/, ""), /[^\w.]fetch\(`http:\/\/127\.0\.0\.1/);
  assert.match(src, /const cdpFetch = [^\n]*AbortSignal\.timeout\(1e4\)/);
  assert.match(src, /await limited\(m\[1\], OPS\[m\[1\]\]\(b, c, ctx\)\)/);
  assert.match(src, /limited\("status", OPS\.status\(b\)\)/);
  assert.match(src, /u\.pathname === "\/health"\) return send\(200/);
});
test("init.sh kills a browser service that misses 3 health checks in a row", () => {
  const sh = fs.readFileSync(new URL("../image/opt/1hc/init.sh", import.meta.url), "utf8");
  assert.match(sh, /curl -sf -m 5 http:\/\/localhost:6080\/health/);
  assert.match(sh, /miss=0; else miss=\$\(\(miss\+1\)\)/);
  assert.match(sh, /\$miss -ge 3 \].*pkill -9 -f \/opt\/1hc-browser\/server\.mjs/);
  // Run the real loop body with a fake curl that always fails and a fast sleep: it must call pkill once after 3 misses.
  const loop = sh.match(/\( miss=0; while true;[\s\S]*?done \) &/)[0].replace(/\) &$/, ")").replace("sleep 30", "sleep 0");
  const dir = fs.mkdtempSync("/tmp/hh-"); fs.writeFileSync(`${dir}/curl`, "#!/bin/sh\nexit 22\n", { mode: 0o755 });
  fs.writeFileSync(`${dir}/pkill`, `#!/bin/sh\necho kill >> ${dir}/kills\nkill -9 $PPID 2>/dev/null\n`, { mode: 0o755 });
  const r = spawnSync("bash", ["-c", `log(){ :; }; export PATH=${dir}:$PATH; ${loop.replace(/\(\s*miss=0;/, "( miss=0;")} `], { timeout: 3e3 });
  assert.ok(fs.existsSync(`${dir}/kills`), String(r.stderr));
  fs.rmSync(dir, { recursive: true });
});
test("the background browser job races its body against the deadline plus 60 s", async () => {
  const src = fs.readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
  assert.match(src, /withDeadline\(runBrowserTask\([\s\S]*?"job", Math\.max\(1e3, j\.deadline \+ 60e3 - Date\.now\(\)\)\)/);
  assert.match(src, /finally \{\s*if \(renew\) clearInterval\(renew\);/);
  await assert.rejects(withDeadline(new Promise(() => {}), "job", 20), (e) => e.deadline === true);   // a hung call ends the wait
});

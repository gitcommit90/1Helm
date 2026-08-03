import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

const sourceBetween = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("request-path subprocesses have no synchronous regression", async () => {
  const memory = await readFile(join(root, "src", "server", "memory.ts"), "utf8");
  const computers = await readFile(join(root, "src", "server", "channel-computers.ts"), "utf8");
  assert.doesNotMatch(memory, /\bexecFileSync\b/, "the Python memory bridge must never synchronously stop Node's only thread");
  const readiness = sourceBetween(computers, "export function runtimeReadiness", "async function sha256File");
  assert.doesNotMatch(readiness, /\bspawnSync\b|ociChannelImageExistsSync/, "runtimeReadiness must only read cache and schedule asynchronous refreshes");
  assert.match(readiness, /void refreshRuntimeReadiness\(\)/, "an expired readiness snapshot schedules a refresh instead of becoming permanently stale");
});

test("slow memory and readiness subprocesses leave the event loop responsive", async (t) => {
  const testRoot = mkdtempSync(join(tmpdir(), "1helm-event-loop-"));
  t.after(() => rmSync(testRoot, { recursive: true, force: true }));
  const fakePython = join(testRoot, "fake-python.mjs");
  const fakeOci = join(testRoot, "fake-oci.mjs");
  const ociCalls = join(testRoot, "oci-calls.log");
  await writeFile(fakePython, `#!/usr/bin/env node
if (process.argv[2] === "-c") process.exit(0);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => setTimeout(() => {
  const request = JSON.parse(input);
  process.stdout.write(JSON.stringify({ ok: request.operation === "init" }));
}, 250));
`, { mode: 0o700 });
  await writeFile(fakeOci, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.FAKE_OCI_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");
setTimeout(() => {
  const operation = process.argv[2];
  if (operation === "version") process.stdout.write("1helm-oci-runtime-v1\\n");
  else if (operation === "ready") process.stdout.write('{"ready":true,"engine":"fake"}\\n');
  else if (operation === "image-status") process.stdout.write('{"exists":true}\\n');
  else process.exitCode = 1;
}, 250);
`, { mode: 0o700 });
  await Promise.all([chmod(fakePython, 0o700), chmod(fakeOci, 0o700)]);

  process.env.CTRL_DATA_DIR = join(testRoot, "data");
  process.env.HELM_APP_ROOT = root;
  process.env.MNEMOSYNE_PYTHON = fakePython;
  process.env.HELM_CHANNEL_COMPUTER_BACKEND = "oci";
  process.env.HELM_OCI_HELPER = fakeOci;
  process.env.HELM_OCI_HELPER_USE_SUDO = "0";
  process.env.HELM_OCI_STATE_ROOT_OVERRIDE = join(testRoot, "oci");
  process.env.FAKE_OCI_CALLS = ociCalls;
  process.env.NODE_ENV = "test";

  const memory = await import("../src/server/memory.ts");
  let ticks = 0;
  const memoryTicks = setInterval(() => { ticks += 1; }, 10);
  const memoryResult = await memory.ensureAgentMemory({ id: 1, kind: "skipper", channel_id: null });
  clearInterval(memoryTicks);
  assert.equal(memoryResult, true);
  assert(ticks >= 10, `the event loop ticked only ${ticks} times during a 250ms memory bridge`);

  const computers = await import("../src/server/channel-computers.ts");
  const started = performance.now();
  const initial = computers.runtimeReadiness();
  const returnedIn = performance.now() - started;
  assert.equal(initial.status, "checking");
  assert(returnedIn < 50, `uncached runtimeReadiness blocked for ${returnedIn.toFixed(1)}ms`);

  ticks = 0;
  const readinessTicks = setInterval(() => { ticks += 1; }, 10);
  const refreshed = await computers.refreshRuntimeReadiness();
  clearInterval(readinessTicks);
  // The OCI backend only reports ready on the platforms that can run it
  // (linux/win32). On macOS the same call correctly returns ready:false, so
  // assert the platform-appropriate value. The point of THIS test - that the
  // slow refresh ran off the event loop - holds either way and is checked by
  // the tick count below, which is what actually regressed.
  const ociSupportedHere = ["linux", "win32"].includes(process.platform) && ["arm64", "x64"].includes(process.arch);
  assert.equal(refreshed.ready, ociSupportedHere, `refreshRuntimeReadiness ready mismatch on ${process.platform}/${process.arch}`);
  assert(ticks >= 40, `the event loop ticked only ${ticks} times during slow runtime probes`);
  const callsBeforeCacheRead = (await readFile(ociCalls, "utf8")).trim().split("\n").length;
  assert.equal(computers.runtimeReadiness().ready, ociSupportedHere);
  await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  const callsAfterCacheRead = (await readFile(ociCalls, "utf8")).trim().split("\n").length;
  assert.equal(callsAfterCacheRead, callsBeforeCacheRead, "a fresh readiness cache must not launch another probe");
});

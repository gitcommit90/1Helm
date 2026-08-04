import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { selectFastTests, DEFAULT_FAST_TESTS } from "../scripts/fast-test-lib.mjs";
import { MNEMOSYNE_VERSION, mnemosyneTestPaths, selectMnemosyneRuntime } from "../scripts/mnemosyne-test-runtime.mjs";
import { assertPortAvailable, assertSafePreviewData, previewConfig, ServerRestarter } from "../scripts/preview-lib.mjs";

const root = new URL("..", import.meta.url).pathname;

test("preview defaults to a loopback non-Stable port and generated data", () => {
  const config = previewConfig(root, [], {});
  assert.equal(config.port, 8124);
  assert.equal(config.url, "http://127.0.0.1:8124");
  assert.equal(config.dataDir, join(root, ".preview-data"));
  assert.throws(() => previewConfig(root, ["--port", "8123"], {}), /refuses Stable port/);
  assert.throws(() => previewConfig(root, ["--port", "9000"], { HELM_STABLE_PORT: "9000" }), /refuses Stable port/);
  for (const unsafe of ["data", "data-refactored", "/var/lib/1helm-oci-v1", "../other-data"]) {
    assert.throws(() => previewConfig(root, ["--data-dir", unsafe], {}), /must stay inside.*preview-data/);
  }
});

test("preview refuses symlinks that could redirect generated data", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "1helm-preview-safety-"));
  const outside = await mkdtemp(join(tmpdir(), "1helm-preview-outside-"));
  t.after(async () => { await rm(project, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  await symlink(outside, join(project, ".preview-data"));
  const config = previewConfig(project, [], {});
  await assert.rejects(assertSafePreviewData(config), /symbolic link/);
});

test("preview gives an actionable error when its chosen port is occupied", async (t) => {
  const server = createServer();
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  t.after(() => server.close());
  const address = server.address();
  await assert.rejects(assertPortAvailable(address.port), /already occupied[\s\S]*--port/);
});

test("server restarts are debounced and all active children are stopped", async () => {
  const started = [];
  const stopped = [];
  let scheduled;
  const restarter = new ServerRestarter({
    start: async () => { const child = { id: started.length + 1 }; started.push(child); return child; },
    stop: async (child) => { stopped.push(child); },
    setTimer: (callback) => { scheduled = callback; return callback; },
    clearTimer: (timer) => { if (scheduled === timer) scheduled = undefined; },
  });
  await restarter.start();
  restarter.changed();
  const firstTimer = scheduled;
  restarter.changed();
  assert.notEqual(scheduled, firstTimer);
  scheduled();
  await restarter.queue;
  assert.deepEqual(started.map(({ id }) => id), [1, 2]);
  assert.deepEqual(stopped.map(({ id }) => id), [1]);
  await restarter.close();
  assert.deepEqual(stopped.map(({ id }) => id), [1, 2]);
});

test("fast tests accept focused files and otherwise choose a small default", () => {
  assert.deepEqual(selectFastTests(root, [], () => true), DEFAULT_FAST_TESTS);
  assert.deepEqual(selectFastTests(root, ["test/phase1-tools.mjs"], () => true), ["test/phase1-tools.mjs"]);
  assert.throws(() => selectFastTests(root, ["src/server/index.ts"], () => true), /inside test/);
  assert.throws(() => selectFastTests(root, ["test/missing.mjs"], () => false), /does not exist/);
});

test("Mnemosyne cache decisions validate every reusable candidate without installing", () => {
  const reusable = selectMnemosyneRuntime({
    explicitPython: "/explicit/python", cachePython: "/cache/python", mode: "cache",
    validity: { explicit: false, cache: true },
  });
  assert.deepEqual(reusable, { action: "reuse", runtime: "/cache/python", source: "generated test cache" });
  assert.equal(selectMnemosyneRuntime({
    explicitPython: "", cachePython: "/bad-cache", mode: "cache",
    validity: { explicit: false, cache: false },
  }).action, "prepare-cache");
  assert.equal(selectMnemosyneRuntime({
    explicitPython: "", cachePython: "/cache", mode: "disposable",
    validity: { explicit: false, cache: true },
  }).action, "prepare-disposable");
  const paths = mnemosyneTestPaths(root);
  assert.match(paths.environmentRoot, new RegExp(`\\.test-state[/\\\\]mnemosyne[/\\\\]${MNEMOSYNE_VERSION.replaceAll(".", "\\.")}$`));
});

test("package commands and docs expose the private preview and fast inner loop", async () => {
  const packageJson = (await import("../package.json", { with: { type: "json" } })).default;
  assert.equal(packageJson.scripts.preview, "node scripts/preview.mjs");
  assert.equal(packageJson.scripts["test:fast"], "node scripts/run-fast-tests.mjs");
});

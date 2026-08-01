import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Linux release packaging ships pinned connectors for every supported host architecture", () => {
  const packageLinux = readFileSync(join(import.meta.dirname, "..", "scripts", "package-linux-host.mjs"), "utf8");
  const resolver = readFileSync(join(import.meta.dirname, "..", "src", "server", "connectors.ts"), "utf8");
  for (const [arch, asset, digest] of [
    ["x64", "cloudflared-linux-amd64", "4a9e50e6d6d798e90fcd01933151a90bf7edd99a0a55c28ad18f2e16263a5c30"],
    ["arm64", "cloudflared-linux-arm64", "0755ba4cbab59980e6148367fcf53a8f3ec85a97deefd63c2420cf7850769bee"],
  ]) {
    assert.match(packageLinux, new RegExp(`arch: "${arch}"[\\s\\S]*asset: "${asset}"[\\s\\S]*sha256: "${digest}"`));
  }
  assert.match(packageLinux, /cloudflared-linux-\$\{connector\.arch\}/, "the verified binaries enter the Linux release archive");
  assert.match(packageLinux, /chmodSync\(destination, 0o755\)/, "packaged Linux connectors retain executable mode");
  assert.match(packageLinux, /rev-parse[\s\S]*--show-toplevel[\s\S]*repositoryRoot !== root[\s\S]*parent repository or source copy is not release authority/, "Linux packaging fails closed when a copied source tree accidentally resolves to a parent Git checkout");
  assert.match(packageLinux, /git", \["show", "HEAD:package\.json"\][\s\S]*headVersion !== version/, "Linux packaging binds its visible version to the exact Git HEAD");
  assert.match(packageLinux, /archive\.stdout\?\.length[\s\S]*stagedPackage[\s\S]*versioned package contract/, "Linux packaging rejects an empty or structurally incomplete Git source archive");
  assert.match(resolver, /cloudflared-linux-\$\{process\.arch\}/, "Linux resolves only the binary matching the running host architecture");
  assert.match(resolver, /process\.env\.HELM_APP_ROOT[\s\S]*process\.cwd\(\)/, "an installed Linux service can resolve its bundled connector from its release working directory");
});

test("Linux release packaging rejects a source copy nested under another Git checkout", async () => {
  const projectRoot = join(import.meta.dirname, "..");
  const version = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version;
  const copiedRoot = await mkdtemp(join(projectRoot, ".package-root-test-"));
  const copiedScripts = join(copiedRoot, "scripts");
  await mkdir(copiedScripts);
  await copyFile(join(projectRoot, "scripts", "package-linux-host.mjs"), join(copiedScripts, "package-linux-host.mjs"));
  await writeFile(join(copiedRoot, "package.json"), `${JSON.stringify({ version })}\n`);
  try {
    const result = spawnSync(process.execPath, [join(copiedScripts, "package-linux-host.mjs")], { cwd: copiedRoot, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /parent repository or source copy is not release authority/);
  } finally {
    await rm(copiedRoot, { recursive: true, force: true });
  }
});

test("Linux service working directory resolves the bundled connector without a legacy app-root environment", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux systemd working-directory contract");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "1helm-linux-connector-root-"));
  const resources = join(root, "resources");
  const binary = join(resources, `cloudflared-linux-${process.arch}`);
  const originalCwd = process.cwd();
  const originalAppRoot = process.env.HELM_APP_ROOT;
  const originalResources = process.env.HELM_RESOURCES_PATH;
  const originalBinary = process.env.CLOUDFLARED_BIN;
  await mkdir(resources);
  await writeFile(binary, "#!/bin/sh\nexit 0\n");
  await chmod(binary, 0o755);
  process.chdir(root);
  delete process.env.HELM_APP_ROOT;
  delete process.env.HELM_RESOURCES_PATH;
  delete process.env.CLOUDFLARED_BIN;
  t.after(async () => {
    process.chdir(originalCwd);
    if (originalAppRoot === undefined) delete process.env.HELM_APP_ROOT; else process.env.HELM_APP_ROOT = originalAppRoot;
    if (originalResources === undefined) delete process.env.HELM_RESOURCES_PATH; else process.env.HELM_RESOURCES_PATH = originalResources;
    if (originalBinary === undefined) delete process.env.CLOUDFLARED_BIN; else process.env.CLOUDFLARED_BIN = originalBinary;
    await rm(root, { recursive: true, force: true });
  });
  const connectors = await import(`../src/server/connectors.ts?linux-root-test=${Date.now()}`);
  assert.equal(connectors.connectorAvailable(), true);
});

test("stopping a connector cancels automatic relaunch while preserving its credentials", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "1helm-connector-test-"));
  const binary = join(root, "cloudflared");
  const log = join(root, "launches.log");
  await writeFile(binary, [
    "#!/bin/sh",
    "printf 'launch\\n' >> \"$HELM_CONNECTOR_TEST_LOG\"",
    "if [ \"${HELM_CONNECTOR_TEST_HOLD:-0}\" = 1 ]; then",
    "  trap 'sleep 0.15; exit 0' TERM",
    "  while :; do sleep 0.05; done",
    "fi",
    "exit 1",
    "",
  ].join("\n"));
  await chmod(binary, 0o755);
  Object.assign(process.env, {
    CTRL_DATA_DIR: join(root, "data"),
    CLOUDFLARED_BIN: binary,
    HELM_CONNECTOR_TEST_LOG: log,
    HELM_CONNECTOR_RELAUNCH_MS: "30",
  });
  const connectors = await import(`../src/server/connectors.ts?connector-test=${Date.now()}`);
  t.after(async () => { connectors.stopAllConnectors(); await rm(root, { recursive: true, force: true }); });

  assert.equal(connectors.connectorAvailable(), true);
  connectors.saveTunnelConnector("workspace", { account_tag: "account", tunnel_id: "tunnel", tunnel_secret: "secret" }, ["test.1helm.com"], 8123);
  connectors.startTunnelConnector("workspace");
  await new Promise((resolve) => setTimeout(resolve, 140));
  const beforeStop = (await readFile(log, "utf8")).trim().split("\n").length;
  assert.ok(beforeStop >= 2, "a failed desired connector relaunches");
  connectors.stopTunnelConnector("workspace");
  // A process already returned by spawn() can reach its first instruction
  // while stop is delivering SIGTERM. Establish the stopped boundary after
  // that in-flight child settles, then prove no timer can launch another one.
  await new Promise((resolve) => setTimeout(resolve, 75));
  const stoppedBoundary = (await readFile(log, "utf8")).trim().split("\n").length;
  await new Promise((resolve) => setTimeout(resolve, 140));
  const afterStop = (await readFile(log, "utf8")).trim().split("\n").length;
  assert.ok(stoppedBoundary >= beforeStop, "stop accounts for any child that was already spawned");
  assert.equal(afterStop, stoppedBoundary, "disabled connector does not relaunch after the stopped boundary");
  assert.ok(connectors.connectorCredential("workspace"), "disabling leaves the reserved connector credential available for re-enable");

  process.env.HELM_CONNECTOR_TEST_HOLD = "1";
  connectors.startTunnelConnector("workspace");
  await new Promise((resolve) => setTimeout(resolve, 60));
  const beforeDuplicateStart = (await readFile(log, "utf8")).trim().split("\n").length;
  connectors.startTunnelConnector("workspace");
  connectors.startTunnelConnector("workspace");
  await new Promise((resolve) => setTimeout(resolve, 120));
  const afterDuplicateStart = (await readFile(log, "utf8")).trim().split("\n").length;
  assert.equal(afterDuplicateStart, beforeDuplicateStart, "starting a healthy desired connector is idempotent");

  const beforeRestart = (await readFile(log, "utf8")).trim().split("\n").length;
  connectors.restartTunnelConnector("workspace");
  await new Promise((resolve) => setTimeout(resolve, 350));
  const afterRestart = (await readFile(log, "utf8")).trim().split("\n").length;
  assert.equal(afterRestart, beforeRestart + 1, "a fast stop/start creates exactly one replacement after the shutting-down connector exits");

  connectors.restartTunnelConnector("workspace");
  connectors.stopTunnelConnector("workspace");
  await new Promise((resolve) => setTimeout(resolve, 350));
  const afterCancelledRestart = (await readFile(log, "utf8")).trim().split("\n").length;
  assert.equal(afterCancelledRestart, afterRestart, "stopping during a restart cancels the pending replacement");
});

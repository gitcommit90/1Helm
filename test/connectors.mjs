import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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

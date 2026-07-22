import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("stopping a connector cancels automatic relaunch while preserving its credentials", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "1helm-connector-test-"));
  const binary = join(root, "cloudflared");
  const log = join(root, "launches.log");
  await writeFile(binary, "#!/bin/sh\nprintf 'launch\\n' >> \"$HELM_CONNECTOR_TEST_LOG\"\nexit 1\n");
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
  await new Promise((resolve) => setTimeout(resolve, 140));
  const afterStop = (await readFile(log, "utf8")).trim().split("\n").length;
  assert.equal(afterStop, beforeStop, "disabled connector does not relaunch");
  assert.ok(connectors.connectorCredential("workspace"), "disabling leaves the reserved connector credential available for re-enable");
});

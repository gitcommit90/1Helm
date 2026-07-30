import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { createNativeUpdateService, publicError, releaseVersion } = require("../desktop/updater.cjs");

function harness({ packaged = true, inApplications = true, platform = "darwin", arch = "arm64" } = {}) {
  const calls = [];
  const autoUpdater = new EventEmitter();
  autoUpdater.setFeedURL = (value) => calls.push(["feed", value]);
  autoUpdater.checkForUpdates = () => calls.push(["check"]);
  autoUpdater.quitAndInstall = (...args) => calls.push(["install", args]);
  const app = {
    isPackaged: packaged,
    getVersion: () => "1.2.3",
    isInApplicationsFolder: () => inApplications,
  };
  const updater = createNativeUpdateService({ app, autoUpdater, platform, arch });
  return { app, autoUpdater, calls, updater };
}

test("native Mac updater owns check, download state, and restart installation", async () => {
  const { autoUpdater, calls, updater } = harness();
  assert.equal(updater.initialize(), true);
  assert.match(updater.feedUrl, /gitcommit90\/1Helm\/darwin-arm64\/1\.2\.3$/);
  assert.equal(updater.check().status, "checking");
  assert.deepEqual(calls.at(-1), ["check"]);
  autoUpdater.emit("update-available");
  assert.equal(updater.state().status, "downloading");
  autoUpdater.emit("update-downloaded", {}, "notes", "1Helm v1.2.4");
  assert.equal(updater.state().status, "ready");
  assert.equal(updater.state().version, "1.2.4");
  assert.equal(updater.install().status, "installing");
  assert.equal(calls.some(([name]) => name === "install"), false, "the host runtime must quiesce before replacement");
  assert.equal(updater.commitInstall(), true);
  assert.deepEqual(calls.at(-1), ["install", [false, true]]);
});

test("native Windows updater uses the host-owned win32-x64 feed", () => {
  const { updater } = harness({ platform: "win32", arch: "x64" });
  assert.equal(updater.initialize(), true);
  assert.equal(updater.state().mode, "native-windows");
  assert.match(updater.feedUrl, /gitcommit90\/1Helm\/win32-x64\/1\.2\.3$/);
});

test("native updater refuses unsupported placement and sanitizes errors", () => {
  const { updater, calls } = harness({ inApplications: false });
  assert.equal(updater.initialize(), false);
  assert.equal(updater.state().status, "unsupported");
  assert.match(updater.state().error, /Move 1Helm to Applications/);
  updater.check();
  assert.equal(calls.length, 0);
  assert.equal(releaseVersion("Version v2.3.4 is ready"), "2.3.4");
  assert.doesNotMatch(publicError(new Error("failed at https://secret.example/token now")), /secret\.example/);
});

test("Linux web action creates only a fixed host request and returns no installer URL", async (t) => {
  const appRoot = await mkdtemp(join(tmpdir(), "1helm-update-app-"));
  const dataDir = await mkdtemp(join(tmpdir(), "1helm-update-data-"));
  await writeFile(join(appRoot, "package.json"), JSON.stringify({ version: "1.2.3" }));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ tag_name: "v1.2.4", draft: false, prerelease: false }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  process.env.HELM_INSTALL_KIND = "linux-systemd";
  process.env.HELM_UPDATE_MANIFEST_URL = `http://127.0.0.1:${address.port}/latest`;
  const service = await import(`../src/server/updates.ts?test=${Date.now()}`);
  const available = await service.hostUpdateState(appRoot, dataDir);
  assert.equal(available.status, "available");
  assert.equal(available.version, "1.2.4");
  assert.equal("download_url" in available, false);
  const queued = await service.runHostUpdateAction(appRoot, dataDir, "download");
  assert.equal(queued.status, "queued");
  assert.equal(queued.mode, "linux-systemd");
  assert.equal("download_url" in queued, false);
  const request = JSON.parse(await readFile(join(dataDir, "host-update.request"), "utf8"));
  assert.equal(typeof request.requested_at, "number");
  assert.deepEqual(Object.keys(request), ["requested_at"]);
  await assert.rejects(() => service.runHostUpdateAction(appRoot, dataDir, "install"), /install automatically/i);
  await rm(join(dataDir, "host-update.request"));
  delete process.env.HELM_INSTALL_KIND;
  const managed = await service.hostUpdateState(appRoot, dataDir);
  assert.equal(managed.status, "managed");
  assert.match(managed.message, /will not send an installer to this browser/i);
});

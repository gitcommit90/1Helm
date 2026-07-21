import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitFor(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch { /* server is starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test("desktop entrypoint keeps the renderer sandboxed and data on the Mac", async () => {
  const source = await readFile(join(root, "desktop", "main.cjs"), "utf8");
  assert.match(source, /CTRL_DATA_DIR = app\.getPath\("userData"\)/);
  assert.match(source, /HELM_HOST = LOOPBACK/);
  assert.match(source, /contextIsolation: true/);
  assert.match(source, /nodeIntegration: false/);
  assert.match(source, /sandbox: true/);
  assert.match(source, /requestSingleInstanceLock/);
  assert.match(source, /setLoginItemSettings\(\{ openAtLogin: true, openAsHidden: true \}\)/);
  assert.match(source, /getLoginItemSettings\(\)\.wasOpenedAsHidden/);
  assert.match(source, /--1helm-background/);
  assert.match(source, /window-all-closed/);
  assert.match(source, /com\.gitcommit90\.1helm\.wake\.plist/);
  assert.match(source, /StartInterval/);
  assert.match(source, /HELM_INTERNAL_WAKE_TOKEN/);
  assert.match(source, /if \(!allowedLocalUrl\(details\.url\)\)/);
  assert.match(source, /process\.emit\("SIGTERM"/);
});

test("server can run from an immutable app root with state elsewhere on loopback", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "1helm-desktop-data-"));
  const foreignCwd = await mkdtemp(join(tmpdir(), "1helm-desktop-cwd-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(root, "src", "server", "index.ts")], {
    cwd: foreignCwd,
    env: {
      ...process.env,
      CTRL_DATA_DIR: dataDir,
      HELM_APP_ROOT: root,
      HELM_HOST: "127.0.0.1",
      PORT: String(port),
      HELM_ROUTER_PORT: String(await freePort()),
      IMPROVEMENT_INTERVAL_MS: "600000",
      THREAD_AUDIT_INTERVAL_MS: "600000",
      FOLLOWUP_INTERVAL_MS: "600000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  t.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => child.once("exit", resolveExit)),
      new Promise((resolveExit) => setTimeout(resolveExit, 3_000)),
    ]);
    await rm(dataDir, { recursive: true, force: true });
    await rm(foreignCwd, { recursive: true, force: true });
  });

  const status = await (await waitFor(`http://127.0.0.1:${port}/api/setup/status`)).json();
  assert.equal(status.needs_setup, true);
  assert.equal(status.has_users, false);
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /1Helm/);
  assert.match(logs, new RegExp(`http://127\\.0\\.0\\.1:${port}`));
});

test("release packaging is fail-closed and records stable product identity", async () => {
  const source = await readFile(join(root, "scripts", "package-mac-dmg.cjs"), "utf8");
  assert.match(source, /const APP_ID = "com\.gitcommit90\.1helm"/);
  assert.match(source, /const ARCH = "arm64"/);
  assert.match(source, /Release builds require APPLE_TEAM_ID and APPLE_NOTARY_PROFILE/);
  assert.match(source, /notarytool/);
  assert.match(source, /<signing-identity>/);
  assert.match(source, /<notary-profile>/);
  assert.doesNotMatch(source, /team \$\{TEAM_ID\}/);
  assert.match(source, /stapler/);
  assert.match(source, /Applications/);
  assert.match(source, /candidate\.dmg/);
  assert.match(source, /"--sign", "-", candidate/);
  assert.match(source, /Library\/Application Support\/1Helm/);
  assert.match(source, /installProductIcon/);
  assert.match(source, /CFBundleIconFile", "-string", "1Helm\.icns/);
  assert.match(source, /missing the 1Helm product icon/);
});

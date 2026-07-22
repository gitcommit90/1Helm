import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const packageVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;

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
  assert.match(source, /setLoginItemSettings\(\{ openAtLogin: true, type: "mainAppService" \}\)/);
  assert.match(source, /getLoginItemSettings\(\{ type: "mainAppService" \}\)/);
  assert.match(source, /login\.wasOpenedAtLogin/);
  assert.match(source, /window-all-closed/);
  assert.match(source, /com\.gitcommit90\.1helm\.wake\.plist/);
  assert.match(source, /removeLegacyWakeLaunchAgent\(\)/);
  assert.doesNotMatch(source, /StartInterval|launchctl", \["bootstrap"|ProgramArguments/, "1Helm migrates away from the legacy LaunchAgent that macOS attributes to the certificate publisher");
  assert.match(source, /if \(!allowedLocalUrl\(details\.url\)\)/);
  assert.match(source, /process\.emit\("SIGTERM"/);
  assert.match(source, /1helm-removal-prepared/);
  assert.match(source, /setLoginItemSettings\(\{ openAtLogin: false, type: "mainAppService" \}\)/, "uninstall preparation disables the Login Item so cleaned VMs are not recreated at next login");
  const updates = await readFile(join(root, "src", "server", "updates.ts"), "utf8");
  assert.match(updates, /demo\.1helm\.com\/api\/app\/update\/latest/);
  assert.match(updates, /AbortSignal\.timeout\(15_000\)/, "manual update checks time out instead of holding the local app open");
  assert.match(updates, /1Helm-\$\{latestVersion\}-arm64\.dmg/, "a release check resolves the exact Apple Silicon DMG when one is published");
  const server = await readFile(join(root, "src", "server", "index.ts"), "utf8");
  assert.match(server, /appUpdateStatus\(APP_ROOT\)/, "the local control plane owns the GitHub release check");
  const appClient = await readFile(join(root, "src", "client", "app.ts"), "utf8");
  assert.match(appClient, /Check for updates/);
  assert.match(appClient, /1Herd v\$\{update\.current_version\}/, "Profile displays the installed version beside the update control");
  const settingsClient = await readFile(join(root, "src", "client", "settings.ts"), "utf8");
  assert.match(settingsClient, /Prepare to remove 1Helm/);
  assert.match(settingsClient, /REMOVE 1HELM/, "full app removal requires an explicit typed confirmation before deleting owned VMs");
  assert.match(server, /prepareAppRemoval\(\)/, "the control plane performs and verifies the owned-VM cleanup before uninstall");
  assert.match(server, /process\.emit\("1helm-removal-prepared"\)/, "successful cleanup notifies the native shell to disable automatic relaunch");
  const helperInstall = await readFile(join(root, "scripts", "ensure-node-pty-helper.cjs"), "utf8");
  assert.match(helperInstall, /process\.platform === "darwin"/);
  assert.match(helperInstall, /chmodSync\(helper, 0o755\)/, "Mac installs restore node-pty's executable spawn helper before terminals open");
  const memoryRuntime = await readFile(join(root, "src", "server", "memory.ts"), "utf8");
  assert.match(memoryRuntime, /assert mnemosyne\.__version__/);
  assert.match(memoryRuntime, /--ignore-requires-python/);
  assert.match(memoryRuntime, /rmSync\(venv, \{ recursive: true, force: true \}\)/, "an invalid partial app-managed memory venv is repaired without touching agent databases");
  assert.match(memoryRuntime, /process\.platform === "darwin" \? \["\/usr\/bin\/python3"\]/, "macOS retries its bundled Python when a preferred interpreter cannot create the app-managed memory runtime");
  const memoryBridge = await readFile(join(root, "scripts", "mnemosyne-bridge.py"), "utf8");
  assert.match(memoryBridge, /sys\.version_info < \(3, 10\)/);
  assert.match(memoryBridge, /zip_longest/);
  assert.match(memoryBridge, /different lengths/, "the Python 3.9 bridge preserves strict zip length checking");
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
  const updateManifest = await (await fetch(`http://127.0.0.1:${port}/api/app/update/latest`)).json();
  assert.equal(updateManifest.version, packageVersion, "the public update manifest reports this exact desktop build version");
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /1Helm/);
  assert.match(logs, new RegExp(`http://127\\.0\\.0\\.1:${port}`));
});

test("release packaging is fail-closed and records stable product identity", async () => {
  const source = await readFile(join(root, "scripts", "package-mac-dmg.cjs"), "utf8");
  const suppliedMacosIcon = join(root, "desktop", "icons", "1helm-macos-app-logo.jpg");
  const iconRoot = await mkdtemp(join(tmpdir(), "1helm-macos-icon-test-"));
  const macosIcon = join(iconRoot, "1helm-macos-app-logo.jpg");
  await copyFile(suppliedMacosIcon, macosIcon);
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
  assert.match(source, /Library\/LaunchAgents/, "release packaging rejects legacy background-agent payloads");
  assert.match(source, /Library\/Application Support\/1Helm/);
  assert.match(source, /installProductIcon/);
  assert.match(source, /desktop", "icons", "1helm-macos-app-logo\.jpg/);
  assert.match(source, /"--setProperty", "format", "png"/, "JPEG app artwork is converted to real PNG iconset members before iconutil runs");
  try {
    assert.ok((await stat(macosIcon)).size > 0, "the dedicated macOS app-icon artwork is present for ICNS generation");
  } finally {
    await rm(iconRoot, { recursive: true, force: true });
  }
  assert.match(source, /CFBundleIconFile", "-string", "1Helm\.icns/);
  assert.match(source, /missing the 1Helm product icon/);
});

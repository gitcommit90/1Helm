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
  const appClient = await readFile(join(root, "src", "client", "app.ts"), "utf8");
  assert.match(source, /CTRL_DATA_DIR = app\.getPath\("userData"\)/);
  assert.match(source, /HELM_HOST = LOOPBACK/);
  assert.match(source, /contextIsolation: true/);
  assert.match(source, /nodeIntegration: false/);
  assert.match(source, /sandbox: true/);
  assert.match(source, /frame-src 'self' blob:/, "the Electron renderer permits only same-origin and blob frames for safe PDF preview");
  assert.match(source, /media-src 'self' blob:/, "the Electron renderer permits only same-origin and blob media for safe audio/video preview");
  assert.match(source, /HELM_RESOURCES_PATH = process\.resourcesPath/, "the local runtime resolves the connector bundled in the signed app");
  assert.match(source, /allowedTeamUrl/);
  assert.match(source, /url\.protocol === "https:"/);
  assert.match(source, /\^mailto:build@1helm\\\.com\$/i, "the company email opens only through the exact external mail link allowlist");
  assert.match(source, /\.1helm\\\.com/);
  assert.match(source, /!\["demo\.1helm\.com", "provision\.1helm\.com"\]\.includes/, "only exact customer workspace subdomains may load inside the sandboxed renderer");
  assert.match(source, /remoteWorkspacePath/);
  assert.match(source, /preferredWorkspaceOrigin\(\)/, "the app remembers a selected team workspace while its own local headless runtime keeps running");
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
  assert.match(updates, /api\.github\.com\/repos\/\$\{UPDATE_REPOSITORY\}\/releases\/latest/);
  assert.match(updates, /AbortSignal\.timeout\(15_000\)/, "manual update checks time out instead of holding the local app open");
  assert.match(updates, /HELM_INSTALL_KIND === "linux-systemd"/, "standard Linux installs use the host system updater");
  assert.match(updates, /host-update\.request/, "the web control plane can only request the fixed host updater action");
  const server = await readFile(join(root, "src", "server", "index.ts"), "utf8");
  assert.match(server, /hostUpdateState\(APP_ROOT, DATA_DIR\)/, "the local control plane owns host update state");
  assert.match(server, /runHostUpdateAction\(APP_ROOT, DATA_DIR, action\)/, "the local control plane invokes a constrained host action");
  assert.match(appClient, /Check for updates/);
  assert.match(appClient, /1Helm v\$\{update\.current_version\}/, "Profile displays the installed version beside the update control");
  assert.match(appClient, /Download on host/, "Profile makes native download ownership explicit");
  assert.match(appClient, /Restart & install/, "Profile installs only after the host reports a verified update ready");
  assert.doesNotMatch(appClient, /window\.open\(target/, "updating never navigates the browsing device to a host installer");
  const nativeUpdater = await readFile(join(root, "desktop", "updater.cjs"), "utf8");
  assert.match(nativeUpdater, /autoUpdater\.checkForUpdates\(\)/);
  assert.match(nativeUpdater, /autoUpdater\.quitAndInstall\(false, true\)/);
  assert.match(source, /1helm-native-update-ready/, "Electron replaces the app only after the local host runtime has quiesced");
  assert.match(server, /shutdown\(true\).*1helm-native-update-ready/s, "the host update API closes server work before handing installation back to Electron");
  assert.match(server, /\["native-macos", "native-windows"\]\.includes\(update\.mode\)/, "both packaged host updaters quiesce the local server before replacement");
  assert.match(nativeUpdater, /update\.electronjs\.org\/gitcommit90\/1Helm\/\$\{feedPlatform\}/);
  assert.match(nativeUpdater, /win32-x64/, "Windows checks and installs on its host through the native updater");
  assert.match(source, /handleSquirrelEvent/);
  assert.match(source, /setAppUserModelId\("com\.squirrel\.1Helm\.1Helm"\)/, "Windows uses Squirrel's stable taskbar identity");
  assert.match(source, /windows-removal\.cjs/, "Windows uninstall invokes ownership-checked WSL cleanup before removing shortcuts");
  const onboardingClient = await readFile(join(root, "src", "client", "onboarding.ts"), "utf8");
  const clientApi = await readFile(join(root, "src", "client", "api.ts"), "utf8");
  const publicIndex = await readFile(join(root, "public", "index.html"), "utf8");
  const webManifest = await readFile(join(root, "public", "manifest.webmanifest"), "utf8");
  const serviceWorker = await readFile(join(root, "public", "sw.js"), "utf8");
  const brandSurfaces = [appClient, onboardingClient, clientApi, publicIndex, webManifest, serviceWorker].join("\n");
  assert.match(brandSurfaces, /1helm-sailboat/, "the bridge, onboarding, workspace, favicon, and installable web app use the sailboat artwork");
  assert.doesNotMatch(brandSurfaces, /brand\/1helm\.png|icons\/icon-(?:192|512)|icon\.svg/, "retired web artwork is not referenced by any brand surface");
  await assert.rejects(stat(join(root, "public", "brand", "1helm.png")), { code: "ENOENT" }, "the retired numeral artwork is removed from the release");
  const brandGenerator = await readFile(join(root, "scripts", "generate-brand-assets.cjs"), "utf8");
  assert.match(brandGenerator, /desktop[\"', ]+.*icons[\"', ]+.*1helm-macos-app-logo\.jpg/s, "web brand assets are derived from the established sailboat app artwork");
  const settingsClient = await readFile(join(root, "src", "client", "settings.ts"), "utf8");
  assert.match(settingsClient, /Prepare to remove 1Helm/);
  assert.match(settingsClient, /REMOVE 1HELM/, "full app removal requires an explicit typed confirmation before deleting owned VMs");
  assert.match(server, /prepareAppRemoval\(\)/, "the control plane performs and verifies the owned-VM cleanup before uninstall");
  assert.match(server, /process\.emit\("1helm-removal-prepared"\)/, "successful cleanup notifies the native shell to disable automatic relaunch");
  const channelComputers = await readFile(join(root, "src", "server", "channel-computers.ts"), "utf8");
  assert.match(channelComputers, /\["machine", "delete", computer\.machine_id\]/, "uninstall cleanup uses Apple's complete machine deletion operation");
  assert.match(channelComputers, /printf '\[automount\]/, "private WSL distros disable Windows-drive automount");
  assert.match(channelComputers, /! findmnt -rn \/mnt\/c[\s\S]*rmdir \/mnt\/c \/mnt\/d[\s\S]*test ! -e \/mnt\/c/, "WSL removes only inert drive mountpoint directories after proving they are not mounted");
  assert.match(channelComputers, /test ! -e \/mnt\/c/, "WSL provisioning verifies the host C drive is not visible");
  const windowsPackager = await readFile(join(root, "scripts", "package-windows.cjs"), "utf8");
  const macPackager = await readFile(join(root, "scripts", "package-mac-dmg.cjs"), "utf8");
  const windowsRemoval = await readFile(join(root, "scripts", "windows-removal.cjs"), "utf8");
  const windowsRuntime = await readFile(join(root, "scripts", "install-wsl-runtime.ps1"), "utf8");
  assert.match(windowsPackager, /HELM_REQUIRE_WINDOWS_SIGNATURE/);
  assert.match(windowsPackager, /require\("png-to-ico"\)\.default/, "Windows packaging uses the module's CommonJS default export");
  assert.match(windowsPackager, /1Helm-\$\{VERSION\}-windows-x64-setup\.exe/);
  assert.match(windowsPackager, /win32-x64/);
  assert.match(windowsPackager, /path\.join\(DIST, "RELEASES"\)/, "the GitHub asset keeps Squirrel's required literal RELEASES name");
  assert.match(windowsPackager, /path\.join\(DIST, path\.basename\(nupkg\)\)/, "the uploaded package keeps the exact basename referenced by RELEASES");
  assert.match(windowsPackager, /signPackagedExecutables\(appDir\)/, "release signing covers nested Windows executables before packaging");
  for (const [source, requiredPaths] of [
    [windowsPackager, ["/scripts", "/scripts/mnemosyne-bridge.py", "/scripts/install-wsl-runtime.ps1", "/scripts/windows-removal.cjs"]],
    [macPackager, ["/scripts", "/scripts/mnemosyne-bridge.py"]],
  ]) {
    const literal = source.match(/const IGNORE_NON_RUNTIME_ROOTS\s*=\s*(\/\^[^;]+\/);/)?.[1];
    assert.ok(literal, "desktop packager exposes a testable runtime-root filter");
    const filter = Function(`"use strict"; return (${literal})`)();
    for (const requiredPath of requiredPaths) assert.equal(filter.test(requiredPath), false, `${requiredPath} survives desktop packaging`);
    assert.equal(filter.test("/scripts/release-only-helper.cjs"), true, "non-runtime release helpers stay outside the desktop app");
    assert.equal(filter.test("/test"), true, "tests stay outside the desktop app");
  }
  assert.match(windowsRemoval, /installation_id/);
  assert.match(windowsRemoval, /ctrl-pane\.db/, "Windows removal reads the real durable 1Helm database");
  assert.doesNotMatch(windowsRemoval, /helm\.sqlite/);
  assert.match(windowsRemoval, /--unregister/);
  assert.match(channelComputers, /"--exec", \.\.\.args/, "WSL executes argv directly so shell variables reach the requested Bash process unchanged");
  assert.match(windowsRemoval, /"--exec", "\/bin\/cat"/, "Windows removal checks ownership without an intervening WSL shell");
  assert.match(windowsRuntime, /VirtualMachinePlatform/);
  assert.match(windowsRuntime, /2\.7\.10\.0/);
  assert.match(windowsRuntime, /github\.com\/microsoft\/WSL\/releases\/download\/2\.7\.10\/wsl\.2\.7\.10\.0\.x64\.msi/);
  assert.match(windowsRuntime, /1a62f90a43c03cc5bda47dfd0b6faf496ac70fd4389190518120a4f84fc895cf/);
  assert.match(windowsRuntime, /Get-AuthenticodeSignature/);
  assert.match(windowsRuntime, /CN=Microsoft Corporation/);
  assert.match(windowsRuntime, /msiexec\.exe/);
  assert.match(windowsRuntime, /--set-default-version 2/);
  assert.doesNotMatch(windowsRuntime, /--update/);
  const helperInstall = await readFile(join(root, "scripts", "ensure-node-pty-helper.cjs"), "utf8");
  assert.match(helperInstall, /process\.platform === "darwin"/);
  assert.match(helperInstall, /chmodSync\(helper, 0o755\)/, "Mac installs restore node-pty's executable spawn helper before terminals open");
  const memoryRuntime = await readFile(join(root, "src", "server", "memory.ts"), "utf8");
  const testRunner = await readFile(join(root, "scripts", "run-test-suite.mjs"), "utf8");
  const feedbackBrowser = await readFile(join(root, "test", "feedback-browser.mjs"), "utf8");
  const terminalBrowser = await readFile(join(root, "test", "terminal-reconnect-browser.mjs"), "utf8");
  assert.match(memoryRuntime, /assert mnemosyne\.__version__/);
  assert.match(memoryRuntime, /\["recall", "recall_transcript"\][\s\S]*MNEMOSYNE_POLYPHONIC_RECALL: "1"/, "semantic recall enables Mnemosyne's supported vector-capable retrieval mode");
  assert.match(memoryRuntime, /--ignore-requires-python/);
  assert.match(memoryRuntime, /rmSync\(venv, \{ recursive: true, force: true \}\)/, "an invalid partial app-managed memory venv is repaired without touching agent databases");
  assert.match(memoryRuntime, /process\.platform === "darwin" \? \["\/usr\/bin\/python3"\]/, "macOS retries its bundled Python when a preferred interpreter cannot create the app-managed memory runtime");
  assert.match(memoryRuntime, /export function prepareMnemosyneRuntime\(\): Promise<boolean>/, "fresh-host memory installation is asynchronous instead of blocking application startup");
  assert.match(memoryRuntime, /export function cancelMnemosyneRuntimePreparation\(\)/, "host shutdown cancels an in-flight app-managed memory installation");
  assert.match(testRunner, /MNEMOSYNE_PYTHON: runtime/, "the full test suite shares one explicit pinned memory runtime instead of racing app-start installers");
  assert.match(testRunner, /if \(existsSync\(venv\)\) rmSync\(venv, \{ recursive: true, force: true \}\);[\s\S]*spawnSync\(installer/, "each test-runtime fallback starts clean after a preferred Python leaves a partial venv");
  assert.match(feedbackBrowser, /skip: executablePath \? false :/, "the Feedback browser contract does not hang a Chrome-free release runner");
  assert.match(await readFile(join(root, "src", "client", "app.ts"), "utf8"), /mailto:build@1helm\.com/, "the in-app Feedback surface exposes the company contact address");
  assert.match(terminalBrowser, /HELM_CHANNEL_COMPUTER_BACKEND: "native"/, "the terminal browser contract uses the explicit development backend on CI hosts without an installed LXC runtime");
  const serverRuntime = await readFile(join(root, "src", "server", "index.ts"), "utf8");
  assert.match(serverRuntime, /const memoryRuntime = prepareMnemosyneRuntime\(\);[\s\S]*server\.listen\([\s\S]*memoryRuntime\.then/, "the HTTP server becomes ready before optional memory installation and initializes agent databases afterward");
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
  assert.match(source, /mac-\$\{ARCH\}\.candidate\.zip/, "release packaging creates a distinct native updater candidate");
  assert.match(source, /Creating the native updater ZIP from the notarized and stapled app/);
  assert.match(source, /verifyApp\(extractedApp, true\)/, "the extracted updater app passes signature, ticket, and Gatekeeper checks");
  assert.match(source, /"--sign", "-", candidate/);
  assert.match(source, /Library\/LaunchAgents/, "release packaging rejects legacy background-agent payloads");
  assert.match(source, /\/AGENTS\\\.md\$/, "release packaging excludes dependency instruction files before signing");
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
  assert.match(source, /NSMicrophoneUsageDescription/, "the signed macOS bundle explains opt-in speech-to-text microphone use");
  assert.match(source, /missing the 1Helm product icon/);
  assert.match(source, /const CLOUDFLARED_VERSION = "2026\.3\.0"/);
  assert.match(source, /2aae4f69b0fc1c671b8353b4f594cbd902cd1e360c8eed2b8cad4602cb1546fb/);
  assert.match(source, /633cee0fd41fd2020e17498beecc54811bf4fc99f891c080dc9343eb0f449c60/);
  assert.match(source, /Cloudflared binary checksum does not match the release pin/, "release packaging verifies the exact upstream tunnel connector before signing");
  assert.match(source, /codesign", \["--verify", "--strict", "--verbose=2", cloudflared\]/, "release packaging verifies the bundled connector's post-signing seal");
});

"use strict";

const { app, autoUpdater, BrowserWindow, dialog, shell, session, systemPreferences } = require("electron");
const { createServer } = require("node:net");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { createNativeUpdateService } = require("./updater.cjs");
const { allowedRemoteUrl, desktopGatewayAction, isHostedWorkspaceOrigin, normalizeRemoteOrigin } = require("./workspace-target.cjs");

const LOOPBACK = "127.0.0.1";
// The OCI architecture is an intentional clean start. Keep the retired
// installation's Application Support/AppData tree untouched and never import
// it implicitly into this runtime generation.
const DATA_NAMESPACE = "1Helm-OCI-v1";
app.setPath("userData", path.join(app.getPath("appData"), DATA_NAMESPACE));
let mainWindow = null;
let authWindow = null;
let localOrigin = "";
let quitting = false;
let hostUpdateService = null;
const remoteWorkspacePath = () => path.join(app.getPath("userData"), "remote-workspace");
const desktopModePath = () => path.join(app.getPath("userData"), "desktop-mode");
const localDatabasePath = () => path.join(app.getPath("userData"), "ctrl-pane.db");

function desktopMode() {
  try {
    const mode = fs.readFileSync(desktopModePath(), "utf8").trim();
    if (["client", "server"].includes(mode)) return mode;
  } catch { /* older installations have no explicit mode */ }
  if (fs.existsSync(remoteWorkspacePath())) return "client";
  if (fs.existsSync(localDatabasePath())) return "server";
  return "choose";
}

function rememberDesktopMode(mode) {
  if (!["client", "server"].includes(mode)) return;
  fs.writeFileSync(desktopModePath(), `${mode}\n`, { mode: 0o600 });
}

function handleSquirrelEvent() {
  if (process.platform !== "win32") return false;
  const event = process.argv[1];
  if (!["--squirrel-install", "--squirrel-updated", "--squirrel-uninstall", "--squirrel-obsolete"].includes(event)) return false;
  const appFolder = path.resolve(process.execPath, "..");
  const updateExe = path.resolve(appFolder, "..", "Update.exe");
  const exe = path.basename(process.execPath);
  if (event === "--squirrel-install" || event === "--squirrel-updated") {
    spawnSync(updateExe, ["--createShortcut", exe], { stdio: "ignore", windowsHide: true });
  } else if (event === "--squirrel-uninstall") {
    const dataRoot = app.getPath("userData");
    const wslRoot = path.join(String(process.env.LOCALAPPDATA || ""), "1Helm-Runtime");
    const cleanup = path.resolve(__dirname, "..", "scripts", "windows-removal.cjs");
    spawnSync(process.execPath, [cleanup, dataRoot, wslRoot], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "ignore", windowsHide: true, timeout: 10 * 60_000 });
    spawnSync(updateExe, ["--removeShortcut", exe], { stdio: "ignore", windowsHide: true });
  }
  setTimeout(() => app.quit(), 1000);
  return true;
}

function preferredWorkspaceOrigin() {
  if (desktopMode() !== "client") return localOrigin;
  try {
    const value = fs.readFileSync(remoteWorkspacePath(), "utf8").trim();
    return normalizeRemoteOrigin(value);
  } catch {
    return "";
  }
}

function rememberTeamUrl(raw) {
  const origin = normalizeRemoteOrigin(raw);
  if (!origin) return;
  fs.writeFileSync(remoteWorkspacePath(), origin + "\n", { mode: 0o600 });
  rememberDesktopMode("client");
}

process.on("1helm-removal-prepared", () => {
  // Prevent a cleaned installation from relaunching at login and recreating
  // its channel VMs before the user moves the app to Trash.
  app.setLoginItemSettings({ openAtLogin: false, type: "mainAppService" });
});

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, LOOPBACK, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(origin, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/setup/status`);
      if (response.ok) return;
      lastError = new Error(`1Helm returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error("1Helm did not become ready in time.");
}

async function startLocalRuntime() {
  const appRoot = app.getAppPath();
  const port = await freePort();
  process.env.HELM_DESKTOP = "1";
  process.env.HELM_APP_ROOT = appRoot;
  process.env.HELM_RESOURCES_PATH = process.resourcesPath;
  process.env.HELM_HOST = LOOPBACK;
  process.env.PORT = String(port);
  process.env.CTRL_DATA_DIR = app.getPath("userData");
  if (process.platform !== "win32") process.env.SHELL ||= "/bin/zsh";
  process.env.HELM_INTERNAL_WAKE_TOKEN ||= crypto.randomBytes(32).toString("hex");
  process.chdir(appRoot);
  localOrigin = `http://${LOOPBACK}:${port}`;
  await import(pathToFileURL(path.join(appRoot, "src", "server", "index.ts")).href);
  await waitForServer(localOrigin);
}

function removeLegacyWakeLaunchAgent() {
  if (process.platform !== "darwin") return;
  const plistPath = path.join(app.getPath("home"), "Library", "LaunchAgents", "com.gitcommit90.1helm.wake.plist");
  const domain = `gui/${process.getuid()}`;
  spawnSync("/bin/launchctl", ["bootout", `${domain}/com.gitcommit90.1helm.wake`], { stdio: "ignore" });
  try { fs.unlinkSync(plistPath); } catch { /* absent */ }
}

function keepSkipperAvailable() {
  // The signed main app appears under its 1Helm app identity and icon in Login
  // Items. The separately registered legacy LaunchAgent was the component
  // macOS exposed as software from the certificate publisher.
  app.setLoginItemSettings({ openAtLogin: true, type: "mainAppService" });
}

function stopAutomaticServerStartup() {
  app.setLoginItemSettings({ openAtLogin: false, type: "mainAppService" });
}

function prepareWindowsWslDataRoot() {
  if (process.platform !== "win32") return;
  // One installation-scoped virtual disk stays outside the replaceable app.
  fs.mkdirSync(path.join(String(process.env.LOCALAPPDATA || ""), "1Helm-Runtime"), { recursive: true });
}

function allowedLocalUrl(raw) {
  try {
    const url = new URL(raw);
    return url.origin === localOrigin && ["http:", "ws:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function allowedTeamUrl(raw) {
  return allowedRemoteUrl(raw, preferredWorkspaceOrigin() === localOrigin ? "" : preferredWorkspaceOrigin());
}

const allowedAppUrl = (raw) => allowedLocalUrl(raw) || allowedTeamUrl(raw);

async function connectRemoteWorkspace(window, origin) {
  try {
    const response = await fetch(`${origin}/api/mobile/compatibility`, { signal: AbortSignal.timeout(15_000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.product !== "1Helm" || result.mobile_api !== 1) throw new Error("That address is not a compatible 1Helm instance.");
    if (!result.has_users || !result.setup_complete) throw new Error("Finish setting up this 1Helm instance before connecting the app.");
    rememberTeamUrl(origin);
    await window.loadURL(origin);
  } catch (error) {
    await loadDesktopGateway(window, { origin, error: error instanceof Error ? error.message : "Could not connect to this instance." });
  }
}

function loadDesktopGateway(window, state = {}) {
  return window.loadFile(path.join(__dirname, "gateway.html"), { query: {
    ...(state.origin ? { origin: state.origin, custom: isHostedWorkspaceOrigin(state.origin) ? "0" : "1" } : {}),
    ...(state.error ? { error: state.error } : {}),
  } });
}

async function loadInitialWorkspace(window) {
  const mode = desktopMode();
  if (mode === "server" || process.platform === "linux") { await window.loadURL(localOrigin); return; }
  if (mode === "client") {
    const preferred = preferredWorkspaceOrigin();
    if (preferred) { await window.loadURL(preferred); return; }
  }
  await loadDesktopGateway(window);
}

async function startServerMode(window) {
  try {
    keepSkipperAvailable();
    prepareWindowsWslDataRoot();
    if (!localOrigin) await startLocalRuntime();
    rememberDesktopMode("server");
    hostUpdateService?.schedule();
    await window.loadURL(localOrigin);
  } catch (error) {
    stopAutomaticServerStartup();
    await dialog.showMessageBox({
      type: "error",
      title: "1Helm could not start",
      message: `The local 1Helm runtime could not start on this ${process.platform === "win32" ? "Windows PC" : "Mac"}.`,
      detail: error instanceof Error ? error.stack || error.message : String(error),
    });
    await loadDesktopGateway(window, { error: "This PC could not start its local 1Helm server." });
  }
}

function microphonePermissionAllowed(webContents, permission, details = {}) {
  const pageUrl = webContents?.getURL?.() || "";
  if (permission !== "media" || !allowedAppUrl(pageUrl)) return false;
  const mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
  return mediaTypes.length === 0 || (mediaTypes.includes("audio") && !mediaTypes.includes("video"));
}

function openAuthWindow(url) {
  if (authWindow && !authWindow.isDestroyed()) authWindow.close();
  const window = new BrowserWindow({
    width: 1040,
    height: 780,
    parent: mainWindow || undefined,
    title: "Connect to 1Helm",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const returnToApp = (event, nextUrl) => {
    if (!allowedAppUrl(nextUrl)) return;
    event.preventDefault();
    void mainWindow?.loadURL(nextUrl);
    window.close();
    mainWindow?.show();
    mainWindow?.focus();
  };
  window.webContents.on("will-navigate", returnToApp);
  window.webContents.on("will-redirect", returnToApp);
  window.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (/^https?:/i.test(nextUrl) || /^mailto:build@1helm\.com$/i.test(nextUrl)) void shell.openExternal(nextUrl);
    return { action: "deny" };
  });
  window.on("closed", () => { if (authWindow === window) authWindow = null; });
  void window.loadURL(url);
  authWindow = window;
}

function createWindow(showWhenReady = true) {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 820,
    minHeight: 600,
    show: false,
    backgroundColor: "#08090c",
    title: "1Helm",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedAppUrl(url)) return { action: "allow" };
    if (/^https?:/i.test(url) || /^mailto:build@1helm\.com$/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const gatewayAction = desktopGatewayAction(url);
    if (gatewayAction) {
      event.preventDefault();
      if (gatewayAction.type === "setup") void startServerMode(window);
      else void connectRemoteWorkspace(window, gatewayAction.origin);
      return;
    }
    if (allowedTeamUrl(url)) { rememberTeamUrl(url); return; }
    if (allowedLocalUrl(url)) return;
    event.preventDefault();
    // The legacy OpenRouter PKCE flow performs a full-page navigation and
    // needs the same Electron session on return so its verifier survives.
    if (/^https?:/i.test(url)) openAuthWindow(url);
  });
  if (showWhenReady) window.once("ready-to-show", () => window.show());
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  void loadInitialWorkspace(window);
  mainWindow = window;
}

if (handleSquirrelEvent()) {
  // Squirrel install/update/uninstall work must exit before the application
  // acquires its normal single-instance lock or starts the local server.
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes("--1helm-background")) return;
    if (!mainWindow) createWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId("com.squirrel.1Helm.1Helm");
    session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => microphonePermissionAllowed(webContents, permission, details));
    session.defaultSession.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
      if (!microphonePermissionAllowed(webContents, permission, details)) { callback(false); return; }
      if (process.platform !== "darwin") { callback(true); return; }
      try { callback(await systemPreferences.askForMediaAccess("microphone")); }
      catch { callback(false); }
    });
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (!allowedLocalUrl(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss: https:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'",
          ],
        },
      });
    });
    try {
      removeLegacyWakeLaunchAgent();
      hostUpdateService = createNativeUpdateService({ app, autoUpdater });
      hostUpdateService.initialize();
      globalThis[Symbol.for("1helm.nativeUpdater")] = {
        state: hostUpdateService.state,
        check: hostUpdateService.check,
        install: hostUpdateService.install,
      };
      process.on("1helm-native-update-ready", () => { hostUpdateService?.commitInstall(); });
      const mode = desktopMode();
      if (mode === "server" || process.platform === "linux") {
        keepSkipperAvailable();
        prepareWindowsWslDataRoot();
        await startLocalRuntime();
        hostUpdateService.schedule();
      } else {
        stopAutomaticServerStartup();
      }
      const login = app.getLoginItemSettings({ type: "mainAppService" });
      createWindow(!login.wasOpenedAtLogin && !process.argv.includes("--1helm-background"));
    } catch (error) {
      await dialog.showMessageBox({
        type: "error",
        title: "1Helm could not start",
        message: `The local 1Helm runtime could not start on this ${process.platform === "win32" ? "Windows PC" : "Mac"}.`,
        detail: error instanceof Error ? error.stack || error.message : String(error),
      });
      app.quit();
    }
  });

  app.on("activate", () => { if (!mainWindow) createWindow(); });
  app.on("window-all-closed", () => {
    // On macOS 1Helm remains the native scheduler/fleet manager until Cmd-Q.
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    hostUpdateService?.stop();
    if (quitting) return;
    quitting = true;
    // Explicit Quit is respected; the signed main-app login service starts the
    // local control plane hidden again at the next user login.
    if (localOrigin) process.emit("SIGTERM", "SIGTERM");
  });
}

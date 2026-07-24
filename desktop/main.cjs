"use strict";

const { app, autoUpdater, BrowserWindow, dialog, shell, session } = require("electron");
const { createServer } = require("node:net");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { createNativeUpdateService } = require("./updater.cjs");

const LOOPBACK = "127.0.0.1";
let mainWindow = null;
let authWindow = null;
let localOrigin = "";
let quitting = false;
let hostUpdateService = null;
const remoteWorkspacePath = () => path.join(app.getPath("userData"), "remote-workspace");

function preferredWorkspaceOrigin() {
  try {
    const value = fs.readFileSync(remoteWorkspacePath(), "utf8").trim();
    return allowedTeamUrl(value) ? new URL(value).origin : localOrigin;
  } catch {
    return localOrigin;
  }
}

function rememberTeamUrl(raw) {
  if (!allowedTeamUrl(raw)) return;
  fs.writeFileSync(remoteWorkspacePath(), new URL(raw).origin + "\n", { mode: 0o600 });
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
  process.env.SHELL ||= "/bin/zsh";
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

function allowedLocalUrl(raw) {
  try {
    const url = new URL(raw);
    return url.origin === localOrigin && ["http:", "ws:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function allowedTeamUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?\.1helm\.com$/i.test(url.hostname) && !["demo.1helm.com", "provision.1helm.com"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const allowedAppUrl = (raw) => allowedLocalUrl(raw) || allowedTeamUrl(raw);

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
    if (/^https?:/i.test(nextUrl)) void shell.openExternal(nextUrl);
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
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (allowedTeamUrl(url)) { rememberTeamUrl(url); return; }
    if (allowedLocalUrl(url)) return;
    event.preventDefault();
    // The legacy OpenRouter PKCE flow performs a full-page navigation and
    // needs the same Electron session on return so its verifier survives.
    if (/^https?:/i.test(url)) openAuthWindow(url);
  });
  if (showWhenReady) window.once("ready-to-show", () => window.show());
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  void window.loadURL(preferredWorkspaceOrigin());
  mainWindow = window;
}

if (!app.requestSingleInstanceLock()) {
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
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
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
      keepSkipperAvailable();
      hostUpdateService = createNativeUpdateService({ app, autoUpdater });
      hostUpdateService.initialize();
      globalThis[Symbol.for("1helm.nativeUpdater")] = {
        state: hostUpdateService.state,
        check: hostUpdateService.check,
        install: hostUpdateService.install,
      };
      process.on("1helm-native-update-ready", () => { hostUpdateService?.commitInstall(); });
      await startLocalRuntime();
      hostUpdateService.schedule();
      const login = app.getLoginItemSettings({ type: "mainAppService" });
      createWindow(!login.wasOpenedAtLogin && !process.argv.includes("--1helm-background"));
    } catch (error) {
      await dialog.showMessageBox({
        type: "error",
        title: "1Helm could not start",
        message: "The local 1Helm runtime could not start on this Mac.",
        detail: error instanceof Error ? error.stack || error.message : String(error),
      });
      app.quit();
    }
  });

  app.on("activate", () => { if (!mainWindow && localOrigin) createWindow(); });
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
    process.emit("SIGTERM", "SIGTERM");
  });
}

"use strict";

const { app, BrowserWindow, dialog, shell, session } = require("electron");
const { createServer } = require("node:net");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const LOOPBACK = "127.0.0.1";
let mainWindow = null;
let authWindow = null;
let localOrigin = "";
let quitting = false;

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

function installWakeLaunchAgent() {
  if (process.platform !== "darwin") return;
  const agentsDir = path.join(app.getPath("home"), "Library", "LaunchAgents");
  const plistPath = path.join(agentsDir, "com.gitcommit90.1helm.wake.plist");
  const xmlEscape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  // Launch the signed 1Helm executable directly. macOS now presents 1Helm—not
  // the generic /bin/sh interpreter—as the background item. A running app's
  // single-instance lock makes this a cheap no-op; a stopped app wakes hidden.
  const executable = process.execPath;
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '<key>Label</key><string>com.gitcommit90.1helm.wake</string>',
    '<key>ProgramArguments</key><array>',
    `<string>${xmlEscape(executable)}</string>`, '<string>--1helm-background</string>',
    '</array>',
    '<key>StartInterval</key><integer>60</integer>',
    '<key>RunAtLoad</key><true/>',
    '<key>ProcessType</key><string>Background</string>',
    '</dict></plist>',
  ].join("\n");
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(plistPath, plist, { mode: 0o600 });
  fs.chmodSync(plistPath, 0o600);
  // Refresh the job on every boot because the loopback port and local wake
  // token are intentionally ephemeral. A failed bootout only means there was
  // no prior instance; bootstrap itself must succeed.
  const domain = `gui/${process.getuid()}`;
  spawnSync("/bin/launchctl", ["bootout", `${domain}/com.gitcommit90.1helm.wake`], { stdio: "ignore" });
  const loaded = spawnSync("/bin/launchctl", ["bootstrap", domain, plistPath], { encoding: "utf8" });
  if (loaded.status !== 0) throw new Error(`Could not install 1Helm's native wake scheduler: ${(loaded.stderr || loaded.stdout || "launchctl bootstrap failed").trim()}`);
}

function removeWakeLaunchAgent() {
  if (process.platform !== "darwin") return;
  const plistPath = path.join(app.getPath("home"), "Library", "LaunchAgents", "com.gitcommit90.1helm.wake.plist");
  const domain = `gui/${process.getuid()}`;
  spawnSync("/bin/launchctl", ["bootout", `${domain}/com.gitcommit90.1helm.wake`], { stdio: "ignore" });
  try { fs.unlinkSync(plistPath); } catch { /* absent */ }
}

function keepSkipperAvailable() {
  // Scheduling and fleet care are native control-plane responsibilities. The
  // window may be closed while Skipper continues to wake channel computers.
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
}

function allowedLocalUrl(raw) {
  try {
    const url = new URL(raw);
    return url.origin === localOrigin && ["http:", "ws:"].includes(url.protocol);
  } catch {
    return false;
  }
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
    if (!allowedLocalUrl(nextUrl)) return;
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
    if (allowedLocalUrl(url)) return { action: "allow" };
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (allowedLocalUrl(url)) return;
    event.preventDefault();
    // The legacy OpenRouter PKCE flow performs a full-page navigation and
    // needs the same Electron session on return so its verifier survives.
    if (/^https?:/i.test(url)) openAuthWindow(url);
  });
  if (showWhenReady) window.once("ready-to-show", () => window.show());
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  void window.loadURL(localOrigin);
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
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' ws: wss: https:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
          ],
        },
      });
    });
    try {
      keepSkipperAvailable();
      await startLocalRuntime();
      installWakeLaunchAgent();
      // A login-item launch keeps Skipper and native schedules available
      // without surprising the user with a window at sign-in.
      createWindow(!app.getLoginItemSettings().wasOpenedAsHidden && !process.argv.includes("--1helm-background"));
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
    if (quitting) return;
    quitting = true;
    // Explicit Quit is respected. A crash leaves the agent installed so it can
    // relaunch the background control plane; login starts it again next time.
    removeWakeLaunchAgent();
    process.emit("SIGTERM", "SIGTERM");
  });
}

"use strict";

const { app, BrowserWindow, dialog, shell, session } = require("electron");
const { createServer } = require("node:net");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const LOOPBACK = "127.0.0.1";
let mainWindow = null;
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
  process.chdir(appRoot);
  localOrigin = `http://${LOOPBACK}:${port}`;
  await import(pathToFileURL(path.join(appRoot, "src", "server", "index.ts")).href);
  await waitForServer(localOrigin);
}

function allowedLocalUrl(raw) {
  try {
    const url = new URL(raw);
    return url.origin === localOrigin && ["http:", "ws:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function createWindow() {
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
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  void window.loadURL(localOrigin);
  mainWindow = window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) createWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
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
      await startLocalRuntime();
      createWindow();
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
  app.on("before-quit", () => {
    if (quitting) return;
    quitting = true;
    process.emit("SIGTERM", "SIGTERM");
  });
}

"use strict";

// Desktop shell for the Cloud Worker. It has no local server, updater, WSL, or
// sidecar path; the legacy installation's data directory stays untouched.
const { app, BrowserWindow, shell, session, systemPreferences } = require("electron");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");
const { allowedRemoteUrl, allowedPermissionUrl, desktopGatewayAction, hostedWorkspaceLandingOrigin, HOSTED_APP_ORIGIN, isHostedWorkspaceOrigin, normalizeRemoteOrigin } = require("./workspace-target.cjs");

const DATA_NAMESPACE = "1Helm-OCI-v1";
const dataPath = path.join(app.getPath("appData"), DATA_NAMESPACE);
fs.mkdirSync(dataPath, { recursive: true, mode: 0o700 });
app.setPath("userData", dataPath);
const remoteWorkspacePath = () => path.join(app.getPath("userData"), "remote-workspace");
let mainWindow = null;
let authWindow = null;
let quitting = false;

function selectedOrigin() {
  try { return normalizeRemoteOrigin(fs.readFileSync(remoteWorkspacePath(), "utf8")); }
  catch { return ""; }
}
function rememberOrigin(raw) {
  const origin = normalizeRemoteOrigin(raw);
  if (origin) fs.writeFileSync(remoteWorkspacePath(), origin + "\n", { mode: 0o600 });
}
function rememberLoadedWorkspace(window, priorOrigin) {
  const origin = hostedWorkspaceLandingOrigin(window.webContents.getURL(), priorOrigin);
  if (origin) rememberOrigin(origin);
}
const allowedAppUrl = (raw) => allowedRemoteUrl(raw, selectedOrigin());
const externalUrl = (raw) => /^https?:/i.test(raw) || /^mailto:build@1helm\.com$/i.test(raw);
const startsHostedHandoff = (raw) => {
  try { const url = new URL(raw); return selectedOrigin() === HOSTED_APP_ORIGIN && url.origin === HOSTED_APP_ORIGIN && url.pathname === "/auth/to"; }
  catch { return false; }
};

function loadGateway(window, state = {}) {
  return window.loadFile(path.join(__dirname, "gateway.html"), { query: {
    ...(state.origin ? { origin: state.origin, custom: isHostedWorkspaceOrigin(state.origin) ? "0" : "1" } : {}),
    ...(state.error ? { error: state.error } : {}),
  } });
}
async function connect(window, origin) {
  const selected = normalizeRemoteOrigin(origin);
  if (!selected) { await loadGateway(window, { error: "Enter an HTTPS server address." }); return; }
  try {
    const response = await fetch(`${selected}/api/mobile/compatibility`, { signal: AbortSignal.timeout(15_000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.product !== "1Helm" || result.mobile_api !== 1) throw new Error("That address is not a compatible 1Helm instance.");
    if (!result.has_users || !result.setup_complete) throw new Error("Finish setting up this 1Helm instance before connecting the app.");
    rememberOrigin(selected);
    await window.loadURL(selected);
    rememberLoadedWorkspace(window, selected);
  } catch (error) {
    await loadGateway(window, { origin: selected, error: error instanceof Error ? error.message : "Could not connect to this instance." });
  }
}
function openAuthWindow(url) {
  if (authWindow && !authWindow.isDestroyed()) authWindow.close();
  const window = new BrowserWindow({ width: 1040, height: 780, parent: mainWindow || undefined,
    title: "Connect to 1Helm", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const returnToApp = (event, nextUrl) => {
    if (!allowedAppUrl(nextUrl)) return;
    event.preventDefault();
    const priorOrigin = selectedOrigin();
    if (mainWindow) {
      const target = mainWindow;
      void target.loadURL(nextUrl).then(() => { if (!target.isDestroyed()) rememberLoadedWorkspace(target, priorOrigin); }).catch(() => {});
    }
    window.close(); mainWindow?.show(); mainWindow?.focus();
  };
  window.webContents.on("will-navigate", returnToApp);
  window.webContents.on("will-redirect", returnToApp);
  window.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (externalUrl(nextUrl)) void shell.openExternal(nextUrl);
    return { action: "deny" };
  });
  window.on("closed", () => { if (authWindow === window) authWindow = null; });
  void window.loadURL(url);
  authWindow = window;
}
function createWindow(showWhenReady = true) {
  const window = new BrowserWindow({ width: 1440, height: 940, minWidth: 820, minHeight: 600,
    show: false, backgroundColor: "#08090c", title: "1Helm",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true } });
  let handoffPending = false;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedAppUrl(url)) return { action: "allow" };
    if (externalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const gatewayFile = pathToFileURL(path.join(__dirname, "gateway.html")).href;
    const action = window.webContents.getURL().split("?")[0] === gatewayFile ? desktopGatewayAction(url) : null;
    if (action) {
      event.preventDefault();
      if (action.type === "connect") void connect(window, action.origin);
      else void loadGateway(window, { error: "This app connects to 1HC or your own server." });
      return;
    }
    if (allowedAppUrl(url)) { if (startsHostedHandoff(url)) handoffPending = true; return; }
    event.preventDefault();
    // External sign-in needs a separate window so the app retains its session.
    if (/^https?:/i.test(url)) openAuthWindow(url);
  });
  // Server redirects also occur during loadURL(), which does not emit will-navigate.
  window.webContents.on("will-redirect", (event, url) => {
    if (allowedAppUrl(url)) { if (startsHostedHandoff(url)) handoffPending = true; return; }
    event.preventDefault();
    if (/^https?:/i.test(url)) openAuthWindow(url);
  });
  window.webContents.on("did-navigate", (_event, url) => {
    if (!handoffPending) return;
    handoffPending = false;
    const origin = hostedWorkspaceLandingOrigin(url, selectedOrigin());
    if (origin) rememberOrigin(origin);
  });
  if (showWhenReady) window.once("ready-to-show", () => window.show());
  window.on("close", (event) => { if (process.platform === "darwin" && !quitting) { event.preventDefault(); window.hide(); } });
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  const origin = selectedOrigin();
  void (origin ? connect(window, origin) : loadGateway(window));
  mainWindow = window;
}

function permissionAllowed(webContents, permission, details = {}) {
  if (!allowedPermissionUrl(webContents?.getURL?.() || "", selectedOrigin())) return false;
  if (permission === "notifications") return true;
  if (permission !== "media") return false;
  const types = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
  return types.length === 0 || (types.includes("audio") && !types.includes("video"));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes("--1helm-background")) return;
    if (!mainWindow) createWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show(); mainWindow?.focus();
  });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => permissionAllowed(contents, permission, details));
    session.defaultSession.setPermissionRequestHandler(async (contents, permission, callback, details) => {
      if (!permissionAllowed(contents, permission, details)) { callback(false); return; }
      if (permission === "notifications" || process.platform !== "darwin") { callback(true); return; }
      try { callback(await systemPreferences.askForMediaAccess("microphone")); }
      catch { callback(false); }
    });
    createWindow();
  });
  app.on("activate", () => { if (!mainWindow) createWindow(); else { mainWindow.show(); mainWindow.focus(); } });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", () => { quitting = true; });
}

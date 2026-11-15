"use strict";

// Desktop shell for the Cloud Worker. It has no local server, WSL, or sidecar path, and
// its only updater is the signed Mac app update in mac-update.cjs; the legacy installation's data directory stays untouched.
const { app, BrowserWindow, nativeTheme, shell, session, systemPreferences, autoUpdater, dialog, Menu } = require("electron");
const { createMacUpdater } = require("./mac-update.cjs");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");
const { allowedRemoteUrl, allowedPermissionUrl, allowedDisplayMediaRequest, desktopGatewayAction, hostedWorkspaceLandingOrigin, HOSTED_APP_ORIGIN, isHostedWorkspaceOrigin, normalizeRemoteOrigin } = require("./workspace-target.cjs");

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
  if (!selected) { await loadGateway(window, { error: "Enter a server address." }); return; }
  try {
    const response = await fetch(`${selected}/api/mobile/compatibility`, { signal: AbortSignal.timeout(15_000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.product !== "1Helm" || result.mobile_api !== 1) throw new Error("That address isn't a 1Helm server.");
    if (!result.has_users || !result.setup_complete) throw new Error("That 1Helm server isn't set up yet.");
    rememberOrigin(selected);
    await window.loadURL(selected);
    rememberLoadedWorkspace(window, selected);
  } catch (error) {
    await loadGateway(window, { origin: selected, error: error instanceof Error ? error.message : "Couldn't connect. Try again." });
  }
}
function openAuthWindow(url) {
  if (authWindow && !authWindow.isDestroyed()) authWindow.close();
  const window = new BrowserWindow({ width: 1040, height: 780, parent: mainWindow || undefined,
    title: "1Helm", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
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
    show: false, backgroundColor: nativeTheme?.shouldUseDarkColors ? "#121212" : "#f3f2ef", title: "1Helm",
    // backgroundThrottling off: with the window closed (hidden) the page still checks its tasks every few seconds and shows a
    // notification when one needs you or finishes. Web push isn't available in Electron, so this is how the Mac app notifies.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, backgroundThrottling: false } });
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
      else void loadGateway(window, { error: "This app can't set up a server on your computer. Sign in to your account instead." });
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

// getDisplayMedia reaches the permission request as "media" with no media types (a microphone or camera request lists its types).
// A display-capture request used to be answered by the microphone prompt, which refused, so the share failed at once.
const isDisplayRequest = (permission, details = {}) => permission === "display-capture" || (permission === "media" && !(Array.isArray(details.mediaTypes) && details.mediaTypes.length));

function permissionAllowed(webContents, permission, details = {}) {
  if (!allowedPermissionUrl(webContents?.getURL?.() || "", selectedOrigin())) return false;
  if (permission === "notifications" || permission === "geolocation") return true;
  // Electron asks for display-capture before it calls the display media handler, which is set on the Mac only and grants only the sound.
  if (permission === "display-capture") return process.platform === "darwin";
  if (permission !== "media") return false;
  const types = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
  return types.length === 0 || (types.includes("audio") && !types.includes("video"));
}

// getDisplayMedia needs a video stream with the sound (Electron refuses an audio-only grant; inferred from Electron's
// ElectronBrowserContext::DisplayMediaDeviceChosen via DeepWiki, to be confirmed on the device). The video is the app's own page,
// which needs no Screen Recording permission and shows nothing else on the screen; the page stops the video track at once.
// The sound is the Mac's system audio ("loopback"), which Electron 43 takes with Apple's CoreAudio tap.
function grantMeetingSound(request, callback) {
  try { callback({ video: request.frame, audio: "loopback" }); }
  catch { try { callback({}); } catch {} }
}

const macUpdater = createMacUpdater({ app, autoUpdater, dialog, Menu, getWindow: () => mainWindow });

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes("--1helm-background")) return;
    if (!mainWindow) createWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show(); mainWindow?.focus();
  });
  app.whenReady().then(() => {
    // The 1HC page tells the Mac app apart from a browser by this token (as the phone apps add 1HelmMobile).
    if (typeof app.userAgentFallback === "string" && !app.userAgentFallback.includes("1HelmDesktop")) app.userAgentFallback += " 1HelmDesktop";
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => permissionAllowed(contents, permission, details));
    session.defaultSession.setPermissionRequestHandler(async (contents, permission, callback, details) => {
      if (!permissionAllowed(contents, permission, details)) { callback(false); return; }
      // macOS shows its own location prompt (NSLocationUsageDescription, set by the packager) the first time it is used.
      if (permission === "notifications" || permission === "geolocation" || isDisplayRequest(permission, details) || process.platform !== "darwin") { callback(true); return; }
      try { callback(await systemPreferences.askForMediaAccess("microphone")); }
      catch { callback(false); }
    });
    // Live notes "A meeting window or app": the page's getDisplayMedia gets the Mac's system sound. Electron 43 captures it with
    // Apple's CoreAudio tap on macOS 14.2 and later (the packager sets NSAudioCaptureUsageDescription). Only the selected app page
    // may ask. Nothing else is granted, and a refusal (callback with no streams) makes the page's request fail.
    if (process.platform === "darwin") {
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        if (!allowedDisplayMediaRequest(request, selectedOrigin())) { callback({}); return; }
        grantMeetingSound(request, callback);
      });
    }
    createWindow();
    macUpdater.start();
  });
  app.on("activate", () => { if (!mainWindow) createWindow(); else { mainWindow.show(); mainWindow.focus(); } });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", () => { quitting = true; });
}

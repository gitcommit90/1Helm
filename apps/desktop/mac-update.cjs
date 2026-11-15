"use strict";

// Automatic updates for the signed Mac app. Electron's built-in autoUpdater (Squirrel.Mac) reads a static JSON feed
// (serverType "json") that lists the current release and the zip of the signed, notarized app. No update service and
// no dependency is involved. Only the packaged app on macOS checks. A missing feed or a network error is silent.
const FEED_URL = "https://1helm.com/download/mac-update.json";
const ZIP_URL = (version) => `https://1helm.com/download/1Helm-${version}-mac.zip`;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15 * 1000;

// The feed file Squirrel.Mac reads with serverType "json" (Electron docs, "macOS Squirrel.Mac releases.json metadata format").
function feedJson(version, { notes = "", pubDate = new Date().toISOString() } = {}) {
  return {
    currentRelease: version,
    releases: [{ version, updateTo: { version, pub_date: pubDate, notes, name: version, url: ZIP_URL(version) } }],
  };
}

function releaseVersion(name) {
  const match = String(name || "").match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
}

// True when version a is newer than version b (three numbers, a pre-release tag is ignored).
function isNewer(a, b) {
  const n = (v) => String(v || "").split("-")[0].split(".").map((x) => parseInt(x, 10) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// What the feed says: the release to install, or null when currentRelease is the running version or older, the release list
// is empty, or the file is not a valid feed. Squirrel.Mac is only asked to download when this returns a release.
function newerRelease(feed, currentVersion) {
  const wanted = feed && typeof feed.currentRelease === "string" ? feed.currentRelease : "";
  if (!wanted || !isNewer(wanted, currentVersion)) return null;
  const entry = Array.isArray(feed.releases) ? feed.releases.find((r) => r && r.version === wanted && r.updateTo && r.updateTo.url) : null;
  return entry ? entry.updateTo : null;
}

function updatesSupported({ app, platform = process.platform } = {}) {
  return platform === "darwin" && app?.isPackaged === true;
}

// The default menu with "Check for Updates…" added under "About 1Helm".
function appMenuTemplate(name, onCheck) {
  return [
    { label: name, submenu: [
      { role: "about" }, { label: "Check for Updates…", click: onCheck }, { type: "separator" },
      { role: "services" }, { type: "separator" },
      { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" },
    ] },
    { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ];
}

async function defaultFetchFeed() {
  const response = await fetch(FEED_URL, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`feed ${response.status}`);
  return response.json();
}

function createMacUpdater({ app, autoUpdater, dialog, Menu, platform = process.platform, getWindow = () => null,
  intervalMs = CHECK_INTERVAL_MS, firstDelayMs = FIRST_CHECK_DELAY_MS, fetchFeed = defaultFetchFeed } = {}) {
  const supported = updatesSupported({ app, platform });
  let initialized = false;
  let busy = false;
  let manual = false;
  let readyVersion = null;
  let promptedVersion = null;
  let timers = [];

  const message = (text, buttons = ["OK"], detail) => {
    const options = { type: "info", message: text, buttons, defaultId: 0, cancelId: buttons.length - 1, ...(detail ? { detail } : {}) };
    const window = getWindow();
    return window && !window.isDestroyed?.() ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
  };

  async function offerRestart(version) {
    if (promptedVersion === version) return;
    promptedVersion = version;
    try {
      const { response } = await message(`1Helm ${version} is ready. Restart to update.`, ["Restart", "Later"]);
      if (response === 0) autoUpdater.quitAndInstall();
    } catch {}
  }

  function upToDate() {
    busy = false;
    if (manual) { manual = false; void message("You're up to date.", ["OK"], `1Helm ${app.getVersion()} is the latest version.`).catch(() => {}); }
  }

  function initialize() {
    if (initialized) return supported;
    initialized = true;
    if (!supported) return false;
    autoUpdater.on("checking-for-update", () => { busy = true; });
    autoUpdater.on("update-available", () => { busy = true; });
    autoUpdater.on("update-not-available", upToDate);
    autoUpdater.on("update-downloaded", (_event, notes, name) => {
      busy = false; manual = false;
      readyVersion = releaseVersion(name) || releaseVersion(notes) || "update";
      void offerRestart(readyVersion);
    });
    autoUpdater.on("error", () => {
      busy = false;
      if (manual) { manual = false; void message("Couldn't check for updates.", ["OK"], "Try again later.").catch(() => {}); }
    });
    try { autoUpdater.setFeedURL({ url: FEED_URL, serverType: "json" }); return true; }
    catch { return false; }
  }

  // Read the feed first, so a feed that names the running version or an older one (or lists nothing) is "up to date" and
  // never reaches Squirrel.Mac. A 404 or network error ends the check without a message (a manual check says so).
  async function run() {
    let release = null;
    try { release = newerRelease(await fetchFeed(), app.getVersion()); }
    catch { busy = false; if (manual) { manual = false; void message("Couldn't check for updates.", ["OK"], "Try again later.").catch(() => {}); } return; }
    if (!release) { upToDate(); return; }
    try { autoUpdater.checkForUpdates(); }
    catch { busy = false; manual = false; }
  }

  function check({ interactive = false } = {}) {
    if (!initialize()) return false;
    if (readyVersion) {
      // A downloaded update is waiting. A manual check offers it again instead of checking.
      if (interactive) { promptedVersion = null; void offerRestart(readyVersion); }
      return true;
    }
    if (busy) { if (interactive) manual = true; return true; }
    manual = interactive;
    busy = true;
    void run();
    return true;
  }

  function start() {
    if (!initialize()) return false;
    if (Menu) Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(app.name || "1Helm", () => check({ interactive: true }))));
    const first = setTimeout(() => check(), firstDelayMs);
    const every = setInterval(() => check(), intervalMs);
    first.unref?.(); every.unref?.();
    timers = [first, every];
    return true;
  }

  function stop() { for (const t of timers) { clearTimeout(t); clearInterval(t); } timers = []; }

  return { start, stop, check, initialize, supported };
}

module.exports = { createMacUpdater, newerRelease, isNewer, feedJson, releaseVersion, updatesSupported, appMenuTemplate, FEED_URL, ZIP_URL, CHECK_INTERVAL_MS };

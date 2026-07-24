"use strict";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function publicError(error) {
  const message = String(error?.message || error || "Update failed")
    .replace(/https?:\/\/\S+/g, "the update service")
    .replace(/\s+/g, " ")
    .trim();
  return message.slice(0, 220) || "Update failed";
}

function releaseVersion(name) {
  const match = String(name || "").match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
}

function createNativeUpdateService({ app, autoUpdater, platform = process.platform, arch = process.arch } = {}) {
  let initialized = false;
  let active = false;
  let busy = false;
  let initialTimer = null;
  let intervalTimer = null;
  const nativeMode = platform === "win32" ? "native-windows" : "native-macos";
  let state = {
    mode: nativeMode,
    status: "idle",
    current_version: app.getVersion(),
    version: null,
    checked_at: null,
    error: null,
    message: `Check for a signed 1Helm update on this ${platform === "win32" ? "Windows PC" : "Mac"}.`,
  };

  let inApplications = true;
  if (platform === "darwin" && typeof app.isInApplicationsFolder === "function") {
    try { inApplications = app.isInApplicationsFolder(); } catch { inApplications = false; }
  }
  const feedPlatform = platform === "win32" && arch === "x64" ? "win32-x64" : "darwin-arm64";
  const supported = app.isPackaged === true && ((platform === "darwin" && arch === "arm64" && inApplications) || (platform === "win32" && arch === "x64"));
  const feedUrl = `https://update.electronjs.org/gitcommit90/1Helm/${feedPlatform}/${encodeURIComponent(app.getVersion())}`;

  const snapshot = () => ({ ...state });
  const setState = (patch) => { state = { ...state, ...patch }; };

  function initialize() {
    if (initialized) return active;
    initialized = true;
    if (!supported) {
      setState({
        status: "unsupported",
        error: app.isPackaged && platform === "darwin" && arch === "arm64" && !inApplications
          ? "Move 1Helm to Applications to enable host updates."
          : null,
        message: app.isPackaged
          ? "Signed automatic updates are available for supported macOS and Windows hosts."
          : "Development builds are updated from their source checkout.",
      });
      return false;
    }
    autoUpdater.on("checking-for-update", () => {
      busy = true;
      setState({ status: "checking", error: null, message: "The 1Helm host is checking for a signed update…" });
    });
    autoUpdater.on("update-available", () => {
      busy = true;
      setState({ status: "downloading", error: null, message: "The 1Helm host is downloading and verifying the update…" });
    });
    autoUpdater.on("update-not-available", () => {
      busy = false;
      setState({ status: "current", checked_at: Date.now(), error: null, message: "This 1Helm host is up to date." });
    });
    autoUpdater.on("update-downloaded", (_event, notes, name) => {
      busy = false;
      const version = releaseVersion(name) || releaseVersion(notes);
      setState({
        status: "ready",
        version,
        checked_at: Date.now(),
        error: null,
        message: `1Helm${version ? ` v${version}` : ""} is verified and ready. Restart the host app to install it.`,
      });
    });
    autoUpdater.on("error", (error) => {
      busy = false;
      const message = publicError(error);
      console.error(`1Helm host update failed: ${message}`);
      setState({ status: "error", checked_at: Date.now(), error: message, message });
    });
    try {
      autoUpdater.setFeedURL({ url: feedUrl });
      active = true;
      return true;
    } catch (error) {
      const message = publicError(error);
      setState({ status: "error", error: message, message });
      return false;
    }
  }

  function check() {
    if (!initialize()) return snapshot();
    if (busy || state.status === "ready") return snapshot();
    busy = true;
    setState({ status: "checking", error: null, message: "The 1Helm host is checking for a signed update…" });
    try {
      const pending = autoUpdater.checkForUpdates();
      pending?.catch?.((error) => {
        busy = false;
        const message = publicError(error);
        setState({ status: "error", checked_at: Date.now(), error: message, message });
      });
    } catch (error) {
      busy = false;
      const message = publicError(error);
      setState({ status: "error", checked_at: Date.now(), error: message, message });
    }
    return snapshot();
  }

  function install() {
    if (state.status !== "ready") {
      return { ...snapshot(), error: "No downloaded host update is ready." };
    }
    setState({ status: "installing", error: null, message: `1Helm is restarting this ${platform === "win32" ? "Windows" : "Mac"} host to install the verified update…` });
    process.env.HELM_UPDATE_INSTALLING = "1";
    return snapshot();
  }

  function commitInstall() {
    if (state.status !== "installing") return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  }

  function schedule({ initialDelayMs = 20_000, intervalMs = CHECK_INTERVAL_MS } = {}) {
    if (!initialize()) return;
    initialTimer ||= setTimeout(() => check(), initialDelayMs);
    initialTimer.unref?.();
    intervalTimer ||= setInterval(() => check(), intervalMs);
    intervalTimer.unref?.();
  }

  function stop() {
    if (initialTimer) clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    initialTimer = null;
    intervalTimer = null;
  }

  return { initialize, check, install, commitInstall, schedule, stop, state: snapshot, feedUrl };
}

module.exports = { createNativeUpdateService, publicError, releaseVersion };

"use strict";

const WORKSPACE_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.1helm\.com$/i;
const RESERVED_WORKSPACE_LABELS = new Set(["demo", "provision"]);
const DESKTOP_ACTION_ORIGIN = "https://desktop-action.1helm.invalid";
const HOSTED_APP_ORIGIN = "https://app.1helm.com";
// The host that serves every workspace at /w/<slug>/app, unlike a workspace's own <slug>.1helm.com.
const SHARED_APP_ORIGINS = new Set([HOSTED_APP_ORIGIN]);
const CONNECT_PATH = "/connect";
const LOCAL_SETUP_PATH = "/setup";

function normalizeRemoteOrigin(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function isHostedWorkspaceOrigin(raw) {
  const origin = normalizeRemoteOrigin(raw);
  if (!origin) return false;
  const url = new URL(origin);
  return !url.port && WORKSPACE_HOST.test(url.hostname) && !RESERVED_WORKSPACE_LABELS.has(url.hostname.toLowerCase().split(".")[0]);
}

function allowedRemoteUrl(raw, selectedOrigin = "") {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const selected = normalizeRemoteOrigin(selectedOrigin);
    if (!selected) return false;
    if (url.origin === selected) return true;
    return isHostedWorkspaceOrigin(selected) && isHostedWorkspaceOrigin(url.origin);
  } catch {
    return false;
  }
}

function allowedPermissionUrl(raw, selectedOrigin = "") {
  try {
    const url = new URL(raw);
    const slug = url.pathname.match(/^\/w\/([a-z0-9][a-z0-9-]{0,62})\/app\/?$/)?.[1];
    if (url.origin !== normalizeRemoteOrigin(selectedOrigin) || !slug) return false;
    return !isHostedWorkspaceOrigin(url.origin) || SHARED_APP_ORIGINS.has(url.origin) || slug === url.hostname.split(".")[0].toLowerCase();
  } catch {
    return false;
  }
}

// A request to share meeting sound (getDisplayMedia) is granted only to the selected app page itself: the top frame of the
// signed-in app page, never an embedded frame, and only when the page asks for sound (the app never needs a screen picture).
function allowedDisplayMediaRequest(request, selectedOrigin = "") {
  try {
    const frame = request?.frame;
    if (!frame || frame.parent || request.audioRequested !== true) return false;
    // Electron reports the origin with a trailing slash ("https://host/"), so compare normalized origins.
    if (request.securityOrigin && normalizeRemoteOrigin(request.securityOrigin) !== normalizeRemoteOrigin(selectedOrigin)) return false;
    return allowedPermissionUrl(frame.url || "", selectedOrigin);
  } catch {
    return false;
  }
}

// A completed 1HC sign-in may move the default app host to the owner's host.
// A link to another hosted page must not silently replace the saved server.
function hostedWorkspaceLandingOrigin(raw, selectedOrigin = "") {
  try {
    if (normalizeRemoteOrigin(selectedOrigin) !== HOSTED_APP_ORIGIN) return "";
    const url = new URL(raw);
    if (!isHostedWorkspaceOrigin(url.origin) || url.origin === HOSTED_APP_ORIGIN) return "";
    const slug = url.pathname.match(/^\/w\/([a-z0-9][a-z0-9-]{0,62})\/app\/?$/)?.[1];
    return slug && slug === url.hostname.split(".")[0].toLowerCase() ? url.origin : "";
  } catch {
    return "";
  }
}

function desktopGatewayAction(raw) {
  try {
    const url = new URL(raw);
    if (url.origin !== DESKTOP_ACTION_ORIGIN || url.hash || url.username || url.password) return null;
    if (url.pathname === LOCAL_SETUP_PATH && !url.search) return { type: "setup" };
    if (url.pathname !== CONNECT_PATH) return null;
    const origin = normalizeRemoteOrigin(url.searchParams.get("origin"));
    return origin ? { type: "connect", origin } : null;
  } catch {
    return null;
  }
}

module.exports = {
  CONNECT_PATH,
  DESKTOP_ACTION_ORIGIN,
  HOSTED_APP_ORIGIN,
  LOCAL_SETUP_PATH,
  allowedRemoteUrl,
  allowedPermissionUrl,
  allowedDisplayMediaRequest,
  hostedWorkspaceLandingOrigin,
  desktopGatewayAction,
  isHostedWorkspaceOrigin,
  normalizeRemoteOrigin,
};

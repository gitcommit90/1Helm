"use strict";

const WORKSPACE_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.1helm\.com$/i;
const RESERVED_WORKSPACE_LABELS = new Set(["demo", "provision"]);
const DESKTOP_ACTION_ORIGIN = "https://desktop-action.1helm.invalid";
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
    if (isHostedWorkspaceOrigin(url.origin)) return true;
    return Boolean(selectedOrigin) && url.origin === normalizeRemoteOrigin(selectedOrigin);
  } catch {
    return false;
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
  LOCAL_SETUP_PATH,
  allowedRemoteUrl,
  desktopGatewayAction,
  isHostedWorkspaceOrigin,
  normalizeRemoteOrigin,
};

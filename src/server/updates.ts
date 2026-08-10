import { existsSync, readFileSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const UPDATE_REPOSITORY = "gitcommit90/1Helm";
export const UPDATE_MANIFEST_URL = String(process.env.HELM_UPDATE_MANIFEST_URL || `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`);

export type HostUpdateStatus =
  | "idle"
  | "queued"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "restarting"
  | "managed"
  | "unsupported"
  | "error";

export type HostUpdateState = {
  mode: "native-macos" | "native-windows" | "linux-systemd" | "source";
  status: HostUpdateStatus;
  current_version: string;
  version: string | null;
  checked_at: number | null;
  error: string | null;
  message: string;
};

type UpdateManifest = { version?: unknown; tag_name?: unknown; draft?: unknown; prerelease?: unknown };
type NativeUpdaterBridge = {
  state: () => Partial<HostUpdateState>;
  check: () => Promise<Partial<HostUpdateState>> | Partial<HostUpdateState>;
  install: () => Promise<Partial<HostUpdateState>> | Partial<HostUpdateState>;
};

const NATIVE_UPDATER = Symbol.for("1helm.nativeUpdater");
const LINUX_UPDATE_REQUEST = "host-update.request";
const LINUX_UPDATE_STATUS = "host-update-status.json";

const versionParts = (value: string): number[] | null => {
  const match = value.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
};

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) throw new Error("Could not compare the installed and released 1Helm versions.");
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function installedAppVersion(appRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { version?: unknown };
    const version = String(pkg.version || "").trim();
    if (versionParts(version)) return version;
  } catch { /* use the explicit unknown state below */ }
  return "unknown";
}

function nativeUpdater(): NativeUpdaterBridge | null {
  const bridge = (globalThis as Record<symbol, unknown>)[NATIVE_UPDATER];
  if (!bridge || typeof bridge !== "object") return null;
  const updater = bridge as NativeUpdaterBridge;
  return typeof updater.state === "function" && typeof updater.check === "function" && typeof updater.install === "function"
    ? updater
    : null;
}

function normalizedState(state: Partial<HostUpdateState>, currentVersion: string): HostUpdateState {
  const status = String(state.status || "idle") as HostUpdateStatus;
  return {
    mode: state.mode === "linux-systemd" || state.mode === "source" || state.mode === "native-windows" ? state.mode : "native-macos",
    status,
    current_version: String(state.current_version || currentVersion),
    version: state.version ? String(state.version) : null,
    checked_at: Number.isFinite(Number(state.checked_at)) ? Number(state.checked_at) : null,
    error: state.error ? String(state.error) : null,
    message: String(state.message || ""),
  };
}

async function fetchLatestVersion(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(UPDATE_MANIFEST_URL, {
      headers: { accept: "application/json", "user-agent": "1Helm-host-update-check" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Could not reach 1Helm's update service. Check the host's connection and try again.");
  }
  if (response.status === 403 || response.status === 429) {
    throw new Error("GitHub is rate-limiting update checks from this host. 1Helm keeps the last known release and retries automatically.");
  }
  if (!response.ok) throw new Error(`Could not check 1Helm updates (HTTP ${response.status}).`);
  const manifest = await response.json() as UpdateManifest;
  if (manifest.draft === true || manifest.prerelease === true) throw new Error("1Helm's update service did not return a stable release.");
  const version = String(manifest.version || manifest.tag_name || "").trim().replace(/^v/i, "");
  if (!versionParts(version)) throw new Error("1Helm's update service returned an invalid version.");
  return version;
}

// GitHub's unauthenticated API allows 60 requests/hour per address, and every
// open admin tab polls /api/app/update. Serve the release lookup from a cache:
// one shared request per TTL window, concurrent checks coalesced onto the same
// fetch, and — when GitHub throttles or hiccups — the last known release
// instead of an error on an otherwise healthy install.
const RELEASE_CACHE_TTL_MS = 15 * 60_000;
const RELEASE_RETRY_COOLDOWN_MS = 2 * 60_000;
let cachedRelease: { version: string; at: number } | null = null;
let releaseFailure: { error: Error; at: number } | null = null;
let releaseFetch: Promise<string> | null = null;

async function latestVersion(): Promise<string> {
  if (cachedRelease && Date.now() - cachedRelease.at < RELEASE_CACHE_TTL_MS) return cachedRelease.version;
  if (releaseFetch) return releaseFetch;
  if (releaseFailure && Date.now() - releaseFailure.at < RELEASE_RETRY_COOLDOWN_MS) {
    if (cachedRelease) return cachedRelease.version;
    throw releaseFailure.error;
  }
  releaseFetch = fetchLatestVersion()
    .then((version) => {
      cachedRelease = { version, at: Date.now() };
      releaseFailure = null;
      return version;
    })
    .catch((error: Error) => {
      releaseFailure = { error, at: Date.now() };
      if (cachedRelease) return cachedRelease.version;
      throw error;
    })
    .finally(() => { releaseFetch = null; });
  return releaseFetch;
}

async function linuxState(appRoot: string, dataDir: string): Promise<HostUpdateState> {
  const currentVersion = installedAppVersion(appRoot);
  if (currentVersion === "unknown") throw new Error("Could not read this 1Helm installation's version.");
  const statusPath = join(dataDir, LINUX_UPDATE_STATUS);
  const requestPath = join(dataDir, LINUX_UPDATE_REQUEST);
  try {
    const saved = JSON.parse(await readFile(statusPath, "utf8")) as Partial<HostUpdateState>;
    if (["checking", "downloading", "installing", "restarting", "error"].includes(String(saved.status))) {
      return normalizedState({ ...saved, mode: "linux-systemd", current_version: currentVersion }, currentVersion);
    }
  } catch { /* no durable updater state yet */ }
  if (existsSync(requestPath)) {
    return normalizedState({
      mode: "linux-systemd",
      status: "queued",
      current_version: currentVersion,
      message: "The host accepted the update request and is waiting for its system updater.",
    }, currentVersion);
  }
  const version = await latestVersion();
  const available = compareVersions(version, currentVersion) > 0;
  return normalizedState({
    mode: "linux-systemd",
    status: available ? "available" : "current",
    current_version: currentVersion,
    version,
    checked_at: Date.now(),
    message: available
      ? `1Helm v${version} is available for this Linux host.`
      : "This 1Helm host is up to date.",
  }, currentVersion);
}

export async function hostUpdateState(appRoot: string, dataDir: string): Promise<HostUpdateState> {
  const currentVersion = installedAppVersion(appRoot);
  if (currentVersion === "unknown") throw new Error("Could not read this 1Helm installation's version.");
  const native = nativeUpdater();
  if (native) return normalizedState(native.state(), currentVersion);
  if (process.env.HELM_INSTALL_KIND === "linux-systemd") return linuxState(appRoot, dataDir);
  return normalizedState({
    mode: "source",
    status: "managed",
    current_version: currentVersion,
    message: "This source deployment is updated by its host operator; 1Helm will not send an installer to this browser.",
  }, currentVersion);
}

async function requestLinuxUpdate(dataDir: string): Promise<HostUpdateState> {
  const requestPath = join(dataDir, LINUX_UPDATE_REQUEST);
  const candidate = `${requestPath}.${process.pid}.candidate`;
  await writeFile(candidate, `${JSON.stringify({ requested_at: Date.now() })}\n`, { mode: 0o600 });
  await rename(candidate, requestPath);
  return normalizedState({
    mode: "linux-systemd",
    status: "queued",
    message: "The host accepted the update request and will download, verify, install, health-check, and roll back automatically if needed.",
  }, "unknown");
}

export async function runHostUpdateAction(
  appRoot: string,
  dataDir: string,
  action: "download" | "install",
): Promise<HostUpdateState> {
  const currentVersion = installedAppVersion(appRoot);
  if (currentVersion === "unknown") throw new Error("Could not read this 1Helm installation's version.");
  const native = nativeUpdater();
  if (native) {
    const state = action === "install" ? await native.install() : await native.check();
    return normalizedState(state, currentVersion);
  }
  if (process.env.HELM_INSTALL_KIND === "linux-systemd") {
    if (action === "install") throw new Error("Linux host updates install automatically after host-side verification.");
    const state = await linuxState(appRoot, dataDir);
    if (state.status !== "available" && state.status !== "error") return state;
    return normalizedState({ ...await requestLinuxUpdate(dataDir), current_version: currentVersion, version: state.version }, currentVersion);
  }
  throw new Error("This source deployment is updated by its host operator.");
}

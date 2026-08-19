import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus as hostCpus, freemem, platform, totalmem } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn as spawnPty, type IPty } from "node-pty";
import { WebSocket } from "ws";
import { APPLE_RUNTIME_VERSION, ensureAppleRuntimeRunning, exactAppleRuntimeVersion } from "./apple-container-runtime.ts";
import { DATA_DIR, now, q, q1, run, type Row } from "./db.ts";
import { channelFilesPath, channelFilesystemRoot, channelUsesRuntimeStorage, channelWorkspacePath, installationScopedRuntimeName, ociHostStateRoot } from "./channel-storage.ts";

export type ChannelComputerBackend = "apple" | "oci" | "native" | "mock";
export type ChannelComputer = {
  channel_id: number;
  backend: ChannelComputerBackend;
  machine_id: string;
  image: string;
  desired_state: "auto" | "running" | "stopped" | "deleted";
  observed_state: string;
  cpus: number;
  memory_bytes: number;
  disk_bytes: number;
  home_mount: "none";
  provision_status: string;
  maintenance_state: string;
  host_revision: number;
  synced_host_revision: number;
  guest_revision: number;
  pressure_json: string;
  low_pressure_streak: number;
  last_update: number;
  last_update_attempt: number;
  last_health: number;
  last_used: number;
  last_error: string;
  created: number;
  updated: number;
};

export type ComputerCommandResult = { status: string; exit_code: number | null; output: string };
export type MachineTerminal = {
  id: string;
  channelId: number;
  ownerId: number;
  machineId: string;
  backend: ChannelComputerBackend;
  pty: IPty;
  clients: Set<WebSocket>;
  scrollback: Buffer[];
  bytes: number;
  cols: number;
  rows: number;
  closed: boolean;
};

type MachineInspection = {
  id?: string;
  status?: string;
  cpus?: number;
  memory?: number;
  diskSize?: number | null;
  homeMount?: string;
  image?: { reference?: string; descriptor?: { digest?: string } } | string;
};

export const APPLE_RUNTIME_PACKAGE = `container-${APPLE_RUNTIME_VERSION}-installer-signed.pkg`;
export const APPLE_RUNTIME_URL = `https://github.com/apple/container/releases/download/${APPLE_RUNTIME_VERSION}/${APPLE_RUNTIME_PACKAGE}`;
export const APPLE_RUNTIME_SHA256 = "0ca1c42a2269c2557efb1d82b1b38ac553e6a3a3da1b1179c439bcee1e7d6714";
export const DEFAULT_CHANNEL_IMAGE = process.env.HELM_CHANNEL_MACHINE_IMAGE || "local/1helm-channel-machine:0.0.41";
const CONTAINER_CANDIDATES = [process.env.HELM_CONTAINER_CLI, "/usr/local/bin/container", "/opt/homebrew/bin/container", "container"].filter(Boolean) as string[];
const OCI_RUNTIME_VERSION = "1helm-oci-runtime-v1";
const OCI_HELPER_CANDIDATES = [
  process.env.HELM_OCI_HELPER,
  "/usr/libexec/1helm-oci-runtime",
  "/usr/local/libexec/1helm-oci-runtime",
  join(process.env.HELM_APP_ROOT || process.cwd(), "scripts", "1helm-oci-runtime"),
].filter(Boolean) as string[];
const COMMAND_TIMEOUT_MS = Math.max(5_000, Number(process.env.HELM_MACHINE_COMMAND_TIMEOUT_MS || 120_000));
const IDLE_AFTER_MS = Math.max(60_000, Number(process.env.HELM_MACHINE_IDLE_MS || 15 * 60_000));
const RECONCILE_EVERY_MS = Math.max(15_000, Number(process.env.HELM_FLEET_INTERVAL_MS || 5 * 60_000));
const INITIAL_RECONCILE_MS = Math.max(25, Number(process.env.HELM_FLEET_INITIAL_MS || 30_000));
const UPDATE_EVERY_MS = Math.max(24 * 60 * 60_000, Number(process.env.HELM_MACHINE_UPDATE_MS || 7 * 24 * 60 * 60_000));
const UPDATE_RETRY_MS = Math.max(60 * 60_000, Number(process.env.HELM_MACHINE_UPDATE_RETRY_MS || 6 * 60 * 60_000));
const MAX_WORKSPACE_SYNC_BYTES = Math.max(64 * 1024 ** 2, Number(process.env.HELM_WORKSPACE_SYNC_MAX_BYTES || 2 * 1024 ** 3));
// Apple's machine runtime exposes a host-backed filesystem capacity in `df`
// and does not offer a disk-size creation flag. This is the honest writable
// allocation 1Helm manages and mirrors for a channel, not that virtual ceiling.
export const MANAGED_CHANNEL_DISK_BYTES = MAX_WORKSPACE_SYNC_BYTES;
const MAX_WORKSPACE_SYNC_ENTRIES = Math.max(10_000, Number(process.env.HELM_WORKSPACE_SYNC_MAX_ENTRIES || 200_000));
const SCROLLBACK_CAP = 256 * 1024;
const terminalSessions = new Map<string, MachineTerminal>();
const channelLocks = new Map<number, Promise<unknown>>();
// Provisioning is a long host operation (the first OCI image build installs
// its guest toolchain). The reconciler must not race that transaction.
const activeProvisioning = new Set<number>();
const syncTimers = new Map<number, NodeJS.Timeout>();
let reconcileTimer: NodeJS.Timeout | null = null;
let reconcileStartupTimer: NodeJS.Timeout | null = null;
let reconcileRunning = false;
let reconcileEnabled = false;
let reconcilePass: Promise<void> | null = null;

const installationId = (): string => {
  let id = String(q1("SELECT installation_id FROM workspace WHERE id=1")?.installation_id || "");
  if (!/^[a-f0-9]{16}$/.test(id)) {
    id = randomBytes(8).toString("hex");
    run("UPDATE workspace SET installation_id=? WHERE id=1", id);
  }
  return id;
};

export const configuredChannelBackend = (): ChannelComputerBackend => {
  const hostDefault: ChannelComputerBackend = platform() === "darwin" ? "apple" : "oci";
  const configured = String(process.env.HELM_CHANNEL_COMPUTER_BACKEND || hostDefault);
  return ["apple", "oci", "native", "mock"].includes(configured) ? configured as ChannelComputerBackend : hostDefault;
};

const explicitComputerId = (channelId: number): string => `1helm-${installationId()}-channel-${channelId}`;
const hostWorldRoot = (channelId: number): string => join(DATA_DIR, "channels", String(channelId));
const hostWorkspace = channelWorkspacePath;
const hostFiles = channelFilesPath;
const workspaceMirrorRefreshes = new Map<number, Promise<void>>();
let appleNetworkRepair: Promise<void> | null = null;
let appleNetworkRepairAt = 0;

function withChannelLock<T>(channelId: number, fn: () => Promise<T>): Promise<T> {
  const previous = channelLocks.get(channelId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(fn);
  channelLocks.set(channelId, current);
  const release = (): void => { if (channelLocks.get(channelId) === current) channelLocks.delete(channelId); };
  void current.then(release, release);
  return current;
}

export function channelComputer(channelId: number): ChannelComputer | undefined {
  return q1("SELECT * FROM channel_computers WHERE channel_id=?", channelId) as ChannelComputer | undefined;
}

function channelComputerPressure(computer: ChannelComputer): Record<string, unknown> | undefined {
  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(computer.pressure_json || "{}"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    value = parsed as Record<string, unknown>;
  } catch { return undefined; }
  const load1 = Number(value.load1);
  const memoryAvailableKb = Number(value.memoryAvailableKb);
  const diskUsedPercent = Number(value.diskUsedPercent);
  if (!Number.isFinite(load1) || load1 < 0
    || !Number.isFinite(memoryAvailableKb) || memoryAvailableKb < 0
    || !Number.isFinite(diskUsedPercent) || diskUsedPercent < 0 || diskUsedPercent > 100) return undefined;
  return {
    load1,
    memoryAvailableKb,
    memoryAvailableBytes: memoryAvailableKb * 1024,
    diskUsedPercent,
    sampledAt: Number(computer.last_health || 0) || null,
    status: computer.observed_state === "running" ? "live" : "last_known",
  };
}

export function channelComputerView(channelId: number): Record<string, unknown> | null {
  const computer = channelComputer(channelId);
  if (!computer) return null;
  const obligations = computerObligations(channelId);
  const pressure = channelComputerPressure(computer);
  return {
    backend: computer.backend,
    machine_id: computer.machine_id,
    image: computer.image,
    desired_state: computer.desired_state,
    observed_state: computer.observed_state,
    cpus: computer.cpus,
    memory_bytes: computer.memory_bytes,
    // `disk_bytes` in the persistence model predates the mirror boundary and
    // is not a VM disk allocation. Never serialize it under a capacity-like
    // name. Apple's runtime in particular exposes the host filesystem's
    // ceiling inside the guest, which is not storage reserved for this VM.
    mirror_quota_bytes: computer.disk_bytes,
    mirror_quota_purpose: "Maximum channel workspace copied across the guest-to-host mirror safety boundary; not VM storage capacity.",
    guest_disk_capacity_bytes: null,
    guest_disk_capacity_status: "unknown",
    pressure,
    pressure_status: pressure ? pressure.status : "unknown",
    home_mount: computer.home_mount,
    provision_status: computer.provision_status,
    maintenance_state: computer.maintenance_state,
    last_update: computer.last_update,
    last_health: computer.last_health,
    last_used: computer.last_used,
    last_error: computer.last_error,
    obligations,
  };
}

function automaticResources(channelCount = Math.max(1, Number(q1("SELECT COUNT(*) n FROM channel_computers WHERE desired_state<>'deleted'")?.n || 1))): { cpus: number; memoryBytes: number } {
  const cores = Math.max(1, hostCpus().length);
  const hostMemory = Math.max(2 * 1024 ** 3, totalmem());
  const macReserve = Math.max(4 * 1024 ** 3, Math.floor(hostMemory * 0.35));
  const usableMemory = Math.max(1024 ** 3, hostMemory - macReserve);
  const perMachine = Math.floor(usableMemory / Math.min(channelCount, 4));
  const memoryBytes = Math.max(1024 ** 3, Math.min(4 * 1024 ** 3, perMachine));
  const vcpus = cores >= 8 ? 2 : 1;
  return { cpus: vcpus, memoryBytes };
}

export function ensureChannelComputerRecord(channelId: number): ChannelComputer {
  const channel = q1(`SELECT c.id,c.status FROM channels c
    JOIN agent_channels ac ON ac.channel_id=c.id JOIN agents a ON a.id=ac.agent_id AND a.kind='channel' AND a.status<>'deleted'
    WHERE c.id=? AND c.kind='channel' AND c.name<>'main' AND c.status<>'deleted'`, channelId);
  if (!channel) throw new Error("Channel computer not found.");
  const existing = channelComputer(channelId);
  if (existing) return existing;
  const resources = automaticResources();
  const stamp = now();
  run(`INSERT INTO channel_computers
    (channel_id,backend,machine_id,image,desired_state,observed_state,cpus,memory_bytes,disk_bytes,home_mount,provision_status,last_used,created,updated)
    VALUES (?,?,?,?,?,'unknown',?,?,?,'none','pending',?,?,?)`,
  channelId, configuredChannelBackend(), explicitComputerId(channelId), DEFAULT_CHANNEL_IMAGE,
  String(channel.status) === "archived" ? "stopped" : "auto", resources.cpus, resources.memoryBytes, MANAGED_CHANNEL_DISK_BYTES, stamp, stamp, stamp);
  markWorkspaceDirty(channelId, "*", "full");
  return channelComputer(channelId)!;
}

export function markWorkspaceDirty(channelId: number, relativePath = "*", operation: "upsert" | "delete" | "full" = "upsert"): void {
  const computer = q1("SELECT backend FROM channel_computers WHERE channel_id=?", channelId);
  if (!computer || String(computer.backend) === "oci") return;
  const path = relativePath === "*" ? "*" : normalizeWorldRelative(relativePath);
  const effective = path === "*" ? "full" : operation;
  run(`INSERT INTO channel_workspace_changes (channel_id,relative_path,operation,created) VALUES (?,?,?,?)
    ON CONFLICT(channel_id,relative_path) DO UPDATE SET operation=excluded.operation,created=excluded.created`, channelId, path, effective, now());
  run("UPDATE channel_computers SET host_revision=host_revision+1,updated=? WHERE channel_id=?", now(), channelId);
}

function normalizeWorldRelative(input: string): string {
  const value = String(input || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!value || value === "." || value.split("/").some((part) => part === "..")) throw new Error("Unsafe channel-world path.");
  return value.startsWith("workspace/") || value.startsWith("files/") ? value : `workspace/${value}`;
}

function resolveHostWorldPath(channelId: number, worldRelative: string): string {
  const rel = normalizeWorldRelative(worldRelative);
  const root = resolve(hostWorldRoot(channelId));
  const target = resolve(root, rel);
  if (target !== root && !target.startsWith(root + sep)) throw new Error("Unsafe channel-world path.");
  return target;
}

function resolveContainerCli(): string {
  for (const candidate of CONTAINER_CANDIDATES) {
    if (candidate.includes("/") ? existsSync(candidate) : spawnSync("/usr/bin/which", [candidate], { stdio: "ignore" }).status === 0) return candidate;
  }
  throw new Error("Apple container runtime is not installed. 1Helm can guide the one-time installation from Computer setup.");
}

function resolveOciHelper(): string {
  if (platform() === "win32") return "/usr/libexec/1helm-oci-runtime";
  if (process.env.HELM_INSTALL_KIND === "linux-systemd") {
    const installed = "/usr/libexec/1helm-oci-runtime";
    if (process.env.HELM_OCI_HELPER && process.env.HELM_OCI_HELPER !== installed) {
      throw new Error("The installed Linux service has an unsafe OCI helper path.");
    }
    if (existsSync(installed)) return installed;
    throw new Error("The installed Linux OCI runtime helper is missing; source-tree fallback is disabled for systemd installations.");
  }
  for (const candidate of OCI_HELPER_CANDIDATES) if (existsSync(candidate)) return candidate;
  throw new Error("1Helm's root-owned OCI runtime helper is not installed.");
}

function resolveWslCli(): string {
  if (windowsSystemAccount()) throw new Error("1Helm cannot use WSL while running as Windows Local System. Launch 1Helm in the signed-in Windows user's session so WSL and its retained distributions are available.");
  const candidates = [process.env.HELM_WSL_CLI, process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "wsl.exe") : "", "wsl.exe"].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (candidate.includes("/") || candidate.includes("\\")) { if (existsSync(candidate)) return candidate; }
    else if (spawnSync(candidate, ["--status"], { stdio: "ignore", timeout: 10_000 }).status === 0) return candidate;
  }
  throw new Error("WSL 2 is not installed. Run Windows' verified 1Helm setup as Administrator once.");
}

/** WSL distributions are scoped to an interactive Windows user and Microsoft
 * explicitly rejects Local System. This accepts injected values for CI. */
export function windowsSystemAccount(env: NodeJS.ProcessEnv = process.env, hostPlatform = platform()): boolean {
  if (hostPlatform !== "win32") return false;
  const username = String(env.USERNAME || env.USER || "").trim().toLowerCase();
  const profile = String(env.USERPROFILE || "").replaceAll("/", "\\").toLowerCase();
  return username === "system" || profile.endsWith("\\windows\\system32\\config\\systemprofile");
}

function appendLimited(chunks: Buffer[], chunk: Buffer, byteState: { value: number }, limit = 8 * 1024 * 1024): void {
  if (byteState.value >= limit) return;
  const accepted = chunk.subarray(0, Math.max(0, limit - byteState.value));
  chunks.push(accepted);
  byteState.value += accepted.length;
}

function spawnCollected(command: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: Buffer | Readable; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<{ code: number; stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env || process.env, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const stdoutBytes = { value: 0 }, stderrBytes = { value: 0 };
    child.stdout.on("data", (chunk: Buffer) => appendLimited(stdout, chunk, stdoutBytes));
    child.stderr.on("data", (chunk: Buffer) => appendLimited(stderr, chunk, stderrBytes));
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5_000).unref(); }, opts.timeoutMs || COMMAND_TIMEOUT_MS);
    const abort = (): void => { child.kill("SIGTERM"); };
    opts.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => { if (settled) return; settled = true; clearTimeout(timeout); opts.signal?.removeEventListener("abort", abort); reject(error); });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      opts.signal?.removeEventListener("abort", abort);
      if (opts.signal?.aborted) { const error = new Error("Channel computer command was cancelled."); error.name = "AbortError"; reject(error); return; }
      if (timedOut) { reject(new Error(`Channel computer command timed out after ${Math.round((opts.timeoutMs || COMMAND_TIMEOUT_MS) / 1000)} seconds.`)); return; }
      resolvePromise({ code: code ?? (signal ? 128 : 1), stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    if (Buffer.isBuffer(opts.input)) { child.stdin.end(opts.input); }
    else if (opts.input) { opts.input.pipe(child.stdin); }
    else child.stdin.end();
  });
}

async function apple(args: string[], opts: Parameters<typeof spawnCollected>[2] = {}): Promise<{ code: number; stdout: Buffer; stderr: Buffer }> {
  return spawnCollected(resolveContainerCli(), args, opts);
}

async function resolveContainerCliAsync(): Promise<string> {
  for (const candidate of CONTAINER_CANDIDATES) {
    if (candidate.includes("/")) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    try {
      const result = await spawnCollected("/usr/bin/which", [candidate], { timeoutMs: 10_000 });
      if (result.code === 0) return candidate;
    } catch { /* try the next supported location */ }
  }
  throw new Error("Apple container runtime is not installed. 1Helm can guide the one-time installation from Computer setup.");
}

async function resolveWslCliAsync(): Promise<string> {
  if (windowsSystemAccount()) throw new Error("1Helm cannot use WSL while running as Windows Local System. Launch 1Helm in the signed-in Windows user's session so WSL and its retained distributions are available.");
  const candidates = [process.env.HELM_WSL_CLI, process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "wsl.exe") : "", "wsl.exe"].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    try {
      const result = await spawnCollected(candidate, ["--status"], { timeoutMs: 10_000 });
      if (result.code === 0) return candidate;
    } catch { /* try the next supported location */ }
  }
  throw new Error("WSL 2 is not installed. Run Windows' verified 1Helm setup as Administrator once.");
}

/** Keep the in-WSL OCI helper synchronized with the packaged app so hotfixes and updates apply. */
let windowsOciHelperDigest = "";
let windowsOciHelperInstallPass: Promise<void> | null = null;
function ensureWindowsOciHelperInstalled(): void {
  if (platform() !== "win32") return;
  const appRoot = process.env.HELM_APP_ROOT || process.cwd();
  const source = join(appRoot, "scripts", "1helm-oci-runtime");
  if (!existsSync(source)) return;
  const encoded = readFileSync(source);
  const digest = createHash("sha256").update(encoded).digest("hex");
  if (windowsOciHelperDigest === digest) return;
  const runtime = installationScopedRuntimeName();
  const wsl = resolveWslCli();
  // Wake the distro first; cold start can exceed a short copy timeout.
  spawnSync(wsl, ["--distribution", runtime, "--user", "root", "--exec", "/bin/true"], {
    encoding: "buffer", timeout: 120_000, windowsHide: true,
  });
  // Copy via wsl so we never depend on a ready \\wsl.localhost mount race.
  const result = spawnSync(wsl, [
    "--distribution", runtime, "--user", "root", "--exec", "/bin/bash", "-lc",
    "cat > /usr/libexec/1helm-oci-runtime && chmod 0755 /usr/libexec/1helm-oci-runtime",
  ], { input: encoded, encoding: "buffer", timeout: 60_000, windowsHide: true });
  if (result.status !== 0) {
    const detail = Buffer.concat([
      Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
      Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
    ]).toString("utf8").replaceAll("\0", " ").trim();
    throw new Error(detail || "Could not install the shared OCI runtime helper into the Windows WSL runtime.");
  }
  windowsOciHelperDigest = digest;
}

/** Async twin used by readiness and preparation. The older synchronous helper
 * remains only for synchronous Windows storage APIs, never for HTTP readiness. */
async function ensureWindowsOciHelperInstalledAsync(): Promise<void> {
  if (platform() !== "win32") return;
  const appRoot = process.env.HELM_APP_ROOT || process.cwd();
  const source = join(appRoot, "scripts", "1helm-oci-runtime");
  if (!existsSync(source)) return;
  const encoded = readFileSync(source);
  const digest = createHash("sha256").update(encoded).digest("hex");
  if (windowsOciHelperDigest === digest) return;
  if (windowsOciHelperInstallPass) return windowsOciHelperInstallPass;
  const pass = (async () => {
    const runtime = installationScopedRuntimeName();
    const wsl = await resolveWslCliAsync();
    try {
      await spawnCollected(wsl, ["--distribution", runtime, "--user", "root", "--exec", "/bin/true"], { timeoutMs: 120_000 });
    } catch { /* the copy below reports an actionable error */ }
    const result = await spawnCollected(wsl, [
      "--distribution", runtime, "--user", "root", "--exec", "/bin/bash", "-lc",
      "cat > /usr/libexec/1helm-oci-runtime && chmod 0755 /usr/libexec/1helm-oci-runtime",
    ], { input: encoded, timeoutMs: 60_000 });
    if (result.code !== 0) {
      const detail = windowsLines(Buffer.concat([result.stderr, result.stdout])).join(" ").trim();
      throw new Error(detail || "Could not install the shared OCI runtime helper into the Windows WSL runtime.");
    }
    windowsOciHelperDigest = digest;
  })();
  windowsOciHelperInstallPass = pass;
  try { await pass; }
  finally { if (windowsOciHelperInstallPass === pass) windowsOciHelperInstallPass = null; }
}

/**
 * Create OCI channel workspace dirs inside the WSL runtime as root.
 * Host-side mkdir on \\wsl.localhost\\... fails on Windows (permissions / 9p / distro-not-ready).
 * The live failure was: UNKNOWN mkdir '...\\workspace\\notes' after a successful container provision.
 */
export function ensureOciChannelWorkspaceDirs(channelId: number): void {
  const machineId = String(channelComputer(channelId)?.machine_id || "").trim()
    || `1helm-${String(q1("SELECT installation_id FROM workspace WHERE id=1")?.installation_id || "")}-channel-${channelId}`;
  if (!/^1helm-[a-f0-9]{16}-channel-\d+$/.test(machineId)) {
    throw new Error("Channel computer identity is not ready for workspace layout.");
  }
  if (platform() !== "win32") {
    const root = channelFilesystemRoot(channelId);
    mkdirSync(join(root, "workspace"), { recursive: true });
    mkdirSync(join(root, "files"), { recursive: true });
    for (const directory of ["notes", "whiteboards", "code", "docs", "presentations"]) {
      mkdirSync(join(root, "workspace", directory), { recursive: true });
    }
    return;
  }
  ensureWindowsOciHelperInstalled();
  const runtime = installationScopedRuntimeName();
  const wsl = resolveWslCli();
  // Workspace/files must be reachable from the Windows host Files/Cowork UI via
  // \\wsl.localhost\...  Mode 0700 agent-only makes Node existsSync/readdir look
  // like "Folder not found." The distro has no Windows interop/automount, so
  // opening these trees for the distro owner is the intended host-access path.
  const script = [
    "set -euo pipefail",
    `root="/var/lib/1helm-oci-v1/runtime/oci/channels/${machineId}"`,
    // 0711 root matches the helper's verify_storage contract. workspace/files
    // stay agent-owned 0700; Windows Files/Cowork use storage-* helper ops,
    // never the disabled-interop 9p share.
    'install -d -o root -g root -m 0711 "$root"',
    'chmod 0711 "$root" || true',
    'chown root:root "$root" || true',
    'install -d -o 1000 -g 1000 -m 0700 "$root/workspace" "$root/files" "$root/home"',
    "for d in notes whiteboards code docs presentations; do",
    '  install -d -o 1000 -g 1000 -m 0700 "$root/workspace/$d"',
    "done",
  ].join("\n");
  const result = spawnSync(wsl, [
    "--distribution", runtime, "--user", "root", "--exec", "/bin/bash", "-lc", script,
  ], { encoding: "buffer", timeout: 60_000, windowsHide: true });
  if (result.status !== 0) {
    const detail = Buffer.concat([
      Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
      Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
    ]).toString("utf8").replaceAll("\0", " ").trim();
    throw new Error(detail || "Could not create the channel workspace directories inside the Windows WSL runtime.");
  }
}

/**
 * Windows OCI host access for Files/Cowork.
 *
 * Isolation keeps WSL interop disabled, which also kills the 9p file server
 * behind \\wsl.localhost. Direct Node fs against that UNC path can never work.
 * All host-side Files/Cowork IO therefore goes through the OCI helper's
 * storage-* operations (wsl.exe --exec → 1helm-oci-runtime).
 */
export function windowsOciStorageRequired(channelId: number): boolean {
  return platform() === "win32" && channelUsesRuntimeStorage(channelId);
}

/** @deprecated No longer probes UNC; kept as a no-op for call-site stability. */
export function ensureWindowsOciHostAccess(channelId: number): void {
  if (!windowsOciStorageRequired(channelId)) return;
  ensureOciChannelWorkspaceDirs(channelId);
}

type StorageArea = "workspace" | "files";
type StorageEntry = { name: string; kind: "file" | "directory"; size: number; modified: number };

function storageMachineAndOwner(channelId: number): { name: string; owner: string } {
  const computer = ensureChannelComputerRecord(channelId);
  return { name: computer.machine_id, owner: ownerMarker(computer) };
}

function ociStorageJson(args: string[], opts: { input?: Buffer; timeoutMs?: number } = {}): unknown {
  const invocation = ociInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "buffer",
    timeout: opts.timeoutMs || 60_000,
    env: invocation.env,
    windowsHide: true,
    input: opts.input,
  });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0);
  if (result.status !== 0) {
    const detail = windowsLines(Buffer.concat([stderr, stdout])).join(" ").replace(/^1Helm OCI runtime:\s*/i, "").trim();
    throw new Error(detail || `storage operation failed (exit ${result.status ?? "timeout"})`);
  }
  const text = windowsLines(stdout).join("\n").trim() || Buffer.from(stdout).toString("utf8").replaceAll("\0", "").trim();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { throw new Error("storage operation returned unreadable JSON"); }
}

function ociStorageBytes(args: string[], opts: { input?: Buffer; timeoutMs?: number } = {}): Buffer {
  const invocation = ociInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "buffer",
    timeout: opts.timeoutMs || 60_000,
    env: invocation.env,
    windowsHide: true,
    input: opts.input,
  });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0);
  if (result.status !== 0) {
    const detail = windowsLines(Buffer.concat([stderr, stdout])).join(" ").replace(/^1Helm OCI runtime:\s*/i, "").trim();
    throw new Error(detail || `storage operation failed (exit ${result.status ?? "timeout"})`);
  }
  // Binary body: do not strip NULs via windowsLines.
  return Buffer.from(stdout);
}

export function windowsOciStorageList(channelId: number, area: StorageArea, relative = ""): StorageEntry[] {
  const { name, owner } = storageMachineAndOwner(channelId);
  const payload = ociStorageJson(["storage-list", name, owner, area, ...(relative ? [relative] : [])]) as { entries?: StorageEntry[] };
  return Array.isArray(payload?.entries) ? payload.entries : [];
}

export function windowsOciStorageStat(channelId: number, area: StorageArea, relative = ""): StorageEntry & { exists: boolean } {
  const { name, owner } = storageMachineAndOwner(channelId);
  return ociStorageJson(["storage-stat", name, owner, area, ...(relative ? [relative] : [])]) as StorageEntry & { exists: boolean };
}

export function windowsOciStorageMkdir(channelId: number, area: StorageArea, relative: string): StorageEntry {
  const { name, owner } = storageMachineAndOwner(channelId);
  return ociStorageJson(["storage-mkdir", name, owner, area, relative]) as StorageEntry;
}

export function windowsOciStorageWrite(channelId: number, area: StorageArea, relative: string, body: Buffer | string, mode: "create" | "overwrite" = "overwrite"): StorageEntry {
  const { name, owner } = storageMachineAndOwner(channelId);
  const input = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  return ociStorageJson(["storage-write", name, owner, area, relative, mode], { input }) as StorageEntry;
}

export function windowsOciStorageRead(channelId: number, area: StorageArea, relative: string): Buffer {
  const { name, owner } = storageMachineAndOwner(channelId);
  return ociStorageBytes(["storage-read", name, owner, area, relative]);
}

export function windowsOciStorageRm(channelId: number, area: StorageArea, relative: string, recursive = false): void {
  const { name, owner } = storageMachineAndOwner(channelId);
  ociStorageJson(["storage-rm", name, owner, area, relative, recursive ? "1" : "0"]);
}

export function windowsOciStorageRename(channelId: number, area: StorageArea, from: string, to: string): StorageEntry {
  const { name, owner } = storageMachineAndOwner(channelId);
  return ociStorageJson(["storage-rename", name, owner, area, from, to]) as StorageEntry;
}

export function windowsOciStorageCopy(channelId: number, area: StorageArea, from: string, to: string): StorageEntry {
  const { name, owner } = storageMachineAndOwner(channelId);
  return ociStorageJson(["storage-copy", name, owner, area, from, to]) as StorageEntry;
}

function linuxOciInvocation(args: string[]): { command: string; args: string[]; env?: NodeJS.ProcessEnv } {
  const helper = resolveOciHelper();
  if (process.env.HELM_OCI_HELPER_USE_SUDO === "0" || process.getuid?.() === 0) {
    const appRoot = process.env.HELM_APP_ROOT || process.cwd();
    return {
      command: helper,
      args,
      env: {
        ...process.env,
        ...(helper === join(appRoot, "scripts", "1helm-oci-runtime") ? {
          HELM_OCI_RUNTIME_MANIFEST: process.env.HELM_OCI_RUNTIME_MANIFEST || join(appRoot, "deploy", "1helm-oci-runtime-v1.conf"),
          HELM_OCI_STATE_ROOT_OVERRIDE: process.env.HELM_OCI_STATE_ROOT_OVERRIDE || ociHostStateRoot(),
          HELM_OCI_CONTAINERFILE_OVERRIDE: process.env.HELM_OCI_CONTAINERFILE_OVERRIDE || join(appRoot, "container", "Containerfile.oci"),
          HELM_OCI_IMAGE_ARCHIVE_OVERRIDE: process.env.HELM_OCI_IMAGE_ARCHIVE_OVERRIDE || join(appRoot, "container", "channel-machine.oci.tar"),
          HELM_OCI_IMAGE_SHA256_FILE_OVERRIDE: process.env.HELM_OCI_IMAGE_SHA256_FILE_OVERRIDE || join(appRoot, "container", "channel-machine.oci.sha256"),
          // Development checkouts without a sealed archive may still live-build.
          HELM_OCI_ALLOW_LIVE_BUILD: process.env.HELM_OCI_ALLOW_LIVE_BUILD || (existsSync(join(appRoot, "container", "channel-machine.oci.tar")) ? "0" : "1"),
        } : {}),
      },
    };
  }
  return { command: "sudo", args: ["-n", helper, ...args] };
}

function ociInvocation(args: string[]): { command: string; args: string[]; env?: NodeJS.ProcessEnv } {
  if (platform() === "win32") {
    ensureWindowsOciHelperInstalled();
    return { command: resolveWslCli(), args: ["--distribution", installationScopedRuntimeName(), "--user", "root", "--exec", "/usr/libexec/1helm-oci-runtime", ...args] };
  }
  return linuxOciInvocation(args);
}

async function ociAsyncInvocation(args: string[]): Promise<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> {
  if (platform() === "win32") {
    await ensureWindowsOciHelperInstalledAsync();
    const wsl = await resolveWslCliAsync();
    return { command: wsl, args: ["--distribution", installationScopedRuntimeName(), "--user", "root", "--exec", "/usr/libexec/1helm-oci-runtime", ...args] };
  }
  return linuxOciInvocation(args);
}

async function oci(args: string[], opts: Parameters<typeof spawnCollected>[2] = {}): Promise<{ code: number; stdout: Buffer; stderr: Buffer }> {
  const invocation = ociInvocation(args);
  return spawnCollected(invocation.command, invocation.args, { ...opts, env: invocation.env || opts.env });
}

/** OCI call path for readiness/preparation: even Windows helper sync and WSL
 * discovery are asynchronous, so a background refresh can never stall Node. */
async function ociAsync(args: string[], opts: Parameters<typeof spawnCollected>[2] = {}): Promise<{ code: number; stdout: Buffer; stderr: Buffer }> {
  const invocation = await ociAsyncInvocation(args);
  return spawnCollected(invocation.command, invocation.args, { ...opts, env: invocation.env || opts.env });
}

const ownerMarker = (computer: ChannelComputer): string => `${installationId()}:${computer.channel_id}`;

function isolatedInvocation(args: string[], computer: ChannelComputer, user: "agent" | "root" = "agent", workdir = "/workspace", terminal = false, pipeInput = false): { command: string; args: string[]; env?: NodeJS.ProcessEnv } {
  if (computer.backend === "apple") {
    const words = ["machine", "run", ...(terminal ? ["-it"] : pipeInput ? ["-i"] : []), ...(user === "root" ? ["--root"] : []), "-n", computer.machine_id, "-w", workdir, "--"];
    return { command: resolveContainerCli(), args: [...words, ...guestWords(...args)] };
  }
  if (computer.backend === "oci") {
    const helperArgs = terminal
      ? ["terminal", computer.machine_id, ownerMarker(computer)]
      : ["exec", computer.machine_id, ownerMarker(computer), user, workdir, "--", ...args];
    const invocation = ociInvocation(helperArgs);
    return invocation;
  }
  throw new Error(`Backend ${computer.backend} is not an isolated channel computer.`);
}

async function isolated(args: string[], computer: ChannelComputer, user: "agent" | "root" = "agent", workdir = "/workspace", opts: Parameters<typeof spawnCollected>[2] = {}): Promise<{ code: number; stdout: Buffer; stderr: Buffer }> {
  const invocation = isolatedInvocation(args, computer, user, workdir, false, Boolean(opts.input));
  return spawnCollected(invocation.command, invocation.args, { ...opts, env: invocation.env || opts.env });
}

const APPLE_GUEST_NETWORK_CHECK = "test \"$(cat /sys/class/net/eth0/operstate 2>/dev/null)\" = up && ip route show default | grep -q .";

async function appleGuestNetworkHealthy(computer: ChannelComputer): Promise<boolean> {
  if (computer.backend !== "apple") return true;
  const checked = await isolated(["/bin/sh", "-lc", APPLE_GUEST_NETWORK_CHECK], computer, "root", "/", { timeoutMs: 15_000 });
  return checked.code === 0;
}

/** Apple container 1.1.0 can leave every machine reported as running while
 * its shared vmnet service has detached their NICs. Restart only that service,
 * then reboot the affected VM so its durable disk receives a fresh attachment. */
async function repairAppleGuestNetwork(computer: ChannelComputer): Promise<void> {
  if (computer.backend !== "apple") return;
  if (!appleNetworkRepair) {
    appleNetworkRepair = (async () => {
      // Avoid repeatedly bouncing shared vmnet while several machines detect
      // the same fleet-wide outage during one reconciliation pass.
      if (now() - appleNetworkRepairAt > 30_000) {
        const activeCommands = Number(q1("SELECT COUNT(*) n FROM channel_computer_obligations WHERE kind='command' AND status='active'")?.n || 0);
        const activeTurns = Number(q1("SELECT COUNT(*) n FROM agent_turns WHERE state='running'")?.n || 0);
        if (terminalSessions.size > 0 || activeCommands > 1 || activeTurns > 1) {
          throw new Error("resident computer network is unavailable; automatic repair is waiting for concurrent work to finish");
        }
        const stopped = await apple(["system", "stop"], { timeoutMs: 90_000 });
        const started = await apple(["system", "start"], { timeoutMs: 90_000 });
        if (stopped.code !== 0) throw new Error(stopped.stderr.toString("utf8").trim() || "Apple container services could not stop for network recovery");
        if (started.code !== 0) throw new Error(started.stderr.toString("utf8").trim() || "Apple container services could not restart");
        appleNetworkRepairAt = now();
      }
    })().finally(() => { appleNetworkRepair = null; });
  }
  await appleNetworkRepair;
  const competingCommands = Number(q1(`SELECT COUNT(*) n FROM channel_computer_obligations
    WHERE channel_id=? AND kind='command' AND status='active'`, computer.channel_id)?.n || 0);
  const runningTurns = Number(q1("SELECT COUNT(*) n FROM agent_turns WHERE channel_id=? AND state='running'", computer.channel_id)?.n || 0);
  if ([...terminalSessions.values()].some((session) => session.channelId === computer.channel_id)
      || competingCommands > 1 || runningTurns > 1) {
    throw new Error("resident computer network is unavailable; automatic repair is waiting for concurrent work to finish");
  }
  const stopped = await apple(["machine", "stop", computer.machine_id], { timeoutMs: 90_000 });
  if (stopped.code !== 0 && !/not running|stopped/i.test(Buffer.concat([stopped.stderr, stopped.stdout]).toString("utf8"))) {
    throw new Error(stopped.stderr.toString("utf8").trim() || "network repair could not stop the channel computer");
  }
  const restarted = await apple(["machine", "run", "-n", computer.machine_id, "--", ...guestWords("/bin/sh", "-lc", APPLE_GUEST_NETWORK_CHECK)], { timeoutMs: 90_000 });
  if (restarted.code !== 0 || !await appleGuestNetworkHealthy(computer)) throw new Error("channel computer network remained unavailable after automatic repair");
  run("UPDATE channel_computers SET observed_state='running',provision_status='ready',last_health=?,last_error='',updated=? WHERE channel_id=?", now(), now(), computer.channel_id);
  recordComputerActivity(computer.channel_id, "Recovered the resident computer's network without replacing its Linux disk.", "complete");
}

const isolatedBackend = (computer: ChannelComputer): boolean => ["apple", "oci"].includes(computer.backend);
const guestAgentIds = (computer: ChannelComputer): { uid: string; gid: string } => computer.backend === "apple"
  ? { uid: String(process.getuid?.() ?? 501), gid: String(process.getgid?.() ?? 20) }
  : { uid: "1000", gid: "1000" };

const transientGuestTransport = (result: { code: number; stdout: Buffer; stderr: Buffer }): boolean => result.code !== 0
  && /operation not supported on socket|inappropriate ioctl for device/i.test(Buffer.concat([result.stderr, result.stdout]).toString("utf8"));

async function setupNewAppleMachine(machineId: string, owner: string): Promise<{ code: number; stdout: Buffer; stderr: Buffer }> {
  const args = ["machine", "run", "--root", "-n", machineId, "--", ...guestWords("/bin/sh", "-lc",
    "set -eu; test \"$(cat /var/lib/1helm/image-contract)\" = 1helm-channel-machine-v1; mkdir -p /workspace/files; test -x /sbin/init; printf '%s\\n' \"$1\" > /var/lib/1helm/owner", "1helm-setup", owner)];
  let result = await apple(args, { timeoutMs: 60_000 });
  // Apple 1.1.0 can report its newly booted machine as created/running before
  // the first guest command socket accepts traffic. Retry only the two exact
  // transport-readiness errors observed from the signed runtime; never retry a
  // real guest setup failure or weaken the image/ownership checks.
  for (let attempt = 1; attempt < 6 && transientGuestTransport(result); attempt++) {
    await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 400));
    result = await apple(args, { timeoutMs: 60_000 });
  }
  return result;
}

// Apple container-machine commands are handed to /sbin.machine/init, whose
// `-s` path deliberately reconstructs them through the guest login shell as
// `<shell> -c "$*"`. Quote each intended argv word for that documented second
// parse; passing raw strings would turn spaces/semicolons into guest shell
// syntax before the requested executable receives them.
function guestWords(...words: string[]): string[] {
  return words.map((word) => `'${String(word).replaceAll("'", `'"'"'`)}'`);
}

function parsedInspection(output: Buffer): MachineInspection | null {
  try {
    const parsed = JSON.parse(output.toString("utf8"));
    return (Array.isArray(parsed) ? parsed[0] : parsed) as MachineInspection;
  } catch { return null; }
}

async function inspectApple(machineId: string): Promise<MachineInspection | null> {
  const result = await apple(["machine", "inspect", machineId], { timeoutMs: 30_000 });
  if (result.code !== 0) {
    const detail = Buffer.concat([result.stderr, result.stdout]).toString("utf8").trim();
    if (/not found|does not exist|no such (?:machine|virtual machine)|could not find/i.test(detail)) return null;
    throw new Error(detail || `could not inspect channel machine ${machineId}`);
  }
  const parsed = parsedInspection(result.stdout);
  if (!parsed) throw new Error(`Apple container returned an unreadable inspection for ${machineId}`);
  return parsed;
}

async function ensureAppleImage(image: string): Promise<void> {
  const existing = await apple(["image", "inspect", image], { timeoutMs: 30_000 });
  if (existing.code === 0) return;
  if (!image.startsWith("local/1helm-channel-machine:")) return;
  const appRoot = process.env.HELM_APP_ROOT || process.cwd();
  const context = join(appRoot, "container");
  const containerfile = join(context, "Containerfile");
  if (!existsSync(containerfile)) throw new Error("The packaged 1Helm channel-machine image recipe is missing.");
  const built = await apple(["build", "--platform", "linux/arm64", "--progress", "plain", "-t", image, "-f", containerfile, context], { timeoutMs: 30 * 60_000 });
  if (built.code !== 0) throw new Error(built.stderr.toString("utf8").trim() || built.stdout.toString("utf8").trim() || "channel machine image build failed");
  const verified = await apple(["image", "inspect", image], { timeoutMs: 30_000 });
  if (verified.code !== 0) throw new Error("The channel machine image did not exist after its build completed.");
}

function recordObserved(computer: ChannelComputer, inspection: MachineInspection | null, error = ""): void {
  if (!inspection) {
    run("UPDATE channel_computers SET observed_state='missing',last_error=?,updated=? WHERE channel_id=?", error.slice(0, 1000), now(), computer.channel_id);
    return;
  }
  run(`UPDATE channel_computers SET observed_state=?,cpus=?,memory_bytes=?,disk_bytes=?,home_mount='none',provision_status='ready',last_health=?,last_error='',updated=? WHERE channel_id=?`,
    String(inspection.status || "unknown"), Number(inspection.cpus || computer.cpus), Number(inspection.memory || computer.memory_bytes),
    MANAGED_CHANNEL_DISK_BYTES, now(), now(), computer.channel_id);
}

async function ensureAppleProvisioned(computer: ChannelComputer): Promise<void> {
  let inspection: MachineInspection | null = null;
  try { inspection = await inspectApple(computer.machine_id); } catch (error) {
    run("UPDATE channel_computers SET provision_status='error',last_error=?,updated=? WHERE channel_id=?", (error as Error).message.slice(0, 1000), now(), computer.channel_id);
    throw error;
  }
  if (inspection) {
    if (inspection.homeMount !== "none") {
      throw new Error(`Refusing to adopt ${computer.machine_id}: its home mount is ${inspection.homeMount || "unknown"}, not none.`);
    }
    const ownership = await apple(["machine", "run", "-n", computer.machine_id, "--", ...guestWords("/bin/cat", "/var/lib/1helm/owner")], { timeoutMs: 30_000 });
    const expectedOwner = `${installationId()}:${computer.channel_id}`;
    if (ownership.code !== 0 || ownership.stdout.toString("utf8").trim() !== expectedOwner) {
      throw new Error(`Refusing to adopt ${computer.machine_id}: its 1Helm ownership marker does not match this installation and channel.`);
    }
    recordObserved(computer, inspection);
    run("UPDATE channel_computers SET provision_status='ready',last_error='',updated=? WHERE channel_id=?", now(), computer.channel_id);
    run(`UPDATE agents SET status='ready' WHERE id=(SELECT agent_id FROM agent_channels WHERE channel_id=?) AND status='waiting'
      AND NOT EXISTS (SELECT 1 FROM threads WHERE channel_id=? AND status='waiting')`, computer.channel_id, computer.channel_id);
    return;
  }
  run("UPDATE channel_computers SET provision_status='provisioning',last_error='',updated=? WHERE channel_id=?", now(), computer.channel_id);
  // If a previously managed machine vanished, the narrow host mirror is the
  // recovery source. Force a full replay into the replacement rather than
  // creating an empty VM with an already-consumed change journal.
  markWorkspaceDirty(computer.channel_id, "*", "full");
  await ensureAppleImage(computer.image);
  const memory = `${Math.max(1024, Math.round(computer.memory_bytes / 1024 ** 2))}M`;
  const created = await apple(["machine", "create", computer.image, "--name", computer.machine_id, "--cpus", String(computer.cpus), "--memory", memory, "--home-mount", "none", "--progress", "none"], { timeoutMs: 15 * 60_000 });
  if (created.code !== 0) {
    const detail = created.stderr.toString("utf8").trim() || created.stdout.toString("utf8").trim() || "machine creation failed";
    run("UPDATE channel_computers SET provision_status='error',last_error=?,updated=? WHERE channel_id=?", detail.slice(0, 1000), now(), computer.channel_id);
    throw new Error(detail);
  }
  const setup = await setupNewAppleMachine(computer.machine_id, `${installationId()}:${computer.channel_id}`);
  if (setup.code !== 0) throw new Error(setup.stderr.toString("utf8").trim() || "machine workspace setup failed");
  inspection = await inspectApple(computer.machine_id);
  if (!inspection || inspection.homeMount !== "none") throw new Error("Provisioned machine failed the no-home-mount verification.");
  recordObserved(computer, inspection);
  run("UPDATE channel_computers SET provision_status='ready',desired_state='auto',last_update=?,last_update_attempt=?,last_error='',updated=? WHERE channel_id=?", now(), now(), now(), computer.channel_id);
  run(`UPDATE agents SET status='ready' WHERE id=(SELECT agent_id FROM agent_channels WHERE channel_id=?) AND status='waiting'
    AND NOT EXISTS (SELECT 1 FROM threads WHERE channel_id=? AND status='waiting')`, computer.channel_id, computer.channel_id);
  recordComputerActivity(computer.channel_id, "Provisioned a persistent isolated Linux computer with no Mac home mount.", "complete");
}

async function inspectOci(computer: ChannelComputer): Promise<MachineInspection | null> {
  // Cold WSL start + helper sync routinely exceeds 30s on Windows; use a longer floor.
  const inspectTimeout = platform() === "win32" ? 120_000 : 30_000;
  const result = await oci(["inspect", computer.machine_id, ownerMarker(computer)], { timeoutMs: inspectTimeout });
  if (result.code !== 0) {
    const detail = Buffer.concat([result.stderr, result.stdout]).toString("utf8").trim();
    if (/does not exist/i.test(detail)) return null;
    throw new Error(detail || `could not inspect OCI channel computer ${computer.machine_id}`);
  }
  if (result.stdout.toString("utf8").trim() === "null") return null;
  const parsed = parsedInspection(result.stdout);
  if (!parsed) throw new Error(`OCI runtime returned an unreadable inspection for ${computer.machine_id}`);
  return parsed;
}

function windowsLines(buffer: Buffer): string[] {
  const raw = buffer.toString("utf8");
  const decoded = raw.includes("\0") ? buffer.toString("utf16le") : raw;
  return decoded.replaceAll("\0", "").split(/\r?\n/).map((line) => line.trim().replace(/^\*\s*/, "")).filter(Boolean);
}

async function inspectIsolated(computer: ChannelComputer): Promise<MachineInspection | null> {
  if (computer.backend === "apple") return inspectApple(computer.machine_id);
  if (computer.backend === "oci") return inspectOci(computer);
  return null;
}

async function ensureOciProvisioned(computer: ChannelComputer): Promise<void> {
  let inspection = await inspectOci(computer);
  if (!inspection) {
    activeProvisioning.add(computer.channel_id);
    try {
      run("UPDATE channel_computers SET provision_status='provisioning',last_error='',updated=? WHERE channel_id=?", now(), computer.channel_id);
      let recovered = false;
      if (!existsSync(channelFilesystemRoot(computer.channel_id))) {
        const backups = await oci(["backups", computer.machine_id, ownerMarker(computer)], { timeoutMs: 5 * 60_000 });
        if (backups.code !== 0) throw new Error(backups.stderr.toString("utf8").trim() || "OCI recovery inventory failed");
        let available: Array<{ backup: string; sha256: string }> = [];
        try { available = JSON.parse(backups.stdout.toString("utf8")); } catch { throw new Error("OCI recovery inventory was unreadable"); }
        const latest = available[0];
        if (latest) {
          const restored = await oci(["restore", computer.machine_id, ownerMarker(computer), latest.backup, latest.sha256], { timeoutMs: 30 * 60_000 });
          if (restored.code !== 0) throw new Error(restored.stderr.toString("utf8").trim() || "OCI channel recovery failed");
          recovered = true;
          recordComputerActivity(computer.channel_id, "Recovered the channel computer from its latest digest-verified OCI backup.", "complete");
        }
      }
      if (!recovered) {
        const image = await oci(["image", computer.image], { timeoutMs: 30 * 60_000 });
        if (image.code !== 0) throw new Error(image.stderr.toString("utf8").trim() || image.stdout.toString("utf8").trim() || "OCI channel image build failed");
        const created = await oci(["create", computer.machine_id, ownerMarker(computer), String(computer.cpus), String(Math.round(computer.memory_bytes / 1024 ** 2)), computer.image], { timeoutMs: 30 * 60_000 });
        if (created.code !== 0) throw new Error(created.stderr.toString("utf8").trim() || created.stdout.toString("utf8").trim() || "OCI channel computer creation failed");
      }
      inspection = await inspectOci(computer);
      if (!inspection || inspection.homeMount !== "none" || inspection.status !== "running") throw new Error("Provisioned OCI computer failed its ownership, storage, or runtime verification.");
      recordComputerActivity(computer.channel_id, "Provisioned a durable OCI channel computer with runtime-owned storage.", "complete");
    } finally { activeProvisioning.delete(computer.channel_id); }
  } else if (inspection.status !== "running") {
    const started = await oci(["start", computer.machine_id, ownerMarker(computer)], { timeoutMs: 90_000 });
    if (started.code !== 0) throw new Error(started.stderr.toString("utf8").trim() || "OCI channel computer did not start");
    inspection = await inspectOci(computer);
  }
  recordObserved(computer, inspection);
  // Never mkdir through \\wsl.localhost on Windows — that is the post-provision failure mode.
  ensureOciChannelWorkspaceDirs(computer.channel_id);
  run("DELETE FROM channel_workspace_changes WHERE channel_id=?", computer.channel_id);
  run("UPDATE channel_computers SET provision_status='ready',desired_state='auto',synced_host_revision=host_revision,last_update=?,last_update_attempt=?,last_error='',updated=? WHERE channel_id=?", now(), now(), now(), computer.channel_id);
}

async function ensureNativeProvisioned(computer: ChannelComputer): Promise<void> {
  mkdirSync(hostWorkspace(computer.channel_id), { recursive: true });
  mkdirSync(hostFiles(computer.channel_id), { recursive: true });
  run("UPDATE channel_computers SET observed_state='running',provision_status='ready',last_health=?,last_error='',updated=? WHERE channel_id=?", now(), now(), computer.channel_id);
}

export async function provisionChannelComputer(channelId: number): Promise<ChannelComputer> {
  return withChannelLock(channelId, async () => {
    let computer = ensureChannelComputerRecord(channelId);
    if (computer.backend === "apple") { await ensureAppleRuntimeRunning(apple); await ensureAppleProvisioned(computer); }
    else if (computer.backend === "oci") await ensureOciProvisioned(computer);
    else await ensureNativeProvisioned(computer);
    computer = channelComputer(channelId)!;
    if (computer.backend === "apple") await syncHostChangesToGuest(computer);
    return channelComputer(channelId)!;
  });
}

export async function ensureChannelComputerRunning(channelId: number, reason = "channel activity"): Promise<ChannelComputer> {
  return withChannelLock(channelId, async () => {
    let computer = ensureChannelComputerRecord(channelId);
    const channel = q1("SELECT status FROM channels WHERE id=?", channelId);
    if (!channel || channel.status !== "active") throw new Error("Restore the channel before using its computer.");
    if (computer.desired_state === "stopped" || computer.desired_state === "deleted") throw new Error("Restore the channel before using its computer.");
    if (computer.backend === "apple") {
      await ensureAppleRuntimeRunning(apple);
      await ensureAppleProvisioned(computer);
      computer = channelComputer(channelId)!;
      // machine run is the supported boot path; this no-op also verifies the guest.
      const boot = await apple(["machine", "run", "-n", computer.machine_id, "--", ...guestWords("/bin/sh", "-lc", "set -eu; mkdir -p /workspace/files; test ! -d /Users || test -z \"$(find /Users -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)\"")], { timeoutMs: 90_000 });
      if (boot.code !== 0) throw new Error(boot.stderr.toString("utf8").trim() || "channel computer did not start");
      await syncHostChangesToGuest(computer);
      const inspection = await inspectApple(computer.machine_id);
      recordObserved(computer, inspection);
      if (!await appleGuestNetworkHealthy(computer)) await repairAppleGuestNetwork(computer);
    } else if (computer.backend === "oci") {
      await ensureOciProvisioned(computer);
      computer = channelComputer(channelId)!;
      // ensureOciProvisioned already inspects and recordObserved — a redundant
      // inspect here doubled the subprocess cost for every OCI channel request.
    } else await ensureNativeProvisioned(computer);
    run("UPDATE channel_computers SET last_used=?,last_error='',updated=? WHERE channel_id=?", now(), now(), channelId);
    recordComputerActivity(channelId, `Computer ready for ${reason}.`, "complete", true);
    return channelComputer(channelId)!;
  });
}

async function syncHostChangesToGuest(computer: ChannelComputer, attempt = 0): Promise<void> {
  if (!isolatedBackend(computer) || computer.backend === "oci") return;
  const targetRevision = Number(channelComputer(computer.channel_id)?.host_revision || computer.host_revision);
  const changes = q("SELECT relative_path,operation FROM channel_workspace_changes WHERE channel_id=? ORDER BY created", computer.channel_id);
  if (!changes.length) return;
  const full = changes.some((change) => change.operation === "full" || change.relative_path === "*");
  if (full) {
    mkdirSync(hostWorkspace(computer.channel_id), { recursive: true });
    mkdirSync(hostFiles(computer.channel_id), { recursive: true });
    validateMirrorTree(hostWorkspace(computer.channel_id));
    validateMirrorTree(hostFiles(computer.channel_id));
    const tar = spawn("tar", ["-C", hostWorldRoot(computer.channel_id), "-cf", "-", "workspace", "files"], { stdio: ["ignore", "pipe", "ignore"] });
    const tarClosed = new Promise<number>((resolvePromise) => tar.once("close", (code) => resolvePromise(code ?? 1)));
    const ids = guestAgentIds(computer);
    const applied = await isolated(["/bin/sh", "-lc", "set -eu; mkdir -p /workspace; find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; rm -rf /files; tar -xf - -C / --no-same-owner; mkdir -p /workspace/files; if test -d /files; then cp -a /files/. /workspace/files/; rm -rf /files; fi; chown -R \"$1:$2\" /workspace", "1helm-sync", ids.uid, ids.gid], computer, "root", "/", { input: tar.stdout!, timeoutMs: 5 * 60_000 });
    const tarCode = await tarClosed;
    if (tarCode !== 0 || applied.code !== 0) throw new Error(applied.stderr.toString("utf8").trim() || "workspace import failed");
  } else {
    for (const change of changes) {
      const rel = normalizeWorldRelative(String(change.relative_path));
      const guest = rel.startsWith("files/") ? `/workspace/${rel}` : `/${rel}`;
      const host = resolveHostWorldPath(computer.channel_id, rel);
      if (String(change.operation) === "delete" || !existsSync(host)) {
        const removed = await isolated(["/bin/rm", "-rf", "--", guest], computer, "root", "/");
        if (removed.code !== 0) throw new Error(removed.stderr.toString("utf8").trim() || `failed to remove ${rel}`);
        continue;
      }
      if (lstatSync(host).isSymbolicLink()) throw new Error(`refusing to import symlink ${rel} into a channel computer`);
      if (lstatSync(host).isDirectory()) validateMirrorTree(host);
      const parent = dirname(guest);
      const tar = spawn("tar", ["-C", dirname(host), "-cf", "-", basename(host)], { stdio: ["ignore", "pipe", "ignore"] });
      const tarClosed = new Promise<number>((resolvePromise) => tar.once("close", (code) => resolvePromise(code ?? 1)));
      const ids = guestAgentIds(computer);
      const applied = await isolated(["/bin/sh", "-lc", "set -eu; mkdir -p \"$1\"; rm -rf -- \"$1/$2\"; tar -xf - -C \"$1\" --no-same-owner; chown -R \"$3:$4\" \"$1/$2\"", "1helm-sync", parent, basename(guest), ids.uid, ids.gid], computer, "root", "/", { input: tar.stdout!, timeoutMs: 5 * 60_000 });
      const tarCode = await tarClosed;
      if (tarCode !== 0 || applied.code !== 0) throw new Error(applied.stderr.toString("utf8").trim() || `failed to import ${rel}`);
    }
  }
  // A host upload can arrive while the tar/CLI processes are awaiting I/O.
  // Only consume the change journal when the exact revision we copied is
  // still current; otherwise leave it intact and safely replay it.
  const currentRevision = Number(channelComputer(computer.channel_id)?.host_revision || 0);
  if (currentRevision === targetRevision) {
    run("DELETE FROM channel_workspace_changes WHERE channel_id=?", computer.channel_id);
    run("UPDATE channel_computers SET synced_host_revision=?,updated=? WHERE channel_id=?", targetRevision, now(), computer.channel_id);
    return;
  }
  if (attempt >= 2) throw new Error("channel files kept changing during guest import; a later fleet-care pass will retry");
  await syncHostChangesToGuest(channelComputer(computer.channel_id) || computer, attempt + 1);
}

export async function syncGuestToHost(channelId: number): Promise<void> {
  return withChannelLock(channelId, async () => {
    const computer = channelComputer(channelId);
    if (!computer) return;
    await syncGuestToHostUnlocked(computer);
  });
}

/** Freshen the host mirror for Files/open/attach without booting a stopped VM. */
export async function refreshChannelWorkspaceMirror(channelId: number): Promise<void> {
  const computer = channelComputer(channelId);
  if (!computer || !isolatedBackend(computer) || computer.backend === "oci" || computer.observed_state !== "running") return;
  const current = workspaceMirrorRefreshes.get(channelId);
  if (current) return current;
  const refresh = syncGuestToHost(channelId).finally(() => {
    if (workspaceMirrorRefreshes.get(channelId) === refresh) workspaceMirrorRefreshes.delete(channelId);
  });
  workspaceMirrorRefreshes.set(channelId, refresh);
  await refresh;
}

/** Resolve an agent artifact only after its canonical guest filesystem is mirrored. */
export async function prepareChannelWorkspaceArtifact(channelId: number): Promise<void> {
  await refreshChannelWorkspaceMirror(channelId);
}

export async function runChannelCommand(channelId: number, command: string, signal?: AbortSignal): Promise<ComputerCommandResult> {
  const obligationRef = `command:${randomBytes(8).toString("hex")}`;
  ensureChannelComputerRecord(channelId);
  upsertObligation(channelId, "command", obligationRef, "resident", command.slice(0, 500));
  try {
    const computer = await ensureChannelComputerRunning(channelId, "an agent command");
    if (!isolatedBackend(computer)) {
      const shell = process.env.SHELL || "/bin/bash";
      const result = await spawnCollected(shell, ["-lc", command], { cwd: hostWorkspace(channelId), signal, timeoutMs: 5 * 60_000 });
      run("UPDATE channel_computers SET last_used=?,updated=? WHERE channel_id=?", now(), now(), channelId);
      return { status: "completed", exit_code: result.code, output: Buffer.concat([result.stdout, result.stderr]).toString("utf8").trim() };
    }
    const result = await isolated(["/bin/bash", "-lc", command], computer, "agent", "/workspace", { signal, timeoutMs: 5 * 60_000 });
    if (computer.backend !== "oci") await syncGuestToHost(channelId);
    run("UPDATE channel_computers SET last_used=?,updated=? WHERE channel_id=?", now(), now(), channelId);
    return { status: "completed", exit_code: result.code, output: Buffer.concat([result.stdout, result.stderr]).toString("utf8").trim() };
  } finally {
    satisfyObligation(channelId, "command", obligationRef);
  }
}

export async function openChannelTerminal(channelId: number, ownerId: number, cols: number, rows: number): Promise<string> {
  const id = `vmterm-${randomBytes(8).toString("hex")}`;
  ensureChannelComputerRecord(channelId);
  upsertObligation(channelId, "terminal", id, "resident", "Interactive channel terminal");
  let computer: ChannelComputer;
  try { computer = await ensureChannelComputerRunning(channelId, "an interactive terminal"); }
  catch (error) { satisfyObligation(channelId, "terminal", id); throw error; }
    const invocation = isolatedBackend(computer) ? isolatedInvocation(["/bin/bash", "-l"], computer, "agent", "/workspace", true) : null;
  const args = invocation?.args || [];
  const requestedShell = process.env.SHELL || "/bin/bash";
  const executable = invocation?.command || (requestedShell.startsWith("/") && existsSync(requestedShell) ? requestedShell : "/bin/bash");
  let pty: IPty;
  try {
    pty = spawnPty(executable, args, {
      name: "xterm-256color", cols: Math.max(20, cols || 80), rows: Math.max(5, rows || 24),
      cwd: invocation ? undefined : hostWorkspace(channelId), env: { ...process.env, ...invocation?.env, TERM: "xterm-256color" },
    });
  } catch (error) { satisfyObligation(channelId, "terminal", id); throw error; }
  const session: MachineTerminal = {
    id, channelId, ownerId, machineId: computer.machine_id, backend: computer.backend, pty, clients: new Set(), scrollback: [], bytes: 0,
    cols: Math.max(20, cols || 80), rows: Math.max(5, rows || 24), closed: false,
  };
  terminalSessions.set(id, session);
  pty.onData((data) => {
    const chunk = Buffer.from(data, "utf8");
    session.scrollback.push(chunk); session.bytes += chunk.length;
    while (session.bytes > SCROLLBACK_CAP && session.scrollback.length > 1) session.bytes -= session.scrollback.shift()!.length;
    for (const client of session.clients) if (client.readyState === client.OPEN) client.send(chunk);
    run("UPDATE channel_computers SET last_used=?,updated=? WHERE channel_id=?", now(), now(), channelId);
    const pending = syncTimers.get(channelId);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
      syncTimers.delete(channelId);
      if (terminalSessions.has(id) && session.backend === "apple") void syncGuestToHost(channelId).catch((error) => recordComputerError(channelId, error));
    }, 3_000);
    timer.unref();
    syncTimers.set(channelId, timer);
  });
  pty.onExit(() => { void finishTerminal(session); });
  return id;
}

async function finishTerminal(session: MachineTerminal): Promise<void> {
  if (session.closed) return;
  session.closed = true;
  terminalSessions.delete(session.id);
  for (const client of session.clients) try { client.close(); } catch { /* closed */ }
  satisfyObligation(session.channelId, "terminal", session.id);
  const timer = syncTimers.get(session.channelId);
  if (timer) { clearTimeout(timer); syncTimers.delete(session.channelId); }
  if (session.backend === "apple") await syncGuestToHost(session.channelId).catch((error) => recordComputerError(session.channelId, error));
}

export async function attachChannelTerminal(sessionId: string, client: WebSocket, ownerId: number): Promise<void> {
  const session = terminalSessions.get(sessionId);
  if (!session || session.closed || session.ownerId !== ownerId) { client.close(4004, "Session not found"); return; }
  for (const chunk of session.scrollback) client.send(chunk);
  session.clients.add(client);
  client.on("message", (raw: Buffer, isBinary: boolean) => {
    if (session.closed) return;
    if (isBinary) { session.pty.write(raw.toString("utf8")); return; }
    try {
      const message = JSON.parse(raw.toString("utf8"));
      if (message.type === "ping") { if (client.readyState === client.OPEN) client.send(JSON.stringify({ type: "pong", at: Date.now() })); }
      else if (message.type === "resize") { session.cols = Number(message.cols) || 80; session.rows = Number(message.rows) || 24; session.pty.resize(session.cols, session.rows); }
      else if (message.type === "input") session.pty.write(String(message.data || ""));
    } catch { session.pty.write(raw.toString("utf8")); }
  });
  client.on("close", () => session.clients.delete(client));
}

export function listChannelTerminals(ownerId: number, ownerChannelId?: number): { id: string; channelId: number; computerId: number; clients: number }[] {
  return [...terminalSessions.values()].filter((session) => session.ownerId === ownerId && (ownerChannelId == null || session.channelId === ownerChannelId))
    .map((session) => ({ id: session.id, channelId: session.channelId, computerId: 0, clients: session.clients.size }));
}

export function closeChannelTerminal(sessionId: string): void {
  const session = terminalSessions.get(sessionId);
  if (!session) return;
  try { session.pty.kill(); } catch { /* gone */ }
  void finishTerminal(session);
}

export function closeChannelComputerTerminals(channelId: number): void {
  for (const session of terminalSessions.values()) if (session.channelId === channelId) closeChannelTerminal(session.id);
}

export function hasChannelComputerTerminal(sessionId: string): boolean { return terminalSessions.has(sessionId); }

export async function stopChannelComputer(channelId: number, reason: "archive" | "idle" | "maintenance" = "idle"): Promise<void> {
  return withChannelLock(channelId, async () => {
    const computer = channelComputer(channelId);
    if (!computer) return;
    if (reason !== "archive" && !canStopChannelComputer(channelId)) return;
    if (reason === "archive") {
      run("UPDATE channel_computers SET desired_state='stopped',maintenance_state='draining',updated=? WHERE channel_id=?", now(), channelId);
      closeChannelComputerTerminals(channelId);
    }
    await syncGuestToHostUnlocked(computer);
    if (computer.backend === "apple") {
      const stopped = await apple(["machine", "stop", computer.machine_id], { timeoutMs: 90_000 });
      if (stopped.code !== 0 && !/not running|stopped/i.test(stopped.stderr.toString("utf8"))) throw new Error(stopped.stderr.toString("utf8").trim() || "machine stop failed");
    } else if (computer.backend === "oci") {
      const stopped = await oci(["stop", computer.machine_id, ownerMarker(computer)], { timeoutMs: 90_000 });
      if (stopped.code !== 0) throw new Error(stopped.stderr.toString("utf8").trim() || "OCI channel computer stop failed");
      if (reason === "archive") {
        const backedUp = await oci(["backup", computer.machine_id, ownerMarker(computer)], { timeoutMs: 30 * 60_000 });
        if (backedUp.code !== 0) throw new Error(backedUp.stderr.toString("utf8").trim() || "OCI channel computer backup failed");
        let backup = "";
        try { backup = String(JSON.parse(backedUp.stdout.toString("utf8")).backup || ""); } catch { /* activity remains useful without exposing a path */ }
        recordComputerActivity(channelId, `Created a digest-verified OCI recovery backup${backup ? ` (${backup})` : ""}.`, "complete");
      }
    }
    run("UPDATE channel_computers SET desired_state=?,observed_state='stopped',maintenance_state='idle',last_error='',updated=? WHERE channel_id=?", reason === "archive" ? "stopped" : "auto", now(), channelId);
    recordComputerActivity(channelId, reason === "archive" ? "Stopped the archived channel computer; its Linux disk is preserved." : "Stopped an idle, obligation-free channel computer.", "complete");
  });
}

async function syncGuestToHostUnlocked(computer: ChannelComputer): Promise<void> {
  if (!isolatedBackend(computer) || computer.backend === "oci" || !["running", "unknown"].includes(computer.observed_state)) return;
  // Avoid recursive lock: stop/maintenance and the public wrapper already own
  // this channel's lock. Host changes are authoritative when they race guest
  // work, so push the journal before taking the guest snapshot.
  for (let attempt = 0; attempt < 3; attempt++) {
    computer = channelComputer(computer.channel_id) || computer;
    await syncHostChangesToGuest(computer);
    const targetRevision = Number(channelComputer(computer.channel_id)?.host_revision || 0);
    const staging = `${hostWorldRoot(computer.channel_id)}.guest-sync-${randomBytes(6).toString("hex")}`;
    mkdirSync(staging, { recursive: true });
    try {
      // Guest workspaces legitimately contain symlinks (Python venvs are the
      // common case). The host mirror deliberately has no symlink semantics,
      // so export only ordinary directories/files. Symlinks remain durable in
      // the guest VM and can never be followed across the host boundary.
      const invocation = isolatedInvocation([
        "/bin/bash", "-lc",
        "set -o pipefail; cd /; find -P workspace -xdev \\( -type d -o -type f \\) -print0 | tar --null --no-recursion -T - -cf -",
      ], computer, "agent", "/workspace");
      const child = spawn(invocation.command, invocation.args, { stdio: ["ignore", "pipe", "pipe"] });
      const extract = spawn("tar", ["-C", staging, "-xf", "-", "--no-same-owner", "--no-same-permissions"], { stdio: ["pipe", "ignore", "pipe"] });
      let archiveBytes = 0, oversized = false;
      child.stdout!.on("data", (chunk: Buffer) => {
        archiveBytes += chunk.length;
        if (!oversized && archiveBytes > MAX_WORKSPACE_SYNC_BYTES + 64 * 1024 ** 2) {
          oversized = true;
          child.kill("SIGTERM");
          extract.kill("SIGTERM");
        }
      });
      // Always drain diagnostics so a noisy tar cannot deadlock either child.
      const childError: Buffer[] = [], extractError: Buffer[] = [];
      const childErrorBytes = { value: 0 }, extractErrorBytes = { value: 0 };
      child.stderr!.on("data", (chunk: Buffer) => appendLimited(childError, chunk, childErrorBytes, 64 * 1024));
      extract.stderr!.on("data", (chunk: Buffer) => appendLimited(extractError, chunk, extractErrorBytes, 64 * 1024));
      child.stdout!.pipe(extract.stdin!);
      const [one, two] = await Promise.all([
        new Promise<number>((r) => child.once("close", (c) => r(c ?? 1))),
        new Promise<number>((r) => extract.once("close", (c) => r(c ?? 1))),
      ]);
      if (oversized) throw new Error(`channel workspace exceeds the ${Math.round(MAX_WORKSPACE_SYNC_BYTES / 1024 ** 2)} MB mirror limit`);
      if (one || two) {
        const detail = Buffer.concat([...childError, ...extractError]).toString("utf8").trim();
        throw new Error(detail || "workspace export failed");
      }
      const stagedWorkspace = join(staging, "workspace");
      if (!existsSync(stagedWorkspace) || !lstatSync(stagedWorkspace).isDirectory()) throw new Error("guest workspace export was empty");
      const stagedFiles = join(staging, "files");
      const embeddedFiles = join(stagedWorkspace, "files");
      if (existsSync(embeddedFiles)) renameSync(embeddedFiles, stagedFiles);
      else mkdirSync(stagedFiles, { recursive: true });
      validateMirrorTree(stagedWorkspace);
      validateMirrorTree(stagedFiles);

      // An upload may have landed while the subprocesses were running. Replay
      // that journal and snapshot again instead of resurrecting stale guest
      // content over the newer host file.
      if (Number(channelComputer(computer.channel_id)?.host_revision || 0) !== targetRevision) continue;
      replaceHostMirror(computer.channel_id, stagedWorkspace, stagedFiles, staging);
      run("UPDATE channel_computers SET guest_revision=guest_revision+1,synced_host_revision=?,last_used=?,updated=? WHERE channel_id=?", targetRevision, now(), now(), computer.channel_id);
      return;
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  throw new Error("channel files kept changing during mirror sync; a later fleet-care pass will retry");
}

function validateMirrorTree(root: string): void {
  let entries = 0, bytes = 0;
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      entries++;
      if (entries > MAX_WORKSPACE_SYNC_ENTRIES) throw new Error("channel workspace contains too many entries to mirror safely");
      const path = join(dir, entry.name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) throw new Error("channel workspace symlinks cannot cross the host mirror boundary");
      if (info.isDirectory()) pending.push(path);
      else if (info.isFile()) {
        bytes += statSync(path).size;
        if (bytes > MAX_WORKSPACE_SYNC_BYTES) throw new Error(`channel workspace exceeds the ${Math.round(MAX_WORKSPACE_SYNC_BYTES / 1024 ** 2)} MB mirror limit`);
      } else throw new Error("channel workspace contains an unsupported filesystem entry");
    }
  }
}

function replaceHostMirror(channelId: number, stagedWorkspace: string, stagedFiles: string, staging: string): void {
  const workspace = hostWorkspace(channelId), files = hostFiles(channelId);
  const oldWorkspace = join(staging, "old-workspace"), oldFiles = join(staging, "old-files");
  mkdirSync(dirname(workspace), { recursive: true });
  let workspaceBackedUp = false, filesBackedUp = false, workspaceInstalled = false, filesInstalled = false;
  try {
    if (existsSync(workspace)) { renameSync(workspace, oldWorkspace); workspaceBackedUp = true; }
    if (existsSync(files)) { renameSync(files, oldFiles); filesBackedUp = true; }
    renameSync(stagedWorkspace, workspace); workspaceInstalled = true;
    renameSync(stagedFiles, files); filesInstalled = true;
  } catch (error) {
    if (filesInstalled && existsSync(files)) rmSync(files, { recursive: true, force: true });
    if (workspaceInstalled && existsSync(workspace)) rmSync(workspace, { recursive: true, force: true });
    if (filesBackedUp && existsSync(oldFiles)) renameSync(oldFiles, files);
    if (workspaceBackedUp && existsSync(oldWorkspace)) renameSync(oldWorkspace, workspace);
    throw error;
  }
  if (workspaceBackedUp) rmSync(oldWorkspace, { recursive: true, force: true });
  if (filesBackedUp) rmSync(oldFiles, { recursive: true, force: true });
}

export async function archiveChannelComputer(channelId: number): Promise<void> {
  await stopChannelComputer(channelId, "archive");
}

export async function restoreChannelComputer(channelId: number): Promise<void> {
  run("UPDATE channel_computers SET desired_state='auto',updated=? WHERE channel_id=?", now(), channelId);
  await ensureChannelComputerRunning(channelId, "channel restoration");
}

export async function deleteChannelComputer(channelId: number): Promise<void> {
  return withChannelLock(channelId, async () => {
    const computer = channelComputer(channelId);
    if (!computer) return;
    closeChannelComputerTerminals(channelId);
    if (computer.backend === "apple") {
      const inspection = await inspectApple(computer.machine_id);
      if (inspection) {
        if (inspection.homeMount !== "none") throw new Error("Refusing to delete a machine whose no-home-mount ownership invariant no longer holds.");
        const ownership = await apple(["machine", "run", "-n", computer.machine_id, "--", ...guestWords("/bin/cat", "/var/lib/1helm/owner")], { timeoutMs: 30_000 });
        const expectedOwner = `${installationId()}:${computer.channel_id}`;
        if (ownership.code !== 0 || ownership.stdout.toString("utf8").trim() !== expectedOwner) {
          throw new Error("Refusing to delete a channel machine whose 1Helm ownership marker does not match exactly.");
        }
        const stopped = await apple(["machine", "stop", computer.machine_id], { timeoutMs: 90_000 });
        if (stopped.code !== 0 && !/not running|stopped/i.test(stopped.stderr.toString("utf8"))) throw new Error(stopped.stderr.toString("utf8").trim() || "machine stop before deletion failed");
        const deleted = await apple(["machine", "delete", computer.machine_id], { timeoutMs: 90_000 });
        if (deleted.code !== 0) throw new Error(deleted.stderr.toString("utf8").trim() || "machine deletion failed");
      }
    } else if (computer.backend === "oci") {
      const inspection = await inspectOci(computer);
      if (inspection) {
        const deleted = await oci(["delete", computer.machine_id, ownerMarker(computer)], { timeoutMs: 5 * 60_000 });
        if (deleted.code !== 0) throw new Error(deleted.stderr.toString("utf8").trim() || "OCI channel computer deletion failed");
      }
    }
    run("UPDATE channel_computers SET desired_state='deleted',observed_state='deleted',provision_status='deleted',updated=? WHERE channel_id=?", now(), channelId);
  });
}

function listedAppleMachineIds(output: Buffer): string[] {
  try {
    const parsed = JSON.parse(output.toString("utf8"));
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.machines) ? parsed.machines : [];
    return rows.map((row: { id?: unknown; name?: unknown }) => String(row?.id || row?.name || "")).filter(Boolean);
  } catch { throw new Error("Apple container returned an unreadable machine list."); }
}

async function ownedInstallationMachineIds(): Promise<string[]> {
  const prefix = `1helm-${installationId()}-channel-`;
  const backend = configuredChannelBackend();
  let names: string[] = [];
  if (backend === "apple") {
    const listed = await apple(["machine", "list", "--format", "json"], { timeoutMs: 30_000 });
    if (listed.code !== 0) throw new Error(listed.stderr.toString("utf8").trim() || "Could not list Apple channel machines.");
    names = listedAppleMachineIds(listed.stdout);
  } else if (backend === "oci") {
    const listed = await oci(["list", prefix], { timeoutMs: 30_000 });
    if (listed.code !== 0) throw new Error(listed.stderr.toString("utf8").trim() || "Could not list OCI channel computers.");
    try { names = JSON.parse(listed.stdout.toString("utf8")); } catch { throw new Error("OCI runtime returned an unreadable container list."); }
  }
  return names.filter((id) => id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)));
}

/** Count exact installation-owned VMs that would survive moving the app to Trash. */
export async function appRemovalStatus(): Promise<{ backend: ChannelComputerBackend; machines: number }> {
  const backend = configuredChannelBackend();
  return { backend, machines: isolatedBackend({ backend } as ChannelComputer) ? (await ownedInstallationMachineIds()).length : 0 };
}

/**
 * Prepare for uninstall by deleting every VM carrying this installation's
 * exact name and in-guest ownership marker. Application Support is preserved
 * so an accidental app removal never destroys credentials or workspace data.
 */
export async function prepareAppRemoval(): Promise<{ backend: ChannelComputerBackend; deleted: number; remaining: number }> {
  const backend = configuredChannelBackend();
  if (!["apple", "oci"].includes(backend)) return { backend, deleted: 0, remaining: 0 };
  // Uninstall is a fleet-wide terminal state. Quiesce and fence the reconciler
  // before enumerating machines so an already-running pass cannot recreate a
  // machine from its stale pre-removal snapshot after deletion completes.
  await shutdownChannelComputers();
  const install = installationId();
  const prefix = `1helm-${install}-channel-`;
  const machineIds = await ownedInstallationMachineIds();
  let deleted = 0;
  for (const machineId of machineIds) {
    const channelId = Number(machineId.slice(prefix.length));
    const synthetic = channelComputer(channelId) || {
      channel_id: channelId, backend, machine_id: machineId, image: DEFAULT_CHANNEL_IMAGE, cpus: 2, memory_bytes: 2 * 1024 ** 3,
      disk_bytes: MANAGED_CHANNEL_DISK_BYTES, home_mount: "none", desired_state: "auto", observed_state: "unknown", provision_status: "ready",
      maintenance_state: "idle", low_pressure_streak: 0, host_revision: 0, synced_host_revision: 0, guest_revision: 0,
      last_health: 0, last_used: 0, last_update: 0, last_update_attempt: 0, last_error: "", created: now(), updated: now(),
    } as ChannelComputer;
    const inspection = await inspectIsolated(synthetic);
    if (!inspection) continue;
    if (inspection.homeMount !== "none") throw new Error(`Refusing to remove ${machineId}: its host-home isolation invariant no longer holds.`);
    const ownership = await isolated(["/bin/cat", "/var/lib/1helm/owner"], synthetic, "root", "/", { timeoutMs: 30_000 });
    if (ownership.code !== 0 || ownership.stdout.toString("utf8").trim() !== `${install}:${channelId}`) throw new Error(`Refusing to remove ${machineId}: its 1Helm ownership marker does not match exactly.`);
    const tracked = q1("SELECT channel_id FROM channel_computers WHERE machine_id=?", machineId);
    if (tracked) {
      await deleteChannelComputer(Number(tracked.channel_id));
      deleted++;
      continue;
    }
    let removed: { code: number; stdout: Buffer; stderr: Buffer };
    if (backend === "apple") {
      const stopped = await apple(["machine", "stop", machineId], { timeoutMs: 90_000 });
      if (stopped.code !== 0 && !/not running|stopped/i.test(Buffer.concat([stopped.stderr, stopped.stdout]).toString("utf8"))) throw new Error(stopped.stderr.toString("utf8").trim() || `Could not stop ${machineId}.`);
      removed = await apple(["machine", "delete", machineId], { timeoutMs: 90_000 });
    } else removed = await oci(["delete", machineId, `${install}:${channelId}`], { timeoutMs: 5 * 60_000 });
    if (removed.code !== 0) throw new Error(removed.stderr.toString("utf8").trim() || `Could not delete ${machineId}.`);
    run("UPDATE channel_computers SET desired_state='deleted',observed_state='deleted',provision_status='deleted',updated=? WHERE machine_id=?", now(), machineId);
    deleted++;
  }
  const remaining = (await ownedInstallationMachineIds()).length;
  if (remaining) throw new Error(`${remaining} 1Helm channel computer${remaining === 1 ? "" : "s"} remained after cleanup.`);
  return { backend, deleted, remaining };
}

/** A reinstall intentionally rebuilds VMs from the preserved host mirrors. */
export function reactivateComputersAfterPreparedRemoval(): void {
  run(`UPDATE channel_computers SET
    desired_state=CASE WHEN channel_id IN (SELECT id FROM channels WHERE status='archived') THEN 'stopped' ELSE 'auto' END,
    observed_state='missing',provision_status='pending',last_error='',updated=?
    WHERE desired_state='deleted' AND channel_id IN (SELECT id FROM channels WHERE kind='channel')`, now());
}

export function upsertObligation(channelId: number, kind: string, ref: string, mode: "resident" | "wakeable", details = "", dueAt?: number): void {
  if (!q1("SELECT 1 FROM channel_computers WHERE channel_id=?", channelId)) return;
  run(`INSERT INTO channel_computer_obligations (channel_id,kind,ref,mode,status,details,due_at,created,updated)
    VALUES (?,?,?,?,'active',?,?,?,?)
    ON CONFLICT(channel_id,kind,ref) DO UPDATE SET mode=excluded.mode,status='active',details=excluded.details,due_at=excluded.due_at,updated=excluded.updated`,
  channelId, kind.slice(0, 80), ref.slice(0, 200), mode, details.slice(0, 1000), dueAt ?? null, now(), now());
}

export function satisfyObligation(channelId: number, kind: string, ref: string): void {
  run("UPDATE channel_computer_obligations SET status='satisfied',updated=? WHERE channel_id=? AND kind=? AND ref=?", now(), channelId, kind, ref);
}

export function computerObligations(channelId: number): Row[] {
  return q(`SELECT kind,ref,mode,status,details,due_at,created,updated FROM channel_computer_obligations
    WHERE channel_id=? AND status='active' ORDER BY CASE mode WHEN 'resident' THEN 0 ELSE 1 END, COALESCE(due_at,created)`, channelId);
}

function detectGuestObligationsOutput(output: string): { resident: boolean; details: string[]; pressure: Record<string, number> } {
  const details: string[] = [];
  const values = new Map(output.split(/\r?\n/).filter(Boolean).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
  const services = Number(values.get("SERVICES") || 0), timers = Number(values.get("TIMERS") || 0), cron = Number(values.get("CRON") || 0), jobs = Number(values.get("JOBS") || 0), sockets = Number(values.get("SOCKETS") || 0), paths = Number(values.get("PATHS") || 0);
  if (services) details.push(`${services} non-system service process(es)`);
  if (timers) details.push(`${timers} active systemd timer(s)`);
  if (cron) details.push("cron schedule present");
  if (jobs) details.push(`${jobs} background session/process candidate(s)`);
  if (sockets) details.push(`${sockets} active systemd socket unit(s)`);
  if (paths) details.push(`${paths} active systemd path unit(s)`);
  return { resident: details.length > 0, details, pressure: { load1: Number(values.get("LOAD1") || 0), memoryAvailableKb: Number(values.get("MEM_AVAILABLE_KB") || 0), diskUsedPercent: Number(values.get("DISK_USED_PERCENT") || 0) } };
}

async function inspectGuestObligations(computer: ChannelComputer): Promise<{ resident: boolean; details: string[]; pressure: Record<string, number> }> {
  if (!isolatedBackend(computer) || computer.observed_state !== "running") return { resident: false, details: [], pressure: {} };
  const script = [
    "set -eu",
    "processes=$(ps -eo uid=,pid=,ppid=,comm=)",
    "timer_rows=$(systemctl list-timers --no-legend)",
    "socket_rows=$(systemctl list-units --type=socket --state=active --no-legend)",
    "path_rows=$(systemctl list-units --type=path --state=active --no-legend)",
    "services=$(printf '%s\\n' \"$processes\" | awk '$3==1 && $4 !~ /^(systemd|init|dbus-daemon|systemd-journal|systemd-journald|systemd-udevd|systemd-tmpfile|systemd-tmpfiles)$/ {n++} END{print n+0}')",
    "timers=$(printf '%s\\n' \"$timer_rows\" | awk '$0 !~ /(^|[[:space:]])systemd-tmpfiles-clean\\.timer([[:space:]]|$)/ && NF{n++} END{print n+0}')",
    "cron=0; systemctl is-active --quiet cron && cron=1 || true",
    "self=$$; uid=$(id -u); jobs=$(printf '%s\\n' \"$processes\" | awk -v uid=\"$uid\" -v self=\"$self\" '$1==uid && $2!=self && $3!=self && $4 !~ /^(ps|awk)$/ {n++} END{print n+0}')",
    "sockets=$(printf '%s\\n' \"$socket_rows\" | awk '$1 !~ /^(dbus|systemd-initctl|systemd-journald-dev-log|systemd-journald|systemd-sysext|systemd-udevd-control|systemd-udevd-kernel)\\.socket$/ && NF{n++} END{print n+0}')",
    "paths=$(printf '%s\\n' \"$path_rows\" | awk '$1 !~ /^systemd-ask-password-(console|wall)\\.path$/ && NF{n++} END{print n+0}')",
    "load=$(cut -d\" \" -f1 /proc/loadavg)",
    "mem=$(awk '/MemAvailable:/{print $2}' /proc/meminfo)",
    "disk=$(df -P / | awk 'NR==2{gsub(/%/,\"\",$5);print $5+0}')",
    "test -n \"$load\" && test -n \"$mem\" && test -n \"$disk\"",
    "printf 'SERVICES=%s\\nTIMERS=%s\\nCRON=%s\\nJOBS=%s\\nSOCKETS=%s\\nPATHS=%s\\nLOAD1=%s\\nMEM_AVAILABLE_KB=%s\\nDISK_USED_PERCENT=%s\\n' \"$services\" \"$timers\" \"$cron\" \"$jobs\" \"$sockets\" \"$paths\" \"$load\" \"$mem\" \"$disk\"",
  ].join("; ");
  const result = await isolated(["/bin/sh", "-lc", script], computer, "agent", "/workspace", { timeoutMs: 30_000 });
  if (result.code !== 0) return { resident: true, details: ["guest quiescence could not be proved"], pressure: {} };
  return detectGuestObligationsOutput(result.stdout.toString("utf8"));
}

export function canStopChannelComputer(channelId: number): boolean {
  if (terminalSessions.size && [...terminalSessions.values()].some((session) => session.channelId === channelId)) return false;
  if (q1("SELECT 1 FROM channel_computer_obligations WHERE channel_id=? AND status='active' AND mode='resident' LIMIT 1", channelId)) return false;
  if (q1("SELECT 1 FROM agents a JOIN agent_channels ac ON ac.agent_id=a.id WHERE ac.channel_id=? AND a.status='working'", channelId)) return false;
  return true;
}

async function maybeResize(computer: ChannelComputer, pressure: Record<string, number>): Promise<void> {
  return withChannelLock(computer.channel_id, async () => maybeResizeUnlocked(channelComputer(computer.channel_id) || computer, pressure));
}

async function maybeUpdate(computer: ChannelComputer): Promise<void> {
  return withChannelLock(computer.channel_id, async () => {
    computer = channelComputer(computer.channel_id) || computer;
    const stamp = now();
    if (!isolatedBackend(computer) || computer.observed_state !== "running" || !canStopChannelComputer(computer.channel_id)) return;
    if (stamp - Number(computer.last_update || computer.created) < UPDATE_EVERY_MS) return;
    if (stamp - Number(computer.last_update_attempt || 0) < UPDATE_RETRY_MS) return;
    const ref = `os-update:${stamp}`;
    upsertObligation(computer.channel_id, "maintenance", ref, "resident", "Skipper is applying unattended Linux security and package updates.");
    run("UPDATE channel_computers SET maintenance_state='updating',last_update_attempt=?,updated=? WHERE channel_id=?", stamp, stamp, computer.channel_id);
    try {
      const script = [
        "set -eu",
        "export DEBIAN_FRONTEND=noninteractive",
        "apt-get update",
        "apt-get -y -o Dpkg::Options::=--force-confold upgrade",
        "apt-get clean",
        "systemctl mask apt-daily.service apt-daily.timer apt-daily-upgrade.service apt-daily-upgrade.timer dpkg-db-backup.timer e2scrub_all.timer e2scrub_reap.service fstrim.timer man-db.timer motd-news.timer systemd-ask-password-console.path systemd-ask-password-wall.path systemd-pstore.service systemd-sysext.service systemd-sysext.socket systemd-tmpfiles-clean.service systemd-tmpfiles-clean.timer >/dev/null 2>&1 || true",
        "if test -e /var/run/reboot-required; then printf 'REBOOT_REQUIRED\\n'; fi",
      ].join("; ");
      const updated = await isolated(["/bin/sh", "-lc", script], computer, "root", "/", { timeoutMs: 30 * 60_000 });
      if (updated.code !== 0) throw new Error(updated.stderr.toString("utf8").trim() || "Linux package update failed");
      if (updated.stdout.toString("utf8").includes("REBOOT_REQUIRED")) {
        await syncGuestToHostUnlocked(channelComputer(computer.channel_id) || computer);
        let stopped: { code: number; stdout: Buffer; stderr: Buffer };
        if (computer.backend === "apple") stopped = await apple(["machine", "stop", computer.machine_id], { timeoutMs: 90_000 });
        else stopped = await oci(["stop", computer.machine_id, ownerMarker(computer)], { timeoutMs: 90_000 });
        if (stopped.code !== 0) throw new Error(stopped.stderr.toString("utf8").replaceAll("\0", "").trim() || "updated channel computer could not restart");
        const restarted = await isolated(["/bin/sh", "-lc", "test -d /workspace"], computer, "root", "/", { timeoutMs: 90_000 });
        if (restarted.code !== 0) throw new Error(restarted.stderr.toString("utf8").trim() || "updated channel computer failed its restart check");
      }
      const inspection = await inspectIsolated(computer);
      if (!inspection || inspection.homeMount !== "none") throw new Error("updated channel computer failed its security health check");
      recordObserved(computer, inspection);
      run("UPDATE channel_computers SET maintenance_state='idle',last_update=?,last_error='',updated=? WHERE channel_id=?", now(), now(), computer.channel_id);
      recordComputerActivity(computer.channel_id, "Applied unattended Linux package updates and verified the channel computer.", "complete");
    } catch (error) {
      const message = (error as Error).message || "Linux package update failed";
      run("UPDATE channel_computers SET maintenance_state='idle',last_error=?,updated=? WHERE channel_id=?", message.slice(0, 1000), now(), computer.channel_id);
      recordComputerActivity(computer.channel_id, `Linux update will retry later: ${message}`.slice(0, 500), "failed");
    } finally {
      satisfyObligation(computer.channel_id, "maintenance", ref);
    }
  });
}

async function maybeResizeUnlocked(computer: ChannelComputer, pressure: Record<string, number>): Promise<void> {
  if (!["apple", "oci"].includes(computer.backend) || computer.observed_state !== "running" || !canStopChannelComputer(computer.channel_id)) return;
  const available = Number(pressure.memoryAvailableKb || 0) * 1024;
  const load = Number(pressure.load1 || 0);
  let targetMemory = computer.memory_bytes, targetCpus = computer.cpus;
  if (available && available < computer.memory_bytes * 0.12 && freemem() > 3 * 1024 ** 3) targetMemory = Math.min(8 * 1024 ** 3, computer.memory_bytes + 1024 ** 3);
  if (load > computer.cpus * 0.9 && hostCpus().length >= 6) targetCpus = Math.min(4, computer.cpus + 1);
  const low = available > computer.memory_bytes * 0.7 && load < Math.max(0.2, computer.cpus * 0.15);
  const streak = low ? Number(computer.low_pressure_streak || 0) + 1 : 0;
  run("UPDATE channel_computers SET low_pressure_streak=?,updated=? WHERE channel_id=?", streak, now(), computer.channel_id);
  if (streak >= 30) {
    targetMemory = Math.max(1024 ** 3, computer.memory_bytes - 1024 ** 3);
    targetCpus = Math.max(1, computer.cpus - 1);
  }
  if (targetMemory === computer.memory_bytes && targetCpus === computer.cpus) return;
  await resizeChannelComputerUnlocked(computer, targetCpus, targetMemory);
}

async function resizeChannelComputerUnlocked(computer: ChannelComputer, targetCpus: number, targetMemory: number): Promise<void> {
  if (!["apple", "oci"].includes(computer.backend) || computer.observed_state !== "running") throw new Error("Only a running Apple or OCI channel computer can be resized independently.");
  if (!canStopChannelComputer(computer.channel_id)) throw new Error("Channel computer is busy; resize will retry when it is quiescent.");
  targetCpus = Math.max(1, Math.min(8, Math.round(targetCpus)));
  targetMemory = Math.max(1024 ** 3, Math.min(16 * 1024 ** 3, Math.round(targetMemory / 1024 ** 2) * 1024 ** 2));
  const previousDesired = computer.desired_state;
  const ref = `resize:${now()}`;
  upsertObligation(computer.channel_id, "maintenance", ref, "resident", "Skipper is safely resizing this channel computer.");
  run("UPDATE channel_computers SET maintenance_state='draining',updated=? WHERE channel_id=?", now(), computer.channel_id);
  try {
    if (computer.backend === "oci") {
      run("UPDATE channel_computers SET desired_state='running',maintenance_state='resizing',updated=? WHERE channel_id=?", now(), computer.channel_id);
      const configured = await oci(["set", computer.machine_id, ownerMarker(computer), String(targetCpus), String(Math.round(targetMemory / 1024 ** 2))], { timeoutMs: 30_000 });
      if (configured.code !== 0) throw new Error(configured.stderr.toString("utf8").trim() || "OCI resource update failed");
      const inspection = await inspectOci({ ...computer, cpus: targetCpus, memory_bytes: targetMemory });
      if (!inspection || Number(inspection.cpus) !== targetCpus || Number(inspection.memory) !== targetMemory || inspection.homeMount !== "none") throw new Error("resized OCI container did not match its verified target");
      recordObserved(computer, inspection);
      run("UPDATE channel_computers SET desired_state=?,maintenance_state='idle',low_pressure_streak=0,last_error='',updated=? WHERE channel_id=?", previousDesired, now(), computer.channel_id);
      recordComputerActivity(computer.channel_id, `Live-resized the OCI channel computer to ${targetCpus} CPU(s) and ${Math.round(targetMemory / 1024 ** 3)} GiB RAM.`, "complete");
      return;
    }
    await syncGuestToHostUnlocked(computer);
    const stopped = await apple(["machine", "stop", computer.machine_id], { timeoutMs: 90_000 });
    if (stopped.code !== 0) throw new Error(stopped.stderr.toString("utf8").trim() || "safe resize drain could not stop the machine");
    run("UPDATE channel_computers SET desired_state='running',observed_state='stopped',maintenance_state='resizing',updated=? WHERE channel_id=?", now(), computer.channel_id);
    const configured = await apple(["machine", "set", "-n", computer.machine_id, `cpus=${targetCpus}`, `memory=${Math.round(targetMemory / 1024 ** 2)}M`, "home-mount=none"], { timeoutMs: 30_000 });
    if (configured.code !== 0) throw new Error(configured.stderr.toString("utf8").trim() || "resize configuration failed");
    const refreshedBeforeStart = { ...computer, cpus: targetCpus, memory_bytes: targetMemory };
    const restarted = await apple(["machine", "run", "-n", computer.machine_id, "--", ...guestWords("/bin/sh", "-lc", "test -d /workspace")], { timeoutMs: 90_000 });
    if (restarted.code !== 0) throw new Error(restarted.stderr.toString("utf8").trim() || "resized machine failed verification");
    const inspection = await inspectIsolated(refreshedBeforeStart);
    if (!inspection || Number(inspection.cpus) !== targetCpus || Number(inspection.memory) !== targetMemory || inspection.homeMount !== "none") throw new Error("resized machine did not match its verified target");
    recordObserved(computer, inspection);
    run("UPDATE channel_computers SET desired_state=?,maintenance_state='idle',low_pressure_streak=0,last_error='',updated=? WHERE channel_id=?", previousDesired, now(), computer.channel_id);
    recordComputerActivity(computer.channel_id, `Safely resized the channel computer to ${targetCpus} CPU(s) and ${Math.round(targetMemory / 1024 ** 3)} GiB RAM.`, "complete");
  } catch (error) {
    run("UPDATE channel_computers SET desired_state='running',maintenance_state='repairing',last_error=?,updated=? WHERE channel_id=?", (error as Error).message.slice(0, 1000), now(), computer.channel_id);
    throw error;
  } finally {
    satisfyObligation(computer.channel_id, "maintenance", ref);
  }
}

/** Fleet-care primitive used by automatic policy and real-Mac acceptance. */
export async function resizeChannelComputer(channelId: number, targetCpus: number, targetMemory: number): Promise<ChannelComputer> {
  return withChannelLock(channelId, async () => {
    const computer = channelComputer(channelId);
    if (!computer) throw new Error("Channel computer not found.");
    await resizeChannelComputerUnlocked(computer, targetCpus, targetMemory);
    return channelComputer(channelId)!;
  });
}

async function reconcileOne(computer: ChannelComputer): Promise<void> {
  if (computer.desired_state === "deleted") return;
  // A newly created isolated world does not receive its owner marker until
  // guest bootstrap completes. The provisioning transaction performs the
  // authoritative post-bootstrap inspection itself.
  if (activeProvisioning.has(computer.channel_id)) return;
  const channel = q1("SELECT status FROM channels WHERE id=?", computer.channel_id);
  if (!channel) return;
  if (!isolatedBackend(computer)) { await ensureNativeProvisioned(computer); return; }
  let inspection: MachineInspection | null;
  try { inspection = await inspectIsolated(computer); } catch (error) { recordComputerError(computer.channel_id, error); return; }
  if (!inspection) {
    recordObserved(computer, null, "machine missing");
    if (channel.status === "active") await provisionChannelComputer(computer.channel_id);
    return;
  }
  if (inspection.homeMount !== "none") { recordComputerError(computer.channel_id, new Error("Security invariant failed: channel machine home mount is not none.")); return; }
  recordObserved(computer, inspection);
  computer = channelComputer(computer.channel_id)!;
  if (computer.maintenance_state === "repairing" && inspection.status === "running") {
    run("UPDATE channel_computers SET desired_state='auto',maintenance_state='idle',last_error='',updated=? WHERE channel_id=?", now(), computer.channel_id);
    recordComputerActivity(computer.channel_id, "Recovered and verified the channel computer after interrupted maintenance.", "complete");
    computer = channelComputer(computer.channel_id)!;
  }
  if (channel.status === "archived" || computer.desired_state === "stopped") {
    if (inspection.status === "running") await stopChannelComputer(computer.channel_id, "archive");
    return;
  }
  if (inspection.status !== "running") {
    const hasDueWake = Boolean(q1("SELECT 1 FROM channel_computer_obligations WHERE channel_id=? AND status='active' AND mode='wakeable' AND due_at<=?", computer.channel_id, now() + 30_000));
    // A guest timer/service cannot ask the native control plane to boot its VM.
    // Preserve the last proven guest-resident obligation across an unexpected
    // stop or Mac reboot, wake the machine, then inspect it again on this/next
    // reconciliation pass. A clean inspection satisfies the stale marker.
    const hasGuestResident = Boolean(q1(`SELECT 1 FROM channel_computer_obligations
      WHERE channel_id=? AND kind='guest-runtime' AND ref='detected' AND status='active' AND mode='resident'`, computer.channel_id));
    if (computer.desired_state === "running" || hasDueWake || hasGuestResident) {
      const reason = hasDueWake ? "a due scheduled obligation" : hasGuestResident ? "a guest service or schedule" : "desired fleet state";
      await ensureChannelComputerRunning(computer.channel_id, reason);
    }
    return;
  }
  if (computer.backend === "apple" && !await appleGuestNetworkHealthy(computer)) {
    if (!canStopChannelComputer(computer.channel_id)) {
      throw new Error("resident computer network is unavailable; automatic repair is waiting for its active work to stop");
    }
    await repairAppleGuestNetwork(computer);
    computer = channelComputer(computer.channel_id)!;
  }
  const guest = await inspectGuestObligations(computer);
  run("UPDATE channel_computers SET pressure_json=?,last_health=?,updated=? WHERE channel_id=?", JSON.stringify(guest.pressure), now(), now(), computer.channel_id);
  if (guest.resident) upsertObligation(computer.channel_id, "guest-runtime", "detected", "resident", guest.details.join("; "));
  else satisfyObligation(computer.channel_id, "guest-runtime", "detected");
  if (!guest.resident) await maybeUpdate(channelComputer(computer.channel_id)!);
  await maybeResize(channelComputer(computer.channel_id)!, guest.pressure);
  const refreshed = channelComputer(computer.channel_id)!;
  const stale = now() - Number(refreshed.last_used || refreshed.created) > IDLE_AFTER_MS;
  if (stale && refreshed.desired_state === "auto" && !guest.resident && canStopChannelComputer(computer.channel_id)) await stopChannelComputer(computer.channel_id, "idle");
}

export async function reconcileChannelComputers(channelIds?: Iterable<number>): Promise<{ checked: number; errors: number }> {
  const scope = channelIds === undefined ? null : new Set([...channelIds].map(Number).filter(Number.isFinite));
  const computers = q("SELECT * FROM channel_computers WHERE desired_state<>'deleted' ORDER BY channel_id") as ChannelComputer[];
  let appleRuntimeError: unknown = null;
  if (computers.some((computer) => computer.backend === "apple" && (!scope || scope.has(Number(computer.channel_id))))) {
    try { await ensureAppleRuntimeRunning(apple); } catch (error) { appleRuntimeError = error; }
  }
  let checked = 0, errors = 0;
  for (const row of computers) {
    if (scope && !scope.has(Number(row.channel_id))) continue;
    if (row.backend === "apple" && appleRuntimeError) { errors++; recordComputerError(row.channel_id, appleRuntimeError); checked++; continue; }
    try { await reconcileOne(row); } catch (error) { errors++; recordComputerError(row.channel_id, error); }
    checked++;
  }
  return { checked, errors };
}

export function startChannelComputerReconciler(): void {
  if (reconcileEnabled) return;
  reconcileEnabled = true;
  const tick = (): void => {
    if (!reconcileEnabled || reconcileRunning) return;
    reconcileRunning = true;
    const pass: Promise<void> = reconcileChannelComputers()
      .then(() => undefined)
      .catch((error) => console.error("channel computer reconcile failed:", (error as Error).message))
      .finally(() => {
        reconcileRunning = false;
        if (reconcilePass === pass) reconcilePass = null;
      });
    reconcilePass = pass;
    void pass;
  };
  reconcileStartupTimer = setTimeout(() => { reconcileStartupTimer = null; tick(); }, INITIAL_RECONCILE_MS);
  reconcileStartupTimer.unref();
  reconcileTimer = setInterval(tick, RECONCILE_EVERY_MS);
  reconcileTimer.unref();
}

export async function shutdownChannelComputers(): Promise<void> {
  reconcileEnabled = false;
  if (reconcileStartupTimer) { clearTimeout(reconcileStartupTimer); reconcileStartupTimer = null; }
  if (reconcileTimer) { clearInterval(reconcileTimer); reconcileTimer = null; }
  await reconcilePass?.catch(() => undefined);
  for (const session of [...terminalSessions.values()]) closeChannelTerminal(session.id);
  for (const timer of syncTimers.values()) clearTimeout(timer);
  syncTimers.clear();
  await Promise.all([...channelLocks.values()].map((pending) => pending.catch(() => undefined)));
}

export type ChannelComputerPrepareStatus = {
  status: "idle" | "running" | "complete" | "failed";
  step: string;
  progress: number;
  error: string;
  image: string;
  started_at: number;
  updated_at: number;
};

let ociPrepareState: ChannelComputerPrepareStatus = {
  status: "idle",
  step: "Private channel computers have not been prepared yet.",
  progress: 0,
  error: "",
  image: DEFAULT_CHANNEL_IMAGE,
  started_at: 0,
  updated_at: 0,
};
let ociPreparePass: Promise<void> | null = null;


function setOciPrepareState(patch: Partial<ChannelComputerPrepareStatus>): ChannelComputerPrepareStatus {
  ociPrepareState = {
    ...ociPrepareState,
    ...patch,
    image: DEFAULT_CHANNEL_IMAGE,
    updated_at: now(),
  };
  return ociPrepareState;
}

export function channelComputerPrepareStatus(): ChannelComputerPrepareStatus {
  return { ...ociPrepareState, image: DEFAULT_CHANNEL_IMAGE };
}

async function ociChannelImageExists(image = DEFAULT_CHANNEL_IMAGE): Promise<boolean> {
  try {
    const result = await ociAsync(["image-status", image], { timeoutMs: 30_000 });
    if (result.code !== 0) return false;
    const text = platform() === "win32"
      ? windowsLines(result.stdout).join("")
      : result.stdout.toString("utf8");
    const parsed = JSON.parse(text || "{}") as { exists?: unknown };
    return Boolean(parsed.exists);
  } catch {
    return false;
  }
}

/**
 * One-time host prepare: materialize the shared channel-computer image before
 * the Captain creates channels. Later create_channel calls only clone/start.
 */
export async function beginOciChannelComputerPrepare(): Promise<ChannelComputerPrepareStatus> {
  if (configuredChannelBackend() !== "oci") {
    return setOciPrepareState({
      status: "failed",
      step: "Channel-computer image prepare is only used on the OCI backend.",
      progress: 0,
      error: "Channel-computer image prepare is only used on the OCI backend.",
      started_at: now(),
    });
  }
  if (ociPrepareState.status === "running" && ociPreparePass) return channelComputerPrepareStatus();
  if (await ociChannelImageExists()) {
    const state = setOciPrepareState({
      status: "complete",
      step: "Channel computer image is ready. New channels can start immediately.",
      progress: 100,
      error: "",
      started_at: ociPrepareState.started_at || now(),
    });
    updateCachedOciImageState(true);
    return state;
  }
  const startedAt = now();
  setOciPrepareState({
    status: "running",
    step: "Verifying the OCI runtime…",
    progress: 5,
    error: "",
    started_at: startedAt,
  });
  const passToken = { current: null as Promise<void> | null };
  const pass = (async () => {
    try {
      const engine = await refreshRuntimeReadiness(true);
      if (!engine.engine_ready) {
        throw new Error(String(engine.error || "The OCI runtime is not ready. Finish the host installer or Windows shared-runtime setup first."));
      }
      setOciPrepareState({
        status: "running",
        step: "Loading the sealed channel computer image. This one-time step does not use live package mirrors…",
        progress: 20,
        error: "",
      });
      const built = await ociAsync(["image", DEFAULT_CHANNEL_IMAGE], { timeoutMs: 30 * 60_000 });
      if (built.code !== 0) {
        throw new Error(built.stderr.toString("utf8").trim() || built.stdout.toString("utf8").trim() || "Channel computer image preparation failed.");
      }
      setOciPrepareState({
        status: "running",
        step: "Verifying the sealed channel computer image…",
        progress: 90,
        error: "",
      });
      if (!(await ociChannelImageExists(DEFAULT_CHANNEL_IMAGE))) {
        throw new Error("The channel computer image was not present after preparation completed.");
      }
      setOciPrepareState({
        status: "complete",
        step: "Channel computer image is ready. New channels can start immediately.",
        progress: 100,
        error: "",
      });
      updateCachedOciImageState(true);
    } catch (error) {
      setOciPrepareState({
        status: "failed",
        step: "Private computer setup failed.",
        progress: Math.max(5, Number(ociPrepareState.progress) || 5),
        error: ((error as Error).message || "Private computer setup failed.").slice(0, 1000),
      });
      updateCachedOciImageState(false);
    } finally {
      if (ociPreparePass === passToken.current) ociPreparePass = null;
    }
  })();
  passToken.current = pass;
  ociPreparePass = pass;
  void pass;
  return channelComputerPrepareStatus();
}

const RUNTIME_READINESS_TTL_MS = Math.max(1_000, Number(process.env.HELM_RUNTIME_READINESS_TTL_MS || 5_000));
type RuntimeReadinessCache = { key: string; value: Record<string, unknown>; expiresAt: number };
let runtimeReadinessCache: RuntimeReadinessCache | null = null;
let runtimeReadinessPass: Promise<Record<string, unknown>> | null = null;

const runtimeReadinessKey = (): string => `${configuredChannelBackend()}:${platform()}:${process.arch}`;

function immediateRuntimeReadiness(): Record<string, unknown> | null {
  const backend = configuredChannelBackend();
  if (backend !== "native" && backend !== "mock") return null;
  return {
    backend, supported: true, ready: true, engine_ready: true, image_ready: true,
    image: null, prepare: null, platform: platform(), architecture: process.arch,
    development_only: true, runtime_version: null, status: "development",
  };
}

function pendingRuntimeReadiness(): Record<string, unknown> {
  const backend = configuredChannelBackend();
  const darwin = platform() === "darwin";
  const windows = platform() === "win32";
  if (backend === "oci") return {
    backend,
    supported: (["linux", "win32"].includes(platform()) && ["arm64", "x64"].includes(process.arch)),
    engine_ready: false,
    image_ready: false,
    image: DEFAULT_CHANNEL_IMAGE,
    prepare: channelComputerPrepareStatus(),
    ready: false,
    platform: platform(), architecture: process.arch, cli: null, version: null, system: null,
    runtime_version: OCI_RUNTIME_VERSION, shared_runtime: windows ? installationScopedRuntimeName() : null,
    storage_authority: windows ? `\\\\wsl.localhost\\${installationScopedRuntimeName()}\\var\\lib\\1helm-oci-v1\\runtime\\oci` : ociHostStateRoot(),
    status: "checking", error: null,
  };
  return {
    backend, supported: darwin && process.arch === "arm64", darwin, arm64: process.arch === "arm64",
    platform: platform(), architecture: process.arch, macos_version: null, cli: null, version: null, system: null,
    runtime_version: APPLE_RUNTIME_VERSION, installer_url: APPLE_RUNTIME_URL, installer_sha256: APPLE_RUNTIME_SHA256,
    status: "checking", error: null, engine_ready: false, image_ready: false,
    image: DEFAULT_CHANNEL_IMAGE, prepare: null, ready: false,
  };
}

function updateCachedOciImageState(imageReady: boolean): void {
  const key = runtimeReadinessKey();
  if (!runtimeReadinessCache || runtimeReadinessCache.key !== key || runtimeReadinessCache.value.backend !== "oci") return;
  const engineReady = Boolean(runtimeReadinessCache.value.engine_ready);
  runtimeReadinessCache = {
    key,
    expiresAt: Date.now() + RUNTIME_READINESS_TTL_MS,
    value: {
      ...runtimeReadinessCache.value,
      image_ready: imageReady,
      ready: Boolean(engineReady && imageReady),
      prepare: channelComputerPrepareStatus(),
      status: !engineReady ? runtimeReadinessCache.value.status : imageReady ? "running" : "image_pending",
    },
  };
}

function invalidateRuntimeReadiness(): void {
  if (runtimeReadinessCache) runtimeReadinessCache.expiresAt = 0;
  void refreshRuntimeReadiness().catch((error) => console.warn("Channel runtime readiness refresh failed:", (error as Error).message));
}

async function probeRuntimeReadiness(): Promise<Record<string, unknown>> {
  const immediate = immediateRuntimeReadiness();
  if (immediate) return immediate;
  const backend = configuredChannelBackend();
  const darwin = platform() === "darwin";
  const linux = platform() === "linux";
  const windows = platform() === "win32";
  const arm64 = process.arch === "arm64";
  const supportedArchitecture = arm64 || process.arch === "x64";
  if (backend === "oci") {
    let helper = "", version = "", system: unknown = null, error = "";
    try {
      if (windows) {
        helper = `${installationScopedRuntimeName()}:/usr/libexec/1helm-oci-runtime`;
        // Cold WSL start after setup routinely exceeds 15–30s. Wake first, then use long floors.
        try {
          const wsl = await resolveWslCliAsync();
          await spawnCollected(wsl, ["--distribution", installationScopedRuntimeName(), "--user", "root", "--exec", "/bin/true"], { timeoutMs: 180_000 });
        } catch { /* version/ready errors surface below */ }
        const versionResult = await ociAsync(["version"], { timeoutMs: 120_000 });
        const versionLines = versionResult.code === 0 ? windowsLines(versionResult.stdout) : [];
        version = (versionLines[0] || "").trim();
        if (versionResult.code !== 0 && !version) {
          error = windowsLines(Buffer.concat([versionResult.stderr, versionResult.stdout])).join(" ")
            || `WSL OCI runtime version check failed (exit ${versionResult.code}).`;
        }
        const readyResult = await ociAsync(["ready"], { timeoutMs: 180_000 });
        if (readyResult.code === 0) {
          const readyText = windowsLines(readyResult.stdout).join("\n").trim();
          try { system = JSON.parse(readyText || "{}"); }
          catch {
            try { system = JSON.parse(readyResult.stdout.toString("utf8").replaceAll("\0", "").trim() || "{}"); }
            catch { system = readyText || windowsLines(readyResult.stdout); }
          }
        } else {
          const readyErr = windowsLines(Buffer.concat([readyResult.stderr, readyResult.stdout])).join(" ")
            || `OCI runtime readiness check failed (exit ${readyResult.code}).`;
          error = error ? `${error} ${readyErr}` : readyErr;
        }
      } else {
        const invocation = linuxOciInvocation(["version"]);
        helper = invocation.command;
        const versionResult = await ociAsync(["version"], { timeoutMs: 15_000 });
        version = versionResult.code === 0 ? versionResult.stdout.toString("utf8").trim().split(/\r?\n/)[0] || "" : "";
        const readyResult = await ociAsync(["ready"], { timeoutMs: 30_000 });
        if (readyResult.code === 0) {
          const readyText = readyResult.stdout.toString("utf8");
          try { system = JSON.parse(readyText || "{}"); } catch { system = readyText.trim(); }
        } else error = Buffer.concat([readyResult.stderr, readyResult.stdout]).toString("utf8").trim() || "OCI runtime readiness check failed.";
      }
    } catch (failure) { error = (failure as Error).message; }
    const supported = (linux || windows) && supportedArchitecture;
    const engineReady = Boolean(supported && helper && version === OCI_RUNTIME_VERSION && system && !error);
    // During image preparation its explicit verification owns this state. At all
    // other times the short-lived cache is refreshed from the runtime helper.
    let imageReady = false;
    if (engineReady && ociPrepareState.status !== "running") {
      imageReady = await ociChannelImageExists();
      if (imageReady && ociPrepareState.status !== "complete") {
        setOciPrepareState({
          status: "complete",
          step: "Channel computer image is ready. New channels can start immediately.",
          progress: 100,
          error: "",
          started_at: ociPrepareState.started_at || now(),
        });
      } else if (!imageReady && ociPrepareState.status === "complete") {
        setOciPrepareState({
          status: "idle",
          step: "Private channel computers have not been prepared yet.",
          progress: 0,
          error: "",
          started_at: 0,
        });
      }
    }
    return {
      backend, supported,
      engine_ready: engineReady,
      image_ready: imageReady,
      image: DEFAULT_CHANNEL_IMAGE,
      prepare: channelComputerPrepareStatus(),
      ready: Boolean(engineReady && imageReady),
      platform: platform(), architecture: process.arch, cli: helper || null, version: version || null, system,
      runtime_version: OCI_RUNTIME_VERSION, shared_runtime: windows ? installationScopedRuntimeName() : null,
      storage_authority: windows ? `\\\\wsl.localhost\\${installationScopedRuntimeName()}\\var\\lib\\1helm-oci-v1\\runtime\\oci` : ociHostStateRoot(),
      status: error ? "error" : !engineReady ? (system ? "running" : "missing") : imageReady ? "running" : "image_pending",
      error: error || (ociPrepareState.status === "failed" ? ociPrepareState.error : null),
    };
  }

  let cli = "";
  try { cli = await resolveContainerCliAsync(); } catch { /* missing */ }
  let system: unknown = null;
  let version: unknown = null;
  if (cli) {
    try {
      const versionResult = await spawnCollected(cli, ["system", "version", "--format", "json"], { timeoutMs: 10_000 });
      if (versionResult.code === 0) {
        const text = versionResult.stdout.toString("utf8");
        try { version = JSON.parse(text); } catch { version = text.trim(); }
      }
      const status = await spawnCollected(cli, ["system", "status", "--format", "json"], { timeoutMs: 10_000 });
      if (status.code === 0) {
        const text = status.stdout.toString("utf8");
        try { system = JSON.parse(text); } catch { system = text.trim(); }
      }
    } catch { /* stopped or unresponsive runtime */ }
  }
  const systemStatus = system && typeof system === "object" ? String((system as Record<string, unknown>).status || "") : "";
  const exactRuntime = exactAppleRuntimeVersion(version) && systemStatus === "running";
  let macosVersion = "";
  if (darwin) {
    try {
      const result = await spawnCollected("/usr/bin/sw_vers", ["-productVersion"], { timeoutMs: 10_000 });
      if (result.code === 0) macosVersion = result.stdout.toString("utf8").trim();
    } catch { /* unsupported host */ }
  }
  const supportedMac = darwin && arm64 && Number(macosVersion.split(".")[0] || 0) >= 26;
  const ready = Boolean(supportedMac && cli && exactRuntime);
  return {
    backend, supported: supportedMac, darwin, arm64, platform: platform(), architecture: process.arch, macos_version: macosVersion || null, cli: cli || null, version, system,
    runtime_version: APPLE_RUNTIME_VERSION, installer_url: APPLE_RUNTIME_URL, installer_sha256: APPLE_RUNTIME_SHA256,
    status: exactRuntime ? "running" : cli ? "stopped" : "missing", error: null,
    engine_ready: ready, image_ready: ready, image: DEFAULT_CHANNEL_IMAGE, prepare: null,
    ready,
  };
}

/** Refresh in one shared asynchronous pass. Force bypasses only the TTL, never
 * an already-running probe, so UI polling cannot create subprocess storms. */
export function refreshRuntimeReadiness(force = false): Promise<Record<string, unknown>> {
  const immediate = immediateRuntimeReadiness();
  if (immediate) return Promise.resolve(immediate);
  const key = runtimeReadinessKey();
  if (!force && runtimeReadinessCache?.key === key && runtimeReadinessCache.expiresAt > Date.now()) {
    return Promise.resolve({ ...runtimeReadinessCache.value });
  }
  if (runtimeReadinessPass) return runtimeReadinessPass;
  const pass = probeRuntimeReadiness().then((value) => {
    runtimeReadinessCache = { key, value, expiresAt: Date.now() + RUNTIME_READINESS_TTL_MS };
    return { ...value };
  });
  runtimeReadinessPass = pass;
  const clear = (): void => { if (runtimeReadinessPass === pass) runtimeReadinessPass = null; };
  pass.then(clear, clear);
  return pass;
}

/** Request-safe snapshot. A miss or expired value schedules one asynchronous
 * refresh and returns immediately; no child process is started synchronously. */
export function runtimeReadiness(): Record<string, unknown> {
  const immediate = immediateRuntimeReadiness();
  if (immediate) return immediate;
  const key = runtimeReadinessKey();
  const cached = runtimeReadinessCache?.key === key ? runtimeReadinessCache : null;
  if (!cached || cached.expiresAt <= Date.now()) {
    void refreshRuntimeReadiness().catch((error) => console.warn("Channel runtime readiness refresh failed:", (error as Error).message));
  }
  return cached ? { ...cached.value } : pendingRuntimeReadiness();
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Download only Apple's pinned, signed runtime installer and open its one-time approval UI. */
export async function prepareAppleRuntimeInstaller(): Promise<{ path: string; sha256: string; opened: boolean }> {
  if (platform() !== "darwin" || process.arch !== "arm64") throw new Error("Apple container machines require an Apple Silicon Mac.");
  const runtimeDir = join(DATA_DIR, "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const destination = join(runtimeDir, APPLE_RUNTIME_PACKAGE);
  if (!existsSync(destination) || await sha256File(destination) !== APPLE_RUNTIME_SHA256) {
    const candidate = `${destination}.candidate-${randomBytes(6).toString("hex")}`;
    try {
      const response = await fetch(APPLE_RUNTIME_URL, { redirect: "follow" });
      if (!response.ok || !response.body) throw new Error(`Apple runtime download failed (${response.status}).`);
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(candidate, { mode: 0o600 }));
      const digest = await sha256File(candidate);
      if (digest !== APPLE_RUNTIME_SHA256) throw new Error("Apple runtime download did not match 1Helm's pinned SHA-256.");
      renameSync(candidate, destination);
    } finally {
      for (const path of [candidate]) if (existsSync(path)) rmSync(path, { force: true });
    }
  }
  const digest = await sha256File(destination);
  if (digest !== APPLE_RUNTIME_SHA256) throw new Error("Apple runtime installer digest verification failed.");
  const signature = spawnSync("/usr/sbin/pkgutil", ["--check-signature", destination], { encoding: "utf8", timeout: 30_000 });
  if (signature.status !== 0 || !/Developer ID Installer/i.test(`${signature.stdout}\n${signature.stderr}`)) {
    throw new Error("Apple runtime installer did not have a valid Developer ID Installer signature.");
  }
  const gatekeeper = spawnSync("/usr/sbin/spctl", ["--assess", "--type", "install", "--verbose=2", destination], { encoding: "utf8", timeout: 30_000 });
  if (gatekeeper.status !== 0) throw new Error("Apple runtime installer did not pass macOS Gatekeeper assessment.");
  const opened = spawnSync("/usr/bin/open", [destination], { stdio: "ignore" }).status === 0;
  if (!opened) throw new Error("macOS could not open the verified Apple runtime installer.");
  return { path: destination, sha256: digest, opened };
}

/** Complete runtime activation after the signed package receives approval. */
export async function startAppleRuntime(): Promise<Record<string, unknown>> {
  if (platform() !== "darwin" || process.arch !== "arm64") throw new Error("Apple container machines require an Apple Silicon Mac.");
  const cli = resolveContainerCli();
  const started = await spawnCollected(cli, ["system", "start", "--enable-kernel-install"], { timeoutMs: 10 * 60_000 });
  if (started.code !== 0) throw new Error(started.stderr.toString("utf8").trim() || started.stdout.toString("utf8").trim() || "Apple container runtime did not start.");
  invalidateRuntimeReadiness();
  const readiness = await refreshRuntimeReadiness(true);
  if (!readiness.ready) throw new Error("Apple container runtime started but did not pass its health check.");
  void reconcileChannelComputers().catch((error) => console.error("post-install channel computer reconcile failed:", (error as Error).message));
  return readiness;
}

/** Userless/system wake hook (for a LaunchAgent) to reconcile due obligations. */
export async function wakeDueChannelComputers(): Promise<{ due: number; woken: number; errors: string[] }> {
  const dueRows = q(`SELECT DISTINCT channel_id FROM channel_computer_obligations
    WHERE status='active' AND mode='wakeable' AND due_at IS NOT NULL AND due_at<=? ORDER BY channel_id`, now() + 60_000);
  let woken = 0;
  const errors: string[] = [];
  for (const row of dueRows) {
    try { await ensureChannelComputerRunning(Number(row.channel_id), "a due native schedule"); woken++; }
    catch (error) { errors.push((error as Error).message); }
  }
  return { due: dueRows.length, woken, errors };
}

function recordComputerError(channelId: number, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const previous = channelComputer(channelId);
  run("UPDATE channel_computers SET provision_status='error',last_error=?,updated=? WHERE channel_id=?", message.slice(0, 1000), now(), channelId);
  const duplicate = previous?.last_error === message.slice(0, 1000)
    && Boolean(q1("SELECT 1 FROM channel_activity WHERE channel_id=? AND kind='computer' AND status='failed' AND created>? LIMIT 1", channelId, now() - 6 * 60 * 60_000));
  if (!duplicate) recordComputerActivity(channelId, `Computer care needs attention: ${message}`.slice(0, 500), "failed");
}

function recordComputerActivity(channelId: number, summary: string, status: string, quiet = false): void {
  if (quiet && q1("SELECT 1 FROM channel_activity WHERE channel_id=? AND kind='computer' AND summary=? AND created>?", channelId, summary, now() - 60_000)) return;
  run("INSERT INTO channel_activity (channel_id,kind,summary,status,actor_type,created) VALUES (?,'computer',?,?, 'skipper',?)", channelId, summary.slice(0, 500), status, now());
}

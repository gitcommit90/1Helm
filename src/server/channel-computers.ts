import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { cpus as hostCpus, freemem, platform, totalmem } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn as spawnPty, type IPty } from "node-pty";
import { WebSocket } from "ws";
import { DATA_DIR, now, q, q1, run, type Row } from "./db.ts";

export type ChannelComputerBackend = "apple" | "native" | "mock";
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

type AppleInspection = {
  id?: string;
  status?: string;
  cpus?: number;
  memory?: number;
  diskSize?: number | null;
  homeMount?: string;
  image?: { reference?: string; descriptor?: { digest?: string } } | string;
};

const APPLE_RUNTIME_VERSION = "1.1.0";
export const APPLE_RUNTIME_PACKAGE = `container-${APPLE_RUNTIME_VERSION}-installer-signed.pkg`;
export const APPLE_RUNTIME_URL = `https://github.com/apple/container/releases/download/${APPLE_RUNTIME_VERSION}/${APPLE_RUNTIME_PACKAGE}`;
export const APPLE_RUNTIME_SHA256 = "0ca1c42a2269c2557efb1d82b1b38ac553e6a3a3da1b1179c439bcee1e7d6714";
export const DEFAULT_CHANNEL_IMAGE = process.env.HELM_CHANNEL_MACHINE_IMAGE || "local/1helm-channel-machine:0.0.2";
const CONTAINER_CANDIDATES = [process.env.HELM_CONTAINER_CLI, "/usr/local/bin/container", "/opt/homebrew/bin/container", "container"].filter(Boolean) as string[];
const COMMAND_TIMEOUT_MS = Math.max(5_000, Number(process.env.HELM_MACHINE_COMMAND_TIMEOUT_MS || 120_000));
const IDLE_AFTER_MS = Math.max(60_000, Number(process.env.HELM_MACHINE_IDLE_MS || 15 * 60_000));
const RECONCILE_EVERY_MS = Math.max(15_000, Number(process.env.HELM_FLEET_INTERVAL_MS || 60_000));
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
const syncTimers = new Map<number, NodeJS.Timeout>();
let reconcileTimer: NodeJS.Timeout | null = null;
let reconcileRunning = false;

const installationId = (): string => {
  let id = String(q1("SELECT installation_id FROM workspace WHERE id=1")?.installation_id || "");
  if (!/^[a-f0-9]{16}$/.test(id)) {
    id = randomBytes(8).toString("hex");
    run("UPDATE workspace SET installation_id=? WHERE id=1", id);
  }
  return id;
};

export const configuredChannelBackend = (): ChannelComputerBackend => {
  const configured = String(process.env.HELM_CHANNEL_COMPUTER_BACKEND || (platform() === "darwin" ? "apple" : "native"));
  return configured === "apple" || configured === "mock" ? configured : "native";
};

const explicitComputerId = (channelId: number): string => `1helm-${installationId()}-channel-${channelId}`;
const hostWorldRoot = (channelId: number): string => join(DATA_DIR, "channels", String(channelId));
const hostWorkspace = (channelId: number): string => join(hostWorldRoot(channelId), "workspace");
const hostFiles = (channelId: number): string => join(hostWorldRoot(channelId), "files");

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

export function channelComputerView(channelId: number): Record<string, unknown> | null {
  const computer = channelComputer(channelId);
  if (!computer) return null;
  const obligations = computerObligations(channelId);
  return {
    backend: computer.backend,
    machine_id: computer.machine_id,
    image: computer.image,
    desired_state: computer.desired_state,
    observed_state: computer.observed_state,
    cpus: computer.cpus,
    memory_bytes: computer.memory_bytes,
    disk_bytes: computer.disk_bytes,
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
  if (!q1("SELECT 1 FROM channel_computers WHERE channel_id=?", channelId)) return;
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

function parsedInspection(output: Buffer): AppleInspection | null {
  try {
    const parsed = JSON.parse(output.toString("utf8"));
    return (Array.isArray(parsed) ? parsed[0] : parsed) as AppleInspection;
  } catch { return null; }
}

async function inspectApple(machineId: string): Promise<AppleInspection | null> {
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

function recordObserved(computer: ChannelComputer, inspection: AppleInspection | null, error = ""): void {
  if (!inspection) {
    run("UPDATE channel_computers SET observed_state='missing',last_error=?,updated=? WHERE channel_id=?", error.slice(0, 1000), now(), computer.channel_id);
    return;
  }
  run(`UPDATE channel_computers SET observed_state=?,cpus=?,memory_bytes=?,disk_bytes=?,home_mount='none',provision_status='ready',last_health=?,last_error='',updated=? WHERE channel_id=?`,
    String(inspection.status || "unknown"), Number(inspection.cpus || computer.cpus), Number(inspection.memory || computer.memory_bytes),
    MANAGED_CHANNEL_DISK_BYTES, now(), now(), computer.channel_id);
}

async function ensureAppleProvisioned(computer: ChannelComputer): Promise<void> {
  let inspection: AppleInspection | null = null;
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

async function ensureNativeProvisioned(computer: ChannelComputer): Promise<void> {
  mkdirSync(hostWorkspace(computer.channel_id), { recursive: true });
  mkdirSync(hostFiles(computer.channel_id), { recursive: true });
  run("UPDATE channel_computers SET observed_state='running',provision_status='ready',last_health=?,last_error='',updated=? WHERE channel_id=?", now(), now(), computer.channel_id);
}

export async function provisionChannelComputer(channelId: number): Promise<ChannelComputer> {
  return withChannelLock(channelId, async () => {
    let computer = ensureChannelComputerRecord(channelId);
    if (computer.backend === "apple") await ensureAppleProvisioned(computer);
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
      await ensureAppleProvisioned(computer);
      computer = channelComputer(channelId)!;
      // machine run is the supported boot path; this no-op also verifies the guest.
      const boot = await apple(["machine", "run", "-n", computer.machine_id, "--", ...guestWords("/bin/sh", "-lc", "set -eu; mkdir -p /workspace/files; test ! -d /Users || test -z \"$(find /Users -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)\"")], { timeoutMs: 90_000 });
      if (boot.code !== 0) throw new Error(boot.stderr.toString("utf8").trim() || "channel computer did not start");
      await syncHostChangesToGuest(computer);
      const inspection = await inspectApple(computer.machine_id);
      recordObserved(computer, inspection);
    } else await ensureNativeProvisioned(computer);
    run("UPDATE channel_computers SET last_used=?,last_error='',updated=? WHERE channel_id=?", now(), now(), channelId);
    recordComputerActivity(channelId, `Computer ready for ${reason}.`, "complete", true);
    return channelComputer(channelId)!;
  });
}

async function syncHostChangesToGuest(computer: ChannelComputer, attempt = 0): Promise<void> {
  if (computer.backend !== "apple") return;
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
    const applied = await apple(["machine", "run", "-i", "--root", "-n", computer.machine_id, "--", ...guestWords("/bin/sh", "-lc", "set -eu; mkdir -p /workspace; find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; rm -rf /files; tar -xf - -C / --no-same-owner; mkdir -p /workspace/files; if test -d /files; then cp -a /files/. /workspace/files/; rm -rf /files; fi; chown -R \"$1:$2\" /workspace", "1helm-sync", String(process.getuid?.() ?? 501), String(process.getgid?.() ?? 20))], { input: tar.stdout!, timeoutMs: 5 * 60_000 });
    const tarCode = await tarClosed;
    if (tarCode !== 0 || applied.code !== 0) throw new Error(applied.stderr.toString("utf8").trim() || "workspace import failed");
  } else {
    for (const change of changes) {
      const rel = normalizeWorldRelative(String(change.relative_path));
      const guest = rel.startsWith("files/") ? `/workspace/${rel}` : `/${rel}`;
      const host = resolveHostWorldPath(computer.channel_id, rel);
      if (String(change.operation) === "delete" || !existsSync(host)) {
        const removed = await apple(["machine", "run", "--root", "-n", computer.machine_id, "--", ...guestWords("/bin/rm", "-rf", "--", guest)]);
        if (removed.code !== 0) throw new Error(removed.stderr.toString("utf8").trim() || `failed to remove ${rel}`);
        continue;
      }
      if (lstatSync(host).isSymbolicLink()) throw new Error(`refusing to import symlink ${rel} into a channel computer`);
      if (lstatSync(host).isDirectory()) validateMirrorTree(host);
      const parent = dirname(guest);
      const tar = spawn("tar", ["-C", dirname(host), "-cf", "-", basename(host)], { stdio: ["ignore", "pipe", "ignore"] });
      const tarClosed = new Promise<number>((resolvePromise) => tar.once("close", (code) => resolvePromise(code ?? 1)));
      const applied = await apple(["machine", "run", "-i", "--root", "-n", computer.machine_id, "--", ...guestWords("/bin/sh", "-lc", "set -eu; mkdir -p \"$1\"; rm -rf -- \"$1/$2\"; tar -xf - -C \"$1\" --no-same-owner; chown -R \"$3:$4\" \"$1/$2\"", "1helm-sync", parent, basename(guest), String(process.getuid?.() ?? 501), String(process.getgid?.() ?? 20))], { input: tar.stdout!, timeoutMs: 5 * 60_000 });
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
  if (!computer || computer.backend !== "apple" || computer.observed_state !== "running") return;
  await syncGuestToHost(channelId);
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
    if (computer.backend !== "apple") {
      const shell = process.env.SHELL || "/bin/bash";
      const result = await spawnCollected(shell, ["-lc", command], { cwd: hostWorkspace(channelId), signal, timeoutMs: 5 * 60_000 });
      run("UPDATE channel_computers SET last_used=?,updated=? WHERE channel_id=?", now(), now(), channelId);
      return { status: "completed", exit_code: result.code, output: Buffer.concat([result.stdout, result.stderr]).toString("utf8").trim() };
    }
    const result = await apple(["machine", "run", "-n", computer.machine_id, "-w", "/workspace", "--", ...guestWords("/bin/bash", "-lc", command)], { signal, timeoutMs: 5 * 60_000 });
    await syncGuestToHost(channelId);
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
  const args = computer.backend === "apple"
    ? ["machine", "run", "-it", "-n", computer.machine_id, "-w", "/workspace", "--", ...guestWords("/bin/bash", "-l")]
    : [];
  const requestedShell = process.env.SHELL || "/bin/bash";
  const executable = computer.backend === "apple" ? resolveContainerCli() : (requestedShell.startsWith("/") && existsSync(requestedShell) ? requestedShell : "/bin/bash");
  let pty: IPty;
  try {
    pty = spawnPty(executable, args, {
      name: "xterm-256color", cols: Math.max(20, cols || 80), rows: Math.max(5, rows || 24),
      cwd: computer.backend === "apple" ? undefined : hostWorkspace(channelId), env: { ...process.env, TERM: "xterm-256color" },
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
      if (message.type === "resize") { session.cols = Number(message.cols) || 80; session.rows = Number(message.rows) || 24; session.pty.resize(session.cols, session.rows); }
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
    }
    run("UPDATE channel_computers SET desired_state=?,observed_state='stopped',maintenance_state='idle',last_error='',updated=? WHERE channel_id=?", reason === "archive" ? "stopped" : "auto", now(), channelId);
    recordComputerActivity(channelId, reason === "archive" ? "Stopped the archived channel computer; its Linux disk is preserved." : "Stopped an idle, obligation-free channel computer.", "complete");
  });
}

async function syncGuestToHostUnlocked(computer: ChannelComputer): Promise<void> {
  if (computer.backend !== "apple" || !["running", "unknown"].includes(computer.observed_state)) return;
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
      const child = spawn(resolveContainerCli(), ["machine", "run", "-n", computer.machine_id, "--", ...guestWords("/bin/tar", "-C", "/", "-cf", "-", "workspace")], { stdio: ["ignore", "pipe", "pipe"] });
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
  if (configuredChannelBackend() !== "apple") return [];
  const listed = await apple(["machine", "list", "--format", "json"], { timeoutMs: 30_000 });
  if (listed.code !== 0) throw new Error(listed.stderr.toString("utf8").trim() || "Could not list Apple channel machines.");
  const prefix = `1helm-${installationId()}-channel-`;
  return listedAppleMachineIds(listed.stdout).filter((id) => id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)));
}

/** Count exact installation-owned VMs that would survive moving the app to Trash. */
export async function appRemovalStatus(): Promise<{ backend: ChannelComputerBackend; machines: number }> {
  const backend = configuredChannelBackend();
  return { backend, machines: backend === "apple" ? (await ownedInstallationMachineIds()).length : 0 };
}

/**
 * Prepare for uninstall by deleting every VM carrying this installation's
 * exact name and in-guest ownership marker. Application Support is preserved
 * so an accidental app removal never destroys credentials or workspace data.
 */
export async function prepareAppRemoval(): Promise<{ backend: ChannelComputerBackend; deleted: number; remaining: number }> {
  const backend = configuredChannelBackend();
  if (backend !== "apple") return { backend, deleted: 0, remaining: 0 };
  const install = installationId();
  const prefix = `1helm-${install}-channel-`;
  const machineIds = await ownedInstallationMachineIds();
  let deleted = 0;
  for (const machineId of machineIds) {
    const channelId = Number(machineId.slice(prefix.length));
    const inspection = await inspectApple(machineId);
    if (!inspection) continue;
    if (inspection.homeMount !== "none") throw new Error(`Refusing to remove ${machineId}: its Mac home isolation invariant no longer holds.`);
    const ownership = await apple(["machine", "run", "-n", machineId, "--", ...guestWords("/bin/cat", "/var/lib/1helm/owner")], { timeoutMs: 30_000 });
    if (ownership.code !== 0 || ownership.stdout.toString("utf8").trim() !== `${install}:${channelId}`) {
      throw new Error(`Refusing to remove ${machineId}: its 1Helm ownership marker does not match exactly.`);
    }
    const tracked = q1("SELECT channel_id FROM channel_computers WHERE machine_id=?", machineId);
    if (tracked) {
      await deleteChannelComputer(Number(tracked.channel_id));
      deleted++;
      continue;
    }
    const stopped = await apple(["machine", "stop", machineId], { timeoutMs: 90_000 });
    if (stopped.code !== 0 && !/not running|stopped/i.test(Buffer.concat([stopped.stderr, stopped.stdout]).toString("utf8"))) {
      throw new Error(stopped.stderr.toString("utf8").trim() || `Could not stop ${machineId}.`);
    }
    const removed = await apple(["machine", "delete", machineId], { timeoutMs: 90_000 });
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
  if (computer.backend !== "apple" || computer.observed_state !== "running") return { resident: false, details: [], pressure: {} };
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
  const result = await apple(["machine", "run", "-n", computer.machine_id, "--", ...guestWords("/bin/sh", "-lc", script)], { timeoutMs: 30_000 });
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
    if (computer.backend !== "apple" || computer.observed_state !== "running" || !canStopChannelComputer(computer.channel_id)) return;
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
      const updated = await apple(["machine", "run", "--root", "-n", computer.machine_id, "--", ...guestWords("/bin/sh", "-lc", script)], { timeoutMs: 30 * 60_000 });
      if (updated.code !== 0) throw new Error(updated.stderr.toString("utf8").trim() || "Linux package update failed");
      if (updated.stdout.toString("utf8").includes("REBOOT_REQUIRED")) {
        await syncGuestToHostUnlocked(channelComputer(computer.channel_id) || computer);
        const stopped = await apple(["machine", "stop", computer.machine_id], { timeoutMs: 90_000 });
        if (stopped.code !== 0) throw new Error(stopped.stderr.toString("utf8").trim() || "updated channel computer could not restart");
        const restarted = await apple(["machine", "run", "-n", computer.machine_id, "--", ...guestWords("/bin/sh", "-lc", "test -d /workspace")], { timeoutMs: 90_000 });
        if (restarted.code !== 0) throw new Error(restarted.stderr.toString("utf8").trim() || "updated channel computer failed its restart check");
      }
      const inspection = await inspectApple(computer.machine_id);
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
  if (computer.backend !== "apple" || computer.observed_state !== "running" || !canStopChannelComputer(computer.channel_id)) return;
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
  if (computer.backend !== "apple" || computer.observed_state !== "running") throw new Error("Only a running Apple channel computer can be resized.");
  if (!canStopChannelComputer(computer.channel_id)) throw new Error("Channel computer is busy; resize will retry when it is quiescent.");
  targetCpus = Math.max(1, Math.min(8, Math.round(targetCpus)));
  targetMemory = Math.max(1024 ** 3, Math.min(16 * 1024 ** 3, Math.round(targetMemory / 1024 ** 2) * 1024 ** 2));
  const previousDesired = computer.desired_state;
  const ref = `resize:${now()}`;
  upsertObligation(computer.channel_id, "maintenance", ref, "resident", "Skipper is safely resizing this channel computer.");
  run("UPDATE channel_computers SET maintenance_state='draining',updated=? WHERE channel_id=?", now(), computer.channel_id);
  try {
    await syncGuestToHostUnlocked(computer);
    const stopped = await apple(["machine", "stop", computer.machine_id], { timeoutMs: 90_000 });
    if (stopped.code !== 0) throw new Error(stopped.stderr.toString("utf8").trim() || "safe resize drain could not stop the machine");
    run("UPDATE channel_computers SET desired_state='running',observed_state='stopped',maintenance_state='resizing',updated=? WHERE channel_id=?", now(), computer.channel_id);
    const configured = await apple(["machine", "set", "-n", computer.machine_id, `cpus=${targetCpus}`, `memory=${Math.round(targetMemory / 1024 ** 2)}M`, "home-mount=none"], { timeoutMs: 30_000 });
    if (configured.code !== 0) throw new Error(configured.stderr.toString("utf8").trim() || "resize configuration failed");
    const restarted = await apple(["machine", "run", "-n", computer.machine_id, "--", ...guestWords("/bin/sh", "-lc", "test -d /workspace")], { timeoutMs: 90_000 });
    if (restarted.code !== 0) throw new Error(restarted.stderr.toString("utf8").trim() || "resized machine failed verification");
    const inspection = await inspectApple(computer.machine_id);
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
  const channel = q1("SELECT status FROM channels WHERE id=?", computer.channel_id);
  if (!channel) return;
  if (computer.backend !== "apple") { await ensureNativeProvisioned(computer); return; }
  let inspection: AppleInspection | null;
  try { inspection = await inspectApple(computer.machine_id); } catch (error) { recordComputerError(computer.channel_id, error); return; }
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
  let checked = 0, errors = 0;
  for (const row of q("SELECT * FROM channel_computers WHERE desired_state<>'deleted' ORDER BY channel_id") as ChannelComputer[]) {
    if (scope && !scope.has(Number(row.channel_id))) continue;
    try { await reconcileOne(row); } catch (error) { errors++; recordComputerError(row.channel_id, error); }
    checked++;
  }
  return { checked, errors };
}

export function startChannelComputerReconciler(): void {
  if (reconcileTimer) return;
  const tick = (): void => {
    if (reconcileRunning) return;
    reconcileRunning = true;
    void reconcileChannelComputers().catch((error) => console.error("channel computer reconcile failed:", (error as Error).message)).finally(() => { reconcileRunning = false; });
  };
  setTimeout(tick, 2_000).unref();
  reconcileTimer = setInterval(tick, RECONCILE_EVERY_MS);
  reconcileTimer.unref();
}

export async function shutdownChannelComputers(): Promise<void> {
  if (reconcileTimer) { clearInterval(reconcileTimer); reconcileTimer = null; }
  for (const session of [...terminalSessions.values()]) closeChannelTerminal(session.id);
  for (const timer of syncTimers.values()) clearTimeout(timer);
  syncTimers.clear();
  await Promise.all([...channelLocks.values()].map((pending) => pending.catch(() => undefined)));
}

export function runtimeReadiness(): Record<string, unknown> {
  const backend = configuredChannelBackend();
  const darwin = platform() === "darwin";
  const arm64 = process.arch === "arm64";
  let cli = "";
  try { cli = resolveContainerCli(); } catch { /* missing */ }
  let system: unknown = null;
  let version: unknown = null;
  if (cli) {
    const versionResult = spawnSync(cli, ["system", "version", "--format", "json"], { encoding: "utf8", timeout: 10_000 });
    if (versionResult.status === 0) { try { version = JSON.parse(versionResult.stdout); } catch { version = versionResult.stdout.trim(); } }
    const status = spawnSync(cli, ["system", "status", "--format", "json"], { encoding: "utf8", timeout: 10_000 });
    if (status.status === 0) { try { system = JSON.parse(status.stdout); } catch { system = status.stdout.trim(); } }
  }
  const versions = Array.isArray(version) ? version : version ? [version] : [];
  const cliVersion = versions.find((entry) => entry && typeof entry === "object" && String((entry as Record<string, unknown>).appName || "") === "container") as Record<string, unknown> | undefined;
  const apiVersion = versions.find((entry) => entry && typeof entry === "object" && String((entry as Record<string, unknown>).appName || "") !== "container") as Record<string, unknown> | undefined;
  const systemStatus = system && typeof system === "object" ? String((system as Record<string, unknown>).status || "") : "";
  const apiVersionValue = String(apiVersion?.version || "");
  // Apple 1.1.0 emits the CLI as a bare semantic version, but the API server
  // as `container-apiserver version 1.1.0 (build: …)`. Match that exact pinned
  // version token and reject a different semantic version in either shape.
  const exactApiVersion = apiVersionValue === APPLE_RUNTIME_VERSION
    || new RegExp(`^container-apiserver version ${APPLE_RUNTIME_VERSION.replaceAll(".", "\\.")}(?:\\s|$)`).test(apiVersionValue);
  const exactRuntime = String(cliVersion?.version || "") === APPLE_RUNTIME_VERSION
    && exactApiVersion
    && systemStatus === "running";
  const macosVersion = darwin ? spawnSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8" }).stdout?.trim() || "" : "";
  const supportedMac = darwin && arm64 && Number(macosVersion.split(".")[0] || 0) >= 26;
  return {
    backend, supported: backend !== "apple" || supportedMac, darwin, arm64, macos_version: macosVersion || null, cli: cli || null, version, system,
    runtime_version: APPLE_RUNTIME_VERSION, installer_url: APPLE_RUNTIME_URL, installer_sha256: APPLE_RUNTIME_SHA256,
    ready: backend !== "apple" || Boolean(supportedMac && cli && exactRuntime),
  };
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
  const readiness = runtimeReadiness();
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

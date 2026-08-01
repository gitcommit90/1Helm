import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./db.ts";

export type TunnelCredential = { account_tag: string; tunnel_id: string; tunnel_secret: string };

const ROOT = join(DATA_DIR, "cloudflare");
const processes = new Map<string, ChildProcess>();
const processGenerations = new Map<string, number>();
const desired = new Set<string>();
const relaunchTimers = new Map<string, NodeJS.Timeout>();
const generations = new Map<string, number>();
const RELAUNCH_MS = Math.max(25, Number(process.env.HELM_CONNECTOR_RELAUNCH_MS) || 5000);
let shuttingDown = false;

function connectorBinary(): string {
  const resources = process.env.HELM_RESOURCES_PATH || "";
  // Linux systemd releases run with /opt/1helm/current as their working
  // directory. Keep that installed-root contract usable even if an older unit
  // omitted HELM_APP_ROOT, while preferring the explicit packaged root.
  const appRoots = [...new Set([process.env.HELM_APP_ROOT || "", process.cwd()].filter(Boolean))];
  const pathSep = process.platform === "win32" ? ";" : ":";
  const pathNames = process.platform === "win32" ? ["cloudflared.exe", "cloudflared"] : ["cloudflared"];
  const linuxConnector = process.platform === "linux" && (process.arch === "x64" || process.arch === "arm64")
    ? `cloudflared-linux-${process.arch}`
    : "";
  const pathCandidates = String(process.env.PATH || "").split(pathSep).filter(Boolean).flatMap((directory) => pathNames.map((name) => join(directory, name)));
  const candidates = [
    process.env.CLOUDFLARED_BIN || "",
    // Packaged desktop apps (macOS Resources/cloudflared, Windows resources/cloudflared.exe).
    resources ? join(resources, "cloudflared.exe") : "",
    resources ? join(resources, "cloudflared") : "",
    ...appRoots.flatMap((appRoot) => [
      join(appRoot, "cloudflared.exe"),
      join(appRoot, "cloudflared"),
      linuxConnector ? join(appRoot, "resources", linuxConnector) : "",
    ]),
    "/opt/homebrew/bin/cloudflared",
    "/usr/local/bin/cloudflared",
    "/usr/bin/cloudflared",
    ...pathCandidates,
  ].filter(Boolean);
  return candidates.find(existsSync) || (process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
}

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 100);
const connectorDir = (id: string): string => join(ROOT, safeId(id));

export function connectorAvailable(): boolean {
  const binary = connectorBinary();
  if (binary === "cloudflared" || binary === "cloudflared.exe") return false;
  return existsSync(binary);
}

export function saveTunnelConnector(id: string, credential: TunnelCredential, hostnames: string[], port: number): void {
  const dir = connectorDir(id);
  mkdirSync(dir, { recursive: true });
  const credentialsPath = join(dir, "credentials.json");
  writeFileSync(credentialsPath, JSON.stringify({
    AccountTag: credential.account_tag,
    TunnelID: credential.tunnel_id,
    TunnelSecret: credential.tunnel_secret,
  }), { mode: 0o600 });
  const ingress = hostnames.map((hostname) => `  - hostname: ${hostname}\n    service: http://127.0.0.1:${port}`).join("\n");
  writeFileSync(join(dir, "config.yml"), [
    `tunnel: ${credential.tunnel_id}`,
    `credentials-file: ${credentialsPath}`,
    "",
    "ingress:",
    ingress,
    "  - service: http_status:404",
    "",
  ].join("\n"), { mode: 0o600 });
}

export function connectorConfigured(id: string): boolean {
  return existsSync(join(connectorDir(id), "config.yml"));
}

export function startTunnelConnector(id: string): void {
  if (shuttingDown) return;
  const config = join(connectorDir(id), "config.yml");
  if (!existsSync(config)) throw new Error("The workspace connector is not configured.");
  const wasDesired = desired.has(id);
  const generation = wasDesired ? (generations.get(id) || 0) : (generations.get(id) || 0) + 1;
  if (!wasDesired) {
    generations.set(id, generation);
    desired.add(id);
  }
  const schedule = (): void => {
    if (shuttingDown || !desired.has(id) || generations.get(id) !== generation || relaunchTimers.has(id)) return;
    const timer = setTimeout(() => {
      relaunchTimers.delete(id);
      launch();
    }, RELAUNCH_MS);
    timer.unref();
    relaunchTimers.set(id, timer);
  };
  const launch = (): void => {
    if (shuttingDown || !desired.has(id) || generations.get(id) !== generation) return;
    const existing = processes.get(id);
    if (existing && existing.exitCode == null) {
      if (processGenerations.get(id) !== generation) schedule();
      return;
    }
    if (existing) processes.delete(id);
    const child = spawn(connectorBinary(), ["--no-autoupdate", "--config", config, "tunnel", "run"], {
      stdio: ["ignore", "ignore", "pipe"],
      env: process.env,
      windowsHide: true,
    });
    let stderr = "";
    let settled = false;
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); });
    processes.set(id, child);
    processGenerations.set(id, generation);
    const finished = (): void => {
      if (settled) return;
      settled = true;
      if (processes.get(id) === child) {
        processes.delete(id);
        processGenerations.delete(id);
      }
      schedule();
      if (stderr) console.warn(`1Helm Cloudflare connector ${id} stopped: ${stderr.split("\n").filter(Boolean).at(-1) || "unknown error"}`);
    };
    child.once("error", finished);
    child.once("exit", finished);
  };
  const existing = processes.get(id);
  if (existing && existing.exitCode == null && processGenerations.get(id) === generation) return;
  if (existing && existing.exitCode == null) schedule();
  else launch();
}

export function stopTunnelConnector(id: string): void {
  generations.set(id, (generations.get(id) || 0) + 1);
  desired.delete(id);
  const timer = relaunchTimers.get(id);
  if (timer) clearTimeout(timer);
  relaunchTimers.delete(id);
  const child = processes.get(id);
  if (child && child.exitCode == null) child.kill("SIGTERM");
  else {
    processes.delete(id);
    processGenerations.delete(id);
  }
}

export function restartTunnelConnector(id: string): void {
  stopTunnelConnector(id);
  startTunnelConnector(id);
}

export function startConfiguredConnectors(ids: string[]): void {
  for (const id of ids) if (connectorConfigured(id)) startTunnelConnector(id);
}

export function stopAllConnectors(): void {
  shuttingDown = true;
  for (const timer of relaunchTimers.values()) clearTimeout(timer);
  relaunchTimers.clear();
  for (const id of [...processes.keys()]) stopTunnelConnector(id);
}

export function connectorCredential(id: string): TunnelCredential | null {
  try {
    const value = JSON.parse(readFileSync(join(connectorDir(id), "credentials.json"), "utf8")) as Record<string, string>;
    return { account_tag: value.AccountTag, tunnel_id: value.TunnelID, tunnel_secret: value.TunnelSecret };
  } catch { return null; }
}

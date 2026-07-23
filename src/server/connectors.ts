import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./db.ts";

export type TunnelCredential = { account_tag: string; tunnel_id: string; tunnel_secret: string };

const ROOT = join(DATA_DIR, "cloudflare");
const processes = new Map<string, ChildProcess>();
const desired = new Set<string>();
const relaunchTimers = new Map<string, NodeJS.Timeout>();
const generations = new Map<string, number>();
const RELAUNCH_MS = Math.max(25, Number(process.env.HELM_CONNECTOR_RELAUNCH_MS) || 5000);
let shuttingDown = false;

function connectorBinary(): string {
  const pathCandidates = String(process.env.PATH || "").split(":").filter(Boolean).map((directory) => join(directory, "cloudflared"));
  const candidates = [
    process.env.CLOUDFLARED_BIN || "",
    process.env.HELM_RESOURCES_PATH ? join(process.env.HELM_RESOURCES_PATH, "cloudflared") : "",
    "/opt/homebrew/bin/cloudflared",
    "/usr/local/bin/cloudflared",
    "/usr/bin/cloudflared",
    ...pathCandidates,
  ].filter(Boolean);
  return candidates.find(existsSync) || "cloudflared";
}

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 100);
const connectorDir = (id: string): string => join(ROOT, safeId(id));

export function connectorAvailable(): boolean {
  const binary = connectorBinary();
  return binary !== "cloudflared" && existsSync(binary);
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
  const generation = (generations.get(id) || 0) + 1;
  generations.set(id, generation);
  desired.add(id);
  if (processes.get(id)?.exitCode == null && processes.has(id)) return;
  const config = join(connectorDir(id), "config.yml");
  if (!existsSync(config)) throw new Error("The workspace connector is not configured.");
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
    if (shuttingDown || !desired.has(id) || generations.get(id) !== generation || processes.has(id)) return;
    const child = spawn(connectorBinary(), ["--no-autoupdate", "--config", config, "tunnel", "run"], {
      stdio: ["ignore", "ignore", "pipe"],
      env: process.env,
    });
    let stderr = "";
    let settled = false;
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); });
    processes.set(id, child);
    const finished = (): void => {
      if (settled) return;
      settled = true;
      if (processes.get(id) === child) processes.delete(id);
      schedule();
      if (stderr) console.warn(`1Helm Cloudflare connector ${id} stopped: ${stderr.split("\n").filter(Boolean).at(-1) || "unknown error"}`);
    };
    child.once("error", finished);
    child.once("exit", finished);
  };
  launch();
}

export function stopTunnelConnector(id: string): void {
  generations.set(id, (generations.get(id) || 0) + 1);
  desired.delete(id);
  const timer = relaunchTimers.get(id);
  if (timer) clearTimeout(timer);
  relaunchTimers.delete(id);
  const child = processes.get(id);
  if (child && child.exitCode == null) child.kill("SIGTERM");
  else processes.delete(id);
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

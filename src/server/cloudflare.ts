import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, now, q, q1, run, type Row } from "./db.ts";

const CLOUDFLARE_API = (process.env.CLOUDFLARE_API_BASE || "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
const DOMAIN_DIR = join(DATA_DIR, "cloudflare");
const CONFIG_PATH = join(DOMAIN_DIR, "config.yml");
const CREDENTIAL_PATH = join(DOMAIN_DIR, "tunnel.json");
const UNIT_PATH = process.env.CLOUDFLARE_UNIT_PATH || "/etc/systemd/system/1helm-cloudflare-domain.service";

const normalizeHostname = (value: string): string => value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.$/, "");

async function cf<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as { success?: boolean; errors?: { message?: string }[]; result?: T };
  if (!response.ok || !payload.success) throw new Error(payload.errors?.map((error) => error.message).filter(Boolean).join("; ") || `Cloudflare returned HTTP ${response.status}.`);
  return payload.result as T;
}

export function domainsView(): Row[] { return q("SELECT * FROM workspace_domains ORDER BY created"); }

export async function connectCloudflareDomain(hostnameInput: string, token: string, port: number): Promise<Row> {
  const hostname = normalizeHostname(hostnameInput);
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) throw new Error("Enter a complete hostname such as agents.example.com.");
  if (!token.trim()) throw new Error("Paste a Cloudflare API token with Account Tunnel and DNS edit access. It is used once and never stored.");
  const existing = q1("SELECT * FROM workspace_domains WHERE hostname=?", hostname);
  const id = existing ? Number(existing.id) : run("INSERT INTO workspace_domains (hostname,provider,status,created,updated) VALUES (?,'cloudflare','connecting',?,?)", hostname, now(), now()).lastInsertRowid;
  run("UPDATE workspace_domains SET status='connecting',error='',updated=? WHERE id=?", now(), id);
  try {
    if (process.env.CLOUDFLARE_MOCK === "1") {
      run("UPDATE workspace_domains SET status='active',tunnel_id='mock-tunnel',verified=?,updated=? WHERE id=?", now(), now(), id);
      return q1("SELECT * FROM workspace_domains WHERE id=?", id)!;
    }
    const zones = await cf<{ id: string; name: string; account: { id: string } }[]>(token, `/zones?status=active&per_page=50`);
    const zone = zones.filter((candidate) => hostname === candidate.name || hostname.endsWith(`.${candidate.name}`)).sort((a, b) => b.name.length - a.name.length)[0];
    if (!zone) throw new Error("That hostname is not in an active zone available to this Cloudflare token.");
    const accountId = zone.account.id;
    const secret = randomBytes(32).toString("base64");
    const tunnel = await cf<{ id: string; name: string }>(token, `/accounts/${accountId}/cfd_tunnel`, {
      method: "POST",
      body: JSON.stringify({ name: `1helm-${hostname.replace(/[^a-z0-9]+/g, "-").slice(0, 48)}-${Date.now().toString(36)}`, tunnel_secret: secret, config_src: "local" }),
    });
    await cf(token, `/zones/${zone.id}/dns_records`, {
      method: "POST",
      body: JSON.stringify({ type: "CNAME", name: hostname, content: `${tunnel.id}.cfargotunnel.com`, proxied: true, ttl: 1, comment: "Connected by 1Helm" }),
    }).catch(async (error) => {
      const records = await cf<{ id: string }[]>(token, `/zones/${zone.id}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`);
      if (!records.length) throw error;
      await cf(token, `/zones/${zone.id}/dns_records/${records[0].id}`, { method: "PUT", body: JSON.stringify({ type: "CNAME", name: hostname, content: `${tunnel.id}.cfargotunnel.com`, proxied: true, ttl: 1, comment: "Connected by 1Helm" }) });
    });
    installTunnel({ accountId, tunnelId: tunnel.id, secret, hostname, port });
    run("UPDATE workspace_domains SET status='active',tunnel_id=?,verified=?,updated=? WHERE id=?", tunnel.id, now(), now(), id);
    return q1("SELECT * FROM workspace_domains WHERE id=?", id)!;
  } catch (error) {
    const message = (error as Error).message.slice(0, 1000);
    run("UPDATE workspace_domains SET status='error',error=?,updated=? WHERE id=?", message, now(), id);
    throw new Error(message);
  }
}

function installTunnel(opts: { accountId: string; tunnelId: string; secret: string; hostname: string; port: number }): void {
  mkdirSync(DOMAIN_DIR, { recursive: true });
  writeFileSync(CREDENTIAL_PATH, JSON.stringify({ AccountTag: opts.accountId, TunnelSecret: opts.secret, TunnelID: opts.tunnelId }), { mode: 0o600 });
  chmodSync(CREDENTIAL_PATH, 0o600);
  writeFileSync(CONFIG_PATH, [
    `tunnel: ${opts.tunnelId}`,
    `credentials-file: ${CREDENTIAL_PATH}`,
    "",
    "ingress:",
    `  - hostname: ${opts.hostname}`,
    `    service: http://127.0.0.1:${opts.port}`,
    "  - service: http_status:404",
    "",
  ].join("\n"));
  const cloudflared = process.env.CLOUDFLARED_BIN || (existsSync("/usr/bin/cloudflared") ? "/usr/bin/cloudflared" : "/usr/local/bin/cloudflared");
  writeFileSync(UNIT_PATH, [
    "[Unit]",
    "Description=1Helm Cloudflare custom domain",
    // The live deployment retains this legacy systemd unit identifier. It is
    // an infrastructure compatibility name, not product branding.
    "After=network-online.target 1herd-refactored.service",
    "Wants=network-online.target",
    "",
    "[Service]",
    `ExecStart=${cloudflared} --no-autoupdate --config ${CONFIG_PATH} tunnel run`,
    "Restart=on-failure",
    "RestartSec=5s",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n"));
  const systemctl = process.env.CLOUDFLARE_SYSTEMCTL_BIN || "systemctl";
  execFileSync(systemctl, ["daemon-reload"], { timeout: 15_000 });
  execFileSync(systemctl, ["enable", "--now", "1helm-cloudflare-domain.service"], { timeout: 30_000 });
}

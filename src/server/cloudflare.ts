import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, now, q, q1, run, type Row } from "./db.ts";
import { connectorConfigured, connectorCredential, saveTunnelConnector, startTunnelConnector, type TunnelCredential } from "./connectors.ts";

const CLOUDFLARE_API = (process.env.CLOUDFLARE_API_BASE || "https://api.cloudflare.com/client/v4").replace(/\/$/, "");

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
    const connectorId = `custom-${id}`;
    saveTunnelConnector(connectorId, { account_tag: accountId, tunnel_id: tunnel.id, tunnel_secret: secret }, [hostname], port);
    startTunnelConnector(connectorId);
    run("UPDATE workspace_domains SET status='active',tunnel_id=?,verified=?,updated=? WHERE id=?", tunnel.id, now(), now(), id);
    return q1("SELECT * FROM workspace_domains WHERE id=?", id)!;
  } catch (error) {
    const message = (error as Error).message.slice(0, 1000);
    run("UPDATE workspace_domains SET status='error',error=?,updated=? WHERE id=?", message, now(), id);
    throw new Error(message);
  }
}

export function startCustomDomainConnectors(port: number): void {
  const active = q("SELECT id,hostname FROM workspace_domains WHERE status='active'");
  for (const domain of active) {
    const id = `custom-${domain.id}`;
    let credential = connectorCredential(id);
    // Migrate the single-domain layout used by earlier releases into the
    // per-connector layout without asking the Captain to reconnect it.
    const legacy = join(DATA_DIR, "cloudflare", "tunnel.json");
    if (!credential && active.length === 1 && existsSync(legacy)) {
      try {
        const parsed = JSON.parse(readFileSync(legacy, "utf8")) as Record<string, string>;
        credential = { account_tag: parsed.AccountTag, tunnel_id: parsed.TunnelID, tunnel_secret: parsed.TunnelSecret } as TunnelCredential;
      } catch { /* malformed legacy state remains visibly disconnected */ }
    }
    if (credential) saveTunnelConnector(id, credential, [String(domain.hostname)], port);
    if (connectorConfigured(id)) startTunnelConnector(id);
  }
}

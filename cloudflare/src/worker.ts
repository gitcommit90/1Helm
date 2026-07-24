interface Env {
  REGISTRY: D1Database;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_ZONE_ID: string;
  CLOUDFLARE_RUNTIME_TOKEN: string;
  PROVISION_LIMIT?: RateLimit;
  FEEDBACK_LIMIT?: RateLimit;
  FEEDBACK_ADMIN_TOKEN?: string;
}

type WorkspaceRow = {
  slug: string;
  hostname: string;
  installation_id: string;
  workspace_name: string;
  management_secret_hash: string;
  tunnel_id: string;
  connector_secret_cipher: string;
  status: string;
  enabled: number;
  error: string;
};
const BETA_WORKSPACE_LIMIT = 1000;

const RESERVED = new Set([
  "admin", "api", "app", "assets", "auth", "billing", "blog", "cdn", "demo", "docs", "help", "mail",
  "provision", "security", "status", "support", "www", "1helm", "cloudflare", "login", "signup", "static",
]);
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  },
});
const slugValid = (slug: string): boolean => /^(?=.{3,48}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(slug) && !RESERVED.has(slug);
const bytes = (length: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));
const base64 = (value: Uint8Array): string => btoa(String.fromCharCode(...value));
const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
};
const seal = async (secret: string, value: string): Promise<string> => {
  const rawKey = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const iv = bytes(12);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)));
  return `${base64(iv)}.${base64(encrypted)}`;
};
const unseal = async (secret: string, value: string): Promise<string> => {
  const [ivText, encryptedText] = value.split(".");
  if (!ivText || !encryptedText) throw new Error("Connector recovery data is unavailable.");
  const fromBase64 = (input: string): Uint8Array<ArrayBuffer> => {
    const decoded = atob(input);
    const result = new Uint8Array(new ArrayBuffer(decoded.length));
    for (let index = 0; index < decoded.length; index++) result[index] = decoded.charCodeAt(index);
    return result;
  };
  const rawKey = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivText) }, key, fromBase64(encryptedText));
  return new TextDecoder().decode(decrypted);
};

async function cf<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.CLOUDFLARE_RUNTIME_TOKEN}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  const payload = await response.json() as { success?: boolean; errors?: Array<{ message?: string }>; result?: T };
  if (!response.ok || !payload.success) throw new Error(payload.errors?.map((item) => item.message).filter(Boolean).join("; ") || `Cloudflare returned HTTP ${response.status}.`);
  return payload.result as T;
}

async function authenticatedWorkspace(request: Request, env: Env, slug: string): Promise<WorkspaceRow | null> {
  const secret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!secret) return null;
  const row = await env.REGISTRY.prepare("SELECT * FROM workspaces WHERE slug=?").bind(slug).first<WorkspaceRow>();
  if (!row || await sha256(secret) !== row.management_secret_hash) return null;
  return row;
}

async function claim(request: Request, env: Env): Promise<Response> {
  const clientAddress = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.PROVISION_LIMIT && !(await env.PROVISION_LIMIT.limit({ key: clientAddress })).success) {
    return json({ error: "Too many workspace provisioning attempts. Try again shortly." }, 429);
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const slug = String(body.slug || "").trim().toLowerCase();
  const installationId = String(body.installation_id || "").trim();
  const workspaceName = String(body.workspace_name || "My Workspace").trim().slice(0, 100) || "My Workspace";
  const managementSecret = String(body.management_secret || "");
  if (!slugValid(slug)) return json({ error: "Choose 3–48 lowercase letters, numbers, or hyphens. That address may also be reserved." }, 400);
  if (!/^[a-f0-9]{16}$/.test(installationId) || managementSecret.length < 32) return json({ error: "This 1Helm installation could not be verified." }, 400);
  const existingInstallation = await env.REGISTRY.prepare("SELECT * FROM workspaces WHERE installation_id=?").bind(installationId).first<WorkspaceRow>();
  if (existingInstallation) {
    if (existingInstallation.management_secret_hash !== await sha256(managementSecret)) return json({ error: "This installation already owns a different workspace address." }, 409);
    const connector = existingInstallation.status === "active" && existingInstallation.connector_secret_cipher
      ? { account_tag: env.CLOUDFLARE_ACCOUNT_ID, tunnel_id: existingInstallation.tunnel_id, tunnel_secret: await unseal(managementSecret, existingInstallation.connector_secret_cipher) }
      : undefined;
    return json({
      workspace: { slug: existingInstallation.slug, hostname: existingInstallation.hostname, status: existingInstallation.status, enabled: Boolean(existingInstallation.enabled) },
      connector,
      existing: true,
    });
  }
  const hostname = `${slug}.1helm.com`;
  const now = Date.now();
  try {
    const reservation = await env.REGISTRY.prepare(`INSERT INTO workspaces
      (slug,hostname,installation_id,workspace_name,management_secret_hash,status,enabled,created_at,updated_at)
      SELECT ?,?,?,?,?,'provisioning',1,?,?
      WHERE (SELECT COUNT(*) FROM workspaces) < ?`).bind(slug, hostname, installationId, workspaceName, await sha256(managementSecret), now, now, BETA_WORKSPACE_LIMIT).run();
    if (Number(reservation.meta?.changes || 0) !== 1) return json({ error: "The collaboration beta is currently full." }, 503);
  } catch {
    return json({ error: `${hostname} is already taken.` }, 409);
  }

  let tunnelId = "";
  let dnsRecordId = "";
  try {
    const tunnelSecret = base64(bytes(32));
    const tunnel = await cf<{ id: string }>(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel`, {
      method: "POST",
      body: JSON.stringify({ name: `1helm-${slug}-${installationId}`, tunnel_secret: tunnelSecret, config_src: "local" }),
    });
    tunnelId = tunnel.id;
    const dns = await cf<{ id: string }>(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records`, {
      method: "POST",
      body: JSON.stringify({ type: "CNAME", name: hostname, content: `${tunnelId}.cfargotunnel.com`, proxied: true, ttl: 1, comment: "Provisioned by 1Helm" }),
    });
    dnsRecordId = dns.id;
    await env.REGISTRY.prepare("UPDATE workspaces SET tunnel_id=?,connector_secret_cipher=?,status='active',error='',updated_at=? WHERE slug=?").bind(tunnelId, await seal(managementSecret, tunnelSecret), Date.now(), slug).run();
    return json({ workspace: { slug, hostname, status: "active", enabled: true }, connector: { account_tag: env.CLOUDFLARE_ACCOUNT_ID, tunnel_id: tunnelId, tunnel_secret: tunnelSecret } }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Provisioning failed.";
    if (dnsRecordId) await cf(env, `/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records/${dnsRecordId}`, { method: "DELETE" }).catch(() => undefined);
    if (tunnelId) await cf(env, `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnelId}`, { method: "DELETE" }).catch(() => undefined);
    await env.REGISTRY.prepare("DELETE FROM workspaces WHERE slug=? AND status='provisioning'").bind(slug).run().catch(() => undefined);
    return json({ error: message }, 502);
  }
}

async function workspaceAction(request: Request, env: Env, slug: string): Promise<Response> {
  const workspace = await authenticatedWorkspace(request, env, slug);
  if (!workspace) return json({ error: "Workspace authorization failed." }, 401);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const enabled = body.enabled !== false;
  await env.REGISTRY.prepare("UPDATE workspaces SET enabled=?,updated_at=? WHERE slug=?").bind(enabled ? 1 : 0, Date.now(), slug).run();
  return json({ workspace: { slug, hostname: workspace.hostname, status: workspace.status, enabled } });
}

async function feedbackIntake(request: Request, env: Env): Promise<Response> {
  const address = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.FEEDBACK_LIMIT && !(await env.FEEDBACK_LIMIT.limit({ key: address })).success) {
    return json({ error: "Too many feedback reports. Try again shortly." }, 429);
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const publicId = String(body.public_id || "");
  const installationId = String(body.installation_id || "");
  const workspaceName = String(body.workspace_name || "").trim().slice(0, 100);
  const comment = String(body.comment || "").trim().slice(0, 10_000);
  const diagnostics = body.diagnostics && typeof body.diagnostics === "object" && !Array.isArray(body.diagnostics) ? body.diagnostics : {};
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 3) as Array<Record<string, unknown>> : [];
  if (!/^fb_[a-f0-9]{24}$/.test(publicId) || !/^[a-f0-9]{16}$/.test(installationId)) {
    return json({ error: "Feedback source could not be verified." }, 400);
  }
  if (!comment && !attachments.length) return json({ error: "Feedback is empty." }, 400);
  if (JSON.stringify(diagnostics).length > 64 * 1024) return json({ error: "Diagnostics are too large." }, 413);
  let total = 0;
  for (const attachment of attachments) {
    const size = Number(attachment.size || 0);
    const data = String(attachment.data || "");
    if (size < 0 || size > 5 * 1024 * 1024 || data.length > 7 * 1024 * 1024) {
      return json({ error: "A feedback attachment is too large." }, 413);
    }
    total += size;
  }
  if (total > 10 * 1024 * 1024) return json({ error: "Feedback attachments are too large." }, 413);
  const timestamp = Date.now();
  await env.REGISTRY.prepare(`INSERT OR IGNORE INTO feedback_reports
    (public_id,installation_id,workspace_name,comment,diagnostics,attachment_count,created_at,received_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(publicId, installationId, workspaceName, comment, JSON.stringify(diagnostics), attachments.length, timestamp, timestamp).run();
  const exists = await env.REGISTRY.prepare("SELECT 1 FROM feedback_attachments WHERE report_id=? LIMIT 1").bind(publicId).first();
  if (!exists) {
    for (const attachment of attachments) await env.REGISTRY.prepare(`INSERT INTO feedback_attachments
      (report_id,name,mime,size,data,created_at) VALUES (?,?,?,?,?,?)`).bind(
      publicId,
      String(attachment.name || "attachment").slice(0, 255),
      String(attachment.mime || "application/octet-stream").slice(0, 120),
      Number(attachment.size || 0),
      String(attachment.data || ""),
      timestamp,
    ).run();
  }
  return json({ id: publicId }, 202);
}

async function feedbackInbox(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!env.FEEDBACK_ADMIN_TOKEN || token !== env.FEEDBACK_ADMIN_TOKEN) return json({ error: "Not found" }, 404);
  const results = await env.REGISTRY.prepare(`SELECT public_id,installation_id,workspace_name,comment,diagnostics,
    attachment_count,created_at created,received_at FROM feedback_reports ORDER BY received_at DESC LIMIT 500`).all<Record<string, unknown>>();
  return json({ reports: (results.results || []).map((report) => ({
    ...report,
    diagnostics: JSON.parse(String(report.diagnostics || "{}")),
    state: "delivered",
    attachments: [],
  })) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return json({ ok: true });
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname === "/v1/feedback" && request.method === "POST") return feedbackIntake(request, env);
    if (url.pathname === "/v1/feedback" && request.method === "GET") return feedbackInbox(request, env);
    const availability = url.pathname.match(/^\/v1\/slugs\/([a-z0-9-]+)$/);
    if (availability && request.method === "GET") {
      const slug = availability[1].toLowerCase();
      const existing = slugValid(slug) ? await env.REGISTRY.prepare("SELECT 1 FROM workspaces WHERE slug=?").bind(slug).first() : { exists: true };
      return json({ slug, hostname: `${slug}.1helm.com`, available: slugValid(slug) && !existing, reason: !slugValid(slug) ? "invalid_or_reserved" : existing ? "taken" : "available" });
    }
    if (url.pathname === "/v1/workspaces" && request.method === "POST") return claim(request, env);
    const action = url.pathname.match(/^\/v1\/workspaces\/([a-z0-9-]+)$/);
    if (action && request.method === "POST") return workspaceAction(request, env, action[1]);
    return json({ error: "Not found" }, 404);
  },
};

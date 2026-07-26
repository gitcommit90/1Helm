interface Env {
  REGISTRY: D1Database;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_ZONE_ID: string;
  CLOUDFLARE_RUNTIME_TOKEN: string;
  PROVISION_LIMIT?: RateLimit;
  FEEDBACK_LIMIT?: RateLimit;
  PUSH_LIMIT?: RateLimit;
  FEEDBACK_ADMIN_TOKEN?: string;
  PUSH_DEVICE_ENCRYPTION_KEY?: string;
  APNS_TEAM_ID?: string;
  APNS_KEY_ID?: string;
  APNS_PRIVATE_KEY?: string;
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
type PushInstallationRow = { installation_id: string };
type PushDeviceRow = { id: number; installation_id: string; recipient_id: string; platform: string; token_cipher: string; token_hash: string };
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
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
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
const base64url = (value: Uint8Array | string): string => {
  const bytesValue = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return base64(bytesValue).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const pemBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const body = value.replace(/\\n/g, "\n").replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
  const decoded = atob(body);
  const result = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index++) result[index] = decoded.charCodeAt(index);
  return result;
};

let apnsAuthorization: { value: string; created: number } | null = null;
async function apnsToken(env: Env): Promise<string> {
  if (!env.APNS_TEAM_ID || !env.APNS_KEY_ID || !env.APNS_PRIVATE_KEY) throw new Error("APNs delivery is not configured.");
  const timestamp = Math.floor(Date.now() / 1000);
  if (apnsAuthorization && timestamp - apnsAuthorization.created < 45 * 60) return apnsAuthorization.value;
  const header = base64url(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID }));
  const claims = base64url(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: timestamp }));
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(env.APNS_PRIVATE_KEY), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`)));
  apnsAuthorization = { value: `${header}.${claims}.${base64url(signature)}`, created: timestamp };
  return apnsAuthorization.value;
}

async function authenticatedPushInstallation(request: Request, env: Env, installationId: string): Promise<PushInstallationRow | null> {
  const secret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!secret || !/^[a-f0-9]{16}$/.test(installationId)) return null;
  const row = await env.REGISTRY.prepare("SELECT * FROM push_installations WHERE installation_id=?").bind(installationId).first<PushInstallationRow & { management_secret_hash?: string }>();
  return row && await sha256(secret) === row.management_secret_hash ? row : null;
}

async function registerPushInstallation(request: Request, env: Env): Promise<Response> {
  const clientAddress = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.PUSH_LIMIT && !(await env.PUSH_LIMIT.limit({ key: `install:${clientAddress}` })).success) return json({ error: "Too many phone-notification registration attempts. Try again shortly." }, 429);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const installationId = String(body.installation_id || "");
  const secret = String(body.management_secret || "");
  if (!/^[a-f0-9]{16}$/.test(installationId) || secret.length < 32) return json({ error: "This 1Helm installation could not be verified." }, 400);
  const hashed = await sha256(secret);
  const existing = await env.REGISTRY.prepare("SELECT * FROM push_installations WHERE installation_id=?").bind(installationId).first<PushInstallationRow>();
  if (existing && (existing as PushInstallationRow & { management_secret_hash?: string }).management_secret_hash !== hashed) return json({ error: "This installation is owned by different push credentials." }, 409);
  if (!existing) await env.REGISTRY.prepare("INSERT INTO push_installations (installation_id,management_secret_hash,created_at,updated_at) VALUES (?,?,?,?)").bind(installationId, hashed, Date.now(), Date.now()).run();
  else await env.REGISTRY.prepare("UPDATE push_installations SET updated_at=? WHERE installation_id=?").bind(Date.now(), installationId).run();
  return json({ ok: true });
}

async function pushDevice(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const installationId = String(body.installation_id || "");
  const clientAddress = request.headers.get("cf-connecting-ip") || "unknown";
  if (env.PUSH_LIMIT && !(await env.PUSH_LIMIT.limit({ key: `device:${installationId}:${clientAddress}` })).success) return json({ error: "Too many phone-notification device requests. Try again shortly." }, 429);
  if (!await authenticatedPushInstallation(request, env, installationId)) return json({ error: "Push authorization failed." }, 401);
  if (!env.PUSH_DEVICE_ENCRYPTION_KEY) return json({ error: "Push device storage is not configured." }, 503);
  const recipientId = String(body.recipient_id || "");
  const platform = String(body.platform || "");
  const token = String(body.token || "").trim();
  if (!/^[a-f0-9]{32}$/.test(recipientId) || !["ios", "android"].includes(platform) || !/^[A-Za-z0-9:_-]{32,4096}$/.test(token)) return json({ error: "Invalid push device." }, 400);
  const tokenHash = await sha256(`${platform}:${token}`);
  if (request.method === "DELETE") {
    await env.REGISTRY.prepare("DELETE FROM push_devices WHERE installation_id=? AND recipient_id=? AND platform=? AND token_hash=?").bind(installationId, recipientId, platform, tokenHash).run();
    return json({ ok: true });
  }
  const cipher = await seal(env.PUSH_DEVICE_ENCRYPTION_KEY, token);
  const timestamp = Date.now();
  await env.REGISTRY.prepare(`INSERT INTO push_devices (installation_id,recipient_id,platform,token_hash,token_cipher,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(installation_id,platform,token_hash) DO UPDATE SET recipient_id=excluded.recipient_id,token_cipher=excluded.token_cipher,updated_at=excluded.updated_at`).bind(
    installationId, recipientId, platform, tokenHash, cipher, timestamp, timestamp,
  ).run();
  return json({ ok: true });
}

async function sendApns(env: Env, device: PushDeviceRow, notification: Record<string, unknown>): Promise<{ delivered: boolean; permanent: boolean; reason: string }> {
  if (!env.PUSH_DEVICE_ENCRYPTION_KEY) throw new Error("Push device storage is not configured.");
  const token = await unseal(env.PUSH_DEVICE_ENCRYPTION_KEY, device.token_cipher);
  const authorization = await apnsToken(env);
  const alert = { title: String(notification.title || "1Helm").slice(0, 178), body: String(notification.body || "New activity").slice(0, 512) };
  const aps: Record<string, unknown> = { alert, "thread-id": `channel-${Number(notification.channelId || 0)}`, "interruption-level": "active" };
  if (notification.sound !== false) aps.sound = "default";
  const payload = JSON.stringify({
    aps,
    channelId: Number(notification.channelId || 0),
    messageId: Number(notification.messageId || 0),
    rootMessageId: Number(notification.rootMessageId || 0) || null,
  });
  const send = async (host: string): Promise<Response> => fetch(`https://${host}/3/device/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${authorization}`,
      "apns-topic": "com.gitcommit90.onehelm.mobile",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": String(notification.idempotency_key || `message-${notification.messageId || "new"}`).slice(0, 64),
    },
    body: payload,
  });
  let response = await send("api.push.apple.com");
  let result = await response.json().catch(() => ({})) as { reason?: string };
  if (!response.ok && result.reason === "BadDeviceToken") {
    response = await send("api.sandbox.push.apple.com");
    result = await response.json().catch(() => ({})) as { reason?: string };
  }
  const reason = String(result.reason || (response.ok ? "" : `HTTP ${response.status}`));
  return { delivered: response.ok, permanent: response.status === 410 || ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(reason), reason };
}

async function pushDelivery(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const installationId = String(body.installation_id || "");
  if (env.PUSH_LIMIT && !(await env.PUSH_LIMIT.limit({ key: `delivery:${installationId}` })).success) return json({ error: "Phone-notification delivery is temporarily rate limited." }, 429);
  if (!await authenticatedPushInstallation(request, env, installationId)) return json({ error: "Push authorization failed." }, 401);
  const recipientId = String(body.recipient_id || "");
  const idempotencyKey = String(body.idempotency_key || "").slice(0, 200);
  if (!/^[a-f0-9]{32}$/.test(recipientId) || !idempotencyKey) return json({ error: "Invalid push delivery." }, 400);
  const claimed = await env.REGISTRY.prepare(`INSERT OR IGNORE INTO push_deliveries
    (installation_id,idempotency_key,recipient_id,delivered_count,created_at) VALUES (?,?,?,-1,?)`).bind(installationId, idempotencyKey, recipientId, Date.now()).run();
  if (!Number(claimed.meta.changes || 0)) {
    const previous = await env.REGISTRY.prepare("SELECT delivered_count FROM push_deliveries WHERE installation_id=? AND idempotency_key=?").bind(installationId, idempotencyKey).first<{ delivered_count: number }>();
    return json({ delivered: Math.max(0, Number(previous?.delivered_count || 0)), existing: true });
  }
  const results = await env.REGISTRY.prepare("SELECT * FROM push_devices WHERE installation_id=? AND recipient_id=? ORDER BY id").bind(installationId, recipientId).all<PushDeviceRow>();
  const devices = results.results || [];
  let delivered = 0;
  const errors: string[] = [];
  for (const device of devices) {
    if (device.platform !== "ios") { errors.push("Android delivery is not configured."); continue; }
    try {
      const outcome = await sendApns(env, device, { ...body, idempotency_key: idempotencyKey });
      if (outcome.delivered) delivered += 1;
      else if (outcome.reason) errors.push(outcome.reason);
      if (outcome.permanent) await env.REGISTRY.prepare("DELETE FROM push_devices WHERE id=?").bind(device.id).run();
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  if (devices.length && delivered === 0 && errors.length) {
    await env.REGISTRY.prepare("DELETE FROM push_deliveries WHERE installation_id=? AND idempotency_key=? AND delivered_count=-1").bind(installationId, idempotencyKey).run();
    return json({ error: errors.join("; ").slice(0, 500) }, 502);
  }
  await env.REGISTRY.prepare("UPDATE push_deliveries SET delivered_count=? WHERE installation_id=? AND idempotency_key=?").bind(delivered, installationId, idempotencyKey).run();
  return json({ delivered, devices: devices.length });
}

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
    const validBase64 = data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(data);
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    const decodedSize = data.length ? (data.length / 4) * 3 - padding : 0;
    if (!Number.isSafeInteger(size) || !validBase64 || decodedSize !== size
      || size < 0 || size > 5 * 1024 * 1024 || data.length > 7 * 1024 * 1024) {
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
    if (url.pathname === "/v1/push/installations" && request.method === "POST") return registerPushInstallation(request, env);
    if (url.pathname === "/v1/push/devices" && ["POST", "DELETE"].includes(request.method)) return pushDevice(request, env);
    if (url.pathname === "/v1/push/deliveries" && request.method === "POST") return pushDelivery(request, env);
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

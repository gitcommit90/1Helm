import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, hashPassword, newToken, now, q, q1, run, tx, type Row } from "./db.ts";
import { connectorAvailable, connectorConfigured, connectorCredential, saveTunnelConnector, startTunnelConnector, stopTunnelConnector, type TunnelCredential } from "./connectors.ts";

const PROVISIONER = (process.env.HELM_PROVISIONER_URL || "https://provision.1helm.com").replace(/\/$/, "");
const DIR = join(DATA_DIR, "collaboration");
const SECRET_PATH = join(DIR, "management-secret");
const CONNECTOR_ID = "workspace";

function managementSecret(): string {
  mkdirSync(DIR, { recursive: true });
  if (existsSync(SECRET_PATH)) return readFileSync(SECRET_PATH, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  return secret;
}

async function provisioner<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${PROVISIONER}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Workspace provisioning returned HTTP ${response.status}.`);
  return payload;
}

export function collaborationView(): Record<string, unknown> {
  const workspace = q1("SELECT * FROM workspace WHERE id=1") || {};
  const custom = q1("SELECT hostname,status FROM workspace_domains WHERE status='active' ORDER BY verified DESC LIMIT 1");
  const hostname = String(workspace.collaboration_hostname || "");
  return {
    enabled: Boolean(workspace.collaboration_enabled),
    slug: String(workspace.collaboration_slug || ""),
    hostname,
    status: String(workspace.collaboration_status || "off"),
    error: String(workspace.collaboration_error || ""),
    accept_new_requests: Boolean(workspace.accept_new_requests),
    custom_domain: custom ? String(custom.hostname) : "",
    primary_url: custom ? `https://${custom.hostname}` : hostname ? `https://${hostname}` : "",
    connector_available: connectorAvailable(),
  };
}

export async function slugAvailability(slug: string): Promise<Record<string, unknown>> {
  return provisioner(`/v1/slugs/${encodeURIComponent(slug.trim().toLowerCase())}`);
}

export async function claimWorkspace(slug: string, workspaceName: string, port: number): Promise<Record<string, unknown>> {
  const workspace = q1("SELECT installation_id FROM workspace WHERE id=1");
  if (!workspace) throw new Error("Workspace state is unavailable.");
  run("UPDATE workspace SET collaboration_status='provisioning',collaboration_error='' WHERE id=1");
  try {
    const result = await provisioner<{
      workspace: { slug: string; hostname: string; status: string; enabled: boolean };
      connector?: TunnelCredential;
      existing?: boolean;
    }>("/v1/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: slug.trim().toLowerCase(),
        installation_id: String(workspace.installation_id),
        workspace_name: workspaceName,
        management_secret: managementSecret(),
      }),
    });
    if (result.connector) saveTunnelConnector(CONNECTOR_ID, result.connector, [result.workspace.hostname], port);
    if (!connectorConfigured(CONNECTOR_ID)) throw new Error("The workspace address exists, but this Mac does not have its connector credential. Contact 1Helm support to rotate it.");
    run(`UPDATE workspace SET collaboration_enabled=1,collaboration_slug=?,collaboration_hostname=?,
      collaboration_status='active',collaboration_error='' WHERE id=1`, result.workspace.slug, result.workspace.hostname);
    startTunnelConnector(CONNECTOR_ID);
    return collaborationView();
  } catch (error) {
    const message = (error as Error).message.slice(0, 1000);
    run("UPDATE workspace SET collaboration_status='error',collaboration_error=? WHERE id=1", message);
    throw new Error(message);
  }
}

export async function setCollaborationEnabled(enabled: boolean): Promise<Record<string, unknown>> {
  const workspace = q1("SELECT collaboration_slug FROM workspace WHERE id=1");
  const slug = String(workspace?.collaboration_slug || "");
  if (!slug) throw new Error("Claim a 1helm.com workspace address first.");
  await provisioner(`/v1/workspaces/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${managementSecret()}`, "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  run("UPDATE workspace SET collaboration_enabled=?,collaboration_status=?,collaboration_error='' WHERE id=1", enabled ? 1 : 0, enabled ? "active" : "off");
  if (enabled) startTunnelConnector(CONNECTOR_ID); else stopTunnelConnector(CONNECTOR_ID);
  return collaborationView();
}

export function setAcceptNewRequests(enabled: boolean): Record<string, unknown> {
  run("UPDATE workspace SET accept_new_requests=? WHERE id=1", enabled ? 1 : 0);
  return collaborationView();
}

export function startCollaborationConnector(port: number): void {
  const workspace = q1("SELECT collaboration_enabled,collaboration_slug,collaboration_hostname FROM workspace WHERE id=1");
  if (!workspace?.collaboration_enabled || !workspace.collaboration_slug || !workspace.collaboration_hostname) return;
  const credential = connectorCredential(CONNECTOR_ID);
  if (credential) saveTunnelConnector(CONNECTOR_ID, credential, [String(workspace.collaboration_hostname)], port);
  if (connectorConfigured(CONNECTOR_ID)) startTunnelConnector(CONNECTOR_ID);
}

export function publicWorkspaceStatus(): Record<string, unknown> {
  const workspace = q1("SELECT name,collaboration_enabled,collaboration_hostname,accept_new_requests FROM workspace WHERE id=1") || {};
  return {
    name: String(workspace.name || "1Helm workspace"),
    collaboration_enabled: Boolean(workspace.collaboration_enabled),
    hostname: String(workspace.collaboration_hostname || ""),
    accept_new_requests: Boolean(workspace.accept_new_requests),
  };
}

export function createAccessRequest(emailInput: string, displayInput: string): { token: string; request: Row } {
  const workspace = q1("SELECT name,collaboration_enabled,accept_new_requests FROM workspace WHERE id=1") || {};
  if (!workspace.collaboration_enabled) throw new Error("This workspace is not available for collaboration.");
  if (!workspace.accept_new_requests) throw new Error(`${String(workspace.name || "This workspace")} isn’t accepting requests right now`);
  const email = emailInput.trim().toLowerCase();
  const display = displayInput.trim().slice(0, 100);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (Number(q1("SELECT COUNT(*) n FROM access_requests WHERE status='pending'")?.n || 0) >= 500) throw new Error("This workspace has too many pending requests right now.");
  if (q1("SELECT 1 FROM users WHERE lower(email)=lower(?)", email)) throw new Error("An account already exists for this email. Sign in instead.");
  const existing = q1("SELECT * FROM access_requests WHERE lower(email)=lower(?) AND status IN ('pending','approved')", email);
  if (existing) throw new Error("An access request for this email is already pending.");
  const token = randomBytes(32).toString("hex");
  const hash = hashToken(token);
  const id = run("INSERT INTO access_requests (email,display,request_token_hash,status,requested_at) VALUES (?,?,?,'pending',?)", email, display, hash, now()).lastInsertRowid;
  return { token, request: q1("SELECT id,email,display,status,requested_at FROM access_requests WHERE id=?", id)! };
}

const hashToken = (value: string): string => createHash("sha256").update(value).digest("hex");

export function accessRequestByToken(token: string): Row | undefined {
  return q1("SELECT id,email,display,status,requested_at,reviewed_at FROM access_requests WHERE request_token_hash=?", hashToken(token));
}

export function pendingAccessRequests(): Row[] {
  return q("SELECT id,email,display,status,requested_at,reviewed_at FROM access_requests ORDER BY requested_at DESC");
}

export function reviewAccessRequest(id: number, approved: boolean, reviewerId: number): Row {
  const request = q1("SELECT * FROM access_requests WHERE id=?", id);
  if (!request) throw new Error("Access request not found.");
  if (request.status !== "pending") throw new Error("This access request has already been reviewed.");
  run("UPDATE access_requests SET status=?,reviewed_at=?,reviewed_by=? WHERE id=?", approved ? "approved" : "denied", now(), reviewerId, id);
  return q1("SELECT id,email,display,status,requested_at,reviewed_at FROM access_requests WHERE id=?", id)!;
}

/** Human-only landing channel for approved coworkers. It deliberately has no
 * resident agent, bot membership, computer, or workspace binding. */
export function ensureCollabChannel(userId?: number): number {
  let channel = q1("SELECT id FROM channels WHERE kind='collab' AND status<>'deleted' LIMIT 1");
  const captain = q1("SELECT id FROM users WHERE is_admin=1 ORDER BY id LIMIT 1");
  if (!channel) {
    const id = run(`INSERT INTO channels (name,slug,kind,topic,purpose,status,created_by,created)
      VALUES ('Collab','collab','collab','Human holding space','A human-only holding space for the Captain and coworkers','active',?,?)`, captain?.id ?? null, now()).lastInsertRowid;
    channel = { id };
  }
  if (captain?.id) run("INSERT OR IGNORE INTO members (channel_id,user_id) VALUES (?,?)", channel.id, captain.id);
  if (userId) run("INSERT OR IGNORE INTO members (channel_id,user_id) VALUES (?,?)", channel.id, userId);
  return Number(channel.id);
}

/** Private Skipper home for one human. It has no resident agent or channel
 * computer: Skipper is the workspace-wide agent, while channels this person
 * creates receive their own resident and isolated computer. */
export function ensurePersonalMainChannel(userId: number): number {
  const user = q1("SELECT id,username FROM users WHERE id=?", userId);
  if (!user) throw new Error("Workspace member not found.");
  const existing = q1("SELECT id FROM channels WHERE personal_main_owner_id=? AND status<>'deleted' LIMIT 1", userId);
  if (existing) {
    run("DELETE FROM members WHERE channel_id=? AND user_id<>?", existing.id, userId);
    run("INSERT OR IGNORE INTO members (channel_id,user_id) VALUES (?,?)", existing.id, userId);
    const skipper = q1("SELECT bot_id FROM agents WHERE kind='skipper' AND status<>'deleted' LIMIT 1");
    if (skipper?.bot_id) run("INSERT OR IGNORE INTO bot_channels (bot_id,channel_id) VALUES (?,?)", skipper.bot_id, existing.id);
    return Number(existing.id);
  }
  const stem = String(user.username || `member-${userId}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `member-${userId}`;
  let slug = `main-${stem}`.slice(0, 64);
  for (let suffix = 2; q1("SELECT 1 FROM channels WHERE slug=? AND status<>'deleted'", slug); suffix++) {
    slug = `main-${stem}`.slice(0, Math.max(1, 63 - String(suffix).length)) + `-${suffix}`;
  }
  const id = run(`INSERT INTO channels (name,slug,kind,topic,purpose,status,created_by,personal_main_owner_id,created)
    VALUES ('main',?,'channel','Your private home base with @skipper','Private coordination with Skipper','active',?,?,?)`, slug, userId, userId, now()).lastInsertRowid;
  run("INSERT INTO members (channel_id,user_id) VALUES (?,?)", id, userId);
  const skipper = q1("SELECT bot_id FROM agents WHERE kind='skipper' AND status<>'deleted' LIMIT 1");
  if (skipper?.bot_id) run("INSERT OR IGNORE INTO bot_channels (bot_id,channel_id) VALUES (?,?)", skipper.bot_id, id);
  return id;
}

export function claimApprovedAccess(token: string, usernameInput: string, password: string, displayInput: string): { token: string; user: Row } {
  const username = usernameInput.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{2,32}$/.test(username) || password.length < 8) throw new Error("Use a valid username and a password of at least 8 characters.");
  return tx(() => {
    const request = q1("SELECT * FROM access_requests WHERE request_token_hash=?", hashToken(token));
    if (!request || request.status !== "approved") throw new Error("This access request has not been approved, or its setup link is no longer valid.");
    const display = displayInput.trim().slice(0, 100) || String(request.display || request.email).split("@")[0];
    if (q1("SELECT 1 FROM users WHERE username=? OR lower(email)=lower(?)", username, request.email)) throw new Error("That username or email already has an account.");
    const userId = run("INSERT INTO users (username,email,pass,display,is_admin,created) VALUES (?,?,?,?,0,?)", username, request.email, hashPassword(password), display, now()).lastInsertRowid;
    ensureCollabChannel(userId);
    ensurePersonalMainChannel(userId);
    run("UPDATE access_requests SET status='claimed',claimed_user_id=? WHERE id=?", userId, request.id);
    const sessionToken = newToken();
    run("INSERT INTO sessions (token,user_id,created) VALUES (?,?,?)", sessionToken, userId, now());
    return { token: sessionToken, user: q1("SELECT * FROM users WHERE id=?", userId)! };
  });
}

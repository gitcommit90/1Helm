import { randomBytes } from "node:crypto";
import { configurePhoton, photonStatus } from "./photon.ts";

const DASHBOARD = (): string => String(process.env.PHOTON_DASHBOARD_HOST || "https://app.photon.codes").replace(/\/+$/, "");
const SPECTRUM = (): string => String(process.env.PHOTON_SPECTRUM_HOST || "https://spectrum.photon.codes").replace(/\/+$/, "");
const CLIENT_ID = "photon-cli";
const PROJECT_NAME = "1Helm";
const E164 = /^\+[1-9]\d{6,14}$/;

type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};
type SetupState = {
  id: string;
  status: "waiting" | "provisioning" | "connected" | "failed" | "expired";
  operator_phone: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  started_at: number;
  expires_at: number;
  error: string;
  device?: DeviceCode;
};

let setup: SetupState | null = null;
let polling: Promise<void> | null = null;

export const redactPhotonError = (value: unknown): string => String((value as Error)?.message || value || "Photon setup failed.")
  .replace(/\b(bearer|token|secret)\s*[:=]?\s*[A-Za-z0-9._~+\/-]+/gi, "$1 [redacted]")
  .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]")
  .slice(0, 1000);
const auth = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
const basic = (projectId: string, projectSecret: string): Record<string, string> => ({ authorization: `Basic ${Buffer.from(`${projectId}:${projectSecret}`).toString("base64")}` });

async function jsonFetch(url: string, init: RequestInit = {}): Promise<{ response: Response; body: Record<string, unknown> | unknown[] }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000), headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({})) as Record<string, unknown> | unknown[];
  return { response, body };
}

function unwrap(value: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  for (const key of keys) {
    const nested = row[key];
    if (Array.isArray(nested)) return unwrap(nested, keys);
    if (nested && typeof nested === "object") {
      const found = unwrap(nested, keys);
      if (found.length) return found;
    }
  }
  return [];
}

function publicSetup(): Record<string, unknown> {
  if (!setup) return { active: false, status: photonStatus() };
  const { device: _device, ...visible } = setup;
  return { active: ["waiting", "provisioning"].includes(setup.status), ...visible, connector: photonStatus() };
}

async function requestDeviceCode(): Promise<DeviceCode> {
  const { response, body } = await jsonFetch(`${DASHBOARD()}/api/auth/device/code`, { method: "POST", body: JSON.stringify({ client_id: CLIENT_ID, scope: "openid profile email" }) });
  if (!response.ok || Array.isArray(body)) throw new Error(`Photon device login could not start (HTTP ${response.status}).`);
  const code = body as Record<string, unknown>;
  if (!code.device_code || !code.user_code || !code.verification_uri) throw new Error("Photon returned an incomplete device login response.");
  return {
    device_code: String(code.device_code), user_code: String(code.user_code), verification_uri: String(code.verification_uri),
    verification_uri_complete: String(code.verification_uri_complete || ""), expires_in: Number(code.expires_in || 1800), interval: Number(code.interval || 5),
  };
}

function tokenCandidate(body: Record<string, unknown>, headers: Headers): string {
  const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : {};
  const session = body.session && typeof body.session === "object" ? body.session as Record<string, unknown> : {};
  const value = body.access_token || body.accessToken || data.access_token || data.accessToken || session.access_token || headers.get("set-auth-token") || "";
  return String(value).replace(/^Bearer\s+/i, "").trim();
}

async function validateDashboardToken(token: string): Promise<void> {
  const session = await jsonFetch(`${DASHBOARD()}/api/auth/get-session`, { headers: auth(token) });
  if (!session.response.ok || Array.isArray(session.body) || !(session.body as Record<string, unknown>).user) throw new Error("Photon approved login but did not issue a project-capable session.");
  const projects = await jsonFetch(`${DASHBOARD()}/api/projects/`, { headers: auth(token) });
  if (!projects.response.ok) throw new Error("Photon approved login but rejected project access.");
}

async function findOrCreateProject(token: string): Promise<string> {
  const listed = await jsonFetch(`${DASHBOARD()}/api/projects`, { headers: auth(token) });
  if (!listed.response.ok) throw new Error(`Photon projects could not be read (HTTP ${listed.response.status}).`);
  const existing = unwrap(listed.body, ["data", "projects", "items"]).find((row) => String(row.name || "").toLowerCase() === PROJECT_NAME.toLowerCase());
  if (existing?.id) return String(existing.id);
  const created = await jsonFetch(`${DASHBOARD()}/api/projects`, { method: "POST", headers: auth(token), body: JSON.stringify({ name: PROJECT_NAME, location: "United States", template: false, observability: false }) });
  if (!created.response.ok || Array.isArray(created.body) || !(created.body as Record<string, unknown>).id) throw new Error(`Photon project creation failed (HTTP ${created.response.status}).`);
  return String((created.body as Record<string, unknown>).id);
}

async function rotateProjectSecret(token: string, projectId: string): Promise<string> {
  const rotated = await jsonFetch(`${DASHBOARD()}/api/projects/${encodeURIComponent(projectId)}/regenerate-secret`, { method: "POST", headers: auth(token), body: "{}" });
  const secret = !Array.isArray(rotated.body) ? String((rotated.body as Record<string, unknown>).projectSecret || "") : "";
  if (!rotated.response.ok || secret.length < 12) throw new Error("Photon did not return the one-time project secret.");
  return secret;
}

const normalizedPhone = (value: unknown): string => String(value || "").replace(/[^\d+]/g, "");
async function findOrCreateUser(projectId: string, secret: string, phone: string): Promise<Record<string, unknown>> {
  const headers = basic(projectId, secret);
  const users = await jsonFetch(`${SPECTRUM()}/projects/${encodeURIComponent(projectId)}/users/`, { headers });
  if (!users.response.ok) throw new Error(`Photon rejected the new project credentials (HTTP ${users.response.status}).`);
  const existing = unwrap(users.body, ["data", "users", "items"]).find((row) => normalizedPhone(row.phoneNumber) === phone);
  if (existing) return existing;
  const created = await jsonFetch(`${SPECTRUM()}/projects/${encodeURIComponent(projectId)}/users/`, { method: "POST", headers, body: JSON.stringify({ type: "shared", phoneNumber: phone }) });
  if (!created.response.ok || Array.isArray(created.body)) throw new Error(`Photon user registration failed (HTTP ${created.response.status}).`);
  const body = created.body as Record<string, unknown>;
  const user = body.user || body.data || body;
  if (!user || typeof user !== "object") throw new Error("Photon user registration returned no user.");
  return user as Record<string, unknown>;
}

async function provision(token: string, phone: string): Promise<void> {
  await validateDashboardToken(token);
  const projectId = await findOrCreateProject(token);
  const secret = await rotateProjectSecret(token, projectId);
  const user = await findOrCreateUser(projectId, secret, phone);
  await configurePhoton({ project_id: projectId, project_secret: secret, operator_phone: phone, assigned_phone: String(user.assignedPhoneNumber || ""), dashboard_token: token });
}

async function poll(state: SetupState): Promise<void> {
  const device = state.device!;
  let delay = Math.max(1, device.interval) * 1000;
  try {
    while (setup === state && Date.now() < state.expires_at) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const result = await jsonFetch(`${DASHBOARD()}/api/auth/device/token`, { method: "POST", body: JSON.stringify({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: device.device_code, client_id: CLIENT_ID }) });
      if (result.response.status === 429) { delay += 10_000; continue; }
      const body = Array.isArray(result.body) ? {} : result.body as Record<string, unknown>;
      if (result.response.status === 400) {
        const error = String(body.error || body.message || "");
        if (error === "authorization_pending") continue;
        if (error === "slow_down") { delay += 5000; continue; }
        if (error === "expired_token") { state.status = "expired"; return; }
        throw new Error(`Photon login failed: ${error || "device authorization was rejected"}.`);
      }
      if (!result.response.ok) continue;
      const token = tokenCandidate(body, result.response.headers);
      if (!token) throw new Error("Photon approved login but returned no access token.");
      state.status = "provisioning";
      await provision(token, state.operator_phone);
      state.status = "connected";
      state.error = "";
      delete state.device;
      return;
    }
    if (setup === state && state.status === "waiting") state.status = "expired";
  } catch (error) {
    if (setup === state) { state.status = "failed"; state.error = redactPhotonError(error); delete state.device; }
  }
}

export async function startPhotonSetup(operatorPhone: string): Promise<Record<string, unknown>> {
  const phone = normalizedPhone(operatorPhone);
  if (!E164.test(phone)) throw new Error("Enter the phone that will text 1Helm in E.164 format, for example +15551234567.");
  const device = await requestDeviceCode();
  const started = Date.now();
  setup = {
    id: randomBytes(12).toString("hex"), status: "waiting", operator_phone: phone, user_code: device.user_code,
    verification_uri: device.verification_uri, verification_uri_complete: device.verification_uri_complete || "", started_at: started,
    expires_at: started + device.expires_in * 1000, error: "", device,
  };
  polling = poll(setup).finally(() => { polling = null; });
  void polling;
  return publicSetup();
}

export function photonSetupStatus(): Record<string, unknown> { return publicSetup(); }

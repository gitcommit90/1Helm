// Phone-app notifications (iPhone and Android apps) through the 1Helm push relay at provision.1helm.com, the same service the
// 1Helm 1.5 apps used. The relay holds Apple's push key (APNs) and the Firebase account (FCM); this Worker never sees either.
// 1HC is one relay "installation": PUSH_RELAY = "<16 hex id>:<secret of 32+ characters>". Each workspace is one relay recipient
// (an opaque hash of the tenant id), so one delivery reaches every phone signed in to that workspace.
// A phone is also a row in push_subs (so Settings counts it, and the test button and pushAll find it):
//   endpoint "native:<ios|android>:<sha256(token) first 32 hex>", p256dh = the platform, auth = the token (needed to remove it).
const RELAY = "https://provision.1helm.com/v1/push";
// Licensed: without the 1HC deployment switch (ONEHELM_EE, see ./index.js) no relay is configured, whatever PUSH_RELAY holds.
export const relayCreds = (env) => { if (env?.ONEHELM_EE !== "1hc") return null; const m = /^([a-f0-9]{16}):(.{32,})$/.exec(String(env?.PUSH_RELAY || "")); return m ? { id: m[1], secret: m[2] } : null; };
export const nativeReady = (env) => !!relayCreds(env);
export const isNative = (s) => String(s?.endpoint || "").startsWith("native:");
export const okNative = (platform, token) => (platform === "ios" || platform === "android") && /^[A-Za-z0-9:_-]{32,4096}$/.test(String(token || ""));
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const recipientFor = async (tenantId) => (await hex(`1hc-tenant:${tenantId}`)).slice(0, 32);
export const nativeEndpoint = async (platform, token) => `native:${platform}:${(await hex(`${platform}:${token}`)).slice(0, 32)}`;

let registered = "";   // per isolate: the relay installation is created once (the call is idempotent)
async function relay(env, path, method, body, f = fetch) {
  const c = relayCreds(env); if (!c) throw new Error("Phone notifications aren’t set up on this server.");
  if (registered !== c.id) {
    const r = await f(`${RELAY}/installations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ installation_id: c.id, management_secret: c.secret }) });
    if (!r.ok) throw new Error(`The notification service said no (${r.status}).`);
    registered = c.id;
  }
  return f(`${RELAY}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${c.secret}` }, body: JSON.stringify({ installation_id: c.id, ...body }) });
}
export async function addNativeDevice(env, tenantId, platform, token, f = fetch) {
  const r = await relay(env, "/devices", "POST", { recipient_id: await recipientFor(tenantId), platform, token }, f);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `The notification service said no (${r.status}).`);
  return nativeEndpoint(platform, token);
}
export async function removeNativeDevice(env, tenantId, platform, token, f = fetch) {
  await relay(env, "/devices", "DELETE", { recipient_id: await recipientFor(tenantId), platform, token }, f).catch(() => null);
}
// One notification to every phone of the workspace. payload is the same object Web Push gets (title, body, url, tag, kind).
export async function pushNative(env, tenantId, payload, f = fetch) {
  const r = await relay(env, "/deliveries", "POST", { recipient_id: await recipientFor(tenantId), idempotency_key: crypto.randomUUID(),
    title: String(payload?.title || "1Helm"), body: String(payload?.body || ""), url: String(payload?.url || ""), sound: payload?.sound !== false,
    ...(payload?.tag ? { tag: String(payload.tag) } : {}) }, f);   // tag: the phone replaces the earlier notification with the same tag (the relay checks the characters)
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, delivered: Number(d.delivered || 0), devices: Number(d.devices || 0), error: d.error || "" };
}
// For tests.
export const _resetRelay = () => { registered = ""; };

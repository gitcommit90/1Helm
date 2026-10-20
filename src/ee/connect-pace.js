// Pacing for Composio sign-in links (composio-ratelimit, 10-20). Composio limits requests per organization over a fixed one-minute window,
// and its hosted sign-in page answers "Invalid or expired link ... Too many requests. Retry after 60s." when the window is spent at the
// moment the page opens. So 1Helm never hands out a link while it knows the window is spent, spaces the links it creates for one workspace,
// and when Composio itself answers 429 it remembers the Retry-After for that workspace. The route answers { wait: seconds } instead of a
// link, and the app waits quietly on the Connect button and asks again.
// The state is one D1 row per workspace, tenant_flags k='connect_next_at' (epoch ms before which no new link is made), so it holds across
// Worker isolates, and the claim is one conditional statement, so two taps at the same moment can't both pass.
import { appsMode, gaugeOf } from "./composio-self.js";
import { GAUGE } from "./composio-api.js";

export const CONNECT_GAP_MS = 2500;       // least time between two links for one workspace
export const COOLDOWN_MAX_MS = 65000;     // the longest wait we ever ask for (Composio's window is 60 s)
export const COOLDOWN_DEFAULT_MS = 60000; // a 429 with no Retry-After
const KEY = "connect_next_at";

const secs = (ms) => Math.max(1, Math.ceil(ms / 1000));
const waitReply = (ms, why) => ({ wait: secs(ms), wait_ms: Math.ceil(ms), why });

// The gauge for this workspace's Composio organization (1Helm's project when Managed, the person's own when Self-managed).
async function gaugeFor(env, tenantId) { return (await appsMode(env, tenantId)) === "self" ? gaugeOf(tenantId) : GAUGE; }
// How long the last response headers say the window stays spent (0 when it isn't nearly used up).
function windowLeftMs(gauge, now) { return gauge.low() && gauge.resetAt > now ? Math.min(COOLDOWN_MAX_MS, gauge.resetAt - now) : 0; }

async function holdUntil(env, tenantId, until) {
  if (!env?.DB) return;
  await env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,?,?,?) ON CONFLICT(tenant_id,k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at WHERE CAST(tenant_flags.v AS INTEGER) < CAST(excluded.v AS INTEGER)")
    .bind(tenantId, KEY, String(Math.ceil(until)), Date.now()).run().catch(() => {});
}
// Claim the next link slot. → 0 when claimed, or the milliseconds until the workspace may ask again.
async function claim(env, tenantId, now) {
  if (!env?.DB) return 0;
  try {
    const r = await env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,?,?,?) ON CONFLICT(tenant_id,k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at WHERE CAST(tenant_flags.v AS INTEGER) <= ?")
      .bind(tenantId, KEY, String(now + CONNECT_GAP_MS), now, now).run();
    if ((r?.meta?.changes ?? 1) > 0) return 0;
    const row = await env.DB.prepare("SELECT v FROM tenant_flags WHERE tenant_id=? AND k=?").bind(tenantId, KEY).first();
    return Math.max(0, Number(row?.v || 0) - now);
  } catch { return 0; }   // pacing is a courtesy: a D1 error never blocks a connect
}

// Runs `makeLink()` (the transport's connectLink) when the workspace may ask, else answers { wait }.
// → the link result, or { wait, wait_ms, why: "spacing" | "limit" }.
export async function pacedConnect(env, tenantId, makeLink, { now = Date.now } = {}) {
  const gauge = await gaugeFor(env, tenantId);
  const spent = windowLeftMs(gauge, now());
  if (spent) { await holdUntil(env, tenantId, now() + spent); return waitReply(spent, "limit"); }
  const held = await claim(env, tenantId, now());
  if (held > 0) return waitReply(held, "spacing");
  let r;
  try { r = await makeLink(); }
  catch (e) {
    if (!e?.rateLimited) throw e;
    const ms = Math.min(COOLDOWN_MAX_MS, e.retryAfterMs ?? COOLDOWN_DEFAULT_MS);
    await holdUntil(env, tenantId, now() + ms);
    return waitReply(ms, "limit");
  }
  // The link was made, but the window is now nearly used up: a page opened now could be refused, so wait for the window to reset first.
  const after = r?.url ? windowLeftMs(gauge, now()) : 0;
  if (after) { await holdUntil(env, tenantId, now() + after); return waitReply(after, "limit"); }
  return r;
}

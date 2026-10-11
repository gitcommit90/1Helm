// Account-owned check-in preferences. These tune tool-call pacing, never spending or approval policy.
export const CHECKIN_DEFAULTS = Object.freeze({ silent: 15, fast: 20 });
export const CHECKIN_MAX = 1000;
export const checkinValueOk = value => Number.isInteger(value) && value >= 1 && value <= CHECKIN_MAX;
export function normalizeCheckins(value) {
  return Object.fromEntries(Object.entries(CHECKIN_DEFAULTS).map(([key, fallback]) => [key, checkinValueOk(value?.[key]) ? value[key] : fallback]));
}
export function checkinPatchOk(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
    && Object.entries(value).every(([key, n]) => Object.hasOwn(CHECKIN_DEFAULTS, key) && checkinValueOk(n));
}
export async function loadCheckins(env, tenant) {
  if (!env?.DB || !tenant) return { ...CHECKIN_DEFAULTS };
  try { return normalizeCheckins(await env.DB.prepare('SELECT silent, fast FROM agent_checkin_prefs WHERE tenant_id=?').bind(tenant).first()); }
  catch { return { ...CHECKIN_DEFAULTS }; } // Existing accounts / rolling migration retain today's behavior.
}
export async function saveCheckins(env, tenant, patch) {
  if (!checkinPatchOk(patch)) throw new Error('Agent check-ins must be whole numbers from 1 to 1000.');
  // Only supplied fields change: simultaneous edits to the independent limits cannot lose each other.
  const keys = Object.keys(patch);
  await env.DB.prepare(`INSERT INTO agent_checkin_prefs (tenant_id,silent,fast,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET ${keys.map(key => `${key}=excluded.${key}`).join(',')}, updated_at=excluded.updated_at`)
    .bind(tenant, patch.silent ?? CHECKIN_DEFAULTS.silent, patch.fast ?? CHECKIN_DEFAULTS.fast, Date.now()).run();
}

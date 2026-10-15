// Account-owned check-in preferences. These tune tool-call pacing, never spending or approval policy.
// Off by default. When the person turns them on, the first update comes after 50 tool calls, and the fast limit is 20 tool
// calls in a rolling 60 seconds (the 60 seconds is fixed in spendguard.js, RUNAWAY.fastMs).
export const CHECKIN_DEFAULTS = Object.freeze({ enabled: false, silent: 50, fast: 20 });
export const CHECKIN_REASONS = Object.freeze(['silent', 'fast']);
export const CHECKIN_MAX = 1000;
export const checkinValueOk = value => Number.isInteger(value) && value >= 1 && value <= CHECKIN_MAX;
const flagOn = v => v === true || v === 1;
export function normalizeCheckins(value) {
  return {
    enabled: flagOn(value?.enabled),
    silent: checkinValueOk(value?.silent) ? value.silent : CHECKIN_DEFAULTS.silent,
    fast: checkinValueOk(value?.fast) ? value.fast : CHECKIN_DEFAULTS.fast,
  };
}
export function checkinPatchOk(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
    && Object.entries(value).every(([key, n]) => Object.hasOwn(CHECKIN_DEFAULTS, key) && (key === 'enabled' ? typeof n === 'boolean' : checkinValueOk(n)));
}
export async function loadCheckins(env, tenant) {
  if (!env?.DB || !tenant) return { ...CHECKIN_DEFAULTS };
  try {
    const row = await env.DB.prepare('SELECT silent, fast, enabled FROM agent_checkin_prefs WHERE tenant_id=?').bind(tenant).first();
    // A row saved before the on/off switch existed (enabled is NULL) holds numbers the person chose, so those accounts stay on.
    return normalizeCheckins(row && { ...row, enabled: row.enabled == null ? true : Number(row.enabled) === 1 });
  } catch { return { ...CHECKIN_DEFAULTS }; } // No row, or the enabled column is not added yet: the default (off).
}
export async function saveCheckins(env, tenant, patch) {
  if (!checkinPatchOk(patch)) throw new Error('Agent check-ins accept enabled (true or false) and whole numbers from 1 to 1000.');
  // Only supplied fields change: simultaneous edits to the independent limits cannot lose each other.
  // A first save of only a number (an older client) counts as turning check-ins on, because the person set a value.
  const keys = Object.keys(patch);
  await env.DB.prepare(`INSERT INTO agent_checkin_prefs (tenant_id,silent,fast,enabled,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET ${keys.map(key => `${key}=excluded.${key}`).join(',')}, updated_at=excluded.updated_at`)
    .bind(tenant, patch.silent ?? CHECKIN_DEFAULTS.silent, patch.fast ?? CHECKIN_DEFAULTS.fast, patch.enabled === false ? 0 : 1, Date.now()).run();
}

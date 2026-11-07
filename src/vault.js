// Saved keys (Settings → Passwords & keys → Keys). The value is sealed with VAULT_KEY and never returned to the browser;
// channel computers only hold the key's stand-in, and the sentinel swaps in the real value on the key's own sites.
// Add: { name, hosts: [site, ...], value }. Edit: also { was: "<saved name>" }; value may be left blank to keep the saved key.
// An edit keeps the row's stand-in whether or not the value changes: the stand-in is random and is not derived from the key,
// it only works on the key's own sites, so replacing the sealed value gives no reason to break code that already uses it.
// A rename moves the same row (same stand-in) and is refused when the new name is already saved.
import { sealSecret, newStandin } from "./sentinel.js";
import { trimKey } from "./sentinel-swap.js";

export const KEY_SITES_MAX = 20, KEY_VALUE_MAX = 8000;
const NAME_RE = /^[A-Z][A-Z0-9_]{1,40}$/, SITE_RE = /^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/;

export async function saveVaultKey(env, tenantId, b) {
  const name = String(b.name || "").toUpperCase(), was = b.was == null ? "" : String(b.was).toUpperCase();
  const raw = (Array.isArray(b.hosts) ? b.hosts : String(b.hosts || "").split(/[\s,]+/)).map((h) => String(h).trim().toLowerCase()).filter(Boolean);
  const hosts = [...new Set(raw)];
  if (!NAME_RE.test(name)) return { status: 400, error: "name: letters, digits, underscore (e.g. OPENWEATHER_KEY)" };
  if (!hosts.length) return { status: 400, error: "hosts: the sites this key is for, e.g. api.openweathermap.org" };
  if (hosts.length > KEY_SITES_MAX) return { status: 400, error: `hosts: a key can have up to ${KEY_SITES_MAX} sites` };
  const badHost = hosts.find((h) => h.length > 253 || !SITE_RE.test(h));
  if (badHost) return { status: 400, error: `hosts: "${badHost.slice(0, 60)}" is not a site address, e.g. api.openweathermap.org` };
  const value = b.value == null ? "" : trimKey(b.value); // outer whitespace from a paste is dropped; inner line breaks (PEM) stay
  if (value.length > KEY_VALUE_MAX) return { status: 400, error: "value too long" };
  const exists = async (n) => !!(await env.DB.prepare("SELECT 1 AS x FROM vault WHERE tenant_id=? AND name=?").bind(tenantId, n).first());
  if (!was) {
    if (!value) return { status: 400, error: "value required" };
    if (await exists(name)) return { status: 409, error: `${name} is already saved. Edit it instead.` };
    await env.DB.prepare("INSERT INTO vault (tenant_id,name,standin,hosts,sealed,created_at) VALUES (?,?,?,?,?,?)").bind(tenantId, name, newStandin(), JSON.stringify(hosts), await sealSecret(env, value), Date.now()).run();
    return { ok: true, name, hosts };
  }
  if (!(await exists(was))) return { status: 404, error: `${was} is not saved.` };
  if (name !== was && (await exists(name))) return { status: 409, error: `${name} is already saved. Pick another name.` };
  if (value) await env.DB.prepare("UPDATE vault SET name=?, hosts=?, sealed=? WHERE tenant_id=? AND name=?").bind(name, JSON.stringify(hosts), await sealSecret(env, value), tenantId, was).run();
  else await env.DB.prepare("UPDATE vault SET name=?, hosts=? WHERE tenant_id=? AND name=?").bind(name, JSON.stringify(hosts), tenantId, was).run();
  return { ok: true, name, hosts };
}

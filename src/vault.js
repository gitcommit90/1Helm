// Saved keys (Settings → Passwords & keys → Keys). The value is sealed with VAULT_KEY and never returned to the browser.
// On a channel computer every saved key is a real environment variable named after the key (a file key is a real file too, see
// vault-rules.js keyFilePath), and 1Helm hides each value from the model and from everything it stores (vault-scrub.js).
// The sites are an approval lock, not a requirement: a key may have none. When a request carries the key's value to a site that is not on its
// list, Sentinel holds the request and asks the person (Allow once, Always allow, Don't allow); Always allow adds the site here (addKeySite).
// Add: { label?, name?, hosts?: [site, ...], note?, kind?, value }. Edit: also { was: "<saved name>" }; value may be left blank to keep the saved key.
// With only a label, the variable name is made from it (App Store Connect → APP_STORE_CONNECT, with _2, _3 on a clash) and can be edited.
// An edit keeps the row's stand-in whether or not the value changes (the stand-in is random, and only works on the key's own sites).
// A rename moves the same row (same stand-in) and is refused when the new name is already saved.
import { sealSecret, newStandin } from "./sentinel.js";
import { trimKey } from "./sentinel-swap.js";
import { KEY_SITES_MAX, KEY_VALUE_MAX, NAME_RE, SITE_RE, LABEL_MAX, NOTE_MAX, nameFromLabel, cleanLine, vaultRows } from "./vault-rules.js";

export { KEY_SITES_MAX, KEY_VALUE_MAX };
export const cleanSites = (raw) => [...new Set((Array.isArray(raw) ? raw : String(raw || "").split(/[\s,]+/)).map((h) => String(h).trim().toLowerCase()).filter(Boolean))];

export async function saveVaultKey(env, tenantId, b) {
  const was = b.was == null ? "" : String(b.was).toUpperCase();
  const label = cleanLine(b.label, LABEL_MAX), note = cleanLine(b.note, NOTE_MAX);
  const exists = async (n) => !!(await env.DB.prepare("SELECT 1 AS x FROM vault WHERE tenant_id=? AND name=?").bind(tenantId, n).first());
  let name = String(b.name || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!name && label && !was) {
    const taken = new Set(((await env.DB.prepare("SELECT name FROM vault WHERE tenant_id=?").bind(tenantId).all()).results || []).map((r) => r.name));
    name = nameFromLabel(label, taken);
  }
  const hosts = cleanSites(b.hosts);
  if (!NAME_RE.test(name)) return { status: 400, error: "name: letters, digits, underscore (e.g. OPENWEATHER_KEY)" };
  if (hosts.length > KEY_SITES_MAX) return { status: 400, error: `hosts: a key can have up to ${KEY_SITES_MAX} sites` };
  const badHost = hosts.find((h) => h.length > 253 || !SITE_RE.test(h));
  if (badHost) return { status: 400, error: `hosts: "${badHost.slice(0, 60)}" is not a site address, e.g. api.openweathermap.org` };
  const value = b.value == null ? "" : trimKey(b.value); // outer whitespace from a paste is dropped; inner line breaks (PEM) stay
  if (value.length > KEY_VALUE_MAX) return { status: 400, error: "value too long" };
  const kind = b.kind === "file" ? "file" : b.kind === "text" ? "text" : null;
  if (!was) {
    if (!value) return { status: 400, error: "value required" };
    if (await exists(name)) return { status: 409, error: `${name} is already saved. Edit it instead.` };
    await env.DB.prepare("INSERT INTO vault (tenant_id,name,standin,hosts,sealed,created_at,label,note,kind) VALUES (?,?,?,?,?,?,?,?,?)").bind(tenantId, name, newStandin(), JSON.stringify(hosts), await sealSecret(env, value), Date.now(), label || null, note || null, kind || "text").run();
    return { ok: true, name, label: label || name, hosts };
  }
  if (!(await exists(was))) return { status: 404, error: `${was} is not saved.` };
  if (name !== was && (await exists(name))) return { status: 409, error: `${name} is already saved. Pick another name.` };
  // A label or note left out of an edit keeps what is saved; an empty label goes back to showing the name.
  const sets = ["name=?", "hosts=?"], args = [name, JSON.stringify(hosts)];
  if (b.label !== undefined) { sets.push("label=?"); args.push(label || null); }
  if (b.note !== undefined) { sets.push("note=?"); args.push(note || null); }
  if (kind) { sets.push("kind=?"); args.push(kind); }
  if (value) { sets.push("sealed=?"); args.push(await sealSecret(env, value)); }
  await env.DB.prepare(`UPDATE vault SET ${sets.join(", ")} WHERE tenant_id=? AND name=?`).bind(...args, tenantId, was).run();
  return { ok: true, name, label: label || name, hosts };
}

// "Always allow" on a held request: the site joins each key's list (the person can edit or remove it in Passwords & keys).
export async function addKeySite(env, tenantId, names, host) {
  host = String(host || "").trim().toLowerCase(); const added = [];
  if (!SITE_RE.test(host) || host.length > 253) return added;
  for (const name of names) {
    const r = await env.DB.prepare("SELECT hosts FROM vault WHERE tenant_id=? AND name=?").bind(tenantId, name).first().catch(() => null);
    if (!r) continue;
    let list = []; try { list = JSON.parse(r.hosts || "[]"); } catch {}
    if (list.includes(host) || list.length >= KEY_SITES_MAX) continue;
    await env.DB.prepare("UPDATE vault SET hosts=? WHERE tenant_id=? AND name=?").bind(JSON.stringify([...list, host]), tenantId, name).run();
    added.push(name);
  }
  return added;
}

// What Settings and the helper may see of a saved key: never the value or the stand-in.
export async function listVaultKeys(env, tenantId) {
  const rows = await vaultRows(env, tenantId, ["name", "hosts", "created_at", "label", "note", "kind"]);
  return rows.map((r) => ({ name: r.name, label: r.label || r.name, hosts: r.hosts, created_at: r.created_at, note: r.note || "", kind: r.kind || "text" }));
}

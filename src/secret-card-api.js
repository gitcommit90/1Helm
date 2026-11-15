// The routes behind the secret request card (secret-card.js) and the "Don't ask again" setting of the composer prompt.
//   GET  /w/<slug>/api/res/<ch>/secrets/<id>              → { secret } (the request: service, fields, sites, status; never a value)
//   POST /w/<slug>/api/res/<ch>/secrets/<id> { op: "save", slots: [{ label?, name?, note?, kind?, value }], hosts?: [...], replace_ok?: true } → { ok, secret, saved: [names] }
//        a name that is already saved answers 409 { replace: [names] } until the card sends replace_ok
//   POST …/secrets/<id> { op: "cancel" } → { ok, secret }                                          (the card's Not now)
// The values go from this request straight into the vault (vault.js saveVaultKey seals each one). Only the saved key names reach the Resident.
import { saveVaultKey } from "./vault.js";
import { checkSecretSave, SECRET_PROMPT_FLAG } from "./secret-card.js";
import { keyFilePath } from "./vault-rules.js";

export async function secretPromptOn(env, tid) {
  try { return (await env.DB.prepare("SELECT v FROM tenant_flags WHERE tenant_id=? AND k=?").bind(String(tid), SECRET_PROMPT_FLAG).first())?.v !== "off"; } catch { return true; }
}
export async function setSecretPrompt(env, tid, on, at = Date.now()) {
  if (on) await env.DB.prepare("DELETE FROM tenant_flags WHERE tenant_id=? AND k=?").bind(String(tid), SECRET_PROMPT_FLAG).run();
  else await env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,?,'off',?) ON CONFLICT(tenant_id,k) DO UPDATE SET v='off', updated_at=excluded.updated_at").bind(String(tid), SECRET_PROMPT_FLAG, at).run();
  return on;
}

export const savedNames = async (env, tid) => new Map(((await env.DB.prepare("SELECT name, hosts FROM vault WHERE tenant_id=?").bind(tid).all()).results || []).map((r) => [r.name, r.hosts]));

// Saves every slot of the card or none: a failure after some were added removes the ones this call added.
// → { ok, names, items: [{ name, label, note, file }], hosts, replaced } or { error, status }. A slot that replaces a saved key keeps that key's sites when the card gave none.
export async function saveSecretSlots(env, tid, slots, hosts, have = null) {
  have ||= await savedNames(env, tid);
  const added = [], items = [];
  for (const f of slots) {
    const replacing = have.has(f.name);
    let sites = hosts; if (replacing && !hosts.length) { try { sites = JSON.parse(have.get(f.name) || "[]"); } catch { sites = []; } }
    const r = await saveVaultKey(env, tid, { name: f.name, label: f.label, note: f.note, kind: f.kind, hosts: sites, value: f.value, ...(replacing ? { was: f.name } : {}) });
    if (r.error) {
      for (const n of added) await env.DB.prepare("DELETE FROM vault WHERE tenant_id=? AND name=?").bind(tid, n).run().catch(() => {});
      return { error: r.error, status: r.status || 400 };
    }
    if (!replacing) added.push(f.name);
    items.push({ name: f.name, label: f.label, note: f.note, file: f.kind === "file" || /[\r\n]/.test(f.value) ? keyFilePath(f.name) : "" });
  }
  return { ok: true, names: slots.map((f) => f.name), items, hosts, replaced: slots.filter((f) => have.has(f.name)).map((f) => f.name) };
}

export async function secretChatApi(req, env, t, m, { json, access, archive, url }) {
  const chans = await archive(env, t.id).channels(), slugOf = (c) => c.slug || c.name, ch = chans.find((c) => slugOf(c) === m[1]);
  if (!ch) return json({ error: "no such channel" }, 404);
  const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`)); await R.bind(t.id, slugOf(ch), String(ch.id));
  if (req.method === "GET") { const v = await R.secretView(m[2]); return v ? json({ secret: v }) : json({ error: "No such request." }, 404); }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  // CSRF: only same-origin JSON is accepted (a cross-site form can't send JSON), like account.js and data-export.js.
  const origin = req.headers.get("origin");
  if ((origin && origin !== url.origin) || !/^application\/json\b/i.test(req.headers.get("content-type") || "")) return json({ error: "forbidden" }, 403);
  if (access?.mode === "read_only") return json({ error: "payment_required", message: access.message || "Your 1Helm plan isn't active, so 1Helm is read-only.", access }, 402);
  const b = await req.json().catch(() => ({})), op = String(b?.op || "");
  if (op === "cancel") { const d = await R.secretCancel(m[2]); return json(d, d.error ? d.status || 400 : 200); }
  if (op !== "save") return json({ error: "op must be save or cancel" }, 400);
  const prep = await R.secretPrepare(m[2]); if (prep.error) return json(prep, prep.status || 400);
  const have = await savedNames(env, t.id);
  const c = checkSecretSave(prep.secret, b, new Set(have.keys())); if (c.error) return json({ error: c.error }, c.status || 400);
  // A name that is already saved is replaced only after the person confirmed: the card is told which names, and sends the same slots again with replace_ok.
  const clash = c.slots.filter((f) => have.has(f.name) && f.explicit).map((f) => f.name);
  if (clash.length && b.replace_ok !== true) return json({ error: `${clash.join(", ")} ${clash.length > 1 ? "are" : "is"} already saved. Saving replaces ${clash.length > 1 ? "their values" : "its value"}.`, replace: clash }, 409);
  const s = await saveSecretSlots(env, t.id, c.slots, c.hosts, have); if (s.error) return json({ error: s.error }, s.status || 400);
  const d = await R.secretDone(m[2], { names: s.names, hosts: s.hosts, replaced: s.replaced, items: s.items });
  return json(d.error ? d : { ...d, saved: s.names }, d.error ? d.status || 400 : 200);
}

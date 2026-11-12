// Secret request card (the request_secret tool): the helper needs something only the person has (an API key, a private key file, an ID), so it puts
// a card in the task's chat and the person pastes it there.
//   - The card is loose. It starts with the slots the helper suggested, or one empty slot. For each slot the person can paste text or attach a file, choose
//     the label and the variable name, and add a note on what it is for. They can add and remove slots. The sites are optional.
//   - The values never pass through the chat. The card posts them to the Worker route (secret-card-api.js), which seals each one in the vault (vault.js
//     saveVaultKey) as a saved key and then tells the Resident only names, labels, notes and file paths (secretDone). The Resident, the messages, the turns,
//     memory, the work log, traces, phone pushes, texts and the model's input never hold a value.
//   - Every saved key is real on the channel computer: an environment variable named after it, and a file key is a file at keyFilePath(NAME) too
//     (channel-computer.js loadStandins). The helper uses them like any variable. 1Helm hides each value from the model (vault-scrub.js).
//   - A name that is already saved is replaced only after the card warned the person and they confirmed (the route answers 409 with the names first).
//   - The card resumes the task like the other cards: the tool returns at once, the turn ends, and a later Save or Not now hands the task back
//     (Resident.cardHandoff). A restart loses nothing, because the request is a row in the Resident's own SQLite.
//   - By text the value is never asked for: the tool tells the helper to send the person to the app.
//   - A saved key shows in Settings → Passwords & keys like any other, where the person can edit or delete it. Deleting removes it from the computer
//     for every later command, and stops sign_token, which reads the vault at each signing.
import { scrubSecrets } from "./secrets-scrub.js";
import { NAME_RE, SITE_RE, KEY_SITES_MAX, KEY_VALUE_MAX, LABEL_MAX, NOTE_MAX, nameFromLabel, cleanLine, keyFilePath } from "./vault-rules.js";
import { trimKey } from "./sentinel-swap.js";

export const SECRET_FIELDS_MAX = 8, SERVICE_MAX = 60, REASON_MAX = 200;
export const SECRET_PROMPT_FLAG = "secret_prompt";   // tenant_flags: v='off' means "Don't ask again" (the composer prompt, secret-prompt in the app)

export const REQUEST_SECRET_TOOL = { type: "function", function: { name: "request_secret",
  description: "Ask the person to paste something only they have (an API key, an ID, a private key file) with a card in this chat. The card hides what they type; the values are saved straight to their saved keys and never pass through this chat or you. " +
    "Every saved key is a real environment variable on your computer named after it (e.g. $APP_STORE_CONNECT), and a key saved as a file is also a real file (the path comes back). " +
    "You can ask openly: with no fields the card has one empty slot, and the person adds, removes and names slots, pastes text or attaches a file in each, and writes a note on what each is for. If you know what you need, suggest slots (a label, and a short hint on where to find it). " +
    "You get back each saved key's label, variable name, note, file path and approved sites, never a value. Use this when something you need isn't in the saved keys list; don't ask the person to paste a secret into the chat. " +
    "It returns at once: end your turn with one short line. If they tap Not now, you'll be told nothing was given.",
  parameters: { type: "object", properties: {
    service: { type: "string", description: "Optional: what the secrets are for, in plain words, e.g. \"App Store Connect\" (shown on the card)" },
    fields: { type: "array", maxItems: SECRET_FIELDS_MAX, description: "Optional: slots to start the card with. Leave it out to show one empty slot. The person can change all of it.", items: { type: "object", properties: {
      label: { type: "string", description: "A plain name the person sees, e.g. \"Key ID\" or \"Private key (.p8 file)\"" },
      note: { type: "string", description: "A short hint, shown under the label, on where to find it, e.g. \"In App Store Connect under Users and Access, Integrations\"" },
      name: { type: "string", description: "Optional: the variable name you'd like, capitals, digits and underscores. If you leave it out one is made from the label." },
      file: { type: "boolean", description: "true = the person attaches a file (e.g. a .p8 or .pem) instead of pasting text" } } } },
    hosts: { type: "array", items: { type: "string" }, description: "Optional: sites these secrets are for, e.g. [\"api.appstoreconnect.apple.com\"]. Sites are an approval: a request that sends a saved key to a site that isn't listed waits for the person's OK. The person can edit the list." },
    reason: { type: "string", description: "Optional: one short sentence on what you'll do with it, shown in full on the card" } } } } };

export const SIGN_TOKEN_TOOL = { type: "function", function: { name: "sign_token",
  description: "Optional helper: make a signed token (a JWT) from a saved private key without writing signing code. In header and claims, write $NAME for any saved key's value (e.g. \"kid\": \"$APP_STORE_CONNECT_KEY_ID\", \"iss\": \"$APP_STORE_CONNECT_ISSUER_ID\"); the real value is put in when the token is made. " +
    "Algorithms: ES256, RS256, PS256, EdDSA and HS256. The private key itself is never returned. A token lasts at most 60 minutes (exp is seconds since 1970; leave it out for 10 minutes). Every saved key is also a real variable on your computer, so you can sign in your own script instead.",
  parameters: { type: "object", properties: {
    key: { type: "string", description: "The variable name of the saved key that holds the private key, e.g. APP_STORE_CONNECT_PRIVATE_KEY (for HS256, the saved shared secret)" },
    alg: { type: "string", enum: ["ES256", "RS256", "PS256", "EdDSA", "HS256"] },
    audience_host: { type: "string", description: "Optional: the site the token will be sent to, e.g. api.appstoreconnect.apple.com. If the saved key has approved sites and this isn't one, no token is made." },
    header: { type: "object", description: "Extra header fields, e.g. { \"kid\": \"$APP_STORE_CONNECT_KEY_ID\" }. alg and typ are added for you." },
    claims: { type: "object", description: "The token's claims, e.g. { \"iss\": \"$APP_STORE_CONNECT_ISSUER_ID\", \"aud\": \"appstoreconnect-v1\", \"exp\": 1760001000 }" } }, required: ["key", "alg"] } } };

export function secretInit(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS secret_requests (id TEXT PRIMARY KEY, session TEXT, turn TEXT, at INTEGER NOT NULL, service TEXT NOT NULL, reason TEXT,
    fields TEXT NOT NULL, hosts TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', saved TEXT, via TEXT NOT NULL DEFAULT 'app', decided INTEGER, handed INTEGER)`);
  sql.exec("CREATE INDEX IF NOT EXISTS secret_requests_session ON secret_requests(session, at)");
}

const line = (s, max) => { const t = scrubSecrets(String(s ?? "")).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(); return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t; };
const parse = (s, d) => { try { return JSON.parse(s || ""); } catch { return d; } };
export const cleanHosts = (raw) => [...new Set((Array.isArray(raw) ? raw : String(raw || "").split(/[\s,]+/)).map((h) => String(h).trim().toLowerCase()).filter(Boolean))];

// The model's arguments → { req } or { error } (plain words the model can fix). Everything is optional: no fields means one empty slot on the card.
export function checkSecretRequest(a = {}) {
  const service = line(a.service, SERVICE_MAX), reason = line(a.reason, REASON_MAX);
  const raw = Array.isArray(a.fields) ? a.fields : [];
  if (raw.length > SECRET_FIELDS_MAX) return { error: `error: ask for at most ${SECRET_FIELDS_MAX} secrets at once (you sent ${raw.length}).` };
  const fields = [];
  for (const [i, f] of raw.entries()) {
    const label = line(f?.label, LABEL_MAX), note = line(f?.note, NOTE_MAX);
    let name = String(f?.name ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (name && !NAME_RE.test(name)) return { error: `error: field ${i + 1} has the name ${JSON.stringify(String(f?.name ?? "").slice(0, 60))}; use capital letters, digits and underscores, starting with a letter (e.g. OPENWEATHER_KEY), or leave the name out.` };
    fields.push({ label, name, note, file: f?.file === true });
  }
  if (new Set(fields.map((f) => f.name).filter(Boolean)).size !== fields.filter((f) => f.name).length) return { error: "error: a variable name is listed twice." };
  const hosts = cleanHosts(a.hosts);
  if (hosts.length > KEY_SITES_MAX) return { error: `error: at most ${KEY_SITES_MAX} sites.` };
  const bad = hosts.find((h) => h.length > 253 || !SITE_RE.test(h));
  if (bad) return { error: `error: ${JSON.stringify(bad.slice(0, 60))} is not a site address, e.g. api.appstoreconnect.apple.com.` };
  return { req: { service, reason, fields, hosts } };
}

// ---- storage and views (never a value) ----
export const secretRow = (sql, id) => sql.exec("SELECT * FROM secret_requests WHERE id=?", String(id)).toArray()[0] || null;
export function secretView(r) {
  if (!r) return null;
  return { id: r.id, session: r.session, turn: r.turn, at: Number(r.at), service: r.service, reason: r.reason || "", fields: parse(r.fields, []), hosts: parse(r.hosts, []), status: r.status, saved: parse(r.saved, null), decided: r.decided ? Number(r.decided) : null };
}
// sessionDetail: each turn gets the secret requests its helper showed.
export function attachSecrets(sql, session, turns, live) {
  let rows = []; try { rows = sql.exec("SELECT * FROM secret_requests WHERE session=? ORDER BY at", String(session)).toArray(); } catch { return; }
  if (!rows.length) return;
  const by = {}; for (const r of rows) (by[r.turn] ||= []).push(secretView(r));
  for (const t of turns) if (by[t.id]) t.secrets = by[t.id];
  if (live && by[live.turn]) live.secrets = by[live.turn];
}
export const openSecretCount = (sql, session) => { try { return sql.exec("SELECT COUNT(*) n FROM secret_requests WHERE session=? AND status='open'", String(session)).one().n; } catch { return 0; } };

// ---- the tool ----
export async function requestSecretTool(R, a, ctx = {}) {
  if (ctx.kind === "helper") return "error: request_secret isn't available to a worker. Say in your report which secret you'd need; the helper who started you asks the person.";
  if (ctx.kind !== "chat" || !ctx.session) return "error: request_secret only works while you're talking with the person in a task, not in a scheduled run. Say in your report which secret you'd need.";
  const c = checkSecretRequest(a); if (c.error) return c.error;
  const existing = ctx.turn ? R.sql.exec("SELECT id FROM secret_requests WHERE turn=? AND status='open'", String(ctx.turn)).toArray()[0] : null;
  if (existing) return "Your secret request card is already shown. Wait for the person to save it or tap Not now.";
  const q = c.req, id = crypto.randomUUID(), now = Date.now(), via = ctx.viaText ? "text" : "app";
  R.sql.exec("INSERT INTO secret_requests (id,session,turn,at,service,reason,fields,hosts,status,via) VALUES (?,?,?,?,?,?,?,?,'open',?)", id, ctx.session, ctx.turn || null, now, q.service, q.reason, JSON.stringify(q.fields), JSON.stringify(q.hosts), via);
  R.sql.exec("UPDATE sessions SET waiting='secret' WHERE id=?", ctx.session);
  ctx.line = "asking for a key"; ctx.emit?.({ t: "status", line: ctx.line });
  ctx.emit?.({ t: "secret_request", secret: secretView(secretRow(R.sql, id)) });
  const what = q.service ? ` for ${q.service}` : "";
  if (via === "text") return `The secret request${what} is waiting in the app, but a secret is never taken by text. Tell the person in one short line to open 1Helm to paste it on the card, and don't ask them to send it in a text. End your turn now. When they save it you'll be told.`;
  return `A card${what ? ` asking${what}` : " for a secret"} is now in the person's chat. It hides what they type, saves the values straight to their saved keys, and you never see them. End your turn now with one short line. When they tap Save you'll be told each saved key's label, variable name, note, file path and sites; if they tap Not now you'll be told too.`;
}

// ---- the person's decision (index.js route → Resident RPC). Values never get here: the route seals them in the vault first. ----
export function secretPrepare(R, id) {
  const r = secretRow(R.sql, id); if (!r) return { error: "No such request.", status: 404 };
  if (r.status !== "open") return { error: `already_${r.status}`, status: 409, secret: secretView(r) };
  return { ok: true, secret: secretView(r) };
}
// What the helper is told after Save: each key by label, variable name, note, file path and approved sites. Never a value.
export function savedKeyLines(items = []) {
  return items.map((k) => `- ${k.label && k.label !== k.name ? `${k.label}: ` : ""}$${k.name}${k.note ? ` (${k.note})` : ""}${k.file ? `, also a file at ${k.file}` : ""}`).join("\n");
}
export const savedNote = (r, items, hosts, replaced = []) =>
  `(Platform event, not from the person: they saved what you asked for on the card${r.service ? ` for ${r.service}` : ""}. Saved keys:\n${savedKeyLines(items)}\n${hosts.length ? `Approved sites: ${hosts.join(", ")}.` : "No sites approved yet: a request that sends one of them to a new site waits for the person's OK."}${replaced.length ? ` ${replaced.map((n) => `$${n}`).join(", ")} already existed and now holds the new value.` : ""} ` +
  "You never see the values. Each one is a real environment variable on your computer, so use $NAME in your commands and scripts; a file key is also a real file at the path above. Carry on with the task now.)";
export const notNowNote = (r) => `(Platform event, not from the person: they tapped Not now on your secret request${r.service ? ` for ${r.service}` : ""}, so no secret was given. Don't ask for it again in the same way. Say in one short line what you can't do without it and ask what they'd like to do instead.)`;

export function secretDone(R, id, { names = [], hosts = [], replaced = [], items = null } = {}) {
  const r = secretRow(R.sql, id); if (!r) return { error: "No such request.", status: 404 };
  if (r.status !== "open") return { error: `already_${r.status}`, status: 409, secret: secretView(r) };
  const now = Date.now(), list = items || names.map((n) => ({ name: n, label: n, note: "", file: "" })), saved = { names, hosts, replaced, items: list.map((k) => ({ name: k.name, label: k.label, note: k.note, file: k.file })) };
  R.sql.exec("UPDATE secret_requests SET status='saved', saved=?, decided=? WHERE id=? AND status='open'", JSON.stringify(saved), now, id);
  return finish(R, secretRow(R.sql, id), savedNote(r, list, hosts, replaced), `Saved: ${r.service || "key"}`);
}
export function secretCancel(R, id) {
  const r = secretRow(R.sql, id); if (!r) return { error: "No such request.", status: 404 };
  if (r.status !== "open") return { error: `already_${r.status}`, status: 409, secret: secretView(r) };
  R.sql.exec("UPDATE secret_requests SET status='cancelled', decided=? WHERE id=? AND status='open'", Date.now(), id);
  return finish(R, secretRow(R.sql, id), notNowNote(r), `Not now: ${r.service || "secret request"}`);
}
function finish(R, r, text, title) {
  if (!openSecretCount(R.sql, r.session)) R.sql.exec("UPDATE sessions SET waiting=NULL WHERE id=? AND waiting='secret'", r.session);
  R.sql.exec("UPDATE secret_requests SET handed=? WHERE id=?", Date.now(), r.id);
  const view = secretView(secretRow(R.sql, r.id));
  try { if (r.session && R.session?.(r.session) && R.cardHandoff) R.cardHandoff(r.session, r.turn, { text: scrubSecrets(text), from: { type: "secret", id: r.id, title: title.slice(0, 80) } }); }
  catch (e) { console.log("secret handoff", e.message); }
  return { ok: true, secret: view };
}

// ---- what the route saves: the person's slots checked against the request. → { slots: [{ label, name, note, kind, value }], hosts } or { error, status } ----
// b.slots: [{ label?, name?, note?, kind?: "text" | "file", value }] (up to SECRET_FIELDS_MAX). An empty slot is skipped; every slot with a value is saved.
// The variable name is the person's own, else made from the label (APP_STORE_CONNECT), with _2, _3 on a clash with a saved key or another slot.
export function checkSecretSave(secret, b = {}, taken = new Set()) {
  const raw = Array.isArray(b.slots) ? b.slots : [];
  const hosts = b.hosts === undefined ? secret.hosts : cleanHosts(b.hosts);
  if (hosts.length > KEY_SITES_MAX) return { error: `A key can be for up to ${KEY_SITES_MAX} sites.`, status: 400 };
  const bad = hosts.find((h) => h.length > 253 || !SITE_RE.test(h));
  if (bad) return { error: `"${bad.slice(0, 60)}" is not a site address, e.g. api.appstoreconnect.apple.com.`, status: 400 };
  if (raw.length > SECRET_FIELDS_MAX) return { error: `A card can save up to ${SECRET_FIELDS_MAX} secrets at a time.`, status: 400 };
  const slots = [], used = new Set();
  for (const [i, f] of raw.entries()) {
    const value = trimKey(f?.value ?? ""); if (!value) continue;
    if (value.length > KEY_VALUE_MAX) return { error: `Secret ${i + 1} is too long.`, status: 400 };
    const label = cleanLine(f?.label, LABEL_MAX), note = cleanLine(f?.note, NOTE_MAX);
    let name = String(f?.name ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_"), explicit = !!name;
    if (!explicit) name = nameFromLabel(label || `Key ${i + 1}`, new Set([...taken, ...used]));
    if (!NAME_RE.test(name)) return { error: `"${name.slice(0, 60)}" is not a usable variable name. Use capital letters, digits and underscores, starting with a letter.`, status: 400 };
    if (used.has(name)) return { error: `${name} is used for two secrets. Give each its own name.`, status: 400 };
    used.add(name);
    slots.push({ label: label || name, name, note, kind: f?.kind === "file" ? "file" : "text", value, explicit });
  }
  if (!slots.length) return { error: "Paste or attach at least one secret.", status: 400 };
  return { slots, hosts };
}

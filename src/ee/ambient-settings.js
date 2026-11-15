// Account-owned soft attention cues, independent of a particular integration.
// tenant_flags already participates in account deletion. Never a wake-word gate,
// speaker identity, authorization or reason to discard uncued speech.
import { scrubSecrets } from "../secrets-scrub.js";
import { boundedText, BodyTooLargeError } from "../bounded-body.js";
export const AMBIENT_SETTINGS_KEY = "ambient_cues";
const defaults = () => ({ enabled: false, phrases: [], revision: 0, updated_at: 0 });
const error = (message, status = 400, code = "invalid_settings") => Object.assign(new Error(message), { status, code });

export function normalizeAmbientSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw error("Provide ambient settings.");
  if (typeof value.enabled !== "boolean" || !Array.isArray(value.phrases)) throw error("enabled must be true or false and phrases must be a list.");
  if (value.phrases.length > 8) throw error("Use at most 8 attention phrases.");
  const phrases = [], seen = new Set();
  for (const raw of value.phrases) {
    if (typeof raw !== "string" || raw.length > 320) throw error("Each phrase must be text of at most 80 characters.");
    // Strip neither meaningful words nor invisible instruction characters.
    // Ordinary whitespace is normalized; other controls are rejected.
    const phrase = raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!phrase || [...phrase].length > 80 || /[\p{Cc}\p{Cf}]/u.test(phrase) || !/[\p{L}\p{N}]/u.test(phrase)) throw error("Each phrase needs 1–80 visible characters including a letter or number.");
    if (scrubSecrets(phrase) !== phrase) throw error("Do not put passwords or secret keys in an attention phrase.");
    const key = phrase.toLocaleLowerCase("und");
    if (!seen.has(key)) { seen.add(key); phrases.push(phrase); }
  }
  if (value.enabled && !phrases.length) throw error("Add at least one phrase before enabling attention hints.");
  return { enabled: value.enabled, phrases };
}

async function rawSettings(env, tenant) {
  if (!tenant) throw error("Ambient settings are unavailable.", 503, "unavailable");
  try { return await env.DB.prepare("SELECT v FROM tenant_flags WHERE tenant_id=? AND k=?").bind(String(tenant), AMBIENT_SETTINGS_KEY).first(); }
  catch { throw error("Ambient settings could not be read. Try again shortly.", 503, "unavailable"); }
}
function parseSettings(row) {
  if (!row) return defaults();
  try {
    const value = JSON.parse(row.v), normalized = normalizeAmbientSettings(value);
    if (!Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isSafeInteger(value.updated_at) || value.updated_at < 0) throw Error();
    return { ...normalized, revision: value.revision, updated_at: value.updated_at };
  } catch { throw error("Saved ambient settings could not be read. Try again shortly.", 503, "unavailable"); }
}
export async function readAmbientSettings(env, tenant) { return parseSettings(await rawSettings(env, tenant)); }

export async function writeAmbientSettings(env, tenant, value) {
  const normalized = normalizeAmbientSettings(value);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision >= Number.MAX_SAFE_INTEGER) throw error("A valid settings revision is required.");
  const row = await rawSettings(env, tenant), current = parseSettings(row);
  if (current.revision !== value.revision) throw error("These settings changed elsewhere. Reload them before saving.", 409, "revision_conflict");
  const next = { ...normalized, revision: current.revision + 1, updated_at: Date.now() };
  let saved;
  try {
    // Compare the exact prior value, not a clock: concurrent updates cannot
    // silently overwrite a more recent phrase/disable choice.
    saved = row
      ? await env.DB.prepare("UPDATE tenant_flags SET v=?,updated_at=? WHERE tenant_id=? AND k=? AND v=?").bind(JSON.stringify(next), next.updated_at, String(tenant), AMBIENT_SETTINGS_KEY, row.v).run()
      : await env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,?,?,?) ON CONFLICT(tenant_id,k) DO NOTHING").bind(String(tenant), AMBIENT_SETTINGS_KEY, JSON.stringify(next), next.updated_at).run();
  } catch { throw error("Ambient settings could not be saved. Try again shortly.", 503, "unavailable"); }
  if (Number(saved.meta?.changes) !== 1) throw error("These settings changed elsewhere. Reload them before saving.", 409, "revision_conflict");
  return next;
}

const reply = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
export async function ambientSettingsRoute(req, env, tenant, user, { look = false } = {}) {
  if (!tenant?.id || !user?.id || tenant.owner_user_id !== user.id) return reply({ error: "Not found." }, 404);
  if (!["GET", "PUT"].includes(req.method)) return reply({ error: "Use GET or PUT." }, 405);
  const origin = req.headers.get("origin"), same = new URL(req.url).origin;
  if (req.headers.get("sec-fetch-site") === "cross-site" || origin != null && origin !== same) return reply({ error: "Forbidden." }, 403);
  if (req.method === "PUT") {
    if (look || origin !== same) return reply({ error: "Forbidden." }, 403);
    if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return reply({ error: "JSON required." }, 415);
    if (Number(req.headers.get("content-length")) > 8192) return reply({ error: "Settings are too large." }, 413);
  }
  try {
    if (req.method === "GET") return reply(await readAmbientSettings(env, tenant.id));
    const text = await boundedText(req, 8192);
    if (text.length > 8192) return reply({ error: "Settings are too large." }, 413);
    let value; try { value = JSON.parse(text); } catch { return reply({ error: "Invalid JSON." }, 400); }
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((k) => !["enabled", "phrases", "revision"].includes(k))) return reply({ error: "Use enabled, phrases and revision only." }, 400);
    return reply(await writeAmbientSettings(env, tenant.id, value));
  } catch (e) {
    if (e instanceof BodyTooLargeError) return reply({ error: "Settings are too large." }, 413);
    return reply({ error: e?.status ? e.message : "Ambient settings are unavailable. Try again shortly.", code: e?.code || "unavailable" }, e?.status || 503);
  }
}

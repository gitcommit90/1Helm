// The memory source registry and the small account-level indexes the envelope needs (the design notes):
//   memory_sources  one row per source the person connected or imported ("google-takeout:2026-10", "bee", "photos"), with its consent,
//                   status and item count, so a whole source can be listed, paused, deleted and forgotten ("remove everything from my
//                   Google import").
//   memory_dedupe   the dedupe key of each stored item per channel bank (a photo's content hash, an email message-id): the same real event
//                   seen again, in the same or another source, is linked to the first copy instead of being stored twice. Per channel,
//                   because banks are air gapped: two channels never share a memory.
//   memory_places   stable place ids ("pl:<lat>,<lng>", a key normalized to 2 decimals) with the person's own label ("Home", "Office", "Blue Bottle"),
//                   and the coordinates the person labelled, as given.
//   geocode_cache   rounded spot → city level place name from OpenStreetMap. No account in it: it is public map data.
//   memory_tombstones  imported documents the person deleted: an automatic re-sync from a connected source skips them; a deliberate import
//                   (the person starts it) brings them back and clears the tombstone.
// Every table but geocode_cache has a tenant_id column, so deleting the account deletes its rows (deletion.js deleteTenantD1).
import { reverseGeocode } from "./location.js";
import { coarse2, placeId, geoValid } from "./memory-envelope.js";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS memory_sources (tenant_id TEXT NOT NULL, source_key TEXT NOT NULL, channel TEXT NOT NULL, kind TEXT NOT NULL, label TEXT,
     consent_at INTEGER, consent_scope TEXT, status TEXT NOT NULL DEFAULT 'active', items INTEGER NOT NULL DEFAULT 0, last_import_at INTEGER, created_at INTEGER NOT NULL,
     PRIMARY KEY (tenant_id, source_key))`,
  `CREATE TABLE IF NOT EXISTS memory_dedupe (tenant_id TEXT NOT NULL, channel TEXT NOT NULL, dedupe_key TEXT NOT NULL, doc TEXT NOT NULL, source_key TEXT,
     seen INTEGER NOT NULL DEFAULT 1, sources TEXT, at INTEGER NOT NULL, PRIMARY KEY (tenant_id, channel, dedupe_key))`,
  `CREATE TABLE IF NOT EXISTS memory_places (tenant_id TEXT NOT NULL, place_id TEXT NOT NULL, label TEXT, place TEXT, lat REAL, lng REAL, updated_at INTEGER NOT NULL,
     PRIMARY KEY (tenant_id, place_id))`,
  `CREATE TABLE IF NOT EXISTS geocode_cache (k TEXT PRIMARY KEY, place TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS memory_tombstones (tenant_id TEXT NOT NULL, channel TEXT NOT NULL, doc TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (tenant_id, channel, doc))`,
];
let ready = false;
export async function sourcesInit(env) { if (ready) return; for (const t of TABLES) await env.DB.prepare(t).run(); ready = true; }
export const _resetSourcesInit = () => { ready = false; };   // tests
const now = () => Date.now();

// ---- sources ----
// A source key is "<kind>" or "<kind>:<label>" in plain letters, digits, dot, dash and colon.
export const SOURCE_RE = /^[a-z][a-z0-9.-]{0,30}(?::[a-z0-9._-]{1,60})?$/;
export async function registerSource(env, tenant, { key, channel, kind, label = "", consentScope = "" }) {
  if (!SOURCE_RE.test(String(key || ""))) throw new Error("memory source: a key like google-takeout:2026-10 is required");
  await sourcesInit(env); const t = now();
  await env.DB.prepare(`INSERT INTO memory_sources (tenant_id, source_key, channel, kind, label, consent_at, consent_scope, status, created_at) VALUES (?,?,?,?,?,?,?, 'active', ?)
    ON CONFLICT(tenant_id, source_key) DO UPDATE SET label=excluded.label, consent_at=excluded.consent_at, consent_scope=excluded.consent_scope, status='active'`)
    .bind(String(tenant), key, String(channel), String(kind || key.split(":")[0]), String(label).slice(0, 120), t, String(consentScope).slice(0, 200), t).run();
  return sourceRow(env, tenant, key);
}
export async function sourceRow(env, tenant, key) { await sourcesInit(env); return await env.DB.prepare("SELECT * FROM memory_sources WHERE tenant_id=? AND source_key=?").bind(String(tenant), String(key)).first() || null; }
export async function listSources(env, tenant) { await sourcesInit(env); return (await env.DB.prepare("SELECT * FROM memory_sources WHERE tenant_id=? ORDER BY created_at").bind(String(tenant)).all()).results || []; }
export async function sourceImported(env, tenant, key, n) {
  await sourcesInit(env); await env.DB.prepare("UPDATE memory_sources SET items=items+?, last_import_at=? WHERE tenant_id=? AND source_key=?").bind(Number(n) || 0, now(), String(tenant), String(key)).run();
}
export async function setSourceStatus(env, tenant, key, status) {
  await sourcesInit(env); await env.DB.prepare("UPDATE memory_sources SET status=? WHERE tenant_id=? AND source_key=?").bind(String(status), String(tenant), String(key)).run();
}
// Consent is per source: an import runs only while its source row is active with consent recorded.
export const consented = (row) => !!row && row.status === "active" && Number(row.consent_at) > 0;

// ---- dedupe ----
// → { first: true } the first time a key is stored in this channel's bank, else { first: false, doc } (the document that already holds it;
// the new source is added to its row so the link is kept).
export async function dedupeSeen(env, tenant, channel, key, doc, sourceKey) {
  if (!key) return { first: true };
  await sourcesInit(env);
  const row = await env.DB.prepare("SELECT doc, sources FROM memory_dedupe WHERE tenant_id=? AND channel=? AND dedupe_key=?").bind(String(tenant), String(channel), String(key)).first();
  if (!row) { await env.DB.prepare("INSERT OR IGNORE INTO memory_dedupe (tenant_id, channel, dedupe_key, doc, source_key, sources, at) VALUES (?,?,?,?,?,?,?)").bind(String(tenant), String(channel), String(key), String(doc), String(sourceKey || ""), String(sourceKey || ""), now()).run(); return { first: true }; }
  if (row.doc === doc) return { first: true, again: true };   // the same item synced again: an update, not a duplicate
  const srcs = new Set(String(row.sources || "").split(",").filter(Boolean)); if (sourceKey) srcs.add(sourceKey);
  await env.DB.prepare("UPDATE memory_dedupe SET seen=seen+1, sources=? WHERE tenant_id=? AND channel=? AND dedupe_key=?").bind([...srcs].join(",").slice(0, 500), String(tenant), String(channel), String(key)).run();
  return { first: false, doc: row.doc };
}
// An item with several dedupe keys (an import's content fingerprint and its cross source key): every key that already holds another document
// gets the new source added to its row (not only the first match), and the keys with no row yet are stored for this document unless
// o.linkOnly is set (an automatic re-sync links a copy and does not store it, so its keys must not point at a document that is not stored).
// → { first: true } when no key held another document, else { first: false, doc } (the document of the first key that did).
export async function dedupeSeenAll(env, tenant, channel, keys, doc, sourceKey, o = {}) {
  const list = [...new Set((keys || []).filter(Boolean))]; if (!list.length) return { first: true };
  await sourcesInit(env);
  const rows = [], t = String(tenant), c = String(channel); let same = null;
  for (const key of list) { const row = await env.DB.prepare("SELECT doc, sources FROM memory_dedupe WHERE tenant_id=? AND channel=? AND dedupe_key=?").bind(t, c, String(key)).first(); rows.push(row || null); if (row && row.doc !== doc && !same) same = row.doc; }
  for (let i = 0; i < list.length; i++) {
    const row = rows[i];
    if (!row) { if (!(o.linkOnly && same)) await env.DB.prepare("INSERT OR IGNORE INTO memory_dedupe (tenant_id, channel, dedupe_key, doc, source_key, sources, at) VALUES (?,?,?,?,?,?,?)").bind(t, c, String(list[i]), String(doc), String(sourceKey || ""), String(sourceKey || ""), now()).run(); continue; }
    if (row.doc === doc) continue;
    const srcs = new Set(String(row.sources || "").split(",").filter(Boolean)); if (sourceKey) srcs.add(sourceKey);
    await env.DB.prepare("UPDATE memory_dedupe SET seen=seen+1, sources=? WHERE tenant_id=? AND channel=? AND dedupe_key=?").bind([...srcs].join(",").slice(0, 500), t, c, String(list[i])).run();
  }
  return same ? { first: false, doc: same } : { first: true };
}
export async function dedupeForgetSource(env, tenant, sourceKey) {
  await sourcesInit(env); await env.DB.prepare("DELETE FROM memory_dedupe WHERE tenant_id=? AND source_key=?").bind(String(tenant), String(sourceKey)).run();
}

// ---- places ----
export async function placeLabel(env, tenant, id) {
  if (!id) return null; await sourcesInit(env);
  const r = await env.DB.prepare("SELECT label FROM memory_places WHERE tenant_id=? AND place_id=?").bind(String(tenant), String(id)).first().catch(() => null);
  return r?.label || null;
}
export async function setPlaceLabel(env, tenant, { lat, lng, label, place = "" }) {
  const id = placeId(lat, lng); if (!id) throw new Error("memory place: lat and lng are required");
  await sourcesInit(env);
  await env.DB.prepare(`INSERT INTO memory_places (tenant_id, place_id, label, place, lat, lng, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id, place_id) DO UPDATE SET label=excluded.label, place=COALESCE(NULLIF(excluded.place,''), memory_places.place), updated_at=excluded.updated_at`)
    .bind(String(tenant), id, String(label || "").slice(0, 60), String(place).slice(0, 120), Number(lat), Number(lng), now()).run();
  return id;
}
// A city level name for a rounded spot, looked up once and cached (OpenStreetMap Nominatim through location.js; only the rounded spot is sent).
export async function geocodeCached(env, lat, lng, geo = reverseGeocode) {
  if (!geoValid(lat, lng)) return "";   // 0,0 or off the globe: the coordinates are stored as given, but no name is looked up for them
  const a = coarse2(lat), b = coarse2(lng), k = `${a.toFixed(2)},${b.toFixed(2)}`;
  try { await sourcesInit(env); const r = await env.DB.prepare("SELECT place FROM geocode_cache WHERE k=?").bind(k).first(); if (r?.place) return r.place; } catch {}
  const place = await geo(a, b).catch(() => "") || "";
  if (place) try { await env.DB.prepare("INSERT OR REPLACE INTO geocode_cache (k, place, at) VALUES (?,?,?)").bind(k, place, now()).run(); } catch {}
  return place;
}
// A dropped document no longer holds its dedupe keys: the next copy of that photo or message is stored again.
export async function dedupeForgetDocs(env, tenant, channel, docs) {
  if (!docs?.length) return; await sourcesInit(env);
  for (const d of docs) await env.DB.prepare("DELETE FROM memory_dedupe WHERE tenant_id=? AND channel=? AND doc=?").bind(String(tenant), String(channel), String(d)).run();
}

// ---- tombstones ----
export async function addTombstones(env, tenant, channel, docs) {
  const list = (docs || []).map(String).filter((d) => d.startsWith("imp:")); if (!list.length) return 0;
  await sourcesInit(env); for (const d of list) await env.DB.prepare("INSERT OR IGNORE INTO memory_tombstones (tenant_id, channel, doc, at) VALUES (?,?,?,?)").bind(String(tenant), String(channel), d, now()).run();
  return list.length;
}
export async function tombstoned(env, tenant, channel, docs) {
  const list = (docs || []).map(String); if (!list.length) return new Set(); await sourcesInit(env); const out = new Set();
  for (let i = 0; i < list.length; i += 50) { const part = list.slice(i, i + 50);
    const rows = (await env.DB.prepare(`SELECT doc FROM memory_tombstones WHERE tenant_id=? AND channel=? AND doc IN (${part.map(() => "?").join(",")})`).bind(String(tenant), String(channel), ...part).all()).results || [];
    for (const r of rows) out.add(r.doc); }
  return out;
}
// A deliberate import brought these documents back: their tombstones go, so a later automatic re-sync keeps them too.
export async function clearTombstones(env, tenant, channel, docs) {
  const list = (docs || []).map(String); if (!list.length) return; await sourcesInit(env);
  for (const d of list) await env.DB.prepare("DELETE FROM memory_tombstones WHERE tenant_id=? AND channel=? AND doc=?").bind(String(tenant), String(channel), d).run();
}

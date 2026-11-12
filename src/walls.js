// Memory Overhaul phase 4B (DESIGN.md 6.4 and 6.6), flag HS_WALLS. No imports, so people.js, deletion-do.js, perms.js and index.js can all use it.
//
// 1. General's front door: the tenant setting front_door (D1 tenants, 0 or 1, default 0). The card that asks "Inspect other channels?" is in
//    front-door.js. This file only reads and writes the setting. A missing column or a failed read counts as 0 (ask first), never as open.
// 2. Contacts visibility: the Archive table people_seen (person, channel, at). A row means "this person came up in this channel". With the flag
//    on, a channel other than General sees only the people seen in it. General sees everyone, so General is never recorded.
export const hsWalls = (env) => env?.HS_WALLS === "on";
export const GENERAL = "main";

// ---------------------------------------------------------------- front door ----------------------------------------------------------------
export async function frontDoorGet(env, tenant) {
  if (!env?.DB || !tenant) return 0;
  try { const r = await env.DB.prepare("SELECT front_door FROM tenants WHERE id=?").bind(tenant).first(); return Number(r?.front_door) === 1 ? 1 : 0; } catch { return 0; }
}
export async function frontDoorSet(env, tenant, on) {
  await env.DB.prepare("UPDATE tenants SET front_door=? WHERE id=?").bind(on ? 1 : 0, tenant).run();
  return { ok: true, front_door: on ? 1 : 0 };
}

// ---------------------------------------------------------------- people_seen ----------------------------------------------------------------
export function seenInit(sql) {
  sql.exec("CREATE TABLE IF NOT EXISTS people_seen (person TEXT NOT NULL, channel TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (person, channel))");
  sql.exec("CREATE INDEX IF NOT EXISTS people_seen_c ON people_seen(channel)");
}
const slugs = (list) => [...new Set((Array.isArray(list) ? list : [list]).map((c) => String(c ?? "").trim()).filter((c) => c && c !== GENERAL))].slice(0, 100);
// Record that a person came up in these channels. General is never recorded (it sees everyone). An existing row keeps its first time.
export function seenAdd(sql, person, channels, at = Date.now()) {
  let n = 0; const p = String(person || ""); if (!p) return 0;
  for (const c of slugs(channels)) { const before = sql.exec("SELECT 1 FROM people_seen WHERE person=? AND channel=?", p, c).toArray().length; sql.exec("INSERT OR IGNORE INTO people_seen (person,channel,at) VALUES (?,?,?)", p, c, at); if (!before) n++; }
  return n;
}
// The Contacts screen's edit: the person is seen in exactly these channels (General aside).
export function seenSet(sql, person, channels, at = Date.now()) {
  const p = String(person || ""), want = new Set(slugs(channels));
  for (const r of sql.exec("SELECT channel FROM people_seen WHERE person=?", p).toArray()) if (!want.has(r.channel)) sql.exec("DELETE FROM people_seen WHERE person=? AND channel=?", p, r.channel);
  seenAdd(sql, p, [...want], at);
  return seenOf(sql, p);
}
export const seenOf = (sql, person) => sql.exec("SELECT channel FROM people_seen WHERE person=? ORDER BY channel", String(person)).toArray().map((r) => r.channel);
export function seenMap(sql) {
  const m = new Map();
  for (const r of sql.exec("SELECT person, channel FROM people_seen ORDER BY channel").toArray()) { if (!m.has(r.person)) m.set(r.person, []); m.get(r.person).push(r.channel); }
  return m;
}
export const seenDropPerson = (sql, person) => sql.exec("DELETE FROM people_seen WHERE person=?", String(person));
export const seenDropChannel = (sql, channel) => sql.exec("DELETE FROM people_seen WHERE channel=?", String(channel));
// A merge: the survivor is seen wherever either contact was; the other contact's rows go.
export function seenMerge(sql, keep, drop) {
  sql.exec("INSERT OR IGNORE INTO people_seen (person,channel,at) SELECT ?, channel, at FROM people_seen WHERE person=?", String(keep), String(drop));
  seenDropPerson(sql, drop);
}
// May this channel see this person? seen = the channels the person came up in. General sees everyone. With the flag off, everyone sees everyone.
export const canSee = (seen, { channel, general = false } = {}) => general || (!!channel && (seen || []).includes(channel));

// ---------------------------------------------------------------- the one time backfill ----------------------------------------------------------------
// Builds people_seen for contacts that exist from data that does exist (DESIGN.md 6.6): (1) people_facts.channel, set by the people job;
// (2) Notebook rows of the "people" section, matched to a contact by name or alias, whose channel_id gives the channel. A contact with no
// match stays General only. It is idempotent (INSERT OR IGNORE), so a run that stops halfway is finished by running it again, and a dry run
// only counts. Runs inside one Archive (this.sql). aliasesFor comes from people.js (passed in, to keep this file free of imports).
const normText = (s) => ` ${String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
export function backfillSeen(sql, { dry = true, aliasesFor } = {}) {
  const jp = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const chans = new Map();   // channel id -> slug
  for (const r of sql.exec("SELECT id, data FROM rows WHERE tbl='channels'").toArray()) { const c = jp(r.data); if (c && !c.deleting && c.kind !== "dm") chans.set(String(r.id), c.slug || c.name); }
  const live = new Set(chans.values());
  const people = sql.exec("SELECT id, name, rel, aka FROM people WHERE deleted=0").toArray().map((r) => ({ id: r.id, name: r.name, rel: r.rel, aka: jp(r.aka) || [] }));
  const pairs = new Map();   // "person|channel" -> { person, channel, at, via }
  const add = (person, channel, at, via) => { if (!channel || channel === GENERAL || !live.has(channel)) return false; const k = `${person}|${channel}`; if (pairs.has(k)) return false; pairs.set(k, { person, channel, at: Number(at) || Date.now(), via }); return true; };
  let fromFacts = 0, fromNotes = 0, skippedFacts = 0;
  const ids = new Set(people.map((p) => p.id));
  for (const r of sql.exec("SELECT person, channel, MIN(at) at FROM people_facts WHERE channel IS NOT NULL AND channel<>'' GROUP BY person, channel").toArray()) {
    if (!ids.has(r.person)) continue;
    if (add(r.person, r.channel, r.at, "fact")) fromFacts++; else if (!live.has(r.channel) && r.channel !== GENERAL) skippedFacts++;
  }
  const keyed = people.map((p) => ({ id: p.id, keys: (aliasesFor ? aliasesFor(p) : [String(p.name).toLowerCase()]).filter((a) => !/^my /.test(a)) }));
  for (const r of sql.exec("SELECT channel_id, data FROM rows WHERE tbl='memory_items'").toArray()) {
    const m = jp(r.data); if (!m || m.sec !== "people" || m.status === "superseded") continue;
    const slug = chans.get(String(r.channel_id)); if (!slug) continue;
    const text = normText(m.content);
    for (const p of keyed) if (p.keys.some((a) => text.includes(` ${a} `) || text.includes(` ${a}'s `))) { if (add(p.id, slug, m.created, "note")) fromNotes++; }
  }
  const existing = new Set(sql.exec("SELECT person, channel FROM people_seen").toArray().map((r) => `${r.person}|${r.channel}`));
  const fresh = [...pairs.values()].filter((x) => !existing.has(`${x.person}|${x.channel}`));
  const byChannel = {}; for (const x of fresh) byChannel[x.channel] = (byChannel[x.channel] || 0) + 1;
  const placed = new Set([...pairs.values(), ...[...existing].map((k) => ({ person: k.split("|")[0] }))].map((x) => x.person));
  const out = { contacts: people.length, rows_to_add: fresh.length, from_facts: fromFacts, from_notes: fromNotes, ignored_facts_in_missing_channels: skippedFacts, already_there: existing.size, general_only: people.filter((p) => !placed.has(p.id)).length, per_channel: byChannel };
  if (!dry) for (const x of fresh) sql.exec("INSERT OR IGNORE INTO people_seen (person,channel,at) VALUES (?,?,?)", x.person, x.channel, x.at);
  return { dry, ...out };
}

// POST /_ops/people-seen-backfill (ops-read.js, dev only): one account (slug) or a page of accounts. dry (default 1) only counts. At most 5 accounts per call.
export async function seenBackfillAdmin(env, { dry = true, slug = "", limit = 3, offset = 0, archive } = {}) {
  if (!hsWalls(env)) return { error: "HS_WALLS is off" };
  if (env.ENV_NAME !== "dev") return { error: "dev only" };
  limit = Math.min(5, Math.max(1, limit | 0 || 3)); offset = Math.max(0, offset | 0);
  const rows = slug ? ((await env.DB.prepare("SELECT id, slug FROM tenants WHERE slug=?").bind(slug).all()).results || [])
    : ((await env.DB.prepare("SELECT id, slug FROM tenants ORDER BY slug LIMIT ? OFFSET ?").bind(limit + 1, offset).all()).results || []);
  if (slug && !rows.length) return { error: "no such workspace" };
  const page = rows.slice(0, limit), results = [];
  for (const t of page) {
    try { results.push({ slug: t.slug, ...(await archive(env, t.id).peopleSeenBackfill(!dry)) }); }
    catch (e) { results.push({ slug: t.slug, error: String(e.message || e).slice(0, 160) }); }
  }
  return { dry, accounts: results.length, next_offset: !slug && rows.length > limit ? offset + limit : null, results };
}

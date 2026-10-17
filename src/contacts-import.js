// Contacts import (Captain 2026-10-06): the app reads a vCard / Google CSV / Outlook CSV in the browser (design-sandbox
// src/contacts-import.ts) and sends only the parsed contacts here, in batches. The file itself is never uploaded or stored.
// Rules: dedupe by email or phone (US numbers normalized to E.164); a name match is only ever a suggestion the person accepts
// in the preview (it arrives as `into`). On a merge we only FILL EMPTY fields and add facts that aren't there yet: nothing the
// person typed is ever overwritten. Extra numbers / emails / addresses, company + title, related people and (only if the
// person ticked "include notes") notes become facts on the contact. Every phone number and email goes on the contact itself,
// labeled (people.js keeps a list of each, primary first); a merge adds the ones the contact doesn't have yet.
export const IMPORT_BATCH_MAX = 500;      // contacts per request (the app sends 200 at a time)
export const CONTACTS_MAX = 20000;        // people in one workspace's Contacts; past this, new ones are skipped (merges still apply)
export const PHOTO_MAX = 24000;           // chars of a data: URL (the app sends ~96 px JPEGs, usually 3 to 6 KB)
const GROUPS = new Set(["Family", "Work", "Friends", "Services"]);
const SOURCES = { vcard: "Imported from a vCard", google: "Imported from Google Contacts", outlook: "Imported from Outlook", csv: "Imported from a spreadsheet" };
const rid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const str = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max);

// The side tables: photos (kept out of the list so boot stays small) and every phone/email key a contact was imported with,
// so a second import of the same file merges instead of duplicating, even through a contact's secondary numbers.
export function ensureImportTables(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS people_photos (person TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS people_keys (k TEXT NOT NULL, person TEXT NOT NULL, PRIMARY KEY (k, person));
    CREATE INDEX IF NOT EXISTS people_keys_p ON people_keys(person);`);
}

// "+1 (503) 555-0187", "503.555.0187", "1-503-555-0187", "tel:+15035550187;ext=2" → "+15035550187". Other countries keep
// their "+" form; "00…" / "011…" prefixes become "+". Too short to be a phone number → "".
export function e164(raw) {
  let s = String(raw || "").trim().replace(/^tel:/i, "").replace(/[;,]?\s*(?:ext\.?|extension|x|#|;ext=)\s*\d{1,6}\s*$/i, "").replace(/;ext=\d+$/i, "");
  const plus = /^\s*\+/.test(s), d = s.replace(/\D/g, "");
  if (d.length < 5 || d.length > 15) return "";
  if (plus) return d.length >= 8 ? `+${d}` : "";
  if (d.length === 10 && /^[2-9]/.test(d)) return `+1${d}`;
  if (d.length === 11 && d[0] === "1" && /^[2-9]/.test(d[1])) return `+${d}`;
  if (d.startsWith("011") && d.length > 10) return `+${d.slice(3)}`;
  if (d.startsWith("00") && d.length > 9) return `+${d.slice(2)}`;
  return d;   // a local / short number: matched as written
}
// US numbers show the way people type them in Contacts ("(503) 555-0187"); others as written.
export function phoneDisplay(raw) {
  const k = e164(raw);
  if (/^\+1[2-9]\d{9}$/.test(k)) return `(${k.slice(2, 5)}) ${k.slice(5, 8)}-${k.slice(8)}`;
  return str(String(raw).replace(/^tel:/i, ""), 40);
}
export const emailKey = (e) => { const s = String(e || "").trim().toLowerCase().replace(/^mailto:/, ""); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : ""; };
const keysOf = (c) => [...c.emails.map((e) => `e:${e.k}`), ...c.phones.map((p) => p.k && `t:${p.k}`)].filter(Boolean);   // an email match wins over a phone match
// A home / work / main line is often shared (a family landline, an office number): it only matches someone with a compatible
// name. A mobile (or an unlabeled number) and an email are personal: they match whoever has them.
export const sharedLine = (t) => /\b(home|work|main|fax|pager|other|company|business|office)\b/.test(t || "") && !/mobile|cell|iphone/.test(t || "");
const words = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
export function sameish(a, b) {   // a, b: { name, aka }
  const na = [a.name, ...(a.aka || [])].map((x) => words(x)).filter((w) => w.length), nb = [b.name, ...(b.aka || [])].map((x) => words(x)).filter((w) => w.length);
  return na.some((x) => nb.some((y) => x[0] === y[0] || x.join(" ") === y.join(" ")));
}
// Which existing contact this one is, by its keys (emails first). A shared line only counts when the names are compatible.
function matchOf(c, idx, who) {
  for (const e of c.emails) { const id = idx.get(`e:${e.k}`); if (id) return id; }
  for (const p of c.phones) { const id = idx.get(`t:${p.k}`); if (id && (!sharedLine(p.t) || sameish(c, who.get(id) || {}))) return id; }
  return null;
}
// Incoming phones / emails → the contact's stored entries ({ v, k, t }), the chosen primary first. "pref" is only a hint for that.
const entries = (list, primary) => [...(primary ? [primary] : []), ...list.filter((x) => x !== primary)].map((x) => ({ v: x.v, k: x.k, t: x.t.replace(/^pref ?/, "") }));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// The best one to show: marked preferred, then a mobile (for phones), then the first that isn't a fax.
function pick(list, isPhone) {
  return list.find((x) => /\bpref/.test(x.t)) || (isPhone && list.find((x) => /mobile|cell|iphone/.test(x.t))) || list.find((x) => !/fax|pager/.test(x.t)) || list[0];
}

// One incoming contact → a clean, capped shape. Returns null when there's nothing to keep.
export function cleanContact(o) {
  if (!o || typeof o !== "object") return null;
  const lab = (t) => str(t, 30).toLowerCase().replace(/[^a-z0-9' -]/g, "").replace(/\bpref\b ?/, "").trim();
  const phones = [], emails = [], seenP = new Set(), seenE = new Set();
  for (const p of (Array.isArray(o.phones) ? o.phones : []).slice(0, 12)) {
    const v = str(p?.v, 40), k = e164(v), t = (/\bpref/.test(String(p?.t || "")) ? "pref " : "") + lab(p?.t); if (!v || !k) continue;
    if (seenP.has(k)) { const q = phones.find((x) => x.k === k); if (q && sharedLine(q.t) && !sharedLine(t)) q.t = t; continue; }   // the same number as a mobile: personal
    seenP.add(k); phones.push({ v: phoneDisplay(v), k, t });
  }
  for (const e of (Array.isArray(o.emails) ? o.emails : []).slice(0, 12)) {
    const k = emailKey(str(e?.v, 200)); if (!k || seenE.has(k)) continue; seenE.add(k);
    emails.push({ v: k, k, t: (/\bpref/.test(String(e?.t || "")) ? "pref " : "") + lab(e?.t) });
  }
  const addrs = (Array.isArray(o.addrs) ? o.addrs : []).slice(0, 5).map((a) => ({ v: str(a?.v, 300), t: lab(a?.t) })).filter((a) => a.v);
  const related = (Array.isArray(o.related) ? o.related : []).slice(0, 10).map((r) => ({ name: str(r?.name, 120), t: lab(r?.t) })).filter((r) => r.name);
  const org = str(o.org, 120), title = str(o.title, 120);
  const name = str(o.name, 120) || org || emails[0]?.v || phones[0]?.v || "";
  const aka = [...new Set((Array.isArray(o.aka) ? o.aka : []).map((a) => str(a, 60)).filter((a) => a && a.toLowerCase() !== name.toLowerCase()))].slice(0, 10);
  const photo = typeof o.photo === "string" && o.photo.length <= PHOTO_MAX && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(o.photo) ? o.photo : "";
  if (!name) return null;
  return { name, aka, phones, emails, addrs, related, org, title, bday: str(o.bday, 40), note: str(String(o.note ?? "").replace(/\r\n?/g, "\n"), 990),   // a fact holds 1,000 characters; "Note: " + this fits
    rel: str(o.rel, 120), group: GROUPS.has(o.group) ? o.group : "", photo, into: o.into ? str(o.into, 40) : "" };
}

// Facts for a contact: everything that has no field of its own (numbers and emails do now). `primary.addr` = the address in the field.
function factsFor(c, primary) {
  const out = [];
  if (c.org && c.org !== c.name) out.push(c.title ? `${c.title} at ${c.org}` : `Works at ${c.org}`);
  else if (c.title) out.push(`Job title: ${c.title}`);
  for (const a of c.addrs.filter((a) => a.v !== primary.addr)) out.push(`${a.t ? `${cap(a.t)} address` : "Other address"}: ${a.v}`);
  for (const r of c.related) out.push(`${r.t ? cap(r.t) : "Related"}: ${r.name}`);
  if (c.note) out.push(`Note: ${c.note}`);
  return out;
}

// The import itself. `people` = the workspace's People (people.js). Synchronous, so the Archive DO can run it in one transaction.
export function importContacts(people, list, source = "csv") {
  const sql = people.sql; ensureImportTables(sql);
  const origin = SOURCES[source] || SOURCES.csv, now = Date.now();
  // One pass over who's already there: email / phone → person id (the fields, plus every key an earlier import saved).
  const idx = new Map(), live = new Set();
  const index = (k, id) => { if (k && !idx.has(k)) idx.set(k, id); };
  const who = new Map();   // id → { name, aka }, for the shared-line rule
  for (const r of sql.exec("SELECT id, name, aka, phone, email, phones, emails FROM people WHERE deleted=0").toArray()) { live.add(r.id); who.set(r.id, { name: r.name, aka: JSON.parse(r.aka || "[]") });
    for (const x of [{ v: r.phone }, ...JSON.parse(r.phones || "[]")]) { const t = e164(x.v); if (t) index(`t:${t}`, r.id); }
    for (const x of [{ v: r.email }, ...JSON.parse(r.emails || "[]")]) { const e = emailKey(x.v); if (e) index(`e:${e}`, r.id); } }
  for (const r of sql.exec("SELECT k, person FROM people_keys").toArray()) if (live.has(r.person)) index(r.k, r.person);
  let count = live.size;
  const out = { added: 0, merged: 0, unchanged: 0, skipped: [], ids: [] };
  for (const raw of (Array.isArray(list) ? list : []).slice(0, IMPORT_BATCH_MAX)) {
    const c = cleanContact(raw);
    if (!c) { out.skipped.push({ name: str(raw?.name, 80) || "(no name)", reason: "No name, email or phone" }); continue; }
    const ks = keysOf(c);
    const into = c.into && live.has(c.into) ? c.into : matchOf(c, idx, who);
    if (into) {
      const r = mergeInto(people, into, c, origin);
      out[r ? "merged" : "unchanged"]++; out.ids.push(into); { const w = who.get(into); if (w) w.aka = [...w.aka, c.name, ...c.aka]; }
      for (const k of ks) { index(k, into); sql.exec("INSERT OR IGNORE INTO people_keys (k, person) VALUES (?, ?)", k, into); }
      continue;
    }
    if (count >= CONTACTS_MAX) { out.skipped.push({ name: c.name, reason: `Contacts is full (${CONTACTS_MAX.toLocaleString("en-US")} people)` }); continue; }
    const id = rid() + out.added.toString(36), primary = { phone: pick(c.phones, true), email: pick(c.emails, false), addr: c.addrs[0]?.v || "" };
    const P = entries(c.phones, primary.phone), E = entries(c.emails, primary.email);
    sql.exec("INSERT INTO people (id,name,rel,aka,phone,email,bday,addr,grp,origin,created,updated,phones,emails) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, c.name, c.rel, JSON.stringify(c.aka),
      P[0]?.v ?? null, E[0]?.v ?? null, c.bday || null, primary.addr || null, c.group || "Friends", origin, now, now, JSON.stringify(P), JSON.stringify(E));
    for (const f of factsFor(c, primary)) people.addFact(id, f, "You imported");
    for (const k of ks) { index(k, id); sql.exec("INSERT OR IGNORE INTO people_keys (k, person) VALUES (?, ?)", k, id); }
    if (c.photo) sql.exec("INSERT OR IGNORE INTO people_photos (person, data, at) VALUES (?, ?, ?)", id, c.photo, now);
    live.add(id); who.set(id, { name: c.name, aka: c.aka }); count++; out.added++; out.ids.push(id);
  }
  return out;
}

// Merge = fill what's empty, add what's missing. Never changes the name, group, or any field that already has a value.
// Numbers / emails the contact doesn't have yet are added to its lists (its primary stays; one with none gets the best new one).
// Returns true when anything changed.
export function mergeInto(people, id, c, origin = "") {
  const p = people.get(id); if (!p) return false;
  const sql = people.sql, cur = people.lists(id), have = new Set(sql.exec("SELECT k FROM people_keys WHERE person=?", id).toArray().map((r) => r.k));
  const inP = new Set(cur.phones.map((x) => e164(x.v) || x.k)), inE = new Set(cur.emails.map((x) => emailKey(x.v) || x.k));
  // A number this contact was imported with before isn't added again (the person may have removed it on purpose).
  const newP = c.phones.filter((x) => !inP.has(x.k) && !have.has(`t:${x.k}`)), newE = c.emails.filter((x) => !inE.has(x.k) && !have.has(`e:${x.k}`));
  const P = cur.phones.length ? [...cur.phones, ...entries(newP)] : entries(newP, pick(newP, true)), E = cur.emails.length ? [...cur.emails, ...entries(newE)] : entries(newE, pick(newE, false));
  const fill = {};
  if (!p.bday && c.bday) fill.bday = c.bday;
  const addr = p.addr ? "" : c.addrs[0]?.v || ""; if (addr) fill.addr = addr;
  if (!p.rel && c.rel) fill.rel = c.rel;
  const lower = new Set([p.name, ...p.aka].map((a) => a.toLowerCase())), newAka = c.aka.filter((a) => !lower.has(a.toLowerCase()));
  if (c.name.toLowerCase() !== p.name.toLowerCase() && !lower.has(c.name.toLowerCase()) && c.name !== c.emails[0]?.v && c.name !== c.phones[0]?.v) newAka.push(c.name);
  let changed = false;
  if (Object.keys(fill).length || newAka.length || newP.length || newE.length) { people.upsert({ id, ...fill, aka: newAka, phones: P, emails: E }, origin); changed = true; }
  const facts = new Set(p.facts.map((f) => f.text));
  for (const f of factsFor(c, { addr: addr || p.addr })) if (!facts.has(f)) { people.addFact(id, f, "You imported"); changed = true; }
  if (c.photo && !sql.exec("SELECT 1 FROM people_photos WHERE person=?", id).toArray().length) { sql.exec("INSERT INTO people_photos (person, data, at) VALUES (?, ?, ?)", id, c.photo, Date.now()); changed = true; }
  return changed;
}

export function photoOf(sql, id) {
  ensureImportTables(sql);
  const r = sql.exec("SELECT data FROM people_photos WHERE person=?", String(id)).toArray()[0]; if (!r) return null;
  const m = String(r.data).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/); if (!m) return null;
  return { type: m[1], bytes: Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0)) };
}

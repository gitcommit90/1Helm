// Workspace-shared memory (memory item 1, Captain 2026-10-02): one registry of people + workspace facts for the whole account.
// Lives in the tenant's Archive DO, so every channel's resident reads the same thing. Contacts in the app is this same registry.
// Rules: facts are append-only (a changed fact supersedes, never overwrites); recall = alias match (µs) + the shared ledger's search.
import { Memory } from "./memory.js";
import { aiOpts } from "./model.js";
import { ensureImportTables, e164, emailKey } from "./contacts-import.js";
const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const clip = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const fold = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// ---------- several phones / emails per contact (Captain 2026-10-06) ----------
// Stored as JSON lists on the people row: [{ v: as written, k: match key (E.164 for phones, lowercase for emails), t: the label
// as it came in ("mobile", "work fax", "personal"…) }]. The FIRST entry is the primary one, and the old `phone` / `email` columns
// always mirror it, so anything that reads them keeps working. The app shows three labels: Work / Personal / Other.
export const LABELS = ["Personal", "Work", "Other"];
export function labelOf(t) {
  const s = String(t || "").toLowerCase().replace(/\bpref\b/g, "").trim();
  if (/\b(work|office|business|company)\b/.test(s)) return "Work";
  if (!s || /\b(mobile|cell|iphone|home|personal|private)\b/.test(s)) return "Personal";   // unlabeled = the person's own
  return "Other";
}
const keyOf = (kind, v) => kind === "phone" ? (e164(v) || String(v).replace(/\D/g, "")) : (emailKey(v) || String(v).trim().toLowerCase());
// A clean, deduped list (by key), primary first. `primary` (a value or key) moves that entry to the front.
export function cleanList(kind, list, primary) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const v = clip(typeof x === "string" ? x : x?.v, kind === "phone" ? 40 : 200); if (!v) continue;
    const k = keyOf(kind, v); if (!k || seen.has(k)) continue; seen.add(k);
    let t = clip(typeof x === "string" ? "" : x?.t ?? x?.label ?? "", 30).toLowerCase();
    out.push({ v, k, t, ...(x?.primary ? { p: 1 } : {}) });
    if (out.length >= 12) break;
  }
  const want = primary ? keyOf(kind, primary) : null, i = out.findIndex((x) => (want ? x.k === want : x.p));
  if (i > 0) out.unshift(...out.splice(i, 1));
  return out.map(({ p, ...x }) => x);
}
const shown = (list) => list.map((x, i) => ({ v: x.v, t: x.t, label: labelOf(x.t), ...(i === 0 ? { primary: true } : {}) }));
// "Other numbers: (212) 555-0100 (work), (212) 555-0177 (work fax)" (what the contacts import used to write) → entries.
export function parseOther(text) {
  const m = String(text || "").match(/^Other (number|email)s?: (.+)$/s); if (!m) return null;
  const kind = m[1] === "number" ? "phone" : "email", items = m[2].split(kind === "phone" ? /,\s+(?=[+(\d])/ : /,\s+/);
  const out = [];
  for (const it of items) { const x = it.trim().match(/^(.*?)(?:\s+\(([a-z0-9' -]*)\))?$/i); if (!x || !x[1]) continue; const v = x[1].trim(); if (!keyOf(kind, v)) continue; out.push({ v, t: (x[2] || "").toLowerCase() }); }
  return out.length ? { kind, list: out } : null;
}
// Default ways a person is referred to: the full name, the first name, and "my <relation>" when the relation is "Your sister"-style.
export function aliasesFor(p) {
  const out = new Set([p.name, ...(p.aka || [])].map(norm).filter(Boolean));
  const first = norm(p.name).split(" ")[0]; if (first && first.length > 1 && !/^(dr|mr|mrs|ms)$/.test(first)) out.add(first);
  const rel = norm(p.rel).replace(/^(your|my) /, ""); if (rel && rel.split(" ").length <= 3) out.add(`my ${rel}`);
  return [...out].filter((a) => a.length > 1);
}
// The shared address book as a short block for every channel's standing context, so a contact saved anywhere (the Contacts page, another
// channel) is in the next turn without a memory search. Newest change first; cut at the budget with a closing line naming recall_memory.
export const CONTACTS_BUDGET = 3000;
export function contactsBlock(list, { budget = CONTACTS_BUDGET } = {}) {
  const ps = (list || []).filter((p) => p?.name).slice().sort((a, b) => (Number(b.updated) || 0) - (Number(a.updated) || 0) || String(a.name).localeCompare(String(b.name)));
  const lines = []; let used = 0, left = 0;
  const more = (n) => `(+${n} more contact${n === 1 ? "" : "s"} not listed here. Search them with recall_memory.)`;
  for (const p of ps) { const ln = `- ${People.prototype.card(p)}`.slice(0, 400);
    if (left || used + ln.length + 1 > budget - more(9999).length - 1) { left++; continue; } lines.push(ln); used += ln.length + 1; }
  if (left) lines.push(more(left));
  return lines.join("\n");
}
// Does a remembered fact's subject name a person or organization (a Contacts entry), or a thing ("gate code", "wifi password", "the car")?
// Only people get a contact: a contact is shared by every channel, so a thing's name there would show that a channel-only fact exists.
// A person when: already in Contacts; the call gave contact details (relation, phone, email, birthday, other names); or the name looks
// like a name (1 to 4 capitalized words, none of them a common noun for a thing).
const THING_WORDS = new Set("code codes password passwords passcode pin key keys wifi wi-fi number numbers account accounts address car truck bike house home apartment door gate garage lock safe locker combination login username token license plate id card insurance policy order reservation booking flight trip project plan budget list note notes recipe schedule appointment meeting event bill invoice the my our a an".split(" "));
export function personSubject(about, o = {}, known = []) {
  const name = String(about || "").trim(); if (!name) return false;
  const k = norm(name); if (known.some((p) => aliasesFor(p).includes(k))) return true;
  if (o.relation || o.phone || o.email || o.birthday || (Array.isArray(o.also_called) && o.also_called.length)) return true;
  const words = name.split(/\s+/);
  return words.length <= 4 && words.every((w) => /^\p{Lu}[\p{L}'.-]*$/u.test(w) && !THING_WORDS.has(w.toLowerCase()));
}
export class People {
  constructor(sql, env) {
    this.sql = sql; this.env = env;
    sql.exec(`CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT NOT NULL, rel TEXT NOT NULL DEFAULT '', aka TEXT NOT NULL DEFAULT '[]', phone TEXT, email TEXT, bday TEXT, addr TEXT,
      grp TEXT NOT NULL DEFAULT 'Family', origin TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, phones TEXT NOT NULL DEFAULT '[]', emails TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS people_notdup (a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY (a, b));
      CREATE TABLE IF NOT EXISTS people_facts (id TEXT PRIMARY KEY, person TEXT NOT NULL, text TEXT NOT NULL, src TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, superseded_by TEXT);
      CREATE INDEX IF NOT EXISTS people_facts_p ON people_facts(person, at);`);
    ensureImportTables(sql);   // photos + phone/email keys from contacts imports (contacts-import.js)
    // Facts the background people upkeep learned (memjobs.js): the channel they were learned in (only that channel and General see
    // them, the memory wall) and their evidence (the person's quoted words, the turn, when).
    for (const c of ["channel TEXT", "cite TEXT"]) { try { sql.exec(`ALTER TABLE people_facts ADD COLUMN ${c}`); } catch {} }
    this.mem = new Memory(sql, env, (kind) => aiOpts(env, { kind, scope: "workspace" }));
    if (!sql.exec("PRAGMA table_info(people)").toArray().some((c) => c.name === "phones")) this.migrateLists();
  }
  // One-time, in place, on a workspace made before several numbers per contact: the phone / email become the primary entries,
  // and the import's "Other numbers: …" / "Other emails: …" facts become labeled entries (and leave the facts list).
  migrateLists() {
    const sql = this.sql;
    sql.exec("ALTER TABLE people ADD COLUMN phones TEXT NOT NULL DEFAULT '[]'"); sql.exec("ALTER TABLE people ADD COLUMN emails TEXT NOT NULL DEFAULT '[]'");
    let n = 0;
    for (const r of sql.exec("SELECT id, phone, email FROM people").toArray()) {
      const ph = r.phone ? [{ v: r.phone, t: "" }] : [], em = r.email ? [{ v: r.email, t: "" }] : [];
      for (const f of sql.exec("SELECT id, text FROM people_facts WHERE person=? AND superseded_by IS NULL AND text LIKE 'Other %'", r.id).toArray()) {
        const o = parseOther(f.text); if (!o) continue;
        (o.kind === "phone" ? ph : em).push(...o.list);
        sql.exec("UPDATE people_facts SET superseded_by='lists' WHERE id=?", f.id); this.mem.supersede(`f:${f.id}`, "lists");
      }
      const P = cleanList("phone", ph), E = cleanList("email", em);
      sql.exec("UPDATE people SET phones=?, emails=?, phone=?, email=? WHERE id=?", JSON.stringify(P), JSON.stringify(E), P[0]?.v ?? null, E[0]?.v ?? null, r.id); n++;
    }
    return n;
  }
  // Write a contact's lists (primary first) and mirror the primary into phone / email.
  setLists(id, phones, emails) {
    this.sql.exec("UPDATE people SET phones=?, emails=?, phone=?, email=?, updated=? WHERE id=?", JSON.stringify(phones), JSON.stringify(emails), phones[0]?.v ?? null, emails[0]?.v ?? null, Date.now(), String(id));
  }
  lists(id) { const r = this.sql.exec("SELECT phones, emails FROM people WHERE id=?", String(id)).toArray()[0]; return { phones: JSON.parse(r?.phones || "[]"), emails: JSON.parse(r?.emails || "[]") }; }
  row(r, ph) { const P = JSON.parse(r?.phones || "[]"), E = JSON.parse(r?.emails || "[]");
    return r && { id: r.id, name: r.name, rel: r.rel, aka: JSON.parse(r.aka || "[]"), phone: P[0]?.v || r.phone || undefined, email: E[0]?.v || r.email || undefined, phones: shown(P), emails: shown(E), bday: r.bday || undefined, addr: r.addr || undefined, group: r.grp, from: r.origin, created: r.created, updated: r.updated,
    photo: (ph ? ph.has(r.id) : this.sql.exec("SELECT 1 FROM people_photos WHERE person=?", r.id).toArray().length) ? 1 : undefined,
    facts: this.sql.exec("SELECT id, text, src, at, channel, cite FROM people_facts WHERE person=? AND superseded_by IS NULL ORDER BY at DESC", r.id).toArray()
      .map(({ channel, cite, ...f }) => ({ ...f, ...(channel ? { channel } : {}), ...(cite ? { cite: (() => { try { return JSON.parse(cite); } catch { return null; } })() } : {}) })) }; }
  list() { const ph = new Set(this.sql.exec("SELECT person FROM people_photos").toArray().map((x) => x.person)); return this.sql.exec("SELECT * FROM people WHERE deleted=0 ORDER BY name COLLATE NOCASE").toArray().map((r) => this.row(r, ph)); }
  get(id) { return this.row(this.sql.exec("SELECT * FROM people WHERE id=? AND deleted=0", String(id)).toArray()[0]); }
  // Find by any alias (name, first name, aka, "my sister"). Exact alias match only, so "Dana" never grabs "Danielle".
  find(ref) { const k = norm(ref); if (!k) return null; return this.list().find((p) => aliasesFor(p).includes(k) || aliasesFor(p).includes(k.replace(/^my /, "my "))) || null; }
  // People mentioned in a message: every alias checked as a whole phrase. Longest alias wins ties; at most 4 people.
  mentioned(text) {
    const t = ` ${norm(text)} `; if (!t.trim()) return [];
    const hits = [];
    for (const p of this.list()) { const a = aliasesFor(p).find((x) => new RegExp(`[ ]${reEsc(x)}(?:'s)?[ ]`).test(t)); if (a) hits.push({ p, a }); }
    return hits.sort((x, y) => y.a.length - x.a.length).slice(0, 4).map((h) => h.p);
  }
  // o.phones / o.emails (lists, from the app's Edit form) replace the lists. A single o.phone / o.email (the helper, older callers)
  // ADDS that number as the primary one and keeps the others, so learning a new number never loses the old one.
  upsert(o, origin = "") {
    const now = Date.now(), name = String(o.name || "").trim().slice(0, 120);
    // o.create (the app's "Add contact"): always a new card. Matching by name or "my brother" there renamed the person's other brother.
    let p = o.id ? this.get(o.id) : o.create ? null : (this.find(name) || (o.rel ? this.find(`my ${norm(o.rel).replace(/^(your|my) /, "")}`) : null));
    const aka = [...new Set([...(p?.aka || []), ...(o.aka || []).map((x) => String(x).trim()).filter(Boolean)])].slice(0, 20);
    const cur = p ? this.lists(p.id) : { phones: [], emails: [] };
    const next = (kind, many, one, have) => Array.isArray(many) ? cleanList(kind, many) : one ? cleanList(kind, [{ v: one, t: have.find((x) => x.k === keyOf(kind, one))?.t ?? "" }, ...have], one) : have;
    const P = next("phone", o.phones, o.phone, cur.phones), E = next("email", o.emails, o.email, cur.emails);
    if (!p) {
      if (!name) return { error: "name required" };
      const id = rid();
      this.sql.exec("INSERT INTO people (id,name,rel,aka,phone,email,bday,addr,grp,origin,created,updated,phones,emails) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, name, String(o.rel || "").slice(0, 120), JSON.stringify(aka),
        P[0]?.v ?? null, E[0]?.v ?? null, o.bday || null, o.addr || null, o.group || "Family", origin, now, now, JSON.stringify(P), JSON.stringify(E));
      p = this.get(id);
    } else {
      const set = { name: name || p.name, rel: o.rel ?? p.rel, bday: o.bday ?? p.bday ?? null, addr: o.addr ?? p.addr ?? null, grp: o.group ?? p.group };
      if (o.replaceAka) aka.splice(0, aka.length, ...(o.aka || []));
      this.sql.exec("UPDATE people SET name=?,rel=?,aka=?,bday=?,addr=?,grp=?,updated=? WHERE id=?", set.name, set.rel, JSON.stringify(aka), set.bday, set.addr, set.grp, now, p.id);
      this.setLists(p.id, P, E);
      p = this.get(p.id);
    }
    this.cardRow(p, origin || "contacts");
    return p;
  }
  // The contact card itself is a ledger row too (versioned by its update time), so meaning-search finds "my sister" → Dana.
  cardRow(p, author) {
    this.mem.put({ id: `p:${p.id}@${p.updated}`, at: Date.now(), kind: "person", author, source: `contacts · ${p.name}`, text: this.card(p) });
    for (const old of this.sql.exec("SELECT id FROM mem_rows WHERE id LIKE ? AND id<>? AND superseded_by IS NULL", `p:${p.id}@%`, `p:${p.id}@${p.updated}`).toArray()) this.mem.supersede(old.id, `p:${p.id}@${p.updated}`);
  }
  remove(id) { this.sql.exec("UPDATE people SET deleted=1, updated=? WHERE id=?", Date.now(), String(id)); this.sql.exec("DELETE FROM people_notdup WHERE a=? OR b=?", String(id), String(id)); this.sql.exec("DELETE FROM people_photos WHERE person=?", String(id)); this.sql.exec("DELETE FROM people_keys WHERE person=?", String(id)); this.sql.exec("UPDATE mem_rows SET superseded_by='deleted' WHERE id LIKE ? AND superseded_by IS NULL", `p:${id}@%`); return { ok: true }; }
  // ---------- merging two contacts into one (Captain 2026-10-06: "two contacts for my brother") ----------
  // The plan both the app's preview and the merge use: numbers and emails deduped by their key (E.164 for US phones), aliases
  // combined (the name that loses becomes one), facts combined without repeats. Name / relation / group / birthday / address
  // come from `keep` unless `pick` chooses the other contact's value (only a value one of the two has is accepted).
  mergePlan(keepId, dropId, pick = {}) {
    const a = this.get(keepId), b = this.get(dropId); if (!a || !b) return { error: "no such contact" }; if (a.id === b.id) return { error: "that's the same contact" };
    const choose = (k) => { const v = pick[k]; return v && (v === a[k] || v === b[k]) ? v : (a[k] || b[k] || ""); };   // an empty pick = no choice
    const name = choose("name") || a.name, la = this.lists(a.id), lb = this.lists(b.id);
    const phones = cleanList("phone", [...la.phones, ...lb.phones], pick.phone), emails = cleanList("email", [...la.emails, ...lb.emails], pick.email);
    const low = name.toLowerCase(), seen = new Set([low]), aka = [];
    for (const x of [...a.aka, ...b.aka, a.name, b.name]) { const v = String(x).trim(), k = v.toLowerCase(); if (v && !seen.has(k)) { seen.add(k); aka.push(v); } }
    const texts = new Set(), facts = [], dupFacts = [];
    for (const f of [...a.facts, ...b.facts]) { const k = fold(f.text); if (texts.has(k)) dupFacts.push(f.id); else { texts.add(k); facts.push(f); } }
    const hasPhoto = (id) => this.sql.exec("SELECT 1 FROM people_photos WHERE person=?", id).toArray().length > 0;
    const photo = pick.photo === "drop" && hasPhoto(b.id) ? "drop" : hasPhoto(a.id) ? "keep" : hasPhoto(b.id) ? "drop" : "";
    return { keep: a.id, drop: b.id, name, rel: choose("rel"), group: choose("group") || a.group, bday: choose("bday"), addr: choose("addr"), aka: aka.slice(0, 20),
      phones: shown(phones), emails: shown(emails), facts, photo, _: { phones, emails, dupFacts } };
  }
  // The merge itself: the survivor gets the plan; everything keyed to the other contact's id (its facts, import keys, photo, its
  // ledger rows) moves to the survivor; then the other contact is deleted. The Archive runs this in one transaction.
  merge(keepId, dropId, pick = {}) {
    const m = this.mergePlan(keepId, dropId, pick); if (m.error) return m;
    const sql = this.sql, now = Date.now(), a = m.keep, b = m.drop;
    sql.exec("UPDATE people SET name=?, rel=?, aka=?, grp=?, bday=?, addr=?, updated=? WHERE id=?", m.name, m.rel, JSON.stringify(m.aka), m.group, m.bday || null, m.addr || null, now, a);
    this.setLists(a, m._.phones, m._.emails);
    sql.exec("UPDATE people_facts SET person=? WHERE person=?", a, b);
    for (const id of m._.dupFacts) { sql.exec("UPDATE people_facts SET superseded_by='merged' WHERE id=?", id); this.mem.supersede(`f:${id}`, "merged"); }
    sql.exec("INSERT OR IGNORE INTO people_keys (k, person) SELECT k, ? FROM people_keys WHERE person=?", a, b); sql.exec("DELETE FROM people_keys WHERE person=?", b);
    if (m.photo === "drop") { sql.exec("DELETE FROM people_photos WHERE person=?", a); sql.exec("UPDATE people_photos SET person=? WHERE person=?", a, b); }
    sql.exec("DELETE FROM people_photos WHERE person=?", b);
    sql.exec("DELETE FROM people_notdup WHERE a=? OR b=?", b, b);
    sql.exec("UPDATE people SET deleted=1, updated=? WHERE id=?", now, b);
    const p = this.get(a);
    for (const old of sql.exec("SELECT id FROM mem_rows WHERE id LIKE ? AND superseded_by IS NULL", `p:${b}@%`).toArray()) this.mem.supersede(old.id, `p:${a}@${p.updated}`);
    this.cardRow(p, "contacts merge");
    return p;
  }
  // Likely duplicates for the "Suggested duplicates" list: the same phone number or email, or the same name. Pairs the person
  // said aren't duplicates stay out. At most 20 pairs.
  duplicates() {
    const ps = this.sql.exec("SELECT id, name, phones, emails FROM people WHERE deleted=0 ORDER BY created").toArray();
    const no = new Set(this.sql.exec("SELECT a, b FROM people_notdup").toArray().map((r) => `${r.a}|${r.b}`));
    const by = new Map(), out = [], seen = new Set();
    const add = (k, id, why) => { const l = by.get(k) || []; l.push({ id, why }); by.set(k, l); };
    for (const r of ps) {
      for (const x of JSON.parse(r.phones || "[]")) add(`t:${x.k}`, r.id, `Same number ${x.v}`);
      for (const x of JSON.parse(r.emails || "[]")) add(`e:${x.k}`, r.id, `Same email ${x.v}`);
      const n = fold(r.name); if (n.length > 2) add(`n:${n}`, r.id, "Same name");
    }
    for (const [, l] of by) for (let i = 1; i < l.length; i++) {
      const a = l[0].id, b = l[i].id; if (a === b) continue; const k = a < b ? `${a}|${b}` : `${b}|${a}`; if (seen.has(k) || no.has(k)) continue;
      seen.add(k); out.push({ a, b, why: l[i].why }); if (out.length >= 20) return out;
    }
    return out;
  }
  notDup(a, b) { a = String(a); b = String(b); if (a === b) return { ok: false }; const [x, y] = a < b ? [a, b] : [b, a]; this.sql.exec("INSERT OR IGNORE INTO people_notdup (a, b) VALUES (?, ?)", x, y); return { ok: true }; }
  // extra (the background people upkeep): { channel, ...evidence } → the fact's channel and cite columns.
  addFact(personId, text, src = "", replaces = null, extra = null) {
    const id = rid(), at = Date.now(), p = this.get(personId); if (!p) return null;
    const { channel = null, ...cite } = extra || {};
    this.sql.exec("INSERT INTO people_facts (id,person,text,src,at,channel,cite) VALUES (?,?,?,?,?,?,?)", id, p.id, String(text).slice(0, 1000), String(src).slice(0, 200), at, channel ? String(channel).slice(0, 64) : null, extra ? JSON.stringify(cite).slice(0, 2000) : null);
    if (replaces) this.sql.exec("UPDATE people_facts SET superseded_by=? WHERE id=? AND person=?", id, String(replaces), p.id);
    this.mem.put({ id: `f:${id}`, at, kind: "fact", author: src || "helper", source: `about ${p.name}${p.rel ? ` (${p.rel})` : ""}`, text: String(text) });
    if (replaces) this.mem.supersede(`f:${replaces}`, `f:${id}`);
    return { id, text, src, at };
  }
  // forget (forget.js): delete = delete. The fact, every version linked to it (superseded_by both ways), and their search rows.
  forgetFact(personId, factId) {
    const ids = new Set([String(factId)]), q = [String(factId)];
    while (q.length && ids.size < 12) { const x = q.shift(); for (const r of this.sql.exec("SELECT id, superseded_by FROM people_facts WHERE person=? AND (id=? OR superseded_by=?)", String(personId), x, x).toArray()) for (const y of [r.id, r.superseded_by]) if (y && !ids.has(y) && this.sql.exec("SELECT 1 FROM people_facts WHERE id=? AND person=?", y, String(personId)).toArray().length) { ids.add(y); q.push(y); } }
    let n = 0;
    for (const id of ids) { n += Number(this.sql.exec("SELECT COUNT(*) n FROM people_facts WHERE id=? AND person=?", id, String(personId)).one().n) || 0; this.sql.exec("DELETE FROM people_facts WHERE id=? AND person=?", id, String(personId)); this.sql.exec("DELETE FROM mem_rows WHERE id=?", `f:${id}`); try { this.sql.exec("DELETE FROM mem_fts WHERE id=?", `f:${id}`); } catch {} }
    return { ok: true, deleted: n };
  }
  dropFact(personId, factId) { this.sql.exec("UPDATE people_facts SET superseded_by='deleted' WHERE id=? AND person=?", String(factId), String(personId)); this.mem.supersede(`f:${factId}`, "deleted"); return { ok: true }; }
  // A workspace fact not about one person ("I'm vegetarian", "we live in Portland").
  addNote(text, src = "") { const id = `w:${rid()}`; this.mem.put({ id, at: Date.now(), kind: "fact", author: src || "helper", source: "about you", text: String(text).slice(0, 2000) }); return { id }; }
  // One line per person for the helper. Every number / email with its label, primary first:
  // "Sam Rivera — Your brother; phones (503) 555-0187 personal (primary), (503) 555-0100 work; email sam@x.com personal".
  card(p) {
    const many = (word, list, one) => { const l = list?.length ? list : one ? [{ v: one, label: "" }] : []; if (!l.length) return "";
      if (l.length === 1 && !l[0].t) return `${word} ${l[0].v}`;
      return `${word}${l.length > 1 ? "s" : ""} ${l.map((x, i) => `${x.v}${x.label ? ` ${x.label.toLowerCase()}` : ""}${i === 0 && l.length > 1 ? " (primary)" : ""}`).join(", ")}`; };
    const bits = [`${p.name}${p.rel ? ` — ${p.rel}` : ""}`, p.aka?.length ? `also called ${p.aka.map((a) => `"${a}"`).join(", ")}` : "", many("phone", p.phones, p.phone), many("email", p.emails, p.email), p.bday && `birthday ${p.bday}`, p.addr && `address ${p.addr}`].filter(Boolean);
    return bits.join("; ");
  }
  // Address-book recall for one message (Captain 2026-10-02: channels are isolated). Every channel gets only WHO the people are
  // (name, relation, aliases, phone, email) plus facts the person typed into Contacts themself. What a channel learns stays in that channel:
  // facts the background people upkeep learned show only in the channel they came from (o.channel) and in General (o.general).
  async recall(query, o = {}) {
    const t0 = Date.now(), ppl = this.mentioned(query);
    const cards = ppl.map((p) => { const mine = p.facts.filter((f) => /^You /.test(f.src)), learned = p.facts.filter((f) => f.channel && !/^You /.test(f.src) && (o.general || f.channel === o.channel));
      return `[contact · ${p.name}] ${this.card(p)}${mine.length ? `\n  Added by the person in Contacts: ${mine.slice(0, 8).map((f) => f.text).join(" · ")}` : ""}${learned.length ? `\n  Learned from what the person said${o.general ? "" : " in this channel"}: ${learned.slice(0, 8).map((f) => `${f.text}${o.general ? ` (#${f.channel})` : ""}`).join(" · ")}` : ""}`; });
    return { people: ppl.map((p) => ({ id: p.id, name: p.name, aliases: aliasesFor(p) })), ids: [], topSim: 0, ms: Date.now() - t0, pack: cards.join("\n") };
  }
}

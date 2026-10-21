// New speaker review (Captain 2026-10-14, the design notes, flag HS_ENVELOPE). In the Captain's words: "treat new speaker
// labels we have never seen coming from bee, become surfaced in the UI: 'New Speaker detected' then the user can see what Bee labelled the
// speaker, then the user can choose to edit or accept it only, then a short Contact query is done for possible matches and surfaced to the
// user 'Possible matches' - if the user confirms/accepts a match, now that specific speaker from that specific recording is linked to that
// specific person. THAT is how we avoid associating people's words with the wrong person."
//   - Each speaker of each recording (Bee's label and Bee's speaker id, the wearer excepted) gets one row here when the recording arrives:
//     state "new". The label stays exactly as Bee gave it; the person's edit goes beside it (name), never over it.
//   - Edit or Accept → "accepted". Possible matches: a short Contacts lookup by the name (or Bee's label), the aliases, and the email or phone
//     when Bee gives one. Confirm → "linked": the speaker in that recording is that Contacts person (person, person_name), the recording is
//     retained again with the person (adapters/bee.js), and the person is marked as seen in General (people_seen).
//   - End of the review without a link: a speaker the person has reviewed (Accept, or Edit with a name) that has no possible Contacts match left
//     (none found, or the person answered "Not them" to every one) goes to "reviewed" and leaves the queue. The row stays, Bee's label and the
//     person's name stay as stored, and nothing is linked (no retain, no people_seen). Rows already "accepted" with no match leave the queue the next
//     time the Notebook loads. A failed Contacts lookup is not "no matches": the card stays pending (speakerMatches returns null then).
//   - A speaker that is not confirmed is never linked to a person. A recording's speaker has no memory entity of its own any more: memory runs on Mem0,
//     which reads no speaker entities, so the per recording scope of 2026-10-14 ("option C") is retired (Captain 2026-10-21, ENVELOPE.md 9.1).
//   - A confirm is remembered (table speaker_map, one row per label, this account only): the same named label (exact, case insensitive, trimmed) in another
//     recording, or in a row already waiting, links to the same person at once, with the effects of Confirm (linked, the recording retained again with the
//     person, people_seen) and no card, logged as an event (speakersCarry; on arrival from hsBeePut, and when the Notebook loads). The newest confirm of a
//     label replaces its mapping and leaves earlier links as they are. "Not them" on a linked recording unlinks that recording only and keeps the mapping.
//     A generic label never maps. The mapping starts from the rows already linked, the newest per label (speakersSeedMap).
//   - A generic or empty label with no distinct Bee speaker id (Bee's "Unknown", "Speaker 2" with no id, Others, Guest, an id as the label) names
//     nobody and separates nobody: one such row can hold several people's words, so linking it to one Contacts person would attach other
//     people's words to that person. It gets no review card. The row is stored as "reviewed" at once (and an older pending one is settled on
//     the next load), by the same path as the end of a review: nothing deleted, nothing linked, logged as an event. A generic label WITH a
//     distinct Bee speaker id keeps its card, which shows the speaker's own words and the recording's time and place, has no Accept (accepting
//     "Speaker 2" as a name adds nothing) and is named with Edit. The label itself is never rewritten.
// The rows live in the BeeSync Durable Object, next to the facts waiting for review ("New from Bee"), and go with it.
import { hsEnvelope } from "../hs-flag.js";
import { e164 } from "../memory-envelope.js";
import { ambientLocation } from "./ambient.js";

export const SPEAKERS = `CREATE TABLE IF NOT EXISTS speakers (rec TEXT NOT NULL, spk TEXT NOT NULL, label TEXT NOT NULL, name TEXT, state TEXT NOT NULL DEFAULT 'new',
  person TEXT, person_name TEXT, email TEXT, phone TEXT, excerpt TEXT, rec_at INTEGER, at INTEGER NOT NULL, PRIMARY KEY (rec, spk))`;
// The standing mapping (Captain 2026-10-21): a confirmed link from a Bee speaker label to a Contacts person, for this account (this Durable Object is the account's).
// k: the label, trimmed and lower case. One row per label; the newest confirm replaces it.
export const SPEAKER_MAP = `CREATE TABLE IF NOT EXISTS speaker_map (k TEXT PRIMARY KEY, label TEXT NOT NULL, person TEXT NOT NULL, person_name TEXT NOT NULL, rec TEXT, at INTEGER NOT NULL)`;
export const mapKey = (label) => String(label ?? "").normalize("NFKC").trim().toLowerCase();
export const EXCERPT_LINES = 3, EXCERPT_CHARS = 240;   // what the review card shows of a speaker's words (the card only; memory keeps every word)
const now = () => Date.now();
// A speaker's key inside its recording: Bee's speaker id when Bee gives one, else its label.
export const spkKey = (u) => (u.speaker_id != null && u.speaker_id !== "" ? `id:${u.speaker_id}` : `label:${u.speaker}`);
// Email and phone Bee attaches to a speaker, when it does (read from the recording as Bee sent it).
function contactsOf(conv) {
  const out = new Map();
  for (const t of conv?.transcriptions || []) for (const u of t?.utterances || []) {
    const s = u?.speaker; if (!s || typeof s !== "object" || s.is_user === true) continue;
    const k = spkKey({ speaker_id: s.id ?? null, speaker: s.name || s.display_name || s.id }), em = s.email || s.email_address || null, ph = s.phone || s.phone_number || null;
    if (em || ph) out.set(k, { email: em ? String(em) : null, phone: ph ? String(ph) : null });
  }
  return out;
}
// A label that names nobody: empty, Bee's own placeholders, a bare number or id, or the speaker's own id. Matches "Unknown", "Unknown speaker",
// "Speaker 2", "Speaker B", "Person 3", "Guest", "Others", "Someone", "s2", a UUID and the like, in any case. id: Bee's speaker id for that speaker when it gave one.
const GENERIC_LABEL = /^(?:unknown|unidentified|unnamed|anonymous|speaker|spk|person|voice|participant|guest|guests|user|talker|caller|someone|somebody|other|others|stranger|man|woman|male|female|n\/a|none|null|undefined)(?:[\s_#:.-]*(?:\d+|[a-z]))?(?:[\s_-]*(?:speaker|person|voice))?(?:[\s_#:.-]*\d+)?$/i;
export function genericLabel(label, id = null) {
  const s = String(label ?? "").normalize("NFKC").replace(/[()\[\]{}"'`]/g, "").trim();
  if (!s || !/[\p{L}\p{N}]/u.test(s)) return true;
  if (id != null && id !== "" && s.toLowerCase() === String(id).trim().toLowerCase()) return true;
  if (/^(?:s|spk|speaker)?[_-]?\d+$/i.test(s) || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s) || /^[0-9a-f]{16,}$/i.test(s)) return true;
  return GENERIC_LABEL.test(s);
}
// The row's key says whether Bee gave a distinct speaker id (spkKey: "id:<id>") or only a label ("label:<label>").
export const spkId = (spk) => (String(spk).startsWith("id:") ? String(spk).slice(3) : null);
// A speaker Bee did not name and did not separate: no card, never linked.
export const unseparated = (row) => !!row && spkId(row.spk) == null && genericLabel(row.label, null);
const GENERIC = new Set(["speaker", "unknown", "person", "guest", "voice", "other", "others"]);
const words = (s) => String(s || "").toLowerCase().split(/[^\p{L}\p{N}']+/u).filter((w) => w.length >= 2 && !GENERIC.has(w) && !/^\d+$/.test(w));

// A label that may map: it names somebody (not Unknown, Speaker N, Others, Guest or an id) and Bee separated it or gave it a name.
export const mappable = (label, spk) => !genericLabel(label, spkId(spk)) && !unseparated({ spk, label });
export const speakerMethods = {
  // not_them: the Contacts ids the person said this speaker is not (a JSON list on the row). place: the recording's address when Bee gave one (for the card). Both are added to older tables with one ALTER each, no data changes.
  spkInit() { this.sql.exec(SPEAKERS); this.sql.exec(SPEAKER_MAP); if (!this._spkSeeded) { this._spkSeeded = true; if (!this.get("spk_map_seeded")) { try { this.speakersSeedMap(); } catch (e) { console.log("speaker map seed", String(e?.message || e).slice(0, 80)); } } } if (!this._spkCols) { try { const have = new Set(this.sql.exec("PRAGMA table_info(speakers)").toArray().map((c) => c.name)); for (const c of ["not_them", "place"]) if (!have.has(c)) this.sql.exec(`ALTER TABLE speakers ADD COLUMN ${c} TEXT`); this._spkCols = true; } catch (e) { console.log("speakers columns", String(e?.message || e).slice(0, 80)); } } },
  notThem(row) { try { return JSON.parse(row?.not_them || "[]"); } catch { return []; } },
  // A recording arrived: one "new" row per speaker not seen in it before. lines: ambientLines(conv). → how many rows were added.
  speakersSeen(conv, lines) {
    if (!hsEnvelope(this.env) || conv?.id == null) return 0; this.spkInit();
    const rec = String(conv.id), at = Date.parse(conv.start_time ?? "") || Number(conv.start_time) || now(), extra = contactsOf(conv), by = new Map();
    let place = null; try { place = ambientLocation(conv)?.address || null; } catch {}
    for (const u of lines || []) { if (u.is_user || u.speaker == null) continue; const k = spkKey(u); if (!by.has(k)) by.set(k, { label: String(u.speaker), texts: [] }); by.get(k).texts.push(String(u.text || "")); }
    let n = 0;
    for (const [spk, v] of by) {
      const ex = v.texts.slice(0, EXCERPT_LINES).join(" … ").slice(0, EXCERPT_CHARS), c = extra.get(spk) || {};
      const before = this.sql.exec("SELECT 1 FROM speakers WHERE rec=? AND spk=?", rec, spk).toArray().length;
      if (before) continue;
      // Bee gave no name and no separate speaker: stored as already reviewed, so it never becomes a card (see the header).
      const none = unseparated({ spk, label: v.label });
      this.sql.exec("INSERT INTO speakers (rec, spk, label, state, email, phone, excerpt, place, rec_at, at) VALUES (?,?,?,?, ?,?,?,?,?,?)", rec, spk, v.label, none ? "reviewed" : "new", c.email || null, c.phone || null, ex, place, at, now());
      if (none) this.ev(`speakers: ${rec}/${spk} has no name and no separate Bee speaker id, so no review card (nothing linked, nothing deleted)`); else n++;
    }
    return n;
  },
  speakerRow(rec, spk) { this.spkInit(); return this.sql.exec("SELECT * FROM speakers WHERE rec=? AND spk=?", String(rec), String(spk)).toArray()[0] || null; },
  // The confirmed links of one recording, for the envelope (adapters/bee.js). Only "linked" rows: an unconfirmed speaker is never a person.
  speakerLinks(rec) {
    try { this.spkInit(); return this.sql.exec("SELECT spk, label, name, person, person_name FROM speakers WHERE rec=? AND state='linked' AND person IS NOT NULL ORDER BY spk", String(rec)).toArray().map((r) => ({ ...r })); } catch { return []; }
  },
  // Rows that Bee neither named nor separated leave the queue here too (an older pending row, or one stored before this rule): same path as the end of a review.
  speakersSettleUnseparated() {
    for (const r of this.sql.exec("SELECT rec, spk, label, state FROM speakers WHERE state IN ('new','accepted') AND spk NOT LIKE 'id:%' LIMIT 500").toArray()) {
      if (unseparated(r)) this.speakerSettle(r, null, "no name and no separate Bee speaker id", true);
    }
  },
  pendingSpeakers() {
    this.spkInit(); this.speakersSettleUnseparated();
    return this.sql.exec("SELECT rec, spk, label, name, state, excerpt, place, rec_at FROM speakers WHERE state IN ('new','accepted') ORDER BY rec_at DESC, rec, spk LIMIT 200").toArray()
      .map((r) => ({ rec: r.rec, spk: r.spk, label: r.label, name: r.name || null, state: r.state, excerpt: r.excerpt || "", at: Number(r.rec_at) || null, ...(r.place ? { place: r.place } : {}), generic: genericLabel(r.label, spkId(r.spk)) }));
  },
  // Possible matches: a short Contacts lookup. Email or E.164 phone first, then the full name or an alias, then a shared word of the name.
  // Returns null when the Contacts lookup failed (not the same as no matches, which is []).
  async speakerMatches(row, preloaded = null) {
    let people = preloaded || []; if (!preloaded) { try { people = (await this.archive().peopleList()) || []; } catch { return null; } }
    const no = new Set(this.notThem(row));
    const q = String(row.name || (genericLabel(row.label, spkId(row.spk)) ? "" : row.label) || "").trim().toLowerCase(), qw = words(q), em = String(row.email || "").toLowerCase(), ph = e164(row.phone);
    const out = [];
    for (const p of people) {
      if (!p?.id || !p.name || no.has(String(p.id))) continue;   // a match the person answered "not them" is not offered again
      const names = [p.name, ...(p.aka || [])].map((x) => String(x).toLowerCase().trim()), emails = [p.email, ...(p.emails || []).map((x) => x?.v ?? x)].map((x) => String(x || "").toLowerCase()), phones = [p.phone, ...(p.phones || []).map((x) => x?.v ?? x)].map(e164);
      let score = 0, why = null;
      if (em && emails.includes(em)) { score = 100; why = "email"; } else if (ph && phones.includes(ph)) { score = 100; why = "phone"; }
      else if (q && names[0] === q) { score = 90; why = "name"; } else if (q && names.slice(1).includes(q)) { score = 80; why = "alias"; }
      else if (qw.length && names.some((n) => words(n).some((w) => qw.includes(w)))) { score = 50; why = "part of the name"; }
      if (score) out.push({ id: String(p.id), name: String(p.name), ...(p.rel ? { rel: String(p.rel) } : {}), why, score });
    }
    return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 5).map(({ score, ...x }) => x);
  },
  // A reviewed speaker (state "accepted") with no possible match left ends the review: state "reviewed", the row and its names kept, never linked.
  // matches null (the lookup failed) or a row that was not reviewed yet changes nothing. any: the speaker has no name and no separate Bee speaker id, so
  // it ends from "new" or "accepted" whatever the matches are. → true when the row left the queue.
  speakerSettle(row, matches, why, any = false) {
    if (!row) return false;
    if (any ? !["new", "accepted"].includes(row.state) : row.state !== "accepted" || !Array.isArray(matches) || matches.length) return false;
    this.sql.exec(`UPDATE speakers SET state='reviewed', at=? WHERE rec=? AND spk=? AND state ${any ? "IN ('new','accepted')" : "='accepted'"}`, now(), row.rec, row.spk);
    this.ev(`speakers: ${row.rec}/${row.spk} review ended, ${why} (nothing linked, nothing deleted)`); return true;
  },
  // ---- the standing mapping (label to Contacts person) ----
  speakerMapGet(label) { this.spkInit(); return this.sql.exec("SELECT k, label, person, person_name FROM speaker_map WHERE k=?", mapKey(label)).toArray()[0] || null; },
  // A confirm makes (or replaces) the mapping for its label. A generic label never maps. Earlier links of that label stay as they are. → true when it was stored.
  speakerMapSet(row, person, personName, at = now()) {
    if (!row || !mappable(row.label, row.spk)) return false; this.spkInit();
    this.sql.exec("INSERT INTO speaker_map (k, label, person, person_name, rec, at) VALUES (?,?,?,?,?,?) ON CONFLICT(k) DO UPDATE SET label=excluded.label, person=excluded.person, person_name=excluded.person_name, rec=excluded.rec, at=excluded.at", mapKey(row.label), String(row.label).trim(), String(person), String(personName), String(row.rec ?? ""), at);
    return true;
  },
  // Once per account: the mapping starts from the rows already linked, the newest link of each label winning.
  speakersSeedMap() {
    let n = 0;
    for (const r of this.sql.exec("SELECT rec, spk, label, person, person_name, at FROM speakers WHERE state='linked' AND person IS NOT NULL ORDER BY at ASC, rec ASC, spk ASC").toArray()) if (this.speakerMapSet(r, r.person, r.person_name || "", Number(r.at) || now())) n++;
    this.put("spk_map_seeded", "1"); if (n) this.ev(`speakers: ${n} confirmed link${n === 1 ? "" : "s"} became the remembered label-to-contact mapping`); return n;
  },
  // Pending rows (new or accepted) whose label has a mapping link at once, with the same state and effects as Confirm: linked, people_seen, and the recording retained again
  // with the person (retain: true waits for it, "later" lets it finish after the answer, false leaves it to the caller, which is about to retain the recording itself).
  // A row the person named differently, or answered "Not them" for that contact, is left for them. A contact that is gone drops the mapping. → the recordings that were linked.
  async speakersCarry({ retain = false } = {}) {
    this.spkInit(); const maps = new Map(this.sql.exec("SELECT k, label, person, person_name FROM speaker_map").toArray().map((r) => [r.k, r]));
    if (!maps.size) return [];
    const rows = this.sql.exec("SELECT rec, spk, label, name, state, not_them FROM speakers WHERE state IN ('new','accepted') LIMIT 500").toArray(), found = new Map(), seen = new Set(), recs = [];
    for (const r of rows) {
      if (!mappable(r.label, r.spk)) continue; const m = maps.get(mapKey(r.label)); if (!m) continue;
      if (r.name && mapKey(r.name) !== mapKey(r.label)) continue;
      if (this.notThem(r).includes(m.person)) continue;
      if (!found.has(m.person)) { let p; try { p = await this.archive().personGet(m.person); } catch { p = undefined; } found.set(m.person, p === undefined ? undefined : p?.id ? p : null); }
      const p = found.get(m.person); if (p === undefined) continue;   // the lookup failed: try again next time
      if (p === null) { this.sql.exec("DELETE FROM speaker_map WHERE k=? AND person=?", m.k ?? mapKey(r.label), m.person); this.ev(`speakers: the remembered contact ${m.person} for "${m.label}" is gone, so that mapping was dropped`); continue; }
      this.sql.exec("UPDATE speakers SET state='linked', person=?, person_name=?, at=? WHERE rec=? AND spk=? AND state IN ('new','accepted')", String(p.id), String(p.name), now(), r.rec, r.spk);
      if (!seen.has(String(p.id))) { seen.add(String(p.id)); try { await this.archive().personSeenAdd(String(p.id), ["main"]); } catch (e) { console.log("speaker seen", String(e?.message || e).slice(0, 120)); } }
      this.ev(`speakers: ${r.rec}/${r.spk} linked to contact ${p.id} (remembered from an earlier confirm)`); recs.push(r.rec);
    }
    if (recs.length && retain) { const go = async () => { for (const rec of new Set(recs)) { try { await this.speakerRetain(rec); } catch (e) { console.log("speaker retain", String(e?.message || e).slice(0, 120)); } } }; if (retain === "later" && this.ctx?.waitUntil) this.ctx.waitUntil(go()); else await go(); }
    return recs;
  },
  // /_ops/bee?speakers=1 (dev, read only): every row of the table in every state, with the row counts. No transcript text beyond the card's short excerpt.
  opsSpeakers() {
    this.spkInit();
    const rows = this.sql.exec("SELECT rec, spk, label, name, state, person IS NOT NULL AS linked, substr(excerpt,1,120) AS excerpt, place, rec_at FROM speakers ORDER BY rec_at DESC, rec, spk LIMIT 500").toArray();
    return { counts: Object.fromEntries(this.sql.exec("SELECT state k, COUNT(*) n FROM speakers GROUP BY state").toArray().map((r) => [r.k, r.n])), generic_without_id: rows.filter((r) => unseparated(r)).length, mapping: this.sql.exec("SELECT label, person, person_name, rec FROM speaker_map ORDER BY k").toArray(), rows: rows.map((r) => ({ ...r, linked: !!r.linked, generic: genericLabel(r.label, spkId(r.spk)) })) };
  },
  // The speakers waiting for review, each with its possible matches (the ones answered "not them" left out), for GET /api/notebook/main.
  async pendingSpeakersWithMatches() {
    try { await this.speakersCarry({ retain: "later" }); } catch (e) { console.log("speaker carry", String(e?.message || e).slice(0, 120)); }   // rows with a remembered label link now, so they are no card
    const list = this.pendingSpeakers(); if (!list.length) return list;
    let people = null; try { people = (await this.archive().peopleList()) || []; } catch {}
    const out = await Promise.all(list.map(async (x) => {
      const row = this.speakerRow(x.rec, x.spk), matches = people ? await this.speakerMatches({ ...row, name: x.name }, people) : null;   // no list of people: unknown, so no row leaves
      return this.speakerSettle(row, matches, "no possible match left") ? null : { ...x, matches: matches || [] };
    }));
    return out.filter(Boolean);
  },
  // op: list | edit | accept | matches | confirm | not_them. o: { name } for edit, { person } (a Contacts id) for confirm.
  async speakerAction(tenant, op, rec, spk, o = {}) {
    if (!this.tid() && tenant) this.put("tenant", tenant);
    if (op === "list") return { speakers: this.pendingSpeakers() };
    const row = this.speakerRow(rec, spk); if (!row) return { error: "That speaker isn't waiting for review.", speakers: this.pendingSpeakers() };
    if (unseparated(row)) { this.speakerSettle(row, null, "no name and no separate Bee speaker id", true); if (op === "matches") return { matches: [] }; return { error: "Bee didn't separate this voice from the others, so it can't be linked to a person.", reviewed: true, speakers: this.pendingSpeakers() }; }
    if (op === "matches") return { matches: (await this.speakerMatches(row)) || [] };
    // "Not them" on a linked recording (for example one linked by the remembered mapping) unlinks that recording only. The mapping stays and no other recording changes.
    if (op === "not_them" && row.state === "linked") {
      const pid = String(o.contact || "").trim(); if (!pid) return { error: "contact required" };
      if (String(row.person) !== pid) return { error: "That speaker is linked to a different contact.", speakers: this.pendingSpeakers() };
      const no = this.notThem(row); if (!no.includes(pid)) no.push(pid);
      this.sql.exec("UPDATE speakers SET state='reviewed', person=NULL, person_name=NULL, not_them=?, at=? WHERE rec=? AND spk=?", JSON.stringify(no), now(), row.rec, row.spk);
      let retained = false; try { retained = await this.speakerRetain(row.rec); } catch (e) { console.log("speaker retain", String(e?.message || e).slice(0, 120)); }
      this.ev(`speakers: ${row.rec}/${row.spk} unlinked from contact ${pid} (the person's answer; the remembered label stays, other recordings keep their links)`);
      return { ok: true, unlinked: true, reviewed: true, retained };
    }
    if (row.state === "linked") return { error: "That speaker is already linked.", speakers: this.pendingSpeakers() };
    if (op === "accept" && !row.name && genericLabel(row.label, spkId(row.spk))) return { error: "Bee's label doesn't name anyone. Give this speaker a name first.", speakers: this.pendingSpeakers() };
    if (op === "edit") {
      const name = String(o.name || "").trim(); if (!name) return { error: "A name is required." };
      this.sql.exec("UPDATE speakers SET name=?, state='accepted', at=? WHERE rec=? AND spk=?", name, now(), row.rec, row.spk);
      this.ev(`speakers: ${row.rec}/${row.spk} named by the person`);
      const m = await this.speakerMatches({ ...row, name }), reviewed = this.speakerSettle({ ...row, state: "accepted" }, m, "named and no possible match");
      return { ok: true, ...(reviewed ? { reviewed: true } : {}), speakers: this.pendingSpeakers(), matches: m || [] };
    }
    if (op === "accept") {
      this.sql.exec("UPDATE speakers SET state='accepted', at=? WHERE rec=? AND spk=?", now(), row.rec, row.spk);
      this.ev(`speakers: ${row.rec}/${row.spk} accepted as Bee labelled it`);
      const m = await this.speakerMatches(row), reviewed = this.speakerSettle({ ...row, state: "accepted" }, m, "accepted and no possible match");
      return { ok: true, ...(reviewed ? { reviewed: true } : {}), speakers: this.pendingSpeakers(), matches: m || [] };
    }
    if (op === "not_them") {
      const pid = String(o.contact || "").trim(); if (!pid) return { error: "contact required" };
      const no = this.notThem(row); if (!no.includes(pid)) no.push(pid);
      this.sql.exec("UPDATE speakers SET not_them=?, at=? WHERE rec=? AND spk=?", JSON.stringify(no), now(), row.rec, row.spk);
      this.ev(`speakers: ${row.rec}/${row.spk} is not contact ${pid} (the person's answer; nothing deleted)`);
      const fresh = this.speakerRow(row.rec, row.spk), left = await this.speakerMatches(fresh);
      // One click cards: a speaker still "new" whose last offered match was answered "Not them" ends its review too.
      const reviewed = fresh.state === "new" && Array.isArray(left) && !left.length && !unseparated(fresh) ? this.speakerSettle(fresh, null, "answered not them to every match", true) : this.speakerSettle(fresh, left, "answered not them to every match");
      return reviewed ? { ok: true, reviewed: true } : { ok: true };
    }
    if (op === "confirm") {
      const pid = String(o.person || ""); let p = null; try { p = pid ? await this.archive().personGet(pid) : null; } catch {}
      if (!p?.id) return { error: "That contact isn't there anymore.", speakers: this.pendingSpeakers() };
      this.sql.exec("UPDATE speakers SET state='linked', person=?, person_name=?, at=? WHERE rec=? AND spk=?", String(p.id), String(p.name), now(), row.rec, row.spk);
      let retained = false; try { retained = await this.speakerRetain(row.rec); } catch (e) { console.log("speaker retain", String(e?.message || e).slice(0, 120)); }
      try { await this.archive().personSeenAdd(String(p.id), ["main"]); } catch (e) { console.log("speaker seen", String(e?.message || e).slice(0, 120)); }
      const was = this.speakerMapGet(row.label), mapped = this.speakerMapSet(row, p.id, p.name);
      let carried = []; if (mapped) { try { carried = await this.speakersCarry({ retain: "later" }); } catch (e) { console.log("speaker carry", String(e?.message || e).slice(0, 120)); } }
      if (mapped) this.ev(`speakers: the label "${row.label}" now maps to contact ${p.id}${was && was.person !== String(p.id) ? ` (replacing contact ${was.person}; recordings already linked keep their link)` : ""}${carried.length ? `; ${carried.length} waiting recording${carried.length === 1 ? "" : "s"} linked` : ""}`);
      this.ev(`speakers: ${row.rec}/${row.spk} linked to contact ${p.id}${retained ? "; recording retained again" : "; recording not retained (it is retained with the link at its next sync)"}`);
      return { ok: true, linked: { rec: row.rec, spk: row.spk, label: row.label, person: String(p.id), person_name: String(p.name) }, retained, ...(carried.length ? { carried: carried.length } : {}), speakers: this.pendingSpeakers() };
    }
    return { error: "op must be list, edit, accept, matches, confirm or not_them" };
  },
  // The recording again, from its saved transcript, with its confirmed links (same document id, replace). → true when it was sent.
  async speakerRetain(rec) {
    const r = this.sql.exec("SELECT r2_key FROM convs WHERE id=?", Number(rec)).toArray()[0]; if (!r?.r2_key) return false;
    const o = await this.env.WS.get(r.r2_key); if (!o) return false; let conv; try { conv = JSON.parse(await o.text()); } catch { return false; }
    const out = await this.hsBeePut(conv); return !out?.error && !out?.skipped;
  },
};
export const speakersMix = (Cls) => Object.assign(Cls.prototype, speakerMethods);

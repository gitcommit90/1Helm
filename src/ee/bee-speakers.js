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
//   - A speaker that is not confirmed is never linked to a person. Inside one recording a speaker is its own entity (adapters/bee.js
//     scopedSpeaker), never linked across recordings by its label.
// The rows live in the BeeSync Durable Object, next to the facts waiting for review ("New from Bee"), and go with it.
import { hsEnvelope } from "../hs-flag.js";
import { e164 } from "../memory-envelope.js";

export const SPEAKERS = `CREATE TABLE IF NOT EXISTS speakers (rec TEXT NOT NULL, spk TEXT NOT NULL, label TEXT NOT NULL, name TEXT, state TEXT NOT NULL DEFAULT 'new',
  person TEXT, person_name TEXT, email TEXT, phone TEXT, excerpt TEXT, rec_at INTEGER, at INTEGER NOT NULL, PRIMARY KEY (rec, spk))`;
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
const GENERIC = new Set(["speaker", "unknown", "person", "guest", "voice", "other", "others"]);
const words = (s) => String(s || "").toLowerCase().split(/[^\p{L}\p{N}']+/u).filter((w) => w.length >= 2 && !GENERIC.has(w) && !/^\d+$/.test(w));

export const speakerMethods = {
  // not_them: the Contacts ids the person said this speaker is not (a JSON list on the row). Added to older tables with one ALTER, no data changes.
  spkInit() { this.sql.exec(SPEAKERS); if (!this._spkCols) { try { if (!this.sql.exec("PRAGMA table_info(speakers)").toArray().some((c) => c.name === "not_them")) this.sql.exec("ALTER TABLE speakers ADD COLUMN not_them TEXT"); this._spkCols = true; } catch (e) { console.log("speakers not_them column", String(e?.message || e).slice(0, 80)); } } },
  notThem(row) { try { return JSON.parse(row?.not_them || "[]"); } catch { return []; } },
  // A recording arrived: one "new" row per speaker not seen in it before. lines: ambientLines(conv). → how many rows were added.
  speakersSeen(conv, lines) {
    if (!hsEnvelope(this.env) || conv?.id == null) return 0; this.spkInit();
    const rec = String(conv.id), at = Date.parse(conv.start_time ?? "") || Number(conv.start_time) || now(), extra = contactsOf(conv), by = new Map();
    for (const u of lines || []) { if (u.is_user || u.speaker == null) continue; const k = spkKey(u); if (!by.has(k)) by.set(k, { label: String(u.speaker), texts: [] }); by.get(k).texts.push(String(u.text || "")); }
    let n = 0;
    for (const [spk, v] of by) {
      const ex = v.texts.slice(0, EXCERPT_LINES).join(" … ").slice(0, EXCERPT_CHARS), c = extra.get(spk) || {};
      const before = this.sql.exec("SELECT 1 FROM speakers WHERE rec=? AND spk=?", rec, spk).toArray().length;
      if (!before) { this.sql.exec("INSERT INTO speakers (rec, spk, label, state, email, phone, excerpt, rec_at, at) VALUES (?,?,?, 'new', ?,?,?,?,?)", rec, spk, v.label, c.email || null, c.phone || null, ex, at, now()); n++; }
    }
    return n;
  },
  speakerRow(rec, spk) { this.spkInit(); return this.sql.exec("SELECT * FROM speakers WHERE rec=? AND spk=?", String(rec), String(spk)).toArray()[0] || null; },
  // The confirmed links of one recording, for the envelope (adapters/bee.js). Only "linked" rows: an unconfirmed speaker is never a person.
  speakerLinks(rec) {
    try { this.spkInit(); return this.sql.exec("SELECT spk, label, name, person, person_name FROM speakers WHERE rec=? AND state='linked' AND person IS NOT NULL ORDER BY spk", String(rec)).toArray().map((r) => ({ ...r })); } catch { return []; }
  },
  pendingSpeakers() {
    this.spkInit();
    return this.sql.exec("SELECT rec, spk, label, name, state, excerpt, rec_at FROM speakers WHERE state IN ('new','accepted') ORDER BY rec_at DESC, rec, spk LIMIT 200").toArray()
      .map((r) => ({ rec: r.rec, spk: r.spk, label: r.label, name: r.name || null, state: r.state, excerpt: r.excerpt || "", at: Number(r.rec_at) || null }));
  },
  // Possible matches: a short Contacts lookup. Email or E.164 phone first, then the full name or an alias, then a shared word of the name.
  // Returns null when the Contacts lookup failed (not the same as no matches, which is []).
  async speakerMatches(row, preloaded = null) {
    let people = preloaded || []; if (!preloaded) { try { people = (await this.archive().peopleList()) || []; } catch { return null; } }
    const no = new Set(this.notThem(row));
    const q = String(row.name || row.label || "").trim().toLowerCase(), qw = words(q), em = String(row.email || "").toLowerCase(), ph = e164(row.phone);
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
  // matches null (the lookup failed) or a row that was not reviewed yet changes nothing. → true when the row left the queue.
  speakerSettle(row, matches, why) {
    if (!row || row.state !== "accepted" || !Array.isArray(matches) || matches.length) return false;
    this.sql.exec("UPDATE speakers SET state='reviewed', at=? WHERE rec=? AND spk=? AND state='accepted'", now(), row.rec, row.spk);
    this.ev(`speakers: ${row.rec}/${row.spk} review ended, ${why} (nothing linked, nothing deleted)`); return true;
  },
  // The speakers waiting for review, each with its possible matches (the ones answered "not them" left out), for GET /api/notebook/main.
  async pendingSpeakersWithMatches() {
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
    if (op === "matches") return { matches: (await this.speakerMatches(row)) || [] };
    if (row.state === "linked") return { error: "That speaker is already linked.", speakers: this.pendingSpeakers() };
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
      const fresh = this.speakerRow(row.rec, row.spk), reviewed = this.speakerSettle(fresh, await this.speakerMatches(fresh), "answered not them to every match");
      return reviewed ? { ok: true, reviewed: true } : { ok: true };
    }
    if (op === "confirm") {
      const pid = String(o.person || ""); let p = null; try { p = pid ? await this.archive().personGet(pid) : null; } catch {}
      if (!p?.id) return { error: "That contact isn't there anymore.", speakers: this.pendingSpeakers() };
      this.sql.exec("UPDATE speakers SET state='linked', person=?, person_name=?, at=? WHERE rec=? AND spk=?", String(p.id), String(p.name), now(), row.rec, row.spk);
      let retained = false; try { retained = await this.speakerRetain(row.rec); } catch (e) { console.log("speaker retain", String(e?.message || e).slice(0, 120)); }
      try { await this.archive().personSeenAdd(String(p.id), ["main"]); } catch (e) { console.log("speaker seen", String(e?.message || e).slice(0, 120)); }
      this.ev(`speakers: ${row.rec}/${row.spk} linked to contact ${p.id}${retained ? "; recording retained again" : "; recording not retained (it is retained with the link at its next sync)"}`);
      return { ok: true, linked: { rec: row.rec, spk: row.spk, label: row.label, person: String(p.id), person_name: String(p.name) }, retained, speakers: this.pendingSpeakers() };
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

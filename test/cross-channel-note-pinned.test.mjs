// node --import ./test/stubs/register.mjs test/cross-channel-note-pinned.test.mjs
// Release 36 (check-wsmemory): General saved "the gate code is 4417" into #bench2's Notebook, and the next bench2 turn made no
// memory search and answered "I have no record". A note another channel saves here is not found unless the model searches, so
// it must be in the channel's pinned notes from the moment it is written. Checks:
// - a note saved into a channel by General is marked (src "general") when it is written, and a note the channel saves itself is not;
// - pinnedBlock lists a General-written agent note even behind many newer notes and a full budget;
// - Resident.systemPrompt for the target channel (memory on) carries that note in its pinned block, and an ordinary agent note stays out.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { pinnedBlock, identityNote, FROM_GENERAL } from "../src/pinned-notes.js";
import { contactsBlock, CONTACTS_BUDGET, personSubject } from "../src/people.js";
import { Resident } from "../src/resident.js";
const ok = (n) => console.log("  ok", n);
const T0 = 1791000000000, H = 3600e3;
const agent = (id, text, at, x = {}) => ({ id, content: text, kind: "fact", sec: "about", author_type: "agent", status: "current", created: at, ...x });

{ // pinnedBlock
  const filler = Array.from({ length: 40 }, (_, i) => agent(`f${i}`, `Filler fact number ${i} about nothing in particular, padded out to take up a good amount of the budget.`, T0 + (i + 10) * H));
  const gate = agent("g1", "The gate code is 4417.", T0, { src: FROM_GENERAL });
  assert.ok(identityNote(gate), "a General-written note counts as a core fact");
  const b = pinnedBlock([...filler, gate].filter(identityNote));
  assert.match(b.text, /The gate code is 4417\./, "listed");
  const b2 = pinnedBlock([...filler, gate], { budget: 800 });
  assert.match(b2.text, /The gate code is 4417\./, "listed even behind newer notes and a small budget");
  ok("pinnedBlock lists a note General wrote into the channel");
}

{ // write path: rememberHere from General marks the row; the channel's own remember does not
  const calls = [];
  const db = new DatabaseSync(":memory:");
  const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
  const archive = { noteAdd: async (cid, sec, text, author, extra) => { calls.push({ cid, sec, text, author, extra }); return { id: `n${calls.length}`, content: text, created: T0 }; } };
  const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: () => {} };
  const R = new Resident(ctx, { DB: {}, ARCHIVE: { idFromName: (n) => n, get: () => archive }, MEMORY: "off", WORKMEM: "off" });
  R.put("tenant", "t1"); R.put("channel", "bench2"); R.put("channel_id", "2");
  R.memIndex = async () => {}; R.hsCapture = async () => {}; R.mem.put = () => true;
  await R.rememberHere("them", "The gate code is 4417.", "from General", "about", FROM_GENERAL);
  await R.rememberLocal("them", "Likes tea.", "task abc", "about");
  assert.equal(calls[0].extra.src, "general", "General's write is marked");
  assert.deepEqual(calls[1].extra, {}, "the channel's own write is not marked");
  ok("rememberHere marks notes written by General; rememberLocal does not");
}

{ // systemPrompt of the target channel
  const d1 = new DatabaseSync(":memory:");
  d1.exec(`CREATE TABLE tenants (id TEXT PRIMARY KEY, slug TEXT, helper_name TEXT, first_name TEXT, helper_tone INTEGER, status TEXT, past_due_since INTEGER);
    INSERT INTO tenants VALUES ('t1','ck1','Skipper','Joseph',1,'active',NULL);`);
  d1.exec(readFileSync(new URL("../db/migrations/0032_041_location.sql", import.meta.url), "utf8"));
  const D1 = { prepare: (q) => { const st = d1.prepare(q); let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }),
    run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
  const NOTES = [agent("g1", "The gate code is 4417.", T0, { src: FROM_GENERAL, sec: "people" }), agent("a1", "Prefers window seats on flights.", T0 + H)];
  let PEOPLE = [{ id: "p1", name: "Dana", rel: "Your sister", aka: [], updated: T0 }];
  const archive = { peopleList: async () => PEOPLE, channel: async () => ({ channel: { name: "bench2" }, memory: NOTES, messages: [] }), channels: async () => [{ name: "bench2", slug: "bench2" }],
    wsRecall: async () => ({ pack: "", ids: [], people: [] }), homeNote: async () => "", reflectionNote: async () => null };
  const db = new DatabaseSync(":memory:");
  const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
  const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: () => {} };
  const R = new Resident(ctx, { DB: D1, ARCHIVE: { idFromName: (n) => n, get: () => archive }, MEMORY: "off", WORKMEM: "off", GENUI: "on", BROWSER_AGENT: "jev" });
  R.put("tenant", "t1"); R.put("channel", "bench2"); R.put("channel_id", "2");
  R.memoryMode = () => "on"; R.notebookBackfillOnce = async () => 0; R.memoryBackfill = () => {}; R.mem.syncCurated = () => {};
  for (const layered of [false, true]) {
    const p = await R.systemPrompt(true, true, layered), text = layered ? JSON.stringify(p.standing) : p;
    assert.match(text, /The gate code is 4417\./, `layered=${layered}: the note General saved is pinned`);
    assert.doesNotMatch(text, /window seats/, `layered=${layered}: an ordinary agent note is still left to recall`);
  }
  ok("Resident.systemPrompt (classic and context v2): General's note is pinned in the target channel");
  // Contacts saved outside this channel's turns (the Contacts page) are in the next turn's standing context, alias included.
  const before = await R.systemPrompt(true, true, true);
  assert.doesNotMatch(JSON.stringify(before.standing), /ari@northwind\.co/);
  PEOPLE = [...PEOPLE, { id: "p2", name: "Ari Cohen", rel: "Your boss", aka: ["my boss"], email: "ari@northwind.co", updated: T0 + H }];
  const after = await R.systemPrompt(true, true, true);
  assert.match(after.standing.contacts, /Ari Cohen — Your boss; also called "my boss"; email ari@northwind\.co/, "new contact with alias and email");
  assert.match(after.standing.contacts, /Dana/);
  assert.match(after.developer, /Contacts .* listed in the user context/);
  assert.notEqual(JSON.stringify(before.standing), JSON.stringify(after.standing), "the standing context changes, so a running task gets a context update");
  ok("a contact saved by hand reaches the channel's next turn context");
}
{ // contactsBlock bounds
  const many = Array.from({ length: 200 }, (_, i) => ({ name: `Person Number${i}`, rel: "Friend", aka: [], email: `p${i}@example.com`, updated: T0 + i }));
  const b = contactsBlock(many);
  assert.ok(b.length <= CONTACTS_BUDGET, `within budget (${b.length})`);
  assert.match(b, /Number199/, "newest first"); assert.match(b, /\(\+\d+ more contacts not listed here\. Search them with recall_memory\.\)$/);
  assert.equal(contactsBlock([]), "");
  ok("contactsBlock is bounded, newest first, and names recall_memory for the rest");
}
{ // a thing never becomes a contact; a person does
  const known = [{ name: "Dana", rel: "Your sister", aka: [] }];
  for (const t of ["gate code", "Gate code", "Gate Code", "wifi password", "the car", "Wifi", "Trip to Lisbon"]) assert.equal(personSubject(t, {}, known), false, t);
  for (const t of ["Dana", "Ari Cohen", "Dr. Patel", "Mary-Jane O'Neil", "Northwind Bank"]) assert.equal(personSubject(t, {}, known), true, t);
  assert.equal(personSubject("dana", {}, known), true, "an existing contact by alias");
  assert.equal(personSubject("my boss", { relation: "Your boss" }, []), true, "contact details given");
  assert.equal(personSubject("gate code", { email: "x@example.com" }, []), true, "explicit details win");
  const upserts = [], notes = [];
  const db = new DatabaseSync(":memory:");
  const sql = { exec: (q, ...a) => { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
  const archive = { peopleList: async () => [], personUpsert: async (o) => { upserts.push(o); return { name: o.name, rel: o.rel }; },
    noteAdd: async (cid, sec, text) => { notes.push({ sec, text }); return { id: "n1", content: text, created: T0 }; } };
  const ctx = { storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, waitUntil: () => {} };
  const R = new Resident(ctx, { DB: {}, ARCHIVE: { idFromName: (n) => n, get: () => archive }, MEMORY: "off", WORKMEM: "off" });
  R.put("tenant", "t1"); R.put("channel", "main"); R.put("channel_id", "1"); R.memIndex = async () => {}; R.hsCapture = async () => {}; R.mem.put = () => true;
  const out = await R.localToolInner("remember", { about: "gate code", fact: "The gate code is 4417." }, {});
  assert.equal(upserts.length, 0, "no contact for a thing"); assert.doesNotMatch(String(out), /in Contacts/);
  assert.equal(notes.length, 1); assert.match(notes[0].text, /gate code/i);
  await R.localToolInner("remember", { about: "Dana", fact: "Likes tulips.", relation: "Your sister" }, {});
  assert.equal(upserts.length, 1); assert.equal(upserts[0].name, "Dana");
  ok("remember: a thing is a Notebook note only; a person still becomes a contact");
}
console.log("cross-channel-note-pinned: all ok");

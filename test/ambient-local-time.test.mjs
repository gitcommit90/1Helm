// node --import ./test/stubs/register.mjs test/ambient-local-time.test.mjs
// Bee and ambient tool results carry a *_local time in the person's zone next to every raw time.
import assert from "node:assert/strict";
import { ambientQuery, addLocalTimes, localStamp, AMBIENT_QUERY_TOOL } from "../src/ee/ambient-query.js";
import { locationQuery, LOCATION_QUERY_TOOL } from "../src/location-query.js";

const PDT = 1792525892000;   // 2026-10-20T19:51:32Z, the value the model converted on dev
const PST = Date.parse("2026-12-01T20:00:00Z");   // after daylight saving ends
assert.equal(localStamp(PDT, "America/Los_Angeles"), "Tue 2026-10-20T12:51:32-07:00");
assert.equal(localStamp(PST, "America/Los_Angeles"), "Tue 2026-12-01T12:00:00-08:00", "standard time offset");
assert.equal(localStamp(Date.parse("2026-03-08T09:59:59Z"), "America/Los_Angeles"), "Sun 2026-03-08T01:59:59-08:00", "last second before the clock change");
assert.equal(localStamp(Date.parse("2026-03-08T10:00:00Z"), "America/Los_Angeles"), "Sun 2026-03-08T03:00:00-07:00", "first second after the clock change");
assert.equal(localStamp(PDT, "Asia/Kolkata"), "Wed 2026-10-21T01:21:32+05:30", "half hour zone and next local day");

const raw = { items: [{ id: "a1", source_at: PDT, due_at: null, evidence: [{ at: PDT, utterance_id: "7" }] }],
  transcripts: [{ utterance_id: "1", at: PDT, offset: 0, id: "bee:1:h:0" }],
  locations: [{ id: "l1", conversation_from: PDT, conversation_to: PDT + 60000, observed_at: null }],
  memories: [{ id: "hs:1", mentioned_at: "2026-10-21T02:03:55.171Z" }],
  coverage: { earliest_available_at: PDT, latest_source_at: PST, scope: { from: PDT, to: PST }, queued: 3, ms: 120 }, next_cursor: "abc" };
const out = addLocalTimes(raw, "America/Los_Angeles");
assert.equal(out.items[0].source_at_local, "Tue 2026-10-20T12:51:32-07:00");
assert.equal(out.items[0].evidence[0].at_local, "Tue 2026-10-20T12:51:32-07:00");
assert.equal(out.items[0].due_at_local, undefined, "a null time gets no local field");
assert.equal(out.transcripts[0].at_local, "Tue 2026-10-20T12:51:32-07:00");
assert.equal(out.locations[0].conversation_to_local, "Tue 2026-10-20T12:52:32-07:00");
assert.equal(out.memories[0].mentioned_at_local, "Tue 2026-10-20T19:03:55-07:00");
assert.equal(out.coverage.latest_source_at_local, "Tue 2026-12-01T12:00:00-08:00", "daylight saving and standard time in one result");
assert.equal(out.coverage.scope.from_local, "Tue 2026-10-20T12:51:32-07:00");
assert.equal(out.coverage.queued, 3); assert.equal(out.coverage.ms, 120); assert.equal(out.coverage.ms_local, undefined);
assert.equal(out.next_cursor, "abc");
assert.deepEqual({ ...out.transcripts[0], at_local: undefined }, { ...raw.transcripts[0], at_local: undefined }, "raw fields are unchanged");
assert.deepEqual(addLocalTimes(out, "America/Los_Angeles"), out, "a second pass changes nothing");

// Through the real tool function, in two zones.
const stub = (result) => ({ idFromName: (n) => n, get: () => ({ ambientQuery: async () => result }) });
const make = (tz, result) => ({ get: (k) => ({ channel: "main", tenant: "t1" })[k], tz: () => tz, env: { ONEHELM_EE: "1hc", BEE_SYNC: stub(result) } });
const page = { items: [], transcripts: [{ utterance_id: "1", at: PDT, text: "hi", id: "bee:1:h:0", offset: 0 }], coverage: { incomplete: false, latest_source_at: PDT }, next_cursor: null };
const la = await ambientQuery(make("America/Los_Angeles", page), { mode: "transcript" });
assert.equal(la.transcripts[0].at, PDT); assert.equal(la.transcripts[0].at_local, "Tue 2026-10-20T12:51:32-07:00"); assert.equal(la.coverage.latest_source_at_local, la.transcripts[0].at_local);
const ny = await ambientQuery(make("America/New_York", page), { mode: "transcript" });
assert.equal(ny.transcripts[0].at_local, "Tue 2026-10-20T15:51:32-04:00");
const winter = await ambientQuery(make("America/Los_Angeles", { ...page, transcripts: [{ ...page.transcripts[0], at: PST }] }), { mode: "transcript" });
assert.equal(winter.transcripts[0].at_local, "Tue 2026-12-01T12:00:00-08:00");

// location_query: Bee places and the requested range.
const places = { items: [], locations: [{ id: "l1", source_id: "9", conversation_from: PDT, conversation_to: PDT + 1000, latitude: 1, longitude: 2 }], coverage: { incomplete: false }, next_cursor: null };
const loc = await locationQuery({ ...make("America/Los_Angeles", places), memoryMode: () => "on", env: { ONEHELM_EE: "1hc", DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) }, BEE_SYNC: stub(places) } }, { from: "2026-10-20T12:00:00-07:00", to: "2026-10-20T13:00:00-07:00" });
assert.equal(loc.bee_locations[0].conversation_from_local, "Tue 2026-10-20T12:51:32-07:00");
assert.equal(loc.requested.from_local, "Tue 2026-10-20T12:00:00-07:00");

// The tool descriptions tell the model not to convert.
for (const t of [AMBIENT_QUERY_TOOL, LOCATION_QUERY_TOOL]) assert.match(t.function.description, /_local[^.]*time zone, so do not convert/);
console.log("PASS ambient-local-time");

// Bee adapter (ENVELOPE.md): one Bee recording's envelope, from Bee's own fields, stored as Bee gave them. The transcript itself is
// unchanged (Bee option A: the raw words in chunks, hindsight-writers.js beeItem).
//   when    the recording's start_time and end_time, and Bee's timezone when it sends one
//   where   Bee's primary_location: its address and its latitude and longitude exactly as given (ambient.js ambientLocation), and the
//           whole location object in raw; 1HC adds no place name of its own here
//   who     each speaker label as Bee gave it, with Bee's speaker id as ref; the wearer is the person (self)
//   from    "bee", with Bee's device_type. source "user": the person's own recording (each line still names its speaker, and other
//           speakers are marked "not the user")
import { makeEnvelope, withEnvelope } from "../memory-envelope.js";

export const modality = "bee";
const ms = (x) => { if (x == null || x === "") return null; const n = typeof x === "number" ? x : Date.parse(x); return Number.isFinite(n) ? n : null; };

// c: { id, lines, at, started, ended, location, timezone, device, start_raw, end_raw } (start_raw and end_raw: Bee's start_time and end_time as sent). lines: ambientLines(conv) ([{ speaker, speaker_id, is_user, ... }]).
// location: ambientLocation(conv) or null.
export function beeEnvelope(c) {
  const seen = new Set(), who = [];
  for (const u of c.lines || []) {
    const name = u.speaker ?? (u.is_user ? "wearer" : null); if (name == null) continue;
    const k = `${u.is_user ? 1 : 0}|${u.speaker_id ?? ""}|${name}`; if (seen.has(k)) continue; seen.add(k);
    who.push({ name, ref: u.speaker_id != null ? `bee:${u.speaker_id}` : null, self: u.is_user === true, role: "speaker" });
  }
  // Bee's latitude and longitude exactly as Bee sent them (ambientLocation's raw object), even when they are 0,0 or off the globe; only
  // the place lookup skips those (Captain 2026-10-14).
  // c.primary: Bee's primary_location object exactly as Bee sent it (preferred); c.location: ambientLocation(conv), for older callers.
  const P = c.primary && typeof c.primary === "object" && !Array.isArray(c.primary) ? c.primary : null, L = c.location || null;
  const lat = P ? (typeof P.latitude === "number" ? P.latitude : null) : L?.latitude ?? null, lng = P ? (typeof P.longitude === "number" ? P.longitude : null) : L?.longitude ?? null;
  const address = P ? (typeof P.address === "string" && P.address.trim() ? P.address : null) : L?.address || null;
  return makeEnvelope({ kind: null, kind1hc: "transcript", modality: "audio",   // Bee gives no kind label of its own
    when: { start: ms(c.started) ?? ms(c.at), end: ms(c.ended), tz: c.timezone || null, tzSource: c.timezone ? "source" : "unknown", how: "bee" },
    where: address || lat != null || lng != null ? { address, lat, lng, how: "bee" } : null,
    privacy: { location: address || lat != null || lng != null ? "on" : "off" }, who, from: { key: "bee", device: c.device || null }, id: { record: `bee:${c.id}` },
    source: "user", raw: { ...(P ? { bee_location: P } : L?.raw ? { bee_location: L.raw } : {}), ...(c.start_raw != null ? { bee_start_time: c.start_raw } : {}), ...(c.end_raw != null ? { bee_end_time: c.end_raw } : {}) } });
}
// A speaker as an entity of ONE recording (Captain 2026-10-14, option C): a Hindsight entity label of the group "bee_speaker", which the
// raw-transcript strategy declares in both bank templates. Hindsight matches label entities exactly and keeps them out of every fuzzy
// match (hindsight@v1.0.0 engine/memories/pg/entity_resolver.py, entity_kind 'label'), so the same label in another recording, or a
// contact with the same name, is never merged with it. The value carries the recording id; Bee's label stays unchanged in the transcript.
// Bee's address and the confirmed people keep Hindsight's default resolution.
export const scopedSpeaker = (rec, p) => `bee_speaker:${rec}/${p.ref ? String(p.ref).replace(/^bee:/, "") : "-"} ${p.name}`;
// The Bee item (beeItem) with its envelope. c.speakers: the speakers the person confirmed as a Contacts person (bee-speakers.js
// speakerLinks), each added as that person's entity with a marked line naming the speaker; an unconfirmed speaker is never a person.
export function beeEnveloped(item, c, { first } = {}) {
  const e = beeEnvelope(c), out = withEnvelope(item, e, { first, people: false }), ents = [...(out.entities || [])], have = new Set(ents.map((x) => x.text.toLowerCase()));
  const add = (text, type) => { const k = String(text).toLowerCase(); if (text && !have.has(k)) { have.add(k); ents.push({ text, type }); } };
  const addr = e.where?.address; if (addr && !e.where.place) add(addr, "LOCATION");   // Bee's address has no place name of its own, so it is the place entity
  for (const p of e.who) if (!p.self) add(scopedSpeaker(c.id, p), "PERSON");
  const links = (c.speakers || []).filter((l) => l?.person && l?.person_name);
  for (const l of links) add(String(l.person_name), "PERSON");
  const head = links.map((l) => `[Written by 1Helm: ${l.label} in this recording is ${l.person_name}, confirmed by ${first || "the user"}]`).join("\n");
  return { ...out, ...(head && typeof out.content === "string" ? { content: `${head}\n${out.content}` } : {}), entities: ents,
    metadata: { ...out.metadata, speakers_scoped: "1hc: each speaker is a bee_speaker label entity of this recording only", ...(links.length ? { speaker_links: links.map((l) => `${l.label}=c:${l.person}`).join(", ") } : {}) } };
}

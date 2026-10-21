import { boundedJson } from "./bounded-body.js";
// The Notebook as pages (Memory Overhaul phase 6, the design notes). Each page is the facts of one or more categories of the channel's own
// Mem0 memory, newest first, written as a list with no model call (the extraction gives each fact its category). 1HC saves the person's edits as Notebook notes (retained
// as note:<id>), so the edit is a memory that every later search reads.
// Routes (Worker, current channel only, same sign-in as /api/notebook/<channel>):
//   GET  /api/notebook/<channel>/pages            the tree, the person, the facts box and every page ({ markdown, updated_at, sources, state }; state is ready, building or empty)
//   GET  /api/notebook/<channel>/pages/<id>       one page as Hindsight wrote it (a page never built asks for one refresh, at most every 1,800 seconds)
//   GET  /api/notebook/<channel>/photo            the person's own photo, original bytes (any channel: it is the account's, kept with General); POST (raw image body) sets or replaces it, POST .../photo/delete removes it
//   POST /api/notebook/<channel>/pages/<id>/edit  { section: heading|null, text } -> { ok, note_id }
import { bankId, factsOf as memoryFacts } from "./mem0.js";
import { hasSecret, SECRET_NOTE } from "./secrets-scrub.js";
import { templateKind } from "./hindsight-template.js";
import { placeOf, tzName } from "./interview.js";

// page id -> the fact categories that answer it, and the Notebook section its edits are filed under.
export const PAGES = {
  general: [
    { id: "about", title: (f) => `About ${f}`, categories: ["identity", "preference", "rule", "other"], sec: "about" },
    { id: "people", title: () => "People", categories: ["person"], sec: "people" },
    { id: "places", title: () => "Places", categories: ["place"], sec: "places" },
    { id: "routines", title: () => "Routines", categories: ["routine"], sec: "how" },
    { id: "whats-going-on", title: () => "What's going on", categories: ["project"], sec: "now" },
  ],
  channel: [
    { id: "brief", title: () => "Brief", categories: ["identity", "preference", "rule", "other"], sec: "ov" },
    { id: "decisions", title: () => "Decisions", categories: ["decision"], sec: "ov" },
    { id: "open-items", title: () => "Open items", categories: ["project"], sec: "now" },
  ],
};
// The photo upload: the types a browser shows as an image, checked by the bytes themselves (not the name or the header), and the size limit.
export const PHOTO_MAX_BYTES = 25 * 1024 * 1024;
export function imageKind(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return "";
}
export const NOTES_PAGE = { id: "notes", title: "All notes" };
export const pagesFor = (slug) => PAGES[templateKind(slug)];
const ms = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : null; };
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// updated: { pageId: ms of its newest fact }.
export function treeOf(slug, first, updated, notesAt) {
  return [...pagesFor(slug).map((p) => ({ id: p.id, title: p.title(first || "you"), group: "pages", kind: "page", updated_at: updated?.[p.id] || null })),
    { id: NOTES_PAGE.id, title: NOTES_PAGE.title, group: "more", kind: "notes", updated_at: notesAt || null }];
}

// The facts box (General only), read from what 1HC already has: the "Get to know you" answers (home, time zone) and Contacts (the person's own
// card for the birthday, partner and children by relation). Nothing is invented, and a field with no data is left out.
const OWN = /^(me|myself|self|you|yourself)$/i, PARTNER = /^(your|my)\s+(partner|spouse|wife|husband|girlfriend|boyfriend|fianc[ée]e?)\b/i, CHILD = /^(your|my)\s+(son|daughter|child|kid)\b/i;
export function factsOf({ interview, people = [] }) {
  const out = [], known = jp(interview?.known, {}), ans = jp(interview?.answers, {}), own = people.find((p) => OWN.test(String(p.rel || "").trim()));
  if (own?.bday) out.push({ label: "Born", value: String(own.bday) });
  const h = ans.home, home = h?.pick === "yes" ? placeOf(known) : String(h?.text || "").trim();
  if (home) out.push({ label: "Lives in", value: home });
  const partner = people.filter((p) => PARTNER.test(String(p.rel || ""))).map((p) => p.name); if (partner.length) out.push({ label: "Partner", value: partner.join(", ") });
  const kids = people.filter((p) => CHILD.test(String(p.rel || ""))).map((p) => p.name); if (kids.length) out.push({ label: kids.length > 1 ? "Children" : "Child", value: kids.join(", ") });
  if (known.tz) out.push({ label: "Time zone", value: tzName(known.tz) });
  return out;
}
const jp = (s, d) => { try { return typeof s === "string" ? JSON.parse(s) : s ?? d; } catch { return d; } };

// A page: the facts of its categories, newest first, as the Markdown list the app shows, with the facts as its sources.
export function pageOf(page, facts) {
  const mine = facts.filter((f) => page.categories.includes(f.type)).sort((a, b) => String(b.mentioned_at).localeCompare(String(a.mentioned_at)));
  const oneLine = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
  // One heading per category: the app gives each heading its own edit pencil.
  const section = (c) => `## ${c[0].toUpperCase()}${c.slice(1)}\n${mine.filter((f) => f.type === c).map((f) => `- ${oneLine(f.text)}`).join("\n")}`;
  return { markdown: page.categories.filter((c) => mine.some((f) => f.type === c)).map(section).join("\n\n"), updated_at: mine.length ? ms(mine[0].mentioned_at) : null,
    sources: mine.map((f) => ({ kind: "memory", id: f.id, title: oneLine(f.text).length > 90 ? `${oneLine(f.text).slice(0, 89)}…` : oneLine(f.text), at: ms(f.mentioned_at) })), state: mine.length ? "ready" : "empty" };
}

// deps: { archive (the tenant's Archive stub), channel (its row), resident (stub to the channel's Resident), interview (D1 row), slug (workspace), first, look }
export async function pagesRoute(req, env, t, chSlug, rest, deps) {
  const { A, ch, look } = deps, bank = bankId(env, t.id, chSlug), first = t.first_name || "", pages = pagesFor(chSlug);
  if (rest === "" || rest === "/") {
    if (req.method !== "GET") return J({ error: "not found" }, 404);
    const main = chSlug === "main";
    // Every read below is independent, so they all run at once: the notes, the facts, the Contacts and the photo.
    const [chan, facts, people, photo] = await Promise.all([A.channel(ch.id, 1), memoryFacts(env, bank, [...new Set(pages.flatMap((p) => p.categories))]).catch(() => []), main ? A.peopleList().catch(() => []) : [], deps.photo ? deps.photo().catch(() => null) : null]);
    const notes = (chan.memory || []).filter((m) => m.status !== "superseded"), notesAt = notes.reduce((a, m) => Math.max(a, Number(m.edited || m.created) || 0), 0) || null;
    const own = people.find((p) => OWN.test(String(p.rel || "").trim())), out = Object.fromEntries(pages.map((p) => [p.id, pageOf(p, facts)]));
    return J({ person: { first, name: own?.name || first, photo: photo ? `/w/${t.slug}/api/notebook/${chSlug}/photo?v=${photo.at}` : own?.photo ? `/w/${t.slug}/api/contacts/photo/${own.id}` : null },
      facts: main ? factsOf({ interview: deps.interview, people }) : [], tree: treeOf(chSlug, first, Object.fromEntries(pages.map((p) => [p.id, out[p.id].updated_at])), notesAt), pages: out });
  }
  const m = rest.match(/^\/([a-z0-9-]{1,40})(\/edit)?$/); if (!m) return J({ error: "not found" }, 404);
  const page = pages.find((p) => p.id === m[1]), isNotes = m[1] === NOTES_PAGE.id;
  const notes = isNotes ? ((await A.channel(ch.id, 1)).memory || []).filter((x) => x.status !== "superseded") : [];
  if (!page && !isNotes) return J({ error: "no such page" }, 404);
  if (!m[2]) {
    if (req.method !== "GET") return J({ error: "not found" }, 404);
    if (isNotes) return J({ id: NOTES_PAGE.id, title: NOTES_PAGE.title, markdown: "", updated_at: notes.reduce((a, n) => Math.max(a, Number(n.edited || n.created) || 0), 0) || null, sources: [] });
    return J({ id: page.id, title: page.title(first || "you"), ...pageOf(page, await memoryFacts(env, bank, page.categories).catch(() => [])) });
  }
  if (req.method !== "POST") return J({ error: "not found" }, 404);
  if (look) return J({ error: "view_as_read_only", message: "This is a read-only view." }, 403);
  if (isNotes) return J({ error: "Edit a note from the notes list." }, 400);
  const b = await boundedJson(req), text = String(b.text ?? "").trim(), section = b.section == null ? null : String(b.section).trim() || null;
  if (!text) return J({ error: "text required" }, 400);
  if (hasSecret(text)) return J({ error: SECRET_NOTE, secret: true }, 400);
  const r = await deps.R.nbPageEdit({ page: page.id, title: page.title(first || "you"), sec: page.sec, section, text });
  return J(r, r?.error ? 400 : 200);
}

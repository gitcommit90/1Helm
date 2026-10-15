import { boundedJson } from "./bounded-body.js";
// The Notebook as pages (Memory Overhaul phase 6, the design notes). Each page is a Hindsight mental model of the
// channel's own bank (a template model that refreshes itself after consolidation and at most once per 1,800 seconds). 1HC only reads it, and
// saves the person's edits as Notebook notes (retained as note:<id>), so the edit is a memory that every later refresh reads.
// Routes (Worker, current channel only, same sign-in as /api/notebook/<channel>):
//   GET  /api/notebook/<channel>/pages            the tree, the person, the facts box and every page ({ markdown, updated_at, sources, state }; state is ready, building or empty)
//   GET  /api/notebook/<channel>/pages/<id>       one page as Hindsight wrote it (a page never built asks for one refresh, at most every 1,800 seconds)
//   GET  /api/notebook/<channel>/photo            the person's own photo, original bytes (any channel: it is the account's, kept with General); POST (raw image body) sets or replaces it, POST .../photo/delete removes it
//   POST /api/notebook/<channel>/pages/<id>/edit  { section: heading|null, text } -> { ok, note_id }
import { bankId, mentalModelPage, mentalModelsMeta, freshStats } from "./hindsight.js";
import { hasSecret, SECRET_NOTE } from "./secrets-scrub.js";
import { templateKind } from "./hindsight-template.js";
import { placeOf, tzName } from "./interview.js";

// page id -> the Hindsight mental model that answers it, and the Notebook section its edits are filed under.
// about, routines and what's going on (and brief and open items) reuse the models the prompt already reads, so no model is duplicated.
export const PAGES = {
  general: [
    { id: "about", title: (f) => `About ${f}`, model: "profile", sec: "about" },
    { id: "people", title: () => "People", model: "people", sec: "people" },
    { id: "places", title: () => "Places", model: "places", sec: "places" },
    { id: "routines", title: () => "Routines", model: "routines", sec: "how" },
    { id: "whats-going-on", title: () => "What's going on", model: "active-tasks", sec: "now" },
  ],
  channel: [
    { id: "brief", title: () => "Brief", model: "brief", sec: "ov" },
    { id: "decisions", title: () => "Decisions", model: "decisions", sec: "ov" },
    { id: "open-items", title: () => "Open items", model: "active-tasks", sec: "now" },
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

export function treeOf(slug, first, meta, notesAt) {
  const by = new Map((meta || []).map((m) => [m.id, m]));
  return [...pagesFor(slug).map((p) => { const m = by.get(p.model); return { id: p.id, title: p.title(first || "you"), group: "pages", kind: "page", updated_at: m?.last_refreshed_at && m.content !== "" ? ms(m.last_refreshed_at) : null }; }),
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

// What the page was built from, as Hindsight 1.0.0 stores it: reflect_response.based_on is an object keyed by fact type ("world", "experience",
// "opinion", "observation"), each a list of { id, text, type, context }. "mental-models" and "directives" are not facts, so they are left out.
// The stored facts carry no document id, so a source is an observation or a memory, never a named note.
const FACT_TYPES = ["observation", "world", "experience", "opinion"];
export function sourcesOf(model) {
  const based = model?.reflect_response?.based_on, seen = new Set(), out = [];
  if (!based || typeof based !== "object") return out;
  for (const type of FACT_TYPES) for (const m of Array.isArray(based[type]) ? based[type] : []) {
    const id = String(m?.id || ""); if (!id || seen.has(id)) continue; seen.add(id);
    const text = String(m.text ?? "").replace(/\s+/g, " ").trim();
    out.push({ kind: type === "observation" ? "observation" : "memory", id, title: text.length > 90 ? `${text.slice(0, 89)}…` : text, at: null });
  }
  return out;
}

// deps: { archive (the tenant's Archive stub), channel (its row), resident (stub to the channel's Resident), interview (D1 row), slug (workspace), first, look }
export async function pagesRoute(req, env, t, chSlug, rest, deps) {
  const { A, ch, look } = deps, prefetch = new URL(req.url).searchParams.get("prefetch") === "1", bank = bankId(env, t.id, chSlug), first = t.first_name || "", pages = pagesFor(chSlug);
  if (rest === "" || rest === "/") {
    if (req.method !== "GET") return J({ error: "not found" }, 404);
    const main = chSlug === "main", realOpen = !look && !prefetch;
    // Every read below is independent, so they all run at once: the notes, the model list, the Contacts, and each page's model.
    const readAll = (ids) => Promise.all(ids.map((id) => mentalModelPage(env, bank, id).catch(() => null)));
    const [chan, meta0, people, mms0, photo] = await Promise.all([A.channel(ch.id, 1), mentalModelsMeta(env, bank).catch(() => []), main ? A.peopleList().catch(() => []) : [], readAll(pages.map((p) => p.model)), deps.photo ? deps.photo().catch(() => null) : null]);
    let meta = meta0, mms = mms0;
    // A real open of a bank whose template predates a page's model (the model does not exist, so the page stays blank): import the current template, then read again.
    if (realOpen && deps.resident && pages.some((p, i) => !mms[i])) {
      try { await (await deps.resident()).nbPagesEnsure(); [meta, mms] = await Promise.all([mentalModelsMeta(env, bank).catch(() => []), readAll(pages.map((p) => p.model))]); }
      catch (e) { console.log("pages ensure", String(e?.message || e).slice(0, 120)); }
    }
    const notes = (chan.memory || []).filter((m) => m.status !== "superseded"), notesAt = notes.reduce((a, m) => Math.max(a, Number(m.edited || m.created) || 0), 0) || null;
    const own = people.find((p) => OWN.test(String(p.rel || "").trim()));
    const byModel = new Map(pages.map((p, i) => [p.model, mms[i]]));
    // Pages with no text yet: building or empty. A model that still does not exist is building (the template import queues its first refresh) unless the bank holds nothing.
    const todo = pages.filter((p) => !String(byModel.get(p.model)?.content ?? "")), states = {};
    if (todo.length) {
      const refreshed = (p) => !!byModel.get(p.model)?.last_refreshed_at, input = [...new Map(todo.map((p) => [p.model, { model: p.model, refreshed: refreshed(p) }])).values()];
      let got = null;
      if (deps.resident && !look) { try { got = await (await deps.resident()).nbPagesBuild({ models: input, build: realOpen }); } catch (e) { console.log("pages build", String(e?.message || e).slice(0, 120)); } }
      if (!got) { const docs = await freshStats(env, bank).then((s) => Number(s?.total_documents) || 0).catch(() => null); got = Object.fromEntries(input.map((x) => [x.model, docs === 0 ? "empty" : x.refreshed ? "empty" : "building"])); }
      for (const p of todo) states[p.model] = got[p.model] === "building" ? "building" : "empty";
    }
    const out = {};
    for (const p of pages) { const mm = byModel.get(p.model), content = String(mm?.content ?? ""); out[p.id] = { markdown: content, updated_at: content && mm?.last_refreshed_at ? ms(mm.last_refreshed_at) : null, sources: content ? sourcesOf(mm) : [], state: content ? "ready" : states[p.model] || "empty" }; }
    return J({ person: { first, name: own?.name || first, photo: photo ? `/w/${t.slug}/api/notebook/${chSlug}/photo?v=${photo.at}` : own?.photo ? `/w/${t.slug}/api/contacts/photo/${own.id}` : null },
      facts: main ? factsOf({ interview: deps.interview, people }) : [], tree: treeOf(chSlug, first, meta, notesAt), pages: out });
  }
  const m = rest.match(/^\/([a-z0-9-]{1,40})(\/edit)?$/); if (!m) return J({ error: "not found" }, 404);
  const page = pages.find((p) => p.id === m[1]), isNotes = m[1] === NOTES_PAGE.id;
  const notes = isNotes ? ((await A.channel(ch.id, 1)).memory || []).filter((x) => x.status !== "superseded") : [];
  if (!page && !isNotes) return J({ error: "no such page" }, 404);
  if (!m[2]) {
    if (req.method !== "GET") return J({ error: "not found" }, 404);
    if (isNotes) return J({ id: NOTES_PAGE.id, title: NOTES_PAGE.title, markdown: "", updated_at: notes.reduce((a, n) => Math.max(a, Number(n.edited || n.created) || 0), 0) || null, sources: [] });
    let mm = await mentalModelPage(env, bank, page.model).catch(() => null);
    if (!mm && deps.resident && !look && !prefetch) { try { await (await deps.resident()).nbPagesEnsure(); mm = await mentalModelPage(env, bank, page.model).catch(() => null); } catch (e) { console.log("page ensure", String(e?.message || e).slice(0, 120)); } }   // a bank imported before this page's model existed
    const content = String(mm?.content ?? "");
    // Never built (the first refresh ran on an empty bank and the interval parks the rest): ask once for a refresh (notebook-pages-do.js nbPageBuild).
    // Only a real open asks: view-as and the app's background prefetch (?prefetch=1, read before the person opens the Notebook) never do.
    if (mm && !content && deps.resident && !look && !prefetch) { try { await (await deps.resident()).nbPageBuild({ model: page.model }); } catch (e) { console.log("page build", String(e?.message || e).slice(0, 120)); } }
    return J({ id: page.id, title: page.title(first || "you"), markdown: content, updated_at: content && mm?.last_refreshed_at ? ms(mm.last_refreshed_at) : null, sources: content ? sourcesOf(mm) : [] });
  }
  if (req.method !== "POST") return J({ error: "not found" }, 404);
  if (look) return J({ error: "view_as_read_only", message: "This is a read-only view." }, 403);
  if (isNotes) return J({ error: "Edit a note from the notes list." }, 400);
  const b = await boundedJson(req), text = String(b.text ?? "").trim(), section = b.section == null ? null : String(b.section).trim() || null;
  if (!text) return J({ error: "text required" }, 400);
  if (hasSecret(text)) return J({ error: SECRET_NOTE, secret: true }, 400);
  const r = await deps.R.nbPageEdit({ page: page.id, title: page.title(first || "you"), model: page.model, sec: page.sec, section, text });
  return J(r, r?.error ? 400 : 200);
}

// Creating a channel (a "project"). One function for the app's New channel sheet and for delegation from General.
// ONE helper (Captain, Muse overhaul): a channel is not a separate helper. It is the person's same helper (same name, same avatar),
// kept laser-focused on one project. So a channel is just a name and what it's for.
//
// What a channel is, and what this creates (everything else is keyed by the slug and comes to life on first use):
//   - Archive DO (archive:<tenant>), table rows: one 'channels' row {id, slug, name, kind:"channel", purpose, topic, created, by}.
//     That row is what makes the channel exist: the app's boot/poll, General's cross-channel memory reads, the bank sweep and
//     every /api/res/<slug>/... route list channels from it.
//   - Resident DO (res:<tenant>:<slug>): bound now (tenant, slug, channel id), so sessions, schedules and General's
//     "remember in #<slug>" work before anyone has opened the channel. Its local memory ledger is private to this DO.
//   - Hindsight bank (<env>-<tenant>-<slug>), when Hindsight is on: created now (idempotent), so General's cross-channel recall
//     finds an empty bank instead of an error. Best effort: if the box is down, the first retain creates it.
//   - Channel computer (cc:<tenant>:<slug>) and its R2 layers (t/<tenant>/c/<slug>/): created by the first computer tool call.
// Memory wall: each channel's memory (Resident ledger, Hindsight bank, Notebook rows by channel id) is private to it; only
// General (slug "main") reads across channels, and it finds new channels because it lists the Archive's channel rows.
// A deleted channel (deletion.js) is wiped everywhere (DO storage, bank, computer, R2) before its row goes, so a slug used again
// later starts empty: it can't inherit an old channel's bank, DO or computer.
import { hsOn } from "./hindsight.js";

export const MAX_CHANNELS = 100;   // per workspace, General included (Captain 2026-10-17: 25 -> 100; no plan defines a channel limit)
export const NAME_MAX = 40, PURPOSE_MAX = 200;
// Slugs the app or the server already use for something else (General is "main"; the hash router's own words).
const RESERVED = new Set(["main", "general", "new", "api", "app", "s", "settings", "apps", "library", "notebook", "contacts", "search", "home", "test"]);

export class ChannelError extends Error {
  constructor(code, message, status = 400, extra = {}) { super(message); this.code = code; this.status = status; Object.assign(this, extra); }
}

const clean = (s) => String(s ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim();
const len = (s) => [...s].length;
// Clip to n characters at a word boundary when one is close (helper-proposed text only; a person's text is never cut silently).
const clip = (s, n) => { if (len(s) <= n) return s; const c = [...s].slice(0, n).join(""), sp = c.lastIndexOf(" "); return (sp > n * 0.6 ? c.slice(0, sp) : c).replace(/[\s,;:.\-–—]+$/, ""); };

export function slugify(name) {
  const s = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return s || "project";
}

// Validated {name, purpose} or a ChannelError. by: "person" rejects text over the limits (the app's fields enforce them);
// by: "helper" clips, so a long proposal from the model still makes a channel.
export function channelInput({ name, purpose, by } = {}) {
  if (by !== "person" && by !== "helper") throw new ChannelError("bad_request", 'by must be "person" or "helper"');
  let n = clean(name).replace(/^#+\s*/, ""), p = clean(purpose);
  if (!n) throw new ChannelError("name_required", "Give the channel a name.");
  if (len(n) > NAME_MAX) { if (by === "person") throw new ChannelError("name_too_long", `Keep the name to ${NAME_MAX} characters or fewer.`); n = clip(n, NAME_MAX); }
  if (len(p) > PURPOSE_MAX) { if (by === "person") throw new ChannelError("purpose_too_long", `Keep “What's it for?” to ${PURPOSE_MAX} characters or fewer.`); p = clip(p, PURPOSE_MAX); }
  return { name: n, purpose: p };
}

// Runs inside the Archive Durable Object (Archive.addChannel). No await in here, so the duplicate check, the limit check and the
// insert are one atomic step: two creates at once can't both take the same name, slug or last slot.
export function insertChannel(sql, { name, purpose, by, max = MAX_CHANNELS }) {
  const have = sql.exec("SELECT id, data FROM rows WHERE tbl='channels'").toArray().map((r) => ({ rid: r.id, ...JSON.parse(r.data) }));
  const real = have.filter((c) => c.kind !== "dm" && !c.test), key = (s) => String(s || "").trim().toLowerCase();
  const dup = real.find((c) => key(c.name) === key(name) || (c.slug === "main" && key(name) === "general"));
  if (dup) return { error: "duplicate", existing: { id: dup.id, slug: dup.slug || dup.name, name: dup.slug === "main" ? "General" : dup.name, purpose: dup.purpose || dup.topic || "" } };
  if (real.length >= max) return { error: "limit", max };
  const taken = new Set(have.map((c) => String(c.slug || c.name)));
  const base = slugify(name); let slug = base;
  for (let i = 2; taken.has(slug) || RESERVED.has(slug); i++) slug = `${base}-${i}`;
  const ids = new Set(have.flatMap((c) => [String(c.id), String(c.rid)]));
  let id = Math.max(1, ...have.map((c) => Number(c.id)).filter((x) => Number.isFinite(x) && (x < 9001 || x > 9009))) + 1;
  while (ids.has(String(id)) || (id >= 9001 && id <= 9009)) id++;   // 9001-9009: TEST_MODE bench channels
  const at = Date.now(), row = { id, slug, name, kind: "channel", purpose, topic: purpose, created: at, updated: at, by };
  sql.exec("INSERT INTO rows (tbl,id,channel_id,data) VALUES ('channels',?,NULL,?)", String(id), JSON.stringify(row));
  return { channel: row };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);

// createChannel(env, tenant, { name, purpose, by: "person" | "helper" }) → { id, slug, name, purpose }
// tenant: the tenants row (or its id). Throws ChannelError {code, status, message}: bad_request / name_required / name_too_long /
// purpose_too_long (400), duplicate (409, .existing = that channel), channel_limit (403, .max). Read-only accounts are refused by
// the caller (the route answers 402), the same as every other write.
export async function createChannel(env, tenant, { name, purpose, by = "person" } = {}) {
  const tid = typeof tenant === "string" ? tenant : tenant?.id;
  if (!tid) throw new ChannelError("bad_request", "no tenant");
  const inp = channelInput({ name, purpose, by });
  const A = env.ARCHIVE.get(env.ARCHIVE.idFromName(`archive:${tid}`));
  await A.provisionFresh();   // General first (a no-op once any channel exists), so a new channel can never be a workspace's only one
  const r = await A.addChannel({ ...inp, by, max: MAX_CHANNELS });
  if (r.error === "duplicate") throw new ChannelError("duplicate", `You already have a channel called “${r.existing.name}”.`, 409, { existing: r.existing });
  if (r.error === "limit") throw new ChannelError("channel_limit", `You have ${r.max} channels, the most a workspace can have for now.`, 403, { max: r.max });
  if (!r.channel) throw new ChannelError("failed", "Couldn't create the channel. Try again.", 500);
  const c = r.channel, R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tid}:${c.slug}`));
  await R.bind(tid, c.slug, String(c.id));
  if (hsOn(env)) await withTimeout(R.hsBank(), 4000).catch((e) => console.log("channel bank", c.slug, e.message));
  return { id: c.id, slug: c.slug, name: c.name, purpose: c.purpose };
}

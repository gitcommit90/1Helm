// Deleting a chat, a channel, a Notebook note's memory, or the whole account (the Captain, 10-06):
//   "Add chat deleting, and make it clear: delete = delete. Same with account and channel deletions. It really really really means delete."
//   "Deleting from the Notebook should delete from memory, yes."
// Real deletion everywhere (rows DELETEd, objects deleted, Durable Object storage deleteAll()'d, external accounts disconnected).
// What runs inside an object is src/deletion-do.js; this module orchestrates, owns the routes and makes it resumable:
//   - deletion_jobs (D1): an in-progress marker per deletion (kind, tenant, target, meta, steps done). Every step is safe to run
//     again; a job left unfinished (crash, a turn still finishing, a provider down) is resumed by the 5-minute cron.
//   - deletion_log (D1): one completion record per deletion with NO user content: kind, a hash of the tenant id (and target),
//     row/object counts, reason, start/finish time. Proof that it ran.
//   - hs_forget (D1): Hindsight documents to delete again later. Retain is asynchronous on Hindsight's side, so a document can
//     land after we deleted it; each is deleted now and re-checked at +2 min, +10 min, +30 min and +2 h.
// Exported for the billing agent (cancel at period end → delete): deleteAccount(env, tenantId, { reason }), deleteChannel(env,
// tenantId, slug), deleteSession(env, tenantId, slug, sessionId).
import { hsOn, bankId, forgetChannel, forgetTenant, forgetDocument } from "./hindsight.js";
import { disconnectAllManaged } from "./ee/index.js";
import { selfSignOut } from "./ee/index.js";
import { linkDisconnect } from "./ee/index.js";
import { openSecret } from "./sentinel.js";
import { stDeleteListed } from "./storage.js";
import { boundedJson, BodyTooLargeError } from "./bounded-body.js";

const GENERAL = "main";
const now = () => Date.now();
const json = (b, s = 200, h = {}) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", ...h } });
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))));
const hashOf = async (s) => (await sha(`1hc-deletion:${s}`)).slice(0, 32);
const jp = (s, d) => { try { return JSON.parse(s ?? "") ?? d; } catch { return d; } };
const reasonOf = (r) => String(r || "person").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) || "person";
const norm = (s) => String(s ?? "").normalize("NFC").replace(/^#+\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();
export const ACCOUNT_CONFIRM = "delete my account";
const HS_RECHECK = [0, 2 * 60e3, 10 * 60e3, 30 * 60e3, 2 * 3600e3];

const archive = (env, tid) => env.ARCHIVE.get(env.ARCHIVE.idFromName(`archive:${tid}`));
const resident = (env, tid, slug) => env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tid}:${slug}`));
const ccOf = (env, tid, slug) => env.CHANNEL_COMPUTER.get(env.CHANNEL_COMPUTER.idFromName(`cc:${tid}:${slug}`));

// ---------------------------------------------------------------- D1 bookkeeping ----------------------------------------------------------------
let tablesReady = false;
export async function ensureDeletionTables(env) {
  if (tablesReady) return;
  for (const q of [
    "CREATE TABLE IF NOT EXISTS deletion_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, tenant_id TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', reason TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, error TEXT)",
    "CREATE TABLE IF NOT EXISTS deletion_log (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, tenant_hash TEXT NOT NULL, target_hash TEXT, counts TEXT NOT NULL, reason TEXT, started_at INTEGER, finished_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS hs_forget (bank TEXT NOT NULL, doc TEXT NOT NULL, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bank, doc))",
  ]) await env.DB.prepare(q).run();
  tablesReady = true;
}
async function jobStart(env, kind, tid, target, meta = {}, reason = "person") {
  await ensureDeletionTables(env);
  const id = `${kind}:${tid}:${target}`;
  const ex = await env.DB.prepare("SELECT * FROM deletion_jobs WHERE id=?").bind(id).first();
  if (ex) { const m = { ...meta, ...jp(ex.meta, {}) }; await env.DB.prepare("UPDATE deletion_jobs SET tries=tries+1, updated_at=?, meta=? WHERE id=?").bind(now(), JSON.stringify(m), id).run(); return { id, meta: m, started: ex.started_at, reason: ex.reason || reason }; }
  await env.DB.prepare("INSERT INTO deletion_jobs (id,kind,tenant_id,target,meta,reason,started_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(id, kind, tid, target, JSON.stringify(meta), reason, now(), now()).run();
  return { id, meta, started: now(), reason };
}
async function jobSave(env, job, error = null) {
  await env.DB.prepare("UPDATE deletion_jobs SET meta=?, updated_at=?, error=? WHERE id=?").bind(JSON.stringify(job.meta), now(), error ? String(error).slice(0, 300) : null, job.id).run();
}
async function jobDone(env, job, kind, tid, target, counts) {
  // Per-channel steps of an account deletion are keyed "ch:<slug>:<step>": summed per step, so no channel name reaches the log.
  const c = {}; for (const [k, v] of Object.entries(counts || {})) { const m = k.match(/^ch:.+:([a-z0-9_]+)$/); if (m) { c.channels ||= { n: 0 }; c.channels[m[1]] = mergeNums(c.channels[m[1]], v); if (m[1] === "resident") c.channels.n++; } else c[k] = v; }
  counts = c;
  await env.DB.prepare("INSERT INTO deletion_log (kind,tenant_hash,target_hash,counts,reason,started_at,finished_at) VALUES (?,?,?,?,?,?,?)")
    .bind(kind, await hashOf(tid), target ? await hashOf(`${tid}:${target}`) : null, JSON.stringify(numbersOnly(counts)), job.reason, job.started, now()).run();
  await env.DB.prepare("DELETE FROM deletion_jobs WHERE id=?").bind(job.id).run();
}
const mergeNums = (a, b) => { if (a == null) return b; if (typeof a === "number" && typeof b === "number") return a + b; const o = { ...(typeof a === "object" ? a : { n: a }) };
  for (const [k, v] of Object.entries(typeof b === "object" && b ? b : { n: b })) o[k] = mergeNums(o[k], v); return o; };
// The log keeps numbers only (never names, ids or text).
function numbersOnly(o, out = {}, pre = "") {
  for (const [k, v] of Object.entries(o || {})) { const key = `${pre}${k}`.replace(/[^a-z0-9_.]/gi, "_").slice(0, 60);
    if (typeof v === "number" && Number.isFinite(v)) out[key] = (out[key] || 0) + v; else if (typeof v === "boolean") out[key] = v ? 1 : 0; else if (v && typeof v === "object" && !Array.isArray(v)) numbersOnly(v, out, `${key}.`); else if (Array.isArray(v)) out[key] = (out[key] || 0) + v.length; }
  return out;
}
// One step of a job: skipped when it already finished in an earlier attempt; its counts are kept in the job.
async function step(env, job, name, fn) {
  job.meta.done ||= []; job.meta.counts ||= {};
  if (job.meta.done.includes(name)) return job.meta.counts[name];
  const r = await fn();
  job.meta.done.push(name); if (r !== undefined) job.meta.counts[name] = typeof r === "object" ? numbersOnly(r) : r;
  await jobSave(env, job); return r;
}

// ---------------------------------------------------------------- Hindsight documents ----------------------------------------------------------------
export async function hsForgetDocs(env, bank, docs) {
  if (!hsOn(env) || !bank || !docs.length) return 0;
  await ensureDeletionTables(env);
  for (const d of docs) await env.DB.prepare("INSERT INTO hs_forget (bank,doc,due,tries) VALUES (?,?,?,0) ON CONFLICT(bank,doc) DO UPDATE SET due=excluded.due, tries=0").bind(bank, d, now()).run();
  return hsForgetDue(env, { bank });
}
// Due documents: delete (404 is fine), then schedule the next re-check; after the last one the row goes.
export async function hsForgetDue(env, { bank = null, limit = 200 } = {}) {
  if (!hsOn(env)) return 0; await ensureDeletionTables(env);
  const rows = (await env.DB.prepare(`SELECT * FROM hs_forget WHERE due<=?${bank ? " AND bank=?" : ""} ORDER BY due LIMIT ?`).bind(...(bank ? [now(), bank, limit] : [now(), limit])).all()).results || [];
  let n = 0;
  for (const r of rows) {
    try { n += (await forgetDocument(env, r.bank, r.doc)).deleted; } catch (e) { console.log("hindsight forget", e.message); continue; }   // left due: retried next pass
    const next = Number(r.tries) + 1;
    if (next >= HS_RECHECK.length) await env.DB.prepare("DELETE FROM hs_forget WHERE bank=? AND doc=?").bind(r.bank, r.doc).run();
    else await env.DB.prepare("UPDATE hs_forget SET tries=?, due=? WHERE bank=? AND doc=?").bind(next, now() + HS_RECHECK[next], r.bank, r.doc).run();
  }
  return n;
}

// ---------------------------------------------------------------- R2 ----------------------------------------------------------------
export async function r2DeletePrefix(env, prefix) {
  if (!prefix || !/^t\/[^/]+\//.test(prefix)) throw new Error(`refusing to delete R2 prefix ${prefix}`);   // always inside one tenant
  let n = 0, cursor;
  for (let i = 0; i < 10000; i++) {
    const l = await env.WS.list({ prefix, cursor, limit: 1000 });
    if (l.objects?.length) n += await stDeleteListed(env, l.objects);   // storage.js: the counter goes down with them
    if (!l.truncated) break; cursor = l.cursor;
  }
  return n;
}

// ---------------------------------------------------------------- one chat ----------------------------------------------------------------
// deleteSession(env, tenantId, slug, sessionId) → { ok, kept: [file names used in other chats, kept], counts, pending }.
// pending = a turn of that chat is still finishing; the job stays and the cron deletes whatever it writes.
export async function deleteSession(env, tenantId, slug, sessionId, { reason = "person" } = {}) {
  const sid = String(sessionId), R = resident(env, tenantId, slug);
  const job = await jobStart(env, "session", tenantId, `${slug}/${sid}`, { slug, sid }, reasonOf(reason));
  try {
    // 1. What only the object knows, saved before its rows go: Hindsight items, texted cards (D1).
    const inv = await R.sessionInventory(sid);
    const bank = hsOn(env) ? bankId(env, tenantId, slug) : null;
    job.meta.counts ||= {};
    job.meta.counts.hindsight_docs = (job.meta.counts.hindsight_docs || 0) + inv.hsDocs.length;
    if (bank) await hsForgetDocs(env, bank, inv.hsDocs);
    const d1 = await deleteSessionD1(env, tenantId, slug, sid, inv);
    // 2. The chat itself, inside the channel's object (files out of R2 first).
    const r = await R.deleteSessionData(sid);
    // 3. A task started from a plan in this chat, in another channel, loses its excerpt and its link back here.
    try { for (const c of await archive(env, tenantId).channels()) { const s = c.slug || c.name; if (s !== slug) await resident(env, tenantId, s).forgetOriginOf(sid); } } catch (e) { console.log("forget origin", e.message); }
    const counts = { ...numbersOnly(r.counts), ...d1, hindsight_docs: job.meta.counts.hindsight_docs, kept_files: r.kept.length, removed_from_computer: r.removed_from_computer };
    if (r.live) { job.meta.counts = counts; await jobSave(env, job, "a turn is still finishing"); return { ok: true, pending: true, kept: r.kept, counts }; }
    await jobDone(env, job, "session", tenantId, `${slug}/${sid}`, counts);
    return { ok: true, existed: r.existed || inv.exists, kept: r.kept, counts };
  } catch (e) { await jobSave(env, job, e.message).catch(() => {}); throw e; }
}
async function deleteSessionD1(env, tid, slug, sid, inv) {
  const out = {}, DB = env.DB;
  const delIds = async (where, ids) => { let n = 0; for (let i = 0; i < ids.length; i += 50) { const c = ids.slice(i, i + 50); n += Number((await DB.prepare(`DELETE FROM cards WHERE tenant_id=? AND channel=? AND ${where} IN (${c.map(() => "?").join(",")})`).bind(tid, slug, ...c).run()).meta?.changes || 0); } return n; };
  // Texted cards: card replies (msg_id = the turn), approval cards, plan cards ("plan:<id>:<created>"), interview cards ("interview:<id>").
  out.texted_cards = await delIds("msg_id", inv.turns)
    + await delIds("msg_id", (inv.plans || []).map((p) => `plan:${p.id}:${p.created}`)) + await delIds("msg_id", (inv.interviews || []).map((i) => `interview:${i}`));
  for (let i = 0; i < inv.approvals.length; i += 50) { const c = inv.approvals.slice(i, i + 50); out.texted_cards += Number((await DB.prepare(`DELETE FROM cards WHERE tenant_id=? AND channel=? AND kind='approval' AND approval_id IN (${c.map(() => "?").join(",")})`).bind(tid, slug, ...c).run()).meta?.changes || 0); }
  // Share offers the helper prepared in this chat (share.js): staged page bytes out of R2, then the rows. Its files' share links go
  // in the Resident (they die with the files); a page already PUBLISHED from it stays published (the person manages it in Share).
  out.share_offers = 0;
  for (const o of (await DB.prepare("SELECT id, prefix, status FROM share_offers WHERE tenant_id=? AND channel=? AND session=?").bind(tid, slug, sid).all().catch(() => ({ results: [] }))).results || []) {
    if (o.prefix && o.status !== "accepted" && /^t\/[^/]+\/pages\/[0-9a-f-]{36}$/.test(o.prefix)) await r2DeletePrefix(env, `${o.prefix}/`);
    await DB.prepare("DELETE FROM share_offers WHERE id=?").bind(o.id).run(); out.share_offers++;
  }
  out.router_shadow = Number((await DB.prepare("DELETE FROM router_shadow WHERE tenant_id=? AND channel=? AND session=?").bind(tid, slug, sid).run()).meta?.changes || 0);
  if (env.ENV_NAME === "dev") out.decision_shadow = Number((await DB.prepare("DELETE FROM decision_shadow WHERE tenant_id=? AND channel=? AND session=?").bind(tid, slug, sid).run().catch(() => ({ meta: {} }))).meta?.changes || 0);   // dev only (decision-shadow.js)
  if (env.ENV_NAME === "dev") for (const t of ["router_lab_runs", "router_lab_incumbents"]) out[t] = Number((await DB.prepare(`DELETE FROM ${t} WHERE tenant_id=? AND channel=? AND session=?`).bind(tid, slug, sid).run().catch(() => ({ meta: {} }))).meta?.changes || 0);   // dev only (router-lab.js)
  out.approval_policy = Number((await DB.prepare("DELETE FROM approval_policy WHERE tenant_id=? AND scope='session' AND scope_key=?").bind(tid, `${slug}:${sid}`).run()).meta?.changes || 0);
  // Get to know you: deleting its task removes the answers too (the row stays as "offered once", empty, so it isn't offered again).
  out.interview = Number((await DB.prepare("UPDATE interviews SET status='removed', answers='{}', known='{}', session_id=NULL, updated_at=? WHERE tenant_id=? AND session_id=?").bind(now(), tid, sid).run().catch(() => ({ meta: {} }))).meta?.changes || 0);
  return out;
}

// ---------------------------------------------------------------- one Notebook note ----------------------------------------------------------------
// The note, and its copies in the channel's memory: the ledger rows (and search index) and the Hindsight document retained for it.
export async function deleteNote(env, tenantId, slug, channelId, noteId) {
  const r = await archive(env, tenantId).noteDelete(channelId, noteId);
  const m = await resident(env, tenantId, slug).noteForget(String(noteId));
  if (hsOn(env)) await hsForgetDocs(env, bankId(env, tenantId, slug), m.hsDocs).catch((e) => console.log("note forget", e.message));
  return { ...r, ok: true, memory_rows: m.rows };
}

// ---------------------------------------------------------------- one channel ----------------------------------------------------------------
async function wipeChannelEverywhere(env, job, tid, slug, cid, prefix = "") {
  const A = archive(env, tid), DB = env.DB, k = (n) => `${prefix}${n}`;
  if (cid != null) await step(env, job, k("hide"), () => A.markChannelDeleting(cid));
  await step(env, job, k("schedules"), async () => Number((await DB.prepare("DELETE FROM resident_schedules WHERE tenant_id=? AND channel=?").bind(tid, slug).run()).meta?.changes || 0));
  await step(env, job, k("resident"), async () => { const R = resident(env, tid, slug); await R.bind(tid, slug, String(cid ?? '')); return R.wipeChannel(); });
  if (env.NATIVE_TRANSPORT) await step(env, job, k('native_transport'), () => env.NATIVE_TRANSPORT.get(env.NATIVE_TRANSPORT.idFromName(`${tid}:${slug}`)).wipe({ tenant: tid, channel: slug }));
  await step(env, job, k("computer"), () => ccOf(env, tid, slug).wipe());
  await step(env, job, k("r2"), async () => { let n = 0; for (const p of [`t/${tid}/c/${slug}/`, `t/${tid}/files/${slug}/`, `t/${tid}/shots/${slug}/`]) n += await r2DeletePrefix(env, p); return n; });
  await step(env, job, k("hindsight"), async () => {
    if (!hsOn(env)) return 0;
    const r = await forgetChannel(env, tid, slug);
    await DB.prepare("DELETE FROM hs_forget WHERE bank=?").bind(bankId(env, tid, slug)).run().catch(() => {});
    return r.deleted;
  });
  await step(env, job, k("d1"), async () => {
    const out = {};
    for (const [t, q] of [["resident_schedules", "DELETE FROM resident_schedules WHERE tenant_id=? AND channel=?"], ["texted_cards", "DELETE FROM cards WHERE tenant_id=? AND channel=?"], ["router_shadow", "DELETE FROM router_shadow WHERE tenant_id=? AND channel=?"], ...(env.ENV_NAME === "dev" ? [["decision_shadow", "DELETE FROM decision_shadow WHERE tenant_id=? AND channel=?"], ["router_lab_runs", "DELETE FROM router_lab_runs WHERE tenant_id=? AND channel=?"], ["router_lab_incumbents", "DELETE FROM router_lab_incumbents WHERE tenant_id=? AND channel=?"]] : []),
      ["link_purchases", "DELETE FROM link_purchases WHERE tenant_id=? AND channel=?"], ["approval_policy", "DELETE FROM approval_policy WHERE tenant_id=? AND scope='channel' AND scope_key=?"]])
      out[t] = Number((await DB.prepare(q).bind(tid, slug).run().catch(() => ({ meta: {} }))).meta?.changes || 0);
    // Share links of its files, offers prepared in it, and pages published from it (bytes first, then the row).
    out.share_links = Number((await DB.prepare("DELETE FROM share_links WHERE tenant_id=? AND channel=?").bind(tid, slug).run().catch(() => ({ meta: {} }))).meta?.changes || 0);
    out.published_pages = 0; out.share_offers = 0;
    for (const t of ["share_offers", "published_pages"]) for (const o of (await DB.prepare(`SELECT * FROM ${t} WHERE tenant_id=? AND channel=?`).bind(tid, slug).all().catch(() => ({ results: [] }))).results || []) {
      if (o.prefix && /^t\/[^/]+\/pages\/[0-9a-f-]{36}$/.test(o.prefix)) await r2DeletePrefix(env, `${o.prefix}/`);
      if (t === "share_offers") { await DB.prepare("DELETE FROM share_offers WHERE id=?").bind(o.id).run(); out.share_offers++; }
      else { await DB.prepare("DELETE FROM published_pages WHERE tenant_id=? AND name=?").bind(tid, o.name).run(); out.published_pages++; }
    }
    out.approval_policy += Number((await DB.prepare("DELETE FROM approval_policy WHERE tenant_id=? AND scope='session' AND scope_key LIKE ?").bind(tid, `${slug}:%`).run()).meta?.changes || 0);
    out.jobs = Number((await DB.prepare("DELETE FROM deletion_jobs WHERE kind='session' AND tenant_id=? AND target LIKE ?").bind(tid, `${slug}/%`).run()).meta?.changes || 0);
    return out;
  });
  if (cid != null) await step(env, job, k("archive"), () => A.deleteChannelRows(cid));   // last: the slug stays taken until everything under it is gone
}
// deleteChannel(env, tenantId, slug) → { ok, counts } | { error }. General can't be deleted. Typed confirmation is the route's job.
export async function deleteChannel(env, tenantId, slug, { reason = "person" } = {}) {
  slug = String(slug || "");
  if (!slug || slug === GENERAL) return { error: "General can't be deleted.", status: 400 };
  const A = archive(env, tenantId), row = await A.channelRowAny(slug);
  await ensureDeletionTables(env);
  const pending = await env.DB.prepare("SELECT 1 FROM deletion_jobs WHERE id=?").bind(`channel:${tenantId}:${slug}`).first();
  if (!row && !pending) return { ok: true, already: true };
  const job = await jobStart(env, "channel", tenantId, slug, { slug, cid: row ? String(row.id) : null }, reasonOf(reason));
  // Resumed after its row went, and a NEW channel took the slug since: nothing of the old one is left; never touch the new one.
  if (row && job.meta.cid != null && String(row.id) !== String(job.meta.cid)) { await jobDone(env, job, "channel", tenantId, slug, job.meta.counts || {}); return { ok: true, already: true }; }
  try { await wipeChannelEverywhere(env, job, tenantId, slug, job.meta.cid); }
  catch (e) { await jobSave(env, job, e.message).catch(() => {}); throw e; }
  await jobDone(env, job, "channel", tenantId, slug, job.meta.counts);
  return { ok: true, counts: job.meta.counts };
}

// ---------------------------------------------------------------- the account ----------------------------------------------------------------
// deleteAccount(env, tenantId, { reason }) → { ok, counts }. Everything for the tenant and its owner: every channel (as above),
// Hindsight, Archive, Ledger, the legacy computer, R2 t/<tenant>/, every D1 row (any table with a tenant_id, plus the user, their
// web sessions and sign-in links), saved keys and logins, texting (Photon webhook + number), Composio connections, Link, Stripe
// (an active subscription is canceled now and the customer deleted), the <slug>.1helm.com address. The person is signed out first.
export async function deleteAccount(env, tenantId, { reason = "person" } = {}) {
  await ensureDeletionTables(env);
  const t = await env.DB.prepare("SELECT * FROM tenants WHERE id=?").bind(tenantId).first();
  const pending = await env.DB.prepare("SELECT 1 FROM deletion_jobs WHERE id=?").bind(`account:${tenantId}:`).first();
  if (!t && !pending) return { ok: true, already: true };
  const u = t ? await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(t.owner_user_id).first() : null;
  const job = await jobStart(env, "account", tenantId, "", t ? { user: t.owner_user_id, email: u?.email || "", slug: t.slug, host_ready: Number(t.host_ready || 0), stripe_customer: t.stripe_customer || "", stripe_subscription: t.stripe_subscription || "" } : {}, reasonOf(reason));
  const m = job.meta, DB = env.DB;
  try {
    // Signed out everywhere, and locked (read-only) while the rest runs.
    await step(env, job, "sign_out", async () => {
      if (t) await DB.prepare("UPDATE tenants SET status='deleting', updated_at=? WHERE id=?").bind(now(), tenantId).run();
      return m.user ? Number((await DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(m.user).run()).meta?.changes || 0) : 0;
    });
    // Stop the ambient producer before deleting any of its downstream stores. A failed
    // RPC leaves this resumable step pending; never report account deletion complete
    // while the BeeSync object could still recreate transcripts, facts or extraction rows.
    if (env.BEE_SYNC) await step(env, job, "bee_sync", () => env.BEE_SYNC.get(env.BEE_SYNC.idFromName(tenantId)).wipeAccount(tenantId));
    // Outside services first, while their credentials are still here.
    await step(env, job, "stripe", () => stripeCancel(env, m.stripe_customer, m.stripe_subscription));
    await step(env, job, "composio", () => composioDisconnectAll(env, tenantId));
    await step(env, job, "photon", () => photonUnregister(env, tenantId));
    await step(env, job, "link", async () => { await linkDisconnect(env, tenantId); return 1; });
    await step(env, job, "host", () => releaseHost(env, m.slug, m.host_ready));
    // Every channel: from the Archive, plus any channel object the scheduler knows (a channel row lost earlier still gets wiped).
    if (!m.channels) {
      const chans = await archive(env, tenantId).channels().catch(() => []);
      const sched = ((await DB.prepare("SELECT channel FROM resident_schedules WHERE tenant_id=?").bind(tenantId).all()).results || []).map((r) => r.channel);
      const list = new Map(chans.map((c) => [c.slug || c.name, String(c.id)])); for (const s of sched) if (!list.has(s)) list.set(s, null);
      m.channels = [...list].map(([slug, cid]) => ({ slug, cid })); await jobSave(env, job);
    }
    for (const c of m.channels) await wipeChannelEverywhere(env, job, tenantId, c.slug, null, `ch:${c.slug}:`);   // Archive rows go with the Archive below
    await step(env, job, "hindsight", async () => hsOn(env) ? (await forgetTenant(env, tenantId)).deleted : 0);
    await step(env, job, "archive", () => archive(env, tenantId).wipeArchive());
    await step(env, job, "ledger", () => env.LEDGER.get(env.LEDGER.idFromName(`tenant:${tenantId}`)).wipe());
    await step(env, job, "computer", () => env.COMPUTER ? env.COMPUTER.get(env.COMPUTER.idFromName(`computer:${tenantId}`)).wipe() : 0);
    await step(env, job, "r2", () => r2DeletePrefix(env, `t/${tenantId}/`));
    await step(env, job, "d1", () => deleteTenantD1(env, tenantId, m, job.reason));
  } catch (e) { await jobSave(env, job, e.message).catch(() => {}); throw e; }
  await jobDone(env, job, "account", tenantId, "", m.counts);
  return { ok: true, counts: m.counts };
}
// Every D1 table with a tenant_id column (found from the schema, so tables added later are covered too), then the person.
// Kept: the deletion records, and the payment hold of an unpaid account (pastdue.js: ids, dates and state only, needed for the
// final email and so a late webhook can't start it again; it blanks its own email address once that email is sent).
const KEEP_AFTER = ["deletion_jobs", "deletion_log", "tenants", "payment_holds", "payment_hold_notices"];
async function deleteTenantD1(env, tid, m, reason = "person") {
  const DB = env.DB, out = {};
  const tables = ((await DB.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all()).results || [])
    .filter((r) => /^[a-z][a-z0-9_]*$/i.test(r.name) && !r.name.startsWith("_cf") && /\btenant_id\b/.test(r.sql || "") && !KEEP_AFTER.includes(r.name)).map((r) => r.name);
  for (const t of tables) out[t] = Number((await DB.prepare(`DELETE FROM ${t} WHERE tenant_id=?`).bind(tid).run()).meta?.changes || 0);
  // Deleted some other way while on hold (Delete account): the hold ends here, with no address kept and no emails (pastdue.js).
  if (reason !== "unpaid") out.payment_hold = Number((await DB.prepare("UPDATE payment_holds SET state='deleted', deleted_at=?, email='', slug='', updated_at=? WHERE tenant_id=? AND state IN ('unpaid','paid')").bind(now(), now(), tid).run().catch(() => ({ meta: {} }))).meta?.changes || 0);
  out.hs_forget = Number((await DB.prepare("DELETE FROM hs_forget WHERE bank LIKE ?").bind(`${bankId(env, tid, "x").slice(0, -1)}%`).run().catch(() => ({ meta: {} }))).meta?.changes || 0);
  out.child_jobs = Number((await DB.prepare("DELETE FROM deletion_jobs WHERE tenant_id=? AND kind<>'account'").bind(tid).run()).meta?.changes || 0);
  if (m.user) out.sessions = Number((await DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(m.user).run()).meta?.changes || 0);
  if (m.user) out.email_changes = Number((await DB.prepare("DELETE FROM email_changes WHERE user_id=?").bind(m.user).run().catch(() => ({ meta: {} }))).meta?.changes || 0);   // account.js
  if (m.email) out.magic_links = Number((await DB.prepare("DELETE FROM magic_links WHERE email=?").bind(m.email).run()).meta?.changes || 0);
  if (m.email) out.signin_code_fails = Number((await DB.prepare("DELETE FROM signin_code_fails WHERE email=?").bind(m.email).run().catch(() => ({ meta: {} }))).meta?.changes || 0);   // signin-code.js
  out.tenants = Number((await DB.prepare("DELETE FROM tenants WHERE id=?").bind(tid).run()).meta?.changes || 0);
  // The user goes too, unless (never today: one workspace per person) they still own another workspace.
  if (m.user && !(await DB.prepare("SELECT 1 FROM tenants WHERE owner_user_id=?").bind(m.user).first())) {
    out.users = Number((await DB.prepare("DELETE FROM users WHERE id=?").bind(m.user).run()).meta?.changes || 0);
    // Completing account deletion reopens an intentionally empty self-hosted server.
    await DB.prepare("DELETE FROM single_owner WHERE user_id=?").bind(m.user).run().catch(() => {});
  }
  return out;
}
async function stripeCancel(env, customer, subscription) {
  if (!env.STRIPE_SECRET_KEY || (!customer && !subscription)) return { canceled: 0, customer_deleted: 0 };
  const api = async (path, method = "GET") => { const r = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }); const d = await r.json().catch(() => ({})); if (!r.ok && r.status !== 404) throw new Error(`Stripe ${method} ${path.split("?")[0]}: ${d?.error?.message || r.status}`); return r.ok ? d : null; };
  const ids = new Set(subscription ? [subscription] : []);
  if (customer) for (const s of (await api(`subscriptions?customer=${encodeURIComponent(customer)}&status=all&limit=100`))?.data || []) if (["active", "trialing", "past_due", "unpaid", "incomplete", "paused"].includes(s.status)) ids.add(s.id);
  let canceled = 0;
  for (const id of ids) { const s = await api(`subscriptions/${encodeURIComponent(id)}`); if (s && !["canceled", "incomplete_expired"].includes(s.status)) { await api(`subscriptions/${encodeURIComponent(id)}`, "DELETE"); canceled++; } }
  const del = customer ? await api(`customers/${encodeURIComponent(customer)}`, "DELETE") : null;   // saved cards and customer details; Stripe keeps invoices/charges (legal)
  return { canceled, customer_deleted: del?.deleted ? 1 : 0 };
}
// "If you leave 1Helm, we delete your connections" (Managed): every 1hc:<tenant> connected account is deleted at Composio and the list
// is checked again (composio.js disconnectAllManaged; it throws while Composio still lists one, so the job retries). Runs for every
// workspace whatever its side (a Self-managed one may still have Managed apps from before it switched). Self-managed connections live in
// the person's own Composio account and stay theirs (the onboarding table says so); 1Helm forgets its sign-in to it (and the D1 sweep
// below removes the row too).
async function composioDisconnectAll(env, tid) {
  const n = await disconnectAllManaged(env, tid);
  if (env.DB) await selfSignOut(env, tid).catch(() => 0);
  return n;
}
// The person's own Photon project (BYOP) stays theirs; we remove what we put in it: our webhook and their number.
async function photonUnregister(env, tid) {
  const r = await env.DB.prepare("SELECT * FROM texting WHERE tenant_id=?").bind(tid).first().catch(() => null);
  if (!r?.project_id || !r.project_secret_sealed) return 0;
  let sec; try { sec = await openSecret(env, r.project_secret_sealed); } catch { return 0; }
  const A = { authorization: "Basic " + btoa(`${r.project_id}:${sec}`), accept: "application/json" }, SPEC = "https://spectrum.photon.codes", pid = encodeURIComponent(r.project_id);
  let n = 0;
  const del = async (u) => { const x = await fetch(u, { method: "DELETE", headers: A, signal: AbortSignal.timeout(15000) }); if (x.ok || x.status === 404) n++; else if (x.status >= 500) throw new Error(`Photon DELETE ${x.status}`); };
  if (r.webhook_id) await del(`${SPEC}/projects/${pid}/webhooks/${encodeURIComponent(r.webhook_id)}`);
  try {
    const l = await fetch(`${SPEC}/projects/${pid}/users/`, { headers: A, signal: AbortSignal.timeout(15000) }); const b = await l.json().catch(() => ({}));
    const list = Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : Array.isArray(b?.data?.users) ? b.data.users : Array.isArray(b?.users) ? b.users : [];
    for (const x of list) if (x.phoneNumber === r.phone && x.id) await del(`${SPEC}/projects/${pid}/users/${encodeURIComponent(x.id)}`);
  } catch (e) { console.log("photon user remove", e.message); }
  return n;
}
// Live only: <slug>.1helm.com is a Workers custom domain (index.js claimHost). Dev never creates one.
async function releaseHost(env, slug, ready) {
  if (env.ENV_NAME === "dev" || !ready || !slug || !env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.PUBLIC_BASE_DOMAIN) return 0;
  const H = { authorization: `Bearer ${env.CF_API_TOKEN}` }, base = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/domains`, host = `${slug}.${env.PUBLIC_BASE_DOMAIN}`;
  const l = await (await fetch(`${base}?hostname=${encodeURIComponent(host)}`, { headers: H })).json().catch(() => ({}));
  let n = 0; for (const x of l.result || []) if (x.hostname === host) { await fetch(`${base}/${x.id}`, { method: "DELETE", headers: H }); n++; }
  return n;
}

// ---------------------------------------------------------------- the cron (every 5 min) ----------------------------------------------------------------
// Resume unfinished deletions (not touched for 2 min, so never one that's running right now), then due Hindsight re-checks.
export async function deletionCron(env) {
  await ensureDeletionTables(env);
  const jobs = (await env.DB.prepare("SELECT * FROM deletion_jobs WHERE updated_at<? AND tries<60 ORDER BY updated_at LIMIT 5").bind(now() - 120e3).all()).results || [];
  const out = { resumed: 0, errors: 0, hs: 0 };
  for (const j of jobs) {
    const m = jp(j.meta, {});
    try {
      if (j.kind === "account") await deleteAccount(env, j.tenant_id, { reason: j.reason });
      else if (j.kind === "channel") await deleteChannel(env, j.tenant_id, m.slug || j.target, { reason: j.reason });
      else if (j.kind === "session") await deleteSession(env, j.tenant_id, m.slug, m.sid, { reason: j.reason });
      out.resumed++;
    } catch (e) { out.errors++; console.log("deletion resume", j.kind, e.message); }
  }
  try { out.hs = await hsForgetDue(env); } catch (e) { console.log("hindsight forget due", e.message); }
  return out;
}

// ---------------------------------------------------------------- the app's routes ----------------------------------------------------------------
// POST /api/res/<ch>/sessions/<id>/delete                        delete a chat
// POST /api/channels/<ch>/delete   { confirm: "<channel name>" }  delete a channel (typed confirmation, checked here)
// POST /api/account/delete         { confirm: "delete my account" } delete the account, then signed out (cookie cleared)
// Auth: the caller (index.js) already matched the signed-in user to this workspace (t.owner_user_id === user.id); everything here
// is keyed by that t.id, so one account can never reach another's data. CSRF: the session cookie is SameSite=Lax (no cross-site
// POSTs carry it); on top, these require a JSON body (a cross-site form can't send one without a CORS preflight) and, when the
// browser sends Origin, the same origin. Allowed even when the account is read-only (unpaid): deleting is always possible.
export async function deletionRoute(req, env, t, url, sub) {
  const sm = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/sessions\/([0-9a-f-]{36})\/delete$/), cm = sub.match(/^\/api\/channels\/([a-z0-9][a-z0-9-]{0,62})\/delete$/), am = sub === "/api/account/delete";
  if (!sm && !cm && !am) return null;
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!String(req.headers.get("content-type") || "").includes("application/json")) return json({ error: "Send JSON." }, 415);
  const origin = req.headers.get("origin"); if (origin && origin !== url.origin) return json({ error: "forbidden" }, 403);
  let b;
  try { b = await boundedJson(req, 8192); }
  catch (e) { return json({ error: e instanceof BodyTooLargeError ? "too_large" : "bad_request" }, e instanceof BodyTooLargeError ? 413 : 400); }
  try {
    if (sm) {
      const ch = (await archive(env, t.id).channels()).find((c) => (c.slug || c.name) === sm[1]); if (!ch) return json({ error: "no such channel" }, 404);
      const R = resident(env, t.id, sm[1]); await R.bind(t.id, sm[1], String(ch.id));
      return json(await deleteSession(env, t.id, sm[1], sm[2], { reason: "person" }));
    }
    if (cm) {
      if (cm[1] === GENERAL) return json({ error: "General can't be deleted." }, 400);
      const ch = (await archive(env, t.id).channels()).find((c) => (c.slug || c.name) === cm[1]); if (!ch) return json({ error: "no such channel" }, 404);
      if (!b.confirm || (norm(b.confirm) !== norm(ch.name) && norm(b.confirm) !== norm(cm[1]))) return json({ error: "confirmation_required", need: ch.name }, 400);
      const r = await deleteChannel(env, t.id, cm[1], { reason: "person" }); return json(r, r.error ? r.status || 400 : 200);
    }
    if (norm(b.confirm) !== ACCOUNT_CONFIRM) return json({ error: "confirmation_required", need: ACCOUNT_CONFIRM }, 400);
    const r = await deleteAccount(env, t.id, { reason: "person" });
    return json({ ok: true, redirect: "/", counts: r.counts }, 200, { "set-cookie": "hc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
  } catch (e) {
    console.log("deletion", sub, e.message);
    return json({ error: "Deleting didn't finish. It keeps going on its own in the next few minutes; you can also try again.", retry: true }, 502, am ? { "set-cookie": "hc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" } : {});
  }
}

// Ambient → Bee, live sync (notes/2026-10-07-ambient-bee/SPEC.md §5, §10 step 3). One BeeSync Durable Object per person, named by
// the tenant id. No always-on server and no held connection: a DO alarm (adaptive: see cadence() below) and Sync now run ONE short container job
// (bee.js SYNC_JS on the Computer class as "beejob:<tenant>", the Bee CA pinned, the token on stdin) that reads
// GET /v1/changes?cursor= and the changed conversations, then the container is stopped at once.
//   - A finished conversation (end_time set), with HS_WRITERS on → General's Hindsight bank as its words in chunks, no extraction (hsBeePut, which scrubs secrets),
//     document_id "bee:conv:<id>". Retained again when its updated_at changes (the same document_id replaces it in Hindsight).
//     A conversation Bee no longer has (404) is forgotten (deletion.js hsForgetDocs: re-checked, since retain is async).
//   - Its raw transcript → R2 "t/<tenant>/bee/conv/<id>.json" through storage.js (counts toward the storage cap; the t/<tenant>/
//     prefix also puts it in the storage recount and in account deletion). Never into Hindsight.
//   - Still recording (end_time null): skipped; Bee's change feed lists it again when it finishes.
//   - Facts (§7, step 4) → General's Notebook, never straight into memory (the Notebook is what reaches memory; noteAdd scrubs
//     secrets). Listed in full (both confirmed and pending, every page) on the first run and hourly, and whenever the change feed
//     names a fact. Keyed on bee_fact_id, so nothing is imported twice. confirmed:true → a Notebook note (src "bee", bee_fact_id,
//     sec about / people), shown "From Bee". confirmed:false → the "New from Bee" block (Approve / Edit / Deny). Facts have no
//     updated_at: an edit in the Bee app is found by comparing text / confirmed with the last copy; a fact gone from a complete
//     list is gone from the Notebook too. Our own change still owed to Bee (a failed write-back) wins until it's written.
//     Writes go through the job (bee.js WRITE_CORE): PUT always with the fact's existing tags, DELETE, POST (undo of a delete).
//   - Todos / dailies / journals: ignored.
//   - 401 → bee_accounts.status needs_reconnect, the alarm stops; Reconnect (bee.js verify → start) resumes from the cursor.
//     429 / 5xx / no answer → backoff 5, 10, 20, 40, 60 min (the job itself retries each call 3 times first).
//   - Cost: every run reserves its container time from the account's Ledger first (never on credit, never a negative balance) and
//     settles the measured seconds; every retain reserves its Hindsight cost (byok.js hsRetainNano) the same way. Out of
//     credits / the daily limit / a read-only (unpaid) account → nothing runs, the card says why, the next alarm tries again.
//   - Disconnect: keep (memories and transcripts stay; the cursor goes) or remove (every bee:conv:<id> document in General's bank
//     and every transcript under t/<tenant>/bee/ are deleted, then this DO's storage).
// The token is never stored here (token_ref names the sealed D1 row), never logged, never in an event, never returned.
// Dedicated Ambient extraction additionally stores full transcripts (including recordings in progress) in this tenant's
// provider-neutral store. General retrieves typed items and raw evidence through ambientQuery; spoken words never execute tools.
import { DurableObject } from "cloudflare:workers";
import { tolerantEnv, codeV } from "../do-stub.js";
import { openSecret } from "../sentinel.js";
import { hsOn, bankId, contentHash } from "../hindsight.js";
import { forgetMemoryDocs, ensureDeletionTables, deleteNote } from "../deletion.js";
import { hsNoteNotify, hsWriters, inboxEligible, DOC as HS_DOC } from "../hindsight-writers.js";   // HS_WRITERS: Bee facts saved as Notebook notes reach General's bank (note:<id>)
import { stPut, stDelete, stDeleteListed, StorageFull } from "../storage.js";
import { templateModelCount } from "../hindsight-template.js";
import { METER, hsRetainNano, hsRawNano, HS_REFRESH_WINDOW_MS } from "../byok-meter.js";
import { scrubSecrets } from "../secrets-scrub.js";
import { beeSyncJob, beeFactsJob, beeEvent, JOB_IDLE_MS, SYNC_KILL_MS } from "./bee.js";
import { AmbientStore, ambientLines, ambientLocation } from "./ambient.js";
import { speakersMix } from "./bee-speakers.js";   // HS_ENVELOPE: the new speaker review (one row per speaker per recording)

export const EVERY_MS = 5 * 60e3, MANUAL_GAP_MS = 15e3, MAX_PER_RUN = 25, OVERLAP_MS = 10 * 60e3, STALE_CURSOR_MS = 6 * 86400e3, MAX_BACKOFF_MS = 60 * 60e3;
// The Computer class's "basic" container at cost + 15%, per second (the same formula as index.js COMPUTER_NANO_PER_SEC).
export const JOB_NANO_PER_SEC = Math.ceil((1 * 0.0000025 + 0.25 * 0.000020 + 4 * 0.00000007) * 1e9 * 1.15);
export const JOB_RESERVE_NANO = Math.ceil((SYNC_KILL_MS + 30e3) / 1000 * JOB_NANO_PER_SEC);   // the longest a run can bill
export const RETAIN_MARKUP = 1.15;
// Write-back to Bee (Approve / Edit / Deny, a From-Bee note edited / deleted / restored): the Notebook changes at once and the request
// returns; the write is a row in `facts` (write put|delete|post) sent by the DO alarm (kicked now), retried with backoff
// (WRITE_BACKOFF: 5 s, 10 s, … up to 5 min, on their own due times in the alarm; a sync flushes too). Never an error for a write that will still be retried.
// Stuck (shown on the Ambient Bee card with Retry): a 4xx from Bee WRITE_4XX_TRIES times, or WRITE_MAX_TRIES failures of any kind.
// Waiting for credits / a reconnect doesn't count as a try.
export const WRITE_MAX_TRIES = 8, WRITE_4XX_TRIES = 3;
export const writeBackoff = (tries) => Math.min(5000 * 2 ** Math.max(0, tries - 1), EVERY_MS);
export const GENERAL = "main";
export const docId = (id) => `bee:conv:${id}`;
export const r2Key = (tid, id) => `t/${tid}/bee/conv/${id}.json`;
export const r2Prefix = (tid) => `t/${tid}/bee/`;
export const backoff = (fails) => Math.min(EVERY_MS * 2 ** Math.max(0, fails - 1), MAX_BACKOFF_MS);
// Adaptive cadence (2026-10-08, the Captain): every check is one container cold start (~1.5 s billed, ~$0.000015), so an idle Bee
// at a flat 5 min cost ~$0.14/person/month for nothing. Now:
//   - every 5 min (EVERY_MS) while something is going on: a conversation still recording at the last check, a new / changed /
//     deleted conversation or fact within ACTIVE_MS (60 min), Live notes on (its claim), a Live notes refine waiting for Bee's final
//     transcript (a watch under REFINE_WAIT_MS old), or conversations left to retry;
//   - then, while nothing changes, 10 → 20 → 30 min (IDLE_STEPS_MS), staying at 30;
//   - overnight (00:00–06:00 in Bee's own time zone, from /v1/changes meta.timezone or a conversation's timezone; none known → no
//     night rule) every 60 min, never past 06:00 and never shorter than the idle step;
//   - back to 5 min at the first check that sees anything change. Sync now runs at once; the Ambient card opening (POST /api/bee/check)
//     runs one at once when the last is over 5 min old (cardOpen); Live notes starting brings the next check within 5 min, and a
//     conversation it sees end runs one within seconds (lnEnded: Bee's final read → the auto refine). These are "pokes" (kv poke_at),
//     kept apart from next_at so a run in flight can't overwrite them.
//   - Fact write-backs are on their own due times (writesDueAt) in the same alarm: never held back by a long interval.
// Idle cost: 288 checks/day → 42 (18 h × 2 + 6 h × 1).
export const ACTIVE_MS = 60 * 60e3, IDLE_STEPS_MS = [10 * 60e3, 20 * 60e3, 30 * 60e3], NIGHT_EVERY_MS = 60 * 60e3, NIGHT_END_H = 6;
export const REFINE_WAIT_MS = 2 * 3600e3, ENDED_KICK_MS = 2000, LIVE_CLAIM_MS = 3 * 60e3;
export const validTz = (tz) => { if (typeof tz !== "string" || !tz || tz.length > 64) return false; try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
// ms from t until 06:00 in tz when t is between 00:00 and 06:00 there; 0 otherwise (or no / a bad zone).
export function nightLeft(t, tz) {
  if (!validTz(tz)) return 0;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(t).map((x) => [x.type, Number(x.value)]));
  const h = p.hour % 24; if (!(h < NIGHT_END_H)) return 0;
  return Math.max(0, ((NIGHT_END_H - h) * 3600 - p.minute * 60 - p.second) * 1000);
}
// The wait before the next check. active: why it's busy (null = quiet); idleRuns: quiet checks in a row before this one.
// → {ms, idleRuns (after this one), why}
export function cadence({ t, active, idleRuns = 0, tz = null }) {
  if (active) return { ms: EVERY_MS, idleRuns: 0, why: active };
  const k = Math.max(0, Number(idleRuns) || 0) + 1, step = IDLE_STEPS_MS[Math.min(k, IDLE_STEPS_MS.length) - 1], night = nightLeft(t, tz);
  if (night > 0 && night > step) return { ms: Math.min(NIGHT_EVERY_MS, night), idleRuns: k, why: "night" };
  return { ms: step, idleRuns: k, why: "quiet" };
}
// A job that met a 429/5xx (SYNC_CORE slow {status, retry_ms}): Bee's Retry-After (up to 6 h), else 30 s; 0 when it didn't.
export const SLOW_WAIT_MS = 30e3;
export const slowWait = (r) => !r?.slow ? 0 : Number(r.slow.retry_ms) >= 0 && r.slow.retry_ms != null ? Math.min(6 * 3600e3, Number(r.slow.retry_ms)) : SLOW_WAIT_MS;
const now = () => Date.now();
// Bee times are epoch ms (some older fields seconds): the CLI's normalizeUnixMs.
export const msOf = (v) => typeof v === "number" && Number.isFinite(v) ? (v > 1e12 ? v : v * 1000) : null;
const iso = (v) => { const m = msOf(v); return m == null ? null : new Date(m).toISOString(); };
const usd = (nano) => `$${(Number(nano || 0) / 1e9).toFixed(5)}`;
// The card's money: "$0.31", "$0.04", under a cent "<$0.01".
export const usdShort = (nano) => { const d = Number(nano || 0) / 1e9; return d > 0 && d < 0.005 ? "<$0.01" : `$${d.toFixed(2)}`; };
// Bee's cursor is "v1-<ms>". Stored rewound by 10 min (like the CLI's sync), so a change committed just before the snapshot is
// never missed; reading it twice is harmless (updated_at decides). Another shape is stored as Bee sent it.
export function nextCursor(next, until) {
  const m = /^v1-(\d+)$/.exec(String(next || ""));
  if (m) return `v1-${Math.max(0, Number(m[1]) - OVERLAP_MS)}`;
  if (next) return String(next);
  const u = msOf(until); return u ? `v1-${Math.max(0, u - OVERLAP_MS)}` : null;
}
export const cursorAt = (c) => { const m = /^v1-(\d+)$/.exec(String(c || "")); return m ? Number(m[1]) : null; };
// [from, to] ranges minus the covered ones (both sorted lists of [a, b]).
export function subtractRanges(want, covered) {
  let out = want.map((r) => [...r]);
  for (const [a, b] of covered) out = out.flatMap(([x, y]) => b < x || a > y ? [[x, y]] : [...(a > x ? [[x, a - 1]] : []), ...(b < y ? [[b + 1, y]] : [])]);
  return out;
}
// Merge [from, to] into the covered ranges (sorted, non-overlapping).
export function addRange(list, from, to) {
  if (!(to >= from)) return list;
  const all = [...list, [from, to]].sort((a, b) => a[0] - b[0]), out = [];
  for (const r of all) { const last = out[out.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]); }
  return out;
}
// What counts as the content of a conversation: its transcript lines with HS_WRITERS on (they go to General's bank as raw chunks, hsBeePut), nothing otherwise.
export const beeContentOf = (env, conv) => hsWriters(env) ? ambientLines(conv).map((l) => l.text).join("\n") : "";
// What goes to R2: the raw transcript and the times around it (the summary is in memory already).
export const transcriptDoc = (conv, withSummary = false) => ({ source: "bee", id: conv.id, ...(withSummary ? { short_summary: typeof conv.short_summary === "string" ? conv.short_summary : null, summary: typeof conv.summary === "string" ? conv.summary : null } : {}), start_time: conv.start_time ?? null, end_time: conv.end_time ?? null, updated_at: conv.updated_at ?? null,
  state: conv.state ?? null, device_type: conv.device_type ?? null, timezone: conv.timezone ?? null, primary_location: conv.primary_location ?? null, transcriptions: Array.isArray(conv.transcriptions) ? conv.transcriptions : [] });

// Facts (§7): a full listing at least hourly (plus whenever the change feed names a fact); a write job's longest bill.
export const FACTS_EVERY_MS = 60 * 60e3;
// Backfill: 20 conversations per container job, the next batch 1 s after; seeds (the Captain's first sync, 10-07: 6 conversations,
// 10,125 summary characters, $0.00142 job + retains → ~$0.00024 each at the old meter; ~0.4 s of job time each; the retain part is now priced by hsRetainNano, about $0.0008 each) until this account has its own.
export const BF_BATCH = 20, BF_GAP_MS = 1000, BF_SEED_MS = 700, BF_BATCH_OVERHEAD_MS = 3000;
export const BF_SEED_RETAIN_NANO = Math.ceil(hsRetainNano(1688) * RETAIN_MARKUP);
export const FACTS_RESERVE_NANO = Math.ceil(120 * JOB_NANO_PER_SEC);
// Notebook section for a fact: "people" when it's about someone else (a relation word or a people-ish tag), else "about".
const REL = /\b(wife|husband|partner|girlfriend|boyfriend|fianc[eé]e?|spouse|sister|brother|sibling|mother|father|mom|dad|parents?|son|daughter|kids?|child(ren)?|grand(ma|pa|mother|father|son|daughter)|aunt|uncle|cousin|niece|nephew|friends?|coworkers?|co-workers?|colleagues?|boss|manager|team ?mates?|neighbou?rs?|roommates?|in-laws?)\b/i;
export function factSec(text, first = "", tags = null) {
  if ((tags || []).some((x) => /relationship|people|family|friend|social|contact/i.test(String(x)))) return "people";
  return REL.test(String(text || "")) ? "people" : "about";
}
const factsLine = (fx, fl) => `${(fl?.list || []).length} listed${fl?.complete ? "" : " (partial)"} → ${fx.added} new note${fx.added === 1 ? "" : "s"}, ${fx.edited} edited in Bee, ${fx.removed} removed${fx.relinked ? `, ${fx.relinked} relinked` : ""}, ${fx.pending} waiting for review${fx.owed ? `, ${fx.owed} of ours owed to Bee` : ""}`;

const NOTE = {
  credits: "Out of credits, so syncing is paused. Add credits in Settings → Usage.",
  day: "Today's spending limit is reached, so syncing is paused until tomorrow.",
  readonly: "1Helm is read-only, so syncing is paused.",
  storage: "Your storage is full, so new transcripts aren't saved. Memories still are.",
  down: (ms) => `Bee isn't answering right now. Trying again in ${Math.round(ms / 60e3)} min.`,
  reconnect: "Bee stopped accepting 1Helm's connection. Reconnect to keep syncing.",
};

export class BeeSync extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.env = tolerantEnv(env); this.sql = ctx.storage.sql; this.gen = 0; this._run = null; this._ambientRun = null; this.init(); this.ambient = new AmbientStore(this); const recovery = this.armAmbientRecovery().catch(() => {}); if (ctx.waitUntil) ctx.waitUntil(recovery); }
  init() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS convs (id INTEGER PRIMARY KEY, start_time INTEGER, end_time INTEGER, updated_at INTEGER, retained_at INTEGER, r2_key TEXT, bytes INTEGER NOT NULL DEFAULT 0, chars INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pending (id INTEGER PRIMARY KEY, why TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bf_queue (id INTEGER PRIMARY KEY, start_time INTEGER, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bf_hist (id INTEGER PRIMARY KEY, days INTEGER, at INTEGER, convs INTEGER, took_ms INTEGER, cost_nano INTEGER, outcome TEXT, done INTEGER, total INTEGER);
      CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY, text TEXT NOT NULL, tags TEXT, confirmed INTEGER NOT NULL DEFAULT 0, created_at INTEGER,
        note_id TEXT, state TEXT NOT NULL, write TEXT, tries INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL);`);
    // try_at: when an owed write is next due (null = now); stuck: why it stopped retrying (null = still retried).
    const cols = new Set(this.sql.exec("PRAGMA table_info(facts)").toArray().map((c) => c.name));
    if (!cols.has("try_at")) this.sql.exec("ALTER TABLE facts ADD COLUMN try_at INTEGER");
    if (!cols.has("stuck")) this.sql.exec("ALTER TABLE facts ADD COLUMN stuck TEXT");
  }
  get(k) { return this.sql.exec("SELECT v FROM kv WHERE k=?", k).toArray()[0]?.v; }
  put(k, v) { if (v == null) this.sql.exec("DELETE FROM kv WHERE k=?", k); else this.sql.exec("INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v)); }
  num(k) { return Number(this.get(k) || 0); }
  counters() { try { return JSON.parse(this.get("counters") || "{}"); } catch { return {}; } }
  bump(o) { const c = this.counters(); for (const [k, v] of Object.entries(o)) c[k] = (c[k] || 0) + v; this.put("counters", JSON.stringify(c)); }
  covered() { try { return JSON.parse(this.get("covered") || "[]"); } catch { return []; } }
  convCount() { return Number(this.sql.exec("SELECT COUNT(*) n FROM convs").toArray()[0]?.n || 0); }
  tid() { return this.get("tenant"); }
  ledger() { return this.env.LEDGER.get(this.env.LEDGER.idFromName(`tenant:${this.tid()}`)); }
  bank() { return bankId(this.env, this.tid(), GENERAL); }
  ev(what) { return beeEvent(this.env, this.tid(), what).catch(() => {}); }
  pend(id, why) { this.sql.exec("INSERT INTO pending (id,why,at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET why=excluded.why", id, why, now()); }
  unpend(id) { this.sql.exec("DELETE FROM pending WHERE id=?", id); }
  async arm(at) { const cur = await this.ctx.storage.getAlarm(); if (!cur || at < cur) await this.ctx.storage.setAlarm(at); }
  // When the live sync is next due: its own schedule, or a poke if one is sooner.
  dueAt() { const n = this.num("next_at") || now() + EVERY_MS, p = this.num("poke_at"); return p ? Math.min(n, p) : n; }
  // Run a check by `at` (now + delay) at the latest, whatever the cadence says. Coalesced: the earliest poke wins.
  async poke(why, delay = 0) {
    if (this.get("status") !== "active") return { ok: false };
    const at = now() + Math.max(0, delay), cur = this.num("poke_at");
    if (!cur || at < cur) { this.put("poke_at", at); this.put("poke_why", why); }
    await this.arm(Math.max(now() + 200, Math.min(at, cur || Infinity)));
    return { ok: true, at: this.num("poke_at") };
  }
  // Settings → Ambient opened (POST /api/bee/check): one check at once when the last one is over 5 min old.
  async cardOpen(tenant) {
    if (!this.tid() && tenant) this.put("tenant", tenant);
    if (this.get("status") !== "active" || this._run || now() - this.num("last_run_at") < EVERY_MS) return { poked: false };
    await this.poke("Ambient opened", 0); return { poked: true };
  }
  liveOn(t = now()) { try { const c = JSON.parse(this.get("live_claim") || "null"); return !!c && c.info?.source !== "mic" && t - c.at < LIVE_CLAIM_MS; } catch { return false; } }   // a mic session doesn't need Bee read sooner
  // Why the sync should stay at 5 min, or null. changed / recording: what the run that just finished saw.
  busyWhy(t, { changed = false, recording = false } = {}) {
    if (changed) this.put("change_at", t);
    if (recording) return "a conversation is recording";
    if (this.num("change_at") && t - this.num("change_at") < ACTIVE_MS) return "a change in the last hour";
    if (this.liveOn(t)) return "Live notes on";
    if (Object.values(this.lnWatches()).some((w) => t - (w?.at || 0) < REFINE_WAIT_MS)) return "a Live notes refine waiting";
    if (Number(this.sql.exec("SELECT COUNT(*) n FROM pending WHERE at > ?", t - 86400e3).toArray()[0]?.n || 0)) return "conversations to retry";   // one stuck for a day doesn't hold it at 5 min
    return null;
  }
  // The next check's wait after a successful run (kv every = {ms, why} for /_ops/bee and the event line).
  nextEvery(t, seen) {
    const c = cadence({ t, active: this.busyWhy(t, seen), idleRuns: this.num("idle_runs"), tz: this.get("tz") || null });
    this.put("idle_runs", c.idleRuns); this.put("every", JSON.stringify({ ms: c.ms, why: c.why, at: t })); return c;
  }
  // The card's line, in D1 (bee_accounts) so GET /api/bee and a look-only view read it without waking anything.
  async mirror() {
    await this.env.DB.prepare("UPDATE bee_accounts SET synced_at=?, conv_count=?, sync_note=? WHERE tenant_id=?")
      .bind(this.get("last_sync_at") ? this.num("last_sync_at") : null, this.convCount(), this.get("note") || null, this.tid()).run().catch((e) => console.log("bee mirror", String(e?.message || e).slice(0, 120)));
  }

  // Connected (bee.js verify → 200). Idempotent: an active sync keeps its alarm. A different Bee account starts over (cursor, retries).
  async start(tenant, { beeUser = null } = {}) {
    if (this.get("account_deleted")) return { status: "deleted" };
    this.put("tenant", tenant); this.put("token_ref", `d1:bee_accounts/${tenant}`);
    if (beeUser != null && this.get("bee_user") && this.get("bee_user") !== String(beeUser)) {
      this.put("cursor", null); this.sql.exec("DELETE FROM pending"); await this.ev(`sync: a different Bee account (${beeUser}); starting over from the last 24 hours`);
    }
    if (beeUser != null) this.put("bee_user", beeUser);
    if (!this.get("live_since")) this.put("live_since", now());
    const was = this.get("status");
    if (was !== "active") { this.put("status", "active"); this.put("fails", 0); this.put("note", null); this.put("next_at", now()); this.put("idle_runs", 0); await this.ev(`sync: on (${was ? `was ${was}` : "first time"}); first run now, then every ${EVERY_MS / 60e3} min while there's activity, up to ${IDLE_STEPS_MS.at(-1) / 60e3} min when quiet`); await this.arm(now() + 1000); }
    else await this.arm(Math.max(now() + 1000, this.dueAt()));   // already on: just make sure an alarm is set
    return this.status();
  }
  // Sync now: runs at once (one run at a time; a run that just happened counts).
  async syncNow(tenant) {
    if (!this.tid() && tenant) this.put("tenant", tenant);
    if (this.get("status") !== "active") return { ...this.status(), ran: false };
    if (this._run) { await this._run; return { ...this.status(), ran: true }; }
    if (now() - this.num("last_run_at") < MANUAL_GAP_MS) return { ...this.status(), ran: false };
    await this.runOnce("sync now");
    if (this.get("status") === "active") await this.ctx.storage.setAlarm(Math.max(now() + 500, Math.min(this.bf()?.status === "running" ? now() + BF_GAP_MS : Infinity, this.dueAt(), this.writesDueAt())));
    return { ...this.status(), ran: true };
  }
  async alarm() {
    if (this.get("account_deleted")) return;
    if (this.get("remove_r2") === "1") { await this.removeTranscripts().catch(() => {}); if (this.get("remove_r2") === "1") { await this.ctx.storage.setAlarm(now() + 60e3); return; } }
    // Write-backs owed to Bee first (a person just tapped Approve / Deny / saved a note): one short job, before any sync or import batch.
    if (this.owedWrites().length) await this.flushWrites().catch((e) => console.log("bee fact writes", String(e?.message || e).slice(0, 120)));
    // The live sync when it's due (its cadence, a backoff, or a poke), then one backfill batch when an import is running.
    if (this.get("status") === "active" && now() >= Math.min(this.num("next_at") || 0, this.num("poke_at") || Infinity) - 2000) {
      const poked = this.num("poke_at") && now() >= this.num("poke_at") - 2000 && now() < (this.num("next_at") || 0) - 2000;
      await this.runOnce(poked ? this.get("poke_why") || "poked" : "scheduled");
    }
    if (this.bf()?.status === "running") await this.bfStep().catch(async (e) => { await this.ev(`backfill step failed: ${String(e?.message || e).slice(0, 160)}`); });
    if (this.ambient.running()) await this.ambientRun();
    await this.hsInboxSync().catch((e) => console.log("bee inbox memory", String(e?.message || e).slice(0, 120)));   // HS_WRITERS: confirmed inbox items → General's bank
    const bfNext = this.bf()?.status === "running" ? now() + BF_GAP_MS : Infinity, liveNext = this.get("status") === "active" ? Math.max(now() + 1000, this.dueAt()) : Infinity;
    const at = Math.min(bfNext, liveNext, this.writesDueAt(), this.ambient.running() ? this.ambient.dueAt() : Infinity); if (at < Infinity) await this.ctx.storage.setAlarm(Math.max(at, now() + 500));
  }
  ambientQuery(args = {}) { return this.ambient.query(args); }
  async armAmbientRecovery() { if (this.get("ambient_recovery_arm") === "1" && this.ambient.running()) { await this.arm(now() + 1000); this.put("ambient_recovery_arm", null); } }
  async ambientStatus() { await this.armAmbientRecovery(); return { ...this.ambient.query({ limit: 1 }).coverage, worker_version: codeV(this.env), counters: this.counters(), diagnostic: (() => { try { return JSON.parse(this.get("ambient_error") || "null"); } catch { return null; } })() }; }
  async ambientReindex(tenant) {
    if (this.get("account_deleted") || this.tid() !== tenant) throw new Error("ambient history unavailable");
    this.put("ambient_indexing", "1"); await this.arm(now() + 1000); return this.ambientQuery();
  }
  async ambientRetrySource(tenant, sourceId) {
    if (this.env.ENV_NAME !== "dev" || this.env.TEST_MODE !== "1" || this.get("account_deleted") || this.tid() !== tenant || !/^[1-9]\d{0,19}$/.test(String(sourceId))) throw new Error("ambient source retry unavailable");
    // Let an existing batch settle before replacing its projection; never race
    // a model response or orphan the durable reservation owned by that batch.
    if (this._ambientRun) await this._ambientRun;
    if (this.get("account_deleted") || this.tid() !== tenant) throw new Error("ambient history unavailable");
    const result = this.ambient.retrySource("bee", sourceId);
    if (result.found) { this.put("ambient_indexing", "1"); await this.arm(now() + 1000); }
    return result;
  }
  ambientRun(fixture = false) {
    if (!this._ambientRun) this._ambientRun = this.ambient.run(fixture).finally(() => { this._ambientRun = null; });
    return this._ambientRun;
  }
  // Internal RPC; the dev-only HTTP caller additionally checks ops key and example.com ownership.
  async ambientFixture(tenant, conv) {
    if (this.env.ENV_NAME !== "dev" || this.env.TEST_MODE !== "1" || this.get("account_deleted")) throw new Error("fixture unavailable");
    if (this.tid() && this.tid() !== tenant) throw new Error("tenant mismatch");
    const row = await this.env.DB.prepare("SELECT u.email FROM tenants t JOIN users u ON u.id=t.owner_user_id WHERE t.id=?").bind(tenant).first();
    if (!/^[^@]+@example\.com$/i.test(row?.email || "")) throw new Error("test accounts only");
    if (!this.tid()) this.put("tenant", tenant);
    await this.ambient.ingest("fixture", conv.id, conv); await this.ambientRun(true); return this.ambientQuery({ limit: 50 });
  }
  // Dev acceptance only (same gate as ambientFixture): a synthetic Bee conversation with any id, stored the way a real sync stores one: the raw
  // transcript in R2 (transcriptDoc), the convs row, and the General memory write with the speaker review rows, so Confirm's re-retain
  // from the stored transcript (speakerRetain) runs for real. The route (ambient-test.js) checks the request, and this checks the account.
  async testGuard(tenant) {
    if (this.env.ENV_NAME !== "dev" || this.env.TEST_MODE !== "1" || this.get("account_deleted")) throw new Error("fixture unavailable");
    if (this.tid() && this.tid() !== tenant) throw new Error("tenant mismatch");
    const row = await this.env.DB.prepare("SELECT u.email FROM tenants t JOIN users u ON u.id=t.owner_user_id WHERE t.id=?").bind(tenant).first();
    if (!/^[^@]+@example\.com$/i.test(row?.email || "")) throw new Error("test accounts only");
    if (!this.tid()) this.put("tenant", tenant);
  }
  async testConvPut(tenant, conv) {
    await this.testGuard(tenant);
    const env = this.env, tid = this.tid(), id = Number(conv?.id); if (!Number.isSafeInteger(id) || id <= 0) throw new Error("conversation id must be a positive integer");
    const body = JSON.stringify(transcriptDoc(conv, hsWriters(env))), key = r2Key(tid, id), bytes = new TextEncoder().encode(body).byteLength;
    await stPut(env, key, body, { httpMetadata: { contentType: "application/json" } }, { check: true, replace: true });
    // The same step the real sync takes (above): an earlier clear of this document left delayed deletes (hs_forget, after 2 min, 10 min, 30 min and 2 h) that would remove it again.
    await ensureDeletionTables(env); await env.DB.prepare("DELETE FROM hs_forget WHERE bank=? AND doc=?").bind(this.bank(), docId(id)).run();
    const r = await this.hsBeePut(conv), chars = beeContentOf(env, conv).length;
    this.sql.exec(`INSERT INTO convs (id,start_time,end_time,updated_at,retained_at,r2_key,bytes,chars,at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      start_time=excluded.start_time,end_time=excluded.end_time,updated_at=excluded.updated_at,retained_at=excluded.retained_at,r2_key=excluded.r2_key,bytes=excluded.bytes,chars=excluded.chars,at=excluded.at`,
      id, msOf(conv.start_time), msOf(conv.end_time), conv.updated_at ?? null, now(), key, bytes, chars, now());
    return { ...(r || {}), conversation: id, r2_key: key, stored: { convs: true, r2: true }, speakers: this.pendingSpeakers().filter((x) => String(x.rec) === String(id)).length };
  }
  // The two calls below run General's Resident inside this object. A Durable Object stub cannot be returned to the caller over RPC
  // (DataCloneError: "Proxy could not be serialized"), so the dev test route (ambient-test.js) must never call hsGeneral() itself.
  async testHsSearch(tenant, args) {
    await this.testGuard(tenant);
    const R = await this.hsGeneral(), r = await R.localTool("ambient_query", args, {});
    return typeof r === "string" ? JSON.parse(r) : r;
  }
  async testHsDrop(tenant, docs) {
    await this.testGuard(tenant);
    return (await this.hsGeneral()).hsDrop(docs);
  }
  // The same conversations removed again: General's memory document, the convs row, the speaker rows and the transcript.
  async testConvClear(tenant, ids) {
    await this.testGuard(tenant); const out = { removed: 0 };
    for (const raw of ids) {
      const id = Number(raw); if (!Number.isSafeInteger(id) || id <= 0) continue;
      const row = this.sql.exec("SELECT r2_key FROM convs WHERE id=?", id).toArray()[0];
      try { await (await this.hsGeneral()).hsDrop([docId(id)]); } catch (e) { console.log("test conv clear", String(e?.message || e).slice(0, 120)); }
      await stDelete(this.env, [row?.r2_key || r2Key(this.tid(), id)]).catch(() => {});
      this.sql.exec("DELETE FROM convs WHERE id=?", id); try { this.spkInit(); this.sql.exec("DELETE FROM speakers WHERE rec=?", String(id)); } catch {}
      out.removed++;
    }
    return out;
  }
  async ambientFixtureClear() { const rows = this.ambient.rows("SELECT source_id FROM ambient_sources WHERE source='fixture'"); for (const row of rows) this.ambient.remove("fixture", row.source_id); return { removed: rows.length }; }
  async wipeAccount(tenant) {
    if (this.tid() && this.tid() !== tenant) throw new Error("tenant mismatch");
    this.gen++; this.put("status", "stopped"); this.put("account_deleted", "1");
    await this.ctx.storage.deleteAlarm();
    if (this._run) await this._run.catch(() => {});
    if (this._ambientRun) await this._ambientRun.catch(() => {});
    await this.ambient.releaseAttempts();
    await this.ctx.storage.deleteAll(); this.init(); this.ambient = new AmbientStore(this); this.put("account_deleted", "1");
    return { deleted: true };
  }
  runOnce(why) {
    if (!this._run) this._run = this.run(why).catch(async (e) => {
      const fails = this.num("fails") + 1, wait = backoff(fails);
      this.put("fails", fails); this.put("next_at", now() + wait); this.put("note", NOTE.down(wait));
      await this.ev(`sync (${why}) failed: ${String(e?.message || e).slice(0, 160)}; next try in ${Math.round(wait / 60e3)} min`); await this.mirror();
    }).finally(() => { this._run = null; });
    return this._run;
  }

  async run(why) {
    const env = this.env, tid = this.tid(), gen = this.gen, t0 = now();
    if (!tid) { this.put("status", "stopped"); return; }
    this.put("last_run_at", t0); this.put("next_at", t0 + EVERY_MS); this.put("poke_at", null); this.put("poke_why", null);   // a poke made from here on runs again after
    const a = await env.DB.prepare("SELECT * FROM bee_accounts WHERE tenant_id=?").bind(tid).first();
    if (!a) { this.put("status", "stopped"); await this.ev("sync: stopped (not connected)"); return; }
    if (a.status === "needs_reconnect") { this.put("status", "needs_reconnect"); this.put("note", NOTE.reconnect); await this.mirror(); return; }
    if (a.status !== "connected") { this.put("next_at", t0 + 60e3); return; }   // still checking /v1/me
    const t = await env.DB.prepare("SELECT status FROM tenants WHERE id=?").bind(tid).first();
    if (t?.status !== "active") { this.put("note", NOTE.readonly); await this.mirror(); await this.ev(`sync (${why}): skipped, the account is ${t?.status || "gone"} (read-only)`); return; }

    // The container time, reserved first (never on credit).
    const L = this.ledger(), jobId = `bee-sync:${crypto.randomUUID()}`;
    let held = null; try { held = await L.reserve(jobId, JOB_RESERVE_NANO); } catch (e) { held = { ok: false, reason: String(e?.message || e).slice(0, 80) }; }
    if (!held?.ok) { this.put("note", held?.reason === "day_limit" ? NOTE.day : NOTE.credits); await this.mirror(); await this.ev(`sync (${why}): skipped, ${held?.reason || "no reservation"}`); return; }

    // A long pause (a cursor over 6 days old, or one Bee refuses): the CLI's fallback full crawl. The job walks the conversation list
    // from the old cursor's time (gap_from; kept until a walk completes) and the finished ones not ingested yet are queued (pending).
    let cursor = this.get("cursor") || null, gap = this.num("gap_from") || null;
    const cAt = cursorAt(cursor) ?? (this.num("cursor_at") || null);
    if (cursor && cAt && t0 - cAt > STALE_CURSOR_MS) { gap = gap ?? cAt; this.put("gap_from", gap); await this.ev(`sync: the saved cursor is over 6 days old; catching up on every conversation since ${iso(gap)}`); cursor = null; }
    const retry = [...new Set([...this.ambient.liveIds(), ...this.sql.exec("SELECT id FROM pending ORDER BY at LIMIT 100").toArray().map((r) => Number(r.id))])];
    let token = await openSecret(env, a.token_sealed), r;
    const factsMode = t0 - this.num("facts_at") > FACTS_EVERY_MS ? "all" : "changed";
    try { r = await beeSyncJob(env, tid, token, { cursor, ids: retry, max: MAX_PER_RUN, facts: factsMode, ...(gap != null ? { catchup: gap } : cursor ? { cursor_at: cAt || this.num("live_since") || 0 } : {}) }); }
    catch (e) { r = { status: 0, error: String(e?.message || e).slice(0, 120), ms: 0 }; }
    finally { token = null; }
    const billMs = Number(r?.ms || 0) + (r?.stopped === false ? JOB_IDLE_MS : 0);
    const jobNano = Math.min(JOB_RESERVE_NANO, Math.ceil(billMs / 1000 * JOB_NANO_PER_SEC));
    await L.settle(jobId, jobNano).catch((e) => console.log("bee sync settle", String(e?.message || e).slice(0, 120)));
    this.bump({ runs: 1, job_ms: Number(r?.ms || 0), cost_nano: jobNano });
    const timing = `job ${r?.ms ?? 0}ms${r?.cold ? " (cold start)" : ""}`;

    if (r?.status === 401) {
      await env.DB.prepare("UPDATE bee_accounts SET status='needs_reconnect', checked_at=?, last_error=? WHERE tenant_id=?").bind(now(), "Bee said 401 (sync)", tid).run();
      this.put("status", "needs_reconnect"); this.put("note", NOTE.reconnect); await this.mirror();
      await this.ev(`sync (${why}): Bee said 401, ${timing}: needs reconnect; syncing stops until Reconnect`); return;
    }
    if (r?.status !== 200) {
      const fails = this.num("fails") + 1, wait = Math.max(backoff(fails), slowWait(r));   // at least what Bee's Retry-After asked
      this.put("fails", fails); this.put("next_at", now() + wait); this.put("note", NOTE.down(wait)); await this.mirror();
      await this.ev(`sync (${why}) failed: ${r?.status ? `Bee answered ${r.status}` : r?.error || "no answer"}, ${timing}; next try in ${Math.round(wait / 60e3)} min`); return;
    }
    if (this.gen !== gen) return;   // disconnected while the job ran: nothing more is written

    const n = { new: 0, updated: 0, same: 0, live: 0, gone: 0, failed: 0, waiting: 0 };
    const st = { L, bank: this.bank(), hsOk: hsOn(env), storageFull: false, creditsOut: null, retainNano: 0, retainChars: 0 };
    for (const c of r.convs || []) {
      if (this.gen !== gen) return;
      const k = await this.ingestOne(c, st); if (k) n[k]++;
    }
    let { storageFull, creditsOut, retainNano } = st;
    for (const id of r.more || []) { this.pend(Number(id), "next run"); n.waiting++; }
    let fx = null;
    if (r.facts?.status === 200 && (r.facts.complete || r.facts.list?.length)) { try { fx = await this.applyFacts(r.facts, gen); if (r.facts.complete && this.gen === gen) { this.put("facts_at", this.get("facts_relink") ? null : now()); this.put("facts_relink", null); } } catch (e) { fx = { error: String(e?.message || e).slice(0, 120) }; } }
    if (this.gen !== gen) return;
    if (this.owedWrites().length) await this.flushWrites().catch((e) => console.log("bee fact writes", String(e?.message || e).slice(0, 120)));
    this.bump({ retained: n.new + n.updated, re_retained: n.updated, forgotten: n.gone, cost_nano: retainNano });

    // The cursor moves on: anything not done is in `pending`, retried by id next run.
    const ch = r.changes || {}, next = nextCursor(ch.next_cursor, ch.until);
    if (next) { this.put("cursor", next); this.put("cursor_at", now()); }
    let since = msOf(ch.since) ?? (cursor ? cursorAt(cursor) : null) ?? t0 - 86400e3;
    const until = msOf(ch.until) ?? t0;
    // The catch-up: queue every finished conversation since the gap that isn't in memory yet; the ones over MAX_PER_RUN go 25 a run.
    let queued = 0;
    if (r.reset && !r.catchup) { gap = gap ?? (cAt || this.num("live_since") || 0); this.put("gap_from", gap); }   // the walk didn't run: next run
    if (r.catchup) {
      const have = new Set(this.sql.exec("SELECT id FROM convs").toArray().map((x) => Number(x.id))), waiting = new Set(this.sql.exec("SELECT id FROM pending").toArray().map((x) => Number(x.id)));
      for (const c of r.catchup.items || []) { const id = Number(c.id); if (id > 0 && !have.has(id) && !waiting.has(id)) { this.pend(id, "catch-up"); queued++; } }
      const done = Array.isArray(r.catchup.items) && !!r.catchup.complete;
      if (done) { this.put("gap_from", null); since = Math.min(since, r.catchup.from); } else this.put("gap_from", r.catchup.from);
      await this.ev(`sync: ${r.reset ? "Bee refused the saved cursor; " : ""}catch-up since ${iso(r.catchup.from)}: ${!Array.isArray(r.catchup.items) ? `the list couldn't be read (${r.catchup.status ? `Bee answered ${r.catchup.status}` : r.catchup.error || "no answer"}); trying again next run` : `${(r.catchup.items || []).length} finished conversation${(r.catchup.items || []).length === 1 ? "" : "s"} in ${r.catchup.pages} page${r.catchup.pages === 1 ? "" : "s"}, ${queued} queued${done ? "" : " (list not complete; again next run)"}`}`);
    } else if (r.reset) await this.ev("sync: Bee refused the saved cursor; catching up next run");
    this.put("covered", JSON.stringify(addRange(this.covered(), since, until)));
    this.put("last_sync_at", now()); this.put("fails", 0);
    this.put("note", creditsOut ? (creditsOut === "day_limit" ? NOTE.day : NOTE.credits) : storageFull ? NOTE.storage : null);
    // Bee's own time zone, for the overnight rule (the change feed's meta.timezone, else a conversation's).
    const tz = [ch.timezone, ...(r.convs || []).map((c) => c?.conv?.timezone)].find(validTz); if (tz && tz !== this.get("tz")) this.put("tz", tz);
    // The cadence: 5 min while anything happens, 10 → 20 → 30 min (60 overnight) while nothing does.
    const changed = n.new + n.updated + n.gone + queued > 0 || !!(fx && !fx.error && (fx.added || fx.edited || fx.removed));
    const cad = this.nextEvery(now(), { changed, recording: n.live > 0 });
    // More than one run's worth (or a catch-up queued): the next one in a minute; Bee asked to wait (429/5xx): at least that long.
    this.put("next_at", now() + (r.slow ? Math.max(cad.ms, slowWait(r)) : ((r.more || []).length || queued) && !creditsOut ? 60e3 : cad.ms));
    await this.mirror();
    const left = Number(this.sql.exec("SELECT COUNT(*) n FROM pending").toArray()[0]?.n || 0);
    await this.ev(`sync (${why}): ${ch.conversations ?? 0} changed conversation${ch.conversations === 1 ? "" : "s"} (${(r.convs || []).length} read) → ${n.new} new, ${n.updated} updated, ${n.same} unchanged, ${n.live} still recording, ${n.gone} deleted, ${n.failed} failed; ${left} to retry; ${timing}; ${usd(jobNano + retainNano)}${storageFull ? "; storage full: transcripts not saved" : ""}${creditsOut ? `; ${creditsOut}: the rest waits` : ""}${fx ? `; facts: ${fx.error ? `not read (${fx.error})` : factsLine(fx, r.facts)}` : ""}; next check in ${Math.round((this.num("next_at") - now()) / 60e3)} min (${cad.why})`);
  }

  // One conversation from Bee (a sync's or a backfill's) → R2 + General's memory, each cost reserved first.
  // → "gone" | "failed" | "live" | "same" | "waiting" | "new" | "updated" (null: not a conversation id).
  async ingestOne(c, st) {
    const env = this.env, tid = this.tid(), id = Number(c.id); if (!(id > 0)) return null;
    const row = this.sql.exec("SELECT * FROM convs WHERE id=?", id).toArray()[0];
    if (c.status === 404) {   // deleted in Bee
      this.ambient.remove("bee", id);
      this.unpend(id);
      await stDelete(env, [row?.r2_key || r2Key(tid, id)]); // ongoing captures also have raw objects, before a finished convs row exists
      if (row) { await forgetMemoryDocs(env, tid, GENERAL, [docId(id)], { hindsight: st.hsOk }); this.sql.exec("DELETE FROM convs WHERE id=?", id); try { this.spkInit(); this.sql.exec("DELETE FROM speakers WHERE rec=?", String(id)); } catch {} return "gone"; }
      return null;
    }
    if (c.status !== 200 || !c.conv) { this.pend(id, `Bee answered ${c.status || c.error || "nothing"}`); return "failed"; }
    const conv = c.conv;
    // Capture the actual speech before the older finished-summary path. Ongoing recordings remain useful all day.
    // Persist and validate every transcript revision, even when Bee's updated_at has not changed.
    let bytes = row?.bytes || 0, key = row?.r2_key || null, rawOk = true;
    try {
      await this.ambient.ingest("bee", id, conv, async () => {
        const body = JSON.stringify(transcriptDoc(conv, hsWriters(env)));   // HS_WRITERS: the summary stays with the transcript, so a rebuild can put it in the context
        await stPut(env, r2Key(tid, id), body, { httpMetadata: { contentType: "application/json" } }, { check: true, replace: true });
        bytes = new TextEncoder().encode(body).byteLength;
      });
      key = r2Key(tid, id);
    } catch (e) {
      rawOk = false; this.pend(id, "ambient transcript not saved");
      if (e instanceof StorageFull || e?.name === "StorageFull") {
        st.storageFull = true; this.put("ambient_note", "Storage is full; some recordings are waiting to be saved and processed");
        this.ambient.remove("bee", id); await this.ambient.ingest("bee", id, { ...conv, primary_location: null, transcriptions: [] });
      } else return "failed";
    }
    if (conv.end_time == null) { if (rawOk) this.unpend(id); return rawOk ? "live" : "failed"; }
    await this.lnNotify(conv).catch((e) => console.log("bee live notes notify", String(e?.message || e).slice(0, 120)));   // Live notes' auto refine (§9.5)
    if (row && row.updated_at === (conv.updated_at ?? null) && (row.retained_at || !beeContentOf(env, conv))) { if (rawOk) this.unpend(id); return rawOk ? "same" : "failed"; }
    if (st.creditsOut) { this.pend(id, "waiting for credits"); return "waiting"; }
    // Raw storage admission above applies to finished and ongoing recordings alike.
    // 2. the summary → General's memory, reserved first
    const item = { content: beeContentOf(env, conv) }; let retainedAt = row?.retained_at || null;
    if (item.content && st.hsOk) {
      // The refresh runs of a new window (3 models in General) are charged only when the last charged window ended (src/byok.js hs_refresh_run), as for any retained text.
      // Bee option A: the words go in as chunks with no model call, so the rest of the price is the chunk facts' consolidation (hsRawNano, about 60 characters of time and
      // speaker per line on top of the words).
      const win = await this.hsRefreshTake(), models = win.models;
      const cost = Math.ceil((hsRawNano(item.content.length + 60 * item.content.split("\n").length) + models * METER.hs_refresh_run) * RETAIN_MARKUP), rid = `bee-retain:${crypto.randomUUID()}`;
      let h = null; try { h = await st.L.reserve(rid, cost); } catch (e) { h = { ok: false, reason: "ledger" }; }
      if (!h?.ok) { await this.hsRefreshGive(win); st.creditsOut = h?.reason || "out_of_credits"; this.pend(id, "waiting for credits"); return "waiting"; }
      try {
        await ensureDeletionTables(env); await env.DB.prepare("DELETE FROM hs_forget WHERE bank=? AND doc=?").bind(st.bank, docId(id)).run();   // an old removal mustn't delete it again
        await this.hsBeePut(conv);   // the transcript as raw text chunks (bee:conv:<id>, strategy raw-transcript), through General's Resident
      } catch (e) { await st.L.settle(rid, 0).catch(() => {}); await this.hsRefreshGive(win); this.pend(id, "memory not saved"); console.log("bee retain", String(e?.message || e).slice(0, 160)); return "failed"; }
      await st.L.settle(rid, cost).catch(() => {}); st.retainNano += cost; st.retainChars += item.content.length; retainedAt = now();
      this.bump({ retain_n: 1, retain_nano: cost });
    }
    this.sql.exec(`INSERT INTO convs (id,start_time,end_time,updated_at,retained_at,r2_key,bytes,chars,at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      start_time=excluded.start_time,end_time=excluded.end_time,updated_at=excluded.updated_at,retained_at=excluded.retained_at,r2_key=excluded.r2_key,bytes=excluded.bytes,chars=excluded.chars,at=excluded.at`,
      id, msOf(conv.start_time), msOf(conv.end_time), conv.updated_at ?? null, retainedAt, key, bytes, item.content.length, now());
    if (rawOk) this.unpend(id);
    return row ? "updated" : "new";
  }

  // ---------------- Backfill (§6): import past conversations ----------------
  // State in this DO (survives deploys and restarts): kv "bf" {days, from, to, status ready|running|paused|done|cancelled, total, done,
  // failed, active_ms, resumed_at, cost_nano, est_nano, est_ms, reason}, the queue bf_queue (id, start_time, state todo|done|fail) and
  // the history bf_hist. Pre-count: list calls only (SYNC_CORE only:"list"); the queue = finished conversations that started in
  // [now−N days, now] minus the ranges already covered (live sync, earlier backfills), minus every id already ingested. The run takes
  // the newest BF_BATCH at a time in ONE container job (only:"convs", the container kept warm between batches and stopped after the
  // last), each conversation the same as a sync (ingestOne: R2 + retain, reserved first), checkpointed after every item. The DO alarm
  // drives it between the live syncs, which keep running (both use the same beejob container, one job at a time).
  bf() { try { return JSON.parse(this.get("bf") || "null"); } catch { return null; } }
  setBf(o) { this.put("bf", o ? JSON.stringify(o) : null); }
  bfCount(state) { return Number(this.sql.exec("SELECT COUNT(*) n FROM bf_queue" + (state ? " WHERE state=?" : ""), ...(state ? [state] : [])).toArray()[0]?.n || 0); }
  // Measured cost and time per conversation: this account's own retains (average summary length × the meter) + the container
  // seconds; seeded from the Captain's first sync until there are 3.
  perConv() {
    const c = this.counters(), rows = this.sql.exec("SELECT COUNT(*) n, AVG(chars) a FROM convs WHERE retained_at IS NOT NULL").toArray()[0] || {};
    const retain = c.retain_n >= 3 ? c.retain_nano / c.retain_n : Number(rows.n) >= 3 ? hsRetainNano(Number(rows.a)) * RETAIN_MARKUP : BF_SEED_RETAIN_NANO;
    const b = this.bf(), ms = b?.done >= 10 && b.active_ms ? b.active_ms / b.done : BF_SEED_MS;
    return { nano: Math.ceil(retain + ms / 1000 * JOB_NANO_PER_SEC), ms };
  }
  async backfill(tenant, op, days = 30) {
    if (!this.tid() && tenant) this.put("tenant", tenant);
    const b = this.bf();
    if (op === "count") {
      if (b && (b.status === "running" || b.status === "paused")) return { error: "An import is already going. Cancel it first." };
      return this.bfCount_(Number(days) || 0);
    }
    if (op === "skip") { if (b?.status === "ready") this.setBf(null); this.sql.exec("DELETE FROM bf_queue"); this.put("bf_offer", "answered"); await this.ev("backfill: skipped"); return {}; }
    if (!b) return { error: "Nothing to import yet." };
    if (op === "start" && b.status === "ready") {
      if (!b.total) { this.setBf(null); return { error: "Nothing new to import from that range." }; }
      this.setBf({ ...b, status: "running", started_at: now(), resumed_at: now(), active_ms: 0, reason: null }); this.put("bf_offer", "answered");
      await this.ev(`backfill: started (${b.days ? `last ${b.days} days` : "all"}, ${b.total} conversation${b.total === 1 ? "" : "s"}, est ${usd(b.est_nano)})`); await this.arm(now() + 500); return {};
    }
    if (op === "pause" && b.status === "running") { this.setBf({ ...b, status: "paused", active_ms: b.active_ms + (now() - (b.resumed_at || now())), resumed_at: null, reason: null }); await this.ev(`backfill: paused at ${b.done} of ${b.total}`); return {}; }
    if (op === "resume" && b.status === "paused") { this.setBf({ ...b, status: "running", resumed_at: now(), reason: null }); await this.ev(`backfill: resumed at ${b.done} of ${b.total}`); await this.arm(now() + 500); return {}; }
    if (op === "cancel" && ["ready", "running", "paused"].includes(b.status)) {
      if (b.status === "ready") { this.setBf(null); this.sql.exec("DELETE FROM bf_queue"); return {}; }
      return this.bfEnd("cancelled");
    }
    return { error: "That can't be done right now." };
  }
  async bfCount_(days, dry = false) {
    const env = this.env, tid = this.tid(), to = now(), from = days ? to - days * 86400e3 : 0;
    const a = await env.DB.prepare("SELECT status, token_sealed FROM bee_accounts WHERE tenant_id=?").bind(tid).first();
    if (!a || a.status !== "connected") return { error: "Bee isn't connected." };
    const L = this.ledger(), jobId = `bee-count:${crypto.randomUUID()}`;
    let held = null; try { held = await L.reserve(jobId, JOB_RESERVE_NANO); } catch { held = { ok: false }; }
    if (!held?.ok) return { error: held?.reason === "day_limit" ? NOTE.day : NOTE.credits };
    let token = await openSecret(env, a.token_sealed), r;
    try { r = await beeSyncJob(env, tid, token, { only: "list", from }); } catch (e) { r = { status: 0, error: String(e?.message || e).slice(0, 120) }; } finally { token = null; }
    const nano = Math.min(JOB_RESERVE_NANO, Math.ceil(Number(r?.ms || 0) / 1000 * JOB_NANO_PER_SEC)); await L.settle(jobId, nano).catch(() => {}); this.bump({ runs: 1, job_ms: Number(r?.ms || 0), cost_nano: nano });
    if (r?.status === 401) { await env.DB.prepare("UPDATE bee_accounts SET status='needs_reconnect', checked_at=?, last_error=? WHERE tenant_id=?").bind(now(), "Bee said 401 (backfill count)", tid).run(); this.put("status", "needs_reconnect"); this.put("note", NOTE.reconnect); await this.mirror(); return { error: NOTE.reconnect }; }
    if (r?.status !== 200 || !r.list) {
      // A 200 without a list = the job ran SYNC_CORE from before step 5 (the beejob Computer DO kept the previous deployment's code for
      // a minute or two after the 10-07 deploy and treated only:"list" as a normal sync). Say exactly what came back.
      const stale = r?.status === 200 && !r.list, why = stale ? `the Bee job answered with the previous version's sync (no list; keys: ${Object.keys(r).filter((k) => k !== "convs").join(",")}); a deploy is still settling`
        : r?.status ? `Bee answered ${r.status}${r.error ? `: ${String(r.error).slice(0, 160)}` : ""}` : r?.error || "no answer";
      await this.ev(`backfill: couldn't count (${why})`);
      return { error: stale ? "1Helm was just updated. Try again in a minute." : "Bee isn't answering right now. Try again in a minute.", detail: why, status: r?.status ?? 0, ms: r?.ms ?? null, cold: !!r?.cold };
    }
    const gaps = subtractRanges([[from, to]], this.covered());
    const have = new Set(this.sql.exec("SELECT id FROM convs").toArray().map((x) => Number(x.id)));
    const items = r.list.items || [], pick = items.filter((c) => (c.end_time != null || c.state === "COMPLETED") && c.start_time != null && c.start_time >= from && c.start_time <= to && !have.has(Number(c.id)) && gaps.some(([x, y]) => c.start_time >= x && c.start_time <= y));
    const live = items.filter((c) => c.end_time == null && c.state !== "COMPLETED").length;
    if (dry) { const per = this.perConv(), n = pick.length;   // /_ops/bee?backfill=count (dev): the estimate only, nothing stored
      return { days, listed: items.length, to_import: n, already_in_memory_or_covered: items.length - n - live, recording: live, pages: r.list.pages, complete: r.list.complete, list_ms: r.ms, list_cost: usd(nano),
        per_conv_usd: usd(per.nano), per_conv_ms: Math.round(per.ms), est_usd: usdShort(n * per.nano), est_min: Math.max(1, Math.round((n * per.ms + Math.ceil(n / BF_BATCH) * BF_BATCH_OVERHEAD_MS) / 60e3)), covered: this.covered() }; }
    this.sql.exec("DELETE FROM bf_queue");
    for (const c of pick) this.sql.exec("INSERT OR IGNORE INTO bf_queue (id, start_time, state) VALUES (?,?, 'todo')", Number(c.id), c.start_time);
    const total = this.bfCount(), per = this.perConv();
    const b = { days, from, to, status: "ready", total, done: 0, failed: 0, active_ms: 0, cost_nano: 0, est_nano: total * per.nano, est_ms: Math.ceil(total * per.ms + Math.ceil(total / BF_BATCH) * BF_BATCH_OVERHEAD_MS),
      listed: items.length, skipped: items.length - pick.length, recording: live, pages: r.list.pages, complete: r.list.complete, counted_at: now(), count_ms: r.ms };
    this.setBf(b);
    await this.ev(`backfill: counted ${days ? `last ${days} days` : "all"}: ${items.length} listed in ${r.list.pages} page${r.list.pages === 1 ? "" : "s"} (${r.ms}ms) → ${total} to import (${items.length - pick.length - live} already in memory or covered, ${live} still recording); est ${usd(b.est_nano)}, ~${Math.max(1, Math.round(b.est_ms / 60e3))} min`);
    return {};
  }
  async bfEnd(outcome) {
    const b = this.bf(); if (!b) return {};
    const active = b.active_ms + (b.status === "running" && b.resumed_at ? now() - b.resumed_at : 0);
    if (outcome === "done") this.put("covered", JSON.stringify(addRange(this.covered(), b.from, b.to)));   // the whole range is in now
    if (b.days) this.sql.exec("INSERT INTO bf_hist (days, at, convs, took_ms, cost_nano, outcome, done, total) VALUES (?,?,?,?,?,?,?,?)", b.days, now(), b.done, active, b.cost_nano, outcome, b.done, b.total);   // "All" gets no history line
    this.sql.exec("DELETE FROM bf_queue"); this.setBf(null);
    await this.ev(`backfill: ${outcome === "done" ? "finished" : `cancelled at ${b.done} of ${b.total}`} (${b.days ? `last ${b.days} days` : "all"}): ${b.done} imported, ${b.failed} failed, took ${Math.round(active / 1000)}s, ${usd(b.cost_nano)}`);
    return {};
  }
  // One batch (alarm): the newest BF_BATCH waiting, one job, each item checkpointed.
  async bfStep() {
    let b = this.bf(); if (b?.status !== "running") return;
    if (now() < (this.num("bf_hold") || 0)) return;   // Bee answered 429/5xx: wait (Retry-After, else 30 s)
    const env = this.env, tid = this.tid(), gen = this.gen;
    const pause = async (reason, note) => { const x = this.bf(); if (x?.status === "running") this.setBf({ ...x, status: "paused", reason, active_ms: x.active_ms + (now() - (x.resumed_at || now())), resumed_at: null }); await this.ev(`backfill: paused (${note})`); };
    if (this.get("status") === "needs_reconnect") return pause("reconnect", "Bee needs reconnecting");
    const t = await env.DB.prepare("SELECT status FROM tenants WHERE id=?").bind(tid).first();
    if (t?.status !== "active") return pause("readonly", "read-only account");
    const ids = this.sql.exec("SELECT id FROM bf_queue WHERE state='todo' ORDER BY start_time DESC, id DESC LIMIT ?", BF_BATCH).toArray().map((x) => Number(x.id));
    if (!ids.length) return this.bfEnd("done");
    const a = await env.DB.prepare("SELECT status, token_sealed FROM bee_accounts WHERE tenant_id=?").bind(tid).first();
    if (!a || a.status !== "connected") return pause("reconnect", "not connected");
    const L = this.ledger(), jobId = `bee-backfill:${crypto.randomUUID()}`;
    let held = null; try { held = await L.reserve(jobId, JOB_RESERVE_NANO); } catch { held = { ok: false }; }
    if (!held?.ok) return pause(held?.reason === "day_limit" ? "day" : "credits", held?.reason || "no reservation");
    const last = this.bfCount("todo") <= ids.length;
    let token = await openSecret(env, a.token_sealed), r;
    try { r = await beeSyncJob(env, tid, token, { only: "convs", ids, stop: last }); } catch (e) { r = { status: 0, error: String(e?.message || e).slice(0, 120), ms: 0 }; } finally { token = null; }
    const jobNano = Math.min(JOB_RESERVE_NANO, Math.ceil((Number(r?.ms || 0) + (last && r?.stopped === false ? JOB_IDLE_MS : 0)) / 1000 * JOB_NANO_PER_SEC));
    await L.settle(jobId, jobNano).catch(() => {}); this.bump({ runs: 1, job_ms: Number(r?.ms || 0), cost_nano: jobNano });
    b = this.bf(); if (b) this.setBf({ ...b, cost_nano: b.cost_nano + jobNano });
    if (r?.status === 401) {
      await env.DB.prepare("UPDATE bee_accounts SET status='needs_reconnect', checked_at=?, last_error=? WHERE tenant_id=?").bind(now(), "Bee said 401 (backfill)", tid).run();
      this.put("status", "needs_reconnect"); this.put("note", NOTE.reconnect); await this.mirror(); return pause("reconnect", "Bee said 401");
    }
    if (r?.slow) this.put("bf_hold", now() + slowWait(r));
    if (r?.status !== 200) { const f = Number(this.get("bf_fails") || 0) + 1; this.put("bf_fails", f); if (f >= 5) { this.put("bf_fails", 0); return pause("down", `Bee answered ${r?.status || r?.error || "nothing"} 5 times`); } return; }
    this.put("bf_fails", 0);
    const st = { L, bank: this.bank(), hsOk: hsOn(env), storageFull: false, creditsOut: null, retainNano: 0, retainChars: 0 };
    for (const c of r.convs || []) {
      if (this.gen !== gen) return;
      b = this.bf(); if (b?.status !== "running") break;   // paused or cancelled between items: the rest stays waiting
      if (c.status === 429) continue;   // rate limited (or not tried after a 429): stays waiting for the next batch
      const before = st.retainNano, k = await this.ingestOne(c, st), id = Number(c.id);
      if (k === "waiting") { await pause(st.creditsOut === "day_limit" ? "day" : "credits", st.creditsOut || "credits"); break; }
      const ok = k === "new" || k === "updated" || k === "same", done = ok || k === "gone" || k === "live";
      this.sql.exec("UPDATE bf_queue SET state=? WHERE id=?", done ? "done" : "fail", id);
      b = this.bf(); if (b) this.setBf({ ...b, done: b.done + 1, failed: b.failed + (done ? 0 : 1), cost_nano: b.cost_nano + (st.retainNano - before),
        active_ms: b.active_ms + (b.resumed_at ? now() - b.resumed_at : 0), resumed_at: b.resumed_at ? now() : null });   // checkpoint after every item
    }
    if (st.retainNano) await this.mirror();
    b = this.bf(); if (b?.status === "running" && !this.bfCount("todo")) await this.bfEnd("done");
  }
  bfView() {
    const b = this.bf(), hist = this.sql.exec("SELECT days, at, convs, took_ms, cost_nano, outcome, done, total FROM bf_hist ORDER BY at DESC LIMIT 10").toArray()
      .map((h) => ({ days: h.days, at: h.at, convs: h.convs, took_ms: h.took_ms, cost_usd: usdShort(h.cost_nano), outcome: h.outcome, done: h.done, total: h.total }));
    if (!b) return { backfill: null, history: hist, offer: this.get("bf_offer") !== "answered" };
    const active = b.active_ms + (b.status === "running" && b.resumed_at ? now() - b.resumed_at : 0), rate = b.done ? active / b.done : this.perConv().ms;
    return { backfill: { status: b.status, days: b.days, total: b.total, done: b.done, failed: b.failed, elapsed_ms: active, left_ms: Math.max(0, Math.round((b.total - b.done) * rate)),
      cost_usd: usdShort(b.cost_nano), est_usd: usdShort(b.est_nano), est_ms: b.est_ms, reason: b.reason || null, recording: b.recording || 0 }, history: hist, offer: this.get("bf_offer") !== "answered" };
  }

  // Disconnect. memories "keep": the documents and transcripts stay (and the list of what was synced, so a later reconnect doesn't
  // import them twice); "remove": every bee:conv:<id> in General's bank and every transcript go, then this DO's storage.
  async stop(memories = "keep") {
    this.gen++; const tid = this.tid();
    this.put("ambient_indexing", null);
    if (["running", "paused"].includes(this.bf()?.status)) await this.bfEnd("cancelled").catch(() => {});
    else { this.setBf(null); this.sql.exec("DELETE FROM bf_queue"); }
    this.put("status", "stopped");
    await this.ctx.storage.deleteAlarm?.();
    if (this._run) await this._run.catch(() => {});
    if (this._ambientRun) await this._ambientRun.catch(() => {});
    await this.ambient.releaseAttempts();
    if (!tid) return { memories, removed: 0 };
    if (memories !== "remove") {
      for (const k of ["cursor", "cursor_at", "gap_from", "live_since", "note", "fails", "next_at", "bee_user", "bf_offer", "poke_at", "poke_why", "idle_runs", "every", "change_at"]) this.put(k, null);
      this.sql.exec("DELETE FROM pending");
      const kept = this.convCount(); await this.ev(`sync: off (disconnected; kept ${kept} conversation${kept === 1 ? "" : "s"} in memory)`);
      return { memories: "kept", kept };
    }
    try { await this.hsInboxClear(); } catch (e) { console.log("bee inbox clear", String(e?.message || e).slice(0, 120)); }   // HS_WRITERS: the inbox documents go with the recordings
    this.ambient.clear();
    let notes = 0; try { notes = await this.removeFactNotes(); } catch (e) { console.log("bee remove notes", String(e?.message || e).slice(0, 120)); }
    const ids = this.sql.exec("SELECT id FROM convs").toArray().map((r) => Number(r.id));
    if (ids.length) await forgetMemoryDocs(this.env, this.tid(), GENERAL, ids.map(docId));   // queued in D1 + re-checked: a retain still landing goes too
    this.put("remove_r2", "1"); await this.removeTranscripts().catch((e) => console.log("bee remove r2", String(e?.message || e).slice(0, 120)));
    const r2Left = this.get("remove_r2") === "1";
    await this.ev(`sync: off (disconnected; removed ${ids.length} conversation${ids.length === 1 ? "" : "s"} from memory${r2Left ? "; transcripts retried in 1 min" : " and their transcripts"}${notes ? `; ${notes} From-Bee note${notes === 1 ? "" : "s"} removed from the Notebook` : ""})`);
    if (r2Left) { this.sql.exec("DELETE FROM convs"); this.sql.exec("DELETE FROM pending"); this.sql.exec("DELETE FROM facts"); try { this.spkInit(); this.sql.exec("DELETE FROM speakers"); } catch {} await this.ctx.storage.setAlarm(now() + 60e3); return { memories: "removed", removed: ids.length }; }
    await this.ctx.storage.deleteAll(); this.init(); this.ambient = new AmbientStore(this);
    return { memories: "removed", removed: ids.length };
  }
  async removeTranscripts() {
    const tid = this.tid(); if (!tid) { this.put("remove_r2", null); return; }
    for (let i = 0; i < 1000; i++) { const l = await this.env.WS.list({ prefix: r2Prefix(tid), limit: 1000 }); if (!l.objects?.length) break; await stDeleteListed(this.env, l.objects); if (!l.truncated) break; }
    this.put("remove_r2", null);
  }

  // ---------------- Live notes (§9, live-notes.js) ----------------
  // One task per person is live at a time: the claim names the LiveNotes DO and is refreshed every minute while it runs (a claim not
  // refreshed for 3 min is free again: a lost DO never blocks the next Start).
  async liveClaim(name, info = {}) {
    const c = (() => { try { return JSON.parse(this.get("live_claim") || "null"); } catch { return null; } })();
    if (c && c.name !== name && now() - c.at < LIVE_CLAIM_MS) return { ok: false, busy: c.info || {} };
    const fresh = !c || c.name !== name || now() - c.at >= LIVE_CLAIM_MS;
    this.put("live_claim", JSON.stringify({ name, info, at: now() }));
    if (fresh && info.source !== "mic") await this.poke("Live notes on", EVERY_MS);   // the sync back at 5 min while Live notes run from Bee (busyWhy)
    return { ok: true };
  }
  async liveRelease(name) { const c = (() => { try { return JSON.parse(this.get("live_claim") || "null"); } catch { return null; } })(); if (c?.name === name) this.put("live_claim", null); return { ok: true }; }
  // Auto refine: these conversations' LiveNotes DO wants Bee's final transcript when each is COMPLETED (ingestOne → lnNotify).
  // A conversation can run through sessions of several tasks (one long Bee conversation, Live notes stopped in one task and started
  // in another): each of them is told.
  // Each watched id is also read by id on the next sync (pending), so one ingested before the watch existed is told too.
  async lnWatch(ids, name) {
    const w = this.lnWatches();
    for (const id of ids || []) if (Number(id) > 0) { const x = w[Number(id)] || { names: [] }; w[Number(id)] = { names: [...new Set([...(x.names || []), name])], at: now() }; this.pend(Number(id), "live notes"); }
    this.put("ln_watch", JSON.stringify(w)); return { ok: true };
  }
  // Live notes saw these conversations end (its poll, or Bee's /v1/stream said so and its poll confirmed): Bee's final read in a
  // few seconds instead of at the next scheduled check, so the auto refine has its transcript at once.
  async lnEnded(ids, name, why = "live notes: a conversation ended") {
    const x = (ids || []).map(Number).filter((id) => id > 0); if (!x.length) return { ok: false };
    if (name) await this.lnWatch(x, name); else for (const id of x) this.pend(id, "live notes");
    return this.poke(why, ENDED_KICK_MS);
  }
  lnWatches() { try { const w = JSON.parse(this.get("ln_watch") || "{}"); for (const [k, v] of Object.entries(w)) if (now() - (v?.at || 0) > 7 * 86400e3) delete w[k]; return w; } catch { return {}; } }
  async lnNotify(conv) {
    const w = this.lnWatches(), x = w[Number(conv.id)]; if (!x || !this.env.LIVE_NOTES) return;
    const fin = (conv.transcriptions || []).filter((t) => t && t.realtime === false), src = fin.length ? fin : (conv.transcriptions || []);
    const utts = src.flatMap((t) => Array.isArray(t?.utterances) ? t.utterances : []).map((u) => ({ id: u.id ?? null, at: msOf(u.spoken_at), sp: typeof u.speaker === "string" ? u.speaker : null, tx: typeof u.text === "string" ? u.text : "" })).filter((u) => u.at != null && u.tx.trim());
    for (const name of x.names || []) await this.env.LIVE_NOTES.get(this.env.LIVE_NOTES.idFromName(name)).convDone(Number(conv.id), utts);
    delete w[Number(conv.id)]; this.put("ln_watch", JSON.stringify(w));
  }

  // ---------------- Facts → General's Notebook (§7) ----------------
  archive() { return this.env.ARCHIVE.get(this.env.ARCHIVE.idFromName(`archive:${this.tid()}`)); }
  async generalCid() {
    const c = this.get("general_cid"); if (c) return c;
    const g = (await this.archive().channels()).find((x) => (x.slug || x.name) === GENERAL); if (!g) throw new Error("no General channel");
    this.put("general_cid", String(g.id)); return String(g.id);
  }
  factRow(id) { return this.sql.exec("SELECT * FROM facts WHERE id=?", Number(id)).toArray()[0] || null; }
  setFact(id, o) {
    const r = this.factRow(id) || { id, text: "", tags: null, confirmed: 0, created_at: null, note_id: null, state: "pending", write: null, tries: 0, try_at: null, stuck: null, at: now() }, x = { ...r, ...o, at: now() };
    if (x.write == null) { x.tries = 0; x.try_at = null; x.stuck = null; }
    this.sql.exec(`INSERT INTO facts (id,text,tags,confirmed,created_at,note_id,state,write,tries,try_at,stuck,at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,tags=excluded.tags,
      confirmed=excluded.confirmed,created_at=excluded.created_at,note_id=excluded.note_id,state=excluded.state,write=excluded.write,tries=excluded.tries,try_at=excluded.try_at,stuck=excluded.stuck,at=excluded.at`,
      Number(id), String(x.text ?? ""), x.tags == null ? null : typeof x.tags === "string" ? x.tags : JSON.stringify(x.tags), x.confirmed ? 1 : 0, x.created_at ?? null, x.note_id ?? null, x.state, x.write ?? null, Number(x.tries || 0), x.try_at ?? null, x.stuck ?? null, x.at);
  }
  // A new write owed to Bee (it replaces any earlier one for the same fact), sent at once by the alarm.
  owe(id, o) { this.setFact(id, { ...o, tries: 0, try_at: null, stuck: null }); return this.kick(); }
  kick() { return this.arm(now()); }
  // Due now (not stuck, past its backoff). → rows
  owedWrites() { return this.sql.exec("SELECT * FROM facts WHERE write IS NOT NULL AND stuck IS NULL AND COALESCE(try_at, 0) <= ? ORDER BY at LIMIT 20", now()).toArray(); }
  // When the next owed write is due (Infinity: none, or only stuck ones / ones waiting for a reconnect).
  writesDueAt() {
    if (this.get("status") !== "active") return Infinity;
    const r = this.sql.exec("SELECT MIN(COALESCE(try_at, 0)) t, COUNT(*) n FROM facts WHERE write IS NOT NULL AND stuck IS NULL").toArray()[0];
    return Number(r?.n || 0) ? Number(r.t || 0) : Infinity;
  }
  // The Ambient Bee card: changes that couldn't reach Bee (stuck) and ones still on their way (owed).
  writesView() {
    const q = (w) => Number(this.sql.exec(`SELECT COUNT(*) n FROM facts WHERE write IS NOT NULL AND ${w}`).toArray()[0]?.n || 0), stuck = q("stuck IS NOT NULL"), owed = q("stuck IS NULL");
    return stuck || owed ? { writes: { stuck, owed } } : {};
  }
  // Card → Retry: every stuck write is due again now. Dismiss: they're dropped (the Notebook keeps what the person did).
  async writesOp(tenant, op) {
    if (!this.tid() && tenant) this.put("tenant", tenant);
    const rows = this.sql.exec("SELECT * FROM facts WHERE write IS NOT NULL AND stuck IS NOT NULL").toArray();
    if (op === "retry") { this.sql.exec("UPDATE facts SET stuck=NULL, tries=0, try_at=NULL WHERE write IS NOT NULL AND stuck IS NOT NULL"); await this.kick(); await this.ev(`facts: retrying ${rows.length} change${rows.length === 1 ? "" : "s"} for Bee (Retry)`); }
    else if (op === "dismiss") { for (const w of rows) { if (Number(w.id) < 0) this.sql.exec("DELETE FROM facts WHERE id=?", Number(w.id)); else this.setFact(w.id, { write: null, ...(w.write === "put" ? { state: "dropped" } : {}) }); } await this.ev(`facts: ${rows.length} change${rows.length === 1 ? "" : "s"} for Bee dismissed`); }
    return this.writesView();
  }
  async firstName() { return (await this.env.DB.prepare("SELECT first_name FROM bee_accounts WHERE tenant_id=?").bind(this.tid()).first().catch(() => null))?.first_name || ""; }
  // HS_WRITERS (DESIGN section 7, option (a)): the voice inbox stays a screen on top of Hindsight, and an item the person confirmed or the extractor
  // located with confidence is retained into General's bank as inbox:<item id>, with its status in the text. A changed status replaces the
  // document, and an item that is gone (its conversation was deleted, or a newer one replaced it) loses its document. The table hs_inbox holds
  // what was sent (a hash per item), so only the difference is sent, and a pass that stops half way finishes at the next one.
  hsInboxReady() { this.sql.exec("CREATE TABLE IF NOT EXISTS hs_inbox (id TEXT PRIMARY KEY, hash TEXT NOT NULL, source_id TEXT)"); }
  // General's bank has one mental model refresh window, kept by its Resident (resident.js hsRefreshTake), so a chat turn and a Bee conversation in
  // the same window are charged once between them. If the Resident can't answer (an old object during a deploy), this object's own clock is used.
  async hsRefreshTake() {
    try { const t = await (await this.hsGeneral()).hsRefreshWindow("take"); if (t && Number.isFinite(t.models)) return { ...t, via: "resident" }; } catch (e) { console.log("refresh window", String(e?.message || e).slice(0, 120)); }
    const prev = this.get("hs_refresh_at") ?? null, models = Number(prev) > now() - HS_REFRESH_WINDOW_MS ? 0 : templateModelCount("general"), mark = models ? now() : null;
    if (mark) this.put("hs_refresh_at", mark);
    return { models, mark, prev, via: "local" };
  }
  async hsRefreshGive(w) {
    if (!w?.mark) return;
    if (w.via === "resident") { try { await (await this.hsGeneral()).hsRefreshWindow("give", { mark: w.mark, prev: w.prev }); } catch (e) { console.log("refresh window give back", String(e?.message || e).slice(0, 120)); } }
    else if (Number(this.get("hs_refresh_at")) === w.mark) this.put("hs_refresh_at", w.prev ?? null);
  }
  async hsGeneral() { const tid = this.tid(), cid = await this.generalCid(); const R = this.env.RESIDENT.get(this.env.RESIDENT.idFromName(`res:${tid}:${GENERAL}`)); await R.bind(tid, GENERAL, String(cid)); return R; }
  async hsInboxSync({ force = false } = {}) {
    if (!hsWriters(this.env) || !hsOn(this.env) || !this.tid() || this.get("account_deleted")) return null;
    const rev = String(this.get("ambient_revision") || "0"); if (!force && this.get("hs_inbox_rev") === rev) return null;
    this.hsInboxReady();
    const all = []; for (let after = "", i = 0; i < 100; i++) { const r = this.ambient.inboxRows(after, 200); all.push(...r.rows); if (r.done) break; after = r.rows[r.rows.length - 1].id; }
    const eligible = all.filter(inboxEligible), have = new Map(this.sql.exec("SELECT id, hash FROM hs_inbox").toArray().map((r) => [r.id, r.hash])), ids = new Set(eligible.map((x) => x.id)), changed = [];
    for (const it of eligible) { const hash = await contentHash(JSON.stringify([it.kind, it.text, it.status, it.due_text, (it.evidence || []).map((e) => e.quote)])); if (have.get(it.id) !== hash) changed.push({ it, hash }); }
    const gone = [...have.keys()].filter((id) => !ids.has(id));
    if (!changed.length && !gone.length) { this.put("hs_inbox_rev", rev); return { sent: 0, dropped: 0 }; }
    const R = await this.hsGeneral();
    for (let i = 0; i < changed.length; i += 40) {
      const part = changed.slice(i, i + 40), r = await R.hsInboxPut(part.map((x) => x.it));
      if (r?.error) throw new Error(r.error);
      for (const x of part) this.sql.exec("INSERT INTO hs_inbox (id, hash, source_id) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash, source_id=excluded.source_id", x.it.id, x.hash, String(x.it.source_id || ""));   // saved after each part
    }
    for (let i = 0; i < gone.length; i += 100) { const part = gone.slice(i, i + 100); await R.hsDrop(part.map(HS_DOC.inbox)); for (const id of part) this.sql.exec("DELETE FROM hs_inbox WHERE id=?", id); }
    this.put("hs_inbox_rev", rev); return { sent: changed.length, dropped: gone.length };
  }
  // The rebuild: every inbox item that qualifies, in id order (hindsight-rebuild.js).
  async hsInboxSource(after = "", limit = 40) {
    const r = this.ambient.inboxRows(after, limit), rows = r.rows.filter(inboxEligible);
    return { items: rows, next: r.rows.length ? r.rows[r.rows.length - 1].id : null, done: r.done };
  }
  // The inbox was cleared (Disconnect with memories removed): every inbox document goes.
  async hsInboxClear() {
    if (!hsWriters(this.env) || !hsOn(this.env)) return 0; this.hsInboxReady();
    const ids = this.sql.exec("SELECT id FROM hs_inbox").toArray().map((r) => r.id); if (!ids.length) return 0;
    const R = await this.hsGeneral(); await R.hsDrop(ids.map(HS_DOC.inbox)); this.sql.exec("DELETE FROM hs_inbox"); this.put("hs_inbox_rev", null); return ids.length;
  }
  // HS_WRITERS: the transcript of one conversation into General's bank, through General's Resident (it owns the bank, the outbox and the rebuild).
  async hsBeePut(conv) {
    const tid = this.tid(), cid = await this.generalCid(), addr = typeof conv.primary_location?.address === "string" && conv.primary_location.address.trim() ? conv.primary_location.address : "", lines = ambientLines(conv);
    try { this.speakersSeen(conv, lines); } catch (e) { console.log("bee speakers", String(e?.message || e).slice(0, 120)); }   // the new speaker review (bee-speakers.js)
    const R = this.env.RESIDENT.get(this.env.RESIDENT.idFromName(`res:${tid}:${GENERAL}`)); await R.bind(tid, GENERAL, String(cid));
    const r = await R.hsBeePut({ id: conv.id, lines, at: msOf(conv.start_time) ?? msOf(conv.created_at) ?? now(), address: addr, summary: String(conv.short_summary || conv.summary || ""), started: iso(conv.start_time), ended: iso(conv.end_time),
      location: ambientLocation(conv), primary: conv.primary_location ?? null, timezone: typeof conv.timezone === "string" ? conv.timezone : null, device: typeof conv.device_type === "string" ? conv.device_type : null, start_raw: conv.start_time ?? null, end_raw: conv.end_time ?? null, speakers: this.speakerLinks(conv.id) });   // the envelope (adapters/bee.js); an older Resident ignores the extra fields
    if (r?.error) throw new Error(r.error); return r;
  }
  // The rebuild (hindsight-rebuild.js): finished conversations, oldest first, as { id, lines, at, address, summary, started, ended }, read from their saved transcripts.
  // after: the start_time and id of the last one given ("<ms>|<id>"). upTo: only conversations that started by then.
  async hsBeeSource(after = "", limit = 10, upTo = Infinity) {
    const all = this.sql.exec("SELECT id, start_time, r2_key FROM convs WHERE r2_key IS NOT NULL ORDER BY start_time, id").toArray().filter((r) => Number(r.start_time || 0) <= upTo), key = (r) => `${String(Number(r.start_time) || 0).padStart(15, "0")}|${r.id}`;
    const rows = all.filter((r) => !after || key(r) > after).slice(0, limit), out = [];
    for (const r of rows) {
      const o = await this.env.WS.get(r.r2_key); if (!o) continue; let d; try { d = JSON.parse(await o.text()); } catch { continue; }
      const addr = typeof d.primary_location?.address === "string" && d.primary_location.address.trim() ? d.primary_location.address : "";
      out.push({ id: d.id ?? r.id, lines: ambientLines(d), at: msOf(d.start_time) ?? Number(r.start_time) ?? now(), address: addr, summary: String(d.short_summary || d.summary || ""), started: iso(d.start_time), ended: iso(d.end_time),
        location: ambientLocation(d), primary: d.primary_location ?? null, timezone: typeof d.timezone === "string" ? d.timezone : null, device: typeof d.device_type === "string" ? d.device_type : null, start_raw: d.start_time ?? null, end_raw: d.end_time ?? null, speakers: this.speakerLinks(d.id ?? r.id) });
    }
    return { items: out, next: rows.length ? key(rows[rows.length - 1]) : null, done: rows.length < limit };
  }
  async addNote(cid, id, text, tags) {
    const sec = factSec(text, await this.firstName(), tags);
    const row = await this.archive().noteAdd(cid, sec, text, "human", { src: "bee", bee_fact_id: Number(id) });
    if (row) await hsNoteNotify(this.env, this.tid(), GENERAL, cid, row.id);
    // A note that came back without its link (an Archive still on the code from before step 4, right after a deploy: 10-07) is
    // matched back by its text on the next full listing.
    if (row && Number(row.bee_fact_id) !== Number(id)) { this.put("facts_relink", "1"); await this.ev(`facts: note ${row.id} saved without its link to fact ${id}; relinking on the next sync`); }
    return row;
  }
  // A From-Bee note with no bee_fact_id and the same text → linked to this fact (instead of a second note). → the note or null.
  async relink(cid, id, text, unlinked) {
    const key = scrubSecrets(String(text || "").trim()), i = unlinked.findIndex((m) => String(m.content || "").trim() === key); if (i < 0) return null;
    const [m] = unlinked.splice(i, 1), row = await this.archive().noteLinkBee(cid, m.id, id);
    if (row) await this.ev(`facts: linked note ${m.id} to fact ${id} (it was saved without its link)`);
    return row;
  }
  async dropNote(cid, noteId) { await deleteNote(this.env, this.tid(), GENERAL, cid, String(noteId)); }
  // One listing → the Notebook. → counts. Never writes to Bee.
  async applyFacts(fl, gen) {
    const n = { added: 0, edited: 0, pending: 0, removed: 0, owed: 0 }, cid = await this.generalCid(), A = this.archive();
    const all = ((await A.channel(cid, 1)).memory || []).filter((m) => m.status !== "superseded"), mem = all.filter((m) => m.bee_fact_id != null);
    const unlinked = all.filter((m) => m.src === "bee" && m.bee_fact_id == null);   // From-Bee notes that lost their link (see addNote)
    const byFact = new Map(mem.map((m) => [Number(m.bee_fact_id), m])), seen = new Set();
    for (const f of fl.list || []) {
      if (this.gen !== gen) return n;
      const id = Number(f.id), text = String(f.text || "").trim(); if (!(id > 0) || !text || seen.has(id)) continue; seen.add(id);
      let row = this.factRow(id), note = byFact.get(id) || null; const tags = Array.isArray(f.tags) ? f.tags : row?.tags ? JSON.parse(row.tags) : null;
      if (row?.write) { n.owed++; continue; }                                  // our change is still owed to Bee: it wins until written
      if (f.confirmed && !byFact.has(id) && (!row || row.state === "note" || row.state === "dropped")) {   // its note may be there without the link
        const r = (row?.text && row.text !== text ? await this.relink(cid, id, row.text, unlinked) : null) || await this.relink(cid, id, text, unlinked); if (r) { byFact.set(id, r); n.relinked = (n.relinked || 0) + 1; if (row?.state === "dropped") this.setFact(id, { state: "note", note_id: String(r.id) }); }
      }
      note = byFact.get(id) || null; row = this.factRow(id);
      if (row && (row.state === "denied" || row.state === "dropped")) continue;   // denied / deleted here (or its note removed another way: not brought back)
      if (f.confirmed) {
        if (note) {
          if (row && row.text !== text) { await A.noteEdit(cid, note.id, text); await hsNoteNotify(this.env, this.tid(), GENERAL, cid, note.id); n.edited++; }   // edited in the Bee app
          this.setFact(id, { text, tags, confirmed: 1, created_at: f.created_at, note_id: String(note.id), state: "note" });
        } else if (row?.state === "note") this.setFact(id, { text, tags, confirmed: 1, state: "dropped" });   // its note was removed another way (Forget): not brought back
        else { const nr = await this.addNote(cid, id, text, tags); byFact.set(id, nr); this.setFact(id, { text, tags, confirmed: 1, created_at: f.created_at, note_id: String(nr.id), state: "note" }); n.added++; }
      } else {
        if (note) { await this.dropNote(cid, note.id); byFact.delete(id); n.removed++; }   // un-confirmed in the Bee app: back to review
        this.setFact(id, { text, tags, confirmed: 0, created_at: f.created_at, note_id: null, state: "pending" });
        n.pending++;
      }
    }
    // Gone from Bee (only when every page was read): gone from the Notebook and the review block too.
    if (fl.complete && this.gen === gen) {
      const known = new Set([...this.sql.exec("SELECT id FROM facts WHERE write IS NULL AND id > 0 AND state IN ('pending','note')").toArray().map((r) => Number(r.id)), ...byFact.keys()]);
      for (const id of known) {
        if (seen.has(id)) continue;
        const row = this.factRow(id); if (row?.write) continue;
        const note = byFact.get(id); if (note) { await this.dropNote(cid, note.id); n.removed++; }
        this.sql.exec("DELETE FROM facts WHERE id=?", id);
      }
    }
    n.pending = Number(this.sql.exec("SELECT COUNT(*) n FROM facts WHERE state='pending' AND write IS NULL").toArray()[0]?.n || 0);
    return n;
  }
  pendingFacts() {
    return this.sql.exec("SELECT id, text, tags, created_at FROM facts WHERE state='pending' AND write IS NULL ORDER BY COALESCE(created_at, at) DESC LIMIT 200").toArray()
      .map((r) => ({ id: Number(r.id), text: r.text, tags: r.tags ? JSON.parse(r.tags) : [], at: msOf(r.created_at) }));
  }
  // One write job, its container time reserved first and settled. → the WRITE_CORE answer ({status: 0, error} if it never ran).
  async writeOps(ops) {
    const env = this.env, tid = this.tid();
    const a = await env.DB.prepare("SELECT status, token_sealed FROM bee_accounts WHERE tenant_id=?").bind(tid).first();
    if (!a || a.status !== "connected") return { status: 0, error: "not connected" };
    const L = this.ledger(), jobId = `bee-facts:${crypto.randomUUID()}`;
    let held = null; try { held = await L.reserve(jobId, FACTS_RESERVE_NANO); } catch { held = { ok: false }; }
    if (!held?.ok) return { status: 0, error: held?.reason === "day_limit" ? "day_limit" : "credits" };
    let token = await openSecret(env, a.token_sealed), r;
    try { r = await beeFactsJob(env, tid, token, ops); } catch (e) { r = { status: 0, error: String(e?.message || e).slice(0, 120), ms: 0 }; } finally { token = null; }
    const nano = Math.min(FACTS_RESERVE_NANO, Math.ceil(Number(r?.ms || 0) / 1000 * JOB_NANO_PER_SEC));
    await L.settle(jobId, nano).catch(() => {}); this.bump({ fact_writes: ops.length, cost_nano: nano });
    if (r?.status === 401) { await env.DB.prepare("UPDATE bee_accounts SET status='needs_reconnect', checked_at=?, last_error=? WHERE tenant_id=?").bind(now(), "Bee said 401 (fact write)", tid).run(); this.put("status", "needs_reconnect"); this.put("note", NOTE.reconnect); await this.mirror(); }
    return r || { status: 0 };
  }
  // Send what's owed to Bee (one job for up to 20 writes). One flush at a time; a call while one runs makes it go round again.
  flushWrites() {
    if (this._flush) { this._again = true; return this._flush; }
    this._flush = (async () => { let n = 0; for (let i = 0; i < 5; i++) { this._again = false; n += await this.flushOnce(); if (!this._again || !this.owedWrites().length) break; } return n; })().finally(() => { this._flush = null; });
    return this._flush;
  }
  async flushOnce() {
    const rows = this.owedWrites(); if (!rows.length) return 0;
    const ops = rows.map((w) => w.write === "delete" ? { op: "delete", id: Number(w.id) } : w.write === "post" ? { op: "post", body: { text: w.text } }
      : { op: "put", id: Number(w.id), body: { text: w.text, tags: w.tags ? JSON.parse(w.tags) : null, confirmed: true } });   // HARD: a PUT carries the fact's tags
    this._sending = new Set(rows.map((w) => Number(w.id)));
    let r; try { r = await this.writeOps(ops); } finally { this._sending = null; }
    // Never reached Bee because of us (credits, today's limit, not connected / needs reconnect): wait, not a try.
    const parked = r.status === 401 || (!r.results?.length && ["credits", "day_limit", "not connected"].includes(r.error));
    let done = 0, retry = 0, stuck = 0;
    for (let i = 0; i < rows.length; i++) {
      const w = rows[i], cur = this.factRow(w.id), x = r.results?.[i];   // WRITE_CORE answers one result per op, in order
      if (!cur || cur.write !== w.write || cur.text !== w.text) continue;   // changed while this was being sent: the newer change goes next
      if (parked && !x) { this.setFact(w.id, { try_at: r.status === 401 ? null : now() + (r.error === "not connected" ? 60e3 : EVERY_MS) }); retry++; continue; }
      const okay = x && ((x.status >= 200 && x.status < 300) || (w.write === "delete" && x.status === 404));
      if (okay && w.write === "post") { await this.posted(w, x.fact); done++; continue; }
      if (okay) { this.setFact(w.id, { write: null, ...(x.fact?.tags ? { tags: x.fact.tags } : {}) }); done++; continue; }
      const tries = Number(w.tries || 0) + 1, four = x && x.status >= 400 && x.status < 500 && x.status !== 408 && x.status !== 429;
      if ((four && tries >= WRITE_4XX_TRIES) || tries >= WRITE_MAX_TRIES) { this.setFact(w.id, { tries, try_at: null, stuck: x?.status ? `Bee answered ${x.status}` : String(x?.error || r.error || "no answer").slice(0, 80) }); stuck++; }
      else { this.setFact(w.id, { tries, try_at: now() + writeBackoff(tries) }); retry++; }
    }
    const left = retry ? Math.round((this.writesDueAt() - now()) / 1000) : 0;
    await this.ev(`facts: ${done} of ${rows.length} change${rows.length === 1 ? "" : "s"} written to Bee${retry ? `; ${retry} retried${parked ? " (waiting: " + (r.status === 401 ? "reconnect" : r.error) + ")" : left > 0 ? ` in ${left}s` : ""}` : ""}${stuck ? `; ${stuck} couldn't be written (shown on the Bee card)` : ""}; job ${r.ms ?? 0}ms${r.cold ? " (cold start)" : ""}`);
    return done;
  }
  // A restored note's fact was created in Bee: link the note to the new id (or, if the note was deleted meanwhile, delete the fact).
  async posted(w, f) {
    this.sql.exec("DELETE FROM facts WHERE id=?", Number(w.id));
    if (!f?.id) return;
    const cid = await this.generalCid(), nr = w.note_id ? await this.archive().noteLinkBee(cid, w.note_id, f.id) : null;
    if (nr) this.setFact(f.id, { text: w.text, tags: f.tags || null, confirmed: 1, note_id: String(nr.id), state: "note" });
    else this.setFact(f.id, { text: w.text, tags: f.tags || null, confirmed: 1, state: "denied", write: "delete" });
  }
  // New from Bee: Approve (PUT confirmed:true with its tags → note), Edit (PUT {text, tags, confirmed:true} → note), Deny (DELETE).
  // The Notebook (and this table) change now; the PUT / DELETE is owed to Bee and sent in the background (flushWrites).
  async factAction(tenant, op, id, text = "") {
    if (!this.tid() && tenant) this.put("tenant", tenant);
    const row = this.factRow(id);
    if (!row || row.state !== "pending" || row.write) return { error: "That one isn't waiting for review anymore.", pending: this.pendingFacts() };
    if (op === "deny") {
      await this.owe(id, { state: "denied", write: "delete" });
      this.ev(`facts: denied ${id} (DELETE owed to Bee)`); return { ok: true, pending: this.pendingFacts() };
    }
    const newText = op === "edit" && text ? text : row.text, tags = row.tags ? JSON.parse(row.tags) : null;
    const cid = await this.generalCid(), nr = await this.addNote(cid, id, newText, tags);
    await this.owe(id, { text: newText, tags, confirmed: 1, note_id: String(nr.id), state: "note", write: "put" });
    this.ev(`facts: ${op === "edit" ? "edited and approved" : "approved"} ${id} → Notebook (PUT owed to Bee)`);
    return { ok: true, note: { id: String(nr.id), sec: nr.sec, text: String(nr.content), at: nr.created, src: "bee" }, pending: this.pendingFacts() };
  }
  // A From-Bee note edited / deleted in the Notebook: owed to Bee, sent in the background.
  async factNoteEdited(tenant, id, noteId, text) {
    if (!this.tid() && tenant) this.put("tenant", tenant);
    const row = this.factRow(id); await this.owe(id, { text, tags: row?.tags ?? null, confirmed: 1, note_id: noteId, state: "note", write: "put" });
    return { owed: true };
  }
  async factNoteDeleted(tenant, id) {
    if (!this.tid() && tenant) this.put("tenant", tenant);
    await this.owe(id, { note_id: null, state: "denied", write: "delete" });
    return { owed: true };
  }
  // Undo of a deleted From-Bee note. Its DELETE not sent yet → cancelled, the note linked to the same fact again. Otherwise the note
  // is back at once (src bee) and the fact is created again in Bee in the background (POST; confirmed, Bee tags it), then linked.
  async factRestore(tenant, sec, text) {
    if (!this.tid() && tenant) this.put("tenant", tenant);
    const key = String(text || "").trim(), cid = await this.generalCid();
    const owed = this.sql.exec("SELECT * FROM facts WHERE state='denied' AND write='delete' ORDER BY at DESC LIMIT 50").toArray().find((w) => String(w.text || "").trim() === key && !this._sending?.has(Number(w.id)));
    if (owed) { const nr = await this.archive().noteAdd(cid, sec, text, "human", { src: "bee", bee_fact_id: Number(owed.id) }); await hsNoteNotify(this.env, this.tid(), GENERAL, cid, nr.id); this.setFact(owed.id, { state: "note", note_id: String(nr.id), confirmed: 1, write: null }); this.ev(`facts: delete of ${owed.id} undone before it reached Bee`); return nr; }
    const nr = await this.archive().noteAdd(cid, sec, text, "human", { src: "bee" }), tmp = -(this.num("tmp_seq") + 1); this.put("tmp_seq", -tmp); await hsNoteNotify(this.env, this.tid(), GENERAL, cid, nr.id);
    await this.owe(tmp, { text, confirmed: 1, note_id: String(nr.id), state: "note", write: "post" });
    return nr;
  }
  // Disconnect → remove: every From-Bee note goes (nothing is written to Bee).
  async removeFactNotes() {
    const cid = await this.generalCid().catch(() => null); if (!cid) return 0;
    const notes = ((await this.archive().channel(cid, 1)).memory || []).filter((m) => m.bee_fact_id != null);
    for (const m of notes) await this.dropNote(cid, m.id);
    this.sql.exec("DELETE FROM facts"); this.put("facts_at", null);
    return notes.length;
  }
  async opsBackfillCount(tenant, days) { if (!this.tid() && tenant) this.put("tenant", tenant); return this.bfCount_(Number(days) || 0, true); }
  // /_ops/bee?facts=count (dev): one read-only job (GET /v1/facts only); nothing is imported or written.
  async opsFactsCount(tenant) {
    if (!this.tid() && tenant) this.put("tenant", tenant);
    const env = this.env, tid = this.tid(), a = await env.DB.prepare("SELECT status, token_sealed FROM bee_accounts WHERE tenant_id=?").bind(tid).first();
    if (!a || a.status !== "connected") return { error: "not connected" };
    const L = this.ledger(), jobId = `bee-count:${crypto.randomUUID()}`;
    const held = await L.reserve(jobId, JOB_RESERVE_NANO).catch(() => null); if (!held?.ok) return { error: "no reservation (credits)" };
    let token = await openSecret(env, a.token_sealed), r;
    try { r = await beeSyncJob(env, tid, token, { only: "facts" }); } catch (e) { r = { status: 0, error: String(e?.message || e).slice(0, 120) }; } finally { token = null; }
    const nano = Math.min(JOB_RESERVE_NANO, Math.ceil(Number(r?.ms || 0) / 1000 * JOB_NANO_PER_SEC)); await L.settle(jobId, nano).catch(() => {});
    if (r?.status !== 200) return { status: r?.status ?? 0, error: r?.error || null };
    const list = r.facts?.list || [], conf = list.filter((f) => f.confirmed);
    return { confirmed: conf.length, unconfirmed: list.length - conf.length, complete: !!r.facts?.complete, already_in_notebook: Number(this.sql.exec("SELECT COUNT(*) n FROM facts WHERE state='note'").toArray()[0]?.n || 0),
      tags_seen: [...new Set(list.flatMap((f) => f.tags || []))].slice(0, 40), ms: r.ms, cost_usd: usd(nano) };
  }

  status() {
    const c = this.counters();
    return { status: this.get("status") || "off", token_ref: this.get("token_ref") || null, cursor: this.get("cursor") || null, live_since: this.num("live_since") || null,
      last_sync_at: this.num("last_sync_at") || null, last_run_at: this.num("last_run_at") || null, next_at: this.num("next_at") || null, fails: this.num("fails"),
      poke_at: this.num("poke_at") || null, every: (() => { try { return JSON.parse(this.get("every") || "null"); } catch { return null; } })(), idle_runs: this.num("idle_runs"), tz: this.get("tz") || null, change_at: this.num("change_at") || null,
      note: this.get("note") || null, running: !!this._run, convs: this.convCount(), covered: this.covered(),
      pending: this.sql.exec("SELECT id, why, at FROM pending ORDER BY at LIMIT 50").toArray(),
      counters: { ...c, cost_usd: usd(c.cost_nano) } };
  }
  // /_ops/bee (dev): the state + the last 50 conversations (ids, times, sizes; no text).
  async opsView() {
    return { ...this.status(), alarm_at: await this.ctx.storage.getAlarm(), bank: this.tid() ? this.bank() : null,
      bf: this.bf(), bf_view: this.bfView(),
      facts: Object.fromEntries(this.sql.exec("SELECT COALESCE(write, state) k, COUNT(*) n FROM facts GROUP BY k").toArray().map((r) => [r.k, r.n])), facts_at: this.num("facts_at") || null,
      recent: this.sql.exec("SELECT id, start_time, end_time, updated_at, retained_at, r2_key, bytes, chars FROM convs ORDER BY start_time DESC LIMIT 50").toArray() };
  }
}
speakersMix(BeeSync);   // bee-speakers.js: the new speaker review (HS_ENVELOPE)

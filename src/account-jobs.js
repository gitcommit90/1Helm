// Per-account scheduled work. A cron run only lists which accounts are due, one cheap indexed page at a time, and sends one queue message
// per account and job kind ({ kind, tenant, ... }). The queue consumer runs the existing per-account body once per message, so no job depends
// on one cron invocation reaching every account, and a failing account is retried by the queue (then goes to the dead letter queue) without
// holding up the others. Every body must be safe to run twice: a message can be delivered again, and a listing can send an account twice.
// A Worker with no queue bound (the example config, one owner) runs each body in the listing itself, so the same work happens without a queue.
import { pastdueOne, cancelOne, beeStart, CRON_STALE_MS, POLL_MS, SEEN_MS, LATE_MS, CLAIM_MS, pollAndSend, sendOne, dailyBillingFlag, billingUp } from "./ee/index.js";
import { recount, RECOUNT_MS } from "./storage.js";
import { doomedPrefixes, forgetPrefix } from "./mem0.js";

const SEND_MAX = 100;   // messages in one sendBatch call
export const PAGE = 500, PAGES = 50;   // accounts per page, pages per run: one run lists up to 25,000 accounts, then continues from the stored cursor
// The minute kinds go to their own queue, so a backlog of hourly work never delays a reminder.
const FAST = new Set(["meeting_alert", "meeting_poll", "watchdog"]);
// Accounts one run may send for a kind, continuing from the cursor next run. The storage recount: 1,100 an hour is 26,400 a day, so every account of 25,000 is counted about once a day.
const MAX_PER_RUN = { storage: 1100 };

// ---- listing ----
// page(cursor, size) returns rows { k, ...message } in ascending k order, k being the keyset value the next page continues after. State per kind
// lives in account_job_state: the cursor, the last run, and the last complete pass (the heartbeat that ops reads).
// claim(rows) runs after each successful sendBatch with the rows just sent.
export async function listJobs(env, kind, page, now = Date.now(), claim = null, d = {}) {
  const st = await env.DB.prepare("SELECT cursor, pass_count FROM account_job_state WHERE kind=?").bind(kind).first();
  let cursor = st?.cursor || "", sent = 0, done = false;
  const queue = FAST.has(kind) ? env.ACCOUNT_JOBS_FAST : env.ACCOUNT_JOBS, max = MAX_PER_RUN[kind] || Infinity;
  for (let i = 0; i < PAGES && !done && sent < max; i++) {
    const n = Math.min(PAGE, max - sent), rows = await page(cursor, n);
    for (let j = 0; j < rows.length; j += SEND_MAX) {
      const part = rows.slice(j, j + SEND_MAX);
      if (queue) await queue.sendBatch(part.map(({ k, ...m }) => ({ body: { kind, ...m } })));
      else for (const { k, ...m } of part) await runAccountJob(env, { kind, ...m }, d).catch((e) => console.log("account job failed", kind, m.tenant || "-", String(e?.message || e).slice(0, 160)));
      if (claim) await claim(part);
    }
    sent += rows.length;
    if (rows.length < n) done = true; else cursor = String(rows[rows.length - 1].k);
  }
  const pass = Number(st?.pass_count || 0) + sent;
  await env.DB.prepare(`INSERT INTO account_job_state (kind, cursor, run_at, run_count, done_at, done_count, pass_count) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(kind) DO UPDATE SET cursor=excluded.cursor, run_at=excluded.run_at, run_count=excluded.run_count, pass_count=excluded.pass_count,
      done_at=CASE WHEN excluded.done_at>0 THEN excluded.done_at ELSE account_job_state.done_at END, done_count=CASE WHEN excluded.done_at>0 THEN excluded.done_count ELSE account_job_state.done_count END`)
    .bind(kind, done ? "" : cursor, now, sent, done ? now : 0, done ? pass : 0, done ? 0 : pass).run();
  return { kind, sent, done };
}
const all = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).all().then((r) => r.results || []);

// The accounts each kind sends. `after` is the keyset cursor; every query reads an indexed key in order.
const LISTERS = {
  // Every account with a subscription: Stripe is asked for the truth of each (healing missed webhooks).
  reconcile: (env, after, n) => all(env, "SELECT id AS k, id AS tenant FROM tenants WHERE stripe_subscription<>'' AND id>? ORDER BY id LIMIT ?", after, n),
  // A resident whose schedule is overdue by more than 2 minutes.
  watchdog: async (env, after, n, now) => {
    const [t, r = "0"] = after.split(":"), rows = await all(env, `SELECT rowid AS r, next_run, tenant_id AS tenant, channel, channel_id FROM resident_schedules
      WHERE next_run IS NOT NULL AND next_run<? AND (next_run, rowid)>(?, ?) ORDER BY next_run, rowid LIMIT ?`, now - 120e3, Number(t), Number(r), n);
    return rows.map(({ r, next_run, ...m }) => ({ k: `${next_run}:${r}`, ...m }));
  },
  pastdue: (env, after, n) => all(env, "SELECT tenant_id AS k, tenant_id AS tenant FROM payment_holds WHERE (state IN ('unpaid','deleting') OR (state='deleted' AND email<>'')) AND tenant_id>? ORDER BY tenant_id LIMIT ?", after, n),
  cancel: (env, after, n) => all(env, "SELECT tenant_id AS k, tenant_id AS tenant FROM plan_cancellations WHERE (state IN ('scheduled','deleting') OR (state='deleted' AND email<>'')) AND tenant_id>? ORDER BY tenant_id LIMIT ?", after, n),
  // A connected Bee account whose sync has not succeeded for CRON_STALE_MS.
  bee: (env, after, n, now) => !env.BEE_SYNC ? [] : all(env, `SELECT tenant_id AS k, tenant_id AS tenant, bee_user_id FROM bee_accounts WHERE status='connected' AND COALESCE(synced_at,0)<? AND tenant_id>?
    AND tenant_id NOT IN (SELECT t.id FROM tenants t JOIN users u ON u.id=t.owner_user_id WHERE LOWER(u.email) LIKE '%@example.com') ORDER BY tenant_id LIMIT ?`, now - CRON_STALE_MS, after, n),
  // Accounts whose storage was not counted in the last RECOUNT_MS.
  storage: (env, after, n, now) => all(env, `SELECT t.id AS k, t.id AS tenant FROM tenants t LEFT JOIN storage_plan s ON s.tenant_id=t.id
    WHERE t.status IN ('active','past_due') AND COALESCE(s.counted_at,0)<? AND t.id>? ORDER BY t.id LIMIT ?`, now - RECOUNT_MS, after, n),
  // Accounts whose next calendar look is due and that have someone to tell (listKind claims the next look for each batch that was sent).
  meeting_poll: (env, after, n, now) => all(env, `SELECT t.id AS k, t.id AS tenant FROM tenants t LEFT JOIN meeting_watch w ON w.tenant_id=t.id LEFT JOIN notif_prefs np ON np.tenant_id=t.id
      WHERE t.status='active' AND COALESCE(np.meetings,1)=1 AND COALESCE(w.next_poll_at,0)<=? AND t.id>?
        AND (EXISTS (SELECT 1 FROM push_subs p WHERE p.tenant_id=t.id) OR COALESCE(w.seen_at,0)>?) ORDER BY t.id LIMIT ?`, now, after, now - SEEN_MS, n),
  // A meeting reminder that is due, paged on (alert_at, id) so the (alert_at, state) index serves it. The first page also marks the reminders that are too late as missed.
  meeting_alert: async (env, after, n, now) => {
    if (!after) await env.DB.prepare("UPDATE meeting_alerts SET state='missed' WHERE state IN ('due','sending') AND start_at < ?").bind(now - LATE_MS).run().catch(() => {});
    const c = after.indexOf(":"), rows = await all(env, `SELECT a.alert_at, a.id, a.tenant_id AS tenant FROM meeting_alerts a WHERE a.alert_at<=? AND a.start_at>=? AND (a.state='due' OR (a.state='sending' AND a.claimed_at<?))
      AND (a.alert_at, a.id)>(?, ?) ORDER BY a.alert_at, a.id LIMIT ?`, now, now - LATE_MS, now - CLAIM_MS, c < 0 ? 0 : Number(after.slice(0, c)), c < 0 ? "" : after.slice(c + 1), n);
    return rows.map(({ alert_at, ...m }) => ({ k: `${alert_at}:${m.id}`, ...m }));
  },
  // Accounts with model activity in the last day (the billing flag). The message carries the start of that day.
  billing_flag: (env, after, n, now) => all(env, "SELECT DISTINCT tenant_id AS k, tenant_id AS tenant, ? AS since FROM memjob_state WHERE last_activity>? AND tenant_id>? ORDER BY tenant_id LIMIT ?", now - 864e5, now - 864e5, after, n),
};

// One listing run for a kind. memory_sweep lists the namespaces of accounts that no longer exist (computed once per run); billing_flag
// also pushes the "up" heartbeat to the monitor when its pass is complete (an account that flags pushes "down" after it).
export async function listKind(env, kind, now = Date.now(), d = {}) {
  if (kind === "memory_sweep") {
    const doomed = (await doomedPrefixes(env)).map((x) => ({ k: `${x.shard}:${x.prefix}`, ...x })).sort((a, b) => (a.k < b.k ? -1 : 1));
    return listJobs(env, kind, async (after, n) => doomed.filter((x) => x.k > after).slice(0, n), now, null, d);
  }
  // meeting_poll: the next look is claimed only for accounts whose message was sent, so a failed send does not delay them.
  const claim = kind === "meeting_poll" ? (rows) => env.DB.batch(rows.map((r) => env.DB.prepare("INSERT INTO meeting_watch (tenant_id,next_poll_at,updated_at) VALUES (?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET next_poll_at=excluded.next_poll_at, updated_at=excluded.updated_at").bind(r.tenant, now + POLL_MS, now))) : null;
  const r = await listJobs(env, kind, (after, n) => LISTERS[kind](env, after, n, now), now, claim, d);
  if (kind === "billing_flag" && r.done) await billingUp(env, r.sent);
  return r;
}

// ---- running one message ----
// d = { stripe, reconcile, residentOf, ledgerOf } from index.js (they need its Stripe call and its account rows).
const live = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
export async function runAccountJob(env, msg, d = {}) {
  const t = msg.tenant;
  switch (msg.kind) {
    case "reconcile": return d.reconcile(env, t);
    // The account may have been deleted since the listing: the account must still exist and be in the state the listing accepted, else nothing is written.
    case "watchdog": return (await live(env, "SELECT 1 FROM resident_schedules s JOIN tenants t ON t.id=s.tenant_id WHERE s.tenant_id=? AND s.channel=? AND s.next_run IS NOT NULL AND s.next_run<?", t, msg.channel, Date.now() - 120e3))
      && env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t}:${msg.channel}`)).ensure(t, msg.channel, msg.channel_id);
    case "pastdue": return pastdueOne(env, t, { stripe: d.stripe });
    case "cancel": return cancelOne(env, t, { stripe: d.stripe });
    case "bee": return (await live(env, "SELECT 1 FROM bee_accounts b JOIN tenants t ON t.id=b.tenant_id WHERE b.tenant_id=? AND b.status='connected'", t)) && beeStart(env, t, msg.bee_user_id);
    case "storage": return (await live(env, "SELECT 1 FROM tenants WHERE id=? AND status IN ('active','past_due')", t)) && recount(env, t);
    case "meeting_poll": return pollAndSend(env, t);
    case "meeting_alert": return sendOne(env, msg.id);
    case "memory_sweep": return forgetPrefix(env, msg.shard, msg.prefix);
    case "billing_flag": return dailyBillingFlag(env, { since: msg.since, tenant: t, residentOf: d.residentOf, ledgerOf: d.ledgerOf });
    default: throw new Error(`unknown account job ${msg.kind}`);
  }
}

// The queue consumer. A message that throws is retried later (the queue's max_retries bounds it); the dead letter queue's consumer logs one
// line per message that gave up, with the job kind and the tenant id.
export async function accountJobsQueue(batch, env, d) {
  const dead = batch.queue.endsWith("-dlq");
  for (const m of batch.messages) {
    const { kind, tenant } = m.body || {};
    if (dead) { console.error(`ACCOUNT_JOB_DEAD kind=${kind} tenant=${tenant || "-"}`); m.ack(); continue; }
    try { await runAccountJob(env, m.body, d); m.ack(); }
    catch (e) { console.log("account job failed", kind, tenant || "-", `attempt ${m.attempts}`, String(e?.message || e).slice(0, 160)); m.retry({ delaySeconds: Math.min(900, 60 * m.attempts) }); }
  }
}

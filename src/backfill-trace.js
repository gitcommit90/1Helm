// Mem0 backfill progress for Langfuse traces.
//
// Every channel of every real account is backfilled once into Mem0 (hindsight-rebuild.js). This module counts where each channel stands and sends the
// counts as a small numbers-only trace over the app trace path (APP_OTEL_URL and APP_OTEL_TOKEN, the same as turn-trace.js). Nothing is sent without the token.
//
// Where the numbers come from:
//   channels   the Archive of each real account lists its channels (the only full list; D1 has no channel table). A direct message is left out, as
//              hsRebuildAdmin does. The bank ids of these channels are kept in the D1 table backfill_trace (key "banks") so a status change can count
//              without asking every account again. The hourly run refreshes the list.
//   status     D1 hs_rebuild_runs rows with version 2 (the Mem0 backfill), matched to that list by bank id. A channel with no row is not started.
//   test       an account whose owner email is @example.com never enters the list, so it is in no count.
//
// What is sent: one trace named "backfill snapshot". Its root span holds the counts as metadata (numbers only). Each count also has its own span named
// "backfill <series>" whose duration in milliseconds equals the count, because a Langfuse dashboard can take the maximum of a duration per time bucket
// and cannot read a number out of metadata. No tenant, slug, channel name, bank id or any text is sent, and no user id is set.
import { isTestEmail as isTestAccount } from "./test-tenant.js";
import { bankId } from "./mem0.js";
import { REBUILD_VERSION } from "./hindsight-writers.js";
import { sendOtlp, newTraceId, newSpanId } from "./turn-trace.js";

export const SERIES = ["channels_total", "remaining", "not_started", "running", "paused", "failed", "done_ok", "done_mismatch", "sent_total"];
// The metadata keys of the root span, which a trace collector can allow by name.
export const COUNT_KEYS = ["channels_total", "not_started", "running", "paused", "failed", "done_ok", "done_mismatch", "sent_total", "tenants", "unread_tenants"];
export const BACKFILL_KEYS = new Set(["langfuse.observation.type", "langfuse.session.id", "langfuse.trace.name", "langfuse.environment", "langfuse.trace.metadata.kind",
  "langfuse.observation.metadata.kind", ...COUNT_KEYS.flatMap((k) => [`langfuse.trace.metadata.${k}`, `langfuse.observation.metadata.${k}`])]);
const MIN_GAP_MS = 30e3, BANKS_TTL_MS = 2 * 3600e3, TENANT_MS = 4e3, CONCURRENCY = 4, MAX_TENANTS = 2000;
const TABLE = "CREATE TABLE IF NOT EXISTS backfill_trace (k TEXT PRIMARY KEY, v TEXT NOT NULL)";
const jp = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
const raceMs = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error("timed out")), ms); })]).finally(() => clearTimeout(t)); };

// One row of hs_rebuild_runs (or none) -> the series it counts in. A done row is ok only when its verify step said so.
export function classifyRun(row) {
  if (!row || Number(row.version) < REBUILD_VERSION) return "not_started";
  const s = String(row.status || "");
  if (s === "running") return "running";
  if (s === "paused") return "paused";
  if (s === "failed") return "failed";
  if (s === "done") return jp(row.summary)?.report?.ok === true ? "done_ok" : "done_mismatch";
  return "not_started";   // idle, or a status this code does not know
}

// Counts for a list of banks and the rows of hs_rebuild_runs. Each bank counts once. Pure.
export function countBanks(banks, rows) {
  const by = new Map((rows || []).map((r) => [r.bank, r])), c = { channels_total: 0, not_started: 0, running: 0, paused: 0, failed: 0, done_ok: 0, done_mismatch: 0, sent_total: 0 };
  for (const b of new Set(banks)) {
    const row = by.get(b), k = classifyRun(row); c.channels_total++; c[k]++;
    if (row && Number(row.version) >= REBUILD_VERSION) c.sent_total += Math.max(0, Math.round(Number(jp(row.summary)?.sent) || 0));
  }
  c.remaining = c.not_started + c.running + c.paused + c.failed;
  return c;
}

// The banks of every channel of every real account, read from the Archives. unread counts accounts whose Archive did not answer in time.
export async function listBanks(env, { fetchTenants, channelsOf } = {}) {
  const tenants = (await (fetchTenants ? fetchTenants() : env.DB.prepare("SELECT t.id AS id, u.email AS email FROM tenants t LEFT JOIN users u ON u.id=t.owner_user_id ORDER BY t.id LIMIT ?").bind(MAX_TENANTS).all().then((r) => r.results || []))).filter((t) => !isTestAccount(t.email));
  const read = channelsOf || ((tid) => env.ARCHIVE.get(env.ARCHIVE.idFromName(`archive:${tid}`)).channels());
  const banks = [], out = { banks, tenants: tenants.length, unread: 0 };
  for (let i = 0; i < tenants.length; i += CONCURRENCY) {
    await Promise.all(tenants.slice(i, i + CONCURRENCY).map(async (t) => {
      try { for (const c of await raceMs(read(t.id), TENANT_MS)) { const ch = c.slug || c.name; if (ch && c.kind !== "dm") banks.push(bankId(env, t.id, ch)); } } catch { out.unread++; }
    }));
  }
  return out;
}

// The OTLP body. Numbers only: the root has the counts as metadata, and each series has a span whose duration in ms is its count.
export function buildSnapshot(counts, { now = Date.now(), kind = "cron", tenants = 0, unread = 0, traceId = newTraceId() } = {}) {
  const all = { ...counts, tenants, unread_tenants: unread }, root = newSpanId(), spans = [];
  const attr = (k, v) => typeof v === "number" && Number.isInteger(v) ? { key: k, value: { intValue: String(v) } } : { key: k, value: { stringValue: String(v) } };
  const keep = (a) => Object.entries(a).filter(([k, v]) => BACKFILL_KEYS.has(k) && v != null && v !== "").map(([k, v]) => attr(k, v));
  const nano = (ms) => (BigInt(Math.max(0, Math.round(ms))) * 1000000n).toString();
  const rootAttrs = { "langfuse.observation.type": "span", "langfuse.session.id": "backfill", "langfuse.trace.name": "backfill snapshot", "langfuse.trace.metadata.kind": "backfill", "langfuse.observation.metadata.kind": kind };
  for (const k of COUNT_KEYS) { rootAttrs[`langfuse.trace.metadata.${k}`] = all[k] ?? 0; rootAttrs[`langfuse.observation.metadata.${k}`] = all[k] ?? 0; }
  spans.push({ traceId, spanId: root, name: "backfill snapshot", kind: 1, startTimeUnixNano: nano(now), endTimeUnixNano: nano(now), attributes: keep(rootAttrs), status: { code: 1 } });
  for (const s of SERIES) {
    const n = Math.max(0, Math.round(all[s] || 0));
    spans.push({ traceId, spanId: newSpanId(), parentSpanId: root, name: `backfill ${s}`, kind: 1, startTimeUnixNano: nano(now), endTimeUnixNano: nano(now + n),
      attributes: keep({ "langfuse.observation.type": "span", "langfuse.session.id": "backfill" }), status: { code: 1 } });
  }
  return { resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "1helm-app" } }] }, scopeSpans: [{ scope: { name: "1helm.backfill" }, spans }] }] };
}

const getKey = async (env, k) => (await env.DB.prepare("SELECT v FROM backfill_trace WHERE k=?").bind(k).first())?.v ?? null;
const putKey = (env, k, v) => env.DB.prepare("INSERT INTO backfill_trace (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, v).run();

// Count and send one snapshot. kind: "cron" (the hourly run, asks every account for its channels) or "change" (a channel's backfill changed status:
// counts from the saved list of banks, and at most one send every 30 seconds across all channels). Never throws. Nothing is read or sent without the token.
export async function sendBackfillSnapshot(env, { kind = "cron", now = Date.now(), fetchImpl, deps } = {}) {
  try {
    if (!env?.APP_OTEL_URL || !env?.APP_OTEL_TOKEN || !env?.DB) return { skipped: "no token" };
    await env.DB.prepare(TABLE).run();
    if (kind === "change") {
      const last = Number(await getKey(env, "last_sent")) || 0;
      if (now - last < MIN_GAP_MS) return { skipped: "sent a moment ago" };
      await putKey(env, "last_sent", String(now));   // claimed before the work, so a burst of changes sends once
    }
    let saved = jp(await getKey(env, "banks"));
    if (kind === "cron" || !saved || now - Number(saved.at) > BANKS_TTL_MS) { const l = await listBanks(env, deps); saved = { at: now, banks: l.banks, tenants: l.tenants, unread: l.unread }; await putKey(env, "banks", JSON.stringify(saved)); }
    const rows = (await env.DB.prepare("SELECT bank, status, version, summary FROM hs_rebuild_runs WHERE version>=?").bind(REBUILD_VERSION).all().catch(() => ({ results: [] }))).results || [];
    const counts = countBanks(saved.banks, rows), body = buildSnapshot(counts, { now, kind, tenants: saved.tenants, unread: saved.unread });
    if (kind === "cron") await putKey(env, "last_sent", String(now));
    const sent = await sendOtlp(env, body, fetchImpl);
    return { sent, kind, counts };
  } catch (e) { return { error: String(e?.message || e).slice(0, 120) }; }
}

// Storage per account (Captain 10-06). Everything an account keeps in R2 lives under t/<tenantId>/ and counts against its limit:
//   included storage for the plan + extra 100 GB blocks bought = the limit.
//   Personal 100 GB · Plus 250 GB · Power 500 GB · Max 1 TB · BYOK 100 GB. A block is R2's raw price + 15%, rounded UP to a whole dollar.
//
// Counting: every R2 put/delete/multipart-complete under t/<tenant>/ goes through the helpers here (stPut, stDelete, stDeleteListed,
// stComplete), which keep a running counter in D1 storage_usage (bytes + objects per tenant and kind). A full recount (list the
// prefix) corrects drift: hourly cron for accounts not counted in a day, and on demand when the Usage page sees a stale count.
// test/storage.test.mjs fails if a new R2 write appears outside these helpers.
//
// Limit: at 80% one plain notice; at 100% writes that add storage are refused (uploads, the helper saving files, screenshots, published
// pages, a computer save that would grow past the limit). Reading and deleting always work; nothing is ever deleted automatically.
// A refused computer save keeps the previous save (nothing half-written becomes current) and the helper is told.
export const GB = 1e9;                            // decimal, like R2's own billing: 1 GB = 10^9 bytes, 1 TB = 1000 GB
export const BLOCK_GB = 100;
export const R2_USD_PER_GB_MONTH = 0.015;         // R2 Standard storage, per GB-month (developers.cloudflare.com/r2/pricing)
export const STORAGE_MARKUP = 1.15;
export const MAX_BLOCKS = 100;                    // 10 TB extra: a typo guard, not a business limit
export const NOTICE_PCT = 80;
export const RECOUNT_MS = 24 * 3600e3;
export const INCLUDED_GB = { personal: 100, plus: 250, power: 500, max: 1000, byok: 100 };
export const KINDS = ["files", "computer", "pages", "other"];
export const KIND_LABEL = { files: "Files", computer: "Computer", pages: "Pages & shares", other: "Other" };

// "+100 GB for $2/month": ceil(R2 price × 100 GB × 1.15). Rounded to micro-dollars first so float noise can't add a dollar.
export function blockPriceUsd({ r2 = R2_USD_PER_GB_MONTH, markup = STORAGE_MARKUP, gb = BLOCK_GB } = {}) {
  return Math.ceil(Math.round(r2 * gb * markup * 1e6) / 1e6);
}
export const BLOCK_USD = blockPriceUsd();
// The Stripe price is found (or made) by this key, so a new R2 price or markup gives a new Stripe price by itself.
export const blockLookupKey = (usd = BLOCK_USD, gb = BLOCK_GB) => `1hc_storage_${gb}gb_month_${Math.round(usd * 100)}c`;

export const includedGb = (plan) => INCLUDED_GB[plan] ?? INCLUDED_GB.plus;   // like index.js planKey: unknown → plus
export function fmtBytes(b) {
  b = Math.max(0, Number(b) || 0);
  if (b >= 1000 * GB) { const v = b / (1000 * GB); return `${+v.toFixed(v >= 10 ? 0 : 1)} TB`; }
  if (b >= GB) { const v = b / GB; return `${v >= 100 ? Math.round(v) : +v.toFixed(1)} GB`; }
  if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${b} B`;
}
export const fmtGb = (gb) => gb >= 1000 && gb % 1000 === 0 ? `${gb / 1000} TB` : `${gb} GB`;

// t/<tenant>/<area>/… → whose bytes, and which line of the breakdown.
export function keyInfo(key) {
  const m = /^t\/([^/]+)\/([^/]+)\//.exec(String(key || "")); if (!m) return null;
  const a = m[2];
  return { tenant: m[1], kind: a === "files" ? "files" : a === "c" || a === "ckpt" ? "computer" : a === "pages" ? "pages" : "other" };
}

// ---------------------------------------------------------------- the counter ----------------------------------------------------------------
async function bump(env, tenant, kind, bytes, objects) {
  if (!env.DB || (!bytes && !objects)) return;
  try {
    await env.DB.prepare(`INSERT INTO storage_usage (tenant_id, kind, bytes, objects) VALUES (?,?,MAX(0,?),MAX(0,?))
      ON CONFLICT(tenant_id, kind) DO UPDATE SET bytes=MAX(0, bytes + ?), objects=MAX(0, objects + ?)`).bind(tenant, kind, bytes, objects, bytes, objects).run();
  } catch (e) { console.log("storage counter", tenant, kind, e.message); }   // never fails a write; the recount corrects it
}
const sizeOf = (body) => body == null ? 0 : typeof body === "string" ? new TextEncoder().encode(body).byteLength : body.byteLength ?? body.size ?? null;

// The one way to put an object. check: refuse (StorageFull) when the account has no room for it. replace: the key may already
// exist, so its old size is taken off first.
export async function stPut(env, key, body, opts = {}, { check = false, size = null, replace = false } = {}) {
  const info = keyInfo(key), n = size ?? sizeOf(body);
  let old = 0, hadOld = false;
  if (replace && info) { try { const head = await env.WS.head(key); if (head) { old = Number(head.size) || 0; hadOld = true; } } catch {} }
  // A replacement uses only its net growth. Shrinking is allowed even when the account is already full.
  if (check && info && n != null && (!replace || n > old)) await assertRoom(env, info.tenant, replace ? n - old : n);
  const o = await env.WS.put(key, body, opts);
  if (info) await bump(env, info.tenant, info.kind, Number(o?.size ?? n ?? 0) - old, hadOld ? 0 : 1);
  return o;
}
// A finished multipart upload.
export async function stComplete(env, key, mpu, parts) {
  const o = await mpu.complete(parts), info = keyInfo(key);
  if (info) await bump(env, info.tenant, info.kind, Number(o?.size ?? (await env.WS.head(key))?.size ?? 0), 1);
  return o;
}
// Delete keys (strings, or { key, size } when the size is already known; unknown sizes are looked up first). Missing keys are fine.
export async function stDelete(env, items) {
  const list = [...new Map((items || []).filter(Boolean).map((x) => typeof x === "string" ? [x, { key: x, size: null }] : [x.key, { key: x.key, size: x.size ?? null }])).values()].filter((x) => x.key);
  for (let i = 0; i < list.length; i += 50) await Promise.all(list.slice(i, i + 50).filter((x) => x.size == null).map(async (x) => { let h = null; try { h = await env.WS.head(x.key); } catch {} x.size = h ? h.size : -1; }));
  for (let i = 0; i < list.length; i += 1000) await env.WS.delete(list.slice(i, i + 1000).map((x) => x.key));
  await countGone(env, list.filter((x) => x.size >= 0));
  return list.length;
}
// Objects from an R2 list() (they carry their size), already known to exist.
export async function stDeleteListed(env, objects) {
  const list = (objects || []).map((o) => ({ key: o.key, size: Number(o.size) || 0 }));
  for (let i = 0; i < list.length; i += 1000) await env.WS.delete(list.slice(i, i + 1000).map((x) => x.key));
  await countGone(env, list); return list.length;
}
async function countGone(env, list) {
  const by = new Map();
  for (const x of list) { const info = keyInfo(x.key); if (!info) continue; const k = `${info.tenant}\n${info.kind}`, v = by.get(k) || [0, 0]; v[0] += x.size; v[1]++; by.set(k, v); }
  for (const [k, [b, n]] of by) { const [tenant, kind] = k.split("\n"); await bump(env, tenant, kind, -b, -n); }
}

// Full recount: list t/<tenant>/ and set the counter to what is really there. → { bytes, by, objects, drift }
export async function recount(env, tenantId) {
  const by = Object.fromEntries(KINDS.map((k) => [k, { bytes: 0, objects: 0 }]));
  let cursor;
  for (let i = 0; i < 100000; i++) {
    const l = await env.WS.list({ prefix: `t/${tenantId}/`, cursor, limit: 1000 });
    for (const o of l.objects || []) { const k = keyInfo(o.key)?.kind || "other"; by[k].bytes += Number(o.size) || 0; by[k].objects++; }
    if (!l.truncated) break; cursor = l.cursor;
  }
  const before = await usedBytes(env, tenantId);
  for (const k of KINDS) await env.DB.prepare(`INSERT INTO storage_usage (tenant_id, kind, bytes, objects) VALUES (?,?,?,?) ON CONFLICT(tenant_id, kind) DO UPDATE SET bytes=excluded.bytes, objects=excluded.objects`)
    .bind(tenantId, k, by[k].bytes, by[k].objects).run();
  await ensurePlanRow(env, tenantId);
  await env.DB.prepare("UPDATE storage_plan SET counted_at=? WHERE tenant_id=?").bind(Date.now(), tenantId).run();
  const bytes = KINDS.reduce((a, k) => a + by[k].bytes, 0);
  return { bytes, by: Object.fromEntries(KINDS.map((k) => [k, by[k].bytes])), objects: KINDS.reduce((a, k) => a + by[k].objects, 0), drift: bytes - before };
}
// Cron: the accounts counted longest ago (never first), a few per run.
export async function recountStale(env, { limit = 20, maxAge = RECOUNT_MS } = {}) {
  const rows = (await env.DB.prepare(`SELECT t.id FROM tenants t LEFT JOIN storage_plan s ON s.tenant_id=t.id WHERE t.status IN ('active','past_due') AND COALESCE(s.counted_at,0) < ?
    ORDER BY COALESCE(s.counted_at,0) LIMIT ?`).bind(Date.now() - maxAge, limit).all()).results || [];
  let fixed = 0, drift = 0;
  for (const r of rows) { try { const c = await recount(env, r.id); if (c.drift) { fixed++; drift += Math.abs(c.drift); } } catch (e) { console.log("storage recount", r.id, e.message); } }
  return { checked: rows.length, fixed, drift };
}

// ---------------------------------------------------------------- the limit ----------------------------------------------------------------
async function ensurePlanRow(env, tenantId) { await env.DB.prepare("INSERT OR IGNORE INTO storage_plan (tenant_id, blocks, updated_at) VALUES (?,0,?)").bind(tenantId, Date.now()).run(); }
export async function usedBytes(env, tenantId) {
  return Number((await env.DB.prepare("SELECT COALESCE(SUM(bytes),0) b FROM storage_usage WHERE tenant_id=?").bind(tenantId).first())?.b || 0);
}
// t: the tenants row (id, plan). → everything the Usage page and the limit need.
export async function storageOf(env, t) {
  const rows = (await env.DB.prepare("SELECT kind, bytes FROM storage_usage WHERE tenant_id=?").bind(t.id).all()).results || [];
  const p = await env.DB.prepare("SELECT * FROM storage_plan WHERE tenant_id=?").bind(t.id).first() || {};
  const by = Object.fromEntries(KINDS.map((k) => [k, 0])); for (const r of rows) by[KINDS.includes(r.kind) ? r.kind : "other"] += Number(r.bytes) || 0;
  const selfHosted = env.ONEHELM_EE !== "1hc";
  const configuredGb = Number(env.SELFHOST_STORAGE_GB);
  const used = KINDS.reduce((a, k) => a + by[k], 0), inc = selfHosted && Number.isInteger(configuredGb) && configuredGb >= 1 && configuredGb <= 1_000_000 ? configuredGb : selfHosted ? 100 : includedGb(t.plan);
  const blocks = selfHosted ? 0 : Math.max(0, Number(p.blocks) || 0);
  const limit = (inc + blocks * BLOCK_GB) * GB;
  const pct = limit ? Math.min(100, Math.floor(used / limit * 1000) / 10) : 100;
  return { used, by, included_gb: inc, blocks, block_gb: BLOCK_GB, block_usd: BLOCK_USD, limit, pct, full: used >= limit, selfHosted,
    counted_at: Number(p.counted_at) || null, notice_seen: Number(p.notice_seen) || 0, refused_at: Number(p.refused_at) || null, refused_what: p.refused_what || null };
}
// The person-facing words.
export const usedLine = (s) => `${fmtBytes(s.used)} of ${fmtBytes(s.limit)}`;
export const fullMessage = (s) => `Your storage is full (${usedLine(s)} used), so this wasn't saved. Nothing was deleted. ${s.selfHosted ? "Raise this server's storage limit in its configuration, or delete files you don't need." : "Add storage in Settings → General → Usage, or delete files you don't need."}`;
export const fullToolNote = (s) => `error: storage is full (${usedLine(s)} used), so this wasn't saved. Nothing was deleted. Tell the person in one or two plain sentences that their storage is full and that they can ${s.selfHosted ? "raise this server's storage limit in its configuration or delete files they no longer need." : "add more in Settings → General → Usage (Add storage) or delete files they no longer need."}`;
export class StorageFull extends Error {
  constructor(s) { super(fullMessage(s)); this.code = "storage_full"; this.status = 507; this.storage = s; this.toolNote = fullToolNote(s); }
}
// Is there room for `add` more bytes? → the storage state + ok.
// Fails open: if the count can't be read (no D1, a missing table), the write goes ahead and the recount catches up.
export async function room(env, tenantId, add = 0) {
  try {
    const t = env.DB && tenantId ? await env.DB.prepare("SELECT id, plan FROM tenants WHERE id=?").bind(tenantId).first() : null;
    if (!t) return { ok: true, unknown: true };   // not an account (tests, imports before the row exists): never block
    const s = await storageOf(env, t);
    return { ...s, ok: s.used + Math.max(0, Number(add) || 0) <= s.limit };
  } catch (e) { console.log("storage room", tenantId, e.message); return { ok: true, unknown: true }; }
}
export async function assertRoom(env, tenantId, add) { const r = await room(env, tenantId, add); if (!r.ok) { await noteRefused(env, tenantId, "file"); throw new StorageFull(r); } return r; }
// A refused write (a computer save, mostly): shown once in the app as the "storage is full" notice.
export async function noteRefused(env, tenantId, what) {
  try { await ensurePlanRow(env, tenantId); await env.DB.prepare("UPDATE storage_plan SET refused_at=?, refused_what=? WHERE tenant_id=?").bind(Date.now(), String(what || "").slice(0, 40), tenantId).run(); } catch (e) { console.log("storage refused note", e.message); }
}
export async function clearRefused(env, tenantId) {
  try { await env.DB.prepare("UPDATE storage_plan SET refused_at=NULL, refused_what=NULL WHERE tenant_id=? AND refused_at IS NOT NULL").bind(tenantId).run(); } catch {}
}
// The app's one-time notice: 80 (getting full) or 100 (full, or a save was refused). Seen = not shown again until it drops below 80%.
export function noticeOf(s) {
  const level = s.full || s.refused_at ? 100 : s.pct >= NOTICE_PCT ? 80 : 0;
  if (!level || s.notice_seen >= level) return null;
  if (s.selfHosted) return level === 100
    ? { level, title: "Your storage is full", text: `${usedLine(s)} used. New files and computer saves are paused until you raise this server's storage limit or delete files you don't need. Nothing has been deleted.` }
    : { level, title: "Your storage is getting full", text: `${usedLine(s)} used (${Math.floor(s.pct)}%). You can raise this server's storage limit in its configuration or delete files you don't need.` };
  return level === 100
    ? { level, title: "Your storage is full", text: `${usedLine(s)} used. New files and computer saves are paused until you add storage or delete files you don't need. Nothing has been deleted.` }
    : { level, title: "Your storage is getting full", text: `${usedLine(s)} used (${Math.floor(s.pct)}%). You can add 100 GB for $${s.block_usd}/month in Settings → General → Usage.` };
}
export async function noticeSeen(env, t) {
  const s = await storageOf(env, t), n = noticeOf(s); await ensurePlanRow(env, t.id);
  await env.DB.prepare("UPDATE storage_plan SET notice_seen=? WHERE tenant_id=?").bind(n ? n.level : s.notice_seen, t.id).run();
  return { ok: true };
}
// Usage dropped back under 80% (deleted files, added storage): the notice can show again next time.
export async function rearmNotice(env, t) {
  const s = await storageOf(env, t);
  if (s.notice_seen && s.pct < NOTICE_PCT && !s.refused_at) await env.DB.prepare("UPDATE storage_plan SET notice_seen=0 WHERE tenant_id=?").bind(t.id).run();
  return s;
}
// What the app gets at boot and from GET /api/storage.
export function storageView(s, plans = {}) {
  if (s.selfHosted) return { used: s.used, limit: s.limit, pct: s.pct, full: s.full, by: s.by, labels: KIND_LABEL,
    used_text: fmtBytes(s.used), limit_text: fmtBytes(s.limit), counted_at: s.counted_at, notice: noticeOf(s) };
  return { used: s.used, limit: s.limit, pct: s.pct, full: s.full, by: s.by, labels: KIND_LABEL, included_gb: s.included_gb, blocks: s.blocks, block_gb: s.block_gb, block_usd: s.block_usd,
    used_text: fmtBytes(s.used), limit_text: fmtBytes(s.limit), counted_at: s.counted_at, notice: noticeOf(s),
    plans: Object.entries(plans).map(([k, p]) => ({ key: k, name: p.name, price: p.price, usage: p.usage, fit: p.fit || "", storage_gb: includedGb(k), storage_text: fmtGb(includedGb(k)) })) };
}

// ---------------------------------------------------------------- billing: blocks as a quantity on the plan's subscription ----------------------------------------------------------------
// Stripe (TEST mode on dev): product "1Helm Extra storage" (metadata app=1hc, kind=storage), monthly price with lookup_key blockLookupKey().
// Adding blocks charges the prorated amount now (always_invoice) and only takes effect if that payment succeeds (pending_if_incomplete);
// removing blocks credits the unused time on the next bill (create_prorations). Stripe's subscription is the truth: D1 storage_plan.blocks
// follows it here, from the webhook (customer.subscription.updated) and from the hourly reconcile.
export const isStorageItem = (i) => i?.price?.metadata?.kind === "storage" || String(i?.price?.lookup_key || "").startsWith("1hc_storage_");
export const storageItemOf = (sub) => (sub?.items?.data || []).find(isStorageItem) || null;
export const blocksOfSub = (sub) => Number(storageItemOf(sub)?.quantity || 0);
let priceCache = null;
export const _resetPriceCache = () => { priceCache = null; };
export async function storagePrice(env, stripe) {
  const lk = blockLookupKey();
  if (priceCache?.lk === lk) return priceCache.id;
  let p = (await stripe(env, `prices?lookup_keys[]=${encodeURIComponent(lk)}&active=true&limit=1`, {}, "GET")).data?.[0];
  if (!p) {
    const prods = (await stripe(env, "products?active=true&limit=100", {}, "GET")).data || [];
    let prod = prods.find((x) => x.metadata?.app === "1hc" && x.metadata?.kind === "storage");
    if (!prod) prod = await stripe(env, "products", { name: "1Helm Extra storage", description: `${BLOCK_GB} GB of extra storage per block, monthly.`, statement_descriptor: "1HELM STORAGE", metadata: { app: "1hc", kind: "storage", block_gb: BLOCK_GB } });
    p = await stripe(env, "prices", { product: prod.id, currency: "usd", unit_amount: Math.round(BLOCK_USD * 100), "recurring[interval]": "month", lookup_key: lk, transfer_lookup_key: "true", nickname: `+${BLOCK_GB} GB storage`, metadata: { app: "1hc", kind: "storage", block_gb: BLOCK_GB } });
  }
  priceCache = { lk, id: p.id }; return p.id;
}
export async function syncBlocks(env, tenantId, sub) {
  if (!sub || !tenantId) return null;
  const it = storageItemOf(sub), n = Number(it?.quantity || 0);
  await ensurePlanRow(env, tenantId);
  await env.DB.prepare("UPDATE storage_plan SET blocks=?, stripe_item=?, updated_at=? WHERE tenant_id=?").bind(n, it?.id || null, Date.now(), tenantId).run();
  return n;
}
// Set the number of extra blocks. → { ok, blocks, storage } | { error, status }
export async function setBlocks(env, t, want, { stripe }) {
  want = Number(want);
  if (!Number.isInteger(want) || want < 0 || want > MAX_BLOCKS) return { error: `Choose between 0 and ${MAX_BLOCKS} extra blocks.`, status: 400 };
  const s = await storageOf(env, t), newLimit = (s.included_gb + want * BLOCK_GB) * GB;
  if (want < s.blocks && newLimit < s.used)
    return { error: `You're using ${fmtBytes(s.used)}, so your storage can't go below that. With ${want} extra block${want === 1 ? "" : "s"} you'd have ${fmtBytes(newLimit)}. Delete files you don't need first, then remove the block.`, status: 409, storage: s };
  if (!t.stripe_subscription) return { error: "There's no active plan to add storage to yet.", status: 409 };
  let sub = await stripe(env, `subscriptions/${t.stripe_subscription}`, {}, "GET");
  if (!["active", "trialing", "past_due"].includes(sub.status)) return { error: "Your plan isn't active, so storage can't be changed right now.", status: 409 };
  if (want > s.blocks && sub.status === "past_due") return { error: "Your last payment didn't go through. Fix your payment first, then add storage.", status: 402 };
  const it = storageItemOf(sub), cur = Number(it?.quantity || 0);
  if (want !== cur) {
    const price = await storagePrice(env, stripe), md = { "metadata[app]": "1hc-proto", "metadata[kind]": "storage" };
    if (want > cur) {
      const pay = { quantity: want, proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete" };
      if (it) await stripe(env, `subscription_items/${it.id}`, { ...pay, ...(it.price?.id !== price ? { price } : {}) });
      else await stripe(env, "subscription_items", { subscription: sub.id, price, ...pay, ...md });
    } else if (want === 0) await stripe(env, `subscription_items/${it.id}`, { proration_behavior: "create_prorations" }, "DELETE");
    else await stripe(env, `subscription_items/${it.id}`, { quantity: want, proration_behavior: "create_prorations" });
    sub = await stripe(env, `subscriptions/${t.stripe_subscription}`, {}, "GET");
  }
  const got = await syncBlocks(env, t.id, sub);
  if (got > s.blocks) await clearRefused(env, t.id);
  const after = await rearmNotice(env, t);
  if (got !== want) return { error: sub.pending_update ? "Your card didn't go through, so no storage was added. Update your card (Change plan → Manage billing) and try again." : "Stripe didn't make that change. Try again in a minute.", status: 402, blocks: got, storage: after };
  return { ok: true, blocks: got, storage: after };
}

// Daily billing flag. Read-only: it never changes a charge, a balance or a saved price. Once a day (index.js scheduled, 10:17 UTC) it looks for
//   1. price_unknown events: a step was settled at the reservation ceiling because the model had no saved price (resident.js, ambient.js), and
//   2. turns charged more than 10 times their list-price estimate: tokens times the model's saved /models price, times 1.15 (the markup);
//      cache reads are priced at the saved cache-read price when the catalog has one, otherwise at the input price.
// The result goes to the Worker log ("BILLING flag ..."), to an Uptime Kuma push monitor when env.BILLING_FLAG_PUSH is set, and
// to GET /_ops/billing-flag on dev (ops-read.js).
export const FLAG_RATIO = 10, FLAG_MARKUP = 1.15, FLAG_MIN_CHARGE = 1e6;   // nano$: a charge under $0.001 is never flagged (rounding noise)
const num = (n) => (Number.isFinite(Number(n)) && Number(n) >= 0 && n !== null && n !== "" ? Number(n) : null);

// The saved price of a model in nano-dollars per token: { in, out, cacheRead } (cacheRead null when none is saved), or null.
export function listPrice(catalog, model) {
  const name = String(model || "").replace(/ \[.*\]$/, ""), p = catalog?.[name]?.pricing || (catalog && catalog.id === name ? catalog.pricing : null);
  const i = num(p?.prompt), o = num(p?.completion), c = num(p?.input_cache_read);
  return i != null && o != null ? { in: i * 1000, out: o * 1000, cacheRead: c != null ? c * 1000 : null } : null;
}

// Turns (rows of the turns table) charged over FLAG_RATIO times their estimate. A turn that used several models is estimated at the dearest
// saved price among them, so a mixed turn is never flagged because of the cheaper model. A turn with no saved price is skipped here.
export function flagTurns(rows, catalog, { ratio = FLAG_RATIO } = {}) {
  const out = [];
  for (const r of rows || []) {
    let models = []; try { models = JSON.parse(r.models || "[]"); } catch {}
    const prices = models.map((m) => listPrice(catalog, m)).filter(Boolean).sort((a, b) => (b.in + b.out) - (a.in + a.out));
    const p = prices[0], charge = Number(r.charge_nano) || 0;
    if (!p || charge < FLAG_MIN_CHARGE) continue;
    const cached = Math.min(Number(r.cached_tok) || 0, Number(r.in_tok) || 0), fresh = (Number(r.in_tok) || 0) - cached;
    const est = Math.ceil((fresh * p.in + cached * (p.cacheRead ?? p.in) + (Number(r.out_tok) || 0) * p.out) * FLAG_MARKUP);
    if (est > 0 && charge > ratio * est) out.push({ turn: r.id, at: r.at, kind: r.kind || null, models: [...new Set(models.map((m) => String(m).replace(/ \[.*\]$/, "")))], charge_nano: charge, estimate_nano: est, ratio: Math.round(charge / est * 10) / 10 });
  }
  return out;
}

// All accounts and channels with activity since `since`. residentOf(tenantId, channel) and ledgerOf(tenantId) return the Durable Object stubs.
export async function scanBilling(env, { since, residentOf, ledgerOf, maxChannels = 300 }) {
  const rows = (await env.DB.prepare("SELECT s.tenant_id, s.channel, t.slug FROM memjob_state s JOIN tenants t ON t.id=s.tenant_id WHERE s.last_activity > ? ORDER BY s.tenant_id, s.channel").bind(since).all().catch(() => ({ results: [] }))).results || [];
  const found = { since, channels: Math.min(rows.length, maxChannels), capped: rows.length > maxChannels, price_unknown: [], over_estimate: [], errors: 0, error_samples: [] };
  const todo = rows.slice(0, maxChannels), tenants = new Map(rows.map((r) => [r.tenant_id, r.slug]));
  const work = [...tenants].map(([tid, slug]) => Object.assign(async () => {
    for (const e of (await ledgerOf(tid).resEvents(since)) || []) if (e.kind === "price_unknown") found.price_unknown.push({ slug, id: e.id, nano: e.nano, at: e.at });
  }, { label: `${slug} ledger` })).concat(todo.map((r) => Object.assign(async () => {
    for (const t of (await residentOf(r.tenant_id, r.channel).billingFlags(since)) || []) found.over_estimate.push({ slug: r.slug, channel: r.channel, ...t });
  }, { label: `${r.slug} ${r.channel}` })));
  await Promise.all(Array.from({ length: 4 }, async () => { for (let w; (w = work.shift());) { try { await w(); } catch (e) { found.errors++; if (found.error_samples.length < 5) found.error_samples.push(`${w.label}: ${String(e?.message || e).slice(0, 100)}`); console.log("billing flag scan", String(e?.message || e).slice(0, 120)); } } }));
  found.flagged = found.price_unknown.length + found.over_estimate.length;
  return found;
}

// One line for the log and for the Kuma push message. No message text, no names beyond the account slug.
export const flagLine = (f) => f.flagged ? `${f.price_unknown.length} price_unknown, ${f.over_estimate.length} over ${FLAG_RATIO}x estimate (${[...new Set([...f.price_unknown, ...f.over_estimate].map((x) => x.slug))].slice(0, 5).join(", ")})` : `none (${f.channels} channels checked)`;

// The daily run: log it, and push it to Uptime Kuma when a push URL is set (the URL has no query string; status and msg are added).
export async function dailyBillingFlag(env, opts) {
  const f = await scanBilling(env, opts), line = flagLine(f);
  console.log("BILLING flag", f.flagged ? "FLAGGED" : "ok", line, f.flagged ? JSON.stringify({ price_unknown: f.price_unknown.slice(0, 20), over_estimate: f.over_estimate.slice(0, 20) }) : "");
  if (env.BILLING_FLAG_PUSH) { try { await fetch(`${env.BILLING_FLAG_PUSH}?status=${f.flagged ? "down" : "up"}&msg=${encodeURIComponent(line.slice(0, 200))}`); } catch (e) { console.log("billing flag push failed", String(e?.message || e).slice(0, 80)); } }
  return f;
}

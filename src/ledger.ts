import { DurableObject } from "cloudflare:workers";
import { now, rand } from "./util";

// Money is integer micro-USD. The customer's balance can never go negative:
// every model call reserves its worst-case price first and settles at <= that reservation.
export class TenantDO extends DurableObject {
  sql: any;
  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS buckets (name TEXT PRIMARY KEY, micro INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger (key TEXT PRIMARY KEY, kind TEXT NOT NULL, micro INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, micro INTEGER NOT NULL, expires_at INTEGER NOT NULL, channel TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS paused (channel TEXT PRIMARY KEY, at INTEGER NOT NULL);
      INSERT OR IGNORE INTO buckets VALUES ('included', 0), ('topup', 0);`);
  }
  private get(name: string): number { return Number(this.sql.exec("SELECT micro FROM buckets WHERE name=?", name).one().micro); }
  private set(name: string, v: number) { this.sql.exec("UPDATE buckets SET micro=? WHERE name=?", v, name); }
  private reserved(): number { return Number(this.sql.exec("SELECT COALESCE(SUM(micro),0) s FROM reservations").one().s); }
  private meta(k: string, v?: string) {
    if (v === undefined) return (this.sql.exec("SELECT v FROM meta WHERE k=?", k).toArray()[0]?.v as string) ?? "";
    this.sql.exec("INSERT INTO meta VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, v);
  }

  async state() {
    const included = this.get("included"), topup = this.get("topup"), reserved = this.reserved();
    const allowance = Number(this.meta("period_allowance") || 0);
    const spent = Number(this.meta("period_spent") || 0);
    return { included, topup, reserved, available: included + topup - reserved, allowance, period_spent: spent,
      period_end: Number(this.meta("period_end") || 0), pct_used: allowance ? Math.min(100, Math.round((spent / allowance) * 100)) : 0,
      paused: this.sql.exec("SELECT channel FROM paused").toArray().map((r: any) => r.channel) };
  }

  // Idempotent: a replayed Stripe event with the same key never credits twice.
  async grantIncluded(key: string, micro: number, periodEnd: number) {
    if (this.sql.exec("SELECT 1 FROM ledger WHERE key=?", key).toArray().length) return { duplicate: true, ...(await this.state()) };
    const expired = this.get("included");
    this.ctx.storage.transactionSync(() => {
      if (expired) this.sql.exec("INSERT INTO ledger VALUES (?,?,?,?,?)", `${key}:expire`, "included_expire", -expired, "no rollover", now());
      this.sql.exec("INSERT INTO ledger VALUES (?,?,?,?,?)", key, "included_grant", micro, "", now());
      this.set("included", micro);
      this.meta("period_allowance", String(micro)); this.meta("period_spent", "0"); this.meta("period_end", String(periodEnd));
    });
    this.ctx.waitUntil(this.resumePaused());
    return { duplicate: false, ...(await this.state()) };
  }
  async grantTopup(key: string, micro: number) {
    if (this.sql.exec("SELECT 1 FROM ledger WHERE key=?", key).toArray().length) return { duplicate: true, ...(await this.state()) };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO ledger VALUES (?,?,?,?,?)", key, "topup_grant", micro, "", now());
      this.set("topup", this.get("topup") + micro);
    });
    this.ctx.waitUntil(this.resumePaused());
    return { duplicate: false, ...(await this.state()) };
  }

  // Synchronous body: no await between the check and the insert, so concurrent calls cannot both pass.
  async reserve(micro: number, channel: string, ttlMs = 5 * 60_000) {
    const available = this.get("included") + this.get("topup") - this.reserved();
    if (micro <= 0 || available < micro) {
      this.sql.exec("INSERT OR IGNORE INTO paused VALUES (?,?)", channel, now());
      return { ok: false, available };
    }
    const id = rand(12);
    this.sql.exec("INSERT INTO reservations VALUES (?,?,?,?)", id, micro, now() + ttlMs, channel);
    const next = await this.ctx.storage.getAlarm();
    if (!next || next > now() + ttlMs) await this.ctx.storage.setAlarm(now() + ttlMs + 1000);
    return { ok: true, id, available: available - micro };
  }
  async settle(id: string, actualMicro: number, note = "") {
    const r = this.sql.exec("SELECT micro FROM reservations WHERE id=?", id).toArray()[0];
    if (!r) return { ok: false, reason: "unknown or expired reservation" };
    const charge = Math.max(0, Math.min(Math.ceil(actualMicro), Number(r.micro)));
    this.ctx.storage.transactionSync(() => {
      let inc = this.get("included"), top = this.get("topup");
      const fromIncluded = Math.min(inc, charge); inc -= fromIncluded; top -= charge - fromIncluded;
      this.set("included", inc); this.set("topup", top);
      this.sql.exec("DELETE FROM reservations WHERE id=?", id);
      this.sql.exec("INSERT INTO ledger VALUES (?,?,?,?,?)", `use:${id}`, "usage", -charge, note, now());
      this.meta("period_spent", String(Number(this.meta("period_spent") || 0) + charge));
    });
    return { ok: true, charged: charge, ...(await this.state()) };
  }
  async release(id: string) { this.sql.exec("DELETE FROM reservations WHERE id=?", id); return { ok: true }; }
  async alarm() {
    // A crashed call never settled: charge the full reservation (the worst case was already allowed).
    for (const r of this.sql.exec("SELECT id, micro FROM reservations WHERE expires_at<=?", now()).toArray()) await this.settle(r.id as string, Number(r.micro), "expired reservation");
    const next = this.sql.exec("SELECT MIN(expires_at) m FROM reservations").one().m;
    if (next) await this.ctx.storage.setAlarm(Number(next) + 1000);
  }
  async setTenant(tenantId: string, slug: string) { this.meta("tenant_id", tenantId); this.meta("slug", slug); }
  private async resumePaused() {
    const env: any = this.env; const slug = this.meta("slug"); const tenant = this.meta("tenant_id");
    const rows = this.sql.exec("SELECT channel FROM paused").toArray();
    this.sql.exec("DELETE FROM paused");
    for (const r of rows) {
      const ch = env.CHANNEL.get(env.CHANNEL.idFromName(`${tenant}:${r.channel}`));
      await ch.resume(tenant, slug, r.channel).catch(() => {});
    }
  }
  async ledgerTail(n = 20) { return this.sql.exec("SELECT * FROM ledger ORDER BY at DESC LIMIT ?", n).toArray(); }
}

// One global object: a hard stop on total platform AI spend, independent of any tenant bug.
export class PlatformDO extends DurableObject {
  sql: any;
  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env); this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS spend (k TEXT PRIMARY KEY, micro INTEGER NOT NULL); INSERT OR IGNORE INTO spend VALUES ('total',0),('held',0),('killed',0);`);
  }
  private v(k: string) { return Number(this.sql.exec("SELECT micro FROM spend WHERE k=?", k).one().micro); }
  async hold(micro: number, capMicro: number) {
    if (this.v("killed")) return { ok: false, reason: "kill switch on" };
    if (this.v("total") + this.v("held") + micro > capMicro) return { ok: false, reason: "platform spend cap reached" };
    this.sql.exec("UPDATE spend SET micro=micro+? WHERE k='held'", micro); return { ok: true };
  }
  async commit(heldMicro: number, costMicro: number) {
    this.sql.exec("UPDATE spend SET micro=MAX(0,micro-?) WHERE k='held'", heldMicro);
    this.sql.exec("UPDATE spend SET micro=micro+? WHERE k='total'", Math.ceil(costMicro)); return { ok: true };
  }
  async kill(on: boolean) { this.sql.exec("UPDATE spend SET micro=? WHERE k='killed'", on ? 1 : 0); return this.status(); }
  async status() { return { total_cost_micro: this.v("total"), held_micro: this.v("held"), killed: !!this.v("killed") }; }
}

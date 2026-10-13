import { DurableObject } from "cloudflare:workers";
import { tolerantEnv } from "../do-stub.js";

// One per tenant: single-writer ledger, so concurrent calls can't overspend.
export class Ledger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = tolerantEnv(env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS grants (key TEXT PRIMARY KEY, nano INTEGER NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS res (id TEXT PRIMARY KEY, nano INTEGER NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS spend (id TEXT PRIMARY KEY, nano INTEGER NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS msgs (seq INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cap (k TEXT PRIMARY KEY, reserved INTEGER NOT NULL, spent INTEGER NOT NULL);`);
  }
  one(q, ...a) { return this.sql.exec(q, ...a).toArray()[0]; }
  totals() {
    const granted = this.one("SELECT COALESCE(SUM(nano),0) n FROM grants").n;
    const included = this.one("SELECT COALESCE(SUM(nano),0) n FROM grants WHERE kind='included'").n;
    const spent = this.one("SELECT COALESCE(SUM(nano),0) n FROM spend").n;
    const reserved = this.one("SELECT COALESCE(SUM(nano),0) n FROM res").n;
    return { granted_nano: granted, included_nano: included, spent_nano: spent, reserved_nano: reserved, balance_nano: granted - spent - reserved };
  }
  // A reservation older than 10 minutes was never settled (a crashed call): charged at its full worst case. Each one is also noted in
  // res_events (deploy-safe Phase 0: the deploy measurements and the chaos check count them; a Resident now releases its own first).
  expire() {
    const old = Date.now() - 10 * 60e3;
    if (this.one("SELECT 1 x FROM res WHERE at<? LIMIT 1", old)) { this.resEventsInit(); this.sql.exec("INSERT INTO res_events (id,kind,nano,at) SELECT id,'expired',nano,? FROM res WHERE at<?", Date.now(), old); }
    this.sql.exec("INSERT OR IGNORE INTO spend SELECT id,nano,at FROM res WHERE at<?", old); this.sql.exec("DELETE FROM res WHERE at<?", old);
  }
  resEventsInit() { this.sql.exec("CREATE TABLE IF NOT EXISTS res_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, kind TEXT NOT NULL, nano INTEGER NOT NULL, at INTEGER NOT NULL)"); }
  async resEvents(since = 0) { this.resEventsInit(); this.sql.exec("DELETE FROM res_events WHERE at<?", Date.now() - 7 * 86400e3); return this.sql.exec("SELECT id,kind,nano,at FROM res_events WHERE at>=? ORDER BY seq DESC LIMIT 200", Number(since) || 0).toArray(); }
  // A charge settled at the price ceiling because the model's price was unknown (resident.js notePriceUnknown). Only an event row; no balance change.
  async notePriceUnknown(id, nano) { this.resEventsInit(); this.sql.exec("INSERT INTO res_events (id,kind,nano,at) VALUES (?,?,?,?)", String(id).slice(0, 80), "price_unknown", Math.round(Number(nano) || 0), Date.now()); }
  async state() { this.expire(); return { ...this.totals(), today: this.dayInfo() }; }
  async opsTotals() { return this.totals(); }   // dev ops (ops-read.js): the balance without the housekeeping writes
  // TEST_MODE: lowering the balance is recorded as usage (so monthly expiry math is realistic); raising it is a test grant.
  async setBalance(target) {
    const t = this.totals(), d = target - t.balance_nano, id = "test-adjust:" + crypto.randomUUID();
    if (d < 0) this.sql.exec("INSERT INTO spend (id,nano,at) VALUES (?,?,?)", id, -d, Date.now());
    else if (d > 0) this.sql.exec("INSERT INTO grants (key,nano,kind,at) VALUES (?,?,?,?)", id, d, "test", Date.now());
    return this.totals();
  }
  async grantIncluded(key, nano) {
    if (this.one("SELECT 1 x FROM grants WHERE key=?", key)) return this.totals();
    this.guardMarkPeriod();   // spendguard.js: a new month starts here (its meter and its 50/80% notices)
    const inc = this.one("SELECT COALESCE(SUM(nano),0) n FROM grants WHERE kind IN ('included','included_expire')").n;
    const spent = this.one("SELECT COALESCE(SUM(nano),0) n FROM spend").n;
    const unusedIncluded = Math.max(0, inc - spent);
    this.ctx.storage.transactionSync(() => {
      if (unusedIncluded > 0) this.sql.exec("INSERT INTO grants (key,nano,kind,at) VALUES (?,?,?,?)", key + ":expire", -unusedIncluded, "included_expire", Date.now());
      this.sql.exec("INSERT INTO grants (key,nano,kind,at) VALUES (?,?,?,?)", key, Math.round(nano), "included", Date.now());
    });
    return this.totals();
  }
  async grant(key, nano, kind) { this.sql.exec("INSERT OR IGNORE INTO grants (key,nano,kind,at) VALUES (?,?,?,?)", key, Math.round(nano), kind, Date.now()); return this.totals(); }
  // Daily safety net (per account, resets at midnight Pacific): a runaway loop can burn at most one day's limit, never the
  // whole balance and never anyone else's. Limit = DAY_CAP_PCT of what the account put in over the last 31 days
  // (plan usage + upgrades + top-ups), at least DAY_CAP_MIN_MICROS. Counted at customer price (spend + open reservations).
  dayStart(at = Date.now()) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const parts = (x) => Object.fromEntries(f.formatToParts(new Date(x)).map((p) => [p.type, +p.value]));
    const offAt = (x) => { const g = parts(x); return Date.UTC(g.year, g.month - 1, g.day, g.hour % 24, g.minute, g.second) - Math.floor(x / 1000) * 1000; };
    const g = parts(at), wall = Date.UTC(g.year, g.month - 1, g.day);
    let t = wall - offAt(at); t = wall - offAt(t); // second pass: use the offset in force at midnight (DST days)
    return t;
  }
  dayInfo() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    const start = this.dayStart(), now = Date.now();
    const put = this.one("SELECT COALESCE(SUM(nano),0) n FROM grants WHERE nano>0 AND kind IN ('included','topup') AND at>=?", now - 31 * 86400e3).n;
    const pct = Number(this.env.DAY_CAP_PCT ?? 50), floor = Number(this.env.DAY_CAP_MIN_MICROS ?? 15e6) * 1000;
    const override = this.one("SELECT v FROM kv WHERE k='day_cap_test'")?.v;
    const cap = override != null ? Number(override) : Math.max(floor, Math.round(put * pct / 100));
    const spent = this.one("SELECT COALESCE(SUM(nano),0) n FROM spend WHERE at>=? AND id NOT LIKE 'test-adjust:%'", start).n;
    const reserved = this.one("SELECT COALESCE(SUM(nano),0) n FROM res").n;
    const next = this.dayStart(start + 36 * 3600e3);
    return { spent_nano: spent, reserved_nano: reserved, cap_nano: cap, resets_at: next };
  }
  async setDayCapTest(nano) { this.dayInfo(); if (nano == null) this.sql.exec("DELETE FROM kv WHERE k='day_cap_test'"); else this.sql.exec("INSERT INTO kv VALUES ('day_cap_test',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", String(Math.round(nano))); return this.dayInfo(); }
  async reserve(id, nano) {
    this.expire();
    const t = this.totals();
    if (t.balance_nano < nano) return { ok: false, reason: "out_of_credits", state: t };
    const d = this.dayInfo();
    if (this.spendPreferences().enabled && d.spent_nano + d.reserved_nano + nano > d.cap_nano) return { ok: false, reason: "day_limit", day: d, state: t };
    this.sql.exec("INSERT INTO res (id,nano,at) VALUES (?,?,?)", id, nano, Date.now());
    return { ok: true };
  }
  async settle(id, nano, msgs = []) {
    const r = this.one("SELECT nano FROM res WHERE id=?", id);
    // A settle for a reservation its Resident already released after a reset (the old instance's call finished after all): noted, not charged.
    if (!r && nano > 0 && this.one("SELECT nano FROM spend WHERE id=?", id)?.nano === 0) { this.resEventsInit(); this.sql.exec("INSERT INTO res_events (id,kind,nano,at) VALUES (?,?,?,?)", id, "late_settle", Math.round(nano), Date.now()); }
    this.sql.exec("DELETE FROM res WHERE id=?", id);
    if (r || nano > 0) this.sql.exec("INSERT OR IGNORE INTO spend (id,nano,at) VALUES (?,?,?)", id, Math.min(nano, r ? r.nano : nano), Date.now());
    for (const m of msgs) this.sql.exec("INSERT INTO msgs (role,content,at) VALUES (?,?,?)", m.role, m.content, Date.now());
    return this.totals();
  }
  async history(n) { return this.sql.exec("SELECT role,content FROM (SELECT * FROM msgs ORDER BY seq DESC LIMIT ?) ORDER BY seq", n).toArray(); }
}


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
    // A reservation capped at the balance (reserve with opts.fit) is marked here: settle charges its real cost. Nullable, so old rows and old callers are unchanged.
    if (!this.sql.exec("PRAGMA table_info(res)").toArray().some((c) => c.name === "capped")) this.sql.exec("ALTER TABLE res ADD COLUMN capped INTEGER");
    this.totInit();
  }
  one(q, ...a) { return this.sql.exec(q, ...a).toArray()[0]; }
  // Running totals. Every balance read used to add up the whole spend table (one row per charge, so it grew for as long as the account lived, and
  // each reserve, settle and state call read it several times: billions of Durable Object rows read a month). The table tot holds the sums,
  // kept by triggers on grants, spend and res, so no code path that writes those tables can leave a sum behind. An existing object is filled once
  // here, in one transaction with the triggers, so no write lands between the sums and the triggers. spend_at serves the per day and per period sums.
  totInit() {
    this.sql.exec("CREATE INDEX IF NOT EXISTS spend_at ON spend(at)");
    if (this.one("SELECT 1 x FROM sqlite_master WHERE type='table' AND name='tot'")) return;
    const make = () => {
      this.sql.exec("CREATE TABLE tot (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
      const sum = (q) => Number(this.one(q).n);
      for (const [k, q] of [["granted", "SELECT COALESCE(SUM(nano),0) n FROM grants"], ["included", "SELECT COALESCE(SUM(nano),0) n FROM grants WHERE kind='included'"],
        ["included_all", "SELECT COALESCE(SUM(nano),0) n FROM grants WHERE kind IN ('included','included_expire')"], ["spent", "SELECT COALESCE(SUM(nano),0) n FROM spend"], ["reserved", "SELECT COALESCE(SUM(nano),0) n FROM res"]]) this.sql.exec("INSERT INTO tot (k,v) VALUES (?,?)", k, sum(q));
      const bump = (k, expr, when = "1") => `UPDATE tot SET v=v+(${expr}) WHERE k='${k}' AND (${when});`;
      const grant = (row, sign) => [bump("granted", `${sign}${row}.nano`), bump("included", `${sign}${row}.nano`, `${row}.kind='included'`), bump("included_all", `${sign}${row}.nano`, `${row}.kind IN ('included','included_expire')`)].join(" ");
      const spend = (row, sign) => [bump("spent", `${sign}${row}.nano`), bump("pspent", `${sign}${row}.nano`, `${row}.at>=(SELECT v FROM tot WHERE k='pfrom')`)].join(" ");
      const trig = (name, ev, table, body) => this.sql.exec(`CREATE TRIGGER ${name} AFTER ${ev} ON ${table} BEGIN ${body} END`);
      trig("tot_grants_i", "INSERT", "grants", grant("NEW", "")); trig("tot_grants_d", "DELETE", "grants", grant("OLD", "-"));
      trig("tot_grants_u", "UPDATE", "grants", grant("OLD", "-") + " " + grant("NEW", ""));
      trig("tot_spend_i", "INSERT", "spend", spend("NEW", "")); trig("tot_spend_d", "DELETE", "spend", spend("OLD", "-"));
      trig("tot_spend_u", "UPDATE", "spend", spend("OLD", "-") + " " + spend("NEW", ""));
      trig("tot_res_i", "INSERT", "res", bump("reserved", "NEW.nano")); trig("tot_res_d", "DELETE", "res", bump("reserved", "-OLD.nano"));
      trig("tot_res_u", "UPDATE", "res", bump("reserved", "NEW.nano-OLD.nano"));
    };
    if (this.ctx.storage.transactionSync) this.ctx.storage.transactionSync(make); else make();
  }
  tot(...keys) {
    const rows = this.sql.exec(`SELECT k,v FROM tot WHERE k IN (${keys.map(() => "?").join(",")})`, ...keys).toArray();
    return Object.fromEntries(keys.map((k) => [k, Number(rows.find((r) => r.k === k)?.v ?? 0)]));
  }
  totals() {
    const { granted, included, spent, reserved } = this.tot("granted", "included", "spent", "reserved");
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
    const { included_all: inc, spent } = this.tot("included_all", "spent");
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
    const reserved = this.tot("reserved").reserved;
    const next = this.dayStart(start + 36 * 3600e3);
    return { spent_nano: spent, reserved_nano: reserved, cap_nano: cap, resets_at: next };
  }
  async setDayCapTest(nano) { this.dayInfo(); if (nano == null) this.sql.exec("DELETE FROM kv WHERE k='day_cap_test'"); else this.sql.exec("INSERT INTO kv VALUES ('day_cap_test',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", String(Math.round(nano))); return this.dayInfo(); }
  // opts.fit: a call that settles with its real cost may hold less than asked, down to what is left (capped); at a balance of 0 or less it still refuses.
  async reserve(id, nano, opts) {
    this.expire();
    const t = this.totals();
    let capped = false;
    if (t.balance_nano < nano) {
      if (opts?.fit === true && t.balance_nano > 0) { nano = t.balance_nano; capped = true; }
      else return { ok: false, reason: "out_of_credits", state: t };
    }
    const d = this.dayInfo();
    if (this.spendPreferences().enabled && d.spent_nano + d.reserved_nano + nano > d.cap_nano) return { ok: false, reason: "day_limit", day: d, state: t };
    if (capped) { this.sql.exec("INSERT INTO res (id,nano,at,capped) VALUES (?,?,?,1)", id, nano, Date.now()); return { ok: true, nano, capped: true }; }
    this.sql.exec("INSERT INTO res (id,nano,at) VALUES (?,?,?)", id, nano, Date.now());
    return { ok: true };
  }
  async settle(id, nano, msgs = []) {
    const r = this.one("SELECT nano,capped FROM res WHERE id=?", id);
    // A settle for a reservation its Resident already released after a reset (the old instance's call finished after all): noted, not charged.
    if (!r && nano > 0 && this.one("SELECT nano FROM spend WHERE id=?", id)?.nano === 0) { this.resEventsInit(); this.sql.exec("INSERT INTO res_events (id,kind,nano,at) VALUES (?,?,?,?)", id, "late_settle", Math.round(nano), Date.now()); }
    this.sql.exec("DELETE FROM res WHERE id=?", id);
    if (r || nano > 0) this.sql.exec("INSERT OR IGNORE INTO spend (id,nano,at) VALUES (?,?,?)", id, r?.capped ? nano : Math.min(nano, r ? r.nano : nano), Date.now());   // a capped hold was smaller than the worst case: charge the real cost
    for (const m of msgs) this.sql.exec("INSERT INTO msgs (role,content,at) VALUES (?,?,?)", m.role, m.content, Date.now());
    return this.totals();
  }
  async history(n) { return this.sql.exec("SELECT role,content FROM (SELECT * FROM msgs ORDER BY seq DESC LIMIT ?) ORDER BY seq", n).toArray(); }
}


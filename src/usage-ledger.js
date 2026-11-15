import { DurableObject } from "cloudflare:workers";
import { installSnapshotRpc } from "./sqlite-snapshot.js";

// Single-owner deployments keep usage history and a daily safety cap without
// Stripe grants, plans, or credits. Provider invoices are paid by the owner.
export class UsageLedger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.sql = ctx.storage.sql; this.env = env;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS res (id TEXT PRIMARY KEY, nano INTEGER NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS spend (id TEXT PRIMARY KEY, nano INTEGER NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS msgs (seq INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, at INTEGER NOT NULL);`);
  }
  one(q, ...a) { return this.sql.exec(q, ...a).toArray()[0]; }
  expire() {
    const old = Date.now() - 10 * 60e3;
    this.sql.exec("INSERT OR IGNORE INTO spend SELECT id,nano,at FROM res WHERE at<?", old);
    this.sql.exec("DELETE FROM res WHERE at<?", old);
  }
  dayInfo() {
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const cap = Math.max(0, Number(this.env.SELFHOST_DAILY_CAP_NANO ?? 20e9));
    const spent = this.one("SELECT COALESCE(SUM(nano),0) n FROM spend WHERE at>=?", start.getTime()).n;
    const reserved = this.one("SELECT COALESCE(SUM(nano),0) n FROM res").n;
    return { spent_nano: spent, reserved_nano: reserved, cap_nano: cap, resets_at: start.getTime() + 86400e3 };
  }
  async reserve(id, nano) {
    this.expire(); nano = Math.max(0, Math.round(Number(nano) || 0));
    if (this.one("SELECT 1 x FROM res WHERE id=?", id) || this.one("SELECT 1 x FROM spend WHERE id=?", id)) return { ok: true };
    const day = this.dayInfo();
    if (this.spendPreferences().enabled && day.spent_nano + day.reserved_nano + nano > day.cap_nano) return { ok: false, reason: "day_limit", day };
    this.sql.exec("INSERT INTO res (id,nano,at) VALUES (?,?,?)", id, nano, Date.now());
    return { ok: true };
  }
  async settle(id, nano, msgs = []) {
    const held = this.one("SELECT nano FROM res WHERE id=?", id);
    this.sql.exec("DELETE FROM res WHERE id=?", id);
    if (held || nano > 0) this.sql.exec("INSERT OR IGNORE INTO spend (id,nano,at) VALUES (?,?,?)", id, Math.max(0, Math.min(Math.round(Number(nano) || 0), held?.nano ?? nano)), Date.now());
    for (const m of msgs) this.sql.exec("INSERT INTO msgs (role,content,at) VALUES (?,?,?)", m.role, m.content, Date.now());
    return this.state();
  }
  async state() {
    this.expire(); const spent = this.one("SELECT COALESCE(SUM(nano),0) n FROM spend").n;
    return { spent_nano: spent, balance_nano: Number.MAX_SAFE_INTEGER, granted_nano: 0, included_nano: 0, reserved_nano: this.dayInfo().reserved_nano, today: this.dayInfo() };
  }
  async opsTotals() { return this.state(); }
  async history(n = 200) { return this.sql.exec("SELECT role,content FROM (SELECT * FROM msgs ORDER BY seq DESC LIMIT ?) ORDER BY seq", n).toArray(); }
  spendPreferences() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    return { enabled: this.one("SELECT v FROM kv WHERE k='spend_pauses'")?.v !== "off" };
  }
  setSpendPreferences(enabled) {
    if (typeof enabled !== "boolean") throw new TypeError("Choose on or off.");
    this.spendPreferences();
    this.sql.exec("INSERT INTO kv VALUES ('spend_pauses',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", enabled ? "on" : "off");
    return this.spendPreferences();
  }
  async guardInfo() { return { spend_pauses: this.spendPreferences().enabled, allowance_nano: 0, day_spent_nano: this.dayInfo().spent_nano, day_ok_nano: 0 }; }
  async noticePending() { return null; }
  async notePriceUnknown() { return null; }   // self-hosted usage keeps no price-unknown event log
  async noticeSeen() { return { ok: true }; }
  async usageNotice() { return null; }
}
installSnapshotRpc(UsageLedger, "UsageLedger");

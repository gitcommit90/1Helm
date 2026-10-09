// Paid-plan Ledger accounting and notices for the 1HC deployment.
import { CHECKIN_TEST_KEY, DAY_FACTOR, NOTICE_LEVELS, checkinOffTest, dayShare, noticeText, testModeOn } from "../spendguard.js";

export const ledgerGuard = {
  guardKv(k, v) {
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    if (v === undefined) return this.sql.exec("SELECT v FROM kv WHERE k=?", k).toArray()[0]?.v ?? null;
    if (v === null) this.sql.exec("DELETE FROM kv WHERE k=?", k);
    else this.sql.exec("INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v));
    return v;
  },
  // grantIncluded marks the period; accounts from before that use their latest plan-sized grant (upgrades are "included" too).
  guardMarkPeriod(at = Date.now()) { this.guardKv("period_start", at); },
  guardPeriod() {
    const mark = Number(this.guardKv("period_start")) || 0; if (mark) return mark;
    const rows = this.sql.exec("SELECT nano, at FROM grants WHERE kind='included' AND nano>0 ORDER BY at DESC").toArray();
    const plan = rows.find((r) => [20e9, 40e9, 80e9, 160e9].includes(Number(r.nano))) || rows[0];
    return plan ? Number(plan.at) : 0;
  },
  guardInfo() {
    const d = this.dayInfo(), now = Date.now(), start = this.guardPeriod();
    let allowance = start ? Number(this.sql.exec("SELECT COALESCE(SUM(nano),0) n FROM grants WHERE kind='included' AND nano>0 AND at>=?", start).toArray()[0].n) : 0;
    const from = start || now - 31 * 86400e3;
    if (!allowance) allowance = Number(this.sql.exec("SELECT COALESCE(SUM(nano),0) n FROM grants WHERE nano>0 AND kind IN ('included','topup','test') AND at>=?", from).toArray()[0].n);
    const used = Number(this.sql.exec("SELECT COALESCE(SUM(nano),0) n FROM spend WHERE at>=?", from).toArray()[0].n);
    const dayKey = `day_ok:${this.dayStart()}`;
    return { allowance_nano: allowance, period_start: start, period_spent_nano: used, pct: allowance ? Math.min(100, Math.round(used / allowance * 100)) : 0,
      day_spent_nano: d.spent_nano + d.reserved_nano, day_share_nano: dayShare(allowance), day_ok_nano: Number(this.guardKv(dayKey)) || 0, day_cap_nano: d.cap_nano,
      ...(checkinOffTest(this.env, this.guardKv(CHECKIN_TEST_KEY)) ? { checkin_off: true } : {}) };
  },
  // Dev evals only (index.js /api/test/day-cap {checkin:false}, @example.com test accounts, TEST_MODE="1"): no day check-in, so a
  // long eval run isn't stopped by "twice a normal day". The hard day cap still applies (set it with cap_nano). Never on prod:
  // the stored flag is ignored unless TEST_MODE is "1" when it's read.
  setCheckinTest(off) { if (!testModeOn(this.env)) return { error: "test mode only" }; this.guardKv(CHECKIN_TEST_KEY, off ? "off" : null); return { checkin_off: !!off }; },
  // Keep going on the day check-in: another 2× share before the next one.
  dayCheckin() {
    const g = this.guardInfo(), level = g.day_spent_nano + DAY_FACTOR * g.day_share_nano;
    this.guardKv(`day_ok:${this.dayStart()}`, Math.max(level, g.day_ok_nano)); return { ...g, day_ok_nano: Math.max(level, g.day_ok_nano) };
  },
  // Crossed 50% / 80% since the last check: one notice (the highest level crossed), every lower level marked too.
  usageNotice(helper = "Your helper") {
    const g = this.guardInfo(); if (!g.allowance_nano) return null;
    const exact = g.period_spent_nano / g.allowance_nano * 100, per = g.period_start || "rolling";
    const due = NOTICE_LEVELS.filter((l) => exact >= l && !this.guardKv(`notice:${per}:${l}`));
    if (!due.length) return null;
    for (const l of NOTICE_LEVELS.filter((l) => exact >= l)) this.guardKv(`notice:${per}:${l}`, Date.now());
    const level = Math.max(...due), text = noticeText(level, g.period_spent_nano, g.allowance_nano, helper);
    const n = { level, text, at: Date.now() };
    this.guardKv("notice_pending", JSON.stringify(n));
    return n;
  },
  noticePending() { try { return JSON.parse(this.guardKv("notice_pending") || "null"); } catch { return null; } },
  noticeSeen() { this.guardKv("notice_pending", null); return { ok: true }; },
};

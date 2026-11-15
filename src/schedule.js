// Calendar schedules for recurring workflows: a cron rule ("0 7 * * MON-FRI") in the person's time zone.
// The Resident's own DO alarm still does the waking; this only answers "when is the next run?" (DST-correct via croner).
import { Cron } from "croner";
import cronstrue from "cronstrue";

export const DEFAULT_TZ = "America/Los_Angeles";
export const validTz = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
const cron = (rule, tz) => new Cron(rule, { timezone: tz, paused: true, legacyMode: true });

// Validate a rule; returns { ok, error?, next?, gap_s? } (gap_s = shortest spacing over the next runs, for floors and wording).
export function checkRule(rule, tz) {
  rule = String(rule || "").trim();
  if (!/^\S+(\s+\S+){4}$/.test(rule)) return { ok: false, error: "use a standard 5-field cron rule: minute hour day-of-month month day-of-week, e.g. \"0 7 * * MON-FRI\"" };
  if (!validTz(tz)) return { ok: false, error: `unknown time zone "${tz}"; use an IANA name like America/Los_Angeles` };
  try {
    const runs = cron(rule, tz).nextRuns(8, new Date());
    if (!runs.length) return { ok: false, error: "that rule never runs" };
    let gap = Infinity; for (let i = 1; i < runs.length; i++) gap = Math.min(gap, (runs[i] - runs[i - 1]) / 1000);
    return { ok: true, rule, next: runs[0].getTime(), gap_s: Number.isFinite(gap) ? Math.round(gap) : 31536000 };
  } catch (e) { return { ok: false, error: String(e.message || e).replace(/^CronPattern: /, "") }; }
}

// Next run strictly after `after` (ms). `notBefore` enforces a floor (e.g. ungated jobs ≥ 15 min apart).
export function nextRun(rule, tz, after, notBefore = 0) {
  try { const d = cron(rule, tz).nextRun(new Date(Math.max(after, notBefore - 1000))); return d ? d.getTime() : null; } catch { return null; }
}

const TZ_ABBR = { "America/Los_Angeles": "PT", "America/Denver": "MT", "America/Phoenix": "MST", "America/Chicago": "CT", "America/New_York": "ET" };
// Plain words for the app and the helper: "Weekdays at 7:00 AM PT".
export function describe(rule, tz) {
  let s; try { s = cronstrue.toString(rule, { verbose: false, use24HourTimeFormat: false }); } catch { return rule; }
  const T = "\\d{1,2}:\\d\\d [AP]M";
  s = s.replace(/^At /, "").replace(/(\d\d):(\d\d) (AM|PM)/g, (_, h, m, ap) => `${Number(h)}:${m} ${ap}`)
    .replace(/Monday through Friday/g, "weekdays").replace(/Saturday and Sunday/g, "weekends").replace(/only on /g, "").replace(/, on /g, ", ")
    .replace(/day (\d+) of the month/, (_, d) => `the ${d}${["th", "st", "nd", "rd"][(d % 100 > 10 && d % 100 < 14) || d % 10 > 3 ? 0 : d % 10]} of the month`);
  let m;
  if ((m = s.match(new RegExp(`^(${T})$`)))) s = `Daily at ${m[1]}`;
  else if ((m = s.match(new RegExp(`^(${T}), weekdays$`)))) s = `Weekdays at ${m[1]}`;
  else if ((m = s.match(new RegExp(`^(${T}), weekends$`)))) s = `Weekends at ${m[1]}`;
  else if ((m = s.match(new RegExp(`^(${T}), (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$`)))) s = `${m[2]}s at ${m[1]}`;
  else if ((m = s.match(new RegExp(`^(${T}), (.+)$`)))) s = `${m[2][0].toUpperCase()}${m[2].slice(1)} at ${m[1]}`;
  const abbr = TZ_ABBR[tz] || tz.split("/").pop().replace(/_/g, " ");
  return new RegExp(T).test(s) ? `${s} ${abbr}` : s;
}

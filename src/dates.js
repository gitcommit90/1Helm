// Memory: relative dates → real time ranges, in the person's time zone. No model. Used two ways:
// (1) the question: "what did we decide yesterday / last week / in September / before Oct 1" → a {from, to} filter for recall;
// (2) stored records: "yesterday" inside a row written on Oct 1 means Sep 30, so the pack shows the real date next to it.
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_RE = "(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday)?";
const monIdx = (s) => MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().slice(0, 3)));
const dayIdx = (s) => DAYS.findIndex((d) => d.startsWith(s.toLowerCase().slice(0, 3)));
const WORDNUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };

// Wall-clock parts of an instant in tz, and the UTC instant of a wall-clock midnight in tz.
function parts(ms, tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month - 1, d: +p.day, wd: dayIdx(p.weekday), h: +p.hour };
}
export function midnight(y, m, d, tz) {
  const guess = Date.UTC(y, m, d);
  for (let off = -14; off <= 14; off++) { const t = guess - off * 3600e3; const p = parts(t, tz); if (p.y === new Date(guess).getUTCFullYear() && p.m === new Date(guess).getUTCMonth() && p.d === new Date(guess).getUTCDate() && p.h === 0) return t; }
  return guess;
}
const dayStart = (ms, tz, add = 0) => { const p = parts(ms, tz); const g = new Date(Date.UTC(p.y, p.m, p.d + add)); return midnight(g.getUTCFullYear(), g.getUTCMonth(), g.getUTCDate(), tz); };
export const localDay = (ms, tz) => (ms ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(ms)) : "undated");
const range = (from, to, label) => ({ from, to, label });

// Find the first time expression in text, relative to now. Returns { from, to, label, match } or null. `to` is exclusive.
export function resolveTime(text, now, tz, o = {}) {
  const s = ` ${String(text || "").toLowerCase().replace(/[’']/g, "'")} `, past = o.past !== false;
  const P = parts(now, tz), today = dayStart(now, tz), DAY = (n) => dayStart(now, tz, n);
  const num = (w) => (/^\d+$/.test(w) ? +w : WORDNUM[w] ?? null);
  let m;
  // explicit ISO / numeric dates
  if ((m = s.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/))) { const a = midnight(+m[1], +m[2] - 1, +m[3], tz); return { ...range(a, a + 86400e3, m[0]), match: m[0] }; }
  if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)) && +m[1] <= 12 && +m[2] <= 31) {
    let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : P.y; let a = midnight(y, +m[1] - 1, +m[2], tz); if (!m[3] && past && a > now) a = midnight(y - 1, +m[1] - 1, +m[2], tz);
    return { ...range(a, dayStart(a, tz, 1), m[0].trim()), match: m[0] };
  }
  // "Sept 12", "September 12th, 2026", "12 September"
  if ((m = s.match(new RegExp(`\\b${MON_RE}\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (20\\d\\d))?\\b`))) || (m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MON_RE}(?:,? (20\\d\\d))?\\b`)))) {
    const swap = /^\d/.test(m[1]), mi = monIdx(swap ? m[2] : m[1]), d = +(swap ? m[1] : m[2]), yy = m[3] ? +m[3] : P.y;
    let a = midnight(yy, mi, d, tz); if (!m[3] && past && a > now + 86400e3) a = midnight(yy - 1, mi, d, tz);
    return { ...range(a, dayStart(a, tz, 1), m[0].trim()), match: m[0] };
  }
  if (/\b(today|earlier today|this morning|this afternoon|tonight|this evening)\b/.test(s)) { m = s.match(/\b(earlier today|today|this morning|this afternoon|tonight|this evening)\b/); return { ...range(today, DAY(1), m[0]), match: m[0] }; }
  if ((m = s.match(/\b(yesterday|last night)\b/))) return { ...range(DAY(-1), m[0] === "last night" ? today + 6 * 3600e3 : today, m[0]), match: m[0] };
  if ((m = s.match(/\b(day before yesterday)\b/))) return { ...range(DAY(-2), DAY(-1), m[0]), match: m[0] };
  if ((m = s.match(/\btomorrow\b/))) return { ...range(DAY(1), DAY(2), m[0]), match: m[0] };
  // "3 days ago", "a couple of weeks ago", "two months ago" (a window around that point)
  if ((m = s.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)(?: of)? (day|week|month|year)s? ago\b/))) {
    const n = num(m[1]) || 1, u = m[2];
    if (u === "day") return { ...range(DAY(-n), DAY(-n + 1), m[0]), match: m[0] };
    if (u === "week") return { ...range(DAY(-7 * n - 3), DAY(-7 * n + 4), m[0]), match: m[0] };
    if (u === "month") { const g = new Date(Date.UTC(P.y, P.m - n, 1)); const a = midnight(g.getUTCFullYear(), g.getUTCMonth(), 1, tz), e = new Date(Date.UTC(P.y, P.m - n + 1, 1)); return { ...range(a, midnight(e.getUTCFullYear(), e.getUTCMonth(), 1, tz), m[0]), match: m[0] }; }
    return { ...range(midnight(P.y - n, 0, 1, tz), midnight(P.y - n + 1, 0, 1, tz), m[0]), match: m[0] };
  }
  // "past/last 3 days", "in the last two weeks"
  if ((m = s.match(/\b(?:past|last|previous) (\d+|two|three|four|five|six|seven|eight|nine|ten|couple of|few) (day|week|month)s\b/))) {
    const n = num(m[1].replace(" of", "")) || 2, days = m[2] === "day" ? n : m[2] === "week" ? 7 * n : 30 * n; return { ...range(DAY(-days), DAY(1), m[0]), match: m[0] };
  }
  // weeks (Monday-start), weekends
  const wkStart = DAY(-((P.wd + 6) % 7));
  if ((m = s.match(/\b(this|last|next) week\b/))) { const k = m[1] === "this" ? 0 : m[1] === "last" ? -7 : 7; return { ...range(dayStart(wkStart, tz, k), dayStart(wkStart, tz, k + 7), m[0]), match: m[0] }; }
  if ((m = s.match(/\b(this|last|past) weekend\b/))) { let sat = dayStart(wkStart, tz, 5); if (m[1] !== "this" || sat > now) sat = dayStart(sat, tz, sat > now || m[1] !== "this" ? -7 : 0); return { ...range(sat, dayStart(sat, tz, 2), m[0]), match: m[0] }; }
  // "last Tuesday", "on Monday", "Friday"
  if ((m = s.match(new RegExp(`\\b(last |this |on |next )?${DAY_RE}\\b`))) && !/\b(may|march)\b/.test(m[0])) {
    const w = dayIdx(m[2]); let back = (P.wd - w + 7) % 7; if (m[1] === "last " && back === 0) back = 7; if (m[1] === "last " && back < 7 && (P.wd - w + 7) % 7 === 0) back = 7;
    if (m[1] === "next ") { const fwd = ((w - P.wd + 7) % 7) || 7; const a = DAY(fwd); return { ...range(a, dayStart(a, tz, 1), m[0].trim()), match: m[0] }; }
    const a = DAY(-back); return { ...range(a, dayStart(a, tz, 1), m[0].trim()), match: m[0] };
  }
  // months: "this month", "last month", "in September", "September 2026"
  if ((m = s.match(/\b(this|last|next) month\b/))) { const k = m[1] === "this" ? 0 : m[1] === "last" ? -1 : 1; const g = new Date(Date.UTC(P.y, P.m + k, 1)), e = new Date(Date.UTC(P.y, P.m + k + 1, 1)); return { ...range(midnight(g.getUTCFullYear(), g.getUTCMonth(), 1, tz), midnight(e.getUTCFullYear(), e.getUTCMonth(), 1, tz), m[0]), match: m[0] }; }
  if ((m = s.match(new RegExp(`\\b(?:in |during |since |back in |early |late |mid-?)?${MON_RE}(?: (20\\d\\d))?\\b`))) && !/\b(may i|may be|may have|march on)\b/.test(s.slice(Math.max(0, s.indexOf(m[0]) - 1), s.indexOf(m[0]) + m[0].length + 6)) && (m[2] || /\b(in|during|since|back in|early|late|mid)\b/.test(m[0]) || m[1].length > 3)) {
    const mi = monIdx(m[1]); let y = m[2] ? +m[2] : P.y; if (!m[2] && past && mi > P.m) y--;
    let a = midnight(y, mi, 1, tz), e = new Date(Date.UTC(y, mi + 1, 1)), b = midnight(e.getUTCFullYear(), e.getUTCMonth(), 1, tz);
    if (/early/.test(m[0])) b = midnight(y, mi, 11, tz); if (/late/.test(m[0])) a = midnight(y, mi, 20, tz); if (/mid/.test(m[0])) { a = midnight(y, mi, 10, tz); b = midnight(y, mi, 21, tz); }
    if (/since/.test(m[0])) b = DAY(1);
    return { ...range(a, b, m[0].trim()), match: m[0] };
  }
  if ((m = s.match(/\b(this|last) year\b/))) { const y = P.y - (m[1] === "last" ? 1 : 0); return { ...range(midnight(y, 0, 1, tz), midnight(y + 1, 0, 1, tz), m[0]), match: m[0] }; }
  if ((m = s.match(/\b(?:in )(20\d\d)\b/))) { const y = +m[1]; return { ...range(midnight(y, 0, 1, tz), midnight(y + 1, 0, 1, tz), m[0].trim()), match: m[0] }; }
  return null;
}

// Question scope: "before/after/since <time>" widens the found range to one side. Returns { from, to, label } or null.
export function questionScope(text, now, tz) {
  const s = String(text || "").toLowerCase();
  const r = resolveTime(s, now, tz); if (!r) return null;
  const pre = s.slice(Math.max(0, s.indexOf(r.match.trim()) - 12), s.indexOf(r.match.trim()));
  if (/\b(before|prior to|until|up to)\s*$/.test(pre)) return { from: null, to: r.from, label: `before ${localDay(r.from, tz)}` };
  if (/\b(after|since)\s*$/.test(pre)) return { from: r.to > now ? r.from : r.from, to: null, label: `since ${localDay(r.from, tz)}` };
  const last = r.to - 1;
  return { from: r.from, to: r.to, label: `"${r.label}" = ${localDay(r.from, tz)}${localDay(last, tz) !== localDay(r.from, tz) ? ` to ${localDay(last, tz)}` : ""}` };
}

// A stored record that says "yesterday" / "on Friday" / "next week" gets its real date, relative to when it was written.
export function annotateRecord(text, at, tz) {
  if (!at) return "";
  const r = resolveTime(String(text || "").slice(0, 1400), at, tz, { past: false }); if (!r) return "";
  if (/^20\d\d-|\d\/|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(r.label)) return "";   // already a real date
  const last = r.to - 1;
  return ` ["${r.label}" here = ${localDay(r.from, tz)}${localDay(last, tz) !== localDay(r.from, tz) ? ` to ${localDay(last, tz)}` : ""}]`;
}

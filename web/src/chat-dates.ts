// Date sections and message times for a task's chat. Days and times are the viewer's own (Intl, the browser's locale and time zone).
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const ok = (t: unknown): t is number => typeof t === "number" && isFinite(t) && t > 0;

// "Today", "Yesterday", "Mon, Nov 2", and with the year when it is not this year.
export function dayLabel(t: number, now = Date.now()): string {
  if (dayKey(t) === dayKey(now)) return "Today";
  if (dayKey(t) === dayKey(new Date(now).setDate(new Date(now).getDate() - 1))) return "Yesterday";
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, sameYear ? { weekday: "short", month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(t);
}
export const sameDay = (a: number, b: number) => dayKey(a) === dayKey(b);
export const timeLabel = (t: number) => TIME.format(t);

// The time of a message, shown inside its action strip (msgreply.ts maActs), so it appears and hides with the Copy and Reply buttons.
export function msgTime(t: number | undefined): string {
  if (!ok(t)) return "";
  return `<time class="mtime" datetime="${new Date(t).toISOString()}" title="${esc(FULL.format(t))}">${esc(timeLabel(t))}</time>`;
}

// Wrap messages in one section per day, each starting with a sticky date label. A message with no time joins the section before it.
export function daySections(msgs: { at?: number }[], html: string[]): string {
  let out = "", open = false, last = 0;
  msgs.forEach((m, i) => {
    const t = m.at; if (!html[i]) return;
    if (!open || (ok(t) && !sameDay(last, t))) {
      if (open) out += `</div>`;
      out += `<div class="mday">${ok(t) ? `<div class="mdate"><span>${esc(dayLabel(t))}</span></div>` : ""}`; open = true;
    }
    if (ok(t)) last = t;
    out += html[i];
  });
  return out + (open ? `</div>` : "");
}

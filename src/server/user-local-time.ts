import { now, q1, run } from "./db.ts";

const MAX_TIME_ZONE_LENGTH = 100;

/** Accept only time-zone identifiers understood by this runtime and store their
 * canonical IANA spelling. Browser-provided values are untrusted input. */
export function normalizeUserTimeZone(value: unknown): string {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.length > MAX_TIME_ZONE_LENGTH) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

/** Remember the authenticated user's current browser time zone. This follows
 * travel automatically while avoiding a separate preference/setup flow. */
export function captureUserTimeZone(userId: number, value: unknown, currentValue?: unknown): string {
  const timeZone = normalizeUserTimeZone(value);
  if (!userId || !timeZone) return "";
  const current = currentValue === undefined
    ? String(q1("SELECT time_zone FROM users WHERE id=?", userId)?.time_zone || "")
    : String(currentValue || "");
  if (current !== timeZone) run("UPDATE users SET time_zone=? WHERE id=?", timeZone, userId);
  return timeZone;
}

export function userLocalTimeContext(userId: number, instant = now()): string {
  if (!userId) return "";
  const timeZone = normalizeUserTimeZone(q1("SELECT time_zone FROM users WHERE id=?", userId)?.time_zone);
  if (!timeZone) return "";
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  }).format(new Date(instant));
  return [
    `<user-local-time timezone="${timeZone}">`,
    `Current date and time for the requesting user: ${local}.`,
    `Current UTC instant: ${new Date(instant).toISOString()}.`,
    "Use the user's time zone for dates, deadlines, and relative phrases such as today or tomorrow unless the user specifies another zone. The channel computer's clock or time zone is not the user's time zone.",
    "</user-local-time>",
  ].join("\n");
}

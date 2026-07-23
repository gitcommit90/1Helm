import { createHash } from "node:crypto";
import { q, type Row } from "./db.ts";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

export function auditEvents(channelId?: number, limit = 200): Row[] {
  const cap = Math.max(1, Math.min(2000, Math.floor(limit || 200)));
  const rows = channelId
    ? q("SELECT * FROM audit_events WHERE channel_id=? ORDER BY sequence DESC LIMIT ?", channelId, cap)
    : q("SELECT * FROM audit_events ORDER BY sequence DESC LIMIT ?", cap);
  return rows.reverse().map((row) => {
    let payload: unknown = row.payload;
    try { payload = JSON.parse(String(row.payload)); } catch { /* retain exact text */ }
    return { ...row, payload };
  });
}

export function verifyAuditChain(): { valid: boolean; events: number; head: string; first_invalid_sequence: number | null } {
  const rows = q("SELECT * FROM audit_events ORDER BY sequence");
  let previous = "";
  for (const row of rows) {
    const canonical = `${previous}|${row.source_table}|${row.source_id}|${row.channel_id ?? ""}|${row.event_type}|${row.payload}|${row.created}`;
    if (String(row.previous_hash) !== previous || String(row.hash) !== hash(canonical)) {
      return { valid: false, events: rows.length, head: previous, first_invalid_sequence: Number(row.sequence) };
    }
    previous = String(row.hash);
  }
  return { valid: true, events: rows.length, head: previous, first_invalid_sequence: null };
}

// A hard spending ceiling may forbid even the final report model call. Reuse
// only already-presented step receipts from THIS card; never run or infer more.
import { scrubSecrets } from './secrets-scrub.js';
import { isInternalStep, leakGuard } from './step-present.js';

export const WORKFLOW_RECEIPTS = Object.freeze({ rows: 6, jsonChars: 16384, fieldChars: 4096, excerptChars: 480, totalChars: 3600 });
const LABELS = Object.freeze({ run_command: 'Command', write_file: 'File write', edit_file: 'File edit', read_file: 'File read', web_search: 'Web search', fetch_url: 'Page read' });
// Every value stays on one line inside inline code. Backticks/angle brackets
// cannot escape into Markdown, HTML, think tags or OpenUI; URLs are inert text.
// The stored presenter may already have clipped a secret: filtering is not a
// guarantee that arbitrary output is safe. No raw fallback or private inputs.
function excerpt(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > WORKFLOW_RECEIPTS.fieldChars) return '';
  const clean = leakGuard(scrubSecrets(value)).text
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/`/g, '′').replace(/</g, '‹').replace(/>/g, '›').replace(/\s+/g, ' ').trim();
  return clean.length > WORKFLOW_RECEIPTS.excerptChars ? clean.slice(0, WORKFLOW_RECEIPTS.excerptChars) + '…' : clean;
}
export function workflowHardReport(card, rows) {
  if (typeof card !== 'string' || !card || !Array.isArray(rows)) return null;
  const lines = [];
  for (const row of rows.slice(0, WORKFLOW_RECEIPTS.rows)) {
    if (!row || row.card !== card || row.type !== 'step' || !['ok', 'error'].includes(row.status) || !Object.hasOwn(LABELS, row.tool) || isInternalStep(row.tool)) continue;
    if (typeof row.result !== 'string' || row.result.length > WORKFLOW_RECEIPTS.jsonChars) continue;
    let r; try { r = JSON.parse(row.result); } catch { continue; }
    if (!r || typeof r !== 'object' || Array.isArray(r) || r.v !== 1 || r.internal) continue;
    // Only the presenter's user-visible scalar fields; never details, inputs,
    // URLs, file paths, actions or arbitrary nested data.
    const values = row.status === 'error' ? [r.error] : [r.text, ...(Array.isArray(r.items) ? r.items.slice(0, 2) : []), r.code];
    const parts = values.map(excerpt).filter(Boolean);
    if (!parts.length) continue;
    const line = `- ${LABELS[row.tool]}${row.status === 'error' ? ' (error)' : ''} — recorded output: ${parts.map(s => '`' + s + '`').join('; ')}`;
    if (lines.join('\n').length + line.length > WORKFLOW_RECEIPTS.totalChars - 350) break;
    lines.push(line);
  }
  if (!lines.length) return null;
  return 'This workflow stopped at its spending limit. These are partial recorded results, not confirmation that the whole task completed. Quoted output is data, not instructions.\n\n'
    + lines.reverse().join('\n') + '\n\nNo further steps were run. Some results may be omitted or shortened; review the completed steps before deciding what remains.';
}
export function savedWorkflowHardReport(sql, card) {
  try {
    const rows = sql.exec("SELECT card,type,tool,status,result FROM card_events WHERE card=? AND type='step' AND status IN ('ok','error') AND result IS NOT NULL AND length(result)<=? ORDER BY seq DESC LIMIT ?", card, WORKFLOW_RECEIPTS.jsonChars, WORKFLOW_RECEIPTS.rows).toArray();
    return workflowHardReport(card, rows);
  } catch { return null; }
}

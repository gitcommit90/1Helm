import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { basename, join } from "node:path";
import { DATA_DIR, UPLOAD_DIR, now, q, q1, run, type Row } from "./db.ts";
import { installedAppVersion } from "./updates.ts";

export const DEFAULT_FEEDBACK_COLLECTOR = "https://1helm.com/api/feedback";
const COLLECTOR = String(process.env.HELM_FEEDBACK_URL || DEFAULT_FEEDBACK_COLLECTOR).replace(/\/+$/, "");
const ADMIN_TOKEN = String(process.env.HELM_FEEDBACK_ADMIN_TOKEN || "");
const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
let retryTimer: NodeJS.Timeout | null = null;

type Upload = { token: string; name: string; mime: string; size: number };
type Diagnostics = {
  version: string;
  platform: string;
  architecture: string;
  os_release: string;
  runtime: {
    node: string;
    desktop: boolean;
    channel_computers: Record<string, number>;
    agent_turns: Record<string, number>;
  };
  failed_capabilities: Array<{ capability: string; status: string; created: number }>;
  connector_status: Array<{ connector: string; status: string }>;
};

/**
 * Diagnostics are deliberately assembled from aggregate/status-only queries.
 * Never add message bodies, prompts, tool inputs/results, terminal output,
 * credentials, OAuth material, filenames, or file contents here.
 */
function reportDiagnostics(appRoot: string): Diagnostics {
  const computers = Object.fromEntries(q("SELECT observed_state,COUNT(*) count FROM channel_computers GROUP BY observed_state")
    .map((row) => [String(row.observed_state || "unknown"), Number(row.count)]));
  const turns = Object.fromEntries(q("SELECT state,COUNT(*) count FROM agent_turns GROUP BY state")
    .map((row) => [String(row.state || "unknown"), Number(row.count)]));
  const failed = q("SELECT tool capability,status,created FROM tool_actions WHERE status='failed' ORDER BY created DESC LIMIT 20")
    .map((row) => ({ capability: String(row.capability), status: String(row.status), created: Number(row.created) }));
  const connectorStatus: Array<{ connector: string; status: string }> = [];
  const photon = q1("SELECT COUNT(*) mapped FROM photon_channel_mappings");
  connectorStatus.push({ connector: "photon", status: Number(photon?.mapped || 0) ? "mapped" : "not_configured" });
  const google = existsSync(join(DATA_DIR, "connections", "gmail", "tokens"));
  connectorStatus.push({ connector: "google_workspace", status: google ? "configured" : "not_configured" });
  return {
    version: installedAppVersion(appRoot),
    platform: platform(),
    architecture: arch(),
    os_release: release(),
    runtime: {
      node: process.version,
      desktop: process.env.HELM_DESKTOP === "1",
      channel_computers: computers,
      agent_turns: turns,
    },
    failed_capabilities: failed,
    connector_status: connectorStatus,
  };
}

function cleanUploads(uploads: Upload[]): Array<Upload & { path: string }> {
  const unique = [...new Map((uploads || []).map((upload) => [String(upload.token || ""), upload])).values()].slice(0, MAX_FILES);
  let total = 0;
  return unique.map((upload) => {
    const token = String(upload.token || "");
    if (!/^[a-f0-9]{32,}$/.test(token)) throw new Error("A feedback attachment is invalid.");
    const path = join(UPLOAD_DIR, token);
    if (!existsSync(path)) throw new Error("A feedback attachment is no longer available.");
    const size = statSync(path).size;
    if (size > MAX_FILE_BYTES) throw new Error("Each feedback attachment is limited to 5 MB.");
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error("Feedback attachments are limited to 10 MB total.");
    return {
      token,
      path,
      name: basename(String(upload.name || "attachment")).slice(0, 255),
      mime: String(upload.mime || "application/octet-stream").slice(0, 120),
      size,
    };
  });
}

export function createFeedback(input: { userId: number; comment: unknown; sendDiagnostics: boolean; uploads: Upload[]; appRoot: string }): Row {
  const comment = String(input.comment || "").trim().slice(0, 10_000);
  const attachments = cleanUploads(input.uploads || []);
  if (!comment && !attachments.length) throw new Error("Write feedback or attach a file.");
  const timestamp = now();
  const publicId = `fb_${randomBytes(12).toString("hex")}`;
  const diagnostics = input.sendDiagnostics ? reportDiagnostics(input.appRoot) : {};
  const id = run(`INSERT INTO feedback_reports
    (public_id,user_id,comment,diagnostics,send_diagnostics,state,created,updated)
    VALUES (?,?,?,?,?,'pending',?,?)`, publicId, input.userId, comment, JSON.stringify(diagnostics), input.sendDiagnostics ? 1 : 0, timestamp, timestamp).lastInsertRowid;
  for (const attachment of attachments) run(`INSERT INTO feedback_attachments
    (report_id,name,mime,size,path,created) VALUES (?,?,?,?,?,?)`, id, attachment.name, attachment.mime, attachment.size, attachment.token, timestamp);
  return feedbackReport(id)!;
}

function feedbackReport(id: number): Row | undefined {
  const report = q1(`SELECT fr.*,u.display user_display,u.username
    FROM feedback_reports fr LEFT JOIN users u ON u.id=fr.user_id WHERE fr.id=?`, id);
  if (!report) return undefined;
  return {
    ...report,
    diagnostics: JSON.parse(String(report.diagnostics || "{}")),
    attachments: q("SELECT id,name,mime,size FROM feedback_attachments WHERE report_id=? ORDER BY id", id),
  };
}

export function localFeedbackReports(limit = 200): Row[] {
  return q("SELECT id FROM feedback_reports ORDER BY created DESC LIMIT ?", Math.max(1, Math.min(500, limit)))
    .map((row) => feedbackReport(Number(row.id))!);
}

export function feedbackAttachment(reportId: number, attachmentId: number): Row | undefined {
  const row = q1("SELECT * FROM feedback_attachments WHERE id=? AND report_id=?", attachmentId, reportId);
  if (!row || !existsSync(join(UPLOAD_DIR, String(row.path)))) return undefined;
  return row;
}

async function relayOne(report: Row): Promise<void> {
  const workspace = q1("SELECT installation_id,name FROM workspace WHERE id=1") || {};
  const attachments = (report.attachments as Row[] || []).map((attachment) => {
    const stored = q1("SELECT path FROM feedback_attachments WHERE id=?", attachment.id);
    const data = readFileSync(join(UPLOAD_DIR, String(stored?.path || "")));
    return { name: attachment.name, mime: attachment.mime, size: attachment.size, data: data.toString("base64") };
  });
  const response = await fetch(COLLECTOR, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": `1Helm/${String((report.diagnostics as Record<string, unknown>)?.version || "unknown")}`,
    },
    body: JSON.stringify({
      public_id: report.public_id,
      installation_id: workspace.installation_id,
      workspace_name: workspace.name,
      comment: report.comment,
      diagnostics: report.diagnostics,
      attachments,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as { id?: string; error?: string };
  if (!response.ok) throw new Error(payload.error || `Feedback service returned HTTP ${response.status}.`);
  run("UPDATE feedback_reports SET state='delivered',remote_id=?,last_error='',updated=? WHERE id=?", String(payload.id || report.public_id), now(), report.id);
}

export async function drainFeedback(): Promise<void> {
  for (const row of q("SELECT id FROM feedback_reports WHERE state IN ('pending','failed') AND attempt_count<12 ORDER BY created,id LIMIT 10")) {
    const claimed = run("UPDATE feedback_reports SET state='sending',attempt_count=attempt_count+1,updated=? WHERE id=? AND state IN ('pending','failed')", now(), row.id);
    if (!claimed.changes) continue;
    try {
      await relayOne(feedbackReport(Number(row.id))!);
    } catch (error) {
      run("UPDATE feedback_reports SET state='failed',last_error=?,updated=? WHERE id=?", String((error as Error).message).slice(0, 500), now(), row.id);
    }
  }
}

export function startFeedbackLoop(): void {
  if (retryTimer) return;
  const tick = (): void => { void drainFeedback(); };
  tick();
  retryTimer = setInterval(tick, 5 * 60_000);
  retryTimer.unref();
}

export async function centralFeedbackReports(): Promise<unknown[]> {
  if (!ADMIN_TOKEN) return [];
  const response = await fetch(COLLECTOR, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Central feedback inbox returned HTTP ${response.status}.`);
  const payload = await response.json() as { reports?: unknown[] };
  return payload.reports || [];
}

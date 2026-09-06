type Row = Record<string, unknown>;
type Query = (sql: string, ...args: unknown[]) => Row[];
type QueryOne = (sql: string, ...args: unknown[]) => Row | undefined;
type Run = (sql: string, ...args: unknown[]) => unknown;

const UNKNOWN_RESULT = "Error: tool execution was interrupted by a server restart. Completion is unknown; inspect current state before retrying or relying on side effects.";

/** Durably close crash-stranded calls and retain their primary keys forever. */
export function settleRestartInterruptedTools(q: Query, q1: QueryOne, run: Run, interruptedAt: number): void {
  for (const action of q(`SELECT ta.id,ta.thread_id,ta.tool,th.span_id,th.payload
      FROM tool_actions ta LEFT JOIN thread_history th ON th.thread_id=ta.thread_id
        AND th.source_type='tool_action' AND th.source_id=ta.id AND th.kind='tool_call'
      WHERE ta.status='running' ORDER BY th.seq DESC`)) {
    const threadId = Number(action.thread_id || 0), actionId = Number(action.id || 0);
    if (!threadId || !actionId || !action.payload) continue;
    let callId = String(action.span_id || "");
    try { callId = String(JSON.parse(String(action.payload)).call_id || callId); } catch { /* use span */ }
    const seq = Number(q1("SELECT COALESCE(MAX(seq),0)+1 seq FROM thread_history WHERE thread_id=?", threadId)?.seq || 1);
    run(`INSERT OR IGNORE INTO thread_history (thread_id,seq,kind,payload,source_type,source_id,span_id,invocation_id,created)
      VALUES (?,?,'tool_result',?,'tool_action_result',?,?,(SELECT invocation_id FROM tool_actions WHERE id=?),?)`,
    threadId, seq, JSON.stringify({ call_id: callId, name: String(action.tool || "tool"), result: UNKNOWN_RESULT, status: "failed" }), actionId, callId, actionId, interruptedAt);
  }
  run("UPDATE tool_actions SET status='failed',result_summary=? WHERE status='running'", UNKNOWN_RESULT);
}

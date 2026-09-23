import { q1, type Row } from "./db.ts";

export type OperationalSessionState = "working" | "needs_you" | "scheduled" | "failed" | "complete" | "idle" | "archived";

/** Runtime records—not prose or the ambiguous legacy open value—own Board state. */
export function operationalSessionView(thread: Row): { operational_state: OperationalSessionState } {
  const threadId = Number(thread.id);
  const rootId = Number(thread.root_message_id);
  const activeTurn = q1("SELECT 1 FROM agent_turns WHERE thread_root_id=? AND state IN ('queued','running') LIMIT 1", rootId);
  const question = q1(`SELECT 1 FROM agent_questions aq JOIN messages m ON m.id=aq.message_id
    WHERE (m.id=? OR m.parent_id=?) AND aq.status='pending' LIMIT 1`, rootId, rootId);
  const escalation = q1("SELECT 1 FROM escalations WHERE thread_id=? AND status='open' LIMIT 1", threadId);
  const followup = q1("SELECT 1 FROM agent_followups WHERE thread_id=? AND status IN ('pending','running') LIMIT 1", threadId);
  const status = String(thread.status || "open");
  if (status === "archived") return { operational_state: "archived" };
  if (activeTurn) return { operational_state: "working" };
  if (question || escalation) return { operational_state: "needs_you" };
  if (followup) return { operational_state: "scheduled" };
  if (status === "failed") return { operational_state: "failed" };
  if (status === "resolved") return { operational_state: "complete" };
  return { operational_state: "idle" };
}

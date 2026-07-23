import { now, q1, run, tx } from "./db.ts";

export type AgentTurnState = "queued" | "running" | "waiting" | "completed" | "failed" | "stopped" | "cancelled";
export type FinalAgentTurnState = Exclude<AgentTurnState, "queued" | "running">;

/** Acquire the only writer lease for a never-started turn. The monotonically
 * increasing generation fences callbacks left behind by an older attempt. */
export function claimAgentTurn(turnId: number): number | null {
  return tx(() => {
    const claimed = run(
      "UPDATE agent_turns SET state='running',started_at=?,finished_at=NULL,error='',writer_generation=writer_generation+1 WHERE id=? AND state='queued'",
      now(), turnId,
    );
    if (!claimed.changes) return null;
    return Number(q1("SELECT writer_generation FROM agent_turns WHERE id=?", turnId)?.writer_generation || 0) || null;
  });
}

export function ownsAgentTurnWriter(turnId: number, generation: number): boolean {
  return Boolean(q1(
    "SELECT 1 FROM agent_turns WHERE id=? AND state='running' AND writer_generation=?",
    turnId, generation,
  ));
}

/** The sole mutable response-body path for durable turns. Once the turn leaves
 * running, or a newer generation owns it, this update becomes a no-op. */
export function writeAgentTurnBody(turnId: number, generation: number, messageId: number, body: string): boolean {
  return Boolean(run(`UPDATE messages SET body=? WHERE id=? AND EXISTS (
    SELECT 1 FROM agent_turns WHERE id=? AND message_id=? AND state='running' AND writer_generation=?
  )`, body, messageId, turnId, messageId, generation).changes);
}

/** Progress is fenced by the same lease as the response body so a late stream
 * cannot resurrect a finalized row as "Working…". */
export function updateAgentTurnProgress(
  turnId: number,
  generation: number,
  progressId: number,
  body: string,
  status: "running" | "complete" | "failed",
): boolean {
  return Boolean(run(`UPDATE agent_progress SET body=?,status=?,updated=? WHERE id=? AND EXISTS (
    SELECT 1 FROM agent_turns at JOIN agent_progress ap ON ap.message_id=at.message_id
    WHERE at.id=? AND at.state='running' AND at.writer_generation=? AND ap.id=?
  )`, body, status, now(), progressId, turnId, generation, progressId).changes);
}

/** One finalizer owns closure. It freezes the exact visible body hash and clears
 * any live progress in the same transaction. Later writers cannot mutate the
 * message because the lease is no longer running. */
export function finalizeAgentTurn(
  turnId: number,
  state: FinalAgentTurnState,
  error = "",
  expected: "queued" | "running" = "running",
  generation?: number,
): boolean {
  return tx(() => {
    const turn = q1("SELECT message_id,writer_generation,state FROM agent_turns WHERE id=?", turnId);
    if (!turn || turn.state !== expected) return false;
    if (generation != null && Number(turn.writer_generation) !== generation) return false;
    const messageId = Number(turn.message_id);
    const body = String(q1("SELECT body FROM messages WHERE id=?", messageId)?.body || "");
    const changed = run(`UPDATE agent_turns SET state=?,finished_at=?,error=?,final_body_hash=sha256(?)
      WHERE id=? AND state=? AND writer_generation=?`,
    state, now(), error, body, turnId, expected, Number(turn.writer_generation)).changes;
    if (!changed) return false;
    run(
      "UPDATE agent_progress SET status=?,updated=? WHERE message_id=? AND status='running'",
      state === "failed" ? "failed" : "complete", now(), messageId,
    );
    // Final connector replies are obligations, not a best-effort callback. The
    // connector worker records an attempt before sending and can recover a
    // never-attempted row after restart. An interrupted attempt is surfaced as
    // uncertain instead of being blindly replayed and possibly duplicated.
    if (["completed", "failed"].includes(state) && body.trim() && body !== "_Working…_") {
      const inbound = q1(`SELECT pm.id,pm.channel_id,pm.space_id FROM agent_turns at
        JOIN photon_messages pm ON pm.message_id=at.trigger_id AND pm.direction='inbound'
        WHERE at.id=?`, turnId);
      if (inbound && !q1(`SELECT 1 FROM photon_messages
        WHERE channel_id=? AND space_id=? AND direction='outbound' AND id>?`,
      inbound.channel_id, inbound.space_id, inbound.id)) {
        run(`INSERT OR IGNORE INTO connector_deliveries
          (connector,idempotency_key,channel_id,destination,body,source_message_id,state,created,updated)
          VALUES ('photon',?,?,?,?,?,'pending',?,?)`,
        `photon:turn:${turnId}:final`, inbound.channel_id, inbound.space_id, body, messageId, now(), now());
      }
    }
    return true;
  });
}

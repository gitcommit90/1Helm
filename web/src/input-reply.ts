// Server-issued question and source-turn identities. The browser never chooses a worker.
export type InputRequest = {
  question_id: string; source_turn: string; session?: string; helper_id?: string; round?: number;
  status: string; question: string; presentation?: string; answer_text?: string;
};
export type InputReply = { question_id?: string; source_turn?: string; response_id: string; action?: string };
export const responseId = () => globalThis.crypto?.randomUUID?.() || `input-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function replyBinding(pending: InputRequest[], sourceTurn?: string, request?: InputRequest): Omit<InputReply, 'response_id'> | undefined {
  const open = pending.filter(x => x.status === 'pending');
  const question = request?.status === 'pending' ? request : sourceTurn ? open.find(x => x.source_turn === sourceTurn) : open.length === 1 ? open[0] : undefined;
  if (!sourceTurn && !question) return undefined;
  return { ...(question ? { question_id: question.question_id } : {}), ...(sourceTurn || question?.source_turn ? { source_turn: sourceTurn || question!.source_turn } : {}) };
}

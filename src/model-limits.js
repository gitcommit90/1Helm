// Managed model waits are bounded independently of the Resident's liveness
// heartbeat. Heartbeats and SSE comments are not evidence of model progress.
// Starting values. The values in effect are the saved limits (limits.js: first reply, silence and total time of a main chat call), which a turn passes in.
export const MODEL_LIMITS = { headersMs: 120_000, idleMs: 120_000, totalMs: 300_000 };
export const OUTPUT_RECOVERY_NOTE = "(Your last message was cut off at the output limit. This is the single recovery attempt. Call the tools you need with short arguments, or give a concise answer now.)";
export const modelFault = (code, phase = null) => Object.assign(new Error(code), { modelFailure: true, code, phase, recoverable: true });
export function modelFailureReply(failure) {
  return (failure?.code === 'model_output_limit'
    ? "The model reached its output limit twice without producing a tool action, so I stopped this attempt."
    : failure?.phase === 'total'
      ? "The model took too long to finish, so I stopped this attempt."
      : "The model stopped responding in time, so I stopped this attempt.")
    + " Any completed steps remain in this task. Send another message to continue.";
}
export function rememberModelFailure(R, tc, error) {
  if (!tc || tc.committed || !error?.modelFailure) return;
  tc.modelFailure = { code: error.code, phase: error.phase || null };
  R.journalModelRecovery?.(tc);
}
// A paid attempt can succeed inside repeat/escalation recovery before the next
// attempt fails. Its caller never receives an aggregate result in that case.
export function retainModelUsage(R, tc, result) {
  if (!tc) return;
  const u = tc.failedModelUsage ||= { in: 0, out: 0, cached: 0, cache_write: 0, charge: 0 };
  for (const [key, field] of [['in','inTok'],['out','outTok'],['cached','cached'],['cache_write','cacheWrite'],['charge','charge']]) u[key] += Number(result[field]) || 0;
  if (!tc.committed) R.journalModelRecovery?.(tc);
}
export function drainModelUsage(tc, stats) {
  if (!tc.failedModelUsage) return;
  for (const key of ['in','out','cached','cache_write','charge']) stats[key] += Number(tc.failedModelUsage[key]) || 0;
  tc.failedModelUsage = null;
}
// Reserve the single retry durably before handing the engine its next input.
// The count belongs to this card, not a model call/checkpoint/deploy instance.
export function claimOutputRecovery(R, tc) {
  if ((tc.outputLimitRetries || 0) >= 1) {
    const error = modelFault('model_output_limit'); rememberModelFailure(R, tc, error); throw error;
  }
  tc.outputLimitRetries = 1; R.journalModelRecovery?.(tc);
  return OUTPUT_RECOVERY_NOTE;
}
export function meaningfulDelta(delta) {
  return !!(delta?.content || delta?.reasoning || delta?.reasoning_content
    || delta?.reasoning_details?.length
    || delta?.tool_calls?.some(c => c.id || c.function?.name || c.function?.arguments));
}
// Abort both the real request and this await. The race also bounds bindings or
// test doubles which ignore AbortSignal; their late streams are disposed.
export function modelDeadline(controller, limits = MODEL_LIMITS) {
  let phase = 'headers', idle = null, total = null, disposed = false;
  const signal = controller.signal;
  const expire = p => { if (!signal.aborted) controller.abort(modelFault('model_timeout', p)); };
  const arm = ms => { clearTimeout(idle); idle = setTimeout(() => expire(phase), ms); };
  arm(limits.headersMs); total = setTimeout(() => expire('total'), limits.totalMs);
  const reason = () => signal.reason instanceof Error ? signal.reason : new Error('aborted');
  return {
    signal,
    reason,
    headers() { if (disposed || signal.aborted) return; phase = 'idle'; arm(limits.idleMs); },
    progress() { if (!disposed && !signal.aborted && phase === 'idle') arm(limits.idleMs); },
    async wait(promise, late = null) {
      let rejectAbort;
      const aborted = new Promise((_, reject) => { rejectAbort = () => reject(reason()); });
      signal.addEventListener('abort', rejectAbort, { once: true });
      if (signal.aborted) rejectAbort();
      const pending = Promise.resolve(promise).then(value => {
        if (signal.aborted) { try { Promise.resolve(late?.(value)).catch(() => {}); } catch {} throw reason(); }
        return value;
      });
      try { return await Promise.race([pending, aborted]); }
      finally { signal.removeEventListener('abort', rejectAbort); }
    },
    dispose() { disposed = true; clearTimeout(idle); clearTimeout(total); },
  };
}

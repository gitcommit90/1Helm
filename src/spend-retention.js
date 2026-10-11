import {progressEntries} from './progress-dedupe.js';
export const RETAIN = 128;
const tail = (xs, first = false) => { if (Array.isArray(xs) && xs.length > RETAIN) xs.splice(first ? 1 : 0, xs.length - RETAIN); };
// Optional running-state tails only. Canonical messages and card/tool events stay
// in SQLite; unknown, actionable, bookkeeping-answer and current text never go.
export function trimTurnState(tc, {said = [], saidMeta = [], stats, trace, stepIn, wmLog} = {}) {
  if (tc?.spendPauses !== false) return 0;
  tail(trace); tail(stats?.models, true); tail(stepIn, true); tail(wmLog); tail(tc.contextSteps);
  const candidates = progressEntries(said, saidMeta).filter(p => p.progress && p.index < said.length - 1).map(p => p.index);
  const remove = candidates.slice(0, Math.max(0, candidates.length - RETAIN));
  if (!remove.length) return 0;
  const texts = remove.map(i => said[i]);
  for (const i of remove.reverse()) { said.splice(i, 1); saidMeta.splice(i, 1); }
  tc.progressOmitted = (tc.progressOmitted || 0) + texts.length;
  if (tc.replyState) {
    const r = tc.replyState;
    for (const text of texts) { const i = r.prog.findIndex(x => x.trim() === text.trim()); if (i >= 0) r.prog.splice(i, 1); }
    r.progress_omitted = tc.progressOmitted;
    tc.text = [...r.pre, ...r.prog, r.body].filter(Boolean).join('\n\n');
    tc.emit?.({t:'snapshot',turn:tc.turn,text:tc.text,reply_state:{...r,pre:[...r.pre],prog:[...r.prog]}});
  }
  return texts.length;
}
export function resumedReplyState(said, saidMeta, omitted = 0) {
  const parts = progressEntries(said, saidMeta), pre = [], prog = [];
  for (const p of parts) (p.progress ? prog : pre).push(p.text);
  return {body:'',pre,prog,held_progress:'',...(omitted > 0 ? {progress_omitted:omitted} : {})};
}
export function diagnosticTrace(trace, omitted = 0) {
  const out = [...trace];
  if (omitted) out.push({tool:'progress_history',omitted});
  // Valid JSON rather than a cut-off serialization; these are previews only.
  while (out.length > 1 && JSON.stringify(out).length > 60000) out.shift();
  return JSON.stringify(out);
}

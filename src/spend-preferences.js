// The account's discretionary workload/spending check-ins. This never grants
// credits, bypasses an approval, or cancels the person's explicit Stop.
export const SPEND_PAUSES_KEY = 'spend_pauses';
// A helper runs with nobody watching, so its step, cost and time limits (limits.js, helper_*) always apply. The account switch
// "Pause to check spending" (off by default) only governs turns the person is waiting on.
export const isHelperTurn = tc => !!tc && (tc.kind === 'helper' || !!tc.helper);
export const spendPausesOn = tc => tc?.spendPauses !== false || isHelperTurn(tc);
// Agent check-ins (agent-checkins.js) keep their own numbers (silent, fast) but are one kind of spending pause: they happen only while
// "Pause to check spending" is on. The turn keeps a snapshot of the check-in numbers in tc.guard.checkins.
export const CHECKIN_PAUSES = ['silent', 'fast'];
export const checkinsOn = tc => spendPausesOn(tc) && tc?.guard?.checkins?.enabled === true;
// Whether a pause or limit on this turn applies: only while "Pause to check spending" is on (or the turn is a helper's).
export const pausesApply = tc => spendPausesOn(tc);
export const stepAllowance = (tc, normal) => spendPausesOn(tc) ? normal : Number.MAX_SAFE_INTEGER;
export function applySpendPreference(tc, enabled) {
  const was = tc.spendPauses;
  tc.spendPauses = enabled !== false;
  if (tc.spendPauses || isHelperTurn(tc)) return;   // a helper keeps its limits and its stop whatever the switch says
  if (tc.guard?.wallT) { clearTimeout(tc.guard.wallT); tc.guard.wallT = null; }
  if (tc.guard) { tc.guard.pre = false; if (was !== false) tc.guard.watch = { calls: [], said: !!tc.guard.watch?.said }; }
  if (tc.abort !== 'hard' && (tc.pause || ['cost', 'steps', 'time'].includes(tc.limitWhy) || tc.helperWhy === 'time limit')) {
    if (tc.abort === 'soft') tc.abort = null;
    tc.pause = null; tc.limitWhy = null; tc.budgetHit = false;
    if (tc.helperWhy === 'time limit') tc.helperWhy = null;
  }
}
export async function readSpendPreference(ledger) {
  // Old isolates/stubs keep pausing. A failed read never silently turns off a
  // person's saved choice; the next successful boundary reads it again.
  try { return (await ledger?.spendPreferences()).enabled !== false; } catch { return true; }
}

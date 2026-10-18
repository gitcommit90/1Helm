// The account's discretionary workload/spending check-ins. This never grants
// credits, bypasses an approval, or cancels the person's explicit Stop.
export const SPEND_PAUSES_KEY = 'spend_pauses';
// A helper runs with nobody watching, so its step, cost and time limits (limits.js, helper_*) always apply. The account switch
// "Pause to check spending" (off by default) only governs turns the person is waiting on.
export const isHelperTurn = tc => !!tc && (tc.kind === 'helper' || !!tc.helper);
export const spendPausesOn = tc => tc?.spendPauses !== false || isHelperTurn(tc);
// Agent check-ins (agent-checkins.js) are their own switch. The turn keeps a snapshot of it in tc.guard.checkins.
export const CHECKIN_PAUSES = ['silent', 'fast'];
export const checkinsOn = tc => tc?.guard?.checkins?.enabled === true;
// Whether a pause or limit on this turn applies: any spending pause while "Pause to check spending" is on, and a check-in pause
// whenever check-ins are on, even with the spending pauses off.
export const pausesApply = tc => spendPausesOn(tc) || (checkinsOn(tc) && CHECKIN_PAUSES.includes(tc?.pause?.reason));
export const stepAllowance = (tc, normal) => spendPausesOn(tc) ? normal : Number.MAX_SAFE_INTEGER;
export function applySpendPreference(tc, enabled) {
  const was = tc.spendPauses;
  tc.spendPauses = enabled !== false;
  if (tc.spendPauses || isHelperTurn(tc)) return;   // a helper keeps its limits and its stop whatever the switch says
  const keepCheckins = checkinsOn(tc);   // check-ins keep counting tool calls while the spending pauses are off
  if (tc.guard?.wallT) { clearTimeout(tc.guard.wallT); tc.guard.wallT = null; }
  if (tc.guard) { tc.guard.pre = false; if (was !== false && !keepCheckins) tc.guard.watch = { calls: [], said: !!tc.guard.watch?.said }; }
  const checkinPause = keepCheckins && CHECKIN_PAUSES.includes(tc.pause?.reason);
  if (tc.abort !== 'hard' && !checkinPause && (tc.pause || ['cost', 'steps', 'time'].includes(tc.limitWhy) || tc.helperWhy === 'time limit')) {
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

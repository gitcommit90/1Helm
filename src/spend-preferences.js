// The account's discretionary workload/spending check-ins. This never grants
// credits, bypasses an approval, or cancels the person's explicit Stop.
export const SPEND_PAUSES_KEY = 'spend_pauses';
export const spendPausesOn = tc => tc?.spendPauses !== false;
export const stepAllowance = (tc, normal) => spendPausesOn(tc) ? normal : Number.MAX_SAFE_INTEGER;
export function applySpendPreference(tc, enabled) {
  const was = tc.spendPauses;
  tc.spendPauses = enabled !== false;
  if (tc.spendPauses) return;
  if (tc.guard?.wallT) { clearTimeout(tc.guard.wallT); tc.guard.wallT = null; }
  if (tc.guard) { tc.guard.pre = false; if (was !== false) tc.guard.watch = { calls: [], said: !!tc.guard.watch?.said }; }
  if (tc.abort !== 'hard' && (tc.pause || ['cost', 'steps', 'time'].includes(tc.limitWhy) || tc.helperWhy === 'time limit')) {
    if (tc.abort === 'soft') tc.abort = null;
    tc.pause = null; tc.limitWhy = null; tc.budgetHit = false;
    if (tc.helperWhy === 'time limit') tc.helperWhy = null;
  }
}
export async function readSpendPreference(ledger) {
  // Old isolates/stubs retain the existing ON policy. A failed read never
  // silently disables safeguards; the next successful boundary reads it again.
  try { return (await ledger?.spendPreferences()).enabled !== false; } catch { return true; }
}

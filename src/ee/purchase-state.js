// What really happened to a Link purchase, in plain words. Link's own status only says whether the person approved the
// request and Link issued a card ("approved"). It never says the store charged the card, and 1Helm does not read the
// store's order confirmation, so no state here claims "paid". Only recorded facts are used. The store's name is already
// the row title in the Wallet, so the sentences leave it out to stay on one short line.

// p: a link_purchases row. Returns { state, text } where state is a stable key for the UI and tests.
export function purchaseOutcome(p) {
  const s = String(p.status || "").toLowerCase();
  const filled = Number(p.card_filled_at) || 0, failed = Number(p.fill_failed_at) || 0, hand = Number(p.handoff_at) || 0;
  const failedLast = failed > filled;   // the latest card attempt is the one that counts
  if (s === "created" || s === "pending_approval") return { state: "waiting", text: "Waiting for your approval" };
  if (s === "denied" || s === "declined" || s === "rejected") return { state: "declined", text: "Declined. Nothing charged" };
  if (s === "canceled" || s === "cancelled") return { state: "canceled", text: filled ? "Canceled after the card was filled in. Check the order" : "Canceled. Nothing charged" };
  if (s === "expired") return { state: "expired", text: filled ? "Expired after the card was filled in. Check the order" : "Expired. Nothing charged" };
  if (s === "approved") {
    if (failedLast) return hand >= failed
      ? { state: "fill_failed_handed_off", text: "Approved, card not filled in. Handed to you. Not paid" }
      : { state: "fill_failed", text: "Approved, but card not filled in. Not paid" };
    if (filled) return hand >= filled
      ? { state: "card_filled_handed_off", text: "Card filled in. Handed to you. Not confirmed paid" }
      : { state: "card_filled", text: "Card filled in. Not confirmed paid" };
    if (hand) return { state: "handed_off", text: "Approved. Card unused. Handed to you" };
    return { state: "approved_unused", text: "Approved. Card not used yet" };
  }
  return { state: "unknown", text: "Status unknown. Not confirmed paid" };
}

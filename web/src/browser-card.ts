// The "<helper> is using the browser" card (and the "Your turn in the browser" hand-off card) is drawn live from a
// browser event. Nothing in the saved task says it, so a reload never shows it. Once nothing is running for the task,
// the card must go away the same way, even when the end event never reached this tab.
type Cardish = { t?: string; text?: string };
type Msgish = { cards?: Cardish[] };
type Taskish = { streaming?: boolean; state?: string; srv?: { waiting?: string; state?: string } | null; messages: Msgish[] };

// True when the task is idle here and on the server, so no browser card should be showing.
export function browserCardsStale(s: Taskish): boolean {
  return !s.streaming && s.state !== "working" && s.srv?.state !== "working";
}

// Removes browser cards that no longer match what is running. A hand-off card stays while the server says the task is
// waiting on the person in the browser. Returns true when it removed something.
export function settleBrowserCards(s: Taskish): boolean {
  if (!browserCardsStale(s)) return false;
  const keepHandoff = s.srv?.waiting === "browser";
  let changed = false;
  for (const m of s.messages) {
    if (!m.cards?.some(c => c.t === "browser")) continue;
    const kept = m.cards.filter(c => c.t !== "browser" || (keepHandoff && !!c.text));
    if (kept.length !== m.cards.length) { m.cards = kept; changed = true; }
  }
  return changed;
}

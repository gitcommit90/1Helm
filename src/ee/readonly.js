// What a read-only account is told (index.js accessOf, pastdue.js, texting.js, the Resident). Captain 10-06: a failed payment makes
// 1Helm read-only at once; nothing that costs anything runs until it's fixed.
export const PAY_MSG = "Your payment didn't go through. 1Helm is read-only until you update your card.";
export const INACTIVE_MSG = "Your 1Helm plan isn't active, so 1Helm is read-only.";
// A text to the helper while read-only gets one of these back, with no model call.
export const PAUSED_TEXT = (link) => `Your 1Helm plan payment didn't go through, so I'm paused. Fix it in the app: ${link}`;
export const INACTIVE_TEXT = (link) => `Your 1Helm plan isn't active, so I'm paused. Open the app: ${link}`;

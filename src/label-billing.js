// How the background labelling calls are billed. A leaf module, so the task summaries (tracker.js) and the chat titles (chat-titles.js) share it without importing each other.
// Captain 2026-10-05: the labeller is billed to the person (reserved and settled on the tenant ledger like any model call). false would make it platform overhead.
export const BILL_LABELLER = true;
export const LABEL_MARKUP = 1.15;

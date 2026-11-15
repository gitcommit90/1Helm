// A running helper (subagent, background job) needs a quiet cue wherever its task is listed, not only in the open task's progress row.
// The server sends the number of running helpers on every task of every channel (sessionView.helpers, counted for status "running" only),
// and the 6-second boot poll refreshes it, so the cue follows tasks the person is not looking at. A helper that waits on the person has its own
// "waiting" wording and is not counted. The cue is separate from the unread dot, which only an unseen reply lights.
export type HelperTask = { done?: boolean; srv?: { helpers?: unknown } | null };
export const helperRunning = (x: HelperTask) => !x.done && Number(x.srv?.helpers) > 0;
export const channelHelperRunning = (tasks: HelperTask[]) => tasks.some(helperRunning);

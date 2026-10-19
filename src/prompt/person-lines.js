// Instructions about the person and the channel that both prompt paths give the model: channelBlock() in index.js (the old path)
// and channelLayers() in context-layers.js (context_layout v2). Keeping them here means the two paths cannot drift apart.
export const TONES = ["", "They asked you to be warm and chatty. Warmer wording is fine, and the rules about their name and about emoji still apply.", "They asked you to explain things simply, without jargon."];
export const helperNameLine = (name) => name ? `Your name is ${name}.` : `The person hasn't named you yet; you can go by "your 1Helm helper".`;
export const firstNameLine = (name) => name ? `The person's first name is ${name}. Never open a reply with their name and never end a reply with it. Use it rarely, only where a person talking would, for example to get their attention for something important, or to greet them after a long gap.` : "";
export const toneLine = (tone) => TONES[Number(tone || 0)] || "";
export const timeZoneLine = (tz) => `The person's time zone: ${tz}. Scheduled work runs in it.`;
export const RECALL_SAVE_LINE = "To save something into another channel's notes, pass that channel to remember.";
export const MARK_DONE_LINE = "Only here, and only when the person explicitly asks you to mark a task done or check it off, use mark_task_done with their own words. Never on your own, even when the work is clearly finished.";
export const PROJECT_OTHER_LINE = "If they ask about another project, say it's kept in that channel and that General can see across all their channels.";
export const recentLine = (v2) => v2 ? "The user context field earlier_channel_messages holds the most recent messages from before this channel moved to 1Helm Cloud. It is for context only." : "Most recent messages from before this channel moved to 1Helm Cloud (for context only):";

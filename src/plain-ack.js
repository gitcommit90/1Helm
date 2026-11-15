// Fixed sentences the app itself shows the person when the main helper hands a job to a background helper.
// They use everyday words only: no "worker", "Primary", "sub-agent", "delegation" or other internal names.
export const ACK_JOB_STARTED_VARIANTS = ["Checking.", "Checking on this.", "On it.", "Let me take a look.", "Looking into this.", "On it."];
export const ACK_JOB_STARTED = ACK_JOB_STARTED_VARIANTS[0];
export const ACK_UPDATE_SENT = "Got it.";
export const ACK_UPDATE_UNCONFIRMED = "I couldn't confirm that your update went through before a restart, and I haven't sent it again. Please send it again if it's still needed.";
export const ACK_RESULT_NOT_READY = "I'm still checking that result, so I haven't given it to you yet.";
export const ACK_UPDATE_FAILED = "I couldn't pass your update along. Please try again.";
export const ACK_JOB_NOT_STARTED = "I couldn't start that job. Please try again.";
export const ACK_ANSWER_RECEIVED = "Got your answer. I'll carry on with it.";
export const PERSON_FACING_ACKS = [...ACK_JOB_STARTED_VARIANTS, ACK_UPDATE_SENT, ACK_UPDATE_UNCONFIRMED, ACK_RESULT_NOT_READY, ACK_UPDATE_FAILED, ACK_JOB_NOT_STARTED, ACK_ANSWER_RECEIVED];

// The job-started line rotates through the variants in order. The caller keeps the counter per channel (the Resident's kv) and passes the current value, so the same line never shows twice in a row.
export const jobStartedReply = (n) => ACK_JOB_STARTED_VARIANTS[((Number(n) || 0) % ACK_JOB_STARTED_VARIANTS.length + ACK_JOB_STARTED_VARIANTS.length) % ACK_JOB_STARTED_VARIANTS.length];

// Replies for a turn the person did not start: a worker's returned result, a pause, a due follow-up or a resume that runs the main helper.
// The person sees a message from such a turn only when it has something for them (the result, a question, a real failure). These lines answer
// something the person sent, so on such a turn they are left out: the progress row already shows the work continues.
export const ACK_INTERNAL_UPDATE_FAILED = "I couldn't pass a correction along to the background work, so its result may not match what you asked for.";
export const ACK_INTERNAL_UPDATE_UNCONFIRMED = "I couldn't confirm that a correction reached the background work before a restart, and I haven't sent it again.";
const QUIET_ON_INTERNAL_TURN = new Set([...ACK_JOB_STARTED_VARIANTS, ACK_UPDATE_SENT, ACK_RESULT_NOT_READY, ACK_ANSWER_RECEIVED]);
const INTERNAL_WORDING = new Map([[ACK_UPDATE_FAILED, ACK_INTERNAL_UPDATE_FAILED], [ACK_UPDATE_UNCONFIRMED, ACK_INTERNAL_UPDATE_UNCONFIRMED]]);
// The one rule: the line to show for this turn. On an internal turn the answering lines become "" (no reply), and the failure lines that speak
// of "your update" use wording that fits. Every other line (a question, a result, a real failure) is returned unchanged.
export const ackFor = (internal, line) => !internal ? line : QUIET_ON_INTERNAL_TURN.has(line) ? "" : INTERNAL_WORDING.get(line) ?? line;

// Computer capacity: the platform refuses a start ("no container instance ...") when the class is at max_instances.
// The person and the helper see one plain message instead of the platform text or a 60 s retry loop.
export const COMPUTER_BUSY_MSG = "All computers are busy right now. Try again in a minute.";
// A refusal can also come back for ~5 s after the same computer's previous stop, so a few retries are still made.
export const CAPACITY_RETRY_MS = 12e3;
const CAPACITY_RE = /no container instance|container instances? (?:limit|quota)|max(?:imum)?[_ ]instances|instance limit|too many (?:container )?instances|(?:out of|insufficient|not enough) (?:capacity|resources)|at capacity|capacity (?:reached|exceeded|limit)/i;
export const isCapacityError = (e) => CAPACITY_RE.test(String(e?.message ?? e ?? ""));
// A step that needs a computer waits and retries instead of ending: pauses grow through BUSY_PAUSES_MS (the last one repeats) until BUSY_WAIT_MAX_MS have passed in total.
export const BUSY_PAUSES_MS = [15e3, 30e3, 60e3], BUSY_WAIT_MAX_MS = 15 * 60e3;
export const BUSY_WAITING = "waiting for a free computer", BUSY_GIVEUP_MSG = "All computers were busy for 15 minutes. Try again later.";
// The plain reply for a busy error (the immediate one or the one after the wait), else null.
export const busyReply = (e) => String(e?.message ?? e ?? "").includes(BUSY_GIVEUP_MSG) ? BUSY_GIVEUP_MSG : isComputerBusy(e) ? COMPUTER_BUSY_MSG : null;
// Runs run() again after each busy refusal. The pause is an in-memory timer that the person's Stop (tc.stopped, tc.abort) ends at once; a deploy that resets the object
// resumes the journaled turn (resume.js), which runs the step again. The status line shows the wait; no model call is made here.
export async function retryWhileBusy(run, tc, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const t0 = Date.now(), line = tc?.line; let waited = false;
  for (let i = 0; ; i++) {
    try { const r = await run(); if (waited) tc?.emit?.({ t: "status", line }); return r; }
    catch (e) {
      const pause = BUSY_PAUSES_MS[Math.min(i, BUSY_PAUSES_MS.length - 1)];
      if (!isComputerBusy(e) || tc?.abort === "hard") throw e;
      if (Date.now() - t0 + pause > BUSY_WAIT_MAX_MS) throw Object.assign(new Error(BUSY_GIVEUP_MSG), { status: 503, code: "computers_busy" });
      waited = true; tc?.emit?.({ t: "status", line: BUSY_WAITING });
      await Promise.race([sleep(pause), ...(tc?.stopped ? [tc.stopped] : [])]);
      if (tc?.abort === "hard") throw e;
    }
  }
}
export const isComputerBusy = (e) => String(e?.message ?? e ?? "").includes(COMPUTER_BUSY_MSG);
export const computerBusyError = () => Object.assign(new Error(COMPUTER_BUSY_MSG), { status: 503, code: "computers_busy" });

// The part of a command's output the model gets: its end, at most `outMax` characters (20,000 unless the caller asks for more, never over 200,000). When the beginning is cut, the output says
// so on its first line, because the end of a long file ("cat" of 26,000 characters) otherwise reads as the whole file and the model reads it again in pieces.
export function tailOutput(out, outMax) {
  const keep = Math.min(200000, Math.max(1, Number(outMax) || 20000)), cut = out.length - keep;
  return cut > 0 ? `[the first ${cut} characters of this output were cut, the last ${keep} follow. To read a whole file use file_text, or read_file with a large enough max_bytes.]\n${out.slice(-keep)}` : out;
}

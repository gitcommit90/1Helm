// Computer capacity: the platform refuses a start ("no container instance ...") when the class is at max_instances.
// The person and the helper see one plain message instead of the platform text or a 60 s retry loop.
export const COMPUTER_BUSY_MSG = "All computers are busy right now. Try again in a minute.";
// A refusal can also come back for ~5 s after the same computer's previous stop, so a few retries are still made.
export const CAPACITY_RETRY_MS = 12e3;
const CAPACITY_RE = /no container instance|container instances? (?:limit|quota)|max(?:imum)?[_ ]instances|instance limit|too many (?:container )?instances|(?:out of|insufficient|not enough) (?:capacity|resources)|at capacity|capacity (?:reached|exceeded|limit)/i;
export const isCapacityError = (e) => CAPACITY_RE.test(String(e?.message ?? e ?? ""));
export const isComputerBusy = (e) => String(e?.message ?? e ?? "").includes(COMPUTER_BUSY_MSG);
export const computerBusyError = () => Object.assign(new Error(COMPUTER_BUSY_MSG), { status: 503, code: "computers_busy" });

// The part of a command's output the model gets: its end, at most `outMax` characters (20,000 unless the caller asks for more, never over 200,000). When the beginning is cut, the output says
// so on its first line, because the end of a long file ("cat" of 26,000 characters) otherwise reads as the whole file and the model reads it again in pieces.
export function tailOutput(out, outMax) {
  const keep = Math.min(200000, Math.max(1, Number(outMax) || 20000)), cut = out.length - keep;
  return cut > 0 ? `[the first ${cut} characters of this output were cut, the last ${keep} follow. To read a whole file use file_text, or read_file with a large enough max_bytes.]\n${out.slice(-keep)}` : out;
}

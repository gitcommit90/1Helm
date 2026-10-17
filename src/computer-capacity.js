// Computer capacity: the platform refuses a start ("no container instance ...") when the class is at max_instances.
// The person and the helper see one plain message instead of the platform text or a 60 s retry loop.
export const COMPUTER_BUSY_MSG = "All computers are busy right now. Try again in a minute.";
// A refusal can also come back for ~5 s after the same computer's previous stop, so a few retries are still made.
export const CAPACITY_RETRY_MS = 12e3;
const CAPACITY_RE = /no container instance|container instances? (?:limit|quota)|max(?:imum)?[_ ]instances|instance limit|too many (?:container )?instances|(?:out of|insufficient|not enough) (?:capacity|resources)|at capacity|capacity (?:reached|exceeded|limit)/i;
export const isCapacityError = (e) => CAPACITY_RE.test(String(e?.message ?? e ?? ""));
export const isComputerBusy = (e) => String(e?.message ?? e ?? "").includes(COMPUTER_BUSY_MSG);
export const computerBusyError = () => Object.assign(new Error(COMPUTER_BUSY_MSG), { status: 503, code: "computers_busy" });

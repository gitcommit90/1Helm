// The functions that run speech models in 1Helm's own container (selfhost-speech.js: selfTranscribe, selfDiarize, selfSessionAppend, selfSessionDiarize,
// selfSessionEnd). Callers ask here, so a test can put fakes in their place (setSpeech) and every other build uses the real ones.
import * as REAL from "./selfhost-speech.js";
let cur = REAL;
export const speech = () => cur;
export const setSpeech = (impl) => { cur = impl || REAL; };
export const speechFn = (name) => { const f = cur[name]; if (typeof f !== "function") throw new Error("the 1Helm speech container is not available"); return f; };
export { speechWaitMs } from "./selfhost-speech.js";   // pure (chain position and time limit in, wait in milliseconds out)

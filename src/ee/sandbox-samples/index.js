// The Sandbox view of /models (src/sandbox.js) shows the real request each job sends. Each sample builds one job's request with the job's own prompt-building
// code and fake inputs. chat.js holds the text jobs and the chat categories, and media.js holds the jobs that read files (speech, pictures, search, ranking, the browser look).
// A sample is { job, via, build(env, ctx) -> { request, files } }. job is a job id from JOBS or "chat:<category id>". via is "<module>#<function>", the exported function the
// real job calls to reach its model (the list the Sandbox can send is VIAS in src/sandbox.js). request is the argument that function receives, with every place that holds
// file bytes written as { "$file": "<name>", "as": "data_url" | "base64" | "bytes" | "text" }. files lists { name, type, path } where path is under /app-static/sandbox/.
// ctx is { settings, job }: the saved model settings and the job id the sample was asked for.
import { samples as chat } from "./chat.js";
import { samples as media } from "./media.js";

// A function, so a test that adds a sample to chat.js's array (a local fixture) is seen.
export const allSamples = () => [...chat, ...media];
// The samples written for one job (the test requires exactly one per job and per chat category).
export const samplesFor = (job) => allSamples().filter((s) => s.job === job);
// The sample of a job. A chat category an administrator added has no sample of its own and uses General's.
export function sampleFor(job) {
  const own = samplesFor(job);
  if (own.length) return own[0];
  return String(job).startsWith("chat:") ? samplesFor("chat:general")[0] || null : null;
}

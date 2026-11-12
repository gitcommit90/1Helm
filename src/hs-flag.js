// The HS_WRITERS flag (Memory Overhaul phase 3), alone in a file with no imports, so a module that only needs to ask the question (live-notes.js)
// does not pull in the whole writer. On when HS_WRITERS is "on" and HS_FOUNDATIONS is "on" too, because the retain strategies live in the bank template.
const on = (v) => String(v || "").toLowerCase() === "on";
export const hsWriters = (env) => on(env?.HS_WRITERS) && on(env?.HS_FOUNDATIONS);
// The HS_USE flag (Memory Overhaul phase 4A, "using memory"): the profile in the prompt, the arms that add memory to a turn, the recall tool's
// new arguments and the correction tool. On when HS_USE is "on" and HS_FOUNDATIONS is "on" too, because the profile and the topic mental
// models live in the bank templates. With the flag off nothing here runs and the prompt, the tools and the turn stay as they were.
export const hsUse = (env) => on(env?.HS_USE) && on(env?.HS_FOUNDATIONS);
// The HS_ENVELOPE flag (the memory envelope, the design notes): every retained item carries time, place, people and
// source as metadata and entities, chat turns carry the place from location services, and photos and videos carry their capture metadata.
// Needs HS_WRITERS (the envelope rides on the phase 3 writers). With the flag off the writers send exactly what they sent before.
export const hsEnvelope = (env) => on(env?.HS_ENVELOPE) && hsWriters(env);

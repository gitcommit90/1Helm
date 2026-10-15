// The one remaining Memory Overhaul phase 5 flag: LEGACY_AMBIENT_SEARCH (the ambient passage index, its embeddings and the ranked search of ambient_query).
// "off" retires it, and a query goes to Hindsight recall over the source:bee documents in General's bank. It is stopped only when Hindsight and HS_WRITERS
// are in place, because Bee transcripts must already be retained there. The other four flags (ledger, upkeep, reflect, people) were removed with their code.
import { hsWriters } from "./hs-flag.js";

const off = (v) => String(v ?? "").trim().toLowerCase() === "off";
const hindsight = (env) => !!(env?.HINDSIGHT && env?.HINDSIGHT_API_KEY && env?.MEMORY_BACKEND === "hindsight");
// true = the ambient passage index runs. false = it is retired.
export const ambientSearchOn = (env) => !off(env?.LEGACY_AMBIENT_SEARCH) || !(hindsight(env) && hsWriters(env));

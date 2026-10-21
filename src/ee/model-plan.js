// The model plan: what one job runs, worked out from the saved model settings alone.
// Pure. It reads no env, no network and no clock, so the same settings give the same plan in every environment.
// The one source of the model ID decides where a step goes: an ID that isCloudflareModel accepts runs on Workers AI ("CF"),
// an ID that isSelfHostedModel accepts ("@1hc/...") runs in 1Helm's own container ("SELF", selfhost-models.js), every other ID runs on OpenRouter ("OR"). Nothing here looks at ENV_NAME, TEST_MODE or DYNAMIC_ROUTING.
//
// ---- Shapes other lanes code against (frozen in commit A1) ----
//
//   Plan = {
//     jobId: string,
//     level: "unrestricted" | "no_training" | "zdr",   // the privacy level the plan was made for (a zero-data-retention job always says "zdr")
//     steps: Step[],                                    // in order: the job's main model, then its fallbacks, minus models this level can't use
//     skipped: { model: string, why: string }[],        // models dropped from the list, and why (never sent)
//   }
//   Step = {
//     model: string,                                    // the saved model ID
//     source: "OR" | "CF" | "SELF",
//     adapter: "chat" | "embeddings" | "transcribe" | "transcribe_live" | "decide_systemone" | "decide_clef" | "decide_json" | "look" | "search",
//     effort: string | null,                            // the saved reasoning level, "none" already raised to "low" when the model can't turn reasoning off; null when the job has none
//     maxOutput: number | null,                         // tokens; null when the saved job has none (no limit is sent). results: a web search step's number of results
//     provider: Provider | null,                        // null for CF and SELF steps
//     privacy_note?: string,                            // CF steps only: shown on /models where the level asks for more than Cloudflare promises (the step still runs)
//     strict?: true,                                    // the saved entry's strict flag, copied as is
//   }
//   Provider = {                                        // ONLY OpenRouter's own fields. The keys order, only and ignore are never produced.
//     zdr?: true, data_collection: "allow" | "deny", sort?: "price" | "throughput" | "latency",
//     max_price: { prompt: number, completion: number },  // dollars per million tokens
//     require_parameters?: true,                        // chat and JSON decision adapters only
//     allow_fallbacks: true,
//   }
//
// Saved job fields read here (names as in INVENTORY section 6(b); Lane B adds them to the settings, and a job without them gets today's value):
//   job.max_output   integer, or null for "no limit sent" (each provider's own maximum)
//   job.sort         "price" | "throughput" | "latency" | null
//   job.max_price    { prompt, completion } dollars per million tokens, or null for today's ceiling
// They are read with the jobLimits accessors of model-jobs.js, which give a job saved before the fields existed its starting values (model-seed.js).
//
// plan(settings, jobId, { level, call })
//   settings  the saved settings object (env.MODEL_SETTINGS: { jobs, catalog, ... })
//   level     the account's privacy level; defaults to "zdr", the strictest
//   call      optional per call override: { adapter }
//             (still clamped to the model's facts). Nothing else can be overridden.
import { JOB_KINDS, jobDef, jobSetting, entriesOf, factsOf, effortFor, jobLimits, jobResults } from "./model-jobs.js";
import { isCloudflareModel, cloudflarePrivacyNote } from "../cloudflare-models.js";
import { isSelfHostedModel } from "../selfhost-models.js";
import { normalizePrivacy } from "../privacy.js";

// Today's price ceiling: $3 in and $15 out per million tokens, raised to the model's own saved price (same rule as maxPriceFor in model.js).
const PRICE_CEILING = { prompt: 3, completion: 15 };
const priceFor = (facts) => { const up = (v, d) => Number.isFinite(v) && v > d ? Math.ceil(v * 1e4) / 1e4 : d; return { prompt: up(facts?.pricing?.prompt, PRICE_CEILING.prompt), completion: up(facts?.pricing?.completion, PRICE_CEILING.completion) }; };
const SORTS = ["price", "throughput", "latency"];

const KIND_ADAPTER = { chat: "chat", chore: "chat", memory: "chat", rerank: "decide_systemone", vision: "chat", workers_ai: "chat", classic: "chat",
  embedding_files: "embeddings", embedding_memory: "embeddings", speech: "transcribe", speech_cloudflare: "transcribe", speech_live: "transcribe_live", look: "look" };
function adapterOf(jobId, kindId, source, facts) {
  if (jobId === "web_search" || kindId === "search") return "search";
  if (kindId === "speech_live") return source === "CF" ? "transcribe_live" : "transcribe";   // a Workers AI streaming model is a WebSocket; any other model takes the recording in chunks
  if (kindId === "decider" || kindId === "workers_decider") return source === "CF" ? "decide_clef" : Array.isArray(facts?.kinds) && facts.kinds.includes("decider") ? "decide_systemone" : "decide_json";
  return KIND_ADAPTER[kindId] || (jobId === "look" ? "look" : "chat");
}
// The most a step may write: the saved job value, honored as saved. An empty value stays empty (null): the request carries no limit and each provider's own
// maximum applies. Nothing in code sets or lowers it; the one guard is that a saved number is kept below the model's context window.
function maxOutputOf(settings, jobId, facts) {
  const n = jobLimits(settings, jobId).max_output;
  const ctx = Number.isFinite(facts?.context_length) && facts.context_length > 1 ? facts.context_length - 1 : null;
  return Number.isFinite(n) ? (ctx ? Math.min(n, ctx) : n) : null;
}
// Adapters that send a price ceiling by default: the ones that write text. Embeddings and speech are priced per input or per second, so they send a
// price cap only when the job has a saved max_price.
const TEXT_ADAPTERS = ["chat", "decide_json", "decide_systemone"];
export function providerOf({ settings, jobId, adapter, facts, level, kindId, strict }) {
  const { sort, max_price: mp } = jobLimits(settings, jobId);
  const saved = mp && Number.isFinite(mp.prompt) && Number.isFinite(mp.completion) ? { prompt: mp.prompt, completion: mp.completion } : null;
  const max_price = saved || (TEXT_ADAPTERS.includes(adapter) ? priceFor(facts) : null);
  // require_parameters: the main chat and retry jobs always ask it (no endpoint may drop the reasoning setting); a background job only when its entry is strict.
  const require = adapter === "decide_json" || (adapter === "chat" && (kindId === "chat" || kindId === "memory" || !!strict));
  return { ...(level === "zdr" ? { zdr: true } : {}), data_collection: level === "unrestricted" ? "allow" : "deny", ...(SORTS.includes(sort) ? { sort } : {}), ...(max_price ? { max_price } : {}),
    ...(require ? { require_parameters: true } : {}), allow_fallbacks: true };
}

export function plan(settings, jobId, { level, call = null } = {}) {
  const job = jobSetting(settings, jobId), def = jobDef(jobId), kindId = def?.kind || null, kind = JOB_KINDS[kindId] || {};
  // A job that always runs on zero-data-retention endpoints says so whatever the account's level is; the others follow the account.
  const lvl = kind.zdr ? "zdr" : normalizePrivacy(level);
  const steps = [], skipped = [];
  for (const e of entriesOf(job)) {   // saved hosts and pin on an entry are ignored: no provider list is ever built from them
    const facts = factsOf(settings, e.model), kindIsSearch = jobId === "web_search" || kindId === "search";
    // A web search provider is not a model: its step is a Cloudflare AI Gateway call ("CF"), with no OpenRouter provider object.
    const source = kindIsSearch || isCloudflareModel(e.model) ? "CF" : isSelfHostedModel(e.model) ? "SELF" : "OR";
    if (source === "OR" && Array.isArray(facts?.levels) && !facts.levels.includes(lvl)) { skipped.push({ model: e.model, why: `no endpoint allowed at ${lvl}` }); continue; }
    const adapter = call?.adapter || adapterOf(jobId, kindId, source, facts);
    steps.push({ model: e.model, source, adapter, effort: kind.effort === false ? null : (effortFor(e.effort ?? null, e.model, settings) ?? null), maxOutput: kindIsSearch ? null : maxOutputOf(settings, jobId, facts), ...(kindIsSearch ? { results: jobResults(settings, jobId) } : {}),
      provider: source !== "OR" ? null : providerOf({ settings, jobId, adapter, facts, level: lvl, kindId, strict: e.strict }), ...(e.strict ? { strict: true } : {}), ...(source === "CF" && !kindIsSearch && cloudflarePrivacyNote(e.model, lvl, facts) ? { privacy_note: cloudflarePrivacyNote(e.model, lvl, facts) } : {}) });
  }
  return { jobId, level: lvl, steps, skipped };
}

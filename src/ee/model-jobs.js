// Every place the platform uses an AI model is a "job" with its own saved setting: the model, its reasoning level and its fallback list.
// The saved settings (model-settings.js, edited on the Models page) are the only source of those values. This file lists which jobs
// exist, reads a job's saved setting, builds the request routes from it, and checks the privacy rule. It names no model.
import { CATEGORIES } from "./pool.js";
import { jobFieldDefaults } from "./model-seed.js";
import { PRIVACY_LEVELS, eligibleHosts, hostOk, normalizePrivacy, registered } from "../privacy.js";

export class ModelSettingsError extends Error {
  constructor(message, status = 503) { super(message); this.name = "ModelSettingsError"; this.modelSettings = true; this.status = status; }
}

// Caps left at 0 on purpose. recovery: the request kind's own chat list already follows it. speech_cloudflare, workers_ai and vision call
// env.AI.run with the one saved model (vision's non-dynamic path too), so a fallback would be saved and never run. embedding_files and
// embedding_memory: a different model makes vectors that don't match the existing index, so a fallback would corrupt search.
// What each kind of job can have. fallbacks: the most fallback models it may list. effort: whether it has a reasoning level.
// level: the account's AI data privacy setting filters its list. zdr: always runs on zero-data-retention endpoints, so it never
// breaks any privacy setting. chat/recovery/chore/classic models must be able to chat; the others are named by what they do.
export const JOB_KINDS = {
  chat: { fallbacks: 5, effort: true, level: true, pick: "chat" },
  recovery: { fallbacks: 0, effort: true, level: true, pick: "chat" },
  chore: { fallbacks: 3, effort: true, zdr: true, pick: "chore" },
  // any: the work is "ask a question, read a short structured answer". The special decision models (kinds list the pick) answer through
  // their own call; every other chat model answers the same questions as strict JSON (text-decision.js). zdr applies to those chat models.
  decider: { fallbacks: 3, effort: false, zdr: true, any: true, pick: "decider" },
  speech: { fallbacks: 3, effort: false, zdr: true, pick: "speech", needs: "Needs a speech-to-text model." },
  speech_cloudflare: { fallbacks: 0, effort: false, pick: "speech_cloudflare", needs: "Needs a speech-to-text model that runs on Cloudflare." },
  speech_live: { fallbacks: 1, effort: false, pick: "speech_live", needs: "Needs a live speech-to-text model." },
  embedding_files: { fallbacks: 0, effort: false, zdr: true, pick: "embedding_files", reindex: true, needs: "Needs a text embedding model." },
  embedding_memory: { fallbacks: 0, effort: false, zdr: true, pick: "embedding_memory", reindex: true, needs: "Needs a text embedding model." },
  // vision has a reasoning level (starting value "none": Gemma does not think). effortNullOk: a version saved before the level existed has null, which reads as "none" (model-settings.js).
  vision: { fallbacks: 0, effort: true, effortNullOk: true, zdr: true, pick: "vision", needs: "Needs a model that can read pictures." },
  workers_ai: { fallbacks: 0, effort: false, pick: "workers_ai", needs: "Needs a Cloudflare Workers AI model." },
  workers_decider: { fallbacks: 3, effort: false, zdr: true, any: true, pick: "workers_decider" },
  classic: { fallbacks: 4, effort: false, zdr: true, pick: "classic" },
  // The browser look: Cloudflare only (cloudflare: true), one model, no fallback. noOutput: the job writes no text, so max_output must stay null.
  look: { fallbacks: 0, effort: false, pick: "look", cloudflare: true, needs: "Needs a Cloudflare model that can look at a page." },
  // Web search through the Cloudflare Web Search API: the saved "model" is the search provider, written "cloudflare/<provider>". It writes no text, so
  // it has no token limit; its `results` field is the number of results (1 to 10), never empty. resultCount marks that meaning.
  search: { fallbacks: 0, effort: false, pick: "search", resultCount: true, needs: "Needs a web search provider." },
};
// Kinds whose job writes no text, so max_output can only be null.
for (const k of ["speech", "speech_cloudflare", "speech_live", "embedding_files", "embedding_memory"]) JOB_KINDS[k].noOutput = true;
// Picks that name a model able to chat. A kind with any: true also takes every chat model (through the JSON adapter).
export const CHAT_PICKS = ["chat", "chore", "classic"];
export const takesChat = (kind) => CHAT_PICKS.includes(kind.pick) || !!kind.any;
// A model's saved facts can chat when it is a validated catalog model or lists chat or chore.
export const canChat = (meta) => Array.isArray(meta?.kinds) && meta.kinds.length ? meta.kinds.some((k) => k === "chat" || k === "chore") : meta?.eligible === true;   // classic router models are not general chat models
// The decision models made for their own call: Clef (kind workers_decider) and Perplexity or Jev (kind decider). Any of them can run any
// any-model job, each through its own call (text-decision.js); every other chat model answers as strict JSON.
export const NATIVE_PICKS = ["workers_decider", "decider"];
export const nativeFor = (meta, kind) => !!kind.any && Array.isArray(meta?.kinds) && meta.kinds.some((k) => NATIVE_PICKS.includes(k));
// Whether the model's endpoints must be zero-data-retention for this kind.
// Pictures and the two search indexes are not chat picks, but a model for them on OpenRouter must also have zero-data-retention endpoints.
const ZDR_PICKS = ["vision", "embedding_files", "embedding_memory"];
export const zdrApplies = (kind, meta) => !!kind.zdr && (meta?.source === "CF" || ((takesChat(kind) || ZDR_PICKS.includes(kind.pick)) && !nativeFor(meta, kind)));

const CHAT_TEXT = {
  general: ["Everyday chat", "Questions, writing, email, calendar, reminders and connected apps."],
  research: ["Research", "Finding and comparing sources, mostly finance, legal and tax."],
  apps_economical: ["Simple apps", "Quick, low-cost builds of small apps, sites and scripts."],
  skills: ["Routine jobs", "Multi-step jobs such as travel, booking, forms, documents and decks."],
  spreadsheet: ["Spreadsheets", "Creating and editing spreadsheets and workbooks."],
  technical: ["Hard technical work", "Real coding, debugging, terminal and server work."],
  apps_complete: ["Full apps", "Software that must be complete and fully working."],
};
const RETRY_TEXT = "Used first when you say an earlier result fell short. The kind of request's own list follows it.";
export const JOBS = [
  ...CATEGORIES.map((c) => ({ id: `chat.${c}`, kind: "chat", group: "chat", label: CHAT_TEXT[c][0], description: CHAT_TEXT[c][1], category: c })),
  { id: "recover.apps_economical", kind: "recovery", group: "recovery", label: "Retry: simple apps", description: `${RETRY_TEXT} Simple apps.` },
  { id: "recover.apps_complete", kind: "recovery", group: "recovery", label: "Retry: full apps", description: `${RETRY_TEXT} Full apps.` },
  { id: "recover.technical", kind: "recovery", group: "recovery", label: "Retry: hard technical work", description: `${RETRY_TEXT} Hard technical work.` },
  { id: "recover.spreadsheet", kind: "recovery", group: "recovery", label: "Retry: spreadsheets", description: `${RETRY_TEXT} Spreadsheets.` },
  { id: "escalate", kind: "recovery", group: "recovery", label: "Switch during a task", description: "Takes over for the rest of a reply after repeated tool failures, a stalled step or getting stuck." },
  { id: "decider", kind: "decider", group: "routing", label: "Request sorter", description: "Reads each message and decides which kind of work it is, which picks the chat list." },
  { id: "handoff", kind: "chore", group: "background", label: "Task handoffs", description: "Short messages that pass context from one task to the next." },
  { id: "label", kind: "chore", group: "background", label: "Task titles", description: "Gives each task card its title." },
  { id: "browser", kind: "chore", group: "background", label: "Browser summaries", description: "Plans what to type in the browser and summarizes what it did." },
  { id: "notes", kind: "chore", group: "background", label: "Live notes", description: "Takes notes while a task runs." },
  { id: "notes_refine", kind: "chore", group: "background", label: "Live notes cleanup", description: "Tidies the draft notes." },
  { id: "notes_final", kind: "chore", group: "background", label: "Final notes", description: "Writes the finished notes when a task ends." },
  { id: "sidecar_card", kind: "chore", group: "background", label: "File summaries", description: "Writes the summary card for each file." },
  { id: "ambient_extract", kind: "chore", group: "background", label: "Ambient pick-up", description: "Finds things worth tracking in connected apps." },
  { id: "ambient_review", kind: "chore", group: "background", label: "Ambient review", description: "Double-checks what ambient pick-up found." },
  { id: "stt", kind: "speech", group: "speech", label: "Speech to text", description: "Transcribes dictation uploads (/api/transcribe), Live notes audio chunks and file audio. AssemblyAI goes first for WAV audio, and other formats go to Qwen3 ASR and then Whisper. The fallbacks run when a model fails." },
  { id: "stt_cloudflare", kind: "speech_cloudflare", group: "speech", label: "Speech to text on Cloudflare", description: "Runs only for the Speech to text job, and only when every model above failed and the audio is under 20 MB." },
  { id: "live_dictation", kind: "speech_live", group: "speech", label: "Live dictation", description: "Transcribes live dictation. AssemblyAI transcribes WAV chunks cut at pauses and returns the text after each pause. Deepgram Nova 3 on Cloudflare streams is the fallback." },
  { id: "embed_files", kind: "embedding_files", group: "search", label: "File search index", description: "Makes the search index for your files. Changing it means files must be indexed again." },
  { id: "embed_memory", kind: "embedding_memory", group: "search", label: "Ambient search index", description: "Makes the embeddings for the ambient passage index, which holds recordings from connected apps. Changing it means ambient passages must be indexed again." },
  { id: "vision_files", kind: "vision", group: "search", label: "Picture descriptions", description: "Describes pictures and reads text in them when a file is a picture." },
  { id: "workers_ai_chat", kind: "workers_ai", group: "other", label: "Backup chat", description: "Answers when OpenRouter can't be reached, or on a self-hosted install with no OpenRouter key." },
  { id: "web_search", kind: "search", group: "search", label: "Web search", description: "Finds web pages for a question when DuckDuckGo has no answer. The model is the search provider, and max output is the number of results it asks for." },
  { id: "browser_decider", kind: "decider", group: "routing", label: "Browser decisions", description: "Decides the browser's next step on each page." },
  { id: "look", kind: "look", group: "other", label: "Browser look", description: "Looks at a page in the browser and answers questions about it, or points at something on it." },
];
// Calls that use no hosted model. The Models page shows them as read-only lines so every outside call is listed in one place.
export const NO_MODEL_LINES = [
  { id: "ocr", label: "Text in scans (OCR)", text: "No hosted model. Local ONNX models in the OCR Worker and the preparation container read the text." },
];
export const JOB_IDS = JOBS.map((j) => j.id);
export const jobDef = (id) => JOBS.find((j) => j.id === id) || null;
export const GROUPS = [
  { id: "chat", title: "Chat replies", note: "The model that answers you, by kind of request. The first model that your privacy setting allows answers, and the next one takes over if it fails." },
  { id: "recovery", title: "When a reply falls short", note: "Models that take over after you say a result was not right, or when a task keeps failing." },
  { id: "routing", title: "Routing", note: "Picks the kind of request." },
  { id: "background", title: "Background jobs", note: "Work that runs behind the scenes. These always use zero-data-retention providers." },
  { id: "speech", title: "Speech", note: "" },
  { id: "search", title: "Search and pictures", note: "" },
  { id: "other", title: "Other", note: "Jobs outside the groups above. They are saved and pushed like every other job." },
];
// Only jobs in a listed page group get controls. Runtime settings can also cover jobs outside the Models page.
export const MODEL_PAGE_JOBS = JOBS.filter((j) => GROUPS.some((g) => g.id === j.group));

// ---- reading a job's saved setting ----
export const settingsOf = (env) => {
  const s = env?.MODEL_SETTINGS;
  if (!s?.jobs) throw new ModelSettingsError("Model settings were not loaded for this call. Nothing was sent.");
  return s;
};
export function jobSetting(settings, id) {
  const j = settings?.jobs?.[id];
  if (!j || typeof j.model !== "string") throw new ModelSettingsError(`No saved model setting for "${id}". Open Models and set it. Nothing was sent.`);
  return j;
}
// The saved per job fields max_output, sort, max_price and results. A job saved before they existed has none, and reads the starting value (model-seed.js).
// A saved null is a real value (no output limit is sent, no sort, the default price ceiling).
export const SORTS = ["price", "throughput", "latency"];
const jobField = (settings, id, name) => { const j = settings?.jobs?.[id]; return j && Object.prototype.hasOwnProperty.call(j, name) ? j[name] : jobFieldDefaults(id)[name]; };
export const jobMaxOutput = (settings, id) => jobField(settings, id, "max_output");
export const jobSort = (settings, id) => jobField(settings, id, "sort");
export const jobMaxPrice = (settings, id) => jobField(settings, id, "max_price");
export const jobResults = (settings, id) => jobField(settings, id, "results");
export const jobTimeoutMs = (settings, id) => jobField(settings, id, "timeout_ms");   // milliseconds for one model attempt, or null for no timeout (limits.js)
export const jobLimits = (settings, id) => ({ max_output: jobMaxOutput(settings, id), sort: jobSort(settings, id), max_price: jobMaxPrice(settings, id), timeout_ms: jobTimeoutMs(settings, id) });
export const factsOf = (settings, model) => settings?.catalog?.[model] || null;
export const quirkOf = (settings, model, name) => !!factsOf(settings, model)?.quirks?.[name];
// A job's models in order: its main model, then its fallbacks. Each: { model, effort, strict? }. Saved entries never carry provider lists.
export const entriesOf = (job) => [{ model: job.model, effort: job.effort ?? null, ...(job.strict ? { strict: true } : {}) },
  ...(job.fallbacks || []).map((f) => ({ ...f, effort: f.effort ?? null }))];
export const chatJobId = (category) => `chat.${CATEGORIES.includes(category) ? category : "general"}`;
// The saved job a main chat call belongs to: the category of a running task's frozen profile, or of the routing policy's route. Recovery models
// (route.recoveryJob) and escalation (route.limitsJob) are read from their own saved jobs inside the dispatcher.
export const mainChatJob = (route) => chatJobId(route?.taskAffinity ? route.taskProfile?.category : route?.category);

// The effort the model's own rules allow. Some models can't turn reasoning off, so "none" is sent as "low" there.
export const reasoningMandatory = (settings, model) => quirkOf(settings, model, "reasoning_mandatory");
export const effortFor = (e, model, settings) => e === "none" && reasoningMandatory(settings, model) ? "low" : e;
export const effortBody = (e, model, settings) => { e = effortFor(e, model, settings); return !e || e === "default" ? {} : e === "none" ? { reasoning: { enabled: false } } : { reasoning: { effort: e } }; };

// The providers one model may use at one privacy level. Models the saved facts hold endpoint lists for use those (kept inside what
// the privacy facts allow); every other model follows the privacy facts alone.
export function configuredHosts(settings, model, level) {
  const meta = settings?.catalog?.[model];
  if (meta?.source === "CF") return meta.levels?.includes(level) ? ["cloudflare"] : [];
  if (!meta?.hosts) return eligibleHosts(model, level);
  if (!meta.levels?.includes(level)) return [];
  // A model the registry lists keeps only the hosts the registry allows at this level. Any other model follows its provider's recorded terms;
  // a host with no recorded terms counts only where it was proven zero retention (the record's unproven_hosts lists the ones that weren't,
  // which serve Unrestricted only). Older records have no such list, and all their hosts came from the published zero-data-retention list.
  const unproven = new Set(Array.isArray(meta.unproven_hosts) ? meta.unproven_hosts : []);
  return meta.hosts.filter((h) => hostOk(model, h, level, { proven: !unproven.has(h) }));
}

// ---- privacy ----
// Which of a job's models the account's privacy setting allows, in order. A model with no allowed endpoint is skipped, never used.
export function allowedEntries(settings, job, level) {
  level = normalizePrivacy(level);
  return entriesOf(job).filter((e) => configuredHosts(settings, e.model, level).length > 0);
}
// For the page: per privacy level, how many of the job's models are allowed and the first one that would answer.
export function privacyCoverage(settings, id) {
  const def = jobDef(id), kind = JOB_KINDS[def?.kind], job = settings?.jobs?.[id];
  if (!kind?.level || !job) return null;
  return Object.fromEntries(PRIVACY_LEVELS.map((level) => { const a = allowedEntries(settings, job, level); return [level, { allowed: a.length, first: a[0]?.model || null }]; }));
}
// A zero-data-retention job can't use a model whose only endpoints keep or train on requests. A model the privacy facts don't list is
// sent with OpenRouter's strictest filter, so it can't leak either.
export function zdrBlocked(settings, model) {
  const meta = factsOf(settings, model);
  if (meta?.hosts) return !meta.levels?.includes("zdr");
  return registered(model) && eligibleHosts(model, "zdr").length === 0;
}

// ---- request routes for background jobs ----
// OpenRouter chooses the provider (zero data retention, price ceiling, and the job's saved sort). No provider list is saved or sent.
function routeEntry(settings, e, def = {}) {
  const facts = factsOf(settings, e.model);
  return { model: e.model, effort: e.effort ?? def.effort ?? "default", ...(e.strict ? { strict: true } : {}) };
}
// The route a background job runs: its model first, then its own fallbacks one at a time, nothing else.
export function choreRouteOf(settings, id) {
  const job = jobSetting(settings, id), [first0, ...rest] = entriesOf(job).map((e) => routeEntry(settings, e)), facts = factsOf(settings, job.model), sort = jobSort(settings, id), maxOut = jobMaxOutput(settings, id);
  // A job with a sort asks OpenRouter for the fastest zero-data-retention endpoint now.
  const first = sort ? { ...first0, sort, ...(maxOut ? { maxOut } : {}) } : first0;
  return { ...first, fallbacks: rest, only: true, chore: true, job: id, runtimeSettings: !!first.strict, json: !(facts?.quirks?.no_json) && facts?.json !== false };
}
// A route that only names the job. The model is read from the saved settings when the call is made (model.js openRouterChat).
export const jobRoute = (id) => ({ chore: true, only: true, job: id });

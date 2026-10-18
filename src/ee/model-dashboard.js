// What the Models console shows for each job: the model, reasoning level, fallbacks and limits (max output, provider sort, max price) that are saved
// for it, which is exactly what the runtime uses (it reads the same saved settings, model-jobs.js). For jobs the account's privacy setting filters,
// it also says whether each privacy setting would leave the job with no allowed model, and it carries the notes about a saved max output.
import { PRIVACY_LABEL } from "../privacy.js";
import { isSelfHostedModel } from "../selfhost-models.js";
import { JOBS, JOB_KINDS, GROUPS, entriesOf, privacyCoverage, factsOf, zdrBlocked, zdrApplies, jobLimits, jobResults } from "./model-jobs.js";

const nameOf = (settings, id) => factsOf(settings, id)?.name || String(id || "");
// OR (OpenRouter), CF (Cloudflare Workers AI) or SELF (1Helm's own container): the transport the dispatcher uses for the model, which is the ID's source (plan() says the same; a web search provider is a Cloudflare call).
const sourceOf = (settings, id) => isSelfHostedModel(id) ? "SELF" : isCloudflare(settings, id) || /^cloudflare\//.test(String(id)) ? "CF" : "OR";
const isCloudflare = (settings, id) => factsOf(settings, id)?.source === "CF" || String(id).startsWith("@cf/");
// Every job has a place on the page: the group Other is one of the groups of model-jobs.js.
export const PAGE_GROUPS = GROUPS;

// A saved max output against each endpoint's own limit (the catalog's endpoint_limits, display facts). Only the endpoints the job may use count: a
// zero-data-retention job uses the endpoints that keep no data, any other job any endpoint. The saved number gets a warning only when NO allowed
// endpoint can take it; when some can't, the note names them, because OpenRouter then uses the others.
const hostName = (tag) => { const h = String(tag).split("/")[0].replace(/[-_]+/g, " "); return h.charAt(0).toUpperCase() + h.slice(1); };
const list = (a) => a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`;
const fmt = (n) => Number(n).toLocaleString("en-US");
export function limitNote(settings, entries, n, kind) {
  if (!Number.isFinite(n)) return null;
  const warn = [], info = [];
  for (const e of entries) {
    const facts = factsOf(settings, e.model), eps = (Array.isArray(facts?.endpoint_limits) ? facts.endpoint_limits : []).filter((x) => kind.zdr ? x.levels?.includes("zdr") : true);
    if (!eps.length) continue;
    const cannot = eps.filter((x) => x.max_output < n);
    if (!cannot.length) continue;
    const names = [...new Set(cannot.map((x) => hostName(x.host)))], name = nameOf(settings, e.model);
    if (cannot.length === eps.length) warn.push(`Max output ${fmt(n)} is above what every provider of ${name} can serve (the most is ${fmt(Math.max(...eps.map((x) => x.max_output)))}).`);
    else info.push(`${list(names)} can't serve ${fmt(n)}${entries.length > 1 ? ` for ${name}` : ""}. OpenRouter uses the others.`);
  }
  return warn.length ? { level: "warn", text: warn.join(" ") } : info.length ? { level: "info", text: info.join(" ") } : null;
}

export function jobView(settings, def) {
  const job = settings.jobs[def.id], kind = JOB_KINDS[def.kind], entries = entriesOf(job);
  const entry = (e) => ({ id: e.model, name: nameOf(settings, e.model), effort: kind.effort ? e.effort : null, efforts: kind.effort ? (factsOf(settings, e.model)?.efforts || []) : [],
    source: sourceOf(settings, e.model) });
  const coverage = privacyCoverage(settings, def.id), warnings = [];
  if (coverage) for (const [level, c] of Object.entries(coverage)) if (!c.allowed) warnings.push(`${PRIVACY_LABEL[level]}: no allowed model, so requests fail with a privacy message instead of using one that setting forbids.`);
  if (kind.zdr) for (const e of entries) if (zdrApplies(kind, factsOf(settings, e.model)) && zdrBlocked(settings, e.model)) warnings.push(`${nameOf(settings, e.model)} has no zero-data-retention provider and can't run here.`);
  if (kind.reindex) warnings.push("If you change the main model to one that is not listed as equivalent, each channel rebuilds its file indexes from the saved text of the files the next time someone searches a file or adds one. Until a file is rebuilt, its search uses keywords only. The rebuild is not charged to the account.");
  const limits = jobLimits(settings, def.id), main = entry(entries[0]), fallbacks = entries.slice(1).map(entry);
  return { id: def.id, kind: def.kind, group: def.group, label: def.label, description: def.description, main, fallbacks,
    has_effort: kind.effort, max_fallbacks: kind.fallbacks, equivalent_only: !!kind.equivalentOnly, pick: kind.pick, any: !!kind.any, needs: kind.needs || null, privacy: kind.level ? "list" : kind.zdr ? "zdr" : "none",
    limits, limit_note: kind.noOutput || kind.resultCount ? null : limitNote(settings, entries, limits.max_output, kind), results: kind.resultCount ? jobResults(settings, def.id) : null, no_output: !!kind.noOutput || !!kind.resultCount, on_openrouter: entries.some((e) => !isCloudflare(settings, e.model) && !isSelfHostedModel(e.model)),
    saved: { model: main.id, effort: main.effort, fallbacks: fallbacks.map((f) => f.id), max_output: limits.max_output, sort: limits.sort, max_price: limits.max_price, results: kind.resultCount ? jobResults(settings, def.id) : null, timeout_ms: limits.timeout_ms },
    coverage: coverage ? Object.fromEntries(Object.entries(coverage).map(([l, c]) => [l, { allowed: c.allowed, first: c.first ? nameOf(settings, c.first) : null, first_source: c.first ? sourceOf(settings, c.first) : null }])) : null, warnings };
}

export function modelDashboard(view) {
  const settings = view.config;
  return { jobs: JOBS.filter((d) => settings.jobs?.[d.id] && typeof settings.jobs[d.id].model === "string").map((d) => jobView(settings, d)), groups: PAGE_GROUPS, level_labels: PRIVACY_LABEL };
}

// What the Models page shows: for each displayed job, the model, reasoning level and fallbacks that are saved for it, which is exactly what the
// runtime uses (it reads the same saved settings, model-jobs.js). For jobs the account's privacy setting filters, it also says whether
// each privacy setting would leave the job with no allowed model.
import { PRIVACY_LABEL } from "../privacy.js";
import { MODEL_PAGE_JOBS, JOB_KINDS, GROUPS, entriesOf, privacyCoverage, factsOf, zdrBlocked, zdrApplies } from "./model-jobs.js";

const nameOf = (settings, id) => factsOf(settings, id)?.name || String(id || "");

export function jobView(settings, def) {
  const job = settings.jobs[def.id], kind = JOB_KINDS[def.kind], entries = entriesOf(job);
  const entry = (e) => ({ id: e.model, name: nameOf(settings, e.model), effort: kind.effort ? e.effort : null, efforts: kind.effort ? (factsOf(settings, e.model)?.efforts || []) : [] });
  const coverage = privacyCoverage(settings, def.id), warnings = [];
  if (coverage) for (const [level, c] of Object.entries(coverage)) if (!c.allowed) warnings.push(`${PRIVACY_LABEL[level]}: no allowed model, so requests fail with a privacy message instead of using one that setting forbids.`);
  if (kind.zdr) for (const e of entries) if (zdrApplies(kind, factsOf(settings, e.model)) && zdrBlocked(settings, e.model)) warnings.push(`${nameOf(settings, e.model)} has no zero-data-retention provider and can't run here.`);
  if (kind.reindex) warnings.push("Changing this model does not re-index existing data. Re-index before relying on search.");
  return { id: def.id, kind: def.kind, group: def.group, label: def.label, description: def.description, main: entry(entries[0]), fallbacks: entries.slice(1).map(entry),
    has_effort: kind.effort, max_fallbacks: kind.fallbacks, pick: kind.pick, any: !!kind.any, needs: kind.needs || null, privacy: kind.level ? "list" : kind.zdr ? "zdr" : "none",
    coverage: coverage ? Object.fromEntries(Object.entries(coverage).map(([l, c]) => [l, { allowed: c.allowed, first: c.first ? nameOf(settings, c.first) : null }])) : null, warnings };
}
export function modelDashboard(view) {
  const settings = view.config;
  return { jobs: MODEL_PAGE_JOBS.filter((d) => !view.hidden?.includes(d.id)).map((d) => jobView(settings, d)), groups: GROUPS, level_labels: PRIVACY_LABEL };
}

// What changed between saved versions of the model settings, for the Models page: the change list of each History entry, and the time each job's or
// category's models last changed. The Last served flag needs the second one, because a served call can only be judged against the models that were
// saved when it was served (model-served.js servedView).
import { jobFieldDefaults } from "./model-seed.js";
import { recentVersions } from "./model-settings.js";

const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const canon = (v) => JSON.stringify(v === undefined ? null : v);
const FIELDS = ["max_output", "sort", "max_price", "timeout_ms", "results"];
const LEVELS = ["unrestricted", "no_training", "zdr"];
const entryOf = (e) => ({ model: e?.model ?? null, effort: e?.effort ?? null });
const jobChain = (j) => (j && j.model ? [entryOf(j), ...(j.fallbacks || []).map(entryOf)] : []);

// One version as { row key: { chain: [...], fields } }. A row key is the job id, "cat:<id>" for a routing category or "limit:<key>" for a saved limit,
// the same keys the page uses for its rows.
export function rowsOfVersion(v) {
  const out = new Map();
  for (const [id, j] of Object.entries(v?.jobs || {})) {
    if (!j || typeof j !== "object") continue;
    const def = jobFieldDefaults(id), fields = {};
    for (const f of FIELDS) fields[f] = own(j, f) ? j[f] : def[f];
    out.set(id, { chains: { all: jobChain(j) }, fields });
  }
  for (const c of v?.routing?.categories || []) {
    if (!c || typeof c.id !== "string") continue;
    const fields = {}; for (const f of FIELDS.filter((x) => x !== "results")) fields[f] = c[f];
    out.set("cat:" + c.id, { chains: Object.fromEntries(LEVELS.map((l) => [l, (c.chains?.[l] || []).map(entryOf)])), fields, title: c.title });
  }
  for (const [k, x] of Object.entries(v?.limits || {})) out.set("limit:" + k, { chains: {}, fields: { value: x } });
  return out;
}
const modelsOf = (row) => canon(Object.fromEntries(Object.entries(row.chains).map(([l, ch]) => [l, ch.map((e) => e.model)])));

// What differs between two versions: [{ key, added?, removed?, fields: ["chain" | "max_output" | ...] }]
export function changesBetween(before, after) {
  const a = rowsOfVersion(before), b = rowsOfVersion(after), out = [];
  for (const [key, row] of b) {
    const old = a.get(key);
    if (!old) { out.push({ key, added: true, fields: [] }); continue; }
    const fields = [];
    if (modelsOf(old) !== modelsOf(row)) fields.push("chain");
    else if (canon(old.chains) !== canon(row.chains)) fields.push("effort");   // the same models, a different reasoning level
    for (const f of Object.keys(row.fields)) if (canon(old.fields[f] ?? null) !== canon(row.fields[f] ?? null)) fields.push(f);
    if (row.title !== undefined && old.title !== row.title) fields.push("title");
    if (fields.length) out.push({ key, fields });
  }
  for (const key of a.keys()) if (!b.has(key)) out.push({ key, removed: true, fields: [] });
  return out;
}

// versions: newest first (model-settings.js recentVersions). Returns
//   history: { [revision]: [changes] } for every version that has an older one to compare with, and
//   since: { [served key]: the time the row's models last changed } where the served key is the job id or "chat:<category id>".
// A row that did not change in any version that was read gets the time of the oldest version read, because it can only be said to be unchanged since then
// (a call served before that time is not judged); when the first version ever saved is among them it gets 0.
export function changeTimes(versions, { complete = false } = {}) {
  const history = {}, since = {}, seen = new Set();
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i], older = versions[i + 1];
    if (older) history[v.revision] = changesBetween(older, v);
    const rows = rowsOfVersion(v), prev = older ? rowsOfVersion(older) : null;
    for (const [key, row] of rows) {
      if (key.startsWith("limit:")) continue;
      const sk = key.startsWith("cat:") ? "chat:" + key.slice(4) : key;
      if (seen.has(sk)) continue;
      const old = prev && prev.get(key);
      if (prev && (!old || modelsOf(old) !== modelsOf(row))) { since[sk] = v.at; seen.add(sk); }
    }
  }
  const first = versions.at(-1);
  if (first) for (const key of rowsOfVersion(versions[0]).keys()) {
    if (key.startsWith("limit:")) continue;
    const sk = key.startsWith("cat:") ? "chat:" + key.slice(4) : key;
    if (!seen.has(sk)) since[sk] = complete ? 0 : first.at;
  }
  return { history, since };
}

// Reads the latest versions and returns changeTimes() of them. A read error gives nothing, and the page then judges no served call.
export async function versionChanges(env, limit = 60) {
  try { const versions = await recentVersions(env, limit); return changeTimes(versions, { complete: versions.length < limit }); }
  catch { return { history: {}, since: {} }; }
}

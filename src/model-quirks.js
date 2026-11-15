// The quirks of a model (auto_tool_choice_only, reasoning_replay, no_temperature, rate_limit_waits, reasoning_mandatory, no_json), found two ways so a model never
// loses them because its ID differs from the saved one:
//  1. resolvedQuirks: the saved facts of the exact ID, else the facts of the saved model it stands for. A "~vendor/name-latest" alias, a dated ID
//     ("name-20261001") or a newer version ("name-1.4") stands for a saved model of the same vendor whose name words (version numbers, dates and "latest" removed)
//     are the first words of its own. The saved model with the longest matching name wins.
//  2. quirksFromRecord: when a model is saved from OpenRouter's catalog, the quirks its endpoints' published parameters show.
// Only the saved catalog is read, never a built-in list of models.
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const wordsOf = (id) => {
  const [vendor, ...rest] = String(id || "").replace(/^~/, "").split("/"), name = rest.join("/").replace(/:[a-z0-9_-]+$/i, "");
  return { vendor: vendor.toLowerCase(), words: name.toLowerCase().split(/[-_ ]+/).filter((w) => w && w !== "latest" && !/^\d+(\.\d+)*$/.test(w) && !/^\d{6,8}$/.test(w)) };
};
export function familyFacts(catalog, model) {
  if (!catalog || typeof model !== "string") return null;
  const me = wordsOf(model); if (!me.vendor || !me.words.length) return null;
  let best = null, bestLen = 0;
  for (const [id, facts] of Object.entries(catalog)) {
    if (id === model || !facts?.quirks) continue;
    const o = wordsOf(id);
    if (o.vendor !== me.vendor || !o.words.length || o.words.length > me.words.length || !o.words.every((w, i) => w === me.words[i])) continue;
    if (o.words.length > bestLen) { best = facts; bestLen = o.words.length; }
  }
  return best;
}
export const resolvedQuirks = (settings, model) => {
  const catalog = settings?.catalog;
  if (own(catalog, model)) { const q = catalog[model]?.quirks; return q || familyFacts(catalog, model)?.quirks || {}; }
  return familyFacts(catalog, model)?.quirks || {};
};
export const quirkOf = (settings, model, name) => !!resolvedQuirks(settings, model)[name];
// True when the saved facts, or the model they resolve to, are known (so a missing quirk means "none", not "unknown").
export const knownModel = (settings, model) => own(settings?.catalog, model) || !!familyFacts(settings?.catalog, model);
// From a catalog record (model-catalog.js assessModelCatalog): the model takes only automatic tool choice when no usable endpoint publishes "none" or "required";
// reasoning is mandatory when the record offers reasoning levels but not "none"; the model can't do JSON when no usable endpoint takes response_format.
export function quirksFromRecord(m) {
  const q = {};
  if (Array.isArray(m?.tool_choice) && !m.tool_choice.includes("none") && !m.tool_choice.includes("required")) q.auto_tool_choice_only = true;
  if (Array.isArray(m?.efforts) && m.efforts.some((e) => e !== "default") && !m.efforts.includes("none")) q.reasoning_mandatory = true;
  if (m?.json === false && Array.isArray(m?.json_levels) && !m.json_levels.length) q.no_json = true;
  return q;
}

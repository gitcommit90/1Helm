// Saved category names are data. Only stable IDs are used for dispatch.
import { PRIVACY_LEVELS, normalizePrivacy } from "../privacy.js";
import { configuredHosts, entriesOf, ModelSettingsError } from "./model-jobs.js";

export const dynamicRoutingOn = (env) => env?.ONEHELM_EE === "1hc" && String(env?.DYNAMIC_ROUTING || "").trim().toLowerCase() === "on";
export const routingCategories = (settings) => settings?.routing?.categories || [];
export const routingCategory = (settings, id) => routingCategories(settings).find((c) => c.id === id) || routingCategories(settings).find((c) => c.id === "general") || null;
export function routingChain(settings, category = "general", level = "zdr") {
  const chain = routingCategory(settings, category)?.chains?.[normalizePrivacy(level)];
  if (!chain?.length) throw new ModelSettingsError("No saved routing models for this category. Open Models and set them. Nothing was sent.");
  return chain.map((e) => ({ ...e }));
}
export const generalRoutingChain = (settings, level = "zdr") => routingChain(settings, "general", level);
export function withRoutingConfig(settings, { zdrThirdModel = null, zdrThirdEntry = null } = {}) {
  if (settings?.version === 3) return settings;
  const all = entriesOf(settings.jobs["chat.general"]);
  const chains = Object.fromEntries(PRIVACY_LEVELS.map((level) => {
    const chain = all.filter((e) => configuredHosts(settings, e.model, level).length).slice(0, 3);
    if (level === "zdr" && chain.length === 2 && zdrThirdModel && !chain.some((e) => e.model === zdrThirdModel)) {
      const meta = settings.catalog?.[zdrThirdModel];
      if (meta && configuredHosts(settings, zdrThirdModel, level).length) {
        const saved = Object.values(settings.jobs).flatMap(entriesOf).concat(zdrThirdEntry || []).find((e) => e.model === zdrThirdModel && meta.efforts?.includes(e.effort));
        if (saved) chain.push({ ...saved });
      }
    }
    if (chain.length !== 3) throw new ModelSettingsError(`General needs three eligible models for ${level}. Set the General list before enabling dynamic routing.`);
    return [level, chain];
  }));
  return { ...settings, version: 3, routing: { categories: [{ id: "general", title: "General", chains }] } };
}

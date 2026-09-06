import { randomBytes } from "node:crypto";

type ProviderModel = string | { id: string; name?: string; enabled?: boolean };
export type ModelCatalogProvider = {
  id: string;
  type: string;
  baseUrl?: string;
  apiKey?: string;
  accessToken?: string;
  models?: ProviderModel[];
  ownerUserId?: number;
  modelAutoRefreshMode?: "all" | "free";
  modelAutoRefreshAttemptedAt?: number;
  modelAutoRefreshSucceededAt?: number;
  modelAutoRefreshError?: string;
};
type ModelConfig = { providers: ModelCatalogProvider[] };
export type ModelStore = { load: () => ModelConfig; update: (fn: (config: ModelConfig) => void) => unknown };
export type ModelDiscovery = { id: string; name: string; free?: boolean };
type ModelRefreshPreview = { userId: number; providerId: string; models: ModelDiscovery[]; expiresAt: number };

const DAY_MS = 24 * 60 * 60_000;
const modelRefreshPreviews = new Map<string, ModelRefreshPreview>();
let autoRefreshTimer: NodeJS.Timeout | null = null;
let autoRefreshRunning: Promise<void> | null = null;

export function normalizeBaseUrl(value: unknown): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function routableBaseUrl(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}

function openRouterFreeFlag(model: Record<string, unknown>): boolean | undefined {
  if (String(model.id || model.name || "").toLowerCase().endsWith(":free")) return true;
  const pricing = model.pricing && typeof model.pricing === "object" ? model.pricing as Record<string, unknown> : null;
  if (!pricing) return undefined;
  const values = [pricing.prompt, pricing.completion].map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) return undefined;
  return values.every((value) => value === 0);
}

export async function fetchModelCatalog(provider: Pick<ModelCatalogProvider, "type" | "baseUrl" | "apiKey" | "accessToken">): Promise<ModelDiscovery[]> {
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  if (!baseUrl || !routableBaseUrl(baseUrl)) throw new Error("Automatic model discovery is unavailable for this account.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const headers = new Headers({ Accept: "application/json" });
    const credential = String(provider.apiKey || provider.accessToken || "").trim();
    if (credential) headers.set("Authorization", `Bearer ${credential}`);
    const response = await fetch(`${baseUrl}/models`, { headers, signal: controller.signal, redirect: "error" });
    if (!response.ok) throw new Error(`The provider's model catalog is unavailable (HTTP ${response.status}).`);
    const announcedBytes = Number(response.headers.get("content-length") || 0);
    if (announcedBytes > 8 * 1024 * 1024) throw new Error("The provider's model catalog is too large to preview safely.");
    const rawPayload = await response.text();
    if (rawPayload.length > 8 * 1024 * 1024) throw new Error("The provider's model catalog is too large to preview safely.");
    let payload: unknown;
    try { payload = JSON.parse(rawPayload); }
    catch { throw new Error("The provider's model catalog did not return valid JSON."); }
    const raw = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : [];
    const models = raw.flatMap((entry): ModelDiscovery[] => {
      if (typeof entry === "string") return entry.trim() ? [{ id: entry.trim(), name: entry.trim() }] : [];
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const id = String(item.id || item.name || "").trim().slice(0, 512);
      if (!id) return [];
      const free = String(provider.type || "") === "openrouter" ? openRouterFreeFlag(item) : undefined;
      return [{ id, name: String(item.name || id).trim().slice(0, 512) || id, ...(free === undefined ? {} : { free }) }];
    });
    return [...new Map(models.map((model) => [model.id, model])).values()].slice(0, 5_000);
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("The provider's model catalog did not respond in time.");
    throw error;
  } finally { clearTimeout(timer); }
}

export async function previewStoredProviderModels(provider: ModelCatalogProvider, userId: number, at = Date.now()): Promise<Record<string, unknown>> {
  try {
    const models = await fetchModelCatalog(provider);
    if (!models.length) return { ok: false, error: "The provider returned no models. Add an exact model ID manually instead." };
    for (const [token, preview] of modelRefreshPreviews) if (preview.expiresAt < at || (preview.userId === userId && preview.providerId === provider.id)) modelRefreshPreviews.delete(token);
    if (modelRefreshPreviews.size >= 512) modelRefreshPreviews.delete(modelRefreshPreviews.keys().next().value as string);
    const previewToken = `models_${randomBytes(18).toString("hex")}`;
    const expiresAt = at + 10 * 60_000;
    modelRefreshPreviews.set(previewToken, { userId, providerId: provider.id, models, expiresAt });
    return { ok: true, previewToken, models, expiresAt };
  } catch (error) { return { ok: false, error: `${(error as Error).message} Add an exact model ID manually instead.` }; }
}

export function applyStoredProviderModels(store: ModelStore, provider: ModelCatalogProvider, userId: number, value: Record<string, unknown>, at = Date.now()): Record<string, unknown> {
  const previewToken = String(value.previewToken || ""), preview = modelRefreshPreviews.get(previewToken);
  if (!preview || preview.userId !== userId || preview.providerId !== provider.id || preview.expiresAt < at) {
    modelRefreshPreviews.delete(previewToken);
    return { ok: false, error: "That model preview expired. Refresh the catalog again before confirming." };
  }
  const available = new Set(preview.models.map((model) => model.id));
  const requested = Array.isArray(value.modelIds) ? value.modelIds.map((id) => String(id)) : [];
  if (requested.some((id) => !available.has(id))) return { ok: false, error: "The selection contains a model that was not in this preview." };
  const selected = new Set(requested), override = value.override === true;
  store.update((config) => {
    const current = config.providers.find((entry) => entry.id === provider.id); if (!current) return;
    const discovered = new Set(preview.models.map((model) => model.id));
    const preserved = override ? [] : (current.models || []).filter((model) => !discovered.has(typeof model === "string" ? model : model.id));
    // Override is an exact active-model replacement, not merely an instruction
    // to retain the refreshed catalog with unchecked entries disabled. Keeping
    // those entries made the post-confirm account still look populated by all
    // discovered models and allowed downstream representations to disagree
    // about what the override meant.
    const refreshed = override && selected.size
      ? preview.models.filter((model) => selected.has(model.id)).map((model) => ({ id: model.id, name: model.name, enabled: true }))
      : preview.models.map((model) => ({ id: model.id, name: model.name, enabled: selected.has(model.id) }));
    current.models = [...preserved, ...refreshed];
  });
  modelRefreshPreviews.delete(previewToken);
  return { ok: true, providerId: provider.id, discovered: preview.models.length, enabled: selected.size, override };
}

function modelId(model: ProviderModel): string { return typeof model === "string" ? model : String(model.id || ""); }
function modelEnabled(model: ProviderModel): boolean { return typeof model === "string" || model.enabled !== false; }

async function refreshProvider(store: ModelStore, provider: ModelCatalogProvider, mode: "all" | "free", at: number): Promise<Record<string, unknown>> {
  try {
    const fetched = await fetchModelCatalog(provider);
    const models = mode === "free" ? fetched.filter((model) => model.free === true) : fetched;
    if (!models.length) throw new Error(mode === "free" ? "OpenRouter reported no free models; the saved list was preserved." : "The provider returned no models; the saved list was preserved.");
    store.update((config) => {
      const current = config.providers.find((entry) => entry.id === provider.id);
      if (!current || current.modelAutoRefreshMode !== mode) return;
      const enabled = new Map((current.models || []).map((model) => [modelId(model), modelEnabled(model)]));
      current.models = models.map((model) => ({ id: model.id, name: model.name, enabled: enabled.get(model.id) ?? true }));
      current.modelAutoRefreshAttemptedAt = at; current.modelAutoRefreshSucceededAt = at; current.modelAutoRefreshError = "";
    });
    return { ok: true, providerId: provider.id, mode, models: models.length };
  } catch (error) {
    const message = (error as Error).message || "Automatic model refresh failed.";
    store.update((config) => { const current = config.providers.find((entry) => entry.id === provider.id); if (current?.modelAutoRefreshMode === mode) { current.modelAutoRefreshAttemptedAt = at; current.modelAutoRefreshError = message.slice(0, 500); } });
    return { ok: false, providerId: provider.id, mode, error: message };
  }
}

export async function setProviderModelAutoRefresh(store: ModelStore, provider: ModelCatalogProvider, requested: unknown, at = Date.now()): Promise<Record<string, unknown>> {
  const mode = requested === "all" || requested === "free" ? requested : "off";
  if (mode === "free" && provider.type !== "openrouter") return { ok: false, error: "Free-only automatic refresh is available only for OpenRouter." };
  store.update((config) => {
    const current = config.providers.find((entry) => entry.id === provider.id); if (!current) return;
    current.modelAutoRefreshMode = mode === "off" ? undefined : mode;
    current.modelAutoRefreshAttemptedAt = at; current.modelAutoRefreshError = "";
  });
  if (mode === "off") return { ok: true, providerId: provider.id, mode };
  return { ok: true, providerId: provider.id, mode, refresh: await refreshProvider(store, { ...provider, modelAutoRefreshMode: mode }, mode, at) };
}

export async function runDueProviderModelRefreshes(store: ModelStore, at = Date.now()): Promise<void> {
  const due = store.load().providers.filter((provider) => provider.modelAutoRefreshMode && at - Number(provider.modelAutoRefreshAttemptedAt || 0) >= DAY_MS);
  for (const provider of due) await refreshProvider(store, provider, provider.modelAutoRefreshMode!, at);
}

export function startProviderModelAutoRefresh(store: ModelStore): void {
  if (autoRefreshTimer) return;
  const tick = (): void => { if (!autoRefreshRunning) autoRefreshRunning = runDueProviderModelRefreshes(store).finally(() => { autoRefreshRunning = null; }); };
  tick(); autoRefreshTimer = setInterval(tick, 60 * 60_000); autoRefreshTimer.unref?.();
}

export function stopProviderModelAutoRefresh(): void {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer); autoRefreshTimer = null; autoRefreshRunning = null; modelRefreshPreviews.clear();
}

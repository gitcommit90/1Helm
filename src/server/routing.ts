import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { DATA_DIR, q, q1, run, now } from "./db.ts";
import { imageBytesFromChatGPTResponse } from "./chatgpt.ts";

const require = createRequire(import.meta.url);
const { createHeadlessRuntime } = require("@gitcommit90/rerouted/src/lib/headless-runtime.js") as {
  createHeadlessRuntime: (options: Record<string, unknown>) => RoutingRuntime;
};
const openaiCompat = require("@gitcommit90/rerouted/src/lib/providers/openai-compat.js") as {
  listModels: (provider: RoutingProvider, options?: Record<string, unknown>) => Promise<Array<{ id: string; name?: string }>>;
  chat: (provider: RoutingProvider, options?: Record<string, unknown>) => Promise<Response>;
};
const { runProviderModelTest } = require("@gitcommit90/rerouted/src/lib/model-test.js") as {
  runProviderModelTest: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
const { createRouter } = require("@gitcommit90/rerouted/src/lib/router.js") as {
  createRouter: (options: Record<string, unknown>) => RoutingRuntime["router"];
};
const { createGateway } = require("@gitcommit90/rerouted/src/lib/gateway.js") as {
  createGateway: (options: Record<string, unknown>) => UserGateway;
};
const { createRequestActivity } = require("@gitcommit90/rerouted/src/lib/request-activity.js") as {
  createRequestActivity: () => RoutingRuntime["requestActivity"];
};
const providerFabricChatGPT = require("@gitcommit90/rerouted/src/lib/providers/chatgpt.js") as {
  chat: (provider: RoutingProvider, options: {
    model: string;
    body: Record<string, unknown>;
    stream: boolean;
    signal?: AbortSignal;
    onTokenRefresh?: (tokens: Record<string, unknown>) => Promise<void>;
  }) => Promise<Response | { response: Response }>;
};
const enginePackage = require("@gitcommit90/rerouted/package.json") as { version: string };

type RoutingRuntime = {
  store: {
    load: () => RoutingConfig;
    save: (config: RoutingConfig) => void;
    update: (fn: (config: RoutingConfig) => void) => unknown;
  };
  router: {
    usageAggregate: (period: string) => unknown;
    stats: () => unknown;
    listModels: () => { data?: Array<{ id?: string; name?: string; combo?: boolean; providerId?: string | null; owned_by?: string; accountAliases?: string[] }> };
  };
  gateway: {
    getAddress: () => string | null;
    getListeningAddress?: () => { host: string; port: number } | null;
    isListening: () => boolean;
  };
  requestActivity: { subscribe: (fn: (activity: unknown) => void) => () => void; snapshot: () => unknown[] };
  controlPlane: {
    invoke: (channel: string, args?: unknown[], context?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  start: (options?: { port?: number; host?: string }) => Promise<Record<string, unknown>>;
  close: (options?: { drainMs?: number }) => Promise<void>;
};

type RoutingStore = RoutingRuntime["store"];

type RoutingProvider = {
  id: string;
  type: string;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  accessToken?: string;
  enabled?: boolean;
  models?: Array<string | { id: string; name?: string; enabled?: boolean }>;
  ownerUserId?: number;
  visibility?: "personal" | "workspace";
  [key: string]: unknown;
};

type RoutingCombo = {
  id: string;
  name: string;
  strategy: "fallback" | "round-robin";
  members: Array<Record<string, unknown>>;
  createdAt?: number;
  ownerUserId?: number;
  visibility?: "personal" | "workspace";
};

function comboMatches(entry: RoutingCombo, id: string): boolean {
  return entry.id === id || String(entry.name || "").trim() === id;
}

type RoutingConfig = {
  onboardingComplete: boolean;
  onboardingStep: string;
  adminPasswordHash: string | null;
  port: number;
  bindHost: string;
  serverEnabled: boolean;
  apiKey: string;
  apiKeys: Array<{ id: string; key: string; name: string; enabled: boolean; createdAt: number; internal?: boolean; scope?: string; ownerUserId?: number }>;
  providers: RoutingProvider[];
  combos: RoutingCombo[];
  [key: string]: unknown;
};

type UserGateway = {
  start: (port?: number, host?: string) => Promise<{ port: number; host: string }>;
  stop: () => Promise<void>;
  getListeningAddress: () => { port: number; host: string } | null;
};

type UserGatewayRuntime = {
  userId: number;
  port: number;
  gateway: UserGateway;
  router: RoutingRuntime["router"];
  requestActivity: RoutingRuntime["requestActivity"];
  activityUnsubscribe: () => void;
};

// ReRouted's generic OpenAI-compatible adapter historically assumed every
// custom endpoint had a bearer key. 1Helm explicitly supports endpoints with
// no authentication: keep the upstream adapter, but strip its empty
// `Authorization: Bearer ` header for discovery, tests, and real requests.
const originalCompatListModels = openaiCompat.listModels.bind(openaiCompat);
const originalCompatChat = openaiCompat.chat.bind(openaiCompat);
const withoutEmptyBearer = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers);
  if (headers.get("authorization")?.trim().toLowerCase() === "bearer") headers.delete("authorization");
  return fetch(input, { ...init, headers });
};
openaiCompat.listModels = (provider, options = {}) => originalCompatListModels(provider, { ...options, fetchImpl: withoutEmptyBearer });
openaiCompat.chat = (provider, options = {}) => originalCompatChat(provider, { ...options, fetchImpl: withoutEmptyBearer });

export type RoutingModel = {
  id: string;
  name: string;
  kind: "model" | "route";
  providerType?: string;
  providerName?: string;
  accountCount?: number;
};

const ROUTING_DIR = join(DATA_DIR, "routing");
const INTERNAL_PROVIDER_KIND = "routing";
const INTERNAL_PROVIDER_NAME = "1Helm Router";
const INTERNAL_GATEWAY_KEY_ID = "key_1helm_internal";
const INTERNAL_GATEWAY_KEY_SCOPE = "1helm-internal";
let runtime: RoutingRuntime | null = null;
let starting: Promise<RoutingRuntime> | null = null;
let activityUnsubscribe: (() => void) | null = null;
let onActivity: ((activity?: unknown, userId?: number) => void) | null = null;
const recentActivity: unknown[] = [];
const recentUserActivity = new Map<number, unknown[]>();
type ModelDiscovery = { id: string; name: string; free?: boolean };
type ModelRefreshPreview = { userId: number; providerId: string; models: ModelDiscovery[]; expiresAt: number };
const modelRefreshPreviews = new Map<string, ModelRefreshPreview>();
type OauthCompletion = { connected: boolean; account?: Record<string, unknown>; error?: string };
const oauthWatchers = new Map<string, NodeJS.Timeout>();
const oauthCompletions = new Map<string, OauthCompletion>();
const oauthFinalizing = new Map<string, Promise<Record<string, unknown>>>();
const oauthOwners = new Map<string, { userId: number; type: string; providerIds: Set<string> }>();
const activeOauthByFamily = new Map<string, string>();
const userGateways = new Map<number, UserGatewayRuntime>();

function publishRoutingActivity(activity: unknown, userId = 0): void {
  const history = userId > 0
    ? (recentUserActivity.get(userId) || (recentUserActivity.set(userId, []), recentUserActivity.get(userId)!))
    : recentActivity;
  history.unshift(activity);
  if (history.length > 30) history.length = 30;
  onActivity?.(activity, userId);
}

const oauthKey = (userId: number, type: string): string => `${userId}:${type}`;
const oauthFamily = (type: string): string => ["chatgpt", "codex"].includes(type) ? "chatgpt" : type;

const visibilityOf = (entry: { ownerUserId?: unknown; visibility?: unknown }): "personal" | "workspace" =>
  entry.visibility === "personal" && Number(entry.ownerUserId || 0) > 0 ? "personal" : "workspace";
const visibleToUser = (entry: { ownerUserId?: unknown; visibility?: unknown }, userId: number): boolean =>
  visibilityOf(entry) === "workspace" || Number(entry.ownerUserId || 0) === userId;
const ownedByUser = (entry: { ownerUserId?: unknown }, userId: number): boolean => Number(entry.ownerUserId || 0) === userId;

function stampNewProviders(target: RoutingRuntime, before: Set<string>, userId: number, visibility: "personal" | "workspace" = "personal"): string[] {
  const ids: string[] = [];
  target.store.update((config) => {
    for (const provider of config.providers || []) {
      if (before.has(provider.id)) continue;
      provider.ownerUserId = userId;
      provider.visibility = visibility;
      ids.push(provider.id);
    }
  });
  return ids;
}

function scopedConfig(config: RoutingConfig, userId: number, gatewayKey?: string): RoutingConfig {
  const providers = (config.providers || []).filter((provider) => visibleToUser(provider, userId)).map((provider) => ({ ...provider }));
  const providerIds = new Set(providers.map((provider) => provider.id));
  const combos = (config.combos || []).filter((combo) => visibleToUser(combo, userId)).map((combo) => ({
    ...combo,
    members: (combo.members || []).filter((member) => {
      const providerId = String(member.providerId || "");
      return !providerId || providerIds.has(providerId);
    }),
  })).filter((combo) => combo.members.length > 0);
  const apiKeys: RoutingConfig["apiKeys"] = q("SELECT id,key,name,enabled,created FROM user_routing_keys WHERE user_id=?", userId).map((entry) => ({ id: String(entry.id), key: String(entry.key), name: String(entry.name), enabled: Boolean(entry.enabled), createdAt: Number(entry.created), ownerUserId: userId }));
  if (gatewayKey) apiKeys.push({ id: `key_user_${userId}`, key: gatewayKey, name: "1Helm user endpoint", enabled: true, createdAt: now(), ownerUserId: userId, internal: true, scope: `1helm-user:${userId}` });
  return { ...config, providers, combos, apiKeys, apiKey: gatewayKey || "" };
}

function migrateRoutingOwnership(target: RoutingRuntime): void {
  const captainId = Number(q1("SELECT id FROM users WHERE is_admin=1 ORDER BY id LIMIT 1")?.id || 0);
  if (!captainId) return;
  target.store.update((config) => {
    for (const provider of config.providers || []) {
      if (!Number(provider.ownerUserId || 0)) provider.ownerUserId = captainId;
      if (!provider.visibility) provider.visibility = "workspace";
    }
    for (const combo of config.combos || []) {
      if (!Number(combo.ownerUserId || 0)) combo.ownerUserId = captainId;
      if (!combo.visibility) combo.visibility = "workspace";
    }
    const legacyKeys = (config.apiKeys || []).filter((entry) => !isInternalGatewayKey(entry));
    for (const entry of legacyKeys) run(`INSERT OR IGNORE INTO user_routing_keys (id,user_id,key,name,enabled,created) VALUES (?,?,?,?,?,?)`,
      String(entry.id), Number(entry.ownerUserId || captainId), String(entry.key), String(entry.name || "Migrated client"), entry.enabled === false ? 0 : 1, Number(entry.createdAt || now()));
    config.apiKeys = (config.apiKeys || []).filter(isInternalGatewayKey);
  });
}

function userEndpointRow(userId: number): { port: number; internal_key: string } {
  const existing = q1("SELECT port,internal_key FROM user_routing_endpoints WHERE user_id=?", userId);
  if (existing) return { port: Number(existing.port), internal_key: String(existing.internal_key) };
  const used = new Set(q("SELECT port FROM user_routing_endpoints").map((row) => Number(row.port)));
  let port = Math.max(4950, Number(process.env.HELM_USER_ROUTER_PORT_BASE || 4950));
  while (used.has(port)) port++;
  const key = `rru-${randomBytes(24).toString("hex")}`;
  run("INSERT INTO user_routing_endpoints (user_id,port,internal_key,created,updated) VALUES (?,?,?,?,?)", userId, port, key, now(), now());
  return { port, internal_key: key };
}

async function ensureUserGateway(userId: number): Promise<UserGatewayRuntime> {
  const existing = userGateways.get(userId);
  if (existing) return existing;
  const target = await startRoutingEngine(onActivity || undefined);
  const endpoint = userEndpointRow(userId);
  const store = {
    load: () => scopedConfig(target.store.load(), userId, endpoint.internal_key),
    save: () => undefined,
    update: (fn: (config: RoutingConfig) => void) => target.store.update((config) => fn(config)),
  };
  const requestActivity = createRequestActivity();
  const baseRouter = createRouter({ store });
  const recordUserUsage = (result: Record<string, unknown>, body: Record<string, unknown>, status: number, usage?: Record<string, unknown> | null): void => {
    const prompt = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0;
    const completion = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0;
    const cached = Number(usage?.cached_tokens ?? (usage?.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens ?? 0) || 0;
    run(`INSERT INTO routing_usage_events
      (user_id,provider_id,model,status,prompt_tokens,completion_tokens,cached_tokens,detail,created)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    userId, String(result.providerId || ""), String(body.model || ""), status, prompt, completion, cached,
    JSON.stringify({ providerType: result.providerType || "", providerName: result.providerName || "", accountAlias: result.accountAlias || null }).slice(0, 4000), now());
  };
  const router = {
    ...baseRouter,
    chatCompletions: async (options: Record<string, unknown>) => {
      const result = await (baseRouter as unknown as { chatCompletions: (input: Record<string, unknown>) => Promise<Record<string, unknown>> }).chatCompletions(options);
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      const streamPipe = result.streamPipe;
      if (result.ok !== false && typeof streamPipe === "function") {
        result.streamPipe = async (clientResponse: unknown) => {
          try {
            const usage = await (streamPipe as (response: unknown) => Promise<Record<string, unknown> | null>)(clientResponse);
            recordUserUsage(result, body, 200, usage);
            return usage;
          } catch (error) {
            recordUserUsage(result, body, Number((error as { status?: unknown }).status || 502), null);
            throw error;
          }
        };
      } else {
        const openAiJson = result.openAiJson && typeof result.openAiJson === "object" ? result.openAiJson as Record<string, unknown> : {};
        const usage = openAiJson.usage && typeof openAiJson.usage === "object" ? openAiJson.usage as Record<string, unknown> : null;
        recordUserUsage(result, body, result.ok === false ? Number(result.status || 502) : 200, usage);
      }
      return result;
    },
  } as RoutingRuntime["router"];
  const gateway = createGateway({ store, router, requestActivity });
  const activityUnsubscribe = requestActivity.subscribe((activity) => publishRoutingActivity(activity, userId));
  const desiredPort = await choosePort(endpoint.port, "127.0.0.1", false);
  let address: { port: number; host: string };
  try {
    address = await gateway.start(desiredPort, "127.0.0.1");
  } catch (error) {
    activityUnsubscribe();
    throw error;
  }
  if (address.port !== endpoint.port) run("UPDATE user_routing_endpoints SET port=?,updated=? WHERE user_id=?", address.port, now(), userId);
  const created = { userId, port: address.port, gateway, router, requestActivity, activityUnsubscribe };
  userGateways.set(userId, created);
  return created;
}

const chatGPTFabricProviders = (config: RoutingConfig): RoutingProvider[] => (config.providers || []).filter((provider) => {
  if (provider.enabled === false || !["chatgpt", "codex"].includes(String(provider.type || ""))) return false;
  const accessToken = String(provider.accessToken || "").trim();
  const refreshToken = String(provider.refreshToken || "").trim();
  const expiresAt = Number(provider.expiresAt || 0);
  return Boolean(refreshToken || (accessToken && (!expiresAt || expiresAt > Date.now())));
});

/** Capability health is derived from the same provider fabric the Settings UI
 * connects. A provider row or stale UI toggle alone can never advertise it. */
export function routingChatGPTImageAvailable(): boolean {
  try {
    const config = runtime?.store.load();
    if (config) return chatGPTFabricProviders(config).length > 0;
    const stored = require("node:fs").readFileSync(join(ROUTING_DIR, "config.json"), "utf8");
    return chatGPTFabricProviders(JSON.parse(stored) as RoutingConfig).length > 0;
  } catch { return false; }
}

const enabledModelIds = (provider: RoutingProvider): string[] => (provider.models || [])
  .filter((model) => typeof model === "string" || model.enabled !== false)
  .map((model) => typeof model === "string" ? model : String(model.id || ""))
  .filter(Boolean);

export async function generateRoutingChatGPTImageWith(
  store: RoutingStore,
  adapter: typeof providerFabricChatGPT,
  prompt: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const providers = chatGPTFabricProviders(store.load());
  if (!providers.length) throw new Error("Connect a ChatGPT subscription account in Settings → Providers.");
  let lastError = "Image generation is unavailable for the connected ChatGPT account.";
  for (const provider of providers) {
    const models = enabledModelIds(provider);
    const preferred = ["gpt-5.6", "gpt-5.5", ...models.filter((model) => /^gpt-5/i.test(model)), ...models];
    for (const model of [...new Set(preferred.filter((candidate) => models.includes(candidate)))]) {
      try {
        const result = await adapter.chat(provider, {
          model,
          body: {
            model,
            messages: [{ role: "user", content: prompt }],
            tools: [{ type: "image_generation", action: "generate" }],
          },
          stream: true,
          signal,
          onTokenRefresh: async (tokens) => {
            store.update((config) => {
              const current = config.providers.find((candidate) => candidate.id === provider.id);
              if (current) Object.assign(current, tokens);
            });
          },
        });
        const response = result instanceof Response ? result : result.response;
        return await imageBytesFromChatGPTResponse(response);
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = (error as Error).message || lastError;
      }
    }
  }
  throw new Error(lastError);
}

/** Generate through the authoritative multi-account fabric, including token
 * refresh persistence and account/model fallback. */
export async function generateRoutingChatGPTImage(prompt: string, signal?: AbortSignal, userId = 0): Promise<Buffer> {
  const target = await startRoutingEngine(onActivity || undefined);
  if (!userId) return generateRoutingChatGPTImageWith(target.store, providerFabricChatGPT, prompt, signal);
  const store = {
    load: () => scopedConfig(target.store.load(), userId),
    save: target.store.save,
    update: target.store.update,
  };
  return generateRoutingChatGPTImageWith(store, providerFabricChatGPT, prompt, signal);
}

function oauthType(payload: unknown): string {
  return typeof payload === "string" ? payload : String((payload as { type?: unknown } | null)?.type || "");
}

function stopOauthWatcher(key: string): void {
  const timer = oauthWatchers.get(key);
  if (timer) clearInterval(timer);
  oauthWatchers.delete(key);
}

function releaseOauthSession(key: string): void {
  stopOauthWatcher(key);
  const owner = oauthOwners.get(key);
  if (owner && activeOauthByFamily.get(oauthFamily(owner.type)) === key) activeOauthByFamily.delete(oauthFamily(owner.type));
  oauthOwners.delete(key);
}

async function finishOauth(target: RoutingRuntime, payload: Record<string, unknown>, userId: number, automatic = false): Promise<Record<string, unknown>> {
  const type = oauthType(payload);
  const key = oauthKey(userId, type);
  const completed = oauthCompletions.get(key);
  if (completed?.connected) return { ok: true, account: completed.account, connected: true };
  const owner = oauthOwners.get(key);
  if (!owner || owner.userId !== userId) return { ok: false, error: "This OAuth connection is not active for your account." };
  const existing = oauthFinalizing.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const result = publicControlPlaneResult(await target.controlPlane.invoke("app:oauth-complete", [payload], { harness: true }));
    if (result.ok !== false) {
      if (owner?.userId) stampNewProviders(target, owner.providerIds, owner.userId, "personal");
      releaseOauthSession(key);
      oauthCompletions.set(key, { connected: true, account: result.account as Record<string, unknown> | undefined });
      ensureInternalProvider(target);
      onActivity?.();
    } else if (automatic) {
      releaseOauthSession(key);
      oauthCompletions.set(key, { connected: false, error: String(result.error || "Connection failed.") });
    }
    return result;
  })().finally(() => { oauthFinalizing.delete(key); });
  oauthFinalizing.set(key, pending);
  return pending;
}

function watchOauth(target: RoutingRuntime, userId: number, type: string, providerId?: string): void {
  const key = oauthKey(userId, type);
  stopOauthWatcher(key);
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (oauthFinalizing.has(key)) return;
    void target.controlPlane.invoke("app:oauth-status", [type], { harness: true }).then((status) => {
      if (status.hasCode) return finishOauth(target, { type, providerId, pasteCode: "" }, userId, true);
      if (!status.active || Date.now() - startedAt > 20 * 60_000) {
        releaseOauthSession(key);
      }
    }).catch(() => undefined);
  }, 750);
  timer.unref();
  oauthWatchers.set(key, timer);
}

function legacyRows(): Array<Record<string, unknown>> {
  return q("SELECT id,name,base_url,api_key,kind,created FROM providers WHERE kind<>? ORDER BY id", INTERNAL_PROVIDER_KIND);
}

function modelIdsForLegacyProvider(providerId: number): string[] {
  const ids = new Set<string>();
  for (const row of q("SELECT model FROM bots WHERE provider_id=? AND trim(model)<>''", providerId)) ids.add(String(row.model));
  for (const row of q("SELECT model FROM model_prefs WHERE provider_id=? AND trim(model)<>''", providerId)) ids.add(String(row.model));
  return [...ids];
}

function normalizeBaseUrl(value: unknown): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

function routableBaseUrl(value: string): boolean {
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

async function fetchModelCatalog(provider: Pick<RoutingProvider, "type" | "baseUrl" | "apiKey" | "accessToken">): Promise<ModelDiscovery[]> {
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
    const raw = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : [];
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
  } finally {
    clearTimeout(timer);
  }
}

async function previewStoredProviderModels(provider: RoutingProvider, userId: number): Promise<Record<string, unknown>> {
  try {
    const models = await fetchModelCatalog(provider);
    if (!models.length) return { ok: false, error: "The provider returned no models. Add an exact model ID manually instead." };
    for (const [token, preview] of modelRefreshPreviews) {
      if (preview.expiresAt < now() || (preview.userId === userId && preview.providerId === provider.id)) modelRefreshPreviews.delete(token);
    }
    if (modelRefreshPreviews.size >= 512) modelRefreshPreviews.delete(modelRefreshPreviews.keys().next().value as string);
    const previewToken = `models_${randomBytes(18).toString("hex")}`;
    const expiresAt = now() + 10 * 60_000;
    modelRefreshPreviews.set(previewToken, { userId, providerId: provider.id, models, expiresAt });
    return { ok: true, previewToken, models, expiresAt };
  } catch (error) {
    return { ok: false, error: `${(error as Error).message} Add an exact model ID manually instead.` };
  }
}

async function previewOpenRouterConnection(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const modelId = String(payload.modelId || "").trim();
  if (modelId) return { ok: true, models: [{ id: modelId, name: modelId }], validation: "manual-model" };
  const baseUrl = normalizeBaseUrl(payload.baseUrl);
  const apiKey = String(payload.apiKey || "").trim();
  if (!baseUrl || !apiKey) return { ok: false, error: "Base URL and API key required" };
  try {
    const models = await fetchModelCatalog({ type: "openrouter", baseUrl, apiKey });
    return models.length ? { ok: true, models, validation: "models" } : { ok: false, error: "OpenRouter returned no models." };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function applyStoredProviderModels(target: RoutingRuntime, provider: RoutingProvider, userId: number, value: Record<string, unknown>): Record<string, unknown> {
  const previewToken = String(value.previewToken || "");
  const preview = modelRefreshPreviews.get(previewToken);
  if (!preview || preview.userId !== userId || preview.providerId !== provider.id || preview.expiresAt < now()) {
    modelRefreshPreviews.delete(previewToken);
    return { ok: false, error: "That model preview expired. Refresh the catalog again before confirming." };
  }
  const available = new Set(preview.models.map((model) => model.id));
  const selected = new Set((Array.isArray(value.modelIds) ? value.modelIds : []).map((id) => String(id)).filter((id) => available.has(id)));
  const requested = Array.isArray(value.modelIds) ? value.modelIds.map((id) => String(id)) : [];
  if (requested.some((id) => !available.has(id))) return { ok: false, error: "The selection contains a model that was not in this preview." };
  target.store.update((config) => {
    const current = config.providers.find((entry) => entry.id === provider.id);
    if (!current) return;
    const discovered = new Set(preview.models.map((model) => model.id));
    const manual = (current.models || []).filter((model) => !discovered.has(typeof model === "string" ? model : model.id));
    current.models = [
      ...manual,
      ...preview.models.map((model) => ({ id: model.id, name: model.name, enabled: selected.has(model.id) })),
    ];
  });
  modelRefreshPreviews.delete(previewToken);
  return { ok: true, providerId: provider.id, discovered: preview.models.length, enabled: selected.size };
}

function routeNameAvailable(config: RoutingConfig, name: string): boolean {
  const key = name.trim().toLowerCase();
  return !!key && !config.combos.some((combo) => String(combo.name || "").trim().toLowerCase() === key);
}

function isInternalGatewayKey(entry: { id?: unknown; internal?: unknown; scope?: unknown } | null | undefined): boolean {
  return !!entry && (
    entry.id === INTERNAL_GATEWAY_KEY_ID
    || entry.internal === true
    || entry.scope === INTERNAL_GATEWAY_KEY_SCOPE
  );
}

/**
 * 1Helm agents authenticate to the embedded gateway with a private, durable
 * credential. Public Endpoint keys can therefore all be disabled or revoked
 * without taking resident agents offline. The marker is stored only in the
 * host-owned routing config and is stripped from every control-plane result.
 */
function ensureInternalGatewayKey(target: RoutingRuntime): string {
  const current = target.store.load();
  const existing = (current.apiKeys || []).find(isInternalGatewayKey);
  if (
    existing
    && existing.id === INTERNAL_GATEWAY_KEY_ID
    && existing.name === "1Helm internal"
    && existing.enabled === true
    && existing.internal === true
    && existing.scope === INTERNAL_GATEWAY_KEY_SCOPE
    && String(existing.key || "").trim()
  ) return String(existing.key);

  let internalKey = "";
  target.store.update((config) => {
    if (!Array.isArray(config.apiKeys)) config.apiKeys = [];
    let entry = config.apiKeys.find(isInternalGatewayKey);
    if (!entry) {
      entry = {
        id: INTERNAL_GATEWAY_KEY_ID,
        key: `rr-${randomBytes(16).toString("hex")}`,
        name: "1Helm internal",
        enabled: true,
        createdAt: now(),
        internal: true,
        scope: INTERNAL_GATEWAY_KEY_SCOPE,
      };
      config.apiKeys.push(entry);
    }
    entry.id = INTERNAL_GATEWAY_KEY_ID;
    entry.name = "1Helm internal";
    entry.enabled = true;
    entry.internal = true;
    entry.scope = INTERNAL_GATEWAY_KEY_SCOPE;
    if (!String(entry.key || "").trim()) entry.key = `rr-${randomBytes(16).toString("hex")}`;
    internalKey = String(entry.key);
  });
  return internalKey;
}

function externalGatewayKeys(config: RoutingConfig): RoutingConfig["apiKeys"] {
  return (config.apiKeys || []).filter((entry) => !isInternalGatewayKey(entry));
}

function publicControlPlaneResult(result: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(result.apiKeys)) return result;
  return { ...result, apiKeys: result.apiKeys.filter((entry) => !isInternalGatewayKey(entry as never)) };
}

function unauthenticatedCustomPayload(payload: unknown): Record<string, unknown> | null {
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const custom = !String(value.apiKey || "").trim()
    && (String(value.providerType || "") === "openai-compat" || (!value.preset && "models" in value));
  return custom ? value : null;
}

async function testUnauthenticatedCustom(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const baseUrl = normalizeBaseUrl(payload.baseUrl);
  const modelId = String(payload.modelId || "").trim();
  if (!baseUrl || !routableBaseUrl(baseUrl)) return { ok: false, error: "Valid HTTP or HTTPS base URL required" };
  const provider: RoutingProvider = { id: "test", type: "openai-compat", name: "Custom", baseUrl, apiKey: "" };
  if (modelId) {
    const tested = await runProviderModelTest({ adapter: openaiCompat, provider, model: modelId });
    if (tested.ok === false) return tested;
    return { ok: true, models: [{ id: modelId, name: modelId }], validation: "chat-completions" };
  }
  try { return { ok: true, models: await openaiCompat.listModels(provider), validation: "models" }; }
  catch (error) { return { ok: false, error: (error as Error).message }; }
}

function addUnauthenticatedCustom(target: RoutingRuntime, payload: Record<string, unknown>): Record<string, unknown> {
  const baseUrl = normalizeBaseUrl(payload.baseUrl);
  const name = String(payload.name || "").trim();
  const models = Array.isArray(payload.models) ? payload.models as RoutingProvider["models"] : [];
  if (!baseUrl || !routableBaseUrl(baseUrl)) return { ok: false, error: "Valid HTTP or HTTPS base URL required" };
  if (!name) return { ok: false, error: "Custom connection name required" };
  if (name.includes("/")) return { ok: false, error: "Custom connection names cannot contain /" };
  const current = target.store.load();
  if (current.providers.some((provider) => ["custom", "openai-compat"].includes(provider.type) && provider.name.trim().toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: `A custom connection named ${name} already exists` };
  }
  const routeNames = new Set(current.combos.map((combo) => String(combo.name || combo.id).trim().toLowerCase()));
  const conflict = (models || []).find((model) => {
    const modelId = typeof model === "string" ? model : model.id;
    return routeNames.has(`${name}/custom/${modelId}`.toLowerCase());
  });
  if (conflict) return { ok: false, error: `A route named ${name}/custom/${typeof conflict === "string" ? conflict : conflict.id} already exists` };
  const id = `prov_${randomBytes(6).toString("hex")}`;
  target.store.update((config) => { config.providers.push({ id, type: "openai-compat", name, baseUrl, apiKey: "", models, enabled: true, createdAt: Date.now() }); });
  return { ok: true, id };
}

/**
 * Import every pre-router 1Helm connection once. Existing agents keep their
 * exact model IDs through named compatibility routes, so the migration is
 * additive and does not strand a running workspace.
 */
function migrateLegacyProviders(target: RoutingRuntime): void {
  const legacy = legacyRows();
  if (!legacy.length) return;
  target.store.update((config) => {
    for (const row of legacy) {
      const legacyId = Number(row.id);
      const marker = `1helm-legacy:${legacyId}`;
      let provider = config.providers.find((item) => item.importSource === marker);
      if (!provider) {
        const baseUrl = normalizeBaseUrl(row.base_url);
        const apiKey = String(row.api_key || "");
        if (!baseUrl || !routableBaseUrl(baseUrl)) continue;
        provider = {
          id: `prov_1helm_${legacyId}`,
          type: "openai-compat",
          name: String(row.name || `Imported provider ${legacyId}`),
          baseUrl,
          apiKey,
          enabled: true,
          createdAt: Number(row.created || now()),
          importSource: marker,
          models: modelIdsForLegacyProvider(legacyId).map((id) => ({ id, name: id, enabled: true })),
        };
        config.providers.push(provider);
      }
      for (const model of modelIdsForLegacyProvider(legacyId)) {
        if (!routeNameAvailable(config, model)) continue;
        config.combos.push({
          id: `combo_1helm_${legacyId}_${Buffer.from(model).toString("hex").slice(0, 24)}`,
          name: model,
          strategy: "fallback",
          members: [{ providerId: provider.id, model }],
          createdAt: now(),
        });
      }
    }
  });
}

function ensureInternalProvider(target: RoutingRuntime): number {
  const config = target.store.load();
  const listening = target.gateway.getListeningAddress?.();
  const port = listening?.port || Number(config.port || 4949);
  const privateKey = ensureInternalGatewayKey(target);
  let row = q1("SELECT id FROM providers WHERE kind=? ORDER BY id LIMIT 1", INTERNAL_PROVIDER_KIND);
  if (!row) {
    const id = run(
      "INSERT INTO providers (name,base_url,api_key,kind,created) VALUES (?,?,?,?,?)",
      INTERNAL_PROVIDER_NAME,
      `http://127.0.0.1:${port}/v1`,
      privateKey,
      INTERNAL_PROVIDER_KIND,
      now(),
    ).lastInsertRowid;
    row = { id };
  } else {
    run(
      "UPDATE providers SET name=?,base_url=?,api_key=? WHERE id=?",
      INTERNAL_PROVIDER_NAME,
      `http://127.0.0.1:${port}/v1`,
      privateKey,
      row.id,
    );
  }

  const internalId = Number(row.id);
  // Once compatibility routes exist, every 1Helm model policy can use the
  // single internal router. This is what makes newly connected accounts and
  // routes immediately available to every resident agent.
  const importedLegacyIds = target.store.load().providers
    .map((provider) => /^1helm-legacy:(\d+)$/.exec(String(provider.importSource || ""))?.[1])
    .filter(Boolean)
    .map(Number);
  run("UPDATE bots SET provider_id=? WHERE provider_id IS NULL", internalId);
  run("UPDATE model_prefs SET provider_id=? WHERE provider_id IS NULL", internalId);
  for (const legacyId of importedLegacyIds) {
    run("UPDATE bots SET provider_id=? WHERE provider_id=?", internalId, legacyId);
    run("UPDATE model_prefs SET provider_id=? WHERE provider_id=?", internalId, legacyId);
  }
  const workspace = q1("SELECT default_provider_id FROM workspace WHERE id=1");
  const workspaceProvider = Number(workspace?.default_provider_id || 0);
  if (workspace && (!workspaceProvider || importedLegacyIds.includes(workspaceProvider))) {
    run("UPDATE workspace SET default_provider_id=? WHERE id=1", internalId);
  }
  return internalId;
}

/** Remove selections that no longer exist after an account/model/route edit.
 * Policies then inherit the current workspace choice instead of displaying a
 * ghost model that the gateway can never serve. */
function reconcileModelPolicies(target: RoutingRuntime): void {
  const available = new Set((target.router.listModels().data || []).map((model) => String(model.id || "").trim()).filter(Boolean));
  const workspace = q1("SELECT default_model FROM workspace WHERE id=1");
  let fallback = String(workspace?.default_model || "");
  if (!available.has(fallback)) {
    fallback = [...available][0] || "";
    run("UPDATE workspace SET default_model=? WHERE id=1", fallback);
  }
  for (const pref of q("SELECT bot_id,scope,scope_id,model FROM model_prefs")) {
    if (!available.has(String(pref.model || ""))) run("DELETE FROM model_prefs WHERE bot_id=? AND scope=? AND scope_id=?", pref.bot_id, pref.scope, pref.scope_id);
  }
  for (const pref of q("SELECT user_id,model FROM user_model_prefs")) {
    const userId = Number(pref.user_id || 0);
    const scoped = userId ? scopedConfig(target.store.load(), userId) : target.store.load();
    const scopedStore = { load: () => scoped, save: () => undefined, update: () => undefined };
    const scopedModels = new Set((createRouter({ store: scopedStore }).listModels().data || []).map((model) => String(model.id || "").trim()).filter(Boolean));
    if (!scopedModels.has(String(pref.model || ""))) run("DELETE FROM user_model_prefs WHERE user_id=?", userId);
  }
  for (const bot of q("SELECT id,model FROM bots")) {
    if (String(bot.model || "") && !available.has(String(bot.model))) run("UPDATE bots SET model=? WHERE id=?", fallback, bot.id);
  }
}

async function initializeEngineConfig(target: RoutingRuntime): Promise<void> {
  let config = target.store.load();
  if (!config.adminPasswordHash) {
    const randomPassword = randomBytes(32).toString("base64url");
    await target.controlPlane.invoke("app:set-admin-password", [randomPassword], { harness: true });
  }
  config = target.store.load();
  if (!config.onboardingComplete) {
    await target.controlPlane.invoke("app:complete-onboarding", [], { harness: true });
  }
}

async function choosePort(preferred: number, host: string, honorConfiguredPort = true): Promise<number> {
  const configured = honorConfiguredPort ? process.env.HELM_ROUTER_PORT : "";
  const requested = Number(configured || preferred || 4949);
  const candidates = configured ? [requested] : [...Array(20)].map((_, index) => requested + index);
  const available = (port: number): Promise<boolean> => new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
  for (const candidate of candidates) if (await available(candidate)) return candidate;
  if (configured) throw new Error(`Router port ${requested} is unavailable.`);
  return new Promise((resolve, reject) => {
    const fallback = createNetServer(); fallback.once("error", reject);
    fallback.listen(0, host, () => { const address = fallback.address(); const port = typeof address === "object" && address ? address.port : 0; fallback.close(() => resolve(port)); });
  });
}

export async function startRoutingEngine(activityCallback?: (activity?: unknown, userId?: number) => void): Promise<RoutingRuntime> {
  if (runtime) return runtime;
  if (starting) return starting;
  onActivity = activityCallback || null;
  starting = (async () => {
    mkdirSync(ROUTING_DIR, { recursive: true, mode: 0o700 });
    const target = createHeadlessRuntime({
      userData: ROUTING_DIR,
      version: enginePackage.version,
      openExternal: async () => undefined,
      onQuit: async () => undefined,
    });
    await initializeEngineConfig(target);
    migrateLegacyProviders(target);
    migrateRoutingOwnership(target);
    ensureInternalGatewayKey(target);
    const config = target.store.load();
    const host = String(config.bindHost || "127.0.0.1");
    const port = await choosePort(Number(config.port || 4949), host);
    if (port !== Number(config.port || 4949)) target.store.update((current) => { current.port = port; });
    await target.start({ port, host });
    ensureInternalProvider(target);
    activityUnsubscribe = target.requestActivity.subscribe((activity) => publishRoutingActivity(activity));
    runtime = target;
    return target;
  })().finally(() => { starting = null; });
  return starting;
}

export async function stopRoutingEngine(): Promise<void> {
  const target = runtime;
  runtime = null;
  activityUnsubscribe?.();
  activityUnsubscribe = null;
  for (const type of oauthWatchers.keys()) stopOauthWatcher(type);
  oauthCompletions.clear();
  oauthFinalizing.clear();
  oauthOwners.clear();
  activeOauthByFamily.clear();
  const gateways = [...userGateways.values()];
  userGateways.clear();
  for (const entry of gateways) entry.activityUnsubscribe();
  await Promise.all(gateways.map((entry) => entry.gateway.stop().catch(() => undefined)));
  recentActivity.length = 0;
  recentUserActivity.clear();
  modelRefreshPreviews.clear();
  if (target) await target.close({ drainMs: 10_000 });
}

export function routingReady(): boolean {
  return !!runtime;
}

export async function routingInvoke(action: string, payload?: unknown, userId = 0, isAdmin = true): Promise<Record<string, unknown>> {
  const target = await startRoutingEngine(onActivity || undefined);
  const actorId = Math.max(0, Number(userId || 0));
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const configBefore = target.store.load();
  const providerIdsBefore = new Set(configBefore.providers.map((entry) => entry.id));
  const comboIdsBefore = new Set(configBefore.combos.map((entry) => entry.id));
  const providerId = String(value.providerId || value.id || (typeof payload === "string" ? payload : ""));
  const keyId = String(value.id || (typeof payload === "string" ? payload : ""));
  const provider = providerId ? configBefore.providers.find((entry) => entry.id === providerId) : undefined;
  const comboId = String(value.id || (typeof payload === "string" ? payload : ""));
  const combo = comboId ? configBefore.combos.find((entry) => comboMatches(entry, comboId)) : undefined;
  const gatewayKey = keyId ? q1("SELECT id,user_id FROM user_routing_keys WHERE id=?", keyId) : undefined;
  const providerMutation = ["app:remove-provider", "app:set-provider-enabled", "app:set-provider-visibility", "app:set-model-enabled", "app:set-all-models-enabled", "app:add-model", "app:remove-model", "app:preview-provider-models", "app:apply-provider-models"].includes(action);
  if (providerMutation && (!provider || !actorId || !ownedByUser(provider, actorId))) return { ok: false, error: "You can change only your own provider accounts." };
  if (gatewayKey && Number(gatewayKey.user_id || 0) !== actorId) return { ok: false, error: "You can change only your own endpoint keys." };
  if (["app:delete-combo"].includes(action) && (!combo || !actorId || !ownedByUser(combo, actorId))) return { ok: false, error: "You can change only your own routes." };
  if (action === "app:save-combo") {
    if (!actorId) return { ok: false, error: "A signed-in user is required." };
    if (comboId && (!combo || !ownedByUser(combo, actorId))) return { ok: false, error: "You can change only your own routes." };
    const requestedVisibility = value.visibility === "workspace" ? "workspace" : "personal";
    const members = Array.isArray(value.members) ? value.members as Array<Record<string, unknown>> : [];
    for (const member of members) {
      const referencedId = String(member.providerId || "");
      if (!referencedId) {
        if (requestedVisibility !== "workspace") continue;
        const requestedFamily = String(member.providerType || "").replace(/^codex$/, "chatgpt");
        const requestedModel = String(member.model || "");
        const hasSharedDestination = configBefore.providers.some((candidate) => {
          const family = String(candidate.type || "").replace(/^codex$/, "chatgpt");
          return candidate.enabled !== false
            && visibilityOf(candidate) === "workspace"
            && family === requestedFamily
            && enabledModelIds(candidate).includes(requestedModel);
        });
        if (!hasSharedDestination) return { ok: false, error: "Share at least one matching provider account before sharing this route." };
        continue;
      }
      const referenced = configBefore.providers.find((entry) => entry.id === referencedId);
      if (!referenced || !visibleToUser(referenced, actorId)) return { ok: false, error: "A route can use only providers available to your account." };
      if (requestedVisibility === "workspace" && visibilityOf(referenced) !== "workspace") return { ok: false, error: "Share each provider in a workspace route before sharing the route." };
    }
  }
  if (
    ["app:revoke-api-key", "app:set-api-key-enabled"].includes(action)
    && (typeof payload === "string" ? payload : String((payload as { id?: unknown } | null)?.id || "")) === INTERNAL_GATEWAY_KEY_ID
  ) {
    return { ok: false, error: "The private workspace credential cannot be changed." };
  }
  if (action === "app:set-provider-visibility") {
    if (!provider || !ownedByUser(provider, actorId)) return { ok: false, error: "Provider not found." };
    const visibility = value.visibility === "workspace" ? "workspace" : "personal";
    target.store.update((config) => {
      const current = config.providers.find((entry) => entry.id === provider.id);
      if (current) { current.ownerUserId = actorId || Number(current.ownerUserId || 0); current.visibility = visibility; }
    });
    return { ok: true, id: provider.id, visibility };
  }
  if (action === "app:create-api-key") {
    if (!actorId) return { ok: false, error: "A signed-in user is required." };
    const name = String(typeof payload === "string" ? payload : value.name || "1Helm client").trim().slice(0, 120) || "1Helm client";
    const id = `key_user_${randomBytes(8).toString("hex")}`;
    const key = `rr-${randomBytes(24).toString("hex")}`;
    run("INSERT INTO user_routing_keys (id,user_id,key,name,enabled,created) VALUES (?,?,?,?,1,?)", id, actorId, key, name, now());
    return { ok: true, key: { id, key, name, enabled: true, createdAt: now() } };
  }
  if (action === "app:preview-provider-models") {
    return previewStoredProviderModels(provider!, actorId);
  }
  if (action === "app:apply-provider-models") {
    const applied = applyStoredProviderModels(target, provider!, actorId, value);
    if (applied.ok !== false) reconcileModelPolicies(target);
    return applied;
  }
  if (action === "app:usage" && actorId) {
    const requestedPeriod = typeof payload === "string" ? payload : String(value.period || "24h");
    const periods: Record<string, number | null> = { "1h": 60 * 60_000, "24h": 24 * 60 * 60_000, "7d": 7 * 24 * 60 * 60_000, "30d": 30 * 24 * 60 * 60_000, all: null };
    const period = Object.hasOwn(periods, requestedPeriod) ? requestedPeriod : "24h";
    const cutoff = periods[period] == null ? null : now() - Number(periods[period]);
    const rows = cutoff == null
      ? q("SELECT provider_id,model,status,prompt_tokens,completion_tokens,cached_tokens,detail,created FROM routing_usage_events WHERE user_id=? ORDER BY id DESC", actorId)
      : q("SELECT provider_id,model,status,prompt_tokens,completion_tokens,cached_tokens,detail,created FROM routing_usage_events WHERE user_id=? AND created>=? ORDER BY id DESC", actorId, cutoff);
    const providerMeta = new Map(configBefore.providers.filter((entry) => visibleToUser(entry, actorId)).map((entry) => [entry.id, entry]));
    const rowDetail = (entry: Record<string, unknown>): Record<string, unknown> => {
      try { return JSON.parse(String(entry.detail || "{}")); } catch { return {}; }
    };
    const providerIdentity = (entry: Record<string, unknown>): Record<string, unknown> => {
      const detail = rowDetail(entry);
      const current = providerMeta.get(String(entry.provider_id || ""));
      const providerType = String(detail.providerType || current?.type || "").replace(/^codex$/, "chatgpt");
      const accountAlias = String(detail.accountAlias || current?.accountAlias || "").trim() || null;
      const storedName = String(detail.providerName || "").trim();
      const humanStoredName = !storedName || /^account$/i.test(storedName) || /^prov_/i.test(storedName) ? "" : storedName;
      const currentName = String(current?.name || "").trim();
      const humanCurrentName = !currentName || /^account$/i.test(currentName) || /^prov_/i.test(currentName) ? "" : currentName;
      const providerName = String(current?.email || current?.profileName || accountAlias || humanCurrentName || humanStoredName || providerType || "Disconnected account").trim();
      return { provider: accountAlias && providerName !== accountAlias ? `${providerName} · ${accountAlias}` : providerName, providerName, providerType, accountAlias };
    };
    const recent = rows.map((entry) => {
      const detail = rowDetail(entry);
      return { ...detail, ...providerIdentity(entry), providerId: String(entry.provider_id), model: String(entry.model), status: Number(entry.status), prompt_tokens: Number(entry.prompt_tokens), completion_tokens: Number(entry.completion_tokens), cached_tokens: Number(entry.cached_tokens), at: Number(entry.created) };
    }).slice(0, 30);
    const prompt = rows.reduce((sum, entry) => sum + Number(entry.prompt_tokens || 0), 0);
    const completion = rows.reduce((sum, entry) => sum + Number(entry.completion_tokens || 0), 0);
    const cached = rows.reduce((sum, entry) => sum + Number(entry.cached_tokens || 0), 0);
    const aggregate = (key: "model" | "provider_id") => {
      const grouped = new Map<string, { requests: number; prompt_tokens: number; completion_tokens: number; cached_tokens: number; total_tokens: number }>();
      for (const row of rows) {
        const id = String(row[key] || "unknown");
        const current = grouped.get(id) || { requests: 0, prompt_tokens: 0, completion_tokens: 0, cached_tokens: 0, total_tokens: 0 };
        current.requests += 1;
        current.prompt_tokens += Number(row.prompt_tokens || 0);
        current.completion_tokens += Number(row.completion_tokens || 0);
        current.cached_tokens += Number(row.cached_tokens || 0);
        current.total_tokens = current.prompt_tokens + current.completion_tokens;
        grouped.set(id, current);
      }
      return [...grouped].map(([id, totals]) => {
        if (key === "model") return { model: id, ...totals };
        const newest = rows.find((row) => String(row.provider_id || "unknown") === id) || {};
        return { providerId: id, ...providerIdentity(newest), ...totals };
      });
    };
    return { ok: true, usage: { period, requests: rows.length, ok: rows.filter((entry) => Number(entry.status) >= 200 && Number(entry.status) < 400).length, errors: rows.filter((entry) => Number(entry.status) >= 400).length, prompt_tokens: prompt, completion_tokens: completion, cached_tokens: cached, total_tokens: prompt + completion, byModel: aggregate("model"), byProvider: aggregate("provider_id"), recent } };
  }
  if (action === "app:revoke-api-key" || action === "app:set-api-key-enabled") {
    if (!gatewayKey) return { ok: false, error: "Endpoint key not found." };
    if (Number(gatewayKey.user_id) !== actorId) return { ok: false, error: "You can change only your own endpoint keys." };
    if (action === "app:revoke-api-key") run("DELETE FROM user_routing_keys WHERE id=?", keyId);
    else run("UPDATE user_routing_keys SET enabled=? WHERE id=?", value.enabled === false ? 0 : 1, keyId);
    return { ok: true };
  }
  let result: Record<string, unknown>;
  if (action === "app:oauth-start") {
    const type = oauthType(payload);
    const providerId = typeof payload === "object" && payload ? String((payload as { providerId?: unknown }).providerId || "") : "";
    if (!actorId) return { ok: false, error: "A signed-in user is required." };
    if (providerId && (!provider || !ownedByUser(provider, actorId))) return { ok: false, error: "You can reconnect only your own provider accounts." };
    const key = oauthKey(actorId, type);
    const family = oauthFamily(type);
    const active = activeOauthByFamily.get(family);
    if (active && active !== key) return { ok: false, error: "Another workspace member is already connecting this provider. Try again when that sign-in finishes." };
    releaseOauthSession(key);
    oauthCompletions.delete(key);
    activeOauthByFamily.set(family, key);
    oauthOwners.set(key, { userId: actorId, type, providerIds: providerIdsBefore });
    result = await target.controlPlane.invoke(action, [type], { harness: true });
    if (result.ok !== false) {
      watchOauth(target, actorId, type, providerId || undefined);
    } else releaseOauthSession(key);
  } else if (action === "app:oauth-status") {
    const type = oauthType(payload);
    const key = oauthKey(actorId, type);
    const completion = oauthCompletions.get(key);
    if (completion) return completion;
    if (activeOauthByFamily.get(oauthFamily(type)) !== key || !oauthOwners.has(key)) return { active: false };
    result = await target.controlPlane.invoke(action, [type], { harness: true });
    if (oauthFinalizing.has(key)) result = { ...result, completing: true };
  } else if (action === "app:oauth-cancel") {
    const type = oauthType(payload);
    const key = oauthKey(actorId, type);
    if (activeOauthByFamily.get(oauthFamily(type)) !== key || !oauthOwners.has(key)) return { ok: true };
    releaseOauthSession(key);
    oauthCompletions.delete(key);
    result = await target.controlPlane.invoke(action, [type], { harness: true });
  } else if (action === "app:oauth-complete") {
    result = await finishOauth(target, (payload || {}) as Record<string, unknown>, actorId);
  } else if (action === "app:test-keyed-provider" && String(value.providerType || "") === "openrouter") {
    result = await previewOpenRouterConnection(value);
  } else if (action === "app:test-keyed-provider" && unauthenticatedCustomPayload(payload)) {
    result = await testUnauthenticatedCustom(unauthenticatedCustomPayload(payload)!);
  } else if (action === "app:add-keyed-provider" && unauthenticatedCustomPayload(payload)) {
    result = addUnauthenticatedCustom(target, unauthenticatedCustomPayload(payload)!);
  } else if (action === "app:set-bind-host") {
    const desiredHost = payload === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
    result = await target.controlPlane.invoke(action, [desiredHost], { harness: true });
    if (result.ok === false && /EADDRINUSE/i.test(String(result.error || ""))) {
      const current = target.store.load();
      const port = await choosePort(Number(current.port || 4949) + 1, desiredHost);
      target.store.update((config) => { config.bindHost = desiredHost; config.port = port; });
      result = await target.controlPlane.invoke("app:set-bind-host", [desiredHost], { harness: true });
    }
    const listening = target.gateway.getListeningAddress?.();
    if (result.ok !== false && listening) result = { ...result, bindHost: desiredHost, port: listening.port, serverListening: true };
  } else {
    const args = payload === undefined ? [] : [payload];
    result = await target.controlPlane.invoke(action, args, { harness: true });
  }
  if (result.ok !== false) {
    if (["app:add-keyed-provider", "app:oauth-complete"].includes(action) && actorId) {
      const before = action === "app:oauth-complete" ? oauthOwners.get(oauthKey(actorId, oauthType(payload)))?.providerIds || providerIdsBefore : providerIdsBefore;
      stampNewProviders(target, before, actorId, value.visibility === "workspace" ? "workspace" : "personal");
      if (action === "app:oauth-complete") releaseOauthSession(oauthKey(actorId, oauthType(payload)));
    }
    if (action === "app:save-combo" && actorId) {
      target.store.update((config) => {
        for (const entry of config.combos || []) if (!comboIdsBefore.has(entry.id) || entry.id === String(value.id || "")) {
          entry.ownerUserId = actorId;
          entry.visibility = value.visibility === "workspace" ? "workspace" : "personal";
        }
      });
    }
  }
  // Key and bind changes can alter the endpoint used by 1Helm agents.
  ensureInternalProvider(target);
  if (/provider|model|combo|oauth/i.test(action)) reconcileModelPolicies(target);
  return publicControlPlaneResult(result);
}

export async function routingState(userId = 0, isAdmin = true): Promise<Record<string, unknown>> {
  const state = await routingInvoke("app:get-state", undefined, userId, isAdmin);
  const target = await startRoutingEngine(onActivity || undefined);
  const scoped = userId ? scopedConfig(target.store.load(), userId) : target.store.load();
  // Credential values are needed only on the dedicated Endpoint screen. Keep
  // routine polling and the rest of the provider UI free of copyable secrets.
  let imageIds: string[] = [];
  try {
    const { imageGenerationEnabledIds } = await import("./skills.ts");
    imageIds = imageGenerationEnabledIds();
  } catch { imageIds = []; }
  const enabled = imageIds.length > 0;
  const visibleProviderIds = new Set(scoped.providers.map((provider) => provider.id));
  const providerMeta = new Map(scoped.providers.map((provider) => [provider.id, provider]));
  const providers = Array.isArray((state as { providers?: unknown[] }).providers)
    ? ((state as { providers: Array<Record<string, unknown>> }).providers).filter((provider) => visibleProviderIds.has(String(provider.id))).map((provider) => ({
      ...provider,
      visibility: visibilityOf(providerMeta.get(String(provider.id)) || provider as RoutingProvider),
      mine: Number(providerMeta.get(String(provider.id))?.ownerUserId || 0) === userId,
      imageGenerationEnabled: enabled && ["chatgpt", "codex"].includes(String(provider.type || "")),
    }))
    : (state as { providers?: unknown }).providers;
  const combos = scoped.combos.map((combo) => ({
    ...combo,
    visibility: visibilityOf(combo),
    mine: Number(combo.ownerUserId || 0) === userId,
  }));
  const personalActivity = userId ? recentUserActivity.get(userId) || [] : recentActivity;
  const activeRequests = userId ? userGateways.get(userId)?.requestActivity.snapshot() || [] : runtime?.requestActivity.snapshot() || [];
  return { ...state, providers, combos, activeRequests, recentActivity: personalActivity, imageGenerationEnabled: enabled, apiKey: state.apiKey ? "" : state.apiKey, apiKeys: undefined, scope: isAdmin ? "captain" : "member" };
}

export async function routingCredentials(userId = 0, isAdmin = true): Promise<Record<string, unknown>> {
  const state = await routingInvoke("app:get-state", undefined, userId, isAdmin);
  const target = await startRoutingEngine(onActivity || undefined);
  const apiKeys = q("SELECT id,key,name,enabled,created FROM user_routing_keys WHERE user_id=? ORDER BY created", userId).map((entry) => ({ id: String(entry.id), key: String(entry.key), name: String(entry.name), enabled: Boolean(entry.enabled), createdAt: Number(entry.created) }));
  const personal = userId ? await ensureUserGateway(userId) : null;
  return {
    endpoint: "/v1",
    directEndpoint: personal ? `http://127.0.0.1:${personal.port}/v1` : state.endpoint,
    personalPort: personal?.port || null,
    bindHost: state.bindHost,
    port: state.port,
    serverListening: state.serverListening,
    apiKey: apiKeys.find((entry) => entry.enabled !== false)?.key || "",
    apiKeys,
  };
}

export async function routingModels(userId = 0): Promise<RoutingModel[]> {
  const target = await startRoutingEngine(onActivity || undefined);
  const config = target.store.load();
  const scoped = userId ? scopedConfig(config, userId) : config;
  const scopedStore = { load: () => scoped, save: () => undefined, update: () => undefined };
  const scopedRouter = userId ? createRouter({ store: scopedStore }) : target.router;
  const providers = new Map(scoped.providers.map((provider) => [provider.id, provider]));
  const models = (scopedRouter.listModels().data || []).map((model): RoutingModel => {
    const id = String(model.id || "").trim();
    const provider = model.providerId ? providers.get(model.providerId) : null;
    const family = String(model.owned_by || provider?.type || "");
    return {
      id,
      name: String(model.name || id),
      kind: model.combo ? "route" : "model",
      providerType: model.combo ? undefined : family,
      providerName: model.combo ? undefined : String(provider?.name || family || "Provider"),
      accountCount: model.combo
        ? scoped.combos.find((combo) => combo.name === id || combo.id === id)?.members.length || 0
        : Array.isArray(model.accountAliases) ? model.accountAliases.length : undefined,
    };
  }).filter((model) => model.id);
  return models.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "route" ? -1 : 1));
}

export async function internalRoutingProviderId(): Promise<number> {
  const target = await startRoutingEngine(onActivity || undefined);
  return ensureInternalProvider(target);
}

export function routingEndpoint(): { base_url: string; api_key: string } | null {
  if (!runtime) return null;
  const config = runtime.store.load();
  const listening = runtime.gateway.getListeningAddress?.();
  const port = listening?.port || Number(config.port || 4949);
  const key = ensureInternalGatewayKey(runtime);
  return key ? { base_url: `http://127.0.0.1:${port}/v1`, api_key: key } : null;
}

/** Internal agent calls inherit the initiating human's provider visibility.
 * The per-user loopback listener is an identity boundary, not a browser
 * download or a publicly exposed unauthenticated port. */
export async function routingEndpointForUser(userId: number): Promise<{ base_url: string; api_key: string }> {
  const endpoint = userEndpointRow(userId);
  const gateway = await ensureUserGateway(userId);
  return { base_url: `http://127.0.0.1:${gateway.port}/v1`, api_key: endpoint.internal_key };
}

export function isInternalRoutingProvider(providerId: number | null): boolean {
  if (!providerId) return false;
  return String(q1("SELECT kind FROM providers WHERE id=?", providerId)?.kind || "") === INTERNAL_PROVIDER_KIND;
}

/** Stream the ReRouted gateway response through 1Helm's own origin. */
export async function proxyRoutingRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const target = await startRoutingEngine(onActivity || undefined);
  const config = target.store.load();
  const authorization = String(req.headers.authorization || "");
  const suppliedKey = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || String(req.headers["x-api-key"] || "");
  const matchedKey = q1("SELECT user_id FROM user_routing_keys WHERE enabled=1 AND key=?", suppliedKey);
  const ownerUserId = Number(matchedKey?.user_id || 0);
  const personal = ownerUserId ? await ensureUserGateway(ownerUserId) : null;
  const listening = personal?.gateway.getListeningAddress() || target.gateway.getListeningAddress?.();
  const port = listening?.port || Number(config.port || 4949);
  await new Promise<void>((resolve, reject) => {
    const upstream = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${port}` },
    }, (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers };
      delete headers["content-security-policy"];
      res.writeHead(upstreamResponse.statusCode || 502, headers);
      upstreamResponse.pipe(res);
      upstreamResponse.on("end", resolve);
    });
    upstream.on("error", reject);
    req.pipe(upstream);
  });
}

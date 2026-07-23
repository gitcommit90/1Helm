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
  [key: string]: unknown;
};

type RoutingCombo = {
  id: string;
  name: string;
  strategy: "fallback" | "round-robin";
  members: Array<Record<string, unknown>>;
  createdAt?: number;
};

type RoutingConfig = {
  onboardingComplete: boolean;
  onboardingStep: string;
  adminPasswordHash: string | null;
  port: number;
  bindHost: string;
  serverEnabled: boolean;
  apiKey: string;
  apiKeys: Array<{ id: string; key: string; name: string; enabled: boolean; createdAt: number; internal?: boolean; scope?: string }>;
  providers: RoutingProvider[];
  combos: RoutingCombo[];
  [key: string]: unknown;
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
let onActivity: ((activity?: unknown) => void) | null = null;
const recentActivity: unknown[] = [];
type OauthCompletion = { connected: boolean; account?: Record<string, unknown>; error?: string };
const oauthWatchers = new Map<string, NodeJS.Timeout>();
const oauthCompletions = new Map<string, OauthCompletion>();
const oauthFinalizing = new Map<string, Promise<Record<string, unknown>>>();

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
export async function generateRoutingChatGPTImage(prompt: string, signal?: AbortSignal): Promise<Buffer> {
  const target = await startRoutingEngine(onActivity || undefined);
  return generateRoutingChatGPTImageWith(target.store, providerFabricChatGPT, prompt, signal);
}

function oauthType(payload: unknown): string {
  return typeof payload === "string" ? payload : String((payload as { type?: unknown } | null)?.type || "");
}

function stopOauthWatcher(type: string): void {
  const timer = oauthWatchers.get(type);
  if (timer) clearInterval(timer);
  oauthWatchers.delete(type);
}

async function finishOauth(target: RoutingRuntime, payload: Record<string, unknown>, automatic = false): Promise<Record<string, unknown>> {
  const type = oauthType(payload);
  const completed = oauthCompletions.get(type);
  if (completed?.connected) return { ok: true, account: completed.account, connected: true };
  const existing = oauthFinalizing.get(type);
  if (existing) return existing;
  const pending = (async () => {
    const result = publicControlPlaneResult(await target.controlPlane.invoke("app:oauth-complete", [payload], { harness: true }));
    if (result.ok !== false) {
      stopOauthWatcher(type);
      oauthCompletions.set(type, { connected: true, account: result.account as Record<string, unknown> | undefined });
      ensureInternalProvider(target);
      onActivity?.();
    } else if (automatic) {
      stopOauthWatcher(type);
      oauthCompletions.set(type, { connected: false, error: String(result.error || "Connection failed.") });
    }
    return result;
  })().finally(() => { oauthFinalizing.delete(type); });
  oauthFinalizing.set(type, pending);
  return pending;
}

function watchOauth(target: RoutingRuntime, type: string, providerId?: string): void {
  stopOauthWatcher(type);
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (oauthFinalizing.has(type)) return;
    void target.controlPlane.invoke("app:oauth-status", [type], { harness: true }).then((status) => {
      if (status.hasCode) return finishOauth(target, { type, providerId, pasteCode: "" }, true);
      if (!status.active || Date.now() - startedAt > 20 * 60_000) stopOauthWatcher(type);
    }).catch(() => undefined);
  }, 750);
  timer.unref();
  oauthWatchers.set(type, timer);
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

async function choosePort(preferred: number, host: string): Promise<number> {
  const requested = Number(process.env.HELM_ROUTER_PORT || preferred || 4949);
  const candidates = process.env.HELM_ROUTER_PORT ? [requested] : [...Array(20)].map((_, index) => requested + index);
  const available = (port: number): Promise<boolean> => new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
  for (const candidate of candidates) if (await available(candidate)) return candidate;
  if (process.env.HELM_ROUTER_PORT) throw new Error(`Router port ${requested} is unavailable.`);
  return new Promise((resolve, reject) => {
    const fallback = createNetServer(); fallback.once("error", reject);
    fallback.listen(0, host, () => { const address = fallback.address(); const port = typeof address === "object" && address ? address.port : 0; fallback.close(() => resolve(port)); });
  });
}

export async function startRoutingEngine(activityCallback?: (activity?: unknown) => void): Promise<RoutingRuntime> {
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
    ensureInternalGatewayKey(target);
    const config = target.store.load();
    const host = String(config.bindHost || "127.0.0.1");
    const port = await choosePort(Number(config.port || 4949), host);
    if (port !== Number(config.port || 4949)) target.store.update((current) => { current.port = port; });
    await target.start({ port, host });
    ensureInternalProvider(target);
    activityUnsubscribe = target.requestActivity.subscribe((activity) => {
      recentActivity.unshift(activity);
      if (recentActivity.length > 30) recentActivity.length = 30;
      onActivity?.(activity);
    });
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
  if (target) await target.close({ drainMs: 10_000 });
}

export function routingReady(): boolean {
  return !!runtime;
}

export async function routingInvoke(action: string, payload?: unknown): Promise<Record<string, unknown>> {
  const target = await startRoutingEngine(onActivity || undefined);
  if (
    ["app:revoke-api-key", "app:set-api-key-enabled"].includes(action)
    && (typeof payload === "string" ? payload : String((payload as { id?: unknown } | null)?.id || "")) === INTERNAL_GATEWAY_KEY_ID
  ) {
    return { ok: false, error: "The private workspace credential cannot be changed." };
  }
  let result: Record<string, unknown>;
  if (action === "app:oauth-start") {
    const type = oauthType(payload);
    const providerId = typeof payload === "object" && payload ? String((payload as { providerId?: unknown }).providerId || "") : "";
    stopOauthWatcher(type);
    oauthCompletions.delete(type);
    result = await target.controlPlane.invoke(action, [type], { harness: true });
    if (result.ok !== false) watchOauth(target, type, providerId || undefined);
  } else if (action === "app:oauth-status") {
    const type = oauthType(payload);
    const completion = oauthCompletions.get(type);
    if (completion) return completion;
    result = await target.controlPlane.invoke(action, [type], { harness: true });
    if (oauthFinalizing.has(type)) result = { ...result, completing: true };
  } else if (action === "app:oauth-cancel") {
    const type = oauthType(payload);
    stopOauthWatcher(type);
    oauthCompletions.delete(type);
    result = await target.controlPlane.invoke(action, [type], { harness: true });
  } else if (action === "app:oauth-complete") {
    result = await finishOauth(target, (payload || {}) as Record<string, unknown>);
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
  // Key and bind changes can alter the endpoint used by 1Helm agents.
  ensureInternalProvider(target);
  if (/provider|model|combo|oauth/i.test(action)) reconcileModelPolicies(target);
  return publicControlPlaneResult(result);
}

export async function routingState(): Promise<Record<string, unknown>> {
  const state = await routingInvoke("app:get-state");
  // Credential values are needed only on the dedicated Endpoint screen. Keep
  // routine polling and the rest of the provider UI free of copyable secrets.
  let imageIds: string[] = [];
  try {
    const { imageGenerationEnabledIds } = await import("./skills.ts");
    imageIds = imageGenerationEnabledIds();
  } catch { imageIds = []; }
  const enabled = imageIds.length > 0;
  const providers = Array.isArray((state as { providers?: unknown[] }).providers)
    ? ((state as { providers: Array<Record<string, unknown>> }).providers).map((provider) => ({
      ...provider,
      imageGenerationEnabled: enabled && ["chatgpt", "codex"].includes(String(provider.type || "")),
    }))
    : (state as { providers?: unknown }).providers;
  return { ...state, providers, activeRequests: runtime?.requestActivity.snapshot() || [], recentActivity, imageGenerationEnabled: enabled, apiKey: state.apiKey ? "" : state.apiKey, apiKeys: undefined };
}

export async function routingCredentials(): Promise<Record<string, unknown>> {
  const state = await routingInvoke("app:get-state");
  const target = await startRoutingEngine(onActivity || undefined);
  const apiKeys = externalGatewayKeys(target.store.load()).map(({ id, key, name, enabled, createdAt }) => ({ id, key, name, enabled, createdAt }));
  return {
    endpoint: state.endpoint,
    bindHost: state.bindHost,
    port: state.port,
    serverListening: state.serverListening,
    apiKey: apiKeys.find((entry) => entry.enabled !== false)?.key || "",
    apiKeys,
  };
}

export async function routingModels(): Promise<RoutingModel[]> {
  const target = await startRoutingEngine(onActivity || undefined);
  const config = target.store.load();
  const providers = new Map(config.providers.map((provider) => [provider.id, provider]));
  const models = (target.router.listModels().data || []).map((model): RoutingModel => {
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
        ? config.combos.find((combo) => combo.name === id || combo.id === id)?.members.length || 0
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

export function isInternalRoutingProvider(providerId: number | null): boolean {
  if (!providerId) return false;
  return String(q1("SELECT kind FROM providers WHERE id=?", providerId)?.kind || "") === INTERNAL_PROVIDER_KIND;
}

/** Stream the ReRouted gateway response through 1Helm's own origin. */
export async function proxyRoutingRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const target = await startRoutingEngine(onActivity || undefined);
  const config = target.store.load();
  const listening = target.gateway.getListeningAddress?.();
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

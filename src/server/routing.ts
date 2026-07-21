import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { DATA_DIR, q, q1, run, now } from "./db.ts";

const require = createRequire(import.meta.url);
const { createHeadlessRuntime } = require("@gitcommit90/rerouted/src/lib/headless-runtime.js") as {
  createHeadlessRuntime: (options: Record<string, unknown>) => RoutingRuntime;
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
let onActivity: (() => void) | null = null;

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
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EADDRINUSE" || process.env.HELM_ROUTER_PORT) { reject(error); return; }
      const fallback = createNetServer();
      fallback.once("error", reject);
      fallback.listen(0, host, () => {
        const address = fallback.address();
        const port = typeof address === "object" && address ? address.port : 0;
        fallback.close(() => resolve(port));
      });
    });
    probe.listen(requested, host, () => probe.close(() => resolve(requested)));
  });
}

export async function startRoutingEngine(activityCallback?: () => void): Promise<RoutingRuntime> {
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
    activityUnsubscribe = target.requestActivity.subscribe(() => onActivity?.());
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
  const args = payload === undefined ? [] : [payload];
  const result = await target.controlPlane.invoke(action, args, { harness: true });
  // Key and bind changes can alter the endpoint used by 1Helm agents.
  ensureInternalProvider(target);
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
  const enabled = new Set(imageIds);
  const providers = Array.isArray((state as { providers?: unknown[] }).providers)
    ? ((state as { providers: Array<Record<string, unknown>> }).providers).map((provider) => ({
      ...provider,
      imageGenerationEnabled: enabled.has(String(provider.id || "")),
    }))
    : (state as { providers?: unknown }).providers;
  return { ...state, providers, apiKey: state.apiKey ? "" : state.apiKey, apiKeys: undefined };
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

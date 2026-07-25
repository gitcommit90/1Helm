import {
  api,
  routingAction,
  type RoutingCombo,
  type RoutingComboMember,
  type RoutingProvider,
  type RoutingQuotaAccount,
  type RoutingState,
  type RoutingUsage,
} from "./api.ts";
import { add, clear, h, icon, providerMark, timeLabel } from "./dom.ts";

type RoutingView = "sources" | "routes" | "activity" | "quota" | "logs" | "endpoint";
type Dialog = (message: string) => Promise<boolean>;

const providerCopy: Record<string, string> = {
  chatgpt: "ChatGPT subscription accounts",
  claude: "Claude subscription accounts",
  antigravity: "Google Antigravity and Gemini models",
  xai: "xAI subscription accounts",
  openrouter: "OpenRouter API keys and catalog",
  nvidia: "NVIDIA NIM inference models",
  cloudflare: "Cloudflare Workers AI",
  glm: "GLM Coding API",
  custom: "Any compatible OpenAI-style endpoint",
};

const fmt = (value: unknown): string => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
const publicEndpoint = (): string => `${location.origin}/v1`;
const providerFamily = (provider: RoutingProvider): string => provider.type === "codex" ? "chatgpt" : provider.type;
const isCustom = (provider: RoutingProvider): boolean => ["custom", "openai-compat"].includes(provider.type);
const routeMember = (provider: RoutingProvider, model: string): RoutingComboMember => isCustom(provider)
  ? { providerId: provider.id, model }
  : { providerType: providerFamily(provider), model };
type DiscoveredModel = { id: string; name?: string; free?: boolean };
type RoutingActivity = { type?: string; request?: Record<string, unknown>; active?: unknown[] };

let liveRoutingActivity: unknown = null;
const routingActivityListeners = new Set<(activity: unknown) => void>();
let closeRoutingPopover: (() => void) | null = null;
export function pushRoutingActivity(activity: unknown): void {
  liveRoutingActivity = activity;
  for (const listener of routingActivityListeners) listener(activity);
}

function applyRoutingActivity(state: RoutingState, activity: unknown): void {
  const event = activity && typeof activity === "object" ? activity as RoutingActivity : {};
  state.recentActivity = [activity, ...(state.recentActivity || []).filter((item) => item !== activity)].slice(0, 30);
  if (Array.isArray(event.active)) state.activeRequests = event.active;
}

function latestRequests(state: RoutingState, limit = 10): Record<string, unknown>[] {
  const events = Array.isArray(state.recentActivity) ? state.recentActivity as RoutingActivity[] : [];
  const requests = [
    ...events.map((event) => event?.request).filter((request): request is Record<string, unknown> => !!request && typeof request === "object"),
    ...(Array.isArray(state.activeRequests) ? state.activeRequests.filter((request): request is Record<string, unknown> => !!request && typeof request === "object") : []),
  ];
  const seen = new Set<string>();
  return requests.filter((request) => {
    const key = String(request.id || `${request.startedAt || ""}:${request.model || ""}`);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, limit);
}

async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const input = h("textarea", { value: text, class: "fixed -left-[9999px]" }) as HTMLTextAreaElement;
    document.body.append(input); input.select(); document.execCommand("copy"); input.remove();
  }
}

function statusLine(): HTMLParagraphElement {
  return h("p", { class: "min-h-5 text-xs leading-5 text-muted" });
}

function heading(eyebrow: string, title: string, copy: string, action?: HTMLElement | null): HTMLElement {
  return h("header", { class: "routing-heading" },
    h("div", { class: "min-w-0" }, h("div", { class: "eyebrow text-accent" }, eyebrow), h("h2", { class: "font-display mt-1 text-3xl text-fg" }, title), h("p", { class: "mt-1 max-w-2xl text-sm leading-6 text-muted" }, copy)),
    action || null);
}

function empty(title: string, copy: string): HTMLElement {
  return h("div", { class: "routing-empty" }, h("div", { class: "font-display text-xl text-fg" }, title), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, copy));
}

function accountName(account: RoutingProvider): string {
  return account.email || account.profileName || account.name || account.accountAlias || account.type;
}

async function openModelRefresh(account: RoutingProvider, refresh: () => Promise<void>): Promise<void> {
  const modal = h("div", { class: "modal-overlay fixed inset-0 z-[70] grid place-items-end bg-black/60 sm:place-items-center sm:p-6" });
  const body = h("div", { class: "space-y-3" }, h("p", { class: "py-6 text-center text-sm text-muted" }, "Asking the provider for its current model catalog…"));
  const status = statusLine();
  const close = (): void => modal.remove();
  modal.onclick = (event: MouseEvent) => { if (event.target === modal) close(); };
  const panel = h("section", { class: "card mobile-sheet flex max-h-[85vh] w-full max-w-2xl flex-col rounded-b-none p-5 sm:rounded-xl sm:p-6", dataset: { modelRefresh: account.id } },
    h("div", { class: "mb-4 flex items-start justify-between gap-4" },
      h("div", {}, h("div", { class: "eyebrow text-accent" }, "Preview only"), h("h2", { class: "font-display mt-1 text-2xl text-fg" }, `Refresh ${accountName(account)} models`), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Choose what this account should offer. Nothing changes until you confirm.")),
      h("button", { class: "btn-ghost", onclick: close }, icon("x"))),
    body, status);
  modal.append(panel); document.body.append(modal);
  const result: { ok: boolean; previewToken?: string; models?: DiscoveredModel[]; error?: string } = await routingAction<{ ok: boolean; previewToken?: string; models?: DiscoveredModel[]; error?: string }>("app:preview-provider-models", { providerId: account.id }).catch((error: Error) => ({ ok: false, error: error.message }));
  if (!modal.isConnected) return;
  clear(body);
  if (!result.ok || !result.previewToken || !result.models?.length) {
    body.append(empty("Automatic discovery is unavailable", result.error || "Add an exact model ID manually from this account's expanded controls."));
    body.append(h("button", { class: "btn-subtle min-h-10 w-full text-xs", onclick: close }, "Back to manual model ID"));
    return;
  }
  const models = result.models;
  const previouslyEnabled = new Set((account.models || []).filter((model) => model.enabled !== false).map((model) => model.id));
  const selected = new Set(models.filter((model) => previouslyEnabled.has(model.id)).map((model) => model.id));
  const list = h("div", { class: "routing-telemetry-list max-h-[42vh] overflow-auto" });
  let freeOnly = false;
  const hasFreeMetadata = account.type === "openrouter" && models.some((model) => model.free !== undefined);
  const redraw = (): void => {
    clear(list);
    for (const model of models.filter((item) => !freeOnly || item.free === true)) {
      const input = h("input", { type: "checkbox", checked: selected.has(model.id), class: "accent-accent", dataset: { discoveredModel: model.id } }) as HTMLInputElement;
      input.onchange = () => { if (input.checked) selected.add(model.id); else selected.delete(model.id); };
      list.append(h("label", { class: "routing-model-row px-3" },
        h("span", { class: "min-w-0 flex-1" }, h("span", { class: "block truncate text-sm font-semibold text-fg" }, model.name || model.id), h("span", { class: "block truncate font-mono text-[10px] text-faint" }, model.id)),
        model.free === true ? h("span", { class: "chip text-[10px] text-ok" }, "Free") : null, input));
    }
    if (!list.childElementCount) list.append(h("p", { class: "p-5 text-center text-sm text-muted" }, "No free models were reported in this catalog."));
  };
  const selectVisible = (enabled: boolean): void => {
    for (const model of models.filter((item) => !freeOnly || item.free === true)) enabled ? selected.add(model.id) : selected.delete(model.id);
    redraw();
  };
  const filters = h("div", { class: "flex flex-wrap items-center gap-2" },
    h("button", { class: "btn-ghost text-xs", dataset: { discoveredAll: "on" }, onclick: () => selectVisible(true) }, "Select all"),
    h("button", { class: "btn-ghost text-xs", dataset: { discoveredAll: "off" }, onclick: () => selectVisible(false) }, "Select none"),
    hasFreeMetadata ? h("button", { class: "btn-subtle ml-auto text-xs", dataset: { freeOnly: "" }, onclick: (event: Event) => { freeOnly = !freeOnly; (event.currentTarget as HTMLElement).classList.toggle("border-accent", freeOnly); (event.currentTarget as HTMLElement).textContent = freeOnly ? "Showing free only" : "Free only"; redraw(); } }, "Free only") : account.type === "openrouter" ? h("span", { class: "ml-auto text-xs text-muted" }, "Free pricing metadata unavailable") : null);
  const confirm = h("button", { class: "btn-primary min-h-10 text-xs", dataset: { confirmModels: "" }, onclick: async () => {
    confirm.disabled = true; status.textContent = "Applying the confirmed model selection…";
    const applied = await routingAction<{ ok: boolean; error?: string }>("app:apply-provider-models", { providerId: account.id, previewToken: result.previewToken, modelIds: [...selected] }).catch((error: Error) => ({ ok: false, error: error.message }));
    if (!applied.ok) { confirm.disabled = false; status.textContent = applied.error || "The model selection could not be applied."; return; }
    close(); await refresh();
  } }, "Confirm model selection") as HTMLButtonElement;
  redraw();
  add(body, filters, list, h("p", { class: "text-xs leading-5 text-muted" }, `${models.length} models discovered. Models absent from this provider response, including manually added IDs, are preserved.`), h("div", { class: "flex justify-end gap-2" }, h("button", { class: "btn-ghost text-xs", onclick: close }, "Cancel"), confirm));
}

function accountCard(account: RoutingProvider, refresh: () => Promise<void>, confirm: Dialog, expandedAccounts: Set<string>): HTMLElement {
  const models = account.models || [];
  const enabledCount = (): number => models.filter((model) => model.enabled !== false).length;
  const details = h("div", { class: `${expandedAccounts.has(account.id) ? "" : "hidden "}border-t border-line px-4 pb-4 pt-3`, dataset: { accountDetails: "" } });
  const count = h("span", { class: "text-xs text-muted" });
  let accountMeta: HTMLSpanElement | null = null;
  const syncCount = (): void => {
    const enabled = enabledCount();
    count.textContent = `${enabled} of ${models.length} models enabled`;
    if (accountMeta) accountMeta.textContent = `${account.name}${account.accountAlias ? ` · ${account.accountAlias}` : ""} · ${enabled}/${models.length} models`;
  };
  const toggle = h("input", { type: "checkbox", checked: account.enabled !== false, class: "accent-accent" }) as HTMLInputElement;
  toggle.disabled = account.mine === false;
  toggle.onchange = async () => {
    const result = await routingAction<{ ok: boolean }>("app:set-provider-enabled", { id: account.id, enabled: toggle.checked }).catch(() => ({ ok: false }));
    if (!result.ok) toggle.checked = !toggle.checked;
    await refresh();
  };
  const modelList = h("div", { class: "space-y-1" });
  const modelToggles: Array<{ model: RoutingProvider["models"][number]; input: HTMLInputElement }> = [];
  for (const model of models) {
    const modelToggle = h("input", { type: "checkbox", checked: model.enabled !== false, class: "accent-accent", dataset: { modelToggle: model.id } }) as HTMLInputElement;
    modelToggle.disabled = account.mine === false;
    modelToggles.push({ model, input: modelToggle });
    modelToggle.onchange = async () => {
      const requested = modelToggle.checked;
      modelToggle.disabled = true;
      const result = await routingAction<{ ok: boolean }>("app:set-model-enabled", { providerId: account.id, modelId: model.id, enabled: requested }).catch(() => ({ ok: false }));
      modelToggle.disabled = false;
      if (!result.ok) { modelToggle.checked = !requested; return; }
      model.enabled = requested;
      syncCount();
    };
    modelList.append(h("label", { class: "routing-model-row" },
      h("span", { class: "min-w-0 flex-1" }, h("span", { class: "block truncate text-sm font-semibold text-fg" }, model.name || model.id), h("span", { class: "block truncate font-mono text-[10px] text-faint" }, model.gatewayId || model.id)), modelToggle));
  }
  const setAllModels = async (requested: boolean, buttons: HTMLButtonElement[]): Promise<void> => {
    buttons.forEach((button) => { button.disabled = true; });
    modelToggles.forEach(({ input }) => { input.disabled = true; });
    const result = await routingAction<{ ok: boolean }>("app:set-all-models-enabled", { providerId: account.id, enabled: requested }).catch(() => ({ ok: false }));
    buttons.forEach((button) => { button.disabled = false; });
    modelToggles.forEach(({ input }) => { input.disabled = false; });
    if (!result.ok) return;
    modelToggles.forEach(({ model, input }) => { model.enabled = requested; input.checked = requested; });
    syncCount();
  };
  const allOn = h("button", { class: "btn-ghost text-xs", dataset: { modelsAll: "on" } }, "All on") as HTMLButtonElement;
  const allOff = h("button", { class: "btn-ghost text-xs", dataset: { modelsAll: "off" } }, "All off") as HTMLButtonElement;
  allOn.disabled = account.mine === false;
  allOff.disabled = account.mine === false;
  allOn.onclick = () => { void setAllModels(true, [allOn, allOff]); };
  allOff.onclick = () => { void setAllModels(false, [allOn, allOff]); };
  const exact = h("input", { class: "field", placeholder: "Exact provider model ID" }) as HTMLInputElement;
  const addStatus = statusLine();
  const addModel = h("button", { class: "btn-subtle min-h-10 text-xs", onclick: async () => {
    const modelId = exact.value.trim(); if (!modelId) return;
    addStatus.textContent = "Testing the real model…";
    const result = await routingAction<{ ok: boolean; error?: string }>("app:add-model", { providerId: account.id, modelId }).catch((error: Error) => ({ ok: false, error: error.message }));
    addStatus.textContent = result.ok ? `${modelId} is ready.` : result.error || "The model test failed.";
    if (result.ok) await refresh();
  } }, "Test & add model");
  add(details,
    h("div", { class: "mb-3 flex flex-wrap items-center justify-between gap-2" },
      count,
      h("div", { class: "flex gap-2" }, allOn, allOff)),
    models.length ? modelList : h("p", { class: "py-4 text-sm text-muted" }, "No models are configured for this account yet."),
    account.mine === false ? null : h("div", { class: "mt-3 grid gap-2 sm:grid-cols-[1fr_auto]" }, exact, addModel), account.mine === false ? null : addStatus,
    h("div", { class: "mt-3 flex flex-wrap justify-end gap-2" },
      account.mine
        ? h("label", { class: "mr-auto flex min-h-10 items-center gap-2 text-xs text-muted" }, (() => {
          const sharing = h("input", { type: "checkbox", checked: account.visibility === "workspace", class: "accent-accent" }) as HTMLInputElement;
          sharing.onchange = async () => { await routingAction("app:set-provider-visibility", { id: account.id, visibility: sharing.checked ? "workspace" : "personal" }); await refresh(); };
          return sharing;
        })(), "Share with workspace")
        : h("span", { class: "mr-auto chip text-[10px]" }, "Shared by a teammate"),
      account.mine !== false && ["chatgpt", "claude", "antigravity", "xai", "codex"].includes(account.type)
        ? h("button", { class: "btn-subtle text-xs", onclick: () => { void openOauth(account.type === "codex" ? "chatgpt" : account.type, refresh, account.id); } }, "Reconnect") : null,
      account.mine === false ? null : h("button", { class: "btn-subtle text-xs", dataset: { refreshModels: account.id }, onclick: () => { void openModelRefresh(account, refresh); } }, "Refresh models"),
      account.mine === false ? null : h("button", { class: "btn-danger text-xs", onclick: async () => {
        if (!(await confirm(`Disconnect ${accountName(account)}? Existing routes will keep working if another account for this provider remains.`))) return;
        await routingAction("app:remove-provider", account.id); await refresh();
      } }, "Disconnect")));

  const chevron = h("span", { class: "w-5 text-center font-mono text-muted" }, expandedAccounts.has(account.id) ? "−" : "+");
  accountMeta = h("span", { class: "block truncate text-xs text-muted" }) as HTMLSpanElement;
  syncCount();
  const head = h("button", { class: "routing-account-head", type: "button", onclick: () => {
    details.classList.toggle("hidden");
    if (details.classList.contains("hidden")) expandedAccounts.delete(account.id); else expandedAccounts.add(account.id);
    chevron.textContent = details.classList.contains("hidden") ? "+" : "−";
  } },
    h("span", { class: "wizard-provider-mark h-10 w-10" }, providerMark(providerFamily(account), 18)),
    h("span", { class: "min-w-0 flex-1 text-left" }, h("span", { class: "block truncate font-semibold text-fg" }, accountName(account)), accountMeta),
    h("span", { class: `routing-live-dot ${account.enabled === false ? "is-off" : ""}` }),
    h("span", { class: "flex min-h-10 items-center px-2", onclick: (event: MouseEvent) => event.stopPropagation() }, toggle),
    chevron);
  return h("article", { class: "routing-account", dataset: { providerAccount: account.id } }, head, details);
}

async function openOauth(type: string, refresh: () => Promise<void>, providerId?: string): Promise<void> {
  const started = await routingAction<{ ok: boolean; authUrl?: string; needsPaste?: boolean; error?: string }>("app:oauth-start", { type, providerId });
  if (!started.ok || !started.authUrl) throw new Error(started.error || "Could not start sign-in.");
  let closed = false;
  const paste = h("input", { class: "field font-mono text-xs", placeholder: type === "xai" ? "Paste the code or full callback URL" : "Paste the full callback URL if the browser cannot return here" }) as HTMLInputElement;
  const status = statusLine(); status.textContent = "Waiting for the provider…";
  const finish = async (): Promise<void> => {
    status.textContent = "Finishing the secure connection…";
    const result = await routingAction<{ ok: boolean; error?: string }>("app:oauth-complete", { type, pasteCode: paste.value.trim(), providerId });
    if (!result.ok) { status.textContent = result.error || "Connection failed."; return; }
    closed = true; modal.remove(); await refresh();
  };
  const modal = h("div", { class: "modal-overlay fixed inset-0 z-[70] grid place-items-end bg-black/60 sm:place-items-center sm:p-6", onclick: (event: MouseEvent) => { if (event.target === modal) { closed = true; modal.remove(); void routingAction("app:oauth-cancel", type); } } },
    h("section", { class: "card mobile-sheet w-full max-w-lg space-y-4 rounded-b-none p-5 sm:rounded-xl sm:p-6" },
      h("div", { class: "flex items-start justify-between gap-4" }, h("div", {}, h("div", { class: "eyebrow text-accent" }, "Secure account connection"), h("h2", { class: "font-display mt-1 text-2xl text-fg" }, `Connect ${type === "antigravity" ? "Antigravity" : type === "xai" ? "xAI" : type[0].toUpperCase() + type.slice(1)}`)), h("button", { class: "btn-ghost", onclick: () => { closed = true; modal.remove(); void routingAction("app:oauth-cancel", type); } }, icon("x"))),
      h("p", { class: "text-sm leading-6 text-muted" }, "Open the provider, approve access, then return here. If its localhost callback page cannot open, copy that failed page's full address and paste it below."),
      h("a", { class: "btn-primary flex min-h-11 w-full", href: started.authUrl, target: "_blank", rel: "noopener noreferrer" }, "Open provider sign-in"),
      paste,
      h("button", { class: "btn-subtle min-h-11 w-full", onclick: () => { void finish(); } }, "Finish connection"), status));
  document.body.append(modal);
  window.open(started.authUrl, "_blank", "noopener,noreferrer");
  for (let attempt = 0; attempt < 240 && !closed; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if (closed) break;
    const state: { active?: boolean; hasCode?: boolean; connected?: boolean; error?: string } = await routingAction<{ active?: boolean; hasCode?: boolean; connected?: boolean; error?: string }>("app:oauth-status", type).catch(() => ({}));
    if (state.error) status.textContent = state.error;
    if (state.connected) { closed = true; modal.remove(); await refresh(); break; }
    if (state.hasCode) status.textContent = "Authorization received. 1Helm is finishing the connection…";
  }
}

/** Shared by first-run onboarding and the full provider control plane. */
export async function connectRoutingOauth(type: string, onConnected: () => Promise<void> = async () => undefined): Promise<void> {
  await openOauth(type, onConnected);
}


function familyLabel(family: string, state: RoutingState): string {
  const oauth = (state.oauthProviders || []).find((item) => item.id === family);
  if (oauth?.name) return oauth.name;
  const preset = (state.keyedPresets || []).find((item) => item.id === family);
  if (preset?.name) return preset.name;
  const account = (state.providers || []).find((item) => (isCustom(item) ? "custom" : providerFamily(item)) === family);
  return account?.name || family;
}

function providerFamilies(state: RoutingState): Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }> {
  const map = new Map<string, { id: string; name: string; models: Map<string, string> }>();
  for (const account of (state.providers || []).filter((item) => item.enabled !== false)) {
    const id = isCustom(account) ? `custom:${account.id}` : providerFamily(account);
    const name = isCustom(account) ? (account.name || "Custom") : familyLabel(providerFamily(account), state);
    const entry = map.get(id) || { id, name, models: new Map<string, string>() };
    for (const model of account.models || []) {
      if (model.enabled === false) continue;
      const mid = model.id;
      if (!entry.models.has(mid)) entry.models.set(mid, model.name || model.id);
    }
    map.set(id, entry);
  }
  return [...map.values()].map((entry) => ({ id: entry.id, name: entry.name, models: [...entry.models.entries()].map(([id, name]) => ({ id, name })) }));
}

function familyRouteMember(familyId: string, model: string, state: RoutingState): RoutingComboMember {
  if (familyId.startsWith("custom:")) {
    const providerId = familyId.slice("custom:".length);
    return { providerId, model };
  }
  // Multi-account agnostic: type + model lets the engine pool all accounts.
  return { providerType: familyId, model };
}

function routingFabric(state: RoutingState): HTMLElement {
  const families = [...new Set((state.providers || []).filter((p) => p.enabled !== false).map((p) => isCustom(p) ? "custom" : providerFamily(p)))].slice(0, 8);
  const nodes = families.length ? families : ["chatgpt", "claude", "openrouter"];
  if (liveRoutingActivity) applyRoutingActivity(state, liveRoutingActivity);
  const rawEvents = Array.isArray(state.recentActivity) ? state.recentActivity as Array<Record<string, unknown>> : [];
  const latest = rawEvents[0] || ((state.activeRequests || [])[0] ? { type: "routed", request: (state.activeRequests || [])[0] } : null);
  const request = latest?.request && typeof latest.request === "object" ? latest.request as Record<string, unknown> : null;
  const activeFamily = String(request?.providerType || "").replace(/^codex$/, "chatgpt");
  const inFlight = Array.isArray(state.activeRequests) ? state.activeRequests.length : 0;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 720 124"); svg.setAttribute("class", "routing-fabric-svg");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Live dotted flow from requests through the 1Helm Router to the routed provider");
  const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  };
  const path = (d: string, live: boolean): SVGPathElement => svgEl("path", { d, class: `routing-fabric-path ${live ? "is-live" : "is-idle"}` });
  svg.append(path("M 112 62 C 205 62, 226 62, 302 62", inFlight > 0));
  const providerPoints = nodes.map((id, index) => ({ id, y: nodes.length === 1 ? 62 : 14 + index * (96 / (nodes.length - 1)) }));
  for (const point of providerPoints) svg.append(path(`M 418 62 C 486 62, 500 ${point.y}, 570 ${point.y}`, inFlight > 0 && (!activeFamily || point.id === activeFamily)));
  svg.append(svgEl("rect", { x: "12", y: "38", width: "100", height: "48", rx: "14", class: "routing-fabric-node" }));
  const requestTitle = svgEl("text", { x: "62", y: "57", "text-anchor": "middle", class: "routing-fabric-hub-label" }); requestTitle.textContent = "REQUESTS"; svg.append(requestTitle);
  const requestCount = svgEl("text", { x: "62", y: "73", "text-anchor": "middle", class: "routing-fabric-hub-label" }); requestCount.textContent = inFlight ? `${inFlight} IN FLIGHT` : "READY"; svg.append(requestCount);
  svg.append(svgEl("rect", { x: "302", y: "33", width: "116", height: "58", rx: "18", class: "routing-fabric-hub" }));
  const routerTitle = svgEl("text", { x: "360", y: "57", "text-anchor": "middle", class: "routing-fabric-hub-label" }); routerTitle.textContent = "1HELM ROUTER"; svg.append(routerTitle);
  const routerStatus = svgEl("text", { x: "360", y: "74", "text-anchor": "middle", class: "routing-fabric-hub-label" }); routerStatus.textContent = inFlight ? "ROUTING LIVE" : "POOL · FAIL OVER"; svg.append(routerStatus);
  for (const point of providerPoints) {
    svg.append(svgEl("circle", { cx: "586", cy: String(point.y), r: "11", class: "routing-fabric-node" }));
    const label = svgEl("text", { x: "605", y: String(point.y + 3), class: "routing-fabric-hub-label" }); label.textContent = familyLabel(point.id, state).slice(0, 16).toUpperCase(); svg.append(label);
  }
  const flow = h("div", { class: "min-w-0" }, svg,
    h("div", { class: "routing-fabric-legend" },
      h("span", { class: `routing-fabric-chip ${inFlight ? "is-live" : ""}` }, `${inFlight || 0} active`),
      ...nodes.map((id) => h("span", { class: `routing-fabric-chip ${activeFamily === id ? "border-accent text-accent is-live" : ""}` }, providerMark(id, 14), familyLabel(id, state)))));
  const status = !request
    ? h("p", { class: "mt-2 text-center text-xs text-muted" }, "Waiting for the next routed request…")
    : h("div", { class: "mt-2 grid gap-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs sm:grid-cols-[1fr_auto]" },
      h("div", { class: "min-w-0" }, h("span", { class: "font-semibold text-fg" }, String(request.model || "Request")), h("span", { class: "ml-2 text-muted" }, request.providerName ? `→ ${String(request.providerName)}` : latest?.type === "started" ? "choosing a destination…" : "routing…")),
      h("span", { class: `font-mono ${latest?.type === "finished" && Number(request.status || 200) >= 400 ? "text-danger" : "text-accent"}` }, latest?.type === "finished" ? `${String(request.outcome || "finished")} · ${Math.max(0, Number(request.finishedAt || Date.now()) - Number(request.startedAt || Date.now()))}ms` : String(latest?.type || "active")));
  return h("div", { class: "routing-fabric", title: "Live requests routed by this workspace" }, flow, status);
}

/** Compact, credential-free live router surface for the channel header. */
export async function openRoutingPopover(eventOrAnchor: Event | Element): Promise<void> {
  const event = eventOrAnchor instanceof Event ? eventOrAnchor : null;
  event?.preventDefault(); event?.stopPropagation();
  const anchor: Element | null = event
    ? (event.currentTarget instanceof Element ? event.currentTarget : event.target instanceof Element ? event.target : null)
    : eventOrAnchor instanceof Element ? eventOrAnchor : null;
  closeRoutingPopover?.();
  const state = await api<RoutingState>("/api/routing/state");
  const rect = anchor?.getBoundingClientRect();
  const width = Math.min(420, Math.max(300, window.innerWidth - 24));
  const left = rect ? Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width)) : window.innerWidth - width - 12;
  const top = rect ? Math.min(window.innerHeight - 180, rect.bottom + 8) : 48;
  const popover = h("aside", { class: "card fixed z-[80] max-h-[min(80vh,44rem)] overflow-auto p-3 shadow-xl", style: `width:${width}px;left:${left}px;top:${Math.max(8, top)}px`, dataset: { routingPopover: "" }, role: "dialog", "aria-label": "Live 1Helm Router activity" });
  const content = h("div");
  let listener: ((activity: unknown) => void) | null = null;
  const close = (): void => {
    if (listener) routingActivityListeners.delete(listener);
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", keydown, true);
    popover.remove();
    if (closeRoutingPopover === close) closeRoutingPopover = null;
  };
  const outside = (outsideEvent: Event): void => { if (!popover.contains(outsideEvent.target as Node) && !anchor?.contains(outsideEvent.target as Node)) close(); };
  const keydown = (keyEvent: KeyboardEvent): void => { if (keyEvent.key === "Escape") close(); };
  const draw = (): void => {
    clear(content);
    const requests = latestRequests(state, 10);
    const list = h("div", { class: "routing-telemetry-list", dataset: { routingLatest: "10" } });
    for (const request of requests) {
      const status = Number(request.status || 0);
      const finished = Number(request.finishedAt || 0);
      const at = finished || Number(request.routedAt || request.startedAt || 0);
      list.append(h("div", { class: "routing-event" },
        h("span", { class: `routing-event-dot ${status >= 400 ? "is-error" : ""}` }),
        h("span", { class: "min-w-0 flex-1" }, h("span", { class: "block truncate text-xs font-semibold text-fg" }, String(request.model || "Request")), h("span", { class: "block truncate text-[10px] text-muted" }, String(request.providerName || request.providerType || (finished ? request.outcome || "Completed" : "Choosing provider…")))),
        h("time", { class: "font-mono text-[10px] text-faint" }, at ? timeLabel(at) : "live")));
    }
    const endpoint = publicEndpoint();
    add(content,
      h("div", { class: "mb-2 flex items-start justify-between gap-3" }, h("div", {}, h("div", { class: "eyebrow text-accent" }, "Live model fabric"), h("h2", { class: "font-display mt-0.5 text-lg text-fg" }, "1Helm Router")), h("button", { class: "btn-ghost p-2", onclick: close }, icon("x", 14))),
      routingFabric(state),
      h("div", { class: "mb-2 flex items-center justify-between gap-2" }, h("strong", { class: "text-xs text-fg" }, "Latest 10 requests"), h("span", { class: "font-mono text-[10px] text-muted" }, `${requests.length} shown`)),
      requests.length ? list : empty("Waiting for traffic", "Real routed requests will appear here live."),
      h("div", { class: "mt-3 rounded-lg border border-line bg-raised/40 p-3" }, h("div", { class: "mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted" }, "Base URL"), h("div", { class: "flex items-center gap-2" }, h("code", { class: "min-w-0 flex-1 truncate text-xs text-fg" }, endpoint), h("button", { class: "btn-subtle shrink-0 text-xs", dataset: { copyRoutingBase: "" }, onclick: () => { void copyText(endpoint); } }, "Copy")), h("p", { class: "mt-2 text-xs leading-5 text-muted" }, "API keys for the router are stored in Settings → Providers → Endpoints.")));
  };
  popover.append(content);
  draw(); document.body.append(popover);
  closeRoutingPopover = close;
  listener = (activity) => { if (!popover.isConnected) { routingActivityListeners.delete(listener!); return; } applyRoutingActivity(state, activity); draw(); };
  routingActivityListeners.add(listener);
  setTimeout(() => { document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", keydown, true); }, 0);
}

function sourceCatalog(state: RoutingState, refresh: () => Promise<void>, confirm: Dialog, expandedAccounts: Set<string>, expandedGroups: Set<string>): HTMLElement {
  const groups = new Map<string, { id: string; name: string; kind: "oauth" | "keyed" | "custom"; accounts: RoutingProvider[]; preset?: RoutingState["keyedPresets"][number] }>();
  for (const oauth of state.oauthProviders || []) groups.set(oauth.id, { id: oauth.id, name: oauth.name, kind: "oauth", accounts: [] });
  for (const preset of state.keyedPresets || []) groups.set(preset.id, { id: preset.id, name: preset.name, kind: "keyed", accounts: [], preset });
  groups.set("custom", { id: "custom", name: "Custom endpoint", kind: "custom", accounts: [] });
  for (const account of state.providers || []) {
    const family = isCustom(account) ? "custom" : providerFamily(account);
    const group = groups.get(family) || { id: family, name: account.name || family, kind: "custom" as const, accounts: [] };
    group.accounts.push(account); groups.set(family, group);
  }
  const list = h("div", { class: "routing-provider-grid" });
  for (const group of groups.values()) {
    const accounts = h("div", { class: "mt-3 space-y-2" }, ...group.accounts.map((account) => accountCard(account, refresh, confirm, expandedAccounts)));
    const body = h("div", { class: `${expandedGroups.has(group.id) ? "" : "hidden "}border-t border-line px-4 pb-4 pt-3`, dataset: { providerGroupBody: group.id } }, accounts);
    const add = h("button", { class: "btn-subtle mt-3 min-h-10 w-full text-xs" }, group.kind === "oauth" ? "Add account" : "Add key");
    add.onclick = () => {
      if (group.kind === "oauth") { void openOauth(group.id, refresh).catch((error: Error) => { add.textContent = error.message; }); return; }
      body.prepend(keyedForm(group.id, group.name, group.preset, refresh));
    };
    body.append(add);
    const caret = h("span", { class: "w-5 font-mono text-muted" }, expandedGroups.has(group.id) ? "−" : "+");
    const open = h("button", { class: "routing-provider-head" },
      h("span", { class: "wizard-provider-mark" }, providerMark(group.id, 19)),
      h("span", { class: "min-w-0 flex-1 text-left" }, h("span", { class: "block font-semibold text-fg" }, group.name), h("span", { class: "block truncate text-xs text-muted" }, providerCopy[group.id] || "Connected model source")),
      h("span", { class: `chip ${group.accounts.length ? "border-accent/40 text-accent" : ""}` }, group.accounts.length ? `${group.accounts.length} connected` : "available"),
      caret);
    open.onclick = () => {
      body.classList.toggle("hidden");
      if (body.classList.contains("hidden")) expandedGroups.delete(group.id); else expandedGroups.add(group.id);
      caret.textContent = body.classList.contains("hidden") ? "+" : "−";
    };
    list.append(h("section", { class: "routing-provider" }, open, body));
  }
  const chatgptConnected = (state.providers || []).some((provider) => provider.enabled !== false && providerFamily(provider) === "chatgpt");
  const imageRow = h("div", { class: "mb-4 flex items-start gap-3 rounded-lg border border-line bg-raised/40 px-4 py-3" },
    h("span", { class: `mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${chatgptConnected ? "bg-ok" : "bg-faint"}` }),
    h("span", { class: "min-w-0 flex-1" }, h("span", { class: "block text-sm font-semibold text-fg" }, "Image Generation · ChatGPT family"), h("span", { class: "mt-0.5 block text-xs leading-5 text-muted" }, chatgptConnected ? "Available automatically through the connected ChatGPT account." : "Connect a ChatGPT subscription account to make this workspace capability available.")));
  return h("div", {}, heading("Provider fabric", "Requests → 1Helm → Providers", "Connect subscriptions and API keys once. Watch active work flow through 1Helm's account pool and into enabled providers."), routingFabric(state), imageRow, list);
}

function keyedForm(id: string, label: string, preset: RoutingState["keyedPresets"][number] | undefined, refresh: () => Promise<void>): HTMLElement {
  const wrap = h("div", { class: "mb-3 rounded-lg border border-accent/30 bg-accent-soft p-3", dataset: { keyedForm: id } });
  const name = h("input", { class: "field", value: label, placeholder: "Connection name", dataset: { keyedField: "name" } }) as HTMLInputElement;
  const baseUrl = h("input", { class: "field", value: preset?.baseUrl || "", placeholder: "https://provider.example/v1", readOnly: !!preset, dataset: { keyedField: "base" } }) as HTMLInputElement;
  const accountId = h("input", { class: "field", placeholder: "Cloudflare account ID", dataset: { keyedField: "account" } }) as HTMLInputElement;
  const key = h("input", { class: "field", type: "password", placeholder: id === "custom" ? "API key (optional)" : "API key", autocomplete: "off", dataset: { keyedField: "key" } }) as HTMLInputElement;
  const model = h("input", { class: "field", placeholder: "Exact model ID (optional)", dataset: { keyedField: "model" } }) as HTMLInputElement;
  const status = statusLine();
  status.dataset.keyedStatus = "";
  const payload = (): Record<string, unknown> => ({ providerType: id === "custom" ? "openai-compat" : id, baseUrl: baseUrl.value.trim().replace("{account_id}", accountId.value.trim()), apiKey: key.value.trim(), modelId: model.value.trim() });
  const testFingerprint = (): string => JSON.stringify([id, baseUrl.value.trim(), accountId.value.trim(), key.value.trim(), model.value.trim()]);
  const saveFingerprint = (): string => JSON.stringify([name.value.trim(), testFingerprint()]);
  const inputs = [name, baseUrl, accountId, key, model];
  let testedFingerprint: string | null = null;
  let testedSaveFingerprint: string | null = null;
  let testedModels: Array<{ id: string; name?: string }> | null = null;
  let freeOnly = false;
  const preview = h("div", { class: "hidden routing-telemetry-list max-h-60 overflow-auto", dataset: { keyedModelPreview: "" } });
  const freeFilter = h("button", { class: "hidden btn-ghost text-xs", dataset: { keyedFreeOnly: "" } }, "Free only") as HTMLButtonElement;
  const drawPreview = (): void => {
    clear(preview);
    const models = (testedModels || []) as DiscoveredModel[];
    for (const item of models.filter((candidate) => !freeOnly || candidate.free === true)) preview.append(h("div", { class: "routing-model-row px-3" }, h("span", { class: "min-w-0 flex-1 truncate text-xs text-fg" }, item.name || item.id), item.free === true ? h("span", { class: "chip text-[10px] text-ok" }, "Free") : null));
    preview.classList.toggle("hidden", !models.length);
  };
  freeFilter.onclick = () => { freeOnly = !freeOnly; freeFilter.textContent = freeOnly ? "Showing free only" : "Free only"; freeFilter.classList.toggle("border-accent", freeOnly); drawPreview(); };
  let testGeneration = 0;
  let testing = false;
  let adding = false;
  const invalidate = (message = "Changes need to be tested again."): void => {
    testGeneration += 1;
    testedFingerprint = null;
    testedSaveFingerprint = null;
    testedModels = null;
    freeOnly = false;
    clear(preview);
    preview.classList.add("hidden");
    freeFilter.classList.add("hidden");
    freeFilter.textContent = "Free only";
    save.disabled = true;
    if (status.textContent) status.textContent = message;
  };
  const test = h("button", { class: "btn-subtle text-xs", dataset: { keyedAction: "test" }, onclick: async () => {
    if (testing || adding) return;
    testing = true;
    const generation = ++testGeneration;
    const currentFingerprint = testFingerprint();
    const currentSaveFingerprint = saveFingerprint();
    testedFingerprint = null;
    testedSaveFingerprint = null;
    testedModels = null;
    test.disabled = true;
    save.disabled = true;
    status.textContent = "Discovering and testing…";
    const result: { ok: boolean; models?: Array<{ id: string; name?: string }>; error?: string } = await routingAction<{ ok: boolean; models?: Array<{ id: string; name?: string }>; error?: string }>("app:test-keyed-provider", payload()).catch((error: Error) => ({ ok: false, error: error.message }));
    testing = false;
    test.disabled = false;
    if (generation !== testGeneration || currentFingerprint !== testFingerprint() || currentSaveFingerprint !== saveFingerprint()) return;
    if (!result.ok) { status.textContent = result.error || "Connection failed."; return; }
    testedFingerprint = currentFingerprint;
    testedSaveFingerprint = currentSaveFingerprint;
    testedModels = result.models || [];
    status.textContent = `${testedModels.length} model${testedModels.length === 1 ? "" : "s"} ready.`;
    const discovered = testedModels as DiscoveredModel[];
    freeFilter.classList.toggle("hidden", id !== "openrouter" || !discovered.some((item) => item.free !== undefined));
    drawPreview();
    save.disabled = false;
  } }, "Test connection");
  const save = h("button", { class: "btn-primary text-xs", disabled: true, dataset: { keyedAction: "add" }, onclick: async () => {
    if (adding) return;
    if (!testedModels || testedFingerprint !== testFingerprint() || testedSaveFingerprint !== saveFingerprint()) { invalidate("Test the current settings before connecting."); return; }
    adding = true;
    test.disabled = true;
    save.disabled = true;
    inputs.forEach((input) => { input.disabled = true; });
    status.textContent = "Connecting…";
    const result = await routingAction<{ ok: boolean; error?: string }>("app:add-keyed-provider", {
      preset: id === "custom" ? undefined : id, name: name.value.trim(), baseUrl: baseUrl.value.trim(), apiKey: key.value.trim(), accountId: accountId.value.trim(), models: testedModels,
    }).catch((error: Error) => ({ ok: false, error: error.message }));
    if (!result.ok) {
      adding = false;
      test.disabled = false;
      save.disabled = testedFingerprint !== testFingerprint() || testedSaveFingerprint !== saveFingerprint();
      inputs.forEach((input) => { input.disabled = false; });
      status.textContent = result.error || "Could not connect.";
      return;
    }
    testedModels = null;
    testedFingerprint = null;
    testedSaveFingerprint = null;
    key.value = ""; wrap.remove(); await refresh();
  } }, "Connect");
  inputs.forEach((input) => input.addEventListener("input", () => invalidate()));
  add(wrap,
    h("div", { class: "mb-2 flex items-center justify-between" }, h("strong", { class: "text-sm text-fg" }, `New ${label} connection`), h("button", { class: "btn-ghost", onclick: () => wrap.remove() }, icon("x", 14))),
    h("div", { class: "grid gap-2 sm:grid-cols-2" }, name, baseUrl, preset?.needsAccountId ? accountId : null, key, model),
    h("div", { class: "mt-2 flex justify-end" }, freeFilter), preview,
    h("div", { class: "mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, h("div", { class: "flex gap-2" }, test, save)));
  return wrap;
}

function hasEnabledSource(state: RoutingState): boolean {
  return (state.providers || []).some((provider) => provider.enabled !== false
    && (provider.models || []).some((model) => model.enabled !== false));
}

/**
 * Focused first-run surface over the same OAuth and keyed-provider actions as
 * Settings. Provider cards connect directly; successful accounts are rendered
 * with the same account controls used by the full provider control plane.
 */
export function onboardingProviderPicker(onState: (state: RoutingState, ready: boolean) => void): HTMLElement {
  const shell = h("div", { class: "space-y-4" });
  const expandedAccounts = new Set<string>();
  let state: RoutingState | null = null;

  const refresh = async (): Promise<void> => {
    state = await api<RoutingState>("/api/routing/state");
    onState(state, hasEnabledSource(state));
    draw();
  };

  const draw = (): void => {
    if (!state) return;
    clear(shell);
    const formMount = h("div");
    const cards = h("div", { class: "grid gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4" });
    const sources: Array<{ id: string; name: string; kind: "oauth" | "keyed"; preset?: RoutingState["keyedPresets"][number] }> = [
      ...(state.oauthProviders || []).map((provider) => ({ ...provider, kind: "oauth" as const })),
      ...(state.keyedPresets || []).map((preset) => ({ id: preset.id, name: preset.name, kind: "keyed" as const, preset })),
      { id: "custom", name: "Custom endpoint", kind: "keyed" as const },
    ];
    for (const source of sources) {
      const familyAccounts = (state.providers || []).filter((provider) => (isCustom(provider) ? "custom" : providerFamily(provider)) === source.id);
      const card = h("button", {
        class: "wizard-choice flex items-center gap-3 text-left",
        dataset: { providerSource: source.id },
      },
      h("span", { class: "wizard-provider-mark" }, providerMark(source.id, 18)),
      h("span", { class: "min-w-0 flex-1" },
        h("span", { class: "block font-semibold text-fg" }, source.name),
        h("span", { class: "mt-0.5 hidden text-[11px] leading-4 text-muted xl:block" }, providerCopy[source.id] || "Any compatible OpenAI-style endpoint")),
      h("span", { class: `chip shrink-0 ${familyAccounts.length ? "border-accent/40 text-accent" : ""}` }, familyAccounts.length ? `${familyAccounts.length} connected` : source.kind === "oauth" ? "Sign in" : "Add key")) as HTMLButtonElement;
      card.onclick = async () => {
        if (source.kind === "oauth") {
          card.disabled = true;
          try { await openOauth(source.id, refresh); }
          catch (error) { clear(formMount); formMount.append(h("div", { class: "wizard-status-err" }, (error as Error).message)); }
          finally { card.disabled = false; }
          return;
        }
        clear(formMount);
        const overlay = h("div", { class: "modal-overlay fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4" });
        const form = keyedForm(source.id, source.name, source.preset, async () => { overlay.remove(); await refresh(); });
        form.classList.remove("mb-3"); form.classList.add("card", "w-full", "max-w-[680px]", "shadow-2xl");
        overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });
        overlay.append(form); document.body.append(overlay);
      };
      cards.append(card);
    }

    const accounts = state.providers || [];
    shell.append(cards, formMount);
    if (accounts.length) shell.append(
      h("div", { class: "border-t border-line pt-3" },
        h("div", { class: "mb-2 flex items-center justify-between gap-3" },
          h("div", { class: "text-sm font-semibold text-fg" }, "Connected accounts & keys"),
          h("span", { class: "text-xs text-muted" }, "Connect as many as you use")),
        h("div", { class: "flex flex-wrap gap-2" }, ...accounts.map((account) => h("span", { class: "chip max-w-[15rem] gap-1.5", dataset: { providerAccount: account.id }, title: `${accountName(account)} · ${(account.models || []).filter((model) => model.enabled !== false).length} models` }, h("span", { class: `routing-live-dot ${account.enabled === false ? "is-off" : ""}` }), h("span", { class: "truncate" }, accountName(account)))))),
    );
  };

  shell.append(h("div", { class: "routing-loading" }, "Reading available providers…"));
  void refresh().catch((error) => {
    clear(shell);
    shell.append(h("div", { class: "wizard-status-err" }, (error as Error).message));
  });
  return shell;
}

function routeEditor(state: RoutingState, refresh: () => Promise<void>, existing?: RoutingCombo): HTMLElement {
  const wrap = h("section", { class: "routing-route-editor" });
  const name = h("input", { class: "field font-mono", value: existing?.name || "", placeholder: "coding" }) as HTMLInputElement;
  const strategy = h("select", { class: "field" }, h("option", { value: "fallback", selected: existing?.strategy !== "round-robin" }, "Fallback — use preferred order"), h("option", { value: "round-robin", selected: existing?.strategy === "round-robin" }, "Round robin — rotate starting source")) as HTMLSelectElement;
  const sharing = h("input", { type: "checkbox", checked: existing?.visibility === "workspace", class: "accent-accent" }) as HTMLInputElement;
  const families = providerFamilies(state);
  const provider = h("select", { class: "field" }, h("option", { value: "" }, "Choose provider"), ...families.map((item) => h("option", { value: item.id }, item.name))) as HTMLSelectElement;
  const model = h("select", { class: "field", disabled: true }, h("option", { value: "" }, "Choose model")) as HTMLSelectElement;
  const members: RoutingComboMember[] = (existing?.members || []).map((member) => ({ ...member }));
  const memberList = h("div", { class: "space-y-2" });
  const status = statusLine();
  const redraw = (): void => {
    clear(memberList);
    members.forEach((member, index) => {
      const family = member.providerId ? `custom:${member.providerId}` : String(member.providerType || "");
      const label = family.startsWith("custom:")
        ? (state.providers.find((item) => item.id === member.providerId)?.name || "Custom")
        : familyLabel(family, state);
      memberList.append(h("div", { class: "routing-route-member" },
        h("span", { class: "routing-route-index" }, String(index + 1)),
        h("span", { class: "min-w-0 flex-1" }, h("span", { class: "block truncate text-sm font-semibold text-fg" }, `${label} · ${member.model}`), h("span", { class: "block text-xs text-muted" }, index === 0 ? "Preferred destination · account pool" : "Fallback destination · account pool")),
        h("button", { class: "btn-ghost p-2", disabled: index === 0, onclick: () => { [members[index - 1], members[index]] = [members[index], members[index - 1]]; redraw(); } }, "↑"),
        h("button", { class: "btn-ghost p-2", disabled: index === members.length - 1, onclick: () => { [members[index + 1], members[index]] = [members[index], members[index + 1]]; redraw(); } }, "↓"),
        h("button", { class: "btn-ghost p-2 text-danger", onclick: () => { members.splice(index, 1); redraw(); } }, icon("x", 13))));
    });
    if (!members.length) memberList.append(h("p", { class: "rounded-lg border border-dashed border-line p-4 text-center text-sm text-muted" }, "Add two or more destinations for useful failover."));
  };
  provider.onchange = () => {
    clear(model); model.append(h("option", { value: "" }, "Choose model"));
    const family = families.find((item) => item.id === provider.value);
    for (const item of family?.models || []) model.append(h("option", { value: item.id }, item.name || item.id));
    model.disabled = !family;
  };
  redraw();
  add(wrap,
    h("div", { class: "grid gap-2 sm:grid-cols-2" }, h("label", {}, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Route name / model ID"), name), h("label", {}, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Routing strategy"), strategy)),
    h("div", { class: "mt-4" }, h("div", { class: "mb-2 text-xs font-semibold text-muted" }, "Destinations"), memberList),
    h("div", { class: "mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" }, provider, model, h("button", { class: "btn-subtle min-h-10 text-xs", onclick: () => {
      if (!provider.value || !model.value) return;
      const candidate = familyRouteMember(provider.value, model.value, state);
      const key = `${candidate.providerId || candidate.providerType}::${candidate.model}`;
      if (!members.some((item) => `${item.providerId || item.providerType}::${item.model}` === key)) members.push(candidate);
      redraw();
    } }, "Add destination")),
    h("label", { class: "mt-3 flex min-h-10 items-center gap-2 text-xs text-muted" }, sharing, "Share this route with the workspace"),
    h("div", { class: "mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, h("div", { class: "flex gap-2" }, h("button", { class: "btn-ghost text-xs", onclick: () => wrap.remove() }, "Cancel"), h("button", { class: "btn-primary text-xs", onclick: async () => {
      if (!name.value.trim() || !members.length) { status.textContent = "Give the route a name and at least one destination."; return; }
      const result = await routingAction<{ ok: boolean; error?: string }>("app:save-combo", { id: existing?.id, name: name.value.trim(), strategy: strategy.value, members, visibility: sharing.checked ? "workspace" : "personal" }).catch((error: Error) => ({ ok: false, error: error.message }));
      if (!result.ok) { status.textContent = result.error || "Could not save route."; return; }
      wrap.remove(); await refresh();
    } }, existing ? "Save route" : "Create route"))));
  return wrap;
}

function routesView(state: RoutingState, refresh: () => Promise<void>, confirm: Dialog): HTMLElement {
  const editorMount = h("div");
  const create = h("button", { class: "btn-primary min-h-10 shrink-0 text-xs", onclick: () => { clear(editorMount); editorMount.append(routeEditor(state, refresh)); } }, icon("plus", 14), "New route");
  const list = h("div", { class: "routing-route-grid" });
  for (const route of state.combos || []) {
    list.append(h("article", { class: "routing-route-card" },
      h("div", { class: "flex min-w-0 items-start justify-between gap-3" }, h("div", { class: "min-w-0" }, h("div", { class: "eyebrow text-faint" }, route.strategy === "round-robin" ? "Round robin" : "Fallback"), h("h3", { class: "mt-1 break-all font-mono text-lg font-semibold text-fg" }, route.name)), h("span", { class: "chip shrink-0" }, `${route.members.length} stop${route.members.length === 1 ? "" : "s"}`)),
      h("div", { class: "mt-4 space-y-2" }, ...route.members.map((member, index) => h("div", { class: "flex items-center gap-2 text-sm" }, h("span", { class: "routing-route-index" }, String(index + 1)), h("span", { class: "truncate text-muted" }, `${member.providerType || state.providers.find((item) => item.id === member.providerId)?.name || "Provider"} · ${member.model}`)))),
      h("div", { class: "mt-4 flex justify-end gap-2 border-t border-line pt-3" }, route.mine === false ? h("span", { class: "mr-auto chip text-[10px]" }, "Shared by a teammate") : null, route.mine === false ? null : h("button", { class: "btn-ghost text-xs", onclick: () => { clear(editorMount); editorMount.append(routeEditor(state, refresh, route)); } }, "Edit"), route.mine === false ? null : h("button", { class: "btn-ghost text-xs text-danger", onclick: async () => { if (await confirm(`Delete the ${route.name} route?`)) { await routingAction("app:delete-combo", route.id); await refresh(); } } }, "Delete"))));
  }
  return h("div", {}, heading("Model policy", "Named routes", "Give agents and external tools one stable model name while 1Helm handles account pools, retries, provider fallback, and round-robin selection.", create), editorMount, state.combos.length ? list : empty("No named routes yet", "Create a route such as coding, fast, or review. Direct connected models remain usable without a route."));
}

async function activityView(state: RoutingState): Promise<HTMLElement> {
  const wrap = h("div");
  let period = "24h";
  const body = h("div");
  const draw = async (): Promise<void> => {
    const response = await routingAction<{ usage: RoutingUsage }>("app:usage", period);
    const usage = response.usage || state.usage;
    clear(body);
    const success = usage.requests ? Math.round((usage.ok / usage.requests) * 100) : 100;
    body.append(h("div", { class: "routing-metrics" },
      ...[
        [fmt(usage.requests), "Requests"], [success + "%", "Successful"], [fmt(usage.total_tokens), "Tokens"], [fmt(usage.cached_tokens), "Cached"],
      ].map(([value, label]) => h("div", { class: "routing-metric" }, h("strong", {}, value), h("span", {}, label)))));
    const providerRows = h("div", { class: "routing-telemetry-list" }, ...(usage.byProvider || []).slice(0, 10).map((entry) => h("div", { class: "routing-telemetry-row" }, h("span", { class: "min-w-0 flex-1 truncate font-semibold text-fg" }, entry.provider || entry.providerName || "Account"), h("span", { class: "font-mono text-xs text-muted" }, `${fmt(entry.requests)} req · ${fmt((entry.prompt_tokens || 0) + (entry.completion_tokens || 0))}t`))));
    const recent = h("div", { class: "routing-telemetry-list" }, ...(usage.recent || []).slice(0, 30).map((entry) => h("div", { class: "routing-event" }, h("span", { class: `routing-event-dot ${Number(entry.status || 0) >= 400 ? "is-error" : ""}` }), h("span", { class: "min-w-0 flex-1" }, h("span", { class: "block truncate text-sm font-semibold text-fg" }, entry.model || "Request"), h("span", { class: "block truncate text-xs text-muted" }, `${entry.providerName || entry.providerType || "Local route"} · ${fmt((entry.prompt_tokens || 0) + (entry.completion_tokens || 0))} tokens`)), h("time", { class: "font-mono text-[10px] text-faint" }, entry.at ? timeLabel(entry.at) : "now"))));
    body.append(h("div", { class: "routing-section-title" }, "Traffic by account"), providerRows.childElementCount ? providerRows : empty("No traffic yet", "Requests from 1Helm agents and external clients will appear here."), h("div", { class: "routing-section-title" }, "Recent requests"), recent.childElementCount ? recent : empty("Waiting for a request", "Once an agent or external client calls the endpoint, its route and token usage will be recorded here."));
  };
  const periods = h("div", { class: "routing-segment" }, ...[["1h", "1 hour"], ["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]].map(([value, label]) => h("button", { class: value === period ? "is-active" : "", onclick: async (event: Event) => { period = value; [...periods.children].forEach((child) => child.classList.remove("is-active")); (event.currentTarget as HTMLElement).classList.add("is-active"); await draw(); } }, label)));
  add(wrap, heading("Local telemetry", "Activity", "See route volume, token mix, failures, and which connected accounts are carrying the workspace."), periods, body);
  await draw(); return wrap;
}

async function quotaView(): Promise<HTMLElement> {
  const wrap = h("div");
  const body = h("div", { class: "space-y-3" });
  const refresh = h("button", { class: "btn-subtle min-h-10 shrink-0 text-xs" }, "Refresh quotas");
  const draw = (accounts: RoutingQuotaAccount[]): void => {
    clear(body);
    for (const account of accounts) body.append(h("article", { class: "routing-quota" },
      h("div", { class: "flex items-start justify-between gap-3" }, h("div", {}, h("h3", { class: "font-semibold text-fg" }, account.name || account.email || account.providerType || account.type), h("p", { class: "text-xs text-muted" }, `${account.plan || account.providerType || account.type}${account.accountAlias ? ` · ${account.accountAlias}` : ""}`)), h("span", { class: `chip ${account.error ? "text-danger" : ""}` }, account.error ? "error" : account.supported || account.status === "ok" || account.status === "empty" ? "live" : "unavailable")),
      account.error || account.note ? h("p", { class: "mt-3 text-sm text-muted" }, account.error || account.note) : null,
      ...(account.windows || []).map((window) => h("div", { class: "mt-4" }, h("div", { class: "mb-1 flex justify-between gap-3 text-xs" }, h("span", { class: "font-semibold text-fg" }, window.label), h("span", { class: "font-mono text-muted" }, `${Math.round(window.remainingPercent)}% left${window.resetsAt ? ` · resets ${timeLabel(window.resetsAt)}` : ""}`)), h("div", { class: "routing-quota-track" }, h("i", { style: `width:${Math.max(0, Math.min(100, window.remainingPercent))}%` }))))));
    if (!accounts.length) body.append(empty("No OAuth accounts connected", "Quota windows are available for supported ChatGPT, Claude, and Antigravity accounts."));
  };
  let loading = false;
  const load = async (): Promise<void> => {
    if (loading || !wrap.isConnected && wrap.dataset.mounted === "1") return;
    loading = true;
    refresh.setAttribute("disabled", "true"); refresh.textContent = "Refreshing…";
    try { const result = await routingAction<{ quota?: { accounts?: RoutingQuotaAccount[] } }>("app:quota-refresh"); draw(result.quota?.accounts || []); }
    finally { loading = false; refresh.removeAttribute("disabled"); refresh.textContent = "Refresh quotas"; }
  };
  refresh.onclick = () => { void load(); };
  add(wrap, heading("Subscription capacity", "Quota", "Check remaining supported subscription windows and reset times without leaving the workspace.", refresh), body);
  await load(); wrap.dataset.mounted = "1";
  const timer = window.setInterval(() => { if (!wrap.isConnected) { clearInterval(timer); return; } void load(); }, 60_000);
  return wrap;
}

async function logsView(): Promise<HTMLElement> {
  const wrap = h("div");
  const box = h("div", { class: "routing-log" });
  const load = async (): Promise<void> => {
    const result = await routingAction<{ entries?: Array<{ at: number; level: string; msg: string; meta?: unknown }> }>("app:logs-get", 300);
    clear(box);
    for (const entry of result.entries || []) box.append(h("div", { class: "routing-log-line" }, h("time", {}, new Date(entry.at).toISOString().slice(11, 23)), h("strong", { class: entry.level === "error" ? "text-danger" : entry.level === "warn" ? "text-accent" : "text-muted" }, entry.level), h("span", {}, entry.msg), entry.meta ? h("code", {}, JSON.stringify(entry.meta)) : null));
    if (!box.childElementCount) box.append(h("p", { class: "p-5 text-sm text-muted" }, "No routing events yet."));
  };
  const actions = h("div", { class: "flex shrink-0 gap-2" }, h("button", { class: "btn-subtle text-xs", onclick: () => { void load(); } }, "Refresh"), h("button", { class: "btn-danger text-xs", onclick: async () => { await routingAction("app:logs-clear"); await load(); } }, "Clear"));
  add(wrap, heading("Diagnostics", "Logs", "Read redacted routing, gateway, provider, and OAuth events without opening a terminal.", actions), box);
  await load(); return wrap;
}

async function endpointView(state: RoutingState, refresh: () => Promise<void>, confirm: Dialog): Promise<HTMLElement> {
  const credentials = await api<Pick<RoutingState, "apiKey" | "apiKeys" | "bindHost" | "port" | "serverListening" | "directEndpoint" | "personalPort">>("/api/routing/credentials");
  state.apiKey = credentials.apiKey;
  state.apiKeys = credentials.apiKeys;
  state.bindHost = credentials.bindHost;
  state.port = credentials.port;
  state.serverListening = credentials.serverListening;
  state.directEndpoint = credentials.directEndpoint;
  state.personalPort = credentials.personalPort;
  const keys = h("div", { class: "space-y-2" });
  const drawKeys = (): void => {
    clear(keys);
    for (const key of state.apiKeys || []) {
      const toggle = h("input", { type: "checkbox", checked: key.enabled !== false, class: "accent-accent" }) as HTMLInputElement;
      toggle.onchange = async () => { await routingAction("app:set-api-key-enabled", { id: key.id, enabled: toggle.checked }); await refresh(); };
      const masked = key.key.length > 12 ? `${key.key.slice(0, 7)}••••••••${key.key.slice(-4)}` : "••••••••••••";
      keys.append(h("div", { class: "routing-key-row" }, h("div", { class: "min-w-0 flex-1" }, h("div", { class: "font-semibold text-fg" }, key.name), h("code", { class: "block truncate text-[10px] text-faint" }, masked)), h("button", { class: "btn-ghost text-xs", onclick: async () => { await copyText(key.key); } }, "Copy"), toggle, h("button", { class: "btn-ghost p-2 text-danger", onclick: async () => { if (await confirm(`Revoke ${key.name}? Clients using it will stop immediately.`)) { await routingAction("app:revoke-api-key", key.id); await refresh(); } } }, icon("trash", 14))));
    }
  };
  drawKeys();
  const name = h("input", { class: "field", placeholder: "Key name, e.g. MacBook Claude Code" }) as HTMLInputElement;
  const endpoint = publicEndpoint();
  return h("div", {}, heading("Your routed identity", "Endpoint & keys", "These keys resolve only your personal accounts plus providers teammates explicitly shared with the workspace. They are separate from your 1Helm login and can be revoked individually."),
    h("section", { class: "routing-endpoint-hero" }, h("div", {}, h("div", { class: "eyebrow text-faint" }, "OpenAI / Anthropic base URL"), h("code", { class: "mt-2 block break-all text-lg text-fg" }, endpoint)), h("button", { class: "btn-primary min-h-10 shrink-0 text-xs", onclick: async () => { await copyText(endpoint); } }, "Copy endpoint")),
    h("div", { class: "routing-section-title" }, "Gateway keys"), keys,
    h("div", { class: "mt-3 grid gap-2 sm:grid-cols-[1fr_auto]" }, name, h("button", { class: "btn-primary min-h-10 text-xs", onclick: async () => { await routingAction("app:create-api-key", name.value.trim() || "1Helm client"); await refresh(); } }, icon("plus", 14), "Create key")),
    state.personalPort ? h("section", { class: "mt-4 rounded-lg border border-line bg-surface p-4" }, h("div", { class: "eyebrow text-faint" }, "Your dedicated host port"), h("code", { class: "mt-2 block break-all text-sm text-fg" }, state.directEndpoint || `http://127.0.0.1:${state.personalPort}/v1`), h("p", { class: "mt-2 text-xs leading-5 text-muted" }, "The port runs on the 1Helm host—not on this browser device—and enforces the same personal key identity.")) : null,
    state.scope === "captain" ? h("div", { class: "routing-section-title" }, "Network") : null,
    state.scope !== "captain" ? null :
    h("div", { class: "routing-network-row" }, h("div", { class: "min-w-0 flex-1" }, h("div", { class: "font-semibold text-fg" }, "Direct router port"), h("p", { class: "mt-1 text-xs leading-5 text-muted" }, "The 1Helm URL above works wherever your workspace is reachable. Optionally expose the engine's direct port to LAN or Tailscale clients.")), (() => {
      const select = h("select", { class: "field max-w-[190px]" }, h("option", { value: "127.0.0.1", selected: state.bindHost !== "0.0.0.0" }, "Localhost only"), h("option", { value: "0.0.0.0", selected: state.bindHost === "0.0.0.0" }, "LAN / Tailscale")) as HTMLSelectElement;
      select.onchange = async () => {
        const previous = state.bindHost; select.disabled = true;
        try {
          const result = await routingAction<{ ok: boolean; bindHost?: string; port?: number }>("app:set-bind-host", select.value);
          state.bindHost = result.bindHost || select.value; if (result.port) state.port = result.port;
          select.value = state.bindHost === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
        } catch (error) { select.value = previous === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1"; alert((error as Error).message); }
        finally { select.disabled = false; }
      };
      return select;
    })()));
}

export function routingPanel(isAdmin: boolean, confirm: Dialog): HTMLElement {
  const shell = h("div", { class: "routing-shell" });
  const nav = h("nav", { class: "routing-nav", "aria-label": "Provider controls" });
  const content = h("div", { class: "routing-content" });
  let state: RoutingState | null = null;
  let current: RoutingView = "sources";
  let shellActivityListener: ((activity: unknown) => void) | null = null;
  const expandedAccounts = new Set<string>();
  const expandedGroups = new Set<string>();
  const views: Array<[RoutingView, string]> = isAdmin
    ? [["sources", "Sources"], ["routes", "Routes"], ["activity", "Activity"], ["quota", "Quota"], ["logs", "Logs"], ["endpoint", "Endpoint"]]
    : [["sources", "My sources"], ["routes", "My routes"], ["activity", "Activity"], ["endpoint", "My endpoint"]];
  const loadState = async (): Promise<RoutingState> => api<RoutingState>("/api/routing/state");
  const draw = async (): Promise<void> => {
    clear(content); content.append(h("div", { class: "routing-loading" }, "Reading the model fabric…"));
    try {
      state = await loadState();
      clear(content);
      const refresh = async (): Promise<void> => { state = await loadState(); await draw(); };
      if (current === "sources") content.append(sourceCatalog(state, refresh, confirm, expandedAccounts, expandedGroups));
      else if (current === "routes") content.append(routesView(state, refresh, confirm));
      else if (current === "activity") content.append(await activityView(state));
      else if (current === "quota") content.append(await quotaView());
      else if (current === "logs") content.append(await logsView());
      else content.append(await endpointView(state, refresh, confirm));
      if (shellActivityListener) routingActivityListeners.delete(shellActivityListener);
      shellActivityListener = (activity) => {
        if (!shell.isConnected) { routingActivityListeners.delete(shellActivityListener!); return; }
        if (!state || current !== "sources") return;
        applyRoutingActivity(state, activity);
        const old = content.querySelector(".routing-fabric");
        if (old) old.replaceWith(routingFabric(state));
      };
      routingActivityListeners.add(shellActivityListener);
    } catch (error) {
      clear(content); content.append(empty("The model fabric is unavailable", (error as Error).message));
    }
  };
  for (const [id, label] of views) nav.append(h("button", { class: id === current ? "is-active" : "", onclick: async (event: Event) => { current = id; [...nav.children].forEach((item) => item.classList.remove("is-active")); (event.currentTarget as HTMLElement).classList.add("is-active"); await draw(); } }, label));
  add(shell, nav, content); void draw(); return shell;
}

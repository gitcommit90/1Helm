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

function accountCard(account: RoutingProvider, refresh: () => Promise<void>, confirm: Dialog): HTMLElement {
  const models = account.models || [];
  const enabled = models.filter((model) => model.enabled !== false).length;
  const details = h("div", { class: "hidden border-t border-line px-4 pb-4 pt-3" });
  const toggle = h("input", { type: "checkbox", checked: account.enabled !== false, class: "accent-accent" }) as HTMLInputElement;
  toggle.onchange = async () => {
    const result = await routingAction<{ ok: boolean }>("app:set-provider-enabled", { id: account.id, enabled: toggle.checked }).catch(() => ({ ok: false }));
    if (!result.ok) toggle.checked = !toggle.checked;
    await refresh();
  };
  const modelList = h("div", { class: "space-y-1" });
  for (const model of models) {
    const modelToggle = h("input", { type: "checkbox", checked: model.enabled !== false, class: "accent-accent" }) as HTMLInputElement;
    modelToggle.onchange = async () => {
      await routingAction("app:set-model-enabled", { providerId: account.id, modelId: model.id, enabled: modelToggle.checked });
      await refresh();
    };
    modelList.append(h("label", { class: "routing-model-row" },
      h("span", { class: "min-w-0 flex-1" }, h("span", { class: "block truncate text-sm font-semibold text-fg" }, model.name || model.id), h("span", { class: "block truncate font-mono text-[10px] text-faint" }, model.gatewayId || model.id)), modelToggle));
  }
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
      h("span", { class: "text-xs text-muted" }, `${enabled} of ${models.length} models enabled`),
      h("div", { class: "flex gap-2" },
        h("button", { class: "btn-ghost text-xs", onclick: async () => { await routingAction("app:set-all-models-enabled", { providerId: account.id, enabled: true }); await refresh(); } }, "All on"),
        h("button", { class: "btn-ghost text-xs", onclick: async () => { await routingAction("app:set-all-models-enabled", { providerId: account.id, enabled: false }); await refresh(); } }, "All off"))),
    models.length ? modelList : h("p", { class: "py-4 text-sm text-muted" }, "No models are configured for this account yet."),
    h("div", { class: "mt-3 grid gap-2 sm:grid-cols-[1fr_auto]" }, exact, addModel), addStatus,
    h("div", { class: "mt-3 flex flex-wrap justify-end gap-2" },
      ["chatgpt", "claude", "antigravity", "xai", "codex"].includes(account.type)
        ? h("button", { class: "btn-subtle text-xs", onclick: () => { void openOauth(account.type === "codex" ? "chatgpt" : account.type, refresh, account.id); } }, "Reconnect") : null,
      h("button", { class: "btn-danger text-xs", onclick: async () => {
        if (!(await confirm(`Disconnect ${accountName(account)}? Existing routes will keep working if another account for this provider remains.`))) return;
        await routingAction("app:remove-provider", account.id); await refresh();
      } }, "Disconnect")));

  const chevron = h("span", { class: "w-5 text-center font-mono text-muted" }, "+");
  const head = h("button", { class: "routing-account-head", type: "button", onclick: () => {
    details.classList.toggle("hidden");
    chevron.textContent = details.classList.contains("hidden") ? "+" : "−";
  } },
    h("span", { class: "wizard-provider-mark h-10 w-10" }, providerMark(providerFamily(account), 18)),
    h("span", { class: "min-w-0 flex-1 text-left" }, h("span", { class: "block truncate font-semibold text-fg" }, accountName(account)), h("span", { class: "block truncate text-xs text-muted" }, `${account.name}${account.accountAlias ? ` · ${account.accountAlias}` : ""} · ${enabled}/${models.length} models`)),
    h("span", { class: `routing-live-dot ${account.enabled === false ? "is-off" : ""}` }),
    h("span", { class: "flex min-h-10 items-center px-2", onclick: (event: MouseEvent) => event.stopPropagation() }, toggle),
    chevron);
  return h("article", { class: "routing-account" }, head, details);
}

async function openOauth(type: string, refresh: () => Promise<void>, providerId?: string): Promise<void> {
  const started = await routingAction<{ ok: boolean; authUrl?: string; needsPaste?: boolean; error?: string }>("app:oauth-start", type);
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
    const state: { active?: boolean; hasCode?: boolean; error?: string } = await routingAction<{ active?: boolean; hasCode?: boolean; error?: string }>("app:oauth-status", type).catch(() => ({}));
    if (state.error) status.textContent = state.error;
    if (state.hasCode) { await finish(); break; }
  }
}

/** Shared by first-run onboarding and the full provider control plane. */
export async function connectRoutingOauth(type: string, onConnected: () => Promise<void> = async () => undefined): Promise<void> {
  await openOauth(type, onConnected);
}

function sourceCatalog(state: RoutingState, refresh: () => Promise<void>, confirm: Dialog): HTMLElement {
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
    const accounts = h("div", { class: "mt-3 space-y-2" }, ...group.accounts.map((account) => accountCard(account, refresh, confirm)));
    const body = h("div", { class: "hidden border-t border-line px-4 pb-4 pt-3" }, accounts);
    const add = h("button", { class: "btn-subtle mt-3 min-h-10 w-full text-xs" }, group.kind === "oauth" ? "Add account" : "Add key");
    add.onclick = () => {
      if (group.kind === "oauth") { void openOauth(group.id, refresh).catch((error: Error) => { add.textContent = error.message; }); return; }
      body.prepend(keyedForm(group.id, group.name, group.preset, refresh));
    };
    body.append(add);
    const caret = h("span", { class: "w-5 font-mono text-muted" }, "+");
    const open = h("button", { class: "routing-provider-head", onclick: () => { body.classList.toggle("hidden"); caret.textContent = body.classList.contains("hidden") ? "+" : "−"; } },
      h("span", { class: "wizard-provider-mark" }, providerMark(group.id, 19)),
      h("span", { class: "min-w-0 flex-1 text-left" }, h("span", { class: "block font-semibold text-fg" }, group.name), h("span", { class: "block truncate text-xs text-muted" }, providerCopy[group.id] || "Connected model source")),
      h("span", { class: `chip ${group.accounts.length ? "border-accent/40 text-accent" : ""}` }, group.accounts.length ? `${group.accounts.length} connected` : "available"),
      caret);
    list.append(h("section", { class: "routing-provider" }, open, body));
  }
  return h("div", {}, heading("Provider fabric", "Accounts & keys", "Connect subscriptions and API keys once. Every enabled model becomes available to Skipper, resident agents, named routes, and the shared endpoint."), list);
}

function keyedForm(id: string, label: string, preset: RoutingState["keyedPresets"][number] | undefined, refresh: () => Promise<void>): HTMLElement {
  const wrap = h("div", { class: "mb-3 rounded-lg border border-accent/30 bg-accent-soft p-3" });
  const name = h("input", { class: "field", value: label, placeholder: "Connection name" }) as HTMLInputElement;
  const baseUrl = h("input", { class: "field", value: preset?.baseUrl || "", placeholder: "https://provider.example/v1" }) as HTMLInputElement;
  const accountId = h("input", { class: "field", placeholder: "Cloudflare account ID" }) as HTMLInputElement;
  const key = h("input", { class: "field", type: "password", placeholder: "API key", autocomplete: "off" }) as HTMLInputElement;
  const model = h("input", { class: "field", placeholder: "Exact model ID (optional)" }) as HTMLInputElement;
  const status = statusLine();
  const payload = (): Record<string, unknown> => ({ providerType: id === "custom" ? "openai-compat" : id, baseUrl: baseUrl.value.trim().replace("{account_id}", accountId.value.trim()), apiKey: key.value.trim(), modelId: model.value.trim() });
  const test = h("button", { class: "btn-subtle text-xs", onclick: async () => {
    status.textContent = "Discovering and testing…";
    const result: { ok: boolean; models?: Array<{ id: string; name?: string }>; error?: string } = await routingAction<{ ok: boolean; models?: Array<{ id: string; name?: string }>; error?: string }>("app:test-keyed-provider", payload()).catch((error: Error) => ({ ok: false, error: error.message }));
    status.textContent = result.ok ? `${result.models?.length || 0} model${result.models?.length === 1 ? "" : "s"} ready.` : result.error || "Connection failed.";
    if (result.ok && !model.value && result.models?.length) model.dataset.discovered = JSON.stringify(result.models);
  } }, "Test connection");
  const save = h("button", { class: "btn-primary text-xs", onclick: async () => {
    status.textContent = "Connecting…";
    let models: Array<{ id: string; name?: string }> = [];
    try { models = JSON.parse(model.dataset.discovered || "[]"); } catch { /* no discovery */ }
    if (model.value.trim()) models = [{ id: model.value.trim(), name: model.value.trim() }];
    const result = await routingAction<{ ok: boolean; error?: string }>("app:add-keyed-provider", {
      preset: id === "custom" ? undefined : id, name: name.value.trim(), baseUrl: baseUrl.value.trim(), apiKey: key.value.trim(), accountId: accountId.value.trim(), models,
    }).catch((error: Error) => ({ ok: false, error: error.message }));
    if (!result.ok) { status.textContent = result.error || "Could not connect."; return; }
    key.value = ""; wrap.remove(); await refresh();
  } }, "Connect");
  add(wrap,
    h("div", { class: "mb-2 flex items-center justify-between" }, h("strong", { class: "text-sm text-fg" }, `New ${label} connection`), h("button", { class: "btn-ghost", onclick: () => wrap.remove() }, icon("x", 14))),
    h("div", { class: "grid gap-2 sm:grid-cols-2" }, name, baseUrl, preset?.needsAccountId ? accountId : null, key, model),
    h("div", { class: "mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, h("div", { class: "flex gap-2" }, test, save)));
  return wrap;
}

function routeEditor(state: RoutingState, refresh: () => Promise<void>, existing?: RoutingCombo): HTMLElement {
  const wrap = h("section", { class: "routing-route-editor" });
  const name = h("input", { class: "field font-mono", value: existing?.name || "", placeholder: "coding" }) as HTMLInputElement;
  const strategy = h("select", { class: "field" }, h("option", { value: "fallback", selected: existing?.strategy !== "round-robin" }, "Fallback — use preferred order"), h("option", { value: "round-robin", selected: existing?.strategy === "round-robin" }, "Round robin — rotate starting source")) as HTMLSelectElement;
  const provider = h("select", { class: "field" }, h("option", { value: "" }, "Choose provider"), ...state.providers.filter((item) => item.enabled !== false).map((item) => h("option", { value: item.id }, item.name))) as HTMLSelectElement;
  const model = h("select", { class: "field", disabled: true }, h("option", { value: "" }, "Choose model")) as HTMLSelectElement;
  const members: RoutingComboMember[] = (existing?.members || []).map((member) => ({ ...member }));
  const memberList = h("div", { class: "space-y-2" });
  const status = statusLine();
  const redraw = (): void => {
    clear(memberList);
    members.forEach((member, index) => {
      const account = state.providers.find((item) => member.providerId ? item.id === member.providerId : providerFamily(item) === member.providerType);
      memberList.append(h("div", { class: "routing-route-member" },
        h("span", { class: "routing-route-index" }, String(index + 1)),
        h("span", { class: "min-w-0 flex-1" }, h("span", { class: "block truncate text-sm font-semibold text-fg" }, `${account?.name || member.providerType || "Provider"} · ${member.model}`), h("span", { class: "block text-xs text-muted" }, index === 0 ? "Preferred destination" : "Fallback destination")),
        h("button", { class: "btn-ghost p-2", disabled: index === 0, onclick: () => { [members[index - 1], members[index]] = [members[index], members[index - 1]]; redraw(); } }, "↑"),
        h("button", { class: "btn-ghost p-2", disabled: index === members.length - 1, onclick: () => { [members[index + 1], members[index]] = [members[index], members[index + 1]]; redraw(); } }, "↓"),
        h("button", { class: "btn-ghost p-2 text-danger", onclick: () => { members.splice(index, 1); redraw(); } }, icon("x", 13))));
    });
    if (!members.length) memberList.append(h("p", { class: "rounded-lg border border-dashed border-line p-4 text-center text-sm text-muted" }, "Add two or more destinations for useful failover."));
  };
  provider.onchange = () => {
    clear(model); model.append(h("option", { value: "" }, "Choose model"));
    const account = state.providers.find((item) => item.id === provider.value);
    for (const item of account?.models.filter((entry) => entry.enabled !== false) || []) model.append(h("option", { value: item.id }, item.name || item.id));
    model.disabled = !account;
  };
  redraw();
  add(wrap,
    h("div", { class: "grid gap-2 sm:grid-cols-2" }, h("label", {}, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Route name / model ID"), name), h("label", {}, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Routing strategy"), strategy)),
    h("div", { class: "mt-4" }, h("div", { class: "mb-2 text-xs font-semibold text-muted" }, "Destinations"), memberList),
    h("div", { class: "mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" }, provider, model, h("button", { class: "btn-subtle min-h-10 text-xs", onclick: () => {
      const account = state.providers.find((item) => item.id === provider.value); if (!account || !model.value) return;
      const candidate = routeMember(account, model.value);
      if (!members.some((item) => (item.providerId || item.providerType) === (candidate.providerId || candidate.providerType) && item.model === candidate.model)) members.push(candidate);
      redraw();
    } }, "Add destination")),
    h("div", { class: "mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, h("div", { class: "flex gap-2" }, h("button", { class: "btn-ghost text-xs", onclick: () => wrap.remove() }, "Cancel"), h("button", { class: "btn-primary text-xs", onclick: async () => {
      if (!name.value.trim() || !members.length) { status.textContent = "Give the route a name and at least one destination."; return; }
      const result = await routingAction<{ ok: boolean; error?: string }>("app:save-combo", { id: existing?.id, name: name.value.trim(), strategy: strategy.value, members }).catch((error: Error) => ({ ok: false, error: error.message }));
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
      h("div", { class: "mt-4 flex justify-end gap-2 border-t border-line pt-3" }, h("button", { class: "btn-ghost text-xs", onclick: () => { clear(editorMount); editorMount.append(routeEditor(state, refresh, route)); } }, "Edit"), h("button", { class: "btn-ghost text-xs text-danger", onclick: async () => { if (await confirm(`Delete the ${route.name} route?`)) { await routingAction("app:delete-combo", route.id); await refresh(); } } }, "Delete"))));
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
  const load = async (force = false): Promise<void> => {
    refresh.setAttribute("disabled", "true"); refresh.textContent = force ? "Refreshing…" : "Loading…";
    const result = await routingAction<{ quota?: { accounts?: RoutingQuotaAccount[] } }>(force ? "app:quota-refresh" : "app:quota-get");
    draw(result.quota?.accounts || []); refresh.removeAttribute("disabled"); refresh.textContent = "Refresh quotas";
  };
  refresh.onclick = () => { void load(true); };
  add(wrap, heading("Subscription capacity", "Quota", "Check remaining supported subscription windows and reset times without leaving the workspace.", refresh), body);
  await load(); return wrap;
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

function endpointView(state: RoutingState, refresh: () => Promise<void>, confirm: Dialog): HTMLElement {
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
  const loadKeys = async (): Promise<void> => {
    const credentials = await api<Pick<RoutingState, "apiKey" | "apiKeys" | "bindHost" | "port" | "serverListening">>("/api/routing/credentials");
    state.apiKey = credentials.apiKey; state.apiKeys = credentials.apiKeys; state.bindHost = credentials.bindHost; state.port = credentials.port; state.serverListening = credentials.serverListening;
    drawKeys();
  };
  void loadKeys();
  const name = h("input", { class: "field", placeholder: "Key name, e.g. MacBook Claude Code" }) as HTMLInputElement;
  const endpoint = publicEndpoint();
  return h("div", {}, heading("One address", "Endpoint & keys", "Use the same routed models outside 1Helm. Gateway keys are separate from workspace login sessions and can be revoked individually."),
    h("section", { class: "routing-endpoint-hero" }, h("div", {}, h("div", { class: "eyebrow text-faint" }, "OpenAI / Anthropic base URL"), h("code", { class: "mt-2 block break-all text-lg text-fg" }, endpoint)), h("button", { class: "btn-primary min-h-10 shrink-0 text-xs", onclick: async () => { await copyText(endpoint); } }, "Copy endpoint")),
    h("div", { class: "routing-section-title" }, "Gateway keys"), keys,
    h("div", { class: "mt-3 grid gap-2 sm:grid-cols-[1fr_auto]" }, name, h("button", { class: "btn-primary min-h-10 text-xs", onclick: async () => { await routingAction("app:create-api-key", name.value.trim() || "1Helm client"); await refresh(); } }, icon("plus", 14), "Create key")),
    h("div", { class: "routing-section-title" }, "Network"),
    h("div", { class: "routing-network-row" }, h("div", { class: "min-w-0 flex-1" }, h("div", { class: "font-semibold text-fg" }, "Direct router port"), h("p", { class: "mt-1 text-xs leading-5 text-muted" }, "The 1Helm URL above works wherever your workspace is reachable. Optionally expose the engine's direct port to LAN or Tailscale clients.")), h("select", { class: "field max-w-[190px]", onchange: async (event: Event) => { await routingAction("app:set-bind-host", (event.currentTarget as HTMLSelectElement).value); await refresh(); } }, h("option", { value: "127.0.0.1", selected: state.bindHost !== "0.0.0.0" }, "Localhost only"), h("option", { value: "0.0.0.0", selected: state.bindHost === "0.0.0.0" }, "LAN / Tailscale"))));
}

export function routingPanel(isAdmin: boolean, confirm: Dialog): HTMLElement {
  if (!isAdmin) return h("div", { class: "routing-empty" }, h("div", { class: "font-display text-xl text-fg" }, "Captain-managed model fabric"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Connected models and named routes are available to your resident agents. A workspace Captain manages accounts, keys, quota, and diagnostics."));
  const shell = h("div", { class: "routing-shell" });
  const nav = h("nav", { class: "routing-nav", "aria-label": "Provider controls" });
  const content = h("div", { class: "routing-content" });
  let state: RoutingState | null = null;
  let current: RoutingView = "sources";
  const views: Array<[RoutingView, string]> = [["sources", "Sources"], ["routes", "Routes"], ["activity", "Activity"], ["quota", "Quota"], ["logs", "Logs"], ["endpoint", "Endpoint"]];
  const loadState = async (): Promise<RoutingState> => api<RoutingState>("/api/routing/state");
  const draw = async (): Promise<void> => {
    clear(content); content.append(h("div", { class: "routing-loading" }, "Reading the model fabric…"));
    try {
      state = await loadState();
      clear(content);
      const refresh = async (): Promise<void> => { state = await loadState(); await draw(); };
      if (current === "sources") content.append(sourceCatalog(state, refresh, confirm));
      else if (current === "routes") content.append(routesView(state, refresh, confirm));
      else if (current === "activity") content.append(await activityView(state));
      else if (current === "quota") content.append(await quotaView());
      else if (current === "logs") content.append(await logsView());
      else content.append(endpointView(state, refresh, confirm));
    } catch (error) {
      clear(content); content.append(empty("The model fabric is unavailable", (error as Error).message));
    }
  };
  for (const [id, label] of views) nav.append(h("button", { class: id === current ? "is-active" : "", onclick: async (event: Event) => { current = id; [...nav.children].forEach((item) => item.classList.remove("is-active")); (event.currentTarget as HTMLElement).classList.add("is-active"); await draw(); } }, label));
  add(shell, nav, content); void draw(); return shell;
}

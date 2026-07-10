import { api, type Bot, type Computer, type Provider, type User } from "./api.ts";
import { h, clear, add, icon } from "./dom.ts";
import { S, avatar, reloadProviders } from "./app.ts";

const modelCache = new Map<number, string[]>();
async function loadModels(botId: number): Promise<string[]> {
  if (modelCache.has(botId)) return modelCache.get(botId)!;
  try { const r = await api<{ models: string[] }>(`/api/bots/${botId}/models`); modelCache.set(botId, r.models); return r.models; }
  catch { return []; }
}
const provModelCache = new Map<number, string[]>();
async function loadProviderModels(providerId: number): Promise<string[]> {
  if (provModelCache.has(providerId)) return provModelCache.get(providerId)!;
  const r = await api<{ models: string[] }>(`/api/providers/${providerId}/models`);
  provModelCache.set(providerId, r.models); return r.models;
}

// ============================================================ OpenRouter OAuth (PKCE)
const b64url = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function pkceChallenge(verifier: string): Promise<string> { return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))); }
export async function startOpenRouterOAuth(): Promise<void> {
  if (!globalThis.crypto?.subtle) {
    const httpsUrl = location.protocol === "http:" ? `https://${location.host}${location.pathname}` : "";
    throw new Error(
      `OpenRouter sign-in needs Web Crypto, which browsers only enable on secure pages — this page is ${location.origin} (${window.isSecureContext ? "secure, but crypto.subtle is unavailable — possibly an embedded frame" : "not a secure context"}).`
      + (httpsUrl ? ` Open ${httpsUrl} instead, or ask your admin to redirect HTTP to HTTPS.` : " Open the app over HTTPS (or localhost) and try again."),
    );
  }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)).buffer);
  // localStorage (not sessionStorage): the verifier must survive the full-page
  // round trip through openrouter.ai, which can land in a fresh session.
  localStorage.setItem(VERIFIER_KEY, JSON.stringify({ v: verifier, t: Date.now() }));
  const callback = location.origin + location.pathname;
  location.assign(`https://openrouter.ai/auth?callback_url=${encodeURIComponent(callback)}&code_challenge=${await pkceChallenge(verifier)}&code_challenge_method=S256`);
}
const VERIFIER_KEY = "ctrl.or_verifier";
const VERIFIER_TTL_MS = 30 * 60 * 1000;
/** Read + consume the stored PKCE verifier; expired or malformed entries are dropped. */
function takeVerifier(): string {
  const raw = localStorage.getItem(VERIFIER_KEY);
  if (!raw) return "";
  localStorage.removeItem(VERIFIER_KEY);
  try {
    const { v, t } = JSON.parse(raw) as { v?: string; t?: number };
    return v && typeof t === "number" && Date.now() - t < VERIFIER_TTL_MS ? v : "";
  } catch { return ""; }
}
function clearExpiredVerifier(): void {
  const raw = localStorage.getItem(VERIFIER_KEY);
  if (!raw) return;
  try {
    const { v, t } = JSON.parse(raw) as { v?: string; t?: number };
    if (!v || typeof t !== "number" || Date.now() - t >= VERIFIER_TTL_MS) localStorage.removeItem(VERIFIER_KEY);
  } catch { localStorage.removeItem(VERIFIER_KEY); }
}
/** On return from OpenRouter, exchange ?code for a key and create a provider. */
export async function finishOpenRouterOAuth(): Promise<void> {
  const code = new URLSearchParams(location.search).get("code");
  if (!code) { clearExpiredVerifier(); return; }
  history.replaceState({}, "", location.pathname);
  const verifier = takeVerifier();
  if (!verifier) {
    console.warn("OpenRouter OAuth: callback code received but no stored PKCE verifier (storage cleared or sign-in older than 30 min)");
    alert("OpenRouter sent back an authorization code, but this browser no longer has the matching sign-in state (it may have been cleared during the redirect). Please click Connect OpenRouter and try again.");
    return;
  }
  try { await api("/api/oauth/openrouter/exchange", { body: { code, code_verifier: verifier, name: "OpenRouter" } }); await reloadProviders(); openSettings("providers"); }
  catch (e) { alert("OpenRouter connection failed: " + (e as Error).message); }
}

/** Start the shared admin Login-with-ChatGPT device flow and show its code in-app. */
async function startChatGPTOAuth(): Promise<void> {
  const started = await api<{ status: string; userCode?: string; verificationUrl?: string; interval?: number; expiresAt?: number }>("/api/chatgpt/login", { body: {} });
  if (!started.userCode || !started.verificationUrl) throw new Error("ChatGPT did not return a verification code.");

  let cancelled = false;
  const code = h("input", { class: "field w-full text-center font-mono text-xl font-bold tracking-[0.18em]", value: started.userCode, readOnly: true }) as HTMLInputElement;
  const status = h("p", { class: "text-center text-sm text-muted" }, "Waiting for approval…");
  const close = (): void => { cancelled = true; modal.remove(); };
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(started.userCode!); status.textContent = "Code copied — paste it into the OpenAI page."; }
    catch { code.focus(); code.select(); document.execCommand("copy"); status.textContent = "Code selected — copy it, then paste it into the OpenAI page."; }
  };
  const modal = h("div", { class: "fixed inset-0 z-50 grid place-items-center bg-black/60 p-6", onclick: (e: MouseEvent) => { if (e.target === modal) close(); } },
    h("div", { class: "card w-full max-w-md space-y-5 p-6 shadow-2xl" },
      h("div", { class: "flex items-start justify-between gap-4" },
        h("div", {}, h("h2", { class: "text-lg font-bold text-fg" }, "Connect ChatGPT"), h("p", { class: "mt-1 text-sm text-muted" }, "Connect the shared admin ChatGPT account for CTRL PANE bots.")),
        h("button", { class: "grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg", title: "Cancel", onclick: close }, icon("x"))),
      h("div", { class: "space-y-2 rounded-lg border border-line bg-raised p-4" },
        h("p", { class: "text-sm text-fg" }, "1. Open the OpenAI verification page."),
        h("a", { class: "btn-primary flex w-full justify-center text-sm", href: started.verificationUrl, target: "_blank", rel: "noopener noreferrer" }, "Open verification page"),
        h("p", { class: "pt-2 text-sm text-fg" }, "2. Enter this one-time code:"),
        code,
        h("button", { class: "btn-subtle w-full text-sm", onclick: () => { void copy(); } }, "Copy code")),
      status,
      h("div", { class: "flex justify-end" }, h("button", { class: "btn-subtle text-sm", onclick: close }, "Cancel"))));
  document.body.append(modal);
  code.focus(); code.select();

  const deadline = started.expiresAt || Date.now() + 15 * 60 * 1000;
  const every = Math.max(2_000, (started.interval || 5) * 1_000);
  while (!cancelled && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, every));
    if (cancelled) return;
    try {
      const state = await api<{ status: string }>("/api/chatgpt/status", { method: "GET" });
      if (state.status !== "authenticated") continue;
      status.textContent = "Connected — saving the shared provider…";
      await api("/api/providers/chatgpt/complete", { body: {} });
      await reloadProviders();
      modal.remove();
      openSettings("providers");
      return;
    } catch (e) {
      if (!cancelled) status.textContent = `Still waiting: ${(e as Error).message}`;
    }
  }
  if (!cancelled) {
    status.textContent = "This code expired. Close this dialog and connect ChatGPT again.";
  }
}

// ============================================================ model routing
/** Effective model + which level supplies it, mirroring server resolution. */
function resolve(bot: Bot, channelId: number, threadId: number | null): { model: string; source: "thread" | "channel" | "global" | "none" } {
  const t = threadId != null ? bot.prefs[`thread:${threadId}`] : "";
  if (t) return { model: t, source: "thread" };
  const c = bot.prefs[`channel:${channelId}`];
  if (c) return { model: c, source: "channel" };
  if (bot.model) return { model: bot.model, source: "global" };
  return { model: "", source: "none" };
}

/**
 * A clear three-level model routing card: Global → Channel → Thread, with the
 * active level highlighted and inherited levels dimmed. Levels below the one
 * being viewed are shown so the override chain is obvious.
 */
export function modelRoutingPanel(bot: Bot, channelId: number, threadId: number | null, onChange: () => Promise<void>): HTMLElement {
  const wrap = h("div", { class: "rounded-xl border border-line bg-raised p-3" });
  const chName = "#" + (S.channels.find((c) => c.id === channelId)?.name || "channel");

  const render = async (): Promise<void> => {
    clear(wrap);
    const eff = resolve(bot, channelId, threadId);
    const models = await loadModels(bot.id).catch(() => [] as string[]);

    const levelRow = (level: "global" | "channel" | "thread", label: string, scope: string): HTMLElement => {
      const value = level === "global" ? bot.model : bot.prefs[`${level}:${level === "channel" ? channelId : threadId}`] || "";
      const active = eff.source === level;
      const inheritsFrom = level === "channel" ? (bot.model ? `global (${bot.model})` : "global") : (bot.prefs[`channel:${channelId}`] ? `channel (${bot.prefs[`channel:${channelId}`]})` : (bot.model ? `global (${bot.model})` : "global"));

      const sel = h("select", { class: "field h-8 flex-1 py-0 text-xs" }) as HTMLSelectElement;
      if (level !== "global") sel.append(h("option", { value: "", selected: !value }, `Inherit — ${inheritsFrom}`));
      else if (!bot.model) sel.append(h("option", { value: "", selected: true }, "Not set"));
      const opts = models.length ? models : (value ? [value] : []);
      for (const mdl of opts) sel.append(h("option", { value: mdl, selected: mdl === value }, mdl));
      sel.addEventListener("change", async () => {
        if (level === "global") await api(`/api/bots/${bot.id}`, { method: "PATCH", body: { model: sel.value } });
        else await api("/api/model-pref", { body: { botId: bot.id, scope: level, scopeId: String(level === "channel" ? channelId : threadId), model: sel.value || null } });
        await onChange();
        const fresh = S.bots.find((b) => b.id === bot.id); if (fresh) { bot.model = fresh.model; bot.prefs = fresh.prefs; }
        render();
      });

      return h("div", { class: `flex items-center gap-2 rounded-lg px-2 py-1.5 ${active ? "bg-accent-soft ring-1 ring-accent/40" : ""}` },
        h("span", { class: `mt-0.5 h-2 w-2 shrink-0 rounded-full ${active ? "bg-accent" : "bg-line"}`, title: active ? "Active here" : "" }),
        h("div", { class: "w-24 shrink-0" }, h("div", { class: `text-xs font-semibold ${active ? "text-accent" : "text-fg"}` }, label), h("div", { class: "truncate text-[10px] text-muted" }, scope)),
        sel,
        value && level !== "global"
          ? h("button", { class: "grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:bg-hover hover:text-danger", title: "Clear override", onclick: async () => { await api("/api/model-pref", { body: { botId: bot.id, scope: level, scopeId: String(level === "channel" ? channelId : threadId), model: null } }); await onChange(); const fr = S.bots.find((b) => b.id === bot.id); if (fr) { bot.model = fr.model; bot.prefs = fr.prefs; } render(); } }, icon("x", 14))
          : h("span", { class: "w-7 shrink-0" }));
    };

    add(wrap,
      h("div", { class: "mb-2 flex items-center gap-2" }, avatar(bot.name, "bot", 7),
        h("div", { class: "min-w-0 flex-1" }, h("div", { class: "truncate text-sm font-semibold text-fg" }, bot.name),
          h("div", { class: "text-[11px] text-muted" }, "Serving here: ", h("span", { class: "font-semibold text-accent" }, eff.model || "no model"), eff.source !== "none" ? ` (from ${eff.source})` : "")),
        !models.length ? h("button", { class: "btn-subtle h-7 text-[11px]", onclick: async () => { modelCache.delete(bot.id); await loadModels(bot.id); render(); } }, "Load models") : null),
      h("div", { class: "space-y-1" },
        levelRow("global", "Global", "all channels"),
        levelRow("channel", "Channel", chName),
        threadId != null ? levelRow("thread", "Thread", "this thread only") : null));
  };
  render();
  return wrap;
}

// ============================================================ settings modal
type Tab = "providers" | "bots" | "computers" | "members";
export function openSettings(tab: Tab = "bots"): void {
  const overlay = h("div", { class: "fixed inset-0 z-40 grid place-items-center bg-black/50 p-6", onclick: (e: MouseEvent) => { if (e.target === overlay) overlay.remove(); } });
  const bodyEl = h("div", { class: "min-h-0 flex-1 overflow-y-auto p-5" });
  const tabs: [Tab, string][] = [["providers", "Providers"], ["bots", "Bots"], ["computers", "Computers"]];
  if (S.me.is_admin) tabs.push(["members", "Members"]);
  const tabBar = h("div", { class: "flex gap-1 border-b border-line px-4 pt-3" });
  const draw = (t: Tab): void => {
    clear(tabBar);
    tabs.forEach(([id, label]) => tabBar.append(h("button", { class: `-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium ${t === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`, onclick: () => draw(id) }, label)));
    clear(bodyEl);
    bodyEl.append(t === "providers" ? providersPanel() : t === "bots" ? botsPanel() : t === "computers" ? computersPanel() : membersPanel());
  };
  overlay.append(h("div", { class: "card flex h-[82vh] w-[760px] flex-col overflow-hidden shadow-2xl" },
    h("div", { class: "flex items-center justify-between border-b border-line px-5 py-3" }, h("div", { class: "flex items-center gap-2 text-lg font-bold text-fg" }, h("span", { class: "text-accent" }, icon("gear", 18)), "Settings"),
      h("button", { class: "grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg", onclick: () => overlay.remove() }, icon("x"))),
    tabBar, bodyEl));
  document.body.append(overlay);
  draw(tab);
}

const adminNote = (): HTMLElement => h("p", { class: "rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300" }, "Only admins can add or edit these.");

// ------------------------------------------------------------ providers
function providersPanel(): HTMLElement {
  const wrap = h("div", { class: "space-y-3" });
  const list = h("div", { class: "space-y-3" });
  const refresh = async (): Promise<void> => { await reloadProviders(); draw(); };
  const draw = (): void => { clear(list); S.providers.forEach((pr) => list.append(providerCard(pr, refresh))); if (!S.providers.length) list.append(h("p", { class: "py-6 text-center text-sm text-muted" }, "No providers yet. Connect one, then reuse it across bots.")); };
  add(wrap,
    h("div", { class: "flex items-center justify-between gap-3" },
      h("p", { class: "text-sm text-muted" }, "Connections to OpenAI-compatible endpoints. Add once, then reuse across any number of bots."),
      S.me.is_admin ? h("div", { class: "flex shrink-0 gap-2" },
        h("button", { class: "btn-subtle text-sm", type: "button", onclick: () => { void startChatGPTOAuth().catch((e) => alert((e as Error).message || "ChatGPT connection failed")); } }, "Connect ChatGPT"),
        h("button", { class: "btn-subtle text-sm", type: "button", onclick: () => { void startOpenRouterOAuth().catch((e) => alert((e as Error).message || "OpenRouter connection failed")); } }, "Connect OpenRouter"),
        h("button", { class: "btn-primary text-sm", onclick: () => list.prepend(providerCard(null, refresh)) }, icon("plus"), "Add a provider")) : null),
    S.me.is_admin ? null : adminNote(), list);
  draw();
  return wrap;
}

function providerCard(prov: Provider | null, refresh: () => void): HTMLElement {
  const ro = !S.me.is_admin;
  const isChatGPT = prov?.kind === "chatgpt";
  const name = h("input", { class: "field", placeholder: "Name (e.g. OpenAI, work OpenRouter)", value: prov?.name || "", disabled: ro || isChatGPT }) as HTMLInputElement;
  const url = h("input", { class: "field", placeholder: "Base URL, e.g. https://api.openai.com/v1", value: isChatGPT ? "Login with ChatGPT (admin subscription)" : (prov?.base_url || ""), disabled: ro || isChatGPT }) as HTMLInputElement;
  const key = h("input", { class: "field", type: "password", placeholder: isChatGPT ? "Connected ChatGPT session (no API key)" : (prov?.has_key ? "•••••• (unchanged)" : "API key"), disabled: ro || isChatGPT }) as HTMLInputElement;
  const status = h("span", { class: "text-xs text-muted" }, isChatGPT ? "Shared admin ChatGPT account for bots." : "");
  const test = async (): Promise<void> => {
    status.textContent = "Testing…";
    try { const r = await api<{ models: string[] }>("/api/providers/fetch-models", { body: prov ? { providerId: prov.id } : { base_url: url.value, api_key: key.value } }); status.textContent = `✓ ${r.models.length} models available`; }
    catch (e) { status.textContent = (e as Error).message; }
  };
  const save = async (): Promise<void> => {
    const payload: Record<string, unknown> = { name: name.value, base_url: url.value }; if (key.value) payload.api_key = key.value;
    try { await api(prov ? `/api/providers/${prov.id}` : "/api/providers", { method: prov ? "PATCH" : "POST", body: payload }); if (prov) provModelCache.delete(prov.id); refresh(); }
    catch (e) { status.textContent = (e as Error).message; }
  };
  const del = async (): Promise<void> => {
    if (!prov || !confirm(isChatGPT ? `Disconnect ChatGPT and remove ${prov.name}?` : `Delete provider ${prov.name}?`)) return;
    try {
      if (isChatGPT) await api("/api/providers/chatgpt/disconnect", { body: {} });
      else await api(`/api/providers/${prov.id}`, { method: "DELETE" });
      refresh();
    } catch (e) { status.textContent = (e as Error).message; }
  };
  const badge = prov?.kind === "openrouter" ? "OR" : prov?.kind === "chatgpt" ? "GPT" : icon("sliders");
  const authChip = prov?.kind === "openrouter" ? "OAuth" : prov?.kind === "chatgpt" ? "ChatGPT login" : null;
  return h("div", { class: "card p-4" },
    h("div", { class: "mb-2 flex items-center gap-2" },
      h("span", { class: "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent font-bold" }, badge),
      h("div", { class: "flex-1" }, name),
      prov ? h("span", { class: "chip" }, `${prov.bots} bot${prov.bots === 1 ? "" : "s"}`) : null,
      authChip ? h("span", { class: "chip border-accent/40 text-accent" }, authChip) : null),
    h("div", { class: "grid grid-cols-2 gap-2" }, url, key),
    h("div", { class: "mt-2.5 flex items-center justify-between border-t border-line pt-2.5" }, status,
      S.me.is_admin ? h("div", { class: "flex gap-2" },
        h("button", { class: "btn-subtle text-xs", onclick: test }, "Test"),
        isChatGPT ? h("button", { class: "btn-subtle text-xs", onclick: () => { void startChatGPTOAuth().then(refresh).catch((e) => alert((e as Error).message || "ChatGPT connection failed")); } }, "Reconnect") : null,
        prov ? h("button", { class: "btn-danger text-xs", onclick: del }, icon("trash", 14), isChatGPT ? "Disconnect" : "Delete") : null,
        isChatGPT ? null : h("button", { class: "btn-primary text-xs", onclick: save }, prov ? "Save" : "Add provider")) : null));
}

// ------------------------------------------------------------ bots
function botsPanel(): HTMLElement {
  const wrap = h("div", { class: "space-y-3" });
  const list = h("div", { class: "space-y-3" });
  const refresh = async (): Promise<void> => { S.bots = (await api<{ bots: Bot[] }>("/api/bots")).bots; draw(); };
  const draw = (): void => { clear(list); S.bots.forEach((b) => list.append(botCard(b, refresh))); if (!S.bots.length) list.append(h("p", { class: "py-6 text-center text-sm text-muted" }, "No bots yet. Add one to bring AI into your threads.")); };
  add(wrap,
    h("div", { class: "flex items-center justify-between gap-3" }, h("p", { class: "text-sm text-muted" }, "Pick a provider and a model, then route models per channel or thread. Add providers in the Providers tab."),
      S.me.is_admin ? h("button", { class: "btn-primary shrink-0 text-sm", onclick: () => list.prepend(botCard(null, refresh)) }, icon("plus"), "Add a new bot") : null),
    S.me.is_admin ? null : adminNote(),
    S.me.is_admin && !S.providers.length ? h("p", { class: "rounded-lg border border-line bg-raised px-3 py-2 text-xs text-muted" }, "Tip: connect a provider first (Providers tab) — bots choose their model from a provider.") : null,
    list);
  draw();
  return wrap;
}

function botCard(bot: Bot | null, refresh: () => void): HTMLElement {
  const ro = !S.me.is_admin;
  const name = h("input", { class: "field", placeholder: "Bot name (used for @mention)", value: bot?.name || "", disabled: ro }) as HTMLInputElement;
  const promptEl = h("textarea", { class: "field min-h-[64px]", placeholder: "System prompt / persona (optional)", disabled: ro }, bot?.prompt || "") as HTMLTextAreaElement;
  const status = h("span", { class: "text-xs text-muted" });

  const providerSel = h("select", { class: "field", disabled: ro }, h("option", { value: "" }, "— choose a provider —")) as HTMLSelectElement;
  S.providers.forEach((pr) => providerSel.append(h("option", { value: pr.id, selected: bot?.provider_id === pr.id }, `${pr.name} · ${pr.kind === "chatgpt" ? "Login with ChatGPT" : pr.base_url}`)));
  const modelSel = h("select", { class: "field", disabled: ro }) as HTMLSelectElement;

  const loadForProvider = async (keepModel: string): Promise<void> => {
    const pid = Number(providerSel.value);
    clear(modelSel); modelSel.append(h("option", { value: keepModel }, keepModel || "— select a provider —"));
    if (!pid) return;
    status.textContent = "Loading models…";
    try { const models = await loadProviderModels(pid); clear(modelSel); modelSel.append(h("option", { value: "" }, "(no default model)")); models.forEach((mo) => modelSel.append(h("option", { value: mo, selected: mo === keepModel }, mo))); status.textContent = `${models.length} models`; }
    catch (e) { status.textContent = (e as Error).message; }
  };
  providerSel.addEventListener("change", () => loadForProvider(""));
  if (bot?.provider_id) void loadForProvider(bot.model || "");

  const compBox = h("div", { class: "flex flex-wrap gap-2" });
  const assigned = new Set(bot?.computers || []);
  const drawComps = (): void => {
    clear(compBox);
    if (!S.computers.length) { compBox.append(h("span", { class: "text-xs text-muted" }, "No computers yet — add them in the Computers tab.")); return; }
    S.computers.forEach((c) => { const on = assigned.has(c.id); compBox.append(h("button", { class: `chip py-1 ${on ? "border-accent bg-accent-soft text-accent" : ""}`, disabled: ro, onclick: () => { if (assigned.has(c.id)) assigned.delete(c.id); else assigned.add(c.id); drawComps(); } }, on ? icon("check", 12) : icon("plus", 12), c.name)); });
  };
  drawComps();

  const save = async (): Promise<void> => {
    const payload: Record<string, unknown> = { name: name.value, prompt: promptEl.value, model: modelSel.value, provider_id: providerSel.value ? Number(providerSel.value) : null, computers: [...assigned] };
    try { await api(bot ? `/api/bots/${bot.id}` : "/api/bots", { method: bot ? "PATCH" : "POST", body: payload }); modelCache.delete(bot?.id ?? -1); refresh(); }
    catch (e) { status.textContent = (e as Error).message; }
  };
  const del = async (): Promise<void> => { if (bot && confirm(`Delete bot ${bot.name}?`)) { await api(`/api/bots/${bot.id}`, { method: "DELETE" }); refresh(); } };

  return h("div", { class: "card space-y-2.5 p-4" },
    h("div", { class: "flex items-center gap-2" }, avatar((bot?.name || "new bot"), "bot", 9), h("div", { class: "flex-1" }, name)),
    h("div", { class: "grid grid-cols-2 gap-2" },
      h("div", {}, h("div", { class: "mb-1 text-xs font-semibold uppercase tracking-wide text-muted" }, "Provider"), providerSel),
      h("div", {}, h("div", { class: "mb-1 text-xs font-semibold uppercase tracking-wide text-muted" }, "Default (global) model"), modelSel)),
    h("div", { class: "text-[11px] text-muted" }, "Providers are shared — the same provider can back many bots. Override the model per channel/thread from the Models button in chat."),
    promptEl,
    h("div", {}, h("div", { class: "mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted" }, "Assigned computers"), compBox,
      h("p", { class: "mt-1 text-[11px] text-muted" }, "The bot's system prompt lists these and grants it permission to run commands on them on your behalf.")),
    h("div", { class: "flex items-center justify-between border-t border-line pt-2.5" }, status,
      S.me.is_admin ? h("div", { class: "flex gap-2" }, bot ? h("button", { class: "btn-danger text-xs", onclick: del }, icon("trash", 14), "Delete") : null, h("button", { class: "btn-primary text-xs", onclick: save }, bot ? "Save changes" : "Create bot")) : null));
}

// ------------------------------------------------------------ computers
function computersPanel(): HTMLElement {
  const wrap = h("div", { class: "space-y-3" });
  const list = h("div", { class: "space-y-3" });
  const refresh = async (): Promise<void> => { S.computers = (await api<{ computers: Computer[] }>("/api/computers")).computers; draw(); };
  const draw = (): void => { clear(list); S.computers.forEach((c) => list.append(computerCard(c, refresh))); if (!S.computers.length) list.append(h("p", { class: "py-6 text-center text-sm text-muted" }, "No computers yet.")); };
  add(wrap,
    h("div", { class: "flex items-center justify-between gap-3" }, h("p", { class: "text-sm text-muted" }, "Computers are Open-Terminal endpoints (base URL + key). Open terminals to them and assign them to bots."),
      S.me.is_admin ? h("button", { class: "btn-primary shrink-0 text-sm", onclick: () => list.prepend(computerCard(null, refresh)) }, icon("plus"), "Add a computer") : null),
    S.me.is_admin ? null : adminNote(), list);
  draw();
  return wrap;
}

function computerCard(comp: Computer | null, refresh: () => void): HTMLElement {
  const ro = !S.me.is_admin;
  const name = h("input", { class: "field", placeholder: "Name", value: comp?.name || "", disabled: ro }) as HTMLInputElement;
  const url = h("input", { class: "field", placeholder: "Base URL, e.g. http://localhost:8000", value: comp?.base_url || "", disabled: ro }) as HTMLInputElement;
  const key = h("input", { class: "field", type: "password", placeholder: comp?.has_key ? "•••••• (unchanged)" : "API key", disabled: ro }) as HTMLInputElement;
  const status = h("span", { class: "text-xs text-muted" });
  const save = async (): Promise<void> => {
    const payload: Record<string, unknown> = { name: name.value, base_url: url.value }; if (key.value) payload.api_key = key.value;
    try { await api(comp ? `/api/computers/${comp.id}` : "/api/computers", { method: comp ? "PATCH" : "POST", body: payload }); refresh(); }
    catch (e) { status.textContent = (e as Error).message; }
  };
  const del = async (): Promise<void> => { if (comp && confirm(`Remove computer ${comp.name}?`)) { await api(`/api/computers/${comp.id}`, { method: "DELETE" }); refresh(); } };
  return h("div", { class: "card p-4" },
    h("div", { class: "mb-2 flex items-center gap-2" }, h("span", { class: "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" }, icon("terminal")), h("div", { class: "flex-1" }, name)),
    h("div", { class: "grid grid-cols-2 gap-2" }, url, key),
    h("div", { class: "mt-2.5 flex items-center justify-between border-t border-line pt-2.5" }, status,
      S.me.is_admin ? h("div", { class: "flex gap-2" }, comp ? h("button", { class: "btn-danger text-xs", onclick: del }, icon("trash", 14), "Remove") : null, h("button", { class: "btn-primary text-xs", onclick: save }, comp ? "Save" : "Add computer")) : null));
}

// ------------------------------------------------------------ members
function membersPanel(): HTMLElement {
  const wrap = h("div", { class: "space-y-2" });
  const refresh = async (): Promise<void> => { S.users = (await api<{ users: User[] }>("/api/users")).users; draw(); };
  const draw = (): void => {
    clear(wrap);
    S.users.forEach((u) => wrap.append(h("div", { class: "card flex items-center gap-3 p-3" },
      avatar(u.display, "user", 9), h("div", { class: "flex-1" }, h("div", { class: "font-semibold text-fg" }, u.display), h("div", { class: "text-xs text-muted" }, "@" + u.username)),
      h("label", { class: "flex items-center gap-1.5 text-xs text-muted" }, h("input", { type: "checkbox", class: "accent-accent", checked: u.is_admin, disabled: u.id === S.me.id, onchange: async (e: Event) => { await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { is_admin: (e.target as HTMLInputElement).checked } }); } }), "admin"),
      u.id === S.me.id ? h("span", { class: "chip" }, "you") : h("button", { class: "btn-danger text-xs", onclick: async () => { if (confirm(`Delete ${u.display}?`)) { await api(`/api/admin/users/${u.id}`, { method: "DELETE" }); refresh(); } } }, "Delete"))));
  };
  draw();
  return wrap;
}

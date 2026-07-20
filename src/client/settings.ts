import { api, getToken, workspacePhotoSrc, type Computer, type Provider, type Skill, type User, type WorkspaceDomain } from "./api.ts";
import { h, clear, add, icon, providerMark } from "./dom.ts";
import { S, avatar, reloadProviders, renderApp, appAlert, appConfirm } from "./app.ts";

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
export async function finishOpenRouterOAuth(): Promise<{ connected: boolean }> {
  const code = new URLSearchParams(location.search).get("code");
  if (!code) { clearExpiredVerifier(); return { connected: false }; }
  history.replaceState({}, "", location.pathname);
  const verifier = takeVerifier();
  if (!verifier) {
    console.warn("OpenRouter OAuth: callback code received but no stored PKCE verifier (storage cleared or sign-in older than 30 min)");
    void appAlert("OpenRouter sent back an authorization code, but this browser no longer has the matching sign-in state (it may have been cleared during the redirect). Please click Connect OpenRouter and try again.");
    return { connected: false };
  }
  try {
    await api("/api/oauth/openrouter/exchange", { body: { code, code_verifier: verifier, name: "OpenRouter" } });
    await reloadProviders();
    return { connected: true };
  } catch (e) {
    void appAlert("OpenRouter connection failed: " + (e as Error).message);
    return { connected: false };
  }
}

/** Start the shared admin Login-with-ChatGPT device flow and show its code in-app. */
export async function startChatGPTOAuth(): Promise<void> {
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
  const modal = h("div", { class: "modal-overlay fixed inset-0 z-50 grid place-items-end bg-black/60 p-0 sm:place-items-center sm:p-6", onclick: (e: MouseEvent) => { if (e.target === modal) close(); } },
    h("div", { class: "card mobile-sheet w-full max-w-md space-y-5 rounded-b-none p-5 shadow-2xl sm:rounded-xl sm:p-6" },
      h("div", { class: "flex items-start justify-between gap-4" },
        h("div", {}, h("h2", { class: "text-lg font-bold text-fg" }, "Connect ChatGPT"), h("p", { class: "mt-1 text-sm text-muted" }, "Connect the shared admin ChatGPT account to serve Skipper and resident agents.")),
        h("button", { class: "grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg sm:h-8 sm:w-8", title: "Cancel", onclick: close }, icon("x"))),
      h("div", { class: "space-y-2 rounded-lg border border-line bg-raised p-4" },
        h("p", { class: "text-sm text-fg" }, "1. Open the OpenAI verification page."),
        h("a", { class: "btn-primary flex min-h-11 w-full justify-center text-sm", href: started.verificationUrl, target: "_blank", rel: "noopener noreferrer" }, "Open verification page"),
        h("p", { class: "pt-2 text-sm text-fg" }, "2. Enter this one-time code:"),
        code,
        h("button", { class: "btn-subtle min-h-11 w-full text-sm", onclick: () => { void copy(); } }, "Copy code")),
      status,
      h("div", { class: "flex justify-end pb-[env(safe-area-inset-bottom)]" }, h("button", { class: "btn-subtle min-h-11 text-sm sm:min-h-0", onclick: close }, "Cancel"))));
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
      const setup = await api<{ setup_complete: boolean }>("/api/setup/status");
      if (setup.setup_complete) openSettings("providers");
      return;
    } catch (e) {
      if (!cancelled) status.textContent = `Still waiting: ${(e as Error).message}`;
    }
  }
  if (!cancelled) {
    status.textContent = "This code expired. Close this dialog and connect ChatGPT again.";
  }
}

// ============================================================ settings modal
type Tab = "admin" | "agents" | "skills" | "domains" | "providers" | "computers" | "members";
export function openSettings(tab: Tab = "agents"): void {
  const overlay = h("div", { class: "modal-overlay fixed inset-0 z-40 grid place-items-end bg-black/50 p-0 sm:place-items-center sm:p-4 md:p-6", onclick: (e: MouseEvent) => { if (e.target === overlay) overlay.remove(); } });
  const bodyEl = h("div", { class: "min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-5" });
  const tabs: [Tab, string][] = S.me.is_admin ? [["admin", "Admin"], ["agents", "Agents"], ["skills", "Skills"], ["domains", "Domains"], ["providers", "Providers"], ["computers", "Advanced computers"], ["members", "Members"]] : [["agents", "Agents"], ["skills", "Skills"], ["providers", "Providers"], ["computers", "Advanced computers"]];
  const tabBar = h("div", { class: "flex gap-1 overflow-x-auto border-b border-line px-2 pt-2 sm:px-4 sm:pt-3" });
  const draw = (t: Tab): void => {
    clear(tabBar);
    tabs.forEach(([id, label]) => tabBar.append(h("button", { class: `view-tab ${t === id ? "view-tab-active" : "view-tab-idle"}`, onclick: () => draw(id) }, label)));
    clear(bodyEl);
    bodyEl.append(t === "admin" ? adminPanel() : t === "agents" ? agentsPanel() : t === "skills" ? skillsPanel() : t === "domains" ? domainsPanel() : t === "providers" ? providersPanel() : t === "computers" ? computersPanel() : membersPanel());
  };
  overlay.append(h("div", { class: "card mobile-sheet flex h-[min(92dvh,100%)] w-full max-w-none flex-col overflow-hidden rounded-b-none shadow-2xl sm:h-[min(82vh,900px)] sm:max-w-[760px] sm:rounded-xl" },
    h("div", { class: "flex items-center justify-between border-b border-line px-4 py-3 sm:px-5" },
      h("div", { class: "font-display flex items-center gap-2.5 text-[1.4rem] leading-tight text-fg" }, h("span", { class: "text-accent" }, icon("gear", 18)), "Settings"),
      h("button", { class: "grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg sm:h-8 sm:w-8", "aria-label": "Close settings", onclick: () => overlay.remove() }, icon("x"))),
    tabBar, bodyEl));
  document.body.append(overlay);
  draw(tab);
}

const adminNote = (): HTMLElement => h("p", { class: "rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300" }, "Only admins can add or edit these.");

function adminPanel(): HTMLElement {
  const name = h("input", { class: "field", value: S.workspace.name, autocomplete: "organization" }) as HTMLInputElement;
  const theme = h("select", { class: "field" }, ...[["graphite", "Signal"], ["ocean", "Ocean"], ["forest", "Forest"], ["ember", "Brass"], ["plum", "Plum"]].map(([value, label]) => h("option", { value, selected: S.workspace.theme === value }, label))) as HTMLSelectElement;
  const status = h("p", { class: "min-h-5 text-sm text-muted" });
  const photo = h("img", { class: "h-16 w-16 rounded-xl border border-line bg-raised object-cover", src: workspacePhotoSrc(S.workspace.photo_url, Date.now()), alt: "Workspace" }) as HTMLImageElement;
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", class: "hidden" }) as HTMLInputElement;
  const presetColors = ["#c8552f", "#4f6d7a", "#8a6b7c", "#a67c52", "#7a6a4f", "#2e7d4f", "#2166b8", "#64748b"];
  const presetRow = h("div", { class: "mt-2 flex flex-wrap gap-2" });
  const applyPreset = async (hex: string): Promise<void> => {
    status.textContent = "Applying workspace color…";
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) { status.textContent = "Canvas unavailable."; return; }
    ctx.fillStyle = hex; ctx.fillRect(0, 0, 256, 256);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) { status.textContent = "Could not generate image."; return; }
    const response = await fetch("/api/workspace/photo", { method: "POST", headers: { authorization: `Bearer ${getToken()}`, "content-type": "image/png" }, body: blob });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { status.textContent = result.error || `HTTP ${response.status}`; return; }
    S.workspace = result.workspace; photo.src = workspacePhotoSrc(S.workspace.photo_url, Date.now()); renderApp(); status.textContent = "Workspace photo updated.";
  };
  for (const hex of presetColors) presetRow.append(h("button", { class: "h-8 w-8 rounded-lg border border-line shadow-sm transition hover:scale-105", style: `background:${hex}`, title: hex, onclick: () => { void applyPreset(hex); } }));
  file.onchange = async () => {
    const image = file.files?.[0]; if (!image) return;
    status.textContent = "Uploading workspace photo…";
    const response = await fetch("/api/workspace/photo", { method: "POST", headers: { authorization: `Bearer ${getToken()}`, "content-type": image.type }, body: image });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { status.textContent = result.error || `HTTP ${response.status}`; return; }
    S.workspace = result.workspace; photo.src = workspacePhotoSrc(S.workspace.photo_url, Date.now()); renderApp(); status.textContent = "Workspace photo updated.";
  };
  const save = async (): Promise<void> => {
    try { S.workspace = (await api<{ workspace: typeof S.workspace }>("/api/workspace", { method: "PATCH", body: { name: name.value, theme: theme.value } })).workspace; applyWorkspaceTheme(); status.textContent = "Workspace settings saved."; renderApp(); }
    catch (error) { status.textContent = (error as Error).message; }
  };
  return h("div", { class: "space-y-4" },
    h("div", { class: "card p-4" }, h("h3", { class: "font-semibold text-fg" }, "Workspace identity"), h("p", { class: "mt-1 text-sm text-muted" }, "Simple shared identity for everyone and every agent in this workspace."),
      h("div", { class: "mt-4 flex flex-col gap-4 sm:flex-row sm:items-center" }, photo, h("div", { class: "flex flex-wrap gap-2" }, h("label", { class: "btn-subtle cursor-pointer text-sm" }, "Choose photo", file), S.workspace.photo_url ? h("button", { class: "btn-ghost text-sm", onclick: async () => { S.workspace = (await api<{ workspace: typeof S.workspace }>("/api/workspace/photo", { method: "DELETE" })).workspace; photo.src = "/brand/1helm.png"; renderApp(); } }, "Remove") : null)),
      h("div", { class: "mt-3" }, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Default colors"), presetRow),
      h("div", { class: "mt-4 grid gap-3 sm:grid-cols-2" }, h("label", {}, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Workspace name"), name), h("label", {}, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Color theme"), theme)),
      h("div", { class: "mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, h("button", { class: "btn-primary text-sm", onclick: () => { void save(); } }, "Save workspace"))));
}

function applyWorkspaceTheme(): void {
  document.documentElement.dataset.workspaceTheme = S.workspace.theme || "graphite";
  localStorage.setItem("ctrl.workspaceTheme", S.workspace.theme || "graphite");
}

function skillsPanel(): HTMLElement {
  const wrap = h("div", { class: "space-y-3" }, h("p", { class: "text-sm leading-6 text-muted" }, "Every agent knows this complete catalog. Skipper starts with all skills; resident agents get a useful permanent kit and can request or propose more while they work."));
  void api<{ skills: Skill[] }>("/api/skills").then(({ skills }) => {
    for (const skill of skills) wrap.append(h("article", { class: "card p-4" }, h("div", { class: "flex flex-wrap items-center gap-2" }, h("h3", { class: "font-semibold text-fg" }, skill.name), h("span", { class: "chip" }, skill.category), h("span", { class: "ml-auto text-xs text-muted" }, `${(skill as Skill & { assigned_agents?: number }).assigned_agents || 0} agents`)), h("p", { class: "mt-2 text-sm leading-6 text-muted" }, skill.description)));
  }).catch((error) => wrap.append(h("p", { class: "text-danger" }, (error as Error).message)));
  return wrap;
}

function domainsPanel(): HTMLElement {
  const hostname = h("input", { class: "field", placeholder: "agents.example.com", autocomplete: "url" }) as HTMLInputElement;
  const token = h("input", { class: "field", type: "password", placeholder: "Cloudflare API token", autocomplete: "off" }) as HTMLInputElement;
  const status = h("p", { class: "min-h-5 text-sm text-muted" });
  const list = h("div", { class: "space-y-2" });
  const load = async (): Promise<void> => {
    clear(list);
    const { domains } = await api<{ domains: WorkspaceDomain[] }>("/api/domains");
    if (!domains.length) list.append(h("p", { class: "py-6 text-center text-sm text-muted" }, "No custom domain connected yet."));
    for (const domain of domains) list.append(h("div", { class: "card flex items-center gap-3 p-3" }, h("span", { class: `h-2.5 w-2.5 rounded-full ${domain.status === "active" ? "bg-ok" : domain.status === "error" ? "bg-danger" : "bg-amber-400"}` }), h("div", { class: "min-w-0 flex-1" }, h("div", { class: "font-semibold text-fg" }, domain.hostname), h("div", { class: "text-xs text-muted" }, domain.status === "active" ? "HTTPS connected through Cloudflare" : domain.error || domain.status))));
  };
  const connect = async (): Promise<void> => {
    status.textContent = "Creating the tunnel, DNS record, HTTPS route, and persistent service…";
    try { const result = await api<{ domain: WorkspaceDomain }>("/api/domains/cloudflare", { body: { hostname: hostname.value, token: token.value } }); token.value = ""; status.textContent = `Connected https://${result.domain.hostname}. The API token was not saved.`; await load(); }
    catch (error) { token.value = ""; status.textContent = (error as Error).message; }
  };
  void load();
  return h("div", { class: "space-y-4" }, h("div", { class: "card p-4" }, h("h3", { class: "font-semibold text-fg" }, "Connect a Cloudflare domain"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Do you have a domain on Cloudflare? Enter the hostname you want for this workspace. 1Helm creates a named tunnel, routes DNS, enables HTTPS, and keeps it running after restarts."), h("div", { class: "mt-4 grid gap-3 sm:grid-cols-2" }, hostname, token), h("p", { class: "mt-2 text-xs text-muted" }, "Create an API token with Account: Cloudflare Tunnel Edit and Zone: DNS Edit. The token is used for this connection and is never stored."), h("div", { class: "mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, h("button", { class: "btn-primary text-sm", onclick: () => { void connect(); } }, "Connect domain"))), list);
}

// ------------------------------------------------------------ native agent roster
function agentsPanel(): HTMLElement {
  const agents = S.channels.filter((channel) => channel.kind === "channel" && channel.agent).map((channel) => ({ channel, agent: channel.agent! }));
  return h("div", { class: "space-y-3" },
    h("div", { class: "rounded-lg border border-accent/25 bg-accent-soft px-4 py-3 text-sm leading-6 text-fg" }, "Agents are created by channels, not manually wired. Each ordinary channel owns one resident specialist; Skipper is the single workspace-wide exception."),
    ...agents.map(({ channel, agent }) => h("div", { class: "card flex flex-col gap-3 p-4 sm:flex-row sm:items-center" },
      h("div", { class: "flex min-w-0 items-start gap-3" },
        avatar(agent.name, "bot", 9, agent.runtime?.avatar || undefined),
        h("div", { class: "min-w-0 flex-1" },
          h("div", { class: "flex flex-wrap items-center gap-2" }, h("span", { class: "font-semibold text-fg" }, "@" + agent.name), h("span", { class: "chip" }, agent.kind === "skipper" ? "Workspace Skipper" : `Resident of #${channel.name}`)),
          h("div", { class: "mt-1 text-sm leading-5 text-muted" }, agent.purpose || channel.purpose),
          h("div", { class: "mt-1 break-words text-xs text-faint" }, `${agent.status} · ${agent.provider_name || "no provider"} · ${agent.model || "no model"}`))),
      h("button", { class: "btn-subtle min-h-11 w-full shrink-0 text-xs sm:min-h-0 sm:w-auto", onclick: () => { document.querySelector<HTMLElement>(".fixed.inset-0.z-40")?.remove(); S.channelId = channel.id; S.view = "settings"; renderApp(); } }, "Open channel"))),
    !agents.length ? h("p", { class: "py-8 text-center text-sm text-muted" }, "Complete setup, then create a channel to provision its resident agent world.") : null);
}

// ------------------------------------------------------------ providers
function providersPanel(): HTMLElement {
  const wrap = h("div", { class: "space-y-3" });
  const list = h("div", { class: "space-y-3" });
  const refresh = async (): Promise<void> => { await reloadProviders(); draw(); };
  const draw = (): void => { clear(list); S.providers.forEach((pr) => list.append(providerCard(pr, refresh))); if (!S.providers.length) list.append(h("p", { class: "py-6 text-center text-sm text-muted" }, "No providers yet. Connect one to serve Skipper and resident agents.")); };
  add(wrap,
    h("div", { class: "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" },
      h("p", { class: "min-w-0 text-sm leading-5 text-muted" }, "Connections to model providers. Add one once, then let any number of resident agents inherit or use it."),
      S.me.is_admin ? h("div", { class: "flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:flex-wrap sm:justify-end" },
        h("button", { class: "btn-subtle min-h-11 w-full text-sm sm:min-h-0 sm:w-auto", type: "button", onclick: () => { void startChatGPTOAuth().catch((e) => appAlert((e as Error).message || "ChatGPT connection failed")); } }, "Connect ChatGPT"),
        h("button", { class: "btn-subtle min-h-11 w-full text-sm sm:min-h-0 sm:w-auto", type: "button", onclick: () => { void startOpenRouterOAuth().catch((e) => appAlert((e as Error).message || "OpenRouter connection failed")); } }, "Connect OpenRouter"),
        h("button", { class: "btn-primary min-h-11 w-full text-sm sm:min-h-0 sm:w-auto", onclick: () => list.prepend(providerCard(null, refresh)) }, icon("plus"), "Add a provider")) : null),
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
  const status = h("span", { class: "min-w-0 flex-1 break-words text-xs text-muted" }, isChatGPT ? "Shared admin ChatGPT account for agents." : "");
  const test = async (): Promise<void> => {
    status.textContent = "Testing…";
    try { const r = await api<{ models: string[] }>("/api/providers/fetch-models", { body: prov ? { providerId: prov.id } : { base_url: url.value, api_key: key.value } }); status.textContent = `✓ ${r.models.length} models available`; }
    catch (e) { status.textContent = (e as Error).message; }
  };
  const save = async (): Promise<void> => {
    const payload: Record<string, unknown> = { name: name.value, base_url: url.value }; if (key.value) payload.api_key = key.value;
    try { await api(prov ? `/api/providers/${prov.id}` : "/api/providers", { method: prov ? "PATCH" : "POST", body: payload }); refresh(); }
    catch (e) { status.textContent = (e as Error).message; }
  };
  const del = async (): Promise<void> => {
    if (!prov || !(await appConfirm(isChatGPT ? `Disconnect ChatGPT and remove ${prov.name}?` : `Delete provider ${prov.name}?`))) return;
    try {
      if (isChatGPT) await api("/api/providers/chatgpt/disconnect", { body: {} });
      else await api(`/api/providers/${prov.id}`, { method: "DELETE" });
      refresh();
    } catch (e) { status.textContent = (e as Error).message; }
  };
  const authChip = prov?.kind === "openrouter" ? "OAuth" : prov?.kind === "chatgpt" ? "ChatGPT login" : null;
  return h("div", { class: "card min-w-0 overflow-hidden p-4" },
    h("div", { class: "mb-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center" },
      h("div", { class: "flex min-w-0 items-center gap-2" },
        h("span", { class: "wizard-provider-mark h-9 w-9 shrink-0" }, providerMark(prov?.kind || "openai", 18)),
        h("div", { class: "min-w-0 flex-1" }, name)),
      h("div", { class: "flex flex-wrap gap-1.5 sm:shrink-0" },
        prov ? h("span", { class: "chip" }, `${prov.bots} agent${prov.bots === 1 ? "" : "s"}`) : null,
        authChip ? h("span", { class: "chip border-accent/40 text-accent" }, authChip) : null)),
    h("div", { class: "grid grid-cols-1 gap-2 sm:grid-cols-2" }, url, key),
    h("div", { class: "mt-2.5 flex flex-col gap-2 border-t border-line pt-2.5 sm:flex-row sm:items-center sm:justify-between" }, status,
      S.me.is_admin ? h("div", { class: "flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end" },
        h("button", { class: "btn-subtle min-h-11 w-full text-xs sm:min-h-0 sm:w-auto", onclick: test }, "Test"),
        isChatGPT ? h("button", { class: "btn-subtle min-h-11 w-full text-xs sm:min-h-0 sm:w-auto", onclick: () => { void startChatGPTOAuth().then(refresh).catch((e) => appAlert((e as Error).message || "ChatGPT connection failed")); } }, "Reconnect") : null,
        prov ? h("button", { class: "btn-danger min-h-11 w-full text-xs sm:min-h-0 sm:w-auto", onclick: del }, icon("trash", 14), isChatGPT ? "Disconnect" : "Delete") : null,
        isChatGPT ? null : h("button", { class: "btn-primary min-h-11 w-full text-xs sm:min-h-0 sm:w-auto", onclick: save }, prov ? "Save" : "Add provider")) : null));
}

// ------------------------------------------------------------ computers
function computersPanel(): HTMLElement {
  const wrap = h("div", { class: "space-y-3" });
  const list = h("div", { class: "space-y-3" });
  const refresh = async (): Promise<void> => { S.computers = (await api<{ computers: Computer[] }>("/api/computers")).computers; draw(); };
  const draw = (): void => { clear(list); S.computers.forEach((c) => list.append(computerCard(c, refresh))); if (!S.computers.length) list.append(h("p", { class: "py-6 text-center text-sm text-muted" }, "No computers yet.")); };
  add(wrap,
    h("div", { class: "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" },
      h("p", { class: "min-w-0 text-sm leading-5 text-muted" }, "Advanced: Open-Terminal endpoints (base URL + key). The embedded This Computer backs every resident agent's /workspace; add a remote computer here for Skipper host-level work."),
      S.me.is_admin ? h("button", { class: "btn-primary min-h-11 w-full shrink-0 text-sm sm:min-h-0 sm:w-auto", onclick: () => list.prepend(computerCard(null, refresh)) }, icon("plus"), "Add a computer") : null),
    S.me.is_admin ? null : adminNote(), list);
  draw();
  return wrap;
}

function computerCard(comp: Computer | null, refresh: () => void): HTMLElement {
  const ro = !S.me.is_admin;
  const name = h("input", { class: "field", placeholder: "Name", value: comp?.name || "", disabled: ro }) as HTMLInputElement;
  const url = h("input", { class: "field", placeholder: "Base URL, e.g. http://localhost:8000", value: comp?.base_url || "", disabled: ro }) as HTMLInputElement;
  const key = h("input", { class: "field", type: "password", placeholder: comp?.has_key ? "•••••• (unchanged)" : "API key", disabled: ro }) as HTMLInputElement;
  const status = h("span", { class: "min-w-0 flex-1 break-words text-xs text-muted" });
  const save = async (): Promise<void> => {
    const payload: Record<string, unknown> = { name: name.value, base_url: url.value }; if (key.value) payload.api_key = key.value;
    try { await api(comp ? `/api/computers/${comp.id}` : "/api/computers", { method: comp ? "PATCH" : "POST", body: payload }); refresh(); }
    catch (e) { status.textContent = (e as Error).message; }
  };
  const del = async (): Promise<void> => { if (comp && (await appConfirm(`Remove computer ${comp.name}?`))) { await api(`/api/computers/${comp.id}`, { method: "DELETE" }); refresh(); } };
  return h("div", { class: "card min-w-0 overflow-hidden p-4" },
    h("div", { class: "mb-2 flex min-w-0 items-center gap-2" }, h("span", { class: "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" }, icon("terminal")), h("div", { class: "min-w-0 flex-1" }, name)),
    h("div", { class: "grid grid-cols-1 gap-2 sm:grid-cols-2" }, url, key),
    h("div", { class: "mt-2.5 flex flex-col gap-2 border-t border-line pt-2.5 sm:flex-row sm:items-center sm:justify-between" }, status,
      S.me.is_admin ? h("div", { class: "flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end" },
        comp ? h("button", { class: "btn-danger min-h-11 w-full text-xs sm:min-h-0 sm:w-auto", onclick: del }, icon("trash", 14), "Remove") : null,
        h("button", { class: "btn-primary min-h-11 w-full text-xs sm:min-h-0 sm:w-auto", onclick: save }, comp ? "Save" : "Add computer")) : null));
}

// ------------------------------------------------------------ members
function membersPanel(): HTMLElement {
  const wrap = h("div", { class: "space-y-2" });
  const refresh = async (): Promise<void> => { S.users = (await api<{ users: User[] }>("/api/users")).users; draw(); };
  const draw = (): void => {
    clear(wrap);
    const username = h("input", { class: "field", placeholder: "username", autocomplete: "off" }) as HTMLInputElement;
    const display = h("input", { class: "field", placeholder: "Display name", autocomplete: "off" }) as HTMLInputElement;
    const password = h("input", { class: "field", type: "password", placeholder: "Temporary password (8+ characters)", autocomplete: "new-password" }) as HTMLInputElement;
    const status = h("p", { class: "min-h-5 min-w-0 flex-1 break-words text-xs text-muted" });
    wrap.append(h("div", { class: "card mb-4 min-w-0 overflow-hidden p-4" },
      h("div", { class: "mb-3" }, h("div", { class: "font-semibold text-fg" }, "Add a workspace member"), h("p", { class: "mt-1 text-xs text-muted" }, "Public registration is closed after the Captain account. Share the username and temporary password directly with this person.")),
      h("div", { class: "grid grid-cols-1 gap-2 sm:grid-cols-3" }, username, display, password),
      h("div", { class: "mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, h("button", { class: "btn-primary min-h-11 w-full shrink-0 text-xs sm:min-h-0 sm:w-auto", onclick: async () => {
        status.textContent = "Adding…";
        try { await api("/api/admin/users", { body: { username: username.value, display: display.value, password: password.value } }); await refresh(); }
        catch (error) { status.textContent = (error as Error).message; }
      } }, icon("plus"), "Add member"))));
    S.users.forEach((u) => wrap.append(h("div", { class: "card flex min-w-0 flex-col gap-3 overflow-hidden p-3 sm:flex-row sm:items-center" },
      h("div", { class: "flex min-w-0 items-center gap-3" },
        avatar(u.display, "user", 9),
        h("div", { class: "min-w-0 flex-1" }, h("div", { class: "truncate font-semibold text-fg" }, u.display), h("div", { class: "truncate text-xs text-muted" }, "@" + u.username))),
      h("div", { class: "flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end" },
        h("label", { class: "flex min-h-11 items-center gap-1.5 text-xs text-muted sm:min-h-0" }, h("input", { type: "checkbox", class: "accent-accent", checked: u.is_admin, disabled: u.id === S.me.id, onchange: async (e: Event) => { await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { is_admin: (e.target as HTMLInputElement).checked } }); } }), "admin"),
        u.id === S.me.id ? h("span", { class: "chip" }, "you") : h("button", { class: "btn-danger min-h-11 text-xs sm:min-h-0", onclick: async () => { if (await appConfirm(`Delete ${u.display}?`)) { await api(`/api/admin/users/${u.id}`, { method: "DELETE" }); refresh(); } } }, "Delete")))));
  };
  draw();
  return wrap;
}

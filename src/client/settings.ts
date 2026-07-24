import { api, getToken, workspacePhotoSrc, type AccessRequest, type ChannelRuntime, type Collaboration, type Computer, type Skill, type SkillCatalogResult, type SkillCatalogStatus, type User, type WorkspaceDomain } from "./api.ts";
import { h, clear, add, icon } from "./dom.ts";
import { S, avatar, reloadProviders, renderApp, appAlert, appConfirm, appPrompt } from "./app.ts";
import { connectRoutingOauth, routingPanel } from "./routing.ts";
import { globalNotificationsMuted, setGlobalNotificationsMuted } from "./notifications.ts";

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
  return connectRoutingOauth("chatgpt", async () => { await reloadProviders(); });
}

// ============================================================ settings application page
type Tab = "admin" | "agents" | "skills" | "workflows" | "connections" | "notifications" | "feedback" | "audit" | "domains" | "providers" | "computers" | "members";
export function openSettings(tab: Tab = "agents"): void {
  document.querySelector<HTMLElement>("[data-settings-overlay]")?.remove();
  const overlay = h("div", { class: "modal-overlay fixed inset-0 z-40 bg-surface", dataset: { settingsOverlay: "", settingsTab: tab } });
  const bodyEl = h("main", { class: "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6 lg:p-8" });
  const page = h("div", { class: "flex h-full w-full flex-col overflow-hidden bg-surface" });
  const tabs: [Tab, string][] = S.me.is_admin
    ? [["admin", "Admin"], ["agents", "Agents"], ["skills", "Skills"], ["workflows", "Workflows"], ["connections", "Connections"], ["notifications", "Notifications"], ["feedback", "Feedback"], ["audit", "Audit"], ["domains", "Domains"], ["providers", "Providers"], ["computers", "Skipper computers"], ["members", "Members"]]
    : [["providers", "Providers"], ["notifications", "Notifications"]];
  if (!tabs.length) return;
  const tabBar = h("nav", { class: "grid w-full shrink-0 grid-cols-2 gap-1 border-b border-line bg-raised/30 p-3 sm:grid-cols-3 lg:w-64 lg:grid-cols-1 lg:border-b-0 lg:border-r lg:p-4", "aria-label": "Settings sections" });
  const draw = (t: Tab): void => {
    overlay.dataset.settingsTab = t;
    clear(tabBar);
    tabs.forEach(([id, label]) => tabBar.append(h("button", { class: `rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition ${t === id ? "bg-accent text-white shadow-sm" : "text-muted hover:bg-hover hover:text-fg"}`, type: "button", "aria-current": t === id ? "page" : undefined, onclick: () => draw(id) }, label)));
    clear(bodyEl);
    const content = t === "admin" ? adminPanel() : t === "agents" ? agentsPanel() : t === "skills" ? skillsPanel() : t === "workflows" ? workflowsPanel() : t === "connections" ? connectionsPanel() : t === "notifications" ? notificationsPanel() : t === "feedback" ? feedbackPanel() : t === "audit" ? auditPanel() : t === "domains" ? domainsPanel() : t === "providers" ? providersPanel() : t === "computers" ? computersPanel() : membersPanel();
    bodyEl.append(h("div", { class: `mx-auto w-full ${t === "providers" ? "max-w-7xl" : "max-w-5xl"}` }, h("div", { class: "mb-5" }, h("div", { class: "eyebrow text-accent" }, "Settings"), h("h1", { class: "font-display mt-1 text-3xl text-fg" }, tabs.find(([id]) => id === t)?.[1] || "Settings")), content));
  };
  page.append(
    h("div", { class: "flex items-center justify-between border-b border-line px-4 py-3 sm:px-5" },
      h("div", { class: "font-display flex items-center gap-2.5 text-[1.4rem] leading-tight text-fg" }, h("span", { class: "text-accent" }, icon("gear", 18)), "1Helm Settings"),
      h("button", { class: "grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg sm:h-8 sm:w-8", "aria-label": "Close settings", onclick: () => overlay.remove() }, icon("x"))),
    h("div", { class: "flex min-h-0 flex-1 flex-col lg:flex-row" }, tabBar, bodyEl));
  overlay.append(page);
  document.body.append(overlay);
  draw(tab);
}

/** Repaint only the open Skills control-plane view after a live arsenal change. */
export function refreshOpenSkillsSettings(): void {
  const overlay = document.querySelector<HTMLElement>("[data-settings-overlay]");
  if (overlay?.dataset.settingsTab !== "skills") return;
  overlay.remove();
  openSettings("skills");
}

const adminNote = (): HTMLElement => h("p", { class: "rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300" }, "Only admins can add or edit these.");

function notificationsPanel(): HTMLElement {
  const muted = h("input", { type: "checkbox", checked: globalNotificationsMuted(), class: "accent-accent" }) as HTMLInputElement;
  const status = h("p", { class: "min-h-5 text-sm text-muted" });
  muted.onchange = async () => {
    muted.disabled = true;
    status.textContent = "Saving…";
    try {
      await setGlobalNotificationsMuted(muted.checked);
      status.textContent = muted.checked ? "All notification sounds are muted for your account." : "Notification sounds are on for your account.";
    } catch (error) {
      muted.checked = !muted.checked;
      status.textContent = (error as Error).message;
    } finally { muted.disabled = false; }
  };
  return h("div", { class: "space-y-4" },
    h("section", { class: "card space-y-3 p-4" },
      h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Global sound"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "This preference belongs only to your 1Helm account and follows you across signed-in devices.")),
      h("label", { class: "flex items-start gap-3 rounded-lg border border-line bg-panel p-3" }, muted, h("span", {}, h("span", { class: "block text-sm font-semibold text-fg" }, "Mute all notification sounds"), h("span", { class: "mt-1 block text-xs leading-5 text-muted" }, "Visual unread badges and agent activity remain available."))),
      status),
    h("section", { class: "card p-4" }, h("h3", { class: "font-semibold text-fg" }, "Channel sounds"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Open any channel → Settings to mute that channel or choose its ping sound. Those choices are also private to your account.")));
}

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
    S.workspace = result.workspace; photo.src = workspacePhotoSrc(S.workspace.photo_url, Date.now()); document.querySelectorAll<HTMLImageElement>(".logo-asset").forEach((image) => { image.src = workspacePhotoSrc(S.workspace.photo_url, Date.now()); }); status.textContent = "Workspace photo updated.";
  };
  for (const hex of presetColors) presetRow.append(h("button", { class: "h-8 w-8 rounded-lg border border-line shadow-sm transition hover:scale-105", style: `background:${hex}`, title: hex, onclick: () => { void applyPreset(hex); } }));
  file.onchange = async () => {
    const image = file.files?.[0]; if (!image) return;
    status.textContent = "Uploading workspace photo…";
    const response = await fetch("/api/workspace/photo", { method: "POST", headers: { authorization: `Bearer ${getToken()}`, "content-type": image.type }, body: image });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { status.textContent = result.error || `HTTP ${response.status}`; return; }
    S.workspace = result.workspace; photo.src = workspacePhotoSrc(S.workspace.photo_url, Date.now()); document.querySelectorAll<HTMLImageElement>(".logo-asset").forEach((image) => { image.src = workspacePhotoSrc(S.workspace.photo_url, Date.now()); }); status.textContent = "Workspace photo updated.";
  };
  const save = async (): Promise<void> => {
    try { S.workspace = (await api<{ workspace: typeof S.workspace }>("/api/workspace", { method: "PATCH", body: { name: name.value, theme: theme.value } })).workspace; applyWorkspaceTheme(); document.querySelectorAll<HTMLElement>(".workspace-sidebar .truncate.text-\\[15px\\]").forEach((node) => { node.textContent = S.workspace.name; }); status.textContent = "Workspace settings saved."; }
    catch (error) { status.textContent = (error as Error).message; }
  };
  const removalStatus = h("p", { class: "min-h-5 text-sm text-muted" }, "Checking for 1Helm channel computers…");
  let removalBackend = "";
  const prepareRemoval = async (): Promise<void> => {
    const platformLabel = removalBackend === "apple" ? "Apple's VM runtime" : removalBackend === "wsl" ? "WSL 2" : removalBackend === "lxc" ? "the Linux LXC runtime" : "the active runtime";
    const confirmation = await appPrompt(`This deletes every verified 1Helm-owned channel computer from ${platformLabel}. Your durable 1Helm data remains intact.\n\nType **REMOVE 1HELM** to continue:`);
    if (confirmation !== "REMOVE 1HELM") { if (confirmation != null) removalStatus.textContent = "Removal preparation cancelled; confirmation did not match."; return; }
    removalStatus.textContent = "Preserving the latest channel files and deleting owned virtual machines…";
    try {
      const result = await api<{ deleted: number; remaining: number }>("/api/app/removal", { body: { confirmation } });
      removalStatus.textContent = `Ready to remove. Deleted ${result.deleted} channel computer${result.deleted === 1 ? "" : "s"}; ${result.remaining} remain. Quit 1Helm, then move the app to Trash.`;
    } catch (error) { removalStatus.textContent = (error as Error).message; }
  };
  void api<{ backend: string; machines: number }>("/api/app/removal").then((result) => {
    removalBackend = result.backend;
    removalStatus.textContent = ["apple", "lxc", "wsl"].includes(result.backend)
      ? `${result.machines} 1Helm-owned channel computer${result.machines === 1 ? "" : "s"} will be removed before uninstall.`
      : "No isolated channel computers are managed by this development installation.";
  }).catch((error) => { removalStatus.textContent = (error as Error).message; });
  return h("div", { class: "space-y-4" },
    h("div", { class: "card p-4" }, h("h3", { class: "font-semibold text-fg" }, "Workspace identity"), h("p", { class: "mt-1 text-sm text-muted" }, "Simple shared identity for everyone and every agent in this workspace."),
      h("div", { class: "mt-4 flex flex-col gap-4 sm:flex-row sm:items-center" }, photo, h("div", { class: "flex flex-wrap gap-2" }, h("label", { class: "btn-subtle cursor-pointer text-sm" }, "Choose photo", file), S.workspace.photo_url ? h("button", { class: "btn-ghost text-sm", onclick: async () => { S.workspace = (await api<{ workspace: typeof S.workspace }>("/api/workspace/photo", { method: "DELETE" })).workspace; photo.src = "/brand/1helm-sailboat.png"; document.querySelectorAll<HTMLImageElement>(".logo-asset").forEach((image) => { image.src = "/brand/1helm-sailboat.png"; }); } }, "Remove") : null)),
      h("div", { class: "mt-3" }, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Default colors"), presetRow),
      h("div", { class: "mt-4 grid gap-3 sm:grid-cols-2" }, h("label", {}, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Workspace name"), name), h("label", {}, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Color theme"), theme)),
      h("div", { class: "mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, h("button", { class: "btn-primary text-sm", onclick: () => { void save(); } }, "Save workspace"))),
    h("div", { class: "card border-danger/30 p-4" },
      h("h3", { class: "font-semibold text-fg" }, "Remove 1Helm"),
      h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Before uninstalling 1Helm, remove its isolated Linux channel computers from the host runtime. Durable workspace data stays in place in case you reinstall."),
      h("div", { class: "mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, removalStatus, h("button", { class: "btn-danger shrink-0 text-sm", onclick: () => { void prepareRemoval(); } }, "Prepare to remove 1Helm"))));
}

function applyWorkspaceTheme(): void {
  document.documentElement.dataset.workspaceTheme = S.workspace.theme || "graphite";
  localStorage.setItem("ctrl.workspaceTheme", S.workspace.theme || "graphite");
}

function skillsPanel(): HTMLElement {
  const wrap = h("div", { class: "space-y-3" },
    h("div", { class: "flex flex-col gap-3 rounded-lg border border-accent/30 bg-accent-soft p-4 sm:flex-row sm:items-center sm:justify-between" },
      h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Teach 1Helm from your own material"), h("p", { class: "mt-1 text-sm leading-5 text-muted" }, "Give Skipper a folder or file, a web page, pasted notes, or any combination. It will inspect the sources and author one reusable workspace skill in a visible #main thread.")),
      h("button", { class: "btn-primary shrink-0 text-sm", onclick: learnSkillDialog }, icon("sparkles", 15), "Learn a new skill")),
    h("p", { class: "text-sm leading-6 text-muted" }, "Every resident permanently owns the built-in operational library. Agents see a compact inventory and load a full procedure only when they choose that skill. You can also search SkillsMD for GitHub-backed skills."));
  void api<{ skills: Array<Skill & { arsenal_locked?: number; arsenal_reason?: string; assigned_agents?: number }>; catalog: SkillCatalogStatus }>("/api/skills").then(({ skills, catalog }) => {
    wrap.append(skillCatalogBrowser(catalog));
    const shipped = h("section", { class: "space-y-3" },
      h("div", { class: "flex flex-wrap items-end justify-between gap-2" }, h("div", {}, h("h3", { class: "font-display text-lg text-fg" }, "Installed arsenal"), h("p", { class: "text-sm text-muted" }, `${skills.length} complete procedures · permanently available · loaded on demand`))));
    for (const skill of skills) shipped.append(h("article", { class: `card p-4 ${skill.arsenal_locked ? "opacity-80" : ""}`, dataset: { skillSlug: skill.slug } },
      h("div", { class: "flex flex-wrap items-center gap-2" },
        h("h3", { class: "font-semibold text-fg" }, skill.name),
        h("span", { class: "chip" }, skill.category),
        skill.source === "shipped" ? h("span", { class: "chip" }, "built in") : null,
        skill.scan_status === "clean" && skill.provenance_identifier ? h("span", { class: "chip border-emerald-500/30 text-emerald-700 dark:text-emerald-300" }, "scanned") : null,
        skill.arsenal_locked ? h("span", { class: "chip border-amber-400/40 text-amber-600 dark:text-amber-300" }, "locked") : null,
        h("span", { class: "ml-auto text-xs text-muted" }, `${skill.assigned_agents || 0} agents`)),
      h("p", { class: "mt-2 text-sm leading-6 text-muted" }, skill.description),
      skill.provenance_identifier ? h("p", { class: "mt-2 break-all text-xs leading-5 text-muted" }, `${skill.trust_level || "external"} · ${skill.provenance_identifier}${skill.provenance_revision ? ` @ ${skill.provenance_revision.slice(0, 12)}` : ""}${skill.content_sha256 ? ` · sha256:${skill.content_sha256.slice(0, 12)}…` : ""}`) : null,
      skill.arsenal_locked && skill.arsenal_reason ? h("p", { class: "mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300" }, skill.arsenal_reason) : null));
    wrap.append(shipped);
  }).catch((error) => wrap.append(h("p", { class: "text-danger" }, (error as Error).message)));
  return wrap;
}

function skillCatalogBrowser(initial: SkillCatalogStatus): HTMLElement {
  const query = h("input", { class: "field min-w-0 flex-1", placeholder: "Search SkillsMD — Gmail, design, research, automation…", autocomplete: "off" }) as HTMLInputElement;
  const results = h("div", { class: "space-y-2" });
  const status = h("p", { class: "text-xs leading-5 text-muted" });
  const renderStatus = (state: SkillCatalogStatus): void => {
    status.textContent = state.available
      ? `${state.skill_count.toLocaleString()} repository records currently listed in SkillsMD's browse index${state.generated_at ? ` · updated ${state.generated_at.slice(0, 10)}` : ""} · searches query the live registry beyond that list`
      : `SkillsMD is not cached yet${state.error ? ` · ${state.error}` : " — the first search will fetch its index"}`;
  };
  renderStatus(initial);
  const install = async (entry: SkillCatalogResult, button: HTMLButtonElement): Promise<void> => {
    button.disabled = true; button.textContent = "Scanning…";
    try {
      await api("/api/skills/catalog/install", { body: { identifier: entry.identifier } });
      button.textContent = "Installed";
    } catch (error) { button.disabled = false; button.textContent = "Install"; void appAlert(`Skill not installed\n\n${(error as Error).message}`); }
  };
  const search = async (): Promise<void> => {
    const text = query.value.trim();
    if (!text) return;
    clear(results); results.append(h("p", { class: "py-4 text-sm text-muted" }, "Searching catalog metadata…"));
    try {
      const found = await api<{ status: SkillCatalogStatus; results: SkillCatalogResult[] }>(`/api/skills/catalog?q=${encodeURIComponent(text)}`);
      renderStatus(found.status); clear(results);
      if (found.results.length) results.append(h("p", { class: "text-xs text-muted", dataset: { skillSearchCount: "" } }, `${found.results.length.toLocaleString()} result${found.results.length === 1 ? "" : "s"} returned by SkillsMD`));
      if (!found.results.length) results.append(h("div", { class: "rounded-lg border border-line bg-raised/40 p-4 text-sm text-muted" }, h("p", {}, "SkillsMD returned no matches."), h("button", { class: "btn-subtle mt-3 text-xs", type: "button", onclick: learnSkillDialog }, "Use Learn a new skill")));
      for (const entry of found.results) {
        const button = h("button", { class: "btn-primary shrink-0 text-xs" }, "Inspect & install") as HTMLButtonElement;
        button.onclick = () => { void install(entry, button); };
        results.append(h("article", { class: "rounded-lg border border-border bg-panel p-3" },
          h("div", { class: "flex items-start gap-3" },
            h("div", { class: "min-w-0 flex-1" },
              h("div", { class: "flex flex-wrap items-center gap-2" }, h("h4", { class: "font-semibold text-fg" }, entry.name), h("span", { class: "chip" }, entry.source)),
              h("p", { class: "mt-1 text-sm leading-5 text-muted" }, entry.description || "No description supplied by the index."),
              h("p", { class: "mt-1 break-all text-xs text-muted" }, `${entry.identifier}${entry.repo ? ` · ${entry.repo}/${entry.path || ""}` : ""}`)),
            button)));
      }
    } catch (error) { clear(results); results.append(h("p", { class: "text-sm text-danger" }, (error as Error).message)); }
  };
  query.addEventListener("keydown", (event) => { if (event.key === "Enter") void search(); });
  return h("section", { class: "card space-y-3 p-4" },
    h("div", {}, h("h3", { class: "font-display text-lg text-fg" }, "SkillsMD library"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Search SkillsMD directly. 1Helm shows every result the open registry returns instead of deciding what you may browse. Installation then revision-pins, size-bounds, scans, hashes, and wraps the selected skill beneath its security boundary.")),
    h("div", { class: "flex gap-2" }, query, h("button", { class: "btn-primary", onclick: () => { void search(); } }, "Search")),
    status,
    results);
}

function learnSkillDialog(): void {
  const overlay = h("div", { class: "modal-overlay fixed inset-0 z-50 grid place-items-end bg-black/50 sm:place-items-center sm:p-5" });
  const path = h("input", { class: "field", placeholder: "/workspace/research or /path/to/file", autocomplete: "off" }) as HTMLInputElement;
  const url = h("input", { class: "field", type: "url", placeholder: "https://example.com/guide", autocomplete: "url" }) as HTMLInputElement;
  const notes = h("textarea", { class: "field min-h-32 resize-y", placeholder: "Paste notes, describe the current workflow, and say what the reusable skill should focus on." }) as HTMLTextAreaElement;
  const status = h("p", { class: "min-h-5 text-sm text-muted" });
  const close = (): void => overlay.remove();
  const learn = async (): Promise<void> => {
    status.textContent = "Opening a Skipper learning thread…";
    try {
      const result = await api<{ channelId: number; rootMessageId: number }>("/api/skills/learn", { body: { path: path.value, url: url.value, notes: notes.value } });
      close();
      location.assign(`/c/main/thread/${result.rootMessageId}`);
    } catch (error) { status.textContent = (error as Error).message; }
  };
  const modal = h("div", { class: "card mobile-sheet w-full max-w-[660px] space-y-4 rounded-b-none p-5 shadow-2xl sm:rounded-xl" },
    h("div", { class: "flex items-start justify-between gap-3" }, h("div", {}, h("h2", { class: "font-display text-xl text-fg" }, "Learn a new skill"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Add any sources you have. Skipper can combine them and will use its normal tools while you watch.")), h("button", { class: "grid h-9 w-9 place-items-center rounded text-muted hover:bg-hover", "aria-label": "Close", onclick: close }, icon("x"))),
    h("div", { class: "grid gap-3 sm:grid-cols-2" }, h("label", { class: "space-y-1 text-xs font-semibold text-fg" }, "Local source (optional)", path), h("label", { class: "space-y-1 text-xs font-semibold text-fg" }, "Web URL (optional)", url)),
    h("label", { class: "block space-y-1 text-xs font-semibold text-fg" }, "Notes and requirements (optional)", notes),
    status,
    h("div", { class: "flex justify-end gap-2" }, h("button", { class: "btn-subtle", onclick: close }, "Cancel"), h("button", { class: "btn-primary", onclick: () => { void learn(); } }, "Start learning")));
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  overlay.append(modal); document.body.append(overlay); notes.focus();
}

type PhotonMapping = { channel_id: number; channel_name: string; agent_name: string; allowed_users: string; updated: number };
type PhotonStatus = { configured: boolean; connected: boolean; project_id: string; operator_phone: string; assigned_phone: string; secret: "stored" | "missing"; mappings: PhotonMapping[] };
type PhotonSetup = { active: boolean; status?: string | PhotonStatus; operator_phone?: string; user_code?: string; verification_uri?: string; verification_uri_complete?: string; expires_at?: number; error?: string; connector?: PhotonStatus };
type GmailStatus = { accounts: string[]; has_oauth_client: boolean; setup: { active: boolean; status: string; authorization_url?: string; manual_completion?: boolean; error?: string } };

function gmailConnectionPanel(): HTMLElement {
  const card = h("section", { class: "card space-y-4 p-4" }, h("p", { class: "text-sm text-muted" }, "Checking Gmail…"));
  let timer: ReturnType<typeof setTimeout> | null = null;
  let callbackDraft = "";
  const draw = async (): Promise<void> => {
    try {
      const { gmail } = await api<{ gmail: GmailStatus }>("/api/connectors/gmail");
      clear(card);
      const connected = gmail.accounts.length > 0;
      const connect = h("button", { class: "btn-primary text-sm", type: "button", onclick: async () => {
          try {
            const result = await api<{ gmail: GmailStatus }>("/api/connectors/gmail/setup", { body: {} });
            const destination = result.gmail.setup.authorization_url;
            if (destination) window.open(destination, "_blank", "noopener,noreferrer");
            await draw();
          } catch (error) { void appAlert((error as Error).message); }
        } }, connected ? "Connect another" : "Connect Gmail");
      const copy = h("div", {},
        h("div", { class: "flex flex-wrap items-center gap-2" },
          h("h3", { class: "font-display text-lg text-fg" }, "Gmail"),
          h("span", { class: `chip ${connected ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "border-amber-400/40 text-amber-700 dark:text-amber-300"}` }, connected ? `${gmail.accounts.length} connected` : "Not connected")),
        h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "1Helm owns the OAuth tokens on this host. Skipper can search, read, and draft; resident computers never receive credentials and sending stays disabled."));
      card.append(h("div", { class: "flex flex-wrap items-start justify-between gap-3" }, copy, connect));
      if (gmail.setup.authorization_url) card.append(h("a", { class: "btn-primary inline-flex w-fit text-sm", href: gmail.setup.authorization_url, target: "_blank", rel: "noopener noreferrer" }, "Authorize with Google"));
      if (gmail.setup.active && gmail.setup.manual_completion) {
        const callback = h("input", { class: "field font-mono text-xs", value: callbackDraft, placeholder: "http://127.0.0.1:.../gmail/callback?state=...&code=...", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
        callback.onfocus = () => { if (timer) { clearTimeout(timer); timer = null; } };
        callback.oninput = () => { callbackDraft = callback.value; };
        const callbackStatus = h("p", { class: "min-h-5 text-xs text-muted" });
        const complete = h("button", { class: "btn-primary shrink-0 text-sm", type: "button", onclick: async () => {
          complete.disabled = true; callbackStatus.textContent = "Completing securely on the 1Helm host…";
          try {
            await api("/api/connectors/gmail/callback", { body: { callback_url: callback.value } });
            callbackDraft = ""; await draw();
          } catch (error) { callbackStatus.textContent = (error as Error).message; complete.disabled = false; }
        } }, "Complete connection") as HTMLButtonElement;
        card.append(h("div", { class: "rounded-lg border border-line bg-panel p-4", dataset: { gmailManualCallback: "" } },
          h("h4", { class: "font-semibold text-fg" }, "If the localhost page cannot load"),
          h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "That is expected when Google opened on a different device. Copy the complete 127.0.0.1 URL from that browser's address bar and paste it here. 1Helm validates its one-time state and PKCE verifier, then exchanges the code on the host; it never fetches the pasted URL."),
          h("div", { class: "mt-3 flex flex-col gap-2 sm:flex-row" }, callback, complete), callbackStatus));
      }
      if (gmail.accounts.length) card.append(h("div", { class: "grid gap-2 sm:grid-cols-2" }, ...gmail.accounts.map((account) => h("div", { class: "rounded-lg border border-line bg-panel px-3 py-2" }, h("div", { class: "font-semibold text-fg" }, account), h("div", { class: "mt-0.5 text-xs text-muted" }, "Read · search · draft · host-owned")))));
      if (!gmail.has_oauth_client) {
        const picker = h("input", { type: "file", accept: "application/json,.json", class: "hidden" }) as HTMLInputElement;
        const status = h("p", { class: "min-h-5 text-xs text-muted" });
        picker.onchange = async () => {
          const file = picker.files?.[0]; if (!file) return;
          try { const client = JSON.parse(await file.text()); await api("/api/connectors/gmail/client", { body: { client } }); status.textContent = "Google OAuth client saved privately on this host."; await draw(); }
          catch (error) { status.textContent = (error as Error).message; }
        };
        card.append(h("div", { class: "rounded-lg border border-line bg-panel p-4" }, h("h4", { class: "font-semibold text-fg" }, "One-time Google OAuth client"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Create a Desktop app OAuth client in Google Cloud, enable the Gmail API, then choose its downloaded JSON file. The client and every account token remain in 1Helm's private Application Support data."), h("div", { class: "mt-3 flex flex-wrap items-center gap-3" }, h("button", { class: "btn-subtle text-sm", type: "button", onclick: () => picker.click() }, "Choose client JSON"), status, picker)));
      }
      if (gmail.setup.error) card.append(h("p", { class: "text-sm text-danger" }, gmail.setup.error));
      if (timer) clearTimeout(timer);
      if (gmail.setup.active && !callbackDraft) timer = setTimeout(() => { void draw(); }, 1500);
    } catch (error) { clear(card); card.append(h("p", { class: "text-sm text-danger" }, (error as Error).message)); }
  };
  void draw();
  return card;
}

function connectionsPanel(): HTMLElement {
  const box = h("section", { class: "card space-y-4 p-4" }, h("p", { class: "text-sm text-muted" }, "Checking Photon…"));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stopPolling = (): void => { if (timer) clearTimeout(timer); timer = null; };
  const refresh = async (): Promise<void> => {
    try {
      const [{ photon }, { photon: setup }] = await Promise.all([
        api<{ photon: PhotonStatus }>("/api/connectors/photon"),
        api<{ photon: PhotonSetup }>("/api/connectors/photon/setup"),
      ]);
      clear(box);
      box.append(
        h("div", { class: "flex flex-wrap items-start justify-between gap-3" },
          h("div", {}, h("div", { class: "flex flex-wrap items-center gap-2" }, h("h3", { class: "font-display text-lg text-fg" }, "Photon · iMessage"), h("span", { class: `chip ${photon.connected ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "border-amber-400/40 text-amber-700 dark:text-amber-300"}` }, photon.connected ? "Connected" : photon.configured ? "Reconnecting" : "Not configured")), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "A supervised loopback connector streams task-scoped messages into the mapped resident. Photon credentials stay on the 1Helm host; residents never receive the Mac Messages database.")),
          photon.assigned_phone ? h("div", { class: "text-right text-xs text-muted" }, "Text 1Helm at", h("strong", { class: "mt-1 block text-sm text-fg" }, photon.assigned_phone)) : null),
      );
      if (!photon.configured || ["waiting", "provisioning", "failed", "expired"].includes(String(setup.status || ""))) {
        const phone = h("input", { class: "field", type: "tel", placeholder: "+15551234567", value: setup.operator_phone || photon.operator_phone || "", autocomplete: "tel" }) as HTMLInputElement;
        const setupStatus = h("p", { class: `min-h-5 text-sm ${setup.error ? "text-danger" : "text-muted"}` }, setup.error || (setup.status === "provisioning" ? "Login approved. Creating or reusing the 1Helm Photon project, rotating its secret, and assigning your line…" : ""));
        const start = h("button", { class: "btn-primary text-sm", onclick: async () => {
          start.disabled = true; setupStatus.textContent = "Starting secure device login…";
          try { await api("/api/connectors/photon/setup", { body: { operator_phone: phone.value } }); await refresh(); }
          catch (error) { start.disabled = false; setupStatus.textContent = (error as Error).message; }
        } }, setup.active ? "Restart login" : "Connect Photon") as HTMLButtonElement;
        box.append(h("div", { class: "rounded-lg border border-border bg-panel p-4" },
          h("p", { class: "text-sm leading-6 text-muted" }, "Enter the phone allowed to text this 1Helm installation. 1Helm opens Photon's device flow, creates or reuses its project, rotates the runtime secret, registers the phone, discovers the assigned iMessage line, and verifies the live sidecar."),
          h("div", { class: "mt-3 flex flex-col gap-2 sm:flex-row" }, phone, start), setupStatus));
      }
      if (setup.active && setup.user_code) {
        const destination = setup.verification_uri_complete || setup.verification_uri || "https://app.photon.codes";
        box.append(h("div", { class: "rounded-lg border border-accent/30 bg-accent-soft p-4" }, h("p", { class: "text-xs font-semibold uppercase tracking-wide text-muted" }, "Approve Photon login"), h("div", { class: "mt-2 flex flex-wrap items-center gap-3" }, h("code", { class: "rounded bg-panel px-3 py-2 text-lg font-bold text-fg" }, setup.user_code), h("a", { class: "btn-primary text-sm", href: destination, target: "_blank", rel: "noopener noreferrer" }, "Open Photon ↗")), h("p", { class: "mt-2 text-xs text-muted" }, "This page updates automatically after approval.")));
      }
      if (photon.configured) {
        const main = S.channels.find((entry) => entry.kind === "channel" && entry.name === "main" && entry.agent);
        const channel = h("select", { class: "field" }, ...S.channels.filter((entry) => entry.kind === "channel" && entry.agent).map((entry) => h("option", { value: String(entry.id), selected: entry.id === main?.id || undefined }, `#${entry.name} · @${entry.agent!.name}`))) as HTMLSelectElement;
        const allowed = h("input", { class: "field", type: "tel", placeholder: photon.operator_phone || "+15551234567", value: photon.operator_phone || "", autocomplete: "tel" }) as HTMLInputElement;
        const mappingStatus = h("p", { class: "min-h-5 text-sm text-muted" });
        const map = h("button", { class: "btn-primary text-sm", onclick: async () => {
          map.disabled = true; mappingStatus.textContent = "Applying least-privilege mapping…";
          try { await api("/api/connectors/photon/map", { body: { channel_id: Number(channel.value), allowed_users: allowed.value.split(",").map((value) => value.trim()).filter(Boolean) } }); await refresh(); }
          catch (error) { map.disabled = false; mappingStatus.textContent = (error as Error).message; }
        } }, "Map conversation") as HTMLButtonElement;
        box.append(h("div", { class: "space-y-3" }, h("div", {}, h("h4", { class: "font-semibold text-fg" }, "Conversation mappings"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "#main and Skipper are the default. An allowlisted inbound message opens a real thread, invokes the mapped agent, and 1Helm automatically returns that agent's final reply to the same authorized iMessage conversation.")),
          ...photon.mappings.map((mapping) => h("div", { class: "rounded-lg border border-border bg-panel p-3" }, h("div", { class: "font-semibold text-fg" }, `#${mapping.channel_name} · @${mapping.agent_name}`), h("div", { class: "mt-1 text-xs text-muted" }, `Allowlisted: ${(() => { try { return (JSON.parse(mapping.allowed_users) as string[]).join(", "); } catch { return "invalid mapping"; } })()}`))),
          h("div", { class: "grid gap-2 sm:grid-cols-[1fr_1fr_auto]" }, channel, allowed, map), mappingStatus));
      }
      if (setup.active) { stopPolling(); timer = setTimeout(() => { void refresh(); }, 2000); }
      else stopPolling();
    } catch (error) { stopPolling(); clear(box); box.append(h("p", { class: "text-sm text-danger" }, (error as Error).message)); }
  };
  void refresh();
  return h("div", { class: "space-y-4" },
    h("div", { class: "rounded-lg border border-accent/25 bg-accent-soft px-4 py-3 text-sm leading-6 text-fg" }, "Connections are host-brokered capabilities. Residents receive the minimum task-scoped interface—not account secrets or your personal computer."),
    gmailConnectionPanel(), box,
    h("section", { class: "card p-4 opacity-80" }, h("h3", { class: "font-display text-lg text-fg" }, "More connections"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Calendar, contacts, Slack, and other messaging brokers are added only when 1Helm can enforce task scope, recovery, and auditability.")));
}

type FeedbackReport = {
  id?: number;
  public_id: string;
  comment: string;
  state: string;
  last_error?: string;
  created: number;
  user_display?: string;
  username?: string;
  diagnostics: Record<string, unknown>;
  attachments?: Array<{ id: number; name: string; mime: string; size: number }>;
};
function feedbackPanel(): HTMLElement {
  const wrap = h("div", { class: "space-y-3", dataset: { feedbackInbox: "" } }, h("p", { class: "text-sm text-muted" }, "Loading feedback…"));
  void api<{ reports: FeedbackReport[]; central: FeedbackReport[] }>("/api/feedback").then(({ reports, central }) => {
    clear(wrap);
    const combined = [...reports, ...(central || []).filter((remote) => !reports.some((local) => local.public_id === remote.public_id))];
    wrap.append(h("div", { class: "rounded-lg border border-accent/25 bg-accent-soft px-4 py-3 text-sm leading-6 text-fg" },
      "Feedback is saved on this host first and relayed to the 1Helm team with automatic retries. Diagnostics are opt-in and exclude conversations, prompts, account content, terminal output, credentials, and OAuth material. Company contact: ",
      h("a", { class: "text-accent hover:underline", href: "mailto:build@1helm.com", target: "_blank", rel: "noopener" }, "build@1helm.com"),
      "."));
    if (!combined.length) {
      wrap.append(h("div", { class: "card p-6 text-center text-sm text-muted" }, "No feedback reports yet."));
      return;
    }
    for (const report of combined) {
      const diagnostics = JSON.stringify(report.diagnostics || {}, null, 2);
      wrap.append(h("article", { class: "card space-y-3 p-4", dataset: { feedbackReport: report.public_id } },
        h("div", { class: "flex flex-wrap items-start justify-between gap-3" },
          h("div", {},
            h("div", { class: "font-semibold text-fg" }, report.user_display || report.username || "Workspace member"),
            h("div", { class: "mt-0.5 font-mono text-[11px] text-muted" }, report.public_id)),
          h("div", { class: "text-right" },
            h("span", { class: "chip" }, report.state),
            h("div", { class: "mt-1 text-xs text-muted" }, new Date(report.created).toLocaleString()))),
        h("p", { class: "whitespace-pre-wrap text-sm leading-6 text-fg" }, report.comment || "(attachment-only report)"),
        report.id && report.attachments?.length ? h("div", { class: "flex flex-wrap gap-2" }, ...report.attachments.map((attachment) => h("a", {
          class: "btn-subtle text-xs",
          href: `/api/feedback/${report.id}/attachments/${attachment.id}`,
          target: "_blank",
          rel: "noopener",
        }, `${attachment.name} · ${Math.ceil(attachment.size / 1024)} KB`))) : null,
        diagnostics !== "{}" ? h("details", { class: "rounded-lg border border-line bg-panel p-3" },
          h("summary", { class: "cursor-pointer text-xs font-semibold text-fg" }, "Privacy-bounded diagnostics"),
          h("pre", { class: "mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted" }, diagnostics)) : null,
        report.last_error ? h("p", { class: "text-xs text-danger" }, `Delivery: ${report.last_error}`) : null));
    }
  }).catch((error) => {
    clear(wrap);
    wrap.append(h("p", { class: "text-sm text-danger" }, (error as Error).message));
  });
  return wrap;
}

type AgentWorkflow = { id: number; channel_id: number; agent_id: number; name: string; prompt: string; interval_seconds: number; next_run: number; last_run: number | null; run_count: number; max_runs: number; status: "active" | "paused" | "complete" | "failed"; last_error: string };
function workflowsPanel(): HTMLElement {
  const wrap = h("div", { class: "space-y-4" });
  const list = h("div", { class: "space-y-2" }, h("p", { class: "text-sm text-muted" }, "Loading recurring workflows…"));
  const load = async (): Promise<void> => {
    try {
      const { workflows } = await api<{ workflows: AgentWorkflow[] }>("/api/workflows");
      clear(list);
      if (!workflows.length) list.append(h("p", { class: "card p-5 text-center text-sm text-muted" }, "No recurring workflows yet. Ask a resident to repeat an outcome on a schedule, or create one here."));
      for (const workflow of workflows) {
        const channel = S.channels.find((entry) => entry.id === workflow.channel_id);
        const action = workflow.status === "active" ? "paused" : workflow.status === "paused" ? "active" : "complete";
        const details = h("div", { class: "min-w-0 flex-1" },
          h("div", { class: "flex flex-wrap items-center gap-2" },
            h("h3", { class: "font-semibold text-fg" }, workflow.name),
            h("span", { class: "chip" }, workflow.status),
            channel ? h("span", { class: "chip" }, `#${channel.name}`) : null),
          h("p", { class: "mt-2 whitespace-pre-wrap text-sm leading-6 text-muted" }, workflow.prompt),
          h("p", { class: "mt-2 text-xs text-faint" }, `Every ${workflow.interval_seconds.toLocaleString()}s · ${workflow.run_count}${workflow.max_runs ? ` / ${workflow.max_runs}` : ""} runs · next ${new Date(workflow.next_run).toLocaleString()}${workflow.last_run ? ` · last ${new Date(workflow.last_run).toLocaleString()}` : ""}${workflow.last_error ? ` · ${workflow.last_error}` : ""}`));
        const control = workflow.status === "active" || workflow.status === "paused"
          ? h("button", { class: "btn-subtle shrink-0 text-xs", onclick: async () => { await api(`/api/workflows/${workflow.id}`, { method: "PATCH", body: { channel_id: workflow.channel_id, status: action } }); await load(); } }, action === "active" ? "Resume" : "Pause")
          : null;
        list.append(h("article", { class: "card p-4" }, h("div", { class: "flex flex-wrap items-start gap-2" }, details, control)));
      }
    } catch (error) { clear(list); list.append(h("p", { class: "text-danger" }, (error as Error).message)); }
  };
  const channel = h("select", { class: "field" }, h("option", { value: "" }, "Choose resident channel"), ...S.channels.filter((entry) => entry.kind === "channel" && entry.name !== "main" && entry.agent).map((entry) => h("option", { value: String(entry.id) }, `#${entry.name} · @${entry.agent!.name}`))) as HTMLSelectElement;
  const name = h("input", { class: "field", placeholder: "Weekly launch evidence" }) as HTMLInputElement;
  const prompt = h("textarea", { class: "field min-h-28 resize-y", placeholder: "Inspect the launch evidence, resolve routine gaps, and publish a verified status report with source links." }) as HTMLTextAreaElement;
  const interval = h("input", { class: "field", type: "number", min: "60", value: "604800", title: "Interval in seconds" }) as HTMLInputElement;
  const maxRuns = h("input", { class: "field", type: "number", min: "0", value: "0", title: "Maximum runs; 0 repeats indefinitely" }) as HTMLInputElement;
  const status = h("p", { class: "min-h-5 text-sm text-muted" });
  const create = async (): Promise<void> => { status.textContent = "Creating durable workflow…"; try { await api("/api/workflows", { body: { channel_id: Number(channel.value), name: name.value, prompt: prompt.value, interval_seconds: Number(interval.value), max_runs: Number(maxRuns.value) } }); name.value = ""; prompt.value = ""; status.textContent = "Workflow scheduled."; await load(); } catch (error) { status.textContent = (error as Error).message; } };
  wrap.append(h("div", { class: "rounded-lg border border-accent/25 bg-accent-soft px-4 py-3 text-sm leading-6 text-fg" }, "Recurring workflows are durable obligations, not haunted cron jobs. Each due run opens a real thread and invokes the same resident with its computer, memory, skills, and verification contract."),
    h("section", { class: "card space-y-3 p-4" }, h("h3", { class: "font-display text-lg text-fg" }, "Create recurring workflow"), h("div", { class: "grid gap-2 sm:grid-cols-2" }, channel, name), prompt, h("div", { class: "grid gap-2 sm:grid-cols-[1fr_1fr_auto]" }, h("label", { class: "text-xs font-semibold text-muted" }, "Interval seconds", interval), h("label", { class: "text-xs font-semibold text-muted" }, "Maximum runs · 0 forever", maxRuns), h("button", { class: "btn-primary self-end", onclick: () => { void create(); } }, "Schedule")), status), list);
  void load(); return wrap;
}

type AuditVerification = { valid: boolean; events: number; head: string; first_invalid_sequence: number | null };
type AuditEvent = { sequence: number; channel_id: number | null; event_type: string; payload: unknown; created: number; hash: string };
function auditPanel(): HTMLElement {
  const box = h("div", { class: "space-y-3" }, h("p", { class: "text-sm text-muted" }, "Verifying operational history…"));
  void api<{ verification: AuditVerification; events: AuditEvent[] }>("/api/audit/events?limit=200").then(({ verification, events }) => {
    clear(box);
    box.append(h("div", { class: `rounded-lg border p-4 ${verification.valid ? "border-emerald-500/30 bg-emerald-500/10" : "border-danger/40 bg-danger/10"}` }, h("div", { class: "flex flex-wrap items-center gap-2" }, h("h3", { class: "font-display text-lg text-fg" }, verification.valid ? "Audit chain verified" : "Audit chain verification failed"), h("span", { class: "chip" }, `${verification.events} chained events`)), h("p", { class: "mt-1 break-all text-xs leading-5 text-muted" }, verification.valid ? `Current head sha256:${verification.head || "empty"}` : `First invalid sequence: ${verification.first_invalid_sequence}. Do not rely on subsequent history.`)),
      h("p", { class: "text-sm leading-6 text-muted" }, "New activity, tool starts/results, and external-skill decisions enter one append-only SHA-256 chain. Historical rows created before this release are not backfilled."));
    for (const event of events.slice().reverse()) box.append(h("article", { class: "card p-3" }, h("div", { class: "flex flex-wrap gap-2 text-xs text-muted" }, h("span", { class: "chip" }, `#${event.sequence}`), h("span", {}, event.event_type), h("span", { class: "ml-auto" }, new Date(event.created).toLocaleString())), h("pre", { class: "mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-fg" }, JSON.stringify(event.payload, null, 2)), h("p", { class: "mt-2 break-all text-[10px] text-faint" }, `sha256:${event.hash}`)));
  }).catch((error) => { clear(box); box.append(h("p", { class: "text-danger" }, (error as Error).message)); });
  return box;
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
  return h("div", { class: "space-y-4" }, collaborationPanel(), h("div", { class: "card p-4" }, h("h3", { class: "font-semibold text-fg" }, "Connect a Cloudflare domain"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Do you have a domain on Cloudflare? Enter the hostname you want for this workspace. Once active it becomes the displayed primary address; your reserved 1helm.com address remains yours."), h("div", { class: "mt-4 grid gap-3 sm:grid-cols-2" }, hostname, token), h("p", { class: "mt-2 text-xs text-muted" }, "Create an API token with Account: Cloudflare Tunnel Edit and Zone: DNS Edit. The token is used for this connection and is never stored."), h("div", { class: "mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, h("button", { class: "btn-primary text-sm", onclick: () => { void connect(); } }, "Connect domain"))), list);
}

function collaborationPanel(): HTMLElement {
  const box = h("div", { class: "card p-4" }, h("p", { class: "text-sm text-muted" }, "Loading collaboration…"));
  const draw = async (): Promise<void> => {
    try {
      const { collaboration } = await api<{ collaboration: Collaboration }>("/api/collaboration");
      clear(box);
      const status = h("p", { class: "min-h-5 text-xs text-muted" }, collaboration.error || (collaboration.enabled ? "This Mac is serving the workspace through its secure tunnel." : collaboration.slug ? "The address remains reserved while its connector is off." : "Choose a permanent workspace address."));
      if (!collaboration.slug) {
        const slug = h("input", { class: "field", placeholder: "your-team", autocomplete: "off" }) as HTMLInputElement;
        const availability = h("p", { class: "min-h-5 text-xs text-muted" });
        let timer: ReturnType<typeof setTimeout> | null = null;
        slug.oninput = () => {
          slug.value = slug.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 48);
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => { void api<{ available: boolean; hostname: string }>(`/api/collaboration/slug?slug=${encodeURIComponent(slug.value)}`).then((result) => { availability.textContent = result.available ? `${result.hostname} is available.` : `${result.hostname} is not available.`; availability.className = `min-h-5 text-xs ${result.available ? "text-ok" : "text-danger"}`; }).catch((error) => { availability.textContent = (error as Error).message; }); }, 350);
        };
        box.append(h("h3", { class: "font-semibold text-fg" }, "Collaborate from this Mac"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Reserve a unique 1helm.com address for this local headless workspace. This installed Mac remains the only server."), h("div", { class: "mt-4" }, slug, availability), h("div", { class: "mt-3 flex items-center justify-between gap-3" }, status, h("button", { class: "btn-primary text-sm", onclick: async () => { try { await api("/api/collaboration/claim", { body: { slug: slug.value, workspace_name: S.workspace.name } }); await draw(); } catch (error) { status.textContent = (error as Error).message; } } }, "Reserve and enable")));
        return;
      }
      const enabled = h("input", { type: "checkbox", class: "accent-accent", checked: collaboration.enabled }) as HTMLInputElement;
      enabled.onchange = async () => { enabled.disabled = true; try { await api("/api/collaboration/enabled", { body: { enabled: enabled.checked } }); await draw(); } catch (error) { status.textContent = (error as Error).message; enabled.checked = !enabled.checked; enabled.disabled = false; } };
      box.append(h("div", { class: "flex flex-wrap items-start justify-between gap-3" }, h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Collaboration address"), h("a", { class: "mt-1 block break-all text-sm text-accent hover:underline", href: `https://${collaboration.hostname}`, target: "_blank", rel: "noopener noreferrer" }, collaboration.hostname), collaboration.custom_domain ? h("p", { class: "mt-1 text-xs text-muted" }, `Primary: ${collaboration.custom_domain}`) : null), h("label", { class: "flex items-center gap-2 text-sm text-fg" }, enabled, "Collaborate")), status,
        h("p", { class: "mt-2 text-xs leading-5 text-muted" }, "Switching this off stops the connector; the address and tunnel remain reserved for this workspace."));
    } catch (error) { box.textContent = (error as Error).message; }
  };
  void draw();
  return box;
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
          h("div", { class: "mt-1 break-words text-xs text-faint" }, `${agent.status} · ${agent.provider_kind === "routing" ? "Model fabric" : agent.provider_name || "no provider"} · ${agent.model || "no model"}`))),
      h("button", { class: "btn-subtle min-h-11 w-full shrink-0 text-xs sm:min-h-0 sm:w-auto", onclick: () => { document.querySelector<HTMLElement>(".fixed.inset-0.z-40")?.remove(); S.channelId = channel.id; S.view = "settings"; renderApp(); } }, "Open channel"))),
    !agents.length ? h("p", { class: "py-8 text-center text-sm text-muted" }, "Complete setup, then create a channel to provision its resident agent world.") : null);
}

// ------------------------------------------------------------ providers
function providersPanel(): HTMLElement {
  return routingPanel(!!S.me.is_admin, appConfirm);
}

// ------------------------------------------------------------ computers
function computersPanel(): HTMLElement {
  const wrap = h("div", { class: "space-y-3" });
  const runtimeBox = h("div", { class: "card p-4" }, h("p", { class: "text-sm text-muted" }, "Checking channel computer runtime…"));
  const list = h("div", { class: "space-y-3" });
  const refresh = async (): Promise<void> => { S.computers = (await api<{ computers: Computer[] }>("/api/computers")).computers; draw(); };
  const draw = (): void => { clear(list); S.computers.forEach((c) => list.append(computerCard(c, refresh))); if (!S.computers.length) list.append(h("p", { class: "py-6 text-center text-sm text-muted" }, "No computers yet.")); };
  add(wrap,
    runtimeBox,
    h("div", { class: "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" },
      h("p", { class: "min-w-0 text-sm leading-5 text-muted" }, "Optional computers you own for Captain-authorized Skipper work. These do not replace the private Linux computer each ordinary channel receives automatically."),
      S.me.is_admin ? h("button", { class: "btn-primary min-h-11 w-full shrink-0 text-sm sm:min-h-0 sm:w-auto", onclick: () => list.prepend(computerCard(null, refresh)) }, icon("plus"), "Add a computer") : null),
    S.me.is_admin ? null : adminNote(), list);
  draw();
  const paintRuntime = (runtime: ChannelRuntime): void => {
    clear(runtimeBox);
    if (runtime.backend === "native" || runtime.backend === "mock") {
      runtimeBox.append(h("h3", { class: "font-semibold text-fg" }, "Channel computers · development backend"), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "This explicit development seam runs without production VM isolation."));
      return;
    }
    if (runtime.backend === "lxc" || runtime.backend === "wsl") {
      const label = runtime.backend === "lxc" ? "Unprivileged LXC" : "Private WSL 2";
      const readyCopy = runtime.backend === "lxc"
        ? "The root-owned LXC boundary is healthy. Skipper manages one persistent unprivileged Linux container per ordinary channel."
        : "WSL 2 is healthy. Skipper manages one persistent private Linux distribution per ordinary channel.";
      const setupCopy = runtime.backend === "lxc"
        ? "Rerun the verified 1Helm Linux host installer to repair the LXC helper, bridge, cgroups, or pinned image assets."
        : "Complete 1Helm's one-time Windows administrator setup to enable WSL 2.";
      const actionStatus = h("p", { class: "mt-2 text-sm text-muted" });
      const windowsSetup = runtime.backend === "wsl" && !runtime.ready ? h("button", { class: "btn-primary mt-3 text-sm", onclick: async () => {
        actionStatus.textContent = "Opening Windows' WSL 2 administrator setup…";
        try { await api("/api/channel-computers/runtime/install", { body: {} }); actionStatus.textContent = "Finish the Windows prompt. Restart once if Windows requests it, then reopen 1Helm."; }
        catch (error) { actionStatus.textContent = (error as Error).message; }
      } }, "Set up WSL 2") : null;
      runtimeBox.append(
        h("div", { class: "flex flex-wrap items-center gap-2" }, h("h3", { class: "font-semibold text-fg" }, "Channel computers"), h("span", { class: "chip border-accent/25" }, runtime.ready ? `${label} ready` : "Setup required")),
        h("p", { class: "mt-1 text-sm leading-6 text-muted" }, runtime.ready ? readyCopy : setupCopy),
        ...(runtime.error ? [h("p", { class: "mt-2 text-sm text-danger" }, runtime.error)] : []),
        ...(windowsSetup ? [windowsSetup] : []), actionStatus,
      );
      return;
    }
    const actionStatus = h("p", { class: "mt-2 text-sm text-muted" });
    const action = !runtime.supported
      ? null
      : !runtime.cli
      ? h("button", { class: "btn-primary mt-3 text-sm", onclick: async () => {
        actionStatus.textContent = "Downloading and verifying Apple's signed installer…";
        try { await api("/api/channel-computers/runtime/install", { body: {} }); actionStatus.textContent = "macOS Installer is open. Approve it once, then choose Finish setup."; }
        catch (error) { actionStatus.textContent = (error as Error).message; }
      } }, "Install verified Apple runtime")
      : !runtime.ready
        ? h("button", { class: "btn-primary mt-3 text-sm", onclick: async () => {
          actionStatus.textContent = "Starting Apple's runtime and checking its health…";
          try { const result = await api<{ runtime: ChannelRuntime }>("/api/channel-computers/runtime/start", { body: {} }); paintRuntime(result.runtime); }
          catch (error) { actionStatus.textContent = (error as Error).message; }
        } }, "Finish setup")
        : null;
    runtimeBox.append(
      h("div", { class: "flex flex-wrap items-center gap-2" }, h("h3", { class: "font-semibold text-fg" }, "Channel computers"), h("span", { class: "chip border-accent/25" }, runtime.ready ? "Ready" : runtime.supported ? "One-time setup" : "Unsupported Mac")),
      h("p", { class: "mt-1 text-sm leading-6 text-muted" }, runtime.ready
        ? "Apple's VM runtime is healthy. Skipper creates and manages one persistent isolated Linux computer per ordinary channel—no CPU or RAM decisions required."
        : "1Helm verifies and opens Apple's signed installer. macOS asks for administrator approval once; Skipper manages everything after that."),
      ...(action ? [action] : []), actionStatus,
    );
  };
  void api<{ runtime: ChannelRuntime }>("/api/channel-computers/runtime").then(({ runtime }) => paintRuntime(runtime)).catch((error) => { runtimeBox.textContent = (error as Error).message; });
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
    const requests = h("div", { class: "space-y-2" });
    const requestToggle = h("input", { type: "checkbox", class: "accent-accent" }) as HTMLInputElement;
    void Promise.all([
      api<{ collaboration: Collaboration }>("/api/collaboration"),
      api<{ requests: AccessRequest[] }>("/api/access-requests"),
    ]).then(([collaborationState, requestState]) => {
      requestToggle.checked = collaborationState.collaboration.accept_new_requests;
      for (const request of requestState.requests) requests.append(h("div", { class: "card flex flex-col gap-3 p-3 sm:flex-row sm:items-center" },
        h("div", { class: "min-w-0 flex-1" }, h("div", { class: "truncate font-semibold text-fg" }, request.display || request.email), h("div", { class: "truncate text-xs text-muted" }, request.email), h("div", { class: "mt-1 text-xs text-faint" }, request.status)),
        request.status === "pending" ? h("div", { class: "flex gap-2" }, h("button", { class: "btn-subtle text-xs", onclick: async () => { await api(`/api/access-requests/${request.id}`, { method: "PATCH", body: { approved: false } }); await refresh(); } }, "Deny"), h("button", { class: "btn-primary text-xs", onclick: async () => { await api(`/api/access-requests/${request.id}`, { method: "PATCH", body: { approved: true } }); await refresh(); } }, "Approve")) : h("span", { class: "chip" }, request.status)));
      if (!requestState.requests.length) requests.append(h("p", { class: "py-3 text-center text-xs text-muted" }, "No access requests yet."));
    }).catch((error) => requests.append(h("p", { class: "text-xs text-danger" }, (error as Error).message)));
    requestToggle.onchange = () => { void api("/api/collaboration/requests-enabled", { body: { enabled: requestToggle.checked } }).catch((error) => { status.textContent = (error as Error).message; requestToggle.checked = !requestToggle.checked; }); };
    wrap.append(h("div", { class: "card mb-4 p-4" }, h("div", { class: "flex items-start justify-between gap-3" }, h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Access requests"), h("p", { class: "mt-1 text-xs leading-5 text-muted" }, "Approved coworkers create their account and land in the human-only #Collab space.")), h("label", { class: "flex shrink-0 items-center gap-2 text-xs text-fg" }, requestToggle, "Accept new requests")), h("div", { class: "mt-3" }, requests)));
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

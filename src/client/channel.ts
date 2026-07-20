import { api, openAuthenticatedFile, type ActivityItem, type AgentTemplate, type Channel, type ChannelFile, type MemoryItem, type ThreadState } from "./api.ts";
import { h, clear, icon, md, timeLabel, initials } from "./dom.ts";
import { S, avatar, appAlert, appConfirm, appPrompt } from "./app.ts";

export type ChannelView = "chat" | "threads" | "files" | "terminal" | "memory" | "activity" | "settings";

export function openCreateChannel(onCreated: (channel: Channel) => void): void {
  const name = h("input", { class: "field", placeholder: "launch", autocomplete: "off" }) as HTMLInputElement;
  const purpose = h("textarea", { class: "field min-h-28", placeholder: "This channel owns planning and coordinating the product launch." }) as HTMLTextAreaElement;
  const status = h("div", { class: "min-h-5 text-sm text-danger" });
  const templates = h("div", { class: "grid gap-2 sm:grid-cols-2" });
  let selectedTemplate = "general";
  const submit = h("button", { class: "btn-primary px-4 py-2" }, "Create channel") as HTMLButtonElement;
  const close = (): void => overlay.remove();
  const create = async (): Promise<void> => {
    status.textContent = "";
    submit.disabled = true; submit.textContent = "Provisioning agent world…";
    try {
      const result = await api<{ channel: Channel }>("/api/channels", { body: { name: name.value, purpose: purpose.value, template: selectedTemplate } });
      close(); onCreated(result.channel);
    } catch (error) {
      status.textContent = (error as Error).message;
      submit.disabled = false; submit.textContent = "Create channel";
    }
  };
  submit.onclick = () => { void create(); };
  purpose.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void create(); });
  const overlay = h("div", { class: "modal-overlay fixed inset-0 z-50 grid place-items-end bg-black/55 p-0 sm:place-items-center sm:p-6", onclick: (event: MouseEvent) => { if (event.target === overlay) close(); } },
    h("section", { class: "card mobile-sheet w-full max-w-lg overflow-hidden rounded-b-none shadow-2xl sm:rounded-xl" },
      h("div", { class: "flex items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6" },
        h("div", {}, h("h2", { class: "font-display text-[1.4rem] leading-tight text-fg" }, "Create an agent channel"), h("p", { class: "mt-1.5 text-sm text-muted" }, "It comes with one resident agent, a computer workspace, files, threads, and memory.")),
        h("button", { class: "grid h-11 w-11 place-items-center rounded text-muted hover:bg-hover sm:h-8 sm:w-8", "aria-label": "Close", onclick: close }, icon("x"))),
      h("div", { class: "max-h-[70dvh] space-y-4 overflow-y-auto p-4 sm:p-6" },
        h("div", {}, h("span", { class: "eyebrow mb-2 block text-muted" }, "Start from a lightweight role"), templates, h("span", { class: "mt-1 block text-xs text-muted" }, "Templates are only a starting kit. The agent keeps learning, gaining skills, and growing with this channel.")),
        h("label", { class: "block" }, h("span", { class: "eyebrow mb-2 block text-muted" }, "Channel name"), name),
        h("label", { class: "block" }, h("span", { class: "mb-1 block text-sm font-semibold text-fg" }, "What is this channel all about?"), purpose, h("span", { class: "mt-1 block text-xs text-muted" }, "This becomes the resident agent's durable purpose and operating context.")),
        status),
      h("div", { class: "flex items-center justify-end gap-2 border-t border-line px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6" }, h("button", { class: "btn-ghost min-h-11 sm:min-h-0", onclick: close }, "Cancel"), submit)));
  document.body.append(overlay);
  void api<{ templates: AgentTemplate[] }>("/api/agent-templates").then(({ templates: options }) => {
    const draw = (): void => {
      clear(templates);
      for (const template of options) templates.append(h("button", { class: `rounded-lg border p-3 text-left transition ${selectedTemplate === template.slug ? "border-accent bg-accent-soft" : "border-line bg-raised hover:border-accent/40"}`, type: "button", dataset: { template: template.slug }, onclick: () => { selectedTemplate = template.slug; if (!purpose.value.trim()) purpose.placeholder = template.purpose_hint; draw(); } },
        h("div", { class: "font-semibold text-fg" }, template.name), h("div", { class: "mt-1 text-xs leading-5 text-muted" }, template.description)));
    };
    draw();
  });
  name.focus();
}

function statusPath(status: string, updatedAt: number): HTMLElement {
  const steps = ["open", "waiting", "resolved"];
  const idx = steps.indexOf(status);
  const isFailed = status === "failed";
  const isArchived = status === "archived";
  const isActive = !isFailed && !isArchived && Date.now() - updatedAt < 5 * 60 * 1000;
  const stepEl = (label: string, active: boolean, current: boolean, pulse: boolean) =>
    h("div", { class: "flex items-center gap-1.5" },
      h("span", { class: `h-2 w-2 rounded-full ${active ? (pulse ? "animate-pulse bg-amber-400" : "bg-ok") : "bg-line"}` }),
      h("span", { class: `font-mono text-[10px] uppercase tracking-[0.12em] ${current ? "text-fg" : "text-faint"}` }, label));
  const connector = (active: boolean) => h("div", { class: `h-px w-6 ${active ? "bg-ok" : "bg-line"}` });
  const parts: HTMLElement[] = [];
  for (let i = 0; i < steps.length; i++) {
    const active = i <= idx;
    const current = i === idx;
    parts.push(stepEl(steps[i], active, current, current && isActive));
    if (i < steps.length - 1) parts.push(connector(i < idx));
  }
  if (isFailed) parts.push(h("span", { class: "chip border-danger/30 bg-danger/10 text-danger text-xs" }, "failed"));
  if (isArchived) parts.push(h("span", { class: "chip border-line text-muted text-xs" }, "archived"));
  return h("div", { class: "flex flex-wrap items-center gap-1.5" }, ...parts);
}

export function renderThreads(container: HTMLElement, channelId: number, onOpen: (thread: ThreadState) => void): void {
  panelLoading(container, "Threads", "Focused sessions with durable status and rolling summaries.");
  void api<{ threads: ThreadState[] }>(`/api/channels/${channelId}/threads`).then(({ threads }) => {
    const list = h("div", { class: "space-y-2" });
    if (!threads.length) list.append(empty("No sessions yet", "Start a top-level message in Chat to open a focused session."));
    for (const thread of threads) {
      list.append(h("article", { class: "card flex w-full min-w-0 items-start gap-3 p-4" },
        h("span", { class: "mt-0.5 shrink-0 text-accent" }, icon("thread")),
        h("button", { class: "min-w-0 flex-1 text-left", type: "button", dataset: { threadOpen: String(thread.id) }, onclick: () => onOpen(thread) },
          h("div", { class: "truncate font-semibold text-fg hover:text-accent" }, thread.title),
          h("div", { class: "md mt-1 line-clamp-2 text-sm leading-5 text-muted", html: md(thread.summary || "No summary yet.") }),
          h("div", { class: "mt-2 flex items-center gap-2 text-xs text-faint" }, statusPath(thread.status, thread.updated_at), h("span", {}, `· Updated ${timeLabel(thread.updated_at)}`)))));
    }
    panelContent(container, "Threads", "Focused sessions with durable status and rolling summaries.", list);
  }).catch((error) => panelError(container, error));
}

export function renderFiles(container: HTMLElement, channelId: number): void {
  panelLoading(container, "Files", "Same tree the channel terminal sees as /workspace. Uploads also appear under files/.");
  void api<{ files: ChannelFile[] }>(`/api/channels/${channelId}/files`).then(({ files }) => {
    const list = h("div", { class: "overflow-hidden rounded-lg border border-line bg-surface" });
    if (!files.length) list.append(empty("No files yet", "Ask the resident agent to create something in /workspace, or attach a file in Chat."));
    for (const file of files) {
      const display = file.path.startsWith("files/") ? file.path : file.path;
      const row = h("div", { class: "flex items-center gap-3 border-b border-line px-4 py-3 last:border-0" },
        h("span", { class: file.kind === "directory" ? "text-muted" : "text-accent" }, icon("file")),
        h("div", { class: "min-w-0 flex-1" },
          h("div", { class: "truncate font-mono text-sm text-fg" }, "/" + display),
          h("div", { class: "text-xs text-muted" }, file.kind === "directory" ? "Folder" : `${formatBytes(file.size)} · changed ${timeLabel(file.modified)} · ${file.path.startsWith("files/") ? "uploads/files" : "workspace"}`)),
        file.kind === "file" ? h("button", { class: "btn-subtle text-xs", onclick: () => { void openAuthenticatedFile(`/api/channels/${channelId}/files/content?path=${encodeURIComponent(file.path)}`).catch((error) => appAlert((error as Error).message)); } }, "Open") : null);
      list.append(row);
    }
    panelContent(container, "Files", "Same tree the channel terminal sees as /workspace. Uploads also appear under files/.", list);
  }).catch((error) => panelError(container, error));
}

export function renderMemory(container: HTMLElement, channelId: number): void {
  panelLoading(container, "Memory / Knowledge", "Provider-neutral continuity owned by this channel, with provenance.");
  const load = (): void => {
    void api<{ memory: MemoryItem[] }>(`/api/channels/${channelId}/memory`).then(({ memory }) => {
      const current = memory.filter((item) => item.status === "current");
      const list = h("div", { class: "space-y-2" });
      if (!current.length) list.append(empty("No durable knowledge yet", "Record decisions, facts, preferences, and artifact references worth carrying into future sessions. Session recaps live in Threads, not here."));
      for (const item of current) list.append(h("article", { class: "card p-4" },
        h("div", { class: "mb-2 flex items-center gap-2" }, h("span", { class: "chip border-accent/30 text-accent" }, item.kind.replace("_", " ")), h("span", { class: "text-xs text-muted" }, `${item.author_type} · ${item.scope} · ${timeLabel(item.created)}`), h("div", { class: "flex-1" }),
          item.kind !== "summary" ? h("button", { class: "btn-ghost text-xs", onclick: async () => { await api(`/api/memory/${item.id}`, { method: "DELETE" }); load(); } }, "Supersede") : null),
        h("div", { class: "md text-sm text-fg", html: md(item.content) })));
      const add = h("button", { class: "btn-primary text-sm", onclick: () => addMemory(channelId, load) }, icon("plus"), "Record knowledge");
      panelContent(container, "Memory / Knowledge", "Provider-neutral continuity owned by this channel, with provenance.", h("div", {}, h("div", { class: "mb-4 flex justify-end" }, add), list));
    }).catch((error) => panelError(container, error));
  };
  load();
}

async function addMemory(channelId: number, onDone: () => void): Promise<void> {
  const kind = await appPrompt("Memory type: decision, fact, preference, or artifact_ref", "decision");
  if (!kind) return;
  const content = await appPrompt("What should this channel retain?");
  if (!content) return;
  void api(`/api/channels/${channelId}/memory`, { body: { kind: kind.trim(), content: content.trim() } }).then(onDone).catch((error) => appAlert((error as Error).message));
}

export function renderActivity(container: HTMLElement, channelId: number): void {
  panelLoading(container, "Activity", "Agent work, tool actions, lifecycle changes, and Skipper interventions.");
  void api<{ activity: ActivityItem[] }>(`/api/channels/${channelId}/activity`).then(({ activity }) => {
    const list = h("div", { class: "space-y-1" });
    if (!activity.length) list.append(empty("No activity yet", "Tool use and lifecycle changes will appear here."));
    for (const item of activity) list.append(h("div", { class: "flex gap-3 rounded-lg border border-line bg-surface px-4 py-3" },
      h("span", { class: `mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.status === "failed" ? "bg-danger" : item.status === "running" || item.status === "open" ? "bg-amber-400" : "bg-ok"}` }),
      h("div", { class: "min-w-0 flex-1" }, h("div", { class: "text-sm text-fg" }, item.summary), h("div", { class: "mt-1 text-xs text-muted" }, `${item.kind} · ${item.actor_type} · ${timeLabel(item.created)}`))));
    panelContent(container, "Activity", "Agent work, tool actions, lifecycle changes, and Skipper interventions.", list);
  }).catch((error) => panelError(container, error));
}

export function renderChannelSettings(container: HTMLElement, channel: Channel, onChanged: (deleted?: boolean) => void): void {
  const purpose = h("textarea", { class: "field min-h-24" }, channel.purpose || "") as HTMLTextAreaElement;
  const provider = h("select", { class: "field" }, h("option", { value: "" }, "No provider")) as HTMLSelectElement;
  for (const item of S.providers) provider.append(h("option", { value: item.id, selected: item.id === channel.agent?.provider_id }, item.name));
  const model = h("select", { class: "field" }, h("option", { value: channel.agent?.model || "" }, channel.agent?.model || "Choose a model")) as HTMLSelectElement;
  const status = h("p", { class: "min-h-5 text-sm text-muted" });
  let loadSequence = 0;
  let modelLoading = false;
  let changeModelButton: HTMLButtonElement | null = null;
  const loadModels = async (): Promise<void> => {
    const providerId = provider.value;
    const sequence = ++loadSequence;
    clear(model); model.append(h("option", { value: "" }, providerId ? "Loading models…" : "Choose a provider"));
    model.disabled = true; modelLoading = Boolean(providerId); if (changeModelButton) changeModelButton.disabled = modelLoading;
    if (!providerId) return;
    status.textContent = "Loading models…";
    try {
      const models = (await api<{ models: string[] }>(`/api/providers/${providerId}/models`)).models;
      if (sequence !== loadSequence || provider.value !== providerId) return;
      clear(model); model.append(...models.map((item) => h("option", { value: item, selected: item === channel.agent?.model }, item)));
      status.textContent = `${models.length} models available.`;
    } catch (error) {
      if (sequence === loadSequence) status.textContent = (error as Error).message;
    } finally {
      if (sequence === loadSequence) { modelLoading = false; model.disabled = false; if (changeModelButton) changeModelButton.disabled = false; }
    }
  };
  provider.onchange = () => { void loadModels(); };
  const savePurpose = async (): Promise<void> => {
    try { await api(`/api/channels/${channel.id}`, { method: "PATCH", body: { purpose: purpose.value } }); status.textContent = "Purpose saved."; onChanged(); }
    catch (error) { status.textContent = (error as Error).message; }
  };
  const saveModel = async (): Promise<void> => {
    if (modelLoading) { status.textContent = "Wait for this provider's models to finish loading."; return; }
    try { await api(`/api/channels/${channel.id}/agent-policy`, { method: "PATCH", body: { provider_id: provider.value ? Number(provider.value) : null, model: model.value } }); status.textContent = "Future turns will use the new model. Identity, files, threads, and memory are unchanged."; onChanged(); }
    catch (error) { status.textContent = (error as Error).message; }
  };
  changeModelButton = h("button", { class: "btn-primary text-sm", onclick: () => { void saveModel(); } }, "Change model") as HTMLButtonElement;

  // Agent avatar presets + upload
  const agentAvatar = h("div", { class: "flex items-center gap-3" });
  const avatarPreview = h("div", { class: "h-12 w-12 shrink-0" });
  const avatarFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", class: "hidden" }) as HTMLInputElement;
  const avatarColors = ["#c8552f", "#4f6d7a", "#8a6b7c", "#a67c52", "#7a6a4f", "#2e7d4f", "#2166b8", "#64748b"];
  const avatarColorRow = h("div", { class: "flex flex-wrap gap-2" });
  const currentAvatar = channel.agent?.runtime?.avatar || "";
  const drawAvatarPreview = (value: string): void => {
    clear(avatarPreview);
    if (value.startsWith("color:")) {
      avatarPreview.append(h("div", { class: "h-12 w-12 rounded-xl flex items-center justify-center text-white font-bold text-sm", style: `background:${value.slice(6)}` }, initials(channel.agent?.name || "A")));
    } else if (value.startsWith("data:image/") || value.startsWith("/")) {
      avatarPreview.append(h("img", { class: "h-12 w-12 rounded-xl object-cover", src: value, alt: "Agent" }));
    } else {
      avatarPreview.append(avatar(channel.agent?.name || "A", "bot", 12));
    }
  };
  drawAvatarPreview(currentAvatar);
  const saveAvatar = async (value: string): Promise<void> => {
    try {
      await api(`/api/channels/${channel.id}/agent-avatar`, { method: "PATCH", body: { avatar: value } });
      drawAvatarPreview(value);
      status.textContent = "Agent avatar saved.";
      onChanged();
    } catch (error) { status.textContent = (error as Error).message; }
  };
  for (const hex of avatarColors) avatarColorRow.append(h("button", { class: "h-8 w-8 rounded-lg border border-line shadow-sm transition hover:scale-105", style: `background:${hex}`, title: hex, onclick: () => { void saveAvatar(`color:${hex}`); } }));
  avatarFile.onchange = async () => {
    const image = avatarFile.files?.[0]; if (!image) return;
    const reader = new FileReader();
    reader.onload = () => { void saveAvatar(String(reader.result)); };
    reader.readAsDataURL(image);
  };
  agentAvatar.append(avatarPreview, h("div", { class: "flex flex-wrap gap-2" }, h("label", { class: "btn-subtle cursor-pointer text-sm" }, "Upload", avatarFile), currentAvatar ? h("button", { class: "btn-ghost text-sm", onclick: () => { void saveAvatar(""); } }, "Reset") : null));

  const lifecycle = channel.name === "main" ? null : h("div", { class: "card border-danger/30 p-4" },
    h("h3", { class: "font-semibold text-fg" }, "Lifecycle"),
    h("p", { class: "mt-1 text-sm leading-5 text-muted" }, channel.status === "archived" ? "This agent world is paused. Restore reuses the same identity, workspace, memory, and threads." : "Archive pauses work while preserving the complete agent world."),
    h("div", { class: "mt-4 flex flex-wrap gap-2" },
      channel.status === "archived"
        ? h("button", { class: "btn-primary text-sm", onclick: async () => { await api(`/api/channels/${channel.id}/restore`, { body: {} }); onChanged(); } }, "Restore same world")
        : h("button", { class: "btn-subtle text-sm", onclick: async () => { if (await appConfirm(`Archive #${channel.name}? Its agent world will be preserved and paused.`)) { await api(`/api/channels/${channel.id}/archive`, { body: {} }); onChanged(); } } }, "Archive channel"),
      channel.status === "archived" ? h("button", { class: "btn-danger text-sm", onclick: async () => {
        const confirmation = await appPrompt(`Permanent deletion removes the agent, workspace, files, memory, sessions, and channel. Type ${channel.name} to confirm:`);
        if (confirmation !== channel.name) return;
        await api(`/api/channels/${channel.id}`, { method: "DELETE", body: { confirm: confirmation } }); onChanged(true);
      } }, icon("trash", 14), "Delete permanently") : null));

  const assignedSkills = h("div", { class: "mt-3 flex flex-wrap gap-2" }, ...((channel.agent?.skills || []).map((skill) => h("span", { class: "chip border-accent/25" }, skill.name))));
  panelContent(container, "Channel settings", "Purpose, replaceable model policy, permanent skills, scoped capabilities, and lifecycle.", h("div", { class: "space-y-4" },
    h("div", { class: "card space-y-3 p-4" }, h("h3", { class: "font-semibold text-fg" }, "Purpose"), purpose, h("div", { class: "flex justify-end" }, h("button", { class: "btn-primary text-sm", onclick: () => { void savePurpose(); } }, "Save purpose"))),
    h("div", { class: "card space-y-3 p-4" },
      h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Agent avatar"), h("p", { class: "mt-1 text-sm text-muted" }, "Pick a flat color or upload a custom image for this resident agent.")),
      agentAvatar, h("div", { class: "mt-2" }, h("span", { class: "mb-1 block text-xs font-semibold text-muted" }, "Default colors"), avatarColorRow)),
    h("div", { class: "card space-y-3 p-4" },
      h("div", {}, h("h3", { class: "font-semibold text-fg" }, "Serving model"), h("p", { class: "mt-1 text-sm text-muted" }, "The model provides replaceable intelligence. Changing it never creates a new agent or discards channel-owned state.")),
      h("div", { class: "grid grid-cols-1 gap-3 sm:grid-cols-2" }, provider, model),
      h("div", { class: "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" }, status, S.me.is_admin ? changeModelButton : null)),
    h("div", { class: "card p-4" }, h("h3", { class: "font-semibold text-fg" }, "Permanent skill arsenal"), h("p", { class: "mt-1 text-sm text-muted" }, "Skipper provisioned these skills for this agent. New grants stay permanently, and the agent still knows what else exists in the workspace catalog."), assignedSkills),
    h("div", { class: "card p-4" }, h("h3", { class: "font-semibold text-fg" }, "Capabilities"), h("div", { class: "mt-3 flex flex-wrap gap-2" }, ...(channel.agent?.capabilities || []).map((capability) => h("span", { class: "chip" }, capability))), h("p", { class: "mt-3 text-xs text-muted" }, "The resident agent is channel-scoped. It calls @skipper for host-level, cross-channel, credential, guest-expert, or missing-capability work.")),
    lifecycle));
  if (channel.agent?.provider_id) void loadModels();
}

function panelLoading(container: HTMLElement, title: string, subtitle: string): void { panelContent(container, title, subtitle, h("div", { class: "py-12 text-center text-sm text-muted" }, "Loading…")); }
function panelError(container: HTMLElement, error: unknown): void { container.replaceChildren(h("div", { class: "m-6 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger" }, (error as Error).message)); }
function panelContent(container: HTMLElement, title: string, subtitle: string, content: HTMLElement): void {
  clear(container);
  container.append(h("div", { class: "mx-auto w-full max-w-5xl p-6" }, h("div", { class: "mb-6" }, h("h2", { class: "font-display text-[1.75rem] leading-tight text-fg" }, title), h("p", { class: "mt-1.5 text-sm text-muted" }, subtitle)), content));
}
function empty(title: string, copy: string): HTMLElement { return h("div", { class: "py-14 text-center" }, h("div", { class: "font-display text-xl text-fg" }, title), h("p", { class: "mx-auto mt-2 max-w-md text-sm leading-6 text-muted" }, copy)); }
function formatBytes(size: number): string { return size < 1024 ? `${size} B` : size < 1_048_576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1_048_576).toFixed(1)} MB`; }

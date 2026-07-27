import { api, type Channel, type ChannelFile, type Message } from "./api.ts";
import { clear, color, h, icon, initials, md, timeLabel } from "./dom.ts";
import { appAlert, appConfirm, appPrompt } from "./app.ts";

export type CoworkSection = "notes" | "whiteboards" | "code" | "docs" | "presentations";

type EditableFile = ChannelFile & { content: string };
type SectionSession = { folder: string; path: string; content: string; saved: string; loaded: boolean; preview: boolean };
type CoworkSurface = { node: HTMLElement; openPath: (path: string) => Promise<void>; reload: () => Promise<void>; setOpenThread: (callback: (root: Message) => void) => void };

const SECTIONS: Array<{ id: CoworkSection; label: string; folder: string; icon: string; defaultName: string }> = [
  { id: "notes", label: "Notes", folder: "notes", icon: "fileText", defaultName: "untitled.md" },
  { id: "whiteboards", label: "Whiteboard", folder: "whiteboards", icon: "board", defaultName: "untitled.whiteboard.json" },
  { id: "code", label: "Code", folder: "code", icon: "code", defaultName: "untitled.txt" },
  { id: "docs", label: "Docs", folder: "docs", icon: "fileText", defaultName: "untitled-document.md" },
  { id: "presentations", label: "Presentations", folder: "presentations", icon: "presentation", defaultName: "untitled.slides.json" },
];

const surfaces = new Map<number, CoworkSurface>();
const pendingPaths = new Map<number, string>();

export function stageCoworkPath(channelId: number, path: string): void {
  pendingPaths.set(channelId, path.replace(/^\/?workspace\/?/, "").replace(/^\/+/, ""));
}

function sectionForPath(path: string): CoworkSection {
  const root = path.split("/")[0] as CoworkSection;
  return SECTIONS.some((section) => section.id === root) ? root : "notes";
}

function fileIcon(file: ChannelFile, size = 17): SVGElement {
  if (file.kind === "directory") return icon("folder", size);
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (["js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "sh", "html", "css", "json", "yaml", "yml", "sql"].includes(ext || "")) return icon("code", size);
  if (file.name.includes(".whiteboard.")) return icon("board", size);
  if (file.name.includes(".slides.")) return icon("presentation", size);
  return icon("fileText", size);
}

function starterContent(section: CoworkSection): string {
  if (section === "whiteboards") return JSON.stringify({ version: 1, elements: [] }, null, 2);
  if (section === "presentations") return JSON.stringify({ version: 1, slides: [{ title: "Untitled presentation", body: "" }] }, null, 2);
  return "";
}

function visibleName(path: string): string { return path.split("/").pop() || path; }

export function renderCowork(container: HTMLElement, channelId: number, channel: Channel, onOpenThread: (root: Message) => void, preserveExisting = false): void {
  const cached = surfaces.get(channelId);
  if (cached) {
    cached.setOpenThread(onOpenThread);
    clear(container); container.append(cached.node);
    const staged = pendingPaths.get(channelId); pendingPaths.delete(channelId);
    if (staged) void cached.openPath(staged); else if (!preserveExisting) void cached.reload();
    return;
  }

  const sessions = new Map<CoworkSection, SectionSession>();
  for (const section of SECTIONS) sessions.set(section.id, { folder: section.folder, path: "", content: "", saved: "", loaded: false, preview: false });
  let section: CoworkSection = "notes";
  let filter = "";
  let agentOpen = false;
  let chatTimer: number | null = null;
  let chatRootId = 0;
  let openThreadCallback = onOpenThread;
  const shell = h("section", { class: "cowork-shell flex h-full min-h-[34rem] flex-col bg-surface", dataset: { coworkSurface: String(channelId) } });
  const sectionNav = h("nav", { class: "cowork-sections flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-raised/25 px-3", "aria-label": "Cowork sections" });
  const breadcrumb = h("nav", { class: "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto font-mono text-[11px]", "aria-label": "Cowork folder path" });
  const fileList = h("div", { class: "min-h-0 flex-1 overflow-y-auto p-2", dataset: { coworkFiles: "" } });
  const workspace = h("main", { class: "cowork-workspace relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg", dataset: { coworkViewport: "" } });
  const status = h("span", { class: "min-h-5 truncate text-xs text-muted", role: "status" });
  const search = h("input", { class: "field h-9 text-xs", type: "search", placeholder: "Filter files", "aria-label": "Filter current Cowork folder" }) as HTMLInputElement;
  const agentPanel = h("aside", { class: "cowork-agent hidden min-h-0 w-[min(25rem,38vw)] shrink-0 flex-col border-l border-line bg-surface", dataset: { coworkAgent: "" } });
  const agentAvatar = h("span", { class: "grid h-9 w-9 place-items-center rounded-full text-xs font-bold text-white", style: `background:${color(channel.agent?.name || "agent")}` }, initials(channel.agent?.display_name || channel.agent?.name || "Agent"));
  const agentToggle = h("button", { class: "cowork-agent-toggle", type: "button", title: "Work with the channel agent", "aria-label": "Open Cowork agent panel", "aria-expanded": "false" }, agentAvatar.cloneNode(true));

  const activeSession = (): SectionSession => sessions.get(section)!;
  const activeSection = () => SECTIONS.find((candidate) => candidate.id === section)!;
  const threadKey = (path: string): string => `1helm.cowork.thread.${channelId}.${path || section}`;
  const draftKey = (path: string): string => `1helm.cowork.draft.${channelId}.${path}`;

  const updateSectionNav = (): void => {
    clear(sectionNav);
    for (const item of SECTIONS) sectionNav.append(h("button", {
      class: `cowork-section ${section === item.id ? "is-active" : ""}`, type: "button", "aria-current": section === item.id ? "page" : undefined,
      onclick: () => { if (section === item.id) return; section = item.id; filter = ""; search.value = ""; void draw(); },
    }, icon(item.icon, 15), item.label));
  };

  const drawBreadcrumb = (): void => {
    clear(breadcrumb);
    const session = activeSession();
    const segments = session.folder.split("/").filter(Boolean);
    const add = (label: string, path: string): void => {
      if (breadcrumb.childNodes.length) breadcrumb.append(h("span", { class: "text-faint" }, "/"));
      breadcrumb.append(h("button", { class: path === session.folder ? "shrink-0 text-fg" : "shrink-0 text-accent hover:underline", type: "button", onclick: () => { session.folder = path; session.path = ""; void draw(); } }, label));
    };
    add("workspace", activeSection().folder);
    segments.slice(1).forEach((segment, index) => add(segment, segments.slice(0, index + 2).join("/")));
  };

  const saveFile = async (): Promise<void> => {
    const session = activeSession();
    if (!session.path || session.content === session.saved) return;
    status.textContent = "Saving…";
    try {
      const result = await api<{ file: EditableFile }>(`/api/channels/${channelId}/files/text`, { method: "PATCH", body: { path: session.path, content: session.content } });
      session.content = result.file.content; session.saved = result.file.content; localStorage.removeItem(draftKey(session.path)); status.textContent = "Saved";
    } catch (error) { status.textContent = (error as Error).message; }
  };

  const textEditor = (session: SectionSession, mode: "notes" | "code" | "docs"): HTMLElement => {
    const textarea = h("textarea", {
      class: mode === "docs" ? "cowork-doc-page" : mode === "code" ? "cowork-code-editor" : "cowork-note-editor",
      value: session.content, spellcheck: mode !== "code", "aria-label": `${activeSection().label} editor`,
    }) as HTMLTextAreaElement;
    const preview = h("div", { class: `md cowork-markdown-preview ${session.preview ? "" : "hidden"}`, html: md(session.content || "_This file is empty._") });
    textarea.classList.toggle("hidden", session.preview);
    textarea.oninput = () => { session.content = textarea.value; localStorage.setItem(draftKey(session.path), session.content); status.textContent = "Unsaved changes"; if (session.preview) preview.innerHTML = md(session.content || "_This file is empty._"); };
    textarea.onkeydown = (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveFile(); } };
    const toolbar = h("div", { class: "cowork-editor-toolbar" },
      h("span", { class: "min-w-0 flex-1 truncate font-mono text-[11px] text-muted", title: `/workspace/${session.path}` }, `/workspace/${session.path}`),
      mode !== "code" ? h("button", { class: `btn-subtle text-xs ${session.preview ? "bg-accent-soft" : ""}`, type: "button", onclick: () => { session.preview = !session.preview; void drawWorkspace(); } }, session.preview ? "Write" : "Preview") : null,
      h("button", { class: "btn-primary text-xs", type: "button", disabled: session.content === session.saved, onclick: () => { void saveFile(); } }, "Save"));
    return h("div", { class: `flex min-h-0 flex-1 flex-col ${mode === "docs" ? "cowork-doc-canvas" : ""}` }, toolbar, h("div", { class: "flex min-h-0 flex-1 flex-col overflow-auto" }, textarea, preview));
  };

  const whiteboardEditor = (session: SectionSession): HTMLElement => {
    type Element = { id: string; x: number; y: number; text: string; color: string };
    let data: { version: number; elements: Element[] };
    try { data = JSON.parse(session.content || "{}"); if (!Array.isArray(data.elements)) throw new Error(); }
    catch { return h("div", { class: "grid flex-1 place-items-center p-8 text-center text-sm text-muted" }, "This file is not a supported 1Helm whiteboard."); }
    const canvas = h("div", { class: "cowork-whiteboard-canvas", tabindex: 0, "aria-label": "Whiteboard canvas" });
    const commit = (): void => { session.content = JSON.stringify(data, null, 2); localStorage.setItem(draftKey(session.path), session.content); status.textContent = "Unsaved changes"; };
    const paint = (): void => {
      clear(canvas);
      for (const element of data.elements) {
        const card = h("article", { class: "cowork-whiteboard-card", style: `left:${element.x}px;top:${element.y}px;border-color:${element.color}`, tabindex: 0 },
          h("textarea", { class: "h-full w-full resize-none bg-transparent text-sm leading-5 text-fg outline-none", value: element.text, "aria-label": "Whiteboard card text", oninput: (event: Event) => { element.text = (event.target as HTMLTextAreaElement).value; commit(); } }),
          h("button", { class: "absolute right-1 top-1 grid h-6 w-6 place-items-center rounded text-faint hover:bg-hover hover:text-danger", type: "button", "aria-label": "Delete card", onclick: () => { data.elements = data.elements.filter((item) => item.id !== element.id); commit(); paint(); } }, icon("x", 12)));
        let drag: { x: number; y: number } | null = null;
        card.addEventListener("pointerdown", (event) => { if ((event.target as HTMLElement | null)?.closest("textarea,button")) return; drag = { x: event.clientX - element.x, y: event.clientY - element.y }; card.setPointerCapture(event.pointerId); });
        card.addEventListener("pointermove", (event) => { if (!drag) return; element.x = Math.max(8, event.clientX - drag.x); element.y = Math.max(8, event.clientY - drag.y); card.style.left = `${element.x}px`; card.style.top = `${element.y}px`; });
        card.addEventListener("pointerup", () => { if (drag) commit(); drag = null; });
        canvas.append(card);
      }
    };
    const addCard = (): void => { data.elements.push({ id: crypto.randomUUID(), x: 40 + data.elements.length * 18, y: 40 + data.elements.length * 18, text: "New idea", color: color(String(data.elements.length)) }); commit(); paint(); };
    paint();
    return h("div", { class: "flex min-h-0 flex-1 flex-col" }, h("div", { class: "cowork-editor-toolbar" }, h("span", { class: "flex-1 text-xs text-muted" }, "Drag cards anywhere on the canvas."), h("button", { class: "btn-subtle text-xs", onclick: addCard }, icon("plus", 13), "Card"), h("button", { class: "btn-primary text-xs", onclick: () => { void saveFile(); } }, "Save")), canvas);
  };

  const presentationEditor = (session: SectionSession): HTMLElement => {
    type Slide = { title: string; body: string };
    let data: { version: number; slides: Slide[] };
    try { data = JSON.parse(session.content || "{}"); if (!Array.isArray(data.slides)) throw new Error(); }
    catch { return h("div", { class: "grid flex-1 place-items-center p-8 text-center text-sm text-muted" }, "This file is not a supported 1Helm presentation."); }
    let active = 0;
    const root = h("div", { class: "flex min-h-0 flex-1 flex-col" });
    const commit = (): void => { session.content = JSON.stringify(data, null, 2); localStorage.setItem(draftKey(session.path), session.content); status.textContent = "Unsaved changes"; };
    const paint = (): void => {
      clear(root); active = Math.min(active, Math.max(0, data.slides.length - 1));
      const thumbnails = h("aside", { class: "cowork-slide-strip" });
      data.slides.forEach((slide, index) => thumbnails.append(h("button", { class: `cowork-slide-thumb ${active === index ? "is-active" : ""}`, type: "button", onclick: () => { active = index; paint(); } }, h("span", { class: "text-[10px] text-faint" }, String(index + 1)), h("span", { class: "truncate text-xs font-semibold text-fg" }, slide.title || "Untitled slide"))));
      const slide = data.slides[active] || { title: "", body: "" };
      const title = h("input", { class: "cowork-slide-title", value: slide.title, placeholder: "Slide title", oninput: (event: Event) => { slide.title = (event.target as HTMLInputElement).value; commit(); } });
      const body = h("textarea", { class: "cowork-slide-body", value: slide.body, placeholder: "Add text…", oninput: (event: Event) => { slide.body = (event.target as HTMLTextAreaElement).value; commit(); } });
      root.append(h("div", { class: "cowork-editor-toolbar" }, h("span", { class: "flex-1 text-xs text-muted" }, `${data.slides.length} slide${data.slides.length === 1 ? "" : "s"}`), h("button", { class: "btn-subtle text-xs", onclick: () => { data.slides.push({ title: "Untitled slide", body: "" }); active = data.slides.length - 1; commit(); paint(); } }, icon("plus", 13), "Slide"), h("button", { class: "btn-ghost text-xs text-danger", disabled: data.slides.length <= 1, onclick: () => { data.slides.splice(active, 1); active = Math.max(0, active - 1); commit(); paint(); } }, "Delete"), h("button", { class: "btn-primary text-xs", onclick: () => { void saveFile(); } }, "Save")), h("div", { class: "flex min-h-0 flex-1" }, thumbnails, h("div", { class: "cowork-slide-stage" }, h("article", { class: "cowork-slide" }, title, body))));
    };
    paint(); return root;
  };

  const drawWorkspace = async (): Promise<void> => {
    const session = activeSession(); clear(workspace);
    if (!session.path) {
      workspace.append(h("div", { class: "grid h-full place-items-center p-8 text-center" }, h("div", {}, h("span", { class: "mx-auto grid h-14 w-14 place-items-center rounded-xl bg-accent-soft text-accent" }, icon(activeSection().icon, 27)), h("h2", { class: "mt-4 font-display text-2xl text-fg" }, activeSection().label), h("p", { class: "mt-2 max-w-sm text-sm leading-6 text-muted" }, "Choose a file on the left or create one. Cowork edits the same files your channel agent sees in /workspace."))));
      return;
    }
    if (!session.loaded) {
      workspace.append(h("div", { class: "grid h-full place-items-center text-sm text-muted" }, "Opening file…"));
      try {
        const result = await api<{ file: EditableFile }>(`/api/channels/${channelId}/files/text?path=${encodeURIComponent(session.path)}`);
        const local = localStorage.getItem(draftKey(session.path)); session.content = local ?? result.file.content; session.saved = result.file.content; session.loaded = true;
      } catch (error) { clear(workspace); workspace.append(h("div", { class: "grid h-full place-items-center p-8 text-center" }, h("div", {}, h("span", { class: "text-accent" }, fileIcon({ path: session.path, name: visibleName(session.path), size: 0, modified: 0, kind: "file" }, 32)), h("h3", { class: "mt-3 font-semibold text-fg" }, visibleName(session.path)), h("p", { class: "mt-2 text-sm text-muted" }, (error as Error).message || "File type not supported to view.")))); return; }
      clear(workspace);
    }
    if (section === "whiteboards") workspace.append(whiteboardEditor(session));
    else if (section === "presentations") workspace.append(presentationEditor(session));
    else workspace.append(textEditor(session, section === "code" ? "code" : section === "docs" ? "docs" : "notes"));
    workspace.append(agentToggle);
  };

  const openPath = async (path: string): Promise<void> => {
    const normalized = path.replace(/^\/?workspace\/?/, "").replace(/^\/+/, "");
    section = sectionForPath(normalized); const session = activeSession(); session.path = normalized; session.folder = normalized.split("/").slice(0, -1).join("/") || activeSection().folder; session.loaded = false;
    chatRootId = Number(localStorage.getItem(threadKey(normalized)) || 0); await draw();
  };

  const loadFiles = async (): Promise<void> => {
    const session = activeSession();
    try {
      const result = await api<{ files: ChannelFile[] }>(`/api/channels/${channelId}/files?path=${encodeURIComponent(session.folder)}`);
      clear(fileList); const visible = result.files.filter((file) => !filter || file.name.toLowerCase().includes(filter));
      if (!visible.length) fileList.append(h("p", { class: "px-2 py-8 text-center text-xs leading-5 text-faint" }, result.files.length ? "No matching files." : "This folder is empty."));
      for (const file of visible) fileList.append(h("button", { class: `group mb-0.5 flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left ${session.path === file.path ? "bg-accent-soft" : "hover:bg-hover"}`, type: "button", ondblclick: () => { if (file.kind === "directory") { session.folder = file.path; session.path = ""; void draw(); } else void openPath(file.path); }, onclick: () => { if (file.kind === "file") void openPath(file.path); } }, h("span", { class: file.kind === "directory" ? "text-muted" : "text-accent" }, fileIcon(file)), h("span", { class: "min-w-0 flex-1 truncate text-xs text-fg" }, file.name), file.kind === "file" ? h("span", { class: "font-mono text-[9px] text-faint" }, file.name.split(".").pop()?.toUpperCase() || "FILE") : null));
    } catch (error) { fileList.replaceChildren(h("p", { class: "p-3 text-xs text-danger" }, (error as Error).message)); }
  };

  const renderChatMessages = async (): Promise<void> => {
    const stream = agentPanel.querySelector<HTMLElement>("[data-cowork-chat-stream]"); if (!stream || !chatRootId) return;
    const stick = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 60; const top = stream.scrollTop;
    try {
      const result = await api<{ root: Message; replies: Message[] }>(`/api/messages/${chatRootId}/thread`);
      const signature = [result.root, ...result.replies].map((message) => `${message.id}:${message.body}`).join("|");
      if (stream.dataset.signature === signature) return;
      stream.dataset.signature = signature; clear(stream);
      for (const message of [result.root, ...result.replies]) stream.append(h("article", { class: `cowork-chat-message ${message.author.kind === "user" ? "is-user" : ""}` }, h("div", { class: "mb-1 text-[10px] font-semibold text-muted" }, message.author.kind === "user" ? "You" : message.author.name), h("div", { class: "md text-sm text-fg", html: md(message.body) })));
      requestAnimationFrame(() => { stream.scrollTop = stick ? stream.scrollHeight : top; });
    } catch { /* a deleted/archived thread stays quiet until the user starts another */ }
  };

  const drawAgent = (): void => {
    agentPanel.classList.toggle("hidden", !agentOpen); agentPanel.classList.toggle("flex", agentOpen); agentToggle.setAttribute("aria-expanded", String(agentOpen));
    if (!agentOpen) { if (chatTimer != null) window.clearInterval(chatTimer); chatTimer = null; return; }
    const session = activeSession(); chatRootId = Number(localStorage.getItem(threadKey(session.path)) || 0);
    const stream = h("div", { class: "min-h-0 flex-1 space-y-3 overflow-y-auto p-3", dataset: { coworkChatStream: "" } });
    const input = h("textarea", { class: "min-h-20 w-full resize-none bg-transparent p-2 text-sm text-fg outline-none placeholder:text-faint", rows: 3, placeholder: session.path ? `Ask @${channel.agent?.name || "agent"} about this file…` : "Open a file to give the agent its path…", disabled: !session.path }) as HTMLTextAreaElement;
    const send = async (): Promise<void> => {
      const message = input.value.trim(); if (!message || !session.path) return;
      input.disabled = true;
      try {
        const body = chatRootId ? message : `@${channel.agent?.name || "agent"} ${message}\n\nWorking file: /workspace/${session.path}`;
        const result = await api<{ message: Message }>(`/api/channels/${channelId}/messages`, { body: { body, parentId: chatRootId || null } });
        if (!chatRootId) { chatRootId = result.message.id; localStorage.setItem(threadKey(session.path), String(chatRootId)); }
        input.value = ""; await renderChatMessages();
      } catch (error) { void appAlert((error as Error).message); }
      finally { input.disabled = false; input.focus(); }
    };
    input.onkeydown = (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } };
    clear(agentPanel);
    agentPanel.append(h("header", { class: "flex min-h-14 items-center gap-2 border-b border-line px-3" }, agentAvatar.cloneNode(true), h("div", { class: "min-w-0 flex-1" }, h("div", { class: "truncate text-sm font-semibold text-fg" }, channel.agent?.display_name || channel.agent?.name || "Channel agent"), h("div", { class: "truncate text-[10px] text-muted" }, session.path ? `/workspace/${session.path}` : "Open a file")), chatRootId ? h("button", { class: "btn-ghost text-xs", onclick: async () => { try { const result = await api<{ root: Message }>(`/api/messages/${chatRootId}/thread`); openThreadCallback(result.root); } catch (error) { void appAlert((error as Error).message); } } }, "Open in Chat") : null, h("button", { class: "grid h-8 w-8 place-items-center rounded text-muted hover:bg-hover", "aria-label": "Close agent panel", onclick: () => { agentOpen = false; drawAgent(); } }, icon("x", 15))), stream,
      h("div", { class: "border-t border-line p-2" }, chatRootId ? h("button", { class: "btn-ghost mb-1 text-[11px]", onclick: () => { chatRootId = 0; localStorage.removeItem(threadKey(session.path)); drawAgent(); } }, "New session") : h("p", { class: "px-2 pb-1 text-[11px] leading-4 text-muted" }, "Your first message starts a normal channel session and includes this file path."), h("div", { class: "rounded-lg border border-line bg-raised/40 focus-within:border-accent" }, input, h("div", { class: "flex justify-end p-1.5" }, h("button", { class: "btn-primary text-xs", disabled: !session.path, onclick: () => { void send(); } }, icon("send", 13), "Send")))));
    void renderChatMessages(); if (chatTimer != null) window.clearInterval(chatTimer); chatTimer = window.setInterval(() => { if (!shell.isConnected || !agentOpen) { if (chatTimer != null) window.clearInterval(chatTimer); chatTimer = null; return; } void renderChatMessages(); }, 1600);
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  };

  agentToggle.onclick = () => { agentOpen = !agentOpen; drawAgent(); };
  search.oninput = () => { filter = search.value.trim().toLowerCase(); void loadFiles(); };
  const createFolder = async (): Promise<void> => { const name = await appPrompt("Folder name"); if (!name) return; try { await api(`/api/channels/${channelId}/files/directories`, { body: { path: activeSession().folder, name } }); await loadFiles(); } catch (error) { status.textContent = (error as Error).message; } };
  const createFile = async (): Promise<void> => { const item = activeSection(); const name = await appPrompt(`New ${item.label.toLowerCase()} file`, item.defaultName); if (!name) return; try { const result = await api<{ file: ChannelFile }>(`/api/channels/${channelId}/files/entries`, { body: { parent: activeSession().folder, name, content: starterContent(section) } }); await openPath(result.file.path); } catch (error) { status.textContent = (error as Error).message; } };

  const draw = async (): Promise<void> => { updateSectionNav(); drawBreadcrumb(); await Promise.all([loadFiles(), drawWorkspace()]); drawAgent(); };
  const rail = h("aside", { class: "cowork-files flex min-h-0 w-[min(18rem,28vw)] shrink-0 flex-col border-r border-line bg-surface" }, h("div", { class: "space-y-2 border-b border-line p-3" }, h("div", { class: "flex items-center gap-2" }, breadcrumb, h("button", { class: "grid h-8 w-8 shrink-0 place-items-center rounded text-muted hover:bg-hover", title: "New folder", onclick: () => { void createFolder(); } }, icon("folder", 14)), h("button", { class: "grid h-8 w-8 shrink-0 place-items-center rounded bg-accent text-white", title: "New file", onclick: () => { void createFile(); } }, icon("plus", 14))), search), fileList, h("div", { class: "min-h-9 border-t border-line px-3 py-2" }, status));
  shell.append(h("header", { class: "flex min-h-14 items-center gap-3 border-b border-line px-3 sm:px-4" }, h("div", { class: "min-w-0 flex-1" }, h("h2", { class: "font-display text-xl text-fg" }, "Cowork"), h("p", { class: "truncate text-xs text-muted" }, "Work directly in this channel's /workspace files"))), sectionNav, h("div", { class: "flex min-h-0 flex-1" }, rail, workspace, agentPanel));
  const surface: CoworkSurface = { node: shell, openPath, reload: async () => { await draw(); }, setOpenThread: (callback) => { openThreadCallback = callback; } }; surfaces.set(channelId, surface); clear(container); container.append(shell);
  const staged = pendingPaths.get(channelId); pendingPaths.delete(channelId); if (staged) void openPath(staged); else void draw();
}

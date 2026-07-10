import { api, uploadFile, connectEvents, getToken, setToken, clearToken, type User, type Channel, type Message, type Bot, type Computer, type Provider, type Workspace } from "./api.ts";
import { h, clear, add, md, color, initials, timeLabel, dayLabel, sameDay, beep, icon, helmMark } from "./dom.ts";
import { openSettings, modelRoutingPanel, finishOpenRouterOAuth } from "./settings.ts";
import { openOnboarding } from "./onboarding.ts";
import { openTerminals } from "./term.ts";

type State = {
  me: User; users: User[]; channels: Channel[]; bots: Bot[]; computers: Computer[]; providers: Provider[];
  workspace: Workspace;
  channelId: number; channelBots: Bot[]; messages: Message[];
  threadRoot: Message | null; threadReplies: Message[]; view: "chat" | "terminal";
};
export const S = {} as State;
const root = document.getElementById("app")!;
const pending: { token: string; name: string; mime: string; size: number }[] = [];

// ---------------- theme ----------------
export function currentTheme(): "light" | "dark" { return document.documentElement.classList.contains("light") ? "light" : "dark"; }
export function toggleTheme(): void {
  const next = currentTheme() === "light" ? "dark" : "light";
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(next);
  localStorage.setItem("ctrl.theme", next);
  window.dispatchEvent(new CustomEvent("themechange", { detail: next }));
  renderApp();
}

// ---------------- boot ----------------
export async function boot(): Promise<void> {
  const setup = await api<{ needs_setup: boolean; has_users: boolean; setup_complete: boolean; workspace: Workspace }>("/api/setup/status").catch(() => null);
  if (setup && !setup.has_users) return openOnboarding(root, { resume: false, onDone: () => boot() });
  if (!getToken()) return renderAuth();
  try {
    const me = await api<{ user: User; workspace: Workspace }>("/api/me");
    S.me = me.user;
    S.workspace = me.workspace;
  } catch { clearToken(); return renderAuth(); }
  // Complete OpenRouter OAuth before loading the workspace so a failed
  // channel/provider fetch cannot swallow the callback.
  const oauth = await finishOpenRouterOAuth();
  if (!S.workspace.setup_complete && S.me.is_admin) {
    return openOnboarding(root, { resume: true, resumeStep: oauth.connected ? 2 : 1, onDone: () => boot() });
  }
  await enterWorkspace();
}

async function enterWorkspace(preferredChannelId?: number): Promise<void> {
  S.messages = S.messages || []; S.channelBots = S.channelBots || []; S.view = "chat";
  if (!S.workspace) {
    try { S.workspace = (await api<{ workspace: Workspace }>("/api/workspace")).workspace; }
    catch { S.workspace = { name: "My Workspace", terminals_enabled: true, setup_complete: true }; }
  }
  await loadWorkspace();
  connectEvents(onEvent);
  if (preferredChannelId) S.channelId = preferredChannelId;
  const main = S.channels.find((c) => c.name === "main" && c.kind === "channel");
  if (!S.channelId && main) S.channelId = main.id;
  if (S.channelId) await openChannel(S.channelId);
  else renderApp();
}

async function loadWorkspace(): Promise<void> {
  const [ch, us, bots, comps, provs, ws] = await Promise.all([
    api<{ channels: Channel[] }>("/api/channels"),
    api<{ users: User[] }>("/api/users"),
    api<{ bots: Bot[] }>("/api/bots"),
    api<{ computers: Computer[] }>("/api/computers"),
    api<{ providers: Provider[] }>("/api/providers"),
    api<{ workspace: Workspace }>("/api/workspace").catch(() => ({ workspace: S.workspace })),
  ]);
  S.channels = ch.channels; S.users = us.users; S.bots = bots.bots; S.computers = comps.computers; S.providers = provs.providers;
  if (ws?.workspace) S.workspace = ws.workspace;
  if (!S.channelId || !S.channels.find((c) => c.id === S.channelId)) {
    const main = S.channels.find((c) => c.name === "main" && c.kind === "channel");
    S.channelId = main?.id || S.channels[0]?.id || 0;
  }
}

async function openChannel(id: number): Promise<void> {
  S.channelId = id; S.threadRoot = null; S.view = "chat";
  const data = await api<{ messages: Message[]; bots: Bot[] }>(`/api/channels/${id}/messages`);
  S.messages = data.messages; S.channelBots = data.bots;
  const c = S.channels.find((x) => x.id === id); if (c) c.unread = 0;
  renderApp();
}
export async function reloadBots(): Promise<void> {
  S.bots = (await api<{ bots: Bot[] }>("/api/bots")).bots;
  S.channelBots = S.channelBots.map((x) => S.bots.find((y) => y.id === x.id) || x);
}
export async function reloadProviders(): Promise<void> { S.providers = (await api<{ providers: Provider[] }>("/api/providers")).providers; }

// ---------------- events ----------------
function onEvent(e: any): void {
  if (e.type === "message" || e.type === "message_update") {
    const msg = e.message as Message;
    const mine = msg.author.kind === "user" && msg.author.id === S.me.id;
    const mentionsMe = new RegExp(`@${S.me.username}\\b`, "i").test(msg.body);
    if (msg.channel_id === S.channelId) {
      applyMessage(msg, e.type === "message_update");
      if (e.type === "message" && !mine) beep(mentionsMe ? "mention" : "msg");
      renderMessages(); if (S.threadRoot) renderThread();
    } else if (e.type === "message" && !mine) {
      const c = S.channels.find((x) => x.id === msg.channel_id); if (c && msg.parent_id == null) c.unread++;
      beep(mentionsMe ? "mention" : "msg"); renderSidebar();
    }
  } else if (e.type === "bot_prompt") botPrompt(e);
  else if (e.type === "channel_new") loadWorkspace().then(renderSidebar);
  else if (e.type === "channel_bots") { if (S.channelBots) { S.channelBots = e.bots; renderHeader(); } }
}

function applyMessage(msg: Message, isUpdate: boolean): void {
  if (msg.parent_id != null) {
    const parent = S.messages.find((m) => m.id === msg.parent_id);
    if (parent && !isUpdate) parent.reply_count++;
  }
  const list = msg.parent_id == null ? S.messages : (S.threadRoot && msg.parent_id === S.threadRoot.id ? S.threadReplies : null);
  if (!list) return;
  const i = list.findIndex((m) => m.id === msg.id);
  if (i >= 0) list[i] = msg; else list.push(msg);
}

// ---------------- auth ----------------
function renderAuth(): void {
  clear(root);
  const err = h("p", { class: "min-h-5 text-sm text-danger" });
  const u = h("input", { class: "field", placeholder: "username", autocomplete: "username" });
  const pw = h("input", { class: "field", type: "password", placeholder: "password", autocomplete: "current-password" });
  const submit = async (): Promise<void> => {
    err.textContent = "";
    try { const r = await api<{ token: string; user: User }>("/api/auth/login", { body: { username: u.value, password: pw.value } }); setToken(r.token); boot(); }
    catch (e) { err.textContent = (e as Error).message; }
  };
  root.append(h("div", { class: "auth-stage grid h-full place-items-center p-6" },
    h("div", { class: "w-full max-w-[400px]" },
      h("div", { class: "mb-7 flex items-center justify-center gap-3" },
        h("div", { class: "logo-plate h-11 w-11 rounded-xl" }, h("img", { class: "logo-asset", src: "/brand/1helm.png", alt: "1Helm" })),
        h("div", {}, h("h1", { class: "font-display text-2xl font-bold tracking-[-0.04em] text-fg" }, "1Helm"), h("p", { class: "mt-0.5 text-xs uppercase tracking-[0.16em] text-muted" }, "Control plane"))),
      h("div", { class: "card space-y-3 p-7" },
        h("div", { class: "mb-2" }, h("h2", { class: "text-lg font-semibold text-fg" }, "Enter the bridge"), h("p", { class: "mt-1 text-sm text-muted" }, "Sign in to your workspace.")),
        u, pw, err,
        h("button", { class: "btn-primary w-full py-2", onclick: submit }, "Sign in")))));
  pw.addEventListener("keydown", (ev) => { if ((ev as KeyboardEvent).key === "Enter") submit(); });
  u.focus();
}

// ---------------- layout ----------------
export function renderApp(): void {
  clear(root);
  root.append(h("div", { class: "flex h-full" }, sidebar(), h("main", { id: "main", class: "flex min-w-0 flex-1 bg-bg" })));
  if (S.view === "terminal") openTerminals(document.getElementById("main")!);
  else renderMain();
}

function sidebar(): HTMLElement {
  const chan = (c: Channel): HTMLElement => {
    const active = c.id === S.channelId && S.view === "chat";
    return h("button", {
      class: `nav-item ${active ? "nav-item-active" : "nav-item-idle"} ${c.unread ? "font-semibold text-white" : ""}`,
      onclick: () => openChannel(c.id),
    },
      c.kind === "dm"
        ? h("span", { class: "relative grid h-4 w-4 shrink-0 place-items-center rounded-sm border border-white/10 text-[9px] font-semibold", style: `background:${color(c.name)};color:#f4f7fb` }, initials(c.name))
        : h("span", { class: "shrink-0 text-sidebar-muted" }, icon("hash", 14)),
      h("span", { class: "flex-1 truncate" }, c.name),
      c.unread > 0 && h("span", { class: "min-w-5 rounded-full bg-danger px-1.5 text-center text-[11px] font-bold text-white" }, String(c.unread)));
  };
  const channels = S.channels.filter((c) => c.kind === "channel");
  const dms = S.channels.filter((c) => c.kind === "dm");
  const theme = currentTheme();

  return h("aside", { class: "flex w-64 shrink-0 flex-col border-r border-white/5 bg-sidebar text-sidebar-fg" },
    h("div", { class: "flex items-center justify-between border-b border-white/10 px-4 py-3.5" },
      h("div", { class: "flex min-w-0 items-center gap-2.5 font-bold text-white" }, h("span", { class: "logo-plate h-7 w-7 rounded-lg" }, h("img", { class: "logo-asset", src: "/brand/1helm.png", alt: "1Helm" })), h("span", { class: "truncate tracking-[-0.025em]" }, S.workspace?.name || "1Helm")),
      h("button", { class: "grid h-7 w-7 place-items-center rounded-md text-sidebar-muted hover:bg-sidebar-hover hover:text-white", title: theme === "light" ? "Switch to dark" : "Switch to light", onclick: toggleTheme }, icon(theme === "light" ? "moon" : "sun"))),
    h("div", { class: "flex-1 space-y-5 overflow-y-auto px-2 py-3" },
      h("div", {}, sbSection("Channels", () => newChannel()), h("div", { class: "space-y-px" }, ...channels.map(chan))),
      h("div", {}, sbSection("Direct messages", () => newDM()), h("div", { class: "space-y-px" }, ...dms.map(chan), dms.length === 0 && h("p", { class: "px-2 py-1 text-[13px] text-sidebar-muted" }, "No conversations yet"))),
      (S.workspace?.terminals_enabled !== false) && h("button", { class: `nav-item ${S.view === "terminal" ? "nav-item-active" : "nav-item-idle"}`, onclick: () => { S.view = "terminal"; renderApp(); } },
        h("span", { class: "text-sidebar-muted" }, icon("terminal")), "Terminals")),
    h("button", { class: "flex items-center gap-2 border-t border-white/10 px-3 py-2 text-left hover:bg-sidebar-hover", title: "Settings", onclick: () => openSettings() },
      avatar(S.me.display, "user"),
      h("div", { class: "min-w-0 flex-1" }, h("div", { class: "truncate text-sm font-semibold text-white" }, S.me.display), h("div", { class: "flex items-center gap-1 truncate text-xs text-sidebar-muted" }, h("span", { class: "h-2 w-2 rounded-full bg-ok" }), "@" + S.me.username + (S.me.is_admin ? " · admin" : ""))),
      h("span", { class: "text-sidebar-muted" }, icon("gear"))));
}

const sbSection = (label: string, onAdd: () => void): HTMLElement =>
  h("div", { class: "flex items-center justify-between px-2 pb-0.5" },
    h("span", { class: "text-xs font-semibold uppercase tracking-wide text-sidebar-muted" }, label),
    h("button", { class: "grid h-5 w-5 place-items-center rounded text-sidebar-muted hover:bg-sidebar-hover hover:text-white", title: "Add", onclick: onAdd }, "+"));

async function newChannel(): Promise<void> {
  const name = prompt("New channel name:")?.trim(); if (!name) return;
  await api("/api/channels", { body: { name } }); await loadWorkspace();
  const c = S.channels.find((x) => x.name === name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")); if (c) openChannel(c.id); else renderSidebar();
}
function newDM(): void {
  const others = S.users.filter((u) => u.id !== S.me.id);
  if (!others.length) return alert("No other users yet.");
  pickList("Start a direct message", others.map((u) => ({ id: u.id, label: u.display + " · @" + u.username })), async (id) => {
    const r = await api<{ channel: Channel }>("/api/dm", { body: { userId: id } }); await loadWorkspace(); openChannel(r.channel.id);
  });
}

// ---------------- main chat ----------------
function renderMain(): void {
  const main = document.getElementById("main")!; clear(main);
  main.append(
    h("section", { class: "flex min-w-0 flex-1 flex-col" }, h("div", { id: "hdr" }), h("div", { id: "msgs", class: "flex-1 overflow-y-auto py-3" }), composer(null)),
    h("aside", { id: "thread", class: "hidden w-[440px] shrink-0 flex-col border-l border-line bg-surface" }),
  );
  renderHeader(); renderMessages(); if (S.threadRoot) renderThread();
}

function renderHeader(): void {
  const el = document.getElementById("hdr"); if (!el) return;
  const c = S.channels.find((x) => x.id === S.channelId);
  clear(el);
  el.className = "flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5";
  add(el,
    h("div", { class: "flex min-w-0 items-center gap-2" },
      h("div", { class: "flex items-center gap-1.5 text-[17px] font-bold text-fg" }, c?.kind === "dm" ? null : h("span", { class: "text-muted" }, "#"), h("span", { class: "truncate" }, c?.name || "")),
      c?.topic ? h("span", { class: "hidden truncate border-l border-line pl-2 text-[13px] text-muted md:inline" }, c.topic) : null),
    h("div", { class: "flex shrink-0 items-center gap-1.5" },
      ...S.channelBots.map((b) => h("span", { class: "chip", title: "Bot in this channel" }, avatar(b.name, "bot", 4), b.name)),
      S.channelBots.length ? h("button", { class: "btn-subtle text-xs", onclick: (ev: MouseEvent) => modelPopover(ev, S.channelId, null) }, icon("sliders"), "Models") : null));
}

function renderMessages(): void {
  const box = document.getElementById("msgs"); if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  clear(box);
  if (!S.messages.length) { box.append(emptyState(S.channels.find((c) => c.id === S.channelId))); return; }
  let prev: Message | null = null;
  for (const m of S.messages) {
    if (!prev || !sameDay(prev.created, m.created)) box.append(dateDivider(m.created));
    const grouped = !!prev && sameDay(prev.created, m.created) && prev.author.kind === m.author.kind && prev.author.id === m.author.id && m.created - prev.created < 5 * 60 * 1000 && !m.attachments?.length;
    box.append(messageRow(m, { grouped, inThread: false }));
    prev = m;
  }
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function emptyState(c: Channel | undefined): HTMLElement {
  return h("div", { class: "flex h-full flex-col items-center justify-center gap-3 px-6 text-center" },
    h("div", { class: "brand-mark grid h-14 w-14 place-items-center rounded-2xl" }, c?.kind === "dm" ? helmMark(25) : icon("hash", 24)),
    h("div", { class: "text-lg font-semibold tracking-[-0.02em] text-fg" }, c?.kind === "dm" ? c.name : "#" + (c?.name || "")),
    h("p", { class: "max-w-sm text-sm leading-6 text-muted" }, "This channel is clear. Start with a message, a file, or a focused thread with an agent."));
}

function dateDivider(ts: number): HTMLElement {
  return h("div", { class: "sticky top-0 z-10 my-1 flex items-center gap-3 px-4" },
    h("div", { class: "h-px flex-1 bg-line" }),
    h("span", { class: "rounded-full border border-line bg-surface px-3 py-0.5 text-xs font-semibold text-muted shadow-sm" }, dayLabel(ts)),
    h("div", { class: "h-px flex-1 bg-line" }));
}

function messageRow(m: Message, opts: { grouped: boolean; inThread: boolean }): HTMLElement {
  const isBot = m.author.kind === "bot";
  const bodyHtml = h("div", { class: "md text-fg", html: md(m.body || (isBot ? "_thinking…_" : "")) });
  const actions = h("div", { class: "absolute right-3 -top-3 hidden gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-md group-hover:flex" },
    !opts.inThread ? h("button", { class: "grid h-7 w-7 place-items-center rounded text-muted hover:bg-hover hover:text-fg", title: "Reply in thread", onclick: () => openThread(m) }, icon("thread")) : null);

  if (opts.grouped) {
    return h("div", { class: "group relative flex gap-3 px-4 py-0.5 hover:bg-hover" },
      h("span", { class: "w-9 shrink-0 pt-0.5 text-right text-[10px] leading-5 text-transparent group-hover:text-faint" }, new Date(m.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).replace(/\s?[AP]M/i, "")),
      h("div", { class: "min-w-0 flex-1" }, bodyHtml, attachments(m), threadFooter(m, opts.inThread)), actions);
  }
  return h("div", { class: "group relative flex gap-3 px-4 py-1 hover:bg-hover" },
    avatar(m.author.name, m.author.kind, 9),
    h("div", { class: "min-w-0 flex-1" },
      h("div", { class: "flex items-baseline gap-2" },
        h("span", { class: "font-bold text-fg hover:underline" }, m.author.name),
        isBot ? h("span", { class: "rounded-sm border border-accent/25 bg-accent-soft px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.12em] text-accent" }, "Agent") : null,
        h("span", { class: "text-xs text-faint" }, timeLabel(m.created))),
      bodyHtml, attachments(m), threadFooter(m, opts.inThread)), actions);
}

function threadFooter(m: Message, inThread: boolean): HTMLElement | null {
  if (inThread || m.reply_count <= 0) return null;
  const last = m.last_reply ? timeLabel(m.last_reply) : "";
  return h("button", { class: "mt-1 flex w-fit items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-xs font-semibold text-accent hover:border-line hover:bg-surface", onclick: () => openThread(m) },
    icon("thread"), `${m.reply_count} ${m.reply_count === 1 ? "reply" : "replies"}`, last ? h("span", { class: "font-normal text-muted" }, "· last " + last) : null);
}

function attachments(m: Message): HTMLElement | null {
  if (!m.attachments?.length) return null;
  return h("div", { class: "mt-1.5 flex flex-wrap gap-2" }, ...m.attachments.map((a) => {
    const url = `/api/files/${a.id}`;
    if (a.mime.startsWith("image/")) return h("a", { href: url, target: "_blank" }, h("img", { src: url, class: "max-h-64 rounded-xl border border-line" }));
    return h("a", { href: url, target: "_blank", class: "flex items-center gap-2.5 rounded-xl border border-line bg-raised px-3 py-2 text-sm hover:border-accent" },
      h("span", { class: "grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent" }, icon("file")),
      h("div", { class: "min-w-0" }, h("div", { class: "truncate font-medium text-fg" }, a.name), h("div", { class: "text-xs text-muted" }, fmtSize(a.size))));
  }));
}

// ---------------- thread panel ----------------
async function openThread(root: Message): Promise<void> {
  const data = await api<{ root: Message; replies: Message[] }>(`/api/messages/${root.id}/thread`);
  S.threadRoot = data.root; S.threadReplies = data.replies; renderThread();
}
function renderThread(): void {
  const el = document.getElementById("thread"); if (!el || !S.threadRoot) return;
  el.className = "flex w-[440px] shrink-0 flex-col border-l border-line bg-surface";
  clear(el);
  el.append(
    h("div", { class: "flex items-center justify-between border-b border-line px-4 py-2.5" },
      h("div", {}, h("div", { class: "font-bold text-fg" }, "Thread"), h("div", { class: "text-xs text-muted" }, "#" + (S.channels.find((c) => c.id === S.channelId)?.name || ""))),
      h("div", { class: "flex items-center gap-1" },
        S.channelBots.length ? h("button", { class: "btn-subtle text-xs", onclick: (ev: MouseEvent) => modelPopover(ev, S.channelId, S.threadRoot!.id) }, icon("sliders"), "Models") : null,
        h("button", { class: "grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg", onclick: () => { S.threadRoot = null; renderMain(); } }, "✕"))),
    h("div", { id: "threadmsgs", class: "flex-1 overflow-y-auto py-2" },
      messageRow(S.threadRoot, { grouped: false, inThread: true }),
      h("div", { class: "mx-4 my-2 flex items-center gap-2 text-xs font-semibold text-muted" }, h("span", {}, `${S.threadReplies.length} ${S.threadReplies.length === 1 ? "reply" : "replies"}`), h("div", { class: "h-px flex-1 bg-line" })),
      ...S.threadReplies.map((r) => messageRow(r, { grouped: false, inThread: true }))),
    composer(S.threadRoot.id));
  const tm = document.getElementById("threadmsgs"); if (tm) tm.scrollTop = tm.scrollHeight;
}

// ---------------- composer ----------------
function composer(parentId: number | null): HTMLElement {
  const attachBar = h("div", { class: "flex flex-wrap gap-2 px-1 pt-1 empty:hidden" });
  const input = h("textarea", { class: "max-h-44 min-h-[24px] w-full resize-none bg-transparent px-1 py-1 text-[15px] text-fg outline-none placeholder:text-faint", rows: 1, placeholder: parentId ? "Reply…" : "Message (type @ to mention a bot)" }) as HTMLTextAreaElement;
  const mentionBox = h("div", { class: "absolute bottom-full left-0 z-20 mb-2 hidden w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-xl" });

  const drawAttach = (): void => { clear(attachBar); pending.forEach((p, i) => attachBar.append(h("span", { class: "chip py-1" }, icon("file"), p.name, h("button", { class: "text-faint hover:text-danger", onclick: () => { pending.splice(i, 1); drawAttach(); } }, "✕")))); };
  const send = async (): Promise<void> => {
    const body = input.value.trim(); if (!body && !pending.length) return;
    const uploads = pending.splice(0); drawAttach();
    input.value = ""; input.style.height = "auto";
    await api(`/api/channels/${S.channelId}/messages`, { body: { body, parentId, uploads } });
  };
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 176) + "px"; mentionAutocomplete(input, mentionBox); });
  input.addEventListener("keydown", (ev) => {
    const k = ev as KeyboardEvent;
    if (!mentionBox.classList.contains("hidden") && ["Enter", "Tab", "ArrowDown", "ArrowUp"].includes(k.key)) { if (handleMentionKey(k, mentionBox, input)) { k.preventDefault(); return; } }
    if (k.key === "Escape") mentionBox.classList.add("hidden");
    if (k.key === "Enter" && !k.shiftKey) { k.preventDefault(); send(); }
  });

  const box = h("div", { class: "relative rounded-xl border border-line bg-surface transition focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--c-accent-soft)]" },
    mentionBox, attachBar,
    h("div", { class: "px-2 pt-1.5" }, input),
    h("div", { class: "flex items-center justify-between px-1.5 pb-1.5" },
      h("label", { class: "grid h-8 w-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-hover hover:text-fg", title: "Attach files" }, icon("paperclip"),
        h("input", { type: "file", multiple: true, class: "hidden", onchange: async (ev: Event) => { for (const f of Array.from((ev.target as HTMLInputElement).files || [])) pending.push(await uploadFile(f)); drawAttach(); } })),
      h("button", { class: "btn-primary h-8 px-3 text-sm", onclick: send }, icon("send"), "Send")));
  const wrap = h("div", { class: "px-4 pb-4 pt-1" }, box);

  wrap.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("border-accent", "shadow-[0_0_0_3px_var(--c-accent-soft)]"); });
  wrap.addEventListener("dragleave", () => box.classList.remove("border-accent"));
  wrap.addEventListener("drop", async (e) => { e.preventDefault(); box.classList.remove("border-accent"); for (const f of Array.from((e as DragEvent).dataTransfer?.files || [])) pending.push(await uploadFile(f)); drawAttach(); });
  drawAttach();
  return wrap;
}

// ---------------- @mention autocomplete ----------------
const currentMention = (input: HTMLTextAreaElement): string | null => { const m = input.value.slice(0, input.selectionStart).match(/@([a-zA-Z0-9_.-]*)$/); return m ? m[1].toLowerCase() : null; };
function mentionAutocomplete(input: HTMLTextAreaElement, box: HTMLElement): void {
  const term = currentMention(input);
  if (term == null) return box.classList.add("hidden");
  const matches = S.bots.filter((b) => b.name.toLowerCase().startsWith(term)).slice(0, 6);
  if (!matches.length) return box.classList.add("hidden");
  clear(box); box.classList.remove("hidden");
  box.append(h("div", { class: "px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint" }, "Bots"));
  matches.forEach((b, i) => box.append(h("button", { class: `flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === 0 ? "bg-accent-soft" : "hover:bg-hover"}`, dataset: { name: b.name }, onclick: () => applyMention(input, b.name, box) },
    avatar(b.name, "bot", 6), h("span", { class: "font-medium text-fg" }, b.name), h("span", { class: "text-xs text-muted" }, b.model || "no model"))));
}
function applyMention(input: HTMLTextAreaElement, name: string, box: HTMLElement): void {
  const before = input.value.slice(0, input.selectionStart).replace(/@[a-zA-Z0-9_.-]*$/, "@" + name + " ");
  input.value = before + input.value.slice(input.selectionStart); input.selectionStart = input.selectionEnd = before.length; box.classList.add("hidden"); input.focus();
}
function handleMentionKey(k: KeyboardEvent, box: HTMLElement, input: HTMLTextAreaElement): boolean {
  const items = Array.from(box.querySelectorAll("button")) as HTMLElement[];
  if (!items.length) return false;
  let idx = items.findIndex((b) => b.classList.contains("bg-accent-soft"));
  if (k.key === "ArrowDown") idx = (idx + 1) % items.length;
  else if (k.key === "ArrowUp") idx = (idx - 1 + items.length) % items.length;
  else if (k.key === "Enter" || k.key === "Tab") { applyMention(input, items[Math.max(0, idx)].dataset.name!, box); return true; }
  else return false;
  items.forEach((b, i) => b.classList.toggle("bg-accent-soft", i === idx));
  return true;
}

// ---------------- bot add prompt ----------------
function botPrompt(e: { botId: number; botName: string; channelId: number; triggerId: number; threadRootId: number; fresh: boolean }): void {
  const c = S.channels.find((x) => x.id === e.channelId);
  const toast = h("div", { class: "card fixed bottom-6 left-1/2 z-50 flex w-[420px] -translate-x-1/2 items-center gap-3 p-4 shadow-2xl" },
    avatar(e.botName, "bot", 10),
    h("div", { class: "flex-1" }, h("div", { class: "text-sm text-fg" }, h("strong", {}, "@" + e.botName), " isn't in ", h("strong", {}, "#" + (c?.name || "channel")), " yet."), h("div", { class: "text-xs text-muted" }, "Add it so it can respond in a thread here.")),
    h("div", { class: "flex gap-2" },
      h("button", { class: "btn-ghost text-sm", onclick: () => toast.remove() }, "Not now"),
      h("button", { class: "btn-primary text-sm", onclick: async () => { toast.remove(); await api(`/api/bots/${e.botId}/join`, { body: { channelId: e.channelId, triggerId: e.triggerId, threadRootId: e.threadRootId, fresh: e.fresh } }); } }, "Add")));
  document.body.append(toast);
  setTimeout(() => toast.remove(), 15000);
}

// ---------------- model routing popover ----------------
function modelPopover(ev: MouseEvent, channelId: number, threadId: number | null): void {
  const pop = h("div", { class: "card fixed z-50 w-[380px] p-0 shadow-2xl" });
  pop.style.left = Math.min(ev.clientX, window.innerWidth - 400) + "px";
  pop.style.top = Math.min(ev.clientY + 12, window.innerHeight - 420) + "px";
  pop.append(h("div", { class: "flex items-center gap-2 border-b border-line px-4 py-2.5" }, h("span", { class: "text-accent" }, icon("sliders")), h("div", { class: "text-sm font-semibold text-fg" }, "Model routing"), h("span", { class: "text-xs text-muted" }, threadId ? "this thread" : "#" + (S.channels.find((c) => c.id === channelId)?.name || ""))));
  const body = h("div", { class: "max-h-[60vh] space-y-4 overflow-y-auto p-4" });
  S.channelBots.forEach((b) => body.append(modelRoutingPanel(b, channelId, threadId, async () => { await reloadBots(); })));
  pop.append(body);
  const close = (e: MouseEvent): void => { if (!pop.contains(e.target as Node)) { pop.remove(); document.removeEventListener("mousedown", close); } };
  document.body.append(pop); setTimeout(() => document.addEventListener("mousedown", close), 0);
}

// ---------------- shared atoms ----------------
export function avatar(name: string, kind: "user" | "bot", size = 8): HTMLElement {
  const px = size * 4;
  if (kind === "bot") return h("div", { class: "identity-bot rounded-md", style: `width:${px}px;height:${px}px;font-size:${Math.max(9, px / 3.2)}px` }, helmMark(Math.max(12, px * .52)));
  return h("div", { class: "identity-user rounded-lg", style: `width:${px}px;height:${px}px;font-size:${Math.max(8, px / 2.8)}px` }, initials(name));
}
export function pickList(title: string, items: { id: number; label: string }[], onPick: (id: number) => void): void {
  const overlay = h("div", { class: "fixed inset-0 z-50 grid place-items-center bg-black/40 p-6", onclick: (e: MouseEvent) => { if (e.target === overlay) overlay.remove(); } },
    h("div", { class: "card max-h-[70vh] w-96 overflow-y-auto p-2 shadow-2xl" }, h("div", { class: "px-2 py-1.5 font-semibold text-fg" }, title),
      ...items.map((it) => h("button", { class: "block w-full rounded-lg px-3 py-2 text-left text-sm text-fg hover:bg-hover", onclick: () => { overlay.remove(); onPick(it.id); } }, it.label))));
  document.body.append(overlay);
}
export const renderSidebar = (): void => { const s = document.querySelector("aside"); if (s && S.channels) s.replaceWith(sidebar()); };
const fmtSize = (n: number): string => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";

boot();

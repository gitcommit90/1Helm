import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api, getToken } from "./api.ts";
import { h, clear, icon } from "./dom.ts";
import { S } from "./app.ts";

type Pane = {
  id: string;
  sessionId: string | null;
  computerId: number;
  term: Terminal;
  fit: FitAddon;
  ws: WebSocket | null;
  el: HTMLElement;
  ro: ResizeObserver;
  disposed: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  reconnectAttempt: number;
  connectionGeneration: number;
  state: TerminalState;
};
type TerminalState = {
  channelId: number;
  columns: Pane[][];
  workspace: HTMLElement;
  grid: HTMLElement;
  body: HTMLElement;
  chromeTitle: HTMLElement;
  chromeLeft: HTMLElement;
  serversBtn: HTMLButtonElement | null;
  restored: boolean;
  preferredComputerId: number;
  serversListOpen: boolean;
  docked: boolean;
  onChromeChange?: () => void;
  onClose?: () => void;
};
type ListedSession = { id: string; computerId: number; channelId: number; clients: number };

const states = new Map<number, TerminalState>();
let seq = 0;
let themeHooked = false;
let reconnectHooksInstalled = false;

/* Night-watch terminal: warm ink field, paper text, vermillion cursor. */
const themes = {
  dark: { background: "#0b0c0f", foreground: "#e0ddd3", cursor: "#fa5d3e", cursorAccent: "#0b0c0f", selectionBackground: "#fa5d3e33", black: "#14161b", brightBlack: "#4b4c49", red: "#f06a86", green: "#46c08a", yellow: "#d9b16b", blue: "#7fa3c7", magenta: "#b392f0", cyan: "#5fb8a8", white: "#e0ddd3", brightWhite: "#f4f1e8" },
  light: { background: "#15171c", foreground: "#e6e3d9", cursor: "#fa5d3e", cursorAccent: "#15171c", selectionBackground: "#fa5d3e3d", black: "#1f2229", brightBlack: "#5c5d58", red: "#f27d95", green: "#54c893", yellow: "#dfba79", blue: "#8cadcd", magenta: "#bd9ff2", cyan: "#6fc2b3", white: "#e6e3d9", brightWhite: "#ffffff" },
};
const activeTheme = (): typeof themes.dark => (document.documentElement.classList.contains("light") ? themes.light : themes.dark);
export const hostComputerId = (): number => S.computers.find((computer) => computer.name === "This Computer")?.id || S.computers[0]?.id || 0;
export const remoteComputers = () => S.computers.filter((computer) => computer.name !== "This Computer");
// Zero is the channel's own persistent computer. Explicit IDs are advanced
// Skipper/remote computers and never become a resident channel's default.
export const defaultTerminalComputer = (channelId: number): number => S.channels.find((channel) => channel.id === channelId)?.agent?.kind === "skipper" ? hostComputerId() : 0;
const multiComputer = (channelId: number): boolean => S.channels.find((channel) => channel.id === channelId)?.agent?.kind === "skipper" && (S.computers?.length || 0) > 1;

export type OpenTerminalsOpts = {
  preferredComputerId?: number;
  serversListOpen?: boolean;
  docked?: boolean;
  onChromeChange?: () => void;
  /** Docked RHS only — Back / ✕ must dismiss the overlay (critical on mobile full-screen). */
  onClose?: () => void;
};

export function openTerminals(container: HTMLElement, channelId: number, preferredOrOpts?: number | OpenTerminalsOpts): void {
  const opts: OpenTerminalsOpts = typeof preferredOrOpts === "number" || preferredOrOpts == null
    ? { preferredComputerId: preferredOrOpts || undefined }
    : preferredOrOpts;
  container.className = "flex min-h-0 flex-1 overflow-hidden";
  let state = states.get(channelId);
  if (!state) {
    state = buildState(channelId, opts.preferredComputerId ?? defaultTerminalComputer(channelId), !!opts.docked, !!opts.serversListOpen, opts.onChromeChange, opts.onClose);
    states.set(channelId, state);
    void restoreSessions(state);
  } else {
    if (opts.preferredComputerId != null && opts.preferredComputerId !== state.preferredComputerId) {
      // Header / Servers chose a different computer while this channel already has a workspace —
      // open a fresh pane on that host instead of forcing a full remount.
      state.preferredComputerId = opts.preferredComputerId;
      if (!state.serversListOpen) {
        state.columns.push([makePane(state, null, opts.preferredComputerId)]);
        paintBody(state);
      }
    }
    if (opts.serversListOpen != null) state.serversListOpen = !!opts.serversListOpen;
    if (opts.docked != null) state.docked = !!opts.docked;
    if (opts.onChromeChange) state.onChromeChange = opts.onChromeChange;
    if (opts.onClose !== undefined) state.onClose = opts.onClose;
    paintChrome(state);
    paintBody(state);
  }
  if (!themeHooked) {
    themeHooked = true;
    window.addEventListener("themechange", () => states.forEach((item) => item.columns.flat().forEach((pane) => { pane.term.options.theme = activeTheme(); })));
  }
  if (!reconnectHooksInstalled) {
    reconnectHooksInstalled = true;
    const reconnectVisiblePanes = (): void => {
      if (document.visibilityState === "hidden") return;
      for (const item of states.values()) for (const pane of item.columns.flat()) {
        if (!pane.disposed && pane.ws?.readyState !== WebSocket.OPEN && pane.ws?.readyState !== WebSocket.CONNECTING) scheduleReconnect(pane, true);
      }
    };
    document.addEventListener("visibilitychange", reconnectVisiblePanes);
    window.addEventListener("online", reconnectVisiblePanes);
    window.addEventListener("focus", reconnectVisiblePanes);
  }
  if (state.workspace.parentElement !== container) {
    clear(container);
    container.append(state.workspace);
  }
  requestAnimationFrame(() => refit(state!));
}

export function getTerminalChrome(channelId: number): { serversListOpen: boolean; preferredComputerId: number } | null {
  const state = states.get(channelId);
  if (!state) return null;
  return { serversListOpen: state.serversListOpen, preferredComputerId: state.preferredComputerId };
}

export function setTerminalServersList(channelId: number, open: boolean): void {
  const state = states.get(channelId);
  if (!state) return;
  state.serversListOpen = open;
  paintChrome(state);
  paintBody(state);
  state.onChromeChange?.();
}

export function setTerminalPreferredComputer(channelId: number, computerId: number): void {
  const state = states.get(channelId);
  if (!state) return;
  state.preferredComputerId = Number.isFinite(computerId) ? computerId : defaultTerminalComputer(channelId);
  state.serversListOpen = false;
  const hasPane = state.columns.flat().some((pane) => pane.computerId === state.preferredComputerId);
  if (!hasPane) state.columns.push([makePane(state, null, state.preferredComputerId)]);
  paintChrome(state);
  paintBody(state);
  state.onChromeChange?.();
  requestAnimationFrame(() => refit(state));
}

export function refitChannelTerminals(channelId: number): void {
  const state = states.get(channelId);
  if (state) requestAnimationFrame(() => refit(state));
}

function buildState(
  channelId: number,
  preferredComputerId: number,
  docked: boolean,
  serversListOpen: boolean,
  onChromeChange?: () => void,
  onClose?: () => void,
): TerminalState {
  const grid = h("div", { class: "flex min-h-0 flex-1 gap-2 overflow-hidden p-2" });
  const body = h("div", { class: "flex min-h-0 flex-1 flex-col overflow-hidden" }, grid);
  const chromeTitle = h("div", { class: "min-w-0" });
  const chromeLeft = h("div", { class: "flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2" });
  const state: TerminalState = {
    channelId, columns: [], workspace: null as unknown as HTMLElement, grid, body, chromeTitle, chromeLeft,
    serversBtn: null, restored: false, preferredComputerId, serversListOpen, docked, onChromeChange, onClose,
  };
  state.workspace = h("div", { class: "term-workspace flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg" },
    h("div", { class: "term-chrome app-topbar flex min-h-12 items-center justify-between gap-2 border-b border-line bg-surface px-2 py-1.5 sm:gap-3 sm:px-4 sm:py-2.5" },
      chromeLeft,
      h("div", { class: "term-chrome-actions flex shrink-0 items-center gap-1.5" })),
    body);
  paintChrome(state);
  return state;
}

function paintChrome(state: TerminalState): void {
  const actions = state.workspace.querySelector(".term-chrome-actions");
  if (!actions) return;
  clear(actions as HTMLElement);
  clear(state.chromeLeft);
  state.serversBtn = null;
  const channel = S.channels.find((item) => item.id === state.channelId);
  const titleText = state.serversListOpen ? "Servers" : (state.docked ? "Terminal" : `#${channel?.name || "channel"} terminal`);
  const subtitle = state.serversListOpen
    ? "Pick a computer"
    : (channel?.name ? `#${channel.name}` : "Channel shell");

  // Docked terminal is a full-screen overlay on mobile — always expose Back + ✕.
  if (state.docked && state.onClose) {
    state.chromeLeft.append(
      h("button", {
        type: "button",
        class: "btn-subtle inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2.5 text-sm sm:min-h-9",
        title: "Close terminal",
        "aria-label": "Close terminal and return to channel",
        onclick: () => state.onClose?.(),
      }, icon("chevronLeft", 18), h("span", { class: "font-semibold" }, "Back")),
      h("div", { class: "min-w-0" },
        h("div", { class: "flex items-center gap-1.5 truncate text-[15px] font-semibold text-fg" },
          h("span", { class: "shrink-0 text-accent" }, icon("terminal", 16)),
          h("span", { class: "truncate" }, titleText)),
        h("div", { class: "truncate font-mono text-[10.5px] text-faint" }, subtitle)),
    );
  } else {
    state.chromeLeft.append(
      h("div", { class: "flex min-w-0 items-center gap-2 font-bold text-fg" },
        h("span", { class: "text-accent" }, icon("terminal")),
        h("span", { class: "truncate" }, titleText)),
      h("span", { class: "hidden text-xs text-muted lg:inline" }, "Shell starts in this channel's /workspace"),
    );
  }

  if (multiComputer(state.channelId)) {
    const btn = h("button", {
      class: "btn-subtle min-h-11 px-2.5 text-xs sm:min-h-9",
      type: "button",
      title: state.serversListOpen ? "Return to terminal" : "Choose computer",
      onclick: () => {
        state.serversListOpen = !state.serversListOpen;
        paintChrome(state);
        paintBody(state);
        state.onChromeChange?.();
        requestAnimationFrame(() => refit(state));
      },
    },
      h("span", { class: "sm:hidden" }, state.serversListOpen ? "Return" : "Servers"),
      h("span", { class: "hidden sm:inline" }, state.serversListOpen ? "Return to Terminal" : "Servers"),
    ) as HTMLButtonElement;
    state.serversBtn = btn;
    actions.append(btn);
  }
  if (!state.serversListOpen) {
    actions.append(h("button", {
      class: "btn-primary min-h-11 px-2.5 text-xs sm:min-h-9",
      type: "button",
      title: "New terminal",
      "aria-label": "New terminal",
      onclick: () => addColumn(state),
    }, icon("plus", 14), h("span", { class: "hidden sm:inline" }, "New")));
  }
  if (state.docked && state.onClose) {
    actions.append(h("button", {
      type: "button",
      class: "grid h-11 w-11 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg sm:h-9 sm:w-9",
      title: "Close terminal",
      "aria-label": "Close terminal",
      onclick: () => state.onClose?.(),
    }, icon("x", 18)));
  }
}

function paintBody(state: TerminalState): void {
  clear(state.body);
  if (state.serversListOpen && multiComputer(state.channelId)) {
    const channelComputer = { id: 0, name: "This channel's computer", base_url: "persistent Linux /workspace", has_key: false };
    const host = S.computers.find((c) => c.name === "This Computer") || S.computers[0];
    const remotes = remoteComputers();
    const ordered = [channelComputer, host, ...remotes].filter(Boolean) as typeof S.computers;
    const list = h("div", { class: "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3" });
    for (const computer of ordered) {
      const active = computer.id === state.preferredComputerId;
      list.append(h("button", {
        type: "button",
        class: `flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${active ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-hover"}`,
        onclick: () => setTerminalPreferredComputer(state.channelId, computer.id),
      },
        h("span", { class: "grid h-9 w-9 shrink-0 place-items-center rounded-md bg-raised text-accent" }, icon("terminal", 16)),
        h("div", { class: "min-w-0 flex-1" },
          h("div", { class: "truncate text-sm font-semibold text-fg" }, computer.name),
          h("div", { class: "truncate font-mono text-[11px] text-muted" }, computer.id === 0 ? "isolated Linux /workspace" : computer.name === "This Computer" ? "Skipper's Mac" : (computer.base_url || "remote"))),
        active ? h("span", { class: "text-xs font-medium text-accent" }, "Active") : null));
    }
    state.body.append(list);
    return;
  }
  state.body.append(state.grid);
  layout(state);
}

async function restoreSessions(state: TerminalState): Promise<void> {
  try {
    const result = await api<{ sessions: ListedSession[] }>(`/api/term/list?channelId=${state.channelId}`);
    if (state.restored) return;
    state.restored = true;
    const sessions = result.sessions.filter((session) => session.channelId === state.channelId);
    if (sessions.length) {
      for (const session of sessions) state.columns.push([makePane(state, session.id, session.computerId)]);
    } else addColumn(state);
    paintBody(state);
  } catch (error) {
    state.restored = true;
    const pane = makePane(state);
    state.columns.push([pane]);
    paintBody(state);
    pane.term.writeln(`\r\n\x1b[31m${(error as Error).message}\x1b[0m`);
  }
}

const refit = (state: TerminalState): void => state.columns.flat().forEach((pane) => { try { pane.fit.fit(); sendResize(pane); } catch { /* detached */ } });
function addColumn(state: TerminalState): void { state.columns.push([makePane(state)]); paintBody(state); }
function splitDown(pane: Pane, colIdx: number): void { pane.state.columns[colIdx].push(makePane(pane.state)); paintBody(pane.state); }
function splitRight(pane: Pane, colIdx: number): void { pane.state.columns.splice(colIdx + 1, 0, [makePane(pane.state)]); paintBody(pane.state); }
function closePane(pane: Pane): void {
  const state = pane.state;
  for (const col of state.columns) { const index = col.indexOf(pane); if (index >= 0) col.splice(index, 1); }
  state.columns = state.columns.filter((column) => column.length);
  pane.disposed = true;
  pane.connectionGeneration++;
  if (pane.reconnectTimer) clearTimeout(pane.reconnectTimer);
  if (pane.heartbeatTimer) clearInterval(pane.heartbeatTimer);
  try { pane.ro.disconnect(); pane.ws?.close(); pane.term.dispose(); } catch { /* gone */ }
  if (pane.sessionId) void api(`/api/term/${pane.sessionId}`, { method: "DELETE" }).catch(() => undefined);
  if (!state.columns.length) addColumn(state); else paintBody(state);
}

function layout(state: TerminalState): void {
  clear(state.grid);
  state.columns.forEach((column, columnIndex) => {
    const columnElement = h("div", { class: "flex min-w-0 flex-1 flex-col gap-2" });
    column.forEach((pane) => columnElement.append(paneShell(pane, columnIndex)));
    state.grid.append(columnElement);
  });
  requestAnimationFrame(() => refit(state));
}

function paneShell(pane: Pane, columnIndex: number): HTMLElement {
  const computer = S.computers.find((item) => item.id === pane.computerId);
  const button = (name: string, title: string, onclick: () => void): HTMLElement =>
    h("button", { class: "grid h-6 w-6 place-items-center rounded text-muted hover:bg-hover hover:text-fg", title, onclick }, icon(name, 14));
  const shell = h("div", { class: "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line" },
    h("div", { class: "flex items-center gap-2 border-b border-line bg-surface px-2.5 py-1.5" },
      h("span", { class: "h-2.5 w-2.5 rounded-full bg-ok shadow-[0_0_0_3px_var(--c-accent-soft)]" }),
      h("span", { class: "text-xs font-medium text-fg" }, pane.computerId === 0 ? "This channel's computer" : (computer?.name || "Computer")),
      h("div", { class: "flex-1" }),
      button("splitDown", "Split down", () => splitDown(pane, columnIndex)),
      button("splitRight", "Split right", () => splitRight(pane, columnIndex)),
      button("x", "Close terminal", () => closePane(pane))));
  shell.append(pane.el);
  return shell;
}

function makePane(state: TerminalState, sessionId: string | null = null, computerId = state.preferredComputerId): Pane {
  const id = "p" + ++seq;
  const term = new Terminal({ fontFamily: '"Fragment Mono", ui-monospace, Menlo, monospace', fontSize: 13, theme: activeTheme(), cursorBlink: true, scrollback: 5000 });
  const fit = new FitAddon(); term.loadAddon(fit);
  const el = h("div", { class: "min-h-0 flex-1 bg-[#070b10]" });
  const pane: Pane = { id, sessionId, computerId, term, fit, ws: null, el, ro: null as unknown as ResizeObserver, disposed: false, reconnectTimer: null, heartbeatTimer: null, reconnectAttempt: 0, connectionGeneration: 0, state };
  requestAnimationFrame(() => { term.open(el); void connect(pane); });
  pane.ro = new ResizeObserver(() => { try { fit.fit(); sendResize(pane); } catch { /* detached */ } });
  pane.ro.observe(el);
  term.onData((data) => pane.ws?.readyState === WebSocket.OPEN && pane.ws.send(JSON.stringify({ type: "input", data })));
  return pane;
}

async function connect(pane: Pane): Promise<void> {
  if (pane.disposed || pane.ws?.readyState === WebSocket.OPEN || pane.ws?.readyState === WebSocket.CONNECTING) return;
  if (pane.reconnectTimer) { clearTimeout(pane.reconnectTimer); pane.reconnectTimer = null; }
  const generation = ++pane.connectionGeneration;
  try {
    if (!pane.sessionId) {
      const opened = await api<{ sessionId: string; computerId?: number }>("/api/term/open", {
        body: { channelId: pane.state.channelId, ...(pane.computerId ? { computerId: pane.computerId } : {}), cols: pane.term.cols, rows: pane.term.rows },
      });
      pane.sessionId = opened.sessionId;
      if (opened.computerId) pane.computerId = opened.computerId;
      pane.el.dataset.sessionId = pane.sessionId;
    }
    if (pane.disposed) { if (pane.sessionId) await api(`/api/term/${pane.sessionId}`, { method: "DELETE" }).catch(() => undefined); return; }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/term/${pane.sessionId}?token=${getToken()}`);
    pane.el.dataset.sessionId = pane.sessionId;
    ws.binaryType = "arraybuffer";
    pane.ws = ws;
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try { if (JSON.parse(event.data)?.type === "pong") return; } catch { /* terminal output */ }
        pane.term.write(event.data);
      } else pane.term.write(new Uint8Array(event.data));
    };
    ws.onopen = () => {
      if (generation !== pane.connectionGeneration || pane.disposed) { ws.close(); return; }
      pane.reconnectAttempt = 0;
      pane.el.dataset.connection = "connected";
      if (pane.heartbeatTimer) clearInterval(pane.heartbeatTimer);
      pane.heartbeatTimer = setInterval(() => {
        if (pane.ws === ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping", at: Date.now() }));
      }, 20_000);
      sendResize(pane);
    };
    ws.onclose = (event) => {
      if (generation !== pane.connectionGeneration || pane.disposed) return;
      if (pane.heartbeatTimer) { clearInterval(pane.heartbeatTimer); pane.heartbeatTimer = null; }
      pane.ws = null;
      pane.el.dataset.connection = "reconnecting";
      if (event.code === 4004) pane.sessionId = null;
      scheduleReconnect(pane);
    };
    ws.onerror = () => { /* close drives the bounded reconnect loop */ };
  } catch (error) {
    if (generation !== pane.connectionGeneration || pane.disposed) return;
    pane.ws = null;
    pane.el.dataset.connection = "reconnecting";
    scheduleReconnect(pane);
  }
}

function scheduleReconnect(pane: Pane, immediate = false): void {
  if (pane.disposed || pane.reconnectTimer || pane.ws?.readyState === WebSocket.OPEN || pane.ws?.readyState === WebSocket.CONNECTING) return;
  const delay = immediate ? 0 : Math.min(10_000, 350 * (2 ** Math.min(pane.reconnectAttempt++, 5)));
  pane.reconnectTimer = setTimeout(() => {
    pane.reconnectTimer = null;
    void connect(pane);
  }, delay);
}

function sendResize(pane: Pane): void {
  if (pane.ws?.readyState === WebSocket.OPEN) pane.ws.send(JSON.stringify({ type: "resize", cols: pane.term.cols, rows: pane.term.rows }));
}

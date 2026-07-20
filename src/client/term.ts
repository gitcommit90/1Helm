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
  state: TerminalState;
};
type TerminalState = {
  channelId: number;
  columns: Pane[][];
  workspace: HTMLElement;
  grid: HTMLElement;
  restored: boolean;
};
type ListedSession = { id: string; computerId: number; channelId: number; clients: number };

const states = new Map<number, TerminalState>();
let seq = 0;
let themeHooked = false;

/* Night-watch terminal: warm ink field, paper text, vermillion cursor. */
const themes = {
  dark: { background: "#0b0c0f", foreground: "#e0ddd3", cursor: "#fa5d3e", cursorAccent: "#0b0c0f", selectionBackground: "#fa5d3e33", black: "#14161b", brightBlack: "#4b4c49", red: "#f06a86", green: "#46c08a", yellow: "#d9b16b", blue: "#7fa3c7", magenta: "#b392f0", cyan: "#5fb8a8", white: "#e0ddd3", brightWhite: "#f4f1e8" },
  light: { background: "#15171c", foreground: "#e6e3d9", cursor: "#fa5d3e", cursorAccent: "#15171c", selectionBackground: "#fa5d3e3d", black: "#1f2229", brightBlack: "#5c5d58", red: "#f27d95", green: "#54c893", yellow: "#dfba79", blue: "#8cadcd", magenta: "#bd9ff2", cyan: "#6fc2b3", white: "#e6e3d9", brightWhite: "#ffffff" },
};
const activeTheme = (): typeof themes.dark => (document.documentElement.classList.contains("light") ? themes.light : themes.dark);
const defaultComputer = (): number => S.computers.find((computer) => computer.name === "This Computer")?.id || S.computers[0]?.id || 0;

export function openTerminals(container: HTMLElement, channelId: number): void {
  container.className = "flex min-h-0 flex-1 overflow-hidden";
  let state = states.get(channelId);
  if (!state) {
    state = buildState(channelId);
    states.set(channelId, state);
    void restoreSessions(state);
  }
  if (!themeHooked) {
    themeHooked = true;
    window.addEventListener("themechange", () => states.forEach((item) => item.columns.flat().forEach((pane) => { pane.term.options.theme = activeTheme(); })));
  }
  container.append(state.workspace);
  requestAnimationFrame(() => refit(state!));
}

function buildState(channelId: number): TerminalState {
  const channel = S.channels.find((item) => item.id === channelId);
  const grid = h("div", { class: "flex min-h-0 flex-1 gap-2 overflow-hidden p-2" });
  const state = { channelId, columns: [], workspace: null as unknown as HTMLElement, grid, restored: false };
  state.workspace = h("div", { class: "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg" },
    h("div", { class: "flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5" },
      h("div", { class: "flex items-center gap-2 font-bold text-fg" }, h("span", { class: "text-accent" }, icon("terminal")), `#${channel?.name || "channel"} terminal`),
      h("span", { class: "hidden text-xs text-muted md:inline" }, "Shell starts in this channel's /workspace (agent world root)"),
      h("div", { class: "flex-1" }),
      h("button", { class: "btn-primary text-xs", onclick: () => addColumn(state) }, icon("plus"), "New terminal")),
    grid);
  return state;
}

async function restoreSessions(state: TerminalState): Promise<void> {
  try {
    const result = await api<{ sessions: ListedSession[] }>(`/api/term/list?channelId=${state.channelId}`);
    if (state.restored) return;
    state.restored = true;
    const sessions = result.sessions.filter((session) => session.channelId === state.channelId);
    if (sessions.length) {
      for (const session of sessions) state.columns.push([makePane(state, session.id, session.computerId)]);
      layout(state);
    } else addColumn(state);
  } catch (error) {
    state.restored = true;
    const pane = makePane(state);
    state.columns.push([pane]);
    layout(state);
    pane.term.writeln(`\r\n\x1b[31m${(error as Error).message}\x1b[0m`);
  }
}

const refit = (state: TerminalState): void => state.columns.flat().forEach((pane) => { try { pane.fit.fit(); sendResize(pane); } catch { /* detached */ } });
function addColumn(state: TerminalState): void { state.columns.push([makePane(state)]); layout(state); }
function splitDown(pane: Pane, colIdx: number): void { pane.state.columns[colIdx].push(makePane(pane.state)); layout(pane.state); }
function splitRight(pane: Pane, colIdx: number): void { pane.state.columns.splice(colIdx + 1, 0, [makePane(pane.state)]); layout(pane.state); }
function closePane(pane: Pane): void {
  const state = pane.state;
  for (const col of state.columns) { const index = col.indexOf(pane); if (index >= 0) col.splice(index, 1); }
  state.columns = state.columns.filter((column) => column.length);
  pane.disposed = true;
  try { pane.ro.disconnect(); pane.ws?.close(); pane.term.dispose(); } catch { /* gone */ }
  if (pane.sessionId) void api(`/api/term/${pane.sessionId}`, { method: "DELETE" }).catch(() => undefined);
  if (!state.columns.length) addColumn(state); else layout(state);
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
      h("span", { class: "text-xs font-medium text-fg" }, computer?.name || "This Computer"),
      h("div", { class: "flex-1" }),
      button("splitDown", "Split down", () => splitDown(pane, columnIndex)),
      button("splitRight", "Split right", () => splitRight(pane, columnIndex)),
      button("x", "Close terminal", () => closePane(pane))));
  shell.append(pane.el);
  return shell;
}

function makePane(state: TerminalState, sessionId: string | null = null, computerId = defaultComputer()): Pane {
  const id = "p" + ++seq;
  const term = new Terminal({ fontFamily: '"Fragment Mono", ui-monospace, Menlo, monospace', fontSize: 13, theme: activeTheme(), cursorBlink: true, scrollback: 5000 });
  const fit = new FitAddon(); term.loadAddon(fit);
  const el = h("div", { class: "min-h-0 flex-1 bg-[#070b10]" });
  const pane: Pane = { id, sessionId, computerId, term, fit, ws: null, el, ro: null as unknown as ResizeObserver, disposed: false, state };
  requestAnimationFrame(() => { term.open(el); void connect(pane); });
  pane.ro = new ResizeObserver(() => { try { fit.fit(); sendResize(pane); } catch { /* detached */ } });
  pane.ro.observe(el);
  term.onData((data) => pane.ws?.readyState === WebSocket.OPEN && pane.ws.send(JSON.stringify({ type: "input", data })));
  return pane;
}

async function connect(pane: Pane): Promise<void> {
  try {
    if (!pane.sessionId) {
      pane.term.writeln("\x1b[90mStarting terminal…\x1b[0m");
      const opened = await api<{ sessionId: string }>("/api/term/open", { body: { channelId: pane.state.channelId, cols: pane.term.cols, rows: pane.term.rows } });
      pane.sessionId = opened.sessionId;
      pane.el.dataset.sessionId = pane.sessionId;
    }
    if (pane.disposed) { if (pane.sessionId) await api(`/api/term/${pane.sessionId}`, { method: "DELETE" }).catch(() => undefined); return; }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/term/${pane.sessionId}?token=${getToken()}`);
    pane.el.dataset.sessionId = pane.sessionId;
    ws.binaryType = "arraybuffer";
    pane.ws = ws;
    ws.onmessage = (event) => pane.term.write(typeof event.data === "string" ? event.data : new Uint8Array(event.data));
    ws.onopen = () => sendResize(pane);
    ws.onclose = (event) => { if (!pane.disposed) pane.term.writeln(`\r\n\x1b[90m[terminal disconnected${event.reason ? `: ${event.reason}` : ""}]\x1b[0m`); };
  } catch (error) {
    pane.term.writeln(`\r\n\x1b[31m${(error as Error).message}\x1b[0m`);
  }
}

function sendResize(pane: Pane): void {
  if (pane.ws?.readyState === WebSocket.OPEN) pane.ws.send(JSON.stringify({ type: "resize", cols: pane.term.cols, rows: pane.term.rows }));
}

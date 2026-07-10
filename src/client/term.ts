import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api, getToken, type Computer } from "./api.ts";
import { h, clear, icon } from "./dom.ts";
import { S } from "./app.ts";

type Pane = { id: string; computerId: number; term: Terminal; fit: FitAddon; ws: WebSocket | null; el: HTMLElement; ro: ResizeObserver };
let columns: Pane[][] = [];
let workspace: HTMLElement | null = null;
let grid: HTMLElement | null = null;
let activeComputer = 0;
let seq = 0;
let themeHooked = false;

const themes = {
  dark: { background: "#070b10", foreground: "#d8e2ef", cursor: "#1fb8a0", cursorAccent: "#070b10", selectionBackground: "#1fb8a036", black: "#0d131b", brightBlack: "#314155", red: "#f0718b", green: "#3ecf9a", yellow: "#c9a86a", blue: "#78a5c3", magenta: "#a18bbf", cyan: "#1fb8a0", white: "#d8e2ef", brightWhite: "#f4f7fb" },
  light: { background: "#111923", foreground: "#e8edf4", cursor: "#1fb8a0", cursorAccent: "#111923", selectionBackground: "#1fb8a03d", black: "#172230", brightBlack: "#526175", red: "#f07c92", green: "#47c89c", yellow: "#d1ae70", blue: "#7ba8c8", magenta: "#ad95c7", cyan: "#3cc6af", white: "#e8edf4", brightWhite: "#ffffff" },
};
const activeTheme = (): typeof themes.dark => (document.documentElement.classList.contains("light") ? themes.light : themes.dark);

export function openTerminals(container: HTMLElement): void {
  if (!activeComputer) activeComputer = S.computers[0]?.id || 0;
  if (!workspace) build();
  if (!themeHooked) { themeHooked = true; window.addEventListener("themechange", () => columns.flat().forEach((p) => { p.term.options.theme = activeTheme(); })); }
  container.append(workspace!);
  requestAnimationFrame(() => refit());
}

function build(): void {
  const compSel = h("select", { class: "field h-8 w-56 py-0 text-xs", onchange: (e: Event) => (activeComputer = Number((e.target as HTMLSelectElement).value)) }) as HTMLSelectElement;
  S.computers.forEach((c: Computer) => compSel.append(h("option", { value: c.id, selected: c.id === activeComputer }, c.name)));
  grid = h("div", { class: "flex min-h-0 flex-1 gap-2 p-2" });
  workspace = h("div", { class: "flex min-w-0 flex-1 flex-col bg-bg" },
    h("div", { class: "flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5" },
      h("div", { class: "flex items-center gap-2 font-bold text-fg" }, h("span", { class: "text-accent" }, icon("terminal")), "Terminals"),
      h("span", { class: "hidden text-xs text-muted md:inline" }, "Split-pane sessions over WebSocket · kept alive server-side"),
      h("div", { class: "flex-1" }),
      h("span", { class: "text-xs text-muted" }, "Computer"), compSel,
      h("button", { class: "btn-primary text-xs", onclick: () => addColumn() }, icon("plus"), "New terminal")),
    grid);
  if (!columns.length) addColumn();
}

const refit = (): void => columns.flat().forEach((p) => { try { p.fit.fit(); sendResize(p); } catch { /* not ready */ } });
function addColumn(): void { columns.push([makePane()]); layout(); }
function splitDown(colIdx: number): void { columns[colIdx].push(makePane()); layout(); }
function splitRight(colIdx: number): void { columns.splice(colIdx + 1, 0, [makePane()]); layout(); }
function closePane(pane: Pane): void {
  for (const col of columns) { const i = col.indexOf(pane); if (i >= 0) col.splice(i, 1); }
  columns = columns.filter((c) => c.length);
  try { pane.ro.disconnect(); pane.ws?.close(); pane.term.dispose(); } catch { /* ignore */ }
  if (!columns.length) addColumn(); else layout();
}

function layout(): void {
  if (!grid) return;
  clear(grid);
  columns.forEach((col, ci) => {
    const colEl = h("div", { class: "flex min-w-0 flex-1 flex-col gap-2" });
    col.forEach((p) => colEl.append(paneShell(p, ci)));
    grid!.append(colEl);
  });
  requestAnimationFrame(() => refit());
}

function paneShell(p: Pane, colIdx: number): HTMLElement {
  const comp = S.computers.find((c) => c.id === p.computerId);
  const btn = (name: string, title: string, onclick: () => void): HTMLElement =>
    h("button", { class: "grid h-6 w-6 place-items-center rounded text-muted hover:bg-hover hover:text-fg", title, onclick }, icon(name, 14));
  const shell = h("div", { class: "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line" },
    h("div", { class: "flex items-center gap-2 border-b border-line bg-surface px-2.5 py-1.5" },
      h("span", { class: "h-2.5 w-2.5 rounded-full bg-ok shadow-[0_0_0_3px_var(--c-accent-soft)]" }),
      h("span", { class: "text-xs font-medium text-fg" }, comp?.name || "computer"),
      h("div", { class: "flex-1" }),
      btn("splitDown", "Split down", () => splitDown(colIdx)),
      btn("splitRight", "Split right", () => splitRight(colIdx)),
      btn("x", "Close", () => closePane(p))));
  shell.append(p.el);
  return shell;
}

function makePane(): Pane {
  const id = "p" + ++seq;
  const term = new Terminal({ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, theme: activeTheme(), cursorBlink: true, scrollback: 5000 });
  const fit = new FitAddon(); term.loadAddon(fit);
  const el = h("div", { class: "min-h-0 flex-1 bg-[#070b10]" });
  const pane: Pane = { id, computerId: activeComputer, term, fit, ws: null, el, ro: null as unknown as ResizeObserver };
  requestAnimationFrame(() => { term.open(el); connect(pane); });
  pane.ro = new ResizeObserver(() => { try { fit.fit(); sendResize(pane); } catch { /* ignore */ } });
  pane.ro.observe(el);
  term.onData((d) => pane.ws?.readyState === WebSocket.OPEN && pane.ws.send(JSON.stringify({ type: "input", data: d })));
  return pane;
}

async function connect(pane: Pane): Promise<void> {
  pane.term.writeln("\x1b[90mConnecting to " + (S.computers.find((c) => c.id === pane.computerId)?.name || "computer") + "…\x1b[0m");
  try {
    const { sessionId } = await api<{ sessionId: string }>("/api/term/open", { body: { computerId: pane.computerId, cols: pane.term.cols, rows: pane.term.rows } });
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/term/${sessionId}?token=${getToken()}`);
    ws.binaryType = "arraybuffer";
    pane.ws = ws;
    ws.onmessage = (e) => pane.term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data));
    ws.onopen = () => sendResize(pane);
    ws.onclose = () => pane.term.writeln("\r\n\x1b[90m[disconnected]\x1b[0m");
  } catch (e) {
    pane.term.writeln("\r\n\x1b[31m" + (e as Error).message + "\x1b[0m");
  }
}

function sendResize(pane: Pane): void {
  if (pane.ws?.readyState === WebSocket.OPEN) pane.ws.send(JSON.stringify({ type: "resize", cols: pane.term.cols, rows: pane.term.rows }));
}

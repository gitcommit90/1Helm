import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { spawn, type IPty } from "node-pty";
import { WebSocketServer, type WebSocket } from "ws";
import { existsSync } from "node:fs";

/**
 * Embedded, open-terminal-compatible agent (https://github.com/open-webui/open-terminal).
 * Speaks the same HTTP + WebSocket protocol, so 1Helm can talk to this local
 * agent and to any external Open Terminal instance through one client (see computer.ts).
 */

type Entry = { type: string; data: string };
type Proc = { id: string; command: string; buf: Entry[]; status: string; exit_code: number | null; pty: IPty; waiters: (() => void)[] };
type Term = { id: string; pty: IPty; created_at: string; pid: number };

const requestedShell = process.env.SHELL || "/bin/bash";
const SHELL = requestedShell.startsWith("/") && existsSync(requestedShell)
  ? requestedShell
  : ["/bin/zsh", "/bin/bash", "/bin/sh"].find(existsSync) || "/bin/sh";
const nativeEnv = (extra: Record<string, unknown> = {}): Record<string, string> => {
  const preferred = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const path = [...preferred, ...String(extra.PATH || process.env.PATH || "").split(":")].filter((item, index, all) => item && all.indexOf(item) === index).join(":");
  const values = { ...process.env, ...extra, PATH: path, HELM_NATIVE_PATH: path };
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
};
const rid = (p: string): string => p + Math.random().toString(36).slice(2, 8);

export function startAgent(port: number, apiKey: string, host = "127.0.0.1"): Promise<number> {
  const procs = new Map<string, Proc>();
  const terms = new Map<string, Term>();

  const auth = (req: IncomingMessage): boolean =>
    !apiKey || req.headers["authorization"] === `Bearer ${apiKey}`;

  const send = (res: ServerResponse, code: number, body: unknown): void => {
    const s = JSON.stringify(body);
    res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
    res.end(s);
  };
  const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      let d = "";
      req.on("data", (c) => (d += c));
      req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    });

  const slice = (p: Proc, offset: number, tail?: number): { output: Entry[]; next_offset: number } => {
    let out = p.buf.slice(offset);
    if (tail && tail < out.length) out = out.slice(out.length - tail);
    return { output: out, next_offset: p.buf.length };
  };
  const waitExit = (p: Proc, sec: number): Promise<void> =>
    p.status !== "running" ? Promise.resolve() : new Promise((r) => {
      const t = setTimeout(() => { p.waiters = p.waiters.filter((w) => w !== done); r(); }, sec * 1000);
      const done = (): void => { clearTimeout(t); r(); };
      p.waiters.push(done);
    });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}`);
    const path = url.pathname;
    if (path === "/health") return send(res, 200, { status: "ok", backend: "pty" });
    if (!auth(req)) return send(res, 401, { detail: "Invalid API key" });

    if (path === "/execute" && req.method === "POST") {
      const b = await readBody(req);
      const command = String(b.command || "");
      const cwd = b.cwd ? String(b.cwd) : process.env.HOME || process.cwd();
      // Login shells can replace the inherited PATH from /etc/zprofile. Export
      // it again after shell startup so Homebrew CLIs work without profile edits.
      const pty = spawn(SHELL, ["-lc", `export PATH="$HELM_NATIVE_PATH"; unset HELM_NATIVE_PATH; ${command}`], { cols: 80, rows: 24, cwd, env: nativeEnv((b.env as Record<string, unknown>) || {}) });
      const p: Proc = { id: rid("exec-"), command, buf: [], status: "running", exit_code: null, pty, waiters: [] };
      procs.set(p.id, p);
      let responseFinished = false;
      res.once("finish", () => { responseFinished = true; });
      res.once("close", () => {
        if (!responseFinished && p.status === "running") { try { pty.kill(); } catch { /* gone */ } p.status = "killed"; }
      });
      pty.onData((d) => p.buf.push({ type: "output", data: d }));
      pty.onExit(({ exitCode }) => { p.status = "completed"; p.exit_code = exitCode; p.waiters.splice(0).forEach((w) => w()); });
      const wait = url.searchParams.get("wait");
      if (wait) await waitExit(p, Math.min(300, Number(wait)));
      const s = slice(p, 0, Number(url.searchParams.get("tail")) || undefined);
      return send(res, 200, { id: p.id, command, status: p.status, exit_code: p.exit_code, ...s });
    }

    const execMatch = path.match(/^\/execute\/([^/]+)(\/status|\/input)?$/);
    if (execMatch) {
      const p = procs.get(execMatch[1]);
      if (!p) return send(res, 404, { detail: "Process not found" });
      const sub = execMatch[2];
      if (sub === "/status" && req.method === "GET") {
        const wait = url.searchParams.get("wait");
        if (wait && p.status === "running") await waitExit(p, Math.min(300, Number(wait)));
        const s = slice(p, Number(url.searchParams.get("offset")) || 0, Number(url.searchParams.get("tail")) || undefined);
        return send(res, 200, { id: p.id, command: p.command, status: p.status, exit_code: p.exit_code, ...s });
      }
      if (sub === "/input" && req.method === "POST") {
        const b = await readBody(req);
        if (p.status !== "running") return send(res, 400, { detail: "Process has already exited" });
        p.pty.write(String(b.input || "").replace(/\\n/g, "\n").replace(/\\x03/g, "\x03").replace(/\\t/g, "\t"));
        return send(res, 200, { status: "ok" });
      }
      if (!sub && req.method === "DELETE") {
        if (p.status === "running") { try { p.pty.kill(); } catch { /* gone */ } p.status = "killed"; }
        procs.delete(p.id);
        return send(res, 200, { status: "killed" });
      }
    }

    if (path === "/api/terminals" && req.method === "POST") {
      const b = await readBody(req);
      const cwd = b.cwd ? String(b.cwd) : process.env.HOME || process.cwd();
      const pty = spawn(SHELL, [], { name: "xterm-256color", cols: Number(b.cols) || 80, rows: Number(b.rows) || 24, cwd, env: nativeEnv() });
      // Interactive startup files may also replace PATH. Apply the native path
      // inside the live shell before a browser attaches to this PTY.
      pty.write(`export PATH="$HELM_NATIVE_PATH"; unset HELM_NATIVE_PATH\r`);
      const t: Term = { id: rid("term-"), pty, created_at: new Date().toISOString(), pid: pty.pid };
      terms.set(t.id, t);
      pty.onExit(() => terms.delete(t.id));
      return send(res, 200, { id: t.id, created_at: t.created_at, pid: t.pid });
    }
    const tMatch = path.match(/^\/api\/terminals\/([^/]+)$/);
    if (tMatch) {
      const t = terms.get(tMatch[1]);
      if (req.method === "GET") return t ? send(res, 200, { id: t.id, created_at: t.created_at, pid: t.pid }) : send(res, 404, { error: "Session not found" });
      if (req.method === "DELETE") { if (t) { try { t.pty.kill(); } catch { /* gone */ } terms.delete(t.id); } return send(res, 200, { status: "deleted" }); }
    }
    if (path === "/api/terminals" && req.method === "GET")
      return send(res, 200, [...terms.values()].map((t) => ({ id: t.id, created_at: t.created_at, pid: t.pid })));

    send(res, 404, { detail: "Not found" });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket: Socket, head) => {
    const m = (req.url || "").match(/^\/api\/terminals\/([^/?]+)/);
    const t = m && terms.get(m[1]);
    if (!t) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => attachTerm(ws, t, apiKey));
  });

  return new Promise((resolve) => server.listen(port, host, () => resolve((server.address() as { port: number }).port)));
}

function attachTerm(ws: WebSocket, t: Term, apiKey: string): void {
  let authed = !apiKey;
  let onData: { dispose(): void } | null = null;
  const forward = (): void => { if (!onData) onData = t.pty.onData((d) => ws.readyState === ws.OPEN && ws.send(d)); };
  if (authed) forward();
  const timer = setTimeout(() => { if (!authed) ws.close(4001, "Auth timeout"); }, 10_000);
  ws.on("message", (raw: Buffer, isBinary: boolean) => {
    if (!authed) {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "auth" && msg.token === apiKey) { authed = true; clearTimeout(timer); forward(); return; }
      } catch { /* fallthrough */ }
      ws.close(4001, "Invalid API key");
      return;
    }
    if (isBinary) { t.pty.write(raw.toString("utf8")); return; }
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "resize") t.pty.resize(Number(msg.cols) || 80, Number(msg.rows) || 24);
      else if (msg.type === "input") t.pty.write(String(msg.data));
    } catch { t.pty.write(raw.toString("utf8")); }
  });
  ws.on("close", () => { clearTimeout(timer); onData?.dispose(); });
}

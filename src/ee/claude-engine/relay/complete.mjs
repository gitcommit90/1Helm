// One model call through the signed-in Claude Code CLI. Reads one JSON request on stdin and writes one JSON line per event on stdout:
//   {"t":"chunk","chunk":{chat.completion.chunk}}   text and reasoning deltas as they arrive, then one last chunk with tool calls, usage and finish_reason
//   {"t":"final","response":{chat.completion}}      the whole answer in one object
//   {"t":"error","error":{"message","status","code"}}
// Each call starts a fresh `claude -p` in a stable private directory with native tools, skills, slash commands, auto memory and setting sources off. The CLI
// talks to a loopback relay (Gate: the first Messages request is forwarded to api.anthropic.com, every later one is refused locally), so the CLI never gets a
// second turn, never runs a tool, and the model's answer is read from the upstream stream itself.
//
// Ported from the Nous Research Hermes plugin "claude-subscription-directsdk" (admission.py, directsdk.py), MIT License, Copyright (c) 2026 Nous Research
// and contributors (notice in THIRD-PARTY-NOTICES.md). The Claude login file is only ever touched by the CLI; the bearer the CLI sends goes only to
// api.anthropic.com (the relay refuses any other upstream) and is never logged.
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, writeFile, rm, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickLimitHeaders } from "./limits.mjs";
import { Gate, CONSUMED_BODY, Capture, transformAdmitted, toKwargs, requestBody, prepareHistory, conversationSessionId, nativeModel, deltaChunk, Progress, assemble, fastEligible, EngineError, BadRequest } from "./native.mjs";

const UPSTREAM_IDLE_MS = 180e3;
const DRAIN_MS = 3e3;
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_UPSTREAM = "https://api.anthropic.com";
// Traffic and identity flags from the plugin. The caller name is 1Helm's own (subscriptions meter by caller name; see the plugin's comments).
const ALWAYS_QUIET = { DISABLE_AUTOUPDATER: "1", DISABLE_FEEDBACK_COMMAND: "1", CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1" };
const QUIET_TRAFFIC = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1" };
const CALLER_IDENTITY = { CLAUDE_CODE_ENTRYPOINT: "1helm-cloud", CLAUDE_CODE_DISABLE_ARTIFACT: "1" };
const CONFLICTING = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_FOUNDRY_API_KEY", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_EXTRA_BODY", "CLAUDE_CODE_EFFORT_LEVEL"];

// The bearer may only go to api.anthropic.com over HTTPS. A loopback HTTP upstream exists for tests and needs allowLoopback.
export function checkUpstream(upstream, allowLoopback = false) {
  const u = new URL(upstream);
  if (u.username || u.password || u.search || u.hash) throw new BadRequest("Upstream must be a plain address");
  if (u.protocol === "https:" && u.hostname === "api.anthropic.com" && (u.port === "" || u.port === "443")) return u;
  if (allowLoopback && u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return u;
  throw new BadRequest("The Claude relay only forwards to api.anthropic.com");
}

// The loopback relay for one call.
export class Admission {
  constructor(upstream, { queried, oneShot = false, timeoutMs, allowLoopback = false } = {}) {
    this.upstream = checkUpstream(upstream, allowLoopback); this.queried = queried; this.oneShot = oneShot; this.timeout = timeoutMs;
    this.gate = new Gate(); this.capture = new Capture(); this.sockets = new Set();
    this.requestId = null; this.status = null; this.limitHeaders = null; this.failure = null; this.unrestored = null; this.errorBody = "";
    this.prefix = "/admit/" + [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => { this.failure = e?.name || "Error"; try { res.destroy(); } catch {} }));
    this.server.on("connection", (s) => { this.sockets.add(s); s.on("close", () => this.sockets.delete(s)); });
  }
  async listen() { await new Promise((ok) => this.server.listen(0, "127.0.0.1", ok)); this.url = `http://127.0.0.1:${this.server.address().port}${this.prefix}`; return this.url; }
  errorText() { try { const m = JSON.parse(this.errorBody).error.message; return typeof m === "string" ? m : this.errorBody; } catch { return this.errorBody; } }
  abort() { this.gate.cancelled = true; for (const s of this.sockets) { try { s.destroy(); } catch {} } if (this.up) try { this.up.destroy(); } catch {} }
  async close() { this.abort(); await new Promise((ok) => this.server.close(ok)); }
  async handle(req, res) {
    const u = new URL(req.url, "http://x");
    if (req.method !== "POST" || u.pathname !== this.prefix + "/v1/messages" || req.headers.origin) { res.writeHead(404).end(); return; }
    if (!this.gate.admit()) { res.writeHead(400, { "content-type": "application/json", "content-length": Buffer.byteLength(CONSUMED_BODY) }).end(CONSUMED_BODY); return; }
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 64 * 1024 * 1024) throw new Error("body too large"); chunks.push(c); }
    const t = transformAdmitted(Buffer.concat(chunks).toString("utf8"), { queried: this.queried, oneShot: this.oneShot });
    this.unrestored = t.unrestored;
    const wire = Buffer.from(t.payload, "utf8"), target = this.upstream;
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "connection", "content-length", "transfer-encoding", "proxy-authorization", "proxy-connection", "accept-encoding"].includes(k)));
    headers["accept-encoding"] = "identity"; headers["content-length"] = String(wire.length);
    const mod = target.protocol === "https:" ? https : http;
    await new Promise((done) => {
      const up = mod.request({ hostname: target.hostname, port: target.port || (target.protocol === "https:" ? 443 : 80), path: target.pathname.replace(/\/$/, "") + "/v1/messages" + u.search, method: "POST", headers }, (r) => {
        this.requestId = r.headers["request-id"] || r.headers["x-request-id"] || null; this.status = r.statusCode; this.limitHeaders = pickLimitHeaders(r.headers);
        res.writeHead(r.statusCode, Object.fromEntries(Object.entries(r.headers).filter(([k]) => !["connection", "transfer-encoding", "server", "date"].includes(k))));
        r.on("data", (c) => { try { if (r.statusCode === 200) this.capture.feed(c); else if (this.errorBody.length < 65536) this.errorBody += c.toString("utf8"); } catch (e) { this.failure = e.name; } res.write(c); });
        r.on("end", () => { res.end(); done(); });
        r.on("error", (e) => { this.failure = e.name; res.destroy(); done(); });
      });
      this.up = up;
      up.setTimeout(UPSTREAM_IDLE_MS, () => { this.failure = "UpstreamIdle"; up.destroy(); });
      up.on("error", (e) => { this.failure ||= e.name; try { res.destroy(); } catch {} done(); });
      res.on("close", () => { if (!res.writableEnded) up.destroy(); });
      up.end(wire);
    });
  }
}

// A timer that never keeps the process alive.
const delay = (ms) => new Promise((r) => setTimeout(r, ms).unref());
function killTree(child) { try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} } }

export async function* complete({ body, model, effort, timeoutMs = 180e3, claudeCommand = ["claude"], upstream = DEFAULT_UPSTREAM, allowLoopback = false, env = process.env, cwd, nodePath = process.execPath, inertPath = path.join(HERE, "inert-mcp.mjs"), signal } = {}) {
  const kwargs = toKwargs(body, { model, effort });
  if (typeof kwargs.model !== "string" || !kwargs.model) throw new BadRequest("model is required");
  const { encoded, manifest, names } = requestBody(kwargs);
  const { system, frames } = prepareHistory(kwargs.messages || [], names);
  const tmp = await mkdtemp(path.join(tmpdir(), "claude-directsdk-")); await chmod(tmp, 0o700);
  const workdir = cwd || path.join(tmpdir(), "claude-directsdk-cwd"); await mkdir(workdir, { recursive: true, mode: 0o700 });
  const queried = frames.at(-1).message.content;
  const gate = new Admission(upstream, { queried, oneShot: body.onehc_one_shot === true && !manifest.length && frames.length === 1, timeoutMs, allowLoopback });
  let child = null, cancelled = false, exited = null;
  const cancel = () => { cancelled = true; gate.abort(); if (child) killTree(child); };
  signal?.addEventListener("abort", cancel);
  try {
    await writeFile(path.join(tmp, "tools.json"), JSON.stringify(manifest));
    await writeFile(path.join(tmp, "settings.json"), JSON.stringify({ env: { CLAUDE_CODE_EXTRA_BODY: encoded } }));
    await writeFile(path.join(tmp, "system.md"), system);
    const childEnv = { ...env };
    for (const k of CONFLICTING) delete childEnv[k];
    Object.assign(childEnv, { ENABLE_TOOL_SEARCH: "false", CLAUDE_CODE_MAX_RETRIES: "0", DISABLE_AUTO_COMPACT: "1", DISABLE_COMPACT: "1", CLAUDE_CODE_TOTAL_TOKENS_REMINDER: "off",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", ...ALWAYS_QUIET, ...CALLER_IDENTITY, ...QUIET_TRAFFIC, BROWSER: "true" });
    childEnv.USER ||= "node"; childEnv.LOGNAME ||= childEnv.USER;
    childEnv.ANTHROPIC_BASE_URL = await gate.listen();
    const parsed = JSON.parse(encoded);
    if ("max_tokens" in parsed) childEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(parsed.max_tokens);
    const mcp = { mcpServers: { onehc: { command: nodePath, args: [inertPath, path.join(tmp, "tools.json")] } } };
    const args = ["-p", "--model", nativeModel(kwargs.model), "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--tools", "",
      "--system-prompt-file", path.join(tmp, "system.md"), "--settings", path.join(tmp, "settings.json"), "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands",
      "--max-turns", "1", "--permission-mode", "dontAsk", "--no-session-persistence", "--mcp-config", JSON.stringify(mcp)];
    const eff = parsed.output_config?.effort; if (eff) args.push("--effort", eff);
    args.push("--session-id", await conversationSessionId(system, frames));
    if (cancelled) throw new EngineError("Claude request cancelled");
    child = spawn(claudeCommand[0], [...claudeCommand.slice(1), ...args], { stdio: ["pipe", "pipe", "pipe"], cwd: workdir, env: childEnv, detached: true });
    const stderr = []; child.stderr.setEncoding("utf8");
    createInterface({ input: child.stderr }).on("line", (l) => { stderr.push(l); if (stderr.length > 40) stderr.shift(); });
    const tail = () => { const t = stderr.map((l) => l.trim()).filter(Boolean).join(" "); return t ? ` (native stderr: ${t.slice(0, 400)})` : ""; };
    const closed = new Promise((ok) => child.on("close", (code) => { exited = code ?? 137; ok(exited); }));
    child.on("error", (e) => { exited = 127; stderr.push(String(e.message)); });
    child.stdin.on("error", () => {});
    const q = []; let wake = null;
    createInterface({ input: child.stdout }).on("line", (l) => { try { q.push(JSON.parse(l)); } catch (e) { q.push({ bad: l.slice(0, 300), error: e }); } wake?.(); }).on("close", () => { q.push(null); wake?.(); });
    let deadline = Date.now() + timeoutMs;
    const receive = async () => {
      for (;;) {
        if (cancelled) throw new EngineError("Claude request cancelled");
        if (q.length) { const e = q.shift(); if (e && e.bad !== undefined) throw new EngineError("Invalid native stream-json output: " + JSON.stringify(e.bad) + tail()); deadline = Date.now() + timeoutMs; return e; }
        const left = deadline - Date.now(); if (left <= 0) throw new EngineError("Claude request timed out", 504);
        await new Promise((r) => { wake = r; setTimeout(r, Math.min(left, 200)); });
      }
    };
    const send = (s) => new Promise((ok) => child.stdin.write(s, () => ok()));
    for (let i = 0; i < frames.length; i++) {
      const frame = structuredClone(frames[i]);
      if (frame.type === "user" && i < frames.length - 1) frame.shouldQuery = false;
      await send(JSON.stringify(frame) + "\n");
      if (frame.shouldQuery === false) {
        for (;;) {
          const ack = await receive();
          if (ack === null) { if (cancelled) throw new EngineError("Claude request cancelled"); await closed; throw new EngineError(`Native exited before replay acknowledgment (exit=${exited})${tail()}`); }
          if (ack.type === "result") { if (ack.num_turns !== 0 || ack.is_error) throw new EngineError("Native history replay not supported: expected zero-turn acknowledgment" + tail()); break; }
        }
      }
    }
    child.stdin.end();
    const progress = new Progress(), assistants = [], results = []; let stopped = false, emitted = "", nativeError = null, nativeErrorCode = null, fast = false;
    for (;;) {
      const ev = await receive(); if (ev === null) break;
      if (ev.type === "assistant") {
        if (ev.error || ev.message?.error) { nativeError = (ev.message?.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("\n"); nativeErrorCode = ev.error; }
        else assistants.push(ev.message);
      } else if (ev.type === "result") {
        results.push(ev);
        if (fastEligible(ev, gate.gate, gate.status, gate.capture, stopped, nativeError)) { fast = true; break; }
      } else if (ev.type === "stream_event") {
        if (ev.event.type === "message_stop") stopped = true;
        const c = deltaChunk(kwargs.model, ev.event);
        if (c) { emitted += c.choices[0].delta.content ?? ""; yield { t: "chunk", chunk: c }; }
        else { const p = progress.chunk(kwargs.model, ev.event); if (p) yield { t: "chunk", chunk: p }; }
      }
    }
    if (!fast) { await Promise.race([closed, delay(Math.max(100, deadline - Date.now()))]); }
    if (cancelled) throw new EngineError("Claude request cancelled");
    if (gate.limitHeaders) yield { t: "limits", headers: gate.limitHeaders, status: gate.status };   // Anthropic's rate limit headers (plan usage in Settings); no token is in them
    const out = assemble({ model: kwargs.model, names, gate: gate.gate, capture: gate.capture, requestId: gate.requestId, status: gate.status, failure: gate.failure, error: gate.errorText(), unrestored: gate.unrestored,
      assistants, results, stopped, emitted, nativeError, nativeErrorCode, fast, exitCode: exited, stderrTail: tail() });
    for (const c of out.chunks) yield { t: "chunk", chunk: c };
    yield { t: "final", response: out.response };
    // The answer is complete; let the CLI exit by itself for a moment (it may be writing a refreshed login), then end it.
    if (exited === null) await Promise.race([closed, delay(DRAIN_MS)]);
  } finally {
    signal?.removeEventListener("abort", cancel);
    cancelled = true; gate.gate.cancelled = true;
    if (child && exited === null) killTree(child);
    await gate.close().catch(() => {});
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export const errorLine = (e) => ({ t: "error", error: { message: String(e?.message || e).slice(0, 2000), status: e?.status ?? null, code: e?.code ?? null } });

async function main() {
  const chunks = []; for await (const c of process.stdin) chunks.push(c);
  const ac = new AbortController(); process.on("SIGTERM", () => ac.abort()); process.on("SIGINT", () => ac.abort());
  process.stdout.on("error", () => ac.abort());
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  try {
    const req = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    // Only these fields come from the caller: the CLI command, upstream and relay settings are fixed here.
    for await (const item of complete({ body: req.body, model: req.model, effort: req.effort, ...(req.timeoutMs ? { timeoutMs: Number(req.timeoutMs) } : {}), signal: ac.signal })) out(item);
  } catch (e) { out(errorLine(e)); }
  process.exit(0);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();

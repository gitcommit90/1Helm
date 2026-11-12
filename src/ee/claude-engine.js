// The Claude engine: the person's own Claude subscription, used through the unmodified Claude Code CLI run headless.
// One Durable Object and one container per account (idFromName(tenantId)), never per channel, so the person signs in once and every channel uses it.
// The container is slim (src/ee/claude-engine/Dockerfile: Debian, ca-certificates and the pinned claude binary). It has no files of the person's, no
// browser and no shell tool for the model: 1Helm's tools reach the CLI over MCP (the `mcp` argument of run), and the CLI's own built-in tools are off.
//
// Terms: Anthropic allows "an end user ... signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform
// hosts Claude Code" (code.claude.com/docs/en/legal-and-compliance). So this file never changes the binary, never removes a login method and never
// uses the Claude Agent SDK or an API key. The CLI runs its own login (`claude auth login --claudeai`) and the person signs in on Anthropic's page.
//
// Saved login: the CLI keeps its login in ~/.claude/.credentials.json (the refresh token rotates) and the account in ~/.claude.json. Both are saved
// sealed with VAULT_KEY in D1 (claude_engine_logins) after login, after every run, and before the container sleeps, and written back at every start.
// Nothing of it is logged or returned.
//
// Survives a Worker deploy: a login and a run each run as a detached process in the container with their input and output in files, so a reset of this
// object does not stop them. attach(session, fromByte) streams a run's output again from a byte offset.
import { pickSignInUrl } from "./claude-signin-url.js";
import { DurableObject } from "cloudflare:workers";
import { tolerantEnv } from "../do-stub.js";
import { sealSecret, openSecret } from "../sentinel.js";
import { parseClaudeHeaders, parseClaudeUsage } from "./byok-usage.js";
import { isCapacityError, computerBusyError, CAPACITY_RETRY_MS } from "../computer-capacity.js";

// Keep in step with ARG CLAUDE_CODE_VERSION in src/ee/claude-engine/Dockerfile.
export const CLAUDE_CODE_VERSION = "2.1.316";
export const IDLE_MS = 5 * 60e3;             // the container sleeps this long after the last run or login step
export const MIN_AWAKE_AFTER_OP_MS = 10e3;
export const RUN_MAX_MS = 30 * 60e3;         // one run may take this long; the CLI is stopped after it
export const MAX_RUNS = 3;                   // runs at once in one container (1 GiB)
const START_ATTEMPT_MS = 15e3;
const START_TOTAL_MS = 60e3;
const LOGIN_MAX_MS = 10 * 60e3;
const SAVE_EVERY_MS = 5 * 60e3;             // while awake, the login is re-saved this often if the CLI changed it
const MAX_SYSTEM_BYTES = 400 * 1024;
const MAX_PROMPT_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = 24 * 1024 * 1024;   // a chat.completions request with images
const MAX_CALLS = 4;                       // model calls at once in one container
const COMPLETE_JS = "/opt/1hc/relay/complete.mjs";
const USAGE_JS = "/opt/1hc/relay/usage.mjs";
const USAGE_TRY_MS = 5 * 60e3;            // the account usage call inside the container is made at most this often
// basic instance: 1 GiB memory, 0.25 vCPU, 4 GB disk. CPU is billed as if fully busy (prepay is conservative), cost + 15%, the same model as the channel computer.
export const RATE_NANO_PER_SEC = Math.ceil((1 * 0.0000025 + 0.25 * 0.000020 + 4 * 0.00000007) * 1e9 * 1.15);
const HOME = "/home/node", CRED = `${HOME}/.claude/.credentials.json`, CJSON = `${HOME}/.claude.json`, WORK = "/work";
const LOGIN_DIR = "/tmp/1hc-login", RUN_DIR = "/tmp/1hc-run";
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const MODEL_RE = /^[A-Za-z0-9._\-\[\]]{1,80}$/;
const CODE_RE = /^[A-Za-z0-9._~#:\/+=\-]{4,2048}$/;
const SESSION_RE = /^[A-Za-z0-9_:.\-]{1,160}$/;
// The CLI's built-in tools are all off (--tools ""): the container holds the account's login, and no built-in tool is needed because 1Helm's tools come over MCP.
// dontAsk answers every permission prompt with "no" except for the tools named in --allowedTools, so only the 1Helm MCP server's tools can run.
export const MCP_SERVER_NAME = "onehc";
export const BUILTIN_TOOLS = "";
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
const enc = new TextEncoder(), dec = new TextDecoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
// Shell kill of a process and all its descendants (the image has no procps, so this reads /proc).
const KILL_TREE = 'kids(){ for s in /proc/[0-9]*/stat; do read -r cp _ _ pp _ < "$s" 2>/dev/null && [ "$pp" = "$1" ] && echo "$cp"; done; }; k(){ for c in $(kids "$1"); do k "$c"; done; kill -9 "$1" 2>/dev/null; }';

// A session id becomes the CLI's session uuid (the CLI wants a uuid), the same for the same session.
export async function sessionUuid(session) {
  const h = await sha256("1hc-claude-engine:" + session);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const runId = async (session) => (await sha256("run:" + session)).slice(0, 24);

// The CLI's command line for a run, and the files it reads. Pure, so a test can check every flag.
export function runArgs({ model, effort, dir }) {
  const a = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--tools", BUILTIN_TOOLS, "--permission-mode", "dontAsk", "--allowedTools", `mcp__${MCP_SERVER_NAME}`,
    "--strict-mcp-config", "--mcp-config", `${dir}/mcp.json`, "--setting-sources", "user",
    "--append-system-prompt-file", `${dir}/system.txt`];
  if (model) a.push("--model", model);
  if (effort) a.push("--effort", effort);
  return a;
}
export function mcpConfig(mcp) {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { type: "http", url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } } });
}
// The runner: a detached bash that starts the CLI with its input from a file and its output to files, so a deploy that resets the Durable Object does not stop it.
export function runnerScript() {
  return `set -u; D="$1"; CWD="$2"; SID="$3"; MS="$4"; shift 4
cd "$CWD" 2>/dev/null || cd ${WORK}
echo $$ > "$D/pid"
if ls ${HOME}/.claude/projects/*/"$SID".jsonl >/dev/null 2>&1; then S="--resume $SID"; else S="--session-id $SID"; fi
timeout -k 5 "$MS" claude "$@" $S < "$D/prompt.txt" > "$D/out" 2> "$D/err"
echo $? > "$D/code"`;
}
// Stream a run's output from a byte offset until it ends, then exit with the CLI's own exit code. It polls the output file every 50 ms (a follow
// process raced with a run that had already ended). The exit code file is read before the size, and the CLI closes its output before that file
// is written, so once it exists the size is final and the last bytes are always sent.
export function tailScript() {
  return `D="$1"; P="$2"; touch "$D/out"
while :; do
  E=0; [ -f "$D/code" ] && E=1
  if [ "$E" = 0 ] && [ -f "$D/pid" ] && ! kill -0 "$(cat "$D/pid")" 2>/dev/null; then sleep 0.5; [ -f "$D/code" ] || echo 137 > "$D/code"; continue; fi
  SZ=$(stat -c %s "$D/out")
  if [ "$SZ" -ge "$P" ]; then dd if="$D/out" iflag=skip_bytes,count_bytes skip=$((P-1)) count=$((SZ-P+1)) status=none; P=$((SZ+1)); fi
  [ "$E" = 1 ] && exit "$(cat "$D/code")"
  sleep 0.05
done`;
}
// Whole lines only, so a consumer never sees half of a JSON line. The last line gets its newline if the CLI ended without one.
function lineStream(onBytes) {
  let buf = "";
  return new TransformStream({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i + 1); buf = buf.slice(i + 1); const b = enc.encode(line); onBytes?.(b.byteLength); ctl.enqueue(b); }
    },
    flush(ctl) { buf += dec.decode(); if (buf) { const b = enc.encode(buf + "\n"); ctl.enqueue(b); } },
  });
}
// The reason a login failed, in plain words, from the CLI's own error line.
export function loginReason(err) {
  const line = String(err || "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  return line.replace(/^Login failed:\s*/i, "").slice(0, 300) || "The code wasn't accepted. Sign in again to get a new code.";
}

export function claudeEngine(env, tenantId) {
  const e = tolerantEnv(env);
  return e.CLAUDE_ENGINE.get(env.CLAUDE_ENGINE.idFromName(String(tenantId)));
}

export class ClaudeEngine extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = tolerantEnv(env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, what TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, session TEXT NOT NULL, started INTEGER NOT NULL, ended INTEGER);`);
    this.inflight = 0; this.calls = new Map();
    this.reattachContainer();
  }
  get(k) { return this.sql.exec("SELECT v FROM kv WHERE k=?", k).toArray()[0]?.v; }
  put(k, v) { this.sql.exec("INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v)); }
  del(k) { this.sql.exec("DELETE FROM kv WHERE k=?", k); }
  log(what) { this.sql.exec("INSERT INTO events (at,what) VALUES (?,?)", Date.now(), what); this.sql.exec("DELETE FROM events WHERE seq < (SELECT MAX(seq) FROM events) - 200"); }
  tenant() { return this.ctx.id?.name || this.get("tenant") || ""; }
  async init(tenant) { if (tenant) this.put("tenant", tenant); return { ok: true }; }
  // A Worker-only deploy resets this object but not the container: notice an exit later, and keep the idle alarm.
  reattachContainer() {
    try {
      const c = this.ctx.container; if (!c) return;
      if (!c.running) { if (this.get("ready") === "1") { this.put("ready", "0"); this.log("container gone after a restart of this object"); } return; }
      c.monitor?.()?.then(() => this.put("ready", "0"), () => this.put("ready", "0"));
      this.ctx.waitUntil?.(this.ctx.storage.getAlarm().then((a) => (a == null ? this.ctx.storage.setAlarm(Date.now() + 30e3) : null)).catch(() => {}));
    } catch (e) { console.log("claude engine reattach", e?.message); }
  }
  touch() { this.put("last_activity", Date.now()); }

  // ---- running a command in the container ----
  // stdin: a string. Output (stdout and stderr together) comes back as text, capped.
  async sh(argv, { stdin = null, timeoutMs = 20e3, env = {} } = {}) {
    let to; const launch = this.ctx.container.exec(argv, { stderr: "combined", env: { HOME, ...env }, ...(stdin != null ? { stdin: new Response(stdin).body } : {}) });
    const p = await Promise.race([launch, new Promise((_, rej) => { to = setTimeout(() => rej(new Error(`exec launch timed out after ${timeoutMs}ms`)), timeoutMs); })]);
    clearTimeout(to);
    let t; const killer = new Promise((_, rej) => { t = setTimeout(() => { try { p.kill(9); } catch {} rej(new Error(`command timed out after ${timeoutMs}ms`)); }, timeoutMs); });
    try {
      const read = (async () => { const r = p.stdout.getReader(); let out = ""; for (;;) { const { value, done } = await r.read(); if (done) break; if (out.length < 200000) out += dec.decode(value, { stream: true }); } return { code: await p.exitCode, out }; })();
      return await Promise.race([read, killer]);
    } finally { clearTimeout(t); }
  }
  bash(script, args = [], opts = {}) { return this.sh(["bash", "-c", script, "_", ...args], opts); }
  writeFile(path, text, opts = {}) { return this.bash('umask 077; mkdir -p "$(dirname "$1")" && cat > "$1"', [path], { stdin: text, ...opts }); }

  // ---- saved login ----
  async readLogin() {
    const a = await this.bash('cat "$1" 2>/dev/null', [CRED]), b = await this.bash('cat "$1" 2>/dev/null', [CJSON]);
    if (a.code !== 0 || !a.out.trim().startsWith("{")) return null;
    return { credentials: a.out, claudeJson: b.code === 0 && b.out.trim().startsWith("{") ? b.out : "" };
  }
  // Save the CLI's login sealed in D1 when it changed since the last save. Returns true when a row was written.
  async saveLogin(account) {
    const tenant = this.tenant(); if (!tenant || !this.ctx.container.running) return false;
    const l = await this.readLogin(); if (!l) return false;
    const plain = JSON.stringify({ v: 1, ...l }), h = await sha256(plain);
    if (!account && this.get("login_sha") === h) { this.put("saved_at", Date.now()); return false; }
    const sealed = await sealSecret(this.env, plain), now = Date.now();
    // A sign-in creates the row. A refresh after a run only updates a row that exists, so a run that ends after Sign out can't bring the login back.
    if (account) await this.env.DB.prepare("INSERT INTO claude_engine_logins (tenant_id, sealed, account_json, saved_at) VALUES (?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET sealed=excluded.sealed, account_json=excluded.account_json, saved_at=excluded.saved_at").bind(tenant, sealed, JSON.stringify(account), now).run();
    else await this.env.DB.prepare("UPDATE claude_engine_logins SET sealed=?, saved_at=? WHERE tenant_id=?").bind(sealed, now, tenant).run();
    this.put("login_sha", h); this.put("saved_at", now);
    return true;
  }
  async savedRow() {
    const tenant = this.tenant(); if (!tenant) return null;
    return (await this.env.DB.prepare("SELECT sealed, account_json FROM claude_engine_logins WHERE tenant_id=?").bind(tenant).first()) || null;
  }
  async restoreLogin() {
    const row = await this.savedRow(); if (!row) { this.put("signed_in", "0"); return false; }
    let l; try { l = JSON.parse(await openSecret(this.env, row.sealed)); } catch { this.log("saved login could not be opened"); this.put("signed_in", "0"); return false; }
    await this.writeFile(CRED, l.credentials);
    if (l.claudeJson) await this.writeFile(CJSON, l.claudeJson);
    this.put("login_sha", await sha256(JSON.stringify({ v: 1, credentials: l.credentials, claudeJson: l.claudeJson || "" })));
    this.put("signed_in", "1");
    this.put("account", row.account_json || "{}");
    return true;
  }
  account() { try { return JSON.parse(this.get("account") || "{}"); } catch { return {}; } }
  async accountInfo() {
    const r = await this.bash("claude auth status --json", [], { timeoutMs: 20e3 }).catch(() => null);
    let j = {}; try { j = JSON.parse(r?.out || "{}"); } catch {}
    return { ...(j.email ? { email: String(j.email) } : {}), ...(j.subscriptionType ? { plan: String(j.subscriptionType) } : {}), ...(j.orgName ? { org: String(j.orgName) } : {}), loggedIn: !!j.loggedIn };
  }

  // ---- metering (the channel computer's model: prepay a minute, refund the unused part on stop) ----
  ledger() { return this.env.LEDGER.get(this.env.LEDGER.idFromName(`tenant:${this.tenant()}`)); }
  async prepayMinute() {
    const L = this.ledger(), id = `claude-engine:${crypto.randomUUID()}`, nano = RATE_NANO_PER_SEC * 60;
    const r = await L.reserve(id, nano);
    if (!r.ok) { this._payFail = r.reason; return false; }
    await L.settle(id, nano);
    this.put("paid_until", Math.max(Number(this.get("paid_until") || 0), Date.now()) + 60e3);
    return true;
  }
  async refundUnused() {
    const left = Number(this.get("paid_until") || 0) - Date.now(); this.put("paid_until", Date.now());
    if (left <= 1000) return 0;
    const nano = Math.floor(RATE_NANO_PER_SEC * left / 1000);
    try { await this.ledger().grant(`claude-engine-refund:${crypto.randomUUID()}`, nano, "computer_refund"); return nano; } catch { return 0; }
  }
  payError() { return this._payFail === "day_limit" ? Object.assign(new Error("skipped: daily safety limit reached"), { status: 429 }) : Object.assign(new Error("out_of_credits"), { status: 402 }); }

  // ---- lifecycle ----
  async ensureRunning() {
    if (this.ctx.container.running && this.get("ready") === "1") return { cold: false };
    if (!this._starting) this._starting = this._ensureRunning().finally(() => { this._starting = null; });
    return await this._starting;
  }
  async _ensureRunning() {
    for (let i = 0; i < 240 && this.get("stopping") === "1"; i++) await sleep(250);
    if (this.ctx.container.running && this.get("ready") === "1") return { cold: false };
    const t0 = Date.now();
    if (!(await this.prepayMinute())) throw this.payError();
    this.put("ready", "0");
    let up = false, attempts = 0, lastErr = "", busySince = 0;
    while (!up && Date.now() - t0 < START_TOTAL_MS) {
      attempts++; lastErr = ""; let exited = null;
      if (!this.ctx.container.running) {
        try { this.ctx.container.start({ enableInternet: true }); } catch (e) { lastErr = String(e?.message || e); if (isCapacityError(lastErr)) exited = lastErr; }
      }
      this.ctx.container.monitor().then(() => { exited = "exit"; this.put("ready", "0"); }, (e) => { exited = String(e?.message || e); lastErr = exited; this.put("ready", "0"); });
      const deadline = Date.now() + START_ATTEMPT_MS;
      while (!up && !exited && Date.now() < deadline) {
        try { up = (await this.sh(["true"], { timeoutMs: 3e3 })).code === 0; } catch { await sleep(200); }
      }
      if (up) break;
      this.log(`start attempt ${attempts} failed after ${Date.now() - t0}ms: ${exited || "no answer in " + START_ATTEMPT_MS + "ms"}`);
      if (this.ctx.container.running) { try { await Promise.race([this.ctx.container.destroy("stuck start"), sleep(5e3)]); } catch {} }
      if (isCapacityError(lastErr)) { busySince ||= Date.now(); if (Date.now() - busySince >= CAPACITY_RETRY_MS) { this.log(`no capacity after ${attempts} attempts`); await this.refundUnused(); throw computerBusyError(); } } else busySince = 0;
      await sleep(500);
    }
    if (!up) { await this.refundUnused(); if (isCapacityError(lastErr)) throw computerBusyError(); throw new Error(`claude engine did not start (${attempts} attempts in ${Date.now() - t0}ms: ${lastErr})`); }
    await this.restoreLogin().catch((e) => { this.log("restore failed: " + String(e?.message || e).slice(0, 120)); });
    this.put("ready", "1"); this.touch(); this.put("started_at", Date.now());
    await this.ctx.storage.setAlarm(Date.now() + 30e3);
    this.log(`started in ${Date.now() - t0}ms (${attempts} attempt${attempts > 1 ? "s" : ""}), login ${this.get("signed_in") === "1" ? "restored" : "none"}`);
    return { cold: true, ms: Date.now() - t0, attempts };
  }
  // The container is asleep: start it, restore the saved login, return how long it took.
  async warm() {
    const t0 = Date.now(); this.touch();
    try {
      const r = await this.ensureRunning();
      if (!this.get("version") || r.cold) { const v = await this.sh(["claude", "--version"], { timeoutMs: 10e3 }).catch(() => null); const m = String(v?.out || "").match(/\d+\.\d+\.\d+/); if (m) this.put("version", m[0]); }
      return { ok: true, ms: Date.now() - t0, cold: !!r.cold };
    } catch (e) { return { ok: false, ms: Date.now() - t0, error: e.message, ...(e.status ? { status: e.status } : {}) }; }
  }
  activeRuns() { return this.sql.exec("SELECT id, session, started FROM runs WHERE ended IS NULL").toArray(); }
  // Sleep: save the login (the CLI may have refreshed it), stop the container, refund unused prepaid time.
  async stop(reason, { cancellable = true } = {}) {
    if (cancellable && (this.inflight || this.activeRuns().length || Date.now() - Number(this.get("last_activity") || 0) < MIN_AWAKE_AFTER_OP_MS)) {
      await this.armAlarm(Date.now() + MIN_AWAKE_AFTER_OP_MS); return { stopped: false, deferred: true, reason };
    }
    const startedStop = Date.now(); this.put("stopping", "1");
    try { await this.saveLogin(); } catch (e) { this.log("save before stop failed: " + String(e?.message || e).slice(0, 120)); }
    if (cancellable && (Number(this.get("last_activity") || 0) > startedStop || this.inflight)) {
      this.put("stopping", "0"); this.log(`stop (${reason}) cancelled: work arrived`); await this.armAlarm(Date.now() + 30e3);
      return { stopped: false, cancelled: true, reason };
    }
    this.put("ready", "0");
    if (this.ctx.container.running) await this.ctx.container.destroy(reason);
    this.sql.exec("UPDATE runs SET ended=? WHERE ended IS NULL", Date.now());
    this.put("stopping", "0"); this.put("stopped_at", Date.now()); this.put("last_stop", reason);
    const refund = await this.refundUnused();
    this.log(`stopped: ${reason}${refund ? `, refunded ${refund} nano unused prepaid time` : ""}`);
    return { stopped: true, reason, refund_nano: refund };
  }
  async armAlarm(at) { const cur = await this.ctx.storage.getAlarm(); if (!cur || at < cur) await this.ctx.storage.setAlarm(at); }
  async alarm() {
    if (!this.ctx.container.running || this.get("ready") !== "1") return;
    await this.reapRuns().catch(() => {});
    const busy = this.inflight || this.activeRuns().length || this.get("login_active") === "1";
    if (!busy && Date.now() - Number(this.get("last_activity") || 0) > Number(this.get("idle_ms") || IDLE_MS)) { await this.stop("idle"); return; }
    if (Number(this.get("paid_until") || 0) - Date.now() < 30e3 && !(await this.prepayMinute())) { await this.stop(this._payFail === "day_limit" ? "daily safety limit" : "out of credits", { cancellable: false }); return; }
    if (Date.now() - Number(this.get("saved_at") || 0) > SAVE_EVERY_MS) await this.saveLogin().catch(() => {});
    await this.ctx.storage.setAlarm(Date.now() + 30e3);
  }
  // A run whose exit code file exists, or that has outlived RUN_MAX_MS, is over (a deploy may have ended the stream that would have marked it).
  async reapRuns() {
    for (const r of this.activeRuns()) {
      const d = `${RUN_DIR}/${r.id}`;
      const x = await this.bash('[ -f "$1/code" ] && echo done || echo running', [d], { timeoutMs: 8e3 }).catch(() => null);
      if (x?.out.includes("done") || Date.now() - r.started > RUN_MAX_MS + 30e3) this.sql.exec("UPDATE runs SET ended=? WHERE id=?", Date.now(), r.id);
    }
  }

  // ---- sign in ----
  // Claude Code's own login for a Claude account. The CLI prints a URL and waits for the code Anthropic shows after sign-in. It runs detached with
  // its input from a named pipe, so loginFinish still works after a deploy reset this object.
  async loginStart() {
    this.touch();
    try { await this.ensureRunning(); } catch (e) { return { error: e.message, ...(e.status ? { status: e.status } : {}) }; }
    const script = `rm -rf "$1"; mkdir -p "$1"; chmod 700 "$1"; mkfifo "$1/in"
setsid bash -c 'D="$1"; ( sleep ${LOGIN_MAX_MS / 1000 + 30} > "$D/in" ) & W=$!; timeout -k 5 ${LOGIN_MAX_MS / 1000} claude auth login --claudeai < "$D/in" > "$D/out" 2> "$D/err"; echo $? > "$D/code"; kill $W 2>/dev/null' _ "$1" > /dev/null 2>&1 &
echo started`;
    const s = await this.bash(script, [LOGIN_DIR], { timeoutMs: 15e3, env: { BROWSER: "true" } }).catch((e) => ({ code: 1, out: String(e?.message || e) }));
    if (s.code !== 0) return { error: "Couldn't start Claude's sign-in." };
    this.put("login_active", "1"); this.put("login_started", Date.now());
    for (let i = 0; i < 100; i++) {
      const r = await this.bash('cat "$1/out" 2>/dev/null; [ -f "$1/code" ] && echo "[[EXIT $(cat "$1/code")]]"', [LOGIN_DIR], { timeoutMs: 8e3 }).catch(() => null);
      const url = pickSignInUrl(r?.out);
      if (url) { this.touch(); return { url }; }
      if (r?.out.includes("[[EXIT")) break;
      await sleep(200);
    }
    this.del("login_active");
    return { error: "Claude's sign-in didn't give an address to open. Try again." };
  }
  async loginFinish(code) {
    this.touch();
    const c = String(code ?? "").trim();
    if (!CODE_RE.test(c)) return { error: "That doesn't look like the code Anthropic showed. Copy all of it and paste it again." };
    if (!this.ctx.container.running) { this.del("login_active"); return { error: "The sign-in expired. Start again." }; }
    const waiting = await this.bash('[ -p "$1/in" ] && [ ! -f "$1/code" ] && echo yes || echo no', [LOGIN_DIR], { timeoutMs: 8e3 }).catch(() => ({ out: "no" }));
    if (!waiting.out.includes("yes")) { this.del("login_active"); return { error: "The sign-in expired. Start again." }; }
    const w = await this.bash('printf "%s\\n" "$2" > "$1/in"', [LOGIN_DIR, c], { timeoutMs: 8e3 }).catch(() => ({ code: 1 }));
    if (w.code !== 0) return { error: "Couldn't send the code to Claude's sign-in. Start again." };
    let exit = null;
    for (let i = 0; i < 150 && exit == null; i++) {
      const r = await this.bash('[ -f "$1/code" ] && cat "$1/code"', [LOGIN_DIR], { timeoutMs: 8e3 }).catch(() => null);
      if (r && /^\d+$/.test(r.out.trim())) exit = Number(r.out.trim()); else await sleep(200);
    }
    this.del("login_active"); this.touch();
    if (exit !== 0) {
      const e = await this.bash('cat "$1/err" 2>/dev/null; rm -rf "$1"', [LOGIN_DIR], { timeoutMs: 8e3 }).catch(() => ({ out: "" }));
      return { error: exit == null ? "Claude's sign-in didn't answer. Start again." : loginReason(e.out) };
    }
    await this.bash('rm -rf "$1"', [LOGIN_DIR], { timeoutMs: 8e3 }).catch(() => {});
    const account = await this.accountInfo();
    if (!account.loggedIn) return { error: "Claude's sign-in finished but isn't signed in. Start again." };
    delete account.loggedIn;
    await this.saveLogin(account);
    this.put("signed_in", "1"); this.put("account", JSON.stringify(account));
    this.log("signed in");
    return { ok: true, account: { ...(account.email ? { email: account.email } : {}), ...(account.plan ? { plan: account.plan } : {}) } };
  }
  // Does not start the container or a model: the saved login row says whether the person signed in.
  async status() {
    const row = await this.savedRow().catch(() => null);
    const signedIn = !!row; const acct = (() => { try { return JSON.parse(row?.account_json || "{}"); } catch { return {}; } })();
    return { signedIn, account: signedIn ? { ...(acct.email ? { email: acct.email } : {}), ...(acct.plan ? { plan: acct.plan } : {}) } : null, version: this.get("version") || CLAUDE_CODE_VERSION, running: !!this.ctx.container.running };
  }
  async signOut() {
    this.touch();
    for (const r of this.activeRuns()) await this.cancel(r.session).catch(() => {});
    if (this.ctx.container.running && this.get("ready") === "1") {
      await this.bash(`claude auth logout >/dev/null 2>&1; rm -f "$1" "$2"; rm -rf ${LOGIN_DIR}`, [CRED, CJSON], { timeoutMs: 20e3 }).catch(() => {});
    }
    const tenant = this.tenant();
    if (tenant) await this.env.DB.prepare("DELETE FROM claude_engine_logins WHERE tenant_id=?").bind(tenant).run();
    for (const k of ["signed_in", "account", "login_sha", "saved_at", "login_active", "limits", "limits_names", "usage_cache", "usage_try", "usage_why"]) this.del(k);
    this.log("signed out");
    return { ok: true };
  }

  // ---- run ----
  // Starts the CLI detached and returns a stream of its stream-json lines as they arrive. Stream chunks are whole lines, byte for byte what the CLI wrote, so a
  // consumer can count bytes and call attach(session, bytes + 1) to carry on after a deploy.
  async run({ prompt, systemAppend = "", model, effort, mcp, session, cwd } = {}) {
    this.touch();
    if (!session || !SESSION_RE.test(String(session))) throw Object.assign(new Error("bad session"), { status: 400 });
    if (typeof prompt !== "string" || !prompt) throw Object.assign(new Error("empty prompt"), { status: 400 });
    if (enc.encode(prompt).byteLength > MAX_PROMPT_BYTES) throw Object.assign(new Error("prompt too large"), { status: 413 });
    if (enc.encode(String(systemAppend || "")).byteLength > MAX_SYSTEM_BYTES) throw Object.assign(new Error("system prompt too large"), { status: 413 });
    if (model && !MODEL_RE.test(String(model))) throw Object.assign(new Error("bad model"), { status: 400 });
    if (effort && !EFFORTS.has(String(effort))) throw Object.assign(new Error("bad effort"), { status: 400 });
    if (!mcp || !/^https:\/\//.test(String(mcp.url || "")) || !mcp.token) throw Object.assign(new Error("mcp url and token are required"), { status: 400 });
    const dir0 = cwd ? String(cwd) : WORK;
    const workdir = /^\/work(\/[A-Za-z0-9_.\-]+)*$/.test(dir0) && !dir0.includes("..") ? dir0 : WORK;
    if (!(await this.savedRow())) throw Object.assign(new Error("Not signed in to Claude. Sign in under Settings, AI services."), { status: 401, code: "not_signed_in" });
    const r = await this.ensureRunning();
    if (this.get("signed_in") !== "1") throw Object.assign(new Error("Not signed in to Claude. Sign in under Settings, AI services."), { status: 401, code: "not_signed_in" });
    const id = await runId(session), dir = `${RUN_DIR}/${id}`;
    // One run per session at a time; a run for the session that is still going is stopped first (the person sent a newer message).
    if (this.activeRuns().some((x) => x.id === id)) await this.cancel(session);
    if (this.activeRuns().length >= MAX_RUNS) throw Object.assign(new Error("Claude is busy with other work for this account. Try again in a moment."), { status: 429, code: "engine_busy" });
    this.inflight++;
    try {
      await this.bash('find "$2" -mindepth 1 -maxdepth 1 -mmin +180 -exec rm -rf {} + 2>/dev/null; rm -rf "$1"; mkdir -p "$1" "$3"; chmod 700 "$1"', [dir, RUN_DIR, workdir], { timeoutMs: 10e3 });
      await this.writeFile(`${dir}/prompt.txt`, prompt);
      await this.writeFile(`${dir}/system.txt`, String(systemAppend || ""));
      await this.writeFile(`${dir}/mcp.json`, mcpConfig(mcp));
      const a = runArgs({ model, effort, dir });
      const uuid = await sessionUuid(session);
      this.sql.exec("INSERT INTO runs (id, session, started, ended) VALUES (?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET session=excluded.session, started=excluded.started, ended=NULL", id, String(session), Date.now());
      await this.ctx.container.exec(["setsid", "bash", "-c", runnerScript() + "\n", "_", dir, workdir, uuid, String(Math.floor(RUN_MAX_MS / 1000)), ...a], { stderr: "ignore", stdin: "ignore", stdout: "ignore", env: { HOME, BROWSER: "true" } });
      this.log(`run started (${id.slice(0, 8)}) model=${model || "default"} effort=${effort || "default"}`);
      this.put("warm_cold", r.cold ? "1" : "0");
    } catch (e) { this.inflight--; this.sql.exec("UPDATE runs SET ended=? WHERE id=?", Date.now(), id); throw e; }
    return await this.streamRun(id, 1);
  }
  // The same run's output again from byte offset `fromByte` (1 is the start), after a deploy reset the object that was streaming it.
  async attach(session, fromByte = 1) {
    this.touch();
    if (!session || !SESSION_RE.test(String(session))) throw Object.assign(new Error("bad session"), { status: 400 });
    if (!this.ctx.container.running) throw Object.assign(new Error("Claude's engine stopped"), { status: 410, code: "engine_stopped" });
    const id = await runId(session);
    const have = await this.bash('[ -d "$1" ] && echo yes || echo no', [`${RUN_DIR}/${id}`], { timeoutMs: 8e3 });
    if (!have.out.includes("yes")) throw Object.assign(new Error("That run is gone"), { status: 410, code: "run_gone" });
    this.sql.exec("INSERT INTO runs (id, session, started, ended) VALUES (?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET ended=NULL", id, String(session), Date.now());
    this.inflight++;
    return await this.streamRun(id, Math.max(1, Math.floor(Number(fromByte) || 1)));
  }
  // The caller has already counted this stream in this.inflight.
  async streamRun(id, from) {
    const dir = `${RUN_DIR}/${id}`;
    let proc = null, reader = null, over = false, sawResult = false;
    try {
      proc = await this.ctx.container.exec(["bash", "-c", tailScript(), "_", dir, String(from)], { stderr: "ignore" });
      reader = proc.stdout.pipeThrough(lineStream()).getReader();
    } catch (e) { this.inflight--; throw e; }
    const finish = async (exit) => {
      if (over) return; over = true;
      this.inflight--; this.touch();
      if (exit != null) this.sql.exec("UPDATE runs SET ended=? WHERE id=?", Date.now(), id);
      if (exit != null) { await this.saveLogin().catch(() => {}); await this.bash('rm -rf "$1"', [dir], { timeoutMs: 8e3 }).catch(() => {}); }
    };
    const out = new ReadableStream({
      pull: async (ctl) => {
        try {
          const { value, done } = await reader.read();
          if (value) { this.touch(); if (!sawResult && /"type":"result"/.test(dec.decode(value))) sawResult = true; ctl.enqueue(value); }
          if (done) {
            const code = await proc.exitCode;
            // 137 or 124 (timeout) come from the run itself: say why on the stream as one more line, in the CLI's own result shape, so a consumer ends the turn.
            if (sawResult && code !== 124 && code !== 137) { /* the CLI already ended the turn with its own result line */ }
            else if (code === 124 || code === 137) ctl.enqueue(enc.encode(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: code === 124 ? "Claude took too long and was stopped." : "Claude's engine stopped before it finished.", exit_code: code }) + "\n"));
            else if (code !== 0) {
              const e = await this.bash('tail -c 2000 "$1/err" 2>/dev/null', [dir], { timeoutMs: 8e3 }).catch(() => ({ out: "" }));
              ctl.enqueue(enc.encode(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: e.out.trim().split("\n").pop() || "Claude stopped with an error.", exit_code: code }) + "\n"));
            }
            await finish(code); ctl.close();
          }
        } catch (e) { await finish(null); ctl.error(e); }
      },
      // The consumer went away (its own object was reset, or the turn was stopped): stop tailing but leave the run going, so attach() can pick it up.
      cancel: async () => { try { proc?.kill(9); } catch {} await finish(null); },
    });
    return out;
  }
  // ---- complete: one model call for 1Helm's own helper loop ----
  // `body` is 1Helm's chat.completions request (messages with system, user, assistant and tool roles, tool_calls, tools with JSON schemas, images, and optionally
  // response_format, max_tokens, stop, reasoning). The signed-in Claude Code CLI is only the model call here: /opt/1hc/relay/complete.mjs starts a fresh
  // `claude -p` with native tools off, lets exactly one request reach api.anthropic.com through a loopback relay, and turns the answer back into chat.completions.
  // Returns the chat.completion object, or with `stream` a ReadableStream of Server-Sent Events bytes ("data: <chat.completion.chunk>\n\n", then "data: [DONE]\n\n").
  // The assistant message carries reasoning_details (signed thinking); the caller keeps it in its history and sends it back unchanged on the next call.
  async complete({ body, model, effort, session, stream = false } = {}) {
    this.touch();
    if (!body || typeof body !== "object" || !Array.isArray(body.messages) || !body.messages.length) throw Object.assign(new Error("body.messages is required"), { status: 400 });
    if (model && !MODEL_RE.test(String(model))) throw Object.assign(new Error("bad model"), { status: 400 });
    if (effort && !EFFORTS.has(String(effort))) throw Object.assign(new Error("bad effort"), { status: 400 });
    if (session != null && !SESSION_RE.test(String(session))) throw Object.assign(new Error("bad session"), { status: 400 });
    const payload = JSON.stringify({ body, model: model || undefined, effort: effort || undefined });
    if (payload.length > MAX_BODY_BYTES) throw Object.assign(new Error("request too large"), { status: 413 });
    if (!(await this.savedRow())) throw Object.assign(new Error("Not signed in to Claude. Sign in under Settings, AI services."), { status: 401, code: "not_signed_in" });
    await this.ensureRunning();
    if (this.get("signed_in") !== "1") throw Object.assign(new Error("Not signed in to Claude. Sign in under Settings, AI services."), { status: 401, code: "not_signed_in" });
    if (this.calls.size >= MAX_CALLS) throw Object.assign(new Error("Claude is busy with other work for this account. Try again in a moment."), { status: 429, code: "engine_busy" });
    const key = session != null ? String(session) : crypto.randomUUID();
    this.inflight++;
    let proc, reader;
    try {
      proc = await this.ctx.container.exec(["node", COMPLETE_JS], { stdin: new Response(payload).body, stderr: "ignore", env: { HOME } });
      reader = proc.stdout.pipeThrough(lineStream()).getReader();
    } catch (e) { this.inflight--; throw e; }
    this.calls.set(key, proc);
    let over = false;
    const finish = async (saveToo) => {
      if (over) return; over = true;
      this.inflight--; if (this.calls.get(key) === proc) this.calls.delete(key); this.touch();
      if (saveToo) await this.saveLogin().catch(() => {});   // the CLI may have refreshed its login during the call
    };
    const next = async () => {   // the next event line, or null at the end of the output
      const { value, done } = await reader.read();
      if (done) return null;
      let ev; try { ev = JSON.parse(dec.decode(value)); } catch { return { t: "error", error: { message: "The Claude engine sent an unreadable line." } }; }
      if (ev?.t === "limits") { this.noteLimits(ev); return next(); }   // Anthropic's rate limit headers: kept for the usage bars, not part of the answer
      return ev;
    };
    const fail = (err) => Object.assign(new Error(err?.message || "Claude stopped with an error."), { ...(err?.status ? { status: err.status } : {}), ...(err?.code ? { code: err.code } : {}) });
    if (!stream) {
      try {
        for (;;) {
          const ev = await next();
          if (ev === null) throw Object.assign(new Error("Claude's engine stopped before it finished."), { status: 503 });
          if (ev.t === "final") { await finish(true); return ev.response; }
          if (ev.t === "error") throw fail(ev.error);
        }
      } catch (e) { await finish(true); throw e; }
      finally { try { reader.cancel(); } catch {} }
    }
    const sse = (o) => enc.encode(`data: ${typeof o === "string" ? o : JSON.stringify(o)}\n\n`);
    return new ReadableStream({
      pull: async (ctl) => {
        try {
          const ev = await next();
          if (ev === null) { await finish(false); ctl.error(Object.assign(new Error("Claude's engine stopped before it finished."), { status: 503 })); return; }
          if (ev.t === "chunk") { this.touch(); ctl.enqueue(sse(ev.chunk)); }
          else if (ev.t === "final") { ctl.enqueue(sse("[DONE]")); await finish(true); ctl.close(); try { reader.cancel(); } catch {} }
          else if (ev.t === "error") { ctl.enqueue(sse({ error: { message: ev.error?.message || "Claude stopped with an error.", status: ev.error?.status ?? null, code: ev.error?.code ?? null } })); await finish(true); ctl.error(fail(ev.error)); }
        } catch (e) { await finish(false); ctl.error(e); }
      },
      cancel: async () => { try { proc.kill(15); } catch {} try { reader.cancel(); } catch {} await finish(false); },
    });
  }
  // ---- plan usage (src/ee/byok-usage.js) ----
  // The relay sends Anthropic's anthropic-ratelimit-* headers of each model call (header names only go to the event log, once per change, so the real names can be checked on dev).
  noteLimits(ev) {
    const h = ev?.headers; if (!h || typeof h !== "object") return;
    const keep = {}; for (const [k, v] of Object.entries(h)) if (/^anthropic-ratelimit-[a-z0-9-]{1,80}$/.test(k) && typeof v === "string" && v.length <= 200) keep[k] = v;
    if (!Object.keys(keep).length) return;
    this.put("limits", JSON.stringify({ at: Date.now(), status: Number(ev.status) || 0, h: keep }));
    const names = Object.keys(keep).sort().join(","); if (this.get("limits_names") !== names) { this.put("limits_names", names); this.log(`rate limit headers (status ${Number(ev.status) || 0}): ${names}`); }
  }
  // The account's plan usage: { source: "headers" | "oauth", windows, status } or { none: true, why }. The headers of the latest call come first. With none, the CLI's own token is used INSIDE the
  // container (relay/usage.mjs) when the container is already running (it is never started for this), at most every 5 minutes. The token is never returned.
  async usage() {
    let lim = null; try { lim = JSON.parse(this.get("limits") || "null"); } catch {}
    if (lim?.h) { const p = parseClaudeHeaders(lim.h); if (p.windows.length) return { source: "headers", at: lim.at, windows: p.windows, status: p.status, reset: p.reset }; }
    let cached = null; try { cached = JSON.parse(this.get("usage_cache") || "null"); } catch {}
    const tried = Number(this.get("usage_try")) || 0;
    if (Date.now() - tried < USAGE_TRY_MS) return cached?.windows?.length ? { source: "oauth", at: cached.at, windows: cached.windows } : { none: true, why: this.get("usage_why") || "none" };
    if (this.get("signed_in") !== "1" || !this.ctx.container?.running) return { none: true, why: "asleep" };
    this.put("usage_try", Date.now());
    let out = null;
    try { const r = await this.bash('node "$1"', [USAGE_JS], { timeoutMs: 20e3, env: { CLAUDE_CODE_VERSION } }); out = JSON.parse(String(r.out || "").trim().split("\n").pop() || "null"); } catch { out = null; }
    if (!out?.ok) { const why = String(out?.why || "engine").slice(0, 40); this.put("usage_why", why); this.del("usage_cache"); return { none: true, why }; }
    const p = parseClaudeUsage(out.data);
    if (!p.windows.length) { this.put("usage_why", "none"); return { none: true, why: "none" }; }
    this.put("usage_cache", JSON.stringify({ at: Date.now(), windows: p.windows })); this.put("usage_why", "");
    return { source: "oauth", at: Date.now(), windows: p.windows };
  }
  // The person's Stop: kill the CLI and everything it started.
  async cancel(session) {
    if (!session || !SESSION_RE.test(String(session))) return { ok: false };
    const call = this.calls.get(String(session));
    if (call) { try { call.kill(15); } catch {} this.log("model call stopped by the person"); return { ok: true }; }
    if (!this.ctx.container.running) return { ok: false, running: false };
    const id = await runId(session);
    await this.bash(`${KILL_TREE}; [ -f "$1/pid" ] && k "$(cat "$1/pid")"; [ -f "$1/code" ] || echo 130 > "$1/code"; true`, [`${RUN_DIR}/${id}`], { timeoutMs: 15e3 }).catch(() => {});
    this.sql.exec("UPDATE runs SET ended=? WHERE id=?", Date.now(), id);
    this.log("run stopped by the person");
    return { ok: true };
  }

  // TEST ONLY
  async setIdle(ms) { this.put("idle_ms", ms); return { idle_ms: ms }; }
  async debug() { return { ready: this.get("ready"), running: !!this.ctx.container.running, runs: this.activeRuns(), events: this.sql.exec("SELECT at,what FROM events ORDER BY seq DESC LIMIT 12").toArray() }; }
}

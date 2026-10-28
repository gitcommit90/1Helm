// One Linux computer per channel. Each channel has its own Durable Object ("ChannelComputer"), its own container
// and its own stack of squashfs layers in R2 under t/<tenant>/c/<channel>/.
// The container never holds R2 keys. It talks to http://computer.internal, which is intercepted outside the VM and
// routed to ComputerLink with this channel's DO id baked into its props, so a container can only reach its own files.
// Layers: newest first; a session's changes are one "delta" layer (replaced on each save in that session).
// A layer only becomes part of the workspace after its bytes are in R2 and the SHA-256 matched.
import { SNAP_CMD } from "./files-saveback.js";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { tolerantEnv } from "./do-stub.js";
import { installSnapshotRpc } from "./sqlite-snapshot.js";
import { computerDeletionMix } from "./deletion-do.js";
import { isCapacityError, computerBusyError, CAPACITY_RETRY_MS, tailOutput } from "./computer-capacity.js";
import { COMPUTER_ENV, COMPUTER_SHELL_PREFIX } from "./computer-env.js";
import { computerPreviewMix } from "./file-preview.js";
import { stPut, stDelete, keyInfo, room, noteRefused, clearRefused, fullMessage, fullToolNote } from "./storage.js";
import { SKILL_SCRIPTS, SKILLS_VERSION, SKILLS_DIR, SKILLS_INSTALL_JS, skillsPayload, TEMPLATES_DIR, TEMPLATE_INSTALL_JS, DECK_COMMAND, deckCommandRefs } from "./skills/scripts.js";
import { deckManifest, deckTemplate } from "./deck-templates.js";

const IDLE_MS = 60e3;                // wakes take 1–6 s, so sleep fast; idle time is the main compute cost
const SAVE_DEBOUNCE_MS = 20e3;
const PRESENCE_MS = 5 * 60e3;       // an open live pane keeps the computer awake only while the person moves/clicks/types within this window
const MAX_DELTAS = 8;              // compaction: after this many delta layers, the next save is a full base
const RATE_NANO_PER_SEC = Math.ceil((8 * 0.0000025 + 2 * 0.000020 + 16 * 0.00000007) * 1e9 * 1.15); // standard-3, CPU billed as if 100% busy (conservative prepay), cost+15%
const dec = new TextDecoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
// k <pid>: kill a process and all its descendants (children first). pgrep when present, else /proc.
const KILL_TREE = 'kids(){ if command -v pgrep >/dev/null 2>&1; then pgrep -P "$1"; else for s in /proc/[0-9]*/stat; do read -r cp _ _ pp _ < "$s" 2>/dev/null && [ "$pp" = "$1" ] && echo "$cp"; done; fi; }; k(){ for c in $(kids "$1"); do k "$c"; done; kill -9 "$1" 2>/dev/null; }';
const START_ATTEMPT_MS = 15e3;     // a start that hasn't answered exec within this is abandoned and replaced
const START_TOTAL_MS = 60e3;
const MIN_AWAKE_AFTER_CMD_MS = 10e3;
const EXEC_TIMEOUT_MS = 15 * 60e3;    // one command may run up to 15 min; the computer never idle-stops while a command is running // never stop (idle/credits) within 10 s of the last command
const BROWSER_OWNER_TTL_MS = 2 * 60e3; // A crashed browser job gives up the shared tab without an explicit release.
const BROWSER_OWNER_MAX_TTL_MS = 15 * 60e3;
// After a reset, keep an uncertain operation from admitting a different browser job, but only as long as that kind of
// operation can still be running. A browser call is short (wake, then one request to Chrome); a shell command may run up to
// EXEC_TIMEOUT_MS. A row left by a deploy therefore blocks for minutes, never for an hour.
const COMPUTER_BUSY_TTL_MS = { browser: 3 * 60e3, owner_browser: 3 * 60e3, command: EXEC_TIMEOUT_MS + 60e3 };
const ACTIVITY_LINGER_MS = 4e3;   // the computer button's dot stays on this long after a computer step ends
const COMPUTER_BUSY_TTL_DEFAULT_MS = 3 * 60e3;
// A reservation written by an earlier instance of this object (a deploy or reset ended the call that would have removed it) keeps
// the computer busy for this long, enough for a browser call already sent to finish, and no longer. Shell commands used to leave a
// 16 minute block that refused every browser task with "still completing another operation".
const COMPUTER_BUSY_ORPHAN_MS = 2 * 60e3;
const RESTART_GAP_MS = 2e3;        // measured: 0 s gap → 3/8 starts needed retries; 2 s → 8/8 first-try; 5 s adds wait for nothing
// The Sentinel terminates HTTPS with a per-container CA that exists only at runtime; trust it before anything else runs.
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const TRUST_CA = `for i in $(seq 1 50); do [ -s ${CA} ] && break; sleep 0.1; done; if [ -s ${CA} ]; then cp ${CA} /usr/local/share/ca-certificates/1helm-sentinel.crt && update-ca-certificates >/dev/null 2>&1; echo "[1hc] sentinel CA trusted"; else echo "[1hc] no sentinel CA"; fi; `;
const CA_ENV = { SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt", REQUESTS_CA_BUNDLE: "/etc/ssl/certs/ca-certificates.crt", CURL_CA_BUNDLE: "/etc/ssl/certs/ca-certificates.crt", NODE_EXTRA_CA_CERTS: CA, GIT_SSL_CAINFO: "/etc/ssl/certs/ca-certificates.crt" };
const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
const RUN_RE = /^[A-Za-z0-9_-]{1,96}$/;   // a tool call's run id (sh/reattach): safe in a file name
// Where the browser's downloads land. The resident moves each finished one into /workspace/files and the Library
// (Resident.collectDownloads), so this folder only ever holds downloads in progress or not yet collected.
export const DOWNLOADS = "/workspace/files/downloads";
const PROFILE = "/workspace/.browser/profile", POLICY_DIR = "/etc/opt/chrome_for_testing/policies/managed";
// Chrome setup run at every wake, before the browser's lazy first start (Chrome reads both at launch):
// - Managed policy: no "Chrome for Testing is only for automated testing" bar and no "Sign in to Chrome?" pill in the live
//   view (web logins still work); downloads go to DOWNLOADS without a Save As dialog (the policy also covers downloads the
//   person makes after Take control, and they can't change it in Chrome's settings).
// - The same folder in the profile's own Preferences, in case the policy file isn't read.
// Not CDP Browser.setDownloadBehavior: Chrome resets it as soon as the client that set it disconnects (checked 2026-10-06),
// and the browser service holds no lasting browser-level connection without an image change.
export function browserSetupCmd({ policyDir = POLICY_DIR, profile = PROFILE, downloads = DOWNLOADS } = {}) {
  const policy = JSON.stringify({ CommandLineFlagSecurityWarningsEnabled: false, BrowserSignin: 0, PromotionsEnabled: false, DownloadDirectory: downloads, PromptForDownloadLocation: false });
  const prefs = `const fs=require("fs"),f=process.argv[1],d=process.argv[2];let j={};try{j=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}`
    + `if(j.download?.default_directory===d&&j.download?.prompt_for_download===false)process.exit(0);`
    + `j.download={...(j.download||{}),default_directory:d,prompt_for_download:false,directory_upgrade:true};j.savefile={...(j.savefile||{}),default_directory:d};`
    + `fs.mkdirSync(require("path").dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(j))`;
  return `mkdir -p '${policyDir}' '${downloads}' && printf '%s' '${policy}' > '${policyDir}/1hc.json'; node -e '${prefs}' '${profile}/Default/Preferences' '${downloads}' || true`;
}

// SigV4 presigned GET for one R2 object (read-only, short-lived). Lets the container download its own layers straight
// from R2 without holding any key and without streaming through this Worker.
async function presignGet(env, key, expires = 900) {
  const enc = new TextEncoder();
  const hmac = async (k, m) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), enc.encode(m)));
  const host = new URL(env.R2_ENDPOINT).host, path = `/${env.R2_BUCKET_NAME}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""), day = now.slice(0, 8), scope = `${day}/auto/s3/aws4_request`;
  const q = { "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${env.R2_ACCESS_KEY_ID}/${scope}`, "X-Amz-Date": now, "X-Amz-Expires": String(expires), "X-Amz-SignedHeaders": "host" };
  const qs = Object.keys(q).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`).join("&");
  const creq = `GET\n${path}\n${qs}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const sts = `AWS4-HMAC-SHA256\n${now}\n${scope}\n${hex(await crypto.subtle.digest("SHA-256", enc.encode(creq)))}`;
  let k = await hmac(enc.encode("AWS4" + env.R2_SECRET_ACCESS_KEY), day);
  for (const part of ["auto", "s3", "aws4_request"]) k = await hmac(k, part);
  return `https://${host}${path}?${qs}&X-Amz-Signature=${hex(await hmac(k, sts))}`;
}

export class ComputerLink extends WorkerEntrypoint {
  async fetch(req) { return linkFetch(this.env, this.ctx.props.id, req); }
}
export async function linkFetch(env, id, req) {
  {
    // The container's init/save scripts use curl. Web pages opened in its Chrome must not call this private controller.
    if (req.headers.has("origin") || req.headers.has("sec-fetch-mode") || req.headers.has("sec-fetch-site"))
      return new Response("forbidden", { status: 403 });
    const u = new URL(req.url);
    const C = env.CHANNEL_COMPUTER.get(env.CHANNEL_COMPUTER.idFromString(id));
    switch (u.pathname) {
      case "/manifest": {
        if (req.method !== "GET") return new Response("GET only", { status: 405 });
        return new Response(await C.manifestText());
      }
      case "/layer": {
        if (req.method !== "GET") return new Response("GET only", { status: 405 });
        const key = u.searchParams.get("key");
        if (!(await C.ownsLayer(key))) return new Response("forbidden", { status: 403 });
        const obj = await env.WS.get(key);
        return obj ? new Response(obj.body, { headers: { "content-length": String(obj.size) } }) : new Response("missing", { status: 404 });
      }
      case "/save-plan": {
        if (req.method !== "GET") return new Response("GET only", { status: 405 });
        return new Response(await C.savePlan(u.searchParams.get("session")));
      }
      case "/save": {
        if (req.method !== "PUT") return new Response("PUT only", { status: 405 });
        const h = (k) => req.headers.get(k) || "";
        const rawLength = req.headers.get("content-length"), kind = h("x-kind"), wantSha = h("x-sha256");
        if (!req.body || rawLength === null) return Response.json({ ok: false, error: "Content-Length required" }, { status: 411 });
        const len = Number(rawLength);
        if (!/^[0-9]+$/.test(rawLength) || !Number.isSafeInteger(len) || len < 1 || !["base", "delta"].includes(kind) || !/^[0-9a-f]{64}$/.test(wantSha))
          return Response.json({ ok: false, error: "invalid layer headers" }, { status: 400 });
        const t0 = Date.now(), key = await C.newLayerKey(kind);
        // storage.js: a save that would grow the account past its limit is refused before any byte is written; the previous save stays current.
        const rm = await C.saveRoom(kind, h("x-session"), len);
        if (!rm.ok) return Response.json({ ok: false, storage_full: true, error: rm.error }, { status: 507 });
        // Hash while streaming (no tee: tee would buffer the lagging branch in Worker memory).
        const digest = new crypto.DigestStream("SHA-256"), dw = digest.getWriter();
        const hashed = req.body.pipeThrough(new TransformStream({ async transform(c, ctl) { await dw.write(c); ctl.enqueue(c); } }));
        await stPut(env, key, hashed.pipeThrough(new FixedLengthStream(len)), {}, { size: len });
        await dw.close(); const sha = hex(await digest.digest);
        const head = await env.WS.head(key);
        if (sha !== wantSha || !head) { await stDelete(env, [{ key, size: head ? head.size : len }]); return Response.json({ ok: false, error: `sha mismatch ${sha} vs ${wantSha}` }, { status: 422 }); }
        return Response.json(await C.commitLayer({ key, sha, bytes: head.size, kind, session: h("x-session"), reason: h("x-reason"), pack_ms: Number(h("x-pack-ms")), upload_ms: Date.now() - t0 }));
      }
      case "/draining": {
        if (req.method !== "POST") return new Response("POST only", { status: 405 });
        return Response.json(await C.markDraining());
      }
    }
    return new Response("not found", { status: 404 });
  }
}

export class ChannelComputer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = tolerantEnv(env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS layers (seq INTEGER PRIMARY KEY, key TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, kind TEXT NOT NULL, session TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, what TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS egress (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, host TEXT, method TEXT, status INTEGER, verdict TEXT, why TEXT, keys TEXT, refused TEXT, ms INTEGER);
      CREATE TABLE IF NOT EXISTS computer_busy (id TEXT PRIMARY KEY, kind TEXT NOT NULL, until INTEGER NOT NULL);`);
    for (const col of ["instance TEXT", "at INTEGER"]) { try { this.sql.exec(`ALTER TABLE computer_busy ADD COLUMN ${col}`); } catch {} }   // rows from before this column keep the old, full expiry
    this.busyInstance = crypto.randomUUID();
    if (env.BACKUP_MAINTENANCE !== "1") this.reattachContainer();
  }
  // A Worker-only deploy resets this object but not its container (no image change → no rollout), and monitor() doesn't carry over
  // (Cloudflare: "If running is true when the Durable Object starts, call monitor() again"). Without it a container that exits later
  // is never noticed and "ready" stays 1. The idle/prepay alarm is re-armed too, so a running computer still sleeps when idle.
  // A container that exited while the object was down: not ready any more.
  reattachContainer() {
    try {
      const c = this.ctx.container; if (!c) return;
      if (!c.running) { if (this.get("ready") === "1") { this.put("ready", "0"); this.log("container gone after a restart of this object"); } return; }
      c.monitor?.()?.then(() => { this.put("ready", "0"); this.put("draining", "0"); }, () => { this.put("ready", "0"); this.put("draining", "0"); });
      this.put("reattached_at", Date.now());
      this.ctx.waitUntil?.(this.ctx.storage.getAlarm().then((a) => (a == null ? this.ctx.storage.setAlarm(Date.now() + 30e3) : null)).catch(() => {}));
    } catch (e) { console.log("container reattach", e?.message); }
  }
  // Only the gateway Worker holds this stub; it has already checked the person's session and the control lease.
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/live") return this.liveView(req, u.searchParams.get("mode"));
    return new Response("not found", { status: 404 });
  }
  get(k) { return this.sql.exec("SELECT v FROM kv WHERE k=?", k).toArray()[0]?.v; }
  put(k, v) { this.sql.exec("INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v)); }
  log(what) { this.sql.exec("INSERT INTO events (at,what) VALUES (?,?)", Date.now(), what); }
  prefix() { return `t/${this.get("tenant")}/c/${this.get("channel")}/`; }
  // Current workspace = newest base and every delta after it, newest first (overlay lowerdir order).
  stack() { return this.sql.exec("SELECT * FROM layers WHERE seq >= COALESCE((SELECT MAX(seq) FROM layers WHERE kind='base'),0) ORDER BY seq DESC").toArray(); }

  // ---- Sentinel support ----
  async who() { return { tenant: this.get("tenant"), channel: this.get("channel") }; }
  async noteEgress(e) {
    this.sql.exec("INSERT INTO egress (at,host,method,status,verdict,why,keys,refused,ms) VALUES (?,?,?,?,?,?,?,?,?)", e.at, e.host, e.method, e.status, e.verdict, e.why || "", JSON.stringify(e.keys || []), JSON.stringify(e.refused || []), e.ms);
    this.sql.exec("DELETE FROM egress WHERE seq < (SELECT MAX(seq) FROM egress) - 2000"); return { ok: true };
  }
  async egressLog(n = 50) { return this.sql.exec("SELECT * FROM egress ORDER BY seq DESC LIMIT ?", n).toArray(); }
  // Saved keys appear in the computer only as stand-ins (env vars); the Sentinel swaps in the real value at the network edge.
  async loadStandins() {
    try { const rows = (await this.env.DB.prepare("SELECT name, standin FROM vault WHERE tenant_id=?").bind(this.get("tenant")).all()).results || [];
      this._standins = Object.fromEntries(rows.map((r) => [r.name, r.standin])); } catch { this._standins = {}; }
  }
  // On unless this channel was switched off (TEST_MODE /api/res/<ch>/sentinel) or the Worker's SENTINEL_DEFAULT isn't "on".
  sentinelOn() { return this.env.NATIVE_NETWORK === 'on' || (this.get("sentinel") || this.env.SENTINEL_DEFAULT || "off") === "on"; }
  // Takes effect at the next start (internet on/off is fixed when the container starts), so a running computer is stopped.
  async setSentinel(mode) { if (mode === 'off' && this.env.NATIVE_NETWORK === 'on') return { error: 'Native network permissions require Sentinel. It cannot be disabled.' }; this.put("sentinel", mode === "off" ? "off" : "on"); if (this.ctx.container.running) await this.stop("sentinel mode changed", { cancellable: false }); return { sentinel: this.get("sentinel") }; }
  // Worker-only activation barrier. An older running internet-enabled instance
  // must finish/restart before the account can claim native network protection.
  async nativeGuardStatus() {
    const guarded = this.sentinelOn() && (!this.ctx.container.running || this.get('started_sentinel') === 'on');
    return { guarded, running: !!this.ctx.container.running, busy: !!this.inflight, configured_sentinel: this.sentinelOn(), started_sentinel: this.get('started_sentinel') || 'off' };
  }
  async init(tenant, channel) { this.put("tenant", tenant); this.put("channel", channel); return { ok: true }; }
  // Migration: register an already-uploaded base image (only on a channel with no layers).
  async importBase(tenant, channel, { key, sha256, bytes }) {
    await this.init(tenant, channel);
    if (this.sql.exec("SELECT COUNT(*) n FROM layers").one().n) throw new Error("channel already has layers");
    if (!key.startsWith(this.prefix())) throw new Error("key outside this channel");
    const head = await this.env.WS.head(key); if (!head || head.size !== bytes) throw new Error("uploaded image missing or wrong size");
    this.sql.exec("INSERT INTO layers (seq,key,sha256,bytes,kind,session,at) VALUES (?,?,?,?,?,?,?)", Date.now(), key, sha256, bytes, "base", "import", Date.now());
    this.log(`imported base ${bytes} bytes`); return { ok: true };
  }

  // ---- called by the container through ComputerLink ----
  async manifestText() {
    const rows = [];
    for (const l of this.stack()) rows.push(`${l.key} ${l.sha256} ${l.bytes} ${this.env.R2_SECRET_ACCESS_KEY ? await presignGet(this.env, l.key) : "-"}`);
    return rows.join("\n") + "\n";
  }
  async ownsLayer(key) { return !!this.sql.exec("SELECT 1 FROM layers WHERE key=?", key).toArray().length; }
  async savePlan(session) {
    const deltas = this.stack().filter((l) => l.kind === "delta");
    const other = deltas.filter((l) => l.session !== session).length;
    return !this.stack().length || other >= MAX_DELTAS || this.get("force_base") === "1" ? "base" : "delta";   // force_base: files were deleted (deletion-do.js)
  }
  // Room for a save of `len` bytes? It replaces layers (a base replaces all; a delta replaces its session's last one), so only the growth counts.
  async saveRoom(kind, session, len) {
    const drop = kind === "base" ? this.sql.exec("SELECT COALESCE(SUM(bytes),0) b FROM layers").one().b
      : this.sql.exec("SELECT COALESCE(SUM(bytes),0) b FROM layers WHERE kind='delta' AND session=? AND session<>''", String(session || "")).one().b;
    const grows = Number(len) - Number(drop || 0); if (grows <= 0) return { ok: true };
    const rm = await room(this.env, this.get("tenant"), grows); if (rm.ok) return { ok: true };
    this.put("save_refused", JSON.stringify({ at: Date.now(), need: grows, used: rm.used, limit: rm.limit }));
    await noteRefused(this.env, this.get("tenant"), "computer save");
    this.log(`save refused: storage full (${rm.used} of ${rm.limit} bytes used, this save adds ${grows}); previous save kept`);
    return { ok: false, error: fullMessage(rm), storage: rm };
  }
  // The helper's note while a save is being refused (exec results carry it, so the helper tells the person).
  storageNote() {
    let r = null; try { r = JSON.parse(this.get("save_refused") || "null"); } catch {}
    return r ? "Note: storage is full, so the latest changes on this computer couldn't be saved (the previous save is kept; nothing was deleted). They're lost if the computer goes to sleep before there's room. Tell the person their storage is full and that they can add more in Settings → General → Usage (Add storage) or delete files they don't need." : null;
  }
  async newLayerKey(kind) { return `${this.prefix()}${Date.now()}-${kind === "base" ? "base" : "delta"}.sqsh`; }
  async commitLayer(l) {
    const seq = Date.now(), kind = l.kind === "base" ? "base" : "delta";
    const drop = kind === "base" ? this.sql.exec("SELECT key, bytes FROM layers WHERE seq < ?", seq).toArray()
      : this.sql.exec("SELECT key, bytes FROM layers WHERE kind='delta' AND session=? AND session<>''", l.session).toArray();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO layers (seq,key,sha256,bytes,kind,session,at) VALUES (?,?,?,?,?,?,?)", seq, l.key, l.sha, l.bytes, kind, l.session, Date.now());
      for (const d of drop) this.sql.exec("DELETE FROM layers WHERE key=?", d.key);
    });
    await stDelete(this.env, drop.map((d) => ({ key: d.key, size: d.bytes })));   // only after the new layer is committed
    if (this.get("save_refused")) { this.sql.exec("DELETE FROM kv WHERE k='save_refused'"); await clearRefused(this.env, this.get("tenant")); }
    this.put("dirty", "0"); if (kind === "base") this.sql.exec("DELETE FROM kv WHERE k='force_base'");
    this.log(`save ${kind} (${l.reason}): ${l.bytes} bytes, pack ${l.pack_ms}ms, upload ${l.upload_ms}ms, dropped ${drop.length}`);
    return { ok: true, kind, bytes: l.bytes, pack_ms: l.pack_ms, upload_ms: l.upload_ms, layers: this.stack().length };
  }
  async markDraining() { this.put("draining", "1"); this.put("ready", "0"); this.log("container got SIGTERM; saving itself"); return { ok: true }; }

  // ---- lifecycle ----
  // tag (a turn's key): Stop can kill this command's whole process tree (cancel below). Its shell writes its pid first.
  // run (a tool call's id, resume.js): the command's output and exit code also go to /tmp/.1hc-out-<run>.{out,code} and its shell's pid to
  // .pid. Measured on dev 10-08: a command started with exec keeps running when this object is reset by a deploy, so the new object can
  // re-attach (reattach below) and hand the turn the real result instead of "it may have finished".
  async sh(cmd, { timeoutMs = 120e3, tag = null, run = null } = {}) {
    if (run && RUN_RE.test(String(run))) { const f = `/tmp/.1hc-out-${run}`;
      cmd = `find /tmp -maxdepth 1 -name '.1hc-out-*' -mmin +180 -delete 2>/dev/null; rm -f ${f}.out ${f}.code; echo $$ > ${f}.pid; ( ${cmd}
) > ${f}.out 2>&1; c=$?; echo $c > ${f}.code; tail -c 200000 ${f}.out; exit $c`; }
    if (tag) cmd = `echo $$ > /tmp/.1hc-run-${tag}; ${cmd}`;
    cmd = COMPUTER_SHELL_PREFIX + cmd;   // computer-env.js: pip and npm installs land under /workspace/.home, which is saved
    // exec() itself can hang when the platform has no instance behind the DO (seen: 300 s hang after a refused start),
    // so the launch is raced against the timeout too, not only the process.
    let to; const launch = this.ctx.container.exec(["bash", "-c", cmd], { cwd: "/", stderr: "combined", env: { ...COMPUTER_ENV, ...CA_ENV, ...(this._standins || {}) } });
    const p = await Promise.race([launch, new Promise((_, rej) => { to = setTimeout(() => rej(new Error(`exec launch timed out after ${timeoutMs}ms`)), timeoutMs); })]);
    clearTimeout(to);
    if (tag) (this.procs ||= new Map()).set(tag, p);
    let timedOut = false;
    try {
    // Past its time: the whole process tree goes (children first, like Stop), not only the shell.
    const t = setTimeout(() => { timedOut = true; if (tag) this.killTree(tag).catch(() => {}); try { p.kill(9); } catch {} }, timeoutMs);
    // Stream with a byte cap so a huge output can't exhaust DO memory.
    const r = p.stdout.getReader(); let out = "", n = 0;
    for (;;) { const { value, done } = await r.read(); if (done) break; n += value.byteLength; if (out.length < 200000) out += dec.decode(value, { stream: true }); }
    const code = await p.exitCode; clearTimeout(t);
    return { code: timedOut ? 124 : code, out: out.length >= 200000 ? out.slice(0, 200000) + `\n[truncated, ${n} bytes total]` : out, ...(timedOut ? { timed_out: true } : {}) };
    } finally { if (tag && this.procs?.get(tag) === p) this.procs.delete(tag); }
  }
  // resume.js: the command a reset object started for tool call `run` → its result when it has finished (or once it finishes, within
  // timeoutMs; past that it's stopped like any command that runs too long), or { lost: true } when it's gone without a result.
  async reattach(run, { timeoutMs = EXEC_TIMEOUT_MS } = {}) {
    if (!RUN_RE.test(String(run))) return { lost: true, why: "bad id" };
    if (!this.ctx.container?.running) return { lost: true, why: "computer stopped" };
    const f = `/tmp/.1hc-out-${run}`, end = Date.now() + Math.max(5e3, Math.min(Number(timeoutMs) || EXEC_TIMEOUT_MS, EXEC_TIMEOUT_MS)), t0 = Date.now();
    this.inflight = (this.inflight || 0) + 1; this.workOps = (this.workOps || 0) + 1;
    try {
      for (;;) {
        this.put("last_activity", Date.now());
        const r = await this.sh(`if [ -f ${f}.code ]; then echo "CODE $(cat ${f}.code)"; tail -c 200000 ${f}.out; elif [ -f ${f}.pid ] && kill -0 "$(cat ${f}.pid)" 2>/dev/null; then echo RUNNING; else echo LOST; fi`, { timeoutMs: 15e3 });
        const head = r.out.split("\n")[0] || "", m = head.match(/^CODE (-?\d+)/);
        if (m) { this.log(`re-attached to a command after a restart (${Date.now() - t0} ms)`); return { code: Number(m[1]), out: r.out.slice(head.length + 1).slice(-20000), reattached: true, waited_ms: Date.now() - t0 }; }
        if (!/^RUNNING/.test(head)) return { lost: true, why: "no result" };
        if (Date.now() > end) {
          await this.sh(`${KILL_TREE}; k "$(cat ${f}.pid)"`, { timeoutMs: 15e3 }).catch(() => {});
          const t = await this.sh(`tail -c 20000 ${f}.out 2>/dev/null`, { timeoutMs: 15e3 }).catch(() => ({ out: "" }));
          return { code: 124, out: t.out, timed_out: true, reattached: true };
        }
        await sleep(2000);
      }
    } finally { this.inflight--; this.workOps--; this.opEnded = Date.now(); this.put("last_activity", Date.now()); }
  }
  // The person's Stop (stop.js): kill the command a turn is running, children first, then its shell.
  async cancel(tag) {
    if (!/^[0-9a-f-]{36}$/.test(String(tag))) return { ok: false };
    const p = this.procs?.get(tag); if (!p) return { ok: false, running: false };
    await this.killTree(tag);
    try { p.kill(9); } catch {}
    this.log("command stopped by the person");
    return { ok: true };
  }
  async killTree(tag) {
    const f = `/tmp/.1hc-run-${tag}`;
    try { const k = await this.ctx.container.exec(["bash", "-c", `${KILL_TREE}; [ -f ${f} ] && k "$(cat ${f})"; rm -f ${f}`], { stderr: "combined" }); await k.exitCode; } catch (e) { console.log("kill tree", e?.message); }
  }
  // Compute is prepaid a minute at a time; the platform bills per 10 ms of actual run time, so unused prepaid seconds go back on stop.
  async refundUnused() {
    const left = Number(this.get("paid_until") || 0) - Date.now(); this.put("paid_until", Date.now());
    if (left <= 1000) return 0;
    const nano = Math.floor(RATE_NANO_PER_SEC * left / 1000);
    const L = this.env.LEDGER.get(this.env.LEDGER.idFromName(`tenant:${this.get("tenant")}`));
    try { await L.grant(`computer-refund:${crypto.randomUUID()}`, nano, "computer_refund"); return nano; } catch { return 0; }
  }
  async prepayMinute() {
    const L = this.env.LEDGER.get(this.env.LEDGER.idFromName(`tenant:${this.get("tenant")}`));
    const id = `computer:${crypto.randomUUID()}`, nano = RATE_NANO_PER_SEC * 60;
    const r = await L.reserve(id, nano);
    if (!r.ok) { this._payFail = r.reason; return false; }
    await L.settle(id, nano);
    this.put("paid_until", Math.max(Number(this.get("paid_until") || 0), Date.now()) + 60e3);
    return true;
  }
  // One start at a time: concurrent callers (early warm-up from the resident + the first tool call) share the same start.
  async ensureRunning() {
    if (this.env.NATIVE_NETWORK === 'on' && this.ctx.container.running && this.get('started_sentinel') !== 'on' && this.inflight) throw new Error('Native network protection is waiting for the previous computer command to finish. Retry after it finishes.');
    // A computer started before the Sentinel mode changed (e.g. the deploy that turned it on by default) still has the old network
    // (internet on/off is fixed at start): stop it once, so this start gets the current mode.
    if (this.ctx.container.running && this.get("ready") === "1" && (this.get("started_sentinel") || "off") !== (this.sentinelOn() ? "on" : "off") && !this.inflight) {
      this.log("sentinel mode changed since start: restarting"); await this.stop("sentinel mode changed", { cancellable: false }).catch(() => {});
    }
    if (this.ctx.container.running && this.get("ready") === "1") return { cold: false };
    if (!this._starting) this._starting = this._ensureRunning().finally(() => { this._starting = null; });
    return await this._starting;
  }
  // Called by the resident the moment the model's streamed output names a computer tool, before its arguments finish.
  async warm() {
    this.put("last_activity", Date.now());
    try { return { ok: true, ...(await this.ensureRunning()) }; } catch (e) { return { ok: false, error: e.message }; }
  }
  async _ensureRunning() {
    if (this.ctx.container.running && this.get("ready") === "1") return { cold: false };
    // An idle stop is saving right now: wait for it to finish or cancel, then reuse the container if it survived.
    for (let i = 0; i < 240 && this.get("stopping") === "1"; i++) await sleep(250);
    if (this.ctx.container.running && this.get("ready") === "1") return { cold: false, reused_after_cancelled_stop: true };
    const t0 = Date.now();
    if (!(await this.prepayMinute())) throw this._payFail === "day_limit" ? Object.assign(new Error("skipped: daily safety limit reached"), { status: 429 }) : Object.assign(new Error("out_of_credits"), { status: 402 });
    // A container that got SIGTERM is saving itself; wait for it to exit rather than racing it.
    for (let i = 0; i < 240 && this.ctx.container.running && this.get("draining") === "1"; i++) await sleep(250);
    this.put("ready", "0"); this.put("draining", "0");
    // Starting right after a stop is where the platform stalls; respect a short gap since the last stop.
    const gap = Number(this.get("stopped_at") || 0) + Number(this.get("gap_override") ?? RESTART_GAP_MS) - Date.now();
    let gapMs = 0; if (gap > 0) { gapMs = gap; await sleep(gap); }
    await this.ctx.container.interceptOutboundHttp("computer.internal", this.ctx.exports.ComputerLink({ props: { id: this.ctx.id.toString() } }));
    // Sentinel: every other HTTP(S) request leaves through a checkpoint outside the VM (stand-in keys, approvals, traffic log).
    // Strict mode also closes every non-HTTP port (raw TCP/SSH can't bypass it); DNS still works.
    const sentinel = this.sentinelOn();
    this.put("started_sentinel", sentinel ? "on" : "off");
    if (sentinel) {
      const S = this.ctx.exports.Sentinel({ props: { id: this.ctx.id.toString(), tenant: this.get("tenant"), channel: this.get("channel") } });
      await this.ctx.container.interceptOutboundHttps("*", S);
      await this.ctx.container.interceptAllOutboundHttp(S);
    }
    // Bounded start: each attempt gets START_ATTEMPT_MS to answer exec; a stuck or refused start is destroyed and retried.
    let up = false, attempts = 0, lastErr = "", busySince = 0;
    while (!up && Date.now() - t0 < START_TOTAL_MS) {
      attempts++; lastErr = "";
      let exited = null;
      if (!this.ctx.container.running) {
        try { this.ctx.container.start({ entrypoint: sentinel ? ["bash", "-c", TRUST_CA + "exec /opt/1hc/init.sh"] : ["/opt/1hc/init.sh"], enableInternet: !sentinel }); } catch (e) { lastErr = String(e?.message || e); if (isCapacityError(lastErr)) exited = lastErr; }   // refused: no need to wait out the attempt
      }
      this.ctx.container.monitor().then(() => { exited = "exit"; this.put("ready", "0"); this.put("draining", "0"); })
        .catch((e) => { exited = String(e?.message || e); lastErr = exited; this.put("ready", "0"); this.put("draining", "0"); });
      const deadline = Date.now() + START_ATTEMPT_MS;
      while (!up && !exited && Date.now() < deadline) {
        try { up = (await this.sh("true", { timeoutMs: 3e3 })).code === 0; } catch { await sleep(200); }
      }
      if (up) break;
      this.log(`start attempt ${attempts} failed after ${Date.now() - t0}ms: ${exited || "no answer in " + START_ATTEMPT_MS + "ms"}`);
      if (this.ctx.container.running) { try { await Promise.race([this.ctx.container.destroy("stuck start"), sleep(5e3)]); } catch {} }
      // The class is at max_instances: stop after a short bound instead of the full START_TOTAL_MS.
      if (isCapacityError(lastErr)) { busySince ||= Date.now(); if (Date.now() - busySince >= CAPACITY_RETRY_MS) { this.log(`no capacity after ${attempts} attempts: ${lastErr}`); throw computerBusyError(); } }
      else busySince = 0;
      // Refusals ("no container instance…") come back in ~1–2 s and clear ~5 s after the previous stop, so retry quickly
      // instead of backing off (the old 1/2/3/4 s backoff added up to 6 s on top of the platform wait).
      await sleep(500);
    }
    if (!up && isCapacityError(lastErr)) throw computerBusyError();
    if (!up) throw new Error(`computer did not start (${attempts} attempts in ${Date.now() - t0}ms: ${lastErr})`);
    if (attempts > 1) this.log(`started after ${attempts} attempts`);
    const bootMs = Date.now() - t0;
    let ready;
    for (let i = 0; i < 900; i++) {
      const r = await this.sh("cat /var/1hc/ready 2>/dev/null || (cat /var/1hc/failed 2>/dev/null && echo FAILED)", { timeoutMs: 5e3 });
      if (r.out.includes("FAILED")) throw new Error("workspace mount failed: " + r.out.trim());
      if (r.out.trim().startsWith("{")) { ready = JSON.parse(r.out.trim()); break; }
      await new Promise((z) => setTimeout(z, 100));
    }
    if (!ready) throw new Error("workspace did not mount");
    const wakeMs = Date.now() - t0;
    // Chrome policy + download folder, written before the browser's lazy first start; no image rebuild needed (see browserSetupCmd).
    await this.sh(browserSetupCmd(), { timeoutMs: 5e3 }).catch(() => {});
    // Skill scripts (src/skills/README.md): a fresh computer has none, so write this deploy's set before anything runs.
    this.put("skills_v", ""); this.put("skills_fail_at", "0"); this.put("templates_have", "{}"); this.put("templates_fail_at", "0"); await this.installSkills();
    this.put("ready", "1"); this.put("last_activity", Date.now());
    this.put("boot_id", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);   // one id per start: the Resident re-checks /workspace/files once per boot (verifyComputerFiles)
    await this.ctx.storage.setAlarm(Date.now() + 30e3);
    // Recent cold-wake times (last 8) feed the live pane's progress estimate.
    { let w = []; try { w = JSON.parse(this.get("wake_hist") || "[]"); } catch {} w.push(wakeMs); this.put("wake_hist", JSON.stringify(w.slice(-8))); }
    this.log(`woke: boot ${bootMs}ms, workspace ${JSON.stringify(ready)}, total ${wakeMs}ms`);
    return { cold: true, boot_ms: bootMs, wake_ms: wakeMs, start_attempts: attempts, gap_wait_ms: gapMs, ...ready };
  }
  // ---- Real browser (Chrome on a virtual screen inside this computer; /opt/1hc-browser/server.mjs on :6080) ----
  // The browser service is only reachable from here: containers have no public ingress, and getTcpPort is DO-only.
  // A reset can leave a container command or browser request running after this object's in-memory counts vanish.
  // Keep a separate durable reservation before each first await. Confirmed completion removes only its own row.
  #busyStart(kind) { const id = crypto.randomUUID(), now = Date.now(); this.sql.exec("DELETE FROM computer_busy WHERE until<=?", now); this.sql.exec("INSERT INTO computer_busy (id,kind,until,instance,at) VALUES (?,?,?,?,?)", id, kind, now + (COMPUTER_BUSY_TTL_MS[kind] ?? COMPUTER_BUSY_TTL_DEFAULT_MS), this.busyInstance, now); return id; }
  #busyEnd(id) { this.sql.exec("DELETE FROM computer_busy WHERE id=?", id); }
  #busyActive(kind = null) {
    // A row from another instance (or from before the instance column) is an orphan: its start is `at`, or the expiry minus its kind's limit.
    const now = Date.now(), cmd = COMPUTER_BUSY_TTL_MS.command;
    const live = `until>? AND (instance=? OR COALESCE(at, until - CASE kind WHEN 'command' THEN ${cmd} ELSE ${COMPUTER_BUSY_TTL_DEFAULT_MS} END)+?>?)`;
    const args = [now, this.busyInstance, COMPUTER_BUSY_ORPHAN_MS, now];
    return !!this.sql.exec(`SELECT 1 FROM computer_busy WHERE ${kind ? "kind=? AND " : ""}${live} LIMIT 1`, ...(kind ? [kind, ...args] : args)).toArray().length;
  }
  #browserOwner() {
    const token = this.get("browser_owner"), until = Number(this.get("browser_owner_until") || 0);
    return token && until > Date.now() ? { token, until } : null;
  }
  // Test route only (resident deployProbe op "computer"): what is holding browser admission, with no tokens. Additive RPC.
  async busyDebug() {
    const now = Date.now();
    return { now, instance: this.busyInstance, in_memory: { browser: this.browserInFlight || 0, owner_browser: this.ownerBrowserInFlight || 0, command: this.commandInFlight || 0 },
      owner: (() => { const o = this.#browserOwner(); return { owned: !!o, until: o?.until || null }; })(), human_lease_until: Number(this.get("lease_until") || 0) || null,
      rows: this.sql.exec("SELECT kind, until, at, instance FROM computer_busy ORDER BY until").toArray().map((r) => ({ kind: r.kind, until: r.until, at: r.at, age_ms: r.at ? now - r.at : null, expires_in_ms: r.until - now, same_instance: r.instance === this.busyInstance, legacy: r.instance == null })) };
  }
  async browserOwnerState() {
    const owner = this.#browserOwner();
    return { owned: !!owner, in_flight: !!this.ownerBrowserInFlight || this.#busyActive("owner_browser"), human_controlled: !!this.get("lease") && Number(this.get("lease_until") || 0) > Date.now(), lease_until: owner?.until || null }; // Never return the bearer token to the app.
  }
  // The caller creates and retains a random token. A retry with the same token is safe; a second job is refused.
  async acquireBrowserOwner(token, ttlMs = BROWSER_OWNER_TTL_MS) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(String(token || ""))) return { ok: false, error: "invalid browser owner token" };
    if (this.get("lease") && Number(this.get("lease_until") || 0) > Date.now())
      return { ok: false, error: "The person has control of the browser.", taken_over: true };
    const owner = this.#browserOwner();
    if (owner && owner.token !== token) return { ok: false, error: "Another browser task is using this browser.", browser_busy: true };
    if ((this.browserInFlight || this.commandInFlight || this.#busyActive()) && (!owner || owner.token !== token))
      return { ok: false, error: "The computer is still completing another operation. Try again after it finishes.", browser_busy: true };
    const until = Date.now() + Math.max(1000, Math.min(Number(ttlMs) || BROWSER_OWNER_TTL_MS, BROWSER_OWNER_MAX_TTL_MS));
    this.put("browser_owner", token); this.put("browser_owner_until", until);
    return { ok: true, lease_until: until };
  }
  async renewBrowserOwner(token, ttlMs = BROWSER_OWNER_TTL_MS) {
    const owner = this.#browserOwner();
    if (!owner || owner.token !== token) return { ok: false, error: "Browser ownership was lost. Stop this task.", owner_lost: true };
    if (this.get("lease") && Number(this.get("lease_until") || 0) > Date.now())
      return { ok: false, error: "The person took control of the browser.", taken_over: true };
    const until = Date.now() + Math.max(1000, Math.min(Number(ttlMs) || BROWSER_OWNER_TTL_MS, BROWSER_OWNER_MAX_TTL_MS));
    this.put("browser_owner_until", until); return { ok: true, lease_until: until };
  }
  async releaseBrowserOwner(token) {
    if (this.get("browser_owner") !== token || !token) return { ok: false, error: "Browser ownership was lost.", owner_lost: true };
    if (this.ownerBrowserInFlight || this.#busyActive("owner_browser")) return { ok: false, error: "A browser operation is still in progress.", browser_busy: true };
    this.sql.exec("DELETE FROM kv WHERE k IN ('browser_owner','browser_owner_until')"); return { ok: true };
  }
  #browserOwnerGate(op, token, reserved = false) {
    if (op !== "status" && this.get("lease") && Number(this.get("lease_until") || 0) > Date.now())
      return { ok: false, error: "The person is using the browser right now (they took control). Wait for them to hand it back, then take a snapshot.", taken_over: true };
    const owner = this.#browserOwner();
    if (token != null) {
      if (!owner || owner.token !== token) return { ok: false, error: "Browser ownership was lost. Stop this task.", owner_lost: true };
      if ((this.ownerBrowserInFlight || 0) > (reserved ? 1 : 0) || !reserved && this.#busyActive("owner_browser"))
        return { ok: false, error: "Another browser operation is still in progress.", browser_busy: true };
    } else if (op !== "status" && (owner || this.ownerBrowserInFlight || this.#busyActive("owner_browser")))
      return { ok: false, error: "A background browser task is using this browser. Wait for it to finish, or take control to stop it.", browser_busy: true };
    // status is also used by the person's live browser pane. It does not change the tab.
    return null;
  }
  // The optional third argument is a bearer token held by a background browser task. Ordinary callers stay unchanged.
  async browser(op, body = {}, ownerToken = null) {
    if (!/^(navigate|snapshot|act|back|screenshot|status|record)$/.test(op)) return { ok: false, error: "unknown browser op" };
    const denied = this.#browserOwnerGate(op, ownerToken); if (denied) return denied;
    // Reserve the call before the first await, so a job cannot acquire ownership while Chrome is waking.
    const busyId = op === "status" ? null : this.#busyStart(ownerToken == null ? "browser" : "owner_browser");
    const counted = op !== "status"; if (counted) this.workOps = (this.workOps || 0) + 1;   // the live pane's status polls are not work
    this.browserInFlight = (this.browserInFlight || 0) + 1;
    if (ownerToken != null) this.ownerBrowserInFlight = (this.ownerBrowserInFlight || 0) + 1;
    this.put("last_activity", Date.now());
    try {
      const boot = await this.ensureRunning();
      // A human may take control, or the lease may expire, during a cold start.
      const changed = this.#browserOwnerGate(op, ownerToken, true); if (changed) return changed;
      this.inflight = (this.inflight || 0) + 1;
      try {
        const port = this.ctx.container.getTcpPort(6080);
        let r, last;
        for (let i = 0; i < 40; i++) {   // the service starts with the container; give it a moment on a cold wake
          // A failed connection waits before retrying. Ownership may change during that wait.
          const beforeSend = this.#browserOwnerGate(op, ownerToken, true); if (beforeSend) return beforeSend;
          try { r = await port.fetch(`http://browser/cdp/${op}`, { method: "POST", headers: { "content-type": "application/json", "x-1helm-controller": "1" }, body: JSON.stringify(this.env.BROWSER_WAIT === "quiet" ? { ...body, _wait: "quiet" } : body) }); break; }
          catch (e) { last = e; await sleep(250); }
        }
        if (!r) throw new Error(`browser service unavailable: ${last?.message}`);
        const out = await r.json();
        // The operation may have completed before a takeover or expiry. Report uncertainty; do not invite a replay.
        if (ownerToken != null) {
          const lost = this.#browserOwnerGate(op, ownerToken, true);
          if (lost) return { ...lost, operation_may_have_completed: true };
        }
        if (boot.cold) out.computer_woke_ms = boot.wake_ms;
        return out;
      } finally { this.inflight--; }
    } finally {
      if (busyId) this.#busyEnd(busyId);
      if (counted) { this.workOps--; this.opEnded = Date.now(); }
      this.browserInFlight--;
      if (ownerToken != null) this.ownerBrowserInFlight--;
      this.put("last_activity", Date.now());
    }
  }
  // Live view: WebSocket from the person's browser → VNC inside the computer. mode=view is a view-only VNC server;
  // mode=control needs the lease (one controller at a time; the resident's browser tools refuse while it's held).
  async liveView(req, mode) {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 426 });
    await this.ensureRunning();
    const port = this.ctx.container.getTcpPort(6080);
    let res, last;
    // Do not forward the person's browser Origin/Fetch Metadata to the local service.
    // The gateway has already checked their session and control lease here.
    const innerReq = new Request(`http://browser/vnc?mode=${mode === "control" ? "control" : "view"}`, { headers: { upgrade: "websocket", "x-1helm-controller": "1" } });
    for (let i = 0; i < 40; i++) { try { res = await port.fetch(innerReq); if (res.webSocket) break; } catch (e) { last = e; } await sleep(250); }
    if (!res?.webSocket) return new Response(`live view unavailable: ${last?.message || res?.status}`, { status: 502 });
    const inner = res.webSocket; inner.accept();
    const [client, server] = Object.values(new WebSocketPair()); server.accept();
    // An open pane alone never keeps the computer awake: only real input (presence pings, or mouse/keys in control mode) does.
    this.viewers = (this.viewers || 0) + 1; this.put("human_at", Date.now());
    this.live = this.live || new Set();
    let closed = false; const end = (code, why) => { if (closed) return; closed = true; this.live.delete(end); this.viewers--; if (!this.viewers) this.sql.exec("DELETE FROM kv WHERE k='hold_until'"); try { inner.close(); } catch {} try { code ? server.close(code, why) : server.close(); } catch {} };
    this.live.add(end);
    let lastIn = 0; const sawInput = (d) => {   // RFB client→server: 4 = KeyEvent, 5 = PointerEvent
      if (!(d instanceof ArrayBuffer) || !d.byteLength) return; const b = new Uint8Array(d)[0];
      if ((b === 4 || b === 5) && Date.now() - lastIn > 10e3) { lastIn = Date.now(); this.presence(); } };
    // VNC is binary. Frames can arrive as Blob; convert in order (a promise chain per direction) so bytes never reorder.
    const pipe = (to) => { let q = Promise.resolve(); return (e) => { const d = e.data; q = q.then(async () => { if (closed) return; to.send(typeof d === "string" || d instanceof ArrayBuffer ? d : await d.arrayBuffer()); }).catch(end); }; };
    inner.addEventListener("message", pipe(server));
    server.addEventListener("message", (e) => { sawInput(e.data); });
    server.addEventListener("message", pipe(inner));
    inner.addEventListener("close", end); server.addEventListener("close", end); inner.addEventListener("error", end); server.addEventListener("error", end);
    return new Response(null, { status: 101, webSocket: client });
  }
  // noVNC client files are baked into the image; serve them through the controller so the pane needs no third-party CDN.
  async novnc(rel) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(rel) || rel.includes("..")) return new Response("bad path", { status: 400 });
    await this.ensureRunning();
    const r = await this.ctx.container.getTcpPort(6080).fetch(`http://browser/novnc/${rel}`);
    return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/octet-stream", "cache-control": "public, max-age=3600" } });
  }
  // The resident calls this while one of its turns is in progress, so the computer (and the page open in its browser)
  // doesn't idle-stop during a long model step between tool calls.
  async touch() { if (this.ctx.container.running) this.put("last_activity", Date.now()); return { ok: true }; }
  async takeControl(who, ms = 10 * 60e3) {
    const cur = this.get("lease"), until = Number(this.get("lease_until") || 0);
    if (cur && cur !== who && until > Date.now()) return { ok: false, error: "someone else has control" };
    // A current operation can finish, but its background owner cannot start another one.
    this.sql.exec("DELETE FROM kv WHERE k IN ('browser_owner','browser_owner_until')");
    this.put("lease", who); this.put("lease_until", Date.now() + ms); this.put("last_activity", Date.now());
    return { ok: true, lease_until: Date.now() + ms };
  }
  // The person is actually using the pane (moved, clicked, scrolled or typed). Keeps it awake for PRESENCE_MS and renews their control.
  // holdMs: "Yes, don't ask for 30 min" keeps it awake that long with no movement (only while the pane stays open).
  async presence(holdMs = 0) {
    this.put("human_at", Date.now());
    if (holdMs > 0) this.put("hold_until", Date.now() + Math.min(holdMs, 30 * 60e3));
    if (this.get("lease") && Number(this.get("lease_until") || 0) > Date.now()) this.put("lease_until", Date.now() + 10 * 60e3);
    return this.sleepState();
  }
  presenceMs() { return Number(this.get("presence_ms") || PRESENCE_MS); }
  humanUntil() { return Math.max(Number(this.get("human_at") || 0) + this.presenceMs(), Number(this.get("hold_until") || 0)); }
  // Never wakes the computer. sleeps_in_ms: when it will sleep if nothing else happens (null = the helper is mid-command).
  // Typical cold wake for this computer: median of recent wakes, plus the restart gap if it only just stopped.
  wakeEst() {
    let w = []; try { w = JSON.parse(this.get("wake_hist") || "[]"); } catch {}
    const med = w.length ? [...w].sort((x, y) => x - y)[w.length >> 1] : 6e3;
    const gap = Math.max(0, Number(this.get("stopped_at") || 0) + RESTART_GAP_MS - Date.now());
    return Math.round(med + gap);
  }
  // What the app's computer button shows: lit while a browser step or a command (which also covers reading and writing computer files)
  // is running, for ACTIVITY_LINGER_MS after the last one ends (so a short step is still seen by a poll, and the dot doesn't blink between
  // two steps), and while the person has taken over the browser. Reads memory only: it never wakes the computer.
  async activity() {
    const now = Date.now(), until = Number(this.get("lease_until") || 0);
    return { busy: (this.workOps || 0) > 0 || now - (this.opEnded || 0) < ACTIVITY_LINGER_MS, controlled: !!this.get("lease") && until > now };
  }
  async sleepState() {
    const running = this.ctx.container.running && this.get("ready") === "1", now = Date.now();
    const work = Number(this.get("last_activity") || 0) + Number(this.get("idle_ms") || IDLE_MS);
    const human = this.viewers ? this.humanUntil() : 0;
    return { running, viewers: this.viewers || 0, busy: !!this.inflight, sleeps_in_ms: running && !this.inflight ? Math.max(0, Math.max(work, human) - now) : null,
      held_by: human > work ? "you" : "work", wake_est_ms: this.wakeEst(), last_stop: this.get("last_stop") || null, stopped_at: Number(this.get("stopped_at") || 0) || null };
  }
  // The id of this computer's current start, or "asleep" when it is not running. Reads memory only: it never wakes the computer.
  async bootId() { return this.ctx.container.running && this.get("ready") === "1" ? this.get("boot_id") || "unknown" : "asleep"; }
  // Files (Library / chat attachments): copy one R2 object into this computer, remove one, or read one out to R2.
  async putFile(path, key) {
    if (!/^files\/[^/]+$/.test(path)) return { ok: false, error: "bad path" };
    await this.ensureRunning(); this.put("last_activity", Date.now());
    const obj = await this.env.WS.get(key); if (!obj) return { ok: false, error: "missing in storage" };
    const p = await this.ctx.container.exec(["bash", "-c", 'mkdir -p /workspace/files && cat > "/workspace/$1"', "_", path], { stdin: obj.body, stderr: "combined" });
    const o = await p.output(); if (o.exitCode !== 0) return { ok: false, error: dec.decode(o.stdout).slice(0, 200) };
    this.put("dirty", "1"); this.put("save_due", Date.now() + SAVE_DEBOUNCE_MS); await this.armAlarm(Date.now() + SAVE_DEBOUNCE_MS);
    return { ok: true, bytes: obj.size };
  }
  // /workspace/files as the computer sees it now (files-saveback.js): { ok, out } with one "size mtime name" line per top-level file.
  async filesSnapshot() {
    try { await this.ensureRunning(); } catch (e) { return { ok: false, error: String(e?.message || e) }; }
    const r = await this.sh(SNAP_CMD, { timeoutMs: 15e3 });
    return r.code === 0 ? { ok: true, out: r.out } : { ok: false, error: String(r.out || "").slice(0, 200) };
  }
  async rmFile(path) {
    if (!/^files\/[^/]+$/.test(path)) return { ok: false, error: "bad path" };
    await this.ensureRunning(); this.put("last_activity", Date.now());
    const p = await this.ctx.container.exec(["rm", "-f", "--", `/workspace/${path}`], { stderr: "combined" });
    const o = await p.output(); if (o.exitCode !== 0) return { ok: false, error: `remove failed (exit ${o.exitCode})` };
    this.put("dirty", "1"); this.put("save_due", Date.now() + SAVE_DEBOUNCE_MS); await this.armAlarm(Date.now() + SAVE_DEBOUNCE_MS);
    return { ok: true };
  }
  async fileToR2(path, key, max, opts = {}) {
    return this.secureFileToR2(path, key, max, opts.expectedSize);
  }
  // Published pages: open every component relative to /workspace with O_NOFOLLOW,
  // then stream from that same descriptor. A file swapped to a link after the
  // manifest was listed cannot redirect the read outside this workspace.
  async secureFileToR2(path, key, max, expectedSize = null) {
    await this.ensureRunning(); this.put("last_activity", Date.now());
    const expected = Number.isSafeInteger(expectedSize) && expectedSize >= 0 ? expectedSize : -1;
    const p = await this.ctx.container.exec(["python3", "/opt/1hc/secure-file.py", String(path), String(max), String(expected)], { stderr: "ignore" });
    const reader = p.stdout.getReader(), prefix = [];
    let first = new Uint8Array(0), ended = false;
    const stop = async () => { try { p.kill(9); } catch {} try { await reader.cancel(); } catch {} };
    try {
      while (prefix.length <= 32) {
        const chunk = await reader.read();
        if (chunk.done) { ended = true; break; }
        const cut = chunk.value.indexOf(10);
        prefix.push(...chunk.value.slice(0, Math.min(cut < 0 ? chunk.value.length : cut, 33 - prefix.length)));
        if (cut >= 0) { first = chunk.value.slice(cut + 1); break; }
      }
    } catch { await stop(); return { ok: false, error: `couldn't read ${path}` }; }
    const rawSize = new TextDecoder().decode(Uint8Array.from(prefix));
    const size = Number(rawSize);
    if (ended || prefix.length > 32 || !/^(0|[1-9][0-9]*)$/.test(rawSize) || !Number.isSafeInteger(size) || size > max || (expected >= 0 && size !== expected)) {
      await stop(); return { ok: false, error: `couldn't read ${path}: it changed, is a link, or exceeds the page limit` };
    }
    const info = keyInfo(key);
    let rm; try { rm = info ? await room(this.env, info.tenant, size) : { ok: true }; }
    catch (e) { await stop(); throw e; }
    if (!rm.ok) { await stop(); await noteRefused(this.env, info.tenant, "file"); return { ok: false, storage_full: true, error: fullToolNote(rm).replace(/^error: /, "") }; }
    let pending = first;
    const body = new ReadableStream({
      async pull(ctl) {
        if (pending) { const chunk = pending; pending = null; if (chunk.length) { ctl.enqueue(chunk); return; } }
        const chunk = await reader.read();
        if (chunk.done) ctl.close(); else ctl.enqueue(chunk.value);
      },
      async cancel() { await stop(); },
    });
    try {
      await stPut(this.env, key, size ? body.pipeThrough(new FixedLengthStream(size)) : new Uint8Array(0), {}, { size });
      if (await p.exitCode) throw new Error("file read failed");
      return { ok: true, bytes: size };
    } catch {
      await stop(); await stDelete(this.env, [key]).catch(() => {});
      return { ok: false, error: `couldn't copy ${path}; the file changed while it was being read` };
    }
  }
  // One file's bytes, for an app action's file input (stage 4, composio-files.js): at most `max` bytes, a regular file under /workspace.
  async readFile(path, max) {
    await this.ensureRunning(); this.put("last_activity", Date.now());
    const fail = { ok: false, error: `couldn't read /workspace/${path}: it is a link, changed, or exceeds the file limit` };
    if (!Number.isSafeInteger(max) || max < 0) return fail;
    const p = await this.ctx.container.exec(["python3", "/opt/1hc/secure-file.py", String(path), String(max), "-1"], { stderr: "ignore" });
    let o; try { o = await p.output(); } catch { return fail; }
    if (o.exitCode !== 0) return fail;
    const out = new Uint8Array(o.stdout), newline = out.indexOf(10);
    if (newline < 1 || newline > 32) return fail;
    const rawSize = new TextDecoder().decode(out.subarray(0, newline)), size = Number(rawSize);
    if (!/^(0|[1-9][0-9]*)$/.test(rawSize) || !Number.isSafeInteger(size) || size > max || out.byteLength - newline - 1 !== size) return fail;
    return { ok: true, bytes: out.subarray(newline + 1) };
  }
  // Browser downloads (DOWNLOADS): wait up to ~10 s for downloads in progress (*.crdownload) to finish, then list the
  // finished ones, oldest first. Never wakes the computer; an asleep computer has nothing new.
  async listDownloads() {
    if (!this.ctx.container.running || this.get("ready") !== "1") return { done: [], partial: [] };
    const r = await this.sh(`cd '${DOWNLOADS}' 2>/dev/null || exit 0; for i in $(seq 1 40); do ls -- *.crdownload >/dev/null 2>&1 || break; sleep 0.25; done; `
      + `find . -maxdepth 1 -type f ! -name '.*' -printf '%T@\\t%s\\t%f\\n' | sort -n`, { timeoutMs: 20e3 });
    const done = [], partial = [];
    for (const l of r.out.split("\n")) { const m = l.match(/^[\d.]+\t(\d+)\t(.+)$/); if (!m) continue;
      if (/\.crdownload$/.test(m[2])) partial.push(m[2].replace(/\.crdownload$/, "")); else done.push({ name: m[2], bytes: Number(m[1]) }); }
    return { done, partial };
  }
  // Move one finished download out of DOWNLOADS so it's never collected twice. dir "files": to files/<to>, its Library
  // name; never overwrites (if <to> is taken the download copy is dropped, ok:false, and the file sync puts the Library copy
  // there). dir "workspace/downloads": too big for the Library, kept under the first free name.
  async takeDownload(name, to, dir = "files") {
    if (!/^[^/]+$/.test(name) || !/^[^/]+$/.test(to) || !/^(files|workspace\/downloads)$/.test(dir)) return { ok: false, error: "bad name" };
    const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const r = await this.sh(`set -- ${sq(name)} ${sq(to)} ${sq(dir)}; src="${DOWNLOADS}/$1"; t="$2"; mkdir -p "/workspace/$3"
if [ "$3" != files ]; then b="\${2%.*}"; e=".\${2##*.}"; [ "$b" = "$2" ] && e=""; i=2; while [ -e "/workspace/$3/$t" ] && [ $i -lt 100 ]; do t="$b ($i)$e"; i=$((i+1)); done; fi
if [ ! -e "/workspace/$3/$t" ] && mv -n -- "$src" "/workspace/$3/$t" && [ ! -e "$src" ]; then printf 'moved\\t%s\\n' "$t"; else [ "$3" = files ] && rm -f -- "$src"; echo kept; fi`, { timeoutMs: 10e3 });
    this.put("dirty", "1"); this.put("save_due", Date.now() + SAVE_DEBOUNCE_MS); await this.armAlarm(Date.now() + SAVE_DEBOUNCE_MS);
    const m = r.out.match(/moved\t(.+)/);
    return m ? { ok: true, path: `${dir}/${m[1].trim()}` } : { ok: false };
  }
  async releaseControl() { this.sql.exec("DELETE FROM kv WHERE k IN ('lease','lease_until','hold_until')"); return { ok: true }; }
  async leaseState() { const until = Number(this.get("lease_until") || 0); return { controlled: !!this.get("lease") && until > Date.now(), lease_until: until || null }; }
  // timeoutMs: this command's limit (the helper's run_command passes 4 min by default, up to 15 when the person asked for a long job).
  async exec(cmd, { save = "defer", tag = null, timeoutMs = EXEC_TIMEOUT_MS, run = null, outMax = 20000 } = {}) {   // outMax: how much of the END of the output comes back (read_file asks for more, up to the 200,000 the shell keeps)
    // A shell command can drive Chrome or send network traffic. Do not launch it while a
    // background browser job owns the shared computer, and reserve before the first await.
    if (this.#browserOwner() || this.ownerBrowserInFlight || this.#busyActive("owner_browser")) return { code: 1, out: "A background browser job is using this channel's computer. Wait for it to finish or take control of the browser.", browser_busy: true };
    const busyId = this.#busyStart("command");
    this.commandInFlight = (this.commandInFlight || 0) + 1; this.workOps = (this.workOps || 0) + 1;
    try {
    const lim = Math.max(5e3, Math.min(Number(timeoutMs) || EXEC_TIMEOUT_MS, EXEC_TIMEOUT_MS));
    if (!/^[0-9a-f-]{36}$/.test(String(tag))) tag = crypto.randomUUID();   // every command can be killed as a tree
    this.put("last_activity", Date.now());   // seen by an in-progress idle stop, which then cancels itself
    const boot = await this.ensureRunning();
    this.put("last_activity", Date.now());
    if (this.get("skills_v") !== SKILLS_VERSION && Date.now() - Number(this.get("skills_fail_at") || 0) > 10 * 60e3) await this.installSkills();   // deployed while this computer was up: refresh the skill scripts
    if (DECK_COMMAND.test(cmd) && Date.now() - Number(this.get("templates_fail_at") || 0) > 60e3) await this.installTemplates(cmd);   // the template a deck command uses, only on a computer that makes a deck
    await this.loadStandins();
    if (this.#browserOwner() || this.ownerBrowserInFlight || this.#busyActive("owner_browser")) return { code: 1, out: "A background browser job took control before this command started. No command was run.", browser_busy: true };
    const t0 = Date.now();
    this.inflight = (this.inflight || 0) + 1;
    let r;
    try { r = await this.sh(`mkdir -p /workspace/.home && cd /workspace && ${cmd}`, { timeoutMs: lim, tag, run }); }
    finally { this.inflight--; this.put("last_activity", Date.now()); }
    const ms = Date.now() - t0;
    this.put("last_activity", Date.now());
    let saved = null;
    if (save === "now") saved = await this.save("turn");
    else if (save === "defer") { this.put("dirty", "1"); this.put("save_due", Date.now() + SAVE_DEBOUNCE_MS); await this.armAlarm(Date.now() + SAVE_DEBOUNCE_MS); }
    const egress = this.sql.exec("SELECT host, method, status, verdict, why FROM egress WHERE at >= ? ORDER BY seq", t0 - 50).toArray();
    // A refused save (storage full): the helper hears about it once every 10 minutes at most, not on every command.
    let storage_note = this.storageNote(); if (storage_note && Date.now() - Number(this.get("storage_told") || 0) < 10 * 60e3) storage_note = null;
    if (storage_note) this.put("storage_told", Date.now());
    return { code: r.code, out: tailOutput(r.out, outMax), ms, boot, saved, egress, ...(r.timed_out ? { timed_out: true, limit_ms: lim } : {}), ...(storage_note ? { storage_note } : {}) };
    } finally { this.#busyEnd(busyId); this.commandInFlight--; this.workOps--; this.opEnded = Date.now(); }
  }
  // Skill scripts → /opt/1hc/skills/<slug>/scripts/ on the computer's own disk (outside /workspace: never saved into the channel's
  // layers, never counted as storage, rewritten after each start). One command, the files on stdin, swapped in whole. A failure is
  // logged and tried again before a command 10 minutes later (or at the next start); it never blocks the command itself.
  async installSkills() {
    if (!SKILL_SCRIPTS.length) { this.put("skills_v", SKILLS_VERSION); return { ok: true, files: 0 }; }
    let to;
    try {
      const run = (async () => (await this.ctx.container.exec(["node", "-e", SKILLS_INSTALL_JS, SKILLS_DIR], { stdin: new Response(skillsPayload()).body, stderr: "combined" })).output())();
      const o = await Promise.race([run, new Promise((_, rej) => { to = setTimeout(() => rej(new Error("timed out")), 20e3); })]);   // launch can hang too (see sh)
      const out = dec.decode(o.stdout).trim();
      if (o.exitCode !== 0 || !out.startsWith("ok ")) throw new Error(out.slice(-300) || `exit ${o.exitCode}`);
      this.put("skills_v", SKILLS_VERSION); return { ok: true, files: SKILL_SCRIPTS.length, version: SKILLS_VERSION };
    } catch (e) { this.put("skills_fail_at", Date.now()); this.log(`skill scripts not installed: ${String(e?.message || e).slice(0, 200)}`); return { ok: false, error: String(e?.message || e) }; }
    finally { clearTimeout(to); }
  }
  // The deck template a command uses (src/deck-templates.js: static assets, one template and its fonts at a time) -> TEMPLATES_DIR, only when
  // a deck command is about to run and only when this computer doesn't hold the template's current hash. The templates come from the command
  // itself (--template, --patterns) or from its project folder's .src/deck.json, unless the deck already has its own copy (.src/template). A failure is logged; the command then says the template is missing.
  async installTemplates(cmd) {
    let to;
    try {
      const refs = deckCommandRefs(cmd), names = new Set(refs.names);
      for (const P of refs.projects) {
        try {
          const o = await Promise.race([this.ctx.container.exec(["node", "-e", 'try{const fs=require("fs"),d=process.argv[1]+"/.src/",t=JSON.parse(fs.readFileSync(d+"deck.json","utf8")).template;if(/^[a-z0-9-]+$/.test(t)&&!fs.existsSync(d+"template/LICENSE"))console.log(t)}catch{}', P]).then((r) => r.output()), new Promise((_, rej) => { to = setTimeout(() => rej(new Error("timed out")), 10e3); })]);
          clearTimeout(to); const n = dec.decode(o.stdout).trim(); if (n) names.add(n);
        } catch { clearTimeout(to); }
      }
      let have = {}; try { have = JSON.parse(this.get("templates_have") || "{}"); } catch {}
      const mf = names.size ? await deckManifest(this.env) : null, sent = [];
      for (const name of names) {
        if (!mf.templates[name] || have[name] === mf.templates[name].hash) continue;
        const t = await deckTemplate(this.env, name), payload = JSON.stringify({ name, hash: t.hash, files: t.files });
        const run = (async () => (await this.ctx.container.exec(["node", "-e", TEMPLATE_INSTALL_JS, TEMPLATES_DIR], { stdin: new Response(payload).body, stderr: "combined" })).output())();
        const o = await Promise.race([run, new Promise((_, rej) => { to = setTimeout(() => rej(new Error("timed out")), 30e3); })]);
        clearTimeout(to);
        const out = dec.decode(o.stdout).trim();
        if (o.exitCode !== 0 || !out.startsWith("ok ")) throw new Error(out.slice(-300) || `exit ${o.exitCode}`);
        have[name] = t.hash; this.put("templates_have", JSON.stringify(have)); sent.push(name);
      }
      return { ok: true, installed: sent };
    } catch (e) { clearTimeout(to); this.put("templates_fail_at", Date.now()); this.log(`deck templates not installed: ${String(e?.message || e).slice(0, 200)}`); return { ok: false, error: String(e?.message || e) }; }
  }
  async save(reason) {
    if (!this.ctx.container.running || this.get("ready") !== "1") return { ok: true, skipped: true, reason: "asleep" };
    const t0 = Date.now(), r = await this.sh(`/opt/1hc/save.sh ${reason}`, { timeoutMs: 900e3 });
    let res; try { res = JSON.parse(r.out.trim().split("\n").pop()); } catch { res = { ok: false, error: r.out.slice(-300) }; }
    let refused = null; try { refused = JSON.parse(this.get("save_refused") || "null"); } catch {}
    if (!res.ok && refused && refused.at >= t0) res = { ok: false, storage_full: true, error: "storage is full; the previous save is kept" };   // storage.js
    return { ...res, total_ms: Date.now() - t0 };
  }
  // Never stop a computer someone is waiting for: a command that arrives while the stop is saving cancels the stop
  // (the container is still up and is reused). Only an explicit user sleep is not cancellable.
  async stop(reason, { cancellable = reason !== "user requested sleep" } = {}) {
    // An explicit sleep must not be undone by a background browser job's next action.
    if (reason === "user requested sleep") this.sql.exec("DELETE FROM kv WHERE k IN ('browser_owner','browser_owner_until')");
    if (cancellable && (this.inflight || Date.now() - Number(this.get("last_activity") || 0) < MIN_AWAKE_AFTER_CMD_MS)) {
      await this.armAlarm(Date.now() + MIN_AWAKE_AFTER_CMD_MS); return { stopped: false, deferred: true, reason };
    }
    const startedStop = Date.now(); this.put("stopping", "1");
    const saved = await this.save(reason);
    if (!saved?.ok) {
      this.put("stopping", "0"); this.log(`stop (${reason}) refused: save failed`);
      await this.armAlarm(Date.now() + 60e3);
      return { stopped: false, reason, saved };
    }
    if (cancellable && Math.max(Number(this.get("last_activity") || 0), this.viewers ? Number(this.get("human_at") || 0) : 0) > startedStop) {
      this.put("stopping", "0"); this.log(`stop (${reason}) cancelled: a command arrived`); await this.armAlarm(Date.now() + 30e3);
      return { stopped: false, cancelled: true, reason, saved };
    }
    this.put("ready", "0");
    if (this.ctx.container.running) {
      if ((this.get("stop_mode") || "destroy") === "graceful") {   // measured: graceful SIGTERM stop makes the next start 6.5–7.8 s; destroy keeps it ~1 s
        // Graceful: SIGTERM lets init exit 0 on its own (its save is a no-op now). destroy() is only the fallback.
        this.put("draining", "1"); this.ctx.container.signal(15);
        for (let i = 0; i < 60 && this.ctx.container.running; i++) await sleep(250);
        if (this.ctx.container.running) await this.ctx.container.destroy(reason);
        this.put("draining", "0");
      } else await this.ctx.container.destroy(reason);
    }
    this.put("stopping", "0"); this.put("stopped_at", Date.now()); this.put("last_stop", reason);
    this.sql.exec("DELETE FROM kv WHERE k IN ('lease','lease_until','hold_until')");
    for (const end of [...(this.live || [])]) end(4000, "asleep");   // tell open panes it slept, so they don't reconnect and wake it again
    const refund = await this.refundUnused();
    this.log(`stopped: ${reason}${refund ? `, refunded $${(refund / 1e9).toFixed(5)} unused prepaid time` : ""}`); return { stopped: true, reason, saved, refund_nano: refund };
  }
  async armAlarm(at) { const cur = await this.ctx.storage.getAlarm(); if (!cur || at < cur) await this.ctx.storage.setAlarm(at); }
  async alarm() {
    if (this.env.ENV_NAME === "selfhost" && this.env.BACKUP_MAINTENANCE === "1") { await this.ctx.storage.setAlarm(Date.now() + 60e3); return; }
    if (!this.ctx.container.running || this.get("ready") !== "1") return;
    const present = this.viewers && Date.now() < this.humanUntil();
    if (!this.inflight && !present && Date.now() - Number(this.get("last_activity") || 0) > Number(this.get("idle_ms") || IDLE_MS)) { await this.stop(this.viewers ? "idle (browser open, no activity)" : "idle"); return; }
    if (Number(this.get("paid_until") || 0) - Date.now() < 30e3 && !(await this.prepayMinute())) { await this.stop(this._payFail === "day_limit" ? "daily safety limit" : "out of credits"); return; }
    if (this.get("dirty") === "1" && Date.now() >= Number(this.get("save_due") || 0)) {
      const r = await this.save("debounce");
      if (r?.storage_full) this.put("save_due", Date.now() + 2 * 60e3);   // storage full: retry in 2 min, not every second (the person may add storage or delete files)
    }
    let next = Date.now() + 30e3; if (this.get("dirty") === "1") next = Math.min(next, Number(this.get("save_due")));
    await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }
  // TEST ONLY
  async setIdle(ms) { this.put("idle_ms", ms); return { idle_ms: ms }; }
  async setPresence(ms) { if (ms) this.put("presence_ms", ms); else this.sql.exec("DELETE FROM kv WHERE k='presence_ms'"); return { presence_ms: this.presenceMs() }; }
  async testSigterm() {
    if (!this.ctx.container.running) return { error: "not running" };
    const t0 = Date.now(); this.ctx.container.signal(15);
    for (let i = 0; i < 1800 && this.ctx.container.running; i++) await new Promise((z) => setTimeout(z, 250));
    return { exited: !this.ctx.container.running, ms: Date.now() - t0 };
  }
  async kill() { this.put("ready", "0"); if (this.ctx.container.running) await this.ctx.container.destroy("simulated host failure"); this.put("stopped_at", Date.now()); return { killed: true }; }
  async testIdleStop() { return await this.stop("idle"); }
  async setStopMode(m) { this.put("stop_mode", m); return { stop_mode: m }; }
  async setGap(ms) { if (ms < 0) this.sql.exec("DELETE FROM kv WHERE k='gap_override'"); else this.put("gap_override", ms); return { gap_ms: ms }; }
  async clearTestOverrides() { this.sql.exec("DELETE FROM kv WHERE k IN ('gap_override','stop_mode')"); return { ok: true }; }
  async snapshotPrepare() {
    if (this.env.ENV_NAME !== "selfhost" || this.env.BACKUP_MAINTENANCE !== "1") throw new Error("snapshot unavailable");
    if (this.inflight || this.viewers) throw new Error("computer is in use");
    if (!this.ctx.container) {
      if (this.get("ready") === "1" || this.get("dirty") === "1") throw new Error("computer binding unavailable during backup");
      return { ready: true };
    }
    const result = await this.stop("backup", { cancellable: false });
    if (!result.stopped || !result.saved?.ok) throw new Error("computer save did not complete");
    return { ready: true };
  }
  async status() {
    return { tenant: this.get("tenant"), channel: this.get("channel"), running: this.ctx.container.running, ready: this.get("ready") === "1", dirty: this.get("dirty") === "1",
      layers: this.stack().map((l) => ({ kind: l.kind, bytes: l.bytes, at: l.at })), all_layers: this.sql.exec("SELECT COUNT(*) n FROM layers").one().n,
      events: this.sql.exec("SELECT at,what FROM events ORDER BY seq DESC LIMIT 12").toArray() };
  }
}
// Channel deletion (deletion-do.js): wipe() and compactNext().
computerDeletionMix(ChannelComputer);
computerPreviewMix(ChannelComputer);   // officeToPdf: the file viewer's preview of a deck or document
installSnapshotRpc(ChannelComputer, "ChannelComputer", (self) => self.ctx.container?.running || self.inflight > 0 || self.viewers > 0);

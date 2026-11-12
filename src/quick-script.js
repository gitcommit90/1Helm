// quick_script: a short JavaScript program run in a Cloudflare Dynamic Worker (Worker Loader, binding LOADER) instead of waking the channel's
// container computer.
//
// What the script gets (the Dynamic Worker docs, usage/bindings and usage/egress-control):
//   - fetch(): every fetch() and connect() goes through QuickScriptHttp (globalOutbound), which refuses private, internal and 1Helm hosts, checks every redirect
//     hop again, adds no header of any kind (no secret or vault value exists in the Dynamic Worker), and caps the size of what comes back.
//   - lib: a custom binding (QuickScriptLib) for the channel's Library. It calls back into this channel's Resident, so a write goes through appFileSave
//     (stPut with the storage check, a new version when the name exists) and a read is only a Library file, never the container's /workspace.
//   - console.log, returned as part of the result.
// The Dynamic Worker has no other binding. Its code is the person's script text, loaded with get() and an id made from the workspace and a hash of the
// script, so the same script run again the same day is one Dynamic Worker, not a new one (pricing page: "use .get() with a stable ID").
import { WorkerEntrypoint } from "cloudflare:workers";
import { publicUrlCheck, APP_FILE_BUFFER_MAX } from "./ee/index.js";   // the public seam; the SSRF check is a pure function, so it works without ONEHELM_EE
import { humanBytes, mimeOf } from "./files.js";

// ---- limits ----
// Custom resource limits page: "You can set limits for the maximum CPU time and number of subrequests per invocation. If a Dynamic Worker reaches either
// limit, it immediately throws an exception." (WorkerCode.limits = { cpuMs, subRequests }.)
export const QS_CPU_MS = 5000;                 // CPU time of one run (the Workers default is far higher; a few seconds is plenty for text, JSON and math)
export const QS_SUBREQUESTS = 50;              // fetch() calls and RPC calls to lib, together
export const QS_WALL_MS = 30_000;              // one run, start to finish (waiting on fetch counts here but not as CPU)
export const QS_FETCH_MS = 20_000;             // one fetch()
export const QS_FETCH_MAX = 10 * 1024 * 1024;  // one fetched body
export const QS_SCRIPT_MAX = 50_000;           // characters of script
export const QS_OUT_MAX = 20_000;              // characters returned to the model, like run_command's output
export const QS_LIB_FILES = 20;                // lib calls that write, per run
export const QS_LIB_BYTES = APP_FILE_BUFFER_MAX;      // bytes written (and, separately, read) per run
export const QS_RATE = { perMin: 20, parallel: 3 };   // per channel
export const QS_VERSION = "1";                 // part of the Dynamic Worker id: bump it when WRAPPER below changes

// ---- billing (nano dollars, cost + 15% like the computer) ----
// Pricing page: requests "+$0.30 per million requests", CPU time "+$0.02 per million CPU milliseconds", and "+$0.002 per Dynamic Worker per day" for each
// unique Dynamic Worker (worker id and code). The included amounts (10 million requests, 30 million CPU ms, 1,000 Dynamic Workers a month) belong to the whole
// Cloudflare account. Requests and CPU are charged to the person at list price + 15% (the included amounts are not subtracted, like the computer's prepaid rate).
// The creation fee passes through only real cost. Pricing page: "1,000 unique Dynamic Workers per month" are included, then
// "+$0.002 per Dynamic Worker per day". The account-wide count of creations for the UTC calendar month is kept in D1 (table logo_usage, key dynworkers:YYYY-MM, one atomic
// increment per creation, shared by every tenant; the table is the existing k/n counter of src/logo.js). While the month's count is 1,000 or less the person is not charged the
// fee; the 1,001st creation and each later one is charged $0.002 + 15% to the person whose run caused it. The pricing page says "billing period" without giving its dates, so the
// calendar month is the best match. A creation is the first run of a Worker id + code that day (tracked in the Resident). Each run's log line has created, creation_count and
// creation_charged; the daily cf-usage-check is where an alert for the count would go (not built). If the counter can't be read, no fee is charged and the log line says so.
export const QS_MARKUP = 1.15;
export const QS_NANO_PER_REQUEST = 300;        // $0.30 / 1e6 = 3e-7 dollars
export const QS_NANO_PER_CPU_MS = 20;          // $0.02 / 1e6 = 2e-8 dollars
export const QS_NANO_PER_CREATE = 2_000_000;   // $0.002 per unique Dynamic Worker per day, charged (+15%) only beyond the month's included creations
export const QS_INCLUDED_CREATIONS = 1000;     // per month, account-wide (pricing page)
export const creationMonth = (ms) => new Date(ms).toISOString().slice(0, 7);
// Requests: the one fetch() into the Dynamic Worker, and each lib call (an RPC call to a stub is billed like one). cpuMs: CPU time is not returned to the caller
// (only a Tail Worker sees it), so the charge uses the wall time of the run, capped at the CPU limit. Wall time is never less than CPU time, so it is an upper bound.
export const quickScriptNano = ({ cpuMs = 0, requests = 1, created = false } = {}) =>
  Math.ceil((requests * QS_NANO_PER_REQUEST + Math.max(0, Math.min(cpuMs, QS_CPU_MS)) * QS_NANO_PER_CPU_MS + (created ? QS_NANO_PER_CREATE : 0)) * QS_MARKUP);
// One more creation this UTC month, account-wide → the month's count including this one, or null when the counter can't be used.
export async function countCreation(env, at) {
  try { const r = await env.DB.prepare("INSERT INTO logo_usage (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n").bind(`dynworkers:${creationMonth(at)}`).first(); return Number(r?.n) || null; }
  catch (e) { console.log("quick_script creation count", String(e?.message || e).slice(0, 120)); return null; }
}
export const quickScriptMaxNano = () => quickScriptNano({ cpuMs: QS_CPU_MS, requests: 1 + QS_LIB_FILES + 30, created: true });

// Why the script is part of the Dynamic Worker's code and not data passed to a fixed runner (checked 2026-11-08): inside a Dynamic Worker, eval, new Function, the
// AsyncFunction constructor and import() of a data: URL all fail ("Code generation from strings disallowed for this context"; tested in workerd with wrangler dev),
// the docs describe no way around it, and Cloudflare's own DynamicWorkerExecutor (@cloudflare/codemode) also puts the code into the module and calls load() per run.
// The pricing page counts a Dynamic Worker by "Worker ID and code", so a new script is a new creation. Only a creation beyond the month's included 1,000 is billed.

// ---- the outbound gate ----
// Hosts a script never reaches: 1Helm's own (this environment's app and gateway hosts, the 1helm.com names, the names the container's Sentinel intercepts) and
// anything the public-address check refuses (private and internal addresses, single-label names, .internal, .local, localhost and so on).
const OWN = /(^|\.)(1helm\.com|computer\.internal|sentinel\.internal|vault\.internal)$/;
export function egressCheck(raw, env = {}) {
  let x; try { x = new URL(String(raw || "").trim()); } catch { return { error: "that isn't a valid address" }; }
  if (x.protocol !== "https:" && x.protocol !== "http:") return { error: "only http and https addresses can be fetched" };
  const h = x.hostname.toLowerCase().replace(/\.$/, "");
  const own = [env.GATEWAY_HOST, env.APP_HOST].map((v) => String(v || "").toLowerCase().replace(/:\d+$/, "")).filter(Boolean);
  if (OWN.test(h) || own.includes(h) || own.some((o) => h.endsWith("." + o))) return { error: "that is one of 1Helm's own addresses, which a script can't reach" };
  if (x.port && !["80", "443", "8080", "8443"].includes(x.port)) return { error: "only ports 80, 443, 8080 and 8443 are fetched" };
  const base = new URL(x.toString()); base.protocol = "https:"; base.port = "";   // reuse the https check for the host rules (user:password, private IPs, internal names)
  const c = publicUrlCheck(base.toString()); if (c.error) return { error: c.error };
  return { ok: true, url: x.toString() };
}

// The outbound gateway (globalOutbound). Props: { tenant, channel }. Redirects are followed here, one hop at a time, each checked again.
export class QuickScriptHttp extends WorkerEntrypoint {
  async fetch(request) {
    let url = request.url, method = request.method, body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    if (body && body.byteLength > 5 * 1024 * 1024) return new Response("quick_script: the request body is over 5 MB", { status: 413 });
    const headers = new Headers(request.headers);
    for (const h of [...headers.keys()]) if (/^(cf-|x-forwarded|x-real-ip)/i.test(h)) headers.delete(h);
    for (let hop = 0; hop < 5; hop++) {
      const c = egressCheck(url, this.env); if (c.error) return new Response(`quick_script: ${c.error}`, { status: 403 });
      let r; try { r = await fetch(c.url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(QS_FETCH_MS) }); }
      catch (e) { return new Response(`quick_script: the request failed (${String(e?.message || e).slice(0, 120)})`, { status: 502 }); }
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
        url = new URL(r.headers.get("location"), c.url).toString();
        if (r.status === 303 || ((r.status === 301 || r.status === 302) && method === "POST")) { method = "GET"; body = undefined; }
        continue;
      }
      const buf = await readCapped(r, QS_FETCH_MAX);
      if (!buf) return new Response(`quick_script: the response is over ${humanBytes(QS_FETCH_MAX)}`, { status: 502 });
      const out = new Headers(r.headers); out.delete("content-encoding"); out.delete("content-length");
      return new Response(buf, { status: r.status, statusText: r.statusText, headers: out });
    }
    return new Response("quick_script: too many redirects", { status: 502 });
  }
}
// The whole body, or null when it is longer than max.
export async function readCapped(r, max) {
  if (!r.body) return new Uint8Array(0);
  const reader = r.body.getReader(), parts = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.byteLength; if (n > max) { try { await reader.cancel(); } catch {} return null; } parts.push(value); }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

// The Library binding (env.LIB in the Dynamic Worker). Props: { tenant, channel }. Each call names the run (runId, passed by the wrapper); the channel's
// Resident accepts it only while that run is open, and enforces the per-run caps. Binary data crosses as Uint8Array.
export class QuickScriptLib extends WorkerEntrypoint {
  #r() { return this.env.RESIDENT.get(this.env.RESIDENT.idFromName(`res:${this.ctx.props.tenant}:${this.ctx.props.channel}`)); }
  list(runId) { return this.#r().quickLib(String(runId), "list", {}); }
  read(runId, ref) { return this.#r().quickLib(String(runId), "read", { ref: String(ref ?? "") }); }
  write(runId, name, data, mime) { return this.#r().quickLib(String(runId), "write", { name: String(name ?? ""), data, mime: mime == null ? "" : String(mime) }); }
}

// The Resident's side of lib. runs: Map of open runs ({ ctx, wrote, bytesWritten, bytesRead }).
export async function quickLibOp(res, runId, op, a) {
  const run = res._qsRuns?.get(runId); if (!run) throw new Error("quick_script: this run has ended");
  const { files } = deps(res); run.calls = (run.calls || 0) + 1;   // each lib call is one more request on the bill
  if (op === "list") return files.list().map((f) => ({ id: f.id, name: f.name, mime: f.mime, bytes: f.bytes }));
  if (op === "read") {
    const f = files.find(a.ref); if (!f) throw new Error(`quick_script: there's no "${String(a.ref).slice(0, 120)}" in this channel's Library (a script reads Library files only, not the computer's files)`);
    if (f.bytes > APP_FILE_BUFFER_MAX) throw new Error(`quick_script: "${f.name}" is ${humanBytes(f.bytes)}; a script can read at most ${humanBytes(APP_FILE_BUFFER_MAX)} per file`);
    if (run.bytesRead + f.bytes > QS_LIB_BYTES) throw new Error(`quick_script: a run can read at most ${humanBytes(QS_LIB_BYTES)} of files`);
    const bytes = await files.bytes(f); if (!bytes) throw new Error(`quick_script: "${f.name}" is missing from storage`);
    run.bytesRead += bytes.byteLength;
    return { id: f.id, name: f.name, mime: f.mime, bytes };
  }
  if (op === "write") {
    const name = String(a.name || "").trim(); if (!name) throw new Error("quick_script: lib.write needs a file name");
    let bytes = a.data;
    if (typeof bytes === "string") bytes = new TextEncoder().encode(bytes);
    else if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    else if (!(bytes instanceof Uint8Array)) throw new Error("quick_script: lib.write takes a string, a Uint8Array or an ArrayBuffer");
    if (run.wrote >= QS_LIB_FILES) throw new Error(`quick_script: a run can write at most ${QS_LIB_FILES} files`);
    if (bytes.byteLength > APP_FILE_BUFFER_MAX || run.bytesWritten + bytes.byteLength > QS_LIB_BYTES) throw new Error(`quick_script: a run can write at most ${humanBytes(QS_LIB_BYTES)}`);
    const r = await files.save({ name, mime: a.mime || files.mimeOf(name), bytes }, run.ctx);
    if (r.error) throw new Error(`quick_script: ${String(r.error).replace(/^error: /, "")}`);   // storage full: storage.js's note
    run.wrote++; run.bytesWritten += bytes.byteLength;
    return { id: r.file.id, name: r.file.name, mime: r.file.mime, bytes: bytes.byteLength, updated: !!r.file.updated };
  }
  throw new Error("quick_script: unknown lib call");
}

// ---- the Dynamic Worker's code ----
// user.js holds the person's script as the body of an async function with (lib, console) in scope; main.js runs it. The script's own text can't reach main.js's
// variables or env: it is a separate module that receives only lib and console.
const WRAPPER = `import run from "./user.js";
const LOGMAX = 20000, OUTMAX = 100000;
const show = (v) => { if (typeof v === "string") return v; try { return JSON.stringify(v, (k, x) => typeof x === "bigint" ? String(x) : x instanceof Uint8Array ? "[Uint8Array " + x.byteLength + "]" : x); } catch { return String(v); } };
export default {
  async fetch(request, env) {
    const { runId, deadline } = await request.json();
    let logs = "", logCut = false;
    const log = (...a) => { const line = a.map(show).join(" ") + "\\n"; if (logs.length + line.length > LOGMAX) { logCut = true; return; } logs += line; };
    const con = { log, info: log, warn: log, error: log, debug: log };
    const realFetch = globalThis.__qsFetch || (globalThis.__qsFetch = globalThis.fetch.bind(globalThis));
    globalThis.fetch = (...a) => Date.now() > deadline ? Promise.reject(new Error("quick_script: the time limit passed")) : realFetch(...a);
    const lib = {
      list: () => env.LIB.list(runId),
      read: (ref) => env.LIB.read(runId, ref),
      readText: async (ref) => new TextDecoder().decode((await env.LIB.read(runId, ref)).bytes),
      write: (name, data, mime) => env.LIB.write(runId, name, data, mime),
    };
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("quick_script: the time limit passed")), Math.max(1, deadline - Date.now())); });
    try {
      const v = await Promise.race([run(lib, con), timeout]);
      let out = v === undefined ? "" : show(v), cut = false;
      if (out.length > OUTMAX) { out = out.slice(0, OUTMAX); cut = true; }
      return Response.json({ ok: true, json: typeof v !== "string" && v !== undefined, out, cut, logs, logCut });
    } catch (e) {
      return Response.json({ ok: false, error: String((e && e.stack) || e).slice(0, 2000), logs, logCut });
    } finally { clearTimeout(timer); }
  },
};
`;
export const userModule = (script) => `export default async function run(lib, console) {\n${script}\n}\n`;
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
// The Dynamic Worker's id: the workspace (its lib binding and gateway are scoped to it, and a cached isolate keeps them), the wrapper version and the script.
export const codeId = async (tenant, channel, script) => `qs${QS_VERSION}:${tenant}:${channel}:${(await sha(script)).slice(0, 32)}`;

// What a Resident gives this module, in one place (tests give their own).
function deps(res) {
  return res._qsDeps || (res._qsDeps = {
    files: {
      list: () => res.sql.exec("SELECT id,name,mime,bytes FROM files WHERE deleted=0 AND pending=0 ORDER BY at DESC LIMIT 200").toArray(),
      find: (ref) => res.libFile(ref),
      bytes: async (f) => { const o = await res.env.WS.get(f.r2key); return o ? new Uint8Array(await o.arrayBuffer()) : null; },
      save: (f, ctx) => res.appFileSave(f, ctx),
      mimeOf,
    },
  });
}

// ---- the tool ----
export const QUICK_SCRIPT_TOOL = { type: "function", function: { name: "quick_script",
  description: "Run a short JavaScript program in a small sandbox that starts instantly, without starting this channel's computer. Use it to fetch pages and APIs, reshape JSON, CSV or text, do math and dates, and read or write files in the channel's Library. The script is the body of an async function: use await, fetch(url, options) for the public internet (no private or 1Helm addresses, and no saved keys), console.log, and lib to reach the Library (lib.list(), lib.read(nameOrId) gives {name, mime, bytes}, lib.readText(nameOrId), lib.write(name, stringOrUint8Array) saves or replaces a Library file). Return the result with return (text or JSON). It does NOT see the computer's /workspace files, has no Python, shell or installed programs, and is stopped after 5 seconds of CPU time or 30 seconds in all. Use run_command on the computer instead for Python libraries, ffmpeg, documents and PDFs, git, the browser, files that live on the computer, and long jobs.",
  parameters: { type: "object", properties: { script: { type: "string", description: "JavaScript, the body of an async function. End with return <result>." } }, required: ["script"] } } };

const errLine = (s) => `error: ${s}`;
export const LIMIT_RE = /exceeded (?:its )?(?:cpu|CPU)|cpu time limit|CPU limit|Worker exceeded/i;

// Runs one script. res: the Resident (env, ctx.exports, get/put, ledger(), libFile, appFileSave); tc: the turn's context; d: extra dependencies for tests and the byok pieces.
export async function quickScriptTool(res, a, tc = null, d = {}) {
  const script = typeof a?.script === "string" ? a.script : "";
  if (!script.trim()) return errLine("script is required: the JavaScript to run (the body of an async function; end with return <result>).");
  if (script.length > QS_SCRIPT_MAX) return errLine(`the script is ${script.length} characters; the most is ${QS_SCRIPT_MAX}. Split it, or use run_command on the computer.`);
  if (!res.env.LOADER) return errLine("the quick script sandbox isn't available here. Use run_command on the computer.");
  const now = d.now || Date.now, tenant = res.get("tenant"), channel = res.get("channel");
  // rate: per channel
  const st = res._qs || (res._qs = { times: [], active: 0 }), t0 = now();
  st.times = st.times.filter((t) => t0 - t < 60_000);
  if (st.active >= QS_RATE.parallel) return errLine(`too many scripts are running at once in this channel (${QS_RATE.parallel} at a time). Wait for one to finish.`);
  if (st.times.length >= QS_RATE.perMin) return errLine(`too many scripts in the last minute (${QS_RATE.perMin} per channel). Wait a little, or do the rest in one script.`);
  st.times.push(t0); st.active++;
  const runId = crypto.randomUUID(), rid = `quick-script:${runId}`, led = (d.ledger || (() => res.ledger()))();
  let held = false, nano = 0, ok = false, kind = "", bytesOut = 0, wall = 0, requests = 1, created = false, creationCount = null, charged = false;
  try {
    // billing: reserve the most one run can cost, settle at the real amount (like web_search); the same for BYOK accounts, as the computer is
    const id = await codeId(tenant, channel, script), day = new Date(t0).toISOString().slice(0, 10), seenKey = `qs_seen:${id}`;
    created = res.get(seenKey) !== day;
    const most = quickScriptMaxNano();
    const r = await led.reserve(rid, most);
    if (!r.ok) { kind = "credits"; if (res.env.BYOK && d.creditsErr) { if (tc) tc.creditsOut = true; return d.creditsErr; } return errLine(r.reason === "day_limit" ? "the daily safety limit is reached, so the script didn't run." : "out of credits for the script sandbox. Add credits to continue."); }
    held = true;
    res._qsRuns ||= new Map(); res._qsRuns.set(runId, { ctx: tc || {}, wrote: 0, bytesWritten: 0, bytesRead: 0 });
    const props = { tenant, channel };
    const exp = d.exports || res.ctx.exports;
    const stub = res.env.LOADER.get(id, async () => ({
      compatibilityDate: "2026-09-01",
      mainModule: "main.js",
      modules: { "main.js": WRAPPER, "user.js": userModule(script) },
      env: { LIB: exp.QuickScriptLib({ props }) },
      globalOutbound: exp.QuickScriptHttp({ props }),
      limits: { cpuMs: QS_CPU_MS, subRequests: QS_SUBREQUESTS },
    }));
    res.put(seenKey, day);
    if (created) creationCount = await (d.countCreation || countCreation)(res.env, t0);   // the account-wide count for the month, after this creation
    const WALL = d.wallMs || QS_WALL_MS, deadline = now() + WALL;
    let timer, reply;
    try {
      const call = stub.getEntrypoint().fetch(new Request("https://quick-script.invalid/run", { method: "POST", body: JSON.stringify({ runId, deadline }) }));
      const stop = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("wall"), { wall: true })), WALL + 2000); });
      const resp = await Promise.race([call, stop]);
      reply = await resp.json();
    } finally { clearTimeout(timer); }
    wall = now() - t0;
    requests = 1 + (res._qsRuns.get(runId)?.calls || 0);
    if (!reply.ok) {
      kind = /time limit passed/.test(reply.error) ? "wall" : LIMIT_RE.test(reply.error) ? "cpu" : "script";
      ok = false;
      const note = kind === "wall" ? `the script ran longer than ${QS_WALL_MS / 1000} seconds and was stopped.` : kind === "cpu" ? `the script used more than ${QS_CPU_MS / 1000} seconds of CPU time and was stopped.` : `the script threw: ${reply.error}`;
      return errLine(note) + logsPart(reply);
    }
    ok = true;
    let out = reply.out || "", cut = reply.cut;
    if (out.length > QS_OUT_MAX) { out = out.slice(0, QS_OUT_MAX); cut = true; }
    bytesOut = out.length;
    return (out || (reply.logs ? "" : "(the script returned nothing)")) + (cut ? `\n[result cut to the first ${QS_OUT_MAX} characters; return less, or save it with lib.write and tell the person]` : "") + logsPart(reply);
  } catch (e) {
    wall = now() - t0;
    if (e?.wall) { kind = "wall"; return errLine(`the script ran longer than ${QS_WALL_MS / 1000} seconds and was stopped.`); }
    kind = kind || "failed";
    const m = String(e?.message || e);
    if (LIMIT_RE.test(m)) { kind = "cpu"; return errLine(`the script used more than ${QS_CPU_MS / 1000} seconds of CPU time and was stopped.`); }
    return errLine(`the script couldn't run (${m.slice(0, 300)}).`);
  } finally {
    st.active--; res._qsRuns?.delete(runId);
    if (held) {
      // CPU is billed from wall time, capped at the CPU limit (see quickScriptNano); a run that hit the CPU limit is billed the whole limit.
      charged = created && creationCount != null && creationCount > QS_INCLUDED_CREATIONS;
      nano = quickScriptNano({ cpuMs: kind === "cpu" ? QS_CPU_MS : wall, requests, created: charged });
      try { await led.settle(rid, nano); if (tc) tc.extraCharge = (tc.extraCharge || 0) + nano; } catch (e) { console.log("quick_script settle", String(e?.message || e).slice(0, 120)); }
    }
    // one line per run, like the computer's: no script text and no output
    console.log("quick_script", JSON.stringify({ channel, cpu_ms_billed: held ? (kind === "cpu" ? QS_CPU_MS : Math.min(wall, QS_CPU_MS)) : 0, wall_ms: wall, bytes_out: bytesOut, created, creation_count: creationCount, creation_charged: charged, ok, error: ok ? "" : kind || "failed", nano }));
  }
}
const logsPart = (r) => r.logs ? `\n[console]\n${r.logs.trimEnd()}${r.logCut ? "\n[console output cut]" : ""}` : "";

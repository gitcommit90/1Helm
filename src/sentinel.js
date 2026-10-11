// Sentinel: the only way out of a channel computer. Every HTTP(S) request the container makes is intercepted here,
// OUTSIDE the VM (Workers runtime), before it reaches the internet. Modeled on Meta Muse's Sentinel (2026-09-08).
//   1. Stand-in tokens: the computer receives stand-ins ("1hs_…"). The real key is swapped in here, and only
//      when the request goes to a host that key is bound to. A stand-in sent anywhere else stays a useless stand-in.
//      Echoed raw/URL-encoded keys in upstream responses are replaced before the computer sees them.
//   2. Approvals: a request that sends data (POST/PUT/PATCH/DELETE) waits for the person's decision in the app,
//      unless Always Approve is on (thread → channel → global) or a grant covers it. The model cannot approve.
//   3. Traffic log: which hosts answered during each command, so the resident can label that output untrusted.
//   Which requests go out on their own (reads, 1Helm's storage, git clone, npm audit, a web page's background traffic) and which
//   ask: egress-policy.js.
import { WorkerEntrypoint } from "cloudflare:workers";
import { linkFetch } from "./channel-computer.js";
import { egressRule, lfsOperation, blockedText, LFS_BATCH, SAFE_METHODS as SAFE } from "./egress-policy.js";
import { boundedText, BodyTooLargeError } from "./bounded-body.js";

export const STANDIN_RE = /1hs_[A-Za-z0-9]{32}/g;
const hostMatch = (host, pats) => pats.some((p) => p === host || (p.startsWith("*.") && (host === p.slice(2) || host.endsWith(p.slice(1)))));
const encoder = new TextEncoder();

// A key's own API can echo it in Location, another header, or a streaming body. Do not hand that
// echo back to the computer. This covers literal and URL-encoded echoes; a service that transforms
// a key in some other way still needs to be trusted by the person who bound the key to that host.
function hideEchoedKeys(res, keys) {
  const replacements = [];
  for (const { real, standin } of keys) {
    const encoded = encodeURIComponent(real);
    for (const value of new Set([real, encoded, encoded.replace(/%[0-9A-F]{2}/g, (s) => s.toLowerCase())])) {
      if (value) replacements.push({ needle: encoder.encode(value), value, standin, standinBytes: encoder.encode(standin) });
    }
  }
  replacements.sort((a, b) => b.needle.length - a.needle.length);
  const scrub = (value) => replacements.reduce((clean, p) => clean.split(p.value).join(p.standin), value);
  const headers = new Headers();
  for (const [name, value] of res.headers) headers.append(scrub(name), scrub(value));
  // The body may change length. Validators, digests, and an upstream byte count would then be false.
  for (const name of ["content-length", "content-range", "accept-ranges", "etag", "content-md5", "digest"]) headers.delete(name);
  if (!res.body) return new Response(null, { status: res.status, statusText: scrub(res.statusText), headers });
  const keep = Math.max(0, ...replacements.map((p) => p.needle.length - 1));
  let pending = new Uint8Array(0);
  const write = (data, end, controller) => {
    const out = [];
    let i = 0;
    while (i < (end ? data.length : Math.max(0, data.length - keep))) {
      const hit = replacements.find(({ needle }) => needle[0] === data[i] && needle.length <= data.length - i && needle.every((b, j) => b === data[i + j]));
      if (hit) { out.push(...hit.standinBytes); i += hit.needle.length; }
      else out.push(data[i++]);
    }
    if (out.length) controller.enqueue(Uint8Array.from(out));
    pending = data.slice(i);
  };
  const body = res.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      const data = new Uint8Array(pending.length + chunk.length);
      data.set(pending); data.set(chunk, pending.length);
      write(data, false, controller);
    },
    flush(controller) { write(pending, true, controller); },
  }));
  return new Response(body, { status: res.status, statusText: scrub(res.statusText), headers });
}

// AES-GCM with the platform VAULT_KEY (32 bytes, base64). Values are stored encrypted; only this layer decrypts.
async function vaultKey(env) { return crypto.subtle.importKey("raw", Uint8Array.from(atob(env.VAULT_KEY), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt", "decrypt"]); }
export async function sealSecret(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await vaultKey(env), new TextEncoder().encode(plain)));
  return btoa(String.fromCharCode(...iv)) + "." + btoa(String.fromCharCode(...ct));
}
async function openSecret(env, sealed) {
  const [iv, ct] = sealed.split(".").map((s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await vaultKey(env), ct));
}
export function newStandin() { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", b = crypto.getRandomValues(new Uint8Array(32)); return "1hs_" + [...b].map((x) => a[x % 62]).join(""); }

export class Sentinel extends WorkerEntrypoint {
  async fetch(req) {
    const t0 = Date.now(), u = new URL(req.url), host = u.hostname.toLowerCase(), method = req.method.toUpperCase();
    // The computer's own controller link (layers, saves) is not internet traffic.
    if (host === "computer.internal") return linkFetch(this.env, this.ctx.props.id, req);
    // Even reads can carry private data in paths, queries or custom headers.
    // Reject every non-HTTPS internet request before lookup, approval or forwarding;
    // never follow a plaintext redirect or rely on recognizing credential names.
    // The controller RPC above is a runtime binding, not an internet destination.
    if (u.protocol !== 'https:') return new Response('1Helm requires HTTPS for all external requests. Nothing was sent. Use the HTTPS address.', {
      status: 403, headers: { 'x-1helm-sentinel': 'blocked', 'content-type': 'text/plain' },
    });
    const C = this.env.CHANNEL_COMPUTER.get(this.env.CHANNEL_COMPUTER.idFromString(this.ctx.props.id));
    // tenant/channel ride in the props the computer set at start (one DO round trip less per request); older starts ask.
    const who = this.ctx.props.tenant && this.ctx.props.channel ? { tenant: this.ctx.props.tenant, channel: this.ctx.props.channel } : await C.who();
    // Our own storage endpoint (layer downloads at wake) passes straight through: presigned, read-only, this channel only.
    if (this.env.R2_ENDPOINT && host === new URL(this.env.R2_ENDPOINT).host && SAFE.has(method)) return fetch(new Request(req, { redirect: "manual" }));
    const R = this.env.RESIDENT.get(this.env.RESIDENT.idFromName(`res:${who.tenant}:${who.channel}`));

    // 1. Stand-in → real key, only for the key's own hosts.
    const headers = new Headers(req.headers); let url = u.toString(); const swapped = [], refused = [], secrets = [];
    const found = new Set([...(url.match(STANDIN_RE) || [])]);
    for (const [, v] of headers) for (const m of v.match(STANDIN_RE) || []) found.add(m);
    if (found.size) {
      const rows = (await this.env.DB.prepare(`SELECT name, standin, hosts, sealed FROM vault WHERE tenant_id=? AND standin IN (${[...found].map(() => "?").join(",")})`).bind(who.tenant, ...found).all()).results || [];
      for (const r of rows) {
        if (!hostMatch(host, JSON.parse(r.hosts))) { refused.push(r.name); continue; }
        const real = await openSecret(this.env, r.sealed);
        for (const [k, v] of [...headers]) if (v.includes(r.standin)) headers.set(k, v.split(r.standin).join(real));
        url = url.split(r.standin).join(encodeURIComponent(real)); swapped.push(r.name); secrets.push({ real, standin: r.standin });
      }
    }

    // 2. Anything that sends data needs approval (or an Always Approve / grant that covers it), unless an automatic rule decides
    //    (egress-policy.js). A request carrying a saved key never goes out on an automatic rule.
    let body = SAFE.has(method) ? undefined : req.body, lfsOp = null;
    const bytes = Number(req.headers.get("content-length") || 0), path = u.pathname.slice(0, 200);
    if (!SAFE.has(method) && LFS_BATCH.test(u.pathname) && bytes > 0 && bytes <= 65536) {
      try { const t = await boundedText(req, 65536); body = t; lfsOp = lfsOperation(t); }
      catch (e) {
        const large = e instanceof BodyTooLargeError;
        const status = large ? 413 : 400;
        await C.noteEgress({ at: t0, host, method, status, verdict: "deny", why: large ? "Git LFS batch body too large" : "invalid Git LFS batch body", keys: swapped, refused, ms: Date.now() - t0 }).catch(() => {});
        return new Response(large ? "Git LFS batch body too large" : "Invalid Git LFS batch body", { status });
      }
    }
    let decision = egressRule({ host, method, path: u.pathname, headers: req.headers, keys: swapped, env: this.env, lfsOp });
    if (decision.verdict === "ask") decision = await R.egressDecision({ host, method, path, bytes, keys: swapped, via: decision.via });
    const log = (status, extra = {}) => C.noteEgress({ at: t0, host, method, status, verdict: decision.verdict, why: decision.why, keys: swapped, refused, ms: Date.now() - t0, ...extra }).catch(() => {});
    if (decision.verdict !== "allow") {
      await log(403);
      return new Response(blockedText({ method, host, path, ...decision }), { status: 403, headers: { "x-1helm-sentinel": decision.quiet ? "skipped" : "blocked", "content-type": "text/plain" } });
    }
    // An encoded response cannot be byte-scanned safely. Ask the upstream for identity bytes.
    if (secrets.length) headers.set("accept-encoding", "identity");
    let res;
    try { res = await fetch(new Request(url, { method, headers, body, redirect: "manual" })); }
    catch { await log(502); return new Response("upstream request failed", { status: 502 }); }
    if (secrets.length && res.headers.get("content-encoding") && res.headers.get("content-encoding") !== "identity") {
      await log(502);
      return new Response("upstream response encoding not supported for saved keys", { status: 502 });
    }
    await log(res.status);
    return secrets.length ? hideEchoedKeys(res, secrets) : res;
  }
}
export { openSecret };

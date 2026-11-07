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
import { rewriteRequest, trimKey, readCapped, bodyKind, BODY_SCAN_MAX, STANDIN_RE } from "./sentinel-swap.js";
import { hideEchoedKeys, basicEchoPairs, encodedResponse } from "./sentinel-scrub.js";
import { boundedText, BodyTooLargeError } from "./bounded-body.js";
import { egressRule, lfsOperation, blockedText, LFS_BATCH, SAFE_METHODS as SAFE } from "./egress-policy.js";

export { STANDIN_RE };
const encoder = new TextEncoder();

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

    // 1. Stand-in → real key, only for the key's own hosts (URL, headers, Basic credentials, request bodies up to BODY_SCAN_MAX, re-signing of
    //    OAuth 1.0a and AWS SigV4 requests): all in sentinel-swap.js.
    const tid = who.tenant, qm = (n) => Array(n).fill("?").join(",");
    let body = SAFE.has(method) ? undefined : req.body, bodyBytes = null;
    const declared = req.headers.get("content-length"), kind = bodyKind(req.headers), aws = /^AWS4-HMAC-SHA256\s/.test(req.headers.get("authorization") || "");
    if (body && (kind || aws) && !(declared != null && Number(declared) > BODY_SCAN_MAX)) {
      const r = await readCapped(body); if (r.bytes) { bodyBytes = r.bytes; body = r.bytes; } else body = r.stream;
    }
    // Every real value opened for this request, including secrets used only to sign: an echo service can return those too.
    const secrets = [];
    const rw = await rewriteRequest({ host, method, url: u.toString(), headers: req.headers, bodyBytes,
      lookup: async (ids) => (await this.env.DB.prepare(`SELECT name, standin, hosts, sealed FROM vault WHERE tenant_id=? AND standin IN (${qm(ids.length)})`).bind(tid, ...ids).all()).results || [],
      lookupHostKeys: async () => (await this.env.DB.prepare("SELECT name, standin, hosts, sealed FROM vault WHERE tenant_id=?").bind(tid).all()).results || [],
      open: async (r) => { const real = await openSecret(this.env, r.sealed); secrets.push({ real, standin: r.standin }); const t = trimKey(real); if (t && t !== real) secrets.push({ real: t, standin: r.standin }); return real; } });
    const headers = rw.headers, url = rw.url, swapped = rw.swapped, refused = rw.refused;
    if (rw.bodyBytes) body = rw.bodyBytes;
    if (secrets.length) secrets.push(...basicEchoPairs(req.headers, headers));

    // 2. Anything that sends data needs approval (or an Always Approve / grant that covers it), unless an automatic rule decides
    //    (egress-policy.js). A request carrying a saved key never goes out on an automatic rule.
    let lfsOp = null;
    const bytes = rw.bodyBytes ? rw.bodyBytes.length : Number(req.headers.get("content-length") || 0), path = u.pathname.slice(0, 200);
    if (!SAFE.has(method) && LFS_BATCH.test(u.pathname) && bytes > 0 && bytes <= 65536) {
      try { const t = rw.bodyBytes ? new TextDecoder().decode(rw.bodyBytes) : await boundedText(req, 65536); if (!rw.bodyBytes) body = t; lfsOp = lfsOperation(t); }
      catch (e) {
        const large = e instanceof BodyTooLargeError, status = large ? 413 : 400;
        await C.noteEgress({ at: t0, host, method, status, verdict: "deny", why: large ? "Git LFS batch body too large" : "invalid Git LFS batch body", keys: swapped, refused, ms: Date.now() - t0 }).catch(() => {});
        return new Response(large ? "Git LFS batch body too large" : "Invalid Git LFS batch body", { status });
      }
    }
    let decision = egressRule({ host, method, path: u.pathname, headers: req.headers, keys: swapped, env: this.env, lfsOp });
    if (decision.verdict === "ask") decision = await R.egressDecision({ host, method, path, bytes, keys: swapped, via: decision.via, page: decision.page });
    const log = (status, extra = {}) => C.noteEgress({ at: t0, host, method, status, verdict: decision.verdict, why: decision.why, keys: swapped, refused, ms: Date.now() - t0, ...extra }).catch(() => {});
    if (decision.verdict !== "allow") {
      await log(403);
      return new Response(blockedText({ method, host, path, ...decision }), { status: 403, headers: { "x-1helm-sentinel": decision.quiet ? "skipped" : "blocked", "content-type": "text/plain" } });
    }
    // An encoded response cannot be byte-scanned safely, so ask the upstream for identity bytes when keys were swapped.
    if (secrets.length) headers.set("accept-encoding", "identity");
    let res;
    try { res = await fetch(new Request(url, { method, headers, body, redirect: "manual" })); }
    catch (e) { await log(502, { error: String(e.message || e).slice(0, 200) }); return new Response(`upstream error: ${e.message}`, { status: 502 }); }
    if (secrets.length && encodedResponse(res)) { await log(502); return new Response("upstream response encoding not supported for saved keys", { status: 502 }); }
    await log(res.status);
    // A real key can come back in an echo (headers, Location, body). The computer gets the stand-in instead. A 101 upgrade has no body to scan.
    return secrets.length && res.status !== 101 ? hideEchoedKeys(res, secrets) : res;
  }
}
export { openSecret };

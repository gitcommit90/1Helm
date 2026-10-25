// Sentinel's automatic rules (Captain 10-09: "Sentinel ON"): which requests from a channel computer go out without the person's tap.
// Ordinary requested sends run directly. Payment/API-key operations and vault-key use
// retain Resident.egressDecision (Always Approve → scoped grants → approval card).
//
// Measured on dev 10-09 (Sentinel on, one channel, no model): pip, apt, curl GET and the image skill only read; `npm install` POSTs its
// audit to registry.npmjs.org, `git clone` POSTs git-upload-pack to github.com, and four ordinary page loads in the browser
// (bbc.com, google.com/travel/flights, kayak.com) made ~70 POSTs to 17 hosts (the sites' own search/XHR calls, ad and analytics
// beacons). Without these rules every one of them would have been a card or a 2-minute hold.
//
//   allow  · reads: GET / HEAD / OPTIONS (as before)
//          · 1Helm's own storage endpoint (R2): presigned URLs only work for what 1Helm signed
//          · git fetch/clone over https (POST …/git-upload-pack) and Git LFS downloads (POST …/info/lfs/objects/batch, operation "download")
//          · npm / yarn audit (POST /-/npm/v1/security/… on the npm registry): the package list, read-only
//          · a web page's own background traffic in the browser (fetch/XHR, beacons, pings): Chrome's fetch metadata says it isn't a
//            navigation the page's user started
//   ask    · explicit payment/API-key operation paths, except a read (GET/HEAD/OPTIONS) the browser page makes itself in the background with no saved
//            key, e.g. a site's own credentials-abc.js script file (a navigation or a command's key read still asks) (a page's own background payment request asks only while a purchase is in
//            progress; Resident.egressDecision drops it quietly otherwise: nothing was bought by the person or the helper)
//          · ANY request carrying a saved key (a stand-in was swapped in): a real key never goes out on an automatic rule
//   deny   · 1Helm itself (the computer may never click its own approvals)
//          · dev-tool telemetry (Next.js, Astro, Gatsby), Chrome's own background services (GCM, updates, Safe Browsing) and the
//            browser's own reports (Reporting API / NEL, CSP, Expect-CT): quietly, with no card
//
// Security note (for review): the browser rule reads headers the computer could forge (Sec-Fetch-*). That is a usability rule, not a
// boundary: anything in the computer can already drive its own Chrome (CDP on 127.0.0.1) to send a real background request. What stays
// a hard boundary: Sentinel substitutes keys only for their bound hosts, and a request carrying a substituted key never goes out on
// an automatic rule; requests to 1Helm itself are refused; and the person's Allow/Deny is never decided inside the computer.
// An upstream that receives a key can echo or transform it. Sentinel scrubs literal echoes from its response, but host binding
// still requires trusting that upstream and is not a general guarantee that the computer can never learn the key.

import { protectedRequest, keyRequest, moneyRequest, financeHost } from "./approval-scope.js";
export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Dedicated telemetry endpoints of dev tools that run on the computer (next build, astro, gatsby). Never worth a card.
export const TELEMETRY_HOSTS = new Set(["telemetry.nextjs.org", "telemetry.astro.build", "telemetry.gatsbyjs.com"]);
// Chrome's own background services (no web page behind them: GCM/push registration, component updates, Safe Browsing, autofill
// hints). Seen on dev 10-09: a POST to android.clients.google.com while Google Flights loaded. Not the person's data; never a card.
export const CHROME_SERVICE_HOSTS = new Set(["android.clients.google.com", "clients2.google.com", "clients4.google.com", "clientservices.googleapis.com",
  "update.googleapis.com", "safebrowsing.googleapis.com", "optimizationguide-pa.googleapis.com", "content-autofill.googleapis.com", "chromewebstore.googleapis.com"]);
// Reports the browser itself sends about a page (Reporting API / Network Error Logging, CSP violations, Expect-CT): not the person's
// data and not something a page user did. Seen on dev 10-09 (APP_V 159): POST w3-reporting-nel.reddit.com/reports
// (application/reports+json, no fetch metadata) became a card while kayak.com loaded. Dropped quietly, never a card.
export const REPORT_TYPES = new Set(["application/reports+json", "application/csp-report", "application/expect-ct-report+json"]);
// Known report collectors, for a report sent without its content type: reddit's w3-reporting*, Cloudflare's a.nel.cloudflare.com,
// Google's csp.withgoogle.com, any host whose first label is nel / *-nel.
export const REPORT_HOST = /^(w3-reporting[a-z0-9-]*|[a-z0-9-]*-nel|nel|[a-z0-9]\.nel)\.|^csp\.withgoogle\.com$|^(?:[a-z0-9-]+\.)*report-uri\.com$/;
const NPM_REGISTRIES = new Set(["registry.npmjs.org", "registry.yarnpkg.com"]);
export const LFS_BATCH = /\/info\/lfs\/objects\/batch$/;

const hdr = (headers, k) => { const v = headers?.get ? headers.get(k) : headers?.[k]; return v == null ? "" : String(v).toLowerCase(); };
const hostOf = (u) => { try { return new URL(String(u)).host.toLowerCase(); } catch { return ""; } };

// Who sent it, in plain words for the card: "form" (a browser form submit), "page" (a page's background request), "command".
export function egressVia(headers) {
  const mode = hdr(headers, "sec-fetch-mode");
  if (!mode) return "command";
  return mode === "navigate" || mode === "nested-navigate" ? "form" : "page";
}

// The site a web page's request came from (its Origin or Referer header), as a bare host, or "". Chrome sends these on page requests.
export function pageSiteOf(headers) {
  for (const k of ["origin", "referer"]) { const h = hostOf(hdr(headers, k)); if (h) return h.replace(/:\d+$/, ""); }
  return "";
}
const registrable = (h) => { h = String(h || "").toLowerCase().replace(/:\d+$/, ""); const p = h.split("."); return p.length > 2 ? p.slice(/^(co|com|org|net|gov|ac)$/.test(p.at(-2)) && p.at(-1).length === 2 ? -3 : -2).join(".") : h; };
// Names a person recognizes for hosts a page often calls in the background (the Captain 10-25: a card for grok.com while editing x.com).
const SITE_NAMES = { "grok.com": "Grok", "x.com": "X", "twitter.com": "X", "x.ai": "xAI", "stripe.com": "Stripe", "paypal.com": "PayPal" };
// The words a permission card uses for a destination: "Grok (from x.com)" for a page's request to another site, else the host itself.
export function approvalLabel({ host, page = "" } = {}) {
  const h = registrable(host), from = registrable(page), name = SITE_NAMES[h];
  const base = name ? `${name} (${h})` : String(host || "");
  return from && from !== h ? `${base}, asked by the ${from} page` : base;
}

// → { verdict: "allow" | "deny", why, rule, quiet? } when a rule decides, or { verdict: "ask", why, via } for the person's decision.
// lfsOp: the "operation" of a Git LFS batch request (the Sentinel reads that small JSON body only for that one path).
export function egressRule({ host, method, path = "/", headers, keys = [], env = {}, lfsOp = null }) {
  host = String(host || "").toLowerCase(); method = String(method || "").toUpperCase(); path = String(path || "/");
  // Native transport never uses an agent-controlled HTTP CONNECT proxy. Keep
  // existing browser WebSocket/Upgrade behavior: application relays inside
  // permitted HTTP(S) are outside the explicitly accepted direct-SSH boundary.
  if (env.NATIVE_NETWORK === 'on' && method === 'CONNECT')
    return { verdict: 'deny', why: 'opaque network tunnels require the native connection gate', rule: 'direct-tunnel' };
  if ([env.GATEWAY_HOST, env.APP_HOST].some((h) => h && host === String(h).toLowerCase()))
    return { verdict: "deny", why: "requests to 1Helm itself are not allowed from the computer", rule: "self" };
  const via = egressVia(headers), page = via === "page" ? pageSiteOf(headers) : "";
  // Vault key use retains the existing once/task/always approval scope, including GET.
  // Connector-managed authentication is not routed here and does not create a fresh key approval.
  if (keys.length) return { verdict: "ask", why: `uses a saved key (${keys.join(", ")})`, via, page };
  // A payment-looking request that a page sends in the background is only asked about while a purchase is in progress in the channel
  // (Resident.egressDecision decides: otherwise it is dropped quietly). Key operations and commands always ask.
  // A third-party widget on the page calling its own service (a bot check, an upsell) with a key-looking word in its path is the page's
  // traffic, not the person's key: no saved key rides it (that asks above), so it goes on to the page rule. A key path on the page's own
  // site, a command's key operation, and anything that also looks like a payment keep asking.
  // A payment company's host is never a widget: its calls (card tokenization, payment methods) are money requests from a page.
  const finance = financeHost(host) && via === "page" && !SAFE_METHODS.has(method);
  const widget = via === "page" && page && registrable(page) !== registrable(host) && keyRequest(path, host) && !moneyRequest(method, path, host) && !financeHost(host);
  // A read the browser page makes itself (GET/HEAD/OPTIONS via "page" only) with no saved key is not a key
  // operation even when its path has a key word (X's own credentials-abc.js script bundle): it is a plain read. A navigation (via "form", the helper
  // opening a URL), a command's key read (curl .../api_keys) and anything that sends data still ask.
  const pageRead = via === "page" && SAFE_METHODS.has(method);
  if (finance || !widget && !pageRead && protectedRequest(method, path, host)) return { verdict: "ask", why: "payment or API-key operation", via, page };
  if (SAFE_METHODS.has(method)) return { verdict: "allow", why: "read-only request", rule: "read" };
  if (env.R2_ENDPOINT && host === hostOf(env.R2_ENDPOINT)) return { verdict: "allow", why: "1Helm storage (presigned)", rule: "own-storage" };
  if (TELEMETRY_HOSTS.has(host)) return { verdict: "deny", why: "dev-tool telemetry (not sent)", rule: "telemetry", quiet: true };
  // Chrome's own services: measured on dev, they DO carry fetch metadata (they showed as "web page background request"), so by host.
  if (CHROME_SERVICE_HOSTS.has(host)) return { verdict: "deny", why: "the browser's own background service (not sent)", rule: "chrome-service", quiet: true };
  if (SAFE_METHODS.has(method)) return { verdict: "allow", why: "read-only request", rule: "read" };
  if (env.R2_ENDPOINT && host === hostOf(env.R2_ENDPOINT)) return { verdict: "allow", why: "1Helm storage (presigned)", rule: "own-storage" };
  const ctype = hdr(headers, "content-type").split(";")[0].trim();
  if (method === "POST" && via !== "form" && (REPORT_TYPES.has(ctype) || REPORT_HOST.test(host)))
    return { verdict: "deny", why: "the browser's own error/security report (not sent)", rule: "browser-report", quiet: true };
  if (method === "POST" && /\/git-upload-pack$/.test(path) && hdr(headers, "content-type") === "application/x-git-upload-pack-request")
    return { verdict: "allow", why: "git fetch / clone (read-only)", rule: "git-read" };
  if (method === "POST" && LFS_BATCH.test(path) && lfsOp === "download") return { verdict: "allow", why: "Git LFS download (read-only)", rule: "git-read" };
  if (method === "POST" && NPM_REGISTRIES.has(host) && path.startsWith("/-/npm/v1/security/")) return { verdict: "allow", why: "npm audit (package list only)", rule: "npm-audit" };
  // Ordinary browser forms and page background requests do not need a second approval.
  if (via === "page") return { verdict: "allow", why: "web page background request", rule: "browser-page" };
  if (via === "form") {
    if (hdr(headers, "sec-fetch-user") === "?1") return { verdict: "allow", why: "ordinary browser form", rule: "task-action", via };
    return { verdict: "allow", why: "page redirect (no click)", rule: "browser-redirect" };
  }
  return { verdict: "allow", why: "ordinary task request", rule: "task-action", via };
}

// A Git LFS batch body → its operation ("download" | "upload" | null). Only small JSON bodies are read.
export function lfsOperation(text) {
  try { const j = JSON.parse(String(text || "")); return typeof j?.operation === "string" ? j.operation : null; } catch { return null; }
}

// The text a blocked command (or page) gets back, in plain words, by why it was stopped.
export function blockedText({ method, host, path, why, verdict, quiet }) {
  const what = `${method} ${host}${String(path || "").slice(0, 120)}`;
  if (quiet) return `1Helm Sentinel did not send ${what}: ${why}.\n`;
  if (/^requests to 1Helm itself/.test(why)) return `1Helm Sentinel blocked ${what}: ${why}.\n`;
  if (/the person denied it/.test(why)) return `1Helm Sentinel blocked ${what}: the person said no to sending this. Nothing was sent. Do not retry it or send it another way; tell them it wasn't sent.\n`;
  return `1Helm Sentinel held ${what}: it sends data and needs the person's OK (${why}). Nothing was sent. Do not retry it in a loop. Tell the person what you were trying to send and why; they can allow it in the app.\n`;
}

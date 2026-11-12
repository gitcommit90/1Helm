// Sentinel's rules for the requests it sees. The channel computer has direct internet, and
// Sentinel only sits on the hosts that saved keys are allowed for, plus 1Helm's own hosts (channel-computer.js interceptTargets), so a real
// saved key never sits inside the computer. Everything else leaves the computer directly and is neither checked nor logged.
//   ask    . a request carrying a saved key to a site that is not on the key's list (key-use.js): Resident.egressDecision (Always Approve, then scoped
//            grants, then an approval card). A key on one of its approved sites goes out with no card (changed 2026-11-10, keysreal).
//   deny   . 1Helm itself (the computer may never call its own approval routes through Sentinel), and CONNECT tunnels when native
//            network permissions are on.
//   allow  . every other request to an intercepted host, because it carries no saved key.
// Before 2026-11-07 every request went through here, and payment-looking requests a page made on its own were dropped or asked about.
// That refused a sign-in to a payment company's dashboard (POST dashboard.stripe.com/ajax/sessions/new, 403), so the rules for payment and
// key-looking paths are gone: with no saved key on a request there is nothing to protect.

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Dedicated telemetry endpoints of dev tools that run on the computer (next build, astro, gatsby). Never worth a card.
export const TELEMETRY_HOSTS = new Set(["telemetry.nextjs.org", "telemetry.astro.build", "telemetry.gatsbyjs.com"]);
// Chrome's own background services (no web page behind them: GCM/push registration, component updates, Safe Browsing, autofill
// hints). Seen in testing: a POST to android.clients.google.com while Google Flights loaded. Not the person's data; never a card.
export const CHROME_SERVICE_HOSTS = new Set(["android.clients.google.com", "clients2.google.com", "clients4.google.com", "clientservices.googleapis.com",
  "update.googleapis.com", "safebrowsing.googleapis.com", "optimizationguide-pa.googleapis.com", "content-autofill.googleapis.com", "chromewebstore.googleapis.com"]);
// Reports the browser itself sends about a page (Reporting API / Network Error Logging, CSP violations, Expect-CT): not the person's
// data and not something a page user did. Seen in testing: POST w3-reporting-nel.reddit.com/reports
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
// Names a person recognizes for hosts a page often calls in the background.
const SITE_NAMES = { "grok.com": "Grok", "x.com": "X", "twitter.com": "X", "x.ai": "xAI", "stripe.com": "Stripe", "paypal.com": "PayPal" };
// The words a permission card uses for a destination: "Grok (from x.com)" for a page's request to another site, else the host itself.
export function approvalLabel({ host, page = "" } = {}) {
  const h = registrable(host), from = registrable(page), name = SITE_NAMES[h];
  const base = name ? `${name} (${h})` : String(host || "");
  return from && from !== h ? `${base}, asked by the ${from} page` : base;
}

// → { verdict: "allow" | "deny", why, rule, quiet? } when a rule decides, or { verdict: "ask", why, via } for the person's decision.
// lfsOp: the "operation" of a Git LFS batch request (the Sentinel reads that small JSON body only for that one path).
export function egressRule({ host, method, path = "/", headers, keys = [], env = {}, lfsOp = null, hold = null }) {
  host = String(host || "").toLowerCase(); method = String(method || "").toUpperCase(); path = String(path || "/");
  // Native transport never uses an agent-controlled HTTP CONNECT proxy. Keep
  // existing browser WebSocket/Upgrade behavior: application relays inside
  // permitted HTTP(S) are outside the explicitly accepted direct-SSH boundary.
  if (env.NATIVE_NETWORK === 'on' && method === 'CONNECT')
    return { verdict: 'deny', why: 'opaque network tunnels require the native connection gate', rule: 'direct-tunnel' };
  if ([env.GATEWAY_HOST, env.APP_HOST].some((h) => h && host === String(h).toLowerCase()))
    return { verdict: "deny", why: "requests to 1Helm itself are not allowed from the computer", rule: "self" };
  const via = egressVia(headers), page = via === "page" ? pageSiteOf(headers) : "";
  // Sentinel only sees the hosts that saved keys are allowed for (and 1Helm's own hosts): the computer's other traffic leaves directly
  // and never reaches this function. A request that carries a saved key (a stand-in was swapped in) keeps the existing once/task/always
  // approval scope, including GET. Connector-managed authentication is not routed here and does not create a fresh key approval.
  // The approval lock (key-use.js): a request that carries a saved key to a site that is not on that key's list waits for the person. A key on a site
  // it is approved for goes out with no card (the person approved that site in Passwords & keys, or with Always allow on an earlier card).
  if (hold) return { verdict: "ask", why: hold.unreadable ? "its body can't be read and might include a saved key" : `uses a saved key (${hold.labels.join(", ")}) on a site it isn't approved for`, via, page };
  if (keys.length) return { verdict: "allow", why: `saved key on its approved site (${keys.join(", ")})`, rule: "key-approved-site", via };
  // No saved key is on the request, so nothing private can leave through it: it goes out, whatever the method, path or payment company.
  return { verdict: "allow", why: "no saved key on the request", rule: "no-key", via };
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
  return `1Helm Sentinel held ${what}: it sends data and needs the person's OK (${why}). Nothing was sent. The request waits in the app, and you are told when the person decides. Do not retry it in a loop; carry on with the rest of the task.\n`;
}

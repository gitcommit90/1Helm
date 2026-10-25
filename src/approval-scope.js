// Captain 2026-10-10: ordinary requested work does not require a second confirmation.
// Keep explicit payment and API-key operations behind the existing server-checked gate.
// Inspect operation identifiers, not document/email prose ("pay the rent" in a note is not a payment).
const READ = /^(GET|LIST|SEARCH|FETCH|RETRIEVE|READ|FIND|LOOKUP|PREVIEW|VALIDATE|CALCULATE|ESTIMATE|CHECK)(_|$)/;
const MONEY = /(^|_)(PAY|PAYMENT|PAYMENTS|PAYMENT_INTENT|PAYMENT_INTENTS|CHARGE|CHARGES|PURCHASE|PURCHASES|CHECKOUT|PAYOUT|PAYOUTS|REFUND|REFUNDS|WITHDRAW|WITHDRAWAL|WITHDRAWALS)(_|$)/;
const FINANCE = /(^|[._/-])(stripe|paypal|wise|adyen|braintree|square|razorpay)([._/-]|$)/i;
const FINANCIAL_ONLY = /(^|_)(TRANSFER|TRANSFERS|SUBSCRIPTION|SUBSCRIPTIONS|ORDER|ORDERS|INVOICE|INVOICES)(_|$)/;
const KEYS = /(^|_)(API_KEY|API_KEYS|APIKEY|APIKEYS|ACCESS_KEY|ACCESS_KEYS|SECRET_KEY|SECRET_KEYS|ACCESS_TOKEN|ACCESS_TOKENS|API_TOKEN|API_TOKENS|CREDENTIAL|CREDENTIALS)(_|$)/;
const words = (s) => String(s || "").replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[^a-z0-9]+/gi, "_").toUpperCase();

export function protectedAppAction(slug, args = {}, depth = 0) {
  const s = words(slug);
  // Match the action, not an API_KEY suffix on an integration's authentication name.
  const match = s.match(/(?:^|_)((?:GET|LIST|SEARCH|FETCH|RETRIEVE|READ|FIND|LOOKUP|PREVIEW|VALIDATE|CALCULATE|ESTIMATE|CHECK|CREATE|UPDATE|DELETE|REMOVE|REVOKE|ROTATE|GENERATE|SEND|MAKE|PAY|CAPTURE|REFUND|EXECUTE|RUN|TRANSFER|CANCEL|CONFIRM|AUTHORIZE|ISSUE|REVEAL|EXPORT|SHOW)(?:_|$).*)/);
  const operation = match?.[1] || s.slice(s.indexOf("_") + 1);
  if (KEYS.test(operation)) return true;
  if (/^CLOUDFLARE_/.test(s) && /(^|_)(TOKEN|TOKENS)(_|$)/.test(operation)) return true;
  if (!READ.test(operation) && (MONEY.test(operation) || FINANCE.test(String(slug)) && FINANCIAL_ONLY.test(operation))) return true;
  if (depth >= 8) return true; // bounded inspection; an excessively nested execution batch is not classified as ordinary
  // Structured batches inherit their contained actions; never inspect free-form prose as authority.
  const calls = args.tools || args.actions || args.requests;
  return Array.isArray(calls) && calls.some((c) => c && typeof c === "object" &&
    (protectedAppAction(c.tool_slug || c.action || c.name, c.arguments || c.args || {}, depth + 1) ||
      (c.path || c.endpoint || c.url) && protectedRequest(c.method, c.path || c.endpoint || c.url)));
}

function requestParts(path, service) {
  let pathname = String(path || "").split(/[?#]/)[0];
  try { const u = new URL(String(path)); pathname = u.pathname; service ||= u.hostname; } catch {}
  try { pathname = decodeURIComponent(pathname); } catch {}
  return { pathname, service, p: words(pathname) };
}
// A payment company's own host (stripe, paypal, adyen...), by name.
export const financeHost = (service) => FINANCE.test(String(service || ""));
// An API-key or token operation by its path (any method; also reading keys).
export function keyRequest(path, service = "") {
  const { pathname, service: sv, p } = requestParts(path, service);
  return KEYS.test(p) || /(^|[.])cloudflare(?:[.]com)?$/i.test(sv) && /\/(?:user|accounts\/[^/]+)\/tokens(?:\/|$)/i.test(pathname);
}
// A payment operation by its path: a request that sends data to a payment path or a payment company.
export function moneyRequest(method, path, service = "") {
  const { service: sv, p } = requestParts(path, service);
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase()) && (MONEY.test(p) || FINANCE.test(sv) && FINANCIAL_ONLY.test(p));
}
export function protectedRequest(method, path, service = "") {
  return keyRequest(path, service) || moneyRequest(method, path, service);
}

export function needsActionConfirm(spec = {}) {
  const p = spec.payload || {};
  if (spec.tool === "app_run") return protectedAppAction(p.action, p.arguments);
  if (spec.tool === "app_proxy") {
    let path = p.endpoint || p.path || "";
    try { path = new URL(path).pathname; } catch {}
    return protectedRequest(p.method, path, p.app);
  }
  return false;
}

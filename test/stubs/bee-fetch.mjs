// A fake Bee API for tests: installs a fetch that answers requests to Bee's public endpoint with handle(method, path, token, body)
// → {status, body?, retry_ms?} (a string body is sent as is, anything else as JSON), or {status: 0, error} for a network failure.
// Every request is recorded in SEEN as {method, path, token, url}. Other URLs go to the fetch that was installed before. Also stops retries from waiting.
import { API_ROOT, beeTiming } from "../../src/ee/bee-api.js";

export function installBeeFetch(handle) {
  const prev = globalThis.fetch, SEEN = [], shim = { handle, SEEN, prev, off: null };
  beeTiming.sleep = async () => {};
  globalThis.fetch = async (u, init = {}) => {
    const url = typeof u === "string" ? u : u.url;
    if (!url.startsWith(API_ROOT + "/")) return prev(u, init);
    const path = url.slice(API_ROOT.length), token = String(init.headers?.authorization || "").replace(/^Bearer /, ""), method = init.method || "GET";
    SEEN.push({ method, path, token, url });
    const r = await shim.handle(method, path, token, init.body ? JSON.parse(init.body) : null);
    if (!r || r.status === 0) throw Object.assign(new Error(r?.error || "network"), { cause: { code: r?.error } });
    return new Response([204, 205, 304].includes(r.status) ? null : typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), { status: r.status, headers: r.retry_ms != null ? { "retry-after": String(r.retry_ms / 1000) } : {} });
  };
  shim.off = () => { globalThis.fetch = prev; };
  return shim;
}

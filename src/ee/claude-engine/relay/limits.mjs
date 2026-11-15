// The rate limit headers worth keeping from Anthropic's answer to a model call: anthropic-ratelimit-* with short values (they hold percentages and reset times, never a token).
// Same logic as pickLimitHeaders in src/ee/byok-usage.js (the Worker side); this copy runs inside the container, which has only relay/.
export function pickLimitHeaders(headers) {
  const out = {}; let n = 0;
  for (const [k, v] of Object.entries(headers || {})) {
    const key = String(k).toLowerCase(), val = Array.isArray(v) ? v[0] : v;
    if (key.startsWith("anthropic-ratelimit-") && n < 40 && val != null && String(val).length <= 200) { out[key] = String(val); n++; }
  }
  return n ? out : null;
}

// Custom MCP: what URL may be registered. Pure checks (no network) plus an optional DNS look through DNS-over-HTTPS.
// Only public HTTPS endpoints: no credentials or query in the URL, no ports but 443, no IP literals in private / loopback / link-local /
// metadata / reserved ranges, no localhost-style or single-label names. 1Helm never fetches the server itself (Composio does); the only
// request this file makes is a DNS lookup to Cloudflare's resolver, so there is no backend URL fetch or proxy to abuse.
export class UrlError extends Error { constructor(code, message) { super(message); this.code = code; } }

const parseV4 = (h) => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h); if (!m) return null; const o = m.slice(1).map(Number); return o.every((n) => n <= 255) ? o : null; };
export function privateV4(o) {
  const [a, b, c] = o;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}
// Expand an IPv6 literal (without brackets) to 8 groups, or null.
function v6Groups(h) {
  h = h.toLowerCase().split("%")[0]; if (!/^[0-9a-f:.]+$/.test(h) || !h.includes(":")) return null;
  let tail = [];
  const lastColon = h.lastIndexOf(":"), last = h.slice(lastColon + 1);
  if (last.includes(".")) { const v4 = parseV4(last); if (!v4) return null; tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]]; h = h.slice(0, lastColon + 1) + "0:0"; }
  const parts = h.split("::"); if (parts.length > 2) return null;
  const grp = (s) => (s === "" ? [] : s.split(":"));
  const head = grp(parts[0]), rest = parts.length === 2 ? grp(parts[1]) : [];
  const fill = parts.length === 2 ? 8 - head.length - rest.length : 0; if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill("0"), ...rest]; if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const n = all.map((g) => parseInt(g, 16)); if (tail.length) { n[6] = tail[0]; n[7] = tail[1]; } return n;
}
export function privateV6(g) {
  const [a, b, c, d, e, f, x, y] = g;
  if (g.every((v) => v === 0) || (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0 && x === 0 && y === 1)) return true;   // :: and ::1
  if ((a & 0xfe00) === 0xfc00 || (a & 0xffc0) === 0xfe80 || (a & 0xff00) === 0xff00 || a === 0x2001 && b === 0x0db8) return true;   // ULA, link-local, multicast, documentation
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return privateV4([x >> 8, x & 255, y >> 8, y & 255]);   // IPv4-mapped
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0) return privateV4([x >> 8, x & 255, y >> 8, y & 255]);   // IPv4-compatible
  if (a === 0x64 && b === 0xff9b) return privateV4([x >> 8, x & 255, y >> 8, y & 255]);   // NAT64
  if (a === 0x2002) return privateV4([b >> 8, b & 255, c >> 8, c & 255]);   // 6to4
  return false;
}
export const isPrivateIp = (s) => { s = String(s || "").replace(/^\[|\]$/g, ""); const v4 = parseV4(s); if (v4) return privateV4(v4); const v6 = v6Groups(s); return v6 ? privateV6(v6) : false; };
const isIpLiteral = (h) => !!parseV4(h) || h.includes(":") || /^[0-9x.]+$/i.test(h);   // dotted, hex/octal/decimal IPv4 forms all count
const BAD_SUFFIX = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|test|invalid|example|onion|arpa)$/i;

// → { url: URL (normalised, no query/hash), host, endpoint: "https://host/path" } or throws UrlError(bad_url | private_url).
export function checkPublicUrl(raw, { what = "server URL", allowQuery = false } = {}) {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 2048) throw new UrlError("bad_url", `Enter the ${what} (https://…).`);
  let u; try { u = new URL(s); } catch { throw new UrlError("bad_url", `That doesn't look like a web address.`); }
  if (u.protocol !== "https:") throw new UrlError("bad_url", `Only https:// addresses can be used for the ${what}.`);
  if (u.username || u.password) throw new UrlError("bad_url", `Remove the username and password from the ${what}; give credentials through the key option instead.`);
  if (u.port && u.port !== "443") throw new UrlError("bad_url", `Only the standard https port (443) can be used.`);
  if (u.hash) throw new UrlError("bad_url", `Remove the # part from the ${what}.`);
  if (u.search && !allowQuery) throw new UrlError("bad_url", `Remove the ? part from the ${what}. Credentials must not go in the address: use the API key option.`);
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UrlError("bad_url", `That address has no host name.`);
  if (isIpLiteral(host.replace(/^\[|\]$/g, ""))) {
    // An IP address as the host is never needed for a public server and is the usual way to reach internal ones.
    throw new UrlError("private_url", `Use a public host name, not an IP address.`);
  }
  if (!host.includes(".") || BAD_SUFFIX.test(host)) throw new UrlError("private_url", `That address isn't a public internet host.`);
  if (host.length > 253) throw new UrlError("bad_url", `That host name is too long.`);
  u.hash = ""; if (!allowQuery) u.search = "";
  return { url: u, host, endpoint: `https://${u.host}${u.pathname}` };
}

// DNS check through Cloudflare's DNS-over-HTTPS (the only request made; never to the user's host). Rejects a name that resolves into a private
// range (a public-looking name pointed at an internal address). Fails OPEN when the resolver is unreachable (Composio connects from its own
// network and runs its own checks); NXDOMAIN is a bad_url. Pass `resolve` to stub in tests.
export async function dnsCheck(host, { resolve = null, timeoutMs = 3000 } = {}) {
  const ask = resolve || (async (type) => {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    if (!r.ok) throw new Error(`doh ${r.status}`);
    return r.json();
  });
  let answers = [], nx = 0, errs = 0;
  for (const type of ["A", "AAAA"]) {
    let d; try { d = await ask(type); } catch { errs++; continue; }
    if (d?.Status === 3) nx++;
    for (const a of d?.Answer || []) if ((a.type === 1 || a.type === 28) && a.data) answers.push(String(a.data));
  }
  for (const ip of answers) if (isPrivateIp(ip)) throw new UrlError("private_url", `That host name points to a private or internal address, so it can't be used.`);
  if (nx === 2 && !answers.length) throw new UrlError("bad_url", `That host name doesn't exist.`);
  return { checked: errs < 2, answers: answers.length };
}

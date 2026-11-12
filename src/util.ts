export const enc = new TextEncoder();
export const now = () => Date.now();
export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}
export function html(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } });
}
export function rand(n = 32) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export function cookie(req: Request, name: string) {
  const c = req.headers.get("cookie") || "";
  for (const part of c.split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1)); }
  return "";
}
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const usd = (micro: number) => `$${(micro / 1e6).toFixed(2)}`;

// Slug rules shared with the self-hosted provisioner, plus Cloud additions.
const RESERVED = new Set(["admin","api","app","assets","auth","billing","blog","cdn","demo","docs","help","mail","provision","security","status","support","www","1helm","cloudflare","login","signup","static",
  "dev","staging","test","internal","captain","root","system","cloud","gateway","portal","account","accounts","dashboard","console","stripe","w"]);
export function slugValid(slug: string) {
  return /^(?=.{3,48}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(slug) && !slug.includes("--") && !/^[0-9]+$/.test(slug) && !RESERVED.has(slug);
}

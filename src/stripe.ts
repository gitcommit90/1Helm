import { hmacHex, timingSafeEqual } from "./util";
function form(obj: Record<string, unknown>, prefix = "", out: string[] = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => typeof item === "object" ? form(item as any, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`));
    else if (typeof v === "object") form(v as any, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}
export async function stripe(env: any, method: string, path: string, body?: Record<string, unknown>, idem?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  let url = `https://api.stripe.com/v1${path}`; let payload: string | undefined;
  if (body && method === "GET") url += "?" + form(body).join("&");
  else if (body) { payload = form(body).join("&"); headers["content-type"] = "application/x-www-form-urlencoded"; }
  if (idem) headers["idempotency-key"] = idem;
  const r = await fetch(url, { method, headers, body: payload });
  const d: any = await r.json();
  if (!r.ok) { const e: any = new Error(d?.error?.message || `Stripe HTTP ${r.status}`); e.stripe = d?.error; e.status = r.status; throw e; }
  return d;
}
// https://docs.stripe.com/webhooks#verify-manually
export async function verifyWebhook(payload: string, header: string, secret: string, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]).filter((p) => p[0] === "t"));
  const t = Number(parts.t); const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = await hmacHex(secret, `${t}.${payload}`);
  return sigs.some((s) => timingSafeEqual(s, expected));
}

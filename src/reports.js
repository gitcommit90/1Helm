// Help & support → Report an issue (Captain 10-06). The app sends what happened, the page it was on, an optional screenshot
// (uploaded, or captured from the current tab), its version, the device and window size, and its last log lines (report.ts in
// the design sandbox keeps those). Stored in D1 (issue_reports) + R2 (t/<tenant>/reports/<id>.<ext>, so account deletion takes
// it with everything else). Admins (RELEASE_ADMINS) read them at /reports.
import { stPut } from "./storage.js";
import { boundedText, BodyTooLargeError } from "./bounded-body.js";
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const MAX_SHOT = 6 * 1024 * 1024, MAX_BODY = 9 * 1024 * 1024, MAX_TEXT = 4000, MAX_LOGS = 40;
const SHOT_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const PER_HOUR = 20;
const cut = (s, n) => String(s ?? "").slice(0, n);
const fromB64 = (s) => { const r = atob(s), o = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; };

// POST /w/<slug>/api/report  { text, route, viewport, ua, logs: [string], client_v, shot?: { type, data (base64) } }
export async function reportApi(req, env, t, user, appV) {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let raw;
  try { raw = await boundedText(req, MAX_BODY); }
  catch (e) { return json({ error: e instanceof BodyTooLargeError ? "That screenshot is too big. Try a smaller one." : "Couldn't read that report." }, e instanceof BodyTooLargeError ? 413 : 400); }
  let b;
  try { b = JSON.parse(raw); } catch { return json({ error: "Couldn't read that report." }, 400); }
  if (!b || typeof b !== "object") return json({ error: "Couldn't read that report." }, 400);
  const text = cut(b.text, MAX_TEXT).trim();
  if (!text) return json({ error: "Tell us what happened first." }, 400);
  const recent = await env.DB.prepare("SELECT COUNT(*) n FROM issue_reports WHERE tenant_id=? AND created_at>?").bind(t.id, Date.now() - 3600e3).first().catch(() => ({ n: 0 }));
  if (Number(recent?.n || 0) >= PER_HOUR) return json({ error: `That's a lot of reports in an hour. Contact ${env.SUPPORT_EMAIL || env.EMAIL_FROM} and we'll take it from there.` }, 429);
  let shot = null;
  if (b.shot && b.shot.data) {
    const type = String(b.shot.type || ""), ext = SHOT_TYPES[type];
    if (!ext) return json({ error: "The screenshot has to be a PNG, JPEG or WebP picture." }, 400);
    let bytes; try { bytes = fromB64(String(b.shot.data).replace(/^data:[^,]*,/, "")); } catch { return json({ error: "Couldn't read that screenshot." }, 400); }
    if (bytes.length > MAX_SHOT) return json({ error: "That screenshot is too big (6 MB at most)." }, 413);
    shot = { bytes, type, ext };
  }
  const id = crypto.randomUUID(), logs = (Array.isArray(b.logs) ? b.logs : []).slice(-MAX_LOGS).map((l) => cut(typeof l === "string" ? l : JSON.stringify(l), 500));
  let key = null;
  if (shot) { key = `t/${t.id}/reports/${id}.${shot.ext}`; await stPut(env, key, shot.bytes, { httpMetadata: { contentType: shot.type } }); }   // storage.js: counted (Other), never refused: a report about a full account must still go through
  await env.DB.prepare("INSERT INTO issue_reports (id,tenant_id,slug,email,text,route,app_v,client_v,ua,viewport,logs,shot_key,shot_type,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, t.id, t.slug || "", user?.email || "", text, cut(b.route, 300), String(appV || ""), cut(b.client_v, 20), cut(b.ua || req.headers.get("user-agent"), 400), cut(b.viewport, 80), JSON.stringify(logs), key, shot?.type || null, Date.now()).run();
  console.log("REPORT", t.slug, id, shot ? "with screenshot" : "");
  return json({ ok: true, id });
}

const when = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT";
// Admin-only reports page (index.js checks): newest first.
export async function reportsPage(env) {
  const rows = (await env.DB.prepare("SELECT * FROM issue_reports ORDER BY created_at DESC LIMIT 200").all()).results || [];
  const item = (r) => { let logs = []; try { logs = JSON.parse(r.logs || "[]"); } catch {}
    return `<article><header><b>${esc(r.slug || r.tenant_id)}</b><span>${esc(r.email)}</span><span>${when(r.created_at)}</span></header>
      <p class="tx">${esc(r.text)}</p>
      <dl><dt>Page</dt><dd><code>${esc(r.route || "-")}</code></dd><dt>Version</dt><dd>APP_V ${esc(r.app_v)}${r.client_v && r.client_v !== r.app_v ? ` (app open: ${esc(r.client_v)})` : ""}</dd>
        <dt>Window</dt><dd>${esc(r.viewport || "-")}</dd><dt>Device</dt><dd class="ua">${esc(r.ua || "-")}</dd></dl>
      ${r.shot_key ? `<a class="shot" href="/reports/${esc(r.id)}/shot" target="_blank" rel="noopener"><img src="/reports/${esc(r.id)}/shot" alt="Screenshot" loading="lazy"></a>` : ""}
      ${logs.length ? `<details><summary>Last ${logs.length} log line${logs.length > 1 ? "s" : ""}</summary><pre>${esc(logs.join("\n"))}</pre></details>` : `<p class="none">No log lines.</p>`}</article>`; };
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reports · 1Helm</title><link rel="icon" href="/1helm-icon-64.png">
<style>@font-face{font-family:IS;src:url(/fonts/instrument-sans.woff2)}@font-face{font-family:ISe;src:url(/fonts/instrument-serif.woff2)}
body{margin:0;background:#f3f2ef;color:#1c1b19;font:15px/1.5 IS,system-ui,sans-serif}main{max-width:860px;margin:0 auto;padding:56px 20px 80px}
h1{font:400 44px/1.1 ISe,serif;margin:0 0 6px}.lead{color:#77746c;margin:0 0 28px}
article{background:#fff;border:1px solid #e7e5e0;border-radius:16px;padding:16px 20px;margin-bottom:12px}
header{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline}header span{color:#77746c;font-size:13px}
.tx{white-space:pre-wrap;margin:10px 0;font-size:16px}dl{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;margin:0;font-size:13px}dt{color:#77746c}dd{margin:0;min-width:0;overflow-wrap:anywhere}
.ua{color:#44423d}.shot img{display:block;max-width:100%;max-height:360px;margin-top:12px;border:1px solid #e7e5e0;border-radius:10px}
details{margin-top:10px;font-size:13px}summary{cursor:pointer;color:#44423d}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f2ef;border-radius:10px;padding:10px;font-size:12px}
.none{color:#a29e95;font-size:13px;margin:10px 0 0}.empty{color:#77746c}</style></head><body><main>
<h1>Reports</h1><p class="lead">What people sent from Help &amp; support → Report an issue. Newest first.</p>
${rows.length ? rows.map(item).join("") : `<p class="empty">No reports yet.</p>`}</main></body></html>`, { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
export async function reportShot(env, id) {
  const r = await env.DB.prepare("SELECT shot_key, shot_type FROM issue_reports WHERE id=?").bind(String(id)).first();
  if (!r?.shot_key) return new Response("Not found", { status: 404 });
  const o = await env.WS.get(r.shot_key); if (!o) return new Response("Not found", { status: 404 });
  return new Response(o.body, { headers: { "content-type": r.shot_type || "image/png", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
}

// Image generation routes (image-gen.js). Both are for the signed-in owner of /w/<slug>/.
//   POST /api/image-intent  { channel, session|null, text }  -> { ask: boolean }   Always 200, and ask is false on any failure.
//   POST /api/res/<channel>/sessions/<id>/image-mode  { mode: "on"|"dismissed"|null }  -> { ok, image_mode, session }   400 on the Bring your own key plan.
import { imageAllowed, imageIntentAsk } from "./image-gen.js";
import { boundedJson } from "../bounded-body.js";   // bounded request bodies, as in the public routes

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
// Same-origin like the other POST routes that change something: a request that names another origin is refused (a request with no origin header comes from a script).
const sameOrigin = (req) => { const o = req.headers.get("origin"); return (!o || o === new URL(req.url).origin) && req.headers.get("sec-fetch-site") !== "cross-site"; };

export async function imageRoute({ req, env, t, sub, access, archive, ledger, deps = {} }) {
  if (sub === "/api/image-intent") {
    if (req.method !== "POST") return json({ error: "method" }, 405);
    if (!sameOrigin(req)) return json({ ask: false });
    try {
      const b = await boundedJson(req, 64 * 1024), text = typeof b.text === "string" ? b.text : "";
      if (access?.mode === "read_only" || !text.trim() || t.plan === "byok") return json({ ask: false });
      let mode = null;
      if (b.session) {
        const chans = await archive(env, t.id).channels(), slug = (c) => c.slug || c.name, ch = chans.find((c) => slug(c) === String(b.channel || ""));
        if (!ch) return json({ ask: false });
        const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slug(ch)}`)); await R.bind(t.id, slug(ch), String(ch.id));
        mode = await R.imageModeGet(String(b.session));
      }
      const L = ledger(env, t.id);
      return json(await imageIntentAsk(env, { allowed: await imageAllowed(env, t.id), mode, text, ledger: () => L, meta: { tenant: t.id, channel: String(b.channel || "") }, deps }));
    } catch (e) { console.log("image-intent", String(e?.message || e).slice(0, 120)); return json({ ask: false }); }
  }
  const m = sub.match(/^\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/sessions\/([0-9a-f-]{36})\/image-mode$/);
  if (!m) return null;
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!sameOrigin(req)) return json({ error: "Changing image mode requires a same-origin request." }, 403);
  if (access?.mode === "read_only") return json({ error: "payment_required", access }, 402);
  if (t.plan === "byok") return json({ error: "Image generation isn't available on this plan." }, 400);
  const chans = await archive(env, t.id).channels(), slug = (c) => c.slug || c.name, ch = chans.find((c) => slug(c) === m[1]);
  if (!ch) return json({ error: "no such channel" }, 404);
  const b = await boundedJson(req, 4096);
  if (!b || typeof b !== "object" || !("mode" in b) || (b.mode !== null && b.mode !== "on" && b.mode !== "dismissed")) return json({ error: "mode must be on, dismissed or null." }, 400);
  const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slug(ch)}`)); await R.bind(t.id, slug(ch), String(ch.id));
  const d = await R.imageModeSet(m[2], b.mode);
  return json(d, d.error ? d.status || 400 : 200);
}

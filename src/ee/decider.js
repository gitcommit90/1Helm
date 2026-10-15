// The decider (Captain 2026-10-08): the router/decider that answers our yes-no and pick-one questions (route2.js task?/hard?, the browser
// agent's next action and "is it done?") is Perplexity's decider on OpenRouter, replacing TypeSafe Jev (half the price: $0.02/M in, $0 out).
// Endpoint /api/v1/systemone: { model, provider, state, questions } -> { answers, usage: { cost }, model }. One endpoint, Perplexity's own
// Prompt caching does not apply (no implicit caching on this model, and no chat prefix).
// The model is the saved setting of the job "decider" (model-jobs.js; change it on the Models page). Every caller uses deciderModel(env),
// where env carries the saved settings (modelSettingsEnv); nothing else names the model.
import { aigOn, aigMeta, aigPayload, OR_MAX_PRICE } from "../model.js";
import { jobSetting, settingsOf } from "./model-jobs.js";

export const DECIDER_IN_NANO = 20;       // $0.02 per million input tokens; estimate only when usage.cost is missing
export const DECIDER_URL = "https://openrouter.ai/api/v1/systemone";
export const deciderModel = (env) => jobSetting(settingsOf(env), "decider").model;
// Provider rules like every other route: the model's own host only (perplexity/… → "perplexity", a ~typesafe/ model → "typesafe"),
// no fallbacks, ZDR only, the price ceiling. If that host ever drops ZDR, OpenRouter refuses and the caller sees the error (no retry without it).
export const deciderHost = (model) => String(model).replace(/^~/, "").split("/")[0];
export const deciderProvider = (model) => { const h = deciderHost(model); return { order: [h], only: [h], allow_fallbacks: false, zdr: true, max_price: OR_MAX_PRICE }; };

// POST one decision request. Through the AI Gateway when on (logged and tagged kind "decider"; gateway trouble falls back to OpenRouter
// directly, a gateway 429 is returned as-is, like orFetch). Returns the fetch Response.
export async function deciderFetch(env, body, { signal = null, title = "1Helm decider", meta = {}, fetchImpl = globalThis.fetch } = {}) {
  const headers = { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json", "x-title": title };
  if (env.APP_HOST) headers["http-referer"] = `https://${env.APP_HOST}`;
  if (aigOn(env)) {
    try {
      const r = await fetchImpl(`https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AIG_ID}/openrouter/v1/systemone`, { method: "POST", body, ...(signal ? { signal } : {}),
        headers: { ...headers, "cf-aig-authorization": `Bearer ${env.AIG_TOKEN}`, "cf-aig-collect-log-payload": aigPayload(env), "cf-aig-no-wholesale": "true", "cf-aig-metadata": JSON.stringify(aigMeta(env, { kind: "decider", ...meta })) } });
      if (r.ok || r.status === 429 || (r.status < 500 && r.status !== 401 && r.status !== 404)) return r;
      const t = await r.clone().text().catch(() => "");
      if (!/AiGatewayError/.test(t) && r.status !== 404) return r;
    } catch (e) { if (signal?.aborted) throw e; }
  }
  return fetchImpl(DECIDER_URL, { method: "POST", headers, body, ...(signal ? { signal } : {}) });
}

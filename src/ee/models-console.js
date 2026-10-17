// The /models console: environment-wide model controls. Only MODEL_ADMINS grants access, never TEST_MODE or ops view-as.
// This file is the route (every security check of the page it replaced), the page's data, and the first render of the page.
// There is one environment here: settings are saved in place, and there is no push to another environment.
// The page itself is app-assets/app-static/models-console.js (browser) and models-console-core.js (shared with this file), plus models-console.css.
import { modelSettingsView, saveModelSettings, restoreModelSettings, readModelSettings, unlistedModels } from "./model-settings.js";
import { modelCatalog, listedKinds, withEndpointLimits } from "./model-catalog.js";
import { SEED_FACTS, jobFieldDefaults } from "./model-seed.js";
import { modelDashboard } from "./model-dashboard.js";
import { JOB_IDS } from "./model-jobs.js";
import { LIMIT_GROUPS, LIMIT_DEFS, limitValues } from "./limits.js";
import { outsideModels } from "./outside-models.js";
import { servedView } from "./model-served.js";
import { boundedText, BodyTooLargeError } from "../bounded-body.js";
import { pageHtml } from "../../app-assets/app-static/models-console-core.js";

const HEADERS = { "cache-control": "no-store, private", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff", "referrer-policy": "same-origin",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...HEADERS, "content-type": "application/json;charset=utf-8", ...extra } });
const html = (value, status = 200) => new Response(value, { status, headers: { ...HEADERS, "content-type": "text/html;charset=utf-8" } });
export const isModelAdmin = (env, user) => !!user?.email && String(env.MODEL_ADMINS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean).includes(String(user.email).toLowerCase());
const SIMPLE = (title, text, link) => `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><h1>Models</h1><p>${esc(text)}</p><p><a href="${link[0]}">${link[1]}</a></p></html>`;

export async function modelsRoute(req, env, user) {
  const url = new URL(req.url), path = url.pathname, api = path !== "/models";
  if (!user) return api ? json({ error: "Sign in again to manage models." }, 401) : new Response(null, { status: 302, headers: { ...HEADERS, location: "/onboard?next=/models" } });
  if (!isModelAdmin(env, user)) return api ? json({ error: "This account cannot manage models." }, 403) : html(SIMPLE("Models · 1Helm", "This account cannot manage models.", ["/", "Back to 1Helm"]), 403);
  const catalog = path === "/models/api/catalog", unl = path === "/models/api/unlisted", read = path === "/models" || path === "/models/api" || catalog || unl;
  const action = { "/models/api/save": saveModelSettings, "/models/api/restore": restoreModelSettings }[path];
  if (!read && !action) return json({ error: "Not found." }, 404);
  if (read ? !["GET", "HEAD"].includes(req.method) : req.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: read ? "GET, HEAD" : "POST" });
  if (!read) {
    // All writes require exact origin proof AND a custom header AND JSON. Cross-site forms and opaque/null origins cannot mutate settings using an administrator's cookie.
    if (req.headers.get("origin") !== url.origin || req.headers.get("sec-fetch-site") === "cross-site" || req.headers.get("x-model-settings") !== "1" || !/^application\/json(?:\s*;|\s*$)/i.test(req.headers.get("content-type") || "")) return json({ error: "Open Models on this site and try again." }, 403);
    if (Number(req.headers.get("content-length")) > MAX_BODY) return json({ error: "Settings request is too large." }, 413);
  }
  try {
    if (unl) return json({ unlisted: await unlistedModels(env) });
    if (catalog) return json(await modelCatalog(env, { q: String(url.searchParams.get("q") || "").slice(0, 120), settings: (await readModelSettings(env)).config, known: Object.keys(listedKinds(SEED_FACTS)) }));
    let view;
    if (read) view = await modelSettingsView(env);
    else {
      const raw = await boundedText(req, MAX_BODY);
      if (new TextEncoder().encode(raw).length > MAX_BODY) return json({ error: "Settings request is too large." }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: "Settings must be valid JSON." }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Settings must be a JSON object." }, 400);
      view = await action(env, body, user.email);
    }
    const state = await consoleState(view, env);
    const response = path === "/models" ? html(consoleHtml(state)) : json(state);
    return req.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
  } catch (e) {
    if (e instanceof BodyTooLargeError) return json({ error: "Settings request is too large." }, 413);
    // Validation messages are intentional API output; database/provider internals never are.
    const status = [400, 404, 409, 503].includes(e?.status) ? e.status : 503;
    if (!e?.modelSettings && !e?.status) console.error("models: request failed", path, String(e?.message || e).slice(0, 200));
    const error = e?.modelSettings ? e.message : status === 503 ? catalog ? "The model catalog is unavailable. Your settings have not changed; try again shortly." : "Model settings are temporarily unavailable. Try again shortly." : e.message;
    return api ? json({ error }, status) : html(SIMPLE("Models · 1Helm", error, ["/models", "Try again"]), status);
  }
}
const MAX_BODY = 131072;

// Everything the page needs. The same object is the page's first state and every API answer, so the page re-renders from it after each change.
export async function consoleState(view, env) {
  // Saved records from before the catalog kept each endpoint's limit are completed from the live catalog, for the max output note only (nothing is saved).
  const config = await withEndpointLimits(view.config, { env }).catch(() => view.config);
  const dash = modelDashboard({ ...view, config });
  return {
    environment: view.environment, dynamicRouting: view.dynamicRouting, revision: view.revision, stale: !!view.stale, history: view.history,
    config: view.config, defaults: Object.fromEntries(JOB_IDS.map((id) => [id, jobFieldDefaults(id)])),
    jobs: dash.jobs, groups: dash.groups, served: await servedView(env),
    limits: { groups: LIMIT_GROUPS, defs: LIMIT_DEFS, values: limitValues(view.config) },
    choices: view.options.choices, outside: outsideModels(env), unlisted: [],
  };
}

const jsonForScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(new RegExp("\\u2028", "g"), "\\u2028").replace(new RegExp("\\u2029", "g"), "\\u2029");
export const defaultUi = (state) => ({ view: "all", q: "", sel: null, level: "unrestricted" });
export function consoleHtml(state, now = Date.now()) {
  const ui = defaultUi(state);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Models · 1Helm</title><link rel="icon" href="/1helm-icon-64.png"><link rel="stylesheet" href="/app-static/models-console.css"></head>
<body data-environment="${esc(state.environment)}"><div id="app">${pageHtml(state, ui, now)}</div><div id="layer"></div><div id="toast" role="status" aria-live="polite"></div>
<noscript>Turn on JavaScript to change model settings.</noscript><script id="model-state" type="application/json">${jsonForScript(state)}</script><script type="module" src="/app-static/models-console.js"></script></body></html>`;
}

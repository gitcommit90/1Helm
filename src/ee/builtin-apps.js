// "Built in" apps (10-06 audit): the only Composio toolkits the helper may use WITHOUT the person connecting anything.
// Composio's no_auth / NO_AUTH flag isn't enough (Gemini lists NO_AUTH and API_KEY, and running it without a connection fails), so this
// list comes from design-sandbox scripts/integrations-builtin.mjs, which checks each candidate with real calls in the Composio version
// 1Helm uses. Its saved result is test/fixtures/composio-builtin-audit.json; test/builtin-apps.test.mjs keeps this list, the catalog's
// b flags and that snapshot in step. Re-run the script (and update this list) when Composio adds or changes no-sign-in apps.
export const BUILTIN_APPS = new Map([
  ["hackernews", "Hacker News"], ["weathermap", "OpenWeatherMap"], ["composio_search", "Composio Search (web, news, maps, shopping search)"],
  ["codeinterpreter", "Code Interpreter"], ["gleif", "GLEIF"], ["seat_geek", "Seat Geek"],
]);
// On Composio's LATEST toolkit versions (env COMPOSIO_TOOLKIT_VERSION="latest", composio.js) more no-sign-in apps have actions and pass
// the same audit (design-sandbox scripts/integrations-builtin.mjs with COMPOSIO_TOOLKIT_VERSION=latest; saved result
// test/fixtures/composio-builtin-audit-latest.json, catalog app-static/integrations-latest.json). Most are other companies' public
// MCP servers that Composio hosts; each one's real read-only call succeeded with no connection.
export const BUILTIN_APPS_LATEST = new Map([...BUILTIN_APPS,
  ["yelp", "Yelp"], ["text_to_pdf", "Text to PDF"], ["osv", "OSV (open-source vulnerabilities)"], ["deepwiki_mcp", "DeepWiki (GitHub repo docs)"],
  ["alltrails_mcp", "AllTrails"], ["trivago_mcp", "trivago"], ["viator_mcp", "Viator"], ["taskrabbit_mcp", "Taskrabbit"],
  ["godaddy_mcp", "GoDaddy (domain search)"], ["malwarebytes_mcp", "Malwarebytes (link, email and phone checks)"], ["dice_mcp", "Dice (tech jobs)"],
  ["granted_mcp", "Granted (grants)"], ["aws_marketplace_mcp", "AWS Marketplace"], ["mermaid_chart_mcp", "Mermaid Chart"], ["excalidraw_mcp", "Excalidraw"],
  ["inspo_mcp", "Inspo (design inspiration)"], ["aiwyn_tax_mcp", "Aiwyn Tax"], ["clarity_ai_mcp", "Clarity AI"], ["pophive_mcp", "PopHIVE (US public health data)"],
  ["mospi_mcp", "MoSPI (India statistics)"],
]);
// ---- The deny list (Captain 10-08, after the builtins audit notes/2026-10-08-composio-builtins-audit.md) ----
// Hidden from the helper entirely: never in its catalog (find_app, offer_connect, the hint), never listed by app_actions, never run by
// app_run, never in its built-in apps line or a Composio session. One place; every check goes through isHiddenApp / isHiddenAction.
// The audit lists above stay as they are (they record what Composio offers; test/builtin-apps.test.mjs keeps them in step).
export const HIDDEN_TOOLKITS = new Map([
  ["malwarebytes_mcp", "wrong verdicts in the audit (google.com 'not a recognized site', an obvious phishing domain 'unknown'), sends the person's link, email or phone to a third party, injects 'User Guidance' text"],
  ["codeinterpreter", "duplicates the helper's own computer; runs code on a third-party sandbox, and every run needs a confirm card"],
  ["text_to_pdf", "uploads the text to a third party and returns a public link; the helper makes PDFs itself"],
  ["excalidraw_mcp", "its export publishes the diagram publicly; widget-only output"],
  ["mermaid_chart_mcp", "a 55k-char SVG per call for a widget 1Helm doesn't have; the helper renders Mermaid on its computer"],
  ["aiwyn_tax_mcp", "invites bank, routing and date-of-birth data; its PDF action isn't read-only"],
  ["clarity_ai_mcp", "a demo API that asks for an email; too narrow"],
]);
export const HIDDEN_ACTIONS = new Map([
  ["COMPOSIO_SEARCH_GROQ_CHAT", "an LLM call on Composio's account, outside 1Helm's model routing, metering and zero data retention"],
  ["COMPOSIO_SEARCH_EXA_ANSWER", "deprecated by Composio"],
  ["AWS_MARKETPLACE_MCP_SUBMIT_AWS_MARKETPLACE_FEEDBACK", "a write, with 'you MUST ask the user' text aimed at the model"],
  ["YELP_GET_REVIEW_HIGHLIGHTS", "always 403 (needs Yelp Premium)"],
]);
export const isHiddenApp = (slug) => HIDDEN_TOOLKITS.has(String(slug || "").toLowerCase());
export const isHiddenAction = (slug) => { const s = String(slug || "").toUpperCase(); return HIDDEN_ACTIONS.has(s) || [...HIDDEN_TOOLKITS.keys()].some((k) => s.startsWith(`${k.toUpperCase()}_`)); };
export const HIDDEN_TEXT = (what) => `error: ${what} isn't available in 1Helm, so nothing was run. Do it another way (your own computer, web_search, or another app), and don't offer to connect it.`;
const visible = (m) => new Map([...m].filter(([s]) => !isHiddenApp(s)));
const LISTS = { latest: visible(BUILTIN_APPS_LATEST), pinned: visible(BUILTIN_APPS) };
// The built-in list for the Composio version this server uses (env = the Worker env; none = the pinned version's list), minus the deny list.
export const builtinApps = (env) => (env?.COMPOSIO_TOOLKIT_VERSION === "latest" ? LISTS.latest : LISTS.pinned);
// Never built in: Composio's own meta toolkit ("composio": COMPOSIO_EXECUTE_TOOL / MULTI_EXECUTE_TOOL run any app's actions,
// INITIATE_CONNECTION / MANAGE_CONNECTIONS connect and remove apps), which would go around app_run's checks; and its test toolkits.
// Built in only when it's on the list AND Composio still offers no other way in (a toolkit that gains a key or sign-in scheme stops
// being built in until the audit says otherwise). `modes` = Composio's auth schemes for it.
export function isBuiltin(slug, modes = [], env = null) {
  return !isHiddenApp(slug) && (env?.COMPOSIO_TOOLKIT_VERSION === "latest" ? BUILTIN_APPS_LATEST : BUILTIN_APPS).has(String(slug || "").toLowerCase()) && (modes || []).every((m) => m === "NO_AUTH");
}
export const BUILTIN_TEXT = (env = null) => [...builtinApps(env)].map(([s, n]) => `${n.replace(/ \(.*\)$/, "")} [${s}]`).join(", ");

// Bring-your-own-key apps: AI model providers (and the like) that need the person's OWN API key from that provider, whose usage the
// provider bills to the person directly. The app page and find_app say so plainly, with where to get the key.
const BYOK = {
  gemini: ["Google AI Studio", "https://aistudio.google.com/apikey", "Google"],
  openai: ["OpenAI", "https://platform.openai.com/api-keys"],
  perplexityai: ["Perplexity", "https://www.perplexity.ai/settings/api"],
  mistral_ai: ["Mistral AI", "https://console.mistral.ai/api-keys"],
  groqcloud: ["Groq", "https://console.groq.com/keys"],
  deepseek: ["DeepSeek", "https://platform.deepseek.com/api_keys"],
  openrouter: ["OpenRouter", "https://openrouter.ai/keys"],
  elevenlabs: ["ElevenLabs", "https://elevenlabs.io/app/settings/api-keys"],
  replicate: ["Replicate", "https://replicate.com/account/api-tokens"],
  cohere: ["Cohere", "https://dashboard.cohere.com/api-keys"],
  hugging_face: ["Hugging Face", "https://huggingface.co/settings/tokens"],
};
const AI_CAT = /\b(ai models?|ai content generation)\b/i;   // model providers, not every app that mentions AI
const firstUrl = (s) => { const m = String(s || "").match(/https?:\/\/[^\s)"']+|\b[a-z0-9.-]+\.(?:com|ai|io|dev|co)\/[^\s)"']*/i); if (!m) return null; const u = m[0].replace(/[.,;]+$/, ""); return /^https?:/.test(u) ? u : `https://${u}`; };
// → { provider, url, payer, text } or null. `cats` = category names; `hint` = Composio's own text about the key (may hold its URL).
export function byokInfo(slug, name, { cats = [], hint = "", site = "" } = {}) {
  const k = BYOK[String(slug || "").toLowerCase()];
  if (!k && !cats.some((c) => AI_CAT.test(String(c)))) return null;
  const provider = k?.[0] || name, payer = k?.[2] || k?.[0] || name, url = k?.[1] || firstUrl(hint) || site || null;
  return { provider, payer, url, text: `${name} needs your own API key from ${provider}. You pay ${payer} directly for what your helper uses; 1Helm doesn't bill for it or include it in your plan.` };
}

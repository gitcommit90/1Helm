// The Worker's endpoint for the Hindsight memory server's model calls. It is Cloud code (src/ee, behind the Cloud switch): on a public install without the switch the
// route /_hs/ answers 404 and the memory server keeps calling its own model provider with its own settings, so a self-hosted Hindsight needs nothing from this file.
//
// With the Cloud switch on, each client of the memory server uses a base URL on this Worker:
//   POST /_hs/llm/<retain|consolidation|reflect|refresh|default>/v1/chat/completions   the five language model clients (OpenAI shaped)
//   POST /_hs/rerank/v1/systemone                                                       the recall reranker (typesafe provider)
// A call is authenticated with one shared secret (the Worker secret HINDSIGHT_LLM_KEY, which the memory server holds as its API key), mapped to its saved job
// (hs_retain, hs_consolidation, hs_reflect, hs_refresh, hs_rerank) and sent through dispatch(), so the saved model, fallbacks, reasoning level, provider sort, max
// price, max output, timeout and zero data retention routing apply and the AI Gateway log is tagged like every other job. Nothing the memory server chose for itself
// (model, provider list, reasoning, output limit) is sent on. Without the secret the route answers 503, and a wrong secret answers 401.
//
// The bank id arrives as the OpenAI `user` field (HINDSIGHT_API_LLM_SEND_BANK_AS_USER) or, for the reranker, the header X-Hindsight-Bank-Id. This file reads it only to tag
// the gateway log, and never sends it on: the request that goes to the provider is rebuilt from a short list of fields. This Worker serves every bank it is asked for with its
// own saved settings (the public edition has one environment, so there is no forward to another Worker).
import { boundedText, BodyTooLargeError } from "../bounded-body.js";
import { dispatch } from "./model-dispatch.js";
import { quirkOf, entriesOf, jobSetting } from "./model-jobs.js";
import { modelSettingsEnv } from "./model-settings.js";

export const HS_PROXY_HEADER = "x-hs-proxy";
export const MAX_BODY = 16 << 20;
// path name to the saved job. "default" is the memory server's global client, used only for its startup check: its model and reasoning level equal consolidation's.
const LLM_JOBS = { retain: "hs_retain", consolidation: "hs_consolidation", reflect: "hs_reflect", refresh: "hs_refresh", default: "hs_consolidation" };
const RERANK_JOB = "hs_rerank";
const ROUTE = /^\/_hs\/(?:llm\/(retain|consolidation|reflect|refresh|default)\/v1\/chat\/completions|rerank\/v1\/systemone)$/;
// The only fields of a chat request that are sent on. Everything else (user, model, provider, extra_body fields, reasoning_effort, max_tokens, max_completion_tokens, cache keys)
// is dropped: the saved job decides the model, provider, reasoning level and output limit.
const KEEP = ["messages", "tools", "tool_choice", "parallel_tool_calls", "response_format", "top_p", "stop", "seed", "stream", "stream_options", "presence_penalty", "frequency_penalty"];
const RERANK_BANK_HEADER = "x-hindsight-bank-id";

const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store", [HS_PROXY_HEADER]: "1" } });
const failure = (status, message, type = "hindsight_proxy_error") => reply({ error: { message: String(message).slice(0, 300), type, code: status } }, status);

// ---- the bank id ----
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// The tenant and channel parts, for the gateway tags only. Both are null when the id does not have the usual shape.
export function bankParts(bank) {
  const m = new RegExp(`^[a-z][a-z0-9]*-(${UUID})-(.{1,64})$`).exec(String(bank || "")) || new RegExp(`^a2a-[a-z][a-z0-9]*-(${UUID})-(.{1,64})$`).exec(String(bank || ""));
  return m ? { tenant: m[1], channel: String(bank).startsWith("a2a-") ? "a2a" : m[2] } : { tenant: null, channel: null };
}

// ---- the secret ----
const enc = new TextEncoder();
async function keyMatches(given, secret) {
  const [a, b] = await Promise.all([given, secret].map(async (v) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(v))))));
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
const bearer = (req) => /^Bearer (.+)$/.exec(req.headers.get("authorization") || "")?.[1] || "";

// ---- cleaning the request ----
// The saved settings and the models' facts decide what is sent, not the memory server's guesses from a model name. No temperature is sent: the memory job always asks for require_parameters, and a temperature next to it leaves no endpoint for most models. A tool_choice other than auto is dropped when a model of the job takes only automatic choice
// (the memory server already narrows a forced call to a single tool).
export function cleanChatRequest(body, settings, jobId) {
  const autoOnly = entriesOf(jobSetting(settings, jobId)).some((e) => quirkOf(settings, e.model, "auto_tool_choice_only"));
  const out = {};
  for (const k of KEEP) if (body[k] !== undefined) out[k] = body[k];
  if (autoOnly && out.tool_choice != null && out.tool_choice !== "auto") delete out.tool_choice;
  if (Array.isArray(out.messages)) out.messages = out.messages.map((m) => (m && typeof m === "object" && m.reasoning_content === "" ? Object.fromEntries(Object.entries(m).filter(([k]) => k !== "reasoning_content")) : m));
  return out;
}

const statusOf = (e) => (Number.isInteger(e?.orStatus) && e.orStatus >= 400 && e.orStatus < 600 ? e.orStatus : e?.privacyBlocked || e?.modelSettings || e?.name === "ModelSettingsError" ? 503 : e?.name === "TimeoutError" || e?.name === "AbortError" ? 504 : 502);
const answer = (r) => new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json;charset=utf-8", "cache-control": "no-store", [HS_PROXY_HEADER]: "1" } });

// The Worker's own env with waitUntil, so the "last served" write is not cut off when the answer ends.
const withWait = (env, ctx) => (ctx?.waitUntil ? Object.assign(Object.create(env), { waitUntil: (p) => ctx.waitUntil(p) }) : env);

async function serve(env, req, { jobId, body, kind, bank }) {
  const { tenant, channel } = bankParts(bank), meta = { kind, ...(tenant ? { tenant } : {}), ...(channel ? { channel } : {}) };
  const seen = await modelSettingsEnv(env);
  const request = jobId === RERANK_JOB ? { state: body.state, questions: body.questions } : cleanChatRequest(body, seen.MODEL_SETTINGS, jobId);
  const r = await dispatch(seen, jobId, request, { meta, level: "zdr", signal: req.signal });
  return answer(r);
}

// The route. Everything it answers carries x-hs-proxy, and none of it is cached. Returns a Response for any path under /_hs/.
export async function hindsightRoute(req, env, ctx, url) {
  const match = ROUTE.exec(url.pathname);
  if (!match) return failure(404, "Not found.", "not_found");
  if (req.method !== "POST") return failure(405, "Method not allowed.", "method_not_allowed");
  if (!env.HINDSIGHT_LLM_KEY) return failure(503, "The memory model endpoint is not set up on this server.", "not_configured");
  if (!(await keyMatches(bearer(req), env.HINDSIGHT_LLM_KEY))) return failure(401, "Not authorized.", "unauthorized");
  // The body is read with the public streaming limit, so a missing or false Content-Length cannot make the Worker buffer more than MAX_BODY.
  let raw; try { raw = await boundedText(req, MAX_BODY); } catch (err) { return err instanceof BodyTooLargeError ? failure(413, "The request is too large.", "too_large") : failure(400, "The request must be UTF-8 JSON.", "bad_request"); }
  let body; try { body = JSON.parse(raw); } catch { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return failure(400, "The request must be a JSON object.", "bad_request");
  const rerank = !match[1], jobId = rerank ? RERANK_JOB : LLM_JOBS[match[1]];
  if (rerank ? typeof body.state !== "string" || !body.questions || typeof body.questions !== "object" : !Array.isArray(body.messages)) return failure(400, rerank ? "The request needs a state and questions." : "The request needs messages.", "bad_request");
  const bank = String((rerank ? req.headers.get(RERANK_BANK_HEADER) : body.user) || "").slice(0, 300);
  const kind = `memory-${rerank ? "rerank" : match[1] === "default" ? "check" : match[1]}`;
  const e = withWait(env, ctx);
  try {
    return await serve(e, req, { jobId, body, kind, bank });
  } catch (err) {
    console.log("hindsight-llm: failed", jobId, statusOf(err), String(err?.message || err).slice(0, 160));
    return failure(statusOf(err), err?.message || "The call failed.", "upstream_error");
  }
}

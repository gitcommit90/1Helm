// Test helpers for calls the app now makes through the dispatcher (src/model-dispatch.js).
// openRouterChat(env, body, session, route, meta, signal): the call shape older tests use. A route that names a background job (or a call kind that
// belongs to one) dispatches that job; any other route is the main chat, so its category's chat job runs with the route.
import { dispatch } from "../../src/ee/model-dispatch.js";
import { CHAT_JOB } from "../../src/ee/model-jobs.js";
import { backgroundRole } from "../../src/ee/background-policy.js";
import { isHandoff } from "../../src/ee/route2.js";

// The address the request sorter's endpoint has on OpenRouter, for tests that fake fetch.
export const JEV_URL = "https://openrouter.ai/api/v1/systemone";

export function jobOfCall(route, meta, body) {
  const kind = meta?.kind || "";
  return route?.job || backgroundRole(kind) || (kind === "card-label" ? "label" : kind === "sidecar-card" ? "sidecar_card"
    : kind.startsWith("live-notes-") ? "notes" : isHandoff(route, body) ? "handoff" : null);
}
export async function openRouterChat(env, body, session, route = null, meta = {}, signal = null) {
  const jobId = route?.taskAffinity ? null : jobOfCall(route, meta, body);
  if (jobId) return dispatch(env, jobId, body, { meta, signal, session });
  const main = route?.taskAffinity ? route : route?.two ? route : { two: true, category: route?.category || "general" };
  return dispatch(env, CHAT_JOB, body, { meta, signal, session, route: main });
}

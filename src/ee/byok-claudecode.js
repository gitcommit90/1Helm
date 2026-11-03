// Continue with Claude (task cc-turns, 2026-11-03): people run Claude Code with their own Claude plan inside 1Helm. The unmodified Claude Code CLI runs headless in one container per ACCOUNT
// (src/ee/claude-engine.js, one sign-in for the whole account, never per channel). This file is the connection side: the sign-in steps, the status the row shows, and the models the picker lists.
//   - one connection per account, kind and id "claudecode", so its models are named claudecode:<model> like every connection's (byok-connections.js). It holds no key: the sign-in lives in the
//     engine's container, and the row only says it exists plus who is signed in (kept in the row's last test, so the page needs no container start to show it).
//   - sign in: loginStart() gives Anthropic's own address (opened in a new tab by the app), the person pastes the code Anthropic shows, loginFinish(code) completes it.
//   - models: the names the Claude Code command accepts for --model (fable, opus, sonnet, haiku), with the reasoning levels of its --effort flag (low, medium, high, xhigh, max), and "default" for no flag at all (the CLI chooses). Haiku has no levels.
//   - a Claude Code model is one more model for 1Helm's own helper loop (Captain 2026-11-03, like the Hermes plugin): claudeChat sends one chat/completions call through the engine's complete(), so chains, chores and
//     Background jobs work as for any service. 1Helm's loop, tools, cards, plans and memory are unchanged.
import { claudeEngine } from "./claude-engine.js";
import { ccSignInUrlOk, ccUrlHost } from "./claude-signin-url.js";
import { limitFromWindows, limitText, noteLimit } from "./byok-usage.js";
import { ByokError, guardStream, firstEventOk, MAX_JSON_BYTES } from "../byok.js";
import { withCacheBreakpoints } from "../model.js";

export const CC_SOURCE = "claudecode";
export const CC_ID = "claudecode";
export const CC_LABEL = "Claude Code";
export const CC_PREFIX = `${CC_ID}:`;
export const isCcModel = (m) => typeof m === "string" && m.startsWith(CC_PREFIX);
// The ids are the CLI's own aliases, so they keep tracking Anthropic's newest models. The names carry version numbers: update them when the pinned CLI version (src/ee/claude-engine/Dockerfile) changes what an alias resolves to.
export const CC_MODELS = [
  { id: "fable", name: "Claude Fable 5.1", family: "Claude Code", note: "May use your Claude usage credits", supported_reasoning_efforts: ["default", "low", "medium", "high", "xhigh", "max"] },
  { id: "opus", name: "Claude Opus 5.5", family: "Claude Code", supported_reasoning_efforts: ["default", "low", "medium", "high", "xhigh", "max"] },
  { id: "sonnet", name: "Claude Sonnet 5.5", family: "Claude Code", supported_reasoning_efforts: ["default", "low", "medium", "high", "max"] },
  { id: "haiku", name: "Claude Haiku 5.5", family: "Claude Code" },
];
// The same shape a service's model list has, so the picker and the saved setting treat it like any other list.
export const ccModelsJson = () => ({ object: "list", data: CC_MODELS.map((m) => ({ ...m })) });
export const CC_BAD_URL = "Claude's sign-in gave a page address 1Helm doesn't recognize, so it wasn't opened. Try again in a minute.";
export const CC_DOWN = "Claude Code isn't reachable right now. Try again in a minute.";
export const CC_SIGNIN_AGAIN = "Claude Code isn't signed in. Open Settings, AI services, choose Continue with Claude and sign in again.";
export const CC_BAD_CODE = "That code didn't work. Copy the whole code Anthropic shows, paste it here and try again.";
export const CC_NO_CREDITS = "Continue with Claude runs on 1Helm's computer, which is paid from credits you add, at cost plus 15%. Add credits to go on. Your Claude plan pays for the AI itself.";
export const CC_DAY_LIMIT = "The daily safety limit was reached, so Continue with Claude is paused until midnight Pacific. Nothing was lost.";
// The engine's raw stop reasons (claude-engine.js payError) as { code, error } in plain words; anything else stays a short sentence, never a bare code.
export function ccPlain(raw) {
  const m = String(raw ?? "");
  if (/out_of_credits?\b/.test(m)) return { code: "out_of_credits", error: CC_NO_CREDITS };
  if (/daily safety limit/i.test(m)) return { code: "day_limit", error: CC_DAY_LIMIT };
  const t = m.trim().slice(0, 200);
  return { error: !t || /^\S+$/.test(t) ? CC_DOWN : t };
}
export const CC_CODE_RE = /^[^\x00-\x1f\x7f]{4,2000}$/;

const engineOf = (env, tid) => { try { return claudeEngine(env, tid); } catch { return null; } };
// Who is signed in, from whatever the engine reports (an email text, or an object with an email and a plan).
export function accountOf(a) {
  if (!a) return { email: "", plan: "" };
  if (typeof a === "string") return { email: a.slice(0, 200), plan: "" };
  return { email: String(a.email || a.emailAddress || a.name || "").slice(0, 200), plan: String(a.plan || a.subscriptionType || a.subscription || "").slice(0, 60) };
}
// Step one: Anthropic's address to open in a new tab. → { url } or { error }.
export async function ccStart(env, tid) {
  const e = engineOf(env, tid); if (!e) return { error: CC_DOWN, status: 503 };
  try {
    const r = await e.loginStart();
    if (r?.error) { const p = ccPlain(r.error); return { ...p, status: p.code === "out_of_credits" ? 402 : p.code ? 429 : 502 }; }
    const url = String(r?.url || "");
    if (!ccSignInUrlOk(url)) { console.log("claudecode: sign-in address refused, host", ccUrlHost(url)); return { error: CC_BAD_URL, code: "bad_signin_url", status: 502 }; }
    return { url: new URL(url).href };
  } catch (err) { console.log("claudecode: login start", String(err?.message || err).slice(0, 100)); return { error: CC_DOWN, status: 503 }; }
}
// Step two: the pasted code. → { ok, account: { email, plan } } or { error }.
export async function ccFinish(env, tid, code) {
  const c = String(code ?? "").trim();
  if (!CC_CODE_RE.test(c)) return { error: CC_BAD_CODE, status: 400 };
  const e = engineOf(env, tid); if (!e) return { error: CC_DOWN, status: 503 };
  try {
    const r = await e.loginFinish(c);
    if (r?.error || !r?.ok) { const p = typeof r?.error === "string" && r.error ? ccPlain(r.error) : { error: CC_BAD_CODE }; return { ...p, status: p.code ? 402 : 400 }; }
    return { ok: true, account: accountOf(r.account) };
  } catch (err) { console.log("claudecode: login finish", String(err?.message || err).slice(0, 100)); return { error: CC_DOWN, status: 503 }; }
}
// The row's Test: does the engine say someone is signed in? → { signedIn, account, version } or { error }.
export async function ccStatus(env, tid) {
  const e = engineOf(env, tid); if (!e) return { error: CC_DOWN };
  try { const r = await e.status(); return { signedIn: !!r?.signedIn, account: accountOf(r?.account), version: String(r?.version || "") }; }
  catch (err) { console.log("claudecode: status", String(err?.message || err).slice(0, 100)); return { error: CC_DOWN }; }
}
// Remove: the sign-in leaves the container. Never throws (the row is removed either way).
export async function ccForget(env, tid) {
  const e = engineOf(env, tid); if (!e) return;
  try { await e.signOut(); } catch (err) { console.log("claudecode: sign out", String(err?.message || err).slice(0, 100)); }
}
// The one connection test the page shows. Runs no model.
export async function ccTest(cfg) {
  const h = cfg.ccHandle; const t0 = Date.now();
  const done = (ok, check, extra = {}) => ({ ok, checks: { reach: check }, ms: Date.now() - t0, at: Date.now(), ...extra });
  if (!h) return done(false, { ok: false, error: CC_DOWN }, { detail: "no engine" });
  const s = await ccStatus(h.env, h.tid);
  if (s.error) return done(false, { ok: false, error: s.error }, { detail: "engine" });
  if (!s.signedIn) return done(false, { ok: false, error: CC_SIGNIN_AGAIN }, { detail: "signed out" });
  return done(true, { ok: true, ms: Date.now() - t0 }, { account: s.account, version: s.version });
}
// Warm the account's engine (a container start) when the General model is Claude Code. Never throws, never waits longer than the engine does.
export async function ccWarm(env, tid) {
  const e = engineOf(env, tid); if (!e || typeof e.warm !== "function") return { ok: false };
  try { const r = await e.warm(); return { ok: !!r?.ok, ms: Number(r?.ms) || 0 }; } catch { return { ok: false }; }
}

// Plan usage for the row (byok-usage.js): the engine's own numbers (Anthropic's rate limit headers of the last call, else the CLI's token used inside the container). → { windows, source } or throws .why.
export async function claudeUsage(env, tid) {
  const e = engineOf(env, tid); if (!e || typeof e.usage !== "function") throw Object.assign(new Error("no engine"), { why: "engine" });
  let r; try { r = await e.usage(); } catch { throw Object.assign(new Error("engine"), { why: "engine" }); }
  if (r?.none || !r?.windows?.length) throw Object.assign(new Error("none"), { why: r?.why === "asleep" ? "asleep" : String(r?.why || "none"), permanent: false });
  return { windows: r.windows, source: r.source || "" };
}
export const isCcLimit = (raw) => /usage limit|rate limit|limit reached|\b429\b|too many requests/i.test(String(raw?.message || raw || "").slice(0, 300));
// The reply for a call that ran into the Claude plan limit: which limit and when it resets (from the engine's numbers, when it has them), and a Manage usage link. It also tells the page.
async function ccLimitReply(env, tid) {
  let info = { window: "", resets_at: null };
  try {
    const e = engineOf(env, tid), u = e && typeof e.usage === "function" ? await e.usage() : null;
    const top = limitFromWindows(u?.windows) || (u?.windows?.length ? (() => { const w = [...u.windows].sort((a, b) => b.used - a.used)[0]; return u.status === "rejected" ? { window: w.id, resets_at: u.reset || w.resets_at } : null; })() : null);
    if (top) info = top;
  } catch {}
  await noteLimit(env, tid, "claudecode", info);
  return limitText("claudecode", { ...info, host: CC_LABEL });
}
// The words for a failed call, pointing to Settings, AI services. raw: what the engine or the CLI said.
export function ccFailText(raw) {
  const r = String(raw?.message || raw || "").slice(0, 300);
  if (/not logged in|log ?in|sign ?in|unauthori[sz]ed|authentication|invalid (api key|token)|\b401\b|expired/i.test(r)) return "Your AI service (Claude Code) isn't signed in. Open Settings, AI services, choose Continue with Claude and sign in again.";
  if (/usage limit|rate limit|limit reached|\b429\b|overloaded|too many requests/i.test(r)) return "Your AI service (Claude Code) says your Claude plan has reached its usage limit. Try again after it resets, or choose another model in Settings, AI services.";
  if (!r || /no engine|not installed|no container|unreachable|econn|fetch failed|timeout/i.test(r)) return "Your AI service (Claude Code) isn't reachable right now. Try again in a minute, or check it in Settings, AI services.";
  return `Your AI service (Claude Code) stopped: ${r.replace(/\s+/g, " ").slice(0, 200)}. Check it in Settings, AI services.`;
}
// Prompt caching on the subscription path: the same breakpoints the OpenRouter path sends (withCacheBreakpoints in model.js, one capability for every route). A session's tool-loop call
// (a session and tools) gets up to four marks; a chore gets one or two. withCacheBreakpoints reads session_id only to know it is a tool loop, so it is taken off again: the engine never sends it upstream.
export function cachedBody(env, body, model, session = null) {
  if (env?.PROMPT_CACHE === "off") return { ...body, model };
  const { session_id, ...marked } = withCacheBreakpoints({ ...body, model, ...(session ? { session_id: String(session) } : {}) });
  return marked;
}
// One chat call on Claude Code: the engine's complete({ body, model, effort, session, stream }) takes an OpenAI chat.completions request and answers with a chat.completions response or SSE chunks.
// Returns the same Response shape the other services return (chatgptChat), so byokChat, chains, chores and Background jobs work unchanged. Nothing is charged: the person's Claude plan pays.
export async function claudeChat(cfg, body, { signal = null, model, effort = null, session = null } = {}) {
  const h = cfg.ccHandle; if (!h) throw new ByokError(ccFailText("no engine"), 0, "no engine");
  const engine = engineOf(h.env, h.tid); if (!engine || typeof engine.complete !== "function") throw new ByokError(ccFailText("no engine"), 0, "no engine");
  const effortOk = effort && effort !== "default" ? effort : undefined, stream = body.stream === true;
  let r;
  try { r = await engine.complete({ body: cachedBody(h.env, body, model, session), model, ...(effortOk ? { effort: effortOk } : {}), session: session ? String(session) : undefined, stream }); }
  catch (e) { if (signal?.aborted) throw e; if (isCcLimit(e)) throw Object.assign(new ByokError(await ccLimitReply(h.env, h.tid), 0, String(e?.message || e).slice(0, 160)), { limit: true }); throw new ByokError(ccFailText(e), 0, String(e?.message || e).slice(0, 160)); }
  if (r?.error && !r.choices && !r.body && !r.getReader) { const raw = r.error?.message || r.error; if (isCcLimit(raw)) throw Object.assign(new ByokError(await ccLimitReply(h.env, h.tid), 0, String(raw).slice(0, 160)), { limit: true }); throw new ByokError(ccFailText(raw), 0, String(raw).slice(0, 160)); }
  const sse = (b) => new Response(b, { status: 200, headers: { "content-type": "text/event-stream" } });
  if (stream) {
    const b = r instanceof Response ? r.body : r?.getReader ? r : null;
    if (!b) throw new ByokError(ccFailText("an empty answer"), 0, "an empty answer");
    return sse(await firstEventOk(cfg, guardStream(cfg, b, signal)));
  }
  let j = r;
  if (r instanceof Response) { try { j = JSON.parse((await r.text()).slice(0, MAX_JSON_BYTES)); } catch { throw new ByokError(ccFailText("the answer wasn't JSON"), 0, "the answer wasn't JSON"); } }
  if (!Array.isArray(j?.choices)) throw new ByokError(ccFailText(j?.error?.message || "the answer had no reply in it"), 0, "no reply");
  j.usage = { ...(j.usage || {}), cost: 0 }; j.model ||= `claudecode:${model}`;
  return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
}

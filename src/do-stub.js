// Version skew and resets between the Worker and its Durable Objects (notes/2026-10-08-deploy-safe-agents.md §3.8, Phase 0).
// A deploy resets every Durable Object at once, with no drain, and an object that is already running can keep the previous code for
// "seconds to minutes" (Cloudflare rolls code out to objects eventually). So right after a deploy, any call from the Worker to a DO,
// or from one DO to another, can fail in one of two ways:
//   - skew: "The RPC receiver does not implement the method X" (a new caller, an old object). The call never ran, so it is always
//     safe to try again, on a fresh stub, once the object has picked up the new code;
//   - reset: "Durable Object reset because its code was updated", "Network connection lost", "overloaded", … The call may have run
//     partly, so only a method that is safe to run twice (IDEMPOTENT below) is tried again.
// tolerantEnv(env) wraps every Durable Object namespace in env so that each stub it hands out does exactly that, with a backoff of
// 0.5, 1, 2, 4, 8 s (about 15 s in all) and a brand-new stub per try (Cloudflare's error-handling advice). Nothing else changes:
// ids, names, fetch() and non-function properties pass straight through, and live changes to env (tests swap a namespace's get) are
// seen at call time. Used by the Worker's entry points and by every Durable Object's constructor, so all ~80 call sites get it.
export const DO_TRANSIENT_RE = /reset because its code was updated|code was updated|Network connection lost|overloaded|transient issue|Durable Object.*(reset|storage operation exceeded|exceeded)|exceeded its CPU time limit|exceeded (its )?memory limit|internal error/i;
export const RPC_SKEW_RE = /RPC receiver does not implement the method/i;
export const rpcSkew = (e) => RPC_SKEW_RE.test(String(e?.message || e || ""));
// A Durable Object (this one, or one it called) was reset by a deploy: its work is carried on (resume.js), never reported as an error.
export const RESET_RE = /reset because its code was updated|Durable Object reset/i;
// The platform dropped this object's connection mid-call (no deploy): Cloudflare words it "Network connection lost" or "Connection closed: this
// Durable Object instance is no longer active". Alone it is ambiguous (a plain subrequest can say it too), so the Resident only treats it as a
// reset when a write to its own storage fails as well (resident.js storageLost).
export const LOST_RE = /Network connection lost|instance is no longer active|Connection closed/i;
export const isLostErr = (e) => !!e && LOST_RE.test(String(e?.message ?? e));
export const isResetErr = (e) => !!e && (e.objectReset === true || RESET_RE.test(String(e?.message ?? e)));
export const doTransient = (e) => !!(e?.retryable || e?.overloaded || DO_TRANSIENT_RE.test(String(e?.message || e || "")));
// The namespaces we wrap (wrangler durable_objects bindings).
export const DO_BINDINGS = ["RESIDENT", "CHANNEL_COMPUTER", "LEDGER", "ARCHIVE", "COMPUTER", "BEE_SYNC", "LIVE_NOTES", "FILE_PREP", "NATIVE_TRANSPORT"];
// Methods that are safe to run twice: reads, plus writes that set a value or are keyed by an id (bind/init/ensure, Ledger settle,
// Live notes' mic chunks: micPush is keyed by the chunk's seq, micState sets a state).
// A method not listed here is retried only on skew (it never ran), never on a reset (it may have).
export const IDEMPOTENT = /^(get|list|read|view|state|totals|opsTotals|opsRead|day|dayInfo|guardInfo|debug|tz|session|sessions|sessionDetail|card|cards|cardsList|cardGet|cardStep|file|files|fileRow|listFiles|shot|helpersList|approvals|approvalPolicy|listGrants|transcript|outbox|runs|turnStats|gateRuns|contextAnatomy|eventLog|memoryStats|memoryRecall|recallFor|clefDoorsLog|channels|channel|status|ambientQuery|leaseState|sleepState|browserOwnerState|busyDebug|acquireBrowserOwner|renewBrowserOwner|egressLog|egress|history|who|bind|init|ensure|settle|release|releaseBrowserOwner|codeV|attach|whoami|homeNote|byokFbState|noticePending|ledgerTail|laterList|listWorkflows|todoItems|interviewView|planCardData|connectOfferGet|approvalCardData|micCheck|micPush|micState|prepStart|prepState|sidecarDone|sidecarOcrHint|reindexStart|sidecarReindexed|addUpload)$/;

const sleep = (ms) => new Promise((z) => setTimeout(z, ms));
// One call on a stub made fresh for every try. mk() → a new stub; k = the method name; a = its arguments.
export async function tolerantCall(env, mk, k, a, { tries = 5 } = {}) {
  const base = Number(env?.SKEW_WAIT_MS ?? 500);
  for (let i = 0; ; i++) {
    try { return await mk()[k](...a); } catch (e) {
      const skew = rpcSkew(e), again = skew || (doTransient(e) && IDEMPOTENT.test(String(k)));
      if (!again || i >= tries - 1) throw e;
      console.log(skew ? "do skew, retrying" : "do reset, retrying", String(k), i + 1, String(e?.message || e).slice(0, 120));
      await sleep(base * 2 ** i);
    }
  }
}
const PASS = new Set(["fetch", "then", "id", "name", "connect", "constructor", "toJSON"]);
function tolerantStub(env, ns, id, opts) {
  const mk = () => ns.get(id, opts), first = mk();
  if (!first || (typeof first !== "object" && typeof first !== "function")) return first;
  return new Proxy(first, {
    get(t, k) {
      const v = t[k];
      if (typeof k === "symbol" || PASS.has(k) || typeof v !== "function") return typeof v === "function" && PASS.has(k) ? v.bind(t) : v;
      let used = false;   // the first try goes to the stub the caller already holds (keeps a test's per-stub state); later tries get fresh ones
      return (...a) => tolerantCall(env, () => (used ? mk() : (used = true, t)), k, a);
    },
  });
}
const NS = new WeakMap();
function tolerantNs(env, ns) {
  if (!ns || typeof ns !== "object" || typeof ns.get !== "function" || ns.__tolerant) return ns;
  let w = NS.get(ns);
  if (!w) {
    w = new Proxy(ns, { get(t, k) {
      if (k === "__tolerant") return true;
      if (k === "get") return (id, opts) => tolerantStub(env, t, id, opts);
      const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
    } });
    NS.set(ns, w);
  }
  return w;
}
const ENVS = new WeakMap();
// env → the same env, with each Durable Object namespace handing out tolerant stubs. Idempotent (a wrapped env is returned as is).
export function tolerantEnv(env) {
  if (!env || typeof env !== "object" || env.__tolerantEnv || env.NO_TOLERANT_STUBS) return env;
  let w = ENVS.get(env);
  if (!w) {
    w = new Proxy(env, { get(t, k) {
      if (k === "__tolerantEnv") return true;
      const v = t[k];
      return typeof k === "string" && DO_BINDINGS.includes(k) ? tolerantNs(w, v) : v;
    } });
    ENVS.set(env, w);
  }
  return w;
}
// The deployed version this code runs as: CODE_V when set (a --var), else the Worker version id (version_metadata binding).
export const codeV = (env) => String(env?.CODE_V || env?.CF_VERSION_METADATA?.id || "unknown");

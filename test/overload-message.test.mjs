// node --import ./test/stubs/register.mjs test/overload-message.test.mjs
// Temporary Cloudflare platform failures show plain words instead of the platform's raw text. Model and provider errors keep their own wording.
import assert from "node:assert";
import { isPlatformOverload, PLATFORM_OVERLOAD_MSG } from "../src/do-stub.js";
import { visibleTurnError } from "../src/resident.js";
import { apiError } from "../src/index.js";
import { isStatusNotice } from "../src/status-notes.js";
import { ByokError } from "../src/byok.js";

assert.equal(PLATFORM_OVERLOAD_MSG, "Our servers are overloaded right now, so this didn't finish. Please try again in a few minutes.");
for (const t of ["internal error; reference = licgkftf4kuh20brlmqv6us6", "Internal Error; Reference = abc", "D1 DB is overloaded. Requests queued for too long.",
  "Durable Object is overloaded. Too many requests queued.", "Network connection lost.", "A transient issue occurred"]) assert.ok(isPlatformOverload(new Error(t)), t);
assert.ok(isPlatformOverload("internal error; reference = x"));
for (const t of ["overloaded_error: Overloaded", "Anthropic API overloaded_error", "429 rate limit exceeded", "out_of_credits", "Your AI service said no", "OpenRouter: provider returned error", "Claude Code login expired"]) assert.ok(!isPlatformOverload(new Error(t)), t);
assert.ok(!isPlatformOverload(Object.assign(new Error("Network connection lost"), { byok: true })));
assert.ok(!isPlatformOverload(new ByokError("Your AI service rejected the key")));
assert.ok(!isPlatformOverload(Object.assign(new Error("internal error; reference = a"), { status: 429 })));
assert.ok(!isPlatformOverload(null));

assert.equal(visibleTurnError(new Error("internal error; reference = abc")), PLATFORM_OVERLOAD_MSG);
assert.equal(visibleTurnError(new Error("some other bug")), null);
assert.match(visibleTurnError({ code: "model_catalog_unavailable" }), /model catalog/);

const body = async (e) => { const r = apiError(e); return { status: r.status, retry: r.headers.get("retry-after"), ...(await r.json()) }; };
let r = await body(new Error("internal error; reference = abc"));
assert.deepEqual(r, { status: 503, retry: "5", error: PLATFORM_OVERLOAD_MSG, retryable: true });
r = await body(new Error("D1 DB is overloaded"));
assert.equal(r.error, PLATFORM_OVERLOAD_MSG);
r = await body(new Error("Durable Object reset because its code was updated."));
assert.equal(r.error, "1Helm was just updated mid-request. Send it again in a moment.");
r = await body(new Error("The RPC receiver does not implement the method foo"));
assert.match(r.error, /just updated and this part hasn't caught up/);
r = await body(new Error("plain bug"));
assert.equal(r.error, "Something went wrong: plain bug"); assert.equal(r.status, 500);
assert.ok(isStatusNotice(PLATFORM_OVERLOAD_MSG));
console.log("overload-message ok");

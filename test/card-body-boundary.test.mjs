// A public card link is a bearer token. A holder must not make its action route
// buffer an unbounded body before rate limiting or checking account state.
import assert from "node:assert/strict";
import { cardRoute, cardToken } from "../src/cards.js";

const env = { VAULT_KEY: Buffer.alloc(32, 7).toString("base64") };
const token = await cardToken(env, "tenant", "main", "message");
const card = { token, tenant_id: "tenant", channel: "main", msg_id: "message", kind: "card", body: "", say: "Choose", sent_at: Date.now() };
let queries = 0;
env.DB = { prepare(query) {
  queries++;
  return { bind() { return this; }, async first() {
    if (query.startsWith("SELECT * FROM cards")) return card;
    if (query.startsWith("SELECT id, helper_name")) return { id: "tenant", helper_name: "Helper", helper_avatar: 1 };
    throw new Error(`unexpected query: ${query}`);
  } };
} };
const url = new URL(`https://owner.example.com/c/${token}/act`);
const response = await cardRoute(new Request(url, { method: "POST", headers: { "content-length": "1" }, body: "x".repeat(70_000) }), env, null, url);
assert.equal(response.status, 413);
assert.deepEqual(await response.json(), { error: "too_large" });
assert.equal(queries, 2, "oversized body stops before account state or action work");
console.log("ok - token-gated card action bodies stop at the streaming limit");

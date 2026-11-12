import assert from "node:assert/strict";
import { S, structuredChat } from "../src/structured-output.js";
import { BodyTooLargeError } from "../src/bounded-body.js";
let calls = 0;
await assert.rejects(structuredChat(async () => {
  calls++;
  return new Response("{}", { headers: { "content-length": "8000001" } });
}, {}, { name: "bounded", schema: S.object({ ok: S.boolean }) }), BodyTooLargeError);
assert.equal(calls, 1, "oversized transport is not a semantic schema retry");
console.log("PASS structured response bytes bounded before JSON parsing");

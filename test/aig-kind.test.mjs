// node --import ./test/stubs/register.mjs test/aig-kind.test.mjs
// Every AI Gateway call carries a kind (Langfuse names a trace from it). The Workers AI path (embeddings, Cloudflare chat) used to send no tags at all.
import test from "node:test";
import assert from "node:assert/strict";
import { aigMeta } from "../src/aig-meta.js";
import { cfOptions, cloudflareEmbeddings } from "../src/cloudflare-models.js";
import { aiOpts } from "../src/model.js";

test("cfOptions sends the tags to the gateway and still keeps the log and cache off", () => {
  const o = cfOptions({ AIG_ID: "gw" }, { tenant: "t1", kind: "memory-embed", _privacy: "zdr" });
  assert.deepEqual(o.gateway.metadata, { tenant: "t1", kind: "memory-embed" });
  assert.equal(o.gateway.collectLog, false); assert.equal(o.gateway.skipCache, true);
  assert.equal(o.extraHeaders["cf-aig-collect-log"], "false");
  assert.deepEqual(cfOptions({}, { kind: "x" }), { extraHeaders: cfOptions({}, { kind: "x" }).extraHeaders }, "no gateway, no tags");
});

test("a Workers AI embeddings call carries tenant and kind", async () => {
  let seen;
  const env = { AIG_ID: "gw", AI: { run: async (m, input, opts) => { seen = opts; return { data: [[0.1, 0.2]], usage: {} }; } } };
  await cloudflareEmbeddings(env, "@cf/baai/bge-m3", ["hi"], { tenant: "t9", kind: "memory-embed" }).catch(() => {});
  if (seen) assert.deepEqual(seen.gateway.metadata, { tenant: "t9", kind: "memory-embed" });
  else assert.fail("env.AI.run was not reached");
});

test("a call with no kind is tagged untagged, never nameless, and a given kind is kept inside the five-key cap", () => {
  assert.deepEqual(aigMeta({}, { tenant: "t" }), { tenant: "t", kind: "untagged" });
  assert.deepEqual(aigMeta({}, {}), { kind: "untagged" });
  assert.equal(aiOpts({ AIG_ID: "gw" }, { channel: "c" }).gateway.metadata.kind, "untagged");
  const m = aigMeta({}, { x: 1, y: 2, z: 3, job: "j", px: "p", channel: "c", session: "s", tenant: "t" });
  assert.deepEqual(Object.keys(m), ["tenant", "session", "channel", "kind", "px"]);
  assert.equal(aigMeta({}, { kind: "chat", tenant: "t" }).kind, "chat");
});

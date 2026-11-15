// node --import ./test/stubs/register.mjs test/mem0-parallel-search.test.mjs
// patches/mem0ai-3.3.1-parallel-search.patch makes Mem0's search start the entity boost beside the query embedding (the keyword search stays after the vector search, because MemStore.keywordSearch adds its hits to the array that search() returned). The results must stay exactly
// what the unpatched library returns, so this runs the same fixtures through the installed (patched) search and through a copy with the patch taken out again.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, ".."), lib = join(root, "node_modules/mem0ai");
const tmp = mkdtempSync(join(root, "test/.mem0-orig-")), dir = join(tmp, "dist/oss");
mkdirSync(dir, { recursive: true });
for (const f of ["index.js", "index.mjs"]) copyFileSync(join(lib, "dist/oss", f), join(dir, f));
execFileSync("patch", ["-R", "-p1", "-s", "-d", tmp, "-i", join(root, "patches/mem0ai-3.3.1-parallel-search.patch")]);
const patched = (await import("mem0ai/oss")).Memory, original = (await import(pathToFileURL(join(dir, "index.mjs")))).Memory;
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vec = (id, score, data, extra = {}) => ({ id, score, payload: { data, user_id: "u", ...extra } });
// A fake Memory: only what search() reads. `log` records when each call starts and ends.
function fake(M, { kwFails, entFails } = {}) {
  const log = [], step = async (name, ms, value, fail) => { log.push("start:" + name); await sleep(ms); log.push("end:" + name); if (fail) throw new Error(name); return value; };
  const self = Object.create(M.prototype);
  Object.assign(self, {
    log, _ensureInitialized: async () => {}, _captureEvent: async () => {}, _hasAdvancedOperators: () => false, _displayFirstRunNotice: async () => {}, _displayScaleThresholdNotice: async () => {}, _displayPerformanceSlowQueryNotice: async () => {},
    embedder: { embed: () => step("embed", 40, [1]), embedBatch: (t) => step("embedBatch", 40, t.map(() => [1]), entFails) },
    vectorStore: { search: () => step("vector", 5, [vec("a", 0.6, "Maria likes tea"), vec("b", 0.5, "Denver office"), vec("c", 0.4, "Falcon launch"), vec("d", 0.45, "Lisbon trip")]), keywordSearch: () => step("keyword", 10, [{ id: "c", score: 5 }, { id: "b", score: 1 }], kwFails) },
    getEntityStore: async () => ({ search: async () => [{ score: 0.9, payload: { linkedMemoryIds: ["d", "a"] } }] }),
    reranker: { rerank: async (q, texts) => texts.map((_, i) => ({ index: texts.length - 1 - i, rerankScore: 1 - i / 10 })).slice(0, 3) },
  });
  return self;
}
const q = "What did Maria Lopez say about the Falcon launch?", cfg = { topK: 5, threshold: 0.1, filters: { user_id: "u" } };
for (const [name, opts, c] of [["with the rerank", {}, { ...cfg, rerank: true }], ["without the rerank", {}, cfg], ["the keyword search fails", { kwFails: true }, cfg], ["the entity embedding fails", { entFails: true }, cfg]]) {
  test(`same ids and order as the unpatched search, ${name}`, async () => {
    const a = await fake(original, opts).search(q, c), b = await fake(patched, opts).search(q, c);
    assert.ok(a.results.length > 0); assert.deepEqual(b, a);
  });
}
test("the entity embedding starts before the query embedding ends, and the keyword search still follows the vector search", async () => {
  const m = fake(patched); await m.search(q, cfg);
  const at = (e) => m.log.indexOf(e);
  assert.ok(at("start:embedBatch") < at("end:embed"), m.log.join(" "));
  assert.ok(at("start:keyword") > at("end:vector"), "keyword search after the vector search");
  const o = fake(original); await o.search(q, cfg); assert.ok(o.log.indexOf("start:embedBatch") > o.log.indexOf("end:embed"), "the fixture shows the unpatched search is serial");
});

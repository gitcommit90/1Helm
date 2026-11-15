// node test/image-gen.test.mjs: the pure parts of image generation in the composer and chat (src/image-gen.ts, src/composer-bars.ts).
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "ig-")), entry = join(dir, "entry.ts"), out = join(dir, "ig.mjs");
writeFileSync(entry, `export * from ${JSON.stringify(new URL("../src/ee/image-gen.ts", import.meta.url).pathname)}; export * from ${JSON.stringify(new URL("../src/composer-bars.ts", import.meta.url).pathname)};`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error" });
globalThis.window = globalThis.window || {}; globalThis.document = globalThis.document || { addEventListener() {} };
const { igHomeOff, igRememberHomeOff, igShouldAsk, igCount, igSlotState, igCardHtml, cbBar } = await import(out);
const base = { ok: true, mode: null, pending: false, homeOff: false, text: "draw a cat", sl: "send" };
assert.equal(igShouldAsk(base), true);
assert.equal(igShouldAsk({ ...base, ok: false }), false, "BYOK never asks");
assert.equal(igShouldAsk({ ...base, mode: "on" }), false);
assert.equal(igShouldAsk({ ...base, mode: "dismissed" }), false);
assert.equal(igShouldAsk({ ...base, pending: true }), false);
assert.equal(igShouldAsk({ ...base, text: "   " }), false);
assert.equal(igShouldAsk({ ...base, sl: "schedule" }), false);
assert.deepEqual([igCount(0), igCount(1), igCount(2), igCount(9), igCount("x"), igCount(2.6)], [1, 1, 2, 3, 1, 3]);
assert.equal(igSlotState("working", false), "working"); assert.equal(igSlotState("working", true), "done");
assert.equal(igSlotState("done", false), "failed"); assert.equal(igSlotState("failed", false), "failed");
const h = igCardHtml({ id: "g1", n: 3, status: "working", files: ["a"] }, { tile: f => `<i>${f}</i>`, url: f => `/u/${f}` });
assert.equal((h.match(/class="ig-slot"/g) || []).length, 3);
assert.ok(h.includes('data-igs="done" data-igu="/u/a"') && h.includes("<i>a</i>"));
assert.equal((h.match(/data-igs="working"/g) || []).length, 2);
const b = cbBar({ id: "x", icon: "I", title: "T<", actions: [{ k: "yes", label: "Yes" }], close: "cancel" });
assert.ok(b.includes('data-cba="x|yes"') && b.includes('data-cba="x|cancel"') && b.includes("T&lt;"));
console.log("image-gen ok");

// Don't ask again chosen before the task exists (Home) is remembered for the channel, and every task made from any composer there carries it to the server.
assert.equal(igHomeOff("bench1"), false); igRememberHomeOff("bench1"); assert.equal(igHomeOff("bench1"), true); assert.equal(igHomeOff("other"), false);
{ const { readFileSync } = await import("node:fs"), v3 = readFileSync(new URL("../src/v3.ts", import.meta.url), "utf8");
  const start = v3.slice(v3.indexOf("function liveStart("), v3.indexOf("function liveReply("));
  assert.match(start, /const dismissed = LIVE && !image && igHomeOff\(ch\.slug\)/, "liveStart (Home and the new task dialog both start tasks here) reads the remembered choice");
  assert.match(start, /\.\.\.\(dismissed \? \{ image_mode: "dismissed" \} : \{\}\)/, "the first message of the task carries it");
  assert.match(v3, /\(um as any\)\?\.image_mode === "dismissed" \? \{ image_mode: "dismissed" \} : \{\}/, "the stream body sends it (and a Retry sends it again)"); }
console.log("image-gen: Home dismissal is carried by the first send");

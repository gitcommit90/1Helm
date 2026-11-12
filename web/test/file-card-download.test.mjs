// node test/file-card-download.test.mjs: a [data-fdl] Download link (the file card in a helper reply) must be left to the browser.
// The old handler in src/v3.ts did location.href = dataset.fdl, and the attribute is empty, so it reloaded the app on General Home.
import assert from "node:assert"; import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/v3.ts", import.meta.url), "utf8");
const lines = src.split("\n").filter(l => l.includes('closest<HTMLElement>("[data-fdl]")') || l.includes('closest("[data-fdl]")'));
assert.equal(lines.length, 1, "exactly one click branch handles [data-fdl]");
const l = lines[0];
assert.ok(!/preventDefault|stopPropagation|stopImmediatePropagation/.test(l), "the Download click is not cancelled");
assert.ok(!/location\.(href|assign|replace)|dataset\.fdl/.test(l), "the Download click does not navigate the app");
assert.ok(/return/.test(l), "the branch returns early so no later branch treats it as an open");
// No element may set data-fdl to a URL that the app would have to follow by script.
const rd = readFileSync(new URL("../src/genui-render.ts", import.meta.url), "utf8");
assert.ok(/<a href="\$\{esc\(f\.dl\)\}" download data-fdl>Download<\/a>/.test(rd), "the file card Download is a native <a href download>");
console.log("PASS file-card-download");

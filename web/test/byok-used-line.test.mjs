// node test/byok-used-line.test.mjs: the "Using ChatGPT plan" line under the composer follows the chat call that was answered (stream event ai_used, task onehelm-option): shown only while ChatGPT
// answers, hidden when 1Helm's models or another service answer, and the page's own state decides before any call has been answered.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "usedln-")), out = join(dir, "bundle.mjs"), entry = join(dir, "entry.ts");
writeFileSync(entry, `export { bykPlanLine, bykUsed } from ${JSON.stringify(here("../src/ee/byok-billing.ts"))};\n`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
const dom = { line: null, form: { insertAdjacentHTML(_w, html) { dom.line = html; } } };
globalThis.document = { addEventListener() {}, querySelector: (s) => (s === ".siwcplan" && dom.line ? { remove() { dom.line = null; } } : null), querySelectorAll() { return []; }, getElementById: () => ({ closest: () => dom.form }), createElement() { return { setAttribute() {}, classList: { add() {} } }; }, body: {} };
globalThis.history = { replaceState() {} }; globalThis.window = { addEventListener() {}, setTimeout, __1HC: { slug: "t" } }; globalThis.location = { search: "", pathname: "/v3/", hash: "", href: "http://x/v3/", origin: "http://x" };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const m = await import(pathToFileURL(out).href);
assert.match(m.bykPlanLine(true), /Using ChatGPT plan/, "before any call the boot answer decides"); assert.strictEqual(m.bykPlanLine(false), "");
const a = {}, b = {};
m.bykUsed(false, a, true); assert.strictEqual(m.bykPlanLine(true, a), "", "1Helm's models or another service answered: no line, even if boot said ChatGPT");
assert.match(m.bykPlanLine(true, b), /Using ChatGPT plan/, "another task is not affected by this task's answer");
m.bykUsed(true, a, true); assert.match(m.bykPlanLine(false, a), /Using ChatGPT plan/); assert.match(dom.line, /Using ChatGPT plan/, "the line is added under the composer");
m.bykUsed(false, a, true); assert.strictEqual(dom.line, null, "and removed when another model answers");
m.bykUsed(true, b, false); assert.strictEqual(dom.line, null, "an answer in a task that is not open leaves the open composer alone");
const c = {}; m.bykUsed("opencode" === "chatgpt", c, false); assert.strictEqual(m.bykPlanLine(true, c), "", "after a reload the saved service (not ChatGPT) overrides the boot flag");
console.log("byok used line: all passed");

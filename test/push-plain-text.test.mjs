// node --import ./test/stubs/register.mjs test/push-plain-text.test.mjs
// Push titles and bodies are plain text: no Markdown syntax, and the length limit applies after stripping.
import assert from "node:assert";
import { plainText, plainLine } from "../src/plain-text.js";
import { pushAll } from "../src/notify.js";
const eq = (a, b) => assert.strictEqual(plainLine(a, 500), b, JSON.stringify(a));
eq("Yes. Press **Eco** on the AC or remote and leave the unit in **Cool** mode.", "Yes. Press Eco on the AC or remote and leave the unit in Cool mode.");
eq("*italic* and _also italic_ and ***both***", "italic and also italic and both");
eq("# Title\n## Sub\nbody", "Title Sub body");
eq("Run `npm test` now", "Run npm test now");
eq("```js\nconst a = 1;\n```\ndone", "const a = 1; done");
eq("See [the docs](https://x.com/a_b) and ![logo](https://x.com/l.png)", "See the docs and logo");
eq("- one\n* two\n+ three\n1. four\n2) five\n- [x] six", "one two three four five six");
eq("> quoted\n> more", "quoted more");
eq("~~gone~~ kept", "gone kept");
eq("| a | b |\n|---|---|\n| 1 | 2 |", "a b 1 2");
eq("<b>bold</b> <br/> text", "bold text");
eq("snake_case_name and file_name.txt", "snake_case_name and file_name.txt");
eq("2 * 3 * 4 = 24", "2 * 3 * 4 = 24");
eq("5 * 3 and a*b", "5 * 3 and a*b");
eq("---\ntext", "text");
eq("\\*literal\\*", "*literal*");
eq("", ""); eq(null, "");
assert.strictEqual(plainLine("**" + "a".repeat(200) + "**", 140).length, 140);          // cut after stripping, so no stray asterisks
assert.ok(!plainLine("**" + "a".repeat(200) + "**", 140).includes("*"));
assert.strictEqual(plainText("line one\n\n\n\nline two"), "line one\n\nline two");
// pushAll strips whatever payload a caller builds (phone app and Web Push both get the same payload).
const calls = [];
const env = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), run: async () => ({}), first: async () => null }) }) } };
const r = await pushAll(env, "t1", { title: "**Hi** `there`", body: "[a](http://b) **x**" });
assert.ok(r); // no devices, no vapid: returns early without throwing
console.log("push-plain-text ok");

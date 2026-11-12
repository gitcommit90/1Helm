// node test/genui-no-required.test.mjs: no card component has a required field. Each draws what it has, and a reply whose cards
// draw nothing falls back to plain text, so a card reply is never blank. Includes the Live reply that vanished (Email with an empty to).
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "gnr-")), entry = join(dir, "entry.ts"), out = join(dir, "g.mjs");
writeFileSync(entry, `export { renderCard, cardText, plainPreview } from ${JSON.stringify(new URL("../src/genui-render.ts", import.meta.url).pathname)};`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error", mainFields: ["module", "main"], loader: { ".json": "json" } });
globalThis.window = globalThis.window || {}; globalThis.document = globalThis.document || { addEventListener() {}, querySelectorAll: () => [] };
const { renderCard, cardText } = await import(out);
let n = 0;
const draw = (code) => renderCard(code, { owner: {}, ref: {}, sid: "s" + n++, streaming: false, file: () => null, icon: () => "" });
const html = (code) => { const r = draw(code); assert.ok("html" in r, `html expected for ${code}: ${JSON.stringify(r)}`); return r.html; };

// The exact Live reply (body shortened).
const live = `root = Stack([e])\ne = Email("", "Re: Tennis Channel DE schedule", "Hi team,\\n\\nThanks for the schedule. Two questions below.\\n\\nBest")`;
const h = html(live);
assert.ok(h.includes("gu-mail") && h.includes("Re: Tennis Channel DE schedule") && h.includes("Thanks for the schedule"), h);
assert.ok(!h.includes("<span>To</span>"), "no To row when to is empty");
assert.ok(html(`Email("", "subj", "body")`).includes("subj"));
assert.ok(html(`Email("a@example.com", "subj", "body")`).includes("<span>To</span>"));
assert.ok(html(`Email("", "", "only body")`).includes("only body"));

// Each component that used to be required-gated, with that field empty.
const cases = {
  Option: [`Options("pick", [Option("", "just detail", "$5")])`, "just detail"],
  Button: [`Buttons([Button("", "go_now", "primary")])`, "go_now"],
  Stepper: [`Form("f", [Stepper("guests", "", 2)], "Send")`, "guests"],
  Choice: [`Form("f", [Choice("size", "", ["S", "M"])], "Send")`, "gu-chip"],
  Field: [`Form("f", [Field("city", "", "type here")], "Send")`, "type here"],
  Big: [`Big("", "just a label")`, "just a label"],
  Bars: [`Bars([], [1, 2, 3])`, "gu-bar"],
  File: [`File("", "12 KB")`, "12 KB"],
  Meter: [`Meter("", 0.4, "a note")`, "a note"],
  Say: [`Say("hello there")`, "hello there"],
  Rows: [`Rows([["a", "b"]])`, "gu-rows"],
};
for (const [k, [code, want]] of Object.entries(cases)) assert.ok(html(code).includes(want), `${k} with an empty field: ${html(code)}`);
// Each previously required field, empty, for the components whose other fields are present.
assert.ok(html(`Stack([Say("kept")])`).includes("kept"));

// All-unrenderable reply: plain text instead of blank. A card with nothing at all, a parse error, and an empty Email next to prose.
const empty = draw(`Email("", "", "")`); assert.ok("text" in empty, JSON.stringify(empty));
const bars = draw(`Bars(["Jan", "Feb"], ["x", "y"])`); assert.ok("text" in bars && bars.text.includes("Jan"), JSON.stringify(bars));
const broken = draw(`root = Stack([Say("Fallback words", [)\nSay("more")`);
assert.ok(("html" in broken && broken.html.trim()) || ("text" in broken && broken.text.includes("Fallback words")), "never blank: " + JSON.stringify(broken));
const txt = cardText(live); assert.ok(txt.includes("Re: Tennis Channel DE schedule") && txt.includes("Thanks for the schedule"), txt);
console.log("genui-no-required: all passed");

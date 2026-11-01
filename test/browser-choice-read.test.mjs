// node --import ./test/stubs/register.mjs test/browser-choice-read.test.mjs
// The browser service's dropdown pick reports what the page shows afterwards. A React-Select style control (the Greenhouse form in the
// 2026-11-01 SpaceX failure) keeps its input empty and shows the choice in a sibling element, so the old read-back said "the choice did
// not stick" although it had. The read now looks at that element, and a mismatch comes back as text, never as an error.
// The pure judge is loaded from server.mjs between its markers. The in-page read runs in a real Chrome against test/fixtures/react-select-form.html
// when puppeteer and Chrome are on this host (skipped otherwise, said on the output).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const src = readFileSync(new URL("../image/opt/1hc-browser/server.mjs", import.meta.url), "utf8");
const block = (name) => { const m = src.match(new RegExp(`// <${name}>[^\\n]*\\n([\\s\\S]*?)// </${name}>`)); assert(m, `${name} markers in server.mjs`); return m[1]; };
const { judgeChoice, describePick } = new Function(`${block("choice-judge")}\nreturn { judgeChoice, describePick };`)();
const CUSTOM_JS = new Function(`${block("choice-read")}\nreturn CUSTOM_JS;`)();

// ---- the judge ----
assert.equal(judgeChoice("Western Governors University", { shown: [], near: ["Western Governors University"], marked: [], backing: "" }).ok, true, "the displayed value element counts");
assert.equal(judgeChoice("Western Governors University", { shown: [], near: ["Western Governors University"] }).where, "the displayed value");
assert.equal(judgeChoice("texas", { shown: ["Texas"] }).where, "the field");
assert.equal(judgeChoice("Texas", { shown: [], marked: ["Texas"] }).where, "the marked option");
assert.equal(judgeChoice("Texas", { backing: "texas" }).where, "the hidden list behind the field");
assert.equal(judgeChoice("Western Governors University", { near: ["Western Governors University (WGU)"] }).ok, true, "a displayed item that holds the text counts");
assert.equal(judgeChoice("UT", { near: ["Utah"] }).ok, false, "a short wanted text is matched exactly only");
{ const j = judgeChoice("Texas", { shown: ["Tex"], near: [], marked: [], backing: "" });
  assert.equal(j.ok, false); assert.equal(j.seen, "Tex");
  const t = describePick("Texas", "e9", "clicked the item", j);
  assert.equal(typeof t, "string"); assert.match(t, /picked "Texas" in e9/); assert.match(t, /does not clearly show it/); assert.match(t, /new snapshot/); }
assert.match(describePick("X", "e1", "clicked the item", judgeChoice("X", {})), /no selected text was visible/);
assert.match(describePick("Texas", "e9", "clicked the item", judgeChoice("Texas", { shown: ["Texas"] })), /^chose "Texas" in e9 \(clicked the item; the page shows it in the field\)$/);
// chooseCustom no longer throws on a mismatch and no longer carries the old error text
assert(!/did not stick\(/.test(src) && !/choice did not stick \(/.test(src), "the old thrown message is gone");
assert(/describePick\(want, a\.ref, how, judgeChoice\(want, await r\("read"\)\)\)/.test(src));
console.log("  ok judge");

// ---- the in-page read, in a real Chrome ----
const CHROME = process.env.CHROME_BIN || "";   // path of a Chrome or Chromium binary; the in-page read is skipped without it
let puppeteer = null;
for (const base of [new URL("../node_modules/", import.meta.url).pathname]) {
  try { puppeteer = createRequire(base + "x.js")("puppeteer"); } catch {}
  if (puppeteer) break;
}
if (!puppeteer || !existsSync(CHROME)) console.log("  skipped in-page read: puppeteer or Chrome is not on this host");
else {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"], headless: true });
  try {
    const page = await browser.newPage();
    await page.goto("file://" + new URL("./fixtures/react-select-form.html", import.meta.url).pathname);
    const read = async (ref, want) => page.evaluate(CUSTOM_JS(ref, want, "read"));
    // the old read-back (input value, innerText, aria-valuetext) saw only this
    assert.equal(await page.$eval("#school", (e) => e.value), "", "the React-Select input stays empty after a pick");
    const v1 = await read("e41", "Western Governors University");
    assert.deepEqual(v1.near, ["Western Governors University"]);
    const j1 = judgeChoice("Western Governors University", v1);
    assert.equal(j1.ok, true); console.log("  pick result:", describePick("Western Governors University", "e41", "clicked the item", j1));
    const v2 = await read("e51", "Computer Science");   // nothing chosen: a placeholder is not a choice
    assert.deepEqual(v2.near, []); const j2 = judgeChoice("Computer Science", v2);
    assert.equal(j2.ok, false); console.log("  mismatch result:", describePick("Computer Science", "e51", "clicked the item", j2));
    const v3 = await read("e61", "Texas");
    assert.deepEqual(v3.marked, ["Texas"]); assert.equal(judgeChoice("Texas", v3).ok, true);
    // the arrow button's ref reads the same field
    assert.equal(judgeChoice("Western Governors University", await read("e42", "Western Governors University")).ok, true);
    console.log("  ok in-page read");
  } finally { await browser.close(); }
}
console.log("browser-choice-read passed");

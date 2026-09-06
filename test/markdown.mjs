import assert from "node:assert/strict";
import test from "node:test";
import { md, textReplaceOps } from "../src/client/dom.ts";

test("md renders headings and emphasis for the document surface", () => {
  const html = md("# Title\n\n**bold** and _italic_\n\n- one\n- two\n");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<ul>/);
  assert.doesNotMatch(html, /\*\*bold\*\*/);
});

test("textReplaceOps keeps shared prefix and suffix", () => {
  assert.equal(textReplaceOps("same", "same"), null);
  assert.deepEqual(textReplaceOps("abXcd", "abYcd"), { start: 2, deleteLen: 1, insert: "Y" });
  assert.deepEqual(textReplaceOps("aaa", "bbb"), { start: 0, deleteLen: 3, insert: "bbb" });
});

test("md renders TeX delimiters as native MathML without breaking surrounding Markdown", () => {
  const html = md(String.raw`Before \(S_2 = N^\alpha\) after.

\[
T_{\text{total}} = \frac{F}{C_t} + \text{decode}
\]

**Still bold.**`);

  assert.match(html, /class="math-inline"/);
  assert.match(html, /class="math-display"/);
  assert.match(html, /<math[^>]*>/);
  assert.match(html, /<mfrac>/);
  assert.match(html, /<strong>Still bold\.<\/strong>/);
  assert.doesNotMatch(html, /\\\\\[|\\\\\]|\\\\\(|\\\\\)/);
  assert.doesNotMatch(html, /math-display[^]*?<br>/);
});

test("md leaves TeX-like delimiters in fenced code untouched", () => {
  const html = md("```text\n\\[not rendered\\]\n```");
  assert.equal(html, "<pre><code>\\[not rendered\\]</code></pre>");
  assert.doesNotMatch(html, /<math/);
});

test("md safely falls back to source for invalid or untrusted TeX", () => {
  const html = md(String.raw`\[\href{javascript:alert(1)}{bad}\] and \(\definitelyUnknown{x}\)`);
  assert.match(html, /class="math-source"/);
  assert.doesNotMatch(html, /<a\s|href=["']/);
});
